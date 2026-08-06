package main

// sql.go — modo `-sql`: una consulta de SOLO LECTURA contra la fuente del target.
//
//   go run . -sql "SELECT id, name FROM countries WHERE id IN (47,60)"
//   go run . -target dev -sql "..." -csv
//
// Por qué existe: el trazador ya tiene la única puerta a la BD de PRODUCCIÓN (Redash), y auditar datos
// —"¿esta columna está vacía también en prod?"— exigía o abrir un túnel aparte o pegar SQL a mano en la
// UI. Los modos existentes (`-ureq`, `-buscar`) responden preguntas de UNA solicitud; esto responde
// preguntas del CONJUNTO, que es lo que hace falta para decidir una migración.
//
// ⚠ CONTRA PROD, Y AUDITADO A NOMBRE DEL TOKEN. El default de `-target` es `prod` (convención del
// binario), así que una consulta sin target va a producción y queda registrada. Por eso el modo:
//
//   1. Es SOLO LECTURA y lo verifica ANTES de salir a la red (ver `esSoloLectura`). No confía en los
//      permisos del datasource: si el usuario de Redash tuviera escritura, la guarda es lo único que hay.
//   2. Imprime target, fuente y la consulta antes de correrla. Nada se ejecuta a ciegas.
//   3. NO pagina ni sigue cursores: lo que devuelve la fuente es lo que se imprime.
//
// La guarda es deliberadamente ESTRICTA (rechaza lo dudoso en vez de intentar entenderlo): no hay un
// parser de SQL acá, y un allowlist que "casi" acierta es peor que uno que molesta.

import (
	"encoding/csv"
	"fmt"
	"os"
	"regexp"
	"sort"
	"strings"
)

// Solo estas dos formas arrancan una lectura. `SHOW`/`DESCRIBE`/`EXPLAIN` quedan afuera a propósito:
// son útiles, pero abrirlos obliga a razonar caso por caso y el objetivo acá es una regla que se pueda
// leer de un vistazo.
var reArranqueLectura = regexp.MustCompile(`(?is)^\s*(select|with)\b`)

// Verbos que jamás aparecen en una lectura. Se buscan como PALABRA (`\b`) para no rechazar una columna
// llamada `updated_at` ni un `SELECT * FROM inserts`.
var reVerboEscritura = regexp.MustCompile(`(?is)\b(insert|update|delete|drop|alter|create|truncate|replace|grant|revoke|rename|call|load|handler|lock|unlock|commit|rollback|savepoint|prepare|execute|do|set)\b`)

// esSoloLectura decide si la consulta puede salir a la red. Devuelve el motivo del rechazo, o "".
//
// El orden importa: primero se normaliza (se sacan comentarios, que son el escondite clásico), después
// se exige el arranque de lectura, y recién al final se buscan verbos. Al revés, un `-- update` en un
// comentario rechazaría una consulta legítima.
func esSoloLectura(q string) string {
	limpia := sinComentarios(q)
	if strings.TrimSpace(limpia) == "" {
		return "la consulta está vacía"
	}
	if !reArranqueLectura.MatchString(limpia) {
		return "solo se permiten consultas que empiecen con SELECT o WITH"
	}
	// Multi-statement: un `;` que no sea el último carácter significa que viene algo más detrás.
	if i := strings.Index(strings.TrimRight(limpia, " \t\r\n;"), ";"); i >= 0 {
		return "una sola sentencia por corrida (se encontró un ';' intermedio)"
	}
	if m := reVerboEscritura.FindString(limpia); m != "" {
		return fmt.Sprintf("contiene el verbo %q, que no pertenece a una lectura", strings.ToUpper(m))
	}
	return ""
}

// sinComentarios saca `-- …`, `# …` y `/* … */` para que la guarda mire SQL y no prosa.
func sinComentarios(q string) string {
	var b strings.Builder
	for _, linea := range strings.Split(q, "\n") {
		if i := strings.Index(linea, "--"); i >= 0 {
			linea = linea[:i]
		}
		if i := strings.Index(linea, "#"); i >= 0 {
			linea = linea[:i]
		}
		b.WriteString(linea)
		b.WriteString("\n")
	}
	sinBloque := regexp.MustCompile(`(?s)/\*.*?\*/`).ReplaceAllString(b.String(), " ")
	return sinBloque
}

