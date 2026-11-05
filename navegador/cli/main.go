// Command navegador maneja por consola la sesión EN VIVO del navegador (la misma que se ve en el editor de
// `make navegador`): abrir un sitio, mirar qué hay para tocar, actuar sobre un elemento por su número y
// verificar el resultado. Habla con la API (:5203), así que la interfaz tiene que estar levantada.
//
//	bin/navegador sites                          los sitios dados de alta
//	bin/navegador open <sitio|url> [url]         abre la sesión en vivo (una URL nueva se da de alta sola)
//	bin/navegador look [--todo]                  la página actual: sus elementos numerados, con su localizador
//	                                             (los enlaces del menú y el pie se resumen; --todo los muestra)
//	bin/navegador click <n> | dblclick <n> | hover <n> | fill <n> <valor> | check <n> | uncheck <n>
//	              select <n> <valor> | press <n> <tecla> | upload <n> <archivo> | drag <n> <destino>
//	              (<n>: el número del último look, o un texto visible: dblclick "Revisar el informe")
//	bin/navegador dialog accept|dismiss          cómo contestar los próximos alert/confirm (por defecto, aceptar)
//	bin/navegador scroll [n]                     baja la página entera, o la zona con scroll n hasta el final
//	bin/navegador goto <url> | back | reload
//	bin/navegador text [buscar]                  el texto visible (o si aparece `buscar`)
//	bin/navegador wait <texto> [segundos]        espera a que el texto se vea (queda como aserción en el script)
//	bin/navegador value <n> [esperado]           el valor de un campo; con esperado, queda como toHaveValue
//	bin/navegador download <n|texto|url>         baja un enlace o la imagen que envuelve (a .data/descargas)
//	bin/navegador images                         las imágenes visibles: tamaño, archivo y texto alternativo
//	bin/navegador media [--afirmar]              si los videos/audios suenan; con --afirmar espera que avance y queda como aserción
//	bin/navegador shot <archivo.png>             guarda lo que se ve ahora
//	bin/navegador steps | script | reset         los pasos hechos, como script de Playwright, o de cero
//	bin/navegador report [meta]                  el paso a paso con una foto por paso (md, html y script)
//	bin/navegador close                          cierra la sesión en vivo
//	bin/navegador ask [--url URL] "<meta>"       Claude maneja la sesión en vivo hasta cumplir la meta (ask.go)
//	bin/navegador evals [--solo X]               corre las metas de navegador/evals/casos.json y compara (evals.go)
//
// Después de cada acción muestra la página como quedó. Los números valen para el ÚLTIMO `look`: si la página
// cambió entre medio, la acción se niega en vez de tocar otro elemento.
//
// CONVENCIÓN: identificadores en inglés, comentarios y texto visible en español.
package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

var api = envOr("NAVEGADOR_API", "http://127.0.0.1:5203")

// lookAll: mostrar también los enlaces del menú, el encabezado y el pie, que se repiten en cada página y por
// defecto se resumen en una línea (cada look los repetía: tokens y lectura de más).
var lookAll bool

// lookQuery: look --buscar 'texto' muestra sólo los elementos cuyo nombre lo contiene.
var lookQuery string

func envOr(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}

