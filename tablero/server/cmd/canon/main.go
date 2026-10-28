// canon lee y dicta canon, el corpus compartido de CreditOp, en un comando (`make canon-*`).
//
//	search "<palabras del negocio>"      qué sección y qué área lo cubren (gratis, sin modelo)
//	map                                  los temas por etapa del crédito, con título y resumen
//	read <id>[,<id>…]                    secciones completas: `cuota/context#<ancla>` o el tema entero
//	propose <pieza.json>                 dónde iría y qué le rechaza el lint. NO escribe
//	write <pieza.json>… [-title T]       borrador → piezas → cierre: UNA revisión. ESCRIBE
//	write -dry <pieza.json>…             el mismo recorrido SIN el cierre: dice qué haría canon con cada pieza y abandona el borrador
//	export -out <carpeta>                el corpus de canon, tal como está hoy, para editar archivos enteros (map.json…)
//	round [-force]                       qué archivos que el corpus declara cambiaron en main (contra los clones del servidor)
//	clones [-sync] [-repo R]             a qué commit de main está el clon de cada repo en el servidor; -sync le pide que los refresque
//	patch -dir <carpeta> -reason R       publica los archivos que cambiaste en esa carpeta. Sin -apply sólo ensaya y muestra el diff
//	corpus                               el corpus entero en JSON, para los cruces de `tools/canon.py`
//	eval [-days N] [-target T] [-json]   organización del corpus y código que se mueve sin área (ver eval.go)
//
// El origen es CANON_URL —producción por defecto, que pide la VPN de prod—, el mismo del tablero. La
// pieza es un JSON con las claves del borrador de canon; `text_file` en vez de `text` lee la prosa de
// un archivo relativo a la pieza. Qué entra y cómo: `.claude/skills/canon/SKILL.md` en la raíz.
package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"creditop/playground/connectors/canon"
)

func main() {
	if len(os.Args) < 2 {
		usage()
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	client := canon.FromEnv()
	args := os.Args[2:]

	var err error
	switch os.Args[1] {
	case "search":
		err = search(ctx, client, strings.Join(args, " "))
	case "read":
		err = read(ctx, client, args)
	case "route":
		if len(args) != 1 {
			err = fmt.Errorf("indica tema/variante#paso")
			break
		}
		var view canon.RouteView
		view, err = client.Route(ctx, args[0])
		if err == nil {
			err = json.NewEncoder(os.Stdout).Encode(view)
		}
	case "propose":
		err = propose(ctx, client, args)
	case "write":
		err = write(ctx, client, args)
	case "export":
		err = exportCorpus(ctx, client, args)
	case "patch":
		err = patch(ctx, client, args)
	case "clones":
		err = clones(ctx, client, args)
	case "round":
		err = round(ctx, client, args)
	case "corpus":
		err = corpus(ctx, client)
	case "map":
		err = topicMap(ctx, client)
	case "eval":
		err = evaluate(ctx, client, args)
	default:
		usage()
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "✗", err)
		os.Exit(1)
	}
}

func usage() {
	fmt.Fprintln(os.Stderr, "uso: canon search|read|route|map|propose|write|export|patch|clones|round|eval …  (ver `make canon-search` y sus vecinos)")
	os.Exit(2)
}

func search(ctx context.Context, client *canon.Client, query string) error {
	if strings.TrimSpace(query) == "" {
		return fmt.Errorf("falta qué buscar: palabras del negocio, en español y cortas")
	}
	found, err := client.Search(ctx, query)
	if err != nil {
		return err
	}
	fmt.Printf("  prosa (%s):\n", canon.URL())
	for i, hit := range found.Prose {
		if i == 6 {
			break
		}
		fmt.Printf("    %s#%s  ·  %s\n", hit.Node, hit.Anchor, hit.Section)
	}
	fmt.Println("  mapa (dónde vive en el código):")
	briefs := map[string]canon.Brief{}
	for i, hit := range found.Map {
		if i == 4 {
			break
		}
		fmt.Printf("    %s  ·  %s\n", hit.Cite, clip(hit.Goal, 110))
		// Un área encontrada por un archivo o una clase no sirve sola: lo que se lee son sus secciones.
		if sections := areaSections(ctx, client, hit.Cite, briefs); len(sections) > 0 {
			fmt.Printf("      → %s\n", strings.Join(sections, " · "))
		}
	}
	if found.Uncovered != nil {
		if text, _ := json.Marshal(found.Uncovered); len(text) > 4 {
			fmt.Printf("  ⚠ sin cubrir: %s\n", text)
		}
	}
	switch {
	case len(found.Prose) == 0 && len(found.Map) == 0:
		fmt.Println("  ⚠ nada: probá otras palabras; si sigue vacío, canon no lo tiene (no es lo mismo que «no existe»)")
	case len(found.Prose) == 0:
		fmt.Println("  ⚠ ninguna sección nombra esas palabras, pero el código sí está en el mapa: leé las secciones de esas áreas")
	}
	fmt.Println("  → leer: make canon-read IDS='<tema/capa#ancla>'")
	return nil
}

