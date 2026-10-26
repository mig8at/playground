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
	loadProfile := flag.Bool("load-profile", false, "le dicta a las centrales del ambiente el perfil de tests/.profile.json")
	purge := flag.Int("purge-user", 0, "borra del todo a ese usuario (cliente dado de baja, sin solicitudes), con respaldo; con -rollback lo deshace")
	disable := flag.Int("disable-user", 0, "da de baja a ese usuario (cliente, activo), con respaldo; con -rollback lo deshace")
	freeUsers := flag.Bool("free-users", false, "con -delete: además da de baja a los usuarios del celular (con -phone) o al de la solicitud si era su última")
	flag.Parse()

	if *loadProfile {
		out, err := LoadProfile(*target, nil)
		if err != nil {
			fmt.Fprintln(os.Stderr, "tests:", err)
			os.Exit(1)
		}
		_ = json.NewEncoder(os.Stdout).Encode(out)
		return
	}
	if *purge > 0 {
		out, err := PurgeUser(*target, *purge, strconv.Itoa(*purge), *rollback)
		if err != nil {
			fmt.Fprintln(os.Stderr, "tests:", err)
			os.Exit(1)
		}
		_ = json.NewEncoder(os.Stdout).Encode(out)
		return
	}
	if *disable > 0 {
		out, err := DisableUser(*target, *disable, strconv.Itoa(*disable), *rollback)
		if err != nil {
			fmt.Fprintln(os.Stderr, "tests:", err)
			os.Exit(1)
		}
		_ = json.NewEncoder(os.Stdout).Encode(out)
		return
	}
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
	if *del && in.Who != "" {
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
		if n, _ := strconv.Atoi(r.URL.Query().Get("request")); in.Who != "" && n > 0 {
			in.Request = n
		}
		res, err := Lookup(r.URL.Query().Get("target"), in)
		if err != nil {
			writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, res)
	})
	// GET /api/tables?target=qa&request=504059 — las tablas con filas de la solicitud y cuántas. Sólo lee.
	mux.HandleFunc("/api/tables", func(w http.ResponseWriter, r *http.Request) {
		request, _ := strconv.Atoi(r.URL.Query().Get("request"))
		out, err := RequestTables(r.URL.Query().Get("target"), request)
		if err != nil {
			writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, out)
	})
	// GET /api/table-rows?target=qa&request=504059&table=user_request_records — las filas de la solicitud en esa
	// tabla, con las columnas en el orden de la base. Sólo lee.
	mux.HandleFunc("/api/table-rows", func(w http.ResponseWriter, r *http.Request) {
		request, _ := strconv.Atoi(r.URL.Query().Get("request"))
		out, err := RequestTableRows(r.URL.Query().Get("target"), request, r.URL.Query().Get("table"))
		if err != nil {
			writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, out)
	})
	// POST /api/user/disable {target, user} — da de baja a un usuario suelto (cliente, activo), con respaldo.
	mux.HandleFunc("/api/user/disable", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "POST"})
			return
		}
		var body struct {
			Target string `json:"target"`
			User   int    `json:"user"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		// La ventana de la interfaz es la confirmación: el id viaja solo y DisableUser vuelve a comprobar todo.
		res, err := DisableUser(body.Target, body.User, strconv.Itoa(body.User), false)
		if err != nil {
			writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, res)
	})
	// GET /api/profile — el perfil de prueba (tests/.profile.json). POST /api/profile/load {target} — se lo dicta a
	// las centrales del ambiente, por el harness.
	mux.HandleFunc("/api/profile", func(w http.ResponseWriter, r *http.Request) {
		p, err := ReadProfile()
		if err != nil {
			writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, p)
	})
	mux.HandleFunc("/api/profile/load", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "POST"})
			return
		}
		var body struct {
			Target  string   `json:"target"`
			Profile *Profile `json:"profile"` // lo editado en la interfaz; sin él, el del archivo
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		res, err := LoadProfile(body.Target, body.Profile)
		if err != nil {
			writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, res)
	})
	// POST /api/request/status {target, request, status} — pasa la solicitud a un estado final por el simulador del
	// backend, que le avisa a la tienda.
	mux.HandleFunc("/api/request/status", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "POST"})
			return
		}
		var body struct {
			Target  string `json:"target"`
			Request int    `json:"request"`
			Status  int    `json:"status"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		res, err := SimulateStatus(body.Target, body.Request, body.Status)
		if err != nil {
			writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, res)
	})
	// POST /api/user/purge {target, user} — borra del todo a un cliente dado de baja y sin solicitudes, con respaldo.
	mux.HandleFunc("/api/user/purge", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "POST"})
			return
		}
		var body struct {
			Target string `json:"target"`
			User   int    `json:"user"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		res, err := PurgeUser(body.Target, body.User, strconv.Itoa(body.User), false)
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
