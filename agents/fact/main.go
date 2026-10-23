// EL AGENTE DEL DATO CURIOSO — contesta con un dato curioso, al azar o del tema que se nombre.
//
// Es un agente del chat del playground compartido: un servidor de esta máquina que recibe
// POST { text, from } y contesta { reply } en lenguaje natural (el contrato está en docs/agents.md del
// playground compartido). Se declara en ~/playground/team/agents.json y lo anuncia `playground listen`:
//
//	{ "name": "fact", "description": "un dato curioso, al azar o de un tema (espacio, animales, cuerpo, historia, ciencia)", "url": "http://127.0.0.1:5187/" }
//
// No lee nada de la persona ni de CreditOp ni sale a la red: los datos van escritos acá abajo.
package main

import (
	"encoding/json"
	"flag"
	"log"
	"math/rand/v2"
	"net/http"
	"regexp"
	"strings"
)

// Los temas que entiende, con las palabras que los nombran en una pregunta (sin tildes, en minúsculas).
var topics = []struct {
	words []string
	facts []string
}{
	{[]string{"espacio", "planeta", "planetas", "luna", "sol", "estrella", "estrellas", "universo", "astronomia"}, []string{
		"Un día en Venus dura más que su año: tarda unos 243 días terrestres en girar sobre sí mismo y unos 225 en darle la vuelta al Sol.",
		"La luz del Sol tarda unos 8 minutos y 20 segundos en llegar a la Tierra.",
		"Las huellas de los astronautas del Apolo siguen en la Luna: sin viento ni lluvia, nada las borra.",
		"Saturno es tan poco denso que, en promedio, es menos denso que el agua.",
	}},
	{[]string{"animal", "animales", "bicho", "bichos", "naturaleza"}, []string{
		"Los pulpos tienen tres corazones y sangre azul.",
		"Las vacas tienen mejores amigas: separadas de ellas, se estresan más.",
		"Un grupo de flamencos se llama «flamboyance» en inglés.",
		"Los colibríes son las únicas aves que pueden volar hacia atrás de forma sostenida.",
		"Las nutrias marinas se toman de las manos mientras duermen para que la corriente no las separe.",
	}},
	{[]string{"cuerpo", "humano", "salud", "cerebro"}, []string{
		"El cuerpo humano adulto tiene 206 huesos, pero un bebé nace con alrededor de 300 que se van fusionando.",
		"El estribo, en el oído, es el hueso más pequeño del cuerpo: mide unos 3 milímetros.",
		"Las huellas dactilares se forman antes de nacer y ni los gemelos idénticos las comparten.",
		"El estómago renueva su capa interna cada pocos días para que su propio ácido no lo digiera.",
	}},
	{[]string{"historia", "antiguo", "antigua", "pasado"}, []string{
		"Cleopatra vivió más cerca en el tiempo de la llegada del hombre a la Luna que de la construcción de la Gran Pirámide de Guiza.",
		"La Universidad de Oxford ya daba clases antes de que existiera el Imperio azteca.",
		"La Guerra anglo-zanzibariana de 1896 es la más corta registrada: duró menos de una hora.",
		"El café llegó a Colombia de la mano de los jesuitas, en el siglo XVIII.",
	}},
	{[]string{"ciencia", "fisica", "quimica", "comida"}, []string{
		"La miel no se daña: se ha encontrado miel comestible en tumbas egipcias de miles de años.",
		"Los plátanos son ligeramente radiactivos por el potasio-40 que contienen.",
		"El agua caliente puede congelarse más rápido que la fría en algunas condiciones: se llama efecto Mpemba.",
		"Un rayo es unas cinco veces más caliente que la superficie del Sol.",
	}},
}

var accents = strings.NewReplacer("á", "a", "é", "e", "í", "i", "ó", "o", "ú", "u", "ü", "u")

// Los datos del tema que nombra la pregunta; todos si no nombra ninguno.
func candidates(text string) []string {
	t := accents.Replace(strings.ToLower(text))
	var all []string
	for _, topic := range topics {
		for _, w := range topic.words {
			if regexp.MustCompile(`\b` + w + `\b`).MatchString(t) {
				return topic.facts
			}
		}
		all = append(all, topic.facts...)
	}
	return all
}

func reply(text string, pick func(n int) int) string {
	facts := candidates(text)
	return "Dato curioso: " + facts[pick(len(facts))]
}

func main() {
	addr := flag.String("serve", "127.0.0.1:5187", "dónde escucha (sólo esta máquina)")
	flag.Parse()
	http.HandleFunc("POST /", func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			Text string `json:"text"`
		}
		_ = json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&in)
		w.Header().Set("content-type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"reply": reply(in.Text, rand.IntN)})
	})
	log.Printf("agente fact en http://%s/", *addr)
	log.Fatal(http.ListenAndServe(*addr, nil))
}
