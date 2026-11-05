package main

/* EL BARRIDO (Miguel, 2026-11-03): varios agentes SOLOS, en paralelo y sin turnos, cada uno sobre un tema de
 * knowledge/, y al final un verificador que no escribió nada comprueba cada hallazgo.
 *
 * POR QUÉ NO LA SALA DE LLAMADAS, que se retiró el mismo día. Se compararon sobre lender-profile-rules, con el mismo
 * brief y el mismo tope: un agente solo dio 10 hallazgos (9 comprobados, los 9 ciertos) con US$2,13 eq.; la llamada
 * dio 0 con US$2,49 eq. Cada turno de la llamada volvía a pagar el contexto base (~55k tokens de entrada nueva) y
 * cada rol alcanzó a trabajar un turno; el agente solo hizo 44 pasos en una sesión con caché. El barrido se queda
 * con lo que funcionó (sesión larga, todas las herramientas) y con lo único bueno de la llamada: lo que se afirma
 * lo comprueba otro.
 *
 * REPARTO. Por TEMA, no por especialidad: con todas las herramientas cada agente ya es «experto en todo», y dos
 * sobre el mismo tema se repiten. Sin temas pedidos, van los de revisión más vieja (`reviewedAt` de sources.json).
 *
 * EL VERIFICADOR NO ALCANZA SOLO. En el primer barrido real marcó 28 de 28 con ✓, y la pasada que llevó los
 * hallazgos a knowledge/ encontró dos partes falsas. Antes de escribir en un tema hace falta una segunda mirada.
 *
 * RETROALIMENTACIÓN. Lo que el verificador confirma queda en sala/.barridos/conocidos/<tema>.md, y el próximo
 * barrido de ese tema lo recibe en su brief para no redescubrirlo. A knowledge/ no se escribe nada: lo aprueba Miguel. */

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"creditop/playground/connectors/canon"
)

const (
	sweepModel    = "claude-opus-5-5"
	sweepEffort   = "medium"
	verifierModel = "claude-opus-5-5"
	verifierLevel = "high"
	maxBriefRunes = 7000
	maxStepsShown = 60 // pasos que guarda cada agente para la interfaz
)

// Lo que ninguno puede hacer: el barrido sólo lee.
var denied = []string{
	"Edit", "Write", "NotebookEdit",
	"Bash(git commit *)", "Bash(git push *)", "Bash(git add *)", "Bash(git checkout *)", "Bash(git reset *)",
	"Bash(*--apply*)", "Bash(*TARGET=prod*)", "Bash(make fresh*)", "Bash(*migrate:fresh*)", "Bash(*db:wipe*)",
}

// Las herramientas de un agente del barrido, todas de lectura: código de main, conocimiento local, la base y los
// logs de cada ambiente, y el harness.
var sweepTools = []string{"Read", "Grep", "Glob",
	"Bash(git grep *)", "Bash(git -C *)", "Bash(git show *)", "Bash(git log *)", "Bash(go run ./cmd/repos *)",
	"Bash(make knowledge-*)", "Bash(make retomar *)", "Bash(make tareas *)", "Bash(make trampas *)",
	"Bash(bin/pg confluence *)", "Bash(bin/pg jira search *)", "Bash(bin/pg tareas *)", "Bash(bin/pg tarea pila *)",
	"Bash(bin/pg sql *)", "Bash(bin/pg events *)", "Bash(bin/pg request *)", "Bash(bin/pg logs *)", "Bash(bin/pg client *)",
	"Bash(make harness-case *)", "Bash(make harness-listing *)", "Bash(make harness-suite *)", "Bash(make harness-walk-wizard *)",
	"Bash(make harness-doctor *)", "Bash(make tarea-verify *)", "Bash(make agente *)", "Bash(lsof -nP -iTCP*)", "Bash(grep *)"}

const sweepRules = `No edites archivos, no commitees y no corras nada contra producción salvo lecturas de bin/pg. ` +
	`Un comando por llamada a Bash, sin cd, sin ;, && ni |: usá git -C <repo> y bin/pg con ruta relativa. ` +
	`En una consulta a Loki, buscá texto sin rayas ni comillas tipográficas: un «—» que no coincide da 0 sin fallar.`

