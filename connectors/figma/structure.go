package figma

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/url"
	"regexp"
	"sort"
	"strings"
)

// Structure es cómo está ARMADO un diseño, no qué nodos tiene: los carriles en que el diseñador reparte
// las pantallas, el orden de cada recorrido, qué dice cada pantalla, dónde se decide, qué conecta con
// qué y qué pantallas son la misma en otro estado.
//
// Todo sale del archivo y nada se inventa, pero dos cosas se DEDUCEN y la salida lo dice: el carril
// (de la posición en el lienzo y de los rótulos grandes) y el título (el texto más grande de la pantalla).
// Medido en `flujo-ecommerce` el 2026-09-24: el nombre de la capa no sirve para ninguna de las dos —
// los rótulos se llaman «-» o «Premium» y dicen «No paga cuota inicial»; las pantallas se llaman
// «Document_» o «Frame 427320380» y dicen «Pago exitoso»—.
type Structure struct {
	ID         string         `json:"id"`
	Name       string         `json:"name"`
	Type       string         `json:"type"`
	Kinds      map[string]int `json:"kinds"`
	Lanes      []Lane         `json:"lanes"`
	Choices    []Screen       `json:"choices,omitempty"` // casillas de decisión («Si», «No») y rombos
	Arrows     []Edge         `json:"arrows,omitempty"`  // las flechas que dibujó el diseñador
	Links      []Edge         `json:"links,omitempty"`   // la navegación del prototipo
	Variants   []Variant      `json:"variants,omitempty"`
	Components []Count        `json:"components,omitempty"`
	References []Screen       `json:"references,omitempty"` // capturas y fotos de referencia pegadas en el lienzo
	Sections   []Structure    `json:"sections,omitempty"`   // secciones adentro de ésta
	// El archivo, sólo en la raíz: la versión cambia con cada guardado y sirve para invalidar lo que
	// se haya guardado de él (las imágenes exportadas).
	FileName     string `json:"file_name,omitempty"`
	Version      string `json:"version,omitempty"`
	LastModified string `json:"last_modified,omitempty"`
	// Tokens, sólo en la raíz: los colores y estilos de texto del diseño con su nombre de Figma
	// (tokens.go). Salen de la misma respuesta que el árbol.
	Tokens *Tokens `json:"tokens,omitempty"`
	// Inventory, sólo en la raíz: los componentes de primer nivel del flujo, con sus variantes y en qué
	// pantallas aparecen (inventory.go).
	Inventory []ComponentUse `json:"inventory,omitempty"`
}

// Lane es un carril: una fila de pantallas bajo un rótulo, en el orden del lienzo (izquierda a derecha).
type Lane struct {
	Label   string   `json:"label"` // vacío: una fila sin rótulo
	LabelID string   `json:"label_id,omitempty"`
	Screens []Screen `json:"screens"`
}

// Screen es un marco de primer nivel del lienzo, leído como pantalla.
type Screen struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Kind  string `json:"kind"` // móvil · web · panel · sin texto · decisión · referencia
	Title string `json:"title,omitempty"`
	// TitleFrom dice de dónde salió el título: «texto» (lo que dice la pantalla) o «capa» (el nombre de
	// la capa, cuando la pantalla no tiene un texto propio que la nombre: sólo datos o una imagen).
	TitleFrom string   `json:"title_from,omitempty"`
	Actions   []string `json:"actions,omitempty"` // los textos de sus botones
	Texts     int      `json:"texts"`
	Comments  int      `json:"open_comments,omitempty"`
	// Hotspots son las zonas del prototipo: dónde tocar y a qué pantalla lleva, relativo a la pantalla.
	Hotspots []Hotspot `json:"hotspots,omitempty"`
	X        float64   `json:"x"`
	Y        float64   `json:"y"`
	W        float64   `json:"w"`
	H        float64   `json:"h"`
}

// Hotspot es una zona clicable del prototipo, en coordenadas de la pantalla (0,0 es su esquina). Una
// pantalla que avanza sola lleva `Auto` y ocupa la pantalla entera.
type Hotspot struct {
	X, Y, W, H float64
	To         string `json:"to"` // la pantalla destino; vacío si está fuera de la sección
	ToName     string `json:"to_name"`
	Via        string `json:"via"`
	Auto       bool   `json:"auto,omitempty"`
}

// Edge une dos nodos de primer nivel. `Via` es lo que la dispara (el botón y el gesto) o el texto de
// la flecha.
type Edge struct {
	From, FromName string
	To, ToName     string
	Via            string `json:"via,omitempty"`
	// Lane es el carril de la pantalla de origen: la misma navegación en dos carriles son dos recorridos.
	Lane string `json:"lane,omitempty"`
}

