package main

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"flag"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"creditop/playground/connectors/figma"
	"creditop/playground/visor/render"
)

// LA API POR CONSOLA DEL VISOR. La interfaz es para mirar; el modelo trabaja con comandos, como con el
// harness. Cada verbo devuelve texto (o escribe archivos) y no necesita el visor corriendo: usa la misma
// caché y las mismas reglas que el server. La pantalla se nombra como en la ruta —`altafinanciera/266-1279`—,
// o con el enlace `visor:` de una tarea, la URL del visor o la de Figma.
//
// Los verbos van en inglés, como todo identificador; por `make` se llaman en castellano (visor-buscar…).
// ⚠ La puerta es `url`: el trabajo empieza con la URL que pega Miguel (la pantalla a adelantar, o una capa
// que no cuadra), y `url` la entiende y trae eso. Los demás son piezas sueltas.
//
//	url <lo que se pegó>             QUÉ es (pantalla o capa), su tarea, y lo que hace falta (make visor-url)
//	search <texto>                   ¿qué pantalla es? por título, carril o archivo      (make visor-buscar)
//	screens <proyecto>               el flujo: carriles y pantallas, con su ruta          (make visor-pantallas)
//	screen <ruta>                    el paquete para el modelo (Markdown)                 (make visor-pantalla)
//	html <ruta> [--out <archivo>]    el HTML traducido                                    (make visor-html)
//	assets <ruta> [--dir <carpeta>] [--svg]
//	                                 las imágenes ORIGINALES (y sus dibujos en SVG)       (make visor-recursos)
//	tokens <proyecto> [--css|--tailwind|--json]                                           (make visor-tokens)
//	components <proyecto>            el inventario de componentes del flujo               (make visor-componentes)
//	fidelity <ruta> [--fresh]        cuánto se parece el HTML a Figma                     (make visor-fidelidad R=)
//	layer <ruta>?capa=<capa> [--capa <id>] [--dir <carpeta>]
//	                                 UNA capa: qué es, qué dice Figma, su HTML y los recortes (make visor-capa)
var cliVerbs = map[string]func(s *server, ctx context.Context, args []string, out io.Writer) error{
	"search":     cliSearch,
	"screens":    cliScreens,
	"screen":     cliBrief,
	"html":       cliHTML,
	"assets":     cliAssets,
	"tokens":     cliTokens,
	"components": cliInventory,
	"fidelity":   cliFidelity,
	"layer":      cliLayer,
	"url":        cliURL,
}

func runCLI(s *server, args []string) int {
	verb := args[0]
	run, ok := cliVerbs[verb]
	if !ok {
		fmt.Fprintf(os.Stderr, "visor: no existe «%s». Los verbos: search · screens · screen · html · assets · tokens · components · fidelity · layer · url (por make: visor-url · visor-buscar · visor-pantallas · visor-pantalla · visor-html · visor-recursos · visor-tokens · visor-componentes · visor-fidelidad · visor-capa)\n", verb)
		return 2
	}
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	if err := run(s, context.Background(), args[1:], out); err != nil {
		out.Flush()
		fmt.Fprintf(os.Stderr, "visor %s: %v\n", verb, err)
		var usage usageError
		if errors.As(err, &usage) {
			return 2
		}
		return 1
	}
	return 0
}

type usageError string

func (u usageError) Error() string { return string(u) }

var (
	reRouteRef = regexp.MustCompile(`^(?:visor:|https?://(?:localhost|127\.0\.0\.1):\d+/)?([A-Za-z0-9-]+)/([0-9]+-[0-9]+)(?:@([0-9a-f]{12}))?(?:\?.*)?$`)
	reProjRef  = regexp.MustCompile(`^(?:visor:|https?://(?:localhost|127\.0\.0\.1):\d+/)?([A-Za-z0-9-]+)(?:/.*)?$`)
)

