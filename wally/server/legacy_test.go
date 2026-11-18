package main

import "testing"

// Lo que pidió un modelo con los nombres de antes sigue pasando, ya traducido; y lo guardado se migra al cargar.
func TestLegacyNamesStillWork(t *testing.T) {
	cases := map[string]string{
		"probar pruebas/cuota":                        "check sandbox/cuota",
		"parchar pruebas/cuota/index.html":            "patch sandbox/cuota/index.html",
		"probar-api pruebas/api":                      "check-api sandbox/api",
		"consola pruebas/api con-api curl -s /tareas": "console sandbox/api with-api curl -s /tareas",
		"listar pruebas":                              "list sandbox",
		"ayuda pruebas":                               "help sandbox",
		"guia conectores":                             "guide connectors",
		"trampa F-162":                                "trap F-162",
		"check sandbox/x":                             "check sandbox/x",
	}
	for old, want := range cases {
		if got := normalizeCommand(old); got != want {
			t.Errorf("%q → %q, quería %q", old, got, want)
		}
		if _, err := commandArgs(old); err != nil {
			t.Errorf("%q no pasa la lista: %v", old, err)
		}
	}
	got := parseCommands("```comando\nprobar pruebas/x\n```\n```archivo pruebas/x/a.txt\nhola\n```")
	if len(got) != 2 || got[0].Cmd != "write sandbox/x/a.txt" || got[1].Cmd != "check sandbox/x" || got[1].Status != "proposed" {
		t.Errorf("bloques de antes: %+v", got)
	}
	c := &Conversation{Mode: "asistente", Agent: &Agent{Skills: []string{"pruebas", "rust"}}, Messages: []Message{
		{Role: "model", Commands: []Command{{Cmd: "escribir pruebas/x/a.txt", Status: "corrido"}, {Cmd: "ayuda", Status: "no-permitido"}}},
	}}
	if !migrateConversation(c) || c.Mode != "assistant" || c.Agent.Skills[0] != "sandbox" ||
		c.Messages[0].Commands[0].Cmd != "write sandbox/x/a.txt" || c.Messages[0].Commands[0].Status != "ran" ||
		c.Messages[0].Commands[1].Status != "not-allowed" {
		t.Errorf("migrada: %+v %+v", c, c.Messages[0].Commands)
	}
	if migrateConversation(c) {
		t.Error("migrar dos veces no tiene que cambiar nada")
	}
}

// Un parche con los marcadores de antes (BUSCAR / REEMPLAZAR) se aplica igual.
func TestLegacyPatchMarkers(t *testing.T) {
	h := patchHunk.FindAllStringSubmatch("<<<<<<< BUSCAR\nviejo\n=======\nnuevo\n>>>>>>> REEMPLAZAR", -1)
	if len(h) != 1 || h[0][1] != "viejo" || h[0][2] != "nuevo" {
		t.Errorf("marcadores de antes: %q", h)
	}
}
