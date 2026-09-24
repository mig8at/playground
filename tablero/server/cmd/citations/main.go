// citations valida las citas `archivo:línea` de uno o más documentos contra `main` de cada repo. La
// lógica, y por qué se ancla por contenido y no por símbolo, están en `internal/citations`.
//
//	citations [-ok] <doc.md> [<doc.md> …]
//
// Sale 1 si hay citas movidas, reescritas o fuera de rango.
package main

import (
	"flag"
	"fmt"
	"os"

	"creditop/playground/connectors/repos"
	"creditop/playground/tablero/server/internal/citations"
	"creditop/playground/tablero/server/internal/layout"
)

func main() {
	showOK := flag.Bool("ok", false, "lista también las que están bien")
	flag.Parse()
	if flag.NArg() == 0 {
		fmt.Fprintln(os.Stderr, "uso: citations [-ok] <doc.md> [<doc.md> …]  ·  desde la raíz: make citas DOC=<doc.md>")
		os.Exit(2)
	}
	checker := citations.New(repos.New(layout.Find().Tools()))
	if citations.Report(os.Stdout, checker.Review(flag.Args()), *showOK) {
		os.Exit(1)
	}
}
