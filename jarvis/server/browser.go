package main

/* El corredor: Playwright (playwright-go) y la sesión en vivo, una a la vez por pestaña. Acá están el turno, el registro que ve la interfaz, el análisis de una pantalla y lo que dice la
 * página entre dos análisis (sus errores de consola).
 *
 * ⚠ Los manejadores de eventos de playwright-go corren en el hilo que lee del driver: llamar desde ahí a algo
 * que espera respuesta (Evaluate, Screenshot) lo traba. Por eso sólo anotan y avisan por un canal.
 */

import (
	"context"
	"crypto/sha1"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
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
	Log     []LogLine `json:"log"`
	LastSeq int       `json:"lastSeq"`
}

type Runner struct {
	store *Store

	mu      sync.Mutex
	tab     string // el id de la pestaña (tabs.go)
	busy    bool
	kind    string
	site    string
	started time.Time
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
	st := State{Busy: r.busy, Kind: r.kind, Site: r.site, Started: r.started, LastSeq: r.seq, Log: []LogLine{}}
	for _, l := range r.log {
		if l.Seq > since {
			st.Log = append(st.Log, l)
		}
	}
	return st
}

// playwright arranca el driver la primera vez (lo arma desde npm si falta, una sola vez). Es
// UNO para todas las pestañas: cada una abre su contexto sobre el mismo proceso.
func (r *Runner) playwright() (*playwright.Playwright, error) {
	sharedPWMu.Lock()
	defer sharedPWMu.Unlock()
	if sharedPW != nil {
		return sharedPW, nil
	}
	r.say("info", "preparando Playwright (la primera vez arma el driver)…")
	opts, err := ensureDriver(r.say)
	if err != nil {
		return nil, err
	}
	if err := playwright.Install(opts); err != nil {
		return nil, fmt.Errorf("instalar Playwright: %w", err)
	}
	pw, err := playwright.Run(opts)
	if err != nil {
		return nil, fmt.Errorf("arrancar Playwright: %w", err)
	}
	sharedPW = pw
	return pw, nil
}

var (
	sharedPWMu sync.Mutex
	sharedPW   *playwright.Playwright
)

// stopPlaywright baja el proceso compartido (al cerrar la API).
func stopPlaywright() {
	sharedPWMu.Lock()
	pw := sharedPW
	sharedPW = nil
	sharedPWMu.Unlock()
	if pw != nil {
		_ = pw.Stop()
	}
}

// Close frena lo que esté corriendo en esta pestaña; el Playwright compartido lo baja stopPlaywright.
func (r *Runner) Close() {
	r.Stop()
}