// resolveScreen: de cualquier forma de nombrar una pantalla a la clave del archivo y el id del nodo.
func (s *server) resolveScreen(ref string) (key, id string, err error) {
	ref = strings.TrimSpace(ref)
	if strings.Contains(ref, "figma.com/") {
		r, err := figma.ParseRef(ref)
		if err != nil || r.NodeID == "" {
			return "", "", usageError("la URL de Figma tiene que traer node-id de la pantalla")
		}
		return r.FileKey, r.NodeID, nil
	}
	m := reRouteRef.FindStringSubmatch(ref)
	if m == nil {
		return "", "", usageError(fmt.Sprintf("«%s» no es una pantalla: se escribe <clave del archivo>/<nodo> (RkyauDfqEsFbJZBBoqChAV/266-1279) o la URL de Figma", ref))
	}
	key = s.keyOfProject(m[1])
	if key == "" {
		return "", "", fmt.Errorf("no hay un proyecto «%s» en la biblioteca del visor (make visor-pantallas los lista)", m[1])
	}
	return key, strings.ReplaceAll(m[2], "-", ":"), nil
}

func (s *server) resolveProject(ref string) (string, error) {
	ref = strings.TrimSpace(ref)
	if strings.Contains(ref, "figma.com/") {
		r, err := figma.ParseRef(ref)
		if err != nil {
			return "", usageError(err.Error())
		}
		return r.FileKey, nil
	}
	m := reProjRef.FindStringSubmatch(ref)
	if m == nil {
		return "", usageError(fmt.Sprintf("«%s» no es un proyecto", ref))
	}
	if key := s.keyOfProject(m[1]); key != "" {
		return key, nil
	}
	return "", fmt.Errorf("no hay un proyecto «%s» en la biblioteca del visor", m[1])
}

// flowScreens son las pantallas de un mapa en orden, con su carril.
type flowScreen struct {
	sc           figma.Screen
	section      string
	lane         string
	index, total int
}

func flowScreens(st figma.Structure) []flowScreen {
	var out []flowScreen
	var walk func(x figma.Structure, section string)
	walk = func(x figma.Structure, section string) {
		for _, l := range x.Lanes {
			for i, sc := range l.Screens {
				out = append(out, flowScreen{sc: sc, section: section, lane: l.Label, index: i + 1, total: len(l.Screens)})
			}
		}
		for _, sub := range x.Sections {
			walk(sub, sub.Name)
		}
	}
	walk(st, st.Name)
	return out
}

func laneLabel(l string) string {
	if l == "" {
		return "fila sin rótulo"
	}
	return l
}

// route es cómo el CLI nombra una pantalla: por IDS de Figma —la clave del archivo y el nodo—, que no
// dependen de cómo se llame nada. La interfaz y las tareas la nombran por proyecto (`altafinanciera/…`),
// que se lee mejor; el CLI acepta las dos, pero contesta en ids.
func route(key, id string) string { return key + "/" + strings.ReplaceAll(id, ":", "-") }

// ── buscar ──

func cliSearch(s *server, ctx context.Context, args []string, out io.Writer) error {
	q := fold(strings.TrimSpace(strings.Join(args, " ")))
	if q == "" {
		return usageError("falta qué buscar: make visor-buscar Q='alta bienvenida'")
	}
	words := strings.Fields(q)
	type hit struct {
		fs    flowScreen
		key   string
		slug  string
		file  string
		named bool // alguna palabra nombra su proyecto
	}
	var hits, laneStarts []hit
	for _, o := range s.libraryKeys() {
		st, _, err := s.readFlow(ctx, o.Key)
		if err != nil {
			fmt.Fprintf(out, "  ✗ %s: %v\n", o.Name, err)
			continue
		}
		slug := s.projectSlug(o.Key)
		project := fold(o.Name + " " + slug)
		named := false
		for _, w := range words {
			if strings.Contains(project, w) {
				named = true
			}
		}
		for _, fs := range flowScreens(st) {
			text := fold(strings.Join([]string{fs.sc.Title, fs.sc.Name, fs.lane, fs.section, o.Name, slug}, " "))
			all := true
			for _, w := range words {
				if !strings.Contains(text, w) {
					all = false
					break
				}
			}
			h := hit{fs: fs, key: o.Key, slug: slug, file: o.Name, named: named}
			if all {
				hits = append(hits, h)
			} else if named && fs.index == 1 {
				laneStarts = append(laneStarts, h)
			}
		}
	}
	print := func(h hit) {
		title := h.fs.sc.Title
		if title == "" {
			title = h.fs.sc.Name
		}
		fmt.Fprintf(out, "  %-36s «%s» · carril «%s», %d de %d · %s\n", route(h.key, h.fs.sc.ID), title, laneLabel(h.fs.lane), h.fs.index, h.fs.total, h.file)
	}
	for _, h := range hits {
		print(h)
	}
	switch {
	case len(hits) > 0:
		fmt.Fprintf(out, "\n  %d pantalla(s) con todas las palabras (en el título, la capa, el carril o el proyecto).\n", len(hits))
	case len(laneStarts) > 0:
		// En Figma una pantalla se llama por lo que DICE, no por lo que es: «bienvenida» no aparece en la
		// bienvenida de Alta (su capa es «home» y su título, el titular). Lo que sí se sabe es dónde está:
		// una bienvenida, un inicio, abre su carril.
		fmt.Fprintln(out, "  Ninguna pantalla tiene todas las palabras: en Figma se llaman por lo que dicen, no por lo que son.")
		fmt.Fprintln(out, "  Las que ABREN cada carril del proyecto nombrado (una bienvenida o un inicio suele ser una de éstas):")
		fmt.Fprintln(out)
		for _, h := range laneStarts {
			print(h)
		}
	default:
		fmt.Fprintln(out, "  Ninguna pantalla. Busca en el título, la capa, el carril y el proyecto; el flujo entero: make visor-pantallas P=<proyecto>")
	}
	fmt.Fprintln(out, "  Una pantalla entera: make visor-pantalla R=<ruta> · sus imágenes: make visor-recursos R=<ruta>")
	return nil
}

