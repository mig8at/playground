package main

/* `bin/jarvis attention '<motivo>'`: Claude necesita a la persona en esta sesión (server/attention.go). Se le avisa a
 * simple vista —🔔 en el título de la pestaña, su grupo «⚠ …» en rojo, un número en el ícono de Jarvis y la tarjeta
 * con borde rojo en Cockpit— hasta `attention --clear`, `finish` o que se cierre la sesión. */

import (
	"fmt"
	"net/http"
	"strings"
)

func attentionCmd(args []string) error {
	reason := strings.TrimSpace(strings.Join(args, " "))
	if reason == "" {
		usage()
	}
	if reason == "--clear" {
		reason = ""
	}
	var res struct{ Attention string }
	if err := call(http.MethodPost, "/api/live/attention", map[string]string{"reason": reason}, &res); err != nil {
		return err
	}
	switch {
	case reason == "" && res.Attention == "":
		fmt.Println("listo: la sesión ya no necesita a la persona")
	case reason == "":
		fmt.Printf("borrado lo que pediste, pero la sesión igual la necesita: %s\n", res.Attention)
	default:
		fmt.Printf("avisado: 🔔 en la pestaña y la tarjeta marcada en Cockpit · %s\n", res.Attention)
	}
	return nil
}
