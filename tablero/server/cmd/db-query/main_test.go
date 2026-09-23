package main

import (
	"context"
	"strings"
	"testing"
	"time"

	"creditop/tablero/server/internal/dbquery"
	"creditop/tablero/server/internal/taskcontext"
)

// El bloque de una consulta: una fila chica va entera en el título —es la respuesta—, la consulta en su
// caja con el ambiente, y debajo lo que dio. Y lo acepta el validador de la pila, que es el que manda.
func TestTheQueryBlockIsOneTheStackAccepts(t *testing.T) {
	cases := []struct {
		rows        []dbquery.Row
		title, want string
	}{
		{[]dbquery.Row{{"solicitudes": 560727}}, "# solicitudes = 560727 en `prod`", "Resultado: solicitudes = 560727."},
		{nil, "# Cero filas en `prod`", "Resultado: cero filas."},
		{[]dbquery.Row{{"n": 1}, {"n": 2}}, "# 2 fila(s) en `prod`", "Resultado: 2 filas: (n = 1); (n = 2)."},
	}
	for _, c := range cases {
		md := blockMarkdown(dbquery.Result{Target: "prod", Rows: c.rows}, "SELECT count(*) AS solicitudes FROM user_requests")
		if !strings.HasPrefix(md, c.title+"\n") || !strings.Contains(md, "```sql prod\nSELECT count(*)") || !strings.Contains(md, c.want) {
			t.Fatalf("md = %q", md)
		}
		title, body, err := taskcontext.ParseBlockMarkdown(md)
		if err != nil {
			t.Fatal(err)
		}
		if _, _, err := taskcontext.PrepareBlock(context.Background(), title, body, "db", taskcontext.BlockDeps{}, time.Now()); err != nil {
			t.Fatalf("la pila lo rechaza: %v\n%s", err, md)
		}
	}
}
