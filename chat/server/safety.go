package main

// LA SEGURIDAD DE TUS AGENTES: prenderlos y apagarlos desde el chat, uno por uno (el interruptor de su ficha).
//
// Tus agentes (agents/*: time, fact) se le anuncian al equipo con `playground listen`, que lee
// ~/playground/team/agents.json en cada pregunta que llega. Apagar uno es moverlo de `agents` a `off` en ese mismo
// archivo: `listen` sólo mira `agents`, así que deja de contestarle al equipo en el acto («no está en esta máquina»).
// Después se le pide a `listen`, por su socket, que vuelva a anunciar, para que tampoco figure en la lista del equipo.
// El proceso del agente sigue prendido (sólo escucha en esta máquina): lo que se corta es que le llegue el equipo.
//
// «Mi agente» (el que contesta por vos en tus conversaciones) vive en el navegador: su interruptor lo maneja la
// interfaz.

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sync"
	"time"
)

type ownAgent struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	URL         string `json:"url"`
}

type ownAgentView struct {
	ownAgent
	On        bool `json:"on"`
	Listening bool `json:"listening"` // su puerto contesta en esta máquina
}

// El archivo, en la forma que entiende `playground listen` ({ "agents": [...] }) y con los apagados al lado.
type agentsFileShape struct {
	Agents []ownAgent `json:"agents"`
	Off    []ownAgent `json:"off,omitempty"`
}

var agentsFileMu sync.Mutex

func agentsFilePath() string {
	if dir := os.Getenv("PLAYGROUND_TEAM_DIR"); dir != "" {
		return filepath.Join(dir, "agents.json")
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, "playground", "team", "agents.json")
}

// Una lista suelta (la forma de antes) o { agents, off }.
func readAgentsFile() (agentsFileShape, error) {
	raw, err := os.ReadFile(agentsFilePath())
	if errors.Is(err, os.ErrNotExist) {
		return agentsFileShape{}, nil
	}
	if err != nil {
		return agentsFileShape{}, err
	}
	var list []ownAgent
	if json.Unmarshal(raw, &list) == nil {
		return agentsFileShape{Agents: list}, nil
	}
	var shape agentsFileShape
	if err := json.Unmarshal(raw, &shape); err != nil {
		return agentsFileShape{}, errors.New("agents.json no es JSON válido")
	}
	return shape, nil
}

// Se escribe a un temporal y se renombra: `listen` nunca lee un archivo a medias.
func writeAgentsFile(shape agentsFileShape) error {
	if shape.Agents == nil {
		shape.Agents = []ownAgent{}
	}
	raw, err := json.MarshalIndent(shape, "", "  ")
	if err != nil {
		return err
	}
	path := agentsFilePath()
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, append(raw, '\n'), 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func portAnswers(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return false
	}
	conn, err := net.DialTimeout("tcp", u.Host, 500*time.Millisecond)
	if err != nil {
		return false
	}
	conn.Close()
	return true
}

// Le pide a `playground listen` que vuelva a anunciar tus agentes (su socket de control, sólo de este usuario).
// Si no está escuchando no hace falta: el anuncio sale cuando arranque.
func reannounceAgents() {
	home, _ := os.UserHomeDir()
	sockets, _ := filepath.Glob(filepath.Join(home, ".config", "creditop-playground", "listen.*.sock"))
	for _, sock := range sockets {
		client := &http.Client{Timeout: 3 * time.Second, Transport: &http.Transport{
			DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
				return (&net.Dialer{}).DialContext(ctx, "unix", sock)
			},
		}}
		if res, err := client.Post("http://listen/agents", "application/json", bytes.NewReader(nil)); err == nil {
			res.Body.Close()
		}
	}
}

func safetyView() ([]ownAgentView, error) {
	shape, err := readAgentsFile()
	if err != nil {
		return nil, err
	}
	out := []ownAgentView{}
	for _, a := range shape.Agents {
		out = append(out, ownAgentView{ownAgent: a, On: true, Listening: portAnswers(a.URL)})
	}
	for _, a := range shape.Off {
		out = append(out, ownAgentView{ownAgent: a, On: false, Listening: portAnswers(a.URL)})
	}
	return out, nil
}

// Mueve un agente entre `agents` y `off`. name vacío: todos.
func setAgentsOn(name string, on bool) error {
	agentsFileMu.Lock()
	defer agentsFileMu.Unlock()
	shape, err := readAgentsFile()
	if err != nil {
		return err
	}
	all := append(append([]ownAgent{}, shape.Agents...), shape.Off...)
	next := agentsFileShape{Agents: []ownAgent{}}
	found := name == ""
	for _, a := range all {
		isOn := containsAgent(shape.Agents, a.Name)
		if name == "" || a.Name == name {
			found = found || a.Name == name
			isOn = on
		}
		if isOn {
			next.Agents = append(next.Agents, a)
		} else {
			next.Off = append(next.Off, a)
		}
	}
	if !found {
		return errors.New("no tenés un agente con ese nombre en agents.json")
	}
	if err := writeAgentsFile(next); err != nil {
		return err
	}
	reannounceAgents()
	return nil
}

func containsAgent(list []ownAgent, name string) bool {
	for _, a := range list {
		if a.Name == name {
			return true
		}
	}
	return false
}

func safetyHandlers(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/safety", func(w http.ResponseWriter, r *http.Request) {
		agents, err := safetyView()
		if err != nil {
			fail(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"agents": agents, "file": agentsFilePath()})
	})
	mux.HandleFunc("POST /api/safety/agents/{name}", func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			On bool `json:"on"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&in); err != nil {
			fail(w, http.StatusBadRequest, errors.New("el cuerpo va en JSON: {on}"))
			return
		}
		if err := setAgentsOn(r.PathValue("name"), in.On); err != nil {
			fail(w, http.StatusBadRequest, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	})
}
