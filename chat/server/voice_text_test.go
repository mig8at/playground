package main

import (
	"encoding/json"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"creditop/playground/chat/cli"
)

// TestVoiceTextParity: la sincronización (Go) y la videollamada (JS, chat/src/voiceText.js) tienen que partir cada
// mensaje en las mismas frases; si no, la llamada no encuentra lo sincronizado y lo vuelve a pagar. Corre la versión de
// JS con node sobre estos mensajes y compara. Sin node la prueba FALLA (no se salta: un salto se lee como verde).
func TestVoiceTextParity(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Fatalf("hace falta node para comparar con chat/src/voiceText.js: %v", err)
	}
	long := strings.Repeat("palabra ", 160)
	many := strings.Repeat("Desarrollamos funcionalidades extraordinariamente complicadas e interconectadas hoy. ", 12)
	messages := []cli.Message{
		{Text: "Listo @miguel, cerré la prueba de la tienda en qa: pasó todo."},
		{Text: "@miguel/luigi, te paso las notas de hoy.", Files: []cli.File{{Name: "notas.md", Type: "application/octet-stream"}}},
		{Text: "", Files: []cli.File{{Name: "foto.png", Type: "image/png"}, {Name: "b.JPG"}}},
		{Text: "", Files: []cli.File{{Name: "a.pdf"}, {Name: "c.png", Type: "image/png"}}},
		{Text: "", Files: []cli.File{{Name: "a.pdf"}, {Name: "b.csv"}}},
		{Text: "# Título\nHola @todos.\n| a | b |\n- primer punto\n- segundo punto!\n1) tercero\n```go\nx := 1\n```\nY mirá https://www.example.com/x?y=1 y `make chat`."},
		{Text: "**Ojo**: esto es *importante* y _urgente_, gracias @duncan.estrada."},
		{Text: "¿Cómo así? ¡Uy, se cayó! jajaja… ok"},
		{Text: "🔑 Pido tu llavero"},
		{Text: "🔑 Mi llavero (3)\n• A"},
		{Text: "🔒 Llavero · 2 claves\nA=U2FsdGVkX1abc"},
		{Text: long},
		{Text: many},
		{Text: "```\nsólo código\n```"},
		{Text: "Hola Wario, mirá esto 🎉 y @kira."},
		{Text: "   "},
		{Text: "Gracias @miguel/leo. Y @Miguel/Luigi-, ¿ya?"},
	}
	names := map[string]string{"miguel": "Miguel", "miguel/luigi": "Luigi", "miguel/leo": "Leo", "duncan.estrada": "Duncan"}

	var goOut [][]string
	for _, m := range messages {
		lines := callLines(m, names, 150)
		if lines == nil {
			lines = []string{}
		}
		goOut = append(goOut, lines)
	}

	input, _ := json.Marshal(map[string]any{"messages": messages, "names": names})
	module, _ := filepath.Abs("../src/voiceText.js")
	script := `import { callLines } from ` + jsonString("file://"+module) + `
let raw = ''; process.stdin.on('data', (d) => { raw += d }); process.stdin.on('end', () => {
  const { messages, names } = JSON.parse(raw)
  process.stdout.write(JSON.stringify(messages.map((m) => callLines(m, names, 150))))
})`
	cmd := exec.Command(node, "--input-type=module", "-e", script)
	cmd.Stdin = strings.NewReader(string(input))
	out, err := cmd.Output()
	if err != nil {
		t.Fatalf("node: %v", err)
	}
	var jsOut [][]string
	if err := json.Unmarshal(out, &jsOut); err != nil {
		t.Fatalf("lo que devolvió node: %v (%s)", err, out)
	}
	for i := range messages {
		if !reflect.DeepEqual(goOut[i], jsOut[i]) {
			t.Errorf("mensaje %d %q\n  go: %q\n  js: %q", i, messages[i].Text, goOut[i], jsOut[i])
		}
	}
}

func jsonString(s string) string { b, _ := json.Marshal(s); return string(b) }
