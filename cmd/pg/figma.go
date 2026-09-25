package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"regexp"
	"sort"
	"strings"

	"creditop/playground/connectors/figma"
)

// Figma por su conector, y sólo lectura. Cada comando acepta la URL que se copia de Figma (con o sin
// `node-id`) o la clave del archivo.

func figmaClient() (*figma.Client, int) {
	tok, err := figma.LoadToken()
	if err != nil {
		return nil, fail(2, "%v", err)
	}
	return figma.New(tok), 0
}

// figmaRef separa la referencia (el primer posicional) de las banderas, que pueden ir antes o después.
func figmaRef(fs *flag.FlagSet, args []string) (figma.Ref, int) {
	var pos []string
	for len(args) > 0 {
		if fs.Parse(args) != nil {
			return figma.Ref{}, 2
		}
		if fs.NArg() == 0 {
			break
		}
		pos = append(pos, fs.Arg(0))
		args = fs.Args()[1:]
	}
	if len(pos) == 0 {
		return figma.Ref{}, fail(2, "falta la URL de Figma o la clave del archivo")
	}
	ref, err := figma.ParseRef(pos[0])
	if err != nil {
		return figma.Ref{}, fail(2, "%v", err)
	}
	return ref, 0
}

func printJSON(v any) int {
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	if err := enc.Encode(v); err != nil {
		return fail(1, "%v", err)
	}
	return 0
}

func runFigmaMe(args []string) int {
	cl, code := figmaClient()
	if cl == nil {
		return code
	}
	u, err := cl.Me(context.Background())
	if err != nil {
		return fail(1, "%v", err)
	}
	fmt.Printf("el token es de %s (%s), id %s\n", u.Handle, u.Email, u.ID)
	return 0
}

func runFigmaFile(args []string) int {
	fs := flag.NewFlagSet("figma file", flag.ContinueOnError)
	asJSON := fs.Bool("json", false, "la estructura en JSON")
	ref, code := figmaRef(fs, args)
	if code != 0 {
		return code
	}
	cl, code := figmaClient()
	if cl == nil {
		return code
	}
	f, err := cl.File(context.Background(), ref.FileKey)
	if err != nil {
		return fail(1, "%v", err)
	}
	if *asJSON {
		return printJSON(f)
	}
	fmt.Printf("%s  (%s · modificado %s · versión %s)\n", f.Name, f.Key, f.LastModified, f.Version)
	for _, p := range f.Pages {
		fmt.Printf("\n▸ página %q  %s — %d nodos de primer nivel\n", p.Name, p.ID, len(p.Children))
		for _, n := range p.Children {
			fmt.Printf("    %-10s %-9s %s%s\n", n.ID, n.Type, n.Name, size(n))
		}
	}
	fmt.Printf("\nel árbol de un nodo: pg figma node <URL con node-id>  (o --id <id>)\n")
	return 0
}

func size(n figma.Node) string {
	if n.Width == 0 && n.Height == 0 {
		return ""
	}
	return fmt.Sprintf("  (%.0f×%.0f)", n.Width, n.Height)
}

func runFigmaNode(args []string) int {
	fs := flag.NewFlagSet("figma node", flag.ContinueOnError)
	id := fs.String("id", "", "el id del nodo (1:2), si la URL no trae node-id")
	depth := fs.Int("depth", 3, "cuántos niveles de hijos mostrar")
	asJSON := fs.Bool("json", false, "el árbol en JSON")
	onlyText := fs.Bool("text", false, "sólo los textos, en orden: el copy de la pantalla")
	all := fs.Bool("all", false, "sin colapsar los íconos y trazos")
	ref, code := figmaRef(fs, args)
	if code != 0 {
		return code
	}
	nodeID := ref.NodeID
	if *id != "" {
		nodeID = strings.ReplaceAll(*id, "-", ":")
	}
	if nodeID == "" {
		return fail(2, "falta el nodo: una URL con node-id, o --id 1:2")
	}
	cl, code := figmaClient()
	if cl == nil {
		return code
	}
	nodes, err := cl.Nodes(context.Background(), ref.FileKey, []string{nodeID}, *depth)
	if err != nil {
		return fail(1, "%v", err)
	}
	n := nodes[nodeID]
	if *asJSON {
		return printJSON(n)
	}
	if *onlyText {
		for _, t := range figma.Texts(n) {
			fmt.Printf("%-24s %s\n", t.ID, strings.ReplaceAll(t.Characters, "\n", " ⏎ "))
		}
		return 0
	}
	printTree(n, 0, *all)
	return 0
}

