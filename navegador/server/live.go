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
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/playwright-community/playwright-go"
)

// La sesión en vivo corre en uno de dos dispositivos, de tamaño FIJO (el editor la escala para que entre): así
// las fotos, el video de la corrida y el script salen siempre iguales, abra donde se abra la interfaz.
//
//	desktop   una pantalla de escritorio común, 1280×800 (por defecto)
//	mobile    un teléfono: el perfil Pixel 7 de Playwright (412×839, táctil, agente de Chrome en Android), para
//	          que el sitio sirva su versión móvil de verdad y no sólo una ventana angosta
const (
	deviceDesktop = "desktop"
	deviceMobile  = "mobile"
	mobileProfile = "Pixel 7"
)

const liveW, liveH = 1280, 800

func normDevice(d string) string {
	if d == deviceMobile {
		return deviceMobile
	}
	return deviceDesktop
}

// Step es una acción hecha en la sesión, con la línea de Playwright que la reproduce.
type Step struct {
	At      time.Time `json:"at"`
	URL     string    `json:"url"`
	Code    string    `json:"code"`
	Target  string    `json:"target"`
	OK      bool      `json:"ok"`
	Error   string    `json:"error,omitempty"`
	Dialogs []string  `json:"dialogs,omitempty"` // los diálogos del navegador que disparó, con su respuesta
	Shot    string    `json:"shot,omitempty"`    // la foto de cómo quedó la página (NN.png, o NN-fallo.png), en la carpeta de la corrida
	Refused bool      `json:"refused,omitempty"` // se negó antes de actuar (deshabilitado, detrás de un modal): no va al script
	Raw     bool      `json:"raw,omitempty"`     // en el script va tal cual, sin await (const d = page.waitForEvent(…))
	UsesFS  bool      `json:"usesFs,omitempty"`  // en el script necesita import fs
	Note    string    `json:"note,omitempty"`    // un dato más para el paso a paso (dónde quedó una descarga)
	// Para el reproductor de la corrida: la foto de ANTES de actuar, con el elemento a la vista (NN-antes.png), y
	// dónde estaba el elemento (en px CSS de la ventana View) sobre esa foto o, si no la hay, sobre la de después.
	Before string `json:"before,omitempty"`
	Box    *Box   `json:"box,omitempty"`
	View   *Box   `json:"view,omitempty"`
	// En el modo guía, lo que se le pidió a la persona (el paso lo hizo ella, no Claude).
	Guide  string  `json:"guia,omitempty"`
	Manual bool    `json:"manual,omitempty"`
	Change *Change `json:"cambio,omitempty"` // lo que cambió en el campo (antes → después), para mostrar antes de guardar
	// Para repetir el paso sin Claude (replay.go): a qué elemento (el localizador, no la línea TS), qué acción y con
	// qué valor (vacío en un secreto, que siempre escribe la persona).
	Ref    *Ref   `json:"ref,omitempty"`
	Action string `json:"accion,omitempty"`
	Value  string `json:"valor,omitempty"`
	Secret bool   `json:"secreto,omitempty"`
	// Para el video: dónde fue la interacción (px de la ventana View) y por qué (lo que Claude pensó antes).
	Point *Box   `json:"punto,omitempty"`
	Why   string `json:"porque,omitempty"`
	Pause bool   `json:"pausa,omitempty"` // al repetir un flujo, este paso lo hace la persona
}

// elementBox es dónde está un elemento en la ventana y el tamaño de la ventana (nil si no se ve).
func elementBox(l *live, loc playwright.Locator) (*Box, *Box) {
	bb, err := loc.BoundingBox(playwright.LocatorBoundingBoxOptions{Timeout: playwright.Float(1500)})
	vs := l.page.ViewportSize()
	if err != nil || bb == nil || vs == nil || bb.Width <= 0 || bb.Height <= 0 {
		return nil, nil
	}
	return &Box{X: int(bb.X), Y: int(bb.Y), W: int(bb.Width), H: int(bb.Height)}, &Box{W: vs.Width, H: vs.Height}
}

// shotBefore saca la foto de antes de actuar, con el elemento llevado a la vista (la acción lo haría igual), y
// lo marca en el paso. Sin elemento visible, el paso queda sin foto de antes.
func (r *Runner) shotBefore(l *live, loc playwright.Locator, s *Step) {
	_ = loc.ScrollIntoViewIfNeeded(playwright.LocatorScrollIntoViewIfNeededOptions{Timeout: playwright.Float(1500)})
	box, view := elementBox(l, loc)
	if box == nil {
		return
	}
	l.mu.Lock()
	n := len(l.steps) + 1
	if l.runDir == "" {
		l.runDir = filepath.Join(r.store.dir, "corridas", time.Now().Format("2006-01-02_15-04-05"))
	}
	dir := l.runDir
	l.mu.Unlock()
	if os.MkdirAll(dir, 0o700) != nil {
		return
	}
	name := fmt.Sprintf("%02d-antes.png", n)
	if _, err := l.page.Screenshot(playwright.PageScreenshotOptions{Path: playwright.String(filepath.Join(dir, name)), Timeout: playwright.Float(5000)}); err == nil {
		s.Before, s.Box, s.View = name, box, view
	}
}

// savedDownload es un archivo que bajó el navegador por una acción.
type savedDownload struct {
	name string
	path string
	size int64
	err  error
}

// dialogSeen es un alert/confirm/prompt que apareció, cómo se contestó y la línea que lo reproduce.
type dialogSeen struct {
	message string
	code    string
}

// LiveState es lo que la interfaz y el CLI preguntan: dónde está, qué hay para tocar y qué se hizo.
type LiveState struct {
	Active    bool      `json:"active"`
	Site      string    `json:"site"`
	URL       string    `json:"url"`
	Title     string    `json:"title"`
	Width     int       `json:"width"`
	Height    int       `json:"height"`
	Device    string    `json:"device"`           // desktop · mobile
	Guide     *GuideReq `json:"guide,omitempty"`  // el paso de la guía que espera a la persona
	Replay    *Replay   `json:"replay,omitempty"` // la repetición de una guía en curso (o la última)
	Popup     string    `json:"popup,omitempty"`  // la ventana emergente que se está mostrando (un login)
	Version   int       `json:"version"`          // sube con cada análisis nuevo
	Analyzing bool      `json:"analyzing"`
	Page      *Page     `json:"page,omitempty"`
	Steps     []Step    `json:"steps"`
	Dialogs   []string  `json:"dialogs"`        // los últimos diálogos del navegador y cómo se contestaron
	ScrollY   float64   `json:"scrollY"`        // dónde está la pantalla: el look muestra primero lo que se ve
	Dismiss   bool      `json:"dismissDialogs"` // la política: true rechaza los confirm, false los acepta
}

