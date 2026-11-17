package main

import "testing"

// Con DeepSeek elegido, un chat va por DeepSeek; un agente o el asistente siguen por AI Studio salvo que se permita.
func TestProviderFor(t *testing.T) {
	ds := Config{Provider: "deepseek"}
	cases := []struct {
		cfg   Config
		mode  string
		agent bool
		want  string
	}{
		{ds, "", false, "deepseek"},
		{ds, "asistente", false, "aistudio"},
		{ds, "asistente", true, "aistudio"},
		{Config{Provider: "deepseek", AgentsOther: true}, "asistente", true, "deepseek"},
		{Config{Provider: "aistudio"}, "", false, "aistudio"},
		{Config{Provider: "chatgpt"}, "", false, "chatgpt"},
		{Config{Provider: "chatgpt"}, "asistente", true, "aistudio"},
		{Config{Provider: "groq"}, "", false, "groq"},
		{Config{Provider: "groq"}, "asistente", true, "aistudio"},
	}
	for _, c := range cases {
		if got := c.cfg.providerFor(c.mode, c.agent); got != c.want {
			t.Errorf("%+v modo=%q agente=%v: %s, quería %s", c.cfg, c.mode, c.agent, got, c.want)
		}
	}
	if v := (Config{Provider: "deepseek", AgentsDeepSeek: true}).valid(); !v.AgentsOther || v.AgentsDeepSeek {
		t.Errorf("el permiso viejo no pasó a AgentsOther: %+v", v)
	}
	if v := (Config{Provider: "otro", Thinking: "Max", Window: "x"}).valid(); v.Provider != "aistudio" || v.Thinking != "High" || v.Window != "minimized" {
		t.Errorf("valid no volvió a lo de siempre: %+v", v)
	}
}

// El proveedor elegido en un agente gana; sin elegir, manda la configuración (y el permiso general de agentes).
func TestProviderForAgent(t *testing.T) {
	cfg := Config{Provider: "deepseek"}
	if got := cfg.providerForAgent("asistente", &Agent{}); got != "aistudio" {
		t.Errorf("sin elegir y sin permiso: %s, quería aistudio", got)
	}
	if got := cfg.providerForAgent("asistente", &Agent{Provider: "chatgpt"}); got != "chatgpt" {
		t.Errorf("elegido en el agente: %s, quería chatgpt", got)
	}
	if got := cfg.providerForAgent("asistente", &Agent{Provider: "otro"}); got != "aistudio" {
		t.Errorf("uno que no existe vuelve a la regla: %s", got)
	}
	if got := cfg.providerForAgent("", nil); got != "deepseek" {
		t.Errorf("un chat: %s, quería deepseek", got)
	}
}
