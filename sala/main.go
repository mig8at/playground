// sala: varios agentes en una «llamada» sobre una tarea del tablero, cada uno con su rol y sus permisos, y
// Miguel como un participante más. EXPERIMENTAL: existe para medir si un equipo de roles resuelve mejor o más
// barato que un agente solo (frente «sala» de tablero/tasks/playground-local/task.md).
//
//	make sala                 → http://127.0.0.1:5201
//	make sala MOCK=1          → respuestas simuladas, sin gastar modelo
//
// Cómo funciona. El MODERADOR es este código, no un modelo: da la palabra por turnos (herramientas →
// arquitecto → probador), y corta por tope de rondas, tope de gasto o cuando el probador dice TERMINÉ. Cada
// participante es una sesión de `claude -p` que se retoma con `--resume`, con su rol en el prompt de sistema,
// sus herramientas permitidas y un tope de gasto por turno (`--max-budget-usd`). Lo que se dijo desde su último
// turno le llega como prompt. Sale en `stream-json` para mostrar en vivo qué comando está corriendo.
//
// LA PIZARRA. Una afirmación entra con `AFIRMO: … | COMANDO: …`, y también una corrección dicha en prosa (`reProse`);
// la que no trae comando queda marcada. Cada una tiene id (C1, C2…) y estado: el probador recibe en cada turno las
// que nadie comprobó y contesta `COMPRUEBO: C2 | ✓|✗ | comando`. Tres agentes de acuerdo no prueban nada.
//
// EL CIERRE. Un TERMINÉ del probador abre una ronda de objeciones (CONFORME u OBJECIÓN); con una objeción la
// llamada sigue. En la primera llamada real (2026-11-02) el TERMINÉ cerró con dos pendientes a la vista.
//
// ⚠ Nadie edita archivos, commitea, publica ni corre el harness contra prod (`denied`). La sala corre en la raíz
// del playground, como el ensayo, y suma los repos reales con `--add-dir` para que `git -C` a main funcione.
package main