// modoSQL corre UNA consulta de lectura y la imprime. Exit: 0 ok · 1 falló la consulta · 2 rechazada.
func modoSQL(c config, target, consulta string, comoCSV bool) int {
	if motivo := esSoloLectura(consulta); motivo != "" {
		fmt.Fprintf(os.Stderr, "  %s consulta rechazada: %s\n\n  %s\n\n",
			paint("31", "✘"), motivo, strings.TrimSpace(consulta))
		return 2
	}

	fuente, err := abrirFuente(c)
	if err != nil {
		fmt.Fprintf(os.Stderr, "  %s %v\n", paint("31", "✘"), err)
		return 1
	}
	defer fuente.Close()

	if !comoCSV {
		step("Consulta de solo lectura")
		detail("target   %s", target)
		detail("fuente   %s", fuente.Nombre())
		if strings.HasPrefix(fuente.Nombre(), "redash") {
			detail("%s", gray("va a la BD de PRODUCCIÓN y queda auditada a nombre del token"))
		}
		fmt.Println()
		for _, l := range strings.Split(strings.TrimSpace(consulta), "\n") {
			fmt.Println("       " + gray(strings.TrimRight(l, " \t")))
		}
		fmt.Println()
	}

	filas, err := fuente.Filas(consulta)
	if err != nil {
		fmt.Fprintf(os.Stderr, "  %s la consulta falló: %v\n", paint("31", "✘"), err)
		return 1
	}
	if len(filas) == 0 {
		if !comoCSV {
			fmt.Println("       (sin filas)")
		}
		return 0
	}

	cols := columnas(filas)
	if comoCSV {
		return imprimirCSV(cols, filas)
	}
	imprimirTabla(cols, filas)
	fmt.Printf("\n       %s\n", gray(fmt.Sprintf("%d fila(s)", len(filas))))
	return 0
}

// columnas devuelve las llaves en un orden ESTABLE. `Fila` es un map, así que sin esto el orden de las
// columnas cambiaría entre corridas y comparar dos salidas sería imposible.
func columnas(filas []Fila) []string {
	vistas := map[string]bool{}
	var cols []string
	for _, f := range filas {
		for k := range f {
			if !vistas[k] {
				vistas[k] = true
				cols = append(cols, k)
			}
		}
	}
	sort.Strings(cols)
	return cols
}

func celda(v any) string {
	if v == nil {
		return "NULL"
	}
	return strings.ReplaceAll(fmt.Sprint(v), "\n", " ")
}

func imprimirTabla(cols []string, filas []Fila) {
	ancho := make([]int, len(cols))
	for i, c := range cols {
		ancho[i] = len(c)
	}
	for _, f := range filas {
		for i, c := range cols {
			if n := len(celda(f[c])); n > ancho[i] {
				ancho[i] = n
			}
		}
	}
	var cab, sep strings.Builder
	for i, c := range cols {
		cab.WriteString(fmt.Sprintf("%-*s  ", ancho[i], c))
		sep.WriteString(strings.Repeat("─", ancho[i]) + "  ")
	}
	fmt.Println("       " + bold(strings.TrimRight(cab.String(), " ")))
	fmt.Println("       " + gray(strings.TrimRight(sep.String(), " ")))
	for _, f := range filas {
		var l strings.Builder
		for i, c := range cols {
			l.WriteString(fmt.Sprintf("%-*s  ", ancho[i], celda(f[c])))
		}
		fmt.Println("       " + strings.TrimRight(l.String(), " "))
	}
}

func imprimirCSV(cols []string, filas []Fila) int {
	w := csv.NewWriter(os.Stdout)
	defer w.Flush()
	if err := w.Write(cols); err != nil {
		fmt.Fprintf(os.Stderr, "  %s %v\n", paint("31", "✘"), err)
		return 1
	}
	for _, f := range filas {
		rec := make([]string, len(cols))
		for i, c := range cols {
			rec[i] = celda(f[c])
		}
		if err := w.Write(rec); err != nil {
			fmt.Fprintf(os.Stderr, "  %s %v\n", paint("31", "✘"), err)
			return 1
		}
	}
	return 0
}