func printTree(n figma.Node, level int, all bool) {
	indent := strings.Repeat("  ", level)
	line := fmt.Sprintf("%s%-9s %s  %s%s", indent, n.Type, n.Name, n.ID, size(n))
	if strokes, ok := figma.Drawing(n); ok && !all && len(n.Children) > 0 {
		fmt.Printf("%s  [ícono o dibujo: %d trazos · --all los muestra]\n", line, strokes)
		return
	}
	if n.Characters != "" {
		text := strings.ReplaceAll(n.Characters, "\n", " ⏎ ")
		if len([]rune(text)) > 120 {
			text = string([]rune(text)[:120]) + "…"
		}
		line += fmt.Sprintf("  «%s»", text)
	}
	if n.Cut > 0 {
		line += fmt.Sprintf("  [+%d hijos sin mostrar: --depth]", n.Cut)
	}
	fmt.Println(line)
	for _, ch := range n.Children {
		printTree(ch, level+1, all)
	}
}

func runFigmaImages(args []string) int {
	fs := flag.NewFlagSet("figma images", flag.ContinueOnError)
	ids := fs.String("ids", "", "ids separados por coma (default: el node-id de la URL)")
	format := fs.String("format", "png", "png, jpg, svg o pdf")
	scale := fs.Float64("scale", 0, "escala de 0.01 a 4 (default de Figma: 1)")
	ref, code := figmaRef(fs, args)
	if code != 0 {
		return code
	}
	list := splitIDs(*ids)
	if len(list) == 0 && ref.NodeID != "" {
		list = []string{ref.NodeID}
	}
	if len(list) == 0 {
		return fail(2, "falta qué exportar: una URL con node-id, o --ids 1:2,3:4")
	}
	cl, code := figmaClient()
	if cl == nil {
		return code
	}
	urls, err := cl.Images(context.Background(), ref.FileKey, list, *format, *scale)
	if err != nil {
		return fail(1, "%v", err)
	}
	keys := make([]string, 0, len(urls))
	for k := range urls {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		u := urls[k]
		if u == "" {
			u = "(Figma no lo pudo renderizar: invisible, vacío o inexistente)"
		}
		fmt.Printf("%-10s %s\n", k, u)
	}
	fmt.Println("\n⚠ los enlaces vencen: se descargan, no se guardan")
	return 0
}

func splitIDs(s string) []string {
	var out []string
	for _, p := range strings.Split(s, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, strings.ReplaceAll(p, "-", ":"))
		}
	}
	return out
}

func runFigmaComments(args []string) int {
	fs := flag.NewFlagSet("figma comments", flag.ContinueOnError)
	open := fs.Bool("open", false, "sólo los que no están resueltos")
	ref, code := figmaRef(fs, args)
	if code != 0 {
		return code
	}
	cl, code := figmaClient()
	if cl == nil {
		return code
	}
	cs, err := cl.Comments(context.Background(), ref.FileKey)
	if err != nil {
		return fail(1, "%v", err)
	}
	shown := 0
	for _, c := range cs {
		if *open && c.ResolvedAt != "" {
			continue
		}
		shown++
		state := ""
		if c.ResolvedAt != "" {
			state = "  ✓ resuelto"
		}
		where := ""
		if c.NodeID != "" {
			where = " en " + c.NodeID
		}
		reply := ""
		if c.ParentID != "" {
			reply = "  ↳ "
		}
		fmt.Printf("%s%s  %s%s%s\n%s    %s\n", reply, c.CreatedAt, c.Author, where, state, reply, strings.ReplaceAll(c.Message, "\n", "\n    "+reply))
	}
	fmt.Printf("\n%d comentario(s)\n", shown)
	return 0
}

