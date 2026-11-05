package main

/* La sesión EN VIVO: un Chromium sin ventana, con el perfil del sitio (o sea, con tu login), cuya pantalla se
 * transmite al editor por CDP (`Page.startScreencast`), como el celular del harness (harness/panel/devices.ts).
 * Lo que se hace sobre el canvas —clic, teclas, rueda— vuelve por la API y se repite con el mouse y el teclado
 * de Playwright. Cada vez que la página navega o cambia, se vuelve a analizar: los elementos interactivos y sus
 * localizadores son los de la página tal como está AHORA.
 *
 * Una acción sobre un elemento («llenar», «marcar», «elegir», «clic») se hace por su localizador recomendado, el
 * mismo que diría una prueba, y queda como un PASO: la lista de pasos es el script del recorrido.
 *
 * ⚠ Los manejadores de CDP corren en el hilo que lee del driver: no pueden esperar nada (ni el ack del cuadro),
 * así que mandan a canales y goroutines. Y un <select> nativo abre su lista como una ventana del sistema, que el
 * screencast no ve: se elige desde la interfaz, por localizador.
 */

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/playwright-community/playwright-go"
)

// El tamaño de la sesión en vivo es el del editor (la interfaz lo manda al abrir y cada vez que cambia), así la
// página se ve 1:1. Sin tamaño, el de una pantalla de escritorio común.
const liveW, liveH = 1280, 800

func clampSize(w, h int) (int, int) {
	if w <= 0 || h <= 0 {
		return liveW, liveH
	}
	return min(max(w, 320), 2560), min(max(h, 240), 1600)
}

// Step es una acción hecha en la sesión, con la línea de Playwright que la reproduce.
type Step struct {
	At     time.Time `json:"at"`
	URL    string    `json:"url"`
	Code   string    `json:"code"`
	Target string    `json:"target"`
	OK     bool      `json:"ok"`
	Error  string    `json:"error,omitempty"`
}

// LiveState es lo que la interfaz y el CLI preguntan: dónde está, qué hay para tocar y qué se hizo.
type LiveState struct {
	Active    bool   `json:"active"`
	Site      string `json:"site"`
	URL       string `json:"url"`
	Title     string `json:"title"`
	Width     int    `json:"width"`
	Height    int    `json:"height"`
	Version   int    `json:"version"` // sube con cada análisis nuevo
	Analyzing bool   `json:"analyzing"`
	Page      *Page  `json:"page,omitempty"`
	Steps     []Step `json:"steps"`
}

type live struct {
	site  Site
	bctx  playwright.BrowserContext
	page  playwright.Page
	cdp   playwright.CDPSession
	tap   *tap
	start string
	w, h  int

	mu        sync.Mutex
	subs      map[chan []byte]struct{}
	lastFrame []byte
	current   *Page
	version   int
	signature string // qué hay para tocar en el último análisis: la versión sube sólo si cambia
	analyzing bool
	steps     []Step

	analyzeMu sync.Mutex
	dirty     chan struct{}
}

func (l *live) broadcast(frame []byte) {
	l.mu.Lock()
	l.lastFrame = frame
	for ch := range l.subs {
		select {
		case ch <- frame:
		default: // un suscriptor lento se pierde cuadros, no traba a los demás
		}
	}
	l.mu.Unlock()
}

// markDirty pide un análisis nuevo (se hace cuando la página se aquieta).
func (l *live) markDirty() {
	select {
	case l.dirty <- struct{}{}:
	default:
	}
}

func (r *Runner) liveSession() *live {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.live
}

