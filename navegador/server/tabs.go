package main

/* Las PESTAÑAS: varias sesiones en vivo a la vez, cada una con su meta, su corrida, su video y su flujo. Cada
 * pestaña es un Runner (su sesión en vivo, su registro) más un Asker (su Claude), así que todo lo que ya sabía
 * hacer una sesión lo sigue haciendo cada una por su lado.
 *
 * Qué pestaña atiende un pedido: el encabezado X-Navegador-Tab (o ?tab=), que manda el CLI con --sesion N o
 * NAVEGADOR_SESION; sin él, la ÚLTIMA que se abrió. La interfaz elige cuál MIRA sin cambiar ese default: si no,
 * un clic de la persona mandaría los comandos de Claude a otra página.
 *
 * ⚠ Dos pestañas del MISMO sitio comparten el perfil de Chromium, y un perfil persistente no se abre dos veces
 * (Chromium lo bloquea): comparten su BrowserContext, cada una con su página (sharedContexts, abajo).
 *
 * LAS PESTAÑAS QUE CLAUDE DEJA SE CIERRAN SOLAS (Sweep, abajo). Una pestaña que abrió Claude (el CLI) y que nadie usa
 * hace un rato —ningún comando de Claude, ninguna acción de la persona, nadie mirándola en la interfaz— se cierra. Así
 * no se juntan diez páginas viejas de un día de trabajo. Las que abrió la persona no se tocan nunca. */

import (
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"sync"
	"time"

	"github.com/playwright-community/playwright-go"
)

const tabHeader = "X-Navegador-Tab"

// clientHeader lo manda el CLI (bin/navegador) en cada pedido: es lo que distingue a Claude de la interfaz.
const clientHeader = "X-Navegador-Client"

// tabIdleDefault: cuánto puede quedar sin uso una pestaña de Claude antes de cerrarse (NAVEGADOR_TAB_IDLE la cambia;
// "0" apaga el cierre).
const tabIdleDefault = 10 * time.Minute

type Tab struct {
	ID      string
	Runner  *Runner
	Asker   *Asker
	Created time.Time
	// ByClaude: la abrió el CLI (no la persona desde la interfaz). Sólo éstas se cierran solas.
	ByClaude bool
	// Las dos se leen y escriben con Tabs.mu.
	lastUsed time.Time // el último comando de Claude o acción de la persona sobre ella
	watchers int       // interfaces mirándola ahora (streams de cuadros abiertos)
}

type Tabs struct {
	mu    sync.Mutex
	store *Store
	seq   int
	tabs  map[string]*Tab
	last  string // la última que se abrió: el default de un pedido sin pestaña
}

func NewTabs(store *Store) *Tabs {
	t := &Tabs{store: store, tabs: map[string]*Tab{}}
	t.New()
	return t
}

// New abre una pestaña vacía (sin página todavía) y la deja como la última.
func (t *Tabs) New() *Tab { return t.NewBy(false) }

// NewBy abre una pestaña y anota si la abrió Claude (el CLI).
func (t *Tabs) NewBy(byClaude bool) *Tab {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.seq++
	id := strconv.Itoa(t.seq)
	r := NewRunner(t.store)
	r.tab = id
	now := time.Now()
	tab := &Tab{ID: id, Runner: r, Asker: &Asker{tab: id}, Created: now, ByClaude: byClaude, lastUsed: now}
	t.tabs[id] = tab
	t.last = id
	return tab
}

// Get devuelve la pestaña id ("" = la última); nil si no existe.
func (t *Tabs) Get(id string) *Tab {
	t.mu.Lock()
	defer t.mu.Unlock()
	if id == "" {
		id = t.last
	}
	return t.tabs[id]
}

// All devuelve las pestañas en el orden en que se abrieron.
func (t *Tabs) All() []*Tab {
	t.mu.Lock()
	defer t.mu.Unlock()
	out := make([]*Tab, 0, len(t.tabs))
	for _, tab := range t.tabs {
		out = append(out, tab)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Created.Before(out[j].Created) })
	return out
}

