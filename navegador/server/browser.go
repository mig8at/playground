package main

/* El navegador: Chromium por playwright-go, con un perfil PERSISTENTE por sitio (store.go). Hay dos modos y
 * corre uno a la vez, porque un perfil de Chromium no se abre dos veces:
 *
 *	browse   ventana VISIBLE. Te logueás a mano (OTP, captcha, SSO: lo que pida) y navegás; cada página a la
 *	         que llegás se analiza y entra al mapa. Al cerrar la ventana la sesión queda en el perfil.
 *	explore  SIN ventana, con la sesión del perfil. Recorre a lo ancho los enlaces del mismo host, analiza cada
 *	         página y saca su captura. Sólo sigue <a href>: nunca envía un formulario ni hace clic en un botón,
 *	         y salta lo que parezca cerrar sesión o borrar.
 *
 * ⚠ Los manejadores de eventos de playwright-go corren en el hilo que lee del driver: llamar desde ahí a algo
 * que espera respuesta (Evaluate, Screenshot) lo traba. Por eso sólo anotan y avisan por un canal.
 */

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/playwright-community/playwright-go"
)

//go:embed analyze.js
var analyzeJS string

// LogLine es un renglón de la consola de la interfaz.
type LogLine struct {
	Seq  int       `json:"seq"`
	At   time.Time `json:"at"`
	Text string    `json:"text"`
	Kind string    `json:"kind"` // info · ok · warn · error
}

// State es lo que la interfaz pregunta cada segundo: si hay algo corriendo y qué dijo.
type State struct {
	Busy    bool      `json:"busy"`
	Kind    string    `json:"kind"`
	Site    string    `json:"site"`
	Started time.Time `json:"started"`
	Visited int       `json:"visited"`
	Log     []LogLine `json:"log"`
	LastSeq int       `json:"lastSeq"`
}

type Runner struct {
	store *Store

	mu      sync.Mutex
	pw      *playwright.Playwright
	busy    bool
	kind    string
	site    string
	started time.Time
	visited int
	cancel  context.CancelFunc
	log     []LogLine
	seq     int
	live    *live // la sesión en vivo, si hay una (live.go)
}

func NewRunner(store *Store) *Runner { return &Runner{store: store} }

func (r *Runner) say(kind, format string, args ...any) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.seq++
	r.log = append(r.log, LogLine{Seq: r.seq, At: time.Now(), Text: fmt.Sprintf(format, args...), Kind: kind})
	if len(r.log) > 600 {
		r.log = r.log[len(r.log)-600:]
	}
	if cliMode {
		fmt.Fprintf(os.Stderr, "%s %s\n", time.Now().Format("15:04:05"), fmt.Sprintf(format, args...))
	}
}

// State devuelve los renglones posteriores a `since`.
func (r *Runner) State(since int) State {
	r.mu.Lock()
	defer r.mu.Unlock()
	st := State{Busy: r.busy, Kind: r.kind, Site: r.site, Started: r.started, Visited: r.visited, LastSeq: r.seq, Log: []LogLine{}}
	for _, l := range r.log {
		if l.Seq > since {
			st.Log = append(st.Log, l)
		}
	}
	return st
}

// playwright arranca el driver la primera vez y, si faltan, baja el driver y Chromium (una sola vez, ~150 MB).
func (r *Runner) playwright() (*playwright.Playwright, error) {
	r.mu.Lock()
	pw := r.pw
	r.mu.Unlock()
	if pw != nil {
		return pw, nil
	}
	r.say("info", "preparando Playwright (la primera vez baja el driver y Chromium)…")
	opts, err := ensureDriver(r.say)
	if err != nil {
		return nil, err
	}
	if err := playwright.Install(opts); err != nil {
		return nil, fmt.Errorf("instalar Playwright: %w", err)
	}
	pw, err = playwright.Run(opts)
	if err != nil {
		return nil, fmt.Errorf("arrancar Playwright: %w", err)
	}
	r.mu.Lock()
	r.pw = pw
	r.mu.Unlock()
	return pw, nil
}

