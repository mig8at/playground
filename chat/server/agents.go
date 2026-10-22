package main

/* LOS AGENTES DEL CHAT — conversaciones con algo que no es una persona del equipo.
 *
 * Por ahora uno: el agente de Jira, que registra las tareas. Se le escribe como a cualquiera y contesta con
 * las tareas activas (sin las terminadas) asignadas a quien usa el chat en el sprint actual, su estado y su
 * avance, en JSON, con un resumen del sprint.
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
	"os"
	"strconv"
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
	{ID: "jira", Name: "Agente de Jira", Detail: "tus tareas del sprint, su estado y su avance"},
}

// El board de CORE: su sprint activo es «el sprint actual» (el mismo que usa el tablero). JIRA_BOARD_ID lo cambia.
func boardID() int {
	if n, err := strconv.Atoi(os.Getenv("JIRA_BOARD_ID")); err == nil && n > 0 {
		return n
	}
	return 384
}

type taskReport struct {
	Key      string   `json:"clave"`
	Summary  string   `json:"titulo"`
	Status   string   `json:"estado"`
	Progress int      `json:"avance"`
	Points   *float64 `json:"puntos,omitempty"`
	URL      string   `json:"url"`
}

type sprintReport struct {
	Name     string `json:"nombre"`
	Start    string `json:"inicio,omitempty"`
	End      string `json:"fin,omitempty"`
	Assigned int    `json:"asignadas_a_vos"`
	Done     int    `json:"terminadas"`
	Active   int    `json:"activas"`
}

type jiraReply struct {
	Agent     string       `json:"agente"`
	Greeting  string       `json:"saludo"`
	Generated string       `json:"generado"`
	Sprint    sprintReport `json:"sprint"`
	Progress  string       `json:"como_se_mide_el_avance"`
	Tasks     []taskReport `json:"tareas"`
}

// progressOf estima el avance por el estado: la categoría de Jira (por hacer, en curso, hecho) y, dentro de
// «en curso», las pruebas o la revisión como el último tramo antes de terminar.
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

// jiraAgentReply: las tareas ACTIVAS (sin las terminadas) asignadas a la cuenta del conector en el sprint
// activo del board, con un resumen del sprint.
func jiraAgentReply(ctx context.Context) (string, error) {
	cfg, err := atlassian.LoadConfig()
	if err != nil {
		return "", err
	}
	client := atlassian.NewFromConfig(cfg)
	sprint, err := client.ActiveSprint(ctx, boardID())
	if err != nil {
		return "", err
	}
	issues, err := client.MySprintIssues(ctx, sprint.ID)
	if err != nil {
		return "", err
	}
	reply := jiraReply{
		Agent: "Agente de Jira", Greeting: "Hola. Estas son tus tareas activas en el sprint actual.",
		Generated: time.Now().Format(time.RFC3339),
		Sprint:    sprintReport{Name: sprint.Name, Start: dateOnly(sprint.StartDate), End: dateOnly(sprint.EndDate), Assigned: len(issues)},
		Progress:  "estimado por estado: por hacer 0 · en curso 50 · en pruebas o revisión 80 · hecho 100",
		Tasks:     []taskReport{},
	}
	for _, it := range issues {
		if it.StatusCategory == "done" {
			reply.Sprint.Done++
			continue
		}
		t := taskReport{Key: it.Key, Summary: it.Summary, Status: it.Status, Progress: progressOf(it.StatusCategory, it.Status),
			URL: cfg.Site + "/browse/" + it.Key}
		if it.HasPoints {
			points := it.Points
			t.Points = &points
		}
		reply.Tasks = append(reply.Tasks, t)
	}
	reply.Sprint.Active = len(reply.Tasks)
	out, err := json.MarshalIndent(reply, "", "  ")
	return string(out), err
}

func dateOnly(s string) string {
	if len(s) < 10 {
		return s
	}
	return s[:10]
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
