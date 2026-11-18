package cliflags

import (
	"reflect"
	"testing"
)

// Los nombres de antes se traducen con uno o dos guiones y con `=`; un valor que se parece a una opción vieja, o lo
// que va después de `--`, no se toca.
func TestTranslateKeepsValuesAndTheRest(t *testing.T) {
	legacy := map[string]string{"tarea": "task", "todas": "all", "dia": "day"}
	got := Translate([]string{"-tarea", "84", "--todas", "-dia=2026-11-18", "-json", "-tarea", "-x", "--", "-tarea"}, legacy)
	want := []string{"-task", "84", "--all", "-day=2026-11-18", "-json", "-task", "-x", "--", "-tarea"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("\n got %q\nwant %q", got, want)
	}
	if got := Translate([]string{"-", "texto"}, legacy); !reflect.DeepEqual(got, []string{"-", "texto"}) {
		t.Errorf("un `-` suelto (stdin) no es una opción: %q", got)
	}
}
