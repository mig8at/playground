package main

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"creditop/tablero/server/internal/canon"
)

// config entrega los orígenes de herramientas que la UI necesita sin quemarlos en el bundle. No son
// secretos, pero sí cambian entre una instalación local y la de equipo; el frontend no debe decidirlos.
func (a *app) config(w http.ResponseWriter, r *http.Request) {
	cors(w)
	if r.Method == http.MethodOptions {
		return
	}
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]string{
		"canonUrl": a.canonURL, "tracerUrl": a.tracerURL, "harnessUrl": a.harnessURL,
	})
}

// canonReferences resuelve los IDs declarados por una tarea. Es un proxy chico
// a /api/read: evita CORS entre la UI local y Canon, conserva el timeout en el
// servidor y devuelve sólo los metadatos que el tablero necesita para listar y
// enlazar referencias. El contenido sigue viviendo y leyéndose en Canon.
func (a *app) canonReferences(w http.ResponseWriter, r *http.Request) {
	cors(w)
	if r.Method == http.MethodOptions {
		return
	}
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	var ids []string
	for _, id := range strings.Split(r.URL.Query().Get("ids"), ",") {
		if id = strings.TrimSpace(id); id != "" {
			ids = append(ids, id)
		}
	}
	if len(ids) == 0 {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "falta ids"})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	references, err := canon.New(a.canonURL).References(ctx, ids)
	if err != nil {
		w.WriteHeader(http.StatusBadGateway)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "no pude consultar Canon: " + err.Error()})
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]any{"canonUrl": a.canonURL, "references": references})
}
