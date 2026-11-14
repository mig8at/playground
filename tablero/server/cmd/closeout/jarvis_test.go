package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func writeFile(t *testing.T, path, body string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestTheProposalNamesTheJarvisRunsOfTheWindowWithTheirFlow(t *testing.T) {
	t.Setenv("JARVIS_DATA", "")
	t.Setenv("JARVIS_FLOWS", "")
	t.Setenv("JARVIS_FLUJOS", "")
	myTools := t.TempDir()
	now := time.Date(2026, 11, 13, 13, 0, 0, 0, time.Local)
	since := now.Add(-time.Hour)
	runs := filepath.Join(myTools, "jarvis", ".data", "runs")

	// Antes del lapso: ya está contada en otra entrada de bitácora.
	writeFile(t, filepath.Join(runs, "2026-11-13_11-00-00", "run.json"),
		`{"id":"2026-11-13_11-00-00","site":"old.test","at":"`+now.Add(-2*time.Hour).Format(time.RFC3339Nano)+`","steps":3,"meta":"vieja","result":"LISTO: x","keyword":"LISTO"}`)
	// Dentro del lapso, en orden inverso al de la carpeta: salen ordenadas por hora.
	writeFile(t, filepath.Join(runs, "2026-11-13_12-40-00", "run.json"),
		`{"id":"2026-11-13_12-40-00","site":"partners.shopify.com","at":"`+now.Add(-20*time.Minute).Format(time.RFC3339Nano)+`","steps":10,"failed":1,"meta":"Ver cómo se pide [la revisión]","result":"NECESITO: Miguel decide la cuenta","keyword":"NECESITO"}`)
	writeFile(t, filepath.Join(runs, "2026-11-13_12-10-00", "run.json"),
		`{"id":"2026-11-13_12-10-00","site":"mail.google.com","at":"`+now.Add(-50*time.Minute).Format(time.RFC3339Nano)+`","steps":2,"meta":"Abrir el borrador","result":"LISTO: borrador abierto","keyword":"LISTO"}`)
	writeFile(t, filepath.Join(myTools, "jarvis", "flows", "mail-google-com", "abrir.json"),
		`{"name":"Abrir el borrador en Gmail","run":"2026-11-13_12-10-00","steps":[]}`)

	got := jarvisRuns(myTools, since, now)
	if len(got) != 2 || got[0].ID != "2026-11-13_12-10-00" || got[1].ID != "2026-11-13_12-40-00" {
		t.Fatalf("corridas del lapso: %+v", got)
	}
	if got[0].Flow != "Abrir el borrador en Gmail" || got[1].Flow != "" {
		t.Fatalf("flujos: %q %q", got[0].Flow, got[1].Flow)
	}
	if got[1].Result != "Miguel decide la cuenta" {
		t.Fatalf("el resultado sin la palabra clave repetida: %q", got[1].Result)
	}

	section := jarvisSection(got)
	for _, want := range []string{
		"[Abrir el borrador](jarvis:2026-11-13_12-10-00)",
		"Quedó como flujo «Abrir el borrador en Gmail»",
		"[Ver cómo se pide (la revisión)](jarvis:2026-11-13_12-40-00)", // los corchetes romperían el enlace
		"(1 fallaron). NECESITO: Miguel decide la cuenta",
	} {
		if !strings.Contains(section, want) {
			t.Errorf("falta %q en:\n%s", want, section)
		}
	}
	if strings.Contains(section, "vieja") {
		t.Errorf("entró una corrida de antes del lapso:\n%s", section)
	}
	if jarvisSection(nil) != "" {
		t.Error("sin corridas, el bloque no nombra a Jarvis")
	}
}

func TestWithoutJarvisTheProposalStaysTheSame(t *testing.T) {
	t.Setenv("JARVIS_DATA", filepath.Join(t.TempDir(), "no-existe"))
	if got := jarvisRuns(t.TempDir(), time.Now().Add(-time.Hour), time.Now()); got != nil {
		t.Fatalf("sin carpeta de corridas no hay corridas: %+v", got)
	}
}
