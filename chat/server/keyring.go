package main

// EL LLAVERO: claves que se le pasan a quien las pida en el chat (personas o agentes), CIFRADAS dentro del texto del
// mensaje con la llave del equipo. Todos tienen esa misma llave en su máquina y la descifran con openssl:
//
//	echo '<cifrado>' | openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 -md sha256 -a -A -pass file:$HOME/.config/creditop/team-key
//
// El cifrado lo hace la interfaz (src/keyring.js); el servidor sólo guarda el llavero y la llave en disco, en esta
// máquina y legibles sólo por su dueño. Lo que va en el llavero es para el equipo: lo privado no va acá.

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

type keyEntry struct {
	Name    string `json:"name"`
	Value   string `json:"value"`
	Note    string `json:"note,omitempty"`
	Updated string `json:"updated,omitempty"`
}

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

func keyringPath() (string, error) {
	dir, err := historyDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "keyring.json"), nil
}

func readKeyring() ([]keyEntry, string, error) {
	keys := []keyEntry{}
	p, err := keyringPath()
	if err != nil {
		return nil, "", err
	}
	if b, err := os.ReadFile(p); err == nil {
		if err := json.Unmarshal(b, &keys); err != nil {
			return nil, "", err
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, "", err
	}
	team := ""
	if kp, err := teamKeyPath(); err == nil {
		if b, err := os.ReadFile(kp); err == nil {
			team = strings.TrimSpace(strings.SplitN(string(b), "\n", 2)[0])
		}
	}
	return keys, team, nil
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
		keys, team, err := readKeyring()
		if err != nil {
			fail(w, http.StatusInternalServerError, err)
			return
		}
		kp, _ := teamKeyPath()
		writeJSON(w, http.StatusOK, map[string]any{"keys": keys, "teamKey": team, "teamKeyPath": kp})
	})
	// Guarda el llavero entero (lo arma la interfaz) y, si viene, la llave del equipo.
	mux.HandleFunc("PUT /api/keyring", func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			Keys    []keyEntry `json:"keys"`
			TeamKey *string    `json:"teamKey"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&in); err != nil {
			fail(w, http.StatusBadRequest, errors.New("el cuerpo va en JSON: {keys, teamKey?}"))
			return
		}
		keyringMu.Lock()
		defer keyringMu.Unlock()
		if in.Keys != nil {
			b, _ := json.MarshalIndent(in.Keys, "", "  ")
			p, err := keyringPath()
			if err == nil {
				err = writePrivate(p, b)
			}
			if err != nil {
				fail(w, http.StatusInternalServerError, err)
				return
			}
		}
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
