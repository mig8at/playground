// Command tests dice qué pasó con una solicitud de prueba: de qué comercio viene, qué mandó la tienda, a qué
// usuario quedó pegada y con qué datos, y por qué estados pasó. Sólo lee, contra local o qa.
//
//	go run ./tests/server -target qa -q 'https://…/ecommerce/8ffe96e2/504059/lenders'   la búsqueda, en JSON
//	go run ./tests/server -serve 127.0.0.1:5179                                         la API de la interfaz
//
// CONVENCIÓN: identificadores en inglés, comentarios y texto visible en español.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"net"
	"net/http"
	"os"
	"strings"
)

func main() {
	addr := flag.String("serve", "", "levanta la API para la interfaz en esta dirección (sólo 127.0.0.1)")
	target := flag.String("target", "", "ambiente: "+strings.Join(Targets, " · "))
	query := flag.String("q", "", "la URL del wizard o el número de la solicitud")
	flag.Parse()

	if *addr != "" {
		if err := serve(*addr); err != nil {
			fmt.Fprintln(os.Stderr, "tests:", err)
			os.Exit(1)
		}
		return
	}
	in, err := ParseInput(*query)
	if err != nil {
		fmt.Fprintln(os.Stderr, "tests:", err)
		os.Exit(2)
	}
	res, err := Lookup(*target, in)
	if err != nil {
		fmt.Fprintln(os.Stderr, "tests:", err)
		os.Exit(1)
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	_ = enc.Encode(res)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/targets", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, Targets)
	})
	// GET /api/lookup?target=qa&q=<url o número>
	mux.HandleFunc("/api/lookup", func(w http.ResponseWriter, r *http.Request) {
		in, err := ParseInput(r.URL.Query().Get("q"))
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		res, err := Lookup(r.URL.Query().Get("target"), in)
		if err != nil {
			writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, res)
	})
	return mux
}

// serve arranca la API. Rechaza cualquier dirección que no sea de esta máquina: devuelve datos personales.
func serve(addr string) error {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return err
	}
	if ip := net.ParseIP(host); host != "localhost" && (ip == nil || !ip.IsLoopback()) {
		return fmt.Errorf("tests sólo escucha en esta máquina (127.0.0.1 o localhost), no en %q", host)
	}
	fmt.Fprintf(os.Stderr, "tests · API en http://%s\n", addr)
	return http.ListenAndServe(addr, handler())
}

func parseJSON(raw string) any {
	var v any
	if json.Unmarshal([]byte(raw), &v) != nil {
		return raw
	}
	return v
}
