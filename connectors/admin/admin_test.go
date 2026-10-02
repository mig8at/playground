package admin

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// ── piezas puras ─────────────────────────────────────────────────────────────────────────────────

// Lo que sirve legacy-application es un <script inertia>, NO el atributo data-page. Con sólo el atributo, el formulario «no
// traía opciones» y no había forma de saber por qué.
func TestParsePageReadsBothForms(t *testing.T) {
	script := `<head><script inertia> window.inertiaPage = {"component":"admin\/AlliedCreate","props":{"settings":{"countries":[{"value":47,"title":"Colombia"}]}},"url":"\/aliados\/crear","version":"abc"}; </script></head>`
	p := ParsePage(script)
	if p == nil || p.Component != "admin/AlliedCreate" || p.Version != "abc" {
		t.Fatalf("no leyó window.inertiaPage: %+v", p)
	}
	attr := `<div id="app" data-page="{&quot;component&quot;:&quot;A&quot;,&quot;props&quot;:{&quot;n&quot;:&quot;a &amp;amp; b&quot;},&quot;url&quot;:&quot;/&quot;}"></div>`
	if p := ParsePage(attr); p == nil || p.Props["n"] != "a &amp; b" {
		t.Fatalf("no leyó data-page escapado: %+v", p)
	}
	if ParsePage("<html></html>") != nil || ParsePage(`<script inertia> window.inertiaPage = {roto}; </script>`) != nil {
		t.Fatal("sin página o con JSON roto tiene que devolver nil")
	}
}

func TestJarAppliesAndDeletes(t *testing.T) {
	j := newJar()
	j.apply([]*http.Cookie{{Name: "XSRF-TOKEN", Value: "abc%3D"}, {Name: "sesion", Value: "vieja"}}, "x.test")
	j.apply([]*http.Cookie{{Name: "sesion", Value: "nueva"}}, "x.test")
	if j.header() != "XSRF-TOKEN=abc%3D; sesion=nueva" {
		t.Fatalf("header: %q", j.header())
	}
	j.apply([]*http.Cookie{{Name: "sesion", Value: "", MaxAge: -1}}, "x.test")
	if j.header() != "XSRF-TOKEN=abc%3D" {
		t.Fatalf("una cookie borrada no se quitó: %q", j.header())
	}
	j.apply([]*http.Cookie{{Name: "vencida", Value: "v", Expires: time.Now().Add(-time.Hour)}}, "x.test")
	if strings.Contains(j.header(), "vencida") {
		t.Fatal("una cookie vencida no debe guardarse")
	}
}

// Laravel devuelve el token en una cookie codificada y lo espera DECODIFICADO en el header.
func TestXSRFIsDecoded(t *testing.T) {
	j := newJar()
	j.apply([]*http.Cookie{{Name: "XSRF-TOKEN", Value: "eyJpdiI6IkFC%3D%3D"}}, "x.test")
	if j.xsrf() != "eyJpdiI6IkFC==" {
		t.Fatalf("token: %q", j.xsrf())
	}
	if newJar().xsrf() != "" {
		t.Fatal("sin cookie no hay token")
	}
}

// Producción es sólo lectura y qa no tiene admin: equivocarse acá crearía un comercio donde no se debe.
func TestBaseFor(t *testing.T) {
	if b, err := BaseFor("DEV"); err != nil || b != "https://admin.dev.creditop.com" {
		t.Fatalf("dev: %q %v", b, err)
	}
	for target, want := range map[string]string{"prod": "sólo lectura", "production": "sólo lectura", "qa": "--target dev", "inventado": "no conozco"} {
		if _, err := BaseFor(target); err == nil || !strings.Contains(err.Error(), want) {
			t.Errorf("%s: esperaba un error con %q, llegó %v", target, want, err)
		}
	}
}

