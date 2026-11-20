package main

/* CONSOLA Y RED POR SESIÓN: lo que la página dice en su consola (con su nivel) y los pedidos de red que hace (método,
 * URL, estado, tipo y cuánto tardó), anotados mientras la sesión está abierta, con tope (devlogMax por lista: lo
 * más viejo se cae). Para depurar sin abrir DevTools: `bin/jarvis console [--errors]`, `bin/jarvis network
 * [--failed]`, y en Cockpit las pestañas Consola y Red del panel de abajo, que siguen a la sesión elegida.
 *
 * Los manejadores corren en el hilo del driver de playwright-go: sólo leen lo que el evento ya trae (tipo, texto, URL,
 * estado). Pedir algo más desde adentro (req.Response(), el cuerpo) traba al driver. */

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"

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
	// Body y ContentType: el cuerpo de un pedido que ESCRIBE (POST, PUT, PATCH, DELETE), con lo que parece una
	// credencial tapado (redactBody). Es lo que permite convertir un flujo en receta por API (recipes/api-from-flow.ts).
	Body        string `json:"body,omitempty"`
	ContentType string `json:"contentType,omitempty"`
	// Response y ResponseType: lo que DEVOLVIÓ ese pedido que escribe (tapado igual). De ahí sale el id que el pedido
	// siguiente usa (crear un producto → publicarlo con su id): la receta los encadena en vez de dejar fijo el de ese día.
	Response     string `json:"response,omitempty"`
	ResponseType string `json:"responseType,omitempty"`
}

