package main

/* La consola y la red de la sesión (server/devlog.go), para depurar sin abrir DevTools:
 *
 *	bin/jarvis console [--errors] [--search texto] [--all]   lo que dijo la página en su consola (los últimos 40)
 *	bin/jarvis network [--failed] [--search texto] [--all]   los pedidos de red: documento, fetch y xhr (--all, todos)
 *	… --run <id|last>                                          los guardados de una corrida terminada (el historial) */

import (
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type devLog struct {
	Active  bool `json:"active"`
	Console []struct {
		At    time.Time `json:"at"`
		Level string    `json:"level"`
		Text  string    `json:"text"`
		Where string    `json:"where"`
	} `json:"console"`
	Network []struct {
		At     time.Time `json:"at"`
		Method string    `json:"method"`
		URL    string    `json:"url"`
		Type   string    `json:"type"`
		Status int       `json:"status"`
		Failed string    `json:"failed"`
		Ms     int       `json:"ms"`
	} `json:"network"`
}

// devRun: con --run <id|last>, la consola y la red guardadas de esa corrida (no las de la sesión en vivo).
var devRun string

func devFlags(args []string) (flag string, search string, all bool) {
	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--run":
			if i+1 >= len(args) {
				usage()
			}
			devRun = args[i+1]
			i++
		case "--errors", "--failed":
			flag = args[i]
		case "--all":
			all = true
		case "--search":
			if i+1 < len(args) {
				search = strings.ToLower(args[i+1])
				i++
			}
		default:
			usage()
		}
	}
	return
}

// loadDevLog trae la consola y la red: de la sesión en vivo o, con --run, las guardadas de una corrida.
func loadDevLog() (devLog, error) {
	var d devLog
	if devRun != "" {
		var r struct {
			Run string `json:"run"`
			devLog
		}
		if err := call(http.MethodGet, "/api/runs/"+url.PathEscape(devRun)+"/devlog", nil, &r); err != nil {
			return d, err
		}
		fmt.Printf("(corrida %s)\n", r.Run)
		return r.devLog, nil
	}
	if err := call(http.MethodGet, "/api/live/devlog", nil, &d); err != nil {
		return d, err
	}
	if !d.Active {
		return d, fmt.Errorf("no hay sesión en vivo en esta pestaña (lo de una corrida terminada: --run <id|last>)")
	}
	return d, nil
}

func consoleCmd(args []string) error {
	flag, search, all := devFlags(args)
	d, err := loadDevLog()
	if err != nil {
		return err
	}
	var lines []string
	for _, e := range d.Console {
		if flag == "--errors" && e.Level != "error" && e.Level != "warning" && e.Level != "excepción" {
			continue
		}
		if search != "" && !strings.Contains(strings.ToLower(e.Text), search) {
			continue
		}
		where := ""
		if e.Where != "" {
			where = "  (" + e.Where + ")"
		}
		lines = append(lines, fmt.Sprintf("%s %-9s %s%s", e.At.Format("15:04:05"), e.Level, e.Text, where))
	}
	printTail(lines, all, "mensajes")
	return nil
}

func networkCmd(args []string) error {
	flag, search, all := devFlags(args)
	d, err := loadDevLog()
	if err != nil {
		return err
	}
	var lines []string
	for _, e := range d.Network {
		if !all && e.Type != "document" && e.Type != "fetch" && e.Type != "xhr" {
			continue
		}
		bad := e.Failed != "" || e.Status >= 400
		if flag == "--failed" && !bad {
			continue
		}
		if search != "" && !strings.Contains(strings.ToLower(e.URL), search) {
			continue
		}
		status, why := fmt.Sprint(e.Status), ""
		if e.Failed != "" {
			status, why = "✗", "  ✗ "+e.Failed
		}
		lines = append(lines, fmt.Sprintf("%s %-6s %-5s %-8s %5d ms  %s%s", e.At.Format("15:04:05"), e.Method, status, e.Type, e.Ms, e.URL, why))
	}
	printTail(lines, all, "pedidos")
	return nil
}

// printTail muestra los últimos 40 (todos con --all) y dice cuántos quedaron afuera.
func printTail(lines []string, all bool, what string) {
	if len(lines) == 0 {
		fmt.Printf("ningún %s que coincida\n", strings.TrimSuffix(what, "s"))
		return
	}
	if !all && len(lines) > 40 {
		fmt.Printf("(%d %s más viejos: --all los muestra)\n", len(lines)-40, what)
		lines = lines[len(lines)-40:]
	}
	fmt.Println(strings.Join(lines, "\n"))
}