func (r *Runner) Close() {
	r.Stop()
	r.mu.Lock()
	pw := r.pw
	r.pw = nil
	r.mu.Unlock()
	if pw != nil {
		_ = pw.Stop()
	}
}

// begin toma el turno; falla si ya hay algo corriendo.
func (r *Runner) begin(kind, site string) (context.Context, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.busy {
		return nil, fmt.Errorf("ya hay un %s corriendo sobre %s: paralo primero", r.kind, r.site)
	}
	ctx, cancel := context.WithCancel(context.Background())
	r.busy, r.kind, r.site, r.started, r.visited, r.cancel = true, kind, site, time.Now(), 0, cancel
	return ctx, nil
}

func (r *Runner) end() {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.cancel != nil {
		r.cancel()
	}
	r.busy, r.cancel = false, nil
}

func (r *Runner) Stop() {
	r.mu.Lock()
	cancel := r.cancel
	r.mu.Unlock()
	if cancel != nil {
		cancel()
	}
}

func (r *Runner) launch(site Site, headless bool) (playwright.BrowserContext, error) {
	pw, err := r.playwright()
	if err != nil {
		return nil, err
	}
	opts := playwright.BrowserTypeLaunchPersistentContextOptions{
		Headless: playwright.Bool(headless),
		// La automatización se nota (navigator.webdriver): algunos logins con SSO se niegan. Se apaga esa marca
		// y nada más; no es un disfraz, es para que el login manual sea igual al de tu navegador.
		Args: []string{"--disable-blink-features=AutomationControlled"},
	}
	if headless {
		opts.Viewport = &playwright.Size{Width: 1366, Height: 900}
	} else {
		opts.NoViewport = playwright.Bool(true)
	}
	return pw.Chromium.LaunchPersistentContext(r.store.ProfileDir(site.Slug), opts)
}

// tap junta lo que dice una página entre dos análisis: sus llamadas al backend y sus errores de consola.
type tap struct {
	mu       sync.Mutex
	requests []Request
	console  []string
}

var backendTypes = map[string]bool{"xhr": true, "fetch": true, "document": true, "websocket": true, "eventsource": true}

func (t *tap) attach(p playwright.Page) {
	p.OnResponse(func(res playwright.Response) {
		req := res.Request()
		if !backendTypes[req.ResourceType()] {
			return
		}
		t.mu.Lock()
		if len(t.requests) < 300 {
			t.requests = append(t.requests, Request{Method: req.Method(), URL: res.URL(), Status: res.Status(), Type: req.ResourceType()})
		}
		t.mu.Unlock()
	})
	p.OnConsole(func(m playwright.ConsoleMessage) {
		if m.Type() != "error" && m.Type() != "warning" {
			return
		}
		t.mu.Lock()
		if len(t.console) < 100 {
			t.console = append(t.console, m.Type()+": "+truncate(m.Text(), 300))
		}
		t.mu.Unlock()
	})
	p.OnPageError(func(err error) {
		t.mu.Lock()
		if len(t.console) < 100 {
			t.console = append(t.console, "excepción: "+truncate(err.Error(), 300))
		}
		t.mu.Unlock()
	})
}

// drain devuelve lo juntado y empieza de cero.
func (t *tap) drain() ([]Request, []string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	req, con := t.requests, t.console
	t.requests, t.console = nil, nil
	return req, con
}

var authPath = regexp.MustCompile(`(?i)/(login|log-in|signin|sign-in|auth|sso|oauth|ingresar|iniciar-sesion)\b`)

