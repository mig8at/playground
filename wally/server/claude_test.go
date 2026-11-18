package main

import (
	"strings"
	"testing"
)

// El stream de Anthropic se junta en texto; un corte por tokens con texto avisa al final; un error del stream es error.
func TestReadClaudeStream(t *testing.T) {
	ok := "event: message_start\ndata: {\"type\":\"message_start\"}\n\n" +
		"data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"Hola, \"}}\n\n" +
		"data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"thinking_delta\",\"thinking\":\"x\"}}\n\n" +
		"data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"Miguel\"}}\n\n" +
		"data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"}}\n\n"
	if got, err := readClaudeStream(strings.NewReader(ok)); err != nil || got != "Hola, Miguel" {
		t.Fatalf("texto: %q, %v", got, err)
	}
	cut := "data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"largo\"}}\n" +
		"data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"max_tokens\"}}\n"
	if got, err := readClaudeStream(strings.NewReader(cut)); err != nil || !strings.Contains(got, "se cortó") {
		t.Fatalf("corte por tokens: %q, %v", got, err)
	}
	bad := "data: {\"type\":\"error\",\"error\":{\"type\":\"overloaded_error\",\"message\":\"Overloaded\"}}\n"
	if _, err := readClaudeStream(strings.NewReader(bad)); err == nil || !strings.Contains(err.Error(), "Overloaded") {
		t.Fatalf("el error del stream tenía que salir: %v", err)
	}
	if _, err := readClaudeStream(strings.NewReader("")); err == nil {
		t.Fatal("sin texto tenía que ser error")
	}
}
