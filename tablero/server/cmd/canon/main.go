// canon lee y dicta canon, el corpus compartido de CreditOp, en un comando (`make canon-*`).
//
//	search "<palabras del negocio>"      qué sección y qué área lo cubren (gratis, sin modelo)
//	map                                  los temas por etapa del crédito, con título y resumen (refresca la copia local)
//	read <id>[,<id>…]                    secciones completas: `cuota/context#<ancla>` o el tema entero
//	code <tema/capa> [n]                 los archivos que declara el área n del tema
//	propose <pieza.json>                 dónde iría y qué le rechaza el lint. NO escribe
//	write <pieza.json>… [-title T]       borrador → piezas → cierre: UNA revisión. ESCRIBE
//	write -dry <pieza.json>…             el mismo recorrido SIN el cierre: dice qué haría canon con cada pieza y abandona el borrador
//	export -out <carpeta>                el corpus de canon, tal como está hoy, para editar archivos enteros (map.json…)
//	patch -dir <carpeta> -reason R       publica los archivos que cambiaste en esa carpeta. Sin -apply sólo ensaya y muestra el diff
//	corpus                               el corpus entero en JSON, para los cruces de `tools/canon.py`
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
	"strconv"
	"strings"
	"time"

	"creditop/playground/connectors/canon"
	"creditop/playground/tablero/server/internal/canoncache"
	"creditop/playground/tablero/server/internal/layout"
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
	case "code":
		err = code(ctx, client, args)
	case "propose":
		err = propose(ctx, client, args)
	case "write":
		err = write(ctx, client, args)
	case "export":
		err = exportCorpus(ctx, client, args)
	case "patch":
		err = patch(ctx, client, args)
	case "corpus":
		err = corpus(ctx, client)
	case "map":
		err = topicMap(ctx, client)
	default:
		usage()
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "✗", err)
		os.Exit(1)
	}
}

func usage() {
	fmt.Fprintln(os.Stderr, "uso: canon search|read|route|code|propose|write|export|patch …  (ver `make canon-search` y sus vecinos)")
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
	for i, hit := range found.Map {
		if i == 4 {
			break
		}
		fmt.Printf("    %s  ·  %s\n", hit.Cite, clip(hit.Goal, 110))
	}
	if found.Uncovered != nil {
		if text, _ := json.Marshal(found.Uncovered); len(text) > 4 {
			fmt.Printf("  ⚠ sin cubrir: %s\n", text)
		}
	}
	if len(found.Prose) == 0 {
		fmt.Println("  ⚠ nada: probá otras palabras; si sigue vacío, canon no lo tiene (no es lo mismo que «no existe»)")
	}
	fmt.Println("  → leer: make canon-read IDS='<tema/capa#ancla>'")
	return nil
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

/* code: los archivos que declara un área, leídos del map.json de la COPIA LOCAL. Canon retiró `/api/code`
 * el 2026-09-27: el código se lee en los repos de esta máquina, y el mapa dice cuáles y contra qué hash. */
func code(_ context.Context, _ *canon.Client, args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("falta el área: `cuota/context` y, si hace falta, su número")
	}
	n := 0
	if len(args) > 1 {
		n, _ = strconv.Atoi(args[1])
	}
	area, total, err := canoncache.Area(layout.Find().Canon(), args[0], n)
	if err != nil {
		return err
	}
	fmt.Printf("  %s · área %d de %d: %s\n", args[0], n, total, area.Goal)
	if area.Deduce != "" {
		fmt.Printf("  se deduce leyendo: %s\n", area.Deduce)
	}
	repos := make([]string, 0, len(area.Files))
	for repo := range area.Files {
		repos = append(repos, repo)
	}
	sort.Strings(repos)
	for _, repo := range repos {
		paths := make([]string, 0, len(area.Files[repo]))
		for p := range area.Files[repo] {
			paths = append(paths, p)
		}
		sort.Strings(paths)
		for _, p := range paths {
			fmt.Printf("    %s:%s  (%s)\n", repo, p, area.Files[repo][p])
		}
	}
	if len(area.Tables) > 0 {
		fmt.Printf("  tablas: %s\n", strings.Join(area.Tables, ", "))
	}
	fmt.Println("  el código se lee en main de cada repo: git show origin/main:<ruta> desde ~/Desktop/CREDITOP/github/<repo>")
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
 * paso para cambiar un archivo entero —un map.json con fuentes que ya no existen en main— con `patch`. No usa la
 * copia de `tablero/canon`: esa se revalida por ETag y puede ir atrás, y editar sobre ella es pisar lo que otra
 * persona acaba de dictar. */
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

/* topicMap: el mapa de canon que usa el tablero —los temas por etapa del crédito, con su título y resumen—,
 * refrescando la copia local (gratis: la del corpus entero se revalida con el ETag del export). Es lo que el hook de
 * inicio resume en una línea por etapa. */
func topicMap(ctx context.Context, client *canon.Client) error {
	dir := filepath.Join(layout.Find().Data, "cache")
	c, err := canoncache.Refresh(ctx, client, canon.URL(), dir, time.Now())
	if len(c.Topics) == 0 {
		if err != nil {
			return fmt.Errorf("canon no respondió y no hay copia local (¿VPN de prod?): %w", err)
		}
		return fmt.Errorf("canon no devolvió temas")
	}
	state := "al día"
	if err != nil {
		state = "copia del " + c.CheckedAt.Local().Format("2006-01-02 15:04") + " — canon no respondió: " + err.Error()
	}
	fmt.Printf("\n  mapa de canon · %d temas · %s · %s\n\n%s\n\n", len(c.Topics), c.Source, state, c.Compact())
	for _, t := range c.Topics {
		fmt.Printf("  %-22s %s\n  %-22s %s\n", t.Topic, t.Title, "", t.Summary)
	}
	fmt.Println("\n  leer un tema entero: make canon-read IDS='<tema>' · buscar: make canon-search Q='…'")
	var syncErr error
	if err == nil {
		syncCtx, cancel := context.WithTimeout(context.Background(), canoncache.MirrorWait)
		defer cancel()
		_, _, syncErr = canoncache.SyncMirror(syncCtx, client, canon.URL(), layout.Find().Canon(), time.Now())
	}
	m, ok := canoncache.LoadMirror(layout.Find().Canon())
	fmt.Println(canoncache.MirrorLine(m, ok, syncErr, "tablero/canon"))
	return nil
}
