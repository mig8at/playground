// task-context agrega o consulta hitos estructurados de una tarea.
//
// No acepta texto libre por flags: el evento vive primero en un JSON revisable, se valida y recién
// entonces se apila en tasks/<slug>/context.jsonl. Así una actualización no termina como un
// diario irrelevante ni duplica el documento Markdown de la tarea.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"strconv"
	"time"

	"creditop/tablero/server/internal/layout"
	"creditop/tablero/server/internal/store"
	"creditop/tablero/server/internal/taskcontext"
)

// dataDir: la carpeta `data/`; las tareas viven al lado, en `tasks/`. Ver el paquete layout.
func dataDir() string { return layout.Find().Data }

func resolve(s *store.Store, ref string) (*store.EffortRef, error) {
	for _, effort := range s.EffortsAll() {
		slug := effort.Slug
		if strconv.FormatInt(effort.ID, 10) == ref || slug == ref {
			e := effort
			return &e, nil
		}
	}
	return nil, fmt.Errorf("no hay tarea %q (id o slug exacto)", ref)
}

func main() {
	task := flag.String("tarea", "", "id o slug de la tarea")
	eventPath := flag.String("evento", "", "JSON con el hito; omite schema, id y at")
	show := flag.Bool("ver", false, "muestra los últimos hitos sin escribir")
	dryRun := flag.Bool("n", false, "valida y previsualiza, sin escribir")
	flag.Parse()

	fail := func(format string, args ...any) {
		fmt.Fprintf(os.Stderr, format+"\n", args...)
		os.Exit(2)
	}
	if *task == "" {
		fail("falta -tarea. Ej: task-context -tarea codigo-preaprobado -evento hito.json")
	}
	if *show && *eventPath != "" {
		fail("-ver no recibe -evento")
	}
	if !*show && *eventPath == "" {
		fail("falta -evento con el JSON del hito")
	}
	s, err := store.Open(dataDir())
	if err != nil {
		fail("abriendo el tablero: %v", err)
	}
	effort, err := resolve(s, *task)
	if err != nil {
		fail("%v. `make tareas` las lista.", err)
	}
	slug := effort.Slug
	if *show {
		events, err := s.TaskContext(effort.ID)
		if err != nil {
			fail("leyendo contexto: %v", err)
		}
		if len(events) == 0 {
			fmt.Printf("\n  #%d %s · sin hitos estructurados todavía\n\n", effort.ID, slug)
			return
		}
		fmt.Printf("\n  #%d %s · %d hito(s), más reciente primero\n", effort.ID, slug, len(events))
		for _, event := range taskcontext.Recent(events, 8) {
			fmt.Printf("  %s · %-10s %s\n", event.At[:10], event.Kind, taskcontext.PlainText(event.Summary))
			if event.Next != "" {
				fmt.Printf("    siguiente: %s\n", event.Next)
			}
		}
		fmt.Println()
		return
	}

	b, err := os.ReadFile(*eventPath)
	if err != nil {
		fail("leyendo -evento: %v", err)
	}
	input, err := taskcontext.Decode(b)
	if err != nil {
		fail("-evento no es JSON válido: %v", err)
	}
	clean, err := taskcontext.NormalizeAndValidate(input, time.Now())
	if err != nil {
		fail("hito inválido: %v", err)
	}
	pretty, _ := json.MarshalIndent(clean, "", "  ")
	fmt.Printf("\n  #%d %s · %s\n%s\n", effort.ID, slug, *eventPath, pretty)
	if *dryRun {
		fmt.Println("  (-n: no se escribió)")
		return
	}
	if _, err := taskcontext.Append(dataDir(), slug, clean, time.Now()); err != nil {
		fail("escribiendo contexto: %v", err)
	}
	fmt.Printf("  escrito en tasks/%s/%s\n\n", slug, layout.ContextFile)
}
