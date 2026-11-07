// Package docs arma la documentación de cada herramienta que Jarvis sabe usar (VTEX, …) a partir de lo que ya está
// en el repo, sin una copia escrita a mano que se desalinee:
//
//	APIs       las recetas (jarvis/recipes/<app>/*.ts): qué hacen (su cabecera), con qué camino (la llave de la
//	           cuenta, la sesión de la persona o la pantalla), qué escriben, sus trampas (⚠) y las llamadas de verdad
//	           que hacen (must/call en su código), y las grabaciones del admin (jarvis/maps/<app>/cases/*.json).
//	pantallas  el mapa (map.json: pantallas y elementos con su localizador verificado) y el barrido de secciones
//	           (sections.json), con el nivel 1 en prosa (jarvis/maps/<app>/README.md).
//
// Lo usan el CLI (`bin/jarvis docs`, sin servidor: sirve también desde la nube) y el servidor (`/api/docs`, para la
// pestaña Jarvis de la extensión). Lee archivos y nada más: no corre ninguna receta.
package docs

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

// Call es una llamada a la API que hace una receta, tal como está en su código.
type Call struct {
	Step   string `json:"step,omitempty"` // lo que dice el código que está haciendo («crear la colección»)
	Method string `json:"method"`
	Host   string `json:"host"` // catalog · store · pricing · payments · otro
	Path   string `json:"path"`
}

// Recipe es una tarea completa de una herramienta.
type Recipe struct {
	ID          string   `json:"id"`
	File        string   `json:"file"`
	Title       string   `json:"title"`
	Description string   `json:"description"`
	Usage       []string `json:"usage,omitempty"`
	// Mode es el camino: "api" (la llave de la cuenta: corre en cualquier máquina), "session" (las llamadas del admin
	// con la sesión de la persona, desde su Chrome) o "screen" (maneja el admin en su Chrome).
	Mode       string   `json:"mode"`
	Writes     string   `json:"writes,omitempty"` // qué escribe, si escribe
	Warnings   []string `json:"warnings,omitempty"`
	Calls      []Call   `json:"calls,omitempty"`
	Operations []string `json:"operations,omitempty"` // las operaciones del admin que repite (modo session)
	Case       string   `json:"case,omitempty"`       // la grabación de la que sale, si la hay
}

// CaseCall es una llamada que el admin hizo mientras una persona hacía la tarea a mano.
type CaseCall struct {
	Step      string `json:"step"`
	Method    string `json:"method"`
	Path      string `json:"path"`
	Operation string `json:"operation,omitempty"`
	Status    int    `json:"status,omitempty"`
}

// Case es una grabación de una tarea hecha por pantalla: de ahí sale la receta por API.
type Case struct {
	ID       string     `json:"id"`
	Recorded string     `json:"recorded"`
	Writes   []CaseCall `json:"writes"` // sólo lo que escribe; las lecturas de la pantalla no dicen nada
}

// Element es un campo o botón de una pantalla, con el localizador que Jarvis verificó.
type Element struct {
	Key         string `json:"key"`
	Kind        string `json:"kind"`
	Text        string `json:"text"`
	Locator     string `json:"locator"`
	Fragile     bool   `json:"fragile,omitempty"`
	Conditional string `json:"conditional,omitempty"`
}

// Screen es una pantalla del mapa.
type Screen struct {
	ID       string    `json:"id"`
	Title    string    `json:"title"`
	URL      string    `json:"url"`
	Saved    string    `json:"saved"`
	Elements []Element `json:"elements"`
}

// SweptScreen es una pantalla del menú tal como la vio el barrido.
type SweptScreen struct {
	Name     string   `json:"name"`
	URL      string   `json:"url"`
	Title    string   `json:"title,omitempty"`
	Headings []string `json:"headings,omitempty"`
	APIs     int      `json:"apis"`
}

// Section agrupa las pantallas de una sección del menú.
type Section struct {
	Name    string        `json:"name"`
	Screens []SweptScreen `json:"screens"`
}

// App es todo lo que Jarvis sabe de una herramienta.
type App struct {
	ID       string    `json:"id"`
	Recipes  []Recipe  `json:"recipes"`
	Cases    []Case    `json:"cases"`
	Screens  []Screen  `json:"screens"`
	Sections []Section `json:"sections"`
	Swept    string    `json:"swept,omitempty"`    // cuándo se barrió el menú
	Overview string    `json:"overview,omitempty"` // maps/<app>/README.md (el nivel 1, en prosa)
	Notes    string    `json:"notes,omitempty"`    // recipes/README.md (catálogo y trampas, en prosa)
}