import (
	"bufio"
	"context"
	_ "embed"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

//go:embed index.html
var indexHTML []byte

type participant struct {
	ID      string  `json:"id"`
	Name    string  `json:"name"`
	Role    string  `json:"role"`
	Status  string  `json:"status"` // esperando · pensando · hablando · pasó · error
	Doing   string  `json:"doing"`
	Cost    float64 `json:"cost"`
	Turns   int     `json:"turns"`
	session string
	system  string
	tools   []string
	seen    int // cuántos mensajes de la transcripción ya vio
}

type message struct {
	Who  string `json:"who"`
	Name string `json:"name"`
	Text string `json:"text"`
	At   string `json:"at"`
}

type claim struct {
	ID      string `json:"id"`
	Who     string `json:"who"`
	Claim   string `json:"claim"`
	Command string `json:"command"`
	Prose   bool   `json:"prose"`  // salió de la prosa (una corrección dicha al pasar), no de una línea AFIRMO
	Status  string `json:"status"` // sin comprobar · comprobada · refutada
	Check   string `json:"check"`  // con qué la comprobó el probador
}

type state struct {
	Task         string         `json:"task"`
	Mock         bool           `json:"mock"`
	Running      bool           `json:"running"`
	Round        int            `json:"round"`
	Rounds       int            `json:"rounds"`
	Budget       float64        `json:"budget"`
	Spent        float64        `json:"spent"`
	Ended        string         `json:"ended"`
	Objecting    bool           `json:"objecting"` // ronda de objeciones abierta tras un TERMINÉ
	Participants []*participant `json:"participants"`
	Messages     []message      `json:"messages"`
	Claims       []claim        `json:"claims"`
}

// Lo que ninguno puede hacer, además de lo que su rol no permite.
var denied = []string{
	"Edit", "Write", "NotebookEdit",
	"Bash(git commit *)", "Bash(git push *)", "Bash(git add *)", "Bash(git checkout *)", "Bash(git reset *)",
	"Bash(*--apply*)", "Bash(*TARGET=prod*)", "Bash(make fresh*)", "Bash(*migrate:fresh*)", "Bash(*db:wipe*)",
}

const common = `Estás en una LLAMADA de trabajo con otros agentes y con Miguel, sobre una tarea del tablero del playground de CreditOp. ` +
	`Hablás en español, en primera persona, como en una reunión: corto (120 palabras como máximo), concreto y sin repetir lo que otro ya dijo. ` +
	`Cuando afirmes algo verificable, agregá una línea aparte con la forma exacta «AFIRMO: <la afirmación> | COMANDO: <el comando que la sostiene>». ` +
	`Una afirmación sin comando vale como opinión. Si corregís algo que ya existe (una nota, un tema de knowledge, una suite, una trampa), ` +
	`va SIEMPRE como AFIRMO con su comando: una corrección dicha en prosa no se comprueba. ` +
	`Si no tenés nada útil que agregar en tu turno, decí sólo «PASO». Cuando el moderador abra una RONDA DE OBJECIONES, ` +
	`contestá sólo «CONFORME» o «OBJECIÓN: <qué queda abierto y con qué se comprobaría>». ` +
	`No edites archivos, no commitees y no corras nada contra producción salvo lecturas de bin/pg.`

func roster() []*participant {
	return []*participant{
		{ID: "herramientas", Name: "Experto en herramientas", Role: "dice con qué se hace cada paso",
			system: common + ` TU ROL: experto en las herramientas del playground. Arrancás con «make agente N=<tarea>» y, en cada turno, ` +
				`decís qué comando conviene para lo que se está discutiendo (make harness-doctor, harness-case, tarea-verify, knowledge-search, bin/pg…) ` +
				`y qué trampa del tablero puede tocarlo. No investigás el código ni corrés pruebas: eso es de los otros.`,
			tools: []string{"Read", "Grep", "Glob", "Bash(make agente *)", "Bash(make harness-doctor *)", "Bash(make knowledge-*)",
				"Bash(make retomar *)", "Bash(make trampas *)", "Bash(make tareas *)", "Bash(make)", "Bash(grep *)"}},
		{ID: "arquitecto", Name: "Arquitecto", Role: "dónde se decide en main",
			system: common + ` TU ROL: arquitecto. Decís dónde se decide lo que se discute en el código de main, mirando SIEMPRE los dos monolitos ` +
				`(legacy-backend y legacy-application) con git grep / git show contra origin/main, y qué patrón seguir. Citás archivo:línea. Sólo lees.`,
			tools: []string{"Read", "Grep", "Glob", "Bash(git grep *)", "Bash(git -C *)", "Bash(git show *)", "Bash(git log *)",
				"Bash(make knowledge-*)", "Bash(go run ./cmd/repos *)"}},
		{ID: "probador", Name: "Probador", Role: "comprueba corriendo y avisa al terminar",
			system: common + ` TU ROL: probador. Lo que se afirma lo comprobás CORRIENDO, contra el ambiente local (harness-case, harness-listing, ` +
				`harness-suite, harness-walk-wizard, tarea-verify) o leyendo con bin/pg. Antes de concluir, mirá el ambiente con make harness-doctor TARGET=local. ` +
				`En cada turno recibís las afirmaciones de la pizarra que nadie comprobó: comprobá las que puedas y respondé por cada una con una línea ` +
				`«COMPRUEBO: C<n> | ✓ o ✗ | <el comando que corriste>». ` +
				`Cuando la tarea esté comprobada (o no se pueda), empezá tu mensaje con «TERMINÉ» y decí qué quedó probado y con qué comando.`,
			tools: []string{"Read", "Grep", "Glob", "Bash(make harness-case *)", "Bash(make harness-listing *)", "Bash(make harness-suite *)",
				"Bash(make harness-walk-wizard *)", "Bash(make harness-doctor *)", "Bash(make tarea-verify *)", "Bash(make agente *)",
				"Bash(bin/pg sql *)", "Bash(bin/pg request *)", "Bash(bin/pg client *)", "mcp__playground__sql", "mcp__playground__request_timeline"}},
	}
}

type hub struct {
	mu     sync.Mutex
	st     state
	subs   map[chan []byte]bool
	cancel context.CancelFunc
	root   string
}

func (h *hub) snapshot() []byte {
	b, _ := json.Marshal(h.st)
	return b
}

// publish manda el estado entero a cada pestaña abierta. Se llama con el candado tomado.
func (h *hub) publish() {
	b := h.snapshot()
	for c := range h.subs {
		select {
		case c <- b:
		default:
		}
	}
}

func (h *hub) update(f func(*state)) {
	h.mu.Lock()
	defer h.mu.Unlock()
	f(&h.st)
	h.publish()
}

func (h *hub) say(who, name, text string) {
	h.update(func(s *state) {
		s.Messages = append(s.Messages, message{Who: who, Name: name, Text: text, At: time.Now().Format("15:04:05")})
	})
}

var (
	reClaim = regexp.MustCompile(`(?m)^\s*AFIRMO:\s*(.+?)(?:\s*\|\s*COMANDO:\s*(.+?))?\s*$`)
	reCheck = regexp.MustCompile(`(?m)^\s*COMPRUEBO:\s*(C[0-9]+)\s*\|\s*(✓|✗)\s*(?:\|\s*(.+?))?\s*$`)
	// Una corrección dicha al pasar: la de la primera llamada real («la nota de la suite cita mal…») era falsa y
	// no entró a la pizarra porque no venía como AFIRMO. Léxico a propósito: mejor una de más, punteada.
	reProse = regexp.MustCompile(`(?i)[^.\n]*(corrección|corrijo|hay que corregir|cita mal|no es correcto|es incorrect|se equivoc)[^.\n]*`)
)

func main() {
	addr := flag.String("addr", "127.0.0.1:5201", "dónde escucha")
	flag.Parse()
	root, _ := os.Getwd()
	if _, err := os.Stat(filepath.Join(root, "tools", "ui", "theme.css")); err != nil {
		log.Fatal("corré la sala desde la raíz del playground (make sala)")
	}
	h := &hub{subs: map[chan []byte]bool{}, root: root}
	h.st = state{Participants: roster(), Messages: []message{}, Claims: []claim{}}

	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("content-type", "text/html; charset=utf-8")
		_, _ = w.Write(indexHTML)
	})
	// El tema es UNO para todas las herramientas: se sirve desde su fuente, no se copia.
	http.HandleFunc("/theme.css", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, filepath.Join(root, "tools", "ui", "theme.css"))
	})
	http.HandleFunc("/api/events", h.events)
	http.HandleFunc("/api/start", h.start)
	http.HandleFunc("/api/say", func(w http.ResponseWriter, r *http.Request) {
		var in struct{ Text string }
		if json.NewDecoder(r.Body).Decode(&in) != nil || strings.TrimSpace(in.Text) == "" {
			http.Error(w, "falta el texto", 400)
			return
		}
		h.say("miguel", "Miguel", strings.TrimSpace(in.Text))
	})
	http.HandleFunc("/api/stop", func(w http.ResponseWriter, r *http.Request) {
		h.mu.Lock()
		if h.cancel != nil {
			h.cancel()
		}
		h.mu.Unlock()
	})
	log.Printf("sala en http://%s", *addr)
	log.Fatal(http.ListenAndServe(*addr, nil))
}

