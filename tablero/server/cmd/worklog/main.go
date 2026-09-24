// bitacora — anota una entrada de la bitácora por consola, con los minutos MEDIDOS por el comando.
//
// Hasta el 2026-09-14 la bitácora se escribía a mano como una línea JSON: había que buscar el id
// máximo, acertar el formato, recordar el `effortId` y calcular los minutos. Con esa fricción salen dos
// cosas medidas ese día: 211′ de entradas sin tarea asignada y tres tareas con trabajo y sin bitácora.
//
// Acá el comando pone el id (por el store, el mismo que usa la UI), el día y la hora, resuelve la tarea
// por id o por slug, y —lo que importa— los minutos NO se tipean sueltos: salen de un lapso, del pulso o
// de un número con su fuente declarada, y la fuente queda escrita en la nota. Es la regla «los minutos
// se miden, no se estiman» hecha comando.
//
//	bitacora -tarea 84 -lapso 21:58-22:11 -titulo "…" -nota "…"        minutos = el lapso
//	bitacora -tarea 84 -pulso 21:30 -titulo "…" -nota-archivo n.txt    minutos = tramos del pulso desde esa hora, hoy
//	bitacora -tarea 84 -min 40 -fuente "lapso entre los commits a1 y b2" -titulo "…"
//
// La nota y el título pasan el guard: la bitácora sube a Jira como worklog.
package main

import (
	"flag"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"creditop/playground/connectors/guard"
	"creditop/playground/tablero/server/internal/layout"
	"creditop/playground/tablero/server/internal/pulse"
	"creditop/playground/tablero/server/internal/store"
)

// dataDir: la carpeta `data/`; las tareas viven al lado, en `tasks/`. Ver el paquete layout.
func dataDir() string { return layout.Find().Data }

func todayAt(hhmm string) (time.Time, error) {
	t, err := time.ParseInLocation("15:04", hhmm, time.Local)
	if err != nil {
		return t, fmt.Errorf("hora %q: tiene que ser HH:MM", hhmm)
	}
	h := time.Now()
	return time.Date(h.Year(), h.Month(), h.Day(), t.Hour(), t.Minute(), 0, 0, time.Local), nil
}

// slotsSince cuenta los tramos de 5' con actividad en el pulso desde `since` hasta ahora (hoy), en
// cualquier repo. Devuelve también si el pulso tenía registro en esa ventana.
func slotsSince(data string, since time.Time) (slotCount int, happened bool) {
	ticks, err := pulse.Read(data, 1)
	if err != nil {
		return 0, false
	}
	slots := map[int64]bool{}
	for _, tk := range ticks {
		if t, err := time.Parse(time.RFC3339, tk.T); err == nil && !t.Before(since) {
			happened = true
		}
		for _, sg := range tk.Signals {
			at, err := time.Parse(time.RFC3339, sg.At)
			if err != nil || at.Before(since) {
				continue
			}
			slots[at.Unix()/300] = true
		}
	}
	return len(slots), happened
}