// Apps lista las herramientas que tienen recetas o mapa.
func Apps(root string) []string {
	seen := map[string]bool{}
	for _, dir := range []string{"recipes", "maps"} {
		entries, _ := os.ReadDir(filepath.Join(root, "jarvis", dir))
		for _, e := range entries {
			if e.IsDir() {
				seen[e.Name()] = true
			}
		}
	}
	var out []string
	for a := range seen {
		out = append(out, a)
	}
	sort.Strings(out)
	return out
}

// Load arma la documentación de una herramienta.
func Load(root, app string) (*App, error) {
	a := &App{ID: app, Recipes: []Recipe{}, Cases: []Case{}, Screens: []Screen{}, Sections: []Section{}}
	files, _ := filepath.Glob(filepath.Join(root, "jarvis", "recipes", app, "*.ts"))
	sort.Strings(files)
	for _, f := range files {
		if filepath.Base(f) == "api.ts" {
			continue // el cliente, no una receta
		}
		src, err := os.ReadFile(f)
		if err != nil {
			return nil, err
		}
		r := parseRecipe(string(src))
		r.ID = strings.TrimSuffix(filepath.Base(f), ".ts")
		r.File, _ = filepath.Rel(root, f)
		a.Recipes = append(a.Recipes, r)
	}
	// Del camino más rápido al más visual: la API, la sesión, la pantalla.
	rank := map[string]int{"api": 0, "session": 1, "screen": 2}
	sort.SliceStable(a.Recipes, func(i, j int) bool { return rank[a.Recipes[i].Mode] < rank[a.Recipes[j].Mode] })
	cases, _ := filepath.Glob(filepath.Join(root, "jarvis", "maps", app, "cases", "*.json"))
	sort.Strings(cases)
	for _, f := range cases {
		if c, err := loadCase(f); err == nil {
			a.Cases = append(a.Cases, c)
		}
	}
	a.Screens = loadMap(filepath.Join(root, "jarvis", "maps", app, "map.json"))
	a.Sections, a.Swept = loadSections(filepath.Join(root, "jarvis", "maps", app, "sections.json"))
	if b, err := os.ReadFile(filepath.Join(root, "jarvis", "maps", app, "README.md")); err == nil {
		a.Overview = string(b)
	}
	if b, err := os.ReadFile(filepath.Join(root, "jarvis", "recipes", "README.md")); err == nil {
		a.Notes = string(b)
	}
	return a, nil
}

// ── las recetas ──

var (
	reMust  = regexp.MustCompile("must(?:<[^>(]*>)?\\(\\s*'([^']*)',\\s*'(GET|POST|PUT|DELETE|PATCH)',\\s*`([^`]*)`")
	reCall  = regexp.MustCompile("[^.\\w]call(?:<[^>(]*>)?\\(\\s*'(GET|POST|PUT|DELETE|PATCH)',\\s*`([^`]*)`")
	reConst = regexp.MustCompile("const (\\w+) = `([^`]*)`;")
	reHosts = regexp.MustCompile(`const \{([^}]*)\} = hosts;`)
	reOp    = regexp.MustCompile(`recordedOperation\('[^']*', '([^']*)', '([^']*)'\)`)
	reExpr  = regexp.MustCompile(`\$\{([^}]*)\}`)
	reIdent = regexp.MustCompile(`[A-Za-z_]\w*`)
)

