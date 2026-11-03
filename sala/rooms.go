package main

/* VARIAS SALAS (Miguel, 2026-11-02). Cada sala tiene su propio estado (participantes, transcripción, pizarra,
 * consumo) y se elige con `?room=<id>`. Hay dos tipos:
 *
 *	tarea          la de siempre: verificar una tarea del tablero (la sala «demo» arranca así)
 *	entendimiento  un TEMA, no una tarea: varios agentes buscan contradicciones entre knowledge/ y main, huecos,
 *	               reglas sin prueba y posibles defectos, y la salida es una lista de HALLAZGOS verificados
 *
 * Una sola llamada activa a la vez, entre todas: cada una gasta el límite del asiento de Miguel. */

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
)

type rooms struct {
	mu     sync.Mutex
	byID   map[string]*hub
	order  []string
	root   string
	topics []byte // la lista de temas de knowledge/, leída una vez
}

func newRooms(root string) *rooms {
	rs := &rooms{byID: map[string]*hub{}, root: root}
	rs.create("Demo · tarea", "tarea")
	return rs
}

var reSlug = regexp.MustCompile(`[^a-z0-9]+`)

func (rs *rooms) create(name, kind string) *hub {
	rs.mu.Lock()
	defer rs.mu.Unlock()
	if kind != "entendimiento" {
		kind = "tarea"
	}
	id := strings.Trim(reSlug.ReplaceAllString(strings.ToLower(name), "-"), "-")
	if id == "" || len(rs.order) == 0 {
		id = map[bool]string{true: "demo", false: kind}[len(rs.order) == 0]
	}
	for base, n := id, 2; rs.byID[id] != nil; n++ {
		id = fmt.Sprintf("%s-%d", base, n)
	}
	h := &hub{subs: map[chan []byte]bool{}, root: rs.root, srv: rs}
	h.st = state{Room: id, Name: name, Kind: kind, Participants: roster(nil), Messages: []message{}, Claims: []claim{}, Questions: []question{}}
	rs.byID[id] = h
	rs.order = append(rs.order, id)
	return h
}

// get: la sala del pedido (`?room=`), la demo si no dice.
func (rs *rooms) get(r *http.Request) *hub {
	id := r.URL.Query().Get("room")
	if id == "" {
		id = "demo"
	}
	rs.mu.Lock()
	defer rs.mu.Unlock()
	return rs.byID[id]
}

// busy: el nombre de otra sala con una llamada en curso, o "".
func (rs *rooms) busy(except *hub) string {
	rs.mu.Lock()
	hubs := make([]*hub, 0, len(rs.order))
	for _, id := range rs.order {
		hubs = append(hubs, rs.byID[id])
	}
	rs.mu.Unlock()
	for _, h := range hubs {
		if h == except {
			continue
		}
		h.mu.Lock()
		running, name := h.st.Running, h.st.Name
		h.mu.Unlock()
		if running {
			return name
		}
	}
	return ""
}