type placedNode struct {
	id string
	b  box
}

func nearest(nodes []placedNode, x, y float64) string {
	best, dist := "", 400.0
	for _, n := range nodes {
		dx := math.Max(0, math.Max(n.b.X-x, x-(n.b.X+n.b.Width)))
		dy := math.Max(0, math.Max(n.b.Y-y, y-(n.b.Y+n.b.Height)))
		if d := math.Hypot(dx, dy); d < dist || (d == 0 && dist > 0) {
			best, dist = n.id, d
		}
	}
	return best
}

// Variant son las pantallas que dicen lo mismo: la misma pantalla en otro estado o en otro carril.
type Variant struct {
	Title   string   `json:"title"`
	Screens []string `json:"screens"`
	Lanes   []string `json:"lanes"`
}

// Count es un componente del sistema de diseño y cuántas veces se usa.
type Count struct {
	Name string `json:"name"`
	Uses int    `json:"uses"`
}

type box struct{ X, Y, Width, Height float64 }

type fullNode struct {
	ID                  string
	Name                string
	Type                string
	Characters          string
	Style               *struct{ FontSize float64 } `json:"style"`
	AbsoluteBoundingBox *box
	ComponentID         string `json:"componentId"`
	TransitionNodeID    string `json:"transitionNodeID"`
	Interactions        []struct {
		Trigger *struct{ Type string } `json:"trigger"`
		Actions []*struct {
			Type          string
			DestinationID string `json:"destinationId"`
			Navigation    string
		} `json:"actions"`
	} `json:"interactions"`
	ConnectorStart *endpoint `json:"connectorStart"`
	ConnectorEnd   *endpoint `json:"connectorEnd"`
	Children       []fullNode
}

// endpoint es una punta de una flecha: pegada a un nodo, o suelta en el lienzo. Suelta, Figma la
// pega al contenedor (la sección) y guarda su posición RELATIVA a él.
type endpoint struct {
	EndpointNodeID string `json:"endpointNodeId"`
	Position       *struct{ X, Y float64 }
}

type componentMeta struct {
	Name           string
	ComponentSetID string `json:"componentSetId"`
}

// Structure baja el árbol COMPLETO del nodo (una sección, una página o un marco) y lo lee como diseño.
// Con `withComments` suma cuántos comentarios abiertos tiene cada pantalla (un pedido más).
func (c *Client) Structure(ctx context.Context, key, nodeID string, withComments bool) (Structure, error) {
	var raw struct {
		Name         string `json:"name"`
		Version      string `json:"version"`
		LastModified string `json:"lastModified"`
		Nodes        map[string]*struct {
			Document      json.RawMessage                  `json:"document"`
			Components    map[string]componentMeta         `json:"components"`
			ComponentSets map[string]struct{ Name string } `json:"componentSets"`
			Styles        map[string]styleMeta             `json:"styles"`
		} `json:"nodes"`
	}
	q := url.Values{"ids": {nodeID}}
	if err := c.get(ctx, "/v1/files/"+url.PathEscape(key)+"/nodes?"+q.Encode(), &raw); err != nil {
		return Structure{}, err
	}
	n, ok := raw.Nodes[nodeID]
	if !ok || n == nil {
		return Structure{}, &Error{Status: 404, Message: "el nodo " + nodeID + " no está en el archivo"}
	}
	names := map[string]string{}
	for id, m := range n.Components {
		name := m.Name
		if set, ok := n.ComponentSets[m.ComponentSetID]; ok && set.Name != "" {
			name = set.Name
		}
		names[id] = name
	}
	var open map[string]int
	if withComments {
		cs, err := c.Comments(ctx, key)
		if err != nil {
			return Structure{}, err
		}
		open = map[string]int{}
		for _, cm := range cs {
			if cm.ResolvedAt == "" && cm.ParentID == "" && cm.NodeID != "" {
				open[cm.NodeID]++
			}
		}
	}
	var doc fullNode
	if err := json.Unmarshal(n.Document, &doc); err != nil {
		return Structure{}, fmt.Errorf("el árbol de %s no es el JSON esperado: %v", nodeID, err)
	}
	st := Read(doc, names, open)
	st.FileName, st.Version, st.LastModified = raw.Name, raw.Version, raw.LastModified
	if tokens, err := ComputeTokens(n.Document, n.Styles, screenIDs(st)); err == nil {
		st.Tokens = &tokens
	}
	if inv, err := ComputeInventory(n.Document, names, screenOrder(st)); err == nil {
		st.Inventory = inv
	}
	return st, nil
}