const sweepSystem = `Trabajás SOLO sobre un TEMA del conocimiento local del playground de CreditOp. Hacés todo: traer lo que ya se ` +
	`sabe (knowledge/, trampas del tablero, Confluence), mirar dónde se decide en main (git grep / git show contra origin/main en los DOS ` +
	`monolitos, legacy-backend y legacy-application), medir en prod sólo leyendo (bin/pg sql, bin/pg logs) y correr el harness si sirve. ` +
	`Buscás contradicciones entre el tema y main, huecos (reglas en main que ningún tema nombra), afirmaciones sin suite que las pruebe y ` +
	`posibles defectos. Antes de escribir un hallazgo comprobalo vos mismo volviendo a la fuente; no repitas lo que el tema ya dice ni lo ` +
	`que figura como YA CONOCIDO. Terminá con la lista: cada hallazgo en UNA sola línea, con la forma exacta «HALLAZGO: ` +
	`<contradicción|hueco|sin prueba|defecto> | <qué es, con archivo:línea> | <destino: el tema a corregir, la suite a crear o «incidencia»> | ` +
	`COMANDO: <el comando que lo muestra>», y después las dudas como «PREGUNTA: …». Nada se escribe en knowledge/ ni en el harness: la ` +
	`lista es un borrador que comprueba otro y aprueba Miguel. ` + sweepRules

const verifierSystem = `Sos el VERIFICADOR de un barrido: otros agentes dejaron hallazgos sobre temas del conocimiento local de ` +
	`CreditOp y vos no escribiste ninguno. Comprobá cada uno volviendo a la fuente, sin repetir el razonamiento de quien lo dijo: git grep / ` +
	`git show contra origin/main en los DOS monolitos, bin/pg sql o logs en sólo lectura. Comprobá también la PREMISA (qué ids, qué rama, ` +
	`qué clave) y cada cita textual: si el hallazgo dice que un comentario o una línea dice algo, abrila. Un hallazgo con una parte falsa ` +
	`es ✗ aunque el resto sea cierto. Por cada hallazgo, una línea exacta «VEREDICTO: H<n> | ✓, ✗ o — | <el comando que corriste> | ` +
	`<una frase: qué viste>», donde ✗ es «es falso, exagera o tiene una parte falsa», y — es «no se pudo comprobar». Si el presupuesto no ` +
	`alcanza para todos, empezá por los defectos y las contradicciones. ` + sweepRules

var goalText = []string{
	"contradicciones: lo que dice knowledge/ contra lo que hace main, en los dos monolitos",
	"huecos: reglas que están en main y no tienen tema en knowledge/ (como un filtro TEMPORAL que nadie anotó)",
	"reglas sin prueba: lo que un tema afirma y ninguna suite del harness comprueba corriendo, con la suite que lo haría",
	"posibles defectos: código raro en main que vale la pena medir en prod (bin/pg, sólo lectura)",
}

// step es una cosa que hizo un agente: una herramienta que usó o algo que dijo.
type step struct {
	At   string `json:"at"`
	Kind string `json:"kind"` // tool · text
	Text string `json:"text"`
}

// agent es un agente del barrido (o el verificador), tal como lo ve la interfaz.
type agent struct {
	Topic    string  `json:"topic"`
	Status   string  `json:"status"` // esperando · trabajando · listo · error · cortado
	Doing    string  `json:"doing"`
	Steps    []step  `json:"steps"`
	Tools    int     `json:"tools"`
	Turns    int     `json:"turns"`
	TokensIn int     `json:"tokensIn"`
	Cost     float64 `json:"cost"`
	Seconds  int     `json:"seconds"`
	Findings int     `json:"findings"`
	Err      string  `json:"err,omitempty"`
	started  time.Time
	text     string
}

type finding struct {
	ID      string `json:"id"`
	Topic   string `json:"topic"`
	Kind    string `json:"kind"` // contradicción · hueco · sin prueba · defecto
	Text    string `json:"text"`
	Verdict string `json:"verdict"` // ✓ ✗ — o vacío si el verificador no llegó
	Check   string `json:"check"`
	// Sólo en el barrido de canon: dónde quedó la pieza y qué dijo canon al ensayarla.
	Piece     string `json:"piece,omitempty"`
	Rehearsal string `json:"rehearsal,omitempty"`
	// Lo que dijo el integrador de esta pieza, si la cruzó con otra de otro tema.
	Integration string `json:"integration,omitempty"`
	piece       canon.Piece
}