// ── pantallas ──

func cliScreens(s *server, ctx context.Context, args []string, out io.Writer) error {
	if len(args) == 0 {
		fmt.Fprintln(out, "  Los proyectos de la biblioteca (la clave de Figma es su id):")
		for _, o := range s.libraryKeys() {
			fmt.Fprintf(out, "    %-24s %s\n", o.Key, o.Name)
		}
		return nil
	}
	key, err := s.resolveProject(args[0])
	if err != nil {
		return err
	}
	st, _, err := s.readFlow(ctx, key)
	if err != nil {
		return err
	}
	fmt.Fprintf(out, "  %s (%s) · «%s» · versión %s\n", st.FileName, key, st.Name, st.Version)
	section, lane := "\x00", "\x00"
	n := 0
	for _, fs := range flowScreens(st) {
		if fs.section != section {
			section = fs.section
			fmt.Fprintf(out, "\n  ▸ %s\n", section)
		}
		if fs.lane != lane || fs.index == 1 {
			lane = fs.lane
			fmt.Fprintf(out, "    %s (%d)\n", laneLabel(fs.lane), fs.total)
		}
		title := fs.sc.Title
		if title == "" {
			title = fs.sc.Name
		}
		link := ""
		if len(fs.sc.Hotspots) > 0 {
			link = "  →"
		}
		fmt.Fprintf(out, "      %2d. %-44s %s%s\n", fs.index, clip(title, 44), route(key, fs.sc.ID), link)
		n++
	}
	fmt.Fprintf(out, "\n  %d pantallas. «→» lleva a otra por el prototipo. Una pantalla: make visor-pantalla R=<ruta>\n", n)
	return nil
}

func clip(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n-1]) + "…"
}

// ── pantalla · html ──

// screenReady deja cargado lo que la pantalla necesita del archivo: su mapa (carril, tokens, inventario).
func (s *server) screenReady(ctx context.Context, ref string) (key, id string, err error) {
	if key, id, err = s.resolveScreen(ref); err != nil {
		return
	}
	_, _, err = s.readFlow(ctx, key)
	return
}

func cliBrief(s *server, ctx context.Context, args []string, out io.Writer) error {
	if len(args) == 0 {
		return usageError("falta la pantalla: make visor-pantalla R=RkyauDfqEsFbJZBBoqChAV/266-1279")
	}
	key, id, err := s.screenReady(ctx, args[0])
	if err != nil {
		return err
	}
	text, err := s.brief(ctx, key, id)
	if err != nil {
		return err
	}
	_, err = io.WriteString(out, text)
	return err
}