func (h *hub) events(w http.ResponseWriter, r *http.Request) {
	fl, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "sin streaming", 500)
		return
	}
	w.Header().Set("content-type", "text/event-stream")
	w.Header().Set("cache-control", "no-cache")
	c := make(chan []byte, 16)
	h.mu.Lock()
	h.subs[c] = true
	first := h.snapshot()
	h.mu.Unlock()
	defer func() { h.mu.Lock(); delete(h.subs, c); h.mu.Unlock() }()
	fmt.Fprintf(w, "data: %s\n\n", first)
	fl.Flush()
	for {
		select {
		case <-r.Context().Done():
			return
		case b := <-c:
			fmt.Fprintf(w, "data: %s\n\n", b)
			fl.Flush()
		}
	}
}

func (h *hub) start(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Task   string  `json:"task"`
		Rounds int     `json:"rounds"`
		Budget float64 `json:"budget"`
		Mock   bool    `json:"mock"`
	}
	if json.NewDecoder(r.Body).Decode(&in) != nil || strings.TrimSpace(in.Task) == "" {
		http.Error(w, "falta la tarea", 400)
		return
	}
	if in.Rounds <= 0 || in.Rounds > 6 {
		in.Rounds = 3
	}
	if in.Budget <= 0 || in.Budget > 10 {
		in.Budget = 3
	}
	if os.Getenv("SALA_MOCK") == "1" {
		in.Mock = true
	}
	h.mu.Lock()
	if h.st.Running {
		h.mu.Unlock()
		http.Error(w, "ya hay una llamada en curso", 409)
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	h.cancel = cancel
	h.st = state{Task: in.Task, Mock: in.Mock, Running: true, Rounds: in.Rounds, Budget: in.Budget, Participants: roster(),
		Messages: []message{}, Claims: []claim{}}
	h.publish()
	h.mu.Unlock()
	go h.meeting(ctx, in.Task)
}

