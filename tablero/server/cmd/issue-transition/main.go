// Command issue-transition mueve un issue de Jira al estado cuyo nombre contiene
// el texto dado (ej. "prueba" → "En pruebas"). Lista las transiciones disponibles
// desde el estado actual y aplica la que corresponde. Reutiliza credenciales del
// tablero (ATLASSIAN_* del .env).
//
// Uso:
//
//	go run ./cmd/issue-transition <KEY> <substring-del-estado-destino>
//	go run ./cmd/issue-transition CORE-309 prueba
package main

import (
	"context"
	"log"
	"os"
	"strings"

	"creditop/tablero/server/internal/atlassian"
	"creditop/tablero/server/internal/env"
)

func main() {
	log.SetFlags(0)
	if len(os.Args) < 3 {
		log.Fatal("uso: issue-transition <KEY> <substring-del-estado-destino>")
	}
	key, target := os.Args[1], strings.ToLower(os.Args[2])

	env.LoadDefaults()
	site, email, token := os.Getenv("ATLASSIAN_SITE"), os.Getenv("ATLASSIAN_EMAIL"), os.Getenv("ATLASSIAN_API_TOKEN")
	if site == "" || email == "" || token == "" {
		log.Fatal("faltan credenciales ATLASSIAN_* (revisá server/.env)")
	}
	c := atlassian.New(site, email, token)
	ctx := context.Background()

	ts, err := c.IssueTransitions(ctx, key)
	if err != nil {
		log.Fatalf("listando transiciones de %s: %v", key, err)
	}
	var match *atlassian.Transition
	for i := range ts {
		if strings.Contains(strings.ToLower(ts[i].To), target) || strings.Contains(strings.ToLower(ts[i].Name), target) {
			match = &ts[i]
			break
		}
	}
	if match == nil {
		log.Printf("no encontré transición a un estado que contenga %q. Disponibles:", target)
		for _, t := range ts {
			log.Printf("  - %q → estado %q (id %s)", t.Name, t.To, t.ID)
		}
		os.Exit(1)
	}
	if err := c.TransitionIssue(ctx, key, match.ID); err != nil {
		log.Fatalf("aplicando transición %q en %s: %v", match.Name, key, err)
	}
	log.Printf("OK: %s → %q (transición %q)", key, match.To, match.Name)
}