func cliHTML(s *server, ctx context.Context, args []string, out io.Writer) error {
	fs := flag.NewFlagSet("html", flag.ContinueOnError)
	to := fs.String("out", "", "el archivo donde escribirlo (sin esto, a la salida estándar)")
	ref, err := parseRefArgs(fs, args)
	if err != nil {
		return err
	}
	key, id, err := s.screenReady(ctx, ref)
	if err != nil {
		return err
	}
	n, version, err := s.screenNode(ctx, key, id)
	if err != nil {
		return err
	}
	doc, rep := render.HTML(n, assets(key, s.fileVariants(key, version), s.styleTokens(key)))
	// Las imágenes van por la API del visor: con el visor corriendo se ven; sin él, `visor recursos` las baja.
	doc = strings.ReplaceAll(doc, `src="/api/asset?`, `src="http://localhost:5193/api/asset?`)
	if *to == "" {
		_, err = io.WriteString(out, doc)
		return err
	}
	if err := os.WriteFile(*to, []byte(doc), 0o644); err != nil {
		return err
	}
	fmt.Fprintf(out, "  %s · %d cajas · %d textos · %d dibujos · %d imágenes\n", *to, rep.Elements, rep.Texts, len(rep.Drawings), len(unique(rep.Images)))
	return nil
}

// parseRefArgs acepta la ruta antes o después de las banderas.
func parseRefArgs(fs *flag.FlagSet, args []string) (string, error) {
	fs.SetOutput(io.Discard)
	var pos []string
	for len(args) > 0 {
		if err := fs.Parse(args); err != nil {
			return "", usageError(err.Error())
		}
		if fs.NArg() == 0 {
			break
		}
		pos = append(pos, fs.Arg(0))
		args = fs.Args()[1:]
	}
	if len(pos) == 0 {
		return "", usageError("falta la pantalla: <clave del archivo>/<nodo>, o la URL de Figma")
	}
	return pos[0], nil
}

// ── recursos ──

type assetUse struct {
	ref, layer, role, file string
	w, h                   int
	box                    string
}

// cliAssets baja las imágenes de la pantalla EN SU RESOLUCIÓN ORIGINAL —la que se subió a Figma, no la
// exportación de la pantalla—, con el nombre de su capa, lista para el front. Con --svg, también los
// dibujos (íconos, logos vectoriales) como el SVG que exporta Figma. Medido con la bienvenida de Alta: el
// logo es un JPEG de 200×200 y la foto de fondo un PNG de 1448×1086, que la implementación reemplazó por
// los de otra marca porque «los tenía que dar diseño».
func cliAssets(s *server, ctx context.Context, args []string, out io.Writer) error {
	fs := flag.NewFlagSet("recursos", flag.ContinueOnError)
	dir := fs.String("dir", "", "la carpeta donde dejarlos (default: visor/.cache/recursos/<proyecto>-<pantalla>)")
	withSVG := fs.Bool("svg", false, "también los dibujos (íconos, logos vectoriales) como SVG")
	ref, err := parseRefArgs(fs, args)
	if err != nil {
		return err
	}
	key, id, err := s.screenReady(ctx, ref)
	if err != nil {
		return err
	}
	n, version, err := s.screenNode(ctx, key, id)
	if err != nil {
		return err
	}
	if *dir == "" {
		*dir = filepath.Join(s.cache, "recursos", s.projectSlug(key)+"-"+strings.ReplaceAll(id, ":", "-"))
	}
	if err := os.MkdirAll(*dir, 0o755); err != nil {
		return err
	}
	// Las imágenes de relleno, con la capa que las usa. Una misma imagen en dos capas se baja una vez.
	var uses []assetUse
	seen := map[string]bool{}
	names := map[string]int{}
	var walk func(nd render.Node, root bool)
	walk = func(nd render.Node, root bool) {
		if nd.Visible != nil && !*nd.Visible {
			return
		}
		for _, p := range nd.Fills {
			if p.Type != "IMAGE" || p.ImageRef == "" || (p.Visible != nil && !*p.Visible) || seen[p.ImageRef] {
				continue
			}
			seen[p.ImageRef] = true
			role := "imagen"
			switch {
			case root:
				role = "fondo de la pantalla"
			case nd.CornerRadius >= 50 || nd.Type == "ELLIPSE":
				role = "imagen en círculo (logo o avatar)"
			}
			box := ""
			if nd.Box != nil {
				box = fmt.Sprintf("%.0f×%.0f", nd.Box.Width, nd.Box.Height)
			}
			uses = append(uses, assetUse{ref: p.ImageRef, layer: nd.Name, role: role, box: box})
		}
		for _, ch := range nd.Children {
			walk(ch, false)
		}
	}
	walk(n, true)
	var refs []string
	for _, u := range uses {
		refs = append(refs, u.ref)
	}
	if len(refs) > 0 {
		if err := s.ensure(ctx, key, version, "fill", refs); err != nil {
			return err
		}
	}
	fmt.Fprintf(out, "  %s\n\n", *dir)
	if len(uses) == 0 {
		fmt.Fprintln(out, "  La pantalla no tiene imágenes (fotos, logos en bitmap).")
	}
	for i := range uses {
		u := &uses[i]
		src := s.assetPath(key, version, "fill", u.ref)
		b, err := os.ReadFile(src)
		if err != nil {
			fmt.Fprintf(out, "  ✗ %s: %v\n", u.layer, err)
			continue
		}
		ext := map[string]string{"image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp"}[http.DetectContentType(b)]
		if ext == "" {
			ext = ".bin"
		}
		base := uniqueName(names, tokenSafe(u.layer, "imagen"))
		u.file = base + ext
		if cfg, _, err := image.DecodeConfig(bytes.NewReader(b)); err == nil {
			u.w, u.h = cfg.Width, cfg.Height
		}
		if err := os.WriteFile(filepath.Join(*dir, u.file), b, 0o644); err != nil {
			return err
		}
		size := "—"
		if u.w > 0 {
			size = fmt.Sprintf("%d×%d", u.w, u.h)
		}
		fmt.Fprintf(out, "  %-28s %-11s original · en pantalla %-9s · %s «%s» · %s\n", u.file, size, u.box, u.role, u.layer, humanBytes(len(b)))
	}
	if *withSVG {
		_, rep := render.HTML(n, assets(key, s.fileVariants(key, version), nil))
		ids := unique(rep.Drawings)
		if len(ids) > 0 {
			if err := s.ensure(ctx, key, version, "svg", ids); err != nil {
				return err
			}
		}
		layers := map[string]string{}
		var index func(nd render.Node)
		index = func(nd render.Node) {
			layers[nd.ID] = nd.Name
			for _, ch := range nd.Children {
				index(ch)
			}
		}
		index(n)
		fmt.Fprintln(out)
		for _, did := range ids {
			b, err := os.ReadFile(s.assetPath(key, version, "svg", did))
			if err != nil {
				continue
			}
			file := uniqueName(names, tokenSafe(layers[did], "dibujo")) + ".svg"
			if err := os.WriteFile(filepath.Join(*dir, file), b, 0o644); err != nil {
				return err
			}
			fmt.Fprintf(out, "  %-28s SVG de Figma · capa «%s»\n", file, layers[did])
		}
	}
	fmt.Fprintln(out, "\n  Los nombres salen de la capa de Figma. Las fotos van en su resolución original, no la de la exportación.")
	return nil
}

