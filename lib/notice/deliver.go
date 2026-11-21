package notice

// LA SALIDA. En orden:
//
//  1. El avisador de Cockpit (cockpit/notifier, lo compila `make cockpit`): «Cockpit» en el aviso, y tocarlo abre el
//     enlace `cockpit://`. Se usa cuando macOS ya le dio permiso.
//  2. El avisador viejo del chat («Chat de my-tools»), mientras el de Cockpit no tenga permiso: así nada deja de
//     avisar en el cambio. Se borra cuando el de Cockpit ande.
//  3. osascript: avisa igual, pero tocarlo no abre nada, y desde un servicio no se ve si «Editor de Scripts» no tiene
//     permiso de avisos (pasó el 2026-11-10). En Linux, notify-send.

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

// NotifierApp: dónde queda el avisador de Cockpit.
func NotifierApp() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, "Applications", "Cockpit Avisos.app")
}

func notifierBin() string {
	return filepath.Join(NotifierApp(), "Contents", "MacOS", "CockpitNotifier")
}

func chatNotifierBin() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, "Applications", "Chat de my-tools.app", "Contents", "MacOS", "ChatNotifier")
}

func isFile(p string) bool {
	st, err := os.Stat(p)
	return err == nil && !st.IsDir()
}

var (
	statusMu   sync.Mutex
	statusAt   time.Time
	statusLast string
)

// NotifierStatus: el permiso de avisos del avisador de Cockpit: authorized · denied · notDetermined · missing. Se
// guarda un minuto (cada aviso no lo pregunta).
func NotifierStatus() string {
	statusMu.Lock()
	defer statusMu.Unlock()
	if statusLast != "" && time.Since(statusAt) < time.Minute {
		return statusLast
	}
	st := "missing"
	if isFile(notifierBin()) {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		out, err := exec.CommandContext(ctx, notifierBin(), "--status").Output()
		cancel()
		st = strings.TrimSpace(string(out))
		if err != nil || st == "" {
			st = "notDetermined"
		}
	}
	statusLast, statusAt = st, time.Now()
	return st
}

func notifierArgs(n Notice) []string {
	args := []string{"--title", n.Title, "--body", n.Body}
	if n.URL != "" {
		args = append(args, "--url", n.URL)
	}
	if n.Group != "" {
		args = append(args, "--group", n.Group)
		if n.Replace {
			args = append(args, "--id", n.Group)
		}
	}
	if n.Sound {
		args = append(args, "--sound")
	}
	return args
}

// deliver es una variable: las pruebas la cambian para no mostrar nada.
var deliver = deliverSystem

func deliverSystem(n Notice) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	var fail []string
	try := func(name, bin string) (string, bool) {
		out, err := exec.CommandContext(ctx, bin, notifierArgs(n)...).CombinedOutput()
		if err == nil {
			return name, true
		}
		fail = append(fail, fmt.Sprintf("%s: %v %s", name, err, strings.TrimSpace(string(out))))
		return "", false
	}
	if runtime.GOOS == "darwin" {
		st := NotifierStatus()
		chat := isFile(chatNotifierBin())
		// Sin permiso todavía y con el viejo a mano, el viejo: pedir el permiso desde un servicio deja el aviso
		// esperando a que alguien toque «Permitir». El permiso se pide con `bin/cockpit notify --test`.
		if st == "authorized" || (st == "notDetermined" && !chat) {
			if via, ok := try("avisador de Cockpit", notifierBin()); ok {
				return via, nil
			}
		}
		if chat {
			if via, ok := try("avisador del chat", chatNotifierBin()); ok {
				return via, nil
			}
		}
		if err := osascript(ctx, n); err != nil {
			return "", fmt.Errorf("%s; osascript: %v", strings.Join(fail, "; "), err)
		}
		if len(fail) > 0 {
			return "osascript (" + strings.Join(fail, "; ") + ")", nil
		}
		return "osascript", nil
	}
	bin, err := exec.LookPath("notify-send")
	if err != nil {
		return "", fmt.Errorf("sin avisador en %s: no está notify-send en el PATH", runtime.GOOS)
	}
	urgency := "normal"
	if n.Important {
		urgency = "critical" // el escritorio no la esconde sola
	}
	// El «--» corta las opciones: un cuerpo que empieza con «-» no se lee como una.
	if out, err := exec.CommandContext(ctx, bin, "--app-name="+n.App, "--urgency="+urgency, "--", n.Title, n.Body).CombinedOutput(); err != nil {
		return "", fmt.Errorf("notify-send: %v %s", err, strings.TrimSpace(string(out)))
	}
	return "notify-send", nil
}

func osascript(ctx context.Context, n Notice) error {
	q := func(s string) string {
		return `"` + strings.NewReplacer(`\`, `\\`, `"`, `\"`, "\r", "").Replace(s) + `"`
	}
	script := "display notification " + q(n.Body) + " with title " + q(n.Title)
	if n.Sound {
		script += ` sound name "Glass"`
	}
	out, err := exec.CommandContext(ctx, "osascript", "-e", script).CombinedOutput()
	if err != nil {
		return fmt.Errorf("%v %s", err, strings.TrimSpace(string(out)))
	}
	return nil
}

// Test manda un aviso de prueba SIEMPRE por el avisador de Cockpit (sin mirar el silencio): es lo que hace que macOS
// pida su permiso, con una persona mirando. Queda en la bandeja.
func Test() (string, error) {
	n := Notice{App: "cockpit", Title: "Aviso de prueba", Body: "Los avisos de my-tools salen por Cockpit.", URL: "cockpit://cockpit/", Group: "cockpit-test", Replace: true}
	now := time.Now()
	rec := Record{ID: newID(now), At: now.UTC().Format(time.RFC3339), App: n.App, Title: n.Title, Body: n.Body, URL: n.URL, Group: n.Group}
	var via string
	var err error
	if isFile(notifierBin()) {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute) // espera a que toquen «Permitir»
		out, e := exec.CommandContext(ctx, notifierBin(), notifierArgs(n)...).CombinedOutput()
		cancel()
		via, err = "avisador de Cockpit", e
		if e != nil {
			err = fmt.Errorf("avisador de Cockpit: %v %s", e, strings.TrimSpace(string(out)))
		}
		statusMu.Lock()
		statusLast = ""
		statusMu.Unlock()
	} else {
		via, err = deliver(n)
	}
	rec.Via, rec.Delivered = via, err == nil
	if err != nil {
		rec.Error = err.Error()
	}
	_ = appendRecord(rec)
	return via, err
}
