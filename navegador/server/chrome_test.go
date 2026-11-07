package main

import "testing"

func TestExtensionOrigin(t *testing.T) {
	t.Setenv("NAVEGADOR_CHROME_EXT", "")
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
	t.Setenv("NAVEGADOR_CHROME_EXT", "abc")
	if extensionOriginOK("chrome-extension://otra") || !extensionOriginOK("chrome-extension://abc") {
		t.Error("con NAVEGADOR_CHROME_EXT sólo vale esa extensión")
	}
}

// Cada comando de Playwright tiene que ir a la pestaña correcta: la de su sesión, la dueña de una sesión hija
// (iframe de otro origen) llevando esa sesión, y la de un alias (la sesión del screencast) sin sesión.
func TestDebuggerTarget(t *testing.T) {
	b := &ChromeBridge{
		attached: map[int]*chromeTab{
			7: {tabID: 7, sessionID: "pw-tab-1", targetInfo: map[string]any{"targetId": "T7"}, children: map[string]bool{"hija": true}},
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
		got, err := b.debuggerTarget("X.y", c.session)
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
	if _, err := b.debuggerTarget("X.y", "desconocida"); err == nil {
		t.Error("una sesión que nadie tiene tiene que dar error, no ir a cualquier pestaña")
	}
	if _, err := (&ChromeBridge{attached: map[int]*chromeTab{}}).debuggerTarget("X.y", ""); err == nil {
		t.Error("sin pestañas enganchadas, un comando del navegador entero tiene que dar error")
	}
}

func TestAliasFor(t *testing.T) {
	b := &ChromeBridge{
		attached: map[int]*chromeTab{7: {tabID: 7, sessionID: "pw-tab-1", targetInfo: map[string]any{"targetId": "T7"}}},
		aliases:  map[string]int{},
	}
	res, err := b.aliasFor("T7")
	if err != nil {
		t.Fatal(err)
	}
	alias, _ := res["sessionId"].(string)
	if b.aliases[alias] != 7 {
		t.Errorf("el alias %q no apunta a la pestaña 7", alias)
	}
	if _, err := b.aliasFor("otro"); err == nil {
		t.Error("un target que no está enganchado tiene que dar error")
	}
}
