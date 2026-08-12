// plantillas — prototipo: el backend COMPONE el flujo de onboarding a partir de un
// catálogo cerrado de componentes, y el frontend lo renderiza sin código por caso.
// Realtime por SSE (HTTP plano: pasa WAF y funciona en iframe).
//
// No se acopla a nada de CreditOp: SQLite local, cero dependencias del monorepo.
// Lo que se está probando es la FORMA, no la integración.
package main

import (
	"database/sql"
	"encoding/json"
	"flag"
	"log"
	"net/http"
	"os"
	"path/filepath"
)

type srv struct {
	db  *sql.DB
	hub *hub
}

func main() {
	puerto := flag.String("puerto", env("PORT", "8090"), "puerto HTTP")
	ruta := flag.String("db", env("PLANTILLAS_DB", "solicitudes.db"), "archivo SQLite")
	flag.Parse()

	db := abrirDB(*ruta)
	defer db.Close()
	s := &srv{db: db, hub: nuevoHub(db)}

	mux := http.NewServeMux()

	// El catálogo y las plantillas se exponen para poder VER que la variación es dato.
	mux.HandleFunc("GET /api/catalogo", s.verCatalogo)
	mux.HandleFunc("GET /api/plantillas", s.verPlantillas)

	// Los burós como CONTRATO (entrada → salida) sobre un diccionario único de claves.
	mux.HandleFunc("GET /api/lenders", s.verLenders)
	mux.HandleFunc("GET /api/claves", s.verClaves)
	mux.HandleFunc("GET /api/proveedores", s.verProveedores)
	mux.HandleFunc("GET /api/claves/{clave}/quien-la-da", s.quienDa)
	mux.HandleFunc("GET /api/plan", s.plan)
	mux.HandleFunc("GET /api/solicitudes/{id}/plan", s.planDeSolicitud)

	mux.HandleFunc("POST /api/solicitudes", s.crearSolicitud)
	mux.HandleFunc("GET /api/solicitudes/{id}", s.verSolicitud)
	mux.HandleFunc("GET /api/solicitudes/{id}/eventos", s.eventos)

	// El "atrás" es una operación DEL MOTOR y es una sola regla: reinicia la solicitud
	// conservando lo tipeado y borrando lo verificado. No hay undo por componente.
	mux.HandleFunc("POST /api/solicitudes/{id}/reiniciar", s.reiniciar)

	// Los INTENTOS: una solicitud puede irse por varios lenders, dejar uno a medias y
	// retomarlo después. Cada uno tiene id propio y no se borra al abandonarlo.
	mux.HandleFunc("POST /api/solicitudes/{id}/intentos", s.abrirIntento)
	mux.HandleFunc("GET /api/intentos/{id}", s.verIntento)
	mux.HandleFunc("POST /api/intentos/{id}/abandonar", s.abandonarIntento)

	// Un endpoint por componente del catálogo. Agregar un componente = agregar acá
	// su efecto + su .vue, y ya se puede poner en cualquier plantilla.
	// UN handler para todo paso que sea formulario: los campos los dice la plantilla.
	mux.HandleFunc("POST /api/solicitudes/{id}/formulario", s.enviarFormulario)

	mux.HandleFunc("POST /api/solicitudes/{id}/telefono", s.pasoTelefono)
	mux.HandleFunc("POST /api/solicitudes/{id}/otp/enviar", s.otpEnviar)
	mux.HandleFunc("POST /api/solicitudes/{id}/otp/verificar", s.otpVerificar)

	// El build de Vue, si existe (en dev se usa vite en :5198 con proxy).
	if dist, err := filepath.Abs("../dist"); err == nil {
		if _, err := os.Stat(dist); err == nil {
			mux.Handle("/", http.FileServer(http.Dir(dist)))
		}
	}

	log.Printf("plantillas · http://localhost:%s · db=%s", *puerto, *ruta)
	if err := http.ListenAndServe(":"+*puerto, mux); err != nil {
		log.Fatal(err)
	}
}

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func (s *srv) verCatalogo(w http.ResponseWriter, r *http.Request) {
	filas, err := s.db.Query(`SELECT tipo, label, efecto FROM componentes ORDER BY tipo`)
	if err != nil {
		errorJSON(w, 500, "no se pudo leer el catálogo")
		return
	}
	defer filas.Close()

	type comp struct {
		Tipo   string `json:"tipo"`
		Label  string `json:"label"`
		Efecto string `json:"efecto"`
	}
	out := []comp{}
	for filas.Next() {
		var c comp
		if err := filas.Scan(&c.Tipo, &c.Label, &c.Efecto); err == nil {
			out = append(out, c)
		}
	}
	responder(w, 200, out)
}

func (s *srv) verPlantillas(w http.ResponseWriter, r *http.Request) {
	filas, err := s.db.Query(`SELECT id, comercio, entidad, pais, etapas FROM plantillas ORDER BY id`)
	if err != nil {
		errorJSON(w, 500, "no se pudieron leer las plantillas")
		return
	}
	defer filas.Close()

	type plant struct {
		ID       int64   `json:"id"`
		Comercio string  `json:"comercio"`
		Entidad  string  `json:"entidad"`
		Pais     string  `json:"pais"`
		Etapas   []etapa `json:"etapas"`
	}
	out := []plant{}
	for filas.Next() {
		var p plant
		var etapas string
		if err := filas.Scan(&p.ID, &p.Comercio, &p.Entidad, &p.Pais, &etapas); err == nil {
			json.Unmarshal([]byte(etapas), &p.Etapas)
			out = append(out, p)
		}
	}
	responder(w, 200, out)
}

func (s *srv) verLenders(w http.ResponseWriter, r *http.Request) {
	filas, err := s.db.Query(`SELECT lender, nombre, nota FROM lenders ORDER BY nombre`)
	if err != nil {
		errorJSON(w, 500, "no se pudieron leer los lenders")
		return
	}
	defer filas.Close()
	type l struct {
		Lender string `json:"lender"`
		Nombre string `json:"nombre"`
		Nota   string `json:"nota"`
	}
	out := []l{}
	for filas.Next() {
		var x l
		if filas.Scan(&x.Lender, &x.Nombre, &x.Nota) == nil {
			out = append(out, x)
		}
	}
	responder(w, 200, out)
}
