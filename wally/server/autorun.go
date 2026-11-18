package main

// EL MODO AUTOMÁTICO, EN EL SERVIDOR (2026-11-18, Miguel: «arrancá con la 1»). Antes lo llevaba quien lo lanzaba —la
// ventana de Wally o `bin/wally ask --auto`—, y en la interfaz se cortaba al cambiar de conversación, al recargar la
// página o al cerrar Cockpit, y nadie lo podía frenar. Ahora la corrida vive acá: la interfaz y la consola la arrancan,
// la miran (`GET /api/live`) y la frenan (`…/auto/stop`), y no depende de ninguna de las dos.
//
// El ciclo: preguntar → correr los comandos que pidió (los de la lista blanca, como siempre) → mandarle los resultados
// → … hasta que contesta sin pedir nada. Ahí actúa el freno (sandboxPending): si escribió en pruebas/ sin comprobar, o
// la última comprobación dejó algo en rojo, se le dice «todavía no terminaste» (hasta 3 veces). Tope de vueltas. Al
// terminar, finishRun: el aviso de macOS y el «sin ver».

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"
)

type autoState struct {
	Since   time.Time `json:"since"`
	Round   int       `json:"round"`   // preguntas hechas en esta corrida
	Max     int       `json:"max"`     // tope de vueltas
	Doing   string    `json:"doing"`   // qué está haciendo ahora, en una línea
	Ended   time.Time `json:"ended"`   // cero mientras corre
	Stopped string    `json:"stopped"` // por qué terminó sin quedar bien ("" si quedó bien)
	ByUser  bool      `json:"byUser"`  // la frenó Miguel
	cancel  context.CancelFunc
}

type autoRuns struct {
	mu sync.Mutex
	m  map[string]*autoState // id de la conversación → su corrida (la que corre, o la última que terminó)
}

const autoMaxRounds = 12