func main() {
	if len(os.Args) < 2 {
		usage()
	}
	cmd, args := os.Args[1], os.Args[2:]
	var err error
	switch cmd {
	case "sites":
		err = sites()
	case "ask":
		err = ask(args)
	case "evals":
		err = evals(args)
	case "open":
		err = open(args)
	case "look":
		for i := 0; i < len(args); i++ {
			switch args[i] {
			case "--todo":
				lookAll = true
			case "--buscar":
				if i+1 < len(args) {
					lookQuery = strings.Join(args[i+1:], " ")
					i = len(args)
				}
			}
		}
		err = look(true)
	case "click", "dblclick", "hover", "check", "uncheck":
		err = act(cmd, args, false)
	case "fill", "select", "press", "upload", "drag":
		err = act(cmd, args, true)
	case "dialog":
		if len(args) < 1 || (args[0] != "accept" && args[0] != "dismiss") {
			usage()
		}
		err = call(http.MethodPost, "/api/live/dialog", map[string]bool{"dismiss": args[0] == "dismiss"}, nil)
		if err == nil {
			fmt.Printf("los próximos diálogos se van a %s\n", map[bool]string{true: "rechazar", false: "aceptar"}[args[0] == "dismiss"])
		}
	case "scroll": // sin número, la página entera; con número, una zona con scroll hasta el final
		if len(args) == 0 {
			err = nav("scroll", "")
		} else {
			err = act("scroll", args, false)
		}
	case "goto":
		if len(args) < 1 {
			usage()
		}
		err = nav("goto", args[0])
	case "back", "forward", "reload":
		err = nav(cmd, "")
	case "text":
		err = text(args)
	case "wait":
		err = wait(args)
	case "value":
		err = value(args)
	case "download":
		err = download(args)
	case "media":
		if len(args) > 0 && args[0] == "--afirmar" {
			var step struct{ Code, Note string }
			if err = call(http.MethodPost, "/api/live/media-expect", nil, &step); err == nil {
				fmt.Printf("✓ %s\n  %s\n", step.Code, step.Note)
			}
		} else {
			err = media()
		}
	case "images":
		err = images()
	case "shot":
		err = shot(args)
	case "steps":
		err = steps()
	case "script":
		err = script()
	case "report":
		err = report(args)
	case "reset":
		err = call(http.MethodDelete, "/api/live/steps", nil, nil)
	case "close":
		err = call(http.MethodPost, "/api/live/stop", nil, nil)
	default:
		usage()
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "navegador:", err)
		os.Exit(1)
	}
}

func usage() {
	fmt.Fprintln(os.Stderr, `uso: bin/navegador <comando>
  sites · open <sitio|url> [url] · look [--todo | --buscar texto] · close
  click <n> · dblclick <n> · hover <n> · fill <n> <valor> · check <n> · uncheck <n> · select <n> <valor>
  press <n> <tecla> · upload <n> <archivo> · drag <n> <destino> · dialog accept|dismiss
  (<n> es el número del último look, o un texto visible entre comillas: click "Revisar el informe")
  scroll [n] · goto <url> · back · reload · text [buscar] · wait <texto> [s] · value <n> [esperado] · download <n|texto|url> · images · media [--afirmar] · shot <archivo.png>
  steps · script · report [meta] · reset
  ask [--url URL] [--pasos 40] [--respuesta R] "<meta>"   Claude maneja la sesión hasta cumplir la meta
  evals [--solo X] [--sin-internet] [-v]                 la suite de regresión de ask (navegador/evals)`)
	os.Exit(2)
}

// ── la API ──

