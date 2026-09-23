// Package taskcontext guarda los hitos que realmente cambian cómo se retoma una tarea.
//
// El cuerpo Markdown es la foto vigente —objetivo, receta, límites y próximo paso—. Este JSONL no
// intenta copiarlo ni convertirse en un diario: conserva sólo las decisiones, bloqueos, evidencia y
// checkpoints que explican por qué esa foto cambió. Un archivo por tarea hace que el historial sea
// versionable, legible sin servidor y fácil de mover junto al trabajo.
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

	"creditop/tablero/server/internal/dbquery"
)

const Schema = "tablero.task-context/v1"

var (
	slugRe            = regexp.MustCompile(`^[a-z0-9][a-z0-9-]*$`)
	inlineCanonLinkRe = regexp.MustCompile(`\[([^\[\]\r\n]+)\]\(canon:([A-Za-z0-9][A-Za-z0-9._/#-]*)\)`)
	kinds             = map[string]bool{"checkpoint": true, "decision": true, "blocker": true, "evidence": true}
	refKinds          = map[string]bool{"canon": true, "db": true, "harness": true, "tracer": true, "jira": true, "pr": true, "run": true, "doc": true, "other": true}
)

// InlineCanonLink es una cita de Canon dentro de una oración. La sintaxis es Markdown conocida,
// pero sólo admite el esquema canon:, para que el editor pueda renderizarla sin aceptar HTML ni URLs
// arbitrarias: [texto visible](canon:nodo/context#seccion).
type InlineCanonLink struct {
	Label  string
	Target string
}

// InlineCanonLinks encuentra sólo las citas seguras de Canon. Cualquier otro texto sigue siendo
// texto plano; no se interpreta como HTML ni como Markdown general.
func InlineCanonLinks(value string) []InlineCanonLink {
	matches := inlineCanonLinkRe.FindAllStringSubmatch(value, -1)
	links := make([]InlineCanonLink, 0, len(matches))
	for _, match := range matches {
		links = append(links, InlineCanonLink{Label: match[1], Target: match[2]})
	}
	return links
}

// PlainText conserva el sentido de un hito al leerlo desde CLI: la etiqueta se muestra, pero la
// sintaxis de enlace no ensucia make retomar ni make tarea-context.
func PlainText(value string) string {
	return inlineCanonLinkRe.ReplaceAllString(value, "$1")
}

// Reference apunta a la prueba o fuente que permite retomar una afirmación sin volver a buscarla.
// Target puede ser una URL, un comando o una ruta local, pero siempre es una referencia concreta.
type Reference struct {
	Kind        string `json:"kind"`
	Label       string `json:"label"`
	Target      string `json:"target"`
	Environment string `json:"environment,omitempty"`
}

// Event es una línea de data/task-context/<slug>.jsonl. No hay un tipo "avance": los bloques de
// tiempo siguen en entries/. Sólo se escribe si altera una decisión futura, deja una prueba útil,
// bloquea el trabajo o congela el estado para retomar.
type Event struct {
	Schema     string      `json:"schema"`
	ID         string      `json:"id"`
	At         string      `json:"at"`
	Kind       string      `json:"kind"`
	Goal       string      `json:"goal,omitempty"`
	Summary    string      `json:"summary"`
	State      string      `json:"state,omitempty"`
	Next       string      `json:"next,omitempty"`
	Reason     string      `json:"reason,omitempty"`
	WaitingOn  string      `json:"waitingOn,omitempty"`
	References []Reference `json:"references,omitempty"`
}

// Decode rechaza campos desconocidos: si se aceptaran en silencio, el JSON Schema y el comando
// dejarían de describir el mismo contrato y un typo podría hacer perder precisamente el dato de retoma.
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