func TestPickOption(t *testing.T) {
	countries := []any{map[string]any{"value": 10.0, "title": "Argentina"}, map[string]any{"value": 47.0, "title": "Colombia"}}
	if n, err := PickOption(countries, 0, 47); err != nil || n != 47 {
		t.Fatalf("debía preferir Colombia: %d %v", n, err)
	}
	types := []any{map[string]any{"id": 3.0, "name": "Grande"}, map[string]any{"id": 1.0, "name": "Pequeño"}}
	if n, _ := PickOption(types, 0, 0); n != 3 {
		t.Fatalf("sin preferencia, la primera: %d", n)
	}
	if _, err := PickOption(types, 9, 0); err == nil || !strings.Contains(err.Error(), "no existe") {
		t.Fatalf("una opción que no existe se rechaza: %v", err)
	}
	if _, err := PickOption(nil, 0, 0); err == nil {
		t.Fatal("sin opciones tiene que fallar")
	}
}

func TestAlliedIDFromLocation(t *testing.T) {
	for loc, want := range map[string]int{"http://admin.localhost:8000/aliados?allied=349": 349, "/aliados/349/puntosdeventa": 349} {
		if got, ok := AlliedIDFromLocation(loc); !ok || got != want {
			t.Errorf("%s → %d %v", loc, got, ok)
		}
	}
	for _, loc := range []string{"/aliados", "/aliados/crear", "/aliados?allied=abc"} {
		if _, ok := AlliedIDFromLocation(loc); ok {
			t.Errorf("%s no debería dar id", loc)
		}
	}
}

func TestAutoNameCarriesThePrefix(t *testing.T) {
	got := AutoName(time.Date(2026, 10, 2, 13, 5, 7, 0, time.Local))
	if got != "PRUEBA AUTO 1002-130507" || !strings.HasPrefix(got, AutoPrefix) {
		t.Fatalf("nombre: %q", got)
	}
}

// El formato en disco es el que lee el harness en TypeScript: si un nombre de campo cambia, los dos lados dejan de verse.
func TestStoredSessionKeepsTheSharedFormat(t *testing.T) {
	c := New("https://admin.dev.creditop.com")
	c.jar.apply([]*http.Cookie{{Name: "creditop_session", Value: "v", Path: "/", HttpOnly: true, Secure: true, SameSite: http.SameSiteLaxMode}}, "admin.dev.creditop.com")
	s := c.toSession("dev", "miguel@creditop.com", "MIGUEL")
	raw, _ := json.Marshal(s)
	for _, key := range []string{`"version":1`, `"kind":"admin"`, `"target":"dev"`, `"user":"miguel@creditop.com"`, `"who":"MIGUEL"`, `"origin":"https://admin.dev.creditop.com"`, `"httpOnly":true`, `"sameSite":"Lax"`, `"domain":"admin.dev.creditop.com"`} {
		if !strings.Contains(string(raw), key) {
			t.Errorf("falta %s en %s", key, raw)
		}
	}
	// y una sesión guardada por el lado de TypeScript (dominio con punto) se carga con sus cookies aplicables
	ts := `{"version":1,"kind":"admin","target":"dev","user":"u","who":null,"origin":"https://admin.dev.creditop.com","createdAt":"x","cookies":[{"name":"a","value":"1","domain":".creditop.com","path":"/","expires":-1,"httpOnly":true,"secure":true},{"name":"b","value":"2","domain":"otro.com","path":"/","expires":-1,"httpOnly":false,"secure":false}]}`
	var stored StoredSession
	if err := json.Unmarshal([]byte(ts), &stored); err != nil {
		t.Fatal(err)
	}
	loaded, err := FromSession(&stored)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.jar.header() != "a=1" {
		t.Fatalf("debía cargar sólo la cookie del dominio: %q", loaded.jar.header())
	}
}

// ── contra un servidor que imita a Laravel ────────────────────────────────────────────────────────

const goodSession = "sess-good"

type fakeLaravel struct {
	pendingErrors map[string]any
	created       int
}

func (f *fakeLaravel) page(w http.ResponseWriter, component string, props map[string]any) {
	raw, _ := json.Marshal(map[string]any{"component": component, "props": props, "url": "/"})
	w.Header().Set("Content-Type", "text/html")
	_, _ = w.Write([]byte(`<html><head><script inertia> window.inertiaPage = ` + string(raw) + `; </script></head></html>`))
}

func (f *fakeLaravel) authed(r *http.Request) bool {
	c, err := r.Cookie("app_session")
	return err == nil && c.Value == goodSession
}

