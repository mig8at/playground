package main

/* QUÉ SE PUEDE CERRAR: una sola regla para el barrido automático (Sweep, cada 30 s) y para `bin/jarvis cleanup`.
 *
 * Se cierra, de lo que abrió Claude:
 *   - una sesión cuya meta terminó (finish) o que nunca tuvo una, sin uso hace más de doneIdle (3 min);
 *   - una sesión con su Claude todavía en una meta pero sin un comando hace más de idle (10 min): la que se olvidó;
 *   - una pestaña HUÉRFANA: la abrió Jarvis para una sesión (está en un grupo) y ya no la maneja nadie —quedó así
 *     cuando se reinició el servidor o se recargó la extensión—.
 * Nunca: lo que abrió o compartió la persona, una sesión que alguien mira en la interfaz, un `ask` o una reproducción
 * en marcha, las pestañas de la ventana aparte (Wally: no van en grupo) ni una que se acaba de abrir.
 * La última sesión (adonde cae un comando sin --session) no se borra: se le cierra la pestaña y queda vacía, así el
 * próximo comando dice «no hay sesión en vivo» en vez de caer en otra página.
 *
 * `cleanup` (manual) es más decidido: cierra las terminadas sin esperar los 3 min. */

import (
	"encoding/json"
	"fmt"
	"sort"
	"time"
)

// inFlight: la sesión está haciendo algo que no se corta: un `ask` corriendo, una reproducción en curso, un paso de la
// guía esperando a la persona o un login en una ventana emergente. OJO: Runner.State().Busy NO sirve para esto: la
// sesión en vivo entera corre como un trabajo (kind «live»), así que una sesión con página está «busy» siempre. El
// barrido viejo lo usaba y por eso nunca cerraba una sesión con página (sólo las vacías): las pestañas se juntaban.
func inFlight(tab *Tab, st LiveState) bool {
	if tab.Asker.Process() || st.Guide != nil || st.Popup != "" {
		return true
	}
	return st.Replay != nil && st.Replay.Status != "done" && st.Replay.Status != "stopped"
}

// orphanGrace: una pestaña recién abierta todavía no tiene sesión (Playwright la engancha después): no es huérfana.
const orphanGrace = 60 * time.Second

// CleanupItem es algo que se puede cerrar y por qué.
type CleanupItem struct {
	Kind      string `json:"kind"` // session · orphan
	Session   string `json:"session,omitempty"`
	ChromeTab int    `json:"chromeTab,omitempty"`
	Title     string `json:"title,omitempty"`
	URL       string `json:"url,omitempty"`
	Group     string `json:"group,omitempty"`
	Reason    string `json:"reason"`
	IdleSec   int    `json:"idleSec,omitempty"`
	KeepEmpty bool   `json:"keepEmpty,omitempty"` // la última sesión: se le cierra la pestaña pero queda (vacía)
}

func minutes(d time.Duration) string {
	if d < time.Minute {
		return fmt.Sprintf("%d s", int(d.Seconds()))
	}
	return fmt.Sprintf("%d min", int(d.Minutes()))
}

