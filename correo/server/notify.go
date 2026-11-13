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

	"creditop/playground/connectors/gmail"
)

// notice: el aviso de un correo nuevo. Tocarlo abre Cockpit en Correo, en ese correo.
func notice(w Watch, m gmail.Message) error {
	return macNotice(w.Name+" · "+sender(m.From), m.Subject, "#/w/"+url.PathEscape(w.ID)+"/"+url.PathEscape(m.ID), true)
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

// macNotice sale por el avisador del chat («Chat del playground», que ya tiene permiso de avisos y abre un enlace
// `cockpit://` al tocarlo), como Sentinel; sin él, por osascript.
func macNotice(title, body, route string, sound bool) error {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	home, _ := os.UserHomeDir()
	bin := filepath.Join(home, "Applications", "Chat del playground.app", "Contents", "MacOS", "ChatNotifier")
	if st, err := os.Stat(bin); err == nil && !st.IsDir() {
		args := []string{"--title", title, "--body", body, "--url", "cockpit://correo/" + route, "--group", "creditop-correo-" + route}
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
