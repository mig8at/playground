// Package launchagent deja un servidor de my-tools corriendo DE FONDO como LaunchAgent de macOS: arranca con la
// sesión, se vuelve a levantar si se cae y sigue aunque Cockpit esté cerrado. Lo usan Sentinel y el chat.
//
// Corre un binario compilado (nunca el temporal de `go run`, que se borra al salir), con la carpeta de my-tools como
// directorio de trabajo y un PATH explícito: launchd no hereda la shell.
package launchagent

import (
	"fmt"
	"html"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"strings"
	"time"
)

// Agent describe uno.
type Agent struct {
	Label string   // com.creditop.<algo>
	Args  []string // los argumentos del binario
	Root  string   // la carpeta de my-tools: su directorio de trabajo
	Log   string   // el nombre del archivo en ~/Library/Logs
	Env   map[string]string
}

func home() string { h, _ := os.UserHomeDir(); return h }

// Plist: dónde queda su definición.
func (a Agent) Plist() string {
	return filepath.Join(home(), "Library", "LaunchAgents", a.Label+".plist")
}

// LogPath: dónde escribe.
func (a Agent) LogPath() string { return filepath.Join(home(), "Library", "Logs", a.Log) }

func domain() string {
	if u, err := user.Current(); err == nil {
		return "gui/" + u.Uid
	}
	return fmt.Sprintf("gui/%d", os.Getuid())
}

// Installed: ¿su definición está en LaunchAgents?
func (a Agent) Installed() bool { _, err := os.Stat(a.Plist()); return err == nil }

// Install escribe la definición con el binario que está corriendo y la carga (si ya estaba, la reemplaza).
func (a Agent) Install() error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	if p, err := filepath.EvalSymlinks(exe); err == nil {
		exe = p
	}
	if strings.Contains(exe, "/go-build") || strings.HasPrefix(exe, os.TempDir()) {
		return fmt.Errorf("el binario es temporal (go run): compilalo primero (los `make …-install` lo hacen)")
	}
	_ = os.MkdirAll(filepath.Dir(a.Plist()), 0o755)
	_ = os.MkdirAll(filepath.Dir(a.LogPath()), 0o755)
	e := html.EscapeString
	var b strings.Builder
	b.WriteString(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
`)
	fmt.Fprintf(&b, "  <key>Label</key><string>%s</string>\n  <key>ProgramArguments</key>\n  <array><string>%s</string>", e(a.Label), e(exe))
	for _, arg := range a.Args {
		fmt.Fprintf(&b, "<string>%s</string>", e(arg))
	}
	b.WriteString("</array>\n")
	fmt.Fprintf(&b, "  <key>WorkingDirectory</key><string>%s</string>\n", e(a.Root))
	b.WriteString("  <key>RunAtLoad</key><true/>\n  <key>KeepAlive</key><true/>\n  <key>ThrottleInterval</key><integer>30</integer>\n")
	b.WriteString("  <key>EnvironmentVariables</key>\n  <dict>\n")
	b.WriteString("    <key>PATH</key><string>/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:/opt/homebrew/bin:/usr/local/go/bin</string>\n")
	fmt.Fprintf(&b, "    <key>MY_TOOLS_ROOT</key><string>%s</string>\n", e(a.Root))
	for k, v := range a.Env {
		fmt.Fprintf(&b, "    <key>%s</key><string>%s</string>\n", e(k), e(v))
	}
	b.WriteString("  </dict>\n")
	fmt.Fprintf(&b, "  <key>StandardOutPath</key><string>%s</string>\n  <key>StandardErrorPath</key><string>%s</string>\n", e(a.LogPath()), e(a.LogPath()))
	// Cortesía con la máquina: corre mientras se trabaja.
	b.WriteString("  <key>ProcessType</key><string>Background</string>\n  <key>LowPriorityIO</key><true/>\n  <key>Nice</key><integer>5</integer>\n")
	b.WriteString("</dict>\n</plist>\n")
	if err := os.WriteFile(a.Plist(), []byte(b.String()), 0o644); err != nil {
		return err
	}
	// bootout antes de bootstrap: si ya estaba cargado, bootstrap falla y el binario nuevo no entraría.
	_ = exec.Command("launchctl", "bootout", domain()+"/"+a.Label).Run()
	time.Sleep(time.Second) // el puerto tarda un instante en soltarse
	if out, err := exec.Command("launchctl", "bootstrap", domain(), a.Plist()).CombinedOutput(); err != nil {
		return fmt.Errorf("launchctl bootstrap: %v\n%s", err, out)
	}
	fmt.Printf("✓ corre de fondo (%s)\n  binario  %s\n  log      %s\n", a.Label, exe, a.LogPath())
	return nil
}

// Uninstall la descarga y borra su definición. Lo que guardó se queda.
func (a Agent) Uninstall() error {
	_ = exec.Command("launchctl", "bootout", domain()+"/"+a.Label).Run()
	if err := os.Remove(a.Plist()); err != nil && !os.IsNotExist(err) {
		return err
	}
	fmt.Printf("✓ %s ya no corre de fondo\n", a.Label)
	return nil
}

// Status: una línea con su estado en launchd.
func (a Agent) Status() string {
	out, err := exec.Command("launchctl", "print", domain()+"/"+a.Label).CombinedOutput()
	if err != nil {
		return "de fondo: NO instalado"
	}
	state, pid := "cargado", ""
	for _, l := range strings.Split(string(out), "\n") {
		l = strings.TrimSpace(l)
		if strings.HasPrefix(l, "state = ") {
			state = strings.TrimPrefix(l, "state = ")
		}
		if strings.HasPrefix(l, "pid = ") {
			pid = " · pid " + strings.TrimPrefix(l, "pid = ")
		}
	}
	return fmt.Sprintf("de fondo: instalado · %s%s · log %s", state, pid, a.LogPath())
}