func call(method, path string, body, out any) error {
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, api+path, rd)
	req.Header.Set("Content-Type", "application/json")
	res, err := (&http.Client{Timeout: 120 * time.Second}).Do(req)
	if err != nil {
		return fmt.Errorf("la API no contesta en %s: ¿está levantado `make navegador`? (%v)", api, err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	if res.StatusCode >= 300 {
		var e struct{ Error string }
		if json.Unmarshal(raw, &e) == nil && e.Error != "" {
			return errors.New(e.Error)
		}
		return fmt.Errorf("HTTP %d: %s", res.StatusCode, strings.TrimSpace(string(raw)))
	}
	if out != nil {
		if s, ok := out.(*string); ok {
			*s = string(raw)
			return nil
		}
		return json.Unmarshal(raw, out)
	}
	return nil
}

type site struct {
	Slug, Name, URL, Host string
	Pages                 int
	Queued                int
}

type control struct {
	ID       int
	Kind     string
	Name     string
	Action   string
	Form     int
	Best     int
	Checked  *bool
	Disabled bool
	Blocked  bool
	Frame    string
	Zone     string
	Box      struct{ X, Y, W, H int }
	AtEnd    *bool
	Options  []struct{ Value, Label string }
	Locators []struct {
		Kind, Code string
		Count      int
		Works      bool
	}
}

type liveState struct {
	Active  bool
	Site    string
	URL     string
	Title   string
	Version int
	Page    *struct {
		Status   int
		Controls []control
		Console  []string
		Notices  []string
	}
	Steps []struct {
		Code, Error string
		OK          bool
	}
	Dialogs []string
	Height  int
	ScrollY float64
}

// La versión del último `look`, para que un número viejo no toque otro elemento.
func versionFile() string {
	dir, _ := os.UserCacheDir()
	return filepath.Join(dir, "navegador", "look-version")
}

func saveVersion(v int) {
	_ = os.MkdirAll(filepath.Dir(versionFile()), 0o755)
	_ = os.WriteFile(versionFile(), []byte(strconv.Itoa(v)), 0o644)
}

func lastVersion() int {
	b, _ := os.ReadFile(versionFile())
	v, _ := strconv.Atoi(strings.TrimSpace(string(b)))
	return v
}

// ── los comandos ──

func sites() error {
	var list []site
	if err := call(http.MethodGet, "/api/sites", nil, &list); err != nil {
		return err
	}
	for _, s := range list {
		fmt.Printf("%-32s %4d páginas  %s\n", s.Slug, s.Pages, s.URL)
	}
	return nil
}

func open(args []string) error {
	if len(args) < 1 {
		usage()
	}
	if err := startLive(args, false); err != nil {
		return err
	}
	return look(true)
}

// startLive deja la sesión en vivo abierta en el sitio (o la URL) pedido, sin mostrar la página. Con clean
// abre SIEMPRE una sesión nueva con un perfil limpio (la que hubiera se cierra): sin el login ni lo guardado
// de corridas anteriores.
func startLive(args []string, clean bool) error {
	slug, start := args[0], ""
	if len(args) > 1 {
		start = args[1]
	}
	// Una URL en vez de un sitio: se busca el sitio de ese host y, si no hay, se da de alta.
	if strings.Contains(slug, "://") || strings.Contains(slug, ".") {
		raw := slug
		if !strings.Contains(raw, "://") {
			raw = "https://" + raw
		}
		u, err := url.Parse(raw)
		if err != nil {
			return err
		}
		var list []site
		if err := call(http.MethodGet, "/api/sites", nil, &list); err != nil {
			return err
		}
		slug = ""
		for _, s := range list {
			if s.Host == u.Host {
				slug = s.Slug
			}
		}
		if slug == "" {
			var s site
			if err := call(http.MethodPost, "/api/sites", map[string]string{"url": raw}, &s); err != nil {
				return err
			}
			slug = s.Slug
			fmt.Printf("sitio nuevo: %s\n", slug)
		}
		if start == "" {
			start = raw
		}
	}
	// Si ya hay una sesión en vivo: del mismo sitio, se reusa y se navega; de otro, se cierra primero.
	var st liveState
	if err := call(http.MethodGet, "/api/live/state", nil, &st); err == nil && st.Active {
		if st.Site == slug && !clean {
			if start == "" {
				return nil
			}
			return call(http.MethodPost, "/api/live/nav", map[string]string{"action": "goto", "url": start}, nil)
		}
		if err := call(http.MethodPost, "/api/live/stop", nil, nil); err != nil {
			return err
		}
		// Cerrar es asincrónico: se espera a que termine de verdad (con un segundo fijo a veces no alcanzaba).
		for i := 0; i < 50; i++ {
			var busy struct{ Busy bool }
			if err := call(http.MethodGet, "/api/state?since=999999999", nil, &busy); err == nil && !busy.Busy {
				break
			}
			time.Sleep(200 * time.Millisecond)
		}
	}
	q := "site=" + url.QueryEscape(slug)
	if start != "" {
		q += "&start=" + url.QueryEscape(start)
	}
	if clean {
		q += "&clean=1"
	}
	return call(http.MethodPost, "/api/live/start?"+q, nil, nil)
}

func look(fresh bool) error {
	var st liveState
	path := "/api/live/state"
	if fresh {
		path += "?fresh=1"
	}
	if err := call(http.MethodGet, path, nil, &st); err != nil {
		return err
	}
	if !st.Active {
		return errors.New("no hay sesión en vivo: abrí una con `bin/navegador open <sitio|url>`")
	}
	saveVersion(st.Version)
	fmt.Printf("%s\n%s\n", st.Title, st.URL)
	if st.Page == nil {
		fmt.Println("(todavía sin analizar)")
		return nil
	}
	if len(st.Page.Console) > 0 {
		fmt.Printf("⚠ %d errores de consola\n", len(st.Page.Console))
	}
	for _, d := range st.Dialogs {
		fmt.Printf("diálogo: %s\n", d)
	}
	for _, n := range st.Page.Notices {
		fmt.Printf("aviso: %s\n", n)
	}

	// Qué se muestra. En una página chica, todo (menos los enlaces del menú y el pie). En una grande (YouTube trae
	// 140 elementos, 21 «Más acciones» con rutas CSS de 20 niveles) eso es caro de leer: primero lo que está en
	// pantalla, los repetidos agrupados, con tope, y una línea que dice cuánto quedó afuera y cómo verlo.
	var pool []control
	navHidden := 0
	for _, c := range st.Page.Controls {
		if !lookAll && lookQuery == "" && c.Kind == "link" && (c.Zone == "navigation" || c.Zone == "banner" || c.Zone == "contentinfo") {
			navHidden++
			continue
		}
		if lookQuery != "" && !strings.Contains(fold(c.Name), fold(lookQuery)) {
			continue
		}
		pool = append(pool, c)
	}
	limit := 40
	if lookAll {
		limit = len(pool)
	}
	onScreen := func(c control) bool {
		return float64(c.Box.Y+c.Box.H) > st.ScrollY && float64(c.Box.Y) < st.ScrollY+float64(st.Height)
	}
	// Los repetidos (mismo tipo y nombre) se muestran una vez, con sus números.
	type group struct {
		first control
		nums  []int
	}
	var groups []*group
	byKey := map[string]*group{}
	for _, c := range pool {
		key := c.Kind + "|" + c.Name
		if g, ok := byKey[key]; ok && !lookAll && lookQuery == "" {
			g.nums = append(g.nums, c.ID+1)
			continue
		}
		g := &group{first: c, nums: []int{c.ID + 1}}
		byKey[key] = g
		groups = append(groups, g)
	}
	shown := groups
	offScreen := 0
	if len(groups) > limit {
		// Primero los que se ven, después los demás, en el orden de la página; hasta el tope.
		var vis, rest []*group
		for _, g := range groups {
			if onScreen(g.first) {
				vis = append(vis, g)
			} else {
				rest = append(rest, g)
			}
		}
		shown = append(vis, rest...)[:limit]
		sort.Slice(shown, func(i, j int) bool { return shown[i].first.ID < shown[j].first.ID })
		for _, g := range append(vis, rest...)[limit:] {
			if !onScreen(g.first) {
				offScreen++
			}
		}
	}
	kinds := map[string]string{"field": "campo", "select": "desplegable", "check": "casilla", "button": "botón", "link": "enlace", "scroll": "con scroll", "file": "archivo", "drag": "arrastrable"}
	for _, g := range shown {
		c := g.first
		loc := "SIN LOCALIZADOR ÚNICO"
		if c.Best >= 0 {
			loc = c.Locators[c.Best].Code
		}
		if !lookAll && len([]rune(loc)) > 110 {
			loc = trim(loc, 110) + "  (completo: look --todo)"
		}
		extra := ""
		if c.Checked != nil {
			extra = map[bool]string{true: " [marcada]", false: " [sin marcar]"}[*c.Checked]
		}
		if c.AtEnd != nil {
			extra += map[bool]string{true: " [leída hasta el final]", false: " [falta bajar]"}[*c.AtEnd]
		}
		if c.Disabled {
			extra += " [deshabilitado]"
		}
		if c.Blocked {
			extra += " [detrás del modal]"
		}
		if c.Frame != "" {
			extra += " [en " + c.Frame + "]"
		}
		if len(g.nums) > 1 {
			nums := []string{}
			for i, n := range g.nums {
				if i == 6 {
					nums = append(nums, "…")
					break
				}
				nums = append(nums, strconv.Itoa(n))
			}
			extra += fmt.Sprintf(" ×%d (números %s)", len(g.nums), strings.Join(nums, ", "))
		}
		fmt.Printf("%3d  %-11s «%s»%s\n       %s\n", c.ID+1, kinds[c.Kind], trim(c.Name, 60), extra, loc)
		if len(c.Options) > 0 {
			opts := []string{}
			for _, o := range c.Options {
				opts = append(opts, fmt.Sprintf("%s=%q", o.Value, o.Label))
			}
			fmt.Printf("       opciones: %s\n", strings.Join(opts, " · "))
		}
	}
	if len(shown) < len(groups) {
		fmt.Printf("  (se muestran %d de %d · %d más abajo o arriba de la pantalla · look --buscar 'texto' para encontrar algo · look --todo para todo)\n", len(shown), len(groups), offScreen)
	}
	if navHidden > 0 {
		fmt.Printf("  (+%d enlaces del menú, el encabezado y el pie: look --todo)\n", navHidden)
	}
	if lookQuery != "" && len(pool) == 0 {
		fmt.Printf("  (nada se llama «%s»)\n", lookQuery)
	}
	return nil
}

// fold pasa a minúsculas y sin acentos, para buscar «Lose yourself» como «Lose Yourself».
func fold(s string) string {
	r := strings.NewReplacer("á", "a", "é", "e", "í", "i", "ó", "o", "ú", "u", "ü", "u", "ñ", "n")
	return r.Replace(strings.ToLower(s))
}

func act(action string, args []string, needsValue bool) error {
	if len(args) < 1 || (needsValue && len(args) < 2) {
		usage()
	}
	body := map[string]any{"action": action, "version": lastVersion()}
	// El objetivo es el número de un elemento del último look o, si no es un número, su texto visible.
	if n, err := strconv.Atoi(args[0]); err == nil && n >= 1 {
		body["control"] = n - 1
	} else {
		body["text"] = args[0]
	}
	if needsValue {
		value := strings.Join(args[1:], " ")
		if action == "upload" {
			if abs, err := filepath.Abs(value); err == nil {
				value = abs
			}
		}
		body["value"] = value
	}
	var step struct {
		Code    string
		Dialogs []string
		Note    string
	}
	if err := call(http.MethodPost, "/api/live/act", body, &step); err != nil {
		return err
	}
	for _, d := range step.Dialogs {
		fmt.Printf("diálogo: %s\n", d)
	}
	if step.Note != "" {
		fmt.Println(step.Note)
	}
	fmt.Printf("✓ %s\n\n", step.Code)
	return look(true)
}

func nav(action, target string) error {
	if err := call(http.MethodPost, "/api/live/nav", map[string]string{"action": action, "url": target}, nil); err != nil {
		return err
	}
	return look(true)
}

func text(args []string) error {
	var out struct{ Text string }
	if err := call(http.MethodGet, "/api/live/text", nil, &out); err != nil {
		return err
	}
	if len(args) == 0 {
		fmt.Println(out.Text)
		return nil
	}
	needle := strings.Join(args, " ")
	if strings.Contains(out.Text, needle) {
		fmt.Printf("✓ aparece «%s»\n", needle)
		return nil
	}
	return fmt.Errorf("no aparece «%s»", needle)
}

// wait espera (en el servidor, con la espera de Playwright) a que el texto se vea, y queda como aserción del script.
func wait(args []string) error {
	if len(args) < 1 {
		usage()
	}
	needle, secs := args[0], 15
	if len(args) > 1 {
		if s, err := strconv.Atoi(args[1]); err == nil {
			secs = s
		}
	}
	var step struct{ Code string }
	if err := call(http.MethodPost, "/api/live/expect", map[string]any{"text": needle, "seconds": secs}, &step); err != nil {
		return err
	}
	fmt.Printf("✓ %s\n\n", step.Code)
	// Lo que se esperaba casi siempre cambió la página: se muestra como quedó, con los números nuevos.
	return look(true)
}

// download baja el recurso de un elemento (un enlace, o la imagen que envuelve) o de una URL.
func download(args []string) error {
	if len(args) < 1 {
		usage()
	}
	body := map[string]any{}
	switch n, err := strconv.Atoi(args[0]); {
	case err == nil && n >= 1:
		body["control"] = n - 1
	case strings.Contains(args[0], "://"):
		body["url"] = args[0]
	default:
		body["text"] = strings.Join(args, " ")
	}
	var step struct{ Code, Note string }
	if err := call(http.MethodPost, "/api/live/download", body, &step); err != nil {
		return err
	}
	fmt.Printf("✓ %s\n  %s\n", step.Code, step.Note)
	return nil
}

// images lista las imágenes visibles de la página, las más grandes primero.
func images() error {
	var list []struct {
		Alt     string
		Ancho   int
		Alto    int
		Archivo string
	}
	if err := call(http.MethodGet, "/api/live/images", nil, &list); err != nil {
		return err
	}
	for _, i := range list {
		alt := i.Alt
		if alt == "" {
			alt = "(sin texto alternativo)"
		}
		fmt.Printf("%4d×%-4d %s · %s\n", i.Ancho, i.Alto, trim(i.Archivo, 60), trim(alt, 60))
	}
	return nil
}

// media dice si los videos y audios de la página están sonando, por dónde van y cuánto duran.
func media() error {
	var list []struct {
		Tipo       string
		Sonando    bool
		Segundo    float64
		Duracion   *float64
		Silenciado bool
	}
	if err := call(http.MethodGet, "/api/live/media", nil, &list); err != nil {
		return err
	}
	if len(list) == 0 {
		fmt.Println("no hay videos ni audios en la página")
		return nil
	}
	for i, m := range list {
		dur := "?"
		if m.Duracion != nil {
			dur = fmt.Sprintf("%.0f s", *m.Duracion)
		}
		state := "en pausa"
		if m.Sonando {
			state = "SONANDO"
		}
		mute := ""
		if m.Silenciado {
			mute = " · silenciado"
		}
		fmt.Printf("%d %s · %s · va por %.1f s de %s%s\n", i+1, m.Tipo, state, m.Segundo, dur, mute)
	}
	return nil
}

// value lee el valor de un campo; con un esperado, lo compara y queda como aserción (toHaveValue).
func value(args []string) error {
	if len(args) < 1 {
		usage()
	}
	body := map[string]any{}
	if n, err := strconv.Atoi(args[0]); err == nil && n >= 1 {
		body["control"] = n - 1
	} else {
		body["text"] = args[0]
	}
	if len(args) > 1 {
		body["expected"] = strings.Join(args[1:], " ")
	}
	var out struct {
		Value string
		Step  struct{ Code string }
	}
	if err := call(http.MethodPost, "/api/live/value", body, &out); err != nil {
		return err
	}
	if out.Step.Code != "" {
		fmt.Printf("✓ %s\n", out.Step.Code)
		return nil
	}
	fmt.Printf("«%s»\n", out.Value)
	return nil
}

func shot(args []string) error {
	if len(args) < 1 {
		usage()
	}
	res, err := http.Get(api + "/api/live/shot")
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(res.Body)
		return fmt.Errorf("HTTP %d: %s", res.StatusCode, strings.TrimSpace(string(b)))
	}
	f, err := os.Create(args[0])
	if err != nil {
		return err
	}
	defer f.Close()
	if _, err := io.Copy(f, res.Body); err != nil {
		return err
	}
	fmt.Println(args[0])
	return nil
}