// LiveStart abre la sesión en vivo en `start` (o en la entrada del sitio), del tamaño w×h.
func (r *Runner) LiveStart(slug, start string, w, h int) error {
	site, err := r.store.Site(slug)
	if err != nil {
		return err
	}
	if start == "" {
		start = site.URL
	}
	ctx, err := r.begin("live", slug)
	if err != nil {
		return err
	}
	ready := make(chan error, 1)
	go func() {
		defer r.end()
		if err := r.runLive(ctx, site, start, w, h, ready); err != nil {
			r.say("error", "en vivo: %v", err)
			select {
			case ready <- err:
			default:
			}
		}
	}()
	select {
	case err := <-ready:
		return err
	case <-time.After(60 * time.Second):
		return errors.New("la sesión en vivo no arrancó en 60 s")
	}
}

func (r *Runner) runLive(ctx context.Context, site Site, start string, w, h int, ready chan<- error) error {
	w, h = clampSize(w, h)
	pw, err := r.playwright()
	if err != nil {
		return err
	}
	bctx, err := pw.Chromium.LaunchPersistentContext(r.store.ProfileDir(site.Slug), playwright.BrowserTypeLaunchPersistentContextOptions{
		Headless: playwright.Bool(true),
		Viewport: &playwright.Size{Width: w, Height: h},
		Args:     []string{"--disable-blink-features=AutomationControlled"},
	})
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
	l := &live{site: site, bctx: bctx, page: page, tap: &tap{}, start: start, w: w, h: h, subs: map[chan []byte]struct{}{}, dirty: make(chan struct{}, 1)}
	l.tap.attach(page)
	page.OnFrameNavigated(func(f playwright.Frame) {
		if f.ParentFrame() == nil {
			l.markDirty()
		}
	})
	// Una pestaña nueva (target=_blank) se trae a la misma: la sesión muestra una sola página.
	bctx.OnPage(func(p playwright.Page) {
		go func() {
			u := p.URL()
			_ = p.Close()
			if u != "" && u != "about:blank" {
				_, _ = l.page.Goto(u)
			}
		}()
	})

	cdp, err := bctx.NewCDPSession(page)
	if err != nil {
		return err
	}
	cdp.On("Page.screencastFrame", func(ev map[string]any) {
		data, _ := ev["data"].(string)
		id := ev["sessionId"]
		go func() { _, _ = cdp.Send("Page.screencastFrameAck", map[string]any{"sessionId": id}) }()
		msg, _ := json.Marshal(map[string]any{"data": data, "meta": ev["metadata"]})
		l.broadcast(msg)
	})
	l.cdp = cdp
	if err := l.startScreencast(); err != nil {
		return fmt.Errorf("screencast: %w", err)
	}

	r.mu.Lock()
	r.live = l
	r.mu.Unlock()
	defer func() {
		r.mu.Lock()
		r.live = nil
		r.mu.Unlock()
		l.mu.Lock()
		for ch := range l.subs {
			close(ch)
		}
		l.subs = map[chan []byte]struct{}{}
		l.mu.Unlock()
	}()

	r.say("info", "en vivo en %s · lo que hagas en el editor (o con bin/navegador) pasa en este navegador", start)
	if _, err := page.Goto(start, playwright.PageGotoOptions{WaitUntil: playwright.WaitUntilStateDomcontentloaded, Timeout: playwright.Float(45000)}); err != nil {
		r.say("warn", "no cargó %s: %v", start, firstLine(err.Error()))
	}
	ready <- nil

	// El análisis va detrás de los cambios, con un respiro: una navegación dispara varios avisos seguidos.
	timer := time.NewTimer(time.Hour)
	for {
		select {
		case <-ctx.Done():
			r.say("info", "sesión en vivo cerrada")
			_, _ = cdp.Send("Page.stopScreencast", nil)
			return nil
		case <-l.dirty:
			timer.Reset(700 * time.Millisecond)
		case <-timer.C:
			if _, err := r.liveAnalyze(l); err != nil && ctx.Err() == nil {
				r.say("warn", "analizar en vivo: %v", firstLine(err.Error()))
			}
		}
	}
}