type live struct {
	site   Site
	bctx   playwright.BrowserContext
	page   playwright.Page
	cdp    playwright.CDPSession
	tap    *tap
	start  string
	w, h   int
	device string  // desktop · mobile
	dpr    float64 // la densidad de la pantalla (2,6 en el teléfono): el screencast va a esa nitidez, con tope
	clean  bool    // el perfil es temporal (cambiar de dispositivo arranca otro, vacío)

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

	// Los diálogos del navegador (alert, confirm, prompt). Sin respuesta, Playwright los descarta en silencio y un
	// «Vaciar carrito» con confirm() parece funcionar sin hacer nada. Se contestan según dismiss (por defecto,
	// aceptar) y quedan registrados.
	dismissDialogs bool
	dialogs        []dialogSeen
	recentDialogs  []string

	// La corrida: la carpeta donde quedan las fotos de cada paso y el reporte (report.go). Se crea con el primer
	// paso después de un reset.
	runDir string
	// Las páginas consultadas en la corrida (analizadas o leídas): las fuentes del reporte.
	sources []Source

	// Una pestaña nueva se procesa en paralelo; si la abrió una acción, su goto va DESPUÉS de ese paso.
	acting       bool
	popupsFlying int
	popupSteps   []Step

	// Las descargas que dispara una acción: se guardan en .data/descargas y en el script quedan como
	// waitForEvent('download') antes del paso y saveAs después.
	downloadsFlying int
	downloads       []savedDownload
	downloadSeq     int

	// El modo guía (guide.go): el paso marcado que espera a la persona, y cuánto tocó ella la página.
	guide        *GuideReq
	guideSeq     int
	guideAnswers chan guideAnswer
	inputs       int
	lastInput    time.Time
	lastClick    *Box // dónde hizo clic la persona por última vez (px de la ventana): el punto del paso en el video
	lastClickAt  time.Time

	// Lo que Claude pensó antes de su próxima acción (lo manda ask): el «por qué» del subtítulo de ese paso.
	pendingWhy string

	// La repetición de una guía en curso (replay.go).
	replay *Replay

	// Una ventana emergente que abrió la persona a mano (un login con Google): se ve y se maneja en el editor
	// hasta que se cierra.
	popup playwright.Page
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

// LiveStart abre la sesión en vivo en `start` (o en la entrada del sitio), en ese dispositivo. Con clean, en un
// perfil TEMPORAL que se borra al cerrar: sin el login ni lo guardado de corridas anteriores (lo usan las evals,
// para que el script no dependa de un estado que dejó otra corrida).
func (r *Runner) LiveStart(slug, start, device string, clean bool) error {
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
		if err := r.runLive(ctx, site, start, normDevice(device), clean, ready); err != nil {
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

func (r *Runner) runLive(ctx context.Context, site Site, start, device string, clean bool, ready chan<- error) error {
	profile := r.store.ProfileDir(site.Slug)
	if clean {
		tmp, err := os.MkdirTemp("", "navegador-limpio-")
		if err != nil {
			return err
		}
		defer os.RemoveAll(tmp)
		profile = tmp
	}
	pw, err := r.playwright()
	if err != nil {
		return err
	}
	opts := playwright.BrowserTypeLaunchPersistentContextOptions{
		Headless: playwright.Bool(true),
		Viewport: &playwright.Size{Width: liveW, Height: liveH},
		Args:     []string{"--disable-blink-features=AutomationControlled"},
	}
	w, h, dpr := liveW, liveH, 1.0
	if device == deviceMobile {
		d := pw.Devices[mobileProfile]
		if d == nil || d.Viewport == nil {
			return fmt.Errorf("playwright no trae el perfil %s", mobileProfile)
		}
		w, h, dpr = d.Viewport.Width, d.Viewport.Height, d.DeviceScaleFactor
		opts.Viewport = &playwright.Size{Width: w, Height: h}
		opts.UserAgent = playwright.String(d.UserAgent)
		opts.DeviceScaleFactor = playwright.Float(d.DeviceScaleFactor)
		opts.IsMobile = playwright.Bool(d.IsMobile)
		opts.HasTouch = playwright.Bool(d.HasTouch)
	}
	bctx, err := pw.Chromium.LaunchPersistentContext(profile, opts)
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
	l := &live{site: site, bctx: bctx, page: page, tap: &tap{}, start: start, w: w, h: h, device: device, dpr: dpr, clean: clean, subs: map[chan []byte]struct{}{}, dirty: make(chan struct{}, 1)}
	l.tap.attach(page)
	page.OnDialog(func(d playwright.Dialog) {
		l.mu.Lock()
		dismiss := l.dismissDialogs
		l.mu.Unlock()
		answer, code := "aceptado", "page.once('dialog', (d) => d.accept())"
		if dismiss {
			answer, code = "rechazado", "page.once('dialog', (d) => d.dismiss())"
		}
		msg := fmt.Sprintf("%s «%s» → %s", d.Type(), d.Message(), answer)
		go func() {
			if dismiss {
				_ = d.Dismiss()
			} else {
				_ = d.Accept()
			}
		}()
		l.mu.Lock()
		l.dialogs = append(l.dialogs, dialogSeen{message: msg, code: code})
		l.recentDialogs = append(l.recentDialogs, msg)
		if len(l.recentDialogs) > 5 {
			l.recentDialogs = l.recentDialogs[len(l.recentDialogs)-5:]
		}
		l.mu.Unlock()
		r.say("info", "diálogo · %s", msg)
	})
	page.OnDownload(func(d playwright.Download) {
		l.mu.Lock()
		l.downloadsFlying++
		l.mu.Unlock()
		go func() {
			defer func() { l.mu.Lock(); l.downloadsFlying--; l.mu.Unlock() }()
			dir := filepath.Join(r.store.dir, "descargas")
			_ = os.MkdirAll(dir, 0o700)
			name := d.SuggestedFilename()
			path := filepath.Join(dir, name)
			err := d.SaveAs(path)
			var size int64
			if fi, statErr := os.Stat(path); statErr == nil {
				size = fi.Size()
			}
			l.mu.Lock()
			l.downloads = append(l.downloads, savedDownload{name: name, path: path, size: size, err: err})
			l.mu.Unlock()
			r.say("info", "descarga · %s (%d bytes) → %s", name, size, path)
		}()
	})
	page.OnFrameNavigated(func(f playwright.Frame) {
		if f.ParentFrame() == nil {
			// Los diálogos recientes son de ESTA página: al navegar, los de la anterior se olvidan (si no, un
			// confirm viejo se muestra como si acabara de pasar).
			l.mu.Lock()
			l.recentDialogs = nil
			l.mu.Unlock()
			l.markDirty()
		}
	})
	// Una pestaña nueva (target=_blank) se trae a la misma: la sesión muestra una sola página.
	// En el script queda como un goto a esa URL después del clic: al repetirlo, el clic abre su pestaña aparte y el
	// goto deja la página principal donde siguió el recorrido.
	bctx.OnPage(func(p playwright.Page) {
		l.mu.Lock()
		manual := !l.acting && l.cdp != nil && r.replayIdle(l)
		if !manual {
			l.popupsFlying++
		}
		l.mu.Unlock()
		// La persona navegando a mano (un «Entrar con Google»): la ventana se muestra en el editor tal cual, sin
		// cerrarla, porque un login por popup necesita a la página que la abrió.
		if manual {
			go r.showPopup(l, p)
			return
		}
		go func() {
			defer func() { l.mu.Lock(); l.popupsFlying--; l.mu.Unlock() }()
			_ = p.WaitForLoadState(playwright.PageWaitForLoadStateOptions{State: playwright.LoadStateDomcontentloaded, Timeout: playwright.Float(10000)})
			u := p.URL()
			_ = p.Close()
			if u != "" && u != "about:blank" {
				_, err := l.page.Goto(u)
				step := Step{Code: fmt.Sprintf("page.goto('%s')", jsQuote(u)), Target: "pestaña nueva", OK: err == nil, Error: errText(err)}
				l.mu.Lock()
				acting := l.acting
				if acting {
					l.popupSteps = append(l.popupSteps, step)
				}
				l.mu.Unlock()
				if !acting {
					r.recordStep(l, step)
				}
				r.say("info", "una pestaña nueva (%s) se abrió en la misma sesión", u)
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

	if clean {
		r.say("info", "en vivo en %s, con un perfil limpio (sin sesiones ni datos guardados)", start)
	} else {
		r.say("info", "en vivo en %s · lo que hagas en el editor (o con bin/navegador) pasa en este navegador", start)
	}
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
	l.mu.Unlock()
	defer func() { l.mu.Lock(); l.analyzing = false; l.mu.Unlock() }()

	settle(l.page)
	pg := r.analyze(l.page, l.tap)
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
	scrollY := 0.0
	if v, err := l.page.Evaluate("() => scrollY"); err == nil {
		scrollY, _ = toFloat(v)
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	return LiveState{
		Active: true, Site: l.site.Slug, URL: l.page.URL(), Title: title, Width: l.w, Height: l.h, Device: l.device, Guide: l.guide, Replay: l.replayCopy(), Popup: l.popupURL(),
		Version: l.version, Analyzing: l.analyzing, Page: l.current, Steps: append([]Step{}, l.steps...),
		Dialogs: append([]string{}, l.recentDialogs...), Dismiss: l.dismissDialogs, ScrollY: scrollY,
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
	target := l.page
	l.mu.Lock()
	if l.popup != nil {
		target = l.popup
	}
	l.mu.Unlock()
	m, k := target.Mouse(), target.Keyboard()
	if in.Type == "click" || in.Type == "up" || in.Type == "key" || in.Type == "text" {
		l.mu.Lock()
		l.inputs++
		l.lastInput = time.Now()
		if in.Type == "click" || in.Type == "up" {
			l.lastClick, l.lastClickAt = &Box{X: int(in.X), Y: int(in.Y)}, time.Now()
		}
		l.mu.Unlock()
	}
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

// NavNote no es un error: avisa algo de la navegación (que la URL era una descarga).
type NavNote struct{ Note string }

func (n *NavNote) Error() string { return n.Note }

// LiveNav: ir a una URL, atrás, adelante o recargar.
func (r *Runner) LiveNav(action, target string) error {
	l := r.liveSession()
	if l == nil {
		return errors.New("no hay sesión en vivo")
	}
	var err error
	switch action {
	case "goto":
		target = withScheme(target)
		_, err = l.page.Goto(target, playwright.PageGotoOptions{WaitUntil: playwright.WaitUntilStateDomcontentloaded, Timeout: playwright.Float(45000)})
		// Una URL que baja un archivo (un PDF, un ZIP) no es un error: el archivo queda guardado y se informa dónde.
		if err != nil && strings.Contains(err.Error(), "Download is starting") {
			for i := 0; i < 100; i++ {
				l.mu.Lock()
				flying := l.downloadsFlying
				l.mu.Unlock()
				if flying == 0 {
					break
				}
				time.Sleep(100 * time.Millisecond)
			}
			l.mu.Lock()
			downloads := l.downloads
			l.downloads = nil
			l.mu.Unlock()
			note := "era una descarga"
			for _, d := range downloads {
				note = fmt.Sprintf("era una descarga: quedó en %s (%d bytes)", d.path, d.size)
			}
			r.recordStep(l, Step{Code: fmt.Sprintf("page.goto('%s')", jsQuote(target)), Target: target, OK: true, Note: note, Action: "goto", Value: target})
			return &NavNote{Note: note}
		}
		r.recordStep(l, Step{Code: fmt.Sprintf("page.goto('%s')", jsQuote(target)), Target: target, OK: err == nil, Error: errText(err), Action: "goto", Value: target})
	case "back":
		_, err = l.page.GoBack()
		r.recordStep(l, Step{Code: "page.goBack()", Target: "atrás", OK: err == nil, Error: errText(err), Action: "back"})
	case "forward":
		_, err = l.page.GoForward()
		r.recordStep(l, Step{Code: "page.goForward()", Target: "adelante", OK: err == nil, Error: errText(err), Action: "forward"})
	case "scroll": // la página entera, hasta abajo
		_, err = l.page.Evaluate("() => window.scrollTo(0, document.body.scrollHeight)")
		r.recordStep(l, Step{Code: "page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))", Target: "bajar la página", OK: err == nil, Error: errText(err), Action: "scroll-page"})
	case "reload":
		_, err = l.page.Reload()
		r.recordStep(l, Step{Code: "page.reload()", Target: "recargar", OK: err == nil, Error: errText(err), Action: "reload"})
	default:
		err = fmt.Errorf("navegación desconocida %q", action)
	}
	l.markDirty()
	return err
}

// LiveAct hace una acción sobre un elemento de la página actual: por su número (con su localizador recomendado)
// o, si no es un elemento interactivo (un texto con doble clic, un ítem de una lista), por su texto visible.
type LiveAct struct {
	Control int    `json:"control"`
	Text    string `json:"text"`    // en vez de un número: el texto visible del objetivo
	Action  string `json:"action"`  // click · dblclick · hover · fill · check · uncheck · select · press · scroll · upload · drag
	Value   string `json:"value"`   // lo que se escribe, la opción, la tecla, la ruta del archivo o el destino de drag
	Version int    `json:"version"` // el análisis sobre el que se eligió el elemento: si cambió, se avisa
	Name    string `json:"name"`    // cómo se llamaba ese número en aquel análisis: si sigue igual, no hay riesgo
}

// target resuelve a qué apunta una acción: el localizador, su código TS y un nombre para los mensajes.
func (r *Runner) liveTarget(l *live, cur *Page, num int, text string) (playwright.Locator, string, *Control, error) {
	if num < 0 && strings.TrimSpace(text) == "" {
		return nil, "", nil, errors.New("falta el elemento: un número del último look o su texto")
	}
	if text != "" {
		for _, exact := range []bool{true, false} {
			// Sólo lo visible: el botón de un modal cerrado existe en el DOM, pero no se puede tocar.
			loc := l.page.GetByText(text, playwright.PageGetByTextOptions{Exact: playwright.Bool(exact)}).Filter(playwright.LocatorFilterOptions{Visible: playwright.Bool(true)})
			n, err := loc.Count()
			if err != nil {
				return nil, "", nil, err
			}
			if n == 1 {
				code := fmt.Sprintf("page.getByText('%s'%s).filter({ visible: true })", jsQuote(text), map[bool]string{true: ", { exact: true }", false: ""}[exact])
				return loc, code, nil, nil
			}
			if n > 1 {
				return nil, "", nil, fmt.Errorf("«%s» aparece %d veces: usá un texto más largo o el número del elemento", text, n)
			}
		}
		// Sin texto visible: una imagen por su texto alternativo, o un campo por su etiqueta o su placeholder
		// («Buscar» es la etiqueta del buscador, no un texto de la página).
		visible := playwright.LocatorFilterOptions{Visible: playwright.Bool(true)}
		exact := playwright.Bool(true)
		for _, alt := range []struct {
			loc  playwright.Locator
			code string
		}{
			{l.page.GetByAltText(text, playwright.PageGetByAltTextOptions{Exact: exact}).Filter(visible), "page.getByAltText('%s', { exact: true }).filter({ visible: true })"},
			{l.page.GetByLabel(text, playwright.PageGetByLabelOptions{Exact: exact}).Filter(visible), "page.getByLabel('%s', { exact: true }).filter({ visible: true })"},
			{l.page.GetByPlaceholder(text, playwright.PageGetByPlaceholderOptions{Exact: exact}).Filter(visible), "page.getByPlaceholder('%s', { exact: true }).filter({ visible: true })"},
		} {
			n, err := alt.loc.Count()
			if err != nil {
				continue
			}
			if n == 1 {
				return alt.loc, fmt.Sprintf(alt.code, jsQuote(text)), nil, nil
			}
			if n > 1 {
				return nil, "", nil, fmt.Errorf("«%s» nombra %d elementos: usá el número del elemento", text, n)
			}
		}
		return nil, "", nil, fmt.Errorf("no hay un texto, una imagen ni un campo «%s» en la página", text)
	}
	if num < 0 || num >= len(cur.Controls) {
		return nil, "", nil, fmt.Errorf("no hay un elemento %d (la página tiene %d)", num+1, len(cur.Controls))
	}
	c := &cur.Controls[num]
	if c.Best < 0 {
		return nil, "", nil, fmt.Errorf("el elemento %d «%s» no tiene un localizador único: probá por su texto", num+1, c.Name)
	}
	loc := c.Locators[c.Best]
	return locatorFor(l.page, loc, c.Frame), loc.Code, c, nil
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
		// Recién abierta, la página todavía no tiene análisis: se hace ahora en vez de negar la acción.
		var err error
		if cur, err = r.liveAnalyze(l); err != nil {
			return Step{}, fmt.Errorf("analizar la página: %v", err)
		}
		l.mu.Lock()
		version = l.version
		l.mu.Unlock()
	}
	// La página cambió desde el look: un número viejo podría tocar OTRO elemento, así que se niega… salvo que ese
	// número todavía nombre lo mismo (en una búsqueda, los resultados que cargan después cambian la lista sin mover
	// lo que ya estaba).
	if in.Text == "" && in.Version != 0 && in.Version != version {
		same := in.Name != "" && in.Control >= 0 && in.Control < len(cur.Controls) && cur.Controls[in.Control].Name == in.Name
		if !same {
			return Step{}, fmt.Errorf("la página cambió desde que la miraste (análisis %d, ahora %d) y el elemento %d ya no es «%s»: volvé a mirarla", in.Version, version, in.Control+1, in.Name)
		}
	}
	target, base, c, err := r.liveTarget(l, cur, in.Control, in.Text)
	if err != nil {
		return Step{}, err
	}
	return r.performAct(l, cur, in, target, base, c, targetRef(c, in.Text, base))
}

// performAct hace la acción sobre un objetivo ya resuelto (por número, por texto, o por el localizador guardado
// de un paso cuando se repite una guía) y la registra con todo lo que el reproductor y la repetición necesitan.
func (r *Runner) performAct(l *live, cur *Page, in LiveAct, target playwright.Locator, base string, c *Control, ref *Ref) (Step, error) {
	var err error
	name := in.Text
	kind := ""
	if c != nil {
		name, kind = c.Name, c.Kind
	}
	action := in.Action
	if action == "" {
		action = map[string]string{"field": "fill", "select": "select", "check": "check", "scroll": "scroll", "file": "upload", "drag": "drag"}[kind]
		if action == "" {
			action = "click"
		}
	}
	timeout := playwright.Float(10000)
	// La foto de antes, con el elemento marcado: en el reproductor, se ve QUÉ se va a tocar y después cómo quedó.
	var shown Step
	r.shotBefore(l, target, &shown)
	// Lo que no va a funcionar se niega al instante, con la causa: esperar 10 s la esconde.
	// Una acción negada queda como paso FALLIDO, con su foto: es lo que más interesa ver en el paso a paso.
	refuse := func(err error) (Step, error) {
		st := Step{Code: base + "." + action + "()", Target: name, OK: false, Error: err.Error(), Refused: true, Before: shown.Before, Box: shown.Box, View: shown.View}
		r.recordStep(l, st)
		return st, err
	}
	if c != nil && c.Blocked {
		return refuse(fmt.Errorf("«%s» está detrás de un modal abierto: cerralo o actuá adentro de él", name))
	}
	if action != "scroll" && action != "press" && action != "hover" {
		if enabled, err := target.IsEnabled(playwright.LocatorIsEnabledOptions{Timeout: playwright.Float(3000)}); err == nil && !enabled {
			why := ""
			if len(cur.Notices) > 0 {
				why = " · avisos: " + strings.Join(cur.Notices, " | ")
			}
			return refuse(fmt.Errorf("«%s» está deshabilitado: la página exige algo antes%s", name, why))
		}
	}
	l.mu.Lock()
	l.dialogs = nil
	l.acting = true
	l.mu.Unlock()
	defer func() { l.mu.Lock(); l.acting = false; l.mu.Unlock() }()

	// Lo que había en el campo antes: con lo que queda después, es el cambio que se muestra antes de guardar.
	var before string
	tracked := action == "fill" || action == "select" || action == "check" || action == "uncheck"
	if tracked {
		before = fieldState(target, action)
	}
	var code string
	switch action {
	case "click":
		code = ".click()"
		err = target.Click(playwright.LocatorClickOptions{Timeout: timeout})
	case "dblclick":
		code = ".dblclick()"
		// Dblclick de playwright-go manda un campo (steps) que el driver rechaza; dos clics seguidos disparan el
		// mismo dblclick en el navegador, y en el script queda .dblclick(), que en Playwright TS anda.
		err = target.Click(playwright.LocatorClickOptions{Timeout: timeout, ClickCount: playwright.Int(2)})
	case "hover":
		code = ".hover()"
		err = target.Hover(playwright.LocatorHoverOptions{Timeout: timeout})
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
	case "upload":
		if in.Value == "" {
			return Step{}, errors.New("falta la ruta del archivo a subir")
		}
		if _, statErr := os.Stat(in.Value); statErr != nil {
			return Step{}, fmt.Errorf("no encuentro el archivo %s", in.Value)
		}
		code = fmt.Sprintf(".setInputFiles('%s')", jsQuote(in.Value))
		err = target.SetInputFiles(in.Value, playwright.LocatorSetInputFilesOptions{Timeout: timeout})
	case "drag":
		// El destino es otro elemento: su número (1, 2…) o su texto.
		n, convErr := strconv.Atoi(in.Value)
		destNum, destText := -1, in.Value
		if convErr == nil {
			destNum, destText = n-1, ""
		}
		dest, destCode, _, dErr := r.liveTarget(l, cur, destNum, destText)
		if dErr != nil {
			return Step{}, fmt.Errorf("destino del arrastre: %v", dErr)
		}
		code = fmt.Sprintf(".dragTo(%s)", destCode)
		err = target.DragTo(dest, playwright.LocatorDragToOptions{Timeout: timeout})
	default:
		return Step{}, fmt.Errorf("acción desconocida %q (click · dblclick · hover · fill · check · uncheck · select · press · scroll · upload · drag)", action)
	}
	// Un confirm() o alert() que dispara la acción llega un instante después: se espera un poco para registrarlo
	// ANTES del paso, que es donde lo pone una prueba (page.once('dialog', …) antes del clic).
	time.Sleep(250 * time.Millisecond)
	// Si la acción abrió una pestaña nueva o bajó un archivo, se espera a que termine (hasta 10 s).
	for i := 0; i < 100; i++ {
		l.mu.Lock()
		flying := l.popupsFlying + l.downloadsFlying
		l.mu.Unlock()
		if flying == 0 {
			break
		}
		time.Sleep(100 * time.Millisecond)
	}
	l.mu.Lock()
	dialogs := l.dialogs
	l.dialogs = nil
	popups := l.popupSteps
	l.popupSteps = nil
	downloads := l.downloads
	l.downloads = nil
	l.mu.Unlock()
	for _, d := range dialogs {
		r.recordStep(l, Step{Code: d.code, Target: d.message, OK: true, Action: "dialog", Value: map[bool]string{true: "dismiss", false: "accept"}[strings.Contains(d.code, "dismiss")]})
	}
	// Una descarga va en el script como lo escribe Playwright: la espera ANTES del paso y el guardado después.
	var after []Step
	for _, d := range downloads {
		l.mu.Lock()
		l.downloadSeq++
		v := fmt.Sprintf("descarga%d", l.downloadSeq)
		l.mu.Unlock()
		r.recordStep(l, Step{Code: fmt.Sprintf("const %s = page.waitForEvent('download')", v), Target: d.name, OK: true, Raw: true})
		note := fmt.Sprintf("descargado: %s (%d bytes)", d.path, d.size)
		if d.err != nil {
			note = "no se pudo guardar la descarga: " + d.err.Error()
		}
		after = append(after, Step{Code: fmt.Sprintf("(await %s).saveAs('%s')", v, jsQuote(d.name)), Target: d.name, OK: d.err == nil, Error: errText(d.err), Note: note})
	}
	step := Step{Code: base + code, Target: name, OK: err == nil, Error: errText(err), Before: shown.Before, Box: shown.Box, View: shown.View,
		Ref: ref, Action: action, Value: in.Value, Point: center(shown.Box)}
	if (action == "fill" || action == "press") && isSecret(target, name) {
		step.Value, step.Secret = "", true // lo que se escribió en una llave no se guarda ni para repetirlo
	}
	if tracked && err == nil {
		after := fieldState(target, action)
		if isSecret(target, name) { // una llave no se muestra nunca: sólo si cambió
			before, after = map[bool]string{true: "•••", false: ""}[before != ""], map[bool]string{true: "•••", false: ""}[after != ""]
		}
		step.Change = &Change{Field: name, Before: before, After: after}
	}
	for _, x := range after {
		step.Note = strings.TrimPrefix(step.Note+"; "+x.Note, "; ")
	}
	for _, d := range dialogs {
		step.Dialogs = append(step.Dialogs, d.message)
	}
	r.recordStep(l, step)
	for _, a := range after {
		r.recordStep(l, a)
	}
	for _, p := range popups {
		r.recordStep(l, p)
	}
	l.markDirty()
	if err != nil {
		return step, fmt.Errorf("%s sobre «%s»: %s", action, name, errText(err))
	}
	return step, nil
}

func (r *Runner) recordStep(l *live, s Step) {
	s.At = time.Now()
	s.URL = l.page.URL()
	// La foto de cómo quedó la página: la evidencia del paso a paso. Un fallo la lleva marcada.
	l.mu.Lock()
	n := len(l.steps) + 1
	if l.runDir == "" {
		l.runDir = filepath.Join(r.store.dir, "corridas", time.Now().Format("2006-01-02_15-04-05"))
	}
	dir := l.runDir
	l.mu.Unlock()
	if err := os.MkdirAll(dir, 0o700); err == nil {
		// Un instante para que la página termine de cargar: la foto es de cómo QUEDÓ, no del medio de la
		// navegación (sin esto salían desplegables a medio cerrar y videos en negro). Con tope, para no trabar.
		_ = l.page.WaitForLoadState(playwright.PageWaitForLoadStateOptions{State: playwright.LoadStateLoad, Timeout: playwright.Float(3000)})
		time.Sleep(300 * time.Millisecond)
		name := fmt.Sprintf("%02d.png", n)
		if !s.OK {
			name = fmt.Sprintf("%02d-fallo.png", n)
		}
		if _, err := l.page.Screenshot(playwright.PageScreenshotOptions{Path: playwright.String(filepath.Join(dir, name)), Timeout: playwright.Float(5000)}); err == nil {
			s.Shot = name
		}
	}
	// Es fuente donde se hizo algo (y lo que se leyó, en LiveRead); no cualquier página analizada de fondo, que
	// puede ser de antes de un reset.
	title, _ := l.page.Title()
	l.mu.Lock()
	if s.Why == "" && !s.Manual && s.Action != "dialog" && !s.Raw {
		s.Why, l.pendingWhy = l.pendingWhy, ""
	}
	l.steps = append(l.steps, s)
	l.noteSource(s.URL, title, "")
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
	// La primera VISIBLE: en sitios grandes el mismo texto suele estar también en un elemento oculto (un menú, una
	// plantilla), y esperar al primero a secas no termina nunca.
	found := l.page.GetByText(text).Filter(playwright.LocatorFilterOptions{Visible: playwright.Bool(true)}).First()
	err := found.WaitFor(playwright.LocatorWaitForOptions{State: playwright.WaitForSelectorStateVisible, Timeout: playwright.Float(seconds * 1000)})
	step := Step{Code: fmt.Sprintf("expect(page.getByText('%s').filter({ visible: true }).first()).toBeVisible()", jsQuote(text)), Target: text, OK: err == nil, Error: errText(err), Action: "expect", Value: text}
	if err == nil { // el texto que se vio, marcado sobre la foto de después
		_ = found.ScrollIntoViewIfNeeded(playwright.LocatorScrollIntoViewIfNeededOptions{Timeout: playwright.Float(1500)})
		step.Box, step.View = elementBox(l, found)
		step.Point = center(step.Box)
	}
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
		l.recentDialogs = nil
		l.runDir = "" // la próxima acción abre una corrida nueva
		l.sources = nil
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
	if why := callLogWhy(err.Error()); why != "" {
		return firstLine(err.Error()) + " · " + why
	}
	return firstLine(err.Error())
}

// callLogWhy saca del registro de Playwright por qué esperó hasta el tope: «Timeout 10000ms exceeded» solo no
// dice nada, y la causa (otro elemento tapa el clic, no se ve, está fuera de la pantalla) es lo que hay que
// resolver. En un teléfono es lo más común: un menú o una tarjeta encima del enlace.
func callLogWhy(msg string) string {
	why := ""
	for _, line := range strings.Split(msg, "\n") {
		t := strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(line), "-"))
		for _, k := range []string{"intercepts pointer events", "element is not visible", "element is outside of the viewport", "element is not enabled", "element is not stable", "element is not attached"} {
			if strings.Contains(t, k) {
				why = t // la última: es el estado en que quedó al vencer
			}
		}
	}
	return truncate(why, 200)
}

// LiveText devuelve el texto visible de la página, CON lo que hay en shadow roots e iframes: el innerText del
// body no los incluye, y un «no aparece» falso es peor que no saber (lo que se lee de menos se lee como «no existe»).
func (r *Runner) LiveText() (string, error) {
	l := r.liveSession()
	if l == nil {
		return "", errors.New("no hay sesión en vivo")
	}
	raw, err := l.page.Evaluate(`() => {
		const parts = [document.body.innerText]
		const walk = (root) => root.querySelectorAll('*').forEach((el) => {
			if (el.shadowRoot) { parts.push([...el.shadowRoot.children].map((c) => c.innerText || '').join('\n')); walk(el.shadowRoot) }
		})
		walk(document)
		return parts.join('\n')
	}`)
	if err != nil {
		return "", err
	}
	text, _ := raw.(string)
	for _, f := range l.page.MainFrame().ChildFrames() {
		if t, err := f.InnerText("body", playwright.FrameInnerTextOptions{Timeout: playwright.Float(2000)}); err == nil && strings.TrimSpace(t) != "" {
			text += "\n" + t
		}
	}
	return text, nil
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
	w, h, device := l.w, l.h, l.device
	l.mu.Unlock()
	var b strings.Builder
	usesFS := false
	for _, s := range steps {
		usesFS = usesFS || s.UsesFS
	}
	if device == deviceMobile {
		b.WriteString("import { test, expect, devices } from '@playwright/test'\n")
	} else {
		b.WriteString("import { test, expect } from '@playwright/test'\n")
	}
	if usesFS {
		b.WriteString("import fs from 'node:fs'\n")
	}
	b.WriteString("\n")
	// En el teléfono, el perfil entero (agente, táctil, densidad): el sitio sirve otra página que en escritorio.
	if device == deviceMobile {
		fmt.Fprintf(&b, "test.use({ ...devices['%s'] })\n\n", mobileProfile)
	}
	fmt.Fprintf(&b, "test('%s', async ({ page }) => {\n", jsQuote("recorrido en "+l.site.Name))
	// El tamaño con que se recorrió: la disposición (y algún localizador) depende de él.
	if device != deviceMobile {
		fmt.Fprintf(&b, "  await page.setViewportSize({ width: %d, height: %d })\n", w, h)
	}
	if len(steps) == 0 || !strings.HasPrefix(steps[0].Code, "page.goto(") {
		fmt.Fprintf(&b, "  await page.goto('%s')\n", jsQuote(start))
	}
	for _, s := range steps {
		if s.Refused {
			continue // nunca llegó a correr: en el script no dice nada
		}
		if s.Guide != "" {
			fmt.Fprintf(&b, "  // guía: %s\n", strings.ReplaceAll(s.Guide, "\n", " "))
		}
		if s.OK && s.Raw {
			fmt.Fprintf(&b, "  %s\n", s.Code)
		} else if s.OK {
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
	scale := min(max(l.dpr, 1), 2) // nítido en el teléfono, sin mandar cuadros de 3× por la red
	_, err := l.cdp.Send("Page.startScreencast", map[string]any{"format": "jpeg", "quality": 75, "maxWidth": int(float64(l.w) * scale), "maxHeight": int(float64(l.h) * scale)})
	return err
}

// LiveDevice cambia de dispositivo: el perfil de un teléfono (agente, táctil, densidad) sólo se fija al abrir
// el navegador, así que se cierra la sesión y se abre otra en la misma página. Con un perfil limpio, lo que había
// (un login) se pierde.
func (r *Runner) LiveDevice(device string) error {
	device = normDevice(device)
	l := r.liveSession()
	if l == nil {
		return errors.New("no hay sesión en vivo")
	}
	if l.device == device {
		return nil
	}
	slug, url, clean := l.site.Slug, l.page.URL(), l.clean
	r.Stop()
	for i := 0; i < 100 && r.State(0).Busy; i++ {
		time.Sleep(100 * time.Millisecond)
	}
	return r.LiveStart(slug, url, device, clean)
}

// LiveDialogPolicy decide cómo se contestan los próximos diálogos: aceptar (por defecto) o rechazar.
func (r *Runner) LiveDialogPolicy(dismiss bool) error {
	l := r.liveSession()
	if l == nil {
		return errors.New("no hay sesión en vivo")
	}
	l.mu.Lock()
	l.dismissDialogs = dismiss
	l.mu.Unlock()
	return nil
}

// LiveValue lee el valor de un campo (que no es texto visible: wait y text no lo ven). Con `expected`, lo
// compara y lo deja como aserción del script: expect(…).toHaveValue('…').
func (r *Runner) LiveValue(num int, text, expected string) (string, Step, error) {
	l := r.liveSession()
	if l == nil {
		return "", Step{}, errors.New("no hay sesión en vivo")
	}
	l.mu.Lock()
	cur := l.current
	l.mu.Unlock()
	if cur == nil {
		var err error
		if cur, err = r.liveAnalyze(l); err != nil {
			return "", Step{}, fmt.Errorf("analizar la página: %v", err)
		}
	}
	target, code, c, err := r.liveTarget(l, cur, num, text)
	if err != nil {
		return "", Step{}, err
	}
	if c != nil && c.Kind == "field" && strings.EqualFold(c.Type, "password") {
		return "", Step{}, errors.New("no leo el valor de un campo de contraseña")
	}
	value, err := target.InputValue(playwright.LocatorInputValueOptions{Timeout: playwright.Float(5000)})
	if err != nil {
		return "", Step{}, fmt.Errorf("leer el valor: %s", firstLine(err.Error()))
	}
	if expected == "" {
		return value, Step{}, nil
	}
	step := Step{Code: fmt.Sprintf("expect(%s).toHaveValue('%s')", code, jsQuote(expected)), Target: expected, OK: value == expected}
	if !step.OK {
		step.Error = fmt.Sprintf("tiene «%s»", value)
	}
	r.recordStep(l, step)
	if !step.OK {
		return value, step, fmt.Errorf("el campo tiene «%s», no «%s»", value, expected)
	}
	return value, step, nil
}

// LiveDownload baja lo que apunta un elemento (un enlace: un export, un reporte) o una URL, con la sesión del
// navegador (sirve también detrás de un login), y lo guarda en .data/descargas.
func (r *Runner) LiveDownload(num int, text, rawURL string) (Step, error) {
	l := r.liveSession()
	if l == nil {
		return Step{}, errors.New("no hay sesión en vivo")
	}
	target := rawURL
	if target == "" {
		l.mu.Lock()
		cur := l.current
		l.mu.Unlock()
		if cur == nil {
			var err error
			if cur, err = r.liveAnalyze(l); err != nil {
				return Step{}, err
			}
		}
		var loc playwright.Locator
		if target == "" {
			var err error
			if loc, _, _, err = r.liveTarget(l, cur, num, text); err != nil {
				return Step{}, err
			}
		}
		// Una imagen, o la que envuelve un enlace (la bandera de una página enlaza a su ficha), antes que el href.
		if loc == nil {
			goto fetch
		}
		v, err := loc.Evaluate(downloadTargetJS, nil, playwright.LocatorEvaluateOptions{Timeout: playwright.Float(5000)})
		if err != nil {
			return Step{}, err
		}
		target, _ = v.(string)
		if target == "" {
			return Step{}, errors.New("ese elemento no tiene nada para bajar (ni imagen ni enlace)")
		}
	}
fetch:
	res, err := l.bctx.Request().Get(target, playwright.APIRequestContextGetOptions{Timeout: playwright.Float(30000)})
	if err != nil {
		return Step{}, fmt.Errorf("bajar %s: %v", target, firstLine(err.Error()))
	}
	if !res.Ok() {
		return Step{}, fmt.Errorf("bajar %s: HTTP %d", target, res.Status())
	}
	body, err := res.Body()
	if err != nil {
		return Step{}, err
	}
	name := downloadName(target, res.Headers()["content-disposition"])
	dir := filepath.Join(r.store.dir, "descargas")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return Step{}, err
	}
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, body, 0o600); err != nil {
		return Step{}, err
	}
	step := Step{
		Code:   fmt.Sprintf("fs.writeFileSync('%s', await (await page.request.get('%s')).body())", jsQuote(name), jsQuote(target)),
		Target: name, OK: true, UsesFS: true,
		Note: fmt.Sprintf("descargado: %s (%d bytes, %s)", path, len(body), res.Headers()["content-type"]),
	}
	r.recordStep(l, step)
	return step, nil
}

// downloadName elige el nombre del archivo: el de Content-Disposition, o el último tramo de la URL.
func downloadName(rawURL, disposition string) string {
	if i := strings.Index(disposition, "filename="); i >= 0 {
		if n := strings.Trim(strings.TrimSpace(strings.Split(disposition[i+9:], ";")[0]), `"`); n != "" {
			return filepath.Base(n)
		}
	}
	if u, err := url.Parse(rawURL); err == nil {
		if n, err := url.PathUnescape(filepath.Base(u.Path)); err == nil && n != "" && n != "/" && n != "." {
			return n
		}
	}
	return fmt.Sprintf("descarga-%d", time.Now().Unix())
}

// readJS saca el contenido principal de la página como texto legible —encabezados, párrafos, listas, tablas— sin
// menú, encabezado ni pie, más los enlaces del contenido y la fecha de actualización si la página la declara. Es
// para INVESTIGAR: el innerText del body entero es caro y ruidoso en un sitio del Estado.
const readJS = `() => {
	const root = document.querySelector('main, [role=main], article, #content, #main-content, .main-content, #contenido') || document.body
	// Sin «form»: los sitios ASP.NET/SharePoint (muchos del Estado) envuelven la página ENTERA en un <form>.
	const SKIP = 'nav, header, footer, aside, script, style, noscript, template, svg, [role=navigation], [role=banner], [role=contentinfo], [aria-hidden=true], .breadcrumb, .menu'
	const clean = (s) => (s || '').replace(/\s+/g, ' ').trim()
	const out = []
	const links = []
	const seen = new Set()
	const walk = (el) => {
		for (const n of el.children) {
			if (n.matches(SKIP) || !n.checkVisibility()) continue
			const t = n.tagName
			if (/^H[1-6]$/.test(t)) { const x = clean(n.innerText); if (x) out.push('\n' + '#'.repeat(+t[1]) + ' ' + x) }
			else if (t === 'P' || t === 'DD' || t === 'DT' || t === 'BLOCKQUOTE' || t === 'FIGCAPTION') { const x = clean(n.innerText); if (x) out.push(x) }
			else if (t === 'LI') { const x = clean(n.innerText); if (x) out.push('- ' + x) }
			else if (t === 'TABLE') {
				for (const r of [...n.rows].slice(0, 60)) out.push('| ' + [...r.cells].map((c) => clean(c.innerText)).join(' | ') + ' |')
			}
			else if (n.children.length === 0) { const x = clean(n.innerText); if (x && x.length > 40) out.push(x) }
			else walk(n)
		}
	}
	walk(root)
	for (const a of root.querySelectorAll('a[href]')) {
		if (a.closest(SKIP) || !a.checkVisibility()) continue
		const x = clean(a.innerText || a.getAttribute('aria-label')), h = a.href
		if (!x || !/^https?:/.test(h) || seen.has(h)) continue
		seen.add(h); links.push(x.slice(0, 90) + ' → ' + h)
	}
	// La fecha de actualización: lo que declare la página (metadatos, <time>, «Fecha de actualización…»).
	const meta = document.querySelector('meta[property="article:modified_time"], meta[name="last-modified"], meta[property="og:updated_time"], meta[name="dcterms.modified"]')?.content
	const time = document.querySelector('time[datetime]')?.getAttribute('datetime')
	const m = document.body.innerText.match(/(fecha de (?:actualizaci[oó]n|publicaci[oó]n|modificaci[oó]n)|[uú]ltima (?:actualizaci[oó]n|modificaci[oó]n)|actualizado(?: el)?|publicado(?: el)?)\s*:?\s*([^\n]{4,40})/i)
	const updated = meta || (m ? clean(m[0]) : '') || time || ''
	return { title: document.title, url: location.href, updated, lines: out, links: links.slice(0, 400) }
}`

// ReadResult es el contenido legible de la página actual.
type ReadResult struct {
	Title   string   `json:"title"`
	URL     string   `json:"url"`
	Updated string   `json:"updated"`
	Lines   []string `json:"lines"`
	Links   []string `json:"links"`
}

// LiveRead devuelve el contenido principal de la página. Queda como página consultada para las fuentes del
// reporte (lo que se leyó, aunque no se haya tocado nada).
func (r *Runner) LiveRead() (ReadResult, error) {
	l := r.liveSession()
	if l == nil {
		return ReadResult{}, errors.New("no hay sesión en vivo")
	}
	raw, err := l.page.Evaluate(readJS)
	if err != nil {
		return ReadResult{}, err
	}
	b, _ := json.Marshal(raw)
	var res ReadResult
	if err := json.Unmarshal(b, &res); err != nil {
		return ReadResult{}, err
	}
	l.mu.Lock()
	l.noteSource(res.URL, res.Title, res.Updated)
	l.mu.Unlock()
	return res, nil
}

// Source es una página consultada durante la corrida: la base de las fuentes de una investigación.
type Source struct {
	URL     string    `json:"url"`
	Title   string    `json:"title"`
	Updated string    `json:"updated,omitempty"`
	At      time.Time `json:"at"`
}

// noteSource registra una página consultada (una vez por URL). Llamar con l.mu tomado.
func (l *live) noteSource(url, title, updated string) {
	for i, s := range l.sources {
		if s.URL == url {
			if updated != "" {
				l.sources[i].Updated = updated
			}
			return
		}
	}
	l.sources = append(l.sources, Source{URL: url, Title: title, Updated: updated, At: time.Now()})
}

// downloadTargetJS decide qué bajar de un elemento:
//   - el enlace: el del elemento, el que lo envuelve, uno adentro, o —si no hay— el de los elementos que vienen
//     justo después (en los sitios del Estado: un título «Descargue aquí el calendario» y abajo el botón);
//   - si ese enlace apunta a un DOCUMENTO (pdf, doc, xls, zip, audio…), el documento, aunque adentro tenga un
//     ícono (si no, se bajaba Icon-pdf.png);
//   - si no, una imagen: la del elemento, en su mejor resolución (srcset).
const downloadTargetJS = `e => {
	const DOC = /\.(pdf|docx?|xlsx?|pptx?|csv|zip|rar|7z|mp3|ogg|flac|wav|m4a|txt|odt|ods)(\?|#|$)/i
	let a = e.closest('a[href]') || e.querySelector('a[href]')
	for (let n = e, i = 0; !a && n && i < 3; n = n.parentElement, i++) {
		for (let s = n.nextElementSibling, j = 0; !a && s && j < 2; s = s.nextElementSibling, j++) {
			a = s.matches('a[href]') ? s : s.querySelector('a[href]')
		}
	}
	if (a && DOC.test(a.href)) return a.href
	const img = e.tagName === 'IMG' ? e : e.querySelector('img')
	if (img) {
		const best = (img.srcset || '').split(',').map((c) => c.trim().split(/\s+/))
			.filter((c) => c[0]).map(([u, d]) => ({ u, w: parseFloat(d) || 1 })).sort((x, y) => y.w - x.w)[0]
		return best ? new URL(best.u, location.href).href : (img.currentSrc || img.src)
	}
	return (a && a.href) || e.src || ''
}`

// replayCopy es la repetición tal como está, para mandarla a la interfaz sin compartir el canal (con l.mu tomado).
func (l *live) replayCopy() *Replay {
	if l.replay == nil {
		return nil
	}
	c := *l.replay
	c.answers = nil
	return &c
}

// replayIdle: no hay una reproducción en curso (con l.mu tomado).
func (r *Runner) replayIdle(l *live) bool {
	return l.replay == nil || l.replay.Status == "done" || l.replay.Status == "stopped"
}

// showPopup pasa el editor a una ventana emergente que abrió la persona: el screencast y su clic y teclado van a
// la ventana hasta que se cierre (al terminar un login, la ventana de Google se cierra sola) y se vuelve a la página.
func (r *Runner) showPopup(l *live, p playwright.Page) {
	_ = p.WaitForLoadState(playwright.PageWaitForLoadStateOptions{State: playwright.LoadStateDomcontentloaded, Timeout: playwright.Float(10000)})
	cdp, err := l.bctx.NewCDPSession(p)
	if err != nil {
		return
	}
	cdp.On("Page.screencastFrame", func(ev map[string]any) {
		data, _ := ev["data"].(string)
		id := ev["sessionId"]
		go func() { _, _ = cdp.Send("Page.screencastFrameAck", map[string]any{"sessionId": id}) }()
		msg, _ := json.Marshal(map[string]any{"data": data, "meta": ev["metadata"]})
		l.broadcast(msg)
	})
	_, _ = l.cdp.Send("Page.stopScreencast", nil)
	l.mu.Lock()
	l.popup = p
	w, h := l.w, l.h
	l.mu.Unlock()
	_, _ = cdp.Send("Page.startScreencast", map[string]any{"format": "jpeg", "quality": 75, "maxWidth": w, "maxHeight": h})
	r.say("info", "ventana emergente en el editor: %s", p.URL())
	l.markDirty()
	closed := make(chan struct{})
	p.OnClose(func(playwright.Page) { close(closed) })
	<-closed
	l.mu.Lock()
	if l.popup == p {
		l.popup = nil
	}
	l.mu.Unlock()
	_ = l.startScreencast()
	r.say("info", "se cerró la ventana emergente: vuelve la página")
	l.markDirty()
}

func (l *live) popupURL() string {
	if l.popup == nil {
		return ""
	}
	return l.popup.URL()
}

// withScheme completa una URL escrita sin esquema: http:// para una dirección local (localhost, 127.0.0.1, ::1),
// que no tiene certificado; https:// para el resto.
func withScheme(u string) string {
	u = strings.TrimSpace(u)
	if strings.Contains(u, "://") || u == "" {
		return u
	}
	if strings.HasPrefix(u, "localhost") || strings.HasPrefix(u, "127.") || strings.HasPrefix(u, "[::1]") {
		return "http://" + u
	}
	return "https://" + u
}
