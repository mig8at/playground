package review

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// Un renombre del --numstat queda con la ruta nueva: con la vieja, ni knowledge ni las trampas lo encuentran.
func TestRenamedTo(t *testing.T) {
	for in, want := range map[string]string{
		"app/A.php":                           "app/A.php",
		"app/{Old => New}/A.php":              "app/New/A.php",
		"app/{ => Sub}/A.php":                 "app/Sub/A.php",
		"old/A.php => new/A.php":              "new/A.php",
		"Modules/X/{OldService.php => S.php}": "Modules/X/S.php",
	} {
		if got := renamedTo(in); got != want {
			t.Errorf("%q → %q, quería %q", in, got, want)
		}
	}
}

// Una trampa cita un archivo con ruta o sólo con su nombre; un nombre que está en todos lados no alcanza.
func TestTrapsCiting(t *testing.T) {
	doc := strings.Join([]string{
		"# Trampas", "## Índice", "| F-1 |", "",
		"### F-1 · Uno", "la causa está en `Modules/Loans/App/Services/LoanService.php:12`",
		"### F-2 · Dos", "y en `TusDatosService.php:195` también",
		"### F-3 · Tres", "algo en `index.ts:3` y en `routes/api.php`",
		"## Otra sección", "`Modules/Loans/App/Services/LoanService.php` fuera de una trampa no cuenta",
	}, "\n")
	files := []string{"Modules/Loans/App/Services/LoanService.php", "Modules/Identity/App/Services/TusDatosService.php",
		"apps/web/index.ts", "Modules/Other/routes/api.php"}
	got := trapsCiting(doc, files)
	ids := []string{}
	for _, h := range got {
		ids = append(ids, h.ID+"="+strings.Join(h.Files, ","))
	}
	want := []string{"F-1=Modules/Loans/App/Services/LoanService.php", "F-2=Modules/Identity/App/Services/TusDatosService.php"}
	if strings.Join(ids, " ") != strings.Join(want, " ") {
		t.Errorf("trampas: %v, quería %v (index.ts es genérico y routes/api.php no coincide con la ruta)", ids, want)
	}
}

// El mapa entero sobre un repo de prueba: una migración lo pone en alto; la dependencia y los arreglos se cuentan sin
// pruebas, migraciones ni merges.
func TestAssess(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("sin git")
	}
	repo := t.TempDir()
	run := func(args ...string) {
		t.Helper()
		cmd := exec.Command("git", append([]string{"-C", repo, "-c", "user.email=t@t", "-c", "user.name=t"}, args...)...)
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %s", args, out)
		}
	}
	write := func(path, body string) {
		t.Helper()
		full := filepath.Join(repo, path)
		_ = os.MkdirAll(filepath.Dir(full), 0o755)
		if err := os.WriteFile(full, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	run("init", "-q", "-b", "main")
	write("app/Services/PaymentCore.php", "<?php class PaymentCore {}\n")
	for i := 0; i < 6; i++ {
		write(filepath.Join("app/Uses", "U"+string(rune('a'+i))+".php"), "<?php use PaymentCore; new PaymentCore;\n")
	}
	write("tests/PaymentCoreTest.php", "<?php // PaymentCore\n")
	run("add", "-A")
	run("commit", "-q", "-m", "init")
	for i := 0; i < 3; i++ {
		write("app/Services/PaymentCore.php", "<?php class PaymentCore { /* "+string(rune('a'+i))+" */ }\n")
		run("commit", "-q", "-am", "fix: arreglo "+string(rune('a'+i)))
	}
	run("update-ref", "refs/remotes/origin/main", "HEAD")
	run("checkout", "-q", "-b", "feat/x")
	write("app/Services/PaymentCore.php", "<?php class PaymentCore { /* cambio */ }\n")
	write("database/migrations/2026_01_01_000000_add.php", "<?php // migración\n")
	run("add", "-A")
	run("commit", "-q", "-m", "feat: el cambio")

	myTools := t.TempDir()
	_ = os.MkdirAll(filepath.Join(myTools, "tools"), 0o755)
	_ = os.WriteFile(filepath.Join(myTools, "tools", "repos.json"), []byte(`{"indexed":{}}`), 0o644)
	_ = os.MkdirAll(filepath.Join(myTools, "knowledge", "traps"), 0o755)
	_ = os.WriteFile(filepath.Join(myTools, "knowledge", "traps", "traps.md"),
		[]byte("# T\n### F-9 · Nueve\nen `app/Services/PaymentCore.php:1`\n"), 0o644)

	im := Assess(context.Background(), myTools, repo, "origin/main", "feat/x")
	if im.Level != "high" || im.Files != 2 {
		t.Fatalf("nivel %q con %d archivos: %+v", im.Level, im.Files, im)
	}
	var core *FileSignal
	for i := range im.Signals {
		if im.Signals[i].Path == "app/Services/PaymentCore.php" {
			core = &im.Signals[i]
		}
	}
	if core == nil || core.FanIn != 6 || core.Fixes90 != 3 {
		t.Fatalf("PaymentCore: %+v (quería 6 que lo nombran —sin la prueba— y 3 arreglos)", core)
	}
	if len(im.Traps) != 1 || im.Traps[0].ID != "F-9" {
		t.Errorf("trampas: %+v", im.Traps)
	}
	md := im.Markdown()
	for _, want := range []string{"Impacto: ALTO", "trae una migración", "F-9 · Nueve", "no se aplican al mergear"} {
		if !strings.Contains(md, want) {
			t.Errorf("el informe no dice %q:\n%s", want, md)
		}
	}
}