func runFigmaMap(args []string) int {
	fs := flag.NewFlagSet("figma map", flag.ContinueOnError)
	id := fs.String("id", "", "el nodo a leer (una sección, una página o un marco), si la URL no trae node-id")
	asJSON := fs.Bool("json", false, "la estructura en JSON")
	noComments := fs.Bool("no-comments", false, "sin contar comentarios abiertos (un pedido menos)")
	ref, code := figmaRef(fs, args)
	if code != 0 {
		return code
	}
	nodeID := ref.NodeID
	if *id != "" {
		nodeID = strings.ReplaceAll(*id, "-", ":")
	}
	if nodeID == "" {
		return fail(2, "falta qué leer: una URL con node-id (una sección o una página), o --id 1:2. Las páginas y secciones las lista `pg figma file`")
	}
	cl, code := figmaClient()
	if cl == nil {
		return code
	}
	st, err := cl.Structure(context.Background(), ref.FileKey, nodeID, !*noComments)
	if err != nil {
		return fail(1, "%v", err)
	}
	if *asJSON {
		return printJSON(st)
	}
	printStructure(st, 0)
	fmt.Println("\n⚠ el carril y el título se DEDUCEN: el carril, de la posición en el lienzo y de los rótulos grandes;")
	fmt.Println("  el título, del texto más grande de cada pantalla. El resto sale tal cual del archivo.")
	fmt.Println("  Una pantalla entera: pg figma node <url> --id <id> --depth 8 --text")
	return 0
}

// runFigmaTokens: la hoja de tokens de un diseño. Sale de la misma lectura que `figma map`.
func runFigmaTokens(args []string) int {
	fs := flag.NewFlagSet("figma tokens", flag.ContinueOnError)
	id := fs.String("id", "", "el nodo a leer (una sección o una página), si la URL no trae node-id")
	asCSS := fs.Bool("css", false, "como variables y clases CSS")
	asTailwind := fs.Bool("tailwind", false, "como tema de Tailwind v4")
	asJSON := fs.Bool("json", false, "la hoja en JSON")
	ref, code := figmaRef(fs, args)
	if code != 0 {
		return code
	}
	nodeID := ref.NodeID
	if *id != "" {
		nodeID = strings.ReplaceAll(*id, "-", ":")
	}
	if nodeID == "" {
		return fail(2, "falta qué leer: una URL con node-id (una sección o una página), o --id 1:2")
	}
	cl, code := figmaClient()
	if cl == nil {
		return code
	}
	st, err := cl.Structure(context.Background(), ref.FileKey, nodeID, false)
	if err != nil {
		return fail(1, "%v", err)
	}
	if st.Tokens == nil {
		return fail(1, "Figma no devolvió estilos para %s", nodeID)
	}
	t := *st.Tokens
	title := st.FileName + " · " + st.Name
	switch {
	case *asJSON:
		return printJSON(t)
	case *asCSS:
		fmt.Print(t.CSS(title))
		return 0
	case *asTailwind:
		fmt.Print(t.Tailwind(title))
		return 0
	}
	fmt.Printf("%s — %d colores y %d estilos de texto con nombre; %d colores sin estilo\n\n", title, len(t.Colors), len(t.Texts), len(t.Loose))
	fmt.Println("  COLORES")
	for _, c := range t.Colors {
		fmt.Printf("    %-22s %-24s %-38s %4d usos · %d pantallas\n", c.Var, c.Value, c.Name, c.Uses, c.Screens)
	}
	fmt.Println("\n  TEXTOS")
	for _, x := range t.Texts {
		fmt.Printf("    %-26s %-10s %3s · %4spx / %-4s %4d usos · %d pantallas\n", x.Name, strings.TrimSuffix(x.Family, " Variable"),
			fmt.Sprint(x.Weight), fmt.Sprint(x.Size), fmt.Sprint(x.LineHeight), x.Uses, x.Screens)
	}
	if len(t.Loose) > 0 {
		fmt.Println("\n  SIN ESTILO (se salen del sistema de diseño)")
		for i, l := range t.Loose {
			if i == 12 {
				fmt.Printf("    … y %d más\n", len(t.Loose)-12)
				break
			}
			same := ""
			if l.Matches != "" {
				same = " · es el valor de " + l.Matches
			}
			fmt.Printf("    %-24s %4d usos · %d pantallas%s\n", l.Value, l.Uses, l.Screens, same)
		}
	}
	var radii []string
	for _, r := range t.Radii {
		radii = append(radii, fmt.Sprintf("%g (%d)", r.Value, r.Uses))
	}
	fmt.Printf("\n  RADIOS   %s\n", strings.Join(radii, " · "))
	fmt.Println("\n⚠ radios y espaciados van por valor: Figma no le da a este token los nombres de sus variables.")
	fmt.Println("  Como hoja: --css (variables y clases) · --tailwind (tema de Tailwind v4) · --json")
	return 0
}

