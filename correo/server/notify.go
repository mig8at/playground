package main

import (
	"context"
	"fmt"
	"net/mail"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"creditop/my-tools/connectors/gmail"
)

// notice: el aviso de un correo nuevo. «te contestó» si en esa conversación ya habías escrito vos (`t`, el estado del
// hilo), «te escribió» si es nueva. Tocarlo abre Cockpit en Correo, en ESA conversación (el hilo, con su desglose), y
// los avisos de un mismo hilo se agrupan: uno nuevo reemplaza al anterior.
func notice(w Watch, m gmail.Message, t Thread) error {
	return macNotice(noticeTitle(w, m, t), m.Subject, threadRoute(w.ID, m.ThreadID), true)
}

func noticeTitle(w Watch, m gmail.Message, t Thread) string {
	verb := "te escribió"
	if !t.LastMine.IsZero() && t.LastMine.Before(m.Date) {
		verb = "te contestó"
	}
	return w.Name + " · " + sender(m.From) + " " + verb
}

func threadRoute(watch, thread string) string {
	return "#/w/" + url.PathEscape(watch) + "/" + url.PathEscape(thread)
}

// sender: el nombre del remitente tal como viene (lo de antes de «<…>»; el parser de direcciones tira lo que va entre
// paréntesis, y «Patrick Elder (Shopify)» quedaba sin «Shopify»), o su dirección si no trae nombre.
func sender(from string) string {
	if i := strings.Index(from, "<"); i > 0 {
		if name := strings.Trim(strings.TrimSpace(from[:i]), `"`); name != "" {
			return name
		}
	}
	if a, err := mail.ParseAddress(from); err == nil {
		if a.Name != "" {
			return a.Name
		}
		return a.Address
	}
	return from
}

// macNotice sale por el avisador del chat («Chat de my-tools», que ya tiene permiso de avisos y abre un enlace
// `cockpit://` al tocarlo), como Sentinel; sin él, por osascript.
func macNotice(title, body, route string, sound bool) error {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	home, _ := os.UserHomeDir()
	bin := filepath.Join(home, "Applications", "Chat de my-tools.app", "Contents", "MacOS", "ChatNotifier")
	if st, err := os.Stat(bin); err == nil && !st.IsDir() {
		group := "creditop-correo"
		if i := strings.LastIndex(route, "/"); i >= 0 && i < len(route)-1 {
			group += "-" + route[i+1:] // uno por conversación
		}
		args := []string{"--title", title, "--body", body, "--url", "cockpit://correo/" + route, "--group", group}
		if sound {
			args = append(args, "--sound")
		}
		if out, err := exec.CommandContext(ctx, bin, args...).CombinedOutput(); err != nil {
			return fmt.Errorf("avisador: %v %s", err, strings.TrimSpace(string(out)))
		}
		return nil
	}
	q := func(s string) string { return `"` + strings.NewReplacer(`\`, `\\`, `"`, `\"`).Replace(s) + `"` }
	script := "display notification " + q(body) + " with title " + q(title)
	if sound {
		script += ` sound name "Glass"`
	}
	return exec.CommandContext(ctx, "osascript", "-e", script).Run()
}
