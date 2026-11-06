package main

/* ask: una META en lenguaje natural, y Claude maneja la sesión en vivo hasta cumplirla. Lanza Claude Code en
 * modo no interactivo (`claude -p`) desde una carpeta neutra —sin el CLAUDE.md del repo, sus hooks ni los MCP:
 * más barato y enfocado— con permiso SOLO para este mismo binario y Read (para mirar capturas). Las
 * instrucciones del ciclo y sus reglas están en ask.md.
 *
 * Mientras corre muestra cada comando y lo que va pensando; lo que hace se ve en vivo en el editor. Si termina
 * con NECESITO: o CONFIRMAR:, pregunta acá y retoma la MISMA sesión con la respuesta.
 *
 * ⚠ Claude Code de consola necesita su propia sesión: la del Code tab de la app de escritorio no se hereda a un
 * proceso aparte. Una vez: `<claude> setup-token` (o `/login` adentro de claude) — ver claudeBinary().
 */

import (
	"bufio"
	_ "embed"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"syscall"
	"time"
)

//go:embed ask.md
var askInstructions string

// Los sitios de práctica (ahí se pueden inventar datos y dar consentimientos de prueba) los decide ESTA lista,
// no el modelo: por host:puerto exacto, o un sufijo que empieza con punto. Por defecto, Credidemo y los dominios
// .test; cualquier otro sitio —también una app propia en localhost— se trata como real. NAVEGADOR_PRACTICE la
// reemplaza (separada por comas).
func practiceList() []string {
	raw := os.Getenv("NAVEGADOR_PRACTICE")
	if raw == "" {
		raw = ".test"
	}
	var out []string
	for _, h := range strings.Split(raw, ",") {
		if h = strings.TrimSpace(h); h != "" {
			out = append(out, h)
		}
	}
	return out
}

func isPractice(rawURL string) bool {
	u, err := url.Parse(rawURL)
	if err != nil {
		return false
	}
	for _, h := range practiceList() {
		if strings.HasPrefix(h, ".") && strings.HasSuffix(u.Hostname(), h) || u.Host == h {
			return true
		}
	}
	return false
}

func ask(args []string) error {
	fs := flag.NewFlagSet("ask", flag.ExitOnError)
	start := fs.String("url", "", "abre la sesión en vivo en esta URL antes de empezar (si no, usa la que está abierta)")
	steps := fs.Int("pasos", 40, "cuántas acciones como mucho")
	model := fs.String("modelo", "", "el modelo de Claude (por defecto, el de tu Claude Code)")
	answer := fs.String("respuesta", "", "contestar sola a un NECESITO/CONFIRMAR con esto (sin preguntar)")
	mobile := fs.Bool("movil", false, "en un teléfono (Pixel 7) en vez de escritorio")
	guide := fs.Bool("guia", false, "enseñame: Claude no toca la página; marca qué hacer y la persona lo hace")
	noFlow := fs.Bool("sin-flujo", false, "no guardar la corrida como flujo aunque termine en LISTO")
	devFlag := fs.String("dispositivo", "", "movil o escritorio (lo usa la interfaz)")
	fs.Usage = func() {
		fmt.Fprintln(os.Stderr, `uso: bin/navegador ask [--url URL] [--pasos 40] [--modelo M] [--respuesta R] "<meta>"`)
		fs.PrintDefaults()
	}
	_ = fs.Parse(args)
	goal := strings.TrimSpace(strings.Join(fs.Args(), " "))
	if goal == "" {
		fs.Usage()
		os.Exit(2)
	}
	dev := parseDevice(*devFlag)
	if *mobile {
		dev = "mobile"
	}
	if *start != "" {
		args := []string{*start}
		if dev != "" {
			args = append([]string{"--" + dev}, args...)
		}
		if err := open(args); err != nil {
			return err
		}
		fmt.Println()
	} else if dev != "" {
		if err := call(http.MethodPost, "/api/live/device", map[string]string{"device": dev}, nil); err != nil {
			return err
		}
	}
	outcome, err := runAsk(askOpts{goal: goal, steps: *steps, model: *model, answer: *answer, guide: *guide, out: os.Stdout})
	if err != nil {
		return err
	}
	if path, err := writeReportInfo(outcome.reportInfo(goal, "ask")); err == nil {
		say(os.Stdout, "report", path, fmt.Sprintf("\nla corrida, como video: %s\n", path))
		// Lo que salió bien queda como flujo (navegador/flujos): se repite sin Claude o se enseña.
		if outcome.Final() == "LISTO" && !*noFlow && lastRunID != "" {
			var fl struct{ App, ID, Path string }
			if err := call(http.MethodPost, "/api/flows", map[string]string{"run": lastRunID, "name": goal}, &fl); err == nil {
				say(os.Stdout, "flow", fl.App+"/"+fl.ID, fmt.Sprintf("flujo guardado: %s\n", fl.Path))
			} else {
				say(os.Stdout, "note", "no se guardó como flujo: "+err.Error(), fmt.Sprintf("(no se guardó como flujo: %v)\n", err))
			}
		}
	} else {
		say(os.Stdout, "note", "no quedó corrida guardada: "+err.Error(), fmt.Sprintf("\n(no quedó corrida guardada: %v)\n", err))
	}
	say(os.Stdout, "", "", "el script de Playwright: bin/navegador script\n")
	return nil
}

