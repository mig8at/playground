package main

import (
	"encoding/json"
	"log"
	"net/http"

	"creditop/playground/connectors/repos"
)

type configResponse struct {
	CanonURL string               `json:"canonUrl"`
	Repos    map[string]repos.Web `json:"repos"`
}

// config entrega los orígenes de herramientas que la UI necesita sin quemarlos en el bundle. No son
// secretos, pero sí cambian entre una instalación local y la de equipo; el frontend no debe decidirlos.
// (Hasta el 2026-09-23 traía también la URL del trazador, para los enlaces de la evidencia de trabajo;
// la evidencia salía de las anotaciones, que ese día pasaron a la pila, y se fue con ellas.)
func (a *app) config(w http.ResponseWriter, r *http.Request) {
	cors(w)
	if r.Method == http.MethodOptions {
		return
	}
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	body := configResponse{CanonURL: a.canonURL, Repos: map[string]repos.Web{}}
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