func (f *fakeLaravel) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/login", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			http.SetCookie(w, &http.Cookie{Name: "XSRF-TOKEN", Value: "tok%3D", Path: "/"})
			http.SetCookie(w, &http.Cookie{Name: "app_session", Value: "anon", Path: "/", HttpOnly: true})
			f.page(w, "auth/Login", map[string]any{"errors": map[string]any{}})
			return
		}
		if r.Header.Get("X-XSRF-TOKEN") != "tok=" {
			http.Error(w, "CSRF token mismatch", 419)
			return
		}
		_ = r.ParseForm()
		if r.PostForm.Get("email") == "miguel@creditop.com" && r.PostForm.Get("password") == "clave-buena" {
			http.SetCookie(w, &http.Cookie{Name: "app_session", Value: goodSession, Path: "/", HttpOnly: true})
			http.Redirect(w, r, "/", http.StatusFound)
			return
		}
		http.Redirect(w, r, "/login", http.StatusFound)
	})
	mux.HandleFunc("/aliados/crear", func(w http.ResponseWriter, r *http.Request) {
		if !f.authed(r) {
			http.Redirect(w, r, "/login", http.StatusFound)
			return
		}
		props := map[string]any{"errors": map[string]any{}, "settings": map[string]any{
			"alliedTypes":      []any{map[string]any{"id": 1, "name": "Pequeño"}},
			"alliedIndustries": []any{map[string]any{"id": 2, "name": "Retail"}},
			"countries":        []any{map[string]any{"value": 10, "title": "Argentina"}, map[string]any{"value": 47, "title": "Colombia"}},
		}}
		if f.pendingErrors != nil {
			props["errors"] = f.pendingErrors
			f.pendingErrors = nil
		}
		f.page(w, "admin/allieds/AlliedCreate", props)
	})
	mux.HandleFunc("/aliados", func(w http.ResponseWriter, r *http.Request) {
		if !f.authed(r) {
			http.Redirect(w, r, "/login", http.StatusFound)
			return
		}
		if r.Method == http.MethodPost {
			if r.Header.Get("X-XSRF-TOKEN") != "tok=" {
				http.Error(w, "CSRF token mismatch", 419)
				return
			}
			if err := r.ParseMultipartForm(1 << 20); err != nil {
				http.Error(w, "no multipart", 400)
				return
			}
			file, _, err := r.FormFile("image")
			if r.FormValue("name") == "" || err != nil {
				f.pendingErrors = map[string]any{"name": "El campo name es obligatorio."}
				http.Redirect(w, r, "/aliados/crear", http.StatusFound)
				return
			}
			head := make([]byte, 4)
			_, _ = file.Read(head)
			if string(head[1:4]) != "PNG" {
				f.pendingErrors = map[string]any{"image": "El archivo no es una imagen."}
				http.Redirect(w, r, "/aliados/crear", http.StatusFound)
				return
			}
			if r.FormValue("country_id") != "47" {
				f.pendingErrors = map[string]any{"country_id": "El pais seleccionado es inválido."}
				http.Redirect(w, r, "/aliados/crear", http.StatusFound)
				return
			}
			f.created++
			http.Redirect(w, r, "/aliados?allied=77", http.StatusFound)
			return
		}
		props := map[string]any{"errors": map[string]any{}, "auth": map[string]any{"full_name": "MIGUEL OCHOA"}}
		if r.URL.Query().Get("allied") == "77" {
			props["testAdvisor"] = map[string]any{"created": true, "cognito": "created", "email": "c1-fake@creditop.com", "passwordFixed": true, "branchName": "b1-fake", "notes": []any{}}
		}
		f.page(w, "admin/allieds/Index", props)
	})
	return mux
}

func loggedIn(t *testing.T) (*Client, *fakeLaravel) {
	t.Helper()
	fake := &fakeLaravel{}
	srv := httptest.NewServer(fake.handler())
	t.Cleanup(srv.Close)
	c := New(srv.URL)
	// El host del servidor de prueba no es el de ningún ambiente: Login se prueba con el cliente armado a mano.
	if _, err := c.Get(context.Background(), "/login"); err != nil {
		t.Fatal(err)
	}
	r, err := c.PostForm(context.Background(), "/login", "/login", map[string][]string{"email": {"miguel@creditop.com"}, "password": {"clave-buena"}})
	if err != nil || r.Status != 302 || isLoginRedirect(r.Location) {
		t.Fatalf("el login de prueba no entró: %+v %v", r, err)
	}
	c.User = "miguel@creditop.com"
	return c, fake
}

