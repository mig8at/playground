package taskcontext

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

// Las pruebas no persiguen cobertura: cada una fija una regla que existe para que un bloque se pueda
// volver a comprobar meses después, o un caso donde el validador podía equivocarse de lado.

type fakeRepos struct{ files map[string]string }

func (f fakeRepos) Pin(alias, path, sha string) (string, error) {
	if got, ok := f.files[alias+"/"+path]; ok {
		if sha != "" {
			return sha, nil
		}
		return got, nil
	}
	return "", errors.New(alias + "/" + path + " no existe en origin/main")
}

func (f fakeRepos) Knows(alias string) bool {
	return alias == "legacy-backend" || alias == "playground"
}

var repos = fakeRepos{files: map[string]string{"legacy-backend/tests/CreatesApplication.php": "cfc577218f2d"}}

var blockNow = time.Date(2026, time.September, 23, 15, 0, 0, 0, time.FixedZone("COT", -5*3600))

func prepare(t *testing.T, body string) (Event, []string, error) {
	t.Helper()
	return PrepareBlock(context.Background(), "La guarda frena las tres formas de recrear la base", body, "", BlockDeps{Files: repos}, blockNow)
}

func TestParseBlockMarkdownTakesTheTitleFromTheFirstLine(t *testing.T) {
	title, body, err := ParseBlockMarkdown("\n# La regla sí excluye\n\nCorrí el caso.\n")
	if err != nil || title != "La regla sí excluye" || body != "Corrí el caso." {
		t.Fatalf("title=%q body=%q err=%v", title, body, err)
	}
	if _, _, err := ParseBlockMarkdown("La regla sí excluye\n\nCorrí el caso."); err == nil {
		t.Fatal("aceptó un bloque sin título")
	}
}

func TestBlockRejectsWhatCannotBeCheckedLater(t *testing.T) {
	cases := []struct{ name, body, want string }{
		{"ruta local", "El log quedó en /Users/miguel/log.txt.", "ruta local"},
		{"archivo sin repo", "Se tocó `app/Services/LenderFilter.php`.", "sin su repo"},
		{"archivo sin repo en prosa", "Mirá tests/CreatesApplication.php antes de correr.", "sin su repo"},
		{"html", "Quedó <b>así</b>.", "HTML"},
		{"enlace sin tipo", "Ver [la guía](http://example.com).", "tipo válido"},
		{"el visor por su puerto", "Ver [la pantalla](http://localhost:5193/credifamilia/381-1052).", "visor:<proyecto>/<pantalla>@<huella>"},
		{"visor con una huella que no es", "Ver [la pantalla](visor:credifamilia/381-1052@xyz).", "tipo válido"},
		{"harness sin ambiente", "```harness\nmake harness-caso CASOS=x\n```\nResultado: pasó.", "TARGET="},
		{"comando sin resultado", "```sh\nmake cierre\n```\n\nY después otra cosa.", "Resultado"},
		{"comando al final sin resultado", "```sh\nmake cierre\n```", "Resultado"},
		{"sql sin ambiente", "```sql\nSELECT 1\n```\nResultado: 1.", "ambiente"},
		{"sql que escribe", "```sql prod\nDELETE FROM user_requests\n```\nResultado: nada.", "sólo lectura"},
		{"tipo de bloque inexistente", "```bash\nls\n```\nResultado: nada.", "no existe"},
		{"bloque sin tipo", "```\nls\n```", "falta el tipo"},
		{"bloque sin cerrar", "```sh\nmake cierre\n", "no se cierra"},
		{"descripción vacía", "", "falta la descripción"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, _, err := prepare(t, c.body)
			if err == nil || !strings.Contains(err.Error(), c.want) {
				t.Fatalf("err = %v, quería algo con %q", err, c.want)
			}
		})
	}
}

