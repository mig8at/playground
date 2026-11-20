package main

/* EL FOCO: qué sitios tienen que estar al frente en Chrome y cuáles trabajan de fondo.
 *
 * Medido el 2026-11-20 en el Chrome de Miguel (demo de tareas, dos sesiones en la misma ventana, una detrás): la de
 * detrás seguía `visible`, con `hasFocus()`, con animaciones (rAF) y temporizadores a ritmo normal, y escribir, hacer
 * clic, leer y capturar anduvo igual que al frente. Lo más probable —no se aisló— es que lo sostengan el screencast de
 * la sesión (una pestaña capturada no se oculta) y la emulación de foco que pone Playwright al conectarse. Así que por
 * defecto Jarvis TRABAJA DE FONDO: un comando ya no trae la pestaña al frente.
 *
 * Las excepciones van por sitio (host) en jarvis/focus.json:
 *   - front: siempre al frente. Lo pone la persona (`focus set`), una medición (`focus check`) o una acción de fondo
 *     que venció por tiempo (se marca sola y se avisa; no se reintenta: un clic que venció pudo haber hecho algo);
 *   - background: medido que anda detrás (`focus check`) o puesto a mano;
 *   - sin perfil: de fondo, hasta que algo diga lo contrario.
 * `follow` (focus follow on) vuelve a lo de antes: cada comando trae su pestaña, para mirar a Claude trabajar.
 * Lo que necesita a la persona (`point`, el modo guía) va siempre al frente. */

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	focusFront      = "front"
	focusBackground = "background"
)

// FocusProfile es lo que se sabe de un sitio. Sin contadores: el archivo va en git y no tiene que cambiar con cada
// acción.
type FocusProfile struct {
	Mode    string          `json:"mode"`             // front · background
	Source  string          `json:"source"`           // manual · check · failure
	Note    string          `json:"note,omitempty"`   // por qué (el error que lo marcó, qué falló en la medición)
	Checks  map[string]bool `json:"checks,omitempty"` // la última medición: visible, focus, frames, timers
	Updated string          `json:"updated"`
}

type focusFile struct {
	Follow bool                     `json:"follow"`
	Hosts  map[string]*FocusProfile `json:"hosts"`
}

type FocusStore struct {
	mu     sync.Mutex
	path   string
	loaded bool
	data   focusFile
}

var focusStore = &FocusStore{}

func focusPath() string {
	if p := os.Getenv("JARVIS_FOCUS_FILE"); p != "" {
		return p
	}
	return filepath.Join(jarvisDir(), "focus.json")
}

// load (con mu tomado) lee el archivo una vez. Uno que falta o no se entiende deja todo de fondo.
func (s *FocusStore) load() {
	if s.loaded {
		return
	}
	s.loaded = true
	if s.path == "" {
		s.path = focusPath()
	}
	s.data = focusFile{Hosts: map[string]*FocusProfile{}}
	if raw, err := os.ReadFile(s.path); err == nil {
		_ = json.Unmarshal(raw, &s.data)
	}
	if s.data.Hosts == nil {
		s.data.Hosts = map[string]*FocusProfile{}
	}
}

