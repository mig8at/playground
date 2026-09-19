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
	fm := "---\nid: 76\ntitle: \"Alta\"\nclase: proyecto\nstage: work\narchived: \"2026-09-11T11:55:00-05:00\"\nramas: feat/la-card, CRED-352\n---\n\ncuerpo\n"
	if err := os.WriteFile(ruta, []byte(fm), 0o644); err != nil {
		t.Fatal(err)
	}
	tr, err := leer(ruta)
	if err != nil {
		t.Fatal(err)
	}
	if tr.ID != 76 || !tr.Archived || tr.Stage != "work" || tr.Clase != "proyecto" {
		t.Errorf("frontmatter mal leído: %+v", tr)
	}
	if len(tr.Ramas) != 2 || tr.Ramas[0] != "feat/la-card" || tr.Ramas[1] != "CRED-352" {
		t.Errorf("las ramas van por coma y sin espacios: %v", tr.Ramas)
	}
	if !esRamaBase("legacy-backend/qa") || esRamaBase("legacy-backend/feat/qa-tools") {
		t.Error("esRamaBase mira la rama entera, no una subcadena")
	}
}

func TestElAltaDeUnContenedorNoFingeTrabajoEnLaHerramienta(t *testing.T) {
	contenedor := tarea{Slug: "trazador", Clase: "proyecto"}
	if !esSoloAltaDeContenedor(contenedor, []string{"archivo"}, false) {
		t.Fatal("el primer archivo del contenedor es organización del tablero")
	}
	if esSoloAltaDeContenedor(contenedor, []string{"archivo"}, true) {
		t.Fatal("los cambios posteriores del contenedor sí se cierran")
	}
	if esSoloAltaDeContenedor(contenedor, []string{"archivo", "rama trazador/feat"}, false) {
		t.Fatal("si también hubo rama, existió trabajo real en la herramienta")
	}
	if esSoloAltaDeContenedor(tarea{Slug: "producto"}, []string{"archivo"}, false) {
		t.Fatal("una tarea de producto nueva sí exige cierre")
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

/*
UNA TAREA TERMINADA NO LA REABRE UNA RAMA.

	El caso real: la #67 cerró el 2026-09-07 declarando el patrón `canon/`, que es subcadena de las
	sesenta y siete ramas de esa herramienta. Diez días después, una rama nueva de canon la reclamó y
	el cierre pidió un `### 2026-09-17` en el Registro de una tarea cerrada — o sea, escribir historia
	falsa para que el guard se calle.

	Lo que esta prueba fija son las tres mitades del arreglo: la cerrada no se reabre, la VIVA que
	declara la misma rama sí, y una rama que SÓLO reclama una tarea cerrada no se da por declarada —
	sale a la lista de huérfanas, que es el pedido correcto: declarala en la tarea viva.
*/
func TestUnaTareaArchivadaNoLaReabreUnaRama(t *testing.T) {
	cerrada := tarea{ID: 67, Slug: "canon-compartido", Archived: true, Ramas: []string{"canon/"}}
	viva := tarea{ID: 72, Slug: "canon-mejoras", Ramas: []string{"canon/la-respuesta-de-un-vistazo"}}
	ramas := []string{"playground/canon/la-respuesta-de-un-vistazo"}

	motivos, conTarea := atribuir([]tarea{cerrada, viva}, map[string]bool{}, ramas)
	if len(motivos["canon-compartido"]) != 0 {
		t.Errorf("la tarea cerrada quedó reclamada por una rama: %v", motivos["canon-compartido"])
	}
	if len(motivos["canon-mejoras"]) != 1 {
		t.Errorf("la tarea viva tiene que quedar reclamada: %v", motivos["canon-mejoras"])
	}
	if !conTarea[ramas[0]] {
		t.Error("la rama la declara una tarea viva: no puede salir como huérfana")
	}

	// Sin la tarea viva, la misma rama queda SIN declarar: es lo que hay que ir a arreglar.
	_, solaCerrada := atribuir([]tarea{cerrada}, map[string]bool{}, ramas)
	if solaCerrada[ramas[0]] {
		t.Error("una tarea cerrada no declara una rama: taparla es el mismo error con otra cara")
	}

	// Pero editar su archivo sí la sigue reclamando: si hoy se escribió ahí, algo se está haciendo.
	editada, _ := atribuir([]tarea{cerrada}, map[string]bool{"canon-compartido": true}, ramas)
	if len(editada["canon-compartido"]) != 1 || editada["canon-compartido"][0] != "archivo" {
		t.Errorf("el motivo «archivo» tiene que seguir valiendo para una archivada: %v", editada["canon-compartido"])
	}
}
