package main

// EL LLAVERO SE CONTESTA SOLO. Alguien del equipo (o su agente) te escribe por el chat, en una conversación directa:
//
//	🔑 Pido tu llavero              → contesta la LISTA de nombres de «Guardadas» (nunca los valores)
//	🔑 Pido estas claves            → contesta UN bloque .env con las pedidas, cada valor ENCRIPTADO (el mismo que
//	• nombre-1                        está guardado: va con la llave del equipo, que todos tienen):
//	• nombre-2
//	                                    🔒 Llavero · 2 claves encriptadas con la llave del equipo
//	                                    NOMBRE_1=U2FsdGVkX1…
//	                                    NOMBRE_2=U2FsdGVkX1…
//	                                    # no está en el llavero: nombre-3
//
// El bloque se lee y se pega como un .env; la interfaz lo desencripta a un .env de verdad, y sin la interfaz lo hace
// openssl línea por línea.
//
// Lo hace este servidor, que corre aunque no haya ninguna ventana abierta. Sólo contesta mensajes directos (no de
// grupos), recientes, y si «Compartir mi llavero» está prendido en la consola (por defecto, sí). Lo que va al
// llavero es para el equipo; lo privado no va ahí.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"creditop/playground/chat/cli"
)

var (
	askKeyringRe = regexp.MustCompile(`^🔑 Pido tu llavero`)
	askKeysRe    = regexp.MustCompile(`^🔑 Pido (?:estas claves|las claves|la clave)`)
	bulletRe     = regexp.MustCompile(`(?m)^[•\-\*] *(\S[^\n]*?)\s*$`)
	quotedRe     = regexp.MustCompile(`«([^»\n]+)»`)
)

// Lo que se manda (lo leen la interfaz, para pintarlo como tarjeta, y cualquiera como texto).
func keyringListText(names []string) string {
	if len(names) == 0 {
		return "🔑 Mi llavero (0)\nNo tengo claves guardadas."
	}
	var b strings.Builder
	fmt.Fprintf(&b, "🔑 Mi llavero (%d)", len(names))
	for _, n := range names {
		b.WriteString("\n• " + n)
	}
	return b.String()
}

var envUnsafe = regexp.MustCompile(`[^A-Za-z0-9_]+`)

// envName: el nombre de la clave como variable de entorno (shopify-admin-dev → SHOPIFY_ADMIN_DEV).
func envName(name string) string {
	n := strings.Trim(envUnsafe.ReplaceAllString(strings.ToUpper(strings.TrimSpace(name)), "_"), "_")
	if n == "" || (n[0] >= '0' && n[0] <= '9') {
		n = "K_" + n
	}
	return n
}

// envBlocks: las claves como bloques .env (encriptados), partidos para no pasar el tope de un mensaje. Cada bloque
// lleva su encabezado con cuántas claves trae; lo que falta va al final como comentario.
func envBlocks(keys []savedKey, missing []string) []string {
	lines := make([]string, 0, len(keys)+1)
	for _, k := range keys {
		lines = append(lines, envName(k.Name)+"="+k.Sealed)
	}
	if len(missing) > 0 {
		lines = append(lines, "# no está en el llavero: "+strings.Join(missing, ", "))
	}
	var out []string
	for len(lines) > 0 {
		n, size, count := 0, 0, 0
		for n < len(lines) && (n == 0 || size+len(lines[n])+1 <= maxText-120) {
			size += len(lines[n]) + 1
			if !strings.HasPrefix(lines[n], "#") {
				count++
			}
			n++
		}
		head := fmt.Sprintf("🔒 Llavero · %d clave%s encriptada%s con la llave del equipo", count, plural(count), plural(count))
		out = append(out, head+"\n"+strings.Join(lines[:n], "\n"))
		lines = lines[n:]
	}
	return out
}

func plural(n int) string {
	if n == 1 {
		return ""
	}
	return "s"
}

// askedNames: los nombres de un «Pido estas claves» (en viñetas, o entre «» en la misma línea).
func askedNames(text string) []string {
	var out []string
	seen := map[string]bool{}
	for _, re := range []*regexp.Regexp{bulletRe, quotedRe} {
		for _, m := range re.FindAllStringSubmatch(text, -1) {
			if n := strings.TrimSpace(m[1]); n != "" && !seen[n] {
				seen[n] = true
				out = append(out, n)
			}
		}
	}
	return out
}

