package main

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"creditop/playground/connectors/figma"
	"creditop/playground/visor/render"
)

// LA PUERTA DEL MODELO: lo que Miguel pega es el ancla. El trabajo con un diseño no empieza con el modelo
// buscando pantallas: empieza con Miguel diciendo «esta es la pantalla que hay que adelantar» o «mirá esta
// capa, los chulos no se ven», con una URL. `url` entiende a qué se refiere esa URL —una pantalla o una capa
// de adentro, venga del visor, de Figma o de una tarea— y trae justo eso, con la tarea del tablero a la que
// está asociada. Los demás verbos siguen para cuando hace falta una pieza suelta.

// pasted es lo que se entendió de lo que se pegó.
type pasted struct {
	key, screen, layer string
	print              string // la huella de un enlace `visor:…@huella` o `?huella=`
	from               string // «el visor» · «Figma» · «una tarea»
}

var rePrintParam = regexp.MustCompile(`[?&]huella=([0-9a-f]{12})`)

// parsePasted entiende lo que se pegó. Las formas: la URL del visor (con `?capa=` y `?huella=`), el enlace
// `visor:` de una tarea, la URL de Figma —de una pantalla o de una capa de adentro— y `<clave>/<nodo>`.
func (s *server) parsePasted(ctx context.Context, raw string) (pasted, error) {
	raw = strings.TrimSpace(strings.Trim(strings.TrimSpace(raw), "<>`'\""))
	if raw == "" {
		return pasted{}, usageError("falta lo que se pegó: la URL de la pantalla o de la capa")
	}
	if strings.Contains(raw, "figma.com/") {
		return s.parseFigmaURL(ctx, raw)
	}
	var p pasted
	var err error
	if p.key, p.screen, err = s.resolveScreen(raw); err != nil {
		return p, err
	}
	switch {
	case strings.HasPrefix(raw, "visor:"):
		p.from = "una tarea"
	case strings.Contains(raw, "://"):
		p.from = "el visor"
	default:
		p.from = "la ruta"
	}
	if m := reLayerParam.FindStringSubmatch(raw); m != nil {
		p.layer = layerFromRoute(m[1])
	}
	if m := reRouteRef.FindStringSubmatch(raw); m != nil && m[3] != "" {
		p.print = m[3]
	} else if m := rePrintParam.FindStringSubmatch(raw); m != nil {
		p.print = m[1]
	}
	if _, _, err := s.readFlow(ctx, p.key); err != nil {
		return p, err
	}
	return p, nil
}

// parseFigmaURL: el `node-id` de Figma puede ser la pantalla o cualquier capa de adentro (lo que se copia
// con «Copy link to selection»). Si es una pantalla del flujo, listo; si no, se busca la pantalla que la
// contiene por dónde está en el lienzo, y se confirma que la capa esté en su árbol.
func (s *server) parseFigmaURL(ctx context.Context, raw string) (pasted, error) {
	ref, err := figma.ParseRef(raw)
	if err != nil {
		return pasted{}, usageError(err.Error())
	}
	if ref.NodeID == "" {
		return pasted{}, usageError("la URL de Figma no trae node-id: copiá el enlace de la pantalla o de la capa (clic derecho → Copy link to selection)")
	}
	p := pasted{key: ref.FileKey, from: "Figma"}
	if _, _, err := s.readFlow(ctx, p.key); err != nil {
		return p, err
	}
	if _, ok := s.findScreen(p.key, ref.NodeID); ok {
		p.screen = ref.NodeID
		return p, nil
	}
	rawNode, err := s.nodeJSON(ctx, p.key, ref.NodeID)
	if err != nil {
		return p, err
	}
	n, err := render.Parse(rawNode)
	if err != nil {
		return p, fmt.Errorf("el node-id %s no es una capa con caja: %v", ref.NodeID, err)
	}
	cx, cy := n.Box.X+n.Box.Width/2, n.Box.Y+n.Box.Height/2
	for _, sc := range s.flowScreensOf(p.key) {
		if cx < sc.X || cx >= sc.X+sc.W || cy < sc.Y || cy >= sc.Y+sc.H {
			continue
		}
		screen, _, err := s.screenNode(ctx, p.key, sc.ID)
		if err != nil {
			continue
		}
		if _, _, ok := findLayer(screen, ref.NodeID, nil); ok {
			p.screen, p.layer = sc.ID, ref.NodeID
			return p, nil
		}
	}
	return p, fmt.Errorf("el node-id %s («%s») no es una pantalla del flujo ni está adentro de una: si es una sección, pasá la URL de una pantalla", ref.NodeID, n.Name)
}

