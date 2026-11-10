package main

// EL LLAVERO: claves que se le pasan a quien las pida en el chat (personas o agentes), CIFRADAS dentro del texto del
// mensaje con la llave del equipo. Todos tienen esa misma llave en su máquina y la descifran con openssl:
//
//	echo '<cifrado>' | openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 -md sha256 -a -A -pass file:$HOME/.config/creditop/team-key
//
// El cifrado lo hace la interfaz (src/keyring.js) y no se guarda ninguna clave: el servidor sólo guarda la llave del
// equipo en disco, en esta máquina y legible sólo por su dueño. Lo que se pasa así es para el equipo: lo privado no.

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

var keyringMu sync.Mutex

// teamKeyPath: la llave del equipo, en el mismo lugar para todos (así el comando de openssl es el mismo).
func teamKeyPath() (string, error) {
	if p := os.Getenv("CREDITOP_TEAM_KEY_FILE"); p != "" {
		return p, nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".config", "creditop", "team-key"), nil
}

// readTeamKey: la primera línea del archivo (como la lee openssl con -pass file:), o vacío si no hay.
func readTeamKey() string {
	kp, err := teamKeyPath()
	if err != nil {
		return ""
	}
	b, err := os.ReadFile(kp)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(strings.SplitN(string(b), "\n", 2)[0])
}

func writePrivate(path string, data []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func registerKeyring(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/keyring", func(w http.ResponseWriter, r *http.Request) {
		keyringMu.Lock()
		defer keyringMu.Unlock()
		kp, _ := teamKeyPath()
		writeJSON(w, http.StatusOK, map[string]any{"teamKey": readTeamKey(), "teamKeyPath": kp})
	})
	// Guarda la llave del equipo.
	mux.HandleFunc("PUT /api/keyring", func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			TeamKey *string `json:"teamKey"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&in); err != nil || in.TeamKey == nil {
			fail(w, http.StatusBadRequest, errors.New("el cuerpo va en JSON: {teamKey}"))
			return
		}
		keyringMu.Lock()
		defer keyringMu.Unlock()
		if in.TeamKey != nil {
			k := strings.TrimSpace(*in.TeamKey)
			if k == "" || strings.ContainsAny(k, " \n\t") {
				fail(w, http.StatusBadRequest, errors.New("la llave del equipo es una sola línea sin espacios"))
				return
			}
			kp, err := teamKeyPath()
			if err == nil {
				err = writePrivate(kp, []byte(k+"\n"))
			}
			if err != nil {
				fail(w, http.StatusInternalServerError, err)
				return
			}
		}
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	})
}
