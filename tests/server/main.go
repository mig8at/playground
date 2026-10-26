// Command tests dice qué pasó con una solicitud de prueba: de qué comercio viene, qué mandó la tienda, a qué
// usuario quedó pegada y con qué datos, y por qué estados pasó, contra local o qa. Lee siempre; borra una
// solicitud de prueba sólo con `-delete -confirm` (ver delete.go, que lleva las guardas).
//
//	go run ./tests/server -target qa -q 3016992677                                      la búsqueda, en JSON (también la URL del wizard o el número)
//	go run ./tests/server -serve 127.0.0.1:5179                                         la API de la interfaz
//	go run ./tests/server -target local -q 467513 -delete [-phone] [-free-users] [-rollback] -confirm 467513
//	                       sin -confirm sólo muestra el plan; con -rollback borra todo y lo deshace al final
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
	"strconv"
	"strings"
)

func main() {
	addr := flag.String("serve", "", "levanta la API para la interfaz en esta dirección (sólo 127.0.0.1)")
	target := flag.String("target", "", "ambiente: "+strings.Join(Targets, " · "))
	query := flag.String("q", "", "la URL del wizard o el número de la solicitud")
	del := flag.Bool("delete", false, "borra la solicitud y lo que cuelga de ella (sin -confirm, sólo el plan)")
	phone := flag.Bool("phone", false, "con -delete: todas las solicitudes del celular de esa solicitud")
	confirm := flag.String("confirm", "", "con -delete: el número de la solicitud (o el celular, con -phone)")
	rollback := flag.Bool("rollback", false, "con -delete: hace todo dentro de la transacción y la deshace")
	freeUsers := flag.Bool("free-users", false, "con -delete: además da de baja a los usuarios del celular (con -phone) o al de la solicitud si era su última")
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
	// Con celular, -delete actúa sobre su solicitud más nueva (la misma que muestra la búsqueda).
	if *del && in.Phone != "" {
		res, err := Lookup(*target, in)
		if err != nil {
			fmt.Fprintln(os.Stderr, "tests:", err)
			os.Exit(1)
		}
		in = res.Input
	}
	var out any
	switch {
	case *del && *confirm == "":
		out, err = BuildPlan(*target, in.Request, *phone, *freeUsers)
	case *del:
		out, err = Delete(*target, in.Request, *phone, *freeUsers, *confirm, *rollback)
	default:
		out, err = Lookup(*target, in)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "tests:", err)
		os.Exit(1)
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	_ = enc.Encode(out)
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
		// Con celular, `request` elige cuál de sus solicitudes se muestra.
		if n, _ := strconv.Atoi(r.URL.Query().Get("request")); in.Phone != "" && n > 0 {
			in.Request = n
		}
		res, err := Lookup(r.URL.Query().Get("target"), in)
		if err != nil {
			writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, res)
	})
	// GET /api/delete/plan?target=qa&request=504059&phone=1 — qué se borraría. Sólo lee.
	mux.HandleFunc("/api/delete/plan", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		request, _ := strconv.Atoi(q.Get("request"))
		plan, err := BuildPlan(q.Get("target"), request, q.Get("phone") == "1", q.Get("users") == "1")
		if err != nil {
			writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, plan)
	})
	// POST /api/delete {target, request, phone, confirm} — borra. Vuelve a armar el plan y a comprobar todo.
	mux.HandleFunc("/api/delete", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "POST"})
			return
		}
		var body struct {
			Target  string `json:"target"`
			Request int    `json:"request"`
			Phone   bool   `json:"phone"`
			Users   bool   `json:"users"`
			Confirm string `json:"confirm"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		res, err := Delete(body.Target, body.Request, body.Phone, body.Users, body.Confirm, false)
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
