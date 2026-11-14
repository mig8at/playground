package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// El ancla tiene que ser la de canon: si no coincide, toda sección parece huérfana.
func TestAnchorOfMatchesCanon(t *testing.T) {
	cases := map[string]string{
		"La categoría corre al final, y es la que manda": "la-categoria-corre-al-final-y-es-la-que-manda",
		"«Autorizada» no es «radicada»":                  "autorizada-no-es-radicada",
		"Año 2026: ñandú":                                "ano-2026-nandu",
	}
	for in, want := range cases {
		if got := anchorOf(in); got != want {
			t.Errorf("anchorOf(%q) = %q, quería %q", in, got, want)
		}
	}
}

// Canon nombra el mismo repo con el alias o con el nombre completo, y desde el 2026-11-14 los dos dicen legacy-application.
func TestCanonRepoAlias(t *testing.T) {
	cases := map[string]string{
		"Creditop-SAS/frontend-monorepo":  "frontend-monorepo",
		"legacy-application":              "legacy-application",
		"Creditop-SAS/legacy-application": "legacy-application",
		"legacy-backend":                  "legacy-backend",
	}
	for in, want := range cases {
		if got := canonRepoAlias(in); got != want {
			t.Errorf("canonRepoAlias(%q) = %q, quería %q", in, got, want)
		}
	}
}

func TestGroupOfAndSkipFile(t *testing.T) {
	if g := groupOf("Modules/Loans/App/Services/X.php"); g != "Modules/Loans" {
		t.Errorf("groupOf = %q", g)
	}
	if g := groupOf("routes/api.php"); g != "routes" {
		t.Errorf("groupOf de un archivo en una carpeta de primer nivel = %q", g)
	}
	if g := groupOf("artisan.php"); g != "artisan.php" {
		t.Errorf("groupOf de un archivo en la raíz = %q", g)
	}
	for _, p := range []string{"Modules/Loans/tests/Unit/XTest.php", "database/migrations/2024_x.php", "apps/a/x.test.ts", "internal/x_test.go"} {
		if !skipFile(p) {
			t.Errorf("%s debería quedar afuera", p)
		}
	}
	if skipFile("Modules/Loans/App/Services/X.php") {
		t.Error("un servicio no es una prueba")
	}
}

// Una sección que ningún área nombra es huérfana; los archivos se juntan por alias, y un repo con dos nombres se avisa.
func TestCorpusStats(t *testing.T) {
	files := map[string]string{
		"content/cuota/context.md": "# Cuota\n\nintro\n\n## La cuota se arma en un orden\n\ntexto\n\n## Sección suelta\n\nmás",
		"content/cuota/map.json": `{"areas":[{"objetivo":"x","secciones":["la-cuota-se-arma-en-un-orden"],
			"fuentes":{"frontend-monorepo":{"a.ts":"1"},"Creditop-SAS/frontend-monorepo":{"b.ts":"2"},"legacy-application":{"c.php":"3"}}}]}`,
		"meta/otro.json": "{}",
	}
	topics, declared, aliases := corpusStats(files)
	if len(topics) != 1 || topics[0].Sections != 2 || topics[0].Areas != 1 {
		t.Fatalf("temas = %+v", topics)
	}
	if len(topics[0].Orphans) != 1 || topics[0].Orphans[0] != "Sección suelta" {
		t.Errorf("huérfanas = %v", topics[0].Orphans)
	}
	if !declared["frontend-monorepo"]["a.ts"] || !declared["frontend-monorepo"]["b.ts"] || !declared["legacy-application"]["c.php"] {
		t.Errorf("declarados = %v", declared)
	}
	if aliases["frontend-monorepo"] == "" {
		t.Error("no avisó que frontend-monorepo aparece con dos nombres")
	}
}

// La cita de un área es `tema/capa#n=<posición>`; cualquier otra forma no se resuelve, sin fallar la búsqueda.
func TestParseAreaCite(t *testing.T) {
	if node, i, ok := parseAreaCite("creditopx/context#n=21"); !ok || node != "creditopx/context" || i != 21 {
		t.Errorf("parseAreaCite = %q %d %v", node, i, ok)
	}
	for _, bad := range []string{"creditopx/context#ancla", "#n=3", "creditopx/context#n=x", "creditopx/context#n=-1"} {
		if _, _, ok := parseAreaCite(bad); ok {
			t.Errorf("%q no debería resolverse", bad)
		}
	}
}

// Un tema nuevo no viene en el export: newContentFiles lo encuentra, sin repetir lo conocido ni mirar fuera de content/.
func TestNewContentFiles(t *testing.T) {
	dir := t.TempDir()
	write := func(p string) {
		full := filepath.Join(dir, filepath.FromSlash(p))
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	for _, p := range []string{"content/cartera/context.md", "content/recaudo/context.md", "content/recaudo/map.json", "content/.oculto", "otro/afuera.md"} {
		write(p)
	}
	got, err := newContentFiles(dir, map[string]string{"content/cartera/context.md": "h"})
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"content/recaudo/context.md", "content/recaudo/map.json"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Errorf("nuevos = %v, quería %v", got, want)
	}
}
