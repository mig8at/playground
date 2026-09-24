package main

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"sync"
	"time"

	"creditop/playground/connectors/figma"
)

// La BIBLIOTECA del visor: los equipos y archivos de donde salen los proyectos de la barra. La API de
// Figma no lista los equipos de una cuenta ni lo visto recientemente, así que se arma de lo que se sumó
// a mano —equipos y proyectos, por la URL de su página— y de los archivos que se abrieron en el visor.
// Se guarda en `visor/.cache/library.json`: es una preferencia de esta máquina, no un dato del repo.

type library struct {
	Teams []string `json:"teams"`
	// Projects son proyectos (carpetas) sumados sueltos: para cuando la cuenta ve una carpeta de otro
	// equipo sin ser miembro del equipo, o no se tiene a mano la página del equipo.
	Projects []string      `json:"projects,omitempty"`
	Opened   []openedEntry `json:"opened"`
}

type openedEntry struct {
	Key      string `json:"key"`
	Name     string `json:"name"`
	OpenedAt string `json:"opened_at"`
}

type libraryView struct {
	Teams    []teamView    `json:"teams"`
	Projects []projectView `json:"projects"`
	Opened   []openedEntry `json:"opened"`
}

type teamView struct {
	ID       string        `json:"id"`
	Name     string        `json:"name"`
	Projects []projectView `json:"projects"`
	Error    string        `json:"error,omitempty"`
}

type projectView struct {
	ID    string            `json:"id"`
	Name  string            `json:"name"`
	Files []figma.FileEntry `json:"files"`
	Error string            `json:"error,omitempty"`
}

var (
	reTeam    = regexp.MustCompile(`/team/([0-9]+)`)
	reProject = regexp.MustCompile(`/project/([0-9]+)`)
)

type libraryStore struct {
	mu    sync.Mutex
	path  string
	view  *libraryView // lo último leído de Figma, para no pedir los proyectos en cada apertura
	taken time.Time
}

func (l *libraryStore) read() library {
	var lib library
	if b, err := os.ReadFile(l.path); err == nil {
		_ = json.Unmarshal(b, &lib)
	}
	return lib
}

func (l *libraryStore) write(lib library) error {
	if err := os.MkdirAll(filepath.Dir(l.path), 0o755); err != nil {
		return err
	}
	b, _ := json.MarshalIndent(lib, "", "  ")
	if err := os.WriteFile(l.path+".tmp", b, 0o644); err != nil {
		return err
	}
	l.view = nil
	return os.Rename(l.path+".tmp", l.path)
}

// opened anota un archivo abierto en el visor: queda en «Abiertos en el visor» sin pedirlo.
func (l *libraryStore) opened(key, name string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	lib := l.read()
	now := time.Now().Format(time.RFC3339)
	for i := range lib.Opened {
		if lib.Opened[i].Key == key {
			lib.Opened[i].Name, lib.Opened[i].OpenedAt = name, now
			_ = l.write(lib)
			return
		}
	}
	lib.Opened = append(lib.Opened, openedEntry{Key: key, Name: name, OpenedAt: now})
	_ = l.write(lib)
}