/* areaSections traduce la cita de un área (`tema/capa#n=8`, la posición del área en el mapa del tema) a las secciones
 * que la explican, como ids listos para `canon-read`. Lee el mapa de cada tema una sola vez por búsqueda; si la cita
 * no tiene esa forma o el tema no se puede leer, no muestra nada en vez de fallar la búsqueda. */
func areaSections(ctx context.Context, client *canon.Client, cite string, briefs map[string]canon.Brief) []string {
	node, index, ok := parseAreaCite(cite)
	if !ok {
		return nil
	}
	brief, seen := briefs[node]
	if !seen {
		var err error
		if brief, err = client.Brief(ctx, node); err != nil {
			return nil
		}
		briefs[node] = brief
	}
	if index >= len(brief.Areas) {
		return nil
	}
	var out []string
	for i, anchor := range brief.Areas[index].Sections {
		if i == 3 {
			out = append(out, fmt.Sprintf("(+%d)", len(brief.Areas[index].Sections)-3))
			break
		}
		out = append(out, node+"#"+anchor)
	}
	return out
}

// parseAreaCite separa `tema/capa#n=8` en el tema y la posición del área.
func parseAreaCite(cite string) (string, int, bool) {
	node, rest, found := strings.Cut(cite, "#n=")
	if !found || node == "" {
		return "", 0, false
	}
	var index int
	if _, err := fmt.Sscanf(rest, "%d", &index); err != nil || index < 0 {
		return "", 0, false
	}
	return node, index, true
}

func read(ctx context.Context, client *canon.Client, args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("falta IDS: `cuota/context#<ancla>`, varias por coma, o el tema")
	}
	text, err := client.Markdown(ctx, args[0])
	if err != nil {
		return err
	}
	fmt.Print(text)
	return nil
}

func propose(ctx context.Context, client *canon.Client, args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("falta la pieza (.json)")
	}
	piece, err := loadPiece(args[0])
	if err != nil {
		return err
	}
	result, err := client.Propose(ctx, piece)
	if err != nil {
		return err
	}
	lint := "sin objeciones"
	if result.Lint != nil {
		text, _ := json.Marshal(result.Lint)
		lint = string(text)
	}
	fmt.Printf("  ready: %v  ·  lint: %s\n", result.Ready, lint)
	if result.Missing != nil {
		text, _ := json.Marshal(result.Missing)
		fmt.Printf("  le falta: %s\n", text)
	}
	for i, where := range result.Where {
		if i == 3 {
			break
		}
		fmt.Printf("    podría ir cerca de: %s\n", where.Read)
	}
	return nil
}

