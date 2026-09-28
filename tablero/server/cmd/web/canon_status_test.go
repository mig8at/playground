package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"testing"
	"time"

	"creditop/playground/connectors/canon"
)

func fakeExport(t *testing.T, hits *int) *httptest.Server {
	t.Helper()
	files := map[string]string{"content/kyc/context.md": "# KYC\n"}
	h := sha256.New()
	fmt.Fprintf(h, "%d:%s%d:%s", len("content/kyc/context.md"), "content/kyc/context.md", len(files["content/kyc/context.md"]), files["content/kyc/context.md"])
	sum := hex.EncodeToString(h.Sum(nil))
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		*hits++
		w.Header().Set("ETag", `"`+sum+`"`)
		if r.Header.Get("If-None-Match") == `"`+sum+`"` {
			w.WriteHeader(http.StatusNotModified)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"etag": `"c"`, "sha256": sum, "files": files, "exportado": "2026-09-28T01:00:00Z"})
	}))
}

func statusOf(t *testing.T, a *app, method string) canonStatus {
	t.Helper()
	w := httptest.NewRecorder()
	a.canonStatusHandler(w, httptest.NewRequest(method, "/api/canon/status", nil))
	var s canonStatus
	if err := json.Unmarshal(w.Body.Bytes(), &s); err != nil {
		t.Fatalf("%s: %v %s", method, err, w.Body.String())
	}
	return s
}

func TestCanonStatusKeepsTheCopyAndSaysSo(t *testing.T) {
	hits := 0
	srv := fakeExport(t, &hits)
	dir := t.TempDir()
	now := time.Date(2026, 9, 28, 10, 0, 0, 0, time.UTC)
	a := &app{canonKeeper: newCanonKeeper(canon.New(srv.URL), "x", dir)}
	a.canonKeeper.now = func() time.Time { return now }

	if s := statusOf(t, a, "GET"); s.State != "current" || !s.Updated || s.Files != 1 {
		t.Fatalf("primera revalidación: %+v", s)
	}
	// dentro del minuto no se le vuelve a preguntar a canon
	if s := statusOf(t, a, "GET"); s.State != "current" || hits != 1 {
		t.Fatalf("revalidó antes de tiempo: %+v, %d pedidos", s, hits)
	}
	// POST revalida ya: 304, sigue al día y no dice que trajo algo nuevo
	if s := statusOf(t, a, "POST"); s.State != "current" || s.Updated || hits != 2 {
		t.Fatalf("revalidación forzada: %+v, %d pedidos", s, hits)
	}
	// canon deja de contestar: la copia sigue, marcada con su fecha
	srv.Close()
	now = now.Add(2 * time.Minute)
	if s := statusOf(t, a, "GET"); s.State != "stale" || s.SyncedAt.IsZero() || s.Error == "" {
		t.Fatalf("sin canon: %+v", s)
	}
	// sin copia y sin canon
	b := &app{canonKeeper: newCanonKeeper(canon.New(srv.URL), "x", t.TempDir())}
	if s := statusOf(t, b, "GET"); s.State != "missing" {
		t.Fatalf("sin copia: %+v", s)
	}
}

// Un tema se sirve desde la copia local, con su título, su intro y sus secciones; lo que no está, 404;
// y un id que intente salir de la carpeta no llega a leerse.
func TestCanonTopicReadsTheLocalCopy(t *testing.T) {
	hits := 0
	srv := fakeExport(t, &hits)
	defer srv.Close()
	dir := filepath.Join(t.TempDir(), "canon")
	a := &app{canonKeeper: newCanonKeeper(canon.New(srv.URL), "x", dir)}
	a.canonKeeper.check(0)
	get := func(id string) (int, map[string]any) {
		w := httptest.NewRecorder()
		a.canonTopic(w, httptest.NewRequest("GET", "/api/canon/topic?id="+url.QueryEscape(id), nil))
		var out map[string]any
		json.Unmarshal(w.Body.Bytes(), &out)
		return w.Code, out
	}
	if code, out := get("kyc/context#algo"); code != 200 || out["title"] != "KYC" || out["id"] != "kyc/context" {
		t.Fatalf("tema: %d %v", code, out)
	}
	if code, _ := get("nope"); code != 404 {
		t.Fatalf("tema inexistente: %d", code)
	}
	for _, bad := range []string{"../etc/passwd", "kyc/../../x", "/abs"} {
		if code, _ := get(bad); code != 400 {
			t.Errorf("%q: %d, quería 400", bad, code)
		}
	}
}
