package main

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"creditop/playground/connectors/figma"
)

// TODAS LAS PÁGINAS de un archivo. La barra arranca en la de flujo (flowPage), pero un archivo trae más:
// App Creditop tiene el recorrido en «✏️ Flujo» y la versión Q3 en «App_Q3_2026_v1.0». La interfaz las
// muestra como pestañas abajo, y el buscador y la consola las leen todas para encontrar una pantalla que
// no está en la de flujo. Cada página se guarda en disco por versión, como la de flujo: la primera lectura
// de una página grande (un benchmark) tarda, las siguientes cuestan el pedido chico de la versión.

// pageMap es el mapa de una página del archivo, o por qué no se pudo leer.
type pageMap struct {
	ID    string
	Name  string
	St    figma.Structure
	Error string
}

// mapsDir es la carpeta de los mapas en la caché. Cambia cuando el mapa guarda algo nuevo que hace falta leer:
// «maps-text» desde que cada pantalla trae todo su texto (figma.Screen.Text, para el buscador). Un mapa de
// la carpeta vieja no lo tiene, y sin esto el buscador no encontraría por texto hasta que el diseñador guarde.
const mapsDir = "maps-text"

// loadPage lee una página con la caché en disco de su versión.
func (s *server) loadPage(ctx context.Context, key string, h figma.FileHead, page figma.Project) (figma.Structure, error) {
	path := filepath.Join(s.cache, key, versionDir(h.Version), mapsDir, reNotDigit.ReplaceAllString(page.ID, "-")+".json")
	var st figma.Structure
	if b, err := os.ReadFile(path); err == nil && json.Unmarshal(b, &st) == nil && st.Version == h.Version {
		s.keepMap(key, page.ID, st)
		return st, nil
	}
	st, err := s.figma.Structure(ctx, key, page.ID, false)
	if err != nil {
		return figma.Structure{}, err
	}
	if b, err := json.Marshal(st); err == nil && os.MkdirAll(filepath.Dir(path), 0o755) == nil {
		_ = os.WriteFile(path+".tmp", b, 0o644)
		_ = os.Rename(path+".tmp", path)
	}
	s.keepMap(key, page.ID, st)
	return st, nil
}

// loadPages lee todas las páginas de pantallas del archivo (no las de reHiddenPage), en el orden de Figma. Una que falla no tumba las demás: va
// con su error. Dos pedidos del mismo archivo a la vez (el buscador mientras se escribe) esperan al primero.
func (s *server) loadPages(ctx context.Context, key string) ([]pageMap, error) {
	lock := s.pageLock(key)
	lock.Lock()
	defer lock.Unlock()
	// Mientras se escribe en el buscador llega un pedido por palabra: preguntarle a Figma la versión en cada
	// uno costaba ~2,8 s aun con todo en caché. Lo leído vale un minuto; después se vuelve a preguntar.
	if v, ok := pagesMemo.Load(s.cache + "|" + key); ok && time.Since(v.(pagesRead).at) < pagesFresh {
		return v.(pagesRead).pages, nil
	}
	h, err := s.figma.Head(ctx, key)
	if err != nil {
		return nil, err
	}
	out := make([]pageMap, 0, len(h.Pages))
	for _, p := range h.Pages {
		if reHiddenPage.MatchString(p.Name) {
			continue
		}
		pm := pageMap{ID: p.ID, Name: p.Name}
		if st, err := s.loadPage(ctx, key, h, p); err != nil {
			pm.Error = err.Error()
		} else {
			pm.St = st
		}
		out = append(out, pm)
	}
	pagesMemo.Store(s.cache+"|"+key, pagesRead{at: time.Now(), pages: out})
	return out, nil
}

// pagesMemo guarda la última lectura de las páginas de cada archivo, por pagesFresh.
var pagesMemo sync.Map

const pagesFresh = time.Minute

type pagesRead struct {
	at    time.Time
	pages []pageMap
}

// reHiddenPage son las páginas que no son de pantallas: la portada (la tapa del archivo), el benchmark (una
// tarjeta que agrupa referencias) y los separadores hechos con rayas. No se muestran ni se buscan (Miguel,
// 2026-09-28). La interfaz usa la misma regla (App.vue).
var reHiddenPage = regexp.MustCompile(`(?i)cover|portada|bench|bechmarck|^[\s\-–—_=*·.|]*$`)

var pageLocks sync.Map // clave del archivo → *sync.Mutex

func (s *server) pageLock(key string) *sync.Mutex {
	m, _ := pageLocks.LoadOrStore(s.cache+"|"+key, &sync.Mutex{})
	return m.(*sync.Mutex)
}