func steps() error {
	var st liveState
	if err := call(http.MethodGet, "/api/live/state", nil, &st); err != nil {
		return err
	}
	for i, s := range st.Steps {
		mark := "✓"
		if !s.OK {
			mark = "✗"
		}
		fmt.Printf("%2d %s %s", i+1, mark, s.Code)
		if s.Error != "" {
			fmt.Printf("  (%s)", s.Error)
		}
		fmt.Println()
	}
	return nil
}

// report escribe el paso a paso de la corrida (md, html con las fotos de cada paso y script) y dice dónde.
func report(args []string) error {
	path, err := writeReport(strings.Join(args, " "), "")
	if err != nil {
		return err
	}
	fmt.Println(path)
	return nil
}

func writeReport(goal, result string) (string, error) {
	var out struct{ Dir, HTML, MD, URL string }
	if err := call(http.MethodPost, "/api/live/report", map[string]string{"meta": goal, "resultado": result}, &out); err != nil {
		return "", err
	}
	return out.URL + "\n  (en disco: " + out.Dir + ")", nil
}

func script() error {
	var s string
	if err := call(http.MethodGet, "/api/live/script", nil, &s); err != nil {
		return err
	}
	fmt.Print(s)
	return nil
}

func trim(s string, n int) string {
	if r := []rune(s); len(r) > n {
		return string(r[:n-1]) + "…"
	}
	return s
}