func tokenSafe(name, fallback string) string {
	if s := slugOf(name); s != "" {
		return s
	}
	return fallback
}

func uniqueName(seen map[string]int, base string) string {
	seen[base]++
	if seen[base] == 1 {
		return base
	}
	return fmt.Sprintf("%s-%d", base, seen[base])
}

func humanBytes(n int) string {
	switch {
	case n >= 1<<20:
		return fmt.Sprintf("%.1f MB", float64(n)/(1<<20))
	case n >= 1<<10:
		return fmt.Sprintf("%.0f KB", float64(n)/(1<<10))
	}
	return fmt.Sprintf("%d B", n)
}

// ── tokens · componentes ──

func cliTokens(s *server, ctx context.Context, args []string, out io.Writer) error {
	fs := flag.NewFlagSet("tokens", flag.ContinueOnError)
	fs.Bool("css", false, "variables y clases CSS (el default)")
	tw := fs.Bool("tailwind", false, "tema de Tailwind v4")
	js := fs.Bool("json", false, "la hoja en JSON")
	ref, err := parseRefArgs(fs, args)
	if err != nil {
		return usageError("falta el proyecto: make visor-tokens P=credifamilia")
	}
	key, err := s.resolveProject(ref)
	if err != nil {
		return err
	}
	st, _, err := s.readFlow(ctx, key)
	if err != nil {
		return err
	}
	if st.Tokens == nil {
		return errors.New("Figma no devolvió estilos para la página de flujo")
	}
	switch {
	case *tw:
		_, err = io.WriteString(out, st.Tokens.Tailwind(st.FileName))
	case *js:
		err = writeJSONTo(out, st.Tokens)
	default: // --css, o sin formato: la hoja CSS es la que se pega al lado de un componente
		_, err = io.WriteString(out, st.Tokens.CSS(st.FileName))
	}
	return err
}

