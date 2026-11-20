package main

/* Las PESTAÑAS: varias sesiones en vivo a la vez, cada una con su meta, su corrida, su video y su flujo. Cada
 * pestaña es un Runner (su sesión en vivo, su registro) más un Asker (su Claude), así que todo lo que ya sabía
 * hacer una sesión lo sigue haciendo cada una por su lado.
 *
 * Qué pestaña atiende un pedido: el encabezado X-Jarvis-Tab (o ?tab=), que manda el CLI con --session N o
 * JARVIS_SESION; sin él, la ÚLTIMA que se abrió. La interfaz elige cuál MIRA sin cambiar ese default: si no,
 * un clic de la persona mandaría los comandos de Claude a otra página.
 *
 * LAS PESTAÑAS QUE CLAUDE DEJA SE CIERRAN SOLAS (Sweep, abajo). Una pestaña que abrió Claude (el CLI) y que nadie usa
 * hace un rato —ningún comando de Claude, ninguna acción de la persona, nadie mirándola en la interfaz— se cierra. Así
 * no se juntan diez páginas viejas de un día de trabajo. Las que abrió la persona no se tocan nunca. */

import (
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const tabHeader = "X-Jarvis-Tab"

// clientHeader lo manda el CLI (bin/jarvis) en cada pedido: es lo que distingue a Claude de la interfaz.
const clientHeader = "X-Jarvis-Client"

// tabIdleDefault: cuánto puede quedar sin uso una pestaña de Claude antes de cerrarse (JARVIS_TAB_IDLE la cambia;
// "0" apaga el cierre).
const tabIdleDefault = 10 * time.Minute

// tabDoneIdleDefault: cuánto queda la pestaña de una meta terminada (o de una sesión que nunca tuvo meta) antes de
// cerrarse sola. Corto: si la próxima meta es en el mismo sitio, la reutiliza antes (Claim).
const tabDoneIdleDefault = 3 * time.Minute

type Tab struct {
	ID      string
	Runner  *Runner
	Asker   *Asker
	Created time.Time
	// ByClaude: la abrió el CLI (no la persona desde la interfaz). Sólo éstas se cierran solas.
	ByClaude bool
	// Group y Color: el grupo de pestañas de Chrome de su tarea (groups.go). Vacío = el grupo «Jarvis» de siempre. Se
	// leen y escriben con Tabs.mu.
	Group string
	Color string
	// claimed: cuándo la tomó un `start` (Claim, groups.go); hasta que su Claude arranca, otro no la toma.
	claimed time.Time
	// Las dos se leen y escriben con Tabs.mu.
	lastUsed time.Time // el último comando de Claude o acción de la persona sobre ella
	watchers int       // interfaces mirándola ahora (streams de cuadros abiertos)
}

type Tabs struct {
	mu sync.Mutex
	// claimMu pone en fila los Claim: dos `start` a la vez no pueden elegir la misma sesión.
	claimMu sync.Mutex
	store   *Store
	seq     int
	tabs    map[string]*Tab
	last    string // la última que se abrió: el default de un pedido sin pestaña
	// doneIdle: cuánto queda abierta la pestaña de una sesión cuya meta terminó (JARVIS_TAB_DONE_IDLE; 0 = el mismo
	// tope que las que trabajan). cleanup.go.
	doneIdle time.Duration
}

func NewTabs(store *Store) *Tabs {
	t := &Tabs{store: store, tabs: map[string]*Tab{}, doneIdle: tabDoneIdleDefault}
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
	var tab *Tab
	// Sin pestaña pero con grupo (--group G en el CLI): la última sesión de ESE grupo, no la última de todas. Así dos
	// trabajos en paralelo, cada uno en su grupo, no se pisan aunque ninguno diga --session.
	if g := groupOf(r); id == "" && g != "" {
		if tab = t.ByGroup(g); tab == nil {
			writeErr(w, http.StatusNotFound, fmt.Errorf("no hay sesiones en el grupo «%s» (bin/jarvis groups los lista; start --group lo crea)", g))
			return nil
		}
	} else if tab = t.Get(id); tab == nil {
		writeErr(w, http.StatusNotFound, fmt.Errorf("no hay pestaña %s (bin/jarvis tabs las lista)", id))
		return nil
	}
	// Uso = un comando de Claude (cualquiera, también mirar) o una acción de la persona (lo que no es un GET). Los GET de
	// la interfaz no cuentan: la interfaz consulta el estado de todas solas, sin que nadie las esté usando.
	if fromCLI(r) || r.Method != http.MethodGet {
		t.Touch(tab)
	}
	// La pestaña va al frente sólo si hace falta (focus.go): lo que necesita a la persona (el modo guía), «seguir a
	// Claude» prendido o un sitio que no anda de fondo. Si no, Claude trabaja detrás y no te mueve la vista.
	if fromCLI(r) {
		tab.Runner.focusChrome(strings.HasPrefix(r.URL.Path, "/api/live/guide"))
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

// IdleLimit es el tiempo sin uso tras el que se cierra una pestaña de Claude (JARVIS_TAB_IDLE: "15m", "90s"; "0"
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

// Sweep cierra las sesiones que abrió Claude y ya no hacen falta (Plan con manual=false) y devuelve cuáles cerró o
// dejó sin página. idle es el tope de una con su Claude todavía en una meta; las demás (terminó o nunca empezó) usan
// t.doneIdle, más corto: una meta terminada no tiene por qué dejar su pestaña 10 minutos. 0 apaga el cierre.
func (t *Tabs) Sweep(now time.Time, idle time.Duration) []string {
	if idle <= 0 {
		return nil
	}
	var out []string
	for _, it := range t.Plan(now, idle, false) {
		if t.applySession(it) {
			out = append(out, it.Session)
		}
	}
	sort.Strings(out)
	return out
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
	ByClaude bool `json:"byClaude"`
	IdleSec  int  `json:"idleSec"`
	// Device y ChromeTab: dónde corre la sesión; con «chrome», en qué pestaña de Chrome (el panel de Jarvis va a ella).
	Device    string `json:"device,omitempty"`
	ChromeTab int    `json:"chromeTab,omitempty"`
	// Group y Color: el grupo de pestañas de Chrome de su tarea; vacío, el «Jarvis» de siempre.
	Group string `json:"group,omitempty"`
	Color string `json:"color,omitempty"`
}

func (t *Tabs) Info() []TabInfo {
	t.mu.Lock()
	last := t.last
	idle := map[string]int{}
	group := map[string][2]string{}
	for id, tab := range t.tabs {
		if tab.watchers == 0 {
			idle[id] = int(time.Since(tab.lastUsed).Seconds())
		}
		group[id] = [2]string{tab.Group, tab.Color}
	}
	t.mu.Unlock()
	var out []TabInfo
	for _, tab := range t.All() {
		st := tab.Runner.LiveState(false)
		as := tab.Asker.State(-1)
		out = append(out, TabInfo{ID: tab.ID, Site: st.Site, Title: st.Title, URL: st.URL, Active: st.Active,
			Goal: as.Goal, Busy: as.Running, Last: tab.ID == last, ByClaude: tab.ByClaude, IdleSec: idle[tab.ID],
			Device: st.Device, ChromeTab: st.ChromeTab, Group: group[tab.ID][0], Color: group[tab.ID][1]})
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