// eventsMode lo prende la API cuando lanza ask desde la interfaz (NAVEGADOR_EVENTS=1): lo que va haciendo sale
// como una línea JSON por evento ({"k": tipo, "t": texto}) en vez de texto para la terminal, y la respuesta a
// un NECESITO/CONFIRMAR llega por stdin.
var eventsMode = os.Getenv("NAVEGADOR_EVENTS") == "1"

// say escribe un evento: para la interfaz, el tipo y el texto completo; para la terminal, human. Con kind
// vacío es sólo para la terminal.
func say(out io.Writer, kind, text, human string) {
	if !eventsMode {
		fmt.Fprint(out, human)
		return
	}
	if kind == "" {
		return
	}
	b, _ := json.Marshal(map[string]string{"k": kind, "t": text})
	fmt.Fprintf(out, "%s\n", b)
}

// askOpts es una corrida de ask: la meta y cómo se contesta un NECESITO/CONFIRMAR.
type askOpts struct {
	goal   string
	steps  int
	model  string
	answer string    // si no está vacía, se contesta sola UNA vez con esto (la usan las evals)
	guide  bool      // modo guía: Claude marca y la persona hace
	out    io.Writer // adónde va lo que va haciendo
}

// askOutcome es cómo terminó: la palabra de cada vuelta (LISTO, NO PUDE, NECESITO, CONFIRMAR) y lo que costó.
type askOutcome struct {
	Rounds  []string
	Text    string
	Turns   int
	Cost    float64
	Seconds float64
	Model   string
	Tokens  tokenUsage
}

// affirmative reconoce un sí a un CONFIRMAR.
// (Sin \b: en RE2 es sólo ASCII, y después de la «í» de «sí» no hay «límite de palabra».)
var affirmative = regexp.MustCompile(`(?i)^\s*(s[ií]|dale|ok|okay|yes|confirmo|hacelo|hazlo|adelante|de una)([^\pL]|$)`)

func normDev(d string) string {
	if d == "mobile" {
		return d
	}
	return "desktop"
}

func (o askOutcome) Final() string {
	if len(o.Rounds) == 0 {
		return ""
	}
	return o.Rounds[len(o.Rounds)-1]
}

// keyword saca la palabra con que empieza la respuesta final, aunque venga con adornos de Markdown
// («**CONFIRMAR:**», «> LISTO:», «# NO PUDE»).
func keyword(text string) string {
	head := strings.ToUpper(strings.TrimLeft(strings.TrimSpace(text), "*_#>` \t"))
	for _, k := range []string{"LISTO", "NO PUDE", "NECESITO", "CONFIRMAR"} {
		if strings.HasPrefix(head, k) {
			return k
		}
	}
	return "?"
}