// screenOrder son las pantallas de un mapa en su orden: por sección, carril y posición.
func screenOrder(st Structure) []string {
	var out []string
	var walk func(s Structure)
	walk = func(s Structure) {
		for _, l := range s.Lanes {
			for _, sc := range l.Screens {
				out = append(out, sc.ID)
			}
		}
		for _, sub := range s.Sections {
			walk(sub)
		}
	}
	walk(st)
	return out
}

// screenIDs son las pantallas de un mapa, con las de sus secciones.
func screenIDs(st Structure) map[string]bool {
	out := map[string]bool{}
	var walk func(s Structure)
	walk = func(s Structure) {
		for _, l := range s.Lanes {
			for _, sc := range l.Screens {
				out[sc.ID] = true
			}
		}
		for _, sub := range s.Sections {
			walk(sub)
		}
	}
	walk(st)
	return out
}

var (
	reStatusBar = regexp.MustCompile(`(?i)status ?bar|system icons`)
	reButton    = regexp.MustCompile(`(?i)button|bot[oó]n|btn|cta`)
	reReference = regexp.MustCompile(`(?i)captura|screenshot|whatsapp image|imagen|photo|foto`)
)

// labelFont es el tamaño desde el cual un texto del lienzo es un RÓTULO y no contenido. Medido en los
// cuatro archivos de producto: el texto más grande de una pantalla móvil es 28; los rótulos van de 50
// («Pensionado», «Empleado» en Credifamilia) a 204 px; y las notas sobre una pantalla —«Permiso de
// permanencia», «Se valida política»— son de 36, y a propósito quedan afuera: no nombran un carril.
// Hasta el 2026-09-24 era 60 y los perfiles de Credifamilia no se veían. Lo que separa un rótulo de una
// casilla de decisión del mismo tamaño no es la letra: es que a la casilla le llega una flecha.
const labelFont = 40

