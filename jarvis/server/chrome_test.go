package main

import "testing"

func TestExtensionOrigin(t *testing.T) {
	t.Setenv("JARVIS_CHROME_EXT", "")
	for origin, want := range map[string]bool{
		"chrome-extension://klpcggojkofdhjplemgdaeibbbdmnhfb": true,
		"http://127.0.0.1:5202":                               false, // la interfaz del navegador no es la extensión
		"https://evil.example":                                false,
		"":                                                    false,
	} {
		if got := extensionOriginOK(origin); got != want {
			t.Errorf("extensionOriginOK(%q) = %v, quería %v", origin, got, want)
		}
	}
	// Con el id fijado, sólo esa extensión.
	t.Setenv("JARVIS_CHROME_EXT", "abc")
	if extensionOriginOK("chrome-extension://otra") || !extensionOriginOK("chrome-extension://abc") {
		t.Error("con JARVIS_CHROME_EXT sólo vale esa extensión")
	}
}

// Cada comando de Playwright tiene que ir a la pestaña correcta: la de su sesión, la dueña de una sesión hija
// (iframe de otro origen) llevando esa sesión, y la de un alias (la sesión del screencast) sin sesión.
func TestDebuggerTarget(t *testing.T) {
	me := &pwClient{id: 1}
	b := &ChromeBridge{
		attached: map[int]*chromeTab{
			7: {tabID: 7, sessionID: "pw-tab-1", targetInfo: map[string]any{"targetId": "T7"}, children: map[string]bool{"hija": true}, owner: me},
		},
		aliases: map[string]int{"pw-alias-2": 7},
	}
	cases := []struct {
		session string
		tab     int
		child   string
	}{
		{"pw-tab-1", 7, ""},
		{"hija", 7, "hija"},
		{"pw-alias-2", 7, ""},
		{"", 7, ""}, // del navegador entero: a cualquier pestaña enganchada
	}
	for _, c := range cases {
		got, err := b.debuggerTarget("X.y", c.session, me)
		if err != nil {
			t.Fatalf("sesión %q: %v", c.session, err)
		}
		if got["tabId"] != c.tab {
			t.Errorf("sesión %q fue a la pestaña %v, quería %d", c.session, got["tabId"], c.tab)
		}
		if sid, _ := got["sessionId"].(string); sid != c.child {
			t.Errorf("sesión %q llevó sessionId %q, quería %q", c.session, sid, c.child)
		}
	}
	if _, err := b.debuggerTarget("X.y", "desconocida", me); err == nil {
		t.Error("una sesión que nadie tiene tiene que dar error, no ir a cualquier pestaña")
	}
	if _, err := (&ChromeBridge{attached: map[int]*chromeTab{}}).debuggerTarget("X.y", "", me); err == nil {
		t.Error("sin pestañas enganchadas, un comando del navegador entero tiene que dar error")
	}
}

func TestAliasFor(t *testing.T) {
	me := &pwClient{id: 1}
	b := &ChromeBridge{
		attached: map[int]*chromeTab{7: {tabID: 7, sessionID: "pw-tab-1", targetInfo: map[string]any{"targetId": "T7"}, owner: me}},
		aliases:  map[string]int{},
	}
	res, err := b.aliasFor("T7", me)
	if err != nil {
		t.Fatal(err)
	}
	alias, _ := res["sessionId"].(string)
	if b.aliases[alias] != 7 {
		t.Errorf("el alias %q no apunta a la pestaña 7", alias)
	}
	if _, err := b.aliasFor("otro", me); err == nil {
		t.Error("un target que no está enganchado tiene que dar error")
	}
}

// Varios clientes de Playwright a la vez (Jarvis y el harness): cada uno llega sólo a SUS pestañas. Un comando del
// otro —por sesión, por alias o del navegador entero— no puede caer en una pestaña ajena, y pedir un alias de un
// target ajeno falla. Antes había un solo cliente y el segundo se rechazaba.
func TestClientsOnlyReachTheirOwnTabs(t *testing.T) {
	jarvis := &pwClient{id: 1, self: true, autoAttach: true}
	harness := &pwClient{id: 2, autoAttach: true}
	b := &ChromeBridge{
		clients: map[int]*pwClient{1: jarvis, 2: harness},
		attached: map[int]*chromeTab{
			7: {tabID: 7, sessionID: "pw-tab-1", targetInfo: map[string]any{"targetId": "T7"}, children: map[string]bool{"hija": true}, owner: jarvis},
			9: {tabID: 9, sessionID: "pw-tab-2", targetInfo: map[string]any{"targetId": "T9"}, children: map[string]bool{}, owner: harness},
		},
		aliases: map[string]int{"pw-alias-3": 7},
	}
	for _, s := range []string{"pw-tab-1", "hija", "pw-alias-3"} {
		if _, err := b.debuggerTarget("X.y", s, harness); err == nil {
			t.Errorf("el harness llegó a la sesión %q, que es de Jarvis", s)
		}
	}
	if got, err := b.debuggerTarget("X.y", "", harness); err != nil || got["tabId"] != 9 {
		t.Errorf("un comando del navegador entero del harness tiene que ir a SU pestaña (9), fue a %v (%v)", got, err)
	}
	if got, err := b.debuggerTarget("X.y", "", jarvis); err != nil || got["tabId"] != 7 {
		t.Errorf("y el de Jarvis a la suya (7), fue a %v (%v)", got, err)
	}
	if _, err := b.aliasFor("T7", harness); err == nil {
		t.Error("el harness no puede pedir un alias de una pestaña de Jarvis")
	}
	if _, err := b.attachTab(7, harness); err == nil {
		t.Error("enganchar una pestaña que ya maneja otro cliente tiene que fallar, no robársela")
	}
	b.mu.Lock()
	if got := b.autoAttachClient(); got != jarvis {
		t.Errorf("una pestaña compartida nueva le toca a Jarvis (el propio servidor), le tocó a %v", got)
	}
	b.mu.Unlock()
}

// Lo que avisa la extensión (`user.view`) dice qué pestaña tiene delante la persona: sólo cuenta si Chrome tiene el
// foco. Si está en otra app, no está mirando ninguna.
func TestUserView(t *testing.T) {
	b := &ChromeBridge{}
	b.setView([]byte(`{"tabId":7,"windowId":1,"focused":true}`))
	if !b.looking(7) || b.looking(8) || b.looking(0) {
		t.Fatal("con Chrome con foco, mira la 7 y sólo la 7")
	}
	b.setView([]byte(`{"tabId":7,"windowId":1,"focused":false}`))
	if b.looking(7) {
		t.Fatal("con Chrome sin foco (otra app delante), no está mirando ninguna pestaña")
	}
}