// runAsk es el motor de ask: lanza Claude Code sobre la sesión en vivo que esté abierta y la maneja hasta
// cumplir la meta, preguntando (o contestando solo) cuando termina con NECESITO o CONFIRMAR.
func runAsk(o askOpts) (askOutcome, error) {
	var outcome askOutcome
	// Cada meta empieza con los pasos en cero: el script del final es SU camino, no el de la corrida anterior.
	_ = call(http.MethodDelete, "/api/live/steps", nil, nil)
	var st liveState
	if err := call(http.MethodGet, "/api/live/state", nil, &st); err != nil {
		return outcome, err
	}
	if !st.Active {
		return outcome, errors.New("no hay sesión en vivo: pasá --url o abrí una con `bin/navegador open`")
	}
	claude, err := claudeBinary()
	if err != nil {
		return outcome, err
	}
	self, err := os.Executable()
	if err != nil {
		return outcome, err
	}
	dir := filepath.Join(must(os.UserCacheDir()), "navegador", "ask")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return outcome, err
	}
	practice := strings.Join(practiceList(), ", ")
	system := strings.NewReplacer("{{NAV}}", self, "{{PASOS}}", fmt.Sprint(o.steps), "{{DIR}}", dir, "{{PRACTICA}}", practice).Replace(askInstructions)
	kind := "NO es un sitio de práctica: tratalo como REAL"
	if isPractice(st.URL) {
		kind = "es un sitio de práctica"
	}
	// HOY: sin la fecha, no se puede decir si un plazo ya pasó o si una página habla de otro año.
	mode := "automático: actuás vos; guardar y activar van solos, y sólo frenás con CONFIRMAR antes de algo irreversible (borrar, desactivar, pagar, enviar)"
	if o.guide {
		mode = "enseñame: NO tocás la página; marcás cada paso con point y la persona lo hace"
	}
	prompt := fmt.Sprintf("META: %s\n\nLa sesión en vivo está en %s (%s).\nSITIO: %s.\nDISPOSITIVO: %s.\nMODO: %s.\nHOY: %s.", o.goal, st.URL, st.Title, kind, deviceName[normDev(st.Device)], mode, time.Now().Format("2006-01-02"))
	base := []string{
		"-p", "--output-format", "stream-json", "--verbose",
		"--append-system-prompt", system,
		// Sólo el navegador y Read (las capturas): sin grep ni head, la regla de «sin tuberías» se cumple sola.
		"--allowedTools", "Bash(" + self + ":*)", "Bash(" + self + " *)", "Read",
		"--setting-sources", "user", "--strict-mcp-config",
	}
	if o.model != "" {
		base = append(base, "--model", o.model)
	}

	if !eventsMode {
		ttyState = sttySave()
	}
	say(o.out, "site", kind, fmt.Sprintf("meta: %s\nsitio: %s\n\n", o.goal, kind))
	session := ""
	autoAnswered := false
	repaired := false
	for {
		argv := append([]string{}, base...)
		if session != "" {
			argv = append(argv, "--resume", session)
		}
		argv = append(argv, prompt)
		res, err := runClaude(claude, dir, argv, self, o.steps, o.out, o.guide)
		_ = os.Remove(approvalFile()) // un sí vale para la vuelta en que se dio, no para las siguientes
		if err != nil {
			return outcome, err
		}
		session = res.session
		// Sin la palabra clave, ask no sabe si tiene que preguntar (en una compra, Claude frenó bien pero empezó con
		// «No pagué: …» y la pregunta nunca llegó). Se le pide UNA vez que lo reescriba, en la misma sesión.
		if keyword(res.text) == "?" && !repaired {
			repaired = true
			say(o.out, "note", "la respuesta no empezó con LISTO, NO PUDE, NECESITO ni CONFIRMAR: le pido que la reescriba",
				"\n  (la respuesta no empezó con LISTO, NO PUDE, NECESITO ni CONFIRMAR: le pido que la reescriba)\n")
			outcome.Turns += res.turns
			outcome.Cost += res.cost
			outcome.Seconds += res.seconds
			outcome.Tokens.add(res.tokens)
			prompt = "Tu último mensaje no empezó con LISTO:, NO PUDE:, NECESITO: ni CONFIRMAR:. Reescribilo igual, pero empezando con la palabra que corresponde (si falta algo que sólo la persona puede dar o decidir, es NECESITO: o CONFIRMAR:). No hagas nada más en la página."
			continue
		}
		outcome.Rounds = append(outcome.Rounds, keyword(res.text))
		outcome.Text = res.text
		outcome.Turns += res.turns
		outcome.Cost += res.cost
		outcome.Seconds += res.seconds
		outcome.Tokens.add(res.tokens)
		if res.model != "" {
			outcome.Model = res.model
		}
		say(o.out, "result", res.text, fmt.Sprintf("\n%s\n", res.text))
		t := res.tokens
		stats := fmt.Sprintf("%d turnos · %.1f s · US$ %.4f · %s · tokens: %d entrada, %d de caché, %d a caché, %d salida",
			res.turns, res.seconds, res.cost, res.model, t.Input, t.CacheRead, t.CacheCreate, t.Output)
		say(o.out, "stats", stats, "\n("+stats+")\n")
		if k := outcome.Final(); k != "NECESITO" && k != "CONFIRMAR" {
			break
		}
		var reply string
		if o.answer != "" {
			if autoAnswered {
				break // ya contestó sola una vez: no se queda en un ida y vuelta
			}
			reply, autoAnswered = o.answer, true
			say(o.out, "answer", reply, fmt.Sprintf("\n  › respuesta automática: %s\n\n", reply))
		} else {
			say(o.out, "ask", outcome.Final(), "")
			reply = askUser("\n› tu respuesta (escribí y Enter; vacío para terminar): ")
			if reply == "" {
				say(o.out, "note", "sin respuesta: termino acá, sin hacer lo que estaba por confirmar",
					"  (sin respuesta: termino acá, sin hacer lo que estaba por confirmar)\n")
				break
			}
			say(o.out, "answer", reply, fmt.Sprintf("  › respuesta: %s\n\n", reply))
		}
		// Un sí a un CONFIRMAR habilita, sólo para la vuelta que sigue, los clics que guardan en un sitio real.
		if outcome.Final() == "CONFIRMAR" && affirmative.MatchString(reply) {
			_ = os.MkdirAll(filepath.Dir(approvalFile()), 0o755)
			_ = os.WriteFile(approvalFile(), []byte(reply), 0o600)
		}
		prompt = reply
	}
	return outcome, nil
}

