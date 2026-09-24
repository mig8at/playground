package figma

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"

	"creditop/playground/connectors/internal/repocheck"
)

// La URL que se copia de Figma trae el nodo con guion y la API lo quiere con dos puntos: si esto se
// rompe, todo pedido de un nodo da 404 y se lee como «el nodo no existe».
func TestParseRefReadsTheURLFigmaGives(t *testing.T) {
	cases := map[string]Ref{
		"https://www.figma.com/design/AbCdEf1234567/Onboarding?node-id=12-345&t=x": {FileKey: "AbCdEf1234567", NodeID: "12:345"},
		"https://www.figma.com/file/AbCdEf1234567/Viejo":                           {FileKey: "AbCdEf1234567"},
		"https://www.figma.com/design/AbCdEf1234567/branch/BrAnCh9876543/X":        {FileKey: "BrAnCh9876543"},
		"AbCdEf1234567": {FileKey: "AbCdEf1234567"},
	}
	for in, want := range cases {
		got, err := ParseRef(in)
		if err != nil || got != want {
			t.Errorf("ParseRef(%q) = %+v, %v; quería %+v", in, got, err, want)
		}
	}
	if _, err := ParseRef("https://example.com/algo"); err == nil {
		t.Error("una URL que no es de Figma tiene que rechazarse")
	}
}

func fake(t *testing.T, handler http.HandlerFunc) *Client {
	t.Helper()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	c := New("tok-secreto")
	c.base = srv.URL
	return c
}

// El árbol se recorta y DICE cuánto recortó: un nodo sin hijos a la vista y uno recortado no son lo
// mismo, y confundirlos hace creer que un frame está vacío.
func TestNodesTrimsAndSaysWhatItCut(t *testing.T) {
	var gotToken, gotIDs string
	c := fake(t, func(w http.ResponseWriter, r *http.Request) {
		gotToken, gotIDs = r.Header.Get("X-Figma-Token"), r.URL.Query().Get("ids")
		if d := r.URL.Query().Get("depth"); d != "2" {
			t.Errorf("con depth 1 se piden 2 niveles a Figma (uno para contar lo recortado); pidió %q", d)
		}
		w.Write([]byte(`{"nodes":{"1:2":{"document":{"id":"1:2","name":"Pantalla","type":"FRAME",
			"absoluteBoundingBox":{"width":375,"height":812},
			"children":[{"id":"1:3","name":"Título","type":"TEXT","characters":"Pedí tu crédito"},
			            {"id":"1:4","name":"Botón","type":"INSTANCE","children":[{"id":"1:5","name":"label","type":"TEXT","characters":"Continuar"}]}]}}}}`))
	})
	got, err := c.Nodes(context.Background(), "KEY1234567890", []string{"1:2"}, 1)
	if err != nil {
		t.Fatal(err)
	}
	n := got["1:2"]
	if n.Width != 375 || len(n.Children) != 2 || n.Children[0].Characters != "Pedí tu crédito" {
		t.Errorf("nodo: %+v", n)
	}
	if n.Children[1].Cut != 1 || len(n.Children[1].Children) != 0 {
		t.Errorf("el botón tenía que quedar recortado con 1 hijo afuera: %+v", n.Children[1])
	}
	if gotToken != "tok-secreto" || gotIDs != "1:2" {
		t.Errorf("pedido: token %q ids %q", gotToken, gotIDs)
	}
	if _, err := c.Nodes(context.Background(), "KEY1234567890", []string{"9:9"}, 1); err == nil {
		t.Error("un nodo que no vino tiene que ser un error, no un árbol vacío")
	}
}

// El error dice lo que dijo Figma y nunca el token: termina en una pantalla o en un log.
func TestErrorsSayWhatFigmaSaidWithoutTheToken(t *testing.T) {
	c := fake(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(403)
		w.Write([]byte(`{"status":403,"err":"Invalid token"}`))
	})
	_, err := c.Me(context.Background())
	var fe *Error
	if !errors.As(err, &fe) || fe.Status != 403 || !strings.Contains(err.Error(), "Invalid token") {
		t.Fatalf("error: %v", err)
	}
	if strings.Contains(err.Error(), "tok-secreto") {
		t.Errorf("el error filtró el token: %v", err)
	}
}