// Read lee un árbol ya bajado. `components` traduce el id de componente a su nombre (el del set, si es
// una variante); `openComments` cuenta comentarios abiertos por nodo. Los dos pueden ir vacíos.
func Read(root fullNode, components map[string]string, openComments map[string]int) Structure {
	s := Structure{ID: root.ID, Name: root.Name, Type: root.Type, Kinds: map[string]int{}}
	var screens []Screen
	var labels []label
	top := map[string]string{} // id de cualquier nodo → id del nodo de primer nivel que lo contiene
	uses := map[string]int{}
	var connectors []fullNode
	var navs []nav

	// Las flechas primero: qué nodos de primer nivel reciben o sueltan una. A una casilla de decisión le
	// llega una flecha; a un rótulo, no — medido en los cuatro archivos sin una sola excepción.
	arrowed := map[string]bool{}
	for _, ch := range root.Children {
		if ch.Type != "SECTION" && ch.Type != "CONNECTOR" {
			index(ch, ch.ID, top)
		}
	}
	for _, ch := range root.Children {
		if ch.Type != "CONNECTOR" {
			continue
		}
		for _, ep := range []*endpoint{ch.ConnectorStart, ch.ConnectorEnd} {
			if ep != nil {
				if t, ok := top[ep.EndpointNodeID]; ok {
					arrowed[t] = true
				}
			}
		}
	}

	for _, ch := range root.Children {
		if ch.Type == "SECTION" {
			sub := Read(ch, components, openComments)
			s.Sections = append(s.Sections, sub)
			continue
		}
		index(ch, ch.ID, top)
		if ch.Type == "CONNECTOR" {
			connectors = append(connectors, ch)
			continue
		}
		b := boxOf(ch)
		texts := textsOf(ch, nil)
		collect(ch, true, components, uses, &navs)
		switch {
		case isChoice(ch, texts, b, arrowed[ch.ID]):
			sc := screenOf(ch, texts, b, "choice")
			if sc.Title == "" {
				sc.Title = "◇ rombo"
			}
			s.Choices = append(s.Choices, sc)
		case isLabel(ch, texts, b):
			labels = append(labels, label{id: ch.ID, text: labelText(texts), b: b})
		case b.Width >= 300 && b.Height >= 300 && (ch.Type == "FRAME" || ch.Type == "INSTANCE" || ch.Type == "COMPONENT" || ch.Type == "COMPONENT_SET" || ch.Type == "GROUP"):
			kind := "panel"
			switch {
			case len(texts) == 0:
				kind = "textless"
			case b.Width <= 500:
				kind = "mobile"
			case b.Width >= 1200:
				kind = "web"
			}
			sc := screenOf(ch, texts, b, kind)
			if openComments != nil {
				sc.Comments = commentsUnder(ch, openComments)
			}
			screens = append(screens, sc)
		case reReference.MatchString(ch.Name) || ch.Type == "RECTANGLE" || ch.Type == "VECTOR":
			if b.Width >= 200 && b.Height >= 200 {
				s.References = append(s.References, screenOf(ch, texts, b, "reference"))
			}
		}
	}
	for _, sc := range screens {
		s.Kinds[sc.Kind]++
	}
	if len(s.Choices) > 0 {
		s.Kinds["choice"] = len(s.Choices)
	}
	if len(s.References) > 0 {
		s.Kinds["reference"] = len(s.References)
	}
	// Las zonas del prototipo, en coordenadas de su pantalla. Van antes de armar los carriles porque
	// éstos copian las pantallas.
	byID := map[string]*Screen{}
	for i := range screens {
		byID[screens[i].ID] = &screens[i]
	}
	for _, nv := range navs {
		sc, ok := byID[top[nv.from]]
		if !ok {
			continue
		}
		h := Hotspot{X: nv.b.X - sc.X, Y: nv.b.Y - sc.Y, W: nv.b.Width, H: nv.b.Height, Via: nv.via, Auto: nv.auto}
		if nv.auto {
			h.X, h.Y, h.W, h.H = 0, 0, sc.W, sc.H
		}
		if t, ok := top[nv.to]; ok {
			h.To = t
			if d, ok := byID[t]; ok {
				h.ToName = display(*d)
			}
		} else {
			h.ToName = "(fuera de esta sección)"
		}
		dup := false
		for _, o := range sc.Hotspots {
			if o.To == h.To && o.X == h.X && o.Y == h.Y {
				dup = true
			}
		}
		if !dup {
			sc.Hotspots = append(sc.Hotspots, h)
		}
	}
	s.Lanes = lanes(screens, labels)

	nameOf := map[string]string{}
	for _, l := range s.Lanes {
		for _, sc := range l.Screens {
			nameOf[sc.ID] = display(sc)
		}
	}
	for _, sc := range s.Choices {
		nameOf[sc.ID] = display(sc)
	}
	for _, l := range labels {
		nameOf[l.id] = "rótulo «" + l.text + "»"
	}
	laneOf := map[string]string{}
	for _, l := range s.Lanes {
		for _, sc := range l.Screens {
			laneOf[sc.ID] = l.Label
		}
	}
	resolve := func(id string) (string, string) {
		if id == "" || id == root.ID {
			return "", "(punto suelto del lienzo)"
		}
		t, ok := top[id]
		if !ok {
			return id, "(fuera de esta sección: " + id + ")"
		}
		if n, ok := nameOf[t]; ok {
			return t, n
		}
		return t, t
	}
	// Una punta suelta se ubica por su posición: el nodo de primer nivel que la contiene o, si cae en el
	// aire, el más cercano a menos de 400 px. Medido: 9 de las 24 puntas del archivo estaban sueltas.
	rb := boxOf(root)
	var placed []placedNode
	for _, sc := range screens {
		placed = append(placed, placedNode{sc.ID, box{sc.X, sc.Y, sc.W, sc.H}})
	}
	for _, sc := range s.Choices {
		placed = append(placed, placedNode{sc.ID, box{sc.X, sc.Y, sc.W, sc.H}})
	}
	for _, l := range labels {
		placed = append(placed, placedNode{l.id, l.b})
	}
	end := func(ep *endpoint) (string, string) {
		if ep == nil {
			return "", "(sin punta)"
		}
		if ep.EndpointNodeID != root.ID || ep.Position == nil {
			return resolve(ep.EndpointNodeID)
		}
		if id := nearest(placed, rb.X+ep.Position.X, rb.Y+ep.Position.Y); id != "" {
			return resolve(id)
		}
		return "", "(punta suelta en el lienzo)"
	}
	for _, cn := range connectors {
		e := Edge{Via: strings.TrimSpace(cn.Characters)}
		e.From, e.FromName = end(cn.ConnectorStart)
		e.To, e.ToName = end(cn.ConnectorEnd)
		e.Lane = laneOf[e.From]
		s.Arrows = append(s.Arrows, e)
	}
	seen := map[string]bool{}
	for _, nv := range navs {
		e := Edge{Via: nv.via}
		e.From, e.FromName = resolve(nv.from)
		e.To, e.ToName = resolve(nv.to)
		e.Lane = laneOf[e.From]
		k := e.From + "→" + e.To + "|" + e.Via
		if seen[k] || e.From == e.To {
			continue
		}
		seen[k] = true
		s.Links = append(s.Links, e)
	}
	s.Variants = variants(s.Lanes)
	for name, n := range uses {
		s.Components = append(s.Components, Count{Name: name, Uses: n})
	}
	sort.Slice(s.Components, func(i, j int) bool {
		if s.Components[i].Uses != s.Components[j].Uses {
			return s.Components[i].Uses > s.Components[j].Uses
		}
		return s.Components[i].Name < s.Components[j].Name
	})
	return s
}

