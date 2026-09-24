package gemini

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// fake contesta como la API: la primera vuelta pide una herramienta, la segunda contesta texto.
func fake(t *testing.T, replies ...string) (*Client, *[]map[string]any) {
	t.Helper()
	var bodies []map[string]any
	i := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-goog-api-key") != "k" || strings.Contains(r.URL.RawQuery, "key=") {
			t.Errorf("la llave tiene que ir en la cabecera y nunca en la URL: %s", r.URL)
		}
		var b map[string]any
		_ = json.NewDecoder(r.Body).Decode(&b)
		bodies = append(bodies, b)
		if i >= len(replies) {
			t.Fatal("más llamadas de las esperadas")
		}
		_, _ = w.Write([]byte(replies[i]))
		i++
	}))
	t.Cleanup(server.Close)
	old := API
	API = server.URL
	t.Cleanup(func() { API = old })
	return New(Config{Key: "k", Model: "m", MaxSteps: 4}), &bodies
}

const callTool = `{"candidates":[{"content":{"parts":[{"functionCall":{"name":"sumar","args":{"a":2,"b":3}}}]}}]}`
const sayText = `{"candidates":[{"content":{"parts":[{"text":"da 5"}]}}]}`

// El bucle: el modelo pide la herramienta, el CÓDIGO la corre y le devuelve el resultado, y el modelo
// contesta. El modelo nunca ejecuta nada.
func TestTheLoopRunsTheToolAndReturnsTheAnswer(t *testing.T) {
	cl, bodies := fake(t, callTool, sayText)
	ran := false
	tools := map[string]Tool{"sumar": {
		Declaration: map[string]any{"name": "sumar"},
		Run: func(args map[string]any) (any, error) {
			ran = true
			return args["a"].(float64) + args["b"].(float64), nil
		},
	}}
	out, err := cl.Ask("¿2+3?", "sé breve", tools, nil)
	if err != nil || out != "da 5" || !ran {
		t.Fatalf("out=%v err=%v ran=%v", out, err, ran)
	}
	second, _ := json.Marshal((*bodies)[1]["contents"])
	if !strings.Contains(string(second), `"functionResponse"`) || !strings.Contains(string(second), `"resultado":5`) {
		t.Errorf("la segunda vuelta no le devolvió el resultado al modelo: %s", second)
	}
	if (*bodies)[0]["system_instruction"] == nil {
		t.Error("las instrucciones no viajaron")
	}
}

// Una herramienta terminal entrega su resultado como respuesta, estructurado, sin otra vuelta.
func TestATerminalToolEndsTheLoop(t *testing.T) {
	cl, _ := fake(t, callTool)
	out, err := cl.Ask("x", "", map[string]Tool{"sumar": {
		Declaration: map[string]any{"name": "sumar"}, Terminal: true,
		Run: func(map[string]any) (any, error) { return map[string]int{"total": 5}, nil },
	}}, nil)
	if err != nil || out.(map[string]int)["total"] != 5 {
		t.Fatalf("out=%v err=%v", out, err)
	}
}

// El error de una herramienta vuelve al modelo en vez de reventar el bucle, para que corrija y reintente.
func TestAToolErrorGoesBackToTheModel(t *testing.T) {
	cl, bodies := fake(t, callTool, sayText)
	_, err := cl.Ask("x", "", map[string]Tool{"sumar": {
		Declaration: map[string]any{"name": "sumar"},
		Run:         func(map[string]any) (any, error) { return nil, errors.New("b no puede ser 3") },
	}}, nil)
	second, _ := json.Marshal((*bodies)[1]["contents"])
	if err != nil || !strings.Contains(string(second), "b no puede ser 3") {
		t.Errorf("err=%v, segunda vuelta %s", err, second)
	}
}

func TestErrorsSayWhatToDo(t *testing.T) {
	if err := explain(404, []byte(`{"error":{"message":"models/x is not found"}}`)); !strings.Contains(err.Error(), "gemini models") {
		t.Errorf("404: %v", err)
	}
	if err := explain(400, []byte(`{"error":{"message":"API key not valid"}}`)); !strings.Contains(err.Error(), "la API key no sirve") {
		t.Errorf("400: %v", err)
	}
}

func TestModelsKeepsOnlyTheOnesThatGenerate(t *testing.T) {
	cl, _ := fake(t, `{"models":[{"name":"models/b","supportedGenerationMethods":["generateContent"]},{"name":"models/emb","supportedGenerationMethods":["embedContent"]},{"name":"models/a","supportedGenerationMethods":["generateContent"]}]}`)
	ms, err := cl.Models()
	if err != nil || len(ms) != 2 || ms[0].Name != "a" || ms[1].Name != "b" {
		t.Errorf("models=%v err=%v", ms, err)
	}
}
