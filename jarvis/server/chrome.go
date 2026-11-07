package main

/* El motor «chrome»: la sesión en vivo corre en el Chrome de la persona, no en el Chromium de Playwright.
 *
 * La extensión Jarvis (jarvis/extension) vive en ese Chrome y se conecta a /api/chrome/bridge. Por ahí
 * pasa el protocolo de depuración (CDP) de las pestañas que la persona COMPARTE desde la pestaña Jarvis, o de las que
 * el navegador abre, con chrome.debugger. Del otro lado, /api/chrome/cdp le habla a Playwright como si fuera un
 * Chrome: contesta lo que es del navegador entero (versión, auto-attach, abrir y cerrar pestañas) y lo demás se lo
 * reenvía a la pestaña que corresponde. Así todo lo que ya hace la sesión en vivo (look, clic, pasos, flujos,
 * script) funciona igual, sin reescribirlo. Es el mismo diseño que el puente de Playwright MCP (browserModel.ts).
 *
 * Sólo local y sin disfrazar nada: es el Chrome de la persona, con su sesión, y Chrome muestra la barra «una
 * extensión está depurando este navegador» mientras dura. Un captcha lo resuelve la persona.
 *
 * Quién puede conectarse: al puente, sólo una extensión (Origin chrome-extension://, y si JARVIS_CHROME_EXT está,
 * sólo esa); al lado de Playwright, sólo un cliente que no es una página web (sin Origin). El servidor escucha en
 * 127.0.0.1 (serve).
 */

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/playwright-community/playwright-go"
)

const deviceChrome = "chrome"

// cdpMessage es un mensaje del protocolo de depuración, en cualquiera de las dos puntas.
type cdpMessage struct {
	ID        int             `json:"id,omitempty"`
	SessionID string          `json:"sessionId,omitempty"`
	Method    string          `json:"method,omitempty"`
	Params    json.RawMessage `json:"params,omitempty"`
	Result    json.RawMessage `json:"result,omitempty"`
	Error     *cdpError       `json:"error,omitempty"`
}

type cdpError struct {
	Message string `json:"message"`
}

// extMessage es un mensaje con la extensión: un pedido {id, method, params}, su respuesta {id, result|error} o un
// evento {method, params}.
type extMessage struct {
	ID     int             `json:"id,omitempty"`
	Method string          `json:"method,omitempty"`
	Params json.RawMessage `json:"params,omitempty"`
	Result json.RawMessage `json:"result,omitempty"`
	Error  string          `json:"error,omitempty"`
}

type extReply struct {
	result json.RawMessage
	err    error
}

// chromeTab es una pestaña con el depurador enganchado: Playwright la ve como la sesión `pw-tab-N`.
type chromeTab struct {
	tabID      int
	sessionID  string
	targetInfo map[string]any
	children   map[string]bool // las sesiones hijas (iframes de otro origen, workers) de esta pestaña
}

// ChromeBridge une la extensión (una) con Playwright (uno a la vez).
type ChromeBridge struct {
	mu          sync.Mutex
	ext         *websocket.Conn
	extInfo     map[string]any // lo que la extensión dijo de sí al conectarse (versión, navegador)
	pending     map[int]chan extReply
	lastID      int
	pw          *websocket.Conn
	shared      map[int]bool // las pestañas que la persona compartió o que abrió el navegador: las únicas que se tocan
	opened      map[int]bool // de ésas, las que abrió el navegador (createTarget): no se reusan como «compartidas»
	attached    map[int]*chromeTab
	autoAttach  bool
	nextSession int
	// Las sesiones «de cliente» que Playwright pide además de la de cada pestaña (context.newCDPSession: la del
	// screencast). chrome.debugger da una sola sesión por pestaña, así que son alias de esa: los comandos van a la
	// pestaña y sus eventos se repiten a cada alias.
	aliases map[string]int
}

// browserSession es la sesión «del navegador entero» que Playwright abre con Target.attachToBrowserTarget.
const browserSession = "navegador-browser"

var chromeBridge = &ChromeBridge{pending: map[int]chan extReply{}, shared: map[int]bool{}, opened: map[int]bool{}, attached: map[int]*chromeTab{}, aliases: map[string]int{}}