// flowScreensOf son las pantallas de los mapas del archivo que ya se leyeron.
func (s *server) flowScreensOf(key string) []figma.Screen {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []figma.Screen
	var walk func(st figma.Structure)
	walk = func(st figma.Structure) {
		for _, l := range st.Lanes {
			out = append(out, l.Screens...)
		}
		for _, sub := range st.Sections {
			walk(sub)
		}
	}
	for k, st := range s.maps {
		if strings.HasPrefix(k, key+"|") {
			walk(st)
		}
	}
	return out
}

// taskLink es una tarea del tablero que enlaza la pantalla.
type taskLink struct {
	folder, id, title string
	file              string
	line              int
}

// linkedTasks son las tareas que enlazan la pantalla —en su documento o en su pila—, con cualquier forma de
// enlace del visor. Es lo que dice en qué se está trabajando cuando Miguel pega la URL.
func (s *server) linkedTasks(root, key, screen string) []taskLink {
	seen := map[string]bool{}
	var out []taskLink
	_ = filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !(strings.HasSuffix(path, ".md") || strings.HasSuffix(path, ".jsonl")) {
			return nil
		}
		rel, _ := filepath.Rel(root, path)
		folder := strings.SplitN(filepath.ToSlash(rel), "/", 2)[0]
		if seen[folder] {
			return nil
		}
		f, err := os.Open(path)
		if err != nil {
			return nil
		}
		defer f.Close()
		sc := bufio.NewScanner(f)
		sc.Buffer(make([]byte, 1<<20), 1<<24)
		for n := 1; sc.Scan(); n++ {
			line := sc.Text()
			var refs [][2]string
			for _, m := range reVisorRef.FindAllStringSubmatch(line, -1) {
				refs = append(refs, [2]string{m[1], m[2]})
			}
			for _, m := range reVisorLink.FindAllStringSubmatch(line, -1) {
				refs = append(refs, [2]string{m[1], m[2]})
			}
			for _, r := range refs {
				if strings.ReplaceAll(r[1], "-", ":") == screen && s.keyOfProject(r[0]) == key {
					seen[folder] = true
					id, title := taskHeader(filepath.Join(root, folder, "task.md"))
					out = append(out, taskLink{folder: folder, id: id, title: title, file: filepath.ToSlash(rel), line: n})
					return nil
				}
			}
		}
		return nil
	})
	sort.Slice(out, func(i, j int) bool { return out[i].folder < out[j].folder })
	return out
}

// taskHeader lee el `id` y el `title` del frontmatter de una tarea.
func taskHeader(path string) (id, title string) {
	b, err := os.ReadFile(path)
	if err != nil {
		return "", ""
	}
	for i, line := range strings.Split(string(b), "\n") {
		if i > 0 && line == "---" {
			break
		}
		if v, ok := strings.CutPrefix(line, "id:"); ok {
			id = strings.TrimSpace(v)
		}
		if v, ok := strings.CutPrefix(line, "title:"); ok {
			title = strings.Trim(strings.TrimSpace(v), `"`)
		}
	}
	return id, title
}