func parseRecipe(src string) Recipe {
	var r Recipe
	// La cabecera: los comentarios de arriba, hasta el primer import.
	var header []string
	for _, l := range strings.Split(src, "\n") {
		if !strings.HasPrefix(l, "//") {
			break
		}
		header = append(header, strings.TrimPrefix(strings.TrimPrefix(l, "//"), " "))
	}
	var prose []string
	for i := 0; i < len(header); i++ {
		l := header[i]
		t := strings.TrimSpace(l)
		switch {
		case strings.Contains(t, "make jarvis-recipe"):
			r.Usage = append(r.Usage, t)
		case strings.HasPrefix(t, "⚠"):
			w := t
			for i+1 < len(header) && continuation(header[i+1]) && !newSentence(w, header[i+1]) {
				i++
				w += " " + strings.TrimSpace(header[i])
			}
			r.Warnings = append(r.Warnings, strings.TrimSpace(strings.TrimPrefix(w, "⚠")))
		case strings.Contains(t, "ESCRIBE"):
			// «ESCRIBE en …» puede empezar en medio de una línea: lo de antes es prosa.
			k := strings.Index(t, "ESCRIBE")
			if k > 0 {
				prose = append(prose, strings.TrimSpace(t[:k]))
			}
			w := t[k:]
			for i+1 < len(header) && continuation(header[i+1]) && !newSentence(w, header[i+1]) {
				i++
				w += " " + strings.TrimSpace(header[i])
			}
			r.Writes = w
		default:
			prose = append(prose, l)
		}
	}
	// El título: el primer párrafo; la descripción: el resto, como está (los bloques con sangría son endpoints).
	title, rest := splitParagraph(prose)
	r.Title = title
	r.Description = strings.TrimSpace(strings.Join(rest, "\n"))

	// Las llamadas, del código: lo que de verdad pide.
	vars := map[string]string{}
	for _, m := range reHosts.FindAllStringSubmatch(src, -1) {
		for _, name := range strings.Split(m[1], ",") {
			if name = strings.TrimSpace(name); name != "" {
				vars[name] = "${hosts." + name + "}"
			}
		}
	}
	for _, m := range reConst.FindAllStringSubmatch(src, -1) {
		vars[m[1]] = m[2]
	}
	seen := map[string]bool{}
	add := func(step, method, raw string) {
		c := toCall(step, method, raw, vars)
		k := c.Method + " " + c.Host + c.Path
		if seen[k] {
			return
		}
		seen[k] = true
		r.Calls = append(r.Calls, c)
	}
	for _, m := range reMust.FindAllStringSubmatch(src, -1) {
		add(m[1], m[2], m[3])
	}
	for _, m := range reCall.FindAllStringSubmatch(src, -1) {
		add("", m[1], m[2])
	}
	for _, m := range reOp.FindAllStringSubmatch(src, -1) {
		r.Case = m[1]
		r.Operations = append(r.Operations, m[2])
	}
	switch {
	case strings.Contains(src, "graphqlInPage("):
		r.Mode = "session"
	case strings.Contains(src, "openChrome(") || strings.Contains(src, "connectOverCDP("):
		r.Mode = "screen"
	default:
		r.Mode = "api"
	}
	if r.Case == "" {
		if m := regexp.MustCompile(`saveCase\('[^']*', '([^']*)'`).FindStringSubmatch(src); m != nil {
			r.Case = m[1]
		}
	}
	return r
}

// continuation dice si una línea de la cabecera sigue el párrafo de la anterior (no es otro bloque).
func continuation(l string) bool {
	t := strings.TrimSpace(l)
	return t != "" && !strings.HasPrefix(t, "⚠") && !strings.HasPrefix(t, "ESCRIBE") && !strings.HasPrefix(l, "  ")
}

// newSentence: un aviso termina donde termina su oración y la línea siguiente empieza otra.
func newSentence(acc, next string) bool {
	t := strings.TrimSpace(next)
	if t == "" || !strings.HasSuffix(strings.TrimSpace(acc), ".") {
		return false
	}
	first := []rune(t)[0]
	return first >= 'A' && first <= 'Z' || first == 'Á' || first == 'É' || first == 'Ó' || first == 'Ú' || first == 'Í'
}

func splitParagraph(lines []string) (string, []string) {
	var first []string
	i := 0
	for ; i < len(lines); i++ {
		if strings.TrimSpace(lines[i]) == "" {
			break
		}
		first = append(first, strings.TrimSpace(lines[i]))
	}
	return strings.Join(first, " "), lines[i:]
}

// toCall resuelve la URL de una llamada: las constantes del archivo (`base`), el host por su nombre y las partes que
// cambian como {nombre}.
func toCall(step, method, raw string, vars map[string]string) Call {
	u := raw
	for i := 0; i < 3; i++ { // las constantes pueden usar otras (base = `${hosts.store}/api`)
		u = reExpr.ReplaceAllStringFunc(u, func(m string) string {
			name := strings.TrimSpace(m[2 : len(m)-1])
			if v, ok := vars[name]; ok {
				return v
			}
			return m
		})
	}
	host := "otro"
	for _, h := range []string{"catalog", "store", "pricing", "admin"} {
		if strings.HasPrefix(u, "${hosts."+h+"}") {
			host, u = h, strings.TrimPrefix(u, "${hosts."+h+"}")
		}
	}
	if strings.Contains(u, "vtexpayments.com.br") {
		host = "payments"
	}
	// Lo que cambia de una vez a otra: {el nombre del dato}.
	u = reExpr.ReplaceAllStringFunc(u, func(m string) string {
		ids := reIdent.FindAllString(m[2:len(m)-1], -1)
		name := "valor"
		for _, id := range ids {
			if id != "encodeURIComponent" && id != "Number" && id != "String" {
				name = id
			}
		}
		return "{" + name + "}"
	})
	if i := strings.Index(u, "?"); i >= 0 && len(u) > i+60 {
		u = u[:i+60] + "…"
	}
	return Call{Step: step, Method: method, Host: host, Path: u}
}

