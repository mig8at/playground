package twilio

import (
	"context"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"

	"creditop/playground/connectors/internal/repocheck"
)

// El 401 de Twilio nombra el permiso que falta, y es lo único que hace útil un inventario: si Why lo
// pierde, la salida vuelve a ser «no autorizado» y hay que adivinar qué marcar en la consola.
func TestWhyNamesTheMissingPermission(t *testing.T) {
	body := map[string]any{"message": "Authorization failed: required permission twilio/messaging/content-templates/list is missing"}
	if got := Why(401, body); got != "FALTA  twilio/messaging/content-templates/list" {
		t.Errorf("Why = %q", got)
	}
	if got := Why(200, map[string]any{"contents": []any{1, 2}}); got != "2 items" {
		t.Errorf("una lista se resume por su largo; dio %q", got)
	}
	if got := Why(404, map[string]any{"message": "not found"}); got != "not found" {
		t.Errorf("otro error dice su mensaje; dio %q", got)
	}
}

// Una credencial viaja en cada pedido: fuera de un host de Twilio, el GET no sale.
func TestGetOnlyGoesToTwilio(t *testing.T) {
	c := newClient(basic("AC1", "secreto"))
	// ⚠ Un error cualquiera no alcanza: `evil.example` también falla por red, y así se leía como rechazo
	// con la guarda apagada. Lo que se exige es que el pedido NI SALGA.
	for _, u := range []string{"https://evil.example/x", "http://api.twilio.com/x", "https://twilio.com.evil.example/x"} {
		if c.allowed(u) {
			t.Errorf("%s debería rechazarse", u)
		}
		if _, _, err := c.Get(context.Background(), u); err == nil || !strings.Contains(err.Error(), "sólo se le pide a hosts de Twilio") {
			t.Errorf("%s: el GET tiene que frenarse antes de salir; dio %v", u, err)
		}
	}
	if !c.allowed("https://content.twilio.com/v1/Content") {
		t.Error("un host de Twilio por https tiene que pasar")
	}
}

// Los templates se leen con su aprobación, y uno sin pedido de aprobación es «unsubmitted», no vacío.
func TestTemplatesReadTheApproval(t *testing.T) {
	var gotAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		if r.URL.Path != "/v1/ContentAndApprovals" {
			http.NotFound(w, r)
			return
		}
		w.Write([]byte(`{"contents":[
			{"sid":"HX1","friendly_name":"pago_recibido_v1","language":"es","types":{"twilio/text":{},"twilio/media":{}},
			 "approval_requests":{"status":"rejected","category":"UTILITY","rejection_reason":"formato"}},
			{"sid":"HX2","friendly_name":"borrador","language":"es","types":{"twilio/text":{}}}]}`))
	}))
	defer srv.Close()
	c := newClient(basic("AC1", "tok"))
	c.override = map[string]string{ContentAPI: srv.URL}
	got, err := c.Templates(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0].Status != "rejected" || got[0].RejectionReason != "formato" || got[1].Status != "unsubmitted" {
		t.Errorf("templates: %+v", got)
	}
	if strings.Join(got[0].Types, ",") != "twilio/media,twilio/text" {
		t.Errorf("los types salen ordenados; dio %v", got[0].Types)
	}
	if gotAuth != basic("AC1", "tok") {
		t.Error("el pedido no llevó la credencial de la cuenta")
	}
}

// Un error no puede llevar la credencial: termina en una pantalla o en un log.
func TestErrorsDoNotLeakTheSecret(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(401)
		w.Write([]byte(`{"message":"Authenticate"}`))
	}))
	defer srv.Close()
	c := newClient(basic("AC1", "supersecreto"))
	c.override = map[string]string{CoreAPI: srv.URL}
	_, err := c.Accounts(context.Background())
	if err == nil || strings.Contains(err.Error(), "supersecreto") || strings.Contains(err.Error(), basic("AC1", "supersecreto")) {
		t.Errorf("error: %v", err)
	}
	if _, _, err := oauth(context.Background(), newClient(""), srv.URL, "OQ1", "supersecreto"); err == nil || strings.Contains(err.Error(), "supersecreto") {
		t.Errorf("el canje OAuth tiene que fallar sin filtrar el secreto: %v", err)
	}
}

func TestIdentityOfReadsTheJWTPayload(t *testing.T) {
	// {"sub":"trn:iam:app:OQ1","act":{"sub":"trn:iam:org:ORc4"},"aud":"api","exp":1000,"iat":400}
	tok := "x.eyJzdWIiOiJ0cm46aWFtOmFwcDpPUTEiLCJhY3QiOnsic3ViIjoidHJuOmlhbTpvcmc6T1JjNCJ9LCJhdWQiOiJhcGkiLCJleHAiOjEwMDAsImlhdCI6NDAwfQ.y"
	id, err := IdentityOf(tok)
	if err != nil {
		t.Fatal(err)
	}
	if id.App != "OQ1" || id.Organization != "ORc4" || id.LifetimeSeconds != 600 {
		t.Errorf("identidad: %+v", id)
	}
}

// Twilio se le habla desde acá y desde ningún otro lado: la regla «un cliente por servicio».
func TestNoOtherTwilioClientInTheRepo(t *testing.T) {
	if offenders := repocheck.Offenders(t, regexp.MustCompile(`https://[a-z.-]*twilio\.com`), nil); len(offenders) > 0 {
		t.Errorf("hay clientes de Twilio fuera de connectors/ (usá connectors/twilio): %v", offenders)
	}
}