func cliInventory(s *server, ctx context.Context, args []string, out io.Writer) error {
	if len(args) == 0 {
		return usageError("falta el proyecto: make visor-componentes P=credifamilia")
	}
	key, err := s.resolveProject(args[0])
	if err != nil {
		return err
	}
	st, _, err := s.readFlow(ctx, key)
	if err != nil {
		return err
	}
	titles := map[string]string{}
	for _, fs := range flowScreens(st) {
		t := fs.sc.Title
		if t == "" {
			t = fs.sc.Name
		}
		titles[fs.sc.ID] = t
	}
	fmt.Fprintf(out, "  Componentes de «%s»: instancias de primer nivel, con sus variantes y dónde aparecen.\n", st.FileName)
	for _, c := range st.Inventory {
		fmt.Fprintf(out, "\n  %s — %d usos en %d pantallas\n", c.Name, c.Uses, len(c.Screens))
		for _, p := range c.Props {
			if p.Type == "TEXT" {
				fmt.Fprintf(out, "    · %s (texto)\n", p.Name)
				continue
			}
			var vs []string
			for _, v := range p.Values {
				vs = append(vs, fmt.Sprintf("%s ×%d", v.Value, v.Uses))
			}
			fmt.Fprintf(out, "    · %s: %s\n", p.Name, strings.Join(vs, " · "))
		}
		// Las pantallas, juntas por título, con la ruta de la primera.
		type group struct {
			first string
			n     int
		}
		byTitle := map[string]*group{}
		var order []string
		for _, sid := range c.Screens {
			t := titles[sid]
			if byTitle[t] == nil {
				byTitle[t] = &group{first: sid}
				order = append(order, t)
			}
			byTitle[t].n++
		}
		var parts []string
		for _, t := range order {
			g := byTitle[t]
			p := fmt.Sprintf("%s (%s)", t, route(key, g.first))
			if g.n > 1 {
				p = fmt.Sprintf("%s ×%d (%s…)", t, g.n, route(key, g.first))
			}
			parts = append(parts, p)
		}
		fmt.Fprintf(out, "    en: %s\n", strings.Join(parts, " · "))
	}
	return nil
}

func writeJSONTo(out io.Writer, v any) error {
	w := &jsonWriter{out}
	writeJSON(w, 200, v)
	return nil
}

// jsonWriter es un http.ResponseWriter mínimo, para reusar writeJSON en la consola.
type jsonWriter struct{ out io.Writer }

func (j *jsonWriter) Header() http.Header         { return http.Header{} }
func (j *jsonWriter) Write(b []byte) (int, error) { return j.out.Write(b) }
func (j *jsonWriter) WriteHeader(int)             {}

// cliFidelity dice cuánto se parece el HTML traducido a la imagen de Figma: qué tan en serio tomar el HTML
// de una pantalla antes de pasarla a código.
func cliFidelity(s *server, ctx context.Context, args []string, out io.Writer) error {
	fs := flag.NewFlagSet("fidelity", flag.ContinueOnError)
	fresh := fs.Bool("fresh", false, "medir de nuevo aunque haya una medida de esta versión")
	ref, err := parseRefArgs(fs, args)
	if err != nil {
		return err
	}
	key, id, err := s.screenReady(ctx, ref)
	if err != nil {
		return err
	}
	f, err := s.fidelityOf(ctx, key, id, *fresh, false)
	if err != nil {
		return err
	}
	title := id
	if place, ok := s.findScreen(key, id); ok && place.screen.Title != "" {
		title = place.screen.Title
	}
	fmt.Fprintf(out, "\n  fidelidad del HTML contra Figma · «%s» · %s/%s\n", title, key, strings.ReplaceAll(id, ":", "-"))
	fmt.Fprintf(out, "  %.2f %% igual, sin contar el suavizado de las letras · %.1f %% píxel a píxel · medida %s\n\n",
		f.SameReal*100, f.Same*100, f.Measured.Format("2006-01-02 15:04"))
	fmt.Fprintln(out, "  Un píxel cuenta si no hay uno parecido a menos de 1 px en la otra imagen: el suavizado de las letras y medio píxel de corrimiento no son diferencias.")
	return nil
}

// reLayerParam: la capa en una ruta del visor, `capa=I1-6711_1265-1238` (guiones por «:», guion bajo por «;»).
var reLayerParam = regexp.MustCompile(`[?&]capa=([A-Za-z0-9_-]+)`)

