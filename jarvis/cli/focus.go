package main

/* EL FOCO desde la consola (server/focus.go): qué sitios tienen que estar al frente y cuáles trabajan de fondo.
 *
 *	bin/jarvis focus                                   los sitios con perfil y si se sigue a Claude
 *	bin/jarvis focus check                             mide el sitio de la sesión con la pestaña detrás y lo guarda
 *	bin/jarvis focus set <sitio> front|background|auto lo pone a mano (auto lo borra: de fondo hasta que falle)
 *	bin/jarvis focus follow on|off                     on: cada comando trae su pestaña, como antes */

import (
	"fmt"
	"net/http"
	"strings"
)

type focusView struct {
	Follow bool `json:"follow"`
	Hosts  []struct {
		Host    string          `json:"host"`
		Mode    string          `json:"mode"`
		Source  string          `json:"source"`
		Note    string          `json:"note"`
		Checks  map[string]bool `json:"checks"`
		Updated string          `json:"updated"`
	} `json:"hosts"`
}

var focusModeText = map[string]string{"front": "al frente", "background": "de fondo"}
var focusSourceText = map[string]string{"manual": "a mano", "check": "medido", "failure": "falló de fondo"}

func focusCmd(args []string) error {
	switch {
	case len(args) == 0:
		var v focusView
		if err := call(http.MethodGet, "/api/focus", nil, &v); err != nil {
			return err
		}
		if v.Follow {
			fmt.Println("siguiendo a Claude: cada comando trae su pestaña al frente (bin/jarvis focus follow off lo apaga)")
		} else {
			fmt.Println("de fondo por defecto: un comando no trae la pestaña, salvo en los sitios «al frente» y en el modo guía")
		}
		if len(v.Hosts) == 0 {
			fmt.Println("ningún sitio con perfil todavía: bin/jarvis focus check mide el de la sesión")
		}
		for _, h := range v.Hosts {
			note := ""
			if h.Note != "" {
				note = " · " + h.Note
			}
			fmt.Printf("  %-32s %-10s %s, %s%s\n", h.Host, focusModeText[h.Mode], focusSourceText[h.Source], h.Updated, note)
		}
		return nil
	case args[0] == "check" && len(args) == 1:
		var res struct {
			Host          string
			Mode          string
			Checks        map[string]bool
			Frames, Ticks int
			Saved         bool
		}
		fmt.Println("dejando la pestaña detrás y midiendo (~4 s)…")
		if err := call(http.MethodPost, "/api/live/focus-check", nil, &res); err != nil {
			return err
		}
		mark := func(ok bool) string {
			if ok {
				return "✓"
			}
			return "✗"
		}
		fmt.Printf("%s con la pestaña detrás:\n", res.Host)
		fmt.Printf("  %s se ve (visibilityState)\n", mark(res.Checks["visible"]))
		fmt.Printf("  %s tiene foco (hasFocus)\n", mark(res.Checks["focus"]))
		fmt.Printf("  %s animaciones: %d en 1 s (al frente, 60 o 120 según la pantalla)\n", mark(res.Checks["frames"]), res.Frames)
		fmt.Printf("  %s temporizadores: %d de 100 en 1 s\n", mark(res.Checks["timers"]), res.Ticks)
		verdict := "anda de fondo"
		if res.Mode == "front" {
			verdict = "necesita estar al frente"
		}
		if res.Saved {
			fmt.Printf("→ %s: guardado en jarvis/focus.json\n", verdict)
		} else {
			fmt.Printf("→ %s, pero el sitio lo pusiste a mano: no se cambió (bin/jarvis focus set %s auto lo deja medir)\n", verdict, res.Host)
		}
		return nil
	case args[0] == "set" && len(args) == 3:
		mode := strings.ToLower(args[2])
		switch mode {
		case "auto":
			mode = ""
		case "front", "background":
		default:
			return fmt.Errorf("modo %q: front, background o auto", args[2])
		}
		host := strings.TrimPrefix(strings.TrimPrefix(args[1], "https://"), "http://")
		if err := call(http.MethodPut, "/api/focus", map[string]string{"host": host, "mode": mode}, nil); err != nil {
			return err
		}
		if mode == "" {
			fmt.Printf("%s sin perfil: de fondo hasta que una acción venza por tiempo\n", host)
		} else {
			fmt.Printf("%s %s (a mano: ni una medición ni una falla lo cambian)\n", host, focusModeText[mode])
		}
		return nil
	case args[0] == "follow" && len(args) == 2 && (args[1] == "on" || args[1] == "off"):
		on := args[1] == "on"
		if err := call(http.MethodPut, "/api/focus", map[string]bool{"follow": on}, nil); err != nil {
			return err
		}
		if on {
			fmt.Println("siguiendo a Claude: cada comando trae su pestaña al frente")
		} else {
			fmt.Println("de fondo por defecto: sólo van al frente los sitios que lo necesitan y el modo guía")
		}
		return nil
	}
	usage()
	return nil
}