type label struct {
	id, text string
	b        box
}

type nav struct {
	from, to, via string
	b             box
	auto          bool
}

type textNode struct {
	name     string
	text     string
	size     float64
	y        float64
	inButton bool
	status   bool
}

func boxOf(n fullNode) box {
	if n.AbsoluteBoundingBox == nil {
		return box{}
	}
	return *n.AbsoluteBoundingBox
}

func index(n fullNode, topID string, top map[string]string) {
	top[n.ID] = topID
	for _, ch := range n.Children {
		index(ch, topID, top)
	}
}

// textsOf junta los textos del subárbol, marcando los que están dentro de un botón o de la barra de
// estado del celular (que no dicen nada de la pantalla).
func textsOf(n fullNode, ancestors []string) []textNode {
	var out []textNode
	chain := append(ancestors, n.Name)
	if n.Characters != "" {
		t := textNode{name: n.Name, text: n.Characters, y: boxOf(n).Y}
		if n.Style != nil {
			t.size = n.Style.FontSize
		}
		for _, a := range chain {
			if reButton.MatchString(a) {
				t.inButton = true
			}
			if reStatusBar.MatchString(a) {
				t.status = true
			}
		}
		out = append(out, t)
	}
	for _, ch := range n.Children {
		out = append(out, textsOf(ch, chain)...)
	}
	return out
}

// collect cuenta los componentes usados y junta la navegación del prototipo.
func collect(n fullNode, isTop bool, components map[string]string, uses map[string]int, navs *[]nav) {
	if n.Type == "INSTANCE" && n.ComponentID != "" {
		name := components[n.ComponentID]
		if name == "" {
			name = n.Name
		}
		uses[name]++
	}
	for _, it := range n.Interactions {
		for _, a := range it.Actions {
			if a == nil || a.DestinationID == "" {
				continue
			}
			trigger := ""
			if it.Trigger != nil {
				trigger = it.Trigger.Type
			}
			var via string
			switch {
			case isTop && trigger == "AFTER_TIMEOUT":
				via = "sola, después de un tiempo"
			case isTop:
				via = gesture(trigger) + " la pantalla"
			default:
				el := firstText(n)
				if el == "" {
					el = n.Name
				}
				via = gesture(trigger) + " «" + el + "»"
			}
			*navs = append(*navs, nav{from: n.ID, to: a.DestinationID, via: via, b: boxOf(n), auto: isTop && trigger == "AFTER_TIMEOUT"})
		}
	}
	for _, ch := range n.Children {
		collect(ch, false, components, uses, navs)
	}
}

func gesture(t string) string {
	switch t {
	case "ON_CLICK":
		return "clic en"
	case "AFTER_TIMEOUT":
		return "sola, después de un tiempo, desde"
	case "":
		return "desde"
	case "ON_HOVER":
		return "al pasar sobre"
	case "ON_DRAG":
		return "al arrastrar"
	}
	return strings.ToLower(t)
}

func firstText(n fullNode) string {
	if reStatusBar.MatchString(n.Name) {
		return ""
	}
	if n.Characters != "" {
		return oneLine(n.Characters)
	}
	for _, ch := range n.Children {
		if t := firstText(ch); t != "" {
			return t
		}
	}
	return ""
}

func oneLine(s string) string {
	s = strings.Join(strings.Fields(s), " ")
	if r := []rune(s); len(r) > 80 {
		return string(r[:80]) + "…"
	}
	return s
}

// isLabel: un rótulo del lienzo son pocos textos, todos grandes, sin nada más que diga algo.
// isLabel: pocos textos, todos grandes, y con forma de franja o de bloque —no de pantalla—. Un marco del
// tamaño de un celular con un solo título grande («VALIDACIÓN DE IDENTIDAD» en Credifamilia) es una
// pantalla.
func isLabel(n fullNode, texts []textNode, b box) bool {
	if len(texts) == 0 || len(texts) > 3 {
		return false
	}
	if b.Height >= 300 && b.Width < b.Height*1.5 {
		return false
	}
	// Un rótulo NOMBRA, no explica: más de 50 caracteres es una nota («Una vez el asesor finaliza el
	// proceso con…» en Altafinanciera, en letra de 50 px).
	if len([]rune(labelText(texts))) > 50 {
		return false
	}
	for _, t := range texts {
		if t.size < labelFont {
			return false
		}
	}
	return n.Type == "TEXT" || n.Type == "FRAME" || n.Type == "GROUP"
}

