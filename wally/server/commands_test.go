package main

import (
	"context"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// La lista blanca es lo único que decide qué se corre: los comandos de sólo lectura de WALLY.md, con argumentos
// validados, y nada más. Un intento de colar otra cosa (un ;, un $(…), un |, una ruta, otro target, otro programa)
// no pasa.
func TestOnlyTheWhitelistedReadOnlyCommandsPass(t *testing.T) {
	for _, cmd := range []string{
		"make knowledge-map",
		"make  knowledge-search   Q='cupo mensual'",
		`make knowledge-search Q="lender listing"`,
		"make knowledge-read ID=creditopx-quota",
		"make knowledge-read ID='creditopx-quota#el-cupo-es-una-bolsa'",
		"make tasks",
		"commands", "commands harness", "traps", "trap F-162", "guide jarvis",
		"changes", "sources creditopx-offer-calculation",
		"diff creditopx-offer-calculation legacy-backend:Modules/Loans/App/Support/CutoffCalendar.php",
		"code legacy-backend:Modules/Loans/App/Support/CutoffCalendar.php",
		"code legacy-backend:Modules/Loans/App/Support/CutoffCalendar.php:228-262",
		"grep legacy-application:app/Http/Controllers/Admin/CreditopXPaymentController.php 'nextPaymentDate'",
	} {
		if _, err := commandArgs(cmd); err != nil {
			t.Errorf("%q tenía que pasar: %v", cmd, err)
		}
	}
	for _, bad := range []string{
		"make knowledge-read ID=x; rm -rf ~",
		"make knowledge-read ID=$(whoami)",
		"make knowledge-search Q='a' | sh",
		"make knowledge-search Q='a'; curl x'",
		"make knowledge-search Q='$(id)'",
		"make knowledge-read ID=../../etc/passwd",
		"make knowledge-read ID=X",
		"make cockpit",
		"make knowledge-drift STEP=aplicar",
		"make tasks N=1; rm -rf ~",
		"cat knowledge/business-overview.md",
		"rm -rf /",
		"make knowledge-map && make cockpit",
		"guide ../../connectors/.env",
		"guide jarvis; ls",
		"trap F-1; ls",
		"trap ../doc",
		"commands $(id)",
		"commands a b",
		"code legacy-backend:../../.ssh/id_rsa",
		"code legacy-backend:/etc/passwd",
		"code legacy-backend:a.php; ls",
		"code legacy-backend:$(id)",
		"code legacy-backend:a.php:1-2; ls",
		"grep legacy-backend:a.php '$(id)'",
		"grep legacy-backend:a.php 'x'; rm -rf ~",
		"grep legacy-backend:../a.php 'x'",
		"diff tema legacy-backend:x | sh",
		"sources ../connectors",
		"task ../connectors",
		"sentinel signal credifamilia",
		"sentinel day ayer",
		"sentinel deploy legacy-backend; ls",
		"sentinel deploy ../x",
		"task 7/context.jsonl",
		"task 7; cat ~/.ssh/id_rsa",
	} {
		if args, err := commandArgs(bad); err == nil {
			t.Errorf("%q tenía que rechazarse y dio %v", bad, args)
		}
	}
}

// Las guías y las trampas leen SÓLO de su lista fija: una guía que no existe dice cuáles hay, y una trampa es su
// sección, hasta la siguiente.
func TestGuidesAndTrapsReadOnlyTheirFixedFiles(t *testing.T) {
	root := t.TempDir()
	write := func(path, text string) {
		os.MkdirAll(filepath.Dir(filepath.Join(root, path)), 0o755)
		os.WriteFile(filepath.Join(root, path), []byte(text), 0o600)
	}
	write("jarvis/CLAUDE.md", "# Jarvis\nla guía")
	write(trapsFile, "# Trampas\n## Índice · ¿con qué síntoma llegás?\n| síntoma | F-2 |\n## Otra cosa\n### F-1 · Uno\ncausa uno\n### F-2 · Dos\ncausa dos\n### F-3 · Tres\n")
	a := &app{root: root}
	run := func(cmd string) string {
		entry, m, err := match(cmd)
		if err != nil {
			t.Fatalf("%q: %v", cmd, err)
		}
		out, _, err := entry.run(context.Background(), a, m)
		if err != nil {
			t.Fatalf("%q: %v", cmd, err)
		}
		return out
	}
	if got := run("guide jarvis"); !strings.Contains(got, "la guía") {
		t.Errorf("guide jarvis: %q", got)
	}
	if got := run("guide tesoro"); !strings.Contains(got, "las que hay") {
		t.Errorf("una guía que no existe tiene que decir cuáles hay: %q", got)
	}
	if got := run("traps"); !strings.Contains(got, "F-2 |") || strings.Contains(got, "Otra cosa") {
		t.Errorf("traps tiene que ser sólo el índice: %q", got)
	}
	if got := run("trap F-2"); got != "### F-2 · Dos\ncausa dos" {
		t.Errorf("trap F-2: %q", got)
	}
	// Una tarea: su task.md por número o por slug, y nunca la pila de al lado.
	write(tasksDir+"/una-tarea/task.md", "---\nid: 7\ntitle: Una\n---\n## Objetivo\nel plan")
	write(tasksDir+"/una-tarea/context.jsonl", `{"secreto":"pila"}`)
	for _, cmd := range []string{"task 7", "task una-tarea"} {
		if got := run(cmd); !strings.Contains(got, "el plan") || strings.Contains(got, "pila") {
			t.Errorf("%s: %q", cmd, got)
		}
	}
	if got := run("task 70"); !strings.Contains(got, "no hay una tarea") {
		t.Errorf("task 70 no existe: %q", got)
	}
}

// Los comandos se leen de los bloques ```command, uno por línea; los que no están en la lista quedan «not-allowed».
func TestCommandsAreReadFromCommandBlocks(t *testing.T) {
	answer := "Necesito ver dos temas:\n\n```command\nmake knowledge-read ID=creditopx-quota\n$ trampa F-162\nrm -rf ~\n```\n\nY este código no:\n```bash\nmake knowledge-map\n```"
	got := parseCommands(answer)
	if len(got) != 3 {
		t.Fatalf("quería 3 comandos, salieron %d: %+v", len(got), got)
	}
	if got[0].Status != "proposed" || got[1].Status != "proposed" || got[1].Cmd != "trap F-162" {
		t.Errorf("los dos primeros: %+v %+v", got[0], got[1])
	}
	if got[2].Status != "not-allowed" || got[2].Reason == "" {
		t.Errorf("rm -rf tenía que quedar not-allowed: %+v", got[2])
	}
	if modeCommands("", answer) != nil {
		t.Error("en un chat sin modo no se leen comandos")
	}
}

// De `bin/sentinel deploy` no viaja el texto de los errores nuevos del front: sólo cuántos son.
func TestSentinelDropsFrontErrorTexts(t *testing.T) {
	in := "Empeoró (1 de 9 señales):\n  ✗ algo\n\nErrores del front NUEVOS (no aparecieron en los 7 días de antes):\n  ✗ 12 × TypeError: tel 3001234567\n  ✗ 3 × otro\n\nOjo: …"
	got := withoutFrontErrorTexts(in)
	if strings.Contains(got, "3001234567") || strings.Contains(got, "otro") || !strings.Contains(got, "2 mensaje(s)") || !strings.Contains(got, "  ✗ algo") || !strings.Contains(got, "Ojo") {
		t.Errorf("salida: %q", got)
	}
	// Lo de la carpeta de pruebas pasa la lista: si no, un archivo o un parche bien formado queda «no permitido» al
	// guardarlo (pasó con «parchar»: su expresión tenía una barra de más y Smeargle tuvo que reescribir todo).
	// La consola acepta cualquier texto de comando (corre adentro del contenedor), pero sólo sobre un proyecto de pruebas.
	for _, bad := range []string{"console ~/.ssh cat id_rsa", "console sandbox/../wally ls", "console sandbox/demo", "console sandbox/Demo ls", "console /etc ls"} {
		if _, err := commandArgs(bad); err == nil {
			t.Errorf("%q tenía que rechazarse", bad)
		}
	}
	for _, ok := range []string{"write sandbox/demo/index.html", "patch sandbox/demo/css/base.css", "list pruebas", "list sandbox/demo", "read sandbox/demo/app.js", "check sandbox/demo", "check sandbox/demo/otra.html"} {
		if _, err := commandArgs(ok); err != nil {
			t.Errorf("%q tenía que pasar: %v", ok, err)
		}
	}
	for _, ok := range []string{"sentinel now", "sentinel day", "sentinel day 2026-11-12", "sentinel deploy legacy-backend", "sentinel deploy frontend-monorepo v1.11.12"} {
		if _, err := commandArgs(ok); err != nil {
			t.Errorf("%q tenía que pasar: %v", ok, err)
		}
	}
}

// Las habilidades y la lista blanca dicen lo mismo: cada comando de ejemplo de wally/skills/*.md pasa la lista, cada
// habilidad tiene su línea de índice, y `help` devuelve el índice o la habilidad.
func TestSkillsMatchTheAllowList(t *testing.T) {
	a := &app{root: filepath.Join("..", "..")}
	list := a.skills()
	if len(list) < 5 {
		t.Fatalf("leí %d habilidades de wally/skills", len(list))
	}
	block := regexp.MustCompile("(?s)```command\\n(.*?)\\n```")
	for _, s := range list {
		if s.About == "" || strings.Contains(s.About, "#") {
			t.Errorf("%s: su primera línea tiene que ser `# %s: para qué sirve`", s.Name, s.Name)
		}
		text, exit, _ := a.skillHelp(s.Name)
		if exit != 0 {
			t.Errorf("help %s: %s", s.Name, text)
		}
		for _, m := range block.FindAllStringSubmatch(text, -1) {
			for _, line := range strings.Split(m[1], "\n") {
				if line = strings.TrimSpace(line); line == "" {
					continue
				}
				if _, err := commandArgs(line); err != nil {
					t.Errorf("%s: el ejemplo %q no pasa la lista blanca: %v", s.Name, line, err)
				}
			}
		}
	}
	if idx, _, _ := a.skillHelp(""); !strings.Contains(idx, "`"+list[0].Name+"`") {
		t.Errorf("el índice no nombra las habilidades: %q", idx)
	}
	if text, exit, _ := a.skillHelp("no-existe"); exit == 0 || !strings.Contains(text, "las que hay") {
		t.Errorf("una habilidad que no existe tiene que decir cuáles hay: %q", text)
	}
	for _, ok := range []string{"help", "help traps", "help knowledge-sync"} {
		if _, err := commandArgs(ok); err != nil {
			t.Errorf("%q tenía que pasar: %v", ok, err)
		}
	}
	for _, bad := range []string{"help ../WALLY", "help trampas; ls", "help Trampas"} {
		if _, err := commandArgs(bad); err == nil {
			t.Errorf("%q tenía que rechazarse", bad)
		}
	}
}