// Close cierra la pestaña: frena su Claude y su sesión. Si era la última que queda, se abre otra vacía (siempre hay
// una, para que un pedido sin pestaña tenga dónde caer).
func (t *Tabs) Close(id string) error {
	t.mu.Lock()
	tab := t.tabs[id]
	if tab == nil {
		t.mu.Unlock()
		return fmt.Errorf("no hay pestaña %s", id)
	}
	delete(t.tabs, id)
	if t.last == id {
		t.last = ""
		var newest *Tab
		for _, o := range t.tabs {
			if newest == nil || o.Created.After(newest.Created) {
				newest = o
			}
		}
		if newest != nil {
			t.last = newest.ID
		}
	}
	empty := len(t.tabs) == 0
	t.mu.Unlock()
	tab.Asker.Stop()
	tab.Runner.Stop()
	if empty {
		t.New()
	}
	return nil
}

// pick resuelve la pestaña de un pedido; si nombra una que no existe, contesta 404 y devuelve nil.
func (t *Tabs) pick(w http.ResponseWriter, r *http.Request) *Tab {
	id := r.Header.Get(tabHeader)
	if id == "" {
		id = r.URL.Query().Get("tab")
	}
	tab := t.Get(id)
	if tab == nil {
		writeErr(w, http.StatusNotFound, fmt.Errorf("no hay pestaña %s (bin/navegador pestanas las lista)", id))
		return nil
	}
	// Uso = un comando de Claude (cualquiera, también mirar) o una acción de la persona (lo que no es un GET). Los GET de
	// la interfaz no cuentan: la interfaz consulta el estado de todas solas, sin que nadie las esté usando.
	if fromCLI(r) || r.Method != http.MethodGet {
		t.Touch(tab)
	}
	return tab
}

func fromCLI(r *http.Request) bool { return r.Header.Get(clientHeader) == "cli" }

// Touch anota que la pestaña se acaba de usar.
func (t *Tabs) Touch(tab *Tab) {
	t.mu.Lock()
	tab.lastUsed = time.Now()
	t.mu.Unlock()
}

// Watch anota que una interfaz la está mirando (mientras dura el stream de cuadros) y devuelve con qué dejar de mirar.
// Mientras alguien la mira no se cierra, y cuenta como usada hasta el momento en que dejó de mirarla.
func (t *Tabs) Watch(tab *Tab) func() {
	t.mu.Lock()
	tab.watchers++
	tab.lastUsed = time.Now()
	t.mu.Unlock()
	return func() {
		t.mu.Lock()
		tab.watchers--
		tab.lastUsed = time.Now()
		t.mu.Unlock()
	}
}

// IdleLimit es el tiempo sin uso tras el que se cierra una pestaña de Claude (NAVEGADOR_TAB_IDLE: "15m", "90s"; "0"
// lo apaga). Un valor que no se entiende deja el de siempre.
func IdleLimit(env string) time.Duration {
	if env == "" {
		return tabIdleDefault
	}
	if env == "0" {
		return 0
	}
	if d, err := time.ParseDuration(env); err == nil && d > 0 {
		return d
	}
	return tabIdleDefault
}

// Sweep cierra las pestañas que abrió Claude y que llevan más de idle sin uso, y devuelve cuáles cerró. Nunca cierra:
// - las que abrió la persona;
// - la última que se abrió (es adonde cae un comando sin --sesion: cerrarla mandaría el próximo a otra página);
// - una que alguien está mirando en la interfaz;
// - una con un Claude corriendo (`ask`) o una reproducción en marcha;
// - la única que queda.
// Una sesión de Claude desde la conversación (`empezar`) sin `terminar` sí se cierra si quedó sin uso: es la pestaña
// que se olvidó.
func (t *Tabs) Sweep(now time.Time, idle time.Duration) []string {
	if idle <= 0 {
		return nil
	}
	t.mu.Lock()
	var candidates []*Tab
	if len(t.tabs) > 1 {
		for _, tab := range t.tabs {
			if tab.ByClaude && tab.ID != t.last && tab.watchers == 0 && now.Sub(tab.lastUsed) > idle {
				candidates = append(candidates, tab)
			}
		}
	}
	t.mu.Unlock()
	var closed []string
	for _, tab := range candidates {
		if tab.Asker.Process() || tab.Runner.State(0).Busy {
			continue
		}
		if err := t.Close(tab.ID); err == nil {
			closed = append(closed, tab.ID)
		}
	}
	sort.Strings(closed)
	return closed
}

