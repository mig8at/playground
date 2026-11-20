package main

/* Los GRUPOS: cada tarea en su grupo de pestañas de Chrome, con su nombre y su color.
 *
 * Un grupo es una etiqueta de la sesión (Tab.Group): `bin/jarvis start --group 'VTEX' '<meta>'` la pone (sin
 * --group, el CLI arma una con la meta), y la pestaña de Chrome de la sesión va a ese grupo en vez del «Jarvis»
 * violeta de siempre. Sirve para dos cosas:
 *
 *  - ver: en Chrome cada tarea queda junta y de un color, y se pliega o se cierra entera;
 *  - no pisarse: un pedido con X-Jarvis-Group (el CLI con --group G o JARVIS_GROUP=G) y sin pestaña va a la ÚLTIMA
 *    sesión de ese grupo, no a la última de todas. Dos trabajos en paralelo, cada uno con su grupo, no se cruzan.
 *
 * Sólo se mueven al grupo las pestañas que abrió Jarvis: una que compartió la persona queda donde ella la tiene. */

import (
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const groupHeader = "X-Jarvis-Group"

// groupMaxLen: Chrome muestra el nombre del grupo en la tira de pestañas; uno largo se come la barra.
const groupMaxLen = 40

// chromeColors son los colores de grupo que acepta chrome.tabGroups, en el orden en que se reparten. El violeta queda
// último: es el del grupo «Jarvis» de siempre.
var chromeColors = []string{"blue", "green", "orange", "pink", "cyan", "red", "yellow", "grey", "purple"}

// groupOf es el grupo que nombra un pedido (encabezado o ?group=). El CLI lo manda escapado: un encabezado con tildes
// no viaja bien.
func groupOf(r *http.Request) string {
	g := r.Header.Get(groupHeader)
	if g == "" {
		g = r.URL.Query().Get("group")
	} else if u, err := url.QueryUnescape(g); err == nil {
		g = u
	}
	return strings.TrimSpace(g)
}

// groupKey es cómo se comparan dos nombres de grupo: sin mayúsculas, tildes ni espacios de más («Créditos  VTEX» y
// «creditos vtex» son el mismo).
func groupKey(s string) string {
	s = strings.ToLower(strings.Join(strings.Fields(s), " "))
	return strings.NewReplacer("á", "a", "é", "e", "í", "i", "ó", "o", "ú", "u", "ü", "u", "ñ", "n").Replace(s)
}

func validColor(c string) bool {
	for _, x := range chromeColors {
		if x == c {
			return true
		}
	}
	return false
}

// ByGroup devuelve la última sesión que se abrió en el grupo (nil si no hay ninguna).
func (t *Tabs) ByGroup(name string) *Tab {
	key := groupKey(name)
	t.mu.Lock()
	defer t.mu.Unlock()
	var newest *Tab
	for _, tab := range t.tabs {
		if tab.Group != "" && groupKey(tab.Group) == key && (newest == nil || tab.Created.After(newest.Created)) {
			newest = tab
		}
	}
	return newest
}

// colorFor (con t.mu tomado): el color del grupo si ya existe; si no, el primero que no usa otro grupo.
func (t *Tabs) colorFor(key string) string {
	used := map[string]bool{}
	for _, tab := range t.tabs {
		if tab.Group == "" {
			continue
		}
		if groupKey(tab.Group) == key && tab.Color != "" {
			return tab.Color
		}
		used[tab.Color] = true
	}
	for _, c := range chromeColors {
		if !used[c] {
			return c
		}
	}
	return chromeColors[len(t.tabs)%len(chromeColors)]
}

// SetGroup pone la sesión en el grupo (vacío la devuelve al «Jarvis» de siempre) y mueve su pestaña de Chrome si ya
// tiene una. Sin color, el del grupo si ya existe o uno libre. Devuelve el nombre y el color con que quedó: si el
// grupo ya existía, gana su nombre tal como se escribió la primera vez.
func (t *Tabs) SetGroup(tab *Tab, name, color string) (string, string, error) {
	name = strings.Join(strings.Fields(name), " ")
	if len([]rune(name)) > groupMaxLen {
		return "", "", fmt.Errorf("el nombre del grupo es largo (%d letras): hasta %d", len([]rune(name)), groupMaxLen)
	}
	color = strings.ToLower(strings.TrimSpace(color))
	if color != "" && !validColor(color) {
		return "", "", fmt.Errorf("color %q: Chrome acepta %s", color, strings.Join(chromeColors, ", "))
	}
	t.mu.Lock()
	if name == "" {
		color = ""
	} else {
		key := groupKey(name)
		for _, o := range t.tabs {
			if o != tab && o.Group != "" && groupKey(o.Group) == key {
				name = o.Group
				break
			}
		}
		if color == "" {
			color = t.colorFor(key)
		}
		// Un color pedido para un grupo que ya existe lo cambia para todas sus sesiones (en Chrome es uno solo).
		for _, o := range t.tabs {
			if o.Group != "" && groupKey(o.Group) == key {
				o.Color = color
			}
		}
	}
	tab.Group, tab.Color = name, color
	t.mu.Unlock()
	tab.Runner.setGroup(name, color)
	return name, color, nil
}

// NewIn abre una sesión ya dentro de un grupo (vacío = sin grupo, como NewBy).
func (t *Tabs) NewIn(byClaude bool, name, color string) (*Tab, error) {
	tab := t.NewBy(byClaude)
	if name == "" {
		return tab, nil
	}
	if _, _, err := t.SetGroup(tab, name, color); err != nil {
		_ = t.Close(tab.ID)
		return nil, err
	}
	return tab, nil
}

// claimHold: cuánto queda reservada una sesión que tomó un `start` mientras abre su página y arranca su Claude.
const claimHold = 90 * time.Second

// Claim elige, de una sola vez, la sesión para una meta nueva del grupo `name` y la deja reservada:
//   - una del grupo sin Claude trabajando ni reservada;
//   - si no, la última vacía y sin grupo (siempre queda una) — la pasa al grupo;
//   - si no, una nueva en el grupo.
//
// Va en fila (claimMu): antes el CLI listaba y elegía por su cuenta, y dos `start` a la vez tomaban la misma sesión
// vacía (el segundo chocaba con «ya hay un live corriendo»).
func (t *Tabs) Claim(byClaude bool, name, color string) (*Tab, error) {
	t.claimMu.Lock()
	defer t.claimMu.Unlock()
	key := groupKey(name)
	now := time.Now()
	t.mu.Lock()
	last := t.last
	t.mu.Unlock()
	var free, empty *Tab
	for _, tab := range t.All() {
		t.mu.Lock()
		group, held := tab.Group, now.Sub(tab.claimed) < claimHold
		t.mu.Unlock()
		if held || tab.Asker.State(-1).Running || tab.Runner.State(0).Busy {
			continue
		}
		switch {
		case key != "" && group != "" && groupKey(group) == key:
			free = tab
		case group == "" && tab.ID == last && !tab.Runner.LiveState(false).Active:
			empty = tab
		}
	}
	tab := free
	if tab == nil {
		tab = empty
	}
	if tab == nil {
		tab = t.NewBy(byClaude)
	}
	if name != "" && (tab != free || color != "") {
		if _, _, err := t.SetGroup(tab, name, color); err != nil {
			return nil, err
		}
	}
	t.mu.Lock()
	tab.claimed = now
	tab.lastUsed = now
	t.mu.Unlock()
	return tab, nil
}

// setGroup anota el grupo de la sesión y, si ya tiene su pestaña de Chrome, la mueve ahí.
func (r *Runner) setGroup(name, color string) {
	r.mu.Lock()
	r.group, r.groupColor = name, color
	r.mu.Unlock()
	if l := r.liveSession(); l != nil && l.chromeTab != 0 {
		r.applyGroup(l.chromeTab)
	}
}

// applyGroup lleva la pestaña de Chrome de la sesión a su grupo. En segundo plano: la extensión contesta rápido, pero
// no hay por qué hacer esperar al que abrió la sesión.
func (r *Runner) applyGroup(chromeTab int) {
	r.mu.Lock()
	name, color := r.group, r.groupColor
	r.mu.Unlock()
	go func() {
		if err := chromeBridge.groupTab(chromeTab, name, color); err != nil {
			r.say("info", "no se pudo poner la pestaña en el grupo «%s»: %v", name, err)
		}
	}()
}

// groupTab mueve una pestaña que abrió Jarvis al grupo `name` de su ventana (lo crea si no está). Vacío = «Jarvis».
// Una pestaña que compartió la persona no se mueve: está donde ella la puso.
func (b *ChromeBridge) groupTab(tabID int, name, color string) error {
	if tabID == 0 {
		return nil
	}
	b.mu.Lock()
	own := b.opened[tabID]
	b.mu.Unlock()
	if !own {
		return nil
	}
	_, err := b.call("chrome.tabs.setGroup", tabID, name, color)
	if err != nil && strings.Contains(err.Error(), "no sé hacer") {
		return fmt.Errorf("la extensión es vieja: recargala en chrome://extensions")
	}
	return err
}