func labelText(texts []textNode) string {
	var parts []string
	for _, t := range texts {
		parts = append(parts, oneLine(t.text))
	}
	return strings.Join(parts, " · ")
}

var reMarker = regexp.MustCompile(`(?i)^\s*(s[ií]|no|fin|inicio|start|end)\s*[.!]?\s*$`)

// isChoice: una casilla de decisión o un marcador del recorrido. Lo es un rombo; lo que dice «Si»,
// «No», «Fin»; y una casilla chica a la que le llega una flecha («Reenviar nuevamente» en Credifamilia).
// Sin flecha, sólo si su letra es de contenido y no de rótulo: una casilla de una o dos palabras.
func isChoice(n fullNode, texts []textNode, b box, arrowed bool) bool {
	if n.Type == "REGULAR_POLYGON" || n.Type == "STAR" || strings.HasPrefix(n.Name, "Polygon") {
		return true
	}
	if b.Height >= 300 || len(texts) == 0 || len(texts) > 3 {
		return false
	}
	if len(texts) == 1 && reMarker.MatchString(texts[0].text) {
		return true
	}
	if arrowed {
		return true
	}
	big := false
	for _, t := range texts {
		big = big || t.size >= labelFont
	}
	return !big && b.Width <= 300 && len(texts) == 1 && len(strings.Fields(texts[0].text)) <= 2
}

func screenOf(n fullNode, texts []textNode, b box, kind string) Screen {
	sc := Screen{ID: n.ID, Name: n.Name, Kind: kind, X: b.X, Y: b.Y, W: b.Width, H: b.Height}
	// El título, por niveles: la capa que el diseñador llamó «Title»; si no hay, el texto más grande
	// que tenga palabras; si tampoco, el más grande. El más grande a secas era un dato en 6 de las 49
	// pantallas móviles del archivo medido («07-Feb», «3», «$2.000.000»).
	best := [3]float64{-1, -1, -1}
	titles := [3]string{}
	for _, t := range texts {
		if t.status {
			continue
		}
		sc.Texts++
		if t.inButton {
			if a := oneLine(t.text); a != "" && !contains(sc.Actions, a) {
				sc.Actions = append(sc.Actions, a)
			}
			continue
		}
		tier := 2
		if reTitle.MatchString(t.name) {
			tier = 0
		} else if wordy(t.text) {
			tier = 1
		}
		for k := tier; k < 3; k++ {
			if t.size > best[k] {
				best[k], titles[k] = t.size, oneLine(t.text)
			}
		}
	}
	switch {
	case titles[0] != "":
		sc.Title, sc.TitleFrom = titles[0], "texto"
	case titles[1] != "":
		sc.Title, sc.TitleFrom = titles[1], "texto"
	case meaningful(n.Name):
		// Sin un texto que la nombre, la capa dice más que un dato: «Elige tu fecha de pago» contra
		// «07-Feb», u «OTP - 8» contra un dígito del código.
		sc.Title, sc.TitleFrom = n.Name, "capa"
	case titles[2] != "":
		sc.Title, sc.TitleFrom = titles[2], "texto"
	}
	return sc
}

var reGenericLayer = regexp.MustCompile(`(?i)^(frame|group|rectangle|mask group|container|document_?|component|instance|vector|section)\b|\d{5,}`)

// meaningful: un nombre de capa que alguien escribió, no el que Figma pone solo.
func meaningful(name string) bool {
	return reLetter.MatchString(name) && !reGenericLayer.MatchString(strings.TrimSpace(name))
}

var (
	reTitle  = regexp.MustCompile(`(?i)^(title|t[ií]tulo|heading|header)$`)
	reLetter = regexp.MustCompile(`\pL{3,}`)
)

// wordy: dos palabras o más, con letras de verdad — no una fecha, un monto ni un dígito del OTP.
func wordy(s string) bool {
	return len(strings.Fields(s)) >= 2 && reLetter.MatchString(s)
}

func contains(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}

func commentsUnder(n fullNode, open map[string]int) int {
	total := open[n.ID]
	for _, ch := range n.Children {
		total += commentsUnder(ch, open)
	}
	return total
}

func display(sc Screen) string {
	if sc.Title != "" {
		return "«" + sc.Title + "»"
	}
	return sc.Name
}

