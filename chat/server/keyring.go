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

	// LAS CLAVES GUARDADAS: sólo su nombre y su ENCRIPTADO (nunca el valor), en el directorio del historial del chat.
	mux.HandleFunc("GET /api/keyring/keys", func(w http.ResponseWriter, r *http.Request) {
		keyringMu.Lock()
		defer keyringMu.Unlock()
		keys, err := readSavedKeys()
		if err != nil {
			fail(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"keys": keys})
	})
	// Una a la vez (guardar o reemplazar por nombre, y borrar): dos ventanas abiertas no se pisan la lista.
	mux.HandleFunc("POST /api/keyring/keys", func(w http.ResponseWriter, r *http.Request) {
		var in savedKey
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&in); err != nil {
			fail(w, http.StatusBadRequest, errors.New("el cuerpo va en JSON: {name, sealed}"))
			return
		}
		in.Name = strings.TrimSpace(in.Name)
		if in.Name == "" || !strings.HasPrefix(in.Sealed, "U2FsdGVkX1") {
			fail(w, http.StatusBadRequest, errors.New("va un nombre y la clave ENCRIPTADA"))
			return
		}
		updateSavedKeys(w, func(keys []savedKey) []savedKey {
			out := []savedKey{}
			for _, k := range keys {
				if k.Name != in.Name {
					out = append(out, k)
				}
			}
			return append(out, in)
		})
	})
	mux.HandleFunc("DELETE /api/keyring/keys/{name}", func(w http.ResponseWriter, r *http.Request) {
		name := r.PathValue("name")
		updateSavedKeys(w, func(keys []savedKey) []savedKey {
			out := []savedKey{}
			for _, k := range keys {
				if k.Name != name {
					out = append(out, k)
				}
			}
			return out
		})
	})
}

type savedKey struct {
	Name    string `json:"name"`
	Sealed  string `json:"sealed"`
	Updated string `json:"updated"`
}

func savedKeysPath() (string, error) {
	dir, err := historyDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "keyring.json"), nil
}

func readSavedKeys() ([]savedKey, error) {
	keys := []savedKey{}
	p, err := savedKeysPath()
	if err != nil {
		return nil, err
	}
	b, err := os.ReadFile(p)
	if errors.Is(err, os.ErrNotExist) {
		return keys, nil
	}
	if err != nil {
		return nil, err
	}
	return keys, json.Unmarshal(b, &keys)
}

// updateSavedKeys lee, cambia y escribe bajo el mismo candado, y contesta con la lista que quedó.
func updateSavedKeys(w http.ResponseWriter, change func([]savedKey) []savedKey) {
	keyringMu.Lock()
	defer keyringMu.Unlock()
	keys, err := readSavedKeys()
	if err == nil {
		keys = change(keys)
		b, _ := json.MarshalIndent(keys, "", "  ")
		var p string
		if p, err = savedKeysPath(); err == nil {
			err = writePrivate(p, b)
		}
	}
	if err != nil {
		fail(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"keys": keys})
}