// meeting es el moderador: arma el contexto de la tarea, da la palabra por turnos y decide cuándo se corta.
func (h *hub) meeting(ctx context.Context, task string) {
	end := func(why string) {
		h.update(func(s *state) {
			s.Running, s.Ended = false, why
			for _, p := range s.Participants {
				if p.Status == "pensando" {
					p.Status = "esperando"
				}
				p.Doing = ""
			}
		})
		h.say("moderador", "Moderador", "Se cierra la llamada: "+why+".")
	}
	brief, err := h.brief(task)
	if err != nil {
		end("no pude leer la tarea: " + err.Error())
		return
	}
	h.say("moderador", "Moderador", fmt.Sprintf("Arranca la llamada sobre la tarea %s. Orden de palabra: herramientas → arquitecto → probador.", task))
	h.say("moderador", "Moderador", "Contexto de la tarea (make agente):\n"+brief)

	for round := 1; ; round++ {
		h.mu.Lock()
		rounds, parts := h.st.Rounds, h.st.Participants
		h.st.Round = round
		h.publish()
		h.mu.Unlock()
		if round > rounds {
			end(fmt.Sprintf("se completaron las %d rondas", rounds))
			return
		}
		passes := 0
		for _, p := range parts {
			if ctx.Err() != nil {
				end("Miguel la cortó")
				return
			}
			h.mu.Lock()
			left := h.st.Budget - h.st.Spent
			h.mu.Unlock()
			if left < 0.1 {
				end(fmt.Sprintf("se llegó al tope de US$%.2f", h.st.Budget))
				return
			}
			text := h.turn(ctx, p, task, min(left, 1.0))
			switch {
			case strings.HasPrefix(strings.TrimSpace(text), "PASO"):
				passes++
			case p.ID == "probador" && strings.HasPrefix(strings.TrimSpace(text), "TERMINÉ"):
				if h.objections(ctx, parts, task) {
					end("el probador la dio por comprobada y nadie objetó")
					return
				}
				if round >= rounds {
					end("quedaron objeciones abiertas al llegar al tope de rondas")
					return
				}
				passes = -1 // hubo objeciones: la ronda no cuenta como «nadie tenía nada»
			}
			if passes < 0 {
				break
			}
		}
		if passes == len(parts) {
			end("nadie tenía nada que agregar")
			return
		}
	}
}

/* objections: antes de cerrar por un TERMINÉ, cada uno de los otros dice CONFORME u OBJECIÓN. En la primera
 * llamada real el probador cerró con dos pendientes a la vista (S3 contra main, F-246) y nadie pudo objetar.
 * Devuelve true si nadie objetó. */
func (h *hub) objections(ctx context.Context, parts []*participant, task string) bool {
	h.update(func(s *state) { s.Objecting = true })
	defer h.update(func(s *state) { s.Objecting = false })
	h.say("moderador", "Moderador", "El probador da la tarea por terminada. Ronda de objeciones: ¿queda algo abierto? CONFORME u OBJECIÓN.")
	objected := false
	for _, q := range parts {
		if q.ID == "probador" || ctx.Err() != nil {
			continue
		}
		h.mu.Lock()
		left := h.st.Budget - h.st.Spent
		h.mu.Unlock()
		if left < 0.1 {
			break
		}
		if strings.HasPrefix(strings.TrimSpace(h.turn(ctx, q, task, min(left, 0.5))), "OBJECIÓN") {
			objected = true
		}
	}
	if objected {
		h.say("moderador", "Moderador", "Hay objeciones: sigue la llamada y el probador las atiende en su próximo turno.")
	}
	return !objected && ctx.Err() == nil
}

func orNone(s string) string {
	if s == "" {
		return "ninguno"
	}
	return s
}

// brief: el arranque de la tarea, el mismo de `make agente` (texto, que es más corto que el JSON).
func (h *hub) brief(task string) (string, error) {
	h.mu.Lock()
	mock := h.st.Mock
	h.mu.Unlock()
	if mock {
		return "(simulado) #" + task + " · 3 pendientes · specs S1–S2 · trampas F-246", nil
	}
	cmd := exec.Command("go", "run", "./cmd/agent", "-n", task)
	cmd.Dir = filepath.Join(h.root, "tablero", "server")
	out, err := cmd.Output()
	if err != nil {
		return "", err
	}
	s := string(out)
	if i := strings.Index(s, "  RECORRIDO"); i > 0 {
		s = s[:i] // el recorrido es de un agente solo; acá los roles lo reparten
	}
	return strings.TrimSpace(s), nil
}

