// Command navegador maneja por consola la sesión EN VIVO del navegador (la misma que se ve en el editor de
// `make navegador`): abrir un sitio, mirar qué hay para tocar, actuar sobre un elemento por su número y
// verificar el resultado. Habla con la API (:5203), así que la interfaz tiene que estar levantada.
//
//	bin/navegador open [--movil] <url>           abre la sesión en vivo en esa URL
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
//	bin/navegador download <n|texto|url>         baja lo que apunta un enlace (un export, un reporte) a .data/descargas
//	bin/navegador read [--desde N|--buscar t]    el texto de la pantalla, legible: los textos de ayuda de una configuración
//	bin/navegador point <n> '<instrucción>'      modo guía: marca el elemento en la página en vivo y espera a que la
//	                                             persona lo haga (guide.go del servidor)
//	bin/navegador cambios                        lo que cambió en cada campo desde el último guardar (antes → después)
//	bin/navegador empezar [--url U] '<meta>'     abre una sesión de Claude desde la conversación: el panel de la interfaz
//	              pienso '<texto>'              muestra cada comando, lo que piensa (pienso) y cómo terminó (terminar,
//	              terminar 'LISTO: …'           que guarda la corrida y, con LISTO, el flujo)
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
	"regexp"
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

// tabID es la pestaña a la que le habla este comando (--sesion N o NAVEGADOR_SESION); vacía, la última que se abrió.
var tabID = os.Getenv("NAVEGADOR_SESION")

// takeTabFlag saca `--sesion N` de los argumentos, esté donde esté.
func takeTabFlag(argv []string) []string {
	out := argv[:0:0]
	for i := 0; i < len(argv); i++ {
		if (argv[i] == "--sesion" || argv[i] == "--pestana") && i+1 < len(argv) {
			tabID = argv[i+1]
			i++
			continue
		}
		out = append(out, argv[i])
	}
	return out
}

func main() {
	os.Args = takeTabFlag(os.Args)
	if len(os.Args) < 2 {
		usage()
	}
	cmd, args := os.Args[1], os.Args[2:]
	// En una sesión de Claude desde la conversación, cada comando aparece en el panel de la interfaz (si no hay
	// sesión abierta, el servidor lo ignora). Dentro de ask no: sus eventos ya van por su propio canal.
	inSession := cmd != "ask" && cmd != "evals" && cmd != "empezar" && cmd != "pienso" && cmd != "terminar" && os.Getenv("NAVEGADOR_ASK") == "" && os.Getenv("NAVEGADOR_EVENTS") == ""
	if inSession {
		panelEvent("act", "navegador "+shellLine(os.Args[1:]))
	}
	var err error
	switch cmd {
	case "empezar":
		err = begin(args)
	case "pestanas", "pestañas":
		err = tabsCmd(args)
	case "pienso":
		if len(args) == 0 {
			usage()
		}
		err = panelEvent("think", strings.Join(args, " "))
	case "terminar":
		err = finish(args)
	case "proyecto":
		if len(args) < 3 {
			usage()
		}
		err = call(http.MethodPost, "/api/projects", map[string]string{"id": args[0], "nombre": args[1], "url": args[2]}, nil)
		if err == nil {
			fmt.Printf("proyecto «%s» (navegador/flujos/%s/): los flujos de %s quedan ahí\n", args[1], args[0], args[2])
		}
	case "ask":
		err = ask(args)
	case "evals":
		err = evals(args)
	case "open":
		err = open(args)
	case "device":
		err = device(args)
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
	case "point":
		err = point(args)
	case "cambios":
		err = changes()
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
		if err = guideRefuses("goto"); err != nil {
			break
		}
		err = nav("goto", args[0])
	case "back", "forward", "reload":
		if err = guideRefuses(cmd); err != nil {
			break
		}
		err = nav(cmd, "")
	case "text":
		err = text(args)
	case "wait":
		err = wait(args)
	case "value":
		err = value(args)
	case "download":
		err = download(args)
	case "read":
		err = read(args)
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
		if inSession {
			panelEvent("fail", err.Error())
		}
		fmt.Fprintln(os.Stderr, "navegador:", err)
		os.Exit(1)
	}
}