// lanes arma los carriles: las pantallas se agrupan en FILAS por su posición vertical, y cada fila se
// parte por los rótulos que tiene encima o al lado — una pantalla va con el rótulo más a la derecha que
// esté a su izquierda. Así un carril puede empezar a mitad de fila, que es como está dibujado.
func lanes(screens []Screen, labels []label) []Lane {
	if len(screens) == 0 {
		return nil
	}
	sort.Slice(screens, func(i, j int) bool { return screens[i].Y < screens[j].Y })
	type row struct {
		top, bottom float64
		screens     []Screen
	}
	var rows []*row
	for _, sc := range screens {
		if n := len(rows); n > 0 {
			r := rows[n-1]
			if sc.Y < r.top+math.Min(sc.H, r.bottom-r.top)/2 {
				r.screens = append(r.screens, sc)
				r.bottom = math.Max(r.bottom, sc.Y+sc.H)
				continue
			}
		}
		rows = append(rows, &row{top: sc.Y, bottom: sc.Y + sc.H, screens: []Screen{sc}})
	}
	labels = mergeStacked(labels)
	// Cada rótulo va a la fila que tiene justo debajo (o que lo contiene a la altura).
	byRow := make([][]label, len(rows))
	for _, l := range labels {
		best, dist := -1, math.MaxFloat64
		for i, r := range rows {
			d := r.top - (l.b.Y + l.b.Height)
			if d < -(r.bottom-r.top) || d > 1500 {
				continue
			}
			if math.Abs(d) < dist {
				best, dist = i, math.Abs(d)
			}
		}
		if best >= 0 {
			byRow[best] = append(byRow[best], l)
		}
	}
	// Los rótulos que ya rotulan algo DESDE ARRIBA no pueden rotular desde abajo: en `flujo-ecommerce`
	// cada rótulo va encima de su fila, y como «rótulo de abajo» se pegaba a las pantallas de la fila de
	// encima («No paga cuota inicial» quedaba partido en 3 y 13). Las franjas de abajo de Credifamilia no
	// tienen nada debajo.
	fromAbove := map[string]bool{}
	for _, sc := range screens {
		if l, ok := covering(labels, screens, sc); ok {
			fromAbove[l.id] = true
		}
	}
	var below []label
	for _, l := range labels {
		if !fromAbove[l.id] {
			below = append(below, l)
		}
	}
	var out []Lane
	for i, r := range rows {
		sort.Slice(r.screens, func(a, b int) bool { return r.screens[a].X < r.screens[b].X })
		ls := byRow[i]
		sort.Slice(ls, func(a, b int) bool { return ls[a].b.X < ls[b].b.X })
		var cur *Lane
		for _, sc := range r.screens {
			// Primero, la FRANJA que la cubre: el rótulo más cercano que esté encima y se superponga en
			// horizontal. Es como rotula Motai —franjas de 6.000 px sobre la parte de la fila a la que se
			// refieren, dos sobre la misma fila—, y ahí la regla de la fila fallaba: pantallas sueltas
			// entre medio le robaban el rótulo a la fila de 23 que estaba debajo.
			lab, ok := covering(labels, screens, sc)
			if !ok {
				// Si ninguno la cubre desde arriba, la franja que la cubre desde ABAJO: Credifamilia pone
				// «Asesor» y «Usuario» debajo del recorrido, cada una bajo su tramo.
				lab, ok = coveringBelow(below, screens, sc)
			}
			if !ok {
				// Si tampoco, el rótulo de su fila más a la derecha que esté a su izquierda, y CERCA:
				// como rotula `flujo-ecommerce`, con bloques del ancho de una pantalla al costado. Sin el
				// tope, un rótulo a 6.000 px le ponía «Asesor» a una pantalla de la rama Empleado.
				for _, l := range ls {
					if l.b.X <= sc.X+100 && sc.X-(l.b.X+l.b.Width) <= 2000 {
						lab = l
					}
				}
				// Y si tampoco, sigue el carril de su vecina de la izquierda: un rótulo al comienzo de
				// una fila vale hasta el próximo. En Motai, «Renting alquiler» cubre las primeras 4 de una
				// fila de 23, y las otras 19 quedaban sin rótulo.
				if lab.id == "" && cur != nil {
					lab = label{id: cur.LabelID, text: cur.Label}
				}
			}
			if cur == nil || cur.LabelID != lab.id {
				out = append(out, Lane{Label: lab.text, LabelID: lab.id})
				cur = &out[len(out)-1]
			}
			cur.Screens = append(cur.Screens, sc)
		}
	}
	return out
}