type claudeResult struct {
	text    string
	session string
	turns   int
	cost    float64
	seconds float64
	model   string
	tokens  tokenUsage
}

// tokenUsage son los tokens de una corrida: sin esto, un costo que se duplica no tiene explicación (¿más
// texto, otro modelo, la caché fría?).
type tokenUsage struct {
	Input       int `json:"entrada"`
	CacheRead   int `json:"cache_leida"`
	CacheCreate int `json:"cache_escrita"`
	Output      int `json:"salida"`
}

func (t *tokenUsage) add(o tokenUsage) {
	t.Input += o.Input
	t.CacheRead += o.CacheRead
	t.CacheCreate += o.CacheCreate
	t.Output += o.Output
}

// runClaude corre una vuelta de claude -p y va mostrando lo que hace; corta si se pasa de acciones.
func runClaude(claude, dir string, argv []string, self string, maxActions int, out io.Writer, guide bool) (claudeResult, error) {
	cmd := exec.Command(claude, argv...)
	cmd.Dir = dir
	// NAVEGADOR_ASK: el CLI sabe que lo maneja Claude (y frena lo que guarda sin un sí); NAVEGADOR_GUIDE: no actúa.
	cmd.Env = append(childEnv(), "NAVEGADOR_ASK=1")
	if guide {
		cmd.Env = append(cmd.Env, "NAVEGADOR_GUIDE=1")
	}
	// En una sesión de terminal PROPIA: Claude Code es una app de terminal y, aun sin stdin, puede abrir /dev/tty
	// y dejarla sin eco; entonces la respuesta a un NECESITO/CONFIRMAR no se ve ni se lee bien.
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	// Ni la salida de errores le llega como terminal: pasa por una tubería y se reimprime. Así el proceso hijo
	// no tiene NINGÚN descriptor de la terminal de la persona para cambiarle el modo.
	errPipe, err := cmd.StderrPipe()
	if err != nil {
		return claudeResult{}, err
	}
	go func() { _, _ = io.Copy(os.Stderr, errPipe) }()
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return claudeResult{}, err
	}
	if err := cmd.Start(); err != nil {
		return claudeResult{}, fmt.Errorf("no pude lanzar Claude Code (%s): %w", claude, err)
	}
	// Por estar en su propia sesión, un Ctrl-C (o el «Frenar» de la interfaz) no le llega solo: se le pasa.
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	finished := make(chan struct{})
	defer func() { signal.Stop(stop); close(finished) }()
	go func() {
		select {
		case <-stop:
			_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGTERM)
			fmt.Fprintln(os.Stderr, "frenado: Claude Code terminó sin cerrar la meta")
			os.Exit(130)
		case <-finished:
		}
	}()
	var res claudeResult
	actions := 0
	sc := bufio.NewScanner(stdout)
	sc.Buffer(make([]byte, 1<<20), 16<<20)
	for sc.Scan() {
		var ev struct {
			Type      string  `json:"type"`
			Subtype   string  `json:"subtype"`
			SessionID string  `json:"session_id"`
			Result    string  `json:"result"`
			IsError   bool    `json:"is_error"`
			NumTurns  int     `json:"num_turns"`
			Cost      float64 `json:"total_cost_usd"`
			Duration  float64 `json:"duration_ms"`
			Model     string  `json:"model"`
			Usage     struct {
				Input       int `json:"input_tokens"`
				CacheRead   int `json:"cache_read_input_tokens"`
				CacheCreate int `json:"cache_creation_input_tokens"`
				Output      int `json:"output_tokens"`
			} `json:"usage"`
			Message struct {
				Content []struct {
					Type    string          `json:"type"`
					Text    string          `json:"text"`
					Name    string          `json:"name"`
					IsError bool            `json:"is_error"`
					Result  json.RawMessage `json:"content"`
					Input   struct {
						Command  string `json:"command"`
						FilePath string `json:"file_path"`
					} `json:"input"`
				} `json:"content"`
			} `json:"message"`
		}
		if json.Unmarshal(sc.Bytes(), &ev) != nil {
			continue
		}
		if ev.SessionID != "" {
			res.session = ev.SessionID
		}
		if ev.Type == "system" && ev.Model != "" {
			res.model = ev.Model
		}
		switch ev.Type {
		case "assistant":
			for _, c := range ev.Message.Content {
				switch {
				case c.Type == "text" && strings.TrimSpace(c.Text) != "":
					say(out, "think", strings.TrimSpace(c.Text), fmt.Sprintf("  · %s\n", oneLine(c.Text, 160)))
					// Es el «por qué» del próximo paso: el subtítulo del video de la corrida.
					_ = call(http.MethodPost, "/api/live/narrate", map[string]string{"text": c.Text}, nil)
				case c.Type == "tool_use" && c.Name == "Bash":
					command := strings.ReplaceAll(c.Input.Command, self, "navegador")
					say(out, "act", command, fmt.Sprintf("  → %s\n", oneLine(command, 160)))
					if isAction(command) {
						actions++
					}
				case c.Type == "tool_use" && c.Name == "Read":
					say(out, "look", filepath.Base(c.Input.FilePath), fmt.Sprintf("  👁 mira %s\n", filepath.Base(c.Input.FilePath)))
				}
			}
			if actions > maxActions {
				_ = cmd.Process.Kill()
				_ = cmd.Wait()
				res.text = fmt.Sprintf("NO PUDE: se pasó de %d acciones sin terminar (cortado por el límite).", maxActions)
				return res, nil
			}
		case "user":
			// Lo que devolvieron las herramientas: sólo se muestra lo que falló o se negó (un comando con una
			// expansión de la shell, por ejemplo), que si no pasa sin que se vea.
			for _, c := range ev.Message.Content {
				if c.Type == "tool_result" && c.IsError {
					msg := strings.ReplaceAll(toolText(c.Result), self, "navegador")
					say(out, "fail", msg, fmt.Sprintf("    ✗ %s\n", oneLine(msg, 160)))
				}
			}
		case "result":
			res.text = ev.Result
			res.turns = ev.NumTurns
			res.cost = ev.Cost
			res.seconds = ev.Duration / 1000
			res.tokens = tokenUsage{Input: ev.Usage.Input, CacheRead: ev.Usage.CacheRead, CacheCreate: ev.Usage.CacheCreate, Output: ev.Usage.Output}
			if ev.IsError && strings.Contains(strings.ToLower(ev.Result), "not logged in") {
				_ = cmd.Wait()
				return res, errors.New(loginHelp(claude))
			}
		}
	}
	_ = cmd.Wait()
	if res.text == "" {
		return res, errors.New("Claude Code terminó sin contestar")
	}
	return res, nil
}

