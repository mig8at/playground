package canon

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// canonDouble es un canon de mentira que anota qué pedidos recibió, para comprobar CÓMO se le habla.
type canonDouble struct {
	mu       sync.Mutex
	requests []string
	patch    map[string]any
	ifMatch  string
	server   *httptest.Server
}

func newCanonDouble(t *testing.T) *canonDouble {
	t.Helper()
	t.Setenv("CANON_WRITE_KEY", "llave-de-prueba")
	double := &canonDouble{}
	double.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		double.mu.Lock()
		defer double.mu.Unlock()
		double.requests = append(double.requests, r.Method+" "+r.URL.Path)
		if r.Header.Get("Authorization") != "Bearer llave-de-prueba" {
			t.Errorf("%s %s sin la llave de escritura", r.Method, r.URL.Path)
		}
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/api/draft":
			_, _ = w.Write([]byte(`{"draft_id":"d1"}`))
		case r.Method == http.MethodPost && r.URL.Path == "/api/draft/d1":
			_, _ = w.Write([]byte(`{"ok":true,"operacion":"verificado","releidos":["a.php","b.php"],"archivos_nota":"sin archivos"}`))
		case r.Method == http.MethodPost && r.URL.Path == "/api/draft/d1/close":
			_, _ = w.Write([]byte(`{"ok":true,"revision":201}`))
		case r.Method == http.MethodDelete && r.URL.Path == "/api/draft/d1":
			_, _ = w.Write([]byte(`{"ok":true}`))
		case r.Method == http.MethodPost && r.URL.Path == "/api/patch":
			double.ifMatch = r.Header.Get("If-Match")
			payload, _ := io.ReadAll(r.Body)
			_ = json.Unmarshal(payload, &double.patch)
			_, _ = w.Write([]byte(`{"ok":true,"dry_run":true,"files":[{"accion":"modificado","path":"content/infraestructura/map.json"}],"diff":{"content/infraestructura/map.json":"- a\n+ b"},"sha256":"nuevo"}`))
		default:
			t.Errorf("pedido inesperado: %s %s", r.Method, r.URL.Path)
		}
	}))
	t.Cleanup(double.server.Close)
	return double
}

func (d *canonDouble) saw(request string) bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	for _, seen := range d.requests {
		if seen == request {
			return true
		}
	}
	return false
}

func TestDryWriteSendsThePiecesAndNeverCloses(t *testing.T) {
	double := newCanonDouble(t)
	pieces := []Piece{{"node": "cartera/context", "operacion": "verificado"}}

	written, err := New(double.server.URL).DryWrite(context.Background(), "Miguel Ochoa", pieces)
	if err != nil {
		t.Fatal(err)
	}
	if !written.Dry || written.Revision != 0 {
		t.Fatalf("un ensayo no deja revisión: %+v", written)
	}
	if len(written.Pieces) != 1 || written.Pieces[0].Reread != 2 || written.Pieces[0].Notes["archivos_nota"] == "" {
		t.Fatalf("el ensayo tiene que traer lo que canon contestó de la pieza: %+v", written.Pieces)
	}
	if double.saw("POST /api/draft/d1/close") {
		t.Fatal("un ensayo NO cierra el borrador: dejaría una revisión en el corpus")
	}
	if !double.saw("DELETE /api/draft/d1") {
		t.Fatal("un ensayo tiene que abandonar el borrador, o queda vivo en la memoria de canon")
	}
}

func TestWriteStillClosesTheDraft(t *testing.T) {
	double := newCanonDouble(t)

	written, err := New(double.server.URL).Write(context.Background(), "Miguel Ochoa", "título", []Piece{{"node": "cartera/context"}})
	if err != nil {
		t.Fatal(err)
	}
	if written.Dry || written.Revision != 201 || !double.saw("POST /api/draft/d1/close") {
		t.Fatalf("dictar tiene que cerrar y devolver la revisión: %+v", written)
	}
	if double.saw("DELETE /api/draft/d1") {
		t.Fatal("un cierre bueno no abandona el borrador")
	}
}