// ChromeStatus es lo que muestran la interfaz y `bin/jarvis chrome`.
type ChromeStatus struct {
	Connected bool           `json:"connected"`
	Extension map[string]any `json:"extension,omitempty"`
	Shared    []int          `json:"shared"`
	Attached  []int          `json:"attached"`
	Driving   bool           `json:"driving"` // Playwright está conectado (hay una sesión en vivo en Chrome)
}

func (b *ChromeBridge) Status() ChromeStatus {
	b.mu.Lock()
	defer b.mu.Unlock()
	st := ChromeStatus{Connected: b.ext != nil, Extension: b.extInfo, Shared: []int{}, Attached: []int{}, Driving: b.pw != nil}
	for id := range b.shared {
		st.Shared = append(st.Shared, id)
	}
	for id := range b.attached {
		st.Attached = append(st.Attached, id)
	}
	return st
}

func (b *ChromeBridge) connected() bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.ext != nil
}

// ── la extensión ──

func extensionOriginOK(origin string) bool {
	if want := os.Getenv("JARVIS_CHROME_EXT"); want != "" {
		return origin == "chrome-extension://"+want
	}
	return strings.HasPrefix(origin, "chrome-extension://")
}

func (b *ChromeBridge) serveExtension(w http.ResponseWriter, r *http.Request) {
	if !extensionOriginOK(r.Header.Get("Origin")) {
		http.Error(w, "sólo la extensión del navegador se conecta acá", http.StatusForbidden)
		return
	}
	c, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true}) // el Origin ya se miró arriba
	if err != nil {
		return
	}
	c.SetReadLimit(64 << 20) // una captura de pantalla viaja entera
	b.mu.Lock()
	if b.ext != nil {
		b.mu.Unlock()
		_ = c.Close(websocket.StatusPolicyViolation, "ya hay una extensión conectada")
		return
	}
	b.ext = c
	b.mu.Unlock()
	logf("chrome: la extensión se conectó")

	ctx := r.Context()
	for {
		_, data, err := c.Read(ctx)
		if err != nil {
			break
		}
		var m extMessage
		if json.Unmarshal(data, &m) != nil {
			continue
		}
		if m.ID != 0 && m.Method == "" {
			b.mu.Lock()
			ch := b.pending[m.ID]
			delete(b.pending, m.ID)
			b.mu.Unlock()
			if ch != nil {
				var e error
				if m.Error != "" {
					e = errors.New(m.Error)
				}
				ch <- extReply{result: m.Result, err: e}
			}
			continue
		}
		b.onExtensionEvent(m)
	}

	b.mu.Lock()
	b.ext = nil
	b.extInfo = nil
	for id, ch := range b.pending {
		ch <- extReply{err: errors.New("la extensión se desconectó")}
		delete(b.pending, id)
	}
	b.shared = map[int]bool{}
	pw := b.pw
	b.mu.Unlock()
	if pw != nil {
		_ = pw.Close(websocket.StatusGoingAway, "la extensión se desconectó")
	}
	logf("chrome: la extensión se desconectó")
}

// send le pide algo a la extensión. Devuelve el canal de la respuesta: el pedido ya salió, en orden, al volver.
func (b *ChromeBridge) send(method string, params ...any) (<-chan extReply, error) {
	raw, err := json.Marshal(params)
	if err != nil {
		return nil, err
	}
	ch := make(chan extReply, 1)
	b.mu.Lock()
	ext := b.ext
	if ext == nil {
		b.mu.Unlock()
		return nil, errors.New("Jarvis (la extensión de Chrome) no está conectado")
	}
	b.lastID++
	id := b.lastID
	b.pending[id] = ch
	data, _ := json.Marshal(extMessage{ID: id, Method: method, Params: raw})
	err = ext.Write(context.Background(), websocket.MessageText, data)
	if err != nil {
		delete(b.pending, id)
	}
	b.mu.Unlock()
	if err != nil {
		return nil, err
	}
	return ch, nil
}

func (b *ChromeBridge) call(method string, params ...any) (json.RawMessage, error) {
	ch, err := b.send(method, params...)
	if err != nil {
		return nil, err
	}
	select {
	case rep := <-ch:
		return rep.result, rep.err
	case <-time.After(30 * time.Second):
		return nil, fmt.Errorf("la extensión no contestó %s en 30 s", method)
	}
}