// isAction: los comandos que cambian algo en la página cuentan para el límite; mirar no.
func isAction(command string) bool {
	fields := strings.Fields(command)
	if len(fields) < 2 {
		return false
	}
	switch fields[1] {
	case "look", "text", "steps", "script", "shot", "sites", "wait", "read", "value", "cambios":
		return false
	}
	return true
}

// childEnv es el entorno de esta terminal SIN las variables de una sesión de Claude Code anfitriona (si ask se
// corre desde adentro de una): con ellas, el proceso hijo se creería parte de esa sesión y fallaría la
// autenticación. La sesión propia (CLAUDE_CODE_OAUTH_TOKEN o ANTHROPIC_API_KEY) sí pasa.
func childEnv() []string {
	var env []string
	for _, kv := range os.Environ() {
		k := kv[:strings.IndexByte(kv, '=')]
		host := strings.HasPrefix(k, "CLAUDE_CODE_") || k == "CLAUDECODE" || k == "CLAUDE_AGENT_SDK_VERSION" || k == "ANTHROPIC_BASE_URL"
		if host && k != "CLAUDE_CODE_OAUTH_TOKEN" {
			continue
		}
		env = append(env, kv)
	}
	return env
}

// claudeBinary: NAVEGADOR_CLAUDE, `claude` en el PATH o el Claude Code que trae la app de escritorio.
func claudeBinary() (string, error) {
	if p := os.Getenv("NAVEGADOR_CLAUDE"); p != "" {
		return p, nil
	}
	if p, err := exec.LookPath("claude"); err == nil {
		return p, nil
	}
	home, _ := os.UserHomeDir()
	found, _ := filepath.Glob(filepath.Join(home, ".config", "Claude", "claude-code", "*", "claude"))
	if len(found) > 0 {
		sort.Slice(found, func(i, j int) bool { return versionLess(found[i], found[j]) })
		return found[len(found)-1], nil
	}
	return "", errors.New("no encuentro Claude Code: instalalo o indicá el binario con NAVEGADOR_CLAUDE")
}

