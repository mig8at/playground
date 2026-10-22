package main

/* LOS AGENTES DEL CHAT — conversaciones con algo que no es una persona del equipo.
 *
 * Por ahora uno: el agente de Jira. Se le escribe en lenguaje natural y contesta igual:
 *   - si la pregunta nombra un día («¿cómo te fue ayer?»), qué se trabajó ese día en tareas del equipo
 *     (workday.go: sin el trabajo propio ni cómo se hizo);
 *   - si no, cómo va el sprint actual: las tareas activas, su estado y su avance (estimado por el estado,
 *     porque Jira no lo trae en un campo propio).
 *
 * Jira se lee con el conector de siempre (connectors/atlassian, credenciales en connectors/.env): este server no
 * guarda ni copia nada. Sólo lee.
 */

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
	"unicode"

	"creditop/playground/chat/cli"
	"creditop/playground/connectors/atlassian"
)

// Agent es lo que la interfaz lista en la sección de agentes.
type Agent struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Detail string `json:"detail"`
}

var agents = []Agent{
	{ID: "jira", Name: "Agente de Jira", Detail: "cómo va el sprint y qué se trabajó cada día"},
}

// El board de CORE: su sprint activo es «el sprint actual» (el mismo que usa el tablero). JIRA_BOARD_ID lo cambia.
func boardID() int {
	if n, err := strconv.Atoi(os.Getenv("JIRA_BOARD_ID")); err == nil && n > 0 {
		return n
	}
	return 384
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

// sprintReply: las tareas ACTIVAS (sin las terminadas) asignadas a la cuenta del conector en el sprint activo del
// board, contadas en una frase cada una. Datos de Jira, sin redactar con un modelo: alcanza con una plantilla.
func sprintReply(ctx context.Context, who string) (string, error) {
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
	done, active := 0, []string{}
	for _, it := range issues {
		if it.StatusCategory == "done" {
			done++
			continue
		}
		active = append(active, fmt.Sprintf("%s (%s) está %s, avance estimado %d %%", it.Key, it.Summary,
			strings.ToLower(plainStatus(it.Status)), progressOf(it.StatusCategory, it.Status)))
	}
	head := fmt.Sprintf("En el %s (del %s al %s) %s tiene %d tareas: %d terminadas y %d activas.", sprint.Name,
		dateOnly(sprint.StartDate), dateOnly(sprint.EndDate), who, len(issues), done, len(active))
	if len(active) == 0 {
		return head, nil
	}
	return head + " " + strings.Join(active, ". ") + ". (El avance se estima por el estado.)", nil
}

// El estado sin el emoji con que lo adorna Jira («🧪 En pruebas» → «En pruebas»).
func plainStatus(s string) string {
	return strings.TrimLeftFunc(s, func(r rune) bool { return !unicode.IsLetter(r) })
}

// Cómo nombrar al dueño del agente: el nombre con que lo conoce el chat del playground, o la parte del correo.
func ownerName(ctx context.Context) string {
	if s, _ := cli.ListenStatus(ctx); s != nil && s.Me != nil && s.Me.Name != "" {
		return strings.Fields(s.Me.Name)[0]
	}
	if cfg, err := atlassian.LoadConfig(); err == nil && cfg.Email != "" {
		name := strings.Split(cfg.Email, "@")[0]
		return strings.ToUpper(name[:1]) + name[1:]
	}
	return "la persona"
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
			ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
			defer cancel()
			who := ownerName(ctx)
			var reply string
			var err error
			// ¿Pregunta por un día? Lo que trabajó ese día (para el equipo); si no, cómo va el sprint.
			if day, label, ok := askedDay(in.Text, time.Now()); ok {
				reply, err = workdayReply(ctx, who, in.Text, day, label)
			} else {
				reply, err = sprintReply(ctx, who)
			}
			if err != nil {
				fail(w, http.StatusBadGateway, errors.New("no pude armar la respuesta: "+err.Error()))
				return
			}
			writeJSON(w, http.StatusOK, map[string]string{"reply": reply, "format": "text"})
		default:
			fail(w, http.StatusNotFound, errors.New("no existe ese agente"))
		}
	})
}