func (b *ChromeBridge) onExtensionEvent(m extMessage) {
	var params []json.RawMessage
	_ = json.Unmarshal(m.Params, &params)
	switch m.Method {
	case "extension.hello":
		var info map[string]any
		if len(params) > 0 {
			_ = json.Unmarshal(params[0], &info)
		}
		b.mu.Lock()
		b.extInfo = info
		b.mu.Unlock()
	case "tabs.shared":
		// La lista entera de pestañas compartidas, cada vez que cambia.
		var ids []int
		if len(params) > 0 {
			_ = json.Unmarshal(params[0], &ids)
		}
		b.mu.Lock()
		next := map[int]bool{}
		for _, id := range ids {
			next[id] = true
		}
		var added []int
		for id := range next {
			if !b.shared[id] {
				added = append(added, id)
			}
		}
		b.shared = next
		auto := b.autoAttach
		b.mu.Unlock()
		if auto {
			for _, id := range added {
				go func(id int) { _, _ = b.attachTab(id) }(id)
			}
		}
	case "chrome.tabs.onRemoved":
		var id int
		if len(params) > 0 {
			_ = json.Unmarshal(params[0], &id)
		}
		b.mu.Lock()
		delete(b.shared, id)
		delete(b.opened, id)
		b.mu.Unlock()
		b.detachTab(id)
	case "chrome.debugger.onDetach":
		var src struct {
			TabID int `json:"tabId"`
		}
		if len(params) > 0 {
			_ = json.Unmarshal(params[0], &src)
		}
		b.detachTab(src.TabID)
	case "chrome.debugger.onEvent":
		if len(params) < 3 {
			return
		}
		var src struct {
			TabID     int    `json:"tabId"`
			SessionID string `json:"sessionId"`
		}
		var method string
		_ = json.Unmarshal(params[0], &src)
		_ = json.Unmarshal(params[1], &method)
		b.mu.Lock()
		t := b.attached[src.TabID]
		if t == nil {
			b.mu.Unlock()
			return
		}
		var child struct {
			SessionID string `json:"sessionId"`
		}
		_ = json.Unmarshal(params[2], &child)
		if child.SessionID != "" {
			if method == "Target.attachedToTarget" {
				t.children[child.SessionID] = true
			} else if method == "Target.detachedFromTarget" {
				delete(t.children, child.SessionID)
			}
		}
		session := src.SessionID
		var aliases []string
		if session == "" {
			session = t.sessionID
			for a, id := range b.aliases {
				if id == src.TabID {
					aliases = append(aliases, a)
				}
			}
		}
		b.mu.Unlock()
		cdpTrace(src.TabID, src.SessionID, method, params[2])
		b.toPlaywright(cdpMessage{SessionID: session, Method: method, Params: params[2]})
		for _, a := range aliases {
			b.toPlaywright(cdpMessage{SessionID: a, Method: method, Params: params[2]})
		}
	}
}

// ── Playwright ──

func (b *ChromeBridge) toPlaywright(m cdpMessage) {
	b.mu.Lock()
	pw := b.pw
	b.mu.Unlock()
	if pw == nil {
		return
	}
	data, _ := json.Marshal(m)
	_ = pw.Write(context.Background(), websocket.MessageText, data)
}

func (b *ChromeBridge) servePlaywright(w http.ResponseWriter, r *http.Request) {
	// Una página web siempre manda Origin: así ninguna puede manejar el Chrome de la persona por este lado.
	if r.Header.Get("Origin") != "" {
		http.Error(w, "este extremo es para Playwright, no para una página", http.StatusForbidden)
		return
	}
	c, err := websocket.Accept(w, r, nil)
	if err != nil {
		return
	}
	c.SetReadLimit(64 << 20)
	b.mu.Lock()
	if b.ext == nil || b.pw != nil {
		why := "la extensión no está conectada"
		if b.pw != nil {
			why = "ya hay otra conexión de Playwright"
		}
		b.mu.Unlock()
		_ = c.Close(websocket.StatusPolicyViolation, why)
		return
	}
	b.pw = c
	b.mu.Unlock()

	ctx := r.Context()
	for {
		_, data, err := c.Read(ctx)
		if err != nil {
			break
		}
		var m cdpMessage
		if json.Unmarshal(data, &m) != nil {
			continue
		}
		b.handleCommand(m)
	}

	// Playwright se fue: se sueltan las pestañas (se va la barra amarilla) y se olvida el auto-attach.
	b.mu.Lock()
	b.pw = nil
	b.autoAttach = false
	ids := make([]int, 0, len(b.attached))
	for id := range b.attached {
		ids = append(ids, id)
	}
	b.attached = map[int]*chromeTab{}
	b.aliases = map[string]int{}
	b.mu.Unlock()
	for _, id := range ids {
		_, _ = b.send("chrome.debugger.detach", map[string]int{"tabId": id})
	}
}