func main() {
	var (
		task      = flag.String("tarea", "", "id o slug de la tarea (obligatorio)")
		title     = flag.String("titulo", "", "qué fue, en una línea (obligatorio)")
		note      = flag.String("nota", "", "la nota (o `-` para leerla de stdin); también -nota-archivo")
		noteFile  = flag.String("nota-archivo", "", "archivo con la nota")
		kind      = flag.String("kind", "progress", "progress · test · finding · blocker")
		span      = flag.String("lapso", "", "HH:MM-HH:MM de hoy: los minutos son la diferencia")
		fromPulse = flag.String("pulso", "", "HH:MM de hoy: los minutos son los tramos del pulso desde esa hora")
		min       = flag.Int("min", 0, "minutos, si ya los mediste: exige -fuente")
		source    = flag.String("fuente", "", "de dónde salió -min (ej. «lapso entre el primer y el último commit»)")
		dryRun    = flag.Bool("n", false, "mostrar la entrada y NO escribirla")
	)
	flag.Parse()

	fail := func(f string, a ...any) {
		fmt.Fprintf(os.Stderr, f+"\n", a...)
		os.Exit(2)
	}
	if *task == "" || *title == "" {
		fail("faltan -tarea y/o -titulo. Ej: bitacora -tarea 84 -lapso 21:58-22:11 -titulo \"…\" -nota \"…\"")
	}
	text := *note
	if text == "" && *noteFile != "" {
		b, err := os.ReadFile(*noteFile)
		if err != nil {
			fail("leyendo la nota: %v", err)
		}
		text = string(b)
	}
	// La nota por stdin se pide EXPLÍCITA (`-nota -`): adivinarla por el tipo de descriptor colgaba el
	// comando cuando lo lanzaba un proceso con un pipe abierto y sin nada que mandar.
	if *note == "-" {
		b, _ := os.ReadFile("/dev/stdin")
		text = string(b)
	}
	text = strings.TrimSpace(text)

	// ── los minutos: de UNA fuente, y la fuente queda escrita ──
	var (
		minutes int
		start   time.Time
		origin  string
	)
	data := dataDir()
	switch {
	case *span != "":
		a, b, ok := strings.Cut(*span, "-")
		if !ok {
			fail("-lapso tiene que ser HH:MM-HH:MM")
		}
		ta, err := todayAt(a)
		if err != nil {
			fail("%v", err)
		}
		tb, err := todayAt(b)
		if err != nil {
			fail("%v", err)
		}
		if !tb.After(ta) {
			fail("el lapso termina antes de empezar")
		}
		minutes, start = int(tb.Sub(ta).Minutes()), ta
		origin = fmt.Sprintf("medidos por el lapso de la sesión (%s a %s), no por el pulso", a, b)
	case *fromPulse != "":
		td, err := todayAt(*fromPulse)
		if err != nil {
			fail("%v", err)
		}
		slots, happened := slotsSince(data, td)
		if !happened {
			fail("el pulso no tiene registro de hoy desde las %s: usá -lapso o -min con -fuente", *fromPulse)
		}
		if slots == 0 {
			fail("el pulso no vio cambios desde las %s. Si trabajaste sin tocar archivos (correr, leer, medir), usá -lapso", *fromPulse)
		}
		minutes, start = slots*5, td
		origin = fmt.Sprintf("medidos por el pulso: %d tramos de 5′ con cambios desde las %s", slots, *fromPulse)
	case *min > 0:
		if strings.TrimSpace(*source) == "" {
			fail("-min exige -fuente: la bitácora sube a Jira y un número sin origen es una estimación")
		}
		minutes, start = *min, time.Now().Add(-time.Duration(*min)*time.Minute)
		origin = "medidos: " + strings.TrimSpace(*source)
	default:
		fail("decí de dónde salen los minutos: -lapso HH:MM-HH:MM · -pulso HH:MM · -min N -fuente \"…\"")
	}

	s, err := store.Open(data)
	if err != nil {
		fail("abriendo el tablero: %v", err)
	}
	var chosen *store.EffortRef
	for _, e := range s.EffortsAll() {
		slug := e.Slug
		if strconv.FormatInt(e.ID, 10) == *task || slug == *task {
			ef := e
			chosen = &ef
			break
		}
	}
	if chosen == nil {
		fail("no hay tarea %q (id o slug exacto). `make tareas` las lista.", *task)
	}
	if chosen.Archived != "" {
		fmt.Fprintf(os.Stderr, "⚠ la tarea #%d está ARCHIVADA; se anota igual, pero revisá que sea la correcta\n", chosen.ID)
	}

	body := text
	if body != "" {
		body += "\n\n"
	}
	body += "MINUTOS: " + origin + "."
	if v := guard.Violations(*title + "\n" + body); len(v) > 0 {
		for _, x := range v {
			fmt.Fprintf(os.Stderr, "✗ no pasa el guard (%s): %q\n", x["what"], x["found"])
		}
		fail("la bitácora sube a Jira como worklog: sin repos, rutas ni F-xx en el título o la nota")
	}

	fmt.Printf("\n  #%d %s · %s · %d′ · %s\n  %s\n  %s\n\n", chosen.ID, chosen.Slug, start.Format("2006-01-02 15:04"), minutes, *kind, *title, origin)
	if *dryRun {
		fmt.Println("  (-n: no se escribió)")
		return
	}
	e, err := s.Create("", *title, 0, chosen.ID, *kind, start, minutes, body)
	if err != nil {
		fail("escribiendo: %v", err)
	}
	fmt.Printf("  escrita como entrada %d en data/entries/%s.jsonl\n\n", e.ID, e.Day[:7])
}
