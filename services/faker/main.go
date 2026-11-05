// EL SERVICIO DE DATOS FALSOS — personas inventadas para las pruebas, servidas por HTTP. Es el ejemplo de
// `playground services`: se prende y se apaga desde la sección Servers del chat, que lo publica en el playground como
// `faker.<tu usuario>.com` (sólo se llega con la VPN).
//
//	GET /persona            una persona: nombres, apellidos, correo y ciudad
//	GET /personas?n=5       varias (hasta 50)
//	GET /                   esta ayuda
//
// Todo es inventado y nada se guarda. A propósito no da cédulas ni celulares: un número con forma real puede ser el de
// una persona de verdad. El correo es siempre @example.com, que no existe.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"math/rand"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
	"unicode"

	"golang.org/x/text/unicode/norm"
)

var (
	// Dos listas: el segundo nombre sale de la misma que el primero (nada de «Natalia Nicolás»).
	femaleNames = []string{"Camila", "Valentina", "Daniela", "Mariana", "Laura", "Natalia", "Isabella", "Paula", "Sofía",
		"Luisa", "Gabriela", "Catalina", "Juliana", "Manuela", "Ángela"}
	maleNames = []string{"Andrés", "Santiago", "Juan", "Sebastián", "Felipe", "Carlos", "Miguel", "David", "Alejandro",
		"Julián", "Mateo", "Nicolás", "Diego", "Esteban", "Óscar"}
	lastNames = []string{"Rodríguez", "Gómez", "González", "Martínez", "García", "López", "Hernández", "Sánchez",
		"Ramírez", "Pérez", "Díaz", "Torres", "Rojas", "Vargas", "Moreno", "Gutiérrez", "Jiménez", "Muñoz", "Castro",
		"Ortiz", "Romero", "Suárez", "Álvarez", "Ruiz", "Mejía", "Ospina", "Restrepo", "Cárdenas", "Quintero", "Osorio"}
	cities = []string{"Bogotá", "Medellín", "Cali", "Barranquilla", "Cartagena", "Bucaramanga", "Pereira", "Manizales",
		"Cúcuta", "Ibagué", "Santa Marta", "Villavicencio", "Pasto", "Armenia", "Neiva"}
)

// Persona es lo que devuelve el servicio.
type Persona struct {
	Nombres   string `json:"nombres"`
	Apellidos string `json:"apellidos"`
	Correo    string `json:"correo"`
	Ciudad    string `json:"ciudad"`
}

// El correo va sin tildes ni eñes: firstName.lastName.NNN@example.com.
func plain(s string) string {
	var b strings.Builder
	for _, r := range norm.NFD.String(strings.ToLower(s)) {
		if unicode.Is(unicode.Mn, r) {
			continue
		}
		if r == 'ñ' {
			r = 'n'
		}
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func newPersona(rng *rand.Rand) Persona {
	pick := func(l []string) string { return l[rng.Intn(len(l))] }
	names := femaleNames
	if rng.Intn(2) == 0 {
		names = maleNames
	}
	first, second := pick(names), ""
	if rng.Intn(3) == 0 { // a veces, dos nombres
		for second = pick(names); second == first; second = pick(names) {
		}
	}
	last1, last2 := pick(lastNames), pick(lastNames)
	nombres := strings.TrimSpace(first + " " + second)
	return Persona{
		Nombres:   nombres,
		Apellidos: last1 + " " + last2,
		Correo:    fmt.Sprintf("%s.%s.%03d@example.com", plain(first), plain(last1), rng.Intn(1000)),
		Ciudad:    pick(cities),
	}
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(v)
}

func handler(rng *rand.Rand) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /persona", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, newPersona(rng)) })
	mux.HandleFunc("GET /personas", func(w http.ResponseWriter, r *http.Request) {
		n, _ := strconv.Atoi(r.URL.Query().Get("n"))
		if n < 1 {
			n = 5
		}
		if n > 50 {
			n = 50
		}
		out := make([]Persona, n)
		for i := range out {
			out[i] = newPersona(rng)
		}
		writeJSON(w, out)
	})
	mux.HandleFunc("GET /{$}", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]any{
			"servicio": "faker: personas inventadas para pruebas (sin cédulas ni celulares; correos @example.com)",
			"rutas":    []string{"GET /persona", "GET /personas?n=5"},
		})
	})
	return mux
}

func main() {
	addr := flag.String("serve", "127.0.0.1:5293", "dónde escucha (sólo esta máquina; el playground lo publica)")
	flag.Parse()
	if !strings.HasPrefix(*addr, "127.0.0.1:") {
		fmt.Fprintln(os.Stderr, "faker: escucha sólo en 127.0.0.1")
		os.Exit(2)
	}
	fmt.Printf("faker · personas inventadas en http://%s\n", *addr)
	srv := &http.Server{Addr: *addr, Handler: handler(rand.New(rand.NewSource(time.Now().UnixNano()))), ReadHeaderTimeout: 5 * time.Second}
	if err := srv.ListenAndServe(); err != nil {
		fmt.Fprintln(os.Stderr, "faker:", err)
		os.Exit(1)
	}
}
