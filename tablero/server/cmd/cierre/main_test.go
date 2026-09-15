package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSeccionRetomaCortaEnElProximoTitulo(t *testing.T) {
	cuerpo := "\n## Si retomás esto sin contexto, empezá acá\n\nEstado de hoy.\n\n**El próximo paso es:** medir.\n\n## Objetivo\n\notra cosa\n"
	got := seccionRetoma(cuerpo)
	if got != "Estado de hoy.\n\n**El próximo paso es:** medir." {
		t.Errorf("sección mal recortada: %q", got)
	}
	if seccionRetoma("## Objetivo\n\nnada\n") != "" {
		t.Error("sin la sección tiene que devolver vacío, no otra sección")
	}
	if !reProximo.MatchString(cuerpo) {
		t.Error("no reconoce «El próximo paso es»")
	}
}

func TestLeerFrontmatterArchivadoEsFechaYRamasVanPorComa(t *testing.T) {
	dir := t.TempDir()
	ruta := filepath.Join(dir, "x.md")
	fm := "---\nid: 76\ntitle: \"Alta\"\nstage: work\narchived: \"2026-09-11T11:55:00-05:00\"\nramas: feat/la-card, CRED-352\n---\n\ncuerpo\n"
	if err := os.WriteFile(ruta, []byte(fm), 0o644); err != nil {
		t.Fatal(err)
	}
	tr, err := leer(ruta)
	if err != nil {
		t.Fatal(err)
	}
	if tr.ID != 76 || !tr.Archived || tr.Stage != "work" {
		t.Errorf("frontmatter mal leído: %+v", tr)
	}
	if len(tr.Ramas) != 2 || tr.Ramas[0] != "feat/la-card" || tr.Ramas[1] != "CRED-352" {
		t.Errorf("las ramas van por coma y sin espacios: %v", tr.Ramas)
	}
	if !esRamaBase("legacy-backend/qa") || esRamaBase("legacy-backend/feat/qa-tools") {
		t.Error("esRamaBase mira la rama entera, no una subcadena")
	}
}

// La sección de retoma se reconoce aunque venga numerada y en mayúsculas: la tarea de Bancolombia la
// titula «## 0 · SI RETOMÁS ESTO SIN CONTEXTO, EMPEZÁ ACÁ» y el patrón exacto la daba por inexistente.
func TestSeccionRetomaReconoceTitulosNumeradosYEnMayusculas(t *testing.T) {
	for _, cuerpo := range []string{
		"\n## Si retomás esto sin contexto, empezá acá\n\nHoy.\n\n## Objetivo\n",
		"\n## 0 · SI RETOMÁS ESTO SIN CONTEXTO, EMPEZÁ ACÁ\n\nHoy.\n\n## Objetivo\n",
		"\n## 1. Si retomas esto sin contexto\n\nHoy.\n\n## Objetivo\n",
	} {
		if got := seccionRetoma(cuerpo); got != "Hoy." {
			t.Errorf("no reconoció la sección en %q → %q", strings.SplitN(cuerpo, "\n", 3)[1], got)
		}
	}
	// y no se inventa una donde no hay
	if seccionRetoma("\n## Objetivo\n\nnada\n") != "" {
		t.Error("sin sección tiene que dar vacío")
	}
}