func versionLess(a, b string) bool {
	pa := strings.Split(filepath.Base(filepath.Dir(a)), ".")
	pb := strings.Split(filepath.Base(filepath.Dir(b)), ".")
	for i := 0; i < len(pa) && i < len(pb); i++ {
		if pa[i] != pb[i] {
			var x, y int
			fmt.Sscan(pa[i], &x)
			fmt.Sscan(pb[i], &y)
			return x < y
		}
	}
	return len(pa) < len(pb)
}

func loginHelp(claude string) string {
	if os.Getenv("CLAUDE_CODE_OAUTH_TOKEN") == "" && os.Getenv("ANTHROPIC_API_KEY") == "" {
		return `Claude Code de consola no tiene sesión: CLAUDE_CODE_OAUTH_TOKEN no está exportada en ESTA terminal.
setup-token sólo muestra el token; hay que exportarlo. En tu ~/.zshrc:
  export CLAUDE_CODE_OAUTH_TOKEN=<el token>
y después: source ~/.zshrc (o una terminal nueva).`
	}
	return fmt.Sprintf(`Claude Code de consola rechaza la sesión aunque CLAUDE_CODE_OAUTH_TOKEN está exportada: puede estar
vencida o revocada (la del Code tab de la app no se hereda).
Una sola vez, en tu terminal:
  %s setup-token
y exportá el token que te da en tu ~/.zshrc:
  export CLAUDE_CODE_OAUTH_TOKEN=…
(o entrá con %s y escribí /login)`, claude, claude)
}

