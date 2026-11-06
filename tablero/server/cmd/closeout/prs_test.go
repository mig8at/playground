package main

import (
	"errors"
	"reflect"
	"testing"
)

const prsBody = `
## Pendientes

- [x] ~~Mergear [legacy-application#348](pr:application#348)~~ — hecho.
- [ ] Revisar y mergear [legacy-application#345](pr:application#345) y
      [legacy-backend#1806](pr:legacy-backend#1806).
- [ ] Mergear frontend-monorepo#1314 y el #1670 suelto, que no dice de qué repo es.
- [ ] Mock: [lamba#11](https://github.com/Creditop-SAS/credifamilia-mockery-lamba/pull/11).

## Objetivo

- [ ] Esto no es un pendiente: está fuera de la sección (legacy-backend#9).
`

func TestOpenPendingItems(t *testing.T) {
	got := openPendingItems(prsBody)
	if len(got) != 3 {
		t.Fatalf("esperaba 3 pendientes abiertos, hubo %d: %q", len(got), got)
	}
	if want := "- [ ] Revisar y mergear [legacy-application#345](pr:application#345) y [legacy-backend#1806](pr:legacy-backend#1806)."; got[0] != want {
		t.Fatalf("la continuación no se unió:\n got %q\nwant %q", got[0], want)
	}
}

func TestPRRefsIn(t *testing.T) {
	aliases := map[string]string{
		"application":       "Creditop-SAS/legacy-application",
		"legacy-backend":    "Creditop-SAS/legacy-backend",
		"frontend-monorepo": "Creditop-SAS/frontend-monorepo",
	}
	names := map[string]string{"legacy-application": "Creditop-SAS/legacy-application"}
	items := openPendingItems(prsBody)

	got := prRefsIn(items[0], aliases, names)
	want := []prRef{{"Creditop-SAS/legacy-application", "345"}, {"Creditop-SAS/legacy-backend", "1806"}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("pr: y repo#N repetidos:\n got %v\nwant %v", got, want)
	}
	if got := prRefsIn(items[1], aliases, names); !reflect.DeepEqual(got, []prRef{{"Creditop-SAS/frontend-monorepo", "1314"}}) {
		t.Fatalf("un #N suelto no tiene repo y no cuenta: %v", got)
	}
	if got := prRefsIn(items[2], aliases, names); !reflect.DeepEqual(got, []prRef{{"Creditop-SAS/credifamilia-mockery-lamba", "11"}}) {
		t.Fatalf("la URL lleva su repo aunque no sea de la lista: %v", got)
	}
}

func TestAcknowledgesMerge(t *testing.T) {
	for item, want := range map[string]bool{
		"- [ ] Mock: [x#11](https://github.com/o/x/pull/11) (mergeado) agrega el dictado; falta infra":     true,
		"- [ ] Llevar a producción el redirect — `legacy-application#169` ya está en `main` y falta verlo": true,
		"- [ ] Revisar y mergear legacy-application#345":                                                   false,
	} {
		if got := acknowledgesMerge(item); got != want {
			t.Errorf("acknowledgesMerge(%q) = %v, want %v", item, got, want)
		}
	}
}

func TestStalePRs(t *testing.T) {
	tasks := []task{
		{Slug: "abierta", ID: 108, Body: prsBody},
		{Slug: "archivada", ID: 50, Body: prsBody, Archived: true},
	}
	aliases := map[string]string{"application": "Creditop-SAS/legacy-application", "legacy-backend": "Creditop-SAS/legacy-backend"}
	lookup := func(r prRef) (prState, error) {
		switch r.String() {
		case "Creditop-SAS/legacy-application#345":
			return prState{State: "MERGED", Merged: "2026-10-29T12:00:00Z", BaseRef: "develop"}, nil
		case "Creditop-SAS/legacy-backend#1806":
			return prState{State: "OPEN", BaseRef: "qa"}, nil
		}
		return prState{}, errors.New("sin acceso")
	}
	got, failed := stalePRs(tasks, aliases, nil, lookup)
	if failed != 1 { // el del mock, que no está en el lookup
		t.Fatalf("esperaba 1 PR sin consultar, hubo %d", failed)
	}
	if len(got) != 1 || got[0].PR != "Creditop-SAS/legacy-application#345" || got[0].Date != "2026-10-29" || got[0].ID != 108 {
		t.Fatalf("sólo el mergeado de la tarea abierta: %+v", got)
	}
}
