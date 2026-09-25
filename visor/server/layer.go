package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"creditop/playground/visor/render"
)

// UNA CAPA DE UNA PANTALLA: lo que Miguel señala en la interfaz para decirle al modelo «acá hay algo que
// no cuadra». La capa se nombra por su id de Figma —el mismo que el HTML lleva en `data-figma`—, y en la
// ruta va como `?capa=<id>` (con guiones, como el nodo de la pantalla).
//
//	/api/layers?key=&id=          las cajas de todas las capas visibles: la interfaz busca la de abajo del mouse
//	/api/layer?key=&id=&layer=    lo que se sabe de UNA: qué es, dónde está, qué dice Figma y qué HTML salió
//
// La consola (`make visor-capa`) suma lo que el modelo no puede ver: los recortes de Figma y del HTML en
// esa zona, y cuánto se parecen ahí.

// layerBox es una capa visible con su caja, en píxeles de la pantalla.
type layerBox struct {
	ID    string  `json:"id"`
	Name  string  `json:"name"`
	Type  string  `json:"type"`
	X     float64 `json:"x"`
	Y     float64 `json:"y"`
	W     float64 `json:"w"`
	H     float64 `json:"h"`
	Depth int     `json:"depth"`
}

// layerBoxes son las capas visibles de la pantalla, sin la pantalla misma. Lo oculto no se lista: no se
// dibuja, así que no se puede señalar.
func layerBoxes(screen render.Node) []layerBox {
	var out []layerBox
	var walk func(n render.Node, depth int)
	walk = func(n render.Node, depth int) {
		if n.Visible != nil && !*n.Visible {
			return
		}
		if depth > 0 && n.Box != nil && n.Box.Width > 0 && n.Box.Height > 0 {
			out = append(out, layerBox{ID: n.ID, Name: n.Name, Type: n.Type, X: n.Box.X - screen.Box.X, Y: n.Box.Y - screen.Box.Y,
				W: n.Box.Width, H: n.Box.Height, Depth: depth})
		}
		for _, c := range n.Children {
			walk(c, depth+1)
		}
	}
	walk(screen, 0)
	return out
}

// findLayer busca la capa en el árbol y devuelve también los nombres de las capas que la contienen.
func findLayer(n render.Node, id string, path []string) (render.Node, []string, bool) {
	if n.ID == id {
		return n, path, true
	}
	for _, c := range n.Children {
		if found, p, ok := findLayer(c, id, append(append([]string(nil), path...), n.Name)); ok {
			return found, p, true
		}
	}
	return render.Node{}, nil, false
}

// layerFact es un renglón de lo que dice Figma: «Relleno · #4c39ff (Colors/morado/morado-500)».
type layerFact struct {
	Label string `json:"label"`
	Value string `json:"value"`
}

type layerDetail struct {
	ID     string      `json:"id"`
	Name   string      `json:"name"`
	Type   string      `json:"type"`
	Path   []string    `json:"path"` // de la pantalla hacia adentro, sin la capa
	X      float64     `json:"x"`
	Y      float64     `json:"y"`
	W      float64     `json:"w"`
	H      float64     `json:"h"`
	Text   string      `json:"text,omitempty"`
	Hidden bool        `json:"hidden,omitempty"`
	Facts  []layerFact `json:"facts"`
	HTML   string      `json:"html"` // el pedazo del HTML traducido que dibuja esta capa
	Figma  string      `json:"figma"`
}

// errNoLayer: la pantalla ya no tiene esa capa (el diseñador la borró o la rehizo con otro id).
type errNoLayer string

func (e errNoLayer) Error() string {
	return fmt.Sprintf("la pantalla ya no tiene la capa %s: se borró o se rehízo con otro id", string(e))
}

func (s *server) layerDetail(ctx context.Context, key, id, layer string) (layerDetail, error) {
	screen, version, err := s.screenNode(ctx, key, id)
	if err != nil {
		return layerDetail{}, err
	}
	n, path, ok := findLayer(screen, layer, nil)
	if !ok || n.ID == screen.ID {
		return layerDetail{}, errNoLayer(layer)
	}
	tokens := s.styleTokens(key)
	d := layerDetail{ID: n.ID, Name: n.Name, Type: n.Type, Path: path, Hidden: n.Visible != nil && !*n.Visible,
		Facts: layerFacts(n, tokens), Figma: "https://www.figma.com/design/" + key + "/?node-id=" + strings.NewReplacer(":", "-", ";", "%3B").Replace(n.ID)}
	if n.Box != nil {
		d.X, d.Y, d.W, d.H = n.Box.X-screen.Box.X, n.Box.Y-screen.Box.Y, n.Box.Width, n.Box.Height
	}
	if n.Type == "TEXT" {
		d.Text = n.Characters
	}
	doc, _ := render.HTML(screen, assets(key, s.fileVariants(key, version), tokens))
	d.HTML = htmlFragment(doc, n.ID)
	return d, nil
}