// analyze describe la página como está AHORA y la guarda en el mapa. `parent` es la página desde la que se
// llegó: con eso se arma el árbol de navegación.
func (r *Runner) analyze(site Site, p playwright.Page, t *tap, requested string, status, depth int, source, parent string) (*Page, error) {
	final := p.URL()
	page := &Page{
		URL: NormalizeURL(final), FinalURL: final, Status: status, Depth: depth, Source: source, At: time.Now(),
		Landmarks: map[string]int{}, Parent: parent,
	}
	page.ID = PageID(page.URL)
	if page.Parent == page.ID {
		page.Parent = ""
	}
	if requested != "" && NormalizeURL(requested) != page.URL && authPath.MatchString(final) {
		page.AuthWall = true
	}
	raw, err := p.Evaluate(analyzeJS)
	if err != nil {
		page.Error = "analizar: " + err.Error()
	} else if s, ok := raw.(string); ok {
		var a struct {
			Title     string         `json:"title"`
			Lang      string         `json:"lang"`
			Stack     []string       `json:"stack"`
			Headings  []Heading      `json:"headings"`
			Links     []Link         `json:"links"`
			Forms     []Form         `json:"forms"`
			Buttons   []string       `json:"buttons"`
			Landmarks map[string]int `json:"landmarks"`
			Controls  []Control      `json:"controls"`
			Notices   []string       `json:"notices"`
		}
		if err := json.Unmarshal([]byte(s), &a); err != nil {
			page.Error = "leer el análisis: " + err.Error()
		} else {
			page.Title, page.Lang, page.Stack, page.Headings = a.Title, a.Lang, a.Stack, a.Headings
			page.Links, page.Forms, page.Buttons, page.Landmarks = a.Links, a.Forms, a.Buttons, a.Landmarks
			verifyControls(p, a.Controls)
			page.Controls = a.Controls
			page.Notices = a.Notices
		}
	}
	page.Requests, page.Console = t.drain()
	shot := r.store.ShotPath(site.Slug, page.ID)
	if err := os.MkdirAll(filepath.Dir(shot), 0o700); err == nil {
		// La página ENTERA, de arriba abajo: es lo que muestra el editor. Una página muy larga tarda más; si no
		// alcanza el tiempo, queda la parte visible antes que nada.
		full := playwright.PageScreenshotOptions{Path: playwright.String(shot), FullPage: playwright.Bool(true), Timeout: playwright.Float(30000)}
		_, err := p.Screenshot(full)
		if err != nil {
			_, err = p.Screenshot(playwright.PageScreenshotOptions{Path: playwright.String(shot), Timeout: playwright.Float(15000)})
		}
		if err == nil {
			page.Shot = true
		}
	}
	if err := r.store.PutPage(site.Slug, page); err != nil {
		return nil, err
	}
	r.mu.Lock()
	r.visited++
	r.mu.Unlock()
	return page, nil
}

// settle espera a que la página deje de pedir cosas, con tope: una que pollea no llega nunca a «networkidle».
func settle(p playwright.Page) {
	_ = p.WaitForLoadState(playwright.PageWaitForLoadStateOptions{State: playwright.LoadStateNetworkidle, Timeout: playwright.Float(6000)})
}

// Browse abre la ventana visible en `start` (o en la entrada del sitio) y analiza cada página a la que llegás.
// Termina cuando cerrás la ventana o se pide parar.
func (r *Runner) Browse(slug, start string) error {
	site, err := r.store.Site(slug)
	if err != nil {
		return err
	}
	if start == "" {
		start = site.URL
	}
	ctx, err := r.begin("browse", slug)
	if err != nil {
		return err
	}
	go func() {
		defer r.end()
		if err := r.browse(ctx, site, start); err != nil {
			r.say("error", "%v", err)
		}
	}()
	return nil
}

