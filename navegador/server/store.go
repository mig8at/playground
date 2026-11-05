package main

/* Lo que se guarda, todo bajo navegador/.data/ (gitignoreado: trae cookies de sesión y capturas):
 *
 *	sites.json                 los sitios dados de alta
 *	<sitio>/profile/           el perfil de Chromium: ahí quedan las cookies del login manual
 *	<sitio>/pages.json         el mapa: una entrada por página visitada, a mano o explorando
 *	<sitio>/shots/<id>.png     la captura de cada página
 */

import (
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

// Site es un sitio dado de alta: de dónde se arranca y qué host se considera «adentro».
type Site struct {
	Slug    string    `json:"slug"`
	Name    string    `json:"name"`
	URL     string    `json:"url"`
	Host    string    `json:"host"`
	Created time.Time `json:"created"`
}

type Link struct {
	Text string `json:"text"`
	Href string `json:"href"`
}

type Field struct {
	Tag         string   `json:"tag"`
	Type        string   `json:"type"`
	Name        string   `json:"name"`
	ID          string   `json:"id"`
	Label       string   `json:"label"`
	Placeholder string   `json:"placeholder"`
	Required    bool     `json:"required"`
	Options     []string `json:"options"`
}

type Form struct {
	Action  string   `json:"action"`
	Method  string   `json:"method"`
	Fields  []Field  `json:"fields"`
	Submits []string `json:"submits"`
	Loose   bool     `json:"loose,omitempty"`
}

type Heading struct {
	Level int    `json:"level"`
	Text  string `json:"text"`
}

// Request es una llamada que hizo la página (sólo XHR, fetch, documento y websocket: lo que habla con un backend).
type Request struct {
	Method string `json:"method"`
	URL    string `json:"url"`
	Status int    `json:"status"`
	Type   string `json:"type"`
}

// Page es lo que se sabe de una página: su estructura, con qué backend habla y qué falló.
type Page struct {
	ID        string         `json:"id"`
	URL       string         `json:"url"`
	FinalURL  string         `json:"finalUrl"`
	Title     string         `json:"title"`
	Lang      string         `json:"lang"`
	Status    int            `json:"status"`
	Depth     int            `json:"depth"`
	Parent    string         `json:"parent"` // id de la página desde la que se llegó (vacío: la entrada)
	Source    string         `json:"source"` // manual · explore
	At        time.Time      `json:"at"`
	Stack     []string       `json:"stack"`
	Headings  []Heading      `json:"headings"`
	Links     []Link         `json:"links"`
	Forms     []Form         `json:"forms"`
	Buttons   []string       `json:"buttons"`
	Landmarks map[string]int `json:"landmarks"`
	Requests  []Request      `json:"requests"`
	Console   []string       `json:"console"`
	Shot      bool           `json:"shot"`
	AuthWall  bool           `json:"authWall"`
	Error     string         `json:"error,omitempty"`
}

// PendingLink es un enlace que el recorrido encontró y no llegó a visitar.
type PendingLink struct {
	URL    string `json:"url"`
	Parent string `json:"parent"`
	Depth  int    `json:"depth"`
}

// Run es el resumen del último recorrido: sin esto, «40 páginas» no dice si el sitio tiene 40 o 4.000.
type Run struct {
	Started  time.Time     `json:"started"`
	Finished time.Time     `json:"finished"`
	Max      int           `json:"max"`
	Depth    int           `json:"depth"`
	Visited  int           `json:"visited"`
	Queued   int           `json:"queued"`
	Stopped  bool          `json:"stopped"`
	AuthWall bool          `json:"authWall"`
	Pending  []PendingLink `json:"pending"`
}

func (s *Store) SaveRun(slug string, run Run) error {
	return writeJSONFile(filepath.Join(s.siteDir(slug), "run.json"), run)
}

// LastRun devuelve el último recorrido, o nil si nunca se exploró.
func (s *Store) LastRun(slug string) *Run {
	b, err := os.ReadFile(filepath.Join(s.siteDir(slug), "run.json"))
	if err != nil {
		return nil
	}
	var run Run
	if json.Unmarshal(b, &run) != nil {
		return nil
	}
	return &run
}

// Page devuelve una página del mapa, o nil.
func (s *Store) Page(slug, id string) *Page {
	if id == "" {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	m, err := s.loadPagesLocked(slug)
	if err != nil {
		return nil
	}
	if p, ok := m[id]; ok {
		cp := *p
		return &cp
	}
	return nil
}

// Store guarda sitios y mapas en disco. Un solo candado para todo: las escrituras son pocas y chicas.
type Store struct {
	dir   string
	mu    sync.Mutex
	sites []Site
	pages map[string]map[string]*Page // sitio → id → página
}

func OpenStore(dir string) (*Store, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	s := &Store{dir: dir, pages: map[string]map[string]*Page{}}
	b, err := os.ReadFile(filepath.Join(dir, "sites.json"))
	if err == nil {
		if err := json.Unmarshal(b, &s.sites); err != nil {
			return nil, fmt.Errorf("sites.json: %w", err)
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	return s, nil
}

func (s *Store) siteDir(slug string) string    { return filepath.Join(s.dir, slug) }
func (s *Store) ProfileDir(slug string) string { return filepath.Join(s.siteDir(slug), "profile") }
func (s *Store) ShotPath(slug, id string) string {
	return filepath.Join(s.siteDir(slug), "shots", id+".png")
}

var slugJunk = regexp.MustCompile(`[^a-z0-9]+`)

// AddSite da de alta un sitio por su URL de entrada. El slug sale del host; si ya hay uno igual, se numera.
func (s *Store) AddSite(raw, name string) (Site, error) {
	raw = strings.TrimSpace(raw)
	if !strings.Contains(raw, "://") {
		raw = "https://" + raw
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
		return Site{}, fmt.Errorf("no es una URL http(s): %q", raw)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	base := strings.Trim(slugJunk.ReplaceAllString(strings.ToLower(u.Hostname()), "-"), "-")
	slug := base
	for i := 2; s.findLocked(slug) != nil; i++ {
		slug = fmt.Sprintf("%s-%d", base, i)
	}
	if strings.TrimSpace(name) == "" {
		name = u.Hostname()
	}
	site := Site{Slug: slug, Name: strings.TrimSpace(name), URL: u.String(), Host: u.Host, Created: time.Now()}
	s.sites = append(s.sites, site)
	return site, s.saveSitesLocked()
}

// RemoveSite olvida el sitio y borra su carpeta: perfil (la sesión), mapa y capturas.
func (s *Store) RemoveSite(slug string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.findLocked(slug) == nil {
		return fmt.Errorf("no hay un sitio %q", slug)
	}
	out := s.sites[:0]
	for _, x := range s.sites {
		if x.Slug != slug {
			out = append(out, x)
		}
	}
	s.sites = out
	delete(s.pages, slug)
	if err := os.RemoveAll(s.siteDir(slug)); err != nil {
		return err
	}
	return s.saveSitesLocked()
}

func (s *Store) Site(slug string) (Site, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if x := s.findLocked(slug); x != nil {
		return *x, nil
	}
	return Site{}, fmt.Errorf("no hay un sitio %q", slug)
}

func (s *Store) findLocked(slug string) *Site {
	for i := range s.sites {
		if s.sites[i].Slug == slug {
			return &s.sites[i]
		}
	}
	return nil
}

func (s *Store) saveSitesLocked() error {
	return writeJSONFile(filepath.Join(s.dir, "sites.json"), s.sites)
}

// SiteSummary es una fila del sidebar.
type SiteSummary struct {
	Site
	Pages      int       `json:"pages"`
	HasSession bool      `json:"hasSession"` // el perfil tiene cookies: NO prueba que haya un login vigente
	LastAt     time.Time `json:"lastAt"`
	Queued     int       `json:"queued"` // lo que el último recorrido dejó en la cola sin visitar
}

func (s *Store) Sites() []SiteSummary {
	s.mu.Lock()
	sites := append([]Site(nil), s.sites...)
	s.mu.Unlock()
	out := []SiteSummary{}
	for _, x := range sites {
		row := SiteSummary{Site: x}
		pages, _ := s.Pages(x.Slug)
		row.Pages = len(pages)
		for _, p := range pages {
			if p.At.After(row.LastAt) {
				row.LastAt = p.At
			}
		}
		_, err := os.Stat(filepath.Join(s.ProfileDir(x.Slug), "Default", "Cookies"))
		row.HasSession = err == nil
		if run := s.LastRun(x.Slug); run != nil {
			row.Queued = run.Queued
		}
		out = append(out, row)
	}
	return out
}

func (s *Store) loadPagesLocked(slug string) (map[string]*Page, error) {
	if m, ok := s.pages[slug]; ok {
		return m, nil
	}
	m := map[string]*Page{}
	b, err := os.ReadFile(filepath.Join(s.siteDir(slug), "pages.json"))
	if err == nil {
		var list []*Page
		if err := json.Unmarshal(b, &list); err != nil {
			return nil, fmt.Errorf("%s/pages.json: %w", slug, err)
		}
		for _, p := range list {
			m[p.ID] = p
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	s.pages[slug] = m
	return m, nil
}

// Pages devuelve el mapa del sitio ordenado por URL (así las secciones quedan juntas).
func (s *Store) Pages(slug string) ([]*Page, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	m, err := s.loadPagesLocked(slug)
	if err != nil {
		return nil, err
	}
	out := make([]*Page, 0, len(m))
	for _, p := range m {
		out = append(out, p)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].URL < out[j].URL })
	return out, nil
}

// PutPage agrega o reemplaza una página y escribe el mapa entero (son decenas de páginas, no miles).
func (s *Store) PutPage(slug string, p *Page) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	m, err := s.loadPagesLocked(slug)
	if err != nil {
		return err
	}
	m[p.ID] = p
	return s.savePagesLocked(slug, m)
}

// ClearPages vacía el mapa y sus capturas, sin tocar la sesión.
func (s *Store) ClearPages(slug string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.pages[slug] = map[string]*Page{}
	_ = os.RemoveAll(filepath.Join(s.siteDir(slug), "shots"))
	_ = os.Remove(filepath.Join(s.siteDir(slug), "run.json"))
	return s.savePagesLocked(slug, s.pages[slug])
}

func (s *Store) savePagesLocked(slug string, m map[string]*Page) error {
	list := make([]*Page, 0, len(m))
	for _, p := range m {
		list = append(list, p)
	}
	sort.Slice(list, func(i, j int) bool { return list[i].URL < list[j].URL })
	return writeJSONFile(filepath.Join(s.siteDir(slug), "pages.json"), list)
}

func writeJSONFile(path string, v any) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// NormalizeURL quita el fragmento (#…) y la barra final, para que la misma página no cuente dos veces.
// En una SPA con rutas por hash (#/clientes) el hash SÍ es la página: ese se conserva.
func NormalizeURL(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return raw
	}
	if !strings.HasPrefix(u.Fragment, "/") && !strings.HasPrefix(u.Fragment, "!/") {
		u.Fragment = ""
	}
	u.Path = strings.TrimSuffix(u.Path, "/")
	if u.Path == "" {
		u.Path = "/"
	}
	return u.String()
}

func PageID(normalized string) string {
	h := sha1.Sum([]byte(normalized))
	return hex.EncodeToString(h[:])[:12]
}
