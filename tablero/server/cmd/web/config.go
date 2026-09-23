package main

import (
	"encoding/json"
	"net/http"
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