func TestBlockAcceptsProseLinksAndCommandsWithTheirResult(t *testing.T) {
	body := "La guarda vive en [CreatesApplication](repo:legacy-backend/tests/CreatesApplication.php#L12).\n\n" +
		"```sql prod\nSELECT count(*) FROM user_requests\n```\nResultado: 560.727 filas.\n\n" +
		"```harness\nmake harness-caso TARGET=local CASOS='ingreso=0'\n```\n" +
		"Resultado: salen 7 entidades.\n\n- Un ejemplo `<div>` entre comillas no es HTML.\n- [CORE-431](jira:CORE-431) · [PR](pr:legacy-backend#1140) · [doc](https://example.com/x.json)\n" +
		"- El diseño: [Completa tu solicitud](visor:credifamilia/381-1052@52065d0ce692) · [sin huella](visor:motai-renting/1176-2003)"
	e, warnings, err := prepare(t, body)
	if err != nil || len(warnings) > 0 {
		t.Fatalf("err=%v warnings=%v", err, warnings)
	}
	if !strings.Contains(e.Body, "(repo:legacy-backend@cfc577218f2d/tests/CreatesApplication.php#L12)") {
		t.Fatalf("el archivo no quedó fijado a su commit: %s", e.Body)
	}
	if e.Schema != BlockSchema || e.Via != "manual" || !strings.HasPrefix(e.ID, "blk_") || e.At != "2026-09-23T15:00:00-05:00" {
		t.Fatalf("faltan los internos: %+v", e)
	}
}

func TestAStoredBlockMustCarryTheCommitOfEveryFile(t *testing.T) {
	e := Event{Schema: BlockSchema, ID: "blk_x", At: "2026-09-23T15:00:00-05:00", Via: "manual", Title: "Un título",
		Body: "Ver [el archivo](repo:legacy-backend/tests/CreatesApplication.php)."}
	if err := ValidateBlock(e); err == nil || !strings.Contains(err.Error(), "fijado") {
		t.Fatalf("aceptó en la pila un archivo sin commit: %v", err)
	}
	e.Body = "Ver [el archivo](repo:legacy-backend@cfc577218f2d/tests/CreatesApplication.php)."
	if err := ValidateBlock(e); err != nil {
		t.Fatal(err)
	}
}

func TestPrepareChecksTheWorldBeforeWriting(t *testing.T) {
	existing := []Event{{ID: "blk_anterior"}}
	deps := BlockDeps{Files: repos, Existing: existing, Canon: func(_ context.Context, refs []string) ([]string, error) {
		var missing []string
		for _, r := range refs {
			if r == "nada" {
				missing = append(missing, "nada (no existe en Canon)")
			}
		}
		return missing, nil
	}}
	run := func(body string) error {
		_, _, err := PrepareBlock(context.Background(), "Un título", body, "", deps, blockNow)
		return err
	}
	if err := run("Ver [x](repo:legacy-backend/app/NoExiste.php)."); err == nil || !strings.Contains(err.Error(), "no existe") {
		t.Fatalf("aceptó un archivo que no existe: %v", err)
	}
	if err := run("Ver [x](canon:nada)."); err == nil || !strings.Contains(err.Error(), "canon:nada") {
		t.Fatalf("aceptó un tema de canon que no existe: %v", err)
	}
	if err := run("Corrige al [anterior](bloque:blk_otro)."); err == nil {
		t.Fatal("aceptó un bloque citado que no está en la pila")
	}
	if err := run("Corrige al [anterior](bloque:blk_anterior)."); err != nil {
		t.Fatal(err)
	}
	if err := run("Ver [el PR](pr:desconocido#3)."); err == nil {
		t.Fatal("aceptó un PR de un repo que no se puede citar")
	}
	if _, _, err := PrepareBlock(context.Background(), "Un título", "Algo.", "a-mano", deps, blockNow); err == nil {
		t.Fatal("aceptó un via inventado")
	}
}

func TestCanonDownIsAWarningNotARejection(t *testing.T) {
	deps := BlockDeps{Files: repos, Canon: func(context.Context, []string) ([]string, error) {
		return nil, errors.New("sin red")
	}}
	e, warnings, err := PrepareBlock(context.Background(), "Un título", "El [listado](canon:listado) manda.", "", deps, blockNow)
	if err != nil || len(warnings) != 1 || e.ID == "" {
		t.Fatalf("err=%v warnings=%v", err, warnings)
	}
}

func TestHasCommandSeesOnlyCommandsNotMaterial(t *testing.T) {
	material := Event{Body: "Así queda el payload:\n\n```json\n{\"a\": 1}\n```"}
	command := Event{Body: "```sh\nmake cierre\n```\nResultado: todo en orden."}
	if HasCommand([]Event{material}) {
		t.Fatal("un JSON de ejemplo no es un comando")
	}
	if !HasCommand([]Event{material, command}) {
		t.Fatal("no vio el comando")
	}
}
