package taskcontext

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"creditop/tablero/server/internal/layout"
)

func checkpoint(summary string) Event {
	return Event{Kind: "checkpoint", Goal: "Cerrar el flujo de código", Summary: summary, State: "La tarea está validada en local", Next: "Confirmar el contrato pendiente"}
}

func TestAppendReadsNewestAndKeepsOneJSONLinePerEvent(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "data")
	old := time.Date(2026, time.March, 20, 9, 0, 0, 0, time.FixedZone("COT", -5*3600))
	newer := old.Add(24 * time.Hour)
	if _, err := Append(dir, "flujo-codigo", checkpoint("Se definió el primer corte"), old); err != nil {
		t.Fatal(err)
	}
	if _, err := Append(dir, "flujo-codigo", checkpoint("Se verificó el camino completo"), newer); err != nil {
		t.Fatal(err)
	}
	events, err := Read(dir, "flujo-codigo")
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 2 || events[0].Summary != "Se verificó el camino completo" || events[0].Schema != Schema || events[0].ID == "" {
		t.Fatalf("events = %+v", events)
	}
	b, err := os.ReadFile(layout.At(dir).ContextPath("flujo-codigo"))
	if err != nil {
		t.Fatal(err)
	}
	if lines := strings.Count(strings.TrimSpace(string(b)), "\n") + 1; lines != 2 {
		t.Fatalf("líneas = %d, archivo = %s", lines, b)
	}
}

func TestRejectsNoiseAndEvidenceWithoutReference(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "data")
	if _, err := Append(dir, "flujo-codigo", Event{Kind: "progress", Summary: "se avanzó"}, time.Now()); err == nil {
		t.Fatal("aceptó un avance de tiempo como contexto")
	}
	if _, err := Append(dir, "flujo-codigo", Event{Kind: "checkpoint", Summary: "pasó", State: "listo", Next: "seguir"}, time.Now()); err == nil {
		t.Fatal("aceptó un checkpoint sin objetivo")
	}
	if _, err := Append(dir, "flujo-codigo", Event{Kind: "evidence", Summary: "pasó"}, time.Now()); err == nil {
		t.Fatal("aceptó evidencia sin referencia")
	}
	if _, err := os.Stat(layout.At(dir).ContextPath("flujo-codigo")); !os.IsNotExist(err) {
		t.Fatalf("se escribió un archivo inválido: %v", err)
	}
}

func TestDecodeRejectsUnknownFields(t *testing.T) {
	if _, err := Decode([]byte(`{"kind":"checkpoint","goal":"cerrar","summary":"x","state":"ok","next":"seguir","unexpected":"no se pierde"}`)); err == nil {
		t.Fatal("aceptó un campo desconocido")
	}
}

func TestCanonLinksMustBeDeclaredAndRenderAsPlainTextInCLI(t *testing.T) {
	now := time.Date(2026, time.September, 22, 15, 0, 0, 0, time.UTC)
	event := checkpoint("El [listado](canon:listado) ya usa la entidad resuelta.")
	event.References = []Reference{{Kind: "canon", Label: "Listado", Target: "listado"}}
	clean, err := NormalizeAndValidate(event, now)
	if err != nil {
		t.Fatal(err)
	}
	if got, want := PlainText(clean.Summary), "El listado ya usa la entidad resuelta."; got != want {
		t.Fatalf("PlainText() = %q, want %q", got, want)
	}
	event.References = nil
	if _, err := NormalizeAndValidate(event, now); err == nil {
		t.Fatal("aceptó un enlace Canon sin reference")
	}
	event.References = []Reference{{Kind: "canon", Label: "Otro", Target: "onboarding"}}
	if _, err := NormalizeAndValidate(event, now); err == nil {
		t.Fatal("aceptó una reference Canon que no se enlaza dentro del párrafo")
	}
}

func TestDatabaseReferenceRequiresEnvironmentAndReadOnlySQL(t *testing.T) {
	now := time.Date(2026, time.September, 22, 15, 0, 0, 0, time.UTC)
	event := checkpoint("Se midió la cohorte relevante.")
	event.References = []Reference{{
		Kind: "db", Label: "Cohorte", Environment: "prod",
		Target: "SELECT count(*) AS solicitudes FROM user_requests",
	}}
	if _, err := NormalizeAndValidate(event, now); err != nil {
		t.Fatal(err)
	}
	event.References[0].Environment = ""
	if _, err := NormalizeAndValidate(event, now); err == nil {
		t.Fatal("aceptó una consulta sin ambiente")
	}
	event.References[0].Environment = "prod"
	event.References[0].Target = "DELETE FROM user_requests"
	if _, err := NormalizeAndValidate(event, now); err == nil {
		t.Fatal("aceptó una escritura como referencia")
	}
}
