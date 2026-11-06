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
 * (Chromium lo bloquea): comparten su BrowserContext, cada una con su página (sharedContexts, abajo). */

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

type Tab struct {
	ID      string
	Runner  *Runner
	Asker   *Asker
	Created time.Time
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
func (t *Tabs) New() *Tab {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.seq++
	id := strconv.Itoa(t.seq)
	r := NewRunner(t.store)
	r.tab = id
	tab := &Tab{ID: id, Runner: r, Asker: &Asker{tab: id}, Created: time.Now()}
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
	}
	return tab
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
}

func (t *Tabs) Info() []TabInfo {
	t.mu.Lock()
	last := t.last
	t.mu.Unlock()
	var out []TabInfo
	for _, tab := range t.All() {
		st := tab.Runner.LiveState(false)
		as := tab.Asker.State(-1)
		out = append(out, TabInfo{ID: tab.ID, Site: st.Site, Title: st.Title, URL: st.URL, Active: st.Active,
			Goal: as.Goal, Busy: as.Running, Last: tab.ID == last})
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
	return "escritorio"
}
