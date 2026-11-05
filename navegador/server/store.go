package main

/* Lo que se guarda bajo navegador/.data/ (gitignoreado: trae cookies de sesión y fotos):
 *
 *	sites.json            los sitios (uno por host) donde se abrió una sesión
 *	<sitio>/profile/      el perfil de Chromium: ahí quedan las cookies del login manual
 *	corridas/<id>/        cada corrida: fotos de los pasos, pasos.json, run.json y su script (report.go)
 *
 * Los FLUJOS no van acá: son JSON versionados en navegador/flujos/ (flows.go). */

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

// Site es un host donde se abrió una sesión en vivo: su perfil de Chromium guarda el login.
type Site struct {
	Slug    string    `json:"slug"`
	Name    string    `json:"name"`
	URL     string    `json:"url"`
	Host    string    `json:"host"`
	Created time.Time `json:"created"`
}

// Page es la pantalla actual tal como la ve el análisis (analyze.js): lo que se puede tocar y los avisos.
type Page struct {
	ID       string    `json:"id"`
	URL      string    `json:"url"`
	FinalURL string    `json:"finalUrl"`
	Title    string    `json:"title"`
	Status   int       `json:"status"`
	At       time.Time `json:"at"`
	Console  []string  `json:"console"`
	Controls []Control `json:"controls"` // lo interactivo, con el localizador de Playwright para llegar a cada uno
	Notices  []string  `json:"notices"`  // avisos a la vista: errores de validación, alertas, muros anti-bots
	Error    string    `json:"error,omitempty"`
}

type Store struct {
	dir   string
	mu    sync.Mutex
	sites []Site
}

func OpenStore(dir string) (*Store, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	s := &Store{dir: dir}
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

func (s *Store) ProfileDir(slug string) string { return filepath.Join(s.dir, slug, "profile") }

var slugJunk = regexp.MustCompile(`[^a-z0-9]+`)

// SiteFor devuelve el sitio del host de una URL, y lo da de alta si no existe.
func (s *Store) SiteFor(raw string) (Site, error) {
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
	for _, x := range s.sites {
		if x.Host == u.Host {
			return x, nil
		}
	}
	// Con puerto (una app local), el puerto es parte del nombre: 127.0.0.1:5206 → 127-0-0-1-5206.
	slug := strings.Trim(slugJunk.ReplaceAllString(strings.ToLower(u.Host), "-"), "-")
	site := Site{Slug: slug, Name: u.Hostname(), URL: u.String(), Host: u.Host, Created: time.Now()}
	s.sites = append(s.sites, site)
	return site, writeJSONFile(filepath.Join(s.dir, "sites.json"), s.sites)
}

func (s *Store) Site(slug string) (Site, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, x := range s.sites {
		if x.Slug == slug {
			return x, nil
		}
	}
	return Site{}, fmt.Errorf("no hay un sitio %q", slug)
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
