package main

/* La API de la interfaz: las MISMAS filas que la consola, en JSON. Sólo escucha en 127.0.0.1 —dice qué
 * credenciales hay y de quién son— y sólo lee.
 *
 * Un pedido por grupo, a propósito: la red y las sesiones contestan en milisegundos y las bases pueden
 * tardar hasta el tope. La interfaz pide los grupos a la vez y pinta cada uno cuando llega, en vez de
 * esperar al más lento. */

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"slices"
	"time"

	"creditop/playground/keyring/check"
)

// Group es un grupo tal como lo lista la interfaz.
type Group struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Quick bool   `json:"quick"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func handler(timeout time.Duration) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/groups", func(w http.ResponseWriter, r *http.Request) {
		out := make([]Group, 0, len(check.Groups))
		for _, g := range check.Groups {
			out = append(out, Group{ID: g, Label: check.GroupLabel[g], Quick: slices.Contains(check.Quick, g)})
		}
		writeJSON(w, http.StatusOK, out)
	})
	mux.HandleFunc("/api/aws", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
		defer cancel()
		accounts, hidden, err := check.AWSAccounts(ctx)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"categories": check.Categories, "services": check.AWSServiceList(), "accounts": accounts, "hidden": hidden})
	})
	// La interfaz pide primero la lista (instantáneo) y después cada perfil por separado: la columna de un
	// perfil aparece apenas contesta, sin esperar al más lento.
	mux.HandleFunc("/api/aws/profiles", func(w http.ResponseWriter, r *http.Request) {
		profiles, err := check.AWSProfiles(r.Context())
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"categories": check.Categories, "services": check.AWSServiceList(), "profiles": profiles})
	})
	mux.HandleFunc("/api/aws/writes", func(w http.ResponseWriter, r *http.Request) {
		writes, err := check.RecordedWrites()
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, writes)
	})
	mux.HandleFunc("/api/aws/account", func(w http.ResponseWriter, r *http.Request) {
		profile := r.URL.Query().Get("profile")
		profiles, _ := check.AWSProfiles(r.Context())
		if !slices.Contains(profiles, profile) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": fmt.Sprintf("perfil %q desconocido", profile)})
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
		defer cancel()
		writeJSON(w, http.StatusOK, check.AWSAccount(ctx, profile))
	})
	mux.HandleFunc("/api/checks", func(w http.ResponseWriter, r *http.Request) {
		group := r.URL.Query().Get("group")
		if !slices.Contains(check.Groups, group) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": fmt.Sprintf("grupo %q desconocido", group)})
			return
		}
		writeJSON(w, http.StatusOK, check.Run(check.Select([]string{group}), timeout))
	})
	return mux
}

// serve arranca la API. Rechaza cualquier dirección que no sea de esta máquina.
func serve(addr string, timeout time.Duration) error {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return err
	}
	if ip := net.ParseIP(host); host != "localhost" && (ip == nil || !ip.IsLoopback()) {
		return fmt.Errorf("keyring sólo escucha en esta máquina (127.0.0.1 o localhost), no en %q", host)
	}
	fmt.Fprintf(os.Stderr, "keyring · API en http://%s\n", addr)
	return http.ListenAndServe(addr, handler(timeout))
}
