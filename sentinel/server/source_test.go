package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

// De un mensaje con partes variables quedan los tramos fijos, del más largo al más corto.
func TestFixedParts(t *testing.T) {
	got := fixedParts(`OnboardingController::validateAndStorePersonalInfoOrchestrator: storePersonalInfo failed, user 631394 "x"`)
	// primero el comienzo hasta lo variable, acortado palabra por palabra; el nombre del método solo, después
	if len(got) < 3 || got[0] != "OnboardingController::validateAndStorePersonalInfoOrchestrator: storePersonalInfo failed, user" ||
		got[1] != "OnboardingController::validateAndStorePersonalInfoOrchestrator: storePersonalInfo failed" {
		t.Fatalf("tramos: %q", got)
	}
	if len(fixedParts(`123 "ab" 456`)) != 0 {
		t.Fatal("sin un tramo de letras no se busca")
	}
}

// El texto fijo se encuentra en main con su archivo y línea; una prueba no cuenta.
func TestGrepFixed(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("sin git")
	}
	dir := t.TempDir()
	run := func(args ...string) {
		t.Helper()
		if out, err := exec.Command("git", append([]string{"-C", dir, "-c", "user.email=t@t", "-c", "user.name=t"}, args...)...).CombinedOutput(); err != nil {
			t.Fatalf("git %v: %s", args, out)
		}
	}
	run("init", "-q", "-b", "main")
	_ = os.MkdirAll(filepath.Join(dir, "app"), 0o755)
	_ = os.MkdirAll(filepath.Join(dir, "tests"), 0o755)
	_ = os.WriteFile(filepath.Join(dir, "tests", "ATest.php"), []byte("<?php // storePersonalInfo failed\n"), 0o644)
	_ = os.WriteFile(filepath.Join(dir, "app", "A.php"), []byte("<?php\n/** storePersonalInfo failed */\nlog('storePersonalInfo failed');\n"), 0o644)
	run("add", "-A")
	run("commit", "-q", "-m", "x")
	if got := grepFixed(dir, "storePersonalInfo failed"); got != "app/A.php:3" {
		t.Fatalf("encontró %q", got)
	}
	if got := grepFixed(dir, "no está en ningún lado"); got != "" {
		t.Fatalf("no tenía que encontrar: %q", got)
	}
}
