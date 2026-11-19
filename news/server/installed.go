package main

// Los modelos instalados en esta máquina (la Mac o el PC: lib/machine), en el sidebar de News, con su tamaño y una papelera. La búsqueda, el borrado y el
// registro de quién usa qué son de lib/models, el mismo código que el CLI `bin/models`: los dos dicen siempre lo mismo.

import (
	"net/http"
	"time"

	"creditop/my-tools/lib/machine"
	"creditop/my-tools/lib/models"
)

// installed: lo que hay en esta máquina, con quién lo usa según models/registry.json (se lee en cada pedido: editarlo no
// pide reiniciar News).
//
// Medir es caro (recorre cada modelo y cada venv: un entorno con torch son decenas de miles de archivos) y la interfaz
// lo pide seguido, así que la medida vale `scanFresh`; borrar la invalida. El registro, que es un archivo chico, sí se
// lee siempre.
func (s *server) installed() ([]models.Installed, error) {
	reg, err := models.LoadRegistry(s.root)
	if err != nil {
		return nil, err
	}
	s.scanMu.Lock()
	if s.scan == nil || time.Since(s.scanAt) > scanFresh {
		s.scan, s.scanAt = models.Scan(s.roots), time.Now()
		if s.scan == nil {
			s.scan = []models.Installed{}
		}
	}
	list := append([]models.Installed(nil), s.scan...)
	s.scanMu.Unlock()
	return reg.Annotate(list), nil
}

const scanFresh = 30 * time.Second

func (s *server) forgetScan() { s.scanMu.Lock(); s.scan = nil; s.scanMu.Unlock() }

func (s *server) installedRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/installed", func(w http.ResponseWriter, _ *http.Request) {
		list, err := s.installed()
		if err != nil {
			writeJSON(w, 500, map[string]string{"error": err.Error()})
			return
		}
		var total int64
		for _, it := range list {
			total += it.Bytes
		}
		// Sin nada instalado va una lista VACÍA, no null: en una máquina sin modelos (el PC recién armado) la interfaz
		// leía `.length` de null y dejaba de pintarse entera, sin mensaje.
		if list == nil {
			list = []models.Installed{}
		}
		writeJSON(w, 200, map[string]any{"installed": list, "bytes": total, "machine": machine.Detect()})
	})
	// Borrar pide el encabezado X-News: un navegador no lo manda desde otra página sin preguntar (CORS), así una web
	// cualquiera no puede borrar modelos aunque la API escuche en 127.0.0.1.
	mux.HandleFunc("DELETE /api/installed", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-News") != "1" {
			writeJSON(w, 403, map[string]string{"error": "falta el encabezado X-News"})
			return
		}
		// Lo que usa una herramienta no se borra sin `force=1`: antes el aviso vivía sólo en el texto de la pantalla, y
		// un pedido directo borraba el modelo del dictado o el de la búsqueda sin preguntar. El CLI ya pedía --force.
		key := r.URL.Query().Get("key")
		if list, err := s.installed(); err == nil && r.URL.Query().Get("force") != "1" {
			for _, it := range list {
				if it.Key == key && len(it.Tools) > 0 {
					writeJSON(w, 409, map[string]string{"error": "lo usa " + it.UsedBy + ": para borrarlo igual, confirmalo", "usedBy": it.UsedBy})
					return
				}
			}
		}
		it, err := models.Remove(s.roots, key)
		s.forgetScan()
		if err != nil {
			writeJSON(w, 400, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, 200, map[string]any{"removed": it.Key, "bytes": it.Bytes})
	})
}
