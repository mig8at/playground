package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

/* LOS MENSAJES DEL EQUIPO, los que llegan por el chat de la terminal del playground compartido.
 *
 * El tablero NO es otro cliente del chat: los lee del CLI (`playground`), cuyo proceso en segundo plano
 * (`playground listen`) ya está conectado al home y los guarda en memoria. Pedírselos con
 * `playground messages --json` es preguntarle a ese proceso por su socket local, sin conocer el socket
 * ni el protocolo: si el CLI los cambia, esto sigue andando. Abrir una segunda conexión desde acá sería
 * un segundo cliente del mismo servicio, y vería sólo lo que llegó mientras el tablero estaba abierto.
 *
 * ⚠ SIN DISCO: el tablero no copia los mensajes a ningún lado. Lo que no está en el proceso de `listen`
 * (porque llegó antes de prenderlo, o porque se apagó) no existe, igual que en la terminal.
 * ⚠ SÓLO SE MUESTRAN: el texto llega a la UI como dato y se pinta como texto, nunca como HTML. */

type chatStatus struct {
	Since     string          `json:"since"`
	Connected bool            `json:"connected"`
	Me        json.RawMessage `json:"me"`
}

type chatResponse struct {
	Installed bool              `json:"installed"`
	Listening bool              `json:"listening"`
	Connected bool              `json:"connected"`
	Since     string            `json:"since,omitempty"`
	Me        json.RawMessage   `json:"me,omitempty"`
	Messages  []json.RawMessage `json:"messages"`
	Error     string            `json:"error,omitempty"`
}

// playgroundCLI encuentra el CLI aunque el server corra con un PATH sin `~/.local/bin`, que es donde
// lo deja el instalador (npm no siempre hereda el PATH de la shell interactiva).
func playgroundCLI() (string, error) {
	if path, err := exec.LookPath("playground"); err == nil {
		return path, nil
	}
	path := filepath.Join(os.Getenv("HOME"), ".local", "bin", "playground")
	if _, err := os.Stat(path); err != nil {
		return "", errors.New("no encuentro el CLI `playground`")
	}
	return path, nil
}

// runPlayground corre el CLI y devuelve su salida estándar. Un código distinto de 0 es un error, con lo
// que el CLI dijo por stderr.
func runPlayground(ctx context.Context, args ...string) ([]byte, error) {
	cli, err := playgroundCLI()
	if err != nil {
		return nil, err
	}
	var stdout, stderr bytes.Buffer
	cmd := exec.CommandContext(ctx, cli, args...)
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	if err := cmd.Run(); err != nil {
		if msg := bytes.TrimSpace(stderr.Bytes()); len(msg) > 0 {
			return nil, errors.New(string(msg))
		}
		return nil, err
	}
	return stdout.Bytes(), nil
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
	body := chatResponse{Messages: []json.RawMessage{}}
	if _, err := playgroundCLI(); err != nil {
		json.NewEncoder(w).Encode(body)
		return
	}
	body.Installed = true

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	// `listen --status` sale 1 cuando no está escuchando: eso no es un error, es el estado.
	out, err := runPlayground(ctx, "listen", "--status", "--json")
	var status chatStatus
	if err != nil || json.Unmarshal(out, &status) != nil {
		json.NewEncoder(w).Encode(body)
		return
	}
	body.Listening, body.Connected, body.Since, body.Me = true, status.Connected, status.Since, status.Me

	if out, err = runPlayground(ctx, "messages", "--json"); err != nil {
		body.Error = err.Error()
	} else if err = json.Unmarshal(out, &body.Messages); err != nil {
		body.Error = "el CLI devolvió algo que no es una lista de mensajes"
		body.Messages = []json.RawMessage{}
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
	if _, err := runPlayground(ctx, "listen"); err != nil {
		w.WriteHeader(http.StatusBadGateway)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}
	json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}
