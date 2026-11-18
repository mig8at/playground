package claude

import (
	"strings"
	"testing"
)

// El stream de Anthropic se junta en texto; un corte por tokens con texto dice por qué; un error del stream es error.
func TestReadStream(t *testing.T) {
	ok := "event: message_start\ndata: {\"type\":\"message_start\"}\n\n" +
		"data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"Hola, \"}}\n\n" +
		"data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"thinking_delta\",\"thinking\":\"x\"}}\n\n" +
		"data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"Miguel\"}}\n\n" +
		"data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"}}\n\n"
	if got, err := ReadStream(strings.NewReader(ok)); err != nil || got.Text != "Hola, Miguel" || got.StopReason != "end_turn" {
		t.Fatalf("texto: %q, %v", got, err)
	}
	cut := "data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"largo\"}}\n" +
		"data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"max_tokens\"}}\n"
	if got, err := ReadStream(strings.NewReader(cut)); err != nil || got.Text != "largo" || got.StopReason != "max_tokens" {
		t.Fatalf("corte por tokens: %q, %v", got, err)
	}
	bad := "data: {\"type\":\"error\",\"error\":{\"type\":\"overloaded_error\",\"message\":\"Overloaded\"}}\n"
	if _, err := ReadStream(strings.NewReader(bad)); err == nil || !strings.Contains(err.Error(), "Overloaded") {
		t.Fatalf("el error del stream tenía que salir: %v", err)
	}
	if _, err := ReadStream(strings.NewReader("")); err == nil {
		t.Fatal("sin texto tenía que ser error")
	}
}