// covering devuelve el rótulo que cubre una pantalla: encima de ella (su borde de abajo no pasa la
// mitad de la pantalla), superpuesto en horizontal, y a menos de 2.500 px. Si hay varios, el más cercano.
// ⚠ Una franja rotula lo que tiene DIRECTAMENTE debajo: si entre ella y la pantalla hay otra pantalla en
// la misma columna, la franja es de esa otra fila, y ésta no la hereda.
func covering(labels []label, screens []Screen, sc Screen) (label, bool) {
	best, gap := label{}, math.MaxFloat64
	for _, l := range labels {
		bottom := l.b.Y + l.b.Height
		if bottom > sc.Y+sc.H/2 {
			continue
		}
		if l.b.X >= sc.X+sc.W || l.b.X+l.b.Width <= sc.X {
			continue
		}
		d := sc.Y - bottom
		if d > 2500 || blocked(screens, sc, bottom) {
			continue
		}
		if d < gap {
			best, gap = l, d
		}
	}
	return best, best.id != ""
}

// mergeStacked funde los rótulos que son RENGLONES de uno solo: alineados a la izquierda (±60 px) y uno
// pegado debajo del otro (menos de 120 px de hueco). En `flujo-ecommerce`, «Salvar mejores» y «Segunda
// oportunidad» son dos marcos a 73 px, y separados partían el carril en uno de 8 y otro de 1.
func mergeStacked(labels []label) []label {
	sort.Slice(labels, func(i, j int) bool { return labels[i].b.Y < labels[j].b.Y })
	var out []label
	used := make([]bool, len(labels))
	for i := range labels {
		if used[i] {
			continue
		}
		cur := labels[i]
		for j := i + 1; j < len(labels); j++ {
			l := labels[j]
			if used[j] || math.Abs(l.b.X-cur.b.X) > 60 {
				continue
			}
			gap := l.b.Y - (cur.b.Y + cur.b.Height)
			if gap < 0 || gap > 120 {
				continue
			}
			used[j] = true
			cur.text += " · " + l.text
			right := math.Max(cur.b.X+cur.b.Width, l.b.X+l.b.Width)
			cur.b.Height = l.b.Y + l.b.Height - cur.b.Y
			cur.b.Width = right - cur.b.X
		}
		out = append(out, cur)
	}
	return out
}

// coveringBelow es covering al revés: una franja DEBAJO de la pantalla, superpuesta en horizontal, sin
// otra pantalla entre medio y a menos de 5.000 px (en Credifamilia «Usuario» está a ~4.500 del recorrido,
// con las ramas por perfil colgando en el medio).
func coveringBelow(labels []label, screens []Screen, sc Screen) (label, bool) {
	best, gap := label{}, math.MaxFloat64
	bottom := sc.Y + sc.H
	for _, l := range labels {
		if l.b.Y < sc.Y+sc.H/2 || l.b.X >= sc.X+sc.W || l.b.X+l.b.Width <= sc.X {
			continue
		}
		d := l.b.Y - bottom
		if d > 5000 || blockedBelow(screens, sc, l.b.Y) {
			continue
		}
		if d < gap {
			best, gap = l, d
		}
	}
	return best, best.id != ""
}

// blockedBelow: hay otra pantalla entre `sc` y el borde de arriba del rótulo, en la misma columna.
func blockedBelow(screens []Screen, sc Screen, labelTop float64) bool {
	for _, o := range screens {
		if o.ID == sc.ID || o.X >= sc.X+sc.W || o.X+o.W <= sc.X {
			continue
		}
		if o.Y >= sc.Y+sc.H-1 && o.Y+o.H <= labelTop+1 {
			return true
		}
	}
	return false
}

// blocked: hay otra pantalla entre el borde de abajo del rótulo y `sc`, superpuesta con ella en horizontal.
func blocked(screens []Screen, sc Screen, labelBottom float64) bool {
	for _, o := range screens {
		if o.ID == sc.ID || o.X >= sc.X+sc.W || o.X+o.W <= sc.X {
			continue
		}
		if o.Y >= labelBottom-1 && o.Y+o.H <= sc.Y+1 {
			return true
		}
	}
	return false
}

func variants(ls []Lane) []Variant {
	groups := map[string]*Variant{}
	var order []string
	for _, l := range ls {
		for _, sc := range l.Screens {
			if sc.Title == "" {
				continue
			}
			k := strings.ToLower(sc.Title)
			v, ok := groups[k]
			if !ok {
				v = &Variant{Title: sc.Title}
				groups[k] = v
				order = append(order, k)
			}
			v.Screens = append(v.Screens, sc.ID)
			lane := l.Label
			if lane == "" {
				lane = "(sin rótulo)"
			}
			if !contains(v.Lanes, lane) {
				v.Lanes = append(v.Lanes, lane)
			}
		}
	}
	var out []Variant
	for _, k := range order {
		if v := groups[k]; len(v.Screens) > 1 {
			out = append(out, *v)
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return len(out[i].Screens) > len(out[j].Screens) })
	return out
}