func (r *Runner) browse(ctx context.Context, site Site, start string) error {
	bctx, err := r.launch(site, false)
	if err != nil {
		return err
	}
	closed := make(chan struct{})
	var closeOnce sync.Once
	bctx.OnClose(func(playwright.BrowserContext) { closeOnce.Do(func() { close(closed) }) })

	type nav struct {
		page playwright.Page
		tap  *tap
	}
	navs := make(chan nav, 64)
	watch := func(p playwright.Page) {
		t := &tap{}
		t.attach(p)
		p.OnFrameNavigated(func(f playwright.Frame) {
			if f.ParentFrame() == nil {
				select {
				case navs <- nav{p, t}:
				default:
				}
			}
		})
	}
	for _, p := range bctx.Pages() {
		watch(p)
	}
	bctx.OnPage(watch)

	page := firstPage(bctx)
	if page == nil {
		if page, err = bctx.NewPage(); err != nil {
			return err
		}
		watch(page)
	}
	r.say("info", "ventana abierta en %s · logueate si hace falta y navegá: cada página entra al mapa. Cerrá la ventana para terminar.", start)
	if _, err := page.Goto(start, playwright.PageGotoOptions{WaitUntil: playwright.WaitUntilStateDomcontentloaded, Timeout: playwright.Float(45000)}); err != nil {
		r.say("warn", "no cargó %s: %v", start, err)
	}

	// Una navegación dispara varios avisos seguidos (redirecciones, el router de la SPA): se analiza cuando la
	// página lleva un rato quieta, y una vez por URL distinta.
	pending := map[playwright.Page]*tap{}
	lastURL := map[playwright.Page]string{}
	timer := time.NewTimer(time.Hour)
	for {
		select {
		case <-ctx.Done():
			r.say("info", "parando…")
			_ = bctx.Close()
			<-closed
			return nil
		case <-closed:
			r.say("ok", "ventana cerrada · la sesión quedó guardada en el perfil del sitio")
			return nil
		case n := <-navs:
			pending[n.page] = n.tap
			timer.Reset(1200 * time.Millisecond)
		case <-timer.C:
			for p, t := range pending {
				delete(pending, p)
				if p.IsClosed() {
					continue
				}
				settle(p)
				u := NormalizeURL(p.URL())
				if u == lastURL[p] || !strings.HasPrefix(u, "http") {
					continue
				}
				parent := ""
				if prev, ok := lastURL[p]; ok {
					parent = PageID(prev)
				}
				lastURL[p] = u
				// Una página que ya tiene lugar en el árbol (la encontró el recorrido) lo conserva: el orden en que
				// la visitás a mano es tuyo, no del sitio.
				depth := 0
				if old := r.store.Page(site.Slug, PageID(u)); old != nil && (old.Parent != "" || old.Depth == 0) {
					parent, depth = old.Parent, old.Depth
				} else if pp := r.store.Page(site.Slug, parent); pp != nil {
					depth = pp.Depth + 1
				}
				pg, err := r.analyze(site, p, t, "", 0, depth, "manual", parent)
				if err != nil {
					r.say("error", "%s: %v", u, err)
					continue
				}
				r.say("ok", "%s · %s", shortURL(pg.URL), describe(pg))
			}
		}
	}
}

func firstPage(c playwright.BrowserContext) playwright.Page {
	if ps := c.Pages(); len(ps) > 0 {
		return ps[0]
	}
	return nil
}

// ExploreOptions son las perillas del recorrido automático.
type ExploreOptions struct {
	Max   int    `json:"max"`
	Depth int    `json:"depth"`
	Start string `json:"start"`
}

// MaxPagesCap es el tope duro: un sitio con páginas generadas (filtros, paginación, calendarios) no termina nunca.
const MaxPagesCap = 2000

// Depth 0 es sin límite de niveles: sigue hasta que no queden páginas nuevas (o se llegue a Max).
func (o *ExploreOptions) defaults() {
	if o.Max <= 0 {
		o.Max = 300
	}
	if o.Max > MaxPagesCap {
		o.Max = MaxPagesCap
	}
	if o.Depth < 0 {
		o.Depth = 0
	}
}

func (o ExploreOptions) depthLabel() string {
	if o.Depth == 0 {
		return "sin límite de niveles"
	}
	return fmt.Sprintf("%d niveles", o.Depth)
}

