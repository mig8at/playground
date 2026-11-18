package main

// Compactar una conversación (Miguel, 2026-11-17; es lo que hacen los harness de agentes cuando el contexto se
// llena): lo viejo se RESUME en un bloque y los últimos bloques quedan tal cual. No se pierde nada: los bloques
// originales van a wally/.data/archive/. El resumen lo escribe el mismo proveedor de la conversación, en una pregunta
// aparte (no en el chat que venía siguiendo); después de compactar, ese chat ya no sirve y la próxima abre uno nuevo.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

// compactKeep: cuántos bloques del final quedan sin tocar (lo último que se dijo, con sus comandos).
const compactKeep = 4

const compactPrompt = `Vas a RESUMIR una conversación larga para que se pueda seguir sin ella. Lo que escribas reemplaza a esos bloques: lo que no esté en tu resumen se pierde para quien siga.

Escribí el resumen en español, con estas secciones (omití la que no aplique):

## Qué se pidió
El objetivo y los pedidos, en el orden en que llegaron.

## Qué se hizo y qué se decidió
Lo hecho, las decisiones y su porqué. Los archivos escritos o cambiados, con su ruta.

## Hechos comprobados
Cada dato que se verificó, CON su cita exacta (repo:archivo:línea, comando, id de trampa o de tema). No resumas las citas: copialas.

## Lo que falló o se descartó
Qué se intentó y no sirvió, para no repetirlo.

## Estado y pendientes
Cómo quedó al final de lo que resumís, y qué falta.

Reglas: no inventes nada ni agregues conclusiones nuevas; no contestes ninguna pregunta de la conversación; no pidas comandos. Sé denso: nombres, rutas, números y citas exactos; nada de relleno. Las salidas largas de comandos se resumen en lo que se sacó de ellas.

Lo que sigue es la conversación a resumir.`

// summarizer hace la pregunta del resumen: en producción, al proveedor; en las pruebas, una función.
type summarizer func(ctx context.Context, prompt string) (text, model string, err error)

// compactPoint: hasta qué bloque se resume. Deja los últimos `keep` y corre el corte para que lo que queda empiece
// en una pregunta (no en una respuesta suelta). 0 = no hay qué compactar.
func compactPoint(msgs []Message, keep int) int {
	cut := len(msgs) - keep
	for cut > 0 && cut < len(msgs) && msgs[cut].Role != "user" {
		cut--
	}
	if cut < 2 {
		return 0
	}
	return cut
}

// transcriptChars: lo que pesa una conversación al viajar (textos más salidas y archivos).
func transcriptChars(msgs []Message) int {
	n := 0
	for _, m := range msgs {
		n += len(m.Text)
		for _, f := range m.Files {
			n += f.Chars
		}
		for _, f := range commandOutputs(m) {
			n += f.Chars
		}
	}
	return n
}

// compact resume los bloques viejos de una conversación. Devuelve cuántos reemplazó.
func (a *app) compact(ctx context.Context, id string, keep int, ask summarizer) (Conversation, int, error) {
	a.store.mu.Lock()
	c, ok := a.store.convs[id]
	if !ok {
		a.store.mu.Unlock()
		return Conversation{}, 0, errBadRequest{"no existe esa conversación"}
	}
	msgs := append([]Message(nil), c.Messages...)
	a.store.mu.Unlock()

	cut := compactPoint(msgs, keep)
	if cut == 0 {
		return Conversation{}, 0, errBadRequest{"no hay qué compactar: la conversación es corta"}
	}
	old := msgs[:cut]
	text, model, err := ask(ctx, compactPrompt+"\n\n"+transcript(old, "Hacé el resumen ahora, con las secciones pedidas.", nil, a.fileText))
	if err != nil {
		return Conversation{}, 0, err
	}
	if len([]rune(text)) < 200 {
		return Conversation{}, 0, fmt.Errorf("el resumen vino demasiado corto (%d caracteres): no se compactó", len([]rune(text)))
	}

	a.store.mu.Lock()
	defer a.store.mu.Unlock()
	c, ok = a.store.convs[id]
	if !ok || len(c.Messages) < cut {
		return Conversation{}, 0, errors.New("la conversación cambió mientras se resumía: no se compactó")
	}
	for i := range old {
		if c.Messages[i].ID != old[i].ID {
			return Conversation{}, 0, errors.New("la conversación cambió mientras se resumía: no se compactó")
		}
	}
	// El original, a un archivo: nada se pierde.
	dir := filepath.Join(a.root, "wally", ".data", "archive")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return Conversation{}, 0, err
	}
	name := fmt.Sprintf("%s-%s.json", id, time.Now().Format("20060102-150405"))
	raw, _ := json.MarshalIndent(old, "", " ")
	if err := os.WriteFile(filepath.Join(dir, name), raw, 0o600); err != nil {
		return Conversation{}, 0, err
	}
	summary := Message{ID: newID(), Role: "summary", Text: text, Model: model, At: time.Now(), Compacted: len(old),
		CompactedChars: transcriptChars(old), Archive: name}
	c.Messages = append([]Message{summary}, c.Messages[cut:]...)
	c.Chats = nil // el chat del proveedor tenía los bloques viejos: la próxima pregunta abre uno con el resumen
	c.Updated = time.Now()
	if err := a.store.save(); err != nil {
		return Conversation{}, 0, err
	}
	return *c, len(old), nil
}

// providerSummarizer: el resumen lo escribe el proveedor de la conversación, en una pregunta aparte.
func (a *app) providerSummarizer(provider string) summarizer {
	return func(ctx context.Context, prompt string) (string, string, error) {
		text, model, _, err := a.askProvider(ctx, provider, prompt, "")
		return text, model, err
	}
}

// compactHandler: POST /api/conversations/{id}/compact {keep?, provider?}.
func (a *app) compactHandler(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Keep     int    `json:"keep"`
		Provider string `json:"provider"`
	}
	_ = json.NewDecoder(r.Body).Decode(&in)
	if in.Keep < 2 {
		in.Keep = compactKeep
	}
	id := r.PathValue("id")
	a.store.mu.Lock()
	c, ok := a.store.convs[id]
	var mode string
	var agent *Agent
	if ok {
		mode, agent = c.Mode, c.Agent
	}
	a.store.mu.Unlock()
	if !ok {
		writeErr(w, 404, errors.New("no existe esa conversación"))
		return
	}
	if mode == "" {
		mode = "assistant"
	}
	provider := a.config.get().providerForConversation(in.Provider, mode, agent)
	a.asking.Store(id, askingInfo{Since: time.Now(), Text: "Resumir lo anterior para achicar el contexto"})
	defer a.asking.Delete(id)
	ctx, cancel := context.WithTimeout(r.Context(), 12*time.Minute)
	defer cancel()
	conv, n, err := a.compact(ctx, id, in.Keep, a.providerSummarizer(provider))
	if err != nil {
		var bad errBadRequest
		if errors.As(err, &bad) {
			writeErr(w, 400, err)
		} else {
			writeErr(w, 502, err)
		}
		return
	}
	writeJSON(w, 200, map[string]any{"conversation": conv, "compacted": n})
}