// save (con mu tomado): ordenado y con sangría, para que un cambio se lea en el diff.
func (s *FocusStore) save() error {
	raw, err := json.MarshalIndent(s.data, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, append(raw, '\n'), 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

// focusHost es la clave de un sitio: el host de la URL, sin «www.» (admin.shopify.com, localhost:5207).
func focusHost(raw string) string {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return ""
	}
	return strings.TrimPrefix(strings.ToLower(u.Host), "www.")
}

// WantsFront dice si un comando sobre ese sitio tiene que traer la pestaña al frente.
func (s *FocusStore) WantsFront(host string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.load()
	if s.data.Follow {
		return true
	}
	p := s.data.Hosts[host]
	return p != nil && p.Mode == focusFront
}

func (s *FocusStore) Get(host string) *FocusProfile {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.load()
	if p := s.data.Hosts[host]; p != nil {
		cp := *p
		return &cp
	}
	return nil
}

// Set guarda el perfil de un sitio; nil lo borra (vuelve a «de fondo hasta que algo diga lo contrario»).
func (s *FocusStore) Set(host string, p *FocusProfile) error {
	if host == "" {
		return errors.New("falta el sitio")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.load()
	if p == nil {
		delete(s.data.Hosts, host)
	} else {
		if p.Mode != focusFront && p.Mode != focusBackground {
			return fmt.Errorf("modo %q: front o background", p.Mode)
		}
		p.Updated = time.Now().Format("2006-01-02")
		s.data.Hosts[host] = p
	}
	return s.save()
}

func (s *FocusStore) SetFollow(on bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.load()
	s.data.Follow = on
	return s.save()
}

// FocusView es lo que ven el CLI y la interfaz: el modo, si siguen a Claude, y cada sitio ordenado.
type FocusView struct {
	Follow bool               `json:"follow"`
	Hosts  []FocusHostProfile `json:"hosts"`
}

type FocusHostProfile struct {
	Host string `json:"host"`
	FocusProfile
}

func (s *FocusStore) View() FocusView {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.load()
	v := FocusView{Follow: s.data.Follow, Hosts: []FocusHostProfile{}}
	for h, p := range s.data.Hosts {
		v.Hosts = append(v.Hosts, FocusHostProfile{Host: h, FocusProfile: *p})
	}
	sort.Slice(v.Hosts, func(i, j int) bool { return v.Hosts[i].Host < v.Hosts[j].Host })
	return v
}

// ── la sesión ──

// focusChrome decide, para un comando de Claude, si la pestaña de la sesión va al frente: con `force` (lo que
// necesita a la persona), con «seguir» prendido o si el sitio es `front`. Si no, la deja donde esté y anota que la
// acción corre de fondo (para aprender si falla).
func (r *Runner) focusChrome(force bool) {
	l := r.liveSession()
	if l == nil || l.device != deviceChrome {
		return
	}
	front := force || focusStore.WantsFront(focusHost(l.page.URL()))
	l.mu.Lock()
	l.background = !front
	l.mu.Unlock()
	if front {
		_ = l.page.BringToFront()
	}
}

// isTimeoutErr: lo que delata una pestaña que no avanza detrás (Playwright esperando un cuadro, una animación o un
// evento que no llega). Un «no encontré el elemento» no cuenta: pasa igual al frente.
func isTimeoutErr(err error) bool {
	if err == nil {
		return false
	}
	m := strings.ToLower(err.Error())
	return strings.Contains(m, "timeout") || strings.Contains(m, "exceeded") || strings.Contains(m, "no arrancó")
}

// noteFocusResult aprende de una acción que corrió de fondo y venció por tiempo. Un vencimiento no siempre es culpa
// del fondo (un botón deshabilitado o tapado vence igual al frente), así que se mide la página en ese momento —sigue
// detrás— y el sitio pasa a `front` sólo si la medición falla; ahí la pestaña viene al frente ya. No se reintenta la
// acción: un clic que venció pudo haber hecho algo.
func (r *Runner) noteFocusResult(err error) {
	if !isTimeoutErr(err) {
		return
	}
	l := r.liveSession()
	if l == nil || l.device != deviceChrome {
		return
	}
	l.mu.Lock()
	bg := l.background
	l.mu.Unlock()
	host := focusHost(l.page.URL())
	if !bg || host == "" {
		return
	}
	if p := focusStore.Get(host); p != nil && p.Source == "manual" {
		return // lo decidió la persona: no se le cambia
	}
	checks, frames, ticks, merr := measureFocus(l)
	if merr != nil {
		return
	}
	var failed []string
	for _, k := range focusCheckOrder {
		if !checks[k] {
			failed = append(failed, k)
		}
	}
	if len(failed) == 0 {
		r.say("info", "venció por tiempo, pero %s anda de fondo (animaciones %d, temporizadores %d): no es por estar detrás", host, frames, ticks)
		return
	}
	note := strings.SplitN(err.Error(), "\n", 2)[0]
	if len([]rune(note)) > 120 {
		note = string([]rune(note)[:120]) + "…"
	}
	note = "falló de fondo (" + strings.Join(failed, ", ") + "): " + note
	if focusStore.Set(host, &FocusProfile{Mode: focusFront, Source: "failure", Note: note, Checks: checks}) == nil {
		r.say("info", "%s no anda de fondo (%s): desde ahora va al frente (bin/jarvis focus lo muestra)", host, strings.Join(failed, ", "))
	}
	l.mu.Lock()
	l.background = false
	l.mu.Unlock()
	_ = l.page.BringToFront()
}

var focusCheckOrder = []string{"visible", "focus", "frames", "timers"}

// measureFocus corre focusCheckJS en la página tal como está y dice qué pasó cada prueba.
func measureFocus(l *live) (map[string]bool, int, int, error) {
	val, err := l.page.Evaluate(focusCheckJS)
	if err != nil {
		return nil, 0, 0, err
	}
	m, _ := val.(map[string]any)
	num := func(k string) int {
		switch v := m[k].(type) {
		case float64:
			return int(v)
		case int:
			return v
		}
		return 0
	}
	frames, ticks := num("frames"), num("ticks")
	visible, _ := m["visible"].(bool)
	focus, _ := m["focus"].(bool)
	return map[string]bool{"visible": visible, "focus": focus, "frames": frames > 20, "timers": ticks > 50}, frames, ticks, nil
}

// focusCheckJS mide lo que una pestaña de fondo puede perder: si se ve, si tiene foco, si corren las animaciones
// (rAF, que Playwright usa para saber si un elemento está quieto antes de un clic) y si los temporizadores van a su
// ritmo (Chrome los frena a 1 por segundo en una pestaña oculta).
const focusCheckJS = `async () => {
	const frames = await new Promise((r) => {
		let n = 0
		const t0 = performance.now()
		const f = () => { n++; if (performance.now() - t0 < 1000) requestAnimationFrame(f); else r(n) }
		requestAnimationFrame(f)
		setTimeout(() => r(n), 2500)
	})
	const ticks = await new Promise((r) => {
		let n = 0
		const id = setInterval(() => n++, 10)
		setTimeout(() => { clearInterval(id); r(n) }, 1000)
	})
	return { visible: document.visibilityState === 'visible', focus: document.hasFocus(), frames, ticks }
}`

// FocusCheckResult es una medición: cada prueba, el modo que sale y si la pestaña de verdad quedó detrás.
type FocusCheckResult struct {
	Host   string          `json:"host"`
	Mode   string          `json:"mode"`
	Checks map[string]bool `json:"checks"`
	Frames int             `json:"frames"` // animaciones en 1 s (al frente, 60 o 120 según la pantalla)
	Ticks  int             `json:"ticks"`  // temporizadores de 10 ms en 1 s (al frente, ~100; frenados, ~1)
	Saved  bool            `json:"saved"`  // false si el sitio estaba puesto a mano: la medición no lo pisa
}

// FocusCheck deja la pestaña de la sesión detrás de verdad (la extensión pone al frente la pestaña Jarvis de esa
// ventana), espera un momento, mide y la vuelve a traer si el sitio va al frente o se sigue a Claude. El sitio queda
// `background` si todo anduvo y `front` si algo no, salvo que la persona lo haya puesto a mano.
func (r *Runner) FocusCheck() (FocusCheckResult, error) {
	l := r.liveSession()
	if l == nil {
		return FocusCheckResult{}, errors.New("no hay sesión en vivo")
	}
	if l.device != deviceChrome || l.chromeTab == 0 {
		return FocusCheckResult{}, errors.New("la sesión no está en una pestaña de Chrome")
	}
	host := focusHost(l.page.URL())
	if host == "" {
		return FocusCheckResult{}, errors.New("la página no tiene un sitio (¿about:blank?)")
	}
	raw, err := chromeBridge.call("chrome.tabs.sendBehind", l.chromeTab)
	if err != nil {
		if strings.Contains(err.Error(), "no sé hacer") {
			return FocusCheckResult{}, errors.New("la extensión es vieja: recargala en chrome://extensions")
		}
		return FocusCheckResult{}, err
	}
	var behind struct{ Active bool }
	_ = json.Unmarshal(raw, &behind)
	if behind.Active {
		return FocusCheckResult{}, errors.New("la pestaña sigue al frente: no se pudo dejarla detrás para medir")
	}
	l.mu.Lock()
	l.background = true
	l.mu.Unlock()
	time.Sleep(1500 * time.Millisecond) // lo que Chrome tarda en tratarla como de fondo
	checks, frames, ticks, err := measureFocus(l)
	if err != nil {
		return FocusCheckResult{}, fmt.Errorf("medir: %w", err)
	}
	res := FocusCheckResult{Host: host, Mode: focusBackground, Checks: checks, Frames: frames, Ticks: ticks}
	var failed []string
	for _, k := range focusCheckOrder {
		if !checks[k] {
			res.Mode = focusFront
			failed = append(failed, k)
		}
	}
	if p := focusStore.Get(host); p == nil || p.Source != "manual" {
		note := ""
		if len(failed) > 0 {
			note = "falló de fondo: " + strings.Join(failed, ", ")
		}
		res.Saved = focusStore.Set(host, &FocusProfile{Mode: res.Mode, Source: "check", Note: note, Checks: res.Checks}) == nil
	}
	if focusStore.WantsFront(host) {
		l.mu.Lock()
		l.background = false
		l.mu.Unlock()
		_ = l.page.BringToFront()
	}
	return res, nil
}