func file(dir, slug string) (string, error) {
	if !slugRe.MatchString(slug) {
		return "", fmt.Errorf("slug de tarea inválido %q", slug)
	}
	return filepath.Join(dir, "task-context", slug+".jsonl"), nil
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

// NormalizeAndValidate completa los campos que no decide la persona y evita el tipo de texto que
// luego no sirve para retomar: párrafos sueltos, "se avanzó" sin resultado o evidencia sin fuente.
func NormalizeAndValidate(event Event, now time.Time) (Event, error) {
	if event.Schema != "" && event.Schema != Schema {
		return Event{}, fmt.Errorf("schema %q no es compatible con %s", event.Schema, Schema)
	}
	event.Schema = Schema
	var err error
	if event.Kind, err = cleanOne("kind", strings.ToLower(event.Kind), 20, true); err != nil {
		return Event{}, err
	}
	if !kinds[event.Kind] {
		return Event{}, fmt.Errorf("kind %q no existe: checkpoint · decision · blocker · evidence", event.Kind)
	}
	if event.Summary, err = cleanOne("summary", event.Summary, 420, true); err != nil {
		return Event{}, err
	}
	if event.Goal, err = cleanOne("goal", event.Goal, 320, false); err != nil {
		return Event{}, err
	}
	if event.State, err = cleanOne("state", event.State, 420, false); err != nil {
		return Event{}, err
	}
	if event.Next, err = cleanOne("next", event.Next, 320, false); err != nil {
		return Event{}, err
	}
	if event.Reason, err = cleanOne("reason", event.Reason, 420, false); err != nil {
		return Event{}, err
	}
	if event.WaitingOn, err = cleanOne("waitingOn", event.WaitingOn, 160, false); err != nil {
		return Event{}, err
	}
	if event.At == "" {
		event.At = now.Format(time.RFC3339)
	} else if at, parseErr := time.Parse(time.RFC3339, event.At); parseErr != nil {
		return Event{}, fmt.Errorf("at debe ser RFC3339: %w", parseErr)
	} else {
		event.At = at.Format(time.RFC3339)
	}

	switch event.Kind {
	case "checkpoint":
		if event.Goal == "" || event.State == "" || event.Next == "" {
			return Event{}, fmt.Errorf("checkpoint exige goal, state y next")
		}
	case "decision":
		if event.Reason == "" {
			return Event{}, fmt.Errorf("decision exige reason")
		}
	case "blocker":
		if event.WaitingOn == "" || event.Next == "" {
			return Event{}, fmt.Errorf("blocker exige waitingOn y next")
		}
	case "evidence":
		if len(event.References) == 0 {
			return Event{}, fmt.Errorf("evidence exige al menos una reference")
		}
	}
	if len(event.References) > 6 {
		return Event{}, fmt.Errorf("hay más de 6 references: separá el hito o dejá sólo las que permiten retomarlo")
	}
	for i := range event.References {
		ref := &event.References[i]
		if ref.Kind, err = cleanOne("reference.kind", strings.ToLower(ref.Kind), 20, true); err != nil {
			return Event{}, err
		}
		if !refKinds[ref.Kind] {
			return Event{}, fmt.Errorf("reference.kind %q no existe", ref.Kind)
		}
		if ref.Label, err = cleanOne("reference.label", ref.Label, 140, true); err != nil {
			return Event{}, err
		}
		if ref.Target, err = cleanOne("reference.target", ref.Target, 600, true); err != nil {
			return Event{}, err
		}
		if ref.Environment, err = cleanOne("reference.environment", ref.Environment, 20, false); err != nil {
			return Event{}, err
		}
		if ref.Kind == "db" {
			if !dbquery.ValidTarget(ref.Environment) {
				return Event{}, fmt.Errorf("reference db exige environment: local · dev · staging · prod")
			}
			if err := dbquery.ValidateReadOnly(ref.Target); err != nil {
				return Event{}, fmt.Errorf("reference db no es una consulta de solo lectura: %w", err)
			}
		} else if ref.Environment != "" {
			return Event{}, fmt.Errorf("reference.environment solo aplica a kind db")
		}
	}
	canonReferences := make(map[string]bool)
	for _, ref := range event.References {
		if ref.Kind == "canon" {
			canonReferences[ref.Target] = true
		}
	}
	linkedCanon := make(map[string]bool)
	for _, field := range []struct {
		name  string
		value string
	}{
		{"goal", event.Goal}, {"summary", event.Summary}, {"state", event.State},
		{"next", event.Next}, {"reason", event.Reason}, {"waitingOn", event.WaitingOn},
	} {
		for _, link := range InlineCanonLinks(field.value) {
			if !canonReferences[link.Target] {
				return Event{}, fmt.Errorf("%s enlaza canon:%s, pero falta la reference canon correspondiente", field.name, link.Target)
			}
			linkedCanon[link.Target] = true
		}
	}
	for target := range canonReferences {
		if !linkedCanon[target] {
			return Event{}, fmt.Errorf("reference canon:%s debe enlazarse dentro de un párrafo del hito", target)
		}
	}
	if event.ID == "" {
		var random [4]byte
		if _, err := rand.Read(random[:]); err != nil {
			return Event{}, fmt.Errorf("generando id: %w", err)
		}
		event.ID = "ctx_" + now.UTC().Format("20060102T150405.000000000Z") + "_" + hex.EncodeToString(random[:])
	} else if !strings.HasPrefix(event.ID, "ctx_") {
		return Event{}, fmt.Errorf("id inválido")
	}
	return event, nil
}

// Read entrega los eventos de más reciente a más antiguo. Un archivo ausente es una tarea que todavía
// no tiene hitos estructurados, no un error.
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
		if _, err := NormalizeAndValidate(event, time.Now()); err != nil {
			return nil, fmt.Errorf("%s línea %d: %w", filepath.Base(path), n+1, err)
		}
		out = append(out, event)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].At > out[j].At })
	return out, nil
}

// Append valida la entrada y reescribe atómicamente el JSONL. El archivo no tiene una línea parcial si
// se interrumpe el proceso durante la escritura.
func Append(dir, slug string, input Event, now time.Time) (Event, error) {
	event, err := NormalizeAndValidate(input, now)
	if err != nil {
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
	line, err := json.Marshal(event)
	if err != nil {
		return Event{}, err
	}
	content := strings.TrimRight(string(previous), "\n")
	if content != "" {
		content += "\n"
	}
	content += string(line) + "\n"
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

// Recent limita la proyección de retoma: el archivo completo conserva la historia, pero al volver a
// una tarea importan el checkpoint más reciente y los últimos cambios, no veinte líneas viejas.
func Recent(events []Event, limit int) []Event {
	if limit <= 0 || len(events) <= limit {
		return events
	}
	return events[:limit]
}
