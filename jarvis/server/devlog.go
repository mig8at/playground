package main

/* CONSOLA Y RED POR SESIÓN: lo que la página dice en su consola (con su nivel) y los pedidos de red que hace (método,
 * URL, estado, tipo y cuánto tardó), anotados mientras la sesión está abierta, con tope (devlogMax por lista: lo
 * más viejo se cae). Para depurar sin abrir DevTools: `bin/jarvis console [--errors]`, `bin/jarvis network
 * [--failed]`, y en Cockpit las pestañas Consola y Red del panel de abajo, que siguen a la sesión elegida.
 *
 * Los manejadores corren en el hilo del driver de playwright-go: sólo leen lo que el evento ya trae (tipo, texto, URL,
 * estado). Pedir algo más desde adentro (req.Response(), el cuerpo) traba al driver. */

import (
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/playwright-community/playwright-go"
)

const devlogMax = 500

type ConsoleEntry struct {
	Seq   int       `json:"seq"`
	At    time.Time `json:"at"`
	Level string    `json:"level"` // log · info · warning · error · debug · excepción
	Text  string    `json:"text"`
	Where string    `json:"where,omitempty"` // archivo:línea, si la página lo dijo
}

type NetEntry struct {
	Seq    int       `json:"seq"`
	At     time.Time `json:"at"`
	Method string    `json:"method"`
	URL    string    `json:"url"`
	Type   string    `json:"type"`             // document · fetch · xhr · script · stylesheet · image · …
	Status int       `json:"status,omitempty"` // 0 si falló sin respuesta
	Failed string    `json:"failed,omitempty"` // por qué falló (sin respuesta)
	Ms     int       `json:"ms,omitempty"`     // desde que salió hasta la respuesta
}

type devlog struct {
	mu      sync.Mutex
	seq     int
	console []ConsoleEntry
	net     []NetEntry
	started map[playwright.Request]time.Time
}

func newDevlog() *devlog { return &devlog{started: map[playwright.Request]time.Time{}} }

func (d *devlog) addConsole(e ConsoleEntry) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.seq++
	e.Seq, e.At = d.seq, time.Now()
	d.console = append(d.console, e)
	if len(d.console) > devlogMax {
		d.console = d.console[len(d.console)-devlogMax:]
	}
}

func (d *devlog) addNet(e NetEntry) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.seq++
	e.Seq = d.seq
	if e.At.IsZero() {
		e.At = time.Now()
	}
	d.net = append(d.net, e)
	if len(d.net) > devlogMax {
		d.net = d.net[len(d.net)-devlogMax:]
	}
}

// attach escucha la página. Sólo lee lo que trae cada evento (ver arriba).
func (d *devlog) attach(p playwright.Page) {
	p.OnConsole(func(m playwright.ConsoleMessage) {
		where := ""
		if loc := m.Location(); loc.URL != "" {
			where = loc.URL
			if loc.LineNumber > 0 {
				where += ":" + strconv.Itoa(loc.LineNumber)
			}
		}
		d.addConsole(ConsoleEntry{Level: m.Type(), Text: truncate(m.Text(), 2000), Where: where})
	})
	p.OnPageError(func(err error) {
		d.addConsole(ConsoleEntry{Level: "excepción", Text: truncate(err.Error(), 2000)})
	})
	p.OnRequest(func(req playwright.Request) {
		if strings.HasPrefix(req.URL(), "data:") {
			return
		}
		d.mu.Lock()
		d.started[req] = time.Now()
		if len(d.started) > 2*devlogMax { // pedidos que nunca terminaron (una página que se fue): no crecer sin fin
			d.started = map[playwright.Request]time.Time{}
		}
		d.mu.Unlock()
	})
	p.OnResponse(func(res playwright.Response) {
		req := res.Request()
		if strings.HasPrefix(req.URL(), "data:") {
			return
		}
		d.mu.Lock()
		t0, ok := d.started[req]
		delete(d.started, req)
		d.mu.Unlock()
		e := NetEntry{Method: req.Method(), URL: req.URL(), Type: req.ResourceType(), Status: res.Status()}
		if ok {
			e.At, e.Ms = t0, int(time.Since(t0).Milliseconds())
		}
		d.addNet(e)
	})
	p.OnRequestFailed(func(req playwright.Request) {
		if strings.HasPrefix(req.URL(), "data:") {
			return
		}
		d.mu.Lock()
		t0, ok := d.started[req]
		delete(d.started, req)
		d.mu.Unlock()
		why := "falló"
		if f := req.Failure(); f != nil {
			why = f.Error()
		}
		e := NetEntry{Method: req.Method(), URL: req.URL(), Type: req.ResourceType(), Failed: why}
		if ok {
			e.At, e.Ms = t0, int(time.Since(t0).Milliseconds())
		}
		d.addNet(e)
	})
}

// since devuelve lo anotado después de `since` (número de orden) y el último número, para pedir sólo lo nuevo.
func (d *devlog) since(since int) ([]ConsoleEntry, []NetEntry, int) {
	d.mu.Lock()
	defer d.mu.Unlock()
	var c []ConsoleEntry
	for _, e := range d.console {
		if e.Seq > since {
			c = append(c, e)
		}
	}
	var n []NetEntry
	for _, e := range d.net {
		if e.Seq > since {
			n = append(n, e)
		}
	}
	return c, n, d.seq
}

// DevLog es lo que piden el CLI y la interfaz: consola y red de la sesión desde `since`.
type DevLog struct {
	Console []ConsoleEntry `json:"console"`
	Network []NetEntry     `json:"network"`
	Last    int            `json:"last"`
	Active  bool           `json:"active"`
}

func (r *Runner) LiveDevLog(since int) DevLog {
	l := r.liveSession()
	if l == nil || l.dev == nil {
		return DevLog{Console: []ConsoleEntry{}, Network: []NetEntry{}}
	}
	c, n, last := l.dev.since(since)
	if c == nil {
		c = []ConsoleEntry{}
	}
	if n == nil {
		n = []NetEntry{}
	}
	return DevLog{Console: c, Network: n, Last: last, Active: true}
}
