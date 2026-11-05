package main

/* El corredor: Playwright (playwright-go) y la sesión en vivo, una a la vez (un perfil de Chromium no se abre
 * dos veces). Acá están el turno, el registro que ve la interfaz, el análisis de una pantalla y lo que dice la
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
	pw      *playwright.Playwright
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
	con := t.console
	t.console = nil
	return con
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

func settle(p playwright.Page) {
	_ = p.WaitForLoadState(playwright.PageWaitForLoadStateOptions{State: playwright.LoadStateNetworkidle, Timeout: playwright.Float(6000)})
}

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
