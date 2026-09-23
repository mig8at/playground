// task-context agrega bloques a la pila de una tarea, o la muestra.
//
// Un bloque se escribe primero en un Markdown revisable —`# título` y la descripción—, se valida y
// recién entonces se apila en tasks/<slug>/context.jsonl, con los archivos que cita fijados al commit
// en que existen.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"creditop/tablero/server/internal/canon"
	"creditop/tablero/server/internal/layout"
	"creditop/tablero/server/internal/repos"
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

// canonMissing le pregunta a canon por los temas citados y devuelve los que no conoce.
func canonMissing(ctx context.Context, refs []string) ([]string, error) {
	// Cuatro segundos y no los ocho del cliente: sin VPN canon no contesta, y agregar un bloque no
	// puede quedarse colgado esperando una red que no está (el bloque entra con un aviso).
	ctx, cancel := context.WithTimeout(ctx, 4*time.Second)
	defer cancel()
	got, err := canon.FromEnv().References(ctx, refs)
	if err != nil {
		return nil, err
	}
	var missing []string
	for _, r := range got {
		if r.Error != "" {
			missing = append(missing, r.Requested+" ("+r.Error+")")
		}
	}
	return missing, nil
}

func main() {
	task := flag.String("tarea", "", "id o slug de la tarea")
	blockPath := flag.String("bloque", "", "Markdown del bloque: `# título` y la descripción")
	via := flag.String("via", "manual", "quién lo agrega: manual · harness · trazador · db")
	show := flag.Bool("ver", false, "muestra la pila sin escribir")
	dryRun := flag.Bool("n", false, "valida y previsualiza, sin escribir")
	flag.Parse()

	fail := func(format string, args ...any) {
		fmt.Fprintf(os.Stderr, format+"\n", args...)
		os.Exit(2)
	}
	if *task == "" {
		fail("falta -tarea. Ej: task-context -tarea codigo-preaprobado -bloque bloque.md")
	}
	if *show && *blockPath != "" {
		fail("-ver no recibe -bloque")
	}
	if !*show && *blockPath == "" {
		fail("falta -bloque con el Markdown del bloque")
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
	events, err := s.TaskContext(effort.ID)
	if err != nil {
		fail("leyendo la pila: %v", err)
	}
	if *show {
		if len(events) == 0 {
			fmt.Printf("\n  #%d %s · la pila está vacía\n\n", effort.ID, slug)
			return
		}
		fmt.Printf("\n  #%d %s · %d en la pila, más reciente primero\n", effort.ID, slug, len(events))
		for _, event := range taskcontext.Recent(events, 8) {
			fmt.Printf("  %s · %s\n", event.At[:10], event.Title)
		}
		fmt.Println()
		return
	}

	src, err := os.ReadFile(*blockPath)
	if err != nil {
		fail("leyendo -bloque: %v", err)
	}
	title, body, err := taskcontext.ParseBlockMarkdown(string(src))
	if err != nil {
		fail("bloque inválido: %v", err)
	}
	deps := taskcontext.BlockDeps{Files: repos.New(layout.Find().Tools()), Canon: canonMissing, Existing: events}
	block, warnings, err := taskcontext.PrepareBlock(context.Background(), title, body, *via, deps, time.Now())
	for _, w := range warnings {
		fmt.Fprintf(os.Stderr, "  ⚠ %s\n", w)
	}
	if err != nil {
		fail("bloque inválido: %v", err)
	}
	var pretty strings.Builder
	encoder := json.NewEncoder(&pretty)
	encoder.SetEscapeHTML(false)
	encoder.SetIndent("", "  ")
	_ = encoder.Encode(block)
	fmt.Printf("\n  #%d %s · %s\n%s", effort.ID, slug, *blockPath, pretty.String())
	if *dryRun {
		fmt.Println("  (-n: no se escribió)")
		return
	}
	if _, err := taskcontext.Append(dataDir(), slug, block, time.Now()); err != nil {
		fail("escribiendo la pila: %v", err)
	}
	fmt.Printf("  apilado en tasks/%s/%s\n\n", slug, layout.ContextFile)
}