// liveAnalyze analiza la página como está ahora y la deja como la actual de la sesión (y en el mapa).
func (r *Runner) liveAnalyze(l *live) (*Page, error) {
	l.analyzeMu.Lock()
	defer l.analyzeMu.Unlock()
	l.mu.Lock()
	l.analyzing = true
	prev := l.current
	l.mu.Unlock()
	defer func() { l.mu.Lock(); l.analyzing = false; l.mu.Unlock() }()

	settle(l.page)
	parent, depth := "", 0
	if prev != nil && NormalizeURL(l.page.URL()) != prev.URL {
		parent, depth = prev.ID, prev.Depth+1
	} else if prev != nil {
		parent, depth = prev.Parent, prev.Depth
	}
	if old := r.store.Page(l.site.Slug, PageID(NormalizeURL(l.page.URL()))); old != nil {
		parent, depth = old.Parent, old.Depth
	}
	pg, err := r.analyze(l.site, l.page, l.tap, "", 0, depth, "live", parent)
	if err != nil {
		return nil, err
	}
	sig := controlsSignature(pg)
	l.mu.Lock()
	l.current = pg
	if sig != l.signature {
		l.signature = sig
		l.version++
	}
	l.mu.Unlock()
	return pg, nil
}

// LiveState: el estado de la sesión; con fresh analiza antes de contestar (lo usa el CLI después de actuar).
func (r *Runner) LiveState(fresh bool) LiveState {
	l := r.liveSession()
	if l == nil {
		return LiveState{Steps: []Step{}}
	}
	if fresh {
		_, _ = r.liveAnalyze(l)
	}
	title, _ := l.page.Title()
	l.mu.Lock()
	defer l.mu.Unlock()
	return LiveState{
		Active: true, Site: l.site.Slug, URL: l.page.URL(), Title: title, Width: l.w, Height: l.h,
		Version: l.version, Analyzing: l.analyzing, Page: l.current, Steps: append([]Step{}, l.steps...),
	}
}

// LiveSubscribe entrega los cuadros del screencast hasta que se cancela.
func (r *Runner) LiveSubscribe() (chan []byte, func(), error) {
	l := r.liveSession()
	if l == nil {
		return nil, nil, errors.New("no hay sesión en vivo")
	}
	ch := make(chan []byte, 4)
	l.mu.Lock()
	l.subs[ch] = struct{}{}
	if l.lastFrame != nil {
		ch <- l.lastFrame
	}
	l.mu.Unlock()
	cancel := func() {
		l.mu.Lock()
		if _, ok := l.subs[ch]; ok {
			delete(l.subs, ch)
			close(ch)
		}
		l.mu.Unlock()
	}
	return ch, cancel, nil
}

// LiveInput es un evento del canvas: coordenadas en px CSS de la página visible.
type LiveInput struct {
	Type string  `json:"type"` // click · down · up · move · wheel · key · text
	X    float64 `json:"x"`
	Y    float64 `json:"y"`
	DX   float64 `json:"dx"`
	DY   float64 `json:"dy"`
	Key  string  `json:"key"`
	Text string  `json:"text"`
}

func (r *Runner) LiveInput(in LiveInput) error {
	l := r.liveSession()
	if l == nil {
		return errors.New("no hay sesión en vivo")
	}
	m, k := l.page.Mouse(), l.page.Keyboard()
	var err error
	switch in.Type {
	case "click":
		err = m.Click(in.X, in.Y)
		l.markDirty()
	case "down":
		if err = m.Move(in.X, in.Y); err == nil {
			err = m.Down()
		}
	case "up":
		if err = m.Move(in.X, in.Y); err == nil {
			err = m.Up()
		}
		l.markDirty()
	case "move":
		err = m.Move(in.X, in.Y)
	case "wheel":
		if err = m.Move(in.X, in.Y); err == nil {
			err = m.Wheel(in.DX, in.DY)
		}
	case "key":
		err = k.Press(in.Key)
		l.markDirty()
	case "text":
		err = k.Type(in.Text)
		l.markDirty()
	default:
		err = fmt.Errorf("evento desconocido %q", in.Type)
	}
	return err
}