// layerFacts dice en castellano lo que Figma sabe de la capa y decide cómo se dibuja: el auto-layout, cómo
// se ajusta, rellenos, trazos, radio, letra, con el token si lo tiene. Es lo que se compara contra el HTML.
func layerFacts(n render.Node, tokens map[string]render.StyleToken) []layerFact {
	var out []layerFact
	add := func(label, format string, args ...any) {
		out = append(out, layerFact{label, fmt.Sprintf(format, args...)})
	}
	// token es el estilo del sistema de diseño que usa la capa por esa vía. Figma nombra la misma vía de
	// dos formas (`fill` y `fills`): con las dos a la vez el token salía repetido.
	token := func(keys ...string) string {
		for _, key := range keys {
			if t, ok := tokens[n.Styles[key]]; ok && t.Name != "" {
				return " (" + t.Name + ")"
			}
		}
		return ""
	}
	if n.LayoutMode == "HORIZONTAL" || n.LayoutMode == "VERTICAL" {
		dir := map[string]string{"HORIZONTAL": "en fila", "VERTICAL": "en columna"}[n.LayoutMode]
		add("Auto-layout", "%s · separación %s · relleno %s %s %s %s · alineado %s / %s", dir, num(n.ItemSpacing),
			num(n.PaddingTop), num(n.PaddingRight), num(n.PaddingBottom), num(n.PaddingLeft), lower(n.PrimaryAlign, "MIN"), lower(n.CounterAlign, "MIN"))
	}
	if n.LayoutPositioning == "ABSOLUTE" {
		add("Posición", "absoluta dentro del auto-layout")
	}
	if n.SizingH != "" || n.SizingV != "" {
		add("Tamaño", "ancho %s · alto %s", sizing(n.SizingH), sizing(n.SizingV))
	}
	for _, p := range n.Fills {
		if f := paintText(p); f != "" {
			add("Relleno", "%s%s", f, token("fill", "fills"))
		}
	}
	for _, p := range n.Strokes {
		if f := paintText(p); f != "" {
			add("Trazo", "%s · %s px %s%s", f, num(n.StrokeWeight), lower(n.StrokeAlign, "CENTER"), token("stroke", "strokes"))
		}
	}
	if len(n.CornerRadii) == 4 {
		add("Radio", "%s %s %s %s", num(n.CornerRadii[0]), num(n.CornerRadii[1]), num(n.CornerRadii[2]), num(n.CornerRadii[3]))
	} else if n.CornerRadius > 0 {
		add("Radio", "%s", num(n.CornerRadius))
	}
	if n.Opacity != nil && *n.Opacity < 1 {
		add("Opacidad", "%s %%", num(*n.Opacity*100))
	}
	if n.ClipsContent {
		add("Recorta", "lo que se sale de la caja")
	}
	for _, e := range n.Effects {
		if e.Visible == nil || *e.Visible {
			add("Efecto", "%s", strings.ToLower(strings.ReplaceAll(e.Type, "_", " ")))
		}
	}
	if n.Type == "TEXT" && n.Style != nil {
		st := n.Style
		add("Letra", "%s %s · %s/%s%s", st.FontFamily, num(st.FontWeight), num(st.FontSize), num(st.LineHeightPx), token("text"))
	}
	for name, p := range n.ComponentProps {
		add("Propiedad", "%s = %s", strings.SplitN(name, "#", 2)[0], strings.Trim(string(p.Value), `"`))
	}
	return out
}

func paintText(p render.Paint) string {
	if p.Visible != nil && !*p.Visible {
		return ""
	}
	op := 1.0
	if p.Opacity != nil {
		op = *p.Opacity
	}
	switch p.Type {
	case "SOLID":
		if p.Color == nil {
			return ""
		}
		c := p.Color
		h := fmt.Sprintf("#%02x%02x%02x", int(math.Round(c.R*255)), int(math.Round(c.G*255)), int(math.Round(c.B*255)))
		if a := c.A * op; a < 1 {
			h += fmt.Sprintf(" al %s %%", num(a*100))
		}
		return h
	case "IMAGE":
		return "imagen (" + strings.ToLower(p.ScaleMode) + ")"
	default:
		return strings.ToLower(strings.ReplaceAll(p.Type, "_", " "))
	}
}

func num(x float64) string {
	s := fmt.Sprintf("%.2f", x)
	s = strings.TrimRight(strings.TrimRight(s, "0"), ".")
	if s == "-0" {
		return "0"
	}
	return s
}

func lower(s, fallback string) string {
	if s == "" {
		s = fallback
	}
	return strings.ToLower(strings.ReplaceAll(s, "_", " "))
}

func sizing(s string) string {
	switch s {
	case "FILL":
		return "llena"
	case "HUG":
		return "se ajusta al contenido"
	case "FIXED":
		return "fijo"
	}
	return "—"
}

