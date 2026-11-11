// Package cockpit es el cliente del PUERTO DE CONTROL de Cockpit (cockpit/, la app de escritorio que junta las
// herramientas del playground): lo usan `bin/cockpit` (cmd/cockpit), para que Claude navegue Cockpit y cuente qué hace,
// y el hook `cockpit` (tablero/server/internal/hooks), que le pasa cada herramienta que Claude usa.
//
// Cockpit, al arrancar, escucha en 127.0.0.1 y deja su puerto y una LLAVE nueva en ~/.config/creditop-cockpit/
// control.json (600); al salir lo borra. Sin ese archivo, Cockpit no está abierto: el cliente lo dice y no espera.
// La llave es para que una página web abierta en el navegador no pueda manejar Cockpit: no la conoce.
package cockpit

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

// Control: dónde escucha Cockpit y con qué llave.
type Control struct {
	Port  int    `json:"port"`
	Token string `json:"token"`
}

// ErrClosed: Cockpit no está abierto (no hay archivo de control, o no contesta).
var ErrClosed = errors.New("Cockpit no está abierto (make cockpit lo instala y lo abre)")

func ControlPath(home string) string {
	return filepath.Join(home, ".config", "creditop-cockpit", "control.json")
}

// Load lee el archivo de control. Sin archivo, ErrClosed.
func Load(home string) (Control, error) {
	raw, err := os.ReadFile(ControlPath(home))
	if err != nil {
		return Control{}, ErrClosed
	}
	var c Control
	if err := json.Unmarshal(raw, &c); err != nil || c.Port == 0 || c.Token == "" {
		return Control{}, fmt.Errorf("el archivo de control de Cockpit está roto: %s", ControlPath(home))
	}
	return c, nil
}

// Do llama al puerto de control. `body` va en JSON; si `out` no es nil, la respuesta se decodifica ahí.
func (c Control) Do(method, path string, body, out any, timeout time.Duration) error {
	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(raw)
	}
	req, err := http.NewRequest(method, fmt.Sprintf("http://127.0.0.1:%d%s", c.Port, path), reader)
	if err != nil {
		return err
	}
	req.Header.Set("x-cockpit-token", c.Token)
	req.Header.Set("content-type", "application/json")
	resp, err := (&http.Client{Timeout: timeout}).Do(req)
	if err != nil {
		return ErrClosed
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 300 {
		var e struct {
			Error string `json:"error"`
		}
		if json.Unmarshal(raw, &e) == nil && e.Error != "" {
			return errors.New(e.Error)
		}
		return fmt.Errorf("Cockpit contestó %d", resp.StatusCode)
	}
	if out != nil {
		return json.Unmarshal(raw, out)
	}
	return nil
}

// Status: qué apps hay, si están arriba y cuál está al frente.
type Status struct {
	Current string `json:"current"`
	Apps    []struct {
		ID    string `json:"id"`
		Name  string `json:"name"`
		Ready bool   `json:"ready"`
	} `json:"apps"`
}

// Activity: una línea del panel «Claude» de Cockpit. `Kind`: say (lo que Claude cuenta), start y end (una herramienta
// que empieza y termina, emparejadas por `ID`), open (Cockpit cambió de app).
type Activity struct {
	Kind    string `json:"kind"`
	ID      string `json:"id,omitempty"`
	Session string `json:"session,omitempty"`
	Tool    string `json:"tool,omitempty"`
	Text    string `json:"text"`
	OK      *bool  `json:"ok,omitempty"`
	App     string `json:"app,omitempty"`
}