// LiveNav: ir a una URL, atrás, adelante o recargar.
func (r *Runner) LiveNav(action, target string) error {
	l := r.liveSession()
	if l == nil {
		return errors.New("no hay sesión en vivo")
	}
	var err error
	switch action {
	case "goto":
		if !strings.Contains(target, "://") {
			target = "https://" + target
		}
		_, err = l.page.Goto(target, playwright.PageGotoOptions{WaitUntil: playwright.WaitUntilStateDomcontentloaded, Timeout: playwright.Float(45000)})
		r.recordStep(l, Step{Code: fmt.Sprintf("page.goto('%s')", jsQuote(target)), Target: target, OK: err == nil, Error: errText(err)})
	case "back":
		_, err = l.page.GoBack()
		r.recordStep(l, Step{Code: "page.goBack()", Target: "atrás", OK: err == nil, Error: errText(err)})
	case "forward":
		_, err = l.page.GoForward()
		r.recordStep(l, Step{Code: "page.goForward()", Target: "adelante", OK: err == nil, Error: errText(err)})
	case "scroll": // la página entera, hasta abajo
		_, err = l.page.Evaluate("() => window.scrollTo(0, document.body.scrollHeight)")
		r.recordStep(l, Step{Code: "page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))", Target: "bajar la página", OK: err == nil, Error: errText(err)})
	case "reload":
		_, err = l.page.Reload()
		r.recordStep(l, Step{Code: "page.reload()", Target: "recargar", OK: err == nil, Error: errText(err)})
	default:
		err = fmt.Errorf("navegación desconocida %q", action)
	}
	l.markDirty()
	return err
}

// LiveAct hace una acción sobre un elemento de la página actual, por su localizador recomendado.
type LiveAct struct {
	Control int    `json:"control"`
	Action  string `json:"action"` // click · fill · check · uncheck · select · press
	Value   string `json:"value"`
	Version int    `json:"version"` // el análisis sobre el que se eligió el elemento: si cambió, se avisa
}