// htmlFragment saca del documento el elemento que dibuja la capa, con todo lo de adentro. El HTML del
// render es regular —un elemento por capa, con `data-figma`—, así que alcanza con contar la apertura y el
// cierre de la misma etiqueta desde donde empieza.
func htmlFragment(doc, id string) string {
	at := strings.Index(doc, `data-figma="`+htmlEscape(id)+`"`)
	if at < 0 {
		return ""
	}
	start := strings.LastIndex(doc[:at], "<")
	if start < 0 {
		return ""
	}
	name := doc[start+1:]
	if i := strings.IndexAny(name, " >"); i > 0 {
		name = name[:i]
	}
	end := strings.Index(doc[at:], ">")
	if end < 0 {
		return ""
	}
	end += at + 1
	switch name {
	case "img", "input", "br", "hr":
		return doc[start:end]
	}
	open, close := "<"+name, "</"+name+">"
	depth, i := 1, end
	for depth > 0 {
		o, c := strings.Index(doc[i:], open), strings.Index(doc[i:], close)
		if c < 0 {
			return doc[start:]
		}
		if o >= 0 && o < c && isTagStart(doc[i+o+len(open):]) {
			depth++
			i += o + len(open)
			continue
		}
		depth--
		i += c + len(close)
	}
	return doc[start:i]
}

// isTagStart: «<div» es una etiqueta si sigue un espacio o «>», no «<divider».
func isTagStart(rest string) bool { return rest != "" && (rest[0] == ' ' || rest[0] == '>') }

func htmlEscape(s string) string {
	return strings.NewReplacer("&", "&amp;", `"`, "&#34;", "<", "&lt;", ">", "&gt;").Replace(s)
}

// layerCrops recorta la zona de la capa en la imagen de Figma y en el HTML dibujado, y mide cuánto se
// parecen ahí. Devuelve dónde quedaron los dos PNG.
func (s *server) layerCrops(ctx context.Context, key, id string, d layerDetail, dir string) ([2]string, measured, error) {
	var paths [2]string
	_, version, err := s.screenNode(ctx, key, id)
	if err != nil {
		return paths, measured{}, err
	}
	if dir == "" {
		dir = filepath.Join(s.cache, key, versionDir(version), "layers")
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return paths, measured{}, err
	}
	base := reNotDigit.ReplaceAllString(id, "-") + "_" + reNotDigit.ReplaceAllString(d.ID, "-")
	paths[0], paths[1] = filepath.Join(dir, base+"-figma.png"), filepath.Join(dir, base+"-html.png")
	for i := range paths {
		if abs, err := filepath.Abs(paths[i]); err == nil {
			paths[i] = abs
		}
	}
	n, _, err := s.screenNode(ctx, key, id)
	if err != nil {
		return paths, measured{}, err
	}
	api, err := s.selfURL()
	if err != nil {
		return paths, measured{}, err
	}
	tool, err := findTool("visor/tools/fidelity.mjs")
	if err != nil {
		return paths, measured{}, err
	}
	fidelityGate.Lock()
	defer fidelityGate.Unlock()
	ctx, cancel := context.WithTimeout(ctx, 3*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, "node", tool, "--api", api, "--key", key, "--id", id,
		"--w", fmt.Sprint(n.Box.Width), "--h", fmt.Sprint(n.Box.Height),
		"--clip", fmt.Sprintf("%s,%s,%s,%s", num(d.X), num(d.Y), num(d.W), num(d.H)),
		"--figma-out", paths[0], "--html-out", paths[1], "--json")
	var out, errOut bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &errOut
	runErr := cmd.Run()
	var m measured
	if err := json.Unmarshal(bytes.TrimSpace(lastLine(out.Bytes())), &m); err != nil || m.Error != "" {
		msg := strings.TrimSpace(m.Error + " " + errOut.String())
		if msg == "" && runErr != nil {
			msg = runErr.Error()
		}
		return paths, measured{}, fmt.Errorf("la medición no terminó: %s", msg)
	}
	return paths, m, nil
}

func (s *server) handleLayers(w http.ResponseWriter, r *http.Request) {
	key, id := r.URL.Query().Get("key"), r.URL.Query().Get("id")
	if !reFileKey.MatchString(key) || !reNodeID.MatchString(id) {
		fail(w, 400, "clave o id inválidos")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
	defer cancel()
	n, _, err := s.screenNode(ctx, key, id)
	if err != nil {
		fail(w, statusOf(err), "%v", err)
		return
	}
	writeJSON(w, 200, map[string]any{"layers": layerBoxes(n)})
}

func (s *server) handleLayer(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	key, id, layer := q.Get("key"), q.Get("id"), q.Get("layer")
	if !reFileKey.MatchString(key) || !reNodeID.MatchString(id) || !reLayerID.MatchString(layer) {
		fail(w, 400, "clave, id o capa inválidos")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
	defer cancel()
	d, err := s.layerDetail(ctx, key, id, layer)
	if _, gone := err.(errNoLayer); gone {
		fail(w, 404, "%v", err)
		return
	}
	if err != nil {
		fail(w, statusOf(err), "%v", err)
		return
	}
	writeJSON(w, 200, d)
}
