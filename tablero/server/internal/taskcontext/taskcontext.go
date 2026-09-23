// Package taskcontext guarda la pila de una tarea: bloques de documentación que entran con el tiempo.
//
// Un archivo por tarea —`tasks/<slug>/context.jsonl`, una línea por bloque— hace que la historia sea
// versionable, legible sin servidor y fácil de mover junto al trabajo. Qué es un bloque y qué se le
// exige está en block.go.
//
// ⚠ Hasta el 2026-09-23 la pila era de HITOS (`tablero.task-context/v1`: kind, summary, state, next…).
// Los 37 que había se migraron a bloques ese día (`via: migration`) y el formato ya no se lee: una
// línea vieja que apareciera hace fallar la lectura en vez de colarse.
package taskcontext

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"creditop/tablero/server/internal/layout"
)

var slugRe = regexp.MustCompile(`^[a-z0-9][a-z0-9-]*$`)

// Event es una línea de la pila: un bloque. Sólo `title` y `body` se muestran; `id`, `at` —que arma el
// acordeón por día— y `via` son internos.
type Event struct {
	Schema string `json:"schema"`
	ID     string `json:"id"`
	At     string `json:"at"`
	Via    string `json:"via"`
	Title  string `json:"title"`
	Body   string `json:"body"`
}

// Decode rechaza campos desconocidos: si se aceptaran en silencio, un «next» o un typo pasarían como si
// el formato los admitiera, y el contrato dejaría de ser uno solo.
func Decode(raw []byte) (Event, error) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var event Event
	if err := decoder.Decode(&event); err != nil {
		return Event{}, err
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		if err == nil {
			return Event{}, fmt.Errorf("hay más de un objeto JSON")
		}
		return Event{}, err
	}
	return event, nil
}

// file es la pila de una tarea: `tasks/<slug>/context.jsonl`, al lado de su documento. `dir` es la
// carpeta `data/`, como la recibe el resto del tablero.
func file(dir, slug string) (string, error) {
	if !slugRe.MatchString(slug) {
		return "", fmt.Errorf("slug de tarea inválido %q", slug)
	}
	return layout.At(dir).ContextPath(slug), nil
}

func cleanOne(name, value string, limit int, required bool) (string, error) {
	value = strings.TrimSpace(value)
	if required && value == "" {
		return "", fmt.Errorf("falta %s", name)
	}
	if strings.ContainsAny(value, "\r\n") {
		return "", fmt.Errorf("%s debe ir en una sola línea", name)
	}
	if len([]rune(value)) > limit {
		return "", fmt.Errorf("%s supera %d caracteres", name, limit)
	}
	return value, nil
}

// newID: `blk_` y el instante, para que ordenar por id también ordene por tiempo.
func newID(prefix string, now time.Time) (string, error) {
	var random [4]byte
	if _, err := rand.Read(random[:]); err != nil {
		return "", fmt.Errorf("generando id: %w", err)
	}
	return prefix + now.UTC().Format("20060102T150405.000000000Z") + "_" + hex.EncodeToString(random[:]), nil
}

// Read entrega los bloques de más reciente a más antiguo, validando cada línea. Un archivo ausente es
// una tarea que todavía no tiene pila, no un error.
func Read(dir, slug string) ([]Event, error) {
	path, err := file(dir, slug)
	if err != nil {
		return nil, err
	}
	b, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return []Event{}, nil
	}
	if err != nil {
		return nil, err
	}
	var out []Event
	for n, line := range strings.Split(string(b), "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		event, err := Decode([]byte(line))
		if err != nil {
			return nil, fmt.Errorf("%s línea %d: JSON inválido: %w", filepath.Base(path), n+1, err)
		}
		if err := ValidateBlock(event); err != nil {
			return nil, fmt.Errorf("%s línea %d: %w", filepath.Base(path), n+1, err)
		}
		out = append(out, event)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].At > out[j].At })
	return out, nil
}

// Append apila un bloque ya preparado (PrepareBlock) y reescribe atómicamente el JSONL: el archivo no
// queda con una línea partida si se interrumpe el proceso durante la escritura.
func Append(dir, slug string, event Event, now time.Time) (Event, error) {
	if err := ValidateBlock(event); err != nil {
		return Event{}, err
	}
	path, err := file(dir, slug)
	if err != nil {
		return Event{}, err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return Event{}, err
	}
	previous, err := os.ReadFile(path)
	if err != nil && !os.IsNotExist(err) {
		return Event{}, err
	}
	// Sin escapar HTML: la pila se lee también a mano y en un diff, y `<slug>` escrito como `<slug>`
	// no lo lee nadie. El JSON sigue siendo válido: el escape de json.Marshal es para incrustarlo en HTML.
	var line bytes.Buffer
	encoder := json.NewEncoder(&line)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(event); err != nil {
		return Event{}, err
	}
	content := strings.TrimRight(string(previous), "\n")
	if content != "" {
		content += "\n"
	}
	content += line.String()
	tmp, err := os.CreateTemp(filepath.Dir(path), ".task-context-*")
	if err != nil {
		return Event{}, err
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	if _, err := tmp.WriteString(content); err != nil {
		tmp.Close()
		return Event{}, err
	}
	if err := tmp.Chmod(0o644); err != nil {
		tmp.Close()
		return Event{}, err
	}
	if err := tmp.Close(); err != nil {
		return Event{}, err
	}
	if err := os.Rename(tmpName, path); err != nil {
		return Event{}, err
	}
	return event, nil
}

// Recent limita lo que se muestra al retomar: el archivo completo conserva la historia, pero al volver a
// una tarea importan los últimos bloques, no veinte viejos.
func Recent(events []Event, limit int) []Event {
	if limit <= 0 || len(events) <= limit {
		return events
	}
	return events[:limit]
}
