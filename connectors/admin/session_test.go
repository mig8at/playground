package admin

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func isolatedSessionRoot(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "connectors", "env"), 0700); err != nil {
		t.Fatal(err)
	}
	t.Chdir(root)
	t.Setenv("PLAYGROUND_ROOT", root)
	return root
}

func TestSessionMigratesOnceAndLogoutDoesNotReviveBackup(t *testing.T) {
	root := isolatedSessionRoot(t)
	base, _ := BaseFor("local")
	s := StoredSession{Version: 1, Kind: "admin", Target: "local", User: "fixture@example.test", Origin: base, Cookies: []StoredCookie{}}
	legacy := filepath.Join(root, "harness", ".auth", "sessions", "admin-local.json")
	if err := os.MkdirAll(filepath.Dir(legacy), 0700); err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(s)
	if err := os.WriteFile(legacy, raw, 0600); err != nil {
		t.Fatal(err)
	}
	got, err := ReadSession("local")
	if err != nil || got == nil || got.User != s.User {
		t.Fatalf("migration: %v %v", got, err)
	}
	path, _ := sessionPath("local")
	if info, err := os.Stat(path); err != nil || info.Mode().Perm() != 0600 {
		t.Fatalf("private session: %v %v", info, err)
	}
	if _, err := os.Stat(legacy); err != nil {
		t.Fatalf("backup removed: %v", err)
	}
	removed, err := RemoveSession("local")
	if !removed || err != nil {
		t.Fatalf("logout: %v %v", removed, err)
	}
	if got, err = ReadSession("local"); got != nil || err != nil {
		t.Fatalf("revived backup: %v %v", got, err)
	}
	if _, err := WriteSession(&s); err != nil {
		t.Fatal(err)
	}
	if got, err = ReadSession("local"); got == nil || err != nil {
		t.Fatalf("new login: %v %v", got, err)
	}
}

func TestSessionRejectsMismatchedMetadataAndTraversal(t *testing.T) {
	root := isolatedSessionRoot(t)
	dir := filepath.Join(root, "connectors", ".auth", "sessions")
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	raw := []byte(`{"version":1,"kind":"advisor","target":"local","origin":"https://other.test","user":"fixture","cookies":[]}`)
	if err := os.WriteFile(filepath.Join(dir, "admin-local.json"), raw, 0600); err != nil {
		t.Fatal(err)
	}
	if got, err := ReadSession("local"); got != nil || err != nil {
		t.Fatalf("wrong identity: %v %v", got, err)
	}
	if _, err := sessionPath("../../outside"); err == nil {
		t.Fatal("path traversal accepted")
	}
}