// cliURL: lo que Miguel pegó, entendido. Primero QUÉ es y a qué tarea está asociado; después, lo que hace
// falta para colaborar: la capa (su HTML, los recortes, cuánto se parece) o la pantalla (el paquete).
func cliURL(s *server, ctx context.Context, args []string, out io.Writer) error {
	raw := strings.Join(args, " ")
	p, err := s.parsePasted(ctx, raw)
	if err != nil {
		return err
	}
	title := p.screen
	fileName := s.fileName(p.key)
	if place, ok := s.findScreen(p.key, p.screen); ok {
		if place.screen.Title != "" {
			title = place.screen.Title
		}
		if place.fileName != "" {
			fileName = place.fileName
		}
	}
	route := p.key + "/" + strings.ReplaceAll(p.screen, ":", "-")
	what := fmt.Sprintf("la pantalla «%s»", title)
	if p.layer != "" {
		route += "?capa=" + strings.NewReplacer(":", "-", ";", "_").Replace(p.layer)
		what = fmt.Sprintf("una capa de la pantalla «%s»", title)
	}
	fmt.Fprintf(out, "# Lo que se pegó: %s · %s\n\n", what, fileName)
	fmt.Fprintf(out, "- **Vino de:** %s · ruta `%s`\n", p.from, route)

	var tasks []taskLink
	if root, err := findTool("tablero/tasks"); err == nil {
		tasks = s.linkedTasks(root, p.key, p.screen)
	}
	if len(tasks) == 0 {
		link := "visor:" + p.key + "/" + strings.ReplaceAll(p.screen, ":", "-")
		if t, err := s.track(ctx, p.key, p.screen, ""); err == nil && t.Print != "" {
			link += "@" + t.Print
		}
		fmt.Fprintf(out, "- **Tarea del tablero:** ninguna enlaza esta pantalla todavía. Para su pila: `[%s](%s)`\n",
			strings.NewReplacer("[", " ", "]", " ").Replace(title), link)
	}
	for _, t := range tasks {
		name := t.folder
		if t.title != "" {
			name = fmt.Sprintf("%s «%s»", t.folder, t.title)
		}
		if t.id != "" && t.id != "0" {
			name = "#" + t.id + " " + name
		}
		fmt.Fprintf(out, "- **Tarea del tablero:** %s (`tablero/tasks/%s:%d`)\n", name, t.file, t.line)
	}
	if p.print != "" {
		if t, err := s.track(ctx, p.key, p.screen, p.print); err == nil {
			switch t.Status {
			case linkSame:
				fmt.Fprintln(out, "- **Desde que se enlazó:** la pantalla sigue igual.")
			case linkChanged:
				fmt.Fprintf(out, "- **Desde que se enlazó:** ⚠ el diseño CAMBIÓ (huella %s → %s): lo que diga la tarea puede estar viejo.\n", p.print, t.Print)
			case linkDeleted:
				fmt.Fprintln(out, "- **Desde que se enlazó:** ⚠ Figma ya no tiene esta pantalla: la borraron.")
				return nil
			}
		}
	}
	fmt.Fprintln(out)

	if p.layer != "" {
		// Una capa: es «mirá esto». Primero lo de la capa; lo de la pantalla, si hace falta, con otra pasada.
		var b strings.Builder
		err := s.writeLayer(ctx, &b, p.key, p.screen, p.layer, "")
		_, _ = io.WriteString(out, demote(b.String()))
		if err != nil {
			var gone errNoLayer
			if errors.As(err, &gone) {
				fmt.Fprintf(out, "⚠ %v. La pantalla entera: `make visor-url U='%s'`.\n", err, p.key+"/"+strings.ReplaceAll(p.screen, ":", "-"))
				return nil
			}
			return err
		}
		fmt.Fprintf(out, "\nLa pantalla entera (textos, imágenes, tokens, HTML): `make visor-url U='%s/%s'`.\n", p.key, strings.ReplaceAll(p.screen, ":", "-"))
		return nil
	}
	text, err := s.brief(ctx, p.key, p.screen)
	if err != nil {
		return err
	}
	// El paquete trae sus títulos: se bajan un nivel, porque el de arriba ya dice qué es.
	_, err = io.WriteString(out, demote(text))
	return err
}

// demote baja un nivel los títulos de Markdown, sin tocar lo que va adentro de un bloque de código.
func demote(md string) string {
	lines := strings.Split(md, "\n")
	fence := false
	for i, l := range lines {
		if strings.HasPrefix(l, "```") {
			fence = !fence
			continue
		}
		if !fence && strings.HasPrefix(l, "#") {
			lines[i] = "#" + l
		}
	}
	return strings.Join(lines, "\n")
}
