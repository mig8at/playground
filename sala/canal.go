package main

/* EL MODO CANAL: nadie da la palabra. Cada mensaje que entra le llega a todos los que escuchan, y cada uno decide si
 * aporta (contesta), si va a trabajar en algo (AVISO, que sale en vivo antes de que empiece) o si calla (PASO, que no
 * se publica). Varios trabajan a la vez. Cuando nadie tiene nada que agregar, habla el COORDINADOR: decide el
 * siguiente paso nombrando a quién (@id), o cierra con CIERRO.
 *
 * Por qué así (Miguel, 2026-11-02): en el modo rondas el probador esperaba su turno mientras el arquitecto leía main, y
 * el que no tenía nada que decir gastaba un turno igual. Acá cada uno habla cuando es pertinente, y la memoria de la
 * llamada es la de su sesión: cada turno trae todo lo dicho desde el anterior.
 *
 * Lo que lo mantiene barato: el propio mensaje no despierta a quien lo dijo; un agente que está trabajando junta lo
 * que llega y lo lee entero al terminar; hay tope de turnos por agente, de intervenciones del coordinador y de gasto. */

import (
	"context"
	"fmt"
	"regexp"
	"strings"
	"sync"
	"time"
)

const (
	maxTurnsPerAgent  = 8
	maxCoordinatorRun = 5
)

var reNotice = regexp.MustCompile(`(?m)^\s*AVISO:\s*(.+?)\s*$`)

func coordinatorDefinition() *participant {
	return &participant{ID: "coordinador", Name: "Coordinador", Role: "decide cómo seguir cuando nadie aporta",
		system: common + ` TU ROL: coordinador. Hablás SÓLO cuando nadie tiene nada nuevo que aportar. Mirás lo dicho y la pizarra y decidís: ` +
			`o el siguiente paso concreto, nombrando a quién le toca con @id (por ejemplo «@probador corré la suite contra local con LAMBDA=1»), ` +
			`o cerrás con una línea «CIERRO: <por qué>». Cerrá cuando lo que la tarea pide esté comprobado por alguien que no lo dijo, ` +
			`o cuando no quede nada útil que hacer con lo que hay. Antes de cerrar, si en la pizarra queda algo importante sin comprobar, ` +
			`pedí que se compruebe. No investigás ni corrés nada: decidís.`,
		tools: read}
}

// channelNote: lo que cierra el prompt de un turno en el canal: quién trabaja en qué, y cómo hablar.
func (h *hub) channelNote(p *participant) string {
	h.mu.Lock()
	var work []string
	for _, q := range h.st.Participants {
		if q.Work != "" && q != p {
			work = append(work, fmt.Sprintf("%s → %s", q.Name, q.Work))
		}
	}
	h.mu.Unlock()
	var b strings.Builder
	if len(work) > 0 {
		b.WriteString("Ahora mismo están trabajando en:\n" + strings.Join(work, "\n") + "\n(no repitas eso: esperá su resultado)\n\n")
	}
	if p.ID == "coordinador" {
		b.WriteString("Nadie tiene nada nuevo que aportar. Decidí el siguiente paso (con @id) o cerrá con «CIERRO: <por qué>».")
		return b.String()
	}
	b.WriteString("Entró contexto nuevo al canal. Decidí vos si aportás: si no tenés algo pertinente y nuevo, contestá sólo «PASO» (no se publica). " +
		"Si vas a correr o leer algo que tarda, empezá tu respuesta con una línea «AVISO: <qué vas a hacer>» ANTES de usar herramientas, " +
		"así el resto sabe que lo tomaste y no lo duplica; después contestá con el resultado. Si alguien te nombra con @" + p.ID + ", te toca.")
	return b.String()
}