func (r *Runner) Explore(slug string, opts ExploreOptions) error {
	site, err := r.store.Site(slug)
	if err != nil {
		return err
	}
	opts.defaults()
	ctx, err := r.begin("explore", slug)
	if err != nil {
		return err
	}
	go func() {
		defer r.end()
		if err := r.explore(ctx, site, opts); err != nil {
			r.say("error", "%v", err)
		}
	}()
	return nil
}

// ExploreSync es lo mismo, para la consola: espera a que termine.
func (r *Runner) ExploreSync(slug string, opts ExploreOptions) error {
	site, err := r.store.Site(slug)
	if err != nil {
		return err
	}
	opts.defaults()
	ctx, err := r.begin("explore", slug)
	if err != nil {
		return err
	}
	defer r.end()
	return r.explore(ctx, site, opts)
}

// Lo que nunca se sigue: cerrar sesión (perderías el login) y lo que suene a escribir o borrar.
var (
	skipLink = regexp.MustCompile(`(?i)(log-?out|sign-?out|salir|cerrar[-_ ]?sesi[oó]n|desconectar|delete|eliminar|borrar|remove|destroy|unsubscribe|anular|cancelar)`)
	skipExt  = regexp.MustCompile(`(?i)\.(pdf|zip|rar|7z|gz|png|jpe?g|gif|webp|svg|ico|mp4|mp3|webm|xlsx?|docx?|pptx?|csv|exe|dmg|apk)$`)
)