func (rs *rooms) list(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodPost {
		var in struct{ Name, Kind string }
		if json.NewDecoder(r.Body).Decode(&in) != nil || strings.TrimSpace(in.Name) == "" {
			http.Error(w, "falta el nombre", 400)
			return
		}
		h := rs.create(strings.TrimSpace(in.Name), in.Kind)
		w.Header().Set("content-type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"id": h.st.Room})
		return
	}
	rs.mu.Lock()
	ids := append([]string(nil), rs.order...)
	rs.mu.Unlock()
	var out []map[string]any
	for _, id := range ids {
		h := rs.byID[id]
		h.mu.Lock()
		out = append(out, map[string]any{"id": id, "name": h.st.Name, "kind": h.st.Kind, "running": h.st.Running,
			"ended": h.st.Ended, "task": h.st.Task, "claims": len(h.st.Claims)})
		h.mu.Unlock()
	}
	w.Header().Set("content-type", "application/json")
	_ = json.NewEncoder(w).Encode(out)
}

// topicsJSON: los temas de knowledge/ (id, título, resumen), para elegir el tema de una sala de entendimiento.
func (rs *rooms) topicsJSON(w http.ResponseWriter, r *http.Request) {
	rs.mu.Lock()
	cached := rs.topics
	rs.mu.Unlock()
	if cached == nil {
		cmd := exec.Command("go", "run", "./cmd/knowledge", "map", "--json")
		cmd.Dir = rs.root
		raw, err := cmd.Output()
		if err != nil {
			http.Error(w, "no pude leer knowledge/", 500)
			return
		}
		var topics []struct{ ID, Title, Summary string }
		_ = json.Unmarshal(raw, &topics)
		cached, _ = json.Marshal(topics)
		rs.mu.Lock()
		rs.topics = cached
		rs.mu.Unlock()
	}
	w.Header().Set("content-type", "application/json")
	_, _ = w.Write(cached)
}

// inRoom adapta un handler de una sala a una ruta: la sala sale de `?room=`.
func (rs *rooms) inRoom(f func(h *hub, w http.ResponseWriter, r *http.Request)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		h := rs.get(r)
		if h == nil {
			http.Error(w, "no existe esa sala", 404)
			return
		}
		f(h, w, r)
	}
}

// LO QUE BUSCA UNA SALA DE ENTENDIMIENTO, y a dónde va cada hallazgo si se confirma.
var goalText = map[string]string{
	"contradicciones": "contradicciones: lo que dice knowledge/ contra lo que hace main, en los dos monolitos",
	"huecos":          "huecos: reglas que están en main y no tienen tema en knowledge/ (como un filtro TEMPORAL que nadie anotó)",
	"sin-prueba":      "reglas sin prueba: lo que un tema afirma y ninguna suite del harness comprueba corriendo, con la suite que lo haría",
	"defectos":        "posibles defectos: código raro en main que vale la pena medir en prod (bin/pg, sólo lectura)",
}

const maxFindings = 8

// understandingNote se suma al prompt de cada participante en una sala de entendimiento.
func understandingNote(topic string, goals []string) string {
	var b strings.Builder
	fmt.Fprintf(&b, " ESTA SALA NO TIENE TAREA: tiene un TEMA para entender, «%s». Buscás, según tu rol:", topic)
	for _, g := range goals {
		if t := goalText[g]; t != "" {
			b.WriteString(" · " + t)
		}
	}
	b.WriteString(". Cada cosa que encuentres va en UNA línea con la forma exacta «HALLAZGO: <contradicción|hueco|sin prueba|defecto> | " +
		"<qué es, con archivo:línea> | <destino: el tema de knowledge/ a corregir, la suite del harness a crear o «incidencia»> | " +
		"COMANDO: <el comando que lo muestra>». Un hallazgo sólo vale si el verificador lo comprueba; no repitas lo que la biblioteca ya dice. " +
		"Nada se escribe en knowledge/ ni en el harness desde la sala: la lista final es un borrador que aprueba Miguel.")
	return b.String()
}

// understandingBrief: el arranque de una sala de entendimiento. Si el tema es un id de knowledge/, va su texto.
func (h *hub) understandingBrief(topic string, goals []string) string {
	var b strings.Builder
	fmt.Fprintf(&b, "Tema: %s\nSe busca:\n", topic)
	for _, g := range goals {
		if t := goalText[g]; t != "" {
			b.WriteString("- " + t + "\n")
		}
	}
	cmd := exec.Command("go", "run", "./cmd/knowledge", "read", topic)
	cmd.Dir = h.root
	if raw, err := cmd.Output(); err == nil {
		text := string(raw)
		if r := []rune(text); len(r) > 7000 {
			text = string(r[:7000]) + "\n…(recortado: el tema entero se lee con make knowledge-read ID=" + topic + ")"
		}
		b.WriteString("\nLo que dice hoy knowledge/" + topic + " (de " + filepath.Join("knowledge", topic, "rules.md") + "):\n\n" + text)
	} else {
		b.WriteString("\n(No es un id de knowledge/: buscá con make knowledge-search Q='…' qué temas lo tocan.)")
	}
	return b.String()
}