// searchHit es una pantalla encontrada, con la página donde vive. Match es el pedazo del texto de la pantalla
// donde están las palabras, cuando no alcanzó con el título, la capa, el carril, la sección o la página.
type searchHit struct {
	Page     string `json:"page"`
	PageName string `json:"page_name"`
	ID       string `json:"id"`
	Title    string `json:"title"`
	Lane     string `json:"lane"`
	Section  string `json:"section"`
	Index    int    `json:"index"`
	Total    int    `json:"total"`
	Match    string `json:"match,omitempty"`
}

const searchLimit = 200

// searchPages busca pantallas en las páginas: todas las palabras tienen que estar en el título, la capa, el
// carril, la sección, el nombre de la página o TODO el texto de la pantalla. Adentro de cada página van
// primero las que se encontraron sin leer el texto: una palabra del título dice más que una de un párrafo.
// Con `id`, la pantalla con ese id (para saber en qué página vive).
func searchPages(pages []pageMap, q, id string) (hits []searchHit, total int) {
	words := strings.Fields(fold(q))
	has := func(text string, ws []string) bool {
		for _, w := range ws {
			if !strings.Contains(text, w) {
				return false
			}
		}
		return len(ws) > 0
	}
	var all []searchHit
	for _, p := range pages {
		var named, bySaid []searchHit
		for _, fs := range flowScreens(p.St) {
			title := fs.sc.Title
			if title == "" {
				title = fs.sc.Name
			}
			h := searchHit{Page: p.ID, PageName: p.Name, ID: fs.sc.ID, Title: title, Lane: fs.lane,
				Section: fs.section, Index: fs.index, Total: fs.total}
			meta := fold(strings.Join([]string{fs.sc.Title, fs.sc.Name, fs.lane, fs.section, p.Name}, " "))
			switch {
			case id != "":
				if fs.sc.ID == id {
					named = append(named, h)
				}
			case has(meta, words):
				named = append(named, h)
			case has(meta+" "+fold(fs.sc.Text), words):
				// Se muestra dónde dice la primera palabra que el título no tiene.
				for _, w := range words {
					if !strings.Contains(meta, w) {
						h.Match = snippet(fs.sc.Text, w)
						break
					}
				}
				bySaid = append(bySaid, h)
			}
		}
		all = append(append(all, named...), bySaid...)
	}
	if len(all) > searchLimit {
		return all[:searchLimit], len(all)
	}
	return all, len(all)
}

// snippet es el pedazo de `text` alrededor de la palabra `w` (ya plegada con fold), con «…» si se cortó. Se
// busca runa por runa, porque plegar las tildes cambia los bytes pero no la cantidad de letras.
func snippet(text, w string) string {
	const around = 36
	orig := []rune(text)
	folded := make([]rune, len(orig))
	for i, r := range orig {
		if f := []rune(fold(string(r))); len(f) == 1 {
			folded[i] = f[0]
		} else {
			folded[i] = r
		}
	}
	at := strings.Index(string(folded), w)
	if at < 0 {
		return ""
	}
	start := len([]rune(string(folded)[:at]))
	from, to := max(0, start-around), min(len(orig), start+len([]rune(w))+around)
	out := strings.TrimSpace(string(orig[from:to]))
	if from > 0 {
		out = "…" + out
	}
	if to < len(orig) {
		out += "…"
	}
	return out
}

// handleSearch: `/api/search?key=<clave>&q=<palabras>` busca en todas las páginas del archivo;
// `&id=<nodo>` en lugar de `q` dice en qué página vive esa pantalla.
func (s *server) handleSearch(w http.ResponseWriter, r *http.Request) {
	key, q, id := r.URL.Query().Get("key"), strings.TrimSpace(r.URL.Query().Get("q")), r.URL.Query().Get("id")
	if !reFileKey.MatchString(key) || (id != "" && !reNodeID.MatchString(id)) || (q == "" && id == "") {
		fail(w, 400, "falta key, y q (qué buscar) o id (qué pantalla)")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Minute)
	defer cancel()
	pages, err := s.readPages(ctx, key)
	if err != nil {
		fail(w, statusOf(err), "%v", err)
		return
	}
	hits, total := searchPages(pages, q, id)
	var failed []map[string]string
	for _, p := range pages {
		if p.Error != "" {
			failed = append(failed, map[string]string{"page": p.Name, "error": p.Error})
		}
	}
	if hits == nil {
		hits = []searchHit{}
	}
	writeJSON(w, 200, map[string]any{"key": key, "hits": hits, "total": total, "pages": len(pages), "failed": failed})
}