// turn: un turno de un participante. Le llega lo que se dijo desde su último turno.
func (h *hub) turn(ctx context.Context, p *participant, task string, budget float64) string {
	h.mu.Lock()
	mock := h.st.Mock
	msgs := append([]message(nil), h.st.Messages[p.seen:]...)
	p.seen = len(h.st.Messages)
	p.Status, p.Doing = "pensando", ""
	h.publish()
	h.mu.Unlock()

	var b strings.Builder
	if p.session == "" {
		fmt.Fprintf(&b, "La tarea de la llamada es la %s del tablero. Lo dicho hasta ahora:\n\n", task)
	} else {
		b.WriteString("Lo dicho desde tu último turno:\n\n")
	}
	for _, m := range msgs {
		fmt.Fprintf(&b, "[%s] %s\n\n", m.Name, m.Text)
	}
	if p.ID == "probador" {
		h.mu.Lock()
		var open []string
		for _, c := range h.st.Claims {
			if c.Status == "sin comprobar" {
				open = append(open, fmt.Sprintf("%s · %s: %s (comando: %s)", c.ID, c.Who, c.Claim, orNone(c.Command)))
			}
		}
		h.mu.Unlock()
		if len(open) > 0 {
			b.WriteString("Afirmaciones de la pizarra que nadie comprobó (respondé con COMPRUEBO por las que puedas):\n" + strings.Join(open, "\n") + "\n\n")
		}
	}
	b.WriteString("Es tu turno.")

	var text, errText string
	var cost float64
	if mock {
		text, cost = mockReply(ctx, h, p)
	} else {
		text, cost, errText = h.claude(ctx, p, b.String(), budget)
	}
	h.update(func(s *state) {
		p.Turns++
		p.Cost += cost
		s.Spent += cost
		p.Doing = ""
		switch {
		case errText != "":
			p.Status = "error"
		case strings.HasPrefix(strings.TrimSpace(text), "PASO"):
			p.Status = "pasó"
		default:
			p.Status = "esperando"
		}
		add := func(c claim) {
			for _, prev := range s.Claims { // repetir una afirmación no la hace más cierta
				if prev.Who == p.Name && prev.Claim == c.Claim {
					return
				}
			}
			c.ID, c.Who, c.Status = fmt.Sprintf("C%d", len(s.Claims)+1), p.Name, "sin comprobar"
			if p.ID == "probador" && c.Command != "" {
				c.Status, c.Check = "comprobada", c.Command // lo afirma quien lo corrió
			}
			s.Claims = append(s.Claims, c)
		}
		for _, m := range reClaim.FindAllStringSubmatch(text, -1) {
			add(claim{Claim: m[1], Command: m[2]})
		}
		prose := reClaim.ReplaceAllString(reCheck.ReplaceAllString(text, ""), "")
		for _, m := range reProse.FindAllString(prose, -1) {
			add(claim{Claim: strings.TrimSpace(m), Prose: true})
		}
		if p.ID == "probador" {
			for _, m := range reCheck.FindAllStringSubmatch(text, -1) {
				for i := range s.Claims {
					if s.Claims[i].ID == m[1] {
						s.Claims[i].Status = map[string]string{"✓": "comprobada", "✗": "refutada"}[m[2]]
						s.Claims[i].Check = m[3]
					}
				}
			}
		}
	})
	if errText != "" {
		h.say(p.ID, p.Name, "⚠ "+errText)
		return ""
	}
	h.say(p.ID, p.Name, strings.TrimSpace(text))
	return text
}

