package main

import (
	"context"
	"fmt"
	"net/url"
	"strings"
	"syscall"
	"testing"
	"time"
)

// Un tope vencido con el servidor vivo NO se reporta como «la API está caída»: lleva a relanzarla o a repetir una
// acción que sigue corriendo. Sólo el rechazo de la conexión pregunta por `make jarvis` a secas.
func TestTransportError(t *testing.T) {
	refused := &url.Error{Op: "Post", URL: api, Err: fmt.Errorf("dial tcp: %w", syscall.ECONNREFUSED)}
	if msg := transportError(refused, time.Second).Error(); !strings.Contains(msg, "la API no contesta") {
		t.Errorf("conexión rechazada: %q", msg)
	}
	timeout := &url.Error{Op: "Post", URL: api, Err: context.DeadlineExceeded}
	msg := transportError(timeout, 120*time.Second).Error()
	if strings.Contains(msg, "la API no contesta") || !strings.Contains(msg, "bin/jarvis steps") || !strings.Contains(msg, "120 s") {
		t.Errorf("tope vencido: %q", msg)
	}
}

func TestSuggest(t *testing.T) {
	for in, want := range map[string]string{"clic": "click", "clicks": "click", "scrol": "scroll", "zzz": "", "c": ""} {
		if got := strings.Join(suggest(in), ","); got != want {
			t.Errorf("suggest(%q) = %q, quería %q", in, got, want)
		}
	}
}
