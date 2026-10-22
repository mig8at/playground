package main

/* LOS AGENTES DEL CHAT — conversaciones con algo que no es una persona del equipo.
 *
 * Por ahora uno: el agente de Jira, que registra las tareas. Se le escribe como a cualquiera y contesta con
 * las tareas asignadas a quien usa el chat (las abiertas: sin las terminadas), su estado y su avance, en JSON.
 * Es un prototipo: el avance se estima por el estado, porque Jira no lo trae en un campo propio.
 *
 * Jira se lee con el conector de siempre (connectors/atlassian, credenciales en connectors/.env): este server no
 * guarda ni copia nada. Sólo lee.
 */

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"creditop/playground/connectors/atlassian"
)

// Agent es lo que la interfaz lista en la sección de agentes.
type Agent struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Detail string `json:"detail"`
}

var agents = []Agent{
	{ID: "jira", Name: "Agente de Jira", Detail: "tus tareas, su estado y su avance"},
}

// La JQL de «mis tareas»: asignadas a la cuenta del conector, sin las terminadas, las más movidas primero.
const myOpenIssuesJQL = "assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC"

type taskReport struct {
	Key      string `json:"clave"`
	Summary  string `json:"titulo"`
	Status   string `json:"estado"`
	Progress int    `json:"avance"`
	Type     string `json:"tipo,omitempty"`
	Sprint   string `json:"sprint,omitempty"`
	Updated  string `json:"actualizada,omitempty"`
	URL      string `json:"url,omitempty"`
}

type jiraReply struct {
	Agent     string       `json:"agente"`
	Greeting  string       `json:"saludo"`
	Generated string       `json:"generado"`
	Total     int          `json:"total"`
	Progress  string       `json:"como_se_mide_el_avance"`
	Tasks     []taskReport `json:"tareas"`
}

// progressOf estima el avance por el estado: la categoría de Jira (por hacer, en curso, hecho) y, dentro de
// «en curso», las pruebas como el último tramo antes de terminar.
func progressOf(category, status string) int {
	switch category {
	case "done":
		return 100
	case "new":
		return 0
	}
	s := strings.ToLower(status)
	if strings.Contains(s, "prueba") || strings.Contains(s, "test") || strings.Contains(s, "qa") || strings.Contains(s, "revis") {
		return 80
	}
	return 50
}

func jiraAgentReply(ctx context.Context) (string, error) {
	cfg, err := atlassian.LoadConfig()
	if err != nil {
		return "", err
	}
	issues, err := atlassian.NewFromConfig(cfg).SearchIssuesDetailed(ctx, myOpenIssuesJQL)
	if err != nil {
		return "", err
	}
	reply := jiraReply{
		Agent: "Agente de Jira", Greeting: "Hola. Estas son tus tareas abiertas en Jira.",
		Generated: time.Now().Format(time.RFC3339), Total: len(issues),
		Progress: "estimado por estado: por hacer 0 · en curso 50 · en pruebas o revisión 80 · hecho 100",
		Tasks:    make([]taskReport, 0, len(issues)),
	}
	for _, it := range issues {
		t := taskReport{Key: it.Key, Summary: it.Summary, Status: it.Status, Progress: progressOf(it.Category, it.Status),
			Type: it.Type, Updated: it.Updated, URL: cfg.Site + "/browse/" + it.Key}
		if n := len(it.Sprints); n > 0 {
			t.Sprint = it.Sprints[n-1]
		}
		reply.Tasks = append(reply.Tasks, t)
	}
	out, err := json.MarshalIndent(reply, "", "  ")
	return string(out), err
}

func agentHandlers(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/agents", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"agents": agents})
	})

	// Un mensaje al agente: contesta con su informe. El agente de Jira responde lo mismo a cualquier mensaje
	// (un «hola» alcanza): por ahora no entiende otras preguntas.
	mux.HandleFunc("POST /api/agents/{id}", func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			Text string `json:"text"`
		}
		_ = json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&in)
		switch r.PathValue("id") {
		case "jira":
			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()
			reply, err := jiraAgentReply(ctx)
			if err != nil {
				fail(w, http.StatusBadGateway, errors.New("no pude leer Jira: "+err.Error()))
				return
			}
			writeJSON(w, http.StatusOK, map[string]string{"reply": reply, "format": "json"})
		default:
			fail(w, http.StatusNotFound, errors.New("no existe ese agente"))
		}
	})
}
