package canon

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// Espera y firma comparten estación, pero no paso ni explicación.
const routeFixture = `{"etag":"revision-1","mapa":{"stations":[{"id":"titular"},{"id":"codeudor"},{"id":"autorizacion"}],"rails":[{"desde":"titular","hasta":"codeudor"},{"desde":"codeudor","hasta":"autorizacion"}]},"flows":{"codeudor/context":{"titulo":"Codeudor","rutas":[{"id":"renting","titulo":"Renting","cuando":"Producto renting.","pasos":["titular","espera","firma","cierre"]},{"id":"directa","titulo":"Otra variante","pasos":["titular","espera"]}],"estaciones":[{"id":"titular","estacion_global":"titular","titulo":"Firma titular"},{"id":"espera","estacion_global":"codeudor","titulo":"Espera codeudor","nota":"La autorización espera."},{"id":"firma","estacion_global":"codeudor","titulo":"Firma codeudor","nota":"Firma después del titular.","referencia":"codeudor/context#firma"},{"id":"cierre","estacion_global":"autorizacion","titulo":"Autorización"}]}}}`

func TestRouteKeepsStepsAndVariant(t *testing.T) {
	var calls int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.URL.Path != "/api/globalmap" {
			t.Errorf("ruta inesperada: %s", r.URL.Path)
		}
		w.Header().Set("ETag", `"revision-1"`)
		w.Write([]byte(routeFixture))
	}))
	defer server.Close()
	c := New(server.URL)
	view, err := c.Route(context.Background(), "codeudor/renting#firma")
	if err != nil {
		t.Fatal(err)
	}
	if len(view.Steps) != 3 || view.Steps[0].ID != "espera" || view.Steps[1].ID != "firma" || !view.Steps[1].Focused || view.Before != 1 || view.After != 0 {
		t.Fatalf("se perdió el orden o se fusionó espera con firma: %+v", view)
	}
	if view.Steps[0].Focused || !strings.Contains(view.URL, "estacion=codeudor") || !strings.Contains(view.URL, "ruta=renting") || !strings.Contains(view.Steps[1].SourceURL, "%23firma") {
		t.Fatalf("enlace o foco incorrectos: %+v", view)
	}
	full, err := c.Route(context.Background(), "codeudor/renting")
	if err != nil || len(full.Steps) != 4 {
		t.Fatalf("variante completa: %+v %v", full, err)
	}
	for _, ref := range []string{"codeudor/directa#firma", "codeudor/inexistente", "otro/renting", "codeudor/renting#borrado"} {
		if _, err := c.Route(context.Background(), ref); !errors.Is(err, ErrRouteMissing) {
			t.Errorf("%s: %v", ref, err)
		}
	}
	if calls != 1 {
		t.Errorf("bajó el mapa %d veces para referencias de la misma revisión", calls)
	}
}

func TestRouteRejectsBrokenCoverage(t *testing.T) {
	for name, fixture := range map[string]string{
		"step":    strings.Replace(routeFixture, `"pasos":["titular","espera","firma","cierre"]`, `"pasos":["titular","falta","firma","cierre"]`, 1),
		"station": strings.ReplaceAll(routeFixture, `"estacion_global":"codeudor"`, `"estacion_global":"falta"`),
		"rail":    strings.Replace(routeFixture, `{"desde":"codeudor","hasta":"autorizacion"}`, `{"desde":"titular","hasta":"autorizacion"}`, 1),
	} {
		t.Run(name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte(fixture)) }))
			defer server.Close()
			if _, err := New(server.URL).Route(context.Background(), "codeudor/renting#firma"); err == nil {
				t.Fatal("inventó o saltó un paso sin respaldo")
			}
		})
	}
}

func TestRouteRefreshAndNetworkFailure(t *testing.T) {
	mode := "initial"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if mode != "initial" && r.Header.Get("If-None-Match") != `"revision-1"` {
			t.Error("no revalidó por ETag")
		}
		switch mode {
		case "unchanged":
			w.WriteHeader(http.StatusNotModified)
		case "offline":
			w.WriteHeader(http.StatusServiceUnavailable)
		default:
			w.Header().Set("ETag", `"revision-1"`)
			w.Write([]byte(routeFixture))
		}
	}))
	defer server.Close()
	c := New(server.URL)
	for _, next := range []string{"initial", "unchanged", "offline"} {
		mode = next
		c.catalogAt = time.Now().Add(-2 * time.Minute)
		_, err := c.Route(context.Background(), "codeudor/renting")
		if next == "offline" && err == nil {
			t.Fatal("sirvió una copia vencida como vigente")
		}
		if next != "offline" && err != nil {
			t.Fatal(err)
		}
	}
}

func TestRouteReferenceSyntax(t *testing.T) {
	for _, ref := range []string{"", "codeudor", "codeudor/renting#", "../renting", "codeudor/renting?url=x", "codeudor/renting#firma/otra"} {
		if _, err := ParseRouteRef(ref); err == nil {
			t.Errorf("aceptó %q", ref)
		}
	}
}