func write(ctx context.Context, client *canon.Client, args []string) error {
	flags := flag.NewFlagSet("write", flag.ExitOnError)
	title := flags.String("title", "canon: dictado desde el playground", "el título de la revisión")
	author := flags.String("author", envOr("CANON_AUTHOR", "Miguel Ochoa"), "quién firma la revisión")
	dry := flags.Bool("dry", false, "ensayar: manda las piezas al borrador y lo abandona, sin cerrar")
	_ = flags.Parse(args)
	if flags.NArg() == 0 {
		return fmt.Errorf("falta al menos una pieza (.json)")
	}
	var pieces []canon.Piece
	for _, path := range flags.Args() {
		piece, err := loadPiece(path)
		if err != nil {
			return err
		}
		pieces = append(pieces, piece)
	}
	var written canon.Written
	var err error
	if *dry {
		written, err = client.DryWrite(ctx, *author, pieces)
	} else {
		written, err = client.Write(ctx, *author, *title, pieces)
	}
	for i, result := range written.Pieces {
		fmt.Printf("  ✓ %v · «%v»: %s\n", pieces[i]["node"], pieces[i]["section"], result.Operation)
		if result.Reread > 0 {
			fmt.Printf("    releería %d archivos\n", result.Reread)
		}
		if result.Retired != nil {
			if text, _ := json.Marshal(result.Retired); len(text) > 4 {
				fmt.Printf("    retiraría los que ya no están en main: %s\n", text)
			}
		}
		for note, text := range result.Notes {
			fmt.Printf("    ⚠ %s: %s\n", note, clip(text, 220))
		}
	}
	if err != nil {
		return err
	}
	if written.Dry {
		fmt.Println("  (ensayo: el borrador se abandonó, no se escribió nada)")
		return nil
	}
	fmt.Printf("  ✓ revisión %d en %s\n", written.Revision, canon.URL())
	if written.Unlinked != nil {
		if text, _ := json.Marshal(written.Unlinked); len(text) > 4 {
			fmt.Printf("    ⚠ sin enlazar: %s\n", text)
		}
	}
	return nil
}

// round: la ronda del servidor. Sale 1 si algo cambió, para poder usarla en un chequeo.
func round(ctx context.Context, client *canon.Client, args []string) error {
	flags := flag.NewFlagSet("round", flag.ExitOnError)
	force := flags.Bool("force", false, "volver a medir en vez de servir el caché de diez minutos del servidor")
	_ = flags.Parse(args)
	result, err := client.Round(ctx, *force)
	if err != nil {
		return err
	}
	if len(result.Changes) == 0 {
		fmt.Printf("  ronda al día: %d archivos declarados, ninguno cambió en main\n", result.Declared)
		return nil
	}
	fmt.Printf("  ronda: %d de %d archivos declarados cambiaron en main\n", len(result.Changes), result.Declared)
	for _, change := range result.Changes {
		fmt.Printf("    %-16s %s:%s  %s → %s\n", change.Topic, change.Repo, change.Path, change.Before, change.Now)
	}
	return fmt.Errorf("«cambió» no es «dejó de ser cierto»: se relee cada archivo antes de mover su hash")
}

/* clones dice a qué commit de main llega el clon que el servidor tiene de cada repo. La ronda del servidor compara
 * contra ESOS clones: si main avanzó después, no ve el cambio hasta que se refresquen. Con -sync se lo pide. */
func clones(ctx context.Context, client *canon.Client, args []string) error {
	flags := flag.NewFlagSet("clones", flag.ExitOnError)
	sync := flags.Bool("sync", false, "pedirle al servidor que refresque los clones")
	repo := flags.String("repo", "", "sólo ese repo (Creditop-SAS/<nombre>); sin esto, todos")
	_ = flags.Parse(args)
	if *sync {
		if err := client.SyncClones(ctx, *repo); err != nil {
			return err
		}
		fmt.Println("  ✓ el servidor empezó a refrescar los clones (corre allá: volvé a mirar en unos segundos)")
	}
	list, err := client.Clones(ctx)
	if err != nil {
		return err
	}
	for _, clone := range list {
		if *repo != "" && clone.Repo != *repo {
			continue
		}
		fmt.Printf("  %-46s %s  %s\n", clone.Repo, clone.Commit, clone.State)
	}
	return nil
}

// baseFile es de qué export parte una carpeta: canon rechaza el parche si el corpus ya cambió desde entonces.
const baseFile = ".canon-base.json"

type checkout struct {
	URL      string            `json:"url"`
	ETag     string            `json:"etag"`
	SHA256   string            `json:"sha256"`
	Exported string            `json:"exported"`
	Hashes   map[string]string `json:"hashes"` // ruta → sha256 del contenido tal como se bajó
}

func digest(text string) string {
	sum := sha256.Sum256([]byte(text))
	return hex.EncodeToString(sum[:])
}

/* exportCorpus baja el corpus de ESTE momento a una carpeta nueva y anota de qué revisión parte. Es el primer
 * paso para cambiar un archivo entero —un map.json con fuentes que ya no existen en main— con `patch`: editar
 * sobre un export viejo es pisar lo que otra persona acaba de dictar. */