func (r *Runner) explore(ctx context.Context, site Site, opts ExploreOptions) error {
	bctx, err := r.launch(site, true)
	if err != nil {
		return err
	}
	defer bctx.Close()
	page := firstPage(bctx)
	if page == nil {
		if page, err = bctx.NewPage(); err != nil {
			return err
		}
	}
	t := &tap{}
	t.attach(page)

	start := opts.Start
	if start == "" {
		start = site.URL
	}
	type item struct {
		url    string
		depth  int
		parent string
	}
	queue := []item{{start, 0, ""}}
	seen := map[string]bool{NormalizeURL(start): true}
	r.say("info", "explorando %s · hasta %d páginas, %s · sólo enlaces de %s", start, opts.Max, opts.depthLabel(), site.Host)
	run := Run{Started: time.Now(), Max: opts.Max, Depth: opts.Depth}
	// Al terminar, por la razón que sea, queda escrito cuántas se visitaron y cuáles quedaron en la cola: eso es
	// lo que hace honesto el conteo del sitio (visitadas + pendientes).
	defer func() {
		run.Finished = time.Now()
		for _, it := range queue {
			if len(run.Pending) >= MaxPagesCap {
				break
			}
			run.Pending = append(run.Pending, PendingLink{URL: it.url, Parent: it.parent, Depth: it.depth})
		}
		run.Queued = len(queue)
		if err := r.store.SaveRun(site.Slug, run); err != nil {
			r.say("error", "guardar el resumen: %v", err)
		}
	}()

	done, walls, downloads := 0, 0, 0
	for len(queue) > 0 && done < opts.Max {
		if ctx.Err() != nil {
			r.say("warn", "parado a pedido · %d páginas analizadas, %d en la cola", done, len(queue))
			run.Stopped = true
			return nil
		}
		it := queue[0]
		queue = queue[1:]
		t.drain()
		res, err := page.Goto(it.url, playwright.PageGotoOptions{WaitUntil: playwright.WaitUntilStateDomcontentloaded, Timeout: playwright.Float(30000)})
		status := 0
		if res != nil {
			status = res.Status()
		}
		// Un enlace que baja un archivo no es una página: se salta sin contarlo (the-internet tiene cientos así).
		if err != nil && strings.Contains(err.Error(), "Download is starting") {
			downloads++
			continue
		}
		if err != nil {
			r.say("warn", "%s · no cargó: %v", shortURL(it.url), firstLine(err.Error()))
			_ = r.store.PutPage(site.Slug, &Page{ID: PageID(NormalizeURL(it.url)), URL: NormalizeURL(it.url), Depth: it.depth, Parent: it.parent, Source: "explore", At: time.Now(), Error: firstLine(err.Error())})
			done++
			run.Visited = done
			continue
		}
		settle(page)
		pg, err := r.analyze(site, page, t, it.url, status, it.depth, "explore", it.parent)
		if err != nil {
			r.say("error", "%s: %v", shortURL(it.url), err)
			continue
		}
		done++
		run.Visited = done
		kind := "ok"
		if status >= 400 || pg.Error != "" {
			kind = "warn"
		}
		if pg.AuthWall {
			kind = "warn"
			walls++
		}
		r.say(kind, "%d/%d %s · %s · %d en la cola", done, opts.Max, shortURL(pg.URL), describe(pg), len(queue))
		if pg.AuthWall && done == 1 {
			r.say("error", "la entrada redirige al login: no hay sesión. Abrí la ventana, logueate a mano y volvé a explorar.")
			run.AuthWall = true
			return nil
		}
		// Si mandó al login no se siguen sus enlaces: serían los del formulario de ingreso.
		if (opts.Depth > 0 && it.depth >= opts.Depth) || pg.AuthWall {
			continue
		}
		for _, l := range pg.Links {
			u, err := url.Parse(l.Href)
			if err != nil || u.Host != site.Host || skipExt.MatchString(u.Path) {
				continue
			}
			if skipLink.MatchString(u.Path) || skipLink.MatchString(u.RawQuery) || skipLink.MatchString(l.Text) {
				continue
			}
			n := NormalizeURL(l.Href)
			if seen[n] {
				continue
			}
			seen[n] = true
			queue = append(queue, item{n, it.depth + 1, pg.ID})
		}
		select {
		case <-ctx.Done():
		case <-time.After(300 * time.Millisecond): // sin apurar al servidor ajeno
		}
	}
	msg := fmt.Sprintf("listo · %d páginas analizadas", done)
	if len(queue) > 0 {
		msg += fmt.Sprintf(", %d quedaron en la cola sin visitar (subí el máximo para seguir)", len(queue))
	} else {
		msg += " · no quedan enlaces nuevos: es el sitio entero alcanzable desde la entrada"
	}
	if walls > 0 {
		msg += fmt.Sprintf(" · ⚠ %d mandaron al login: la sesión pudo vencer", walls)
	}
	if downloads > 0 {
		msg += fmt.Sprintf(" · %d enlaces eran descargas y se saltaron", downloads)
	}
	r.say("ok", "%s", msg)
	return nil
}

func describe(p *Page) string {
	parts := []string{}
	if p.Title != "" {
		parts = append(parts, "«"+truncate(p.Title, 60)+"»")
	}
	if p.Status > 0 {
		parts = append(parts, fmt.Sprint(p.Status))
	}
	parts = append(parts, fmt.Sprintf("%d enlaces · %d formularios · %d llamadas", len(p.Links), len(p.Forms), len(p.Requests)))
	if len(p.Console) > 0 {
		parts = append(parts, fmt.Sprintf("%d errores de consola", len(p.Console)))
	}
	if p.AuthWall {
		parts = append(parts, "mandó al login")
	}
	return strings.Join(parts, " · ")
}

func shortURL(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return raw
	}
	s := u.Path
	if s == "" {
		s = "/"
	}
	if u.RawQuery != "" {
		s += "?" + u.RawQuery
	}
	if u.Fragment != "" {
		s += "#" + u.Fragment
	}
	return truncate(s, 90)
}

func truncate(s string, n int) string {
	if len([]rune(s)) <= n {
		return s
	}
	return string([]rune(s)[:n-1]) + "…"
}

func firstLine(s string) string {
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		s = s[:i]
	}
	return truncate(s, 200)
}
