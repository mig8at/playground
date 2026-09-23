// Command tareas es el CLI del tablero: su propio dominio, sin levantar el server ni abrir la UI.
//
// POR QUÉ EXISTE. El store ya había resuelto la mitad —pasó de SQLite a archivos justamente porque
// «el tablero era el único rincón del playground que un modelo no puede leer sin levantar un
// server»— así que LEER una tarea ya funciona: es un `.md`. Lo que seguía atrás de la UI era todo lo
// demás: preguntar EN QUÉ SE ESTÁ TRABAJANDO obligaba a parsear 38 frontmatters a mano cada vez, y
// el GUARD —la regla de qué puede salir a Jira— sólo corría al publicar, cuando ya es tarde para
// decidir cómo escribir.
//
//	go run ./cmd/tasks                      las abiertas, con estado, Jira y nodos
//	go run ./cmd/tasks -todas               incluidas las archivadas
//	go run ./cmd/tasks -stage work          filtradas por etapa
//	go run ./cmd/tasks -n <slug|id>         una tarea: qué es PÚBLICO y qué es PRIVADO
//	go run ./cmd/tasks -guard <archivo>     ¿este texto puede salir a Jira? (sale 1 si no)
//	go run ./cmd/tasks -json                la lista resumida, para encadenar
//	go run ./cmd/tasks -n <slug> -json      una tarea en el contrato tipado tablero.task.v2
//
// El `-guard` reusa `internal/guard`, que es la fuente única: la UI compila esos mismos patrones y
// `issue-create` los aplica antes de publicar. Reimplementarlos acá habría sido la cuarta copia, y
// el propio paquete advierte que dos ya habrían derivado.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"creditop/tablero/server/internal/canon"
	"creditop/tablero/server/internal/env"
	"creditop/tablero/server/internal/guard"
	"creditop/tablero/server/internal/layout"
	"creditop/tablero/server/internal/store"
)

// Task es lo que se puede saber de un `.md` SIN abrirlo entero: su frontmatter.
type Task struct {
	Slug     string   `json:"slug"`
	ID       int      `json:"id"`
	Title    string   `json:"title"`
	Stage    string   `json:"stage"`
	Class    string   `json:"class,omitempty"` // tarea (default) | proyecto — ver store.Effort.Clase
	Archived bool     `json:"archived"`
	Jira     []string `json:"jira,omitempty"`
	Nodes    []string `json:"canon,omitempty"`
	// OldNodes es el `context_nodes:` de antes del 2026-09-21. No se usa para nada salvo para
	// poder FALLAR nombrándolo: un campo que se ignora en silencio se lee como un campo vacío.
	OldNodes []string `json:"-"`
	File     string   `json:"file"`
}

// DocumentJSON es la proyección tipada de una tarea. El Markdown sigue siendo la fuente de verdad:
// esta forma se deriva al pedirla, así que Jev, workers o un script reciben estructura sin crear un
// sidecar que pueda quedar viejo.
type DocumentJSON struct {
	SchemaVersion string          `json:"schemaVersion"`
	Task          Task            `json:"task"`
	State         StateJSON       `json:"state"`
	Work          WorkJSON        `json:"work"`
	Sections      []string        `json:"sections"`
	Publication   PublicationJSON `json:"publication"`
}

type StateJSON struct {
	Resume   string `json:"resume"`
	NextStep string `json:"nextStep"`
}

type CountsJSON struct {
	OpenPending   int `json:"openPending"`
	ClosedPending int `json:"closedPending"`
	Measurements  int `json:"measurements"`
	Decisions     int `json:"decisions"`
	Questions     int `json:"questions"`
	Risks         int `json:"risks"`
}

type WorkJSON struct {
	Counts      CountsJSON          `json:"counts"`
	Pending     []store.PendingItem `json:"pending"`
	Annotations []store.Annotation  `json:"annotations"`
}

type PublicationJSON struct {
	Available    bool                `json:"available"`
	ReadyForJira bool                `json:"readyForJira"`
	HasQA        bool                `json:"hasQA"`
	Bytes        int                 `json:"bytes"`
	Violations   []map[string]string `json:"violations"`
	Draft        string              `json:"draft,omitempty"`
}