// begin toma el turno; falla si ya hay algo corriendo.
func (r *Runner) begin(kind, site string) (context.Context, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.busy {
		return nil, fmt.Errorf("ya hay un %s corriendo sobre %s: paralo primero", r.kind, r.site)
	}
	ctx, cancel := context.WithCancel(context.Background())
	r.busy, r.kind, r.site, r.started, r.cancel = true, kind, site, time.Now(), cancel
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

// tap junta lo que dice una página entre dos análisis: sus errores de consola.
type tap struct {
	mu      sync.Mutex
	console []string
}

func (t *tap) attach(p playwright.Page) {
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
func (t *tap) drain() []string {
	t.mu.Lock()
	defer t.mu.Unlock()
	detached := t.console
	t.console = nil
	return detached
}

// analyze describe la pantalla como está AHORA: título, lo interactivo con sus localizadores verificados (también
// adentro de iframes) y los avisos a la vista.
func (r *Runner) analyze(p playwright.Page, t *tap) *Page {
	final := p.URL()
	page := &Page{URL: final, FinalURL: final, At: time.Now()}
	page.ID = pageID(final)
	raw, err := p.Evaluate(analyzeJS)
	if err != nil {
		page.Error = "analizar: " + err.Error()
	} else if s, ok := raw.(string); ok {
		var a struct {
			Title    string    `json:"title"`
			Controls []Control `json:"controls"`
			Notices  []string  `json:"notices"`
		}
		if err := json.Unmarshal([]byte(s), &a); err != nil {
			page.Error = "leer el análisis: " + err.Error()
		} else {
			page.Title, page.Notices = a.Title, a.Notices
			controls := append(a.Controls, frameControls(p, len(a.Controls))...)
			verifyControls(p, controls)
			page.Controls = controls
		}
	}
	page.Console = t.drain()
	return page
}

// pageID identifica una pantalla por su URL sin el fragmento de búsqueda variable (12 caracteres).
func pageID(raw string) string {
	sum := sha1.Sum([]byte(raw))
	return hex.EncodeToString(sum[:])[:12]
}

// settle espera a que la página esté quieta antes de analizarla. Es la ÚNICA puerta: para volver a lo de antes
// (networkidle con tope de 6 s) alcanza con JARVIS_SETTLE=networkidle, o con dejar acá sólo settleNetworkIdle.
//
// Antes era sólo networkidle (6 s). En un panel que hace polling o tiene un pedido abierto para siempre (SSE,
// long-poll) networkidle no llega NUNCA y cada análisis pagaba los 6 s enteros. Ahora gana la primera de dos señales:
//   - networkidle, como antes: en una página que ya quedó en reposo contesta al instante (el camino rápido);
//   - la quietud del DOM medida en la página (settleQuietJS): cargada, y settleQuietMs sin mutaciones ni recursos
//     que terminen de bajar, con tope settleCapMs.
//
// ⚠ Lo que la quietud NO ve: un pedido lento todavía en vuelo que no mueve el DOM (un spinner por CSS). En una
// navegación así, networkidle esperaba a que terminara y esto puede analizar antes; el análisis de fondo (liveLoop)
// la vuelve a mirar cuando la página cambia.
const (
	settleQuietMs = 300
	settleCapMs   = 2000
)

func settle(p playwright.Page) {
	if os.Getenv("JARVIS_SETTLE") == "networkidle" {
		settleNetworkIdle(p, 6000)
		return
	}
	began := time.Now()
	_ = p.WaitForLoadState(playwright.PageWaitForLoadStateOptions{State: playwright.LoadStateDomcontentloaded, Timeout: playwright.Float(settleCapMs)})
	// Las dos esperas corren a la par y cada una avisa por su canal (con lugar, para que la que pierde no quede
	// trabada). La que pierde termina sola: las dos tienen tope.
	idle, quiet := make(chan struct{}, 1), make(chan struct{}, 1)
	go func() {
		if settleNetworkIdle(p, settleCapMs) == nil {
			idle <- struct{}{}
		}
	}()
	go func() {
		// Una navegación en el medio destruye el contexto y Evaluate falla al instante: eso NO es quietud. Se
		// espera a la página nueva y se mide de nuevo, hasta el tope.
		for time.Since(began) < settleCapMs*time.Millisecond {
			if _, err := p.Evaluate(settleQuietJS, map[string]any{"quiet": settleQuietMs, "cap": settleCapMs}); err == nil {
				quiet <- struct{}{}
				return
			}
			time.Sleep(100 * time.Millisecond)
			_ = p.WaitForLoadState(playwright.PageWaitForLoadStateOptions{State: playwright.LoadStateDomcontentloaded, Timeout: playwright.Float(settleCapMs)})
		}
	}()
	// El tope de Go es un poco más largo que el de la página: en una pestaña de fondo Chrome frena los timers a 1 s,
	// y un Evaluate sobre una página congelada no vuelve.
	select {
	case <-idle:
	case <-quiet:
	case <-time.After(time.Until(began.Add((settleCapMs + 1000) * time.Millisecond))):
	}
}

func settleNetworkIdle(p playwright.Page, ms float64) error {
	return p.WaitForLoadState(playwright.PageWaitForLoadStateOptions{State: playwright.LoadStateNetworkidle, Timeout: playwright.Float(ms)})
}

// settleQuietJS resuelve cuando el documento terminó de cargar y pasaron `quiet` ms sin que cambie el DOM ni termine
// de bajar un recurso, o a los `cap` ms. No deja nada colgado en la página: desconecta sus observadores al resolver.
const settleQuietJS = `({ quiet, cap }) => new Promise((resolve) => {
  const began = performance.now()
  let last = began
  const touch = () => { last = performance.now() }
  const mo = new MutationObserver(touch)
  mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true })
  let po = null
  try { po = new PerformanceObserver(touch); po.observe({ type: 'resource' }) } catch { po = null }
  const timer = setInterval(() => {
    const now = performance.now()
    if (now - began < cap && (document.readyState !== 'complete' || now - last < quiet)) return
    clearInterval(timer); mo.disconnect(); if (po) po.disconnect()
    resolve(true)
  }, 50)
})`

func firstPage(c playwright.BrowserContext) playwright.Page {
	if ps := c.Pages(); len(ps) > 0 {
		return ps[0]
	}
	return nil
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
