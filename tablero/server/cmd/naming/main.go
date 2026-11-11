// naming: ¿el código del playground —el tablero, lo compartido de la raíz (connectors, cmd, lib, tools), el harness,
// el visor y las apps (`naming.Apps`)— nombra algo en español que no esté en la deuda conocida? Sale 1 si sí. La vara y por qué no es el
// diccionario del sistema: `internal/naming`.
//
//	naming                 los nombres que no pasan como inglés
//	naming -words          sólo las palabras desconocidas y cuántos nombres las usan, para curar la lista
//	naming -freeze         congela los nombres en español de ahora como deuda conocida (tools/naming-debt.txt)
//	naming -all            muestra también la deuda conocida, no sólo lo nuevo
//	naming -json           los hallazgos en JSON
//	naming -decls <dir>    cada identificador declarado en el Go de ese árbol (archivo:línea:col, nombre, clase)
//	naming -json-keys <dir>  cada clave JSON de ese árbol (archivo:línea, clase, contexto, clave)
//
// Los dos últimos son los extractores con los que trabajan los renombradores de `tools/rename/`.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"creditop/playground/tablero/server/internal/layout"
	"creditop/playground/tablero/server/internal/naming"
)

func main() {
	words := flag.Bool("words", false, "sólo las palabras desconocidas y cuántos nombres las usan")
	asJSON := flag.Bool("json", false, "los hallazgos en JSON")
	decls := flag.String("decls", "", "lista las declaraciones de Go de ese árbol y sale")
	jsonKeys := flag.String("json-keys", "", "lista las claves JSON de ese árbol y sale")
	canon := flag.String("canon", "", "la raíz del repo compartido: revisa SÓLO canon (tools/canon), que vive allá")
	cache := flag.String("cache", "", "dónde guardar la tabla de frecuencias (por defecto data/cache/naming-baseline.json)")
	freeze := flag.Bool("freeze", false, "congela los nombres en español de ahora como deuda conocida")
	all := flag.Bool("all", false, "muestra también la deuda conocida")
	flag.Parse()

	switch {
	case *decls != "":
		for _, d := range naming.GoDecls(*decls, os.Stderr) {
			fmt.Printf("%s:%d:%d\t%s\t%s\n", d.Path, d.Line, d.Col, d.Name, d.Kind)
		}
		return
	case *jsonKeys != "":
		for _, k := range naming.JSONKeys(*jsonKeys) {
			fmt.Printf("%s:%d\t%s\t%s\t%s\n", k.Path, k.Line, k.Kind, k.Ctx, k.Key)
		}
		return
	}

	lay := layout.Find()
	data, err := filepath.Abs(lay.Data)
	if err != nil {
		fail(err)
	}
	board := filepath.Dir(data)
	if *cache == "" {
		*cache = filepath.Join(data, "cache", "naming-baseline.json")
	}
	baseline, err := naming.Baseline(*cache)
	if err != nil {
		fail(err)
	}
	allow, err := naming.LoadAllow(filepath.Join(board, "tools", "naming-allow.txt"))
	if err != nil {
		fail(err)
	}
	var findings []naming.Finding
	var seen []string
	boards := []naming.Board{naming.Default(board), naming.Shared(filepath.Dir(board)), naming.Harness(filepath.Dir(board)), naming.Visor(filepath.Dir(board))}
	boards = append(boards, naming.Apps(filepath.Dir(board))...)
	if *canon != "" {
		boards = []naming.Board{naming.Canon(*canon, filepath.Dir(board))}
	}
	for _, b := range boards {
		found, counts, err := naming.Check(b, baseline, allow, os.Stderr)
		if err != nil {
			fail(err)
		}
		findings = append(findings, found...)
		seen = append(seen, b.Name+": "+naming.Seen(counts))
	}
	// La deuda conocida (no aplica a canon, que vive en otro repo): falla sólo lo nuevo.
	debtPath := filepath.Join(board, "tools", "naming-debt.txt")
	if *freeze && *canon == "" {
		n, err := naming.WriteDebt(debtPath, findings)
		if err != nil {
			fail(err)
		}
		fmt.Printf("  deuda congelada: %d nombre(s) en tablero/tools/naming-debt.txt\n", n)
		return
	}
	var known []naming.Finding
	var paid []string
	if *canon == "" && !*all && !*words {
		debt, err := naming.LoadDebt(debtPath)
		if err != nil {
			fail(err)
		}
		findings, known, paid = naming.SplitDebt(findings, debt)
	}
	debtNote := ""
	if len(known) > 0 {
		debtNote = fmt.Sprintf("\n      deuda conocida: %d nombre(s) en español de antes (tablero/tools/naming-debt.txt; ALL=1 los lista)", len(known))
	}
	if len(paid) > 0 {
		debtNote += fmt.Sprintf("\n  ▲ %d de la deuda ya no aparecen (renombrados o borrados): FREEZE=1 los saca de la lista", len(paid))
	}

	switch {
	case *asJSON:
		if findings == nil {
			findings = []naming.Finding{}
		}
		enc := json.NewEncoder(os.Stdout)
		enc.SetEscapeHTML(false)
		enc.SetIndent("", "  ")
		_ = enc.Encode(findings)
	case *words:
		for _, w := range naming.ByWord(findings) {
			fmt.Printf("%s %3d  %s\n", pad(w.Word, 22), len(w.Names), strings.Join(firstUnique(w.Names, 6), ", "))
		}
	case len(findings) == 0:
		fmt.Printf("  ✓ nombres en inglés: ninguno nuevo en español\n      %s%s\n", strings.Join(seen, "\n      "), debtNote)
	default:
		fmt.Printf("  ✗ %d nombre(s) NUEVOS con palabras que no son inglés, de\n      %s%s\n\n", len(findings), strings.Join(seen, "\n      "), debtNote)
		for _, f := range findings {
			fmt.Printf("    %s %s %s\n", pad(f.Where, 52), pad(f.Name, 34), strings.Join(f.Words, ", "))
		}
		fmt.Print("\n  Si la palabra es inglés o un nombre propio, va a tablero/tools/naming-allow.txt." +
			"\n  Si es español, se renombra (tablero/tools/rename/ tiene los renombradores).\n")
	}
	if len(findings) > 0 {
		os.Exit(1)
	}
}

// firstUnique: los nombres sin repetir, ordenados, hasta `n`.
func firstUnique(names []string, n int) []string {
	seen := map[string]bool{}
	var out []string
	for _, name := range names {
		if !seen[name] {
			seen[name] = true
			out = append(out, name)
		}
	}
	sort.Strings(out)
	if len(out) > n {
		out = out[:n]
	}
	return out
}

func pad(s string, width int) string {
	if n := len([]rune(s)); n < width {
		return s + strings.Repeat(" ", width-n)
	}
	return s
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}
