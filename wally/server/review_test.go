package main

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// El revisor no ve la conversación del agente: sólo lo que pidió Miguel (sin las vueltas automáticas) y criterios.json.
// Lo que manda son sus listas, y si no contesta algo que se entienda, no frena.
func TestReviewerSeesOnlyRequestsAndCriteria(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, sandboxDir, "notas")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	os.WriteFile(filepath.Join(dir, "index.html"), []byte("<h1>Notas</h1>"), 0o644)
	os.WriteFile(filepath.Join(dir, "criterios.json"), []byte(`[{"nombre":"carga","pasos":[{"ver":"Notas"}]}]`), 0o644)
	a := &app{root: root}
	conv := Conversation{Messages: []Message{
		{Role: "user", Text: "Proyecto propina: una calculadora de propina"},
		{Role: "user", Text: "En notas: hacé una página que sume el total"},
		{Role: "model", Text: "SECRETO DEL AGENTE"},
		{Role: "user", Text: "Listo: corrí el comando (la salida va arriba). Seguí."},
		{Role: "user", Text: "Todavía no terminaste: escribiste en pruebas/notas…"},
		{Role: "user", Text: "Y que no acepte notas vacías"},
	}}
	var prompt string
	ask := func(_ context.Context, p string) (string, string, error) {
		prompt = p
		return "```json\n{\"ok\": true, \"faltan\": [\"el total\"], \"debiles\": [\"carga: busca el título\"]}\n```", "m", nil
	}
	v, err := a.reviewCriteria(context.Background(), conv, 3, "notas", ask)
	if err != nil {
		t.Fatal(err)
	}
	if v.OK || len(v.Faltan) != 1 || len(v.Debiles) != 1 {
		t.Errorf("un «ok» con huecos no es ok: %+v", v)
	}
	for _, want := range []string{"sume el total", "no acepte notas vacías", `"nombre":"carga"`, "una página web"} {
		if !strings.Contains(prompt, want) {
			t.Errorf("al revisor le falta %q", want)
		}
	}
	for _, not := range []string{"calculadora de propina", "SECRETO DEL AGENTE", "Listo: corrí", "escribiste en pruebas"} {
		if strings.Contains(prompt, not) {
			t.Errorf("el revisor vio %q", not)
		}
	}
	nudge := reviewNudge("notas", v)
	if !isRoundNote(nudge) || !strings.Contains(nudge, "el total") || !strings.Contains(nudge, "busca el título") {
		t.Errorf("el empujón: %s", nudge)
	}
	// Una respuesta que no es JSON, o un error: no frena.
	bad := func(context.Context, string) (string, string, error) { return "no sé", "m", nil }
	if v, err := a.reviewCriteria(context.Background(), conv, 3, "notas", bad); !v.OK || err == nil {
		t.Errorf("sin JSON: %+v %v", v, err)
	}
	// Sin criterios.json no hay nada que revisar.
	if v, _ := a.reviewCriteria(context.Background(), conv, 3, "otro", ask); !v.OK {
		t.Errorf("sin criterios: %+v", v)
	}
}

// El proyecto que se revisa es el que escribió ESTA corrida, no uno de antes en la misma conversación.
func TestLastWrittenProjectIsThisRuns(t *testing.T) {
	msgs := []Message{
		{Role: "model", Commands: []Command{{Cmd: "escribir pruebas/viejo/index.html", Status: "corrido"}}},
		{Role: "user", Text: "otra cosa"},
		{Role: "model", Commands: []Command{
			{Cmd: "parchar pruebas/api/src/main.rs", Status: "corrido"},
			{Cmd: "escribir pruebas/roto/x", Status: "corrido", Exit: 1},
			{Cmd: "probar-api pruebas/api", Status: "corrido"},
		}},
	}
	if got := lastWrittenProject(msgs, 1); got != "api" {
		t.Errorf("esta corrida escribió api: %q", got)
	}
	if got := lastWrittenProject(msgs[:2], 1); got != "" {
		t.Errorf("esta corrida no escribió nada: %q", got)
	}
}
