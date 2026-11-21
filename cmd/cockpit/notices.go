package main

// LOS AVISOS POR CONSOLA (lib/notice). No pasan por la ventana de Cockpit: leen y escriben los archivos de la bandeja y
// de los ajustes, así sirven con Cockpit cerrado. La carcasa de Cockpit usa los mismos comandos con --json
// (src-tauri/src/main.rs, `notices_*`), así hay UNA implementación.
//
//	bin/cockpit notices [--app X] [--unread] [--limit N] [--json] [--read]
//	bin/cockpit notices settings [--json] [--set '<json>']
//	bin/cockpit notify --title T [--body B] [--app X] [--url U] [--important] [--sound]
//	bin/cockpit notify --test
//	bin/cockpit mute <app> [all|important|none]
//	bin/cockpit pause <1h|30m|off>

import (
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"creditop/my-tools/lib/notice"
)

// noticeApps: las herramientas que avisan, con su nombre en Cockpit. Es la lista de la sección «Avisos».
var noticeApps = []struct{ ID, Name string }{
	{"sentinel", "Sentinel"}, {"correo", "Correo"}, {"chat", "Chat"}, {"knowledge", "Knowledge"},
	{"wally", "Wally"}, {"tablero", "Tablero (la daily)"}, {"cockpit", "Cockpit (la sesión)"},
}

func notices(args []string) int {
	if len(args) > 0 && args[0] == "settings" {
		return noticeSettings(args[1:])
	}
	app, limit, asJSON, unreadOnly, markRead := "", 0, false, false, false
	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--app":
			if i+1 < len(args) {
				i++
				app = args[i]
			}
		case "--limit":
			if i+1 < len(args) {
				i++
				limit, _ = strconv.Atoi(args[i])
			}
		case "--json":
			asJSON = true
		case "--unread":
			unreadOnly = true
		case "--read":
			markRead = true
		default:
			fmt.Fprintf(os.Stderr, "cockpit notices: no conozco %q (bin/cockpit help)\n", args[i])
			return 2
		}
	}
	list, err := notice.List(app, limit)
	if err != nil {
		fmt.Fprintln(os.Stderr, "cockpit notices:", err)
		return 1
	}
	state := notice.ReadState()
	unread := notice.Unread(list, state)
	if unreadOnly {
		var only []notice.Record
		for _, r := range list {
			if r.Silenced == "" && r.At > state.ReadUntil {
				only = append(only, r)
			}
		}
		list = only
	}
	if markRead {
		if err := notice.MarkRead(time.Now()); err != nil {
			fmt.Fprintln(os.Stderr, "cockpit notices:", err)
			return 1
		}
	}
	if asJSON {
		if list == nil {
			list = []notice.Record{}
		}
		out := map[string]any{"items": list, "unread": unread, "readUntil": state.ReadUntil, "settings": notice.ReadSettings(),
			"notifier": notice.NotifierStatus(), "apps": noticeApps}
		_ = json.NewEncoder(os.Stdout).Encode(out)
		return 0
	}
	if len(list) == 0 {
		fmt.Println("sin avisos")
		return 0
	}
	for _, r := range list {
		t, _ := time.Parse(time.RFC3339, r.At)
		mark := "  "
		switch {
		case r.Silenced != "":
			mark = "· " // callado
		case r.Error != "":
			mark = "✗ "
		case r.At > state.ReadUntil:
			mark = "● " // sin leer
		}
		line := fmt.Sprintf("%s%s  %-9s %s", mark, t.Local().Format("02/01 15:04"), r.App, r.Title)
		if r.Body != "" {
			line += " — " + firstLine(r.Body, 80)
		}
		switch {
		case r.Silenced != "":
			line += "  (callado: " + r.Silenced + ")"
		case r.Error != "":
			line += "  (no salió: " + firstLine(r.Error, 80) + ")"
		}
		fmt.Println(line)
	}
	fmt.Printf("\n%d sin leer · ● sin leer · · callado · ✗ no salió\n", unread)
	return 0
}

func firstLine(s string, max int) string {
	s, _, _ = strings.Cut(s, "\n")
	if r := []rune(s); len(r) > max {
		return string(r[:max-1]) + "…"
	}
	return s
}

