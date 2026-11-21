package main

// bin/jarvis flows: los flujos guardados por su identidad (<app>/<id>), para verlos, borrarlos, renombrarlos y aprobar
// los arreglos que propuso una repetición (server/repair.go). Una grabación igual ya no crea otro: actualiza éste.

import (
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type flowSummary struct {
	App, ID, Name string
	Steps, Params int
	Verified      time.Time
}

type flowFull struct {
	Name     string    `json:"name"`
	Goal     string    `json:"meta"`
	Start    string    `json:"start"`
	Created  time.Time `json:"created"`
	Updated  time.Time `json:"updated"`
	Verified time.Time `json:"verified"`
	Run      string    `json:"run"`
	LastRun  string    `json:"lastRun"`
	Steps    []struct {
		Action, Target, Value, Instruction, Param string
		Pause, Secret                             bool
	} `json:"steps"`
	Repairs []struct {
		Step     int
		Old, New string
		Score    float64
		Run      string
	} `json:"repairs"`
}

func flowsCmd(args []string) error {
	if len(args) == 0 || !strings.Contains(args[0], "/") && args[0] != "show" && args[0] != "rm" && args[0] != "rename" && args[0] != "repairs" {
		app := ""
		if len(args) > 0 {
			app = args[0]
		}
		return flowsList(app)
	}
	sub, rest := args[0], args[1:]
	if strings.Contains(sub, "/") { // flows <app>/<id> = show
		sub, rest = "show", args
	}
	if len(rest) == 0 || !strings.Contains(rest[0], "/") {
		return fmt.Errorf("flows %s <app>/<id> (bin/jarvis flows los lista)", sub)
	}
	app, id, _ := strings.Cut(rest[0], "/")
	p := "/api/flows/" + url.PathEscape(app) + "/" + url.PathEscape(id)
	switch sub {
	case "show":
		return flowShow(app, id, p)
	case "rm":
		if err := call(http.MethodDelete, p, nil, nil); err != nil {
			return err
		}
		fmt.Printf("borré el flujo %s/%s (jarvis/flows/%s/%s.json; sigue en git si estaba commiteado)\n", app, id, app, id)
	case "rename":
		if len(rest) < 2 || strings.TrimSpace(strings.Join(rest[1:], " ")) == "" {
			return fmt.Errorf("flows rename <app>/<id> 'nombre nuevo'")
		}
		name := strings.TrimSpace(strings.Join(rest[1:], " "))
		if err := call(http.MethodPut, p, map[string]any{"name": name}, nil); err != nil {
			return err
		}
		fmt.Printf("%s/%s se llama «%s» (el id no cambia: los lotes y las recetas lo siguen nombrando igual)\n", app, id, name)
	case "repairs":
		action := ""
		for _, a := range rest[1:] {
			switch a {
			case "--apply":
				action = "apply"
			case "--discard":
				action = "discard"
			}
		}
		if action == "" {
			return flowShow(app, id, p)
		}
		var out struct{ Count int }
		if err := call(http.MethodPost, p+"/repairs", map[string]string{"action": action}, &out); err != nil {
			return err
		}
		if action == "apply" {
			fmt.Printf("apliqué %d arreglo(s) en %s/%s: la próxima repetición usa los elementos nuevos\n", out.Count, app, id)
		} else {
			fmt.Printf("descarté %d arreglo(s) de %s/%s: el flujo queda como estaba\n", out.Count, app, id)
		}
	default:
		return fmt.Errorf("flows: list · show · rm · rename · repairs")
	}
	return nil
}

func flowsList(app string) error {
	var list []flowSummary
	if err := call(http.MethodGet, "/api/flows", nil, &list); err != nil {
		return err
	}
	n := 0
	for _, f := range list {
		if app != "" && f.App != app {
			continue
		}
		checked := "sin verificar"
		if !f.Verified.IsZero() {
			checked = "verificado " + f.Verified.Format("2006-01-02")
		}
		fmt.Printf("  %-48s %s · %d pasos · %d datos · %s\n", f.App+"/"+f.ID, f.Name, f.Steps, f.Params, checked)
		n++
	}
	if n == 0 {
		fmt.Println("no hay flujos" + map[bool]string{true: " en " + app, false: ""}[app != ""])
		return nil
	}
	fmt.Println("\n  ver uno: bin/jarvis flows <app>/<id> · borrar: flows rm <app>/<id> · renombrar: flows rename <app>/<id> 'nombre'")
	return nil
}

func flowShow(app, id, p string) error {
	var out struct{ Flow flowFull }
	if err := call(http.MethodGet, p, nil, &out); err != nil {
		return err
	}
	f := out.Flow
	fmt.Printf("%s/%s · %s\n", app, id, f.Name)
	fmt.Printf("  entra por %s · creado %s", f.Start, f.Created.Format("2006-01-02 15:04"))
	if !f.Updated.IsZero() {
		fmt.Printf(" · actualizado %s", f.Updated.Format("2006-01-02 15:04"))
	}
	if !f.Verified.IsZero() {
		fmt.Printf(" · verificado %s", f.Verified.Format("2006-01-02"))
	}
	fmt.Printf("\n  grabado en la corrida %s", f.Run)
	if f.LastRun != "" {
		fmt.Printf(" · última repetición %s", f.LastRun)
	}
	fmt.Println()
	for i, s := range f.Steps {
		extra := ""
		if s.Param != "" {
			extra = fmt.Sprintf("  [dato «%s»: %q]", s.Param, s.Value)
		}
		if s.Pause {
			extra += "  [lo hace la persona]"
		}
		fmt.Printf("  %2d. %s%s\n", i+1, s.Instruction, extra)
	}
	if len(f.Repairs) > 0 {
		fmt.Printf("\n  ⚠ %d arreglo(s) propuesto(s) por una repetición (el elemento había cambiado):\n", len(f.Repairs))
		for _, r := range f.Repairs {
			fmt.Printf("    paso %d: «%s» → «%s» (parecido %.0f%%, corrida %s)\n", r.Step+1, r.Old, r.New, r.Score*100, r.Run)
		}
		fmt.Printf("  aplicarlos: bin/jarvis flows repairs %s/%s --apply · descartarlos: --discard\n", app, id)
	}
	return nil
}