func exportCorpus(ctx context.Context, client *canon.Client, args []string) error {
	flags := flag.NewFlagSet("export", flag.ExitOnError)
	out := flags.String("out", "", "carpeta nueva (o vacía) donde dejar el corpus")
	_ = flags.Parse(args)
	if *out == "" {
		return fmt.Errorf("falta -out <carpeta>")
	}
	if entries, err := os.ReadDir(*out); err == nil && len(entries) > 0 {
		return fmt.Errorf("%s ya tiene archivos: usá una carpeta nueva, o se pisarían ediciones sin publicar", *out)
	}
	export, _, _, err := client.Export(ctx, "")
	if err != nil {
		return err
	}
	if err := export.Verify(); err != nil {
		return err
	}
	base := checkout{URL: canon.URL(), ETag: export.ETag, SHA256: export.SHA256, Exported: export.ExportedAt, Hashes: map[string]string{}}
	for path, text := range export.Files {
		target := filepath.Join(*out, filepath.FromSlash(path))
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		if err := os.WriteFile(target, []byte(text), 0o644); err != nil {
			return err
		}
		base.Hashes[path] = digest(text)
	}
	encoded, err := json.MarshalIndent(base, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(*out, baseFile), encoded, 0o644); err != nil {
		return err
	}
	fmt.Printf("  ✓ %d archivos en %s (revisión del corpus %s…)\n", len(export.Files), *out, export.SHA256[:12])
	fmt.Println("  editá los que hagan falta y publicalos: make canon-patch DIR=" + *out + " REASON='…'")
	return nil
}

/* patch publica los archivos de la carpeta que cambiaron respecto de lo que se bajó (los que no se tocaron no
 * viajan: es una revisión parcial). Sin -apply canon valida el corpus resultante y devuelve el diff, pero no
 * guarda nada. Si el corpus cambió desde el export, canon lo rechaza (412): se vuelve a bajar y se rehace. */
func patch(ctx context.Context, client *canon.Client, args []string) error {
	flags := flag.NewFlagSet("patch", flag.ExitOnError)
	dir := flags.String("dir", "", "la carpeta que dejó `export`")
	reason := flags.String("reason", "", "por qué cambia: queda en la revisión")
	author := flags.String("author", envOr("CANON_AUTHOR", "Miguel Ochoa"), "quién firma la revisión")
	apply := flags.Bool("apply", false, "publicar de verdad; sin esto sólo se ensaya")
	_ = flags.Parse(args)
	if *dir == "" || strings.TrimSpace(*reason) == "" {
		return fmt.Errorf("faltan -dir <carpeta de export> y -reason '<por qué>'")
	}
	raw, err := os.ReadFile(filepath.Join(*dir, baseFile))
	if err != nil {
		return fmt.Errorf("%s no es una carpeta de `canon export` (falta %s): %w", *dir, baseFile, err)
	}
	var base checkout
	if err := json.Unmarshal(raw, &base); err != nil {
		return fmt.Errorf("%s ilegible: %w", baseFile, err)
	}
	if base.URL != canon.URL() {
		return fmt.Errorf("la carpeta se bajó de %s y CANON_URL apunta a %s: el parche iría a otro canon", base.URL, canon.URL())
	}
	files := map[string]*string{}
	for path, hash := range base.Hashes {
		data, err := os.ReadFile(filepath.Join(*dir, filepath.FromSlash(path)))
		switch {
		case os.IsNotExist(err):
			fmt.Printf("  ⚠ %s ya no está en la carpeta: borrar desde acá no se hace\n", path)
		case err != nil:
			return err
		case digest(string(data)) != hash:
			text := string(data)
			files[path] = &text
		}
	}
	if len(files) == 0 {
		fmt.Println("  nada cambió respecto de lo que se bajó: no hay qué publicar")
		return nil
	}
	patched, err := client.Patch(ctx, canon.PatchRequest{
		Author: *author,
		Reason: *reason,
		Base:   canon.PatchBase{ETag: base.ETag, SHA256: base.SHA256},
		Files:  files,
		DryRun: !*apply,
	})
	if err != nil {
		return err
	}
	for _, file := range patched.Files {
		fmt.Printf("  ✓ %s: %s\n", file.Path, file.Action)
	}
	paths := make([]string, 0, len(patched.Diff))
	for path := range patched.Diff {
		paths = append(paths, path)
	}
	sort.Strings(paths)
	for _, path := range paths {
		fmt.Printf("\n%s\n%s\n", path, clip(patched.Diff[path], 4000))
	}
	if patched.DryRun {
		fmt.Println("\n  (ensayo: canon validó el corpus resultante y no guardó nada; para publicar, APPLY=1)")
		return nil
	}
	fmt.Printf("  ✓ revisión %d en %s\n", patched.Revision, canon.URL())
	return nil
}