type devlog struct {
	mu      sync.Mutex
	seq     int
	console []ConsoleEntry
	net     []NetEntry
	started map[playwright.Request]time.Time
	pending []NetEntry // respuestas que llegaron por la página antes que su evento de red (takeResponse)
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

func (d *devlog) addNet(e NetEntry) int {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.seq++
	e.Seq = d.seq
	if e.At.IsZero() {
		e.At = time.Now()
	}
	for i, p := range d.pending {
		if p.Method == e.Method && p.URL == e.URL {
			e.Response, e.ResponseType = p.Response, p.ResponseType
			d.pending = append(d.pending[:i], d.pending[i+1:]...)
			break
		}
	}
	d.net = append(d.net, e)
	if len(d.net) > devlogMax {
		d.net = d.net[len(d.net)-devlogMax:]
	}
	return e.Seq
}

// ── lo que devuelven los pedidos que escriben ──
//
// Se lee DESDE LA PÁGINA (respJS envuelve fetch y XMLHttpRequest y, para un pedido que no es GET, manda por la consola
// su respuesta con la marca respMark, que no se anota como consola). Pedírselo a Playwright (Response.Body) no sirve:
// por el puente de la extensión a veces no llega el «terminó de cargar» y la llamada queda colgada para siempre
// (medido el 2026-11-20: el POST de un producto devolvió su cuerpo y el del SKU, enseguida después, nunca).
const respMark = "\u2063jarvis-response "

const respJS = `(() => {
	if (window.__jarvisResp) return
	window.__jarvisResp = true
	const MARK = '\u2063jarvis-response ', MAX = 65536
	const send = (method, url, status, type, text) => {
		try { console.debug(MARK + JSON.stringify({ method, url: new URL(url, location.href).href, status, type: type || '', text: String(text || '').slice(0, MAX) })) } catch {}
	}
	const writes = (m) => !/^(GET|HEAD|OPTIONS)$/i.test(m || 'GET')
	const f = window.fetch
	window.fetch = async function (input, init) {
		const res = await f.apply(this, arguments)
		try {
			const method = (init && init.method) || (input && input.method) || 'GET'
			if (writes(method)) res.clone().text().then((t) => send(method.toUpperCase(), res.url || (input && input.url) || String(input), res.status, res.headers.get('content-type'), t), () => {})
		} catch {}
		return res
	}
	const open = XMLHttpRequest.prototype.open
	XMLHttpRequest.prototype.open = function (method, url) { this.__jarvis = { method: String(method).toUpperCase(), url }; return open.apply(this, arguments) }
	const sendX = XMLHttpRequest.prototype.send
	XMLHttpRequest.prototype.send = function () {
		const x = this
		if (x.__jarvis && writes(x.__jarvis.method)) x.addEventListener('loadend', () => {
			try { send(x.__jarvis.method, x.responseURL || x.__jarvis.url, x.status, x.getResponseHeader('content-type'), x.responseType === '' || x.responseType === 'text' ? x.responseText : '') } catch {}
		})
		return sendX.apply(this, arguments)
	}
})()`

// takeResponse anota lo que devolvió un pedido (el JSON que manda respJS) en el último pedido igual que no tiene.
func (d *devlog) takeResponse(raw string) {
	var in struct {
		Method, URL, Type, Text string
		Status                  int
	}
	if json.Unmarshal([]byte(raw), &in) != nil || in.Text == "" {
		return
	}
	body := redactBody(in.Text, in.Type)
	d.mu.Lock()
	defer d.mu.Unlock()
	for i := len(d.net) - 1; i >= 0; i-- {
		n := &d.net[i]
		if n.Method == in.Method && n.URL == in.URL && n.Response == "" {
			n.Response, n.ResponseType = body, in.Type
			return
		}
	}
	// Llegó antes que el evento de red: queda pendiente y se le pega cuando aparezca.
	d.pending = append(d.pending, NetEntry{Method: in.Method, URL: in.URL, Response: body, ResponseType: in.Type})
	if len(d.pending) > 50 {
		d.pending = d.pending[1:]
	}
}

// attach escucha la página. Sólo lee lo que trae cada evento (ver arriba).
func (d *devlog) attach(p playwright.Page) {
	p.OnConsole(func(m playwright.ConsoleMessage) {
		if t := m.Text(); strings.HasPrefix(t, respMark) { // lo que devolvió un pedido que escribe (respJS), no es consola
			d.takeResponse(t[len(respMark):])
			return
		}
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
		withBody(&e, req)
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

// watchResponses pone respJS en la página: en las que cargue de acá en más y en la que ya está.
func (d *devlog) watchResponses(p playwright.Page) {
	_ = p.AddInitScript(playwright.Script{Content: playwright.String(respJS)})
	_, _ = p.Evaluate(respJS)
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

// ── el historial: la consola y la red quedan con la corrida ──
//
// Al escribir el reporte de una corrida (finish) y al cerrarse la sesión, lo anotado DESDE QUE EMPEZÓ LA CORRIDA va a
// .data/runs/<id>/devlog.json, al lado de sus pasos y sus fotos. Sin esto se perdía al cerrar la sesión o reiniciar el
// servidor, y un Claude que retomaba la tarea no podía preguntar qué falló en la red de la corrida de ayer.
// `bin/jarvis console --run <id|last>` y `network --run …` lo leen.

const devlogFile = "devlog.json"

// mark devuelve el número de orden actual: lo anotado después es de la corrida que empieza.
func (d *devlog) mark() int {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.seq
}

// saveDevlog escribe en la carpeta de la corrida lo anotado desde su comienzo. Sin carpeta o sin nada, no escribe.
func (l *live) saveDevlog() error {
	l.mu.Lock()
	dir, from, dev := l.runDir, l.devFrom, l.dev
	l.mu.Unlock()
	if dir == "" || dev == nil {
		return nil
	}
	c, n, last := dev.since(from)
	if len(c) == 0 && len(n) == 0 {
		return nil
	}
	if c == nil {
		c = []ConsoleEntry{}
	}
	if n == nil {
		n = []NetEntry{}
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	return writeJSONFile(filepath.Join(dir, devlogFile), DevLog{Console: c, Network: n, Last: last})
}

// RunDevLog lee la consola y la red guardadas de una corrida. "last" es la más nueva que las tiene.
func (s *Store) RunDevLog(id string) (DevLog, string, error) {
	if id == "last" {
		// La más nueva que tenga consola y red, tenga reporte (finish) o no: una sesión que se cerró sin finish también
		// deja su devlog.json. Las carpetas se llaman por fecha y hora, así que el orden es el nombre.
		files, _ := filepath.Glob(filepath.Join(s.dir, "runs", "*", devlogFile))
		sort.Strings(files)
		if len(files) > 0 {
			id = filepath.Base(filepath.Dir(files[len(files)-1]))
		}
		if id == "last" {
			return DevLog{}, "", errors.New("ninguna corrida guardada tiene consola y red todavía")
		}
	}
	if strings.ContainsAny(id, "/\\") || strings.HasPrefix(id, ".") {
		return DevLog{}, "", errors.New("corrida inválida")
	}
	b, err := os.ReadFile(filepath.Join(s.dir, "runs", id, devlogFile))
	if err != nil {
		return DevLog{}, id, fmt.Errorf("la corrida %s no tiene consola ni red guardadas (son de las corridas desde el 2026-11-20)", id)
	}
	var d DevLog
	if err := json.Unmarshal(b, &d); err != nil {
		return DevLog{}, id, err
	}
	d.Active = true
	return d, id, nil
}

// bodyMax: el tope del cuerpo que se guarda de un pedido (un formulario, un JSON de un guardado).
const bodyMax = 64 << 10

// withBody guarda el cuerpo de un pedido que escribe. Sólo lo que el evento ya trae (PostData, los encabezados de la
// solicitud): pedir más desde el manejador traba el driver.
// writes: el método escribe (no es GET, HEAD ni OPTIONS).
func writes(method string) bool {
	return method != "GET" && method != "HEAD" && method != "OPTIONS"
}

func withBody(e *NetEntry, req playwright.Request) {
	if !writes(e.Method) {
		return
	}
	if h := req.Headers(); h != nil {
		e.ContentType = h["content-type"]
	}
	body, err := req.PostData()
	if err != nil || body == "" {
		return
	}
	if len(body) > bodyMax {
		body = body[:bodyMax]
	}
	e.Body = redactBody(body, e.ContentType)
}

// isSecretKey: el nombre de un campo que lleva una credencial; su valor no se guarda nunca (CLAUDE.md: contraseñas,
// llaves y tokens, nunca) y queda «•••». Se compara por PARTES enteras del nombre (apiKey, api_key, x-auth-token →
// api·key, x·auth·token): con una búsqueda suelta, «pin» tapaba «shipping» y «auth» tapaba «author».
var secretParts = map[string]bool{"password": true, "pass": true, "passwd": true, "pwd": true, "secret": true, "token": true,
	"auth": true, "authorization": true, "credential": true, "credentials": true, "cookie": true, "session": true,
	"sessionid": true, "otp": true, "pin": true, "cvv": true, "cvc": true, "apikey": true, "privatekey": true}

func isSecretKey(k string) bool {
	var parts []string
	var cur []rune
	flush := func() {
		if len(cur) > 0 {
			parts = append(parts, strings.ToLower(string(cur)))
			cur = cur[:0]
		}
	}
	for i, r := range k {
		switch {
		case r == '_' || r == '-' || r == '.' || r == ' ':
			flush()
		case unicode.IsUpper(r) && i > 0:
			flush()
			cur = append(cur, r)
		default:
			cur = append(cur, r)
		}
	}
	flush()
	for i, p := range parts {
		if secretParts[p] {
			return true
		}
		if i+1 < len(parts) && (p == "api" || p == "private" || p == "access" || p == "card") && (parts[i+1] == "key" || parts[i+1] == "number" || parts[i+1] == "token") {
			return true
		}
	}
	return false
}

// redactBody tapa los valores de los campos con nombre de credencial, en un JSON o en un formulario.
func redactBody(body, contentType string) string {
	if strings.Contains(contentType, "json") || strings.HasPrefix(strings.TrimSpace(body), "{") || strings.HasPrefix(strings.TrimSpace(body), "[") {
		var v any
		if json.Unmarshal([]byte(body), &v) == nil {
			b, _ := json.Marshal(redactJSON(v))
			return string(b)
		}
	}
	if strings.Contains(contentType, "x-www-form-urlencoded") {
		if q, err := url.ParseQuery(body); err == nil {
			for k := range q {
				if isSecretKey(k) {
					q.Set(k, "•••")
				}
			}
			return q.Encode()
		}
	}
	return body
}

func redactJSON(v any) any {
	switch t := v.(type) {
	case map[string]any:
		for k, x := range t {
			if isSecretKey(k) {
				t[k] = "•••"
			} else {
				t[k] = redactJSON(x)
			}
		}
	case []any:
		for i := range t {
			t[i] = redactJSON(t[i])
		}
	}
	return v
}
