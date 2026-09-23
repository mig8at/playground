package main

import (
	"encoding/json"
	"log"
	"net/http"

	"creditop/tablero/server/internal/repos"
)

type configResponse struct {
	CanonURL  string               `json:"canonUrl"`
	TracerURL string               `json:"tracerUrl"`
	Repos     map[string]repos.Web `json:"repos"`
}

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
	body := configResponse{CanonURL: a.canonURL, TracerURL: a.tracerURL, Repos: map[string]repos.Web{}}
	if a.repos != nil {
		// Sin la lista, los enlaces a archivos se muestran igual, sólo que sin href: no es motivo para
		// que la UI no arranque.
		if web, err := a.repos.Web(); err == nil {
			body.Repos = web
		} else {
			log.Printf("repos: %v", err)
		}
	}
	_ = json.NewEncoder(w).Encode(body)
}