// Las tareas LOCALES son contenedores permanentes, no un backlog paralelo a Jira. Una mejora de una
// herramienta vuelve a su único archivo; lo transversal o todavía sin destino vive en playground.
// La lista se valida en el CLI y en el lint por archivo para que la limpieza no dependa de memoria.
var canonicalLocals = map[string]bool{
	"canon": true, "context": true, "harness": true, "playground": true,
	"tablero": true, "trazador": true, "workers": true,
}

func localProblem(t Task) string {
	canonical := canonicalLocals[t.Slug]
	if len(t.Jira) == 0 && !canonical {
		return "las tareas locales sólo pueden ser canon, context, harness, playground, tablero, trazador o workers; agregá el frente al contenedor correspondiente"
	}
	if canonical && len(t.Jira) > 0 {
		return "un contenedor local canónico no puede vincularse a Jira; el trabajo publicado necesita su propia tarea"
	}
	if canonical && t.Class != "proyecto" {
		return "un contenedor local canónico debe declarar `clase: proyecto`"
	}
	return ""
}

var (
	reList     = regexp.MustCompile(`\[(.*?)\]`)
	reCitation = regexp.MustCompile(`^["']|["']$`)
	rePublic   = regexp.MustCompile(`(?m)^##\s+Tarea \(publicable\)\s*$`)
	reH2       = regexp.MustCompile(`(?m)^##\s+(.+?)\s*$`)
	// La mitad de QA de lo publicable. Los nombres NO son inventados: son los que ya usan las tareas
	// que la tienen bien (Ábaco, card de renting, codeudor, KYC del segundo apellido). Se buscan los
	// tres, y basta uno — imponer la plantilla completa haría fallar a una tarea chica que con «Cómo
	// validar» ya deja a QA sin preguntas.
	reQA = regexp.MustCompile(`(?im)^#{2,4}\s*(C[óo]mo validar|D[óo]nde probar|Criterios de aceptaci[óo]n|C[óo]mo se prueba)`)
)

func separateBody(body string) (private, publishable string) {
	if loc := rePublic.FindStringIndex(body); loc != nil {
		return strings.TrimSpace(body[:loc[0]]), strings.TrimSpace(body[loc[1]:])
	}
	return strings.TrimSpace(body), ""
}

func sectionTitles(body string) []string {
	out := []string{}
	for _, m := range reH2.FindAllStringSubmatch(body, -1) {
		out = append(out, strings.TrimSpace(m[1]))
	}
	return out
}

func documentJSON(t Task, body string, includeDraft bool) DocumentJSON {
	private, publishable := separateBody(body)
	pending := store.Pending(private)
	annotations := store.Annotations(private)
	counts := CountsJSON{}
	for _, p := range pending {
		if p.Done {
			counts.ClosedPending++
		} else {
			counts.OpenPending++
		}
	}
	for _, a := range annotations {
		switch a.Kind {
		case "medicion":
			counts.Measurements++
		case "decision":
			counts.Decisions++
		case "pregunta":
			counts.Questions++
		case "riesgo":
			counts.Risks++
		}
	}
	violations := []map[string]string{}
	if publishable != "" {
		if found := guard.Violations(publishable); found != nil {
			violations = found
		}
	}
	hasQA := publishable != "" && reQA.MatchString(publishable)
	doc := DocumentJSON{
		SchemaVersion: "tablero.task.v2",
		Task:          t,
		State: StateJSON{
			Resume:   store.Resume(private),
			NextStep: store.NextStep(private),
		},
		Work: WorkJSON{
			Counts:      counts,
			Pending:     pending,
			Annotations: annotations,
		},
		Sections: sectionTitles(private),
		Publication: PublicationJSON{
			Available:    publishable != "",
			ReadyForJira: publishable != "" && len(violations) == 0 && hasQA,
			HasQA:        hasQA,
			Bytes:        len(publishable),
			Violations:   violations,
		},
	}
	if includeDraft {
		doc.Publication.Draft = publishable
	}
	return doc
}