/* corpus imprime el corpus entero en JSON —`{"url", "topics": {tema: {areas, prose}}}`— para los
 * cruces en Python (`tools/canon.py`). Es la única lectura del corpus completo del playground. */
func corpus(ctx context.Context, client *canon.Client) error {
	topics, err := client.Corpus(ctx)
	if err != nil {
		return err
	}
	return json.NewEncoder(os.Stdout).Encode(map[string]any{"url": canon.URL(), "topics": topics})
}

// loadPiece lee una pieza; con `text_file` la prosa sale de un archivo relativo a la pieza.
func loadPiece(path string) (canon.Piece, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var piece canon.Piece
	if err := json.Unmarshal(raw, &piece); err != nil {
		return nil, fmt.Errorf("%s no es un JSON válido: %w", path, err)
	}
	if file, ok := piece["text_file"].(string); ok {
		text, err := os.ReadFile(filepath.Join(filepath.Dir(path), file))
		if err != nil {
			return nil, err
		}
		delete(piece, "text_file")
		piece["text"] = strings.TrimSpace(string(text))
	}
	return piece, nil
}

func envOr(name, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}

func clip(text string, n int) string {
	runes := []rune(text)
	if len(runes) <= n {
		return text
	}
	return string(runes[:n]) + "…"
}

/* topicMap: el mapa de canon —los temas por etapa del crédito, con su título y resumen—, leído de la API en
 * el momento (gratis: `/api/topics` y `/api/globalmap`). No guarda copia: lo que se lee es lo vigente. */
func topicMap(ctx context.Context, client *canon.Client) error {
	topics, _, _, err := client.Topics(ctx, "")
	if err != nil {
		return fmt.Errorf("canon no respondió (¿VPN de prod?): %w", err)
	}
	if len(topics) == 0 {
		return fmt.Errorf("canon no devolvió temas")
	}
	gm, err := client.GlobalMap(ctx)
	if err != nil {
		return err
	}
	stages, err := canon.Stages(gm)
	if err != nil {
		return err
	}
	fmt.Printf("\n  mapa de canon · %d temas · %s\n\n%s\n\n", len(topics), canon.URL(), compactStages(topics, stages))
	for _, t := range topics {
		fmt.Printf("  %-22s %s\n  %-22s %s\n", t.Topic, t.Title, "", t.Summary)
	}
	fmt.Println("\n  leer un tema entero: make canon-read IDS='<tema>' · buscar: make canon-search Q='…'")
	return nil
}

// compactWidth es el ancho de la lista por etapas; lo que no entra sigue abajo, con sangría.
const compactWidth = 100

// compactStages: los temas por etapa, sólo nombres; los que no tienen estación van como transversales.
func compactStages(topics []canon.TopicSummary, stages []canon.Stage) string {
	var b strings.Builder
	line := func(label string, names []string) {
		prefix := fmt.Sprintf("    %-20s ", label)
		indent := strings.Repeat(" ", len([]rune(prefix))) // en caracteres: «evaluación» tiene una ó de dos bytes
		row := prefix
		for i, t := range names {
			piece := t
			if i > 0 {
				piece = " · " + t
			}
			if i > 0 && len([]rune(row+piece)) > compactWidth {
				b.WriteString(row + " ·\n")
				row = indent + t
				continue
			}
			row += piece
		}
		b.WriteString(row + "\n")
	}
	inStage := map[string]bool{}
	for _, s := range stages {
		for _, t := range s.Topics {
			inStage[t] = true
		}
		if len(s.Topics) > 0 {
			line(strings.ToLower(s.Title), s.Topics)
		}
	}
	var cross []string
	for _, t := range topics {
		if !inStage[t.Topic] {
			cross = append(cross, t.Topic)
		}
	}
	if len(cross) > 0 {
		line("transversales", cross)
	}
	return strings.TrimRight(b.String(), "\n")
}
