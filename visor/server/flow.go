package main

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"

	"creditop/playground/connectors/figma"
)

// loadFlow lee la página de flujo de un archivo —la misma que abre la barra (flowPage)— y la guarda en
// disco POR VERSIÓN, como el JSON de cada pantalla. Antes el mapa vivía sólo en memoria: cada reinicio, y
// cada comando de consola, volvía a bajar el árbol entero de Figma (3,3 s flujo ecommerce, 2,3 s Motai,
// medido el 2026-09-25). Ahora cuesta un pedido chico (`Head`, un nivel del archivo) para saber la versión,
// y el árbol sólo se vuelve a bajar cuando el diseñador guardó algo.
func (s *server) loadFlow(ctx context.Context, key string) (figma.Structure, string, error) {
	h, err := s.figma.Head(ctx, key)
	if err != nil {
		return figma.Structure{}, "", err
	}
	page, ok := flowPage(h.Pages)
	if !ok {
		return figma.Structure{}, "", &figma.Error{Status: 404, Message: "el archivo no tiene páginas"}
	}
	path := filepath.Join(s.cache, key, versionDir(h.Version), "maps", reNotDigit.ReplaceAllString(page.ID, "-")+".json")
	var st figma.Structure
	if b, err := os.ReadFile(path); err == nil && json.Unmarshal(b, &st) == nil && st.Version == h.Version {
		s.keepMap(key, page.ID, st)
		return st, page.ID, nil
	}
	if st, err = s.figma.Structure(ctx, key, page.ID, false); err != nil {
		return figma.Structure{}, "", err
	}
	if b, err := json.Marshal(st); err == nil && os.MkdirAll(filepath.Dir(path), 0o755) == nil {
		_ = os.WriteFile(path+".tmp", b, 0o644)
		_ = os.Rename(path+".tmp", path)
	}
	s.keepMap(key, page.ID, st)
	return st, page.ID, nil
}

// keepMap deja el mapa en memoria, como si lo hubiera pedido la UI: el HTML de sus pantallas usa sus
// tokens, el paquete su carril y su inventario.
func (s *server) keepMap(key, node string, st figma.Structure) {
	s.mu.Lock()
	s.maps[key+"|"+node] = st
	if st.Version != "" {
		s.versions[key] = st.Version
	}
	s.mu.Unlock()
}

// libraryKeys son los archivos que la barra conoce: los abiertos o sumados, con su nombre.
func (s *server) libraryKeys() []openedEntry {
	var out []openedEntry
	seen := map[string]bool{}
	for _, o := range s.library.read().Opened {
		if !seen[o.Key] {
			seen[o.Key] = true
			out = append(out, o)
		}
	}
	return out
}

// fold es un texto para comparar: minúsculas y sin tildes.
func fold(s string) string {
	return strings.NewReplacer("á", "a", "é", "e", "í", "i", "ó", "o", "ú", "u", "ü", "u", "ñ", "n").Replace(strings.ToLower(s))
}