// notice publica en vivo el AVISO de un agente, la primera vez que aparece en su turno, y lo deja como su trabajo.
func (h *hub) notice(p *participant, text string) {
	m := reNotice.FindStringSubmatch(text)
	if m == nil {
		return
	}
	h.mu.Lock()
	already := p.Work == m[1]
	if !already {
		p.Work = m[1]
	}
	h.publish()
	h.mu.Unlock()
	if !already {
		h.post(message{Who: p.ID, Name: p.Name, Text: "AVISO: " + m[1], Kind: "aviso"})
	}
}

// unseen: si entró algo que este agente no leyó, que no dijo él y que no es sólo un aviso.
func (h *hub) unseen(p *participant) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	for _, m := range h.st.Messages[min(p.seen, len(h.st.Messages)):] {
		if m.Who != p.ID && m.Kind != "aviso" {
			return true
		}
	}
	return false
}

func (h *hub) channel(outer context.Context, task string) {
	ctx, cancel := context.WithCancel(outer)
	var once sync.Once
	finish := func(why string) {
		once.Do(func() {
			cancel()
			h.mu.Lock()
			h.onSay = nil
			h.mu.Unlock()
			h.say("moderador", "Moderador", "Se cierra la llamada: "+why+".")
			h.scribe(outer, task)
			h.update(func(s *state) {
				s.Running, s.Ended = false, why
				for _, p := range s.Participants {
					if p.Status == "pensando" {
						p.Status = "escuchando"
					}
					p.Doing, p.Work = "", ""
				}
			})
		})
	}

	brief, err := h.brief(task)
	if err != nil {
		finish("no pude leer la tarea: " + err.Error())
		return
	}
	h.mu.Lock()
	var listeners []*participant
	var coord *participant
	for _, p := range h.st.Participants {
		switch p.ID {
		case "coordinador":
			coord = p
		case "escriba":
		default:
			listeners = append(listeners, p)
			p.Status = "escuchando"
		}
	}
	wake := map[string]chan struct{}{}
	for _, p := range listeners {
		wake[p.ID] = make(chan struct{}, 1)
	}
	h.onSay = func() {
		for _, c := range wake {
			select {
			case c <- struct{}{}:
			default:
			}
		}
	}
	h.mu.Unlock()

	left := func() float64 {
		h.mu.Lock()
		defer h.mu.Unlock()
		return h.st.Budget - h.st.Spent
	}
	var busy sync.WaitGroup
	var running sync.Map // id → true mientras trabaja
	for _, p := range listeners {
		go func(p *participant) {
			for {
				select {
				case <-ctx.Done():
					return
				case <-wake[p.ID]:
				}
				for ctx.Err() == nil && h.unseen(p) {
					if left() < 0.1 {
						go finish(fmt.Sprintf("se llegó al tope de US$%.2f", h.st.Budget))
						return
					}
					if p.Turns >= maxTurnsPerAgent {
						h.mu.Lock()
						p.seen = len(h.st.Messages) // ya habló todo lo que podía: escucha sin contestar
						h.mu.Unlock()
						break
					}
					busy.Add(1)
					running.Store(p.ID, true)
					h.turn(ctx, p, task, min(left(), 0.6))
					running.Delete(p.ID)
					busy.Done()
				}
			}
		}(p)
	}

	h.say("moderador", "Moderador", fmt.Sprintf("Arranca la llamada sobre la tarea %s, en modo canal: cada uno habla cuando tiene algo pertinente. "+
		"Si nadie aporta, decide el coordinador.", task))
	h.say("moderador", "Moderador", "Contexto de la tarea (make agente):\n"+brief)

	// El que detecta que nadie aporta: todos escuchando y sin nada sin leer, durante un momento.
	quiet, runs := 0, 0
	tick := time.NewTicker(700 * time.Millisecond)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			if outer.Err() != nil {
				finish("Miguel la cortó")
			}
			return
		case <-tick.C:
		}
		idle := true
		running.Range(func(_, _ any) bool { idle = false; return false })
		for _, p := range listeners {
			if h.unseen(p) && p.Turns < maxTurnsPerAgent {
				idle = false
			}
		}
		if !idle {
			quiet = 0
			continue
		}
		if quiet++; quiet < 3 {
			continue
		}
		quiet = 0
		if runs >= maxCoordinatorRun {
			finish("el coordinador llegó a su tope de intervenciones")
			return
		}
		if left() < 0.1 {
			finish(fmt.Sprintf("se llegó al tope de US$%.2f", h.st.Budget))
			return
		}
		runs++
		text := h.turn(ctx, coord, task, min(left(), 0.4))
		if m := regexp.MustCompile(`(?m)^\s*CIERRO:\s*(.+?)\s*$`).FindStringSubmatch(text); m != nil {
			finish("el coordinador cerró: " + m[1])
			return
		}
		if strings.TrimSpace(text) == "" {
			finish("el coordinador no pudo decidir")
			return
		}
	}
}