// startAuto: POST /api/conversations/{id}/auto {text, provider, rounds, files} — arranca una corrida. Sin text, sigue
// desde lo que quedó (corre los comandos propuestos de la última respuesta). Contesta enseguida: la corrida sigue sola.
func (a *app) startAuto(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Text     string   `json:"text"`
		Provider string   `json:"provider"`
		Rounds   int      `json:"rounds"`
		Files    []string `json:"files"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeErr(w, 400, err)
		return
	}
	id := r.PathValue("id")
	a.store.mu.Lock()
	_, ok := a.store.convs[id]
	a.store.mu.Unlock()
	if !ok {
		writeErr(w, 404, errors.New("no existe esa conversación"))
		return
	}
	var files []Attachment
	for _, f := range in.Files {
		att, err := a.attachment(f)
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		files = append(files, att)
	}
	if in.Rounds <= 0 || in.Rounds > 30 {
		in.Rounds = autoMaxRounds
	}
	ctx, cancel := context.WithCancel(context.Background()) // no el del pedido: la corrida sobrevive a quien la lanzó
	st := &autoState{Since: time.Now(), Max: in.Rounds, Doing: "arrancando", cancel: cancel}
	a.autos.mu.Lock()
	if a.autos.m == nil {
		a.autos.m = map[string]*autoState{}
	}
	if cur := a.autos.m[id]; cur != nil && cur.Ended.IsZero() {
		a.autos.mu.Unlock()
		cancel()
		writeErr(w, 409, errors.New("esa conversación ya tiene una corrida automática andando"))
		return
	}
	a.autos.m[id] = st
	a.autos.mu.Unlock()
	go a.runAuto(ctx, id, strings.TrimSpace(in.Text), files, in.Provider, st)
	writeJSON(w, 202, a.autoView(id))
}

// stopAuto: POST /api/conversations/{id}/auto/stop — la frena. Corta la pregunta o el comando que esté corriendo (un
// contenedor de Rust se mata); lo ya hecho queda.
func (a *app) stopAuto(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	a.autos.mu.Lock()
	st := a.autos.m[id]
	running := st != nil && st.Ended.IsZero()
	if running {
		st.ByUser = true
		st.Doing = "frenando"
		st.cancel()
	}
	a.autos.mu.Unlock()
	if !running {
		writeErr(w, 409, errors.New("esa conversación no tiene una corrida automática andando"))
		return
	}
	writeJSON(w, 200, a.autoView(id))
}

// getAuto: GET /api/conversations/{id}/auto — la corrida que anda, o la última que terminó (null si nunca hubo).
func (a *app) getAuto(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, a.autoView(r.PathValue("id")))
}

func (a *app) autoView(id string) *autoState {
	a.autos.mu.Lock()
	defer a.autos.mu.Unlock()
	st := a.autos.m[id]
	if st == nil {
		return nil
	}
	cp := *st
	cp.cancel = nil
	return &cp
}

// autoRunning: las corridas que andan ahora (para /api/live).
func (a *app) autoRunning() map[string]*autoState {
	a.autos.mu.Lock()
	ids := []string{}
	for id, st := range a.autos.m {
		if st.Ended.IsZero() {
			ids = append(ids, id)
		}
	}
	a.autos.mu.Unlock()
	out := map[string]*autoState{}
	for _, id := range ids {
		out[id] = a.autoView(id)
	}
	return out
}

func (a *app) autoSet(st *autoState, f func(*autoState)) {
	a.autos.mu.Lock()
	f(st)
	a.autos.mu.Unlock()
}

// runAuto es el ciclo. Termina siempre por finishRun (salvo que la frene Miguel: eso no avisa).
func (a *app) runAuto(ctx context.Context, id, text string, files []Attachment, provider string, st *autoState) {
	start := time.Now()
	stopped := ""
	nudges, reviews := 0, 0
	from := -1 // desde qué mensaje es de esta corrida (para saber qué proyecto escribió ella)
	ask := func(t string, f []Attachment) error {
		a.autoSet(st, func(s *autoState) { s.Round++; s.Doing = fmt.Sprintf("vuelta %d: esperando la respuesta", s.Round) })
		_, err := a.askInConversation(ctx, askInput{ID: id, Text: t, Files: f, Provider: provider})
		return err
	}
	defer func() {
		if r := recover(); r != nil {
			log.Printf("wally: la corrida automática de %s se cayó: %v", id, r)
			stopped = fmt.Sprintf("se cayó: %v", r)
		}
		byUser := false
		a.autoSet(st, func(s *autoState) {
			if s.ByUser {
				stopped = "la frenaste" // la pregunta o el comando cortados fallan con su propio error: no es ése el porqué
			}
			s.Ended, s.Stopped, s.Doing = time.Now(), stopped, "terminó"
			byUser = s.ByUser
		})
		if byUser {
			return // la frenó Miguel: ya lo sabe
		}
		rounds := 0
		a.autoSet(st, func(s *autoState) { rounds = s.Round })
		if _, err := a.finishRun(id, rounds, time.Since(start).Milliseconds(), stopped, false); err != nil {
			log.Printf("wally: no pude anotar el fin de la corrida de %s: %v", id, err)
		}
	}()
	a.store.mu.Lock()
	if c, ok := a.store.convs[id]; ok {
		from = len(c.Messages)
	}
	a.store.mu.Unlock()
	if text != "" {
		if err := ask(text, files); err != nil {
			stopped = "la pregunta falló: " + err.Error()
			return
		}
	}
	for {
		if ctx.Err() != nil {
			stopped = "la frenaste"
			return
		}
		a.store.mu.Lock()
		c, ok := a.store.convs[id]
		var conv Conversation
		if ok {
			conv = *c
			conv.Messages = append([]Message(nil), c.Messages...)
		}
		a.store.mu.Unlock()
		if !ok {
			stopped = "la conversación se borró"
			return
		}
		if len(conv.Messages) == 0 || conv.Messages[len(conv.Messages)-1].Role != "model" {
			stopped = "no hay una respuesta de la que seguir"
			return
		}
		last := conv.Messages[len(conv.Messages)-1]
		var proposed []Command
		for _, k := range last.Commands {
			if k.Status == "propuesto" {
				proposed = append(proposed, k)
			}
		}
		// Contestó sin pedir nada: ¿puede cerrar?
		if len(proposed) == 0 {
			reason := sandboxPending(conv, a.sandboxKind)
			if reason == "" {
				// Quedó en verde con sus propios criterios: antes de cerrar, el revisor (review.go).
				project := lastWrittenProject(conv.Messages, from)
				if project == "" || a.sandboxKind(project) == "" {
					return
				}
				if reviews >= maxReviews {
					return // ya lo revisó y lo dejó pasar, o ya se le pidió lo que había que pedirle
				}
				reviews++
				a.autoSet(st, func(s *autoState) { s.Doing = "un revisor compara lo pedido con los criterios" })
				mode := conv.Mode
				if mode == "" {
					mode = "asistente"
				}
				v, err := a.reviewCriteria(ctx, conv, from, project, a.providerSummarizer(a.config.get().providerForConversation(provider, mode, conv.Agent)))
				if err != nil {
					log.Printf("wally: el revisor de %s no pudo: %v (cierra igual)", id, err)
				}
				if v.OK {
					reviews = maxReviews // pasó: no se vuelve a revisar en esta corrida
					return
				}
				if reviews >= maxReviews {
					stopped = "cerró con huecos que vio el revisor: " + strings.Join(append(append([]string{}, v.Faltan...), v.Debiles...), " · ")
					return
				}
				if st.Round >= st.Max {
					stopped = fmt.Sprintf("se acabaron las %d vueltas y el revisor vio huecos en los criterios", st.Max)
					return
				}
				if err := ask(reviewNudge(project, v), nil); err != nil {
					stopped = "la pregunta falló: " + err.Error()
					return
				}
				continue
			}
			if nudges >= 3 {
				stopped = reason
				return
			}
			nudges++
			if st.Round >= st.Max {
				stopped = fmt.Sprintf("se acabaron las %d vueltas sin quedar bien: %s", st.Max, reason)
				return
			}
			if err := ask(reason, nil); err != nil {
				stopped = "la pregunta falló: " + err.Error()
				return
			}
			continue
		}
		if st.Round >= st.Max {
			stopped = fmt.Sprintf("se acabaron las %d vueltas y todavía pedía %d comando(s)", st.Max, len(proposed))
			return
		}
		var ran, refused []string
		for i, k := range proposed {
			if ctx.Err() != nil {
				stopped = "la frenaste"
				return
			}
			a.autoSet(st, func(s *autoState) {
				s.Doing = fmt.Sprintf("vuelta %d: corriendo %d de %d · %s", s.Round, i+1, len(proposed), shorten(k.Cmd, 60))
			})
			c2, code, err := a.decideCommand(ctx, id, last.ID, k.ID, "run")
			if err != nil {
				if code == 409 { // lo tomó otra ventana: se toma como corrido
					ran = append(ran, k.Cmd)
					continue
				}
				refused = append(refused, k.Cmd)
				continue
			}
			for _, m := range c2.Messages {
				for _, x := range m.Commands {
					if x.ID == k.ID {
						if x.Status == "corrido" {
							ran = append(ran, k.Cmd)
						} else {
							refused = append(refused, k.Cmd)
						}
					}
				}
			}
		}
		for _, k := range last.Commands {
			if k.Status == "no-permitido" {
				refused = append(refused, k.Cmd)
			}
		}
		if ctx.Err() != nil {
			stopped = "la frenaste"
			return
		}
		// El mismo texto que usaba el CLI: la interfaz lo reconoce y lo muestra como una línea fina (roundNote).
		next := ""
		if len(ran) > 0 {
			what := "el comando"
			if len(ran) > 1 {
				what = fmt.Sprintf("los %d comandos", len(ran))
			}
			next = fmt.Sprintf("Listo: corrí %s (la salida va arriba)", what)
			if len(refused) > 0 {
				next += fmt.Sprintf("; %d no están en la lista: %s", len(refused), strings.Join(refused, " · "))
			}
			next += ". Seguí."
		} else {
			next = fmt.Sprintf("Ninguno de esos comandos está en la lista de sólo lectura (%s). Seguí con lo que tenés o pedí otro.", strings.Join(refused, " · "))
		}
		if err := ask(next, nil); err != nil {
			stopped = "la pregunta falló: " + err.Error()
			return
		}
	}
}

func shorten(s string, n int) string {
	if r := []rune(s); len(r) > n {
		return string(r[:n]) + "…"
	}
	return s
}