// handleCommand contesta lo que es del navegador entero y reenvía lo demás. El reenvío sale EN ORDEN (antes de
// leer el próximo comando); la espera de la respuesta va aparte.
func (b *ChromeBridge) handleCommand(m cdpMessage) {
	reply := func(result any, err error) {
		out := cdpMessage{ID: m.ID, SessionID: m.SessionID}
		if err != nil {
			out.Error = &cdpError{Message: err.Error()}
		} else {
			raw, _ := json.Marshal(result)
			if string(raw) == "null" {
				raw = []byte("{}")
			}
			out.Result = raw
		}
		b.toPlaywright(out)
	}
	// Lo que llega por la sesión del navegador entero es como si no tuviera sesión (la respuesta sí la lleva).
	session := m.SessionID
	if session == browserSession {
		session = ""
	}
	switch m.Method {
	case "Browser.close", "Browser.crash", "Browser.crashGpuProcess", "Target.disposeBrowserContext":
		// Es el Chrome de la persona: ningún cliente lo cierra ni lo tira. Se contesta como hecho, sin reenviarlo.
		reply(map[string]any{}, nil)
		return
	case "Target.attachToBrowserTarget":
		reply(map[string]string{"sessionId": browserSession}, nil)
		return
	case "Target.attachToTarget":
		if session == "" {
			var p struct {
				TargetID string `json:"targetId"`
			}
			_ = json.Unmarshal(m.Params, &p)
			reply(b.aliasFor(p.TargetID))
			return
		}
	case "Target.detachFromTarget":
		var p struct {
			SessionID string `json:"sessionId"`
		}
		_ = json.Unmarshal(m.Params, &p)
		b.mu.Lock()
		_, isAlias := b.aliases[p.SessionID]
		delete(b.aliases, p.SessionID)
		b.mu.Unlock()
		if isAlias {
			reply(map[string]any{}, nil)
			return
		}
	case "Browser.getVersion":
		ua := "Chrome"
		b.mu.Lock()
		if v, ok := b.extInfo["userAgent"].(string); ok {
			ua = v
		}
		b.mu.Unlock()
		reply(map[string]string{"protocolVersion": "1.3", "product": "Chrome/Navegador-Bridge", "userAgent": ua}, nil)
		return
	case "Page.bringToFront":
		// En Chrome: activar la pestaña en su ventana (chrome.tabs), sin robarle el foco a la ventana de la persona.
		if t, err := b.debuggerTarget(m.Method, session); err == nil {
			go func() {
				_, err := b.call("chrome.tabs.activate", t["tabId"])
				reply(map[string]any{}, err)
			}()
			return
		}
	case "Browser.setDownloadBehavior":
		reply(map[string]any{}, nil)
		return
	case "Target.setAutoAttach":
		if session == "" {
			go func() { reply(map[string]any{}, b.enableAutoAttach()) }()
			return
		}
	case "Target.createTarget":
		var p struct {
			URL string `json:"url"`
		}
		_ = json.Unmarshal(m.Params, &p)
		go func() { reply(b.createTarget(p.URL)) }()
		return
	case "Target.closeTarget":
		var p struct {
			TargetID string `json:"targetId"`
		}
		_ = json.Unmarshal(m.Params, &p)
		go func() { reply(b.closeTarget(p.TargetID)) }()
		return
	case "Target.getTargetInfo":
		if session == "" {
			// Del navegador entero (Playwright lo pide al conectarse, antes de que haya pestañas).
			reply(map[string]any{"targetInfo": map[string]any{"targetId": "navegador-browser", "type": "browser", "title": "", "url": "", "attached": true, "canAccessOpener": false}}, nil)
			return
		}
		if m.SessionID != "" {
			b.mu.Lock()
			var info map[string]any
			for _, t := range b.attached {
				if t.sessionID == m.SessionID {
					info = t.targetInfo
				}
			}
			b.mu.Unlock()
			if info != nil {
				reply(map[string]any{"targetInfo": info}, nil)
				return
			}
		}
	}

	target, err := b.debuggerTarget(m.Method, session)
	if err != nil {
		reply(nil, err)
		return
	}
	var params any = map[string]any{}
	if len(m.Params) > 0 {
		params = m.Params
	}
	ch, err := b.send("chrome.debugger.sendCommand", target, m.Method, params)
	if err != nil {
		reply(nil, err)
		return
	}
	go func() {
		rep := <-ch
		if rep.err != nil {
			reply(nil, rep.err)
			return
		}
		out := cdpMessage{ID: m.ID, SessionID: m.SessionID, Result: rep.result}
		if len(out.Result) == 0 || string(out.Result) == "null" {
			out.Result = []byte("{}")
		}
		b.toPlaywright(out)
	}()
}