// ── las grabaciones ──

var reads = regexp.MustCompile(`^(get|list|search|count|collections?|products|brands|permission|totalProducts|productsName|productsOrder|subcollections|collectionBrands|collection$|integrationStatus|locales|topbarData)`)

func loadCase(path string) (Case, error) {
	var raw struct {
		Case     string `json:"case"`
		Recorded string `json:"recorded"`
		Network  []struct {
			Step      string `json:"step"`
			Method    string `json:"method"`
			URL       string `json:"url"`
			Operation string `json:"operation"`
			Status    int    `json:"status"`
		} `json:"network"`
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return Case{}, err
	}
	if err := json.Unmarshal(b, &raw); err != nil {
		return Case{}, err
	}
	c := Case{ID: raw.Case, Recorded: raw.Recorded, Writes: []CaseCall{}}
	if c.ID == "" {
		c.ID = strings.TrimSuffix(filepath.Base(path), ".json")
	}
	for _, n := range raw.Network {
		if n.Operation != "" && reads.MatchString(n.Operation) {
			continue
		}
		if n.Operation == "" && n.Method == "GET" {
			continue
		}
		p := n.URL
		if i := strings.Index(p, "://"); i >= 0 {
			if j := strings.Index(p[i+3:], "/"); j >= 0 {
				p = p[i+3+j:]
			}
		}
		c.Writes = append(c.Writes, CaseCall{Step: n.Step, Method: n.Method, Path: p, Operation: n.Operation, Status: n.Status})
	}
	return c, nil
}

// ── las pantallas ──

func loadMap(path string) []Screen {
	var raw struct {
		Screens map[string]struct {
			URL      string `json:"url"`
			Title    string `json:"title"`
			Saved    string `json:"saved"`
			Elements map[string]struct {
				Kind        string `json:"kind"`
				Text        string `json:"text"`
				Locator     string `json:"locator"`
				Fragile     bool   `json:"fragile"`
				Conditional string `json:"conditional"`
			} `json:"elements"`
		} `json:"screens"`
	}
	b, err := os.ReadFile(path)
	if err != nil || json.Unmarshal(b, &raw) != nil {
		return []Screen{}
	}
	out := []Screen{}
	for id, s := range raw.Screens {
		sc := Screen{ID: id, Title: s.Title, URL: s.URL, Saved: s.Saved, Elements: []Element{}}
		for k, e := range s.Elements {
			sc.Elements = append(sc.Elements, Element{Key: k, Kind: e.Kind, Text: e.Text, Locator: e.Locator, Fragile: e.Fragile, Conditional: e.Conditional})
		}
		sort.Slice(sc.Elements, func(i, j int) bool { return sc.Elements[i].Key < sc.Elements[j].Key })
		out = append(out, sc)
	}
	// El armazón primero; después, por nombre.
	sort.Slice(out, func(i, j int) bool {
		if (out[i].ID == "admin") != (out[j].ID == "admin") {
			return out[i].ID == "admin"
		}
		return out[i].ID < out[j].ID
	})
	return out
}

func loadSections(path string) ([]Section, string) {
	var raw struct {
		Swept   string `json:"swept"`
		Screens []struct {
			Section  string            `json:"section"`
			Name     string            `json:"name"`
			URL      string            `json:"url"`
			Title    string            `json:"title"`
			Headings []string          `json:"headings"`
			APIs     []json.RawMessage `json:"apis"`
		} `json:"screens"`
	}
	b, err := os.ReadFile(path)
	if err != nil || json.Unmarshal(b, &raw) != nil {
		return []Section{}, ""
	}
	var out []Section
	idx := map[string]int{}
	for _, s := range raw.Screens {
		i, ok := idx[s.Section]
		if !ok {
			i = len(out)
			idx[s.Section] = i
			out = append(out, Section{Name: s.Section, Screens: []SweptScreen{}})
		}
		out[i].Screens = append(out[i].Screens, SweptScreen{Name: s.Name, URL: s.URL, Title: s.Title, Headings: s.Headings, APIs: len(s.APIs)})
	}
	if out == nil {
		out = []Section{}
	}
	return out, raw.Swept
}