func printStructure(st figma.Structure, level int) {
	in := strings.Repeat("  ", level)
	var kinds []string
	for k, n := range st.Kinds {
		kinds = append(kinds, fmt.Sprintf("%d %s", n, kindName(k)))
	}
	sort.Strings(kinds)
	summary := strings.Join(kinds, " · ")
	if summary == "" {
		summary = fmt.Sprintf("%d sección(es) adentro", len(st.Sections))
	}
	fmt.Printf("%s%s «%s» (%s) — %s\n", in, strings.ToLower(st.Type), st.Name, st.ID, summary)
	if len(st.Lanes) > 0 {
		fmt.Printf("\n%sCARRILES — cada fila del lienzo, de izquierda a derecha, con el rótulo que le puso el diseñador\n", in)
	}
	for _, l := range st.Lanes {
		name := l.Label
		if name == "" {
			name = "(fila sin rótulo)"
		} else {
			name = "«" + name + "»"
		}
		fmt.Printf("\n%s▸ %s — %d pantalla(s)\n", in, name, len(l.Screens))
		for i, sc := range l.Screens {
			title := sc.Title
			switch {
			case title == "":
				title = "(sin título: " + sc.Name + ")"
			case sc.TitleFrom == "capa":
				title += "  (nombre de la capa)"
			}
			extra := ""
			if len(sc.Actions) > 0 {
				extra = "  → " + strings.Join(quoteAll(sc.Actions), " · ")
			}
			if sc.Comments > 0 {
				extra += fmt.Sprintf("  💬 %d", sc.Comments)
			}
			fmt.Printf("%s  %2d. %-9s %-11s %s%s\n", in, i+1, kindName(sc.Kind), sc.ID, title, extra)
		}
	}
	if len(st.Choices) > 0 {
		var cs []string
		for _, c := range st.Choices {
			cs = append(cs, fmt.Sprintf("%s (%s)", c.Title, c.ID))
		}
		fmt.Printf("\n%sDECISIONES — casillas y rombos: %s\n", in, strings.Join(cs, " · "))
	}
	if len(st.Arrows) > 0 {
		fmt.Printf("\n%sFLECHAS QUE DIBUJÓ EL DISEÑADOR\n", in)
		for _, e := range st.Arrows {
			via := ""
			if e.Via != "" {
				via = "  «" + e.Via + "»"
			}
			fmt.Printf("%s  %s → %s%s\n", in, e.FromName, e.ToName, via)
		}
	}
	if len(st.Links) > 0 {
		fmt.Printf("\n%sPROTOTIPO — qué lleva a qué pantalla, por carril\n", in)
		byLane := map[string][]figma.Edge{}
		var order []string
		for _, e := range st.Links {
			if _, ok := byLane[e.Lane]; !ok {
				order = append(order, e.Lane)
			}
			byLane[e.Lane] = append(byLane[e.Lane], e)
		}
		for _, lane := range order {
			name := lane
			if name == "" {
				name = "(sin rótulo)"
			}
			fmt.Printf("%s  en «%s»\n", in, name)
			for _, e := range byLane[lane] {
				fmt.Printf("%s    %s —[%s]→ %s\n", in, e.FromName, e.Via, e.ToName)
			}
		}
	}
	if len(st.Variants) > 0 {
		fmt.Printf("\n%sVARIANTES — pantallas que dicen lo mismo en otro estado o carril\n", in)
		for _, v := range st.Variants {
			fmt.Printf("%s  «%s» ×%d  en %s\n", in, v.Title, len(v.Screens), strings.Join(quoteAll(v.Lanes), ", "))
		}
	}
	if len(st.Components) > 0 {
		var cs []string
		for i, c := range st.Components {
			if i == 12 {
				cs = append(cs, fmt.Sprintf("… y %d más", len(st.Components)-12))
				break
			}
			cs = append(cs, fmt.Sprintf("%s ×%d", c.Name, c.Uses))
		}
		fmt.Printf("\n%sCOMPONENTES más usados: %s\n", in, strings.Join(cs, " · "))
	}
	if len(st.References) > 0 {
		fmt.Printf("%sREFERENCIAS pegadas en el lienzo (capturas, fotos): %d\n", in, len(st.References))
	}
	for _, sub := range st.Sections {
		fmt.Println()
		printStructure(sub, level+1)
	}
}

