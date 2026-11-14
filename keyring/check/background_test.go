package check

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// Un LaunchAgent escrito a mano en un temporal: lo que leen las pruebas es lo mismo que launchd guarda.
func writeAgent(t *testing.T, label, program, workdir, extraEnv string) string {
	t.Helper()
	if _, err := exec.LookPath("plutil"); err != nil {
		t.Skip("sin plutil (no es macOS)")
	}
	f := filepath.Join(t.TempDir(), label+".plist")
	body := `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>` + label + `</string>
  <key>ProgramArguments</key><array><string>` + program + `</string></array>
  <key>WorkingDirectory</key><string>` + workdir + `</string>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>/no/existe/bin:/usr/bin</string>` + extraEnv + `
  </dict>
  <key>KeepAlive</key><true/>
</dict></plist>`
	if err := os.WriteFile(f, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	return f
}

// El caso del 2026-11-14: el servicio seguía apuntando a la carpeta de antes del renombre.
func TestAgentPointingToAMissingFolderFails(t *testing.T) {
	f := writeAgent(t, "com.creditop.tablero.pulso", "/bin/sh", "/Users/nadie/Desktop/CREDITOP/playground", "")
	c := checkAgent(context.Background(), f)
	if c.Name != "pulso" || c.State != Fail || !strings.Contains(c.Detail, "/Users/nadie/Desktop/CREDITOP/playground") ||
		!strings.Contains(c.Detail, "make pulso-install") {
		t.Fatalf("quería ✗ pulso con la carpeta y el arreglo: %+v", c)
	}
}

// Una ruta dentro del entorno (como PULSO_EXTRA=nombre=/ruta) también cuenta; el PATH no.
func TestAgentChecksEnvironmentPathsButNotPATH(t *testing.T) {
	dir := t.TempDir()
	f := writeAgent(t, "com.creditop.my-tools.chat", "/bin/sh", dir,
		"\n    <key>PULSO_EXTRA</key><string>my-tools=/Users/nadie/no-esta, otro="+dir+"</string>")
	c := checkAgent(context.Background(), f)
	if c.State != Fail || !strings.Contains(c.Detail, "/Users/nadie/no-esta") {
		t.Fatalf("quería ✗ por la ruta del entorno: %+v", c)
	}
	if strings.Contains(c.Detail, "/no/existe/bin") {
		t.Fatalf("el PATH no es una ruta que el servicio necesite: %+v", c)
	}
}

// Con todo en su lugar pero sin cargar en launchd (este label no existe), dice que no está cargado.
func TestAgentNotLoadedFails(t *testing.T) {
	f := writeAgent(t, "com.creditop.prueba-que-no-existe", "/bin/sh", t.TempDir(), "")
	c := checkAgent(context.Background(), f)
	if c.State != Fail || !strings.Contains(c.Detail, "no cargado") {
		t.Fatalf("quería ✗ no cargado: %+v", c)
	}
}

func TestAgentName(t *testing.T) {
	for label, want := range map[string]string{
		"com.creditop.my-tools.chat": "chat", "com.creditop.tablero.pulso": "pulso",
		"com.creditop.sentinel": "sentinel", "com.creditop.playground.chat": "chat",
	} {
		if got := agentName(label); got != want {
			t.Errorf("%s → %q, quería %q", label, got, want)
		}
	}
}