func value(line string) string {
	_, v, _ := strings.Cut(line, ":")
	return reCitation.ReplaceAllString(strings.TrimSpace(v), "")
}

func list(line string) []string {
	m := reList.FindStringSubmatch(line)
	if m == nil || strings.TrimSpace(m[1]) == "" {
		return nil
	}
	var out []string
	for _, x := range strings.Split(m[1], ",") {
		if x = reCitation.ReplaceAllString(strings.TrimSpace(x), ""); x != "" {
			out = append(out, x)
		}
	}
	return out
}

// taskSlug: el slug de una tarea es su carpeta (`tasks/<slug>/task.md`). Un `.md` suelto que se pase
// a `-lint` o `-guard` —un borrador, por ejemplo— se nombra por su archivo.
func taskSlug(path string) string {
	if filepath.Base(path) == layout.TaskFile {
		return layout.SlugOf(path)
	}
	return strings.TrimSuffix(filepath.Base(path), ".md")
}

// readTaskFile saca el frontmatter. No parsea YAML de verdad a propósito: el frontmatter de una tarea es
// plano y conocido, y meter una dependencia para cinco claves sería pagar de más.
func readTaskFile(path string) (Task, string, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return Task{}, "", err
	}
	body := string(b)
	t := Task{Slug: taskSlug(path), File: path}
	parts := strings.SplitN(body, "---", 3)
	if len(parts) < 3 {
		return t, body, nil // sin frontmatter: se devuelve igual, con lo que se sepa
	}
	for _, l := range strings.Split(parts[1], "\n") {
		switch {
		case strings.HasPrefix(l, "id:"):
			t.ID, _ = strconv.Atoi(value(l))
		case strings.HasPrefix(l, "title:"):
			t.Title = value(l)
		case strings.HasPrefix(l, "stage:"):
			t.Stage = value(l)
		case strings.HasPrefix(l, "clase:"):
			t.Class = value(l)
		case strings.HasPrefix(l, "archived:"):
			// El valor es la FECHA de archivado (así lo escribe el tablero y así lo lee el store:
			// "" = viva). Acá decía `== "true"`, y como ningún archivo dice `true`, las 24 archivadas
			// contaban como abiertas: `make tareas` anunciaba 63 cuando eran 39 (2026-09-14).
			v := value(l)
			t.Archived = v != "" && v != "false" && v != "null"
		case strings.HasPrefix(l, "jira:"):
			t.Jira = list(l)
		case strings.HasPrefix(l, "canon:"):
			t.Nodes = list(l)
		case strings.HasPrefix(l, "context_nodes:"):
			// El campo se renombró el 2026-09-21, cuando el árbol de `context/` empezó a apagarse y su
			// contenido pasó a canon. Se sigue LEYENDO para poder decirlo: si se ignorara, una tarea
			// vieja perdería sus temas en silencio y el tablero mostraría «no declara ninguno», que es
			// indistinguible de una tarea que de verdad no declara nada.
			t.OldNodes = list(l)
		}
	}
	return t, parts[2], nil
}