func quoteAll(list []string) []string {
	out := make([]string, len(list))
	for i, s := range list {
		out[i] = "«" + s + "»"
	}
	return out
}

// kindName traduce el tipo de pantalla para leerlo; el JSON lleva el id.
func kindName(k string) string {
	switch k {
	case "mobile":
		return "móvil"
	case "textless":
		return "sin texto"
	case "choice":
		return "decisión"
	case "reference":
		return "referencia"
	}
	return k
}

// reTeamURL saca el id de equipo de la URL de su página (`figma.com/files/team/<id>/…`).
var reTeamURL = regexp.MustCompile(`/team/([0-9]+)`)

func runFigmaProjects(args []string) int {
	fs := flag.NewFlagSet("figma projects", flag.ContinueOnError)
	team := fs.String("team", "", "el id del equipo, o la URL de su página en Figma")
	if fs.Parse(args) != nil {
		return 2
	}
	id := *team
	if m := reTeamURL.FindStringSubmatch(id); m != nil {
		id = m[1]
	}
	if id == "" {
		return fail(2, "falta --team: el número de figma.com/files/team/<id>/… (la API no lista equipos ni «recientes»)")
	}
	cl, code := figmaClient()
	if cl == nil {
		return code
	}
	ctx := context.Background()
	name, projects, err := cl.TeamProjects(ctx, id)
	if err != nil {
		return fail(1, "%v", err)
	}
	fmt.Printf("equipo «%s» (%s) — %d proyecto(s)\n", name, id, len(projects))
	for _, p := range projects {
		files, err := cl.ProjectFiles(ctx, p.ID)
		if err != nil {
			fmt.Printf("\n▸ %s (%s): %v\n", p.Name, p.ID, err)
			continue
		}
		fmt.Printf("\n▸ %s (%s) — %d archivo(s)\n", p.Name, p.ID, len(files))
		for _, f := range files {
			fmt.Printf("    %s  %s  %s\n", f.Key, f.LastModified[:min(10, len(f.LastModified))], f.Name)
		}
	}
	return 0
}