// debuggerTarget dice a qué pestaña de chrome.debugger va un comando: sin sesión, a cualquiera enganchada (son
// comandos del navegador entero); con la sesión de una pestaña, a ella; con una sesión hija, a su pestaña con esa
// sesión.
func (b *ChromeBridge) debuggerTarget(method, session string) (map[string]any, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if session == "" {
		for id := range b.attached {
			return map[string]any{"tabId": id}, nil
		}
		return nil, fmt.Errorf("no hay ninguna pestaña enganchada para %s", method)
	}
	if id, ok := b.aliases[session]; ok {
		return map[string]any{"tabId": id}, nil
	}
	for id, t := range b.attached {
		if t.sessionID == session {
			return map[string]any{"tabId": id}, nil
		}
		if t.children[session] {
			return map[string]any{"tabId": id, "sessionId": session}, nil
		}
	}
	return nil, fmt.Errorf("ninguna pestaña tiene la sesión %s", session)
}

func (b *ChromeBridge) enableAutoAttach() error {
	b.mu.Lock()
	b.autoAttach = true
	ids := make([]int, 0, len(b.shared))
	for id := range b.shared {
		ids = append(ids, id)
	}
	b.mu.Unlock()
	for _, id := range ids {
		if _, err := b.attachTab(id); err != nil {
			logf("chrome: no se pudo enganchar la pestaña %d: %v", id, err)
		}
	}
	return nil
}

func (b *ChromeBridge) attachTab(tabID int) (*chromeTab, error) {
	b.mu.Lock()
	if t := b.attached[tabID]; t != nil {
		b.mu.Unlock()
		return t, nil
	}
	b.mu.Unlock()
	if _, err := b.call("chrome.debugger.attach", map[string]int{"tabId": tabID}, "1.3"); err != nil {
		return nil, err
	}
	raw, err := b.call("chrome.debugger.sendCommand", map[string]int{"tabId": tabID}, "Target.getTargetInfo", map[string]any{})
	if err != nil {
		return nil, err
	}
	var res struct {
		TargetInfo map[string]any `json:"targetInfo"`
	}
	_ = json.Unmarshal(raw, &res)
	b.mu.Lock()
	if t := b.attached[tabID]; t != nil { // otro pedido la enganchó mientras tanto
		b.mu.Unlock()
		return t, nil
	}
	b.nextSession++
	t := &chromeTab{tabID: tabID, sessionID: fmt.Sprintf("pw-tab-%d", b.nextSession), targetInfo: res.TargetInfo, children: map[string]bool{}}
	b.attached[tabID] = t
	b.mu.Unlock()
	info := map[string]any{}
	for k, v := range res.TargetInfo {
		info[k] = v
	}
	info["attached"] = true
	params, _ := json.Marshal(map[string]any{"sessionId": t.sessionID, "targetInfo": info, "waitingForDebugger": false})
	b.toPlaywright(cdpMessage{Method: "Target.attachedToTarget", Params: params})
	return t, nil
}

func (b *ChromeBridge) detachTab(tabID int) {
	b.mu.Lock()
	t := b.attached[tabID]
	delete(b.attached, tabID)
	for a, id := range b.aliases {
		if id == tabID {
			delete(b.aliases, a)
		}
	}
	b.mu.Unlock()
	if t == nil {
		return
	}
	params, _ := json.Marshal(map[string]any{"sessionId": t.sessionID, "targetId": t.targetInfo["targetId"]})
	b.toPlaywright(cdpMessage{Method: "Target.detachedFromTarget", Params: params})
}

