package main

/* QUÉ PESTAÑA ESTÁ MIRANDO LA PERSONA: la extensión avisa (`user.view`) la pestaña activa de la ventana con foco y si
 * Chrome tiene el foco. Sirve para dos cosas:
 *   - no robarle la vista: cuando una sesión tiene que ir al frente (un sitio «front») y la persona está mirando otra
 *     pestaña de ESA ventana, la sesión se muda a la ventana aparte y se activa ahí (`chrome.tabs.surface`), en vez de
 *     cambiarle la pestaña. Lo que la necesita a ella (el modo guía) sí se le trae: ahí le toca actuar;
 *   - mostrarlo: `tabs`, `chrome` y la vista «Todas» marcan la sesión que está mirando. */

import (
	"encoding/json"
	"strings"
)

// UserView es lo último que avisó la extensión.
type UserView struct {
	TabID    int    `json:"tabId"`
	WindowID int    `json:"windowId"`
	Focused  bool   `json:"focused"` // Chrome tiene el foco (si la persona está en otra app, false)
	Title    string `json:"title,omitempty"`
	URL      string `json:"url,omitempty"`
}

func (b *ChromeBridge) setView(raw json.RawMessage) {
	var v UserView
	if json.Unmarshal(raw, &v) != nil {
		return
	}
	b.mu.Lock()
	b.view = v
	b.mu.Unlock()
}

// View es lo que la persona está mirando ahora (cero si la extensión todavía no avisó o es vieja).
func (b *ChromeBridge) View() UserView {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.view
}

// looking dice si la persona tiene esa pestaña delante (Chrome con foco y esa pestaña activa en la ventana con foco).
func (b *ChromeBridge) looking(tabID int) bool {
	v := b.View()
	return tabID != 0 && v.Focused && v.TabID == tabID
}

// surface activa la pestaña de la sesión sin robarle la vista a la persona (ver arriba). Devuelve si se mudó a la
// ventana aparte. Con una extensión vieja (sin chrome.tabs.surface), activa como antes.
func (b *ChromeBridge) surface(tabID int) (bool, error) {
	raw, err := b.call("chrome.tabs.surface", tabID)
	if err != nil {
		if strings.Contains(err.Error(), "no sé hacer") {
			_, err = b.call("chrome.tabs.activate", tabID)
		}
		return false, err
	}
	var res struct{ Moved bool }
	_ = json.Unmarshal(raw, &res)
	return res.Moved, nil
}
