// Command tareas es el CLI del tablero: su propio dominio, sin levantar el server ni abrir la UI.
//
// POR QUÉ EXISTE. El store ya había resuelto la mitad —pasó de SQLite a archivos justamente porque
// «el tablero era el único rincón del playground que un modelo no puede leer sin levantar un
// server»— así que LEER una tarea ya funciona: es un `.md`. Lo que seguía atrás de la UI era todo lo
// demás: preguntar EN QUÉ SE ESTÁ TRABAJANDO obligaba a parsear 38 frontmatters a mano cada vez, y
// el GUARD —la regla de qué puede salir a Jira— sólo corría al publicar, cuando ya es tarde para
// decidir cómo escribir.
//
//	go run ./cmd/tareas                      las abiertas, con estado, Jira y nodos
//	go run ./cmd/tareas -todas               incluidas las archivadas
//	go run ./cmd/tareas -stage work          filtradas por etapa
//	go run ./cmd/tareas -n <slug|id>         una tarea: qué es PÚBLICO y qué es PRIVADO
//	go run ./cmd/tareas -guard <archivo>     ¿este texto puede salir a Jira? (sale 1 si no)
//	go run ./cmd/tareas -json                lo mismo, para encadenar
//
// El `-guard` reusa `internal/guard`, que es la fuente única: la UI compila esos mismos patrones y
// `issue-create` los aplica antes de publicar. Reimplementarlos acá habría sido la cuarta copia, y
// el propio paquete advierte que dos ya habrían derivado.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"creditop/tablero/server/internal/guard"
)

// Tarea es lo que se puede saber de un `.md` SIN abrirlo entero: su frontmatter.
type Tarea struct {
	Slug     string   `json:"slug"`
	ID       int      `json:"id"`
	Title    string   `json:"title"`
	Stage    string   `json:"stage"`
	Archived bool     `json:"archived"`
	Jira     []string `json:"jira,omitempty"`
	Nodos    []string `json:"context_nodes,omitempty"`
	Archivo  string   `json:"archivo"`
}

var (
	reLista  = regexp.MustCompile(`\[(.*?)\]`)
	reCita   = regexp.MustCompile(`^["']|["']$`)
	rePublic = regexp.MustCompile(`(?m)^##\s+Tarea \(publicable\)\s*$`)
)

func valor(linea string) string {
	_, v, _ := strings.Cut(linea, ":")
	return reCita.ReplaceAllString(strings.TrimSpace(v), "")
}

func lista(linea string) []string {
	m := reLista.FindStringSubmatch(linea)
	if m == nil || strings.TrimSpace(m[1]) == "" {
		return nil
	}
	var out []string
	for _, x := range strings.Split(m[1], ",") {
		if x = reCita.ReplaceAllString(strings.TrimSpace(x), ""); x != "" {
			out = append(out, x)
		}
	}
	return out
}

// leer saca el frontmatter. No parsea YAML de verdad a propósito: el frontmatter de una tarea es
// plano y conocido, y meter una dependencia para cinco claves sería pagar de más.
func leer(ruta string) (Tarea, string, error) {
	b, err := os.ReadFile(ruta)
	if err != nil {
		return Tarea{}, "", err
	}
	cuerpo := string(b)
	t := Tarea{Slug: strings.TrimSuffix(filepath.Base(ruta), ".md"), Archivo: ruta}
	partes := strings.SplitN(cuerpo, "---", 3)
	if len(partes) < 3 {
		return t, cuerpo, nil // sin frontmatter: se devuelve igual, con lo que se sepa
	}
	for _, l := range strings.Split(partes[1], "\n") {
		switch {
		case strings.HasPrefix(l, "id:"):
			t.ID, _ = strconv.Atoi(valor(l))
		case strings.HasPrefix(l, "title:"):
			t.Title = valor(l)
		case strings.HasPrefix(l, "stage:"):
			t.Stage = valor(l)
		case strings.HasPrefix(l, "archived:"):
			t.Archived = valor(l) == "true"
		case strings.HasPrefix(l, "jira:"):
			t.Jira = lista(l)
		case strings.HasPrefix(l, "context_nodes:"):
			t.Nodos = lista(l)
		}
	}
	return t, partes[2], nil
}

func dirDatos() string {
	// Se corre con `go run ./cmd/tareas` desde `server/`, así que `../data` es lo normal; pero
	// también se acepta desde la raíz del tablero, para que no importe desde dónde se lance.
	for _, d := range []string{"../data", "data", "tablero/data"} {
		if fi, err := os.Stat(d); err == nil && fi.IsDir() {
			return d
		}
	}
	return "../data"
}

func todas() ([]Tarea, error) {
	rutas, err := filepath.Glob(filepath.Join(dirDatos(), "*.md"))
	if err != nil {
		return nil, err
	}
	var out []Tarea
	for _, r := range rutas {
		t, _, err := leer(r)
		if err == nil {
			out = append(out, t)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID > out[j].ID })
	return out, nil
}