type keyringSettings struct {
	AutoShare bool `json:"autoShare"`
}

func keyringSettingsPath() (string, error) {
	dir, err := historyDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "keyring-settings.json"), nil
}

func readKeyringSettings() keyringSettings {
	s := keyringSettings{AutoShare: true}
	if p, err := keyringSettingsPath(); err == nil {
		if b, err := os.ReadFile(p); err == nil {
			_ = json.Unmarshal(b, &s)
		}
	}
	return s
}

// sendMessage es cli.Send; las pruebas lo cambian para no mandar nada.
var sendMessage = func(ctx context.Context, to, text, re string) (cli.SendResult, error) {
	return cli.Send(ctx, to, text, re)
}

// sendAndRecord manda por el CLI y lo deja en el historial (lo que sale de acá no pasa por el listen).
func sendAndRecord(ctx context.Context, to, text, re string) error {
	result, err := sendMessage(ctx, to, text, re)
	if err != nil {
		return err
	}
	if chatHistory != nil && result.ID != "" {
		dest := result.To
		if dest == "" {
			dest = to
		}
		_, _ = chatHistory.add([]cli.Message{{ID: result.ID, Dir: "out", To: dest, Text: text, Re: result.Re,
			Time: time.Now().UTC().Format(time.RFC3339Nano)}})
	}
	return nil
}

// answerKeyring mira los mensajes nuevos y contesta los pedidos de llavero.
func answerKeyring(fresh []cli.Message) {
	for _, m := range fresh {
		if m.Dir == "out" || m.Group != nil || m.From.Email == "" {
			continue
		}
		text := strings.TrimSpace(m.Text)
		isList, isKeys := askKeyringRe.MatchString(text), askKeysRe.MatchString(text)
		if !isList && !isKeys {
			continue
		}
		if t, err := time.Parse(time.RFC3339Nano, m.Time); err == nil && time.Since(t) > 15*time.Minute {
			continue // un pedido viejo que vuelve a pasar (el listen se reinició): no se contesta dos veces
		}
		if !readKeyringSettings().AutoShare {
			continue
		}
		keyringMu.Lock()
		keys, err := readSavedKeys()
		keyringMu.Unlock()
		if err != nil {
			log.Printf("llavero: %v", err)
			continue
		}
		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		if isList {
			names := make([]string, 0, len(keys))
			for _, k := range keys {
				names = append(names, k.Name)
			}
			err = sendAndRecord(ctx, m.From.Email, keyringListText(names), m.ID)
		} else {
			// Se busca por el nombre tal cual o como variable de entorno (pedir SHOPIFY_ADMIN_DEV trae shopify-admin-dev).
			byName := map[string]savedKey{}
			for _, k := range keys {
				byName[k.Name] = k
				byName[envName(k.Name)] = k
			}
			var found []savedKey
			var missing []string
			for _, n := range askedNames(text) {
				if k, ok := byName[n]; ok {
					found = append(found, k)
				} else {
					missing = append(missing, n)
				}
			}
			for _, block := range envBlocks(found, missing) {
				if err = sendAndRecord(ctx, m.From.Email, block, m.ID); err != nil {
					break
				}
			}
		}
		cancel()
		if err != nil {
			log.Printf("llavero: no se pudo contestar a %s: %v", m.From.Email, err)
			continue
		}
		kind := "keys"
		if isList {
			kind = "list"
		}
		events.publish("keyring", map[string]string{"to": m.From.Email, "name": m.From.Name, "kind": kind})
	}
}

func registerKeyringSettings(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/keyring/settings", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, readKeyringSettings())
	})
	mux.HandleFunc("PUT /api/keyring/settings", func(w http.ResponseWriter, r *http.Request) {
		var in keyringSettings
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&in); err != nil {
			fail(w, http.StatusBadRequest, errors.New("el cuerpo va en JSON: {autoShare}"))
			return
		}
		b, _ := json.Marshal(in)
		p, err := keyringSettingsPath()
		if err == nil {
			err = writePrivate(p, b)
		}
		if err != nil {
			fail(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, http.StatusOK, in)
	})
}