// handleLibrary devuelve los proyectos (de los equipos sumados y los sumados sueltos), con sus
// archivos, y los abiertos. Con POST {url} suma un equipo, un proyecto o un archivo, según la URL; con
// DELETE ?team=|?project=|?file= lo saca.
func (s *server) handleLibrary(w http.ResponseWriter, r *http.Request) {
	l := s.library
	switch r.Method {
	case http.MethodPost:
		var body struct {
			URL string `json:"url"`
		}
		if json.NewDecoder(r.Body).Decode(&body) != nil || body.URL == "" {
			fail(w, 400, "falta url: la página de un equipo o de un proyecto de Figma, o un archivo")
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
		defer cancel()
		if m := reProject.FindStringSubmatch(body.URL); m != nil {
			// Un proyecto también se prueba antes de guardarlo.
			if _, err := s.figma.ProjectFiles(ctx, m[1]); err != nil {
				fail(w, statusOf(err), "%v", err)
				return
			}
			l.mu.Lock()
			lib := l.read()
			if !contains(lib.Projects, m[1]) {
				lib.Projects = append(lib.Projects, m[1])
			}
			err := l.write(lib)
			l.mu.Unlock()
			if err != nil {
				fail(w, 500, "%v", err)
				return
			}
		} else if m := reTeam.FindStringSubmatch(body.URL); m != nil {
			// Se prueba antes de guardarlo: un equipo al que la cuenta no entra (403) no se suma callado.
			if _, _, err := s.figma.TeamProjects(ctx, m[1]); err != nil {
				fail(w, statusOf(err), "%v", err)
				return
			}
			l.mu.Lock()
			lib := l.read()
			if !contains(lib.Teams, m[1]) {
				lib.Teams = append(lib.Teams, m[1])
			}
			err := l.write(lib)
			l.mu.Unlock()
			if err != nil {
				fail(w, 500, "%v", err)
				return
			}
		} else {
			ref, err := figma.ParseRef(body.URL)
			if err != nil {
				fail(w, 400, "%v", err)
				return
			}
			meta, err := s.figma.Meta(ctx, ref.FileKey)
			if err != nil {
				fail(w, statusOf(err), "%v", err)
				return
			}
			l.opened(ref.FileKey, meta.Name)
		}
	case http.MethodDelete:
		l.mu.Lock()
		lib := l.read()
		if t := r.URL.Query().Get("team"); t != "" {
			lib.Teams = remove(lib.Teams, t)
		}
		if p := r.URL.Query().Get("project"); p != "" {
			lib.Projects = remove(lib.Projects, p)
		}
		if f := r.URL.Query().Get("file"); f != "" {
			var keep []openedEntry
			for _, o := range lib.Opened {
				if o.Key != f {
					keep = append(keep, o)
				}
			}
			lib.Opened = keep
		}
		_ = l.write(lib)
		l.mu.Unlock()
	}
	view, err := s.libraryView(r.Context(), r.URL.Query().Get("fresh") != "")
	if err != nil {
		fail(w, statusOf(err), "%v", err)
		return
	}
	writeJSON(w, 200, view)
}

// libraryView pide a Figma los proyectos y archivos de cada equipo. Se guarda 10 minutos: la barra
// se abre seguido y los proyectos cambian poco; `fresh` lo vuelve a pedir.
func (s *server) libraryView(ctx context.Context, fresh bool) (libraryView, error) {
	l := s.library
	l.mu.Lock()
	lib := l.read()
	cached := l.view
	if cached != nil && !fresh && time.Since(l.taken) < 10*time.Minute {
		out := *cached
		out.Opened = sortOpened(lib.Opened)
		l.mu.Unlock()
		return out, nil
	}
	l.mu.Unlock()
	view := libraryView{Opened: sortOpened(lib.Opened)}
	for _, t := range lib.Teams {
		tv := teamView{ID: t}
		name, projects, err := s.figma.TeamProjects(ctx, t)
		if err != nil {
			tv.Error = err.Error()
			view.Teams = append(view.Teams, tv)
			continue
		}
		tv.Name = name
		for _, p := range projects {
			pv := projectView{ID: p.ID, Name: p.Name}
			files, err := s.figma.ProjectFiles(ctx, p.ID)
			if err != nil {
				pv.Error = err.Error()
			}
			pv.Files = files
			tv.Projects = append(tv.Projects, pv)
		}
		view.Teams = append(view.Teams, tv)
	}
	// Los proyectos sumados sueltos: su nombre viene en la misma respuesta que sus archivos.
	for _, p := range lib.Projects {
		name, files, err := s.figma.ProjectFilesNamed(ctx, p)
		pv := projectView{ID: p, Name: name, Files: files}
		if err != nil {
			pv.Error = err.Error()
		}
		view.Projects = append(view.Projects, pv)
	}
	l.mu.Lock()
	l.view, l.taken = &view, time.Now()
	l.mu.Unlock()
	return view, nil
}

func sortOpened(list []openedEntry) []openedEntry {
	out := append([]openedEntry(nil), list...)
	sort.SliceStable(out, func(i, j int) bool { return out[i].OpenedAt > out[j].OpenedAt })
	return out
}

// handlePages devuelve las páginas de un archivo: lo que se despliega bajo él en la barra.
func (s *server) handlePages(w http.ResponseWriter, r *http.Request) {
	key := r.URL.Query().Get("key")
	if !reFileKey.MatchString(key) {
		fail(w, 400, "clave inválida")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()
	name, pages, err := s.figma.Pages(ctx, key)
	if err != nil {
		fail(w, statusOf(err), "%v", err)
		return
	}
	writeJSON(w, 200, map[string]any{"key": key, "name": name, "pages": pages})
}

func contains(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}

func remove(list []string, s string) []string {
	var out []string
	for _, x := range list {
		if x != s {
			out = append(out, x)
		}
	}
	return out
}