func TestLoginFlowSendsTheCSRFToken(t *testing.T) {
	c, _ := loggedIn(t)
	who, err := c.Probe(context.Background())
	if err != nil || who != "MIGUEL OCHOA" {
		t.Fatalf("Probe: %q %v", who, err)
	}
	c.Who = who
	if c.ActingAs() != "MIGUEL OCHOA (miguel@creditop.com)" {
		t.Fatalf("ActingAs: %q", c.ActingAs())
	}
}

func TestWrongPasswordIsRejected(t *testing.T) {
	fake := &fakeLaravel{}
	srv := httptest.NewServer(fake.handler())
	defer srv.Close()
	c := New(srv.URL)
	_, _ = c.Get(context.Background(), "/login")
	r, _ := c.PostForm(context.Background(), "/login", "/login", map[string][]string{"email": {"miguel@creditop.com"}, "password": {"mala"}})
	if !isLoginRedirect(r.Location) {
		t.Fatalf("una clave mala tiene que volver al login: %+v", r)
	}
	if _, err := c.Get(context.Background(), "/aliados"); !errors.Is(err, ErrNoSession) {
		t.Fatalf("sin sesión, Get tiene que decir ErrNoSession: %v", err)
	}
}

func TestPlanThenCreateAllied(t *testing.T) {
	c, fake := loggedIn(t)
	c.Who = "MIGUEL OCHOA"
	plan, err := c.PlanAllied(context.Background(), AlliedOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(plan.Name, AutoPrefix) || plan.CountryID != 47 || plan.TypeID != 1 || plan.IndustryID != 2 {
		t.Fatalf("plan: %+v", plan)
	}
	if fake.created != 0 {
		t.Fatal("PlanAllied no debe escribir nada")
	}
	if plan.ActingAs != "MIGUEL OCHOA (miguel@creditop.com)" {
		t.Fatalf("el plan tiene que decir con quién actúa: %q", plan.ActingAs)
	}
	got, err := c.CreateAllied(context.Background(), plan)
	if err != nil {
		t.Fatal(err)
	}
	if got.ID != 77 || fake.created != 1 {
		t.Fatalf("alta: %+v creados=%d", got, fake.created)
	}
	if got.Flash == nil || got.Flash.Cognito != "created" || got.Flash.Email != "c1-fake@creditop.com" || !got.Flash.PasswordFixed {
		t.Fatalf("flash: %+v", got.Flash)
	}
}

// El nombre sin el prefijo no se acepta: es lo único que el borrado reconoce.
func TestPlanRejectsANameWithoutThePrefix(t *testing.T) {
	c, _ := loggedIn(t)
	if _, err := c.PlanAllied(context.Background(), AlliedOptions{Name: "Mi comercio"}); err == nil || !strings.Contains(err.Error(), AutoPrefix) {
		t.Fatalf("esperaba rechazo por el prefijo: %v", err)
	}
}

// Las validaciones del admin salen en el error, no como «no redirigió».
func TestValidationErrorsAreReported(t *testing.T) {
	c, _ := loggedIn(t)
	plan, err := c.PlanAllied(context.Background(), AlliedOptions{})
	if err != nil {
		t.Fatal(err)
	}
	plan.CountryID = 10 // el admin sólo acepta los países operando
	_, err = c.CreateAllied(context.Background(), plan)
	if err == nil || !strings.Contains(err.Error(), "country_id") || !strings.Contains(err.Error(), "inválido") {
		t.Fatalf("el error tiene que traer la validación del admin: %v", err)
	}
}

// Sin el token CSRF el admin contesta 419, y se dice qué es.
func TestMissingCSRFIsExplained(t *testing.T) {
	c, _ := loggedIn(t)
	plan, _ := c.PlanAllied(context.Background(), AlliedOptions{})
	c.jar = newJar()
	c.jar.apply([]*http.Cookie{{Name: "app_session", Value: goodSession}}, "x")
	if _, err := c.CreateAllied(context.Background(), plan); err == nil || !strings.Contains(err.Error(), "419") {
		t.Fatalf("esperaba el error de CSRF: %v", err)
	}
}