// TabInfo es lo que la interfaz y el CLI ven de cada pestaña.
type TabInfo struct {
	ID     string `json:"id"`
	Site   string `json:"site"`
	Title  string `json:"title"`
	URL    string `json:"url"`
	Active bool   `json:"active"`         // tiene una página abierta
	Goal   string `json:"meta,omitempty"` // la meta de su Claude, si hay uno trabajando
	Busy   bool   `json:"busy"`           // su Claude está trabajando
	Last   bool   `json:"last"`           // es la que atiende un pedido sin pestaña
	// ByClaude: la abrió Claude; IdleSec: hace cuántos segundos nadie la usa (las de Claude se cierran solas).
	ByClaude bool `json:"porClaude"`
	IdleSec  int  `json:"sinUsoSeg"`
}

func (t *Tabs) Info() []TabInfo {
	t.mu.Lock()
	last := t.last
	idle := map[string]int{}
	for id, tab := range t.tabs {
		if tab.watchers == 0 {
			idle[id] = int(time.Since(tab.lastUsed).Seconds())
		}
	}
	t.mu.Unlock()
	var out []TabInfo
	for _, tab := range t.All() {
		st := tab.Runner.LiveState(false)
		as := tab.Asker.State(-1)
		out = append(out, TabInfo{ID: tab.ID, Site: st.Site, Title: st.Title, URL: st.URL, Active: st.Active,
			Goal: as.Goal, Busy: as.Running, Last: tab.ID == last, ByClaude: tab.ByClaude, IdleSec: idle[tab.ID]})
	}
	return out
}

func (t *Tabs) CloseAll() {
	for _, tab := range t.All() {
		tab.Asker.Stop()
		tab.Runner.Stop()
	}
	stopPlaywright()
}

// ── un BrowserContext por perfil, compartido entre las pestañas del mismo sitio ──

type sharedContext struct {
	bctx   playwright.BrowserContext
	refs   int
	device string
	fresh  bool // nadie tomó todavía su primera página
}

var (
	sharedMu       sync.Mutex
	sharedContexts = map[string]*sharedContext{}
)

// acquireContext da una página propia en el contexto del perfil: lo abre con launch si nadie lo tiene, o agrega una
// página al que ya está abierto. Dos pestañas del mismo perfil tienen que ir con el mismo dispositivo (el perfil
// de un teléfono se fija al abrir). release cierra la página y, con la última, el contexto.
func acquireContext(profile, device string, launch func() (playwright.BrowserContext, error)) (playwright.BrowserContext, playwright.Page, func(), error) {
	sharedMu.Lock()
	defer sharedMu.Unlock()
	sc := sharedContexts[profile]
	if sc != nil && sc.device != device {
		return nil, nil, nil, fmt.Errorf("este sitio ya está abierto en otra pestaña como %s: dos pestañas del mismo sitio comparten el perfil y van con el mismo dispositivo", deviceName(sc.device))
	}
	if sc == nil {
		bctx, err := launch()
		if err != nil {
			return nil, nil, nil, err
		}
		sc = &sharedContext{bctx: bctx, device: device, fresh: true}
		sharedContexts[profile] = sc
	}
	var page playwright.Page
	if sc.fresh {
		page = firstPage(sc.bctx)
		sc.fresh = false
	}
	if page == nil {
		p, err := sc.bctx.NewPage()
		if err != nil {
			if sc.refs == 0 {
				_ = sc.bctx.Close()
				delete(sharedContexts, profile)
			}
			return nil, nil, nil, err
		}
		page = p
	}
	sc.refs++
	var once sync.Once
	release := func() {
		once.Do(func() {
			sharedMu.Lock()
			defer sharedMu.Unlock()
			sc.refs--
			if sc.refs <= 0 {
				_ = sc.bctx.Close()
				if sharedContexts[profile] == sc {
					delete(sharedContexts, profile)
				}
				return
			}
			_ = page.Close()
		})
	}
	return sc.bctx, page, release, nil
}

// contextShared dice cuántas pestañas usan el perfil (para no reabrir con otro dispositivo uno compartido).
func contextShared(profile string) int {
	sharedMu.Lock()
	defer sharedMu.Unlock()
	if sc := sharedContexts[profile]; sc != nil {
		return sc.refs
	}
	return 0
}

func deviceName(d string) string {
	if d == deviceMobile {
		return "teléfono"
	}
	if d == deviceChrome {
		return "tu Chrome"
	}
	return "escritorio"
}