// board es el estado de un barrido: lo que pinta la interfaz y lo que queda en barrido.json.
type board struct {
	ID          string     `json:"id"`
	Mode        string     `json:"mode"`  // knowledge · canon
	Phase       string     `json:"phase"` // agentes · verificador · terminado · cortado
	Mock        bool       `json:"mock"`
	Budget      float64    `json:"budget"`
	CheckBudget float64    `json:"checkBudget"`
	Agents      []*agent   `json:"agents"`
	Verifier    *agent     `json:"verifier"`
	Verifiers   []*agent   `json:"verifiers,omitempty"`   // canon: uno por tema, en cadena detrás de su agente
	Notes       []*agent   `json:"notes,omitempty"`       // canon: los agentes de archivo compartido, antes de los temas
	Integrator  *agent     `json:"integrator,omitempty"`  // canon: el que cruza las piezas de temas que comparten archivos
	Correctors  []*agent   `json:"correctors,omitempty"`  // canon: corrector y reverificador de cada tema con piezas rechazadas
	SharedFiles int        `json:"sharedFiles,omitempty"` // canon: archivos de estos temas que la ronda marca en más de un tema
	ReusedNotes int        `json:"reusedNotes,omitempty"` // …y cuántas notas se reusaron de un barrido anterior
	Findings    []*finding `json:"findings"`
	Cost        float64    `json:"cost"`
	Report      string     `json:"report"`
	Started     string     `json:"started"`
	Ended       string     `json:"ended"`
}

var (
	reVerdict   = regexp.MustCompile(`(?m)^[\s*_-]*VEREDICTO:?[*_]*\s*([HP][0-9]+)\s*\|\s*(✓|✗|—)\s*\|\s*(.+?)[\s*_]*$`)
	reFindStart = regexp.MustCompile(`^\s*(?:[-*]\s*)?HALLAZGO:`)
	reFindKind  = regexp.MustCompile(`^HALLAZGO:\s*([^|]+?)\s*\|`)
)

// sweeper corre un barrido a la vez y guarda el estado que pinta la interfaz.
type sweeper struct {
	root   string
	mu     sync.Mutex
	b      *board
	cancel context.CancelFunc
	work   canonWork // los archivos cambiados de cada tema, en el barrido de canon
}

func (s *sweeper) snapshot() []byte {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.b == nil {
		return []byte("null")
	}
	raw, _ := json.Marshal(s.b)
	return raw
}

func (s *sweeper) running() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b != nil && s.b.Ended == ""
}

func (s *sweeper) stop() {
	s.mu.Lock()
	cancel := s.cancel
	s.mu.Unlock()
	if cancel != nil {
		cancel()
	}
}

// start arranca un barrido en segundo plano; done recibe la ruta del informe al terminar.
func (s *sweeper) start(mode string, topics []string, n int, budget, checkBudget float64, mock bool, done func(string, error)) error {
	if s.running() {
		return fmt.Errorf("ya hay un barrido corriendo")
	}
	var work canonWork
	if mode == "canon" {
		rctx, rcancel := context.WithTimeout(context.Background(), 90*time.Second)
		var err error
		topics, work, err = canonRound(rctx, topics, n)
		rcancel()
		if err != nil {
			return err
		}
	} else {
		mode = "knowledge"
		if len(topics) == 0 {
			topics = oldestTopics(s.root, n)
		}
	}
	if len(topics) == 0 {
		return fmt.Errorf("no hay temas para barrer en %s", mode)
	}
	ctx, cancel := context.WithCancel(context.Background())
	b := &board{ID: time.Now().Format("20060102-150405"), Mode: mode, Phase: "agentes", Mock: mock, Budget: budget, CheckBudget: checkBudget,
		Verifier: &agent{Topic: "verificador", Status: "esperando", Steps: []step{}}, Findings: []*finding{},
		Started: time.Now().Format(time.RFC3339)}
	for _, t := range topics {
		b.Agents = append(b.Agents, &agent{Topic: t, Status: "esperando", Steps: []step{}})
		if mode == "canon" {
			b.Verifiers = append(b.Verifiers, &agent{Topic: "verificador · " + t, Status: "esperando", Steps: []step{}})
		}
	}
	s.mu.Lock()
	if mode == "canon" {
		b.Phase, b.Verifier = "notas", nil
	}
	s.b, s.cancel, s.work = b, cancel, work
	s.mu.Unlock()
	go func() {
		path, err := s.run(ctx, b)
		cancel()
		if done != nil {
			done(path, err)
		}
	}()
	return nil
}

