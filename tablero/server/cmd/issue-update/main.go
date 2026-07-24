// Command issue-update edita el summary y/o la descripción de un issue de Jira
// existente. Reutiliza el cliente y las credenciales del tablero (ATLASSIAN_*
// del .env), sin tocar el server en ejecución.
//
// Uso:
//
//	go run ./cmd/issue-update <archivo.json>
//
// donde el JSON es {"key":"CORE-309","summary":"...","description":"..."}.
package main

import (
	"context"
	"encoding/json"
	"log"
	"os"

	"creditop/tablero/server/internal/atlassian"
	"creditop/tablero/server/internal/env"
)

func main() {
	log.SetFlags(0)
	if len(os.Args) < 2 {
		log.Fatal("uso: issue-update <archivo.json con {key,summary,description}>")
	}
	raw, err := os.ReadFile(os.Args[1])
	if err != nil {
		log.Fatalf("leyendo %s: %v", os.Args[1], err)
	}
	var in struct {
		Key         string `json:"key"`
		Summary     string `json:"summary"`
		Description string `json:"description"`
	}
	if err := json.Unmarshal(raw, &in); err != nil {
		log.Fatalf("json inválido: %v", err)
	}
	if in.Key == "" {
		log.Fatal("falta 'key' en el JSON")
	}

	env.LoadDefaults()
	site, email, token := os.Getenv("ATLASSIAN_SITE"), os.Getenv("ATLASSIAN_EMAIL"), os.Getenv("ATLASSIAN_API_TOKEN")
	if site == "" || email == "" || token == "" {
		log.Fatal("faltan credenciales ATLASSIAN_* (revisá server/.env)")
	}

	c := atlassian.New(site, email, token)
	if err := c.UpdateIssue(context.Background(), in.Key, atlassian.UpdateIssueParams{
		Summary:     in.Summary,
		Description: in.Description,
	}); err != nil {
		log.Fatalf("update %s ERROR: %v", in.Key, err)
	}
	log.Printf("OK: %s actualizado", in.Key)
}