// showLint es la validación de UN archivo de tarea al escribirlo (la corre el hook de PostToolUse).
// Existe porque nada de esto fallaba en ningún lado: una etapa inventada no cae en ninguna columna,
// un id repetido hace que una tarea pise a la otra en el store, y un nodo de context mal escrito manda
// a leer una carpeta que no existe. Las tres pasaron (27/8 y 14/9). Sale 1 con la lista; 0 en silencio.
func showLint(path string) int {
	t, body, err := readTaskFile(path)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 2
	}
	var failures, warnings []string
	failure := func(f string, a ...any) { failures = append(failures, fmt.Sprintf(f, a...)) }
	// Un AVISO se imprime pero no hace fallar: es algo que hay que mirar, no algo que esté roto. Existe
	// por el caso de marcar una tarea como proyecto — su publicable queda ahí hasta que alguien la lea,
	// y forzar el borrado en ese instante haría perder texto que quizá sirva para otra cosa.
	warns := func(f string, a ...any) { warnings = append(warnings, fmt.Sprintf(f, a...)) }

	b, _ := os.ReadFile(path)
	if !strings.HasPrefix(string(b), "---\n") {
		failure("no tiene frontmatter: el archivo tiene que empezar con `---`")
	}
	if t.Title == "" {
		failure("`title` vacío: es el nombre compartido con Jira")
	}
	if t.Class != "" && t.Class != "tarea" && t.Class != "proyecto" {
		failure("clase «%s» no existe: `tarea` (ligada a Jira) o `proyecto` (contenedor local canónico)", t.Class)
	}
	if problem := localProblem(t); problem != "" {
		failure("organización local: %s", problem)
	}
	// Un PROYECTO no se comparte: si trae sección publicable, alguien la va a leer como si fuera para el
	// equipo. Es aviso y no error del guard, porque el texto en sí puede estar perfecto — lo que está
	// mal es que exista.
	if t.Class == "proyecto" && rePublic.MatchString(body) {
		warns("es `clase: proyecto` y conserva `## Tarea (publicable)`: un contenedor local no sale a Jira. Revisala o borrala")
	}
	if !validStage(t.Stage) {
		failure("etapa «%s» no existe (evaluation · work · tasks). Si la tarea terminó, va `archived: \"<fecha ISO>\"`, no otra etapa", t.Stage)
	}
	fm := frontmatter(string(b))
	if v, ok := fm["archived"]; ok && (v == "true" || v == "false" || v == "null" || v == "") {
		failure("`archived: %s` no vale: el valor es la FECHA de archivado (ISO-8601), o la línea no va", v)
	}
	if v, ok := fm["archived"]; ok && v != "" && !reDate.MatchString(v) {
		failure("`archived: %s` no parece una fecha ISO-8601 (ej. 2026-09-14T18:00:00-05:00)", v)
	}
	if v, ok := fm["created"]; !ok || v == "" {
		failure("falta `created` (ISO-8601 con offset)")
	} else if !reDate.MatchString(v) {
		failure("`created: %s` no parece una fecha ISO-8601", v)
	}
	for _, l := range strings.Split(strings.SplitN(string(b), "---", 3)[1], "\n") {
		if i := strings.Index(l, " #"); i > 0 {
			failure("el frontmatter no admite comentarios en la línea (%q): el parser los deja DENTRO del valor", strings.TrimSpace(l))
		}
	}
	// id único: el store indexa por id y dos archivos con el mismo número se pisan
	ts, _ := all()
	for _, o := range ts {
		if o.ID == t.ID && o.Slug != t.Slug && t.ID != 0 {
			failure("id %d repetido con %s — en el tablero sobrevive uno solo. El siguiente libre es %d", t.ID, o.Slug, maxID(ts)+1)
		}
	}
	// Las referencias se validan contra la API que Canon sirve desde Postgres. Si la API no responde,
	// no se bloquea una edición local: se avisa claramente y se conserva la misma degradación segura
	// que había cuando el corpus compartido no estaba clonado en esta máquina.
	if len(t.OldNodes) > 0 {
		failure("`context_nodes:` se renombró a `canon:` — usá temas o referencias de Canon (esta tarea todavía dice: %s)", strings.Join(t.OldNodes, ", "))
	}
	if len(t.Nodes) > 0 {
		ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		references, err := canon.FromEnv().References(ctx, t.Nodes)
		cancel()
		if err != nil {
			fmt.Fprintf(os.Stderr, "  ⚠ no validé `canon:` — Canon no respondió en %s (%v)\n", canon.URL(), err)
		} else {
			for _, reference := range references {
				if reference.Error != "" {
					failure("canon: la referencia «%s» no existe o no es válida (%s)", reference.Requested, reference.Error)
				}
			}
		}
	}
	// la publicable pasa el guard: es lo único que sale a Jira
	if loc := rePublic.FindStringIndex(body); loc != nil {
		for _, v := range guard.Violations(body[loc[1]:]) {
			failure("la publicable no pasa el guard (%s): %q", v["what"], v["found"])
		}
	}
	for _, a := range warnings {
		fmt.Fprintf(os.Stderr, "tarea %s ⚠ %s\n", filepath.Base(path), a)
	}
	if len(failures) == 0 {
		return 0
	}
	fmt.Fprintf(os.Stderr, "tarea %s: %d problema(s)\n", taskSlug(path), len(failures))
	for _, f := range failures {
		fmt.Fprintf(os.Stderr, "  ✗ %s\n", f)
	}
	return 1
}

