package main

// DE FONDO: un LaunchAgent de macOS que deja la API corriendo desde que arranca la sesión, aunque Cockpit esté cerrado,
// y la vuelve a levantar si se cae. Así lo guardado no tiene huecos por haber tenido la app cerrada. Corre el binario
// compilado (`sentinel/bin/sentinel`, fuera de git): un cambio en el servidor pide `make sentinel-install` de nuevo.
// Con el Mac dormido o sin la VPN de producción no mide; la pasada siguiente pide el hueco entero.

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

const agentLabel = "com.creditop.sentinel"

func agentPlist() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, "Library", "LaunchAgents", agentLabel+".plist")
}

func agentLog() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, "Library", "Logs", "sentinel.log")
}

func agentDomain() string {
	if u, err := user.Current(); err == nil {
		return "gui/" + u.Uid
	}
	return fmt.Sprintf("gui/%d", os.Getuid())
}

func exitOn(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, "sentinel:", err)
		os.Exit(1)
	}
}

func installAgent(root, serve string) error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	if p, err := filepath.EvalSymlinks(exe); err == nil {
		exe = p
	}
	// `go run` compila a un temporal que se borra al salir: el agente quedaría apuntando a un binario que no existe.
	if strings.Contains(exe, "/go-build") || strings.HasPrefix(exe, os.TempDir()) {
		return fmt.Errorf("el binario es temporal (go run): instalalo con `make sentinel-install`, que lo compila primero")
	}
	_ = os.MkdirAll(filepath.Dir(agentPlist()), 0o755)
	_ = os.MkdirAll(filepath.Dir(agentLog()), 0o755)
	e := html.EscapeString
	plist := `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>` + agentLabel + `</string>
  <key>ProgramArguments</key>
  <array><string>` + e(exe) + `</string><string>-serve</string><string>` + e(serve) + `</string></array>
  <key>WorkingDirectory</key><string>` + e(root) + `</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:/opt/homebrew/bin:/usr/local/go/bin</string>
  </dict>
  <key>StandardOutPath</key><string>` + e(agentLog()) + `</string>
  <key>StandardErrorPath</key><string>` + e(agentLog()) + `</string>
  <key>ProcessType</key><string>Background</string>
  <key>LowPriorityIO</key><true/>
  <key>Nice</key><integer>5</integer>
</dict>
</plist>
`
	if err := os.WriteFile(agentPlist(), []byte(plist), 0o644); err != nil {
		return err
	}
	// bootout antes de bootstrap: si ya estaba cargado, bootstrap falla y el binario nuevo no entraría.
	_ = exec.Command("launchctl", "bootout", agentDomain()+"/"+agentLabel).Run()
	time.Sleep(time.Second) // el puerto tarda un instante en soltarse
	if out, err := exec.Command("launchctl", "bootstrap", agentDomain(), agentPlist()).CombinedOutput(); err != nil {
		return fmt.Errorf("launchctl bootstrap: %v\n%s", err, out)
	}
	fmt.Printf("✓ Sentinel corre de fondo (%s)\n  binario  %s\n  API      http://%s\n  log      %s\n", agentLabel, exe, serve, agentLog())
	return nil
}

func uninstallAgent() error {
	_ = exec.Command("launchctl", "bootout", agentDomain()+"/"+agentLabel).Run()
	if err := os.Remove(agentPlist()); err != nil && !os.IsNotExist(err) {
		return err
	}
	fmt.Println("✓ Sentinel ya no corre de fondo (lo guardado se queda en sentinel/.data)")
	return nil
}

func agentStatus(st *store) {
	out, err := exec.Command("launchctl", "print", agentDomain()+"/"+agentLabel).CombinedOutput()
	if err != nil {
		fmt.Println("de fondo: NO instalado (make sentinel-install)")
	} else {
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
		fmt.Printf("de fondo: instalado · %s%s · log %s\n", state, pid, agentLog())
	}
	if reach := st.reach(); !reach.IsZero() {
		fmt.Printf("guardado hasta %s (hace %s) · %s\n", reach.In(bogota).Format("2006-01-02 15:04"), time.Since(reach).Round(time.Minute), st)
	}
}
