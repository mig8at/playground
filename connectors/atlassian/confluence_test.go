package atlassian

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// Un 404 de la API v2 con el token vencido se leía como «ruta mal armada»: tres pasos hasta descubrir la
// causa. La sonda de Jira decide: con 401 es la credencial; con 200, el 404 es de verdad.
func TestA404IsBlamedOnTheCredentialOnlyWhenJiraSays401(t *testing.T) {
	for _, tc := range []struct {
		myself     int
		credential bool
	}{{401, true}, {200, false}} {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/rest/api/3/myself" {
				w.WriteHeader(tc.myself)
				fmt.Fprint(w, `{}`)
				return
			}
			w.WriteHeader(404)
			fmt.Fprint(w, `{"message":"not found"}`)
		}))
		_, err := New(srv.URL, "a@b.c", "t").Spaces(context.Background())
		srv.Close()
		var ce *CredentialError
		if got := errors.As(err, &ce); got != tc.credential {
			t.Errorf("myself=%d: ¿credencial? %v, quería %v (%v)", tc.myself, got, tc.credential, err)
		}
		if !tc.credential && !strings.Contains(fmt.Sprint(err), "HTTP 404 en /wiki/api/v2/spaces") {
			t.Errorf("sin culpa de la credencial, el error tiene que decir el 404 y la ruta: %v", err)
		}
	}
}

// Las páginas vienen de a 250 y el cursor viaja adentro de `_links.next`: si no se sigue, un espacio
// grande se ve entero y le faltan páginas.
func TestPagesFollowTheCursorInsideNext(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/wiki/api/v2/spaces":
			fmt.Fprint(w, `{"results":[{"id":77,"key":"K","name":"n"}]}`)
		case r.URL.Path == "/wiki/api/v2/spaces/77/pages" && r.URL.Query().Get("cursor") == "":
			fmt.Fprint(w, `{"results":[{"id":"1","title":"uno"}],"_links":{"next":"/wiki/api/v2/spaces/77/pages?cursor=abc&limit=250"}}`)
		case r.URL.Path == "/wiki/api/v2/spaces/77/pages" && r.URL.Query().Get("cursor") == "abc":
			fmt.Fprint(w, `{"results":[{"id":"2","title":"dos"}],"_links":{}}`)
		default:
			w.WriteHeader(500)
		}
	}))
	defer srv.Close()
	pages, err := New(srv.URL, "a@b.c", "t").Pages(context.Background(), "K")
	if err != nil || len(pages) != 2 || pages[1].Title != "dos" {
		t.Fatalf("Pages = %+v, %v; quería las dos tandas", pages, err)
	}
}

// El formato de almacenamiento a texto: comparado contra el de Python sobre las 211 páginas de
// Creditop el 2026-09-24. Esto fija las reglas que más valen: el código, los enlaces, las tablas y
// las entidades. La salida esperada es la que da el Python viejo con esta misma entrada.
func TestStorageToTextKeepsWhatMatters(t *testing.T) {
	in := `<h2>Reglas</h2><p>Cupo &gt; 0 &amp; plazo</p>` +
		`<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">sql</ac:parameter>` +
		`<ac:plain-text-body><![CDATA[SELECT 1]]></ac:plain-text-body></ac:structured-macro>` +
		`<ul><li>uno</li><li>dos</li></ul>` +
		`<table><tr><th>a</th><th>b</th></tr></table>` +
		`<ac:link><ri:page ri:content-title="Política de riesgo" /></ac:link>` +
		`<ac:structured-macro ac:name="toc" />`
	want := "## Reglas\nCupo > 0 & plazo\n\n```\nSELECT 1\n```\n\n- uno\n\n- dos\n\na | b |\n\n[[Política de riesgo]]«macro toc»"
	if got := StorageToText(in); got != want {
		t.Errorf("StorageToText:\n%q\nquería\n%q", got, want)
	}
}