var reDate = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?([+-]\d{2}:\d{2}|Z)?)?$`)

func frontmatter(text string) map[string]string {
	out := map[string]string{}
	parts := strings.SplitN(text, "---", 3)
	if len(parts) < 3 {
		return out
	}
	for _, l := range strings.Split(parts[1], "\n") {
		if k, _, ok := strings.Cut(l, ":"); ok && strings.TrimSpace(k) != "" && !strings.HasPrefix(l, " ") {
			out[strings.TrimSpace(k)] = value(l)
		}
	}
	return out
}

func maxID(ts []Task) int {
	m := 0
	for _, t := range ts {
		if t.ID > m {
			m = t.ID
		}
	}
	return m
}

// warnings son las inconsistencias del frontmatter que el tablero NO corrige solo y que, sin decirse,
// mienten: un id repetido hace que una tarea pise a la otra en el store, y una etapa fuera del
// vocabulario no cae en ninguna columna. Se imprimen arriba de la lista, no como error: la lista
// sigue sirviendo, pero hay que arreglar el archivo.
func warnings(ts []Task) []string {
	var out []string
	byID := map[int][]string{}
	for _, t := range ts {
		byID[t.ID] = append(byID[t.ID], t.Slug)
		if problem := localProblem(t); problem != "" {
			out = append(out, fmt.Sprintf("#%d %s: %s", t.ID, t.Slug, problem))
		}
		if !t.Archived && !validStage(t.Stage) {
			out = append(out, fmt.Sprintf("#%d %s: etapa «%s» no existe (evaluation · work · tasks). "+
				"Si está terminada, va `archived:` con fecha", t.ID, t.Slug, t.Stage))
		}
	}
	ids := make([]int, 0, len(byID))
	for id := range byID {
		ids = append(ids, id)
	}
	sort.Ints(ids)
	for _, id := range ids {
		if len(byID[id]) > 1 {
			out = append(out, fmt.Sprintf("id %d repetido: %s — en el tablero sobrevive uno solo",
				id, strings.Join(byID[id], ", ")))
		}
	}
	return out
}

func validStage(s string) bool {
	return s == "evaluation" || s == "work" || s == "tasks" || s == ""
}

// dataDir: la carpeta `data/` (lo operativo). Ver el paquete layout, que sabe desde dónde se corre.
func dataDir() string { return layout.Find().Data }

func all() ([]Task, error) {
	paths, err := layout.Find().TaskPaths()
	if err != nil {
		return nil, err
	}
	var out []Task
	for _, r := range paths {
		t, _, err := readTaskFile(r)
		if err == nil {
			out = append(out, t)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID > out[j].ID })
	return out, nil
}

// showGuard es el único modo que puede salir con código 1: se usa para DECIDIR antes de publicar, así
// que tiene que poder frenar un pipeline, no sólo informar.
func showGuard(path string, asJSON bool) int {
	b, err := os.ReadFile(path)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 2
	}
	// Se mide LO QUE SALE, no el archivo entero. Si el archivo tiene su sección publicable, el guard va
	// sobre ESA: lo de arriba es privado y puede —debe— nombrar repos, rutas y F-xx.
	//
	// Medirlo todo daba falsos positivos con razón de sobra para ignorarlos: el 2026-08-20 marcó un
	// comentario HTML del Registro, que es privado y está bien que exista. Un guard que se equivoca en lo
	// legítimo entrena a saltear el que acierta.
	text := string(b)
	scope := "el archivo entero (no tiene sección publicable)"
	if loc := rePublic.FindStringIndex(text); loc != nil {
		text = strings.TrimSpace(text[loc[1]:])
		scope = "la sección `## Tarea (publicable)`"
	}

	v := guard.Violations(text)
	if asJSON {
		_ = json.NewEncoder(os.Stdout).Encode(map[string]any{
			"file": path, "scope": scope, "violations": v})
	} else if len(v) == 0 {
		fmt.Printf("  ✓ %s puede salir a Jira: %s no matchea ningún patrón prohibido\n", path, scope)
	} else {
		fmt.Printf("  (medido sobre %s)\n", scope)
		fmt.Printf("  ✗ %s NO puede salir — %d violación(es):\n", path, len(v))
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

func showOne(ref string, asJSON, includeContent bool) int {
	ts, _ := all()
	var chosen *Task
	for i, t := range ts {
		if t.Slug == ref || strconv.Itoa(t.ID) == ref || strings.Contains(strings.ToLower(t.Slug), strings.ToLower(ref)) {
			chosen = &ts[i]
			break
		}
	}
	if chosen == nil {
		fmt.Fprintf(os.Stderr, "no encontré una tarea que matchee %q. Corré sin -n para ver la lista.\n", ref)
		return 2
	}
	_, body, _ := readTaskFile(chosen.File)
	// La frontera del repo hecha visible: lo de arriba de `## Tarea (publicable)` es PRIVADO y puede
	// nombrar repos, rutas y F-xx; lo de abajo es lo único que sale. Mostrarlas mezcladas es cómo se
	// publica sin querer algo que no debía salir.
	public := ""
	if loc := rePublic.FindStringIndex(body); loc != nil {
		public = strings.TrimSpace(body[loc[1]:])
	}
	if asJSON {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		_ = enc.Encode(documentJSON(*chosen, body, includeContent))
		return 0
	}
	fmt.Printf("\n  #%d  %s\n  %s · %s%s\n", chosen.ID, chosen.Title, chosen.Slug, chosen.Stage,
		map[bool]string{true: " · ARCHIVADA"}[chosen.Archived])
	if len(chosen.Jira) > 0 {
		fmt.Printf("  jira: %s\n", strings.Join(chosen.Jira, ", "))
	}
	if len(chosen.Nodes) > 0 {
		fmt.Printf("  nodos de context: %s\n", strings.Join(chosen.Nodes, ", "))
	}
	fmt.Printf("\n  archivo: %s\n", chosen.File)
	if public == "" {
		fmt.Println("\n  ⚠ no tiene sección `## Tarea (publicable)`: no hay nada que se pueda mandar a Jira.")
	} else {
		fmt.Printf("\n  ── PUBLICABLE (%d chars, lo único que sale a Jira) ──\n", len(public))
		v := guard.Violations(public)
		if len(v) == 0 {
			fmt.Println("  ✓ pasa el guard")
		} else {
			fmt.Printf("  ✗ NO pasa el guard: %d violación(es) — corré -guard para el detalle\n", len(v))
		}
		// La OTRA mitad de lo publicable, que el guard no puede ver: la receta de prueba. El guard
		// contesta "¿esto puede salir?"; esto contesta "¿alcanza para que QA lo pruebe sin preguntar?".
		// Medido el 2026-08-19 sobre las 16 tareas de los últimos 4 sprints: ninguna publicable la tenía,
		// y los archivos que sí explican cómo probar lo hacen en el cuerpo PRIVADO, donde QA no entra.
		if !reQA.MatchString(public) {
			fmt.Println("  ⚠ le falta la mitad de QA (`## Cómo validar` / `## Dónde probar` /")
			fmt.Println("    `## Criterios de aceptación`): así QA tiene que preguntar cómo verificarlo")
		}
	}
	fmt.Println("\n  (el cuerpo entero es PRIVADO: leelo del archivo, puede nombrar repos, rutas y F-xx)")
	return 0
}

// showSprint lee el SNAPSHOT de Jira que alimenta la UI (`data/cache/jira.json`).
//
// ⚠ Es una foto, no el estado vivo: cada fila trae su `seen_at` y acá se imprime, porque un tablero
// de sprint presentado como actual siendo de hace días es peor que no tenerlo — se decide sobre él.
// Para el dato fresco hay que pasar por Jira (el server al refrescar, o los `jira-*` del Makefile).
func showSprint(asJSON bool) int {
	b, err := os.ReadFile(filepath.Join(dataDir(), "cache", "jira.json"))
	if err != nil {
		fmt.Fprintln(os.Stderr, "no hay snapshot de Jira todavía:", err)
		return 2
	}
	var d struct {
		Sprints []struct {
			ID     int    `json:"id"`
			Name   string `json:"name"`
			State  string `json:"state"`
			SeenAt string `json:"seen_at"`
		} `json:"sprints"`
		Tasks []struct {
			Key      string   `json:"key"`
			Summary  string   `json:"summary"`
			Status   string   `json:"status"`
			Category string   `json:"category"`
			Points   *float64 `json:"points"`
			SprintID int      `json:"sprint_id"`
			SeenAt   string   `json:"seen_at"`
		} `json:"tasks"`
	}
	if err := json.Unmarshal(b, &d); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 2
	}
	active, name, seen := 0, "", ""
	for _, s := range d.Sprints {
		if s.State == "active" {
			active, name, seen = s.ID, s.Name, s.SeenAt
		}
	}
	var inSprint []int
	for i, t := range d.Tasks {
		if t.SprintID == active {
			inSprint = append(inSprint, i)
		}
	}
	if asJSON {
		_ = json.NewEncoder(os.Stdout).Encode(map[string]any{"sprint": name, "sprint_id": active,
			"seen_at": seen, "tasks": d.Tasks})
		return 0
	}
	if active == 0 {
		fmt.Println("\n  no hay sprint activo en el snapshot")
		return 0
	}
	fmt.Printf("\n  %s  (#%d)\n  ⚠ SNAPSHOT tomado %s — no es el estado vivo de Jira\n\n", name, active, seen)
	points := 0.0
	for _, i := range inSprint {
		t := d.Tasks[i]
		p := ""
		if t.Points != nil {
			p = fmt.Sprintf("%.0f pt", *t.Points)
			points += *t.Points
		}
		fmt.Printf("  %-10s %-6s %-22s %s\n", t.Key, p, t.Status, t.Summary)
	}
	fmt.Printf("\n  %d tarea(s) · %.0f puntos\n", len(inSprint), points)
	return 0
}

