// traps revisa las TRAMPAS del sistema (`tablero/data/traps/doc.md`): que su índice esté completo y
// que sus citas sigan apuntando bien. Por qué los dos chequeos: `internal/traps`.
//
//	traps          los dos chequeos
//	traps -index   sólo el índice (no necesita los repos, no toca git)
//
// Sale 0 si todo está en orden y 1 si hay algo que arreglar.
package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"

	"creditop/playground/connectors/repos"
	"creditop/playground/lib/text"
	"creditop/playground/tablero/server/internal/citations"
	"creditop/playground/tablero/server/internal/layout"
	"creditop/playground/tablero/server/internal/traps"
)

func main() {
	onlyIndex := flag.Bool("index", false, "sólo el índice, sin tocar los repos")
	flag.Parse()

	lay := layout.Find()
	playground := filepath.Dir(lay.Tools())
	doc, err := filepath.Abs(filepath.Join(lay.Data, "traps", "doc.md"))
	if err != nil {
		fmt.Fprintln(os.Stderr, "✗", err)
		os.Exit(1)
	}
	shown, err := filepath.Rel(playground, doc)
	if err != nil {
		shown = doc
	}
	raw, err := os.ReadFile(doc)
	if err != nil {
		fmt.Fprintln(os.Stderr, "✗ no pude leer las trampas:", err)
		os.Exit(1)
	}
	total, failures := traps.ReviewIndex(text.SplitLines(string(raw)))
	fmt.Printf("\n  TRAMPAS · %d con ancla en %s\n\n", total, shown)

	exit := 0
	if !*onlyIndex {
		exit = reviewCitations(repos.New(lay.Tools()), doc, shown)
	}
	if len(failures) > 0 {
		fmt.Print("\n✗ el índice no está completo — una trampa fuera de la puerta se lee como «no nos pasó»:\n\n")
		for _, f := range failures {
			fmt.Println(f)
		}
		os.Exit(1)
	}
	fmt.Println("  ✓ índice completo: toda trampa con ancla está citada, y ninguna cita apunta al vacío")
	os.Exit(exit)
}

/* reviewCitations: las citas `archivo:línea` del documento, contra `main`.
 *
 * ⚠ HASTA EL 2026-09-21 ESTE CHEQUEO NO PODÍA PONERSE EN ROJO. Filtraba las líneas del validador que
 * anunciaban movidas o reescritas… y guardaba el resultado en una variable que no leía nadie: imprimía
 * el resumen y devolvía 0 igual. O sea que una cita corrida salía en pantalla y `make trampas` seguía
 * dando verde. Ahora el balde roto decide la salida, y se listan las primeras para poder arreglarlas
 * sin volver a correr nada. */
func reviewCitations(client *repos.Client, doc, shown string) int {
	res := citations.New(client).Review([]string{doc})
	b := res.Buckets
	fmt.Printf("  %d citas · ✓ %d ancladas · · %d sin ancla · ? %d no existen en main\n",
		res.Total(), len(b[citations.OK]), len(b[citations.Unanchored]), len(b[citations.Missing]))
	if !res.Broken() {
		return 0
	}
	fmt.Println()
	fmt.Println("  ✗ citas que ya no apuntan a lo que dicen:")
	for _, key := range []string{citations.Moved, citations.Rewritten, citations.Outside} {
		items := citations.Sorted(b[key])
		if len(items) > 8 {
			items = items[:8]
		}
		for _, it := range items {
			fmt.Printf("    %s %s %s\n", citations.Pad(it.Where, 22), citations.Pad(it.Citation, 54), it.Note)
		}
	}
	fmt.Printf("  → todas: make citas DOC=%s\n", shown)
	return 1
}