func oneLine(s string, n int) string {
	s = strings.Join(strings.Fields(s), " ")
	if r := []rune(s); len(r) > n {
		return string(r[:n-1]) + "…"
	}
	return s
}

func must[T any](v T, err error) T {
	if err != nil {
		panic(err)
	}
	return v
}

// toolText saca el texto de un tool_result, que llega como string o como lista de bloques.
func toolText(raw json.RawMessage) string {
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return s
	}
	var blocks []struct {
		Text string `json:"text"`
	}
	if json.Unmarshal(raw, &blocks) == nil {
		parts := []string{}
		for _, b := range blocks {
			parts = append(parts, b.Text)
		}
		return strings.Join(parts, " ")
	}
	return string(raw)
}

// ── la respuesta de la persona ──

// stdinReader es uno solo para toda la corrida: un bufio nuevo por pregunta perdería lo que el anterior ya leyó.
var stdinReader = bufio.NewReader(os.Stdin)

// ttyState es el modo de la terminal al arrancar (stty -g), para restaurarlo antes de preguntar.
var ttyState string

func sttySave() string {
	tty, err := os.Open("/dev/tty")
	if err != nil {
		return ""
	}
	defer tty.Close()
	cmd := exec.Command("stty", "-g")
	cmd.Stdin = tty
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

// askUser pregunta en la terminal y lee UNA línea escrita DESPUÉS de la pregunta: restaura el modo de la
// terminal (por si algo lo tocó), descarta lo que se tecleó mientras Claude trabajaba (un Enter suelto contaba
// como respuesta vacía) y lee de /dev/tty. Sin terminal (una tubería), lee de stdin.
func askUser(prompt string) string {
	if eventsMode { // la interfaz contesta por stdin, una línea
		line, _ := stdinReader.ReadString('\n')
		return strings.TrimSpace(line)
	}
	tty, err := os.OpenFile("/dev/tty", os.O_RDWR, 0)
	if err != nil {
		fmt.Print(prompt)
		line, _ := bufio.NewReader(os.Stdin).ReadString('\n')
		return strings.TrimSpace(line)
	}
	defer tty.Close()
	if ttyState != "" {
		restore := exec.Command("stty", ttyState)
		restore.Stdin = tty
		_ = restore.Run()
	}
	_, _, _ = syscall.Syscall(syscall.SYS_IOCTL, tty.Fd(), 0x540B, uintptr(syscall.TCIFLUSH)) // TCFLSH (Linux)
	fmt.Fprint(tty, prompt)
	line, _ := bufio.NewReader(tty).ReadString('\n')
	return strings.TrimSpace(line)
}

// reportInfo es lo que va al run.json de la corrida (la lista de corridas de la interfaz lo muestra).
func (o askOutcome) reportInfo(goal, source string) map[string]any {
	return map[string]any{
		"meta": goal, "resultado": o.Text, "palabra": o.Final(), "vueltas": o.Rounds, "usd": o.Cost, "turnos": o.Turns,
		"seg": o.Seconds, "modelo": o.Model, "origen": source,
		"tokens": map[string]int{"entrada": o.Tokens.Input, "cache_leida": o.Tokens.CacheRead, "cache_escrita": o.Tokens.CacheCreate, "salida": o.Tokens.Output},
	}
}
