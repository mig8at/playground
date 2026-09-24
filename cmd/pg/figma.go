package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
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
