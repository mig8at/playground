package vault

import (
	"bytes"
	"strings"
	"testing"
)

func TestParseEnv(t *testing.T) {
	in := `# comentario
APP_NAME=CreditOp
export TOKEN="con espacios # y numeral"
QUOTED='simple'
INLINE=valor # comentario
EMPTY=
EMPTY_QUOTES=""
not a line
APP_NAME=gana-la-ultima
`
	got, err := ParseEnv(strings.NewReader(in))
	if err != nil {
		t.Fatal(err)
	}
	want := [][2]string{{"APP_NAME", "gana-la-ultima"}, {"TOKEN", "con espacios # y numeral"}, {"QUOTED", "simple"}, {"INLINE", "valor"}}
	if len(got) != len(want) {
		t.Fatalf("%v", got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("%d: %v, quería %v", i, got[i], want[i])
		}
	}
}

func TestImportEnv(t *testing.T) {
	p := paths(t)
	pairs := [][2]string{{"A", "1"}, {"B", "2"}, {"C", "3"}}
	res, err := p.ImportEnv("Nuevo", pairs, nil, []string{"C"})
	if err != nil || len(res.Added) != 2 {
		t.Fatalf("%+v %v", res, err)
	}
	res, _ = p.ImportEnv("nuevo", [][2]string{{"A", "1"}, {"B", "otro"}}, nil, nil)
	if len(res.Same) != 1 || len(res.Updated) != 1 {
		t.Fatalf("%+v", res)
	}
	if v, _ := p.Reveal("nuevo", "B"); v != "otro" {
		t.Fatal(v)
	}
}

// Exportar con una contraseña e importar en OTRA máquina (otra llave personal): las llaves llegan iguales.
func TestExportImport(t *testing.T) {
	src := paths(t)
	if _, err := src.ImportEnv("VTEX", [][2]string{{"APP_KEY", "k"}, {"APP_TOKEN", "t"}}, nil, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := src.ImportEnv("Sonar", [][2]string{{"SONAR_TOKEN", "s"}}, nil, nil); err != nil {
		t.Fatal(err)
	}
	var zipped bytes.Buffer
	if _, _, err := src.Export(&zipped, "corta", nil); err == nil {
		t.Fatal("aceptó una contraseña corta")
	}
	rings, keys, err := src.Export(&zipped, "una contraseña larga", nil)
	if err != nil || rings != 2 || keys != 3 {
		t.Fatalf("%d %d %v", rings, keys, err)
	}
	if bytes.Contains(zipped.Bytes(), []byte(`"k"`)) {
		t.Fatal("un valor en claro en el zip")
	}
	dst := paths(t)
	if _, err := dst.Import(zipped.Bytes(), "otra", false); err == nil {
		t.Fatal("abrió con la contraseña equivocada")
	}
	if d, _ := dst.Load(); len(d.Rings) != 0 {
		t.Fatal("escribió algo con la contraseña equivocada")
	}
	res, err := dst.Import(zipped.Bytes(), "una contraseña larga", false)
	if err != nil || res.Added != 3 || res.Rings != 2 {
		t.Fatalf("%+v %v", res, err)
	}
	if v, _ := dst.Reveal("vtex", "APP_TOKEN"); v != "t" {
		t.Fatalf("%q", v)
	}
	// Otra vez: todo igual. Con un valor distinto: conflicto, y con replace se reemplaza.
	if res, _ := dst.Import(zipped.Bytes(), "una contraseña larga", false); res.Same != 3 {
		t.Fatalf("%+v", res)
	}
	if _, err := dst.SetKey("vtex", "APP_KEY", "cambiada"); err != nil {
		t.Fatal(err)
	}
	if res, _ := dst.Import(zipped.Bytes(), "una contraseña larga", false); len(res.Conflicts) != 1 {
		t.Fatalf("%+v", res)
	}
	if res, _ := dst.Import(zipped.Bytes(), "una contraseña larga", true); res.Replaced != 1 {
		t.Fatalf("%+v", res)
	}
	if v, _ := dst.Reveal("vtex", "APP_KEY"); v != "k" {
		t.Fatalf("%q", v)
	}
}