// showWorklog lee `data/entries/*.jsonl` — el tiempo registrado, que es dato PERSONAL y está fuera
// de git a propósito. Se agrupa por día porque la pregunta real es «¿en qué se fue el día?», no el
// listado de asientos.
func showWorklog(days int, asJSON bool) int {
	paths, _ := filepath.Glob(filepath.Join(dataDir(), "entries", "*.jsonl"))
	type entry struct {
		Day       string `json:"day"`
		TaskKey   string `json:"taskKey"`
		FreeTitle string `json:"freeTitle"`
		Minutes   int    `json:"minutes"`
		Note      string `json:"note"`
		Kind      string `json:"kind"`
	}
	var all []entry
	for _, r := range paths {
		b, err := os.ReadFile(r)
		if err != nil {
			continue
		}
		for _, l := range strings.Split(string(b), "\n") {
			if strings.TrimSpace(l) == "" {
				continue
			}
			var e entry
			if json.Unmarshal([]byte(l), &e) == nil {
				all = append(all, e)
			}
		}
	}
	sort.Slice(all, func(i, j int) bool { return all[i].Day > all[j].Day })
	byDay := map[string][]entry{}
	var order []string
	for _, e := range all {
		if _, ok := byDay[e.Day]; !ok {
			order = append(order, e.Day)
		}
		byDay[e.Day] = append(byDay[e.Day], e)
	}
	if days > 0 && len(order) > days {
		order = order[:days]
	}
	if asJSON {
		_ = json.NewEncoder(os.Stdout).Encode(all)
		return 0
	}
	fmt.Printf("\n  bitácora · %d asiento(s) en %d día(s)\n", len(all), len(byDay))
	for _, d := range order {
		tot := 0
		for _, e := range byDay[d] {
			tot += e.Minutes
		}
		fmt.Printf("\n  %s — %dh %02dm\n", d, tot/60, tot%60)
		for _, e := range byDay[d] {
			qué := e.TaskKey
			if qué == "" {
				qué = e.FreeTitle
			}
			// La nota se RECORTA acá y no en el dato: son párrafos enteros —el registro de esfuerzo
			// se escribe en prosa— y sin recortar la vista es ilegible. `-json` la devuelve completa,
			// que es la forma en que la quiere un modelo.
			// ⚠ Se corta por RUNAS, no por bytes. `n[:96]` parte un carácter multibyte por la mitad
			// y saca un `�` — y en español pasa casi siempre, porque las tildes y la ñ son de
			// dos bytes. Un recorte que rompe el texto que venía a hacer legible.
			r := []rune(strings.Join(strings.Fields(e.Note), " "))
			n := string(r)
			if len(r) > 96 {
				n = string(r[:96]) + "…"
			}
			fmt.Printf("      %3dm  %-34.34s  %s\n", e.Minutes, qué, n)
		}
	}
	return 0
}