// tabForTarget dice qué pestaña de Chrome tiene ese target (0 si ninguna enganchada).
func (b *ChromeBridge) tabForTarget(targetID string) int {
	b.mu.Lock()
	defer b.mu.Unlock()
	for id, t := range b.attached {
		if t.targetInfo["targetId"] == targetID {
			return id
		}
	}
	return 0
}

// aliasFor da una sesión más para la pestaña de ese target (ver aliases).
func (b *ChromeBridge) aliasFor(targetID string) (map[string]any, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	for id, t := range b.attached {
		if t.targetInfo["targetId"] == targetID {
			b.nextSession++
			alias := fmt.Sprintf("pw-alias-%d", b.nextSession)
			b.aliases[alias] = id
			return map[string]any{"sessionId": alias}, nil
		}
	}
	return nil, fmt.Errorf("no hay pestaña enganchada con el target %s", targetID)
}

// createTarget abre una pestaña en el Chrome de la persona: queda compartida (es del navegador) y enganchada.
func (b *ChromeBridge) createTarget(url string) (map[string]any, error) {
	if url == "" {
		url = "about:blank"
	}
	raw, err := b.call("chrome.tabs.create", map[string]any{"url": url, "active": true})
	if err != nil {
		return nil, err
	}
	var tab struct {
		ID int `json:"id"`
	}
	if json.Unmarshal(raw, &tab) != nil || tab.ID == 0 {
		return nil, errors.New("la extensión no pudo abrir la pestaña")
	}
	b.mu.Lock()
	b.shared[tab.ID] = true
	b.opened[tab.ID] = true
	b.mu.Unlock()
	t, err := b.attachTab(tab.ID)
	if err != nil {
		return nil, err
	}
	return map[string]any{"targetId": t.targetInfo["targetId"]}, nil
}

func (b *ChromeBridge) closeTarget(targetID string) (map[string]any, error) {
	b.mu.Lock()
	id := 0
	for tid, t := range b.attached {
		if t.targetInfo["targetId"] == targetID {
			id = tid
		}
	}
	b.mu.Unlock()
	if id == 0 {
		return map[string]any{"success": false}, nil
	}
	if _, err := b.call("chrome.tabs.remove", id); err != nil {
		return nil, err
	}
	return map[string]any{"success": true}, nil
}

// ── el lado de la sesión en vivo ──

var chromePW struct {
	mu       sync.Mutex
	browser  playwright.Browser
	sessions int          // las sesiones en vivo que corren en Chrome ahora
	inUse    map[int]bool // las pestañas de Chrome que ya tiene una sesión: otra no las toma
}

// chromeTabInUse marca (o suelta) una pestaña de Chrome como tomada por una sesión.
func chromeTabInUse(tabID int, used bool) {
	if tabID == 0 {
		return
	}
	chromePW.mu.Lock()
	defer chromePW.mu.Unlock()
	if chromePW.inUse == nil {
		chromePW.inUse = map[int]bool{}
	}
	if used {
		chromePW.inUse[tabID] = true
	} else {
		delete(chromePW.inUse, tabID)
	}
}

// chromeSessionStarted cuenta una sesión en Chrome y devuelve con qué terminarla: al terminar la última, se corta
// Playwright y el puente suelta el depurador de todas las pestañas (se va la barra «está depurando» de Chrome).
func chromeSessionStarted() func() {
	chromePW.mu.Lock()
	chromePW.sessions++
	chromePW.mu.Unlock()
	var once sync.Once
	return func() {
		once.Do(func() {
			chromePW.mu.Lock()
			chromePW.sessions--
			last := chromePW.sessions <= 0
			chromePW.mu.Unlock()
			if last {
				chromeBridge.dropPlaywright()
			}
		})
	}
}

// dropPlaywright corta la conexión de Playwright; servePlaywright suelta las pestañas al verla cerrarse.
func (b *ChromeBridge) dropPlaywright() {
	b.mu.Lock()
	pw := b.pw
	b.mu.Unlock()
	if pw != nil {
		_ = pw.Close(websocket.StatusNormalClosure, "no quedan sesiones en Chrome")
	}
}