// mockChannelReply: un turno simulado del canal, para ver avisos en paralelo, el silencio y al coordinador.
func mockChannelReply(ctx context.Context, h *hub, p *participant) (string, float64) {
	pause := func(d time.Duration) bool {
		select {
		case <-ctx.Done():
			return false
		case <-time.After(d):
			return true
		}
	}
	h.mu.Lock()
	last := h.st.Messages[len(h.st.Messages)-1]
	var checks []string
	for _, c := range h.st.Claims {
		if c.Status == "sin comprobar" && c.Who != p.Name {
			checks = append(checks, fmt.Sprintf("COMPRUEBO: %s | ✓ | git -C legacy-backend grep -n … origin/main", c.ID))
		}
	}
	coordRuns := 0
	for _, m := range h.st.Messages {
		if m.Who == "coordinador" {
			coordRuns++
		}
	}
	h.mu.Unlock()
	named := strings.Contains(last.Text, "@"+p.ID)

	switch p.ID {
	case "coordinador":
		if coordRuns == 0 {
			return "Falta correrlo con el buró dictado. @probador corré la suite de Prami con LAMBDA=1.", 0
		}
		return "Lo pedido quedó comprobado por el verificador.\nCIERRO: specs comprobadas y la duda del buró resuelta", 0
	case "verificador":
		if len(checks) == 0 {
			return "PASO", 0
		}
		pause(800 * time.Millisecond)
		return strings.Join(checks, "\n"), 0
	case "herramientas":
		if p.Turns > 0 {
			return "PASO", 0
		}
		h.notice(p, "AVISO: miro el ambiente con make agente N=86 ENV=1")
		pause(1500 * time.Millisecond)
		return "Nada frena en local; ojo con F-139 en la suite de Prami.\nAFIRMO: nada frena en local | COMANDO: make harness-doctor TARGET=local", 0
	case "probador":
		if p.Turns > 0 && !named {
			return "PASO", 0
		}
		what := "corro make tarea-verify N=86"
		if named {
			what = "corro la suite de Prami con LAMBDA=1"
		}
		h.notice(p, "AVISO: "+what)
		pause(2500 * time.Millisecond)
		if named {
			return "Con el buró dictado, Prami sigue en el listado y la compuerta cierra en los tres casos que fallan.\nAFIRMO: con LAMBDA=1 la compuerta cierra en los 3 casos que fallan | COMANDO: make harness-suite TARGET=local SUITE=harness/suites/compuerta-prami.json LAMBDA=1", 0
		}
		return "S1–S4 pasan.\nAFIRMO: las cuatro specs pasan | COMANDO: make tarea-verify N=86", 0
	case "arquitecto":
		if p.Turns > 0 {
			return "PASO", 0
		}
		pause(1200 * time.Millisecond)
		return "El reordenamiento se decide en LenderValidationService.\nAFIRMO: sólo rt=2 sale del listado al fallar | COMANDO: git -C legacy-backend grep -n dropsWhenRulesFail origin/main", 0
	}
	return "PASO", 0
}
