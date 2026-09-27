package main

import (
	"encoding/json"
	"errors"
	"net/http"

	"creditop/playground/connectors/canon"
)

func (a *app) canonRoute(w http.ResponseWriter, r *http.Request) {
	cors(w)
	w.Header().Set("Cache-Control", "no-store")
	if r.Method == http.MethodOptions {
		return
	}
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	ref := r.URL.Query().Get("ref")
	if _, err := canon.ParseRouteRef(ref); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}
	view, err := a.canonClient.Route(r.Context(), ref)
	if err != nil {
		status, message := http.StatusBadGateway, "No se pudo cargar el recorrido de Canon."
		if errors.Is(err, canon.ErrRouteMissing) {
			status, message = http.StatusNotFound, "La variante o el paso ya no existe en Canon. Revisa la referencia."
		}
		w.WriteHeader(status)
		json.NewEncoder(w).Encode(map[string]string{"error": message})
		return
	}
	json.NewEncoder(w).Encode(view)
}