func TestPatchSendsTheBaseAsPreconditionAndAsDigest(t *testing.T) {
	double := newCanonDouble(t)
	text := "{}\n"

	patched, err := New(double.server.URL).Patch(context.Background(), PatchRequest{
		Author: "Miguel Ochoa",
		Reason: "reapuntar fuentes",
		Base:   PatchBase{ETag: `"abc"`, SHA256: "base-sha"},
		Files:  map[string]*string{"content/infraestructura/map.json": &text},
		DryRun: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if double.ifMatch != `"abc"` || double.patch["base_sha256"] != "base-sha" || double.patch["dry_run"] != true {
		t.Fatalf("la base viaja en If-Match y en base_sha256, y el ensayo en dry_run: %q %+v", double.ifMatch, double.patch)
	}
	if !patched.DryRun || len(patched.Files) != 1 || patched.Files[0].Action != "modificado" ||
		!strings.Contains(patched.Diff["content/infraestructura/map.json"], "+ b") {
		t.Fatalf("falta lo que canon dijo que haría: %+v", patched)
	}
}

func TestPatchRefusesToGuessTheBase(t *testing.T) {
	double := newCanonDouble(t)

	_, err := New(double.server.URL).Patch(context.Background(), PatchRequest{Reason: "x", Files: map[string]*string{"content/a/map.json": nil}})
	if err == nil {
		t.Fatal("sin base no hay parche: el servidor no podría detectar que se editó sobre una copia vieja")
	}
	if len(double.requests) != 0 {
		t.Fatalf("no tenía que llamar a canon: %v", double.requests)
	}
}

func TestPatchExplainsARefusal(t *testing.T) {
	t.Setenv("CANON_WRITE_KEY", "llave-de-prueba")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusPreconditionFailed)
		_, _ = w.Write([]byte(`{"error":"la revisión cambió desde el export"}`))
	}))
	defer server.Close()

	_, err := New(server.URL).Patch(context.Background(), PatchRequest{
		Reason: "x",
		Base:   PatchBase{ETag: `"abc"`, SHA256: "base"},
		Files:  map[string]*string{"content/a/map.json": nil},
	})
	if err == nil || !strings.Contains(err.Error(), "la revisión cambió desde el export") {
		t.Fatalf("el rechazo de canon tiene que llegar al que corrió el comando: %v", err)
	}
}

func TestClonesReadsTheCommitOfEachRepo(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/clones" {
			t.Errorf("ruta = %s", r.URL.Path)
		}
		_, _ = w.Write([]byte(`{"repos":[{"repo":"Creditop-SAS/legacy-backend","commit":"29226e81764b","estado":"al_dia"},{"repo":"Creditop-SAS/infrastructure","commit":"3cbeaab21fd7","estado":"al_dia"}]}`))
	}))
	defer server.Close()

	clones, err := New(server.URL).Clones(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(clones) != 2 || clones[0].Repo != "Creditop-SAS/legacy-backend" || clones[0].Commit != "29226e81764b" || clones[0].State != "al_dia" {
		t.Fatalf("clones = %+v", clones)
	}
}

func TestSyncClonesAsksForOneRepoWithTheWriteKey(t *testing.T) {
	t.Setenv("CANON_WRITE_KEY", "llave-de-prueba")
	var asked map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/clones/sync" || r.Header.Get("Authorization") != "Bearer llave-de-prueba" {
			t.Errorf("pedido inesperado: %s %s", r.Method, r.URL.Path)
		}
		payload, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(payload, &asked)
		w.WriteHeader(http.StatusAccepted)
		_, _ = w.Write([]byte(`{"ok":true,"repos":1}`))
	}))
	defer server.Close()

	if err := New(server.URL).SyncClones(context.Background(), "Creditop-SAS/legacy-backend"); err != nil {
		t.Fatal(err)
	}
	if asked["repo"] != "Creditop-SAS/legacy-backend" {
		t.Fatalf("pidió %+v", asked)
	}
}

func TestSyncClonesExplainsWhyItCouldNot(t *testing.T) {
	t.Setenv("CANON_WRITE_KEY", "llave-de-prueba")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusConflict)
		_, _ = w.Write([]byte(`{"error":"ya hay una sincronización en curso"}`))
	}))
	defer server.Close()

	err := New(server.URL).SyncClones(context.Background(), "")
	if err == nil || !strings.Contains(err.Error(), "ya hay una sincronización en curso") {
		t.Fatalf("el motivo tiene que llegar: %v", err)
	}
}

func TestRoundListsTheChangedFilesByTopic(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("force") != "1" {
			t.Errorf("pidió sin force: %s", r.URL.String())
		}
		_, _ = w.Write([]byte(`{"declared":1667,"up_to_date":false,"round":{"topics":[{"topic":"servicios","areas":[{"changes":[{"repo":"legacy-backend","path":"Modules/BroadcastV1/README.md","before":"405461569588","now":"09b3d1a7a737"}]}]}]}}`))
	}))
	defer server.Close()

	round, err := New(server.URL).Round(context.Background(), true)
	if err != nil {
		t.Fatal(err)
	}
	if round.UpToDate || round.Declared != 1667 || len(round.Changes) != 1 ||
		round.Changes[0].Topic != "servicios" || round.Changes[0].Now != "09b3d1a7a737" {
		t.Fatalf("round = %+v", round)
	}
}