func usage() {
	fmt.Fprintln(os.Stderr, `uso: bin/navegador <comando>
  open [--movil] <url> · device [movil|escritorio] · look [--todo | --buscar texto] · close
  click <n> · dblclick <n> · hover <n> · fill <n> <valor> · check <n> · uncheck <n> · select <n> <valor>
  press <n> <tecla> · upload <n> <archivo> · drag <n> <destino> · dialog accept|dismiss
  (<n> es el número del último look, o un texto visible entre comillas: click "Revisar el informe")
  scroll [n] · goto <url> · back · reload · text [buscar] · wait <texto> [s] · value <n> [esperado] · download <n|texto|url> · read [--desde N | --buscar texto] · shot <archivo.png>
  point <n> '<instrucción>' (modo guía: marca y espera a la persona) · cambios (lo que cambió en cada campo)
  empezar [--url U] '<meta>' · pienso '<texto>' · terminar 'LISTO: …'   una sesión de Claude desde la conversación, a la vista en el panel
  pestanas [cerrar N]   las pestañas abiertas (cada una, su sesión). Cualquier comando: --sesion N (o NAVEGADOR_SESION=N);
                        sin eso, la última que se abrió. empezar abre una nueva si en la actual ya trabaja otro Claude
  proyecto <id> '<nombre>' <url>   un proyecto con nombre propio para un sitio real (sus flujos van a navegador/flujos/<id>)
  steps · script · report [meta] · reset
  ask [--url URL] [--movil] [--pasos 40] [--respuesta R] "<meta>"   Claude maneja la sesión hasta cumplir la meta
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
	if tabID != "" {
		req.Header.Set("X-Navegador-Tab", tabID)
	}
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
	Device  string
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

// Y cómo se llamaba cada número en ese look: si la página cambió pero el número sigue nombrando lo mismo, la
// acción puede seguir.
func namesFile() string { return versionFile() + ".nombres" }

func saveNames(controls []control) {
	m := map[int]string{}
	for _, c := range controls {
		m[c.ID] = c.Name
	}
	b, _ := json.Marshal(m)
	_ = os.WriteFile(namesFile(), b, 0o644)
}

func lastName(id int) string {
	b, err := os.ReadFile(namesFile())
	if err != nil {
		return ""
	}
	m := map[int]string{}
	_ = json.Unmarshal(b, &m)
	return m[id]
}

func lastVersion() int {
	b, _ := os.ReadFile(versionFile())
	v, _ := strconv.Atoi(strings.TrimSpace(string(b)))
	return v
}

// ── los comandos ──

func open(args []string) error {
	dev := ""
	var rest []string
	for _, a := range args {
		if d := parseDevice(strings.TrimPrefix(a, "--")); strings.HasPrefix(a, "--") && d != "" {
			dev = d
		} else {
			rest = append(rest, a)
		}
	}
	if len(rest) < 1 {
		usage()
	}
	if err := startLive(rest, false, dev); err != nil {
		return err
	}
	return look(true)
}

// parseDevice acepta el nombre en castellano o en inglés; vacío si no es un dispositivo.
func parseDevice(s string) string {
	switch strings.ToLower(s) {
	case "movil", "móvil", "mobile", "celular":
		return "mobile"
	case "escritorio", "desktop":
		return "desktop"
	}
	return ""
}

var deviceName = map[string]string{"mobile": "móvil (Pixel 7)", "desktop": "escritorio (1440×900)"}

// device dice en qué dispositivo está la sesión o la pasa al otro: se reabre en la misma página (el perfil de
// un teléfono se fija al abrir el navegador).
func device(args []string) error {
	if len(args) == 0 {
		var st liveState
		if err := call(http.MethodGet, "/api/live/state", nil, &st); err != nil {
			return err
		}
		if !st.Active {
			return errors.New("no hay sesión en vivo")
		}
		fmt.Println(deviceName[st.Device])
		return nil
	}
	d := parseDevice(args[0])
	if d == "" {
		return fmt.Errorf("dispositivo desconocido %q: movil o escritorio", args[0])
	}
	if err := call(http.MethodPost, "/api/live/device", map[string]string{"device": d}, nil); err != nil {
		return err
	}
	fmt.Printf("ahora en %s\n\n", deviceName[d])
	return look(true)
}

// startLive deja la sesión en vivo abierta en el sitio (o la URL) pedido, sin mostrar la página. Con clean
// abre SIEMPRE una sesión nueva con un perfil limpio (la que hubiera se cierra): sin el login ni lo guardado
// de corridas anteriores.
func startLive(args []string, clean bool, dev string) error {
	raw := args[0]
	if !strings.Contains(raw, "://") {
		raw = "https://" + raw
		if strings.HasPrefix(args[0], "localhost") || strings.HasPrefix(args[0], "127.") || strings.HasPrefix(args[0], "[::1]") {
			raw = "http://" + args[0]
		}
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return fmt.Errorf("no es una URL: %q", args[0])
	}
	start := raw
	// Si ya hay una sesión en vivo: del mismo sitio, se reusa y se navega; de otro, se cierra primero.
	var st liveState
	if err := call(http.MethodGet, "/api/live/state", nil, &st); err == nil && st.Active {
		if su, _ := url.Parse(st.URL); su != nil && su.Host == u.Host && !clean {
			if dev != "" && dev != st.Device {
				if err := call(http.MethodPost, "/api/live/device", map[string]string{"device": dev}, nil); err != nil {
					return err
				}
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
	q := "url=" + url.QueryEscape(start)
	if clean {
		q += "&clean=1"
	}
	if dev != "" {
		q += "&device=" + dev
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
	saveNames(st.Page.Controls)
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
	// Un objetivo vacío (un número que un script no encontró) no puede terminar en un clic sobre cualquier cosa.
	if strings.TrimSpace(args[0]) == "" {
		return errors.New("falta el elemento: un número del último look o su texto")
	}
	if action != "hover" {
		if err := guideRefuses(action); err != nil {
			return err
		}
	}
	name := args[0]
	if n, err := strconv.Atoi(args[0]); err == nil && n >= 1 {
		name = lastName(n - 1)
	}
	if err := saveGuard(action, name); err != nil {
		return err
	}
	body := map[string]any{"action": action, "version": lastVersion()}
	// El objetivo es el número de un elemento del último look o, si no es un número, su texto visible.
	if n, err := strconv.Atoi(args[0]); err == nil && n >= 1 {
		body["control"] = n - 1
		body["name"] = lastName(n - 1)
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
	var out struct{ Note string }
	if err := call(http.MethodPost, "/api/live/nav", map[string]string{"action": action, "url": target}, &out); err != nil {
		return err
	}
	if out.Note != "" {
		fmt.Println(out.Note)
		fmt.Println("(la página no cambió: era una descarga)")
		return nil
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

// read muestra el contenido principal de la página, legible: para investigar, mejor que el texto entero.
// read [--desde N] pagina; read --buscar 'texto' muestra sólo lo que lo menciona, con el encabezado de su sección.
func read(args []string) error {
	from, query := 0, ""
	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--desde":
			if i+1 < len(args) {
				from, _ = strconv.Atoi(args[i+1])
				i++
			}
		case "--buscar":
			if i+1 < len(args) {
				query = strings.Join(args[i+1:], " ")
				i = len(args)
			}
		}
	}
	var res struct {
		Title, URL, Updated string
		Lines, Links        []string
	}
	if err := call(http.MethodGet, "/api/live/read", nil, &res); err != nil {
		return err
	}
	fmt.Printf("%s\n%s\n", res.Title, res.URL)
	if res.Updated != "" {
		fmt.Printf("actualización que declara la página: %s\n", res.Updated)
	} else {
		fmt.Println("la página no declara fecha de actualización")
	}
	fmt.Println()
	if query != "" {
		// Cada coincidencia con el encabezado de su sección, para que el dato no quede suelto.
		heading, shown := "", 0
		for _, line := range res.Lines {
			if strings.HasPrefix(strings.TrimSpace(line), "#") {
				heading = strings.TrimSpace(line)
				continue
			}
			if strings.Contains(fold(line), fold(query)) {
				if heading != "" {
					fmt.Println(heading)
					heading = ""
				}
				fmt.Println(line)
				shown++
				if shown >= 40 {
					break
				}
			}
		}
		// Y los enlaces que lo mencionan, con su URL: en un sitio con cientos de enlaces, lo que se busca suele estar
		// entre ellos (se siguen con goto, o con click 'texto').
		linksShown := 0
		for _, l := range res.Links {
			if strings.Contains(fold(l), fold(query)) {
				if linksShown == 0 {
					fmt.Println("\nEnlaces que lo mencionan:")
				}
				fmt.Println("- " + l)
				if linksShown++; linksShown >= 20 {
					break
				}
			}
		}
		if shown == 0 && linksShown == 0 {
			fmt.Printf("(el contenido no menciona «%s»)\n", query)
		}
		return nil
	}
	// De a ~9 000 caracteres, para no inundar.
	budget, i := 9000, from
	for ; i < len(res.Lines) && budget > 0; i++ {
		fmt.Println(res.Lines[i])
		budget -= len(res.Lines[i])
	}
	if i < len(res.Lines) {
		fmt.Printf("\n(sigue: read --desde %d · %d líneas en total)\n", i, len(res.Lines))
	} else if len(res.Links) > 0 {
		fmt.Println("\nEnlaces del contenido:")
		for i, l := range res.Links {
			if i == 40 {
				fmt.Printf("(+%d enlaces más: read --buscar 'texto' los filtra)\n", len(res.Links)-40)
				break
			}
			fmt.Println("- " + l)
		}
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
	return writeReportInfo(map[string]any{"meta": goal, "resultado": result})
}

// writeReportInfo escribe el reporte con todo lo que se sepa de la corrida (palabra final, costo, modelo…).
func writeReportInfo(info map[string]any) (string, error) {
	var out struct{ Dir, ID, URL string }
	if err := call(http.MethodPost, "/api/live/report", info, &out); err != nil {
		return "", err
	}
	lastRunID = out.ID
	return out.URL, nil
}

// lastRunID es la corrida que dejó el último reporte (ask la guarda como flujo).
var lastRunID string

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

// ── modo guía y cambios ──

// guideRefuses: con NAVEGADOR_GUIDE=1 (ask --guia) Claude no toca la página: la persona lo hace y él marca con
// point. Mirar, leer, bajar y pasar el mouse sí.
func guideRefuses(action string) error {
	if os.Getenv("NAVEGADOR_GUIDE") != "1" {
		return nil
	}
	return fmt.Errorf("modo guía: no hacés %s vos. Marcá el elemento con `point <n> '<qué tiene que hacer>'` y esperá a que la persona lo haga", action)
}

// approvalFile lo escribe ask cuando la persona contesta que sí a un CONFIRMAR, y lo borra al terminar esa vuelta.
func approvalFile() string { return filepath.Join(must(os.UserCacheDir()), "navegador", "aprobado") }

// destructiveLike: lo IRREVERSIBLE (el mismo criterio que la repetición del servidor, guide.go). Guardar, activar
// o conectar van solos.
var destructiveLike = regexp.MustCompile(`(?i)^\s*(eliminar|borrar|delete|remove|quitar|desactivar|deactivate|disable|desconectar|disconnect|pagar|pay|comprar|buy|enviar|send|publicar|publish|vaciar|empty|revocar|revoke|dar de baja|cancelar (la |mi )?(cuenta|suscripci))`)

// saveGuard frena, cuando la maneja Claude (ask), un clic DESTRUCTIVO (borrar, desactivar, pagar, enviar) en un
// sitio real sin un sí de la persona en esta vuelta. Lo decide el CLI, no el modelo.
func saveGuard(action, name string) error {
	if os.Getenv("NAVEGADOR_ASK") != "1" || (action != "click" && action != "dblclick") || !destructiveLike.MatchString(name) {
		return nil
	}
	var st liveState
	if err := call(http.MethodGet, "/api/live/state", nil, &st); err != nil || isPractice(st.URL) {
		return err
	}
	if _, err := os.Stat(approvalFile()); err == nil {
		return nil
	}
	return fmt.Errorf("«%s» es irreversible en un sitio real y la persona todavía no dijo que sí: terminá con CONFIRMAR, diciendo qué se va a borrar, desactivar, pagar o enviar", name)
}

func point(args []string) error {
	if len(args) < 2 {
		usage()
	}
	if strings.TrimSpace(args[0]) == "" {
		return errors.New("falta el elemento: un número del último look o su texto")
	}
	body := map[string]any{"version": lastVersion(), "instruction": strings.Join(args[1:], " ")}
	if n, err := strconv.Atoi(args[0]); err == nil && n >= 1 {
		body["control"] = n - 1
		body["name"] = lastName(n - 1)
	} else {
		body["text"] = args[0]
	}
	fmt.Println("esperando a la persona (hasta 100 s)…")
	var res struct {
		Done bool
		How  string
		Code string
	}
	if err := call(http.MethodPost, "/api/live/guide", body, &res); err != nil {
		return err
	}
	if !res.Done {
		fmt.Printf("✗ %s\n\n", res.How)
	} else {
		fmt.Printf("✓ %s", res.How)
		if res.Code != "" {
			fmt.Printf(" · %s", res.Code)
		}
		fmt.Print("\n\n")
	}
	return look(true)
}

func changes() error {
	var list []struct{ Campo, Antes, Despues string }
	if err := call(http.MethodGet, "/api/live/changes", nil, &list); err != nil {
		return err
	}
	if len(list) == 0 {
		fmt.Println("sin cambios en campos desde el último guardar")
		return nil
	}
	for _, c := range list {
		fmt.Printf("  «%s»: %s → %s\n", c.Campo, quoteOrEmpty(c.Antes), quoteOrEmpty(c.Despues))
	}
	return nil
}

func quoteOrEmpty(s string) string {
	if s == "" {
		return "(vacío)"
	}
	return "«" + s + "»"
}

// ── una sesión de Claude desde la conversación, a la vista en el panel ──

func panelEvent(kind, text string) error {
	return call(http.MethodPost, "/api/ask/external", map[string]string{"accion": "event", "k": kind, "t": text}, nil)
}

// shellLine es el comando como se escribió, con comillas simples donde hacen falta.
func shellLine(args []string) string {
	out := make([]string, len(args))
	for i, a := range args {
		if a == "" || strings.ContainsAny(a, " \t'\"$!*?;&|<>()") {
			a = "'" + strings.ReplaceAll(a, "'", `'\''`) + "'"
		}
		out[i] = a
	}
	return strings.Join(out, " ")
}

func begin(args []string) error {
	start := ""
	if len(args) > 1 && args[0] == "--url" {
		start, args = args[1], args[2:]
	}
	goal := strings.TrimSpace(strings.Join(args, " "))
	if goal == "" {
		usage()
	}
	// Si en la pestaña ya trabaja otro Claude (u otra meta sin terminar), ésta va a una pestaña nueva: así dos
	// trabajos corren en paralelo sin pisarse. Con --sesion N se usa esa, ocupada o no.
	if tabID == "" {
		tabs, _ := listTabs()
		for _, t := range tabs {
			if t.Last && t.Busy {
				var nt struct{ ID string }
				if err := call(http.MethodPost, "/api/tabs", nil, &nt); err != nil {
					return err
				}
				tabID = nt.ID
				fmt.Printf("la pestaña %s está ocupada (%s): esta meta va en una nueva\n", t.ID, t.Goal)
			}
		}
	}
	pinTab()
	// Los pasos de cero, ANTES de ir a la URL: la corrida (y el flujo) son de esta meta, con la ida incluida.
	_ = call(http.MethodDelete, "/api/live/steps", nil, nil)
	if start != "" {
		if err := startLive([]string{start}, false, ""); err != nil {
			return err
		}
	}
	if err := call(http.MethodPost, "/api/ask/external", map[string]string{"accion": "begin", "meta": goal}, nil); err != nil {
		return err
	}
	fmt.Printf("sesión abierta en el panel, pestaña %s: %s\n", tabID, goal)
	if tabs, _ := listTabs(); len(tabs) > 1 {
		fmt.Printf("hay %d pestañas: seguí con --sesion %s (o NAVEGADOR_SESION=%s) para no caer en otra\n", len(tabs), tabID, tabID)
	}
	fmt.Println()
	if start != "" {
		return look(true)
	}
	return nil
}

func finish(args []string) error {
	result := strings.TrimSpace(strings.Join(args, " "))
	if result == "" {
		usage()
	}
	var st struct{ Meta string }
	_ = call(http.MethodGet, "/api/ask?desde=999999", nil, &st)
	goal := st.Meta
	defer call(http.MethodPost, "/api/ask/external", map[string]string{"accion": "end"}, nil)
	_ = panelEvent("result", result)
	url, err := writeReportInfo(map[string]any{"meta": goal, "resultado": result, "palabra": keyword(result), "origen": "Claude desde la conversación"})
	if err != nil {
		return err
	}
	_ = panelEvent("report", url)
	fmt.Printf("la corrida, como video: %s\n", url)
	if keyword(result) == "LISTO" && lastRunID != "" && goal != "" {
		var fl struct{ App, ID, Path string }
		if err := call(http.MethodPost, "/api/flows", map[string]string{"run": lastRunID, "name": goal}, &fl); err != nil {
			return fmt.Errorf("no se guardó como flujo: %w", err)
		}
		_ = panelEvent("flow", fl.App+"/"+fl.ID)
		fmt.Printf("flujo guardado: %s\n", fl.Path)
	}
	return nil
}

// ── pestañas ──

type tabInfo struct {
	ID     string `json:"id"`
	Site   string `json:"site"`
	Title  string `json:"title"`
	URL    string `json:"url"`
	Active bool   `json:"active"`
	Goal   string `json:"meta"`
	Busy   bool   `json:"busy"`
	Last   bool   `json:"last"`
}

func listTabs() ([]tabInfo, error) {
	var tabs []tabInfo
	err := call(http.MethodGet, "/api/tabs", nil, &tabs)
	return tabs, err
}

// pinTab fija la pestaña de este comando (la última, si no se dijo) y la deja en el entorno: lo que lance después
// (el Claude de ask y sus comandos) le habla a ESA, aunque mientras tanto se abran otras.
func pinTab() {
	if tabID == "" {
		tabs, _ := listTabs()
		for _, t := range tabs {
			if t.Last {
				tabID = t.ID
			}
		}
	}
	if tabID != "" {
		os.Setenv("NAVEGADOR_SESION", tabID)
	}
}

func tabsCmd(args []string) error {
	if len(args) == 2 && args[0] == "cerrar" {
		if err := call(http.MethodDelete, "/api/tabs/"+args[1], nil, nil); err != nil {
			return err
		}
		fmt.Printf("pestaña %s cerrada\n", args[1])
		return nil
	}
	tabs, err := listTabs()
	if err != nil {
		return err
	}
	for _, t := range tabs {
		mark := " "
		if t.Last {
			mark = "*"
		}
		where := "(vacía)"
		if t.Active {
			where = t.Title + " · " + t.URL
		}
		who := ""
		if t.Busy {
			who = " · Claude: " + t.Goal
		}
		fmt.Printf("%s %s  %s%s\n", mark, t.ID, where, who)
	}
	fmt.Println("  (* la que atiende un comando sin --sesion)")
	return nil
}
