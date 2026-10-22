// EL AGENTE DE LA HORA — contesta qué hora es, en Bogotá o en la ciudad que se nombre.
//
// Es un agente del chat del playground compartido: un servidor de esta máquina que recibe
// POST { text, from } y contesta { reply } en lenguaje natural (el contrato está en docs/agents.md del
// playground compartido). Se declara en ~/playground/team/agents.json y lo anuncia `playground listen`:
//
//	{ "name": "time", "description": "qué hora es en Bogotá o en otra ciudad", "url": "http://127.0.0.1:5186/" }
//
// No lee nada de la persona ni de CreditOp: sólo el reloj de esta máquina y la base de zonas horarias de Go.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"time"
)

// Las ciudades que entiende, por cómo se escriben en una pregunta (sin tildes, en minúsculas).
var cities = map[string]struct{ name, zone string }{
	"bogota": {"Bogotá", "America/Bogota"}, "colombia": {"Colombia", "America/Bogota"},
	"medellin": {"Medellín", "America/Bogota"}, "cali": {"Cali", "America/Bogota"},
	"barranquilla": {"Barranquilla", "America/Bogota"},
	"lima":         {"Lima", "America/Lima"}, "peru": {"Perú", "America/Lima"},
	"quito": {"Quito", "America/Guayaquil"}, "ecuador": {"Ecuador", "America/Guayaquil"},
	"panama": {"Panamá", "America/Panama"},
	"mexico": {"Ciudad de México", "America/Mexico_City"}, "cdmx": {"Ciudad de México", "America/Mexico_City"},
	"santiago": {"Santiago de Chile", "America/Santiago"}, "chile": {"Chile", "America/Santiago"},
	"buenos aires": {"Buenos Aires", "America/Argentina/Buenos_Aires"}, "argentina": {"Argentina", "America/Argentina/Buenos_Aires"},
	"sao paulo": {"São Paulo", "America/Sao_Paulo"}, "brasil": {"Brasil", "America/Sao_Paulo"},
	"santo domingo": {"Santo Domingo", "America/Santo_Domingo"}, "republica dominicana": {"República Dominicana", "America/Santo_Domingo"},
	"miami": {"Miami", "America/New_York"}, "nueva york": {"Nueva York", "America/New_York"}, "new york": {"Nueva York", "America/New_York"},
	"los angeles": {"Los Ángeles", "America/Los_Angeles"}, "san francisco": {"San Francisco", "America/Los_Angeles"},
	"madrid": {"Madrid", "Europe/Madrid"}, "espana": {"España", "Europe/Madrid"}, "barcelona": {"Barcelona", "Europe/Madrid"},
	"londres": {"Londres", "Europe/London"}, "paris": {"París", "Europe/Paris"}, "berlin": {"Berlín", "Europe/Berlin"},
	"tokio": {"Tokio", "Asia/Tokyo"}, "utc": {"UTC", "UTC"},
}

var accents = strings.NewReplacer("á", "a", "é", "e", "í", "i", "ó", "o", "ú", "u", "ü", "u")
var weekdays = []string{"domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"}
var months = []string{"", "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"}

// Las ciudades que nombra la pregunta, en el orden en que aparecen; Bogotá si no nombra ninguna. Cada zona horaria
// cuenta una vez: «Santiago de Chile» no da dos horas, ni «Bogotá y Medellín».
func askedCities(text string) []struct{ name, zone string } {
	t := accents.Replace(strings.ToLower(text))
	type hit struct {
		at  int
		key string
	}
	var hits []hit
	for key := range cities {
		if loc := regexp.MustCompile(`\b` + regexp.QuoteMeta(key) + `\b`).FindStringIndex(t); loc != nil {
			hits = append(hits, hit{loc[0], key})
		}
	}
	sort.Slice(hits, func(i, j int) bool {
		return hits[i].at < hits[j].at || hits[i].at == hits[j].at && len(hits[i].key) > len(hits[j].key)
	})
	var out []struct{ name, zone string }
	seen := map[string]bool{}
	for _, h := range hits {
		c := cities[h.key]
		if seen[c.zone] {
			continue
		}
		seen[c.zone] = true
		out = append(out, c)
	}
	if len(out) == 0 {
		out = append(out, cities["bogota"])
	}
	return out
}

// «2:45 p. m. del jueves 22 de octubre»
func spoken(t time.Time) string {
	h, suffix := t.Hour(), "a. m."
	if h >= 12 {
		suffix = "p. m."
	}
	if h = h % 12; h == 0 {
		h = 12
	}
	return fmt.Sprintf("%d:%02d %s del %s %d de %s", h, t.Minute(), suffix, weekdays[t.Weekday()], t.Day(), months[t.Month()])
}

func reply(text string, now time.Time) string {
	var parts []string
	for _, c := range askedCities(text) {
		loc, err := time.LoadLocation(c.zone)
		if err != nil {
			parts = append(parts, fmt.Sprintf("no tengo la zona horaria de %s", c.name))
			continue
		}
		local := now.In(loc)
		verb := "son las"
		if local.Hour()%12 == 1 {
			verb = "es la"
		}
		parts = append(parts, fmt.Sprintf("en %s %s %s", c.name, verb, spoken(local)))
	}
	out := strings.Join(parts, "; ")
	return strings.ToUpper(out[:1]) + out[1:] + "."
}

func main() {
	addr := flag.String("serve", "127.0.0.1:5186", "dónde escucha (sólo esta máquina)")
	flag.Parse()
	http.HandleFunc("POST /", func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			Text string `json:"text"`
		}
		_ = json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&in)
		w.Header().Set("content-type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"reply": reply(in.Text, time.Now())})
	})
	log.Printf("agente time en http://%s/", *addr)
	log.Fatal(http.ListenAndServe(*addr, nil))
}
