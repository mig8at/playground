package main

import (
	"os"
	"path/filepath"
	"testing"
)

// Una rama declarada que ya no existe se busca en el registro de la limpieza: con `repo:` sólo en ese repo, y por
// subcadena, como al medir.
func TestDeletedMatchingFollowsThePatternRules(t *testing.T) {
	dir := t.TempDir()
	tsv := "repo\trama\tcommit\tmotivo\n" +
		"frontend-monorepo\tfix/cosigner-signature-confirmation\t7d592088d\tsin-pr\n" +
		"legacy-backend\tfix/cosigner-authorization-recovery\t82ec26586\tsin-pr\n" +
		"risk-services-mockery-lambda\tfeat/dictado-compartido\tacb2ebecf\tsin-pr\n"
	if err := os.WriteFile(filepath.Join(dir, "ramas-borradas-2026-11-14.tsv"), []byte(tsv), 0o644); err != nil {
		t.Fatal(err)
	}
	deleted := readDeleted(dir)
	if len(deleted) != 3 || deleted[0].Date != "2026-11-14" {
		t.Fatalf("quería las 3 filas con su fecha: %+v", deleted)
	}
	if got := deletedMatching(deleted, "risk-services-mockery-lambda:dictado-compartido"); len(got) != 1 || got[0].Branch != "feat/dictado-compartido" {
		t.Fatalf("con repo: %+v", got)
	}
	if got := deletedMatching(deleted, "legacy-backend:cosigner"); len(got) != 1 || got[0].Repo != "legacy-backend" {
		t.Fatalf("`repo:` no puede traer la de otro repo: %+v", got)
	}
	if got := deletedMatching(deleted, "cosigner"); len(got) != 2 {
		t.Fatalf("sin repo, en todos: %+v", got)
	}
	if got := deletedMatching(deleted, "no-existe"); len(got) != 0 {
		t.Fatalf("nada que ver: %+v", got)
	}
}