// chromeContext conecta Playwright al Chrome de la persona (una vez; se reusa mientras siga conectado).
func chromeContext(pw *playwright.Playwright) (playwright.BrowserContext, error) {
	if !chromeBridge.connected() {
		return nil, errors.New("Jarvis no está conectado: cargá la extensión en Chrome (jarvis/extension) y mirá que la pestaña Jarvis (su ícono) diga «conectado»")
	}
	chromePW.mu.Lock()
	defer chromePW.mu.Unlock()
	if chromePW.browser != nil && chromePW.browser.IsConnected() {
		if cs := chromePW.browser.Contexts(); len(cs) > 0 {
			return cs[0], nil
		}
	}
	b, err := pw.Chromium.ConnectOverCDP("ws://" + apiAddr + "/api/chrome/cdp")
	if err != nil {
		return nil, fmt.Errorf("conectar con Chrome: %w", err)
	}
	b.OnDisconnected(func(playwright.Browser) {
		chromePW.mu.Lock()
		if chromePW.browser == b {
			chromePW.browser = nil
		}
		chromePW.mu.Unlock()
	})
	chromePW.browser = b
	cs := b.Contexts()
	if len(cs) == 0 {
		return nil, errors.New("Chrome no expuso ningún contexto")
	}
	return cs[0], nil
}

// sharedChromePage busca una pestaña del mismo sitio que start que la persona COMPARTIÓ y que no tiene otra sesión.
// Las que abrió el navegador no cuentan: son de la sesión que las abrió (dos sesiones en la misma pestaña se pisan;
// pasó con la compra y el admin de VTEX, los dos en creditop.myvtex.com). Devuelve la página y su pestaña de Chrome.
func sharedChromePage(bctx playwright.BrowserContext, start string) (playwright.Page, int) {
	want, err := url.Parse(withScheme(start))
	if err != nil || want.Host == "" {
		return nil, 0
	}
	for _, p := range bctx.Pages() {
		u, err := url.Parse(p.URL())
		if err != nil || u.Host != want.Host {
			continue
		}
		tab := chromeTabOf(bctx, p)
		chromeBridge.mu.Lock()
		mine := tab != 0 && chromeBridge.shared[tab] && !chromeBridge.opened[tab]
		chromeBridge.mu.Unlock()
		chromePW.mu.Lock()
		busy := chromePW.inUse[tab]
		chromePW.mu.Unlock()
		if mine && !busy {
			return p, tab
		}
	}
	return nil, 0
}

// chromeTabOf dice en qué pestaña de Chrome está una página (0 si no se supo).
func chromeTabOf(bctx playwright.BrowserContext, p playwright.Page) int {
	cdp, err := bctx.NewCDPSession(p)
	if err != nil {
		return 0
	}
	defer func() { _ = cdp.Detach() }()
	raw, err := cdp.Send("Target.getTargetInfo", nil)
	if err != nil {
		return 0
	}
	if m, ok := raw.(map[string]any); ok {
		if info, ok := m["targetInfo"].(map[string]any); ok {
			id, _ := info["targetId"].(string)
			return chromeBridge.tabForTarget(id)
		}
	}
	return 0
}

// cdpTrace anota los eventos de depuración de navegación y de targets en el archivo de JARVIS_CDP_LOG (apagado si
// está vacía): para ver qué llega por el puente cuando algo no se entera (una navegación a otro dominio).
var cdpTraceMu sync.Mutex

func cdpTrace(tab int, session, method string, params json.RawMessage) {
	path := os.Getenv("JARVIS_CDP_LOG")
	if path == "" || !(strings.HasPrefix(method, "Page.frame") || strings.HasPrefix(method, "Page.navigated") || strings.HasPrefix(method, "Target.") ||
		strings.HasPrefix(method, "Runtime.executionContext") || strings.HasPrefix(method, "Inspector.") || method == "Page.lifecycleEvent") {
		return
	}
	cdpTraceMu.Lock()
	defer cdpTraceMu.Unlock()
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return
	}
	defer f.Close()
	p := string(params)
	if len(p) > 300 {
		p = p[:300] + "…"
	}
	fmt.Fprintf(f, "%s tab=%d session=%q %s %s\n", time.Now().Format("15:04:05.000"), tab, session, method, p)
}

func logf(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "jarvis: "+format+"\n", args...)
}
