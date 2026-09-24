package main

import (
	"os"
	"path/filepath"
	"testing"

	"creditop/playground/tablero/server/internal/pulse"
	"creditop/playground/tablero/server/internal/taskcontext"
)

func TestReadFrontmatterArchivedIsDateAndBranchesSplitByComma(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "x.md")
	fm := "---\nid: 76\ntitle: \"Alta\"\nclase: proyecto\nstage: work\narchived: \"2026-09-11T11:55:00-05:00\"\nramas: feat/la-card, CRED-352\n---\n\ncuerpo\n"
	if err := os.WriteFile(path, []byte(fm), 0o644); err != nil {
		t.Fatal(err)
	}
	tr, err := readTaskFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if tr.ID != 76 || !tr.Archived || tr.Stage != "work" || tr.Class != "proyecto" {
		t.Errorf("frontmatter mal leído: %+v", tr)
	}
	if len(tr.Branches) != 2 || tr.Branches[0] != "feat/la-card" || tr.Branches[1] != "CRED-352" {
		t.Errorf("las ramas van por coma y sin espacios: %v", tr.Branches)
	}
	if !isBaseBranch("qa") || isBaseBranch("feat/qa-tools") {
		t.Error("isBaseBranch mira la rama entera, no una subcadena")
	}
}

func TestContainerCreationDoesNotFakeToolWork(t *testing.T) {
	container := task{Slug: "trazador", Class: "proyecto"}
	if !isOnlyContainerCreation(container, []string{"archivo"}, false) {
		t.Fatal("el primer archivo del contenedor es organización del tablero")
	}
	if isOnlyContainerCreation(container, []string{"archivo"}, true) {
		t.Fatal("los cambios posteriores del contenedor sí se cierran")
	}
	if isOnlyContainerCreation(container, []string{"archivo", "rama trazador/feat"}, false) {
		t.Fatal("si también hubo rama, existió trabajo real en la herramienta")
	}
	if isOnlyContainerCreation(task{Slug: "producto"}, []string{"archivo"}, false) {
		t.Fatal("una tarea de producto nueva sí exige cierre")
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
func TestArchivedTaskIsNotReopenedByBranch(t *testing.T) {
	closed := task{ID: 67, Slug: "canon-compartido", Archived: true, Branches: []string{"canon/"}}
	live := task{ID: 72, Slug: "canon-mejoras", Branches: []string{"canon/la-respuesta-de-un-vistazo"}}
	branches := []string{"playground/canon/la-respuesta-de-un-vistazo"}

	reasons, withTask := attribute([]task{closed, live}, map[string]bool{}, branches)
	if len(reasons["canon-compartido"]) != 0 {
		t.Errorf("la tarea cerrada quedó reclamada por una rama: %v", reasons["canon-compartido"])
	}
	if len(reasons["canon-mejoras"]) != 1 {
		t.Errorf("la tarea viva tiene que quedar reclamada: %v", reasons["canon-mejoras"])
	}
	if !withTask[branches[0]] {
		t.Error("la rama la declara una tarea viva: no puede salir como huérfana")
	}

	// Sin la tarea viva, la misma rama queda SIN declarar: es lo que hay que ir a arreglar.
	_, onlyClosed := attribute([]task{closed}, map[string]bool{}, branches)
	if onlyClosed[branches[0]] {
		t.Error("una tarea cerrada no declara una rama: taparla es el mismo error con otra cara")
	}

	// Pero editar su archivo sí la sigue reclamando: si hoy se escribió ahí, algo se está haciendo.
	edited, _ := attribute([]task{closed}, map[string]bool{"canon-compartido": true}, branches)
	if len(edited["canon-compartido"]) != 1 || edited["canon-compartido"][0] != "archivo" {
		t.Errorf("el motivo «archivo» tiene que seguir valiendo para una archivada: %v", edited["canon-compartido"])
	}
}

// El caso del 2026-09-23: el pulso nombra `microservices/customer-service` como UN repo, y partir
// "repo/rama" en la primera barra hacía de su `main` la rama «customer-service/main» — una rama sin dueño
// que hacía salir 1 al cierre por un pull. La base se decide con la rama sola.
func TestBaseBranchOfANestedRepoIsStillBase(t *testing.T) {
	hours := []pulse.Hour{{Day: "2026-09-23", Slots: 2, Covered: 1, Repos: []pulse.RepoHour{
		{Repo: "microservices/customer-service", Branch: "main"},
		{Repo: "legacy-backend", Branch: "feat/qa-tools"},
		{Repo: "frontend-monorepo", Branch: "fix/main"},
	}}, {Day: "2026-09-22", Repos: []pulse.RepoHour{{Repo: "otro", Branch: "feat/ayer"}}}}
	branches, base, minutes, ok := dayBranches(hours, "2026-09-23")
	if !ok || minutes != 10 || len(branches) != 3 {
		t.Fatalf("ramas del día mal leídas: %v · %d′ · ok=%v", branches, minutes, ok)
	}
	if !base["microservices/customer-service/main"] {
		t.Error("el main de un repo con barra en el nombre es una rama base")
	}
	if base["legacy-backend/feat/qa-tools"] || base["frontend-monorepo/fix/main"] {
		t.Error("una rama de trabajo no es base aunque su nombre termine en /main o contenga qa")
	}
}

// Un bloque cuenta por su FECHA, no porque su archivo haya cambiado: el 2026-09-23 la migración reescribió
// los 37 hitos viejos con sus fechas, y si contara el archivo habría vuelto «tocadas» a 22 tareas. Y un
// bloque migrado cumple con el bloque de su día, pero no es trabajo de ese día.
func TestABlockCountsOnTheDayItWasWritten(t *testing.T) {
	events := []taskcontext.Event{
		{At: "2026-09-22T20:50:00-05:00", Via: "migration"},
		{At: "2026-09-23T15:10:00-05:00", Via: "manual"},
	}
	if any, work := blocksOn(events, "2026-09-23"); !any || !work {
		t.Fatal("no vio el bloque del 23")
	}
	if any, _ := blocksOn(events, "2026-09-21"); any {
		t.Fatal("vio un bloque del 21 que no existe")
	}
	if any, work := blocksOn(events, "2026-09-22"); !any || work {
		t.Fatalf("el hito del 22 convertido cumple con el bloque del 22 sin ser trabajo del 22: any=%v work=%v", any, work)
	}
}
