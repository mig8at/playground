package main

import (
	"context"
	"os"
	"path/filepath"
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
		"make tareas",
		"comandos", "comandos harness", "trampas", "trampa F-162", "guia jarvis",
		"cambios", "fuentes creditopx-offer-calculation",
		"diff creditopx-offer-calculation legacy-backend:Modules/Loans/App/Support/CutoffCalendar.php",
		"codigo legacy-backend:Modules/Loans/App/Support/CutoffCalendar.php",
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
		"make knowledge-deriva PASO=aplicar",
		"make tareas N=1; rm -rf ~",
		"cat knowledge/business-overview.md",
		"rm -rf /",
		"make knowledge-map && make cockpit",
		"guia ../../connectors/.env",
		"guia jarvis; ls",
		"trampa F-1; ls",
		"trampa ../doc",
		"comandos $(id)",
		"comandos a b",
		"codigo legacy-backend:../../.ssh/id_rsa",
		"codigo legacy-backend:/etc/passwd",
		"codigo legacy-backend:a.php; ls",
		"codigo legacy-backend:$(id)",
		"diff tema legacy-backend:x | sh",
		"fuentes ../connectors",
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
	if got := run("guia jarvis"); !strings.Contains(got, "la guía") {
		t.Errorf("guia jarvis: %q", got)
	}
	if got := run("guia tesoro"); !strings.Contains(got, "las que hay") {
		t.Errorf("una guía que no existe tiene que decir cuáles hay: %q", got)
	}
	if got := run("trampas"); !strings.Contains(got, "F-2 |") || strings.Contains(got, "Otra cosa") {
		t.Errorf("trampas tiene que ser sólo el índice: %q", got)
	}
	if got := run("trampa F-2"); got != "### F-2 · Dos\ncausa dos" {
		t.Errorf("trampa F-2: %q", got)
	}
}

// Los comandos se leen de los bloques ```comando, uno por línea; los que no están en la lista quedan «no-permitido».
func TestCommandsAreReadFromCommandBlocks(t *testing.T) {
	answer := "Necesito ver dos temas:\n\n```comando\nmake knowledge-read ID=creditopx-quota\n$ trampa F-162\nrm -rf ~\n```\n\nY este código no:\n```bash\nmake knowledge-map\n```"
	got := parseCommands(answer)
	if len(got) != 3 {
		t.Fatalf("quería 3 comandos, salieron %d: %+v", len(got), got)
	}
	if got[0].Status != "propuesto" || got[1].Status != "propuesto" || got[1].Cmd != "trampa F-162" {
		t.Errorf("los dos primeros: %+v %+v", got[0], got[1])
	}
	if got[2].Status != "no-permitido" || got[2].Reason == "" {
		t.Errorf("rm -rf tenía que quedar no-permitido: %+v", got[2])
	}
	if modeCommands("", answer) != nil {
		t.Error("en un chat sin modo no se leen comandos")
	}
}
