package dbquery

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestValidateReadOnly(t *testing.T) {
	for _, query := range []string{
		"SELECT id FROM user_requests",
		"WITH recientes AS (SELECT id FROM user_requests) SELECT * FROM recientes",
		"SELECT REPLACE(name, 'a', 'b') FROM lenders",
	} {
		if err := ValidateReadOnly(query); err != nil {
			t.Fatalf("%q: %v", query, err)
		}
	}
	for _, query := range []string{
		"DELETE FROM users",
		"SELECT * INTO OUTFILE '/tmp/a' FROM users",
		"SELECT 1; DELETE FROM users",
	} {
		if err := ValidateReadOnly(query); err == nil {
			t.Fatalf("aceptó %q", query)
		}
	}
}

func TestQueryRedashUsesTheExplicitQuery(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/query_results" || r.Method != http.MethodPost {
			t.Fatalf("request inesperado: %s %s", r.Method, r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Key token-de-prueba" {
			t.Fatalf("authorization = %q", r.Header.Get("Authorization"))
		}
		var body struct {
			Query        string `json:"query"`
			DataSourceID int    `json:"data_source_id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body.Query != "SELECT id FROM lenders" || body.DataSourceID != 7 {
			t.Fatalf("body = %+v", body)
		}
		_, _ = w.Write([]byte(`{"query_result":{"data":{"rows":[{"id":77,"name":"Prueba"}]}}}`))
	}))
	defer server.Close()

	result, err := Query(context.Background(), Config{
		Target: "prod", RedashURL: server.URL, RedashToken: "token-de-prueba", RedashDataSource: 7,
	}, "SELECT id FROM lenders")
	if err != nil {
		t.Fatal(err)
	}
	if result.Target != "prod" || result.Source != "redash" || len(result.Rows) != 1 || result.Rows[0]["name"] != "Prueba" {
		t.Fatalf("result = %+v", result)
	}
	if got := strings.Join(Columns(result.Rows), ","); got != "id,name" {
		t.Fatalf("columns = %s", got)
	}
}