// layerFromRoute pasa la capa de su forma en la ruta a su id de Figma.
func layerFromRoute(v string) string {
	return strings.NewReplacer("-", ":", "_", ";").Replace(v)
}

// cliLayer es lo que Miguel señaló en la interfaz, para el modelo: qué capa es, qué dice Figma de ella,
// el pedazo de HTML que la dibuja, y los dos recortes de esa zona —Figma y el HTML— para compararlos sin
// adivinar dónde mirar.
func cliLayer(s *server, ctx context.Context, args []string, out io.Writer) error {
	fs := flag.NewFlagSet("layer", flag.ContinueOnError)
	layerFlag := fs.String("capa", "", "el id de la capa (si la ruta no lo trae como ?capa=)")
	dir := fs.String("dir", "", "dónde guardar los recortes (sin esto, en la caché del visor)")
	ref, err := parseRefArgs(fs, args)
	if err != nil {
		return err
	}
	layer := *layerFlag
	if m := reLayerParam.FindStringSubmatch(ref); m != nil && layer == "" {
		layer = layerFromRoute(m[1])
	}
	if layer == "" {
		return usageError("falta la capa: la ruta con ?capa=<id> (como la copia la interfaz) o --capa <id>")
	}
	if !reLayerID.MatchString(layer) {
		return usageError(fmt.Sprintf("«%s» no es un id de capa de Figma", layer))
	}
	key, id, err := s.screenReady(ctx, ref)
	if err != nil {
		return err
	}
	return s.writeLayer(ctx, out, key, id, layer, *dir)
}

// writeLayer es el informe de UNA capa: qué es, qué dice Figma, los recortes y cuánto se parecen en esa
// zona, y el HTML que la dibuja. Lo usan `layer` y `url`.
func (s *server) writeLayer(ctx context.Context, out io.Writer, key, id, layer, dir string) error {
	d, err := s.layerDetail(ctx, key, id, layer)
	if err != nil {
		return err
	}
	title := id
	if place, ok := s.findScreen(key, id); ok && place.screen.Title != "" {
		title = place.screen.Title
	}
	fmt.Fprintf(out, "# Capa «%s» · %s\n\n", d.Name, strings.ToLower(d.Type))
	fmt.Fprintf(out, "- **Pantalla:** «%s» (%s/%s)\n", title, key, strings.ReplaceAll(id, ":", "-"))
	if len(d.Path) > 0 {
		fmt.Fprintf(out, "- **Adentro de:** %s\n", strings.Join(d.Path, " › "))
	}
	fmt.Fprintf(out, "- **Caja:** %s,%s · %s×%s px (desde la esquina de la pantalla)\n", num(d.X), num(d.Y), num(d.W), num(d.H))
	fmt.Fprintf(out, "- **Id:** `%s` · Figma: %s\n", d.ID, d.Figma)
	if d.Text != "" {
		fmt.Fprintf(out, "- **Dice:** «%s»\n", strings.Join(strings.Fields(d.Text), " "))
	}
	if len(d.Facts) > 0 {
		b := &strings.Builder{}
		for _, f := range d.Facts {
			fmt.Fprintf(b, "- %s: %s\n", f.Label, f.Value)
		}
		fmt.Fprintf(out, "\n## Lo que dice Figma\n\n%s", b.String())
	}

	// Los recortes y cuánto se parece la zona: un Chromium, como la fidelidad de la pantalla.
	fmt.Fprintln(out, "\n## Esa zona, en Figma y en el HTML")
	crops, m, err := s.layerCrops(ctx, key, id, d, dir)
	if err != nil {
		fmt.Fprintf(out, "\nNo se pudo recortar: %v\n", err)
	} else {
		fmt.Fprintf(out, "\n- %.2f %% igual sin contar el suavizado de las letras · %.1f %% píxel a píxel\n", m.SameReal*100, m.Same*100)
		fmt.Fprintf(out, "- Figma: %s\n- HTML: %s\n", crops[0], crops[1])
	}

	fmt.Fprintln(out, "\n## El HTML que la dibuja")
	if d.HTML == "" {
		fmt.Fprintln(out, "\nEl HTML no tiene un elemento propio para esta capa: va dibujada adentro de otra (un SVG de Figma o una imagen).")
	} else {
		fmt.Fprintf(out, "\n```html\n%s\n```\n", d.HTML)
	}
	return nil
}
