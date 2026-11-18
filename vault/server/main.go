// El Llavero: la API de la app (vault/, :5237) sobre lib/vault, la misma librería que `bin/pg vault`. La interfaz
// (:5236) la muestra en Cockpit; por consola, todo sigue estando en `bin/pg vault`, que no necesita este servidor.
//
// Esta API devuelve valores (ver, copiar, exportar), así que se cuida de dos cosas:
//   - una página web cualquiera: todo pedido lleva el encabezado `X-Vault: 1` (un navegador no lo manda desde otro
//     origen sin preguntar antes, y acá nadie contesta esa pregunta), y el Host tiene que ser el de esta máquina (una
//     página que se hace pasar por localhost con su DNS no pasa);
//   - una sesión de Claude: el hook `vault-guard` niega un comando que le pida a este puerto un valor o el zip.
package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"creditop/my-tools/lib/launchagent"
	"creditop/my-tools/lib/vault"
)

func main() {
	serve := flag.String("serve", "127.0.0.1:5237", "host:puerto de la API")
	flag.Parse()
	p, err := vault.DefaultPaths()
	if err != nil {
		log.Fatal(err)
	}
	ln, err := launchagent.Listen("vault", *serve)
	if err != nil {
		log.Fatal(err)
	}
	log.Printf("vault: API en http://%s", *serve)
	log.Fatal(http.Serve(ln, guard(routes(p))))
}

// guard: el encabezado propio y un Host de esta máquina en cada pedido a /api.
func guard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host := r.Host
		if i := strings.LastIndexByte(host, ':'); i >= 0 {
			host = host[:i]
		}
		if host != "127.0.0.1" && host != "localhost" {
			writeErr(w, http.StatusForbidden, errors.New("sólo desde esta máquina"))
			return
		}
		if r.Header.Get("X-Vault") != "1" {
			writeErr(w, http.StatusForbidden, errors.New("falta el encabezado X-Vault"))
			return
		}
		next.ServeHTTP(w, r)
	})
}

type keyOut struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Print   string `json:"print"`
	Updated string `json:"updated"`
}

type ringOut struct {
	ID   string   `json:"id"`
	Name string   `json:"name"`
	Slug string   `json:"slug"`
	Keys []keyOut `json:"keys"`
}

func routes(p vault.Paths) *http.ServeMux {
	mux := http.NewServeMux()
	// Los llaveros y sus llaves, sin valores.
	mux.HandleFunc("GET /api/rings", func(w http.ResponseWriter, _ *http.Request) {
		d, err := p.Load()
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		out := []ringOut{}
		for _, r := range d.Rings {
			ro := ringOut{ID: r.ID, Name: r.Name, Slug: vault.Slug(r.Name), Keys: []keyOut{}}
			for _, k := range r.Keys {
				ro.Keys = append(ro.Keys, keyOut{ID: k.ID, Name: k.Name, Print: k.Print, Updated: k.Updated})
			}
			out = append(out, ro)
		}
		_, keyErr := p.PersonalKey(false)
		writeJSON(w, 200, map[string]any{"rings": out, "hasKey": keyErr == nil})
	})
	mux.HandleFunc("POST /api/rings", func(w http.ResponseWriter, r *http.Request) {
		var in struct{ Name string }
		if !decode(w, r, &in) {
			return
		}
		ring, err := p.CreateRing(in.Name)
		reply(w, map[string]string{"id": ring.ID}, err)
	})
	mux.HandleFunc("PATCH /api/rings/{ring}", func(w http.ResponseWriter, r *http.Request) {
		var in struct{ Name string }
		if !decode(w, r, &in) {
			return
		}
		reply(w, ok, p.RenameRing(r.PathValue("ring"), in.Name))
	})
	mux.HandleFunc("DELETE /api/rings/{ring}", func(w http.ResponseWriter, r *http.Request) {
		reply(w, ok, p.DeleteRing(r.PathValue("ring"), r.URL.Query().Get("force") == "1"))
	})
	mux.HandleFunc("POST /api/rings/{ring}/keys", func(w http.ResponseWriter, r *http.Request) {
		var in struct{ Name, Value string }
		if !decode(w, r, &in) {
			return
		}
		k, err := p.SetKey(r.PathValue("ring"), in.Name, in.Value)
		reply(w, map[string]string{"name": k.Name, "print": k.Print}, err)
	})
	mux.HandleFunc("PATCH /api/rings/{ring}/keys/{key}", func(w http.ResponseWriter, r *http.Request) {
		var in struct{ Name string }
		if !decode(w, r, &in) {
			return
		}
		_, err := p.RenameKey(r.PathValue("ring"), r.PathValue("key"), in.Name)
		reply(w, ok, err)
	})
	mux.HandleFunc("DELETE /api/rings/{ring}/keys/{key}", func(w http.ResponseWriter, r *http.Request) {
		reply(w, ok, p.DeleteKey(r.PathValue("ring"), r.PathValue("key")))
	})
	// UN valor, para «Ver» y «Copiar».
	mux.HandleFunc("POST /api/rings/{ring}/keys/{key}/reveal", func(w http.ResponseWriter, r *http.Request) {
		v, err := p.Reveal(r.PathValue("ring"), r.PathValue("key"))
		reply(w, map[string]string{"value": v}, err)
	})
	// El zip para otra máquina: se escribe en Descargas (desde un iframe de Cockpit no hay descarga del navegador).
	mux.HandleFunc("POST /api/export", func(w http.ResponseWriter, r *http.Request) {
		var in struct{ Passphrase string }
		if !decode(w, r, &in) {
			return
		}
		var buf bytes.Buffer
		rings, keys, err := p.Export(&buf, in.Passphrase, nil)
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		dir := os.Getenv("VAULT_EXPORT_DIR") // las pruebas, para no dejar un zip en Descargas
		if dir == "" {
			home, _ := os.UserHomeDir()
			dir = filepath.Join(home, "Downloads")
		}
		name := "llavero-" + time.Now().Format("2006-01-02") + ".zip"
		if err := os.WriteFile(filepath.Join(dir, name), buf.Bytes(), 0o600); err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, map[string]any{"file": name, "rings": rings, "keys": keys})
	})
	mux.HandleFunc("POST /api/import", func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			Passphrase string
			Zip        string // base64
			Replace    bool
		}
		if !decode(w, r, &in) {
			return
		}
		data, err := base64.StdEncoding.DecodeString(in.Zip)
		if err != nil || len(data) == 0 {
			writeErr(w, 400, errors.New("falta el zip"))
			return
		}
		res, err := p.Import(data, in.Passphrase, in.Replace)
		reply(w, res, err)
	})
	return mux
}

var ok = map[string]bool{"ok": true}

func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 48<<20)).Decode(v); err != nil {
		writeErr(w, 400, fmt.Errorf("el cuerpo va en JSON: %w", err))
		return false
	}
	return true
}

func reply(w http.ResponseWriter, v any, err error) {
	if err != nil {
		writeErr(w, 400, err)
		return
	}
	writeJSON(w, 200, v)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, err error) {
	writeJSON(w, status, map[string]string{"error": err.Error()})
}