// Plan dice qué sesiones se pueden cerrar ahora. manual: las terminadas sin esperar doneIdle.
func (t *Tabs) Plan(now time.Time, idle time.Duration, manual bool) []CleanupItem {
	done := t.doneIdle
	if done <= 0 {
		done = idle
	}
	type cand struct {
		tab     *Tab
		idleFor time.Duration
		last    bool
		group   string
	}
	t.mu.Lock()
	only := len(t.tabs) <= 1
	var cands []cand
	for _, tab := range t.tabs {
		if !tab.ByClaude || tab.watchers > 0 {
			continue
		}
		cands = append(cands, cand{tab, now.Sub(tab.lastUsed), tab.ID == t.last || only, tab.Group})
	}
	t.mu.Unlock()
	var out []CleanupItem
	for _, c := range cands {
		st := c.tab.Runner.LiveState(false)
		if inFlight(c.tab, st) {
			continue
		}
		working := c.tab.Asker.State(-1).Running
		var reason string
		switch {
		case working && idle > 0 && c.idleFor > idle:
			reason = "Claude la dejó sin uso hace " + minutes(c.idleFor) + " (su meta no terminó)"
		case !working && st.Active && (manual || c.idleFor > done):
			reason = "su meta terminó hace " + minutes(c.idleFor)
		case !working && !st.Active && !c.last && (manual || c.idleFor > done):
			reason = "sin página"
		}
		if reason == "" || (c.last && !st.Active) {
			continue
		}
		out = append(out, CleanupItem{Kind: "session", Session: c.tab.ID, ChromeTab: st.ChromeTab, Title: st.Title, URL: st.URL,
			Group: c.group, Reason: reason, IdleSec: int(c.idleFor.Seconds()), KeepEmpty: c.last})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Session < out[j].Session })
	return out
}

// applySession cierra una sesión del plan; la última queda vacía (sin pestaña). Dice si hizo algo.
func (t *Tabs) applySession(it CleanupItem) bool {
	tab := t.Get(it.Session)
	if tab == nil || it.Session == "" {
		return false
	}
	if it.KeepEmpty {
		tab.Runner.Stop()
		return true
	}
	return t.Close(it.Session) == nil
}

// chromeOrphans pregunta a la extensión qué pestañas abrió y devuelve las huérfanas: en un grupo (o sea, de una
// sesión), sin depurador enganchado ni sesión que la use, y abiertas hace más de orphanGrace. Una extensión vieja no
// sabe contestar: no hay huérfanas.
func chromeOrphans(now time.Time) []CleanupItem {
	if !chromeBridge.connected() {
		return nil
	}
	raw, err := chromeBridge.call("chrome.tabs.listOpened")
	if err != nil {
		return nil
	}
	var list []struct {
		ID      int    `json:"id"`
		GroupID int    `json:"groupId"`
		Group   string `json:"group"`
		Title   string `json:"title"`
		URL     string `json:"url"`
	}
	if json.Unmarshal(raw, &list) != nil {
		return nil
	}
	b := chromeBridge
	var out []CleanupItem
	for _, tb := range list {
		if tb.GroupID < 0 {
			continue // la ventana aparte (Wally) o una que la persona sacó del grupo
		}
		b.mu.Lock()
		_, attached := b.attached[tb.ID]
		born, known := b.openedAt[tb.ID]
		b.mu.Unlock()
		chromePW.mu.Lock()
		inUse := chromePW.inUse[tb.ID]
		chromePW.mu.Unlock()
		if attached || inUse || (known && now.Sub(born) < orphanGrace) {
			continue
		}
		out = append(out, CleanupItem{Kind: "orphan", ChromeTab: tb.ID, Title: tb.Title, URL: tb.URL, Group: tb.Group,
			Reason: "la abrió Jarvis y ya no la maneja ninguna sesión (se reinició el servidor o se recargó la extensión)"})
	}
	return out
}

// closeOrphan cierra una pestaña huérfana en Chrome.
func closeOrphan(it CleanupItem) bool {
	if it.ChromeTab == 0 {
		return false
	}
	_, err := chromeBridge.call("chrome.tabs.remove", it.ChromeTab)
	return err == nil
}

// Cleanup arma el plan completo (sesiones y huérfanas) y, con apply, lo ejecuta. Devuelve lo que había (o lo que se
// cerró).
func (t *Tabs) Cleanup(now time.Time, idle time.Duration, manual, apply bool) []CleanupItem {
	items := append(t.Plan(now, idle, manual), chromeOrphans(now)...)
	if !apply {
		return items
	}
	var done []CleanupItem
	for _, it := range items {
		ok := false
		if it.Kind == "orphan" {
			ok = closeOrphan(it)
		} else {
			ok = t.applySession(it)
		}
		if ok {
			done = append(done, it)
		}
	}
	return done
}
