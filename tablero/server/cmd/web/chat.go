package main

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"creditop/playground/chat/cli"
)

/* LOS MENSAJES DEL EQUIPO, los que llegan por el chat de la terminal del playground compartido.
 *
 * El tablero NO es otro cliente del chat: los lee del CLI (`playground`), cuyo proceso en segundo plano
 * (`playground listen`) ya está conectado al home y los guarda en memoria. Cómo se le pregunta al CLI lo
 * sabe un solo lugar, el paquete chat/cli, que comparte con la app `chat` (donde además se contesta).
 * Abrir una segunda conexión desde acá sería un segundo cliente del mismo servicio, y vería sólo lo que
 * llegó mientras el tablero estaba abierto.
 *
 * ⚠ SIN DISCO: el tablero no copia los mensajes a ningún lado. Lo que no está en el proceso de `listen`
 * (porque llegó antes de prenderlo, o porque se apagó) no existe, igual que en la terminal.
 * ⚠ SÓLO SE MUESTRAN: el texto llega a la UI como dato y se pinta como texto, nunca como HTML. */

type chatResponse struct {
	Installed bool          `json:"installed"`
	Listening bool          `json:"listening"`
	Connected bool          `json:"connected"`
	Since     string        `json:"since,omitempty"`
	Me        *cli.Person   `json:"me,omitempty"`
	Messages  []cli.Message `json:"messages"`
	Error     string        `json:"error,omitempty"`
}

// chat contesta GET /api/chat: si el CLI está, si `listen` está prendido y los mensajes que recibió.
func (a *app) chat(w http.ResponseWriter, r *http.Request) {
	cors(w)
	if r.Method == http.MethodOptions {
		return
	}
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	body := chatResponse{Installed: cli.Installed(), Messages: []cli.Message{}}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	if status, _ := cli.ListenStatus(ctx); status != nil {
		body.Listening, body.Connected, body.Since, body.Me = true, status.Connected, status.Since, status.Me
		if messages, err := cli.Messages(ctx); err != nil {
			body.Error = err.Error()
		} else {
			body.Messages = messages
		}
	}
	json.NewEncoder(w).Encode(body)
}

// chatListen contesta POST /api/chat/listen: prende `playground listen`, lo mismo que correrlo en la
// terminal. El CLI lo desprende, así que sigue vivo aunque se reinicie el tablero. Sin sesión vigente no
// intenta entrar —no hay terminal delante— y contesta «corré `playground login`», que la UI muestra.
func (a *app) chatListen(w http.ResponseWriter, r *http.Request) {
	cors(w)
	if r.Method == http.MethodOptions {
		return
	}
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	if err := cli.Listen(ctx); err != nil {
		w.WriteHeader(http.StatusBadGateway)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}
	json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}
