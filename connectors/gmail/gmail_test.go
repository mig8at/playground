package gmail

import (
	"encoding/base64"
	"strings"
	"testing"
)

func b64(s string) string { return base64.URLEncoding.EncodeToString([]byte(s)) }

func TestParseTakesHeadersDateAndThePlainTextBody(t *testing.T) {
	r := rawMessage{ID: "m1", ThreadID: "t1", Snippet: "Hi &amp; bye", InternalDate: "1794595059000"}
	r.Payload.MimeType = "multipart/alternative"
	r.Payload.Headers = append(r.Payload.Headers,
		struct {
			Name  string `json:"name"`
			Value string `json:"value"`
		}{"From", "Patrick Elder (Shopify) <support@shopify.com>"},
		struct {
			Name  string `json:"name"`
			Value string `json:"value"`
		}{"Subject", "[Shopify] Update"})
	plain := part{MimeType: "text/plain"}
	plain.Body.Data = b64("Ticket 72090155")
	htm := part{MimeType: "text/html"}
	htm.Body.Data = b64("<p>no</p>")
	r.Payload.Parts = []part{htm, plain}

	m := parse(r, true)
	if m.From != "Patrick Elder (Shopify) <support@shopify.com>" || m.Subject != "[Shopify] Update" {
		t.Fatalf("encabezados: %+v", m)
	}
	if m.Snippet != "Hi & bye" {
		t.Errorf("el snippet viene con entidades HTML: %q", m.Snippet)
	}
	if m.Body != "Ticket 72090155" {
		t.Errorf("el cuerpo es el text/plain: %q", m.Body)
	}
	if m.Date.UnixMilli() != 1794595059000 {
		t.Errorf("la fecha sale de internalDate: %v", m.Date)
	}
	if parse(r, false).Body != "" {
		t.Error("sin pedir el cuerpo no se decodifica")
	}
}

func TestHTMLOnlyMailBecomesReadableText(t *testing.T) {
	got := htmlToText("<html><head><style>p{}</style></head><body><p>Hola&nbsp;Juan</p><div>Línea 2</div><script>x()</script></body></html>")
	if strings.Contains(got, "<") || strings.Contains(got, "x()") || strings.Contains(got, "p{}") {
		t.Fatalf("quedaron etiquetas o scripts: %q", got)
	}
	if !strings.Contains(got, "Hola Juan") || !strings.Contains(got, "Línea 2") {
		t.Fatalf("se perdió el texto: %q", got)
	}
}
