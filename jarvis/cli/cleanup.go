package main

/* `bin/jarvis cleanup [--apply]`: qué se puede cerrar ahora y por qué (server/cleanup.go). Sin --apply sólo muestra;
 * con --apply lo cierra. El barrido de fondo del servidor hace lo mismo solo, con más paciencia: las sesiones
 * terminadas a los 3 min y las olvidadas a los 10; acá las terminadas se cierran ya. */

import (
	"fmt"
	"net/http"
)

type cleanupItem struct {
	Kind      string `json:"kind"`
	Session   string `json:"session"`
	ChromeTab int    `json:"chromeTab"`
	Title     string `json:"title"`
	URL       string `json:"url"`
	Group     string `json:"group"`
	Reason    string `json:"reason"`
	KeepEmpty bool   `json:"keepEmpty"`
}

func cleanupCmd(args []string) error {
	apply := false
	for _, a := range args {
		if a == "--apply" {
			apply = true
			continue
		}
		usage()
	}
	method := http.MethodGet
	if apply {
		method = http.MethodPost
	}
	// Este comando mira todo: ni la sesión ni el grupo de este comando lo acotan.
	tabID, groupName = "", ""
	var items []cleanupItem
	if err := call(method, "/api/cleanup", nil, &items); err != nil {
		return err
	}
	if len(items) == 0 {
		fmt.Println("nada para cerrar: cada pestaña abierta por Jarvis tiene una sesión que la usa")
		return nil
	}
	verb := "se puede cerrar"
	if apply {
		verb = "cerrado"
	}
	for _, it := range items {
		what := ""
		switch it.Kind {
		case "orphan":
			what = fmt.Sprintf("pestaña huérfana %d", it.ChromeTab)
		default:
			what = "sesión " + it.Session
			if it.KeepEmpty {
				what += " (queda vacía: es la última)"
			}
		}
		page := it.Title
		if page == "" {
			page = it.URL
		}
		group := ""
		if it.Group != "" {
			group = " · grupo «" + it.Group + "»"
		}
		fmt.Printf("  %s: %s · %s%s\n      %s\n", verb, what, page, group, it.Reason)
	}
	if !apply {
		fmt.Println("(bin/jarvis cleanup --apply lo cierra; lo que abriste o compartiste vos no entra nunca)")
	}
	return nil
}
