package main

// CUADRILLA EN EL CHAT: tus tareas, lo que anotan los demás en ellas y anotar, bloquear o cerrar sin salir de la
// conversación. Todo por el CLI (`cli.Cuadrilla*`), con tu sesión.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"creditop/playground/chat/cli"
)

func cuadrillaHandlers(mux *http.ServeMux) {
	// El tablero entero y quién sos en él: la app arma tus tareas y lo nuevo con eso.
	mux.HandleFunc("GET /api/cuadrilla", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
		defer cancel()
		me, err := cli.Me(ctx)
		if err != nil {
			fail(w, http.StatusBadGateway, err)
			return
		}
		epics, err := cli.CuadrillaBoard(ctx)
		if err != nil {
			fail(w, http.StatusBadGateway, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"me": me, "url": cli.CuadrillaURL(), "epicas": epics})
	})

	// Una nota en una tarea: un avance, un bloqueo (con de quién depende) o un desbloqueo.
	mux.HandleFunc("POST /api/cuadrilla/note", func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			Task, Kind, Text, Owner string
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&in); err != nil {
			fail(w, http.StatusBadRequest, errors.New("el cuerpo va en JSON: {task, kind, text, owner}"))
			return
		}
		in.Task, in.Text, in.Owner = strings.TrimSpace(in.Task), strings.TrimSpace(in.Text), strings.TrimSpace(in.Owner)
		if len([]rune(in.Text)) > maxText {
			fail(w, http.StatusRequestEntityTooLarge, fmt.Errorf("la nota pasa de %d caracteres", maxText))
			return
		}
		shortcut, params := "", map[string]string{"task": in.Task}
		switch in.Kind {
		case "avance", "":
			shortcut = "note"
			params["text"] = in.Text
		case "bloqueo":
			if in.Owner == "" {
				fail(w, http.StatusBadRequest, errors.New("un bloqueo dice de quién depende: @persona o un tercero"))
				return
			}
			shortcut = "block"
			params["owner"], params["text"] = in.Owner, in.Text
		case "desbloqueo":
			shortcut = "unblock"
			if in.Text != "" {
				params["text"] = in.Text
			}
		default:
			fail(w, http.StatusBadRequest, fmt.Errorf("«%s» no es un tipo de nota: avance, bloqueo o desbloqueo", in.Kind))
			return
		}
		if in.Task == "" || (in.Kind != "desbloqueo" && in.Text == "") {
			fail(w, http.StatusBadRequest, errors.New("falta la tarea o el texto"))
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
		defer cancel()
		if err := cli.CuadrillaWrite(ctx, shortcut, params); err != nil {
			fail(w, http.StatusBadGateway, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	})

	// Marcar una tarea hecha. Cuadrilla deja hacerlo a quien la creó o a quien la lleva.
	mux.HandleFunc("POST /api/cuadrilla/done", func(w http.ResponseWriter, r *http.Request) {
		var in struct{ Task string }
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&in); err != nil || strings.TrimSpace(in.Task) == "" {
			fail(w, http.StatusBadRequest, errors.New("el cuerpo va en JSON: {task}"))
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
		defer cancel()
		if err := cli.CuadrillaWrite(ctx, "edit", map[string]string{"task": strings.TrimSpace(in.Task), "done": "true"}); err != nil {
			fail(w, http.StatusBadGateway, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	})
}