func (r *Runner) LiveAct(in LiveAct) (Step, error) {
	l := r.liveSession()
	if l == nil {
		return Step{}, errors.New("no hay sesión en vivo")
	}
	l.mu.Lock()
	cur, version := l.current, l.version
	l.mu.Unlock()
	if cur == nil {
		return Step{}, errors.New("la página todavía no se analizó: esperá un momento")
	}
	if in.Version != 0 && in.Version != version {
		return Step{}, fmt.Errorf("la página cambió desde que la miraste (análisis %d, ahora %d): volvé a mirarla", in.Version, version)
	}
	if in.Control < 0 || in.Control >= len(cur.Controls) {
		return Step{}, fmt.Errorf("no hay un elemento %d (la página tiene %d)", in.Control+1, len(cur.Controls))
	}
	c := cur.Controls[in.Control]
	if c.Best < 0 {
		return Step{}, fmt.Errorf("el elemento %d «%s» no tiene un localizador único", in.Control+1, c.Name)
	}
	loc := c.Locators[c.Best]
	action := in.Action
	if action == "" {
		action = map[string]string{"field": "fill", "select": "select", "check": "check", "scroll": "scroll"}[c.Kind]
		if action == "" {
			action = "click"
		}
	}
	target := locatorFor(l.page, loc)
	timeout := playwright.Float(10000)
	// Un elemento deshabilitado se niega al instante: esperar 10 s a que se habilite solo esconde la causa, que
	// casi siempre es una regla de la página (un campo inválido, un texto sin leer).
	if action != "scroll" && action != "press" {
		if enabled, err := target.IsEnabled(playwright.LocatorIsEnabledOptions{Timeout: playwright.Float(3000)}); err == nil && !enabled {
			why := ""
			if len(cur.Notices) > 0 {
				why = " · avisos: " + strings.Join(cur.Notices, " | ")
			}
			return Step{}, fmt.Errorf("«%s» está deshabilitado: la página exige algo antes%s", c.Name, why)
		}
	}
	var code string
	var err error
	switch action {
	case "click":
		code = ".click()"
		err = target.Click(playwright.LocatorClickOptions{Timeout: timeout})
	case "fill":
		code = fmt.Sprintf(".fill('%s')", jsQuote(in.Value))
		err = target.Fill(in.Value, playwright.LocatorFillOptions{Timeout: timeout})
	case "check":
		code = ".check()"
		err = target.Check(playwright.LocatorCheckOptions{Timeout: timeout})
	case "uncheck":
		code = ".uncheck()"
		err = target.Uncheck(playwright.LocatorUncheckOptions{Timeout: timeout})
	case "select":
		code = fmt.Sprintf(".selectOption('%s')", jsQuote(in.Value))
		_, err = target.SelectOption(playwright.SelectOptionValues{Values: &[]string{in.Value}}, playwright.LocatorSelectOptionOptions{Timeout: timeout})
		if err != nil { // quizás pasaron la etiqueta y no el valor
			_, err = target.SelectOption(playwright.SelectOptionValues{Labels: &[]string{in.Value}}, playwright.LocatorSelectOptionOptions{Timeout: timeout})
		}
	case "scroll":
		code = ".evaluate((e) => e.scrollTo(0, e.scrollHeight))"
		_, err = target.Evaluate("e => e.scrollTo(0, e.scrollHeight)", nil, playwright.LocatorEvaluateOptions{Timeout: timeout})
	case "press":
		code = fmt.Sprintf(".press('%s')", jsQuote(in.Value))
		err = target.Press(in.Value, playwright.LocatorPressOptions{Timeout: timeout})
	default:
		return Step{}, fmt.Errorf("acción desconocida %q (click · fill · check · uncheck · select · press · scroll)", action)
	}
	step := Step{Code: loc.Code + code, Target: c.Name, OK: err == nil, Error: errText(err)}
	r.recordStep(l, step)
	l.markDirty()
	if err != nil {
		return step, fmt.Errorf("%s sobre «%s»: %s", action, c.Name, firstLine(err.Error()))
	}
	return step, nil
}

func (r *Runner) recordStep(l *live, s Step) {
	s.At = time.Now()
	s.URL = l.page.URL()
	l.mu.Lock()
	l.steps = append(l.steps, s)
	l.mu.Unlock()
	mark := "ok"
	if !s.OK {
		mark = "warn"
	}
	r.say(mark, "paso · %s%s", s.Code, map[bool]string{true: "", false: " · " + s.Error}[s.OK])
}

// LiveExpect espera (con la espera de Playwright) a que un texto se vea en la página, y lo deja como aserción:
// en un recorrido con contenido que cambia solo, es lo que hace que el script no corra más rápido que la página.
func (r *Runner) LiveExpect(text string, seconds float64) (Step, error) {
	l := r.liveSession()
	if l == nil {
		return Step{}, errors.New("no hay sesión en vivo")
	}
	if seconds <= 0 {
		seconds = 15
	}
	err := l.page.GetByText(text).First().WaitFor(playwright.LocatorWaitForOptions{State: playwright.WaitForSelectorStateVisible, Timeout: playwright.Float(seconds * 1000)})
	step := Step{Code: fmt.Sprintf("expect(page.getByText('%s').first()).toBeVisible()", jsQuote(text)), Target: text, OK: err == nil, Error: errText(err)}
	r.recordStep(l, step)
	l.markDirty()
	if err != nil {
		return step, fmt.Errorf("«%s» no se vio en %.0f s", text, seconds)
	}
	return step, nil
}

// LiveClearSteps empieza la lista de pasos de cero (sin cerrar la sesión).
func (r *Runner) LiveClearSteps() {
	if l := r.liveSession(); l != nil {
		l.mu.Lock()
		l.steps = nil
		l.mu.Unlock()
	}
}

