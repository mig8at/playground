package main

// Una consulta que falla tiene que dejar dicho que falló. Hasta el 2026-09-25 el perfilamiento, las
// categorías, Deceval, el canal Corbeta, el historial y el buró devolvían vacío ante un error, y un vacío
// por error se lee igual que «no pasó»: el diagnóstico equivocado más caro de esta herramienta.

import (
	"errors"
	"strings"
	"testing"
	"time"

	dbsql "creditop/playground/connectors/sql"
)

// failingSource contesta la solicitud y falla en todo lo demás.
type failingSource struct{}

func (failingSource) Rows(query string, args ...any) ([]dbsql.Row, error) {
	if query == sqlLoanRequest {
		return []dbsql.Row{{"user_id": int64(7), "st": int64(11), "status": "Autorizada", "created_at": "2026-09-25 10:00:00"}}, nil
	}
	return nil, errors.New("timeout de la fuente")
}
func (failingSource) Name() string         { return "falla" }
func (failingSource) Zone() *time.Location { return time.UTC }
func (failingSource) Close()               {}

func TestAFailedLookupIsAWarningNotAnAbsence(t *testing.T) {
	s, err := GetLoanRequest(failingSource{}, 42)
	if err != nil {
		t.Fatalf("la solicitud sí se leyó: %v", err)
	}
	if len(s.Unread) == 0 {
		t.Fatal("fallaron el historial, el buró y el perfilamiento, y no quedó anotado nada")
	}
	for _, what := range []string{"historial", "buró", "perfilamiento"} {
		if !strings.Contains(strings.Join(s.Unread, " · "), what) {
			t.Errorf("no anotó que falló %s: %v", what, s.Unread)
		}
	}
	if _, err := GetCategories(failingSource{}, 7, time.Now().Add(-time.Hour), time.Now(), time.Time{}); err == nil {
		t.Error("GetCategories escondió el error de la fuente")
	}
	if _, err := GetDeceval(failingSource{}, 42); err == nil {
		t.Error("GetDeceval escondió el error de la fuente")
	}
	if _, err := GetCorbetaAllieds(failingSource{}); err == nil {
		t.Error("GetCorbetaAllieds escondió el error de la fuente")
	}
	if p, err := GetProfiling(failingSource{}, 42); err == nil || p != nil {
		t.Error("GetProfiling escondió el error de la fuente")
	}
}