// verGuard es el único modo que puede salir con código 1: se usa para DECIDIR antes de publicar, así
// que tiene que poder frenar un pipeline, no sólo informar.
func verGuard(ruta string, comoJSON bool) int {
	b, err := os.ReadFile(ruta)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 2
	}
	v := guard.Violations(string(b))
	if comoJSON {
		_ = json.NewEncoder(os.Stdout).Encode(map[string]any{"archivo": ruta, "violaciones": v})
	} else if len(v) == 0 {
		fmt.Printf("  ✓ %s puede salir a Jira: no matchea ningún patrón prohibido\n", ruta)
	} else {
		fmt.Printf("  ✗ %s NO puede salir — %d violación(es):\n", ruta, len(v))
		for _, x := range v {
			fmt.Printf("      %-46s encontró: %s\n", x["what"], x["found"])
		}
		fmt.Println("\n  (recordá: a Jira sólo salen `jira_title` y la sección `## Tarea (publicable)`)")
	}
	if len(v) > 0 {
		return 1
	}
	return 0
}

func verUna(ref string, comoJSON bool) int {
	ts, _ := todas()
	var elegida *Tarea
	for i, t := range ts {
		if t.Slug == ref || strconv.Itoa(t.ID) == ref || strings.Contains(strings.ToLower(t.Slug), strings.ToLower(ref)) {
			elegida = &ts[i]
			break
		}
	}
	if elegida == nil {
		fmt.Fprintf(os.Stderr, "no encontré una tarea que matchee %q. Corré sin -n para ver la lista.\n", ref)
		return 2
	}
	_, cuerpo, _ := leer(elegida.Archivo)
	// La frontera del repo hecha visible: lo de arriba de `## Tarea (publicable)` es PRIVADO y puede
	// nombrar repos, rutas y F-xx; lo de abajo es lo único que sale. Mostrarlas mezcladas es cómo se
	// publica sin querer algo que no debía salir.
	publico := ""
	if loc := rePublic.FindStringIndex(cuerpo); loc != nil {
		publico = strings.TrimSpace(cuerpo[loc[1]:])
	}
	if comoJSON {
		_ = json.NewEncoder(os.Stdout).Encode(map[string]any{
			"tarea": elegida, "privado": strings.TrimSpace(cuerpo), "publicable": publico})
		return 0
	}
	fmt.Printf("\n  #%d  %s\n  %s · %s%s\n", elegida.ID, elegida.Title, elegida.Slug, elegida.Stage,
		map[bool]string{true: " · ARCHIVADA"}[elegida.Archived])
	if len(elegida.Jira) > 0 {
		fmt.Printf("  jira: %s\n", strings.Join(elegida.Jira, ", "))
	}
	if len(elegida.Nodos) > 0 {
		fmt.Printf("  nodos de context: %s\n", strings.Join(elegida.Nodos, ", "))
	}
	fmt.Printf("\n  archivo: %s\n", elegida.Archivo)
	if publico == "" {
		fmt.Println("\n  ⚠ no tiene sección `## Tarea (publicable)`: no hay nada que se pueda mandar a Jira.")
	} else {
		fmt.Printf("\n  ── PUBLICABLE (%d chars, lo único que sale a Jira) ──\n", len(publico))
		v := guard.Violations(publico)
		if len(v) == 0 {
			fmt.Println("  ✓ pasa el guard")
		} else {
			fmt.Printf("  ✗ NO pasa el guard: %d violación(es) — corré -guard para el detalle\n", len(v))
		}
	}
	fmt.Println("\n  (el cuerpo entero es PRIVADO: leelo del archivo, puede nombrar repos, rutas y F-xx)")
	return 0
}

func main() {
	var (
		una      = flag.String("n", "", "una tarea, por slug o por id (acepta subcadena del slug)")
		guardar  = flag.String("guard", "", "¿el texto de este archivo puede salir a Jira? sale 1 si no")
		stage    = flag.String("stage", "", "filtrar por etapa (p. ej. work)")
		conTodas = flag.Bool("todas", false, "incluir las archivadas")
		comoJSON = flag.Bool("json", false, "salida en JSON")
	)
	flag.Parse()

	if *guardar != "" {
		os.Exit(verGuard(*guardar, *comoJSON))
	}
	if *una != "" {
		os.Exit(verUna(*una, *comoJSON))
	}

	ts, err := todas()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}
	var vis []Tarea
	for _, t := range ts {
		if !*conTodas && t.Archived {
			continue
		}
		if *stage != "" && t.Stage != *stage {
			continue
		}
		vis = append(vis, t)
	}
	if *comoJSON {
		_ = json.NewEncoder(os.Stdout).Encode(vis)
		return
	}
	fmt.Printf("\n  %d tarea(s)%s · de %d en total\n\n", len(vis),
		map[bool]string{true: "", false: " abiertas"}[*conTodas], len(ts))
	for _, t := range vis {
		j := ""
		if len(t.Jira) > 0 {
			j = "  " + strings.Join(t.Jira, ",")
		}
		fmt.Printf("  #%-3d %-10s %s%s\n", t.ID, t.Stage, t.Title, j)
		fmt.Printf("       %s\n", t.Slug)
	}
	fmt.Println("\n  -n <slug|id> para una · -guard <archivo> antes de publicar · -json para encadenar")
}