func jsQuote(s string) string {
	return strings.NewReplacer(`\`, `\\`, `'`, `\'`, "\n", `\n`).Replace(s)
}

func errText(err error) string {
	if err == nil {
		return ""
	}
	return firstLine(err.Error())
}

// LiveText devuelve el texto visible de la página (para verificar un mensaje sin mirar la pantalla).
func (r *Runner) LiveText() (string, error) {
	l := r.liveSession()
	if l == nil {
		return "", errors.New("no hay sesión en vivo")
	}
	return l.page.InnerText("body", playwright.PageInnerTextOptions{Timeout: playwright.Float(5000)})
}

// LiveShot devuelve la captura de lo que se ve ahora (PNG).
func (r *Runner) LiveShot() ([]byte, error) {
	l := r.liveSession()
	if l == nil {
		return nil, errors.New("no hay sesión en vivo")
	}
	return l.page.Screenshot(playwright.PageScreenshotOptions{Timeout: playwright.Float(10000)})
}

// LiveScript arma con los pasos un script de Playwright que repite el recorrido. Los pasos que fallaron quedan
// comentados: el script es lo que funcionó.
func (r *Runner) LiveScript() string {
	l := r.liveSession()
	if l == nil {
		return ""
	}
	l.mu.Lock()
	steps := append([]Step{}, l.steps...)
	start := l.start
	w, h := l.w, l.h
	l.mu.Unlock()
	var b strings.Builder
	b.WriteString("import { test, expect } from '@playwright/test'\n\n")
	fmt.Fprintf(&b, "test('%s', async ({ page }) => {\n", jsQuote("recorrido en "+l.site.Name))
	// El tamaño con que se recorrió: la disposición (y algún localizador) depende de él.
	fmt.Fprintf(&b, "  await page.setViewportSize({ width: %d, height: %d })\n", w, h)
	if len(steps) == 0 || !strings.HasPrefix(steps[0].Code, "page.goto(") {
		fmt.Fprintf(&b, "  await page.goto('%s')\n", jsQuote(start))
	}
	for _, s := range steps {
		if s.OK {
			fmt.Fprintf(&b, "  await %s\n", s.Code)
		} else {
			fmt.Fprintf(&b, "  // falló: await %s  (%s)\n", s.Code, s.Error)
		}
	}
	b.WriteString("})\n")
	return b.String()
}

// controlsSignature resume lo que hay para tocar: la URL y cada elemento por su tipo, nombre y localizador. Un
// análisis que da lo mismo no invalida los números que alguien acaba de mirar.
func controlsSignature(p *Page) string {
	var b strings.Builder
	b.WriteString(p.URL)
	for _, c := range p.Controls {
		code := ""
		if c.Best >= 0 {
			code = c.Locators[c.Best].Code
		}
		fmt.Fprintf(&b, "|%s:%s:%s", c.Kind, c.Name, code)
	}
	return b.String()
}

func (l *live) startScreencast() error {
	_, err := l.cdp.Send("Page.startScreencast", map[string]any{"format": "jpeg", "quality": 75, "maxWidth": l.w, "maxHeight": l.h})
	return err
}

// LiveResize cambia el tamaño de la página al del editor y reinicia el screencast con ese tamaño. La disposición
// cambia, así que la página se vuelve a analizar (los cuadros y, a veces, los localizadores).
func (r *Runner) LiveResize(w, h int) error {
	l := r.liveSession()
	if l == nil {
		return errors.New("no hay sesión en vivo")
	}
	w, h = clampSize(w, h)
	l.mu.Lock()
	same := l.w == w && l.h == h
	l.mu.Unlock()
	if same {
		return nil
	}
	if err := l.page.SetViewportSize(w, h); err != nil {
		return err
	}
	l.mu.Lock()
	l.w, l.h = w, h
	l.mu.Unlock()
	_, _ = l.cdp.Send("Page.stopScreencast", nil)
	if err := l.startScreencast(); err != nil {
		return err
	}
	l.markDirty()
	return nil
}
