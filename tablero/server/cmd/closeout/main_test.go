package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

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

// La fase 3 de radar (#96): una fricción inventada HOY en una transcripción de prueba aparece en el cierre,
// y la misma, ocurrida también días antes, ya no es nueva y no se repite. Se escribe una transcripción en
// una carpeta de proyectos falsa, con el nombre que Claude Code le da a una raíz inventada.
func TestTheDaysNewFrictionReachesTheCloseout(t *testing.T) {
	root := filepath.Join(t.TempDir(), "playground")
	projects := t.TempDir()
	dir := filepath.Join(projects, strings.ReplaceAll(root, "/", "-"))
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	today := time.Date(2026, 9, 27, 0, 0, 0, 0, time.Local)
	session := func(name string, when time.Time, cmd, result string) {
		lines := []map[string]any{
			{"type": "user", "turnOrigin": "human", "timestamp": when.UTC().Format(time.RFC3339), "message": map[string]any{"content": "hola"}},
			{"type": "assistant", "timestamp": when.UTC().Format(time.RFC3339), "message": map[string]any{"content": []any{
				map[string]any{"type": "tool_use", "id": "t1", "name": "Bash", "input": map[string]any{"command": cmd}}}}},
			{"type": "user", "timestamp": when.UTC().Format(time.RFC3339), "message": map[string]any{"content": []any{
				map[string]any{"type": "tool_result", "tool_use_id": "t1", "is_error": true, "content": result}}}},
		}
		var b strings.Builder
		for _, l := range lines {
			raw, _ := json.Marshal(l)
			b.Write(raw)
			b.WriteByte('\n')
		}
		if err := os.WriteFile(filepath.Join(dir, name+".jsonl"), []byte(b.String()), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	session("hoy", today.Add(15*time.Hour), "grep x && make trampas", "The following part requires approval: make trampas")
	session("frenada", today.Add(16*time.Hour), "git commit -m x", "⛔ Bloqueado por el hook index-guard (…): …")
	session("vieja", today.AddDate(0, 0, -3).Add(10*time.Hour), "git commit -m y", "⛔ Bloqueado por el hook index-guard (…): …")

	notes := dayFriction(root, projects, filepath.Join(t.TempDir(), "idx.json"), today)
	if len(notes) != 1 || notes[0].Key != "make trampas" || notes[0].Kind != "pidió aprobación" {
		t.Fatalf("fricción nueva del día: %+v (quería sólo make trampas; el commit frenado ya había pasado hace 3 días)", notes)
	}

	// y sale en el texto del cierre, como aviso —no cambia lo que falta—
	var out strings.Builder
	stdout := os.Stdout
	r, w, _ := os.Pipe()
	os.Stdout = w
	printReport(Report{Day: "2026-09-27", Friction: notes})
	w.Close()
	os.Stdout = stdout
	buf := make([]byte, 1<<16)
	n, _ := r.Read(buf)
	out.Write(buf[:n])
	if !strings.Contains(out.String(), "▲ fricción NUEVA del día") || !strings.Contains(out.String(), "make trampas") {
		t.Errorf("el cierre no la muestra:\n%s", out.String())
	}
	if !strings.Contains(out.String(), "todo en orden") {
		t.Errorf("la fricción avisa, no hace fallar el cierre:\n%s", out.String())
	}
}