func (s *sweeper) run(ctx context.Context, b *board) (string, error) {
	dir := filepath.Join(s.root, "sala", ".barridos", b.ID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	if b.Mode == "canon" {
		s.pipeline(ctx, b, dir)
		return s.finish(ctx, b, dir)
	}
	var wg sync.WaitGroup
	for _, a := range b.Agents {
		wg.Add(1)
		go func(a *agent) {
			defer wg.Done()
			s.runOne(ctx, a, sweepBrief(s.root, a.Topic), sweepSystem, sweepTools, sweepModel, sweepEffort, b.Budget, b.Mock, nil)
			_ = os.WriteFile(filepath.Join(dir, a.Topic+".md"), []byte(a.text), 0o644)
		}(a)
	}
	wg.Wait()

	s.mu.Lock()
	for _, a := range b.Agents {
		if b.Mode == "canon" {
			for _, p := range parsePieces(a.text) {
				kind, label := pieceLabel(p)
				b.Findings = append(b.Findings, &finding{ID: fmt.Sprintf("P%d", len(b.Findings)+1), Topic: a.Topic, Kind: kind, Text: label, piece: p})
				a.Findings++
			}
			continue
		}
		for _, text := range parseFindings(a.text) {
			f := &finding{ID: fmt.Sprintf("H%d", len(b.Findings)+1), Topic: a.Topic, Text: text}
			if m := reFindKind.FindStringSubmatch(text); m != nil {
				f.Kind = m[1]
			}
			b.Findings = append(b.Findings, f)
			a.Findings++
		}
	}
	findings := append([]*finding(nil), b.Findings...)
	if ctx.Err() == nil && len(findings) > 0 {
		b.Phase = "verificador"
	}
	s.mu.Unlock()

	if ctx.Err() == nil && len(findings) > 0 {
		var p strings.Builder
		system, tools := verifierSystem, sweepTools
		if b.Mode == "canon" {
			system, tools = canonVerifierSystem, canonTools
			p.WriteString("Piezas del barrido de canon. Comprobá cada una:\n\n")
			for _, f := range findings {
				raw, _ := json.Marshal(f.piece)
				fmt.Fprintf(&p, "%s [%s]\n%s\n\n", f.ID, f.Topic, raw)
			}
			var topics []string
			for _, ag := range b.Agents {
				topics = append(topics, ag.Topic)
			}
			p.WriteString(canonProse(ctx, topics))
		} else {
			p.WriteString("Hallazgos del barrido. Comprobá cada uno:\n\n")
			for _, f := range findings {
				fmt.Fprintf(&p, "%s [%s] %s\n\n", f.ID, f.Topic, f.Text)
			}
		}
		s.runOne(ctx, b.Verifier, p.String(), system, tools, verifierModel, verifierLevel, b.CheckBudget, b.Mock, findings)
		s.mu.Lock()
		byID := map[string]*finding{}
		for _, f := range b.Findings {
			byID[f.ID] = f
		}
		for _, m := range reVerdict.FindAllStringSubmatch(b.Verifier.text, -1) {
			if f := byID[m[1]]; f != nil {
				f.Verdict, f.Check = m[2], m[3]
			}
		}
		s.mu.Unlock()
		_ = os.WriteFile(filepath.Join(dir, "verificador.md"), []byte(b.Verifier.text), 0o644)
	}
	if b.Mode == "canon" && len(findings) > 0 {
		// Fuera del candado: el ensayo habla con canon. Cada pieza es de un solo hilo acá.
		s.mu.Lock()
		if ctx.Err() == nil {
			b.Phase = "ensayo"
		}
		s.mu.Unlock()
		rehearse(ctx, dir, findings, b.Mock, func(f *finding, piece, rehearsal string) {
			s.mu.Lock()
			defer s.mu.Unlock()
			if piece != "" {
				f.Piece = piece
			}
			if rehearsal != "" {
				f.Rehearsal = rehearsal
			}
		})
	}

	return s.finish(ctx, b, dir)
}

// finish cierra el barrido: lo conocido, el costo, el informe y barrido.json.
func (s *sweeper) finish(ctx context.Context, b *board, dir string) (string, error) {
	s.mu.Lock()
	if !b.Mock { // lo simulado no alimenta lo conocido
		remember(s.root, b.Mode, b.Findings)
	}
	b.Phase = "terminado"
	if ctx.Err() != nil {
		b.Phase = "cortado"
	}
	b.Cost = 0
	for _, a := range append(append([]*agent(nil), b.Agents...), b.allVerifiers()...) {
		b.Cost += a.Cost
	}
	b.Report = sweepReport(b)
	b.Ended = time.Now().Format(time.RFC3339)
	raw, _ := json.MarshalIndent(b, "", "  ")
	report := b.Report
	s.mu.Unlock()
	path := filepath.Join(dir, "informe.md")
	_ = os.WriteFile(filepath.Join(dir, "barrido.json"), raw, 0o644)
	return path, os.WriteFile(path, []byte(report), 0o644)
}

// work corre un agente y va dejando en el tablero lo que hace.
func (s *sweeper) runOne(ctx context.Context, a *agent, prompt, system string, tools []string, model, effort string, budget float64, mock bool, findings []*finding) {
	s.mu.Lock()
	a.Status, a.started = "trabajando", time.Now()
	s.mu.Unlock()
	onStep := func(kind, text string) {
		s.mu.Lock()
		defer s.mu.Unlock()
		text = truncate(text, 220)
		if kind == "tool" {
			a.Tools++
			a.Doing = text
		}
		a.Steps = append(a.Steps, step{At: time.Now().Format("15:04:05"), Kind: kind, Text: text})
		if len(a.Steps) > maxStepsShown {
			a.Steps = a.Steps[len(a.Steps)-maxStepsShown:]
		}
		a.Seconds = int(time.Since(a.started).Seconds())
	}
	onTokens := func(in int) { s.mu.Lock(); a.TokensIn += in; s.mu.Unlock() }
	var res agentResult
	var err error
	if mock {
		res, err = mockAgent(ctx, a.Topic, findings, onStep)
		if err == nil && findings == nil {
			switch system {
			case canonSystem, canonCorrectorSystem:
				res.Result = mockCanonPieces(a.Topic)
			case canonNotesSystem:
				res.Result = mockNotes(prompt)
			case canonIntegratorSystem:
				res.Result = "INTEGRACIÓN: ninguna"
			}
		}
	} else {
		res, err = runAgent(ctx, s.root, prompt, system, tools, model, effort, budget, onStep, onTokens)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	a.text, a.Cost, a.Turns = res.Result, res.Cost, res.Turns
	a.Seconds, a.Doing = int(time.Since(a.started).Seconds()), ""
	switch {
	case ctx.Err() != nil:
		a.Status = "cortado"
	case err != nil:
		a.Status, a.Err = "error", err.Error()
	default:
		a.Status = "listo"
	}
}

// parseFindings toma cada HALLAZGO y las líneas de lista que lo siguen (algunos agentes lo parten en viñetas).
func parseFindings(text string) []string {
	var out []string
	cur := ""
	flush := func() {
		if cur != "" {
			out = append(out, strings.TrimSpace(cur))
			cur = ""
		}
	}
	for _, line := range strings.Split(text, "\n") {
		t := strings.TrimSpace(line)
		switch {
		case reFindStart.MatchString(line):
			flush()
			cur = strings.TrimSpace(strings.TrimLeft(t, "-* "))
		case cur != "" && (strings.HasPrefix(t, "- ") || strings.HasPrefix(t, "Destino") || strings.HasPrefix(t, "COMANDO")):
			cur += " " + t
		case t == "": // una línea en blanco no corta: hay quien separa la viñeta del destino
		default:
			flush()
		}
	}
	flush()
	return out
}

type topicInfo struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	Reviewed string `json:"reviewed"`
}

// allTopics: los temas de knowledge/, de la revisión más vieja a la más nueva.
func allTopics(root string) []topicInfo {
	files, _ := filepath.Glob(filepath.Join(root, "knowledge", "*", "sources.json"))
	var all []topicInfo
	for _, f := range files {
		raw, err := os.ReadFile(f)
		if err != nil {
			continue
		}
		var meta struct {
			Title      string `json:"title"`
			ReviewedAt string `json:"reviewedAt"`
		}
		_ = json.Unmarshal(raw, &meta)
		all = append(all, topicInfo{filepath.Base(filepath.Dir(f)), meta.Title, meta.ReviewedAt})
	}
	sort.Slice(all, func(i, j int) bool { return all[i].Reviewed < all[j].Reviewed })
	return all
}

func oldestTopics(root string, n int) []string {
	var ids []string
	for i, t := range allTopics(root) {
		if i >= n {
			break
		}
		ids = append(ids, t.ID)
	}
	return ids
}

func knownPath(root, topic string) string {
	return filepath.Join(root, "sala", ".barridos", "conocidos", topic+".md")
}

// sweepBrief: lo que se busca, lo que dice hoy el tema y lo que ya se encontró y comprobó en barridos anteriores.
func sweepBrief(root, topic string) string {
	var b strings.Builder
	fmt.Fprintf(&b, "Tema: %s\nSe busca:\n", topic)
	for _, g := range goalText {
		b.WriteString("- " + g + "\n")
	}
	cmd := exec.Command("go", "run", "./cmd/knowledge", "read", topic)
	cmd.Dir = root
	if raw, err := cmd.Output(); err == nil {
		text := string(raw)
		if r := []rune(text); len(r) > maxBriefRunes {
			text = string(r[:maxBriefRunes]) + "\n…(recortado: el tema entero se lee con make knowledge-read ID=" + topic + ")"
		}
		b.WriteString("\nLo que dice hoy knowledge/" + topic + ":\n\n" + text)
	} else {
		b.WriteString("\n(No es un id de knowledge/: buscá con make knowledge-search Q='…' qué temas lo tocan.)")
	}
	if known, err := os.ReadFile(knownPath(root, topic)); err == nil && len(known) > 0 {
		b.WriteString("\n\nYA CONOCIDO (comprobado en barridos anteriores; no lo repitas):\n" + string(known))
	}
	return b.String()
}

// remember agrega a lo conocido de cada tema lo que el verificador confirmó.
func remember(root, mode string, findings []*finding) {
	byTopic := map[string][]string{}
	for _, f := range findings {
		if f.Verdict == "✓" {
			key := f.Topic
			if mode == "canon" {
				key = "canon-" + f.Topic
			}
			byTopic[key] = append(byTopic[key], "- "+time.Now().Format("2006-01-02")+" · "+f.Text)
		}
	}
	for topic, lines := range byTopic {
		path := knownPath(root, topic)
		_ = os.MkdirAll(filepath.Dir(path), 0o755)
		fh, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
		if err != nil {
			continue
		}
		_, _ = fh.WriteString(strings.Join(lines, "\n") + "\n")
		_ = fh.Close()
	}
}

func sweepReport(b *board) string {
	var r strings.Builder
	count := map[string]int{}
	for _, f := range b.Findings {
		count[f.Verdict]++
	}
	what := "hallazgo(s)"
	if b.Mode == "canon" {
		what = "pieza(s) de canon"
		fmt.Fprintf(&r, "\n# Barrido de canon · %s\n\n", b.ID)
		if b.SharedFiles > 0 {
			fmt.Fprintf(&r, "Archivos compartidos con otros temas: %d (notas reusadas de un barrido anterior: %d).\n\n", b.SharedFiles, b.ReusedNotes)
		}
	} else {
		fmt.Fprintf(&r, "\n# Barrido · %s\n\n", b.ID)
	}
	fmt.Fprintf(&r, "%d "+what+": %d ✓ · %d ✗ · %d — · %d sin veredicto. Costo: US$%.2f eq. (corre con el asiento; no se cobra aparte).\n\n",
		len(b.Findings), count["✓"], count["✗"], count["—"], count[""], b.Cost)
	r.WriteString("| agente | US$ eq. | pasos | s | hallazgos |\n|---|---|---|---|---|\n")
	for _, a := range append(append([]*agent(nil), b.Agents...), b.allVerifiers()...) {
		fmt.Fprintf(&r, "| %s%s | %.2f | %d | %d | %d |\n", a.Topic, map[bool]string{true: " ⚠"}[a.Err != ""], a.Cost, a.Turns, a.Seconds, a.Findings)
	}
	for _, f := range b.Findings {
		v := f.Verdict
		if v == "" {
			v = "sin veredicto"
		}
		fmt.Fprintf(&r, "\n**%s · %s · %s**\n%s\n", f.ID, f.Topic, v, f.Text)
		if f.Check != "" {
			fmt.Fprintf(&r, "> %s\n", f.Check)
		}
		if f.Rehearsal != "" {
			fmt.Fprintf(&r, "> ensayo en canon: %s\n", f.Rehearsal)
		}
		if f.Integration != "" {
			fmt.Fprintf(&r, "> integración: %s\n", f.Integration)
		}
		if f.Piece != "" {
			fmt.Fprintf(&r, "> pieza: %s\n", f.Piece)
		}
	}
	if b.Mode == "canon" {
		var ready []string
		for _, f := range b.Findings {
			if f.Verdict == "✓" && strings.HasPrefix(f.Rehearsal, "ok") && f.Integration == "" && f.Piece != "" {
				ready = append(ready, f.Piece)
			}
		}
		if len(ready) > 0 {
			fmt.Fprintf(&r, "\n## Listas para publicar (%d)\n\nNada se publicó. Para ensayarlas juntas y después publicarlas, en UNA revisión:\n\n"+
				"    make canon-write DRY=1 PIECE='%s'\n    make canon-write PIECE='%s' TITLE='canon: puesta al día desde la sala'\n",
				len(ready), strings.Join(ready, " "), strings.Join(ready, " "))
		}
	}
	return r.String()
}

type agentResult struct {
	Result string
	Cost   float64
	Turns  int
}

// runAgent corre un agente de una sesión larga con `claude -p` en stream-json, desde la raíz (carga el CLAUDE.md
// y sus guardas), y avisa cada herramienta que usa y cada cosa que dice.
func runAgent(ctx context.Context, root, prompt, system string, tools []string, model, effort string, budget float64,
	onStep func(kind, text string), onTokens func(int)) (agentResult, error) {
	tctx, cancel := context.WithTimeout(ctx, 30*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(tctx, "claude", "-p", prompt, "--output-format", "stream-json", "--verbose",
		"--max-budget-usd", fmt.Sprintf("%.2f", budget), "--model", model, "--effort", effort,
		"--append-system-prompt", system,
		"--allowedTools", strings.Join(tools, ","),
		"--disallowedTools", strings.Join(denied, ","),
		"--add-dir", filepath.Join(os.Getenv("HOME"), "Desktop", "CREDITOP", "github"),
		// Sin servidores MCP: cada sesión cargaba sus definiciones (~4.600 tokens) y el agente tiene bin/pg.
		"--strict-mcp-config")
	cmd.Dir = root
	cmd.Env = childEnv()
	out, err := cmd.StdoutPipe()
	if err != nil {
		return agentResult{}, err
	}
	if err := cmd.Start(); err != nil {
		return agentResult{}, fmt.Errorf("no pude lanzar claude: %w", err)
	}
	var res agentResult
	var failed string
	sc := bufio.NewScanner(out)
	sc.Buffer(make([]byte, 1<<20), 32<<20)
	for sc.Scan() {
		var ev struct {
			Type    string  `json:"type"`
			Subtype string  `json:"subtype"`
			Result  string  `json:"result"`
			Cost    float64 `json:"total_cost_usd"`
			Turns   int     `json:"num_turns"`
			IsError bool    `json:"is_error"`
			Message struct {
				Usage struct {
					In         int `json:"input_tokens"`
					CacheWrite int `json:"cache_creation_input_tokens"`
				} `json:"usage"`
				Content []struct {
					Type  string          `json:"type"`
					Text  string          `json:"text"`
					Name  string          `json:"name"`
					Input json.RawMessage `json:"input"`
				} `json:"content"`
			} `json:"message"`
		}
		if json.Unmarshal(sc.Bytes(), &ev) != nil {
			continue
		}
		switch ev.Type {
		case "assistant":
			onTokens(ev.Message.Usage.In + ev.Message.Usage.CacheWrite)
			for _, c := range ev.Message.Content {
				switch c.Type {
				case "text":
					if t := strings.TrimSpace(c.Text); t != "" {
						onStep("text", t)
					}
				case "tool_use":
					onStep("tool", describeTool(c.Name, c.Input))
				}
			}
		case "result":
			res = agentResult{Result: ev.Result, Cost: ev.Cost, Turns: ev.Turns}
			if ev.IsError {
				failed = "terminó con error: " + ev.Subtype
			}
		}
	}
	if err := cmd.Wait(); err != nil && failed == "" && res.Result == "" {
		failed = "claude -p: " + err.Error()
	}
	if failed != "" && res.Result == "" {
		return res, fmt.Errorf("%s", failed)
	}
	return res, nil
}

// describeTool: una línea legible de lo que hace una herramienta (el comando, el archivo o el patrón).
func describeTool(name string, input json.RawMessage) string {
	var in struct {
		Command  string `json:"command"`
		FilePath string `json:"file_path"`
		Pattern  string `json:"pattern"`
	}
	_ = json.Unmarshal(input, &in)
	switch {
	case in.Command != "":
		return in.Command
	case in.FilePath != "":
		return name + " " + in.FilePath
	case in.Pattern != "":
		return name + " " + in.Pattern
	}
	return name
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

// mockAgent simula un agente (o el verificador, si recibe hallazgos) con pasos espaciados, sin gastar modelo.
func mockAgent(ctx context.Context, topic string, findings []*finding, onStep func(kind, text string)) (agentResult, error) {
	pause := func(d time.Duration) bool {
		select {
		case <-ctx.Done():
			return false
		case <-time.After(d):
			return true
		}
	}
	steps := []string{"make knowledge-read ID=" + topic, "git -C ../github/legacy-backend grep -n estado origin/main",
		"git -C ../github/legacy-application show origin/main:app/Services/X.php", "bin/pg sql --target prod --query 'SELECT …'"}
	if findings != nil {
		steps = nil
		for _, f := range findings {
			steps = append(steps, "git -C ../github/legacy-backend grep -n … origin/main  # "+f.ID)
		}
	}
	for i, st := range steps {
		if !pause(time.Duration(700+300*(i%3)) * time.Millisecond) {
			return agentResult{}, ctx.Err()
		}
		onStep("tool", st)
	}
	if findings != nil {
		var b strings.Builder
		for i, f := range findings {
			mark := "✓"
			if i%3 == 1 { // con dos piezas por tema, una ✗: así el simulado pasa por el corrector
				mark = "✗"
			}
			fmt.Fprintf(&b, "VEREDICTO: %s | %s | git -C legacy-backend grep -n … origin/main | visto en main\n", f.ID, mark)
		}
		onStep("text", "Comprobé los hallazgos contra main.")
		return agentResult{Result: b.String(), Cost: 0.4, Turns: len(steps)}, nil
	}
	onStep("text", "Revisé el tema contra main.")
	return agentResult{Result: "Revisé el tema contra main.\n\n" +
		"HALLAZGO: contradicción | " + topic + ": el tema dice X y `Service.php:10` hace Y | " + topic + " | COMANDO: git -C legacy-backend grep -n Y origin/main\n" +
		"HALLAZGO: hueco | regla en dos partes:\n- `A.php:3` filtra por estado\n- `B.php:9` lo repite | " + topic + " | COMANDO: git -C legacy-backend grep -n estado origin/main\n\n" +
		"PREGUNTA: ¿esto pesa en prod?", Cost: 0.5, Turns: len(steps)}, nil
}

// allVerifiers: el verificador único (knowledge) o los de cada tema (canon).
func (b *board) allVerifiers() []*agent {
	if len(b.Verifiers) > 0 {
		out := append(append(append([]*agent(nil), b.Notes...), b.Verifiers...), b.Correctors...)
		if b.Integrator != nil {
			out = append(out, b.Integrator)
		}
		return out
	}
	if b.Verifier != nil {
		return []*agent{b.Verifier}
	}
	return nil
}
