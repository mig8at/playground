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
	maxTurnsPerAgent = 8
	// minTurnCap: con menos no arranca un turno. Sólo el contexto base cuesta US$0,30-0,45 por turno, y en la segunda
	// sala de entendimiento dos turnos arrancaron con US$0,29 y murieron por tope sin decir nada (pero gastaron).
	minTurnCap        = 0.45
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
	var questions []string
	for _, q := range h.st.Questions {
		if q.Status == "abierta" {
			questions = append(questions, fmt.Sprintf("%s (%s): %s", q.ID, q.Who, q.Text))
		}
	}
	h.mu.Unlock()
	var b strings.Builder
	if len(questions) > 0 {
		b.WriteString("Preguntas abiertas (si podés contestar una con evidencia, RESPONDO: Q<n> | … | COMANDO: …):\n" + strings.Join(questions, "\n") + "\n\n")
	}
	if len(work) > 0 {
		b.WriteString("Ahora mismo están trabajando en:\n" + strings.Join(work, "\n") + "\n(no repitas eso: esperá su resultado)\n\n")
	}
	if p.ID == "coordinador" {
		b.WriteString("Nadie tiene nada nuevo que aportar. Si hay preguntas abiertas, elegí la más importante y asignala con @id " +
			"(«@probador tomá Q2»), o descartala con «DESCARTO: Q<n> | por qué». Si no queda nada útil, cerrá con «CIERRO: <por qué>».")
		return b.String()
	}
	if h.isChecker(p) {
		b.WriteString("Sos quien comprueba: si arriba hay afirmaciones sin comprobar, NO contestes PASO; respondé COMPRUEBO por cada una.\n\n")
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
	var owner *participant
	if !already {
		for _, q := range h.st.Participants {
			if q != p && q.Work != "" && sameWork(q.Work, m[1]) {
				owner = q
			}
		}
	}
	if owner != nil {
		// Dos avisaron lo mismo casi a la vez (en la primera sala de entendimiento real, el probador y el verificador
		// repitieron juntos la consulta de datos): sigue el primero, al segundo se le corta el turno y se le avisa.
		p.dupCut = true
		if p.cancelTurn != nil {
			p.cancelTurn()
		}
	} else if !already {
		p.Work = m[1]
	}
	h.publish()
	h.mu.Unlock()
	switch {
	case owner != nil:
		h.post(message{Who: "moderador", Name: "Moderador", Kind: "aviso",
			Text: fmt.Sprintf("@%s: eso ya lo toma %s («%s»). Esperá su resultado.", p.ID, owner.Name, owner.Work)})
	case !already:
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
			h.report(task, why)
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
	isListener := map[string]bool{}
	for _, p := range listeners {
		wake[p.ID] = make(chan struct{}, 1)
		isListener[p.ID] = true
	}
	want := map[string]bool{} // a quién le toca reaccionar (h.mu)
	reserved := 0.0           // lo apartado por los turnos en curso (h.mu)
	routing := 0              // decisiones del portero en curso (h.mu)
	h.onSay = func(m message) { go h.route(ctx, m, listeners, isListener, want, wake, &routing) }
	h.mu.Unlock()

	// El coordinador tiene su parte apartada desde el arranque: en la primera sala de entendimiento real el tope llegó
	// antes de que hablara, y la pregunta más importante quedó sin dueño. Con lo apartado siempre puede cerrar.
	coordReserve := 0.0
	if h.st.Budget >= 1.5 {
		coordReserve = 0.6 // un turno de Opus midió US$0,43 en la segunda: con 0,40 murió por tope sin hablar
	}
	// take: si a p le toca y queda presupuesto libre, aparta el tope de su turno. Reservar ANTES de empezar es lo
	// que evita lo de la primera llamada en canal: cinco turnos en paralelo gastaban a la vez, el tope cortaba uno a
	// la mitad y su gasto se perdía. Acá, sin presupuesto libre, el turno no empieza y nadie se corta.
	take := func(p *participant) (float64, bool) {
		h.mu.Lock()
		defer h.mu.Unlock()
		if !want[p.ID] {
			return 0, false
		}
		want[p.ID] = false
		avail := h.st.Budget - h.st.Spent - reserved - coordReserve // lo del coordinador no se toca
		if p.Turns >= maxTurnsPerAgent || avail < minTurnCap {
			return 0, false
		}
		cap := min(avail, 0.6)
		reserved += cap
		return cap, true
	}
	release := func(cap float64) { h.mu.Lock(); reserved -= cap; h.mu.Unlock() }
	var running sync.Map // id → true mientras trabaja
	for _, p := range listeners {
		go func(p *participant) {
			for {
				select {
				case <-ctx.Done():
					return
				case <-wake[p.ID]:
				}
				for ctx.Err() == nil {
					cap, ok := take(p)
					if !ok {
						break
					}
					running.Store(p.ID, true)
					h.turn(ctx, p, task, cap)
					running.Delete(p.ID)
					release(cap)
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
		h.mu.Lock()
		for _, p := range listeners {
			if want[p.ID] && p.Turns < maxTurnsPerAgent {
				idle = false
			}
		}
		if routing > 0 {
			idle = false
		}
		avail := h.st.Budget - h.st.Spent - reserved
		workers := avail - coordReserve
		h.mu.Unlock()
		// En una sala de entendimiento, con suficientes hallazgos comprobados se cierra: lo que sigue es revisarlos.
		h.mu.Lock()
		verified := 0
		for _, c := range h.st.Claims {
			if c.Kind == "hallazgo" && c.Status == "comprobada" {
				verified++
			}
		}
		h.mu.Unlock()
		if verified >= maxFindings {
			finish(fmt.Sprintf("se juntaron %d hallazgos comprobados", verified))
			return
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
		if workers < minTurnCap {
			// Se acabó lo de los demás: el coordinador usa lo suyo para cerrar diciendo qué quedó y qué falta.
			// Siempre habla: los turnos se pasan de su tope y lo apartado puede no alcanzar, pero el cierre no queda sin piso.
			h.say("moderador", "Moderador", "Se terminó el presupuesto de trabajo. @coordinador: es tu último turno: "+
				"resumí qué quedó comprobado, qué preguntas siguen abiertas y por qué, y cerrá con CIERRO.")
			h.turn(ctx, coord, task, max(avail, minTurnCap))
			finish(fmt.Sprintf("se llegó al tope de US$%.2f", h.st.Budget))
			return
		}
		runs++
		text := h.turn(ctx, coord, task, min(avail, 0.7))
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
	var last message
	for i := len(h.st.Messages) - 1; i >= 0; i-- { // el último que dijo algo: no un aviso ni la línea del portero
		if k := h.st.Messages[i].Kind; k != "aviso" && k != "portero" {
			last = h.st.Messages[i]
			break
		}
	}
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
	if h.st.Kind == "entendimiento" {
		return mockUnderstanding(h, p, coordRuns, checks, pause), 0
	}

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

// mockUnderstanding: una sala de entendimiento simulada que ejercita las cuatro piezas: dos AVISO iguales (el segundo
// se corta), una PREGUNTA que el coordinador asigna y alguien contesta, un hallazgo del verificador que comprueba otro, y
// el cierre.
func mockUnderstanding(h *hub, p *participant, coordRuns int, checks []string, pause func(time.Duration) bool) string {
	h.mu.Lock()
	var openQ, lastText string
	for _, q := range h.st.Questions {
		if q.Status == "abierta" {
			openQ = q.ID
		}
	}
	for i := len(h.st.Messages) - 1; i >= 0; i-- {
		if k := h.st.Messages[i].Kind; k != "aviso" && k != "portero" {
			lastText = h.st.Messages[i].Text
			break
		}
	}
	h.mu.Unlock()
	named := strings.Contains(lastText, "@"+p.ID)
	switch p.ID {
	case "investigador", "arquitecto":
		if p.Turns > 0 {
			return "PASO"
		}
		h.notice(p, "AVISO: busco los filtros TEMPORAL del listado en main")
		h.mu.Lock()
		cut := p.dupCut
		p.dupCut = false
		h.mu.Unlock()
		if cut {
			return "PASO"
		}
		pause(1200 * time.Millisecond)
		return "HALLAZGO: hueco | LenderRetrievalService.php:739 pisa la línea de Bancolombia en Sonría | lender-listing | COMANDO: git -C legacy-backend grep -n Sonria origin/main"
	case "datos":
		if p.Turns > 0 {
			return "PASO"
		}
		pause(900 * time.Millisecond)
		return "Hay filas para las cinco entidades excluidas, pero no sé qué puerta atiende el tráfico.\nPREGUNTA: ¿qué puerta del listado, v1 o v2, atiende hoy el tráfico real?"
	case "probador":
		if named && openQ != "" {
			h.notice(p, "AVISO: mido qué ruta del listado recibe el tráfico en los logs de prod")
			pause(1500 * time.Millisecond)
			return "RESPONDO: " + openQ + " | v2: lenders-v2 recibe el 98% de los pedidos en 7 días | COMANDO: bin/pg logs --target prod --query 'sum by (path) (…)'\n" + strings.Join(checks, "\n")
		}
		if len(checks) > 0 {
			return strings.Join(checks, "\n")
		}
		return "PASO"
	case "verificador":
		if p.Turns == 0 {
			pause(700 * time.Millisecond)
			return "HALLAZGO: defecto | el filtro temporal de Prami sigue en main desde junio | incidencia | COMANDO: git -C legacy-backend log -S excludedPreApproveLenderIds origin/main"
		}
		if len(checks) == 0 {
			return "PASO"
		}
		pause(700 * time.Millisecond)
		return strings.Join(checks, "\n")
	case "coordinador":
		if openQ != "" {
			return "Lo más importante es saber qué puerta atiende el tráfico. @probador tomá " + openQ + "."
		}
		return "Quedó contestado y comprobado.\nCIERRO: no queda nada abierto sobre el tema"
	}
	return "PASO"
}

var reWord = regexp.MustCompile(`[\p{L}0-9_./-]{4,}`)

// sameWork: si dos avisos son el mismo trabajo: comparten el comando entre comillas invertidas, o la mitad de sus palabras.
func sameWork(a, b string) bool {
	ca, cb := regexp.MustCompile("`([^`]+)`").FindStringSubmatch(a), regexp.MustCompile("`([^`]+)`").FindStringSubmatch(b)
	if ca != nil && cb != nil && ca[1] == cb[1] {
		return true
	}
	wa, wb := map[string]bool{}, map[string]bool{}
	for _, w := range reWord.FindAllString(strings.ToLower(a), -1) {
		wa[w] = true
	}
	for _, w := range reWord.FindAllString(strings.ToLower(b), -1) {
		wb[w] = true
	}
	inter := 0
	for w := range wa {
		if wb[w] {
			inter++
		}
	}
	union := len(wa) + len(wb) - inter
	return union > 0 && float64(inter)/float64(union) >= 0.5
}