func main() {
	var (
		single  = flag.String("n", "", "una tarea, por slug o por id (acepta subcadena del slug)")
		save    = flag.String("guard", "", "¿el texto de este archivo puede salir a Jira? sale 1 si no")
		lint    = flag.String("lint", "", "¿este archivo de tarea está bien formado? frontmatter, id único, etapa, nodos y guard de la publicable. Sale 1 si no")
		stage   = flag.String("stage", "", "filtrar por etapa (p. ej. work)")
		withAll = flag.Bool("todas", false, "incluir las archivadas")
		sprint  = flag.Bool("sprint", false, "el sprint activo, del snapshot de Jira (dice cuándo se tomó)")
		worklog = flag.Int("bitacora", 0, "el tiempo registrado, agrupado por día: cuántos días mirar")
		asJSON  = flag.Bool("json", false, "salida en JSON")
		content = flag.Bool("contenido", false, "con -n -json, incluir también el borrador publicable")
	)
	flag.Parse()
	env.LoadDefaults()

	if *save != "" {
		os.Exit(showGuard(*save, *asJSON))
	}
	if *lint != "" {
		os.Exit(showLint(*lint))
	}
	if *sprint {
		os.Exit(showSprint(*asJSON))
	}
	if *worklog > 0 {
		os.Exit(showWorklog(*worklog, *asJSON))
	}
	if *single != "" {
		os.Exit(showOne(*single, *asJSON, *content))
	}

	ts, err := all()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}
	var vis []Task
	for _, t := range ts {
		if !*withAll && t.Archived {
			continue
		}
		if *stage != "" && t.Stage != *stage {
			continue
		}
		vis = append(vis, t)
	}
	if *asJSON {
		_ = json.NewEncoder(os.Stdout).Encode(vis)
		return
	}
	fmt.Printf("\n  %d tarea(s)%s · de %d en total\n\n", len(vis),
		map[bool]string{true: "", false: " abiertas"}[*withAll], len(ts))
	for _, notice := range warnings(ts) {
		fmt.Printf("  ⚠ %s\n", notice)
	}
	for _, t := range vis {
		j := ""
		if len(t.Jira) > 0 {
			j = "  " + strings.Join(t.Jira, ",")
		}
		class := ""
		if t.Class == "proyecto" {
			class = " ·proyecto"
		}
		fmt.Printf("  #%-3d %-10s%s %s%s\n", t.ID, t.Stage, class, t.Title, j)
		fmt.Printf("       %s\n", t.Slug)
	}
	fmt.Println("\n  -n <slug|id> para una · -guard <archivo> antes de publicar · -json para encadenar")
}