// Una exportación que Figma no pudo renderizar vuelve en null: se reporta vacía, no se inventa.
func TestImagesKeepsTheNodesFigmaCouldNotRender(t *testing.T) {
	c := fake(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("format") != "svg" || r.URL.Query().Get("scale") != "2" {
			t.Errorf("query: %s", r.URL.RawQuery)
		}
		w.Write([]byte(`{"err":null,"images":{"1:2":"https://s3/x.svg","1:9":null}}`))
	})
	got, err := c.Images(context.Background(), "KEY1234567890", []string{"1:2", "1:9"}, "svg", 2)
	if err != nil {
		t.Fatal(err)
	}
	if got["1:2"] != "https://s3/x.svg" || got["1:9"] != "" || len(got) != 2 {
		t.Errorf("images: %v", got)
	}
	if _, err := c.Images(context.Background(), "K", []string{"1:2"}, "gif", 0); err == nil {
		t.Error("un formato que Figma no exporta tiene que rechazarse antes de pedir")
	}
}

// Figma se le habla desde acá y desde ningún otro lado: la regla «un cliente por servicio».
func TestNoOtherFigmaClientInTheRepo(t *testing.T) {
	if offenders := repocheck.Offenders(t, regexp.MustCompile(`api\.figma\.com`), nil); len(offenders) > 0 {
		t.Errorf("hay clientes de Figma fuera de connectors/ (usá connectors/figma): %v", offenders)
	}
}

// Lo que se colapsa tiene que ser SÓLO dibujo: un texto adentro, o un hijo sin ver, lo deja a la vista.
func TestDrawingCollapsesOnlyWhatSaysNothing(t *testing.T) {
	icon := Node{Type: "GROUP", Children: []Node{{Type: "VECTOR"}, {Type: "BOOLEAN_OPERATION", Children: []Node{{Type: "VECTOR"}, {Type: "ELLIPSE"}}}}}
	if n, ok := Drawing(icon); !ok || n != 3 {
		t.Errorf("un ícono de 3 trazos: %d, %v", n, ok)
	}
	withText := Node{Type: "FRAME", Children: []Node{{Type: "VECTOR"}, {Type: "TEXT", Characters: "Continuar"}}}
	if _, ok := Drawing(withText); ok {
		t.Error("un frame con texto no es dibujo")
	}
	if _, ok := Drawing(Node{Type: "GROUP", Cut: 4}); ok {
		t.Error("un nodo recortado no se vio entero: no se puede afirmar que sea dibujo")
	}
	if _, ok := Drawing(Node{Type: "FRAME"}); ok {
		t.Error("un frame vacío no es un trazo")
	}
	texts := Texts(Node{Children: []Node{{Characters: "Pago exitoso"}, {Children: []Node{{Characters: "Elegir fecha"}}}}})
	if len(texts) != 2 || texts[1].Characters != "Elegir fecha" {
		t.Errorf("textos en orden: %+v", texts)
	}
}

// Un 429 se espera y se reintenta; si Figma pide esperar demasiado, el error sube con el motivo.
func TestRateLimitWaitsAndRetries(t *testing.T) {
	calls := 0
	c := fake(t, func(w http.ResponseWriter, r *http.Request) {
		calls++
		if calls == 1 {
			w.Header().Set("Retry-After", "0")
			w.WriteHeader(429)
			return
		}
		w.Write([]byte(`{"id":"1","handle":"miguel","email":"m@x"}`))
	})
	u, err := c.Me(context.Background())
	if err != nil || u.Handle != "miguel" || calls != 2 {
		t.Fatalf("tenía que reintentar una vez y responder: %+v %v (%d pedidos)", u, err, calls)
	}
	slow := fake(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Retry-After", "3600")
		w.WriteHeader(429)
	})
	var fe *Error
	if _, err := slow.Me(context.Background()); !errors.As(err, &fe) || fe.Status != 429 {
		t.Errorf("una espera de una hora no se hace: sube como error 429; dio %v", err)
	}
}
