package store

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"creditop/tablero/server/internal/layout"
)

// Hasta el 2026-09-23 los artifacts eran `data/artifacts/<slug>*.html`, unidos a su tarea por el
// nombre: 13 de 21 no eran `.html` y no se veían nunca, y uno quedó huérfano al renombrarse su tarea.
// Ahora son TODO lo que hay en `tasks/<slug>/artifacts/`, con la etiqueta sin extensión: el tipo lo
// muestra la UI aparte.
func TestArtifactsAreEverythingInTheTaskFolder(t *testing.T) {
	lay := layout.At(filepath.Join(t.TempDir(), "data"))
	dir := lay.ArtifactsPath("kyc")
	if err := os.MkdirAll(filepath.Join(dir, "subcarpeta"), 0o755); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"kyc.html", "kyc.dictar-centrales.html", "kyc.sdk.prototipo-tecnico.html", "casos.sql", "que-se-hizo.md", ".DS_Store"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	s := &Store{dir: lay.Data, layout: lay}
	got := s.artifactsOf("kyc")
	want := []Artifact{
		{File: "kyc/casos.sql", Label: "casos"},
		{File: "kyc/kyc.dictar-centrales.html", Label: "dictar centrales"},
		{File: "kyc/kyc.html", Label: "prototipo"},
		{File: "kyc/que-se-hizo.md", Label: "que se hizo"},
		{File: "kyc/kyc.sdk.prototipo-tecnico.html", Label: "sdk · prototipo tecnico"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("artifacts:\n got %+v\nwant %+v", got, want)
	}
	if other := s.artifactsOf("kyc-segundo"); len(other) != 0 {
		t.Errorf("otra tarea cuyo slug empieza igual no hereda nada; dio %+v", other)
	}
}
