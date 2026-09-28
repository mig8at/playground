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

// loadPage lee una página con la caché en disco de su versión.
func (s *server) loadPage(ctx context.Context, key string, h figma.FileHead, page figma.Project) (figma.Structure, error) {
	path := filepath.Join(s.cache, key, versionDir(h.Version), "maps", reNotDigit.ReplaceAllString(page.ID, "-")+".json")
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

// loadPages lee todas las páginas del archivo menos la portada, en el orden de Figma. Una que falla no tumba las demás: va
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
		if reCoverPage.MatchString(p.Name) {
			continue // la portada es la tapa del archivo: ni pestaña ni búsqueda (Miguel, 2026-09-28)
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

var reCoverPage = regexp.MustCompile(`(?i)cover|portada`)

var pageLocks sync.Map // clave del archivo → *sync.Mutex

func (s *server) pageLock(key string) *sync.Mutex {
	m, _ := pageLocks.LoadOrStore(s.cache+"|"+key, &sync.Mutex{})
	return m.(*sync.Mutex)
}

// searchHit es una pantalla encontrada, con la página donde vive.
type searchHit struct {
	Page     string `json:"page"`
	PageName string `json:"page_name"`
	ID       string `json:"id"`
	Title    string `json:"title"`
	Lane     string `json:"lane"`
	Section  string `json:"section"`
	Index    int    `json:"index"`
	Total    int    `json:"total"`
}

const searchLimit = 200

// searchPages busca pantallas en las páginas: todas las palabras tienen que estar en el título, la capa, el
// carril, la sección o el nombre de la página. Con `id`, la pantalla con ese id (para saber en qué página vive).
func searchPages(pages []pageMap, q, id string) (hits []searchHit, total int) {
	words := strings.Fields(fold(q))
	for _, p := range pages {
		for _, fs := range flowScreens(p.St) {
			if id != "" {
				if fs.sc.ID != id {
					continue
				}
			} else {
				text := fold(strings.Join([]string{fs.sc.Title, fs.sc.Name, fs.lane, fs.section, p.Name}, " "))
				all := len(words) > 0
				for _, w := range words {
					if !strings.Contains(text, w) {
						all = false
						break
					}
				}
				if !all {
					continue
				}
			}
			total++
			if len(hits) < searchLimit {
				title := fs.sc.Title
				if title == "" {
					title = fs.sc.Name
				}
				hits = append(hits, searchHit{Page: p.ID, PageName: p.Name, ID: fs.sc.ID, Title: title, Lane: fs.lane,
					Section: fs.section, Index: fs.index, Total: fs.total})
			}
		}
	}
	return hits, total
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
