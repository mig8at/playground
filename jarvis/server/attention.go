package main

/* LA ATENCIÓN: cuándo una sesión necesita a la persona, y cómo se le avisa a simple vista.
 *
 * A una pestaña de Jarvis no le hace falta el foco para funcionar (de fondo sigue visible y dibujando: focus.go); lo
 * que de verdad «exige foco» es que necesite a la PERSONA. Eso pasa cuando:
 *   - Claude lo pide (`bin/jarvis attention '<motivo>'`): un código que llegó al celular, una llave, un login;
 *   - el modo guía espera que haga un paso, una reproducción espera que decida o que lo haga ella, Claude le hizo una
 *     pregunta (CONFIRMAR, NECESITO), hay un login en una ventana emergente o un captcha / muro anti-bots.
 * Lo que pidió Claude dura hasta `attention --clear`, hasta que termina su meta (`finish`) o hasta que se cierra la
 * sesión; lo demás dura lo que dura ese estado.
 *
 * Se avisa (syncAttention, cada segundo): 🔔 delante del título de la pestaña (se vuelve a poner si la página lo pisa),
 * su grupo pasa a «⚠ <grupo>» en rojo, el ícono de Jarvis muestra cuántas te necesitan (la extensión), y la interfaz
 * marca la tarjeta con borde rojo y el motivo (TabInfo.Attention). */

import (
	"encoding/json"
	"strings"
	"time"
)

const bell = "🔔 "

// SetAttention anota (o borra, con "") que Claude necesita a la persona en esta sesión, y por qué.
func (r *Runner) SetAttention(reason string) {
	r.mu.Lock()
	r.attention = strings.TrimSpace(reason)
	r.mu.Unlock()
}

func (r *Runner) explicitAttention() string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.attention
}

// Attention dice por qué la sesión necesita a la persona ahora ("" si no la necesita).
func (t *Tab) Attention() string {
	if a := t.Runner.explicitAttention(); a != "" {
		return a
	}
	st := t.Runner.LiveState(false)
	switch {
	case st.Guide != nil:
		return "Te toca un paso: " + st.Guide.Instruction
	case st.Replay != nil && st.Replay.Status == "waiting":
		return "La reproducción espera que elijas qué hacer"
	case st.Replay != nil && st.Replay.Status == "person":
		return "La reproducción espera que lo hagas vos"
	case t.Asker.State(-1).Waiting:
		return "Claude te hizo una pregunta"
	case st.Popup != "":
		return "Un login en una ventana emergente"
	case st.Page != nil:
		for _, n := range st.Page.Notices {
			if strings.HasPrefix(n, "MURO ANTI-BOTS") {
				return "Un captcha o un muro anti-bots: lo resolvés vos"
			}
		}
	}
	return ""
}

// bellJS pone (o saca) 🔔 delante del título de la página, y lo vuelve a poner si la página lo cambia.
const bellJS = `(on) => {
	const B = '` + bell + `'
	if (on) {
		const apply = () => { if (!document.title.startsWith(B)) document.title = B + document.title }
		if (!window.__jarvisBell) window.__jarvisBell = setInterval(apply, 500)
		apply()
	} else {
		clearInterval(window.__jarvisBell)
		window.__jarvisBell = null
		if (document.title.startsWith(B)) document.title = document.title.slice(B.length)
	}
	return true
}`

// syncAttention mantiene los avisos al día: cada segundo, las pestañas que necesitan a la persona llevan 🔔 en el
// título (y las que ya no, no), y la extensión recibe la lista (el número del ícono y el grupo en rojo) cuando cambia.
func syncAttention(tabs *Tabs) {
	last := ""
	for range time.Tick(time.Second) {
		type item struct {
			TabID   int    `json:"tabId"`
			Session string `json:"session"`
			Reason  string `json:"reason"`
		}
		var items []item
		for _, tab := range tabs.All() {
			l := tab.Runner.liveSession()
			if l == nil || l.device != deviceChrome {
				continue
			}
			reason := tab.Attention()
			title := tab.Runner.LiveState(false).Title
			has := strings.HasPrefix(title, bell)
			if (reason != "") != has {
				_, _ = l.page.Evaluate(bellJS, reason != "")
			}
			if reason != "" && l.chromeTab != 0 {
				items = append(items, item{TabID: l.chromeTab, Session: tab.ID, Reason: reason})
			}
		}
		b, _ := json.Marshal(items)
		if string(b) == last || !chromeBridge.connected() {
			continue
		}
		if items == nil {
			items = []item{}
		}
		if _, err := chromeBridge.call("attention.set", items); err == nil || strings.Contains(err.Error(), "no sé hacer") {
			last = string(b)
		}
	}
}