// claude corre el turno con `claude -p` en stream-json: cada herramienta que usa se ve en su recuadro.
func (h *hub) claude(ctx context.Context, p *participant, prompt string, budget float64) (string, float64, string) {
	args := []string{"-p", prompt, "--output-format", "stream-json", "--verbose",
		"--max-budget-usd", fmt.Sprintf("%.2f", budget),
		"--append-system-prompt", p.system,
		"--allowedTools", strings.Join(p.tools, ","),
		"--disallowedTools", strings.Join(denied, ","),
		"--add-dir", filepath.Join(os.Getenv("HOME"), "Desktop", "CREDITOP", "github")}
	if p.session != "" {
		args = append(args, "--resume", p.session)
	}
	tctx, cancel := context.WithTimeout(ctx, 15*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(tctx, "claude", args...)
	cmd.Dir = h.root
	cmd.Env = childEnv()
	out, err := cmd.StdoutPipe()
	if err != nil {
		return "", 0, err.Error()
	}
	if err := cmd.Start(); err != nil {
		return "", 0, "no pude lanzar claude: " + err.Error()
	}
	h.update(func(*state) { p.Status = "pensando" })
	var result string
	var cost float64
	var failed string
	sc := bufio.NewScanner(out)
	sc.Buffer(make([]byte, 1<<20), 32<<20)
	for sc.Scan() {
		var ev struct {
			Type      string  `json:"type"`
			Subtype   string  `json:"subtype"`
			SessionID string  `json:"session_id"`
			Result    string  `json:"result"`
			Cost      float64 `json:"total_cost_usd"`
			IsError   bool    `json:"is_error"`
			Message   struct {
				Content []struct {
					Type  string          `json:"type"`
					Name  string          `json:"name"`
					Input json.RawMessage `json:"input"`
				} `json:"content"`
			} `json:"message"`
		}
		if json.Unmarshal(sc.Bytes(), &ev) != nil {
			continue
		}
		if ev.SessionID != "" {
			p.session = ev.SessionID
		}
		switch ev.Type {
		case "assistant":
			for _, c := range ev.Message.Content {
				if c.Type == "tool_use" {
					doing := c.Name
					var in struct{ Command string }
					if json.Unmarshal(c.Input, &in) == nil && in.Command != "" {
						doing = in.Command
					}
					h.update(func(*state) { p.Doing = truncate(doing, 90) })
				}
			}
		case "result":
			result, cost = ev.Result, ev.Cost
			if ev.IsError {
				failed = "el turno terminó con error: " + ev.Subtype
			}
		}
	}
	if err := cmd.Wait(); err != nil && failed == "" && result == "" {
		failed = "claude -p: " + err.Error()
	}
	if failed != "" && result != "" {
		return result, cost, ""
	}
	return result, cost, failed
}

func childEnv() []string {
	var env []string
	for _, kv := range os.Environ() {
		if !strings.HasPrefix(kv, "E2E_TARGET=") {
			env = append(env, kv)
		}
	}
	return env
}

func truncate(s string, n int) string {
	s = strings.Join(strings.Fields(s), " ")
	if r := []rune(s); len(r) > n {
		return string(r[:n]) + "…"
	}
	return s
}

// mockReply: un turno simulado, para probar la interfaz sin gastar modelo.
func mockReply(ctx context.Context, h *hub, p *participant) (string, float64) {
	steps := map[string][]string{
		"herramientas": {"make agente N=86", "make harness-doctor TARGET=local"},
		"arquitecto":   {"git -C legacy-backend grep -n optionCount origin/main", "git -C legacy-application grep -n calculator origin/main"},
		"probador":     {"make harness-doctor TARGET=local", "make tarea-verify N=86"},
	}
	for _, d := range steps[p.ID] {
		h.update(func(*state) { p.Doing = d })
		select {
		case <-ctx.Done():
			return "", 0
		case <-time.After(900 * time.Millisecond):
		}
	}
	h.mu.Lock()
	round, objecting := h.st.Round, h.st.Objecting
	h.mu.Unlock()
	switch {
	case objecting && p.ID == "herramientas" && round < 3:
		return "OBJECIÓN: S3 se midió en la rama local, no en main.", 0
	case objecting:
		return "CONFORME", 0
	case p.ID == "probador" && round >= 2:
		return "TERMINÉ: las cuatro specs pasan.\nAFIRMO: la tarea cumple su criterio de hecho | COMANDO: make tarea-verify N=86", 0
	case p.ID == "probador":
		return "Corrí el doctor y la suite.\nCOMPRUEBO: C3 | ✗ | git -C legacy-backend grep -n false_lenders origin/main", 0
	case p.ID == "herramientas":
		return "Antes de leer código, el doctor ya dice qué está mal en local.\nAFIRMO: Motai R no declara plazo en su calculadora | COMANDO: make harness-doctor TARGET=local", 0
	case p.ID == "arquitecto":
		return "El número de cuotas sale de count o weeks en lenders.calculator. Corrección: la nota de la suite cita mal RiskCentralValidationService.\nAFIRMO: el plazo de renting sale de LenderCalculator::optionCount", 0
	}
	return "PASO", 0
}