func noticeSettings(args []string) int {
	s := notice.ReadSettings()
	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--json":
		case "--set":
			if i+1 >= len(args) {
				fmt.Fprintln(os.Stderr, "cockpit notices settings --set '<json>'")
				return 2
			}
			i++
			next := s
			if err := json.Unmarshal([]byte(args[i]), &next); err != nil {
				fmt.Fprintln(os.Stderr, "cockpit notices settings: el JSON no se lee:", err)
				return 2
			}
			if err := notice.WriteSettings(next); err != nil {
				fmt.Fprintln(os.Stderr, "cockpit notices settings:", err)
				return 1
			}
			s = notice.ReadSettings()
		default:
			fmt.Fprintf(os.Stderr, "cockpit notices settings: no conozco %q\n", args[i])
			return 2
		}
	}
	_ = json.NewEncoder(os.Stdout).Encode(s)
	return 0
}

func notifyCmd(args []string) int {
	var n notice.Notice
	for i := 0; i < len(args); i++ {
		val := func() string {
			if i+1 < len(args) {
				i++
				return args[i]
			}
			return ""
		}
		switch args[i] {
		case "--test":
			via, err := notice.Test()
			if err != nil {
				fmt.Fprintln(os.Stderr, "cockpit notify:", err)
				return 1
			}
			fmt.Println("el aviso de prueba salió por " + via + " · permiso del avisador: " + notice.NotifierStatus())
			return 0
		case "--title":
			n.Title = val()
		case "--body":
			n.Body = val()
		case "--app":
			n.App = val()
		case "--url":
			n.URL = val()
		case "--group":
			n.Group = val()
		case "--important":
			n.Important = true
		case "--sound":
			n.Sound = true
		default:
			fmt.Fprintf(os.Stderr, "cockpit notify: no conozco %q (bin/cockpit help)\n", args[i])
			return 2
		}
	}
	if n.Title == "" {
		fmt.Fprintln(os.Stderr, "cockpit notify --title T [--body B] [--app X] [--url cockpit://…] [--important] [--sound] · o --test")
		return 2
	}
	if n.App == "" && n.URL == "" {
		n.App = "claude" // lo que manda una sesión por consola
	}
	via, err := notice.Send(n)
	if err != nil {
		fmt.Fprintln(os.Stderr, "cockpit notify:", err)
		return 1
	}
	fmt.Println(via)
	return 0
}

func muteCmd(args []string) int {
	if len(args) == 0 || len(args) > 2 {
		fmt.Fprintln(os.Stderr, "cockpit mute <app> [all|important|none]   (sin nivel: none)")
		return 2
	}
	level := notice.LevelNone
	if len(args) == 2 {
		level = args[1]
	}
	if level != notice.LevelAll && level != notice.LevelImportant && level != notice.LevelNone {
		fmt.Fprintf(os.Stderr, "cockpit mute: el nivel es all, important o none (no %q)\n", level)
		return 2
	}
	s := notice.ReadSettings()
	s.Apps[args[0]] = level
	if err := notice.WriteSettings(s); err != nil {
		fmt.Fprintln(os.Stderr, "cockpit mute:", err)
		return 1
	}
	fmt.Printf("%s: %s\n", args[0], level)
	return 0
}

func pauseCmd(args []string) int {
	if len(args) != 1 {
		fmt.Fprintln(os.Stderr, "cockpit pause <1h|30m|off>")
		return 2
	}
	s := notice.ReadSettings()
	if args[0] == "off" {
		s.PausedUntil = ""
	} else {
		d, err := time.ParseDuration(args[0])
		if err != nil || d <= 0 {
			fmt.Fprintf(os.Stderr, "cockpit pause: %q no es una duración (1h, 30m, off)\n", args[0])
			return 2
		}
		s.PausedUntil = time.Now().Add(d).Format(time.RFC3339)
	}
	if err := notice.WriteSettings(s); err != nil {
		fmt.Fprintln(os.Stderr, "cockpit pause:", err)
		return 1
	}
	if s.PausedUntil == "" {
		fmt.Println("los avisos vuelven a salir")
	} else {
		t, _ := time.Parse(time.RFC3339, s.PausedUntil)
		fmt.Println("en pausa hasta las " + t.Format("15:04"))
	}
	return 0
}
