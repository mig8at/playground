package main

/* ask: una META en lenguaje natural, y Claude maneja la sesión en vivo hasta cumplirla. Lanza Claude Code en
 * modo no interactivo (`claude -p`) desde una carpeta neutra —sin el CLAUDE.md del repo, sus hooks ni los MCP:
 * más barato y enfocado— con permiso SOLO para este mismo binario, Read (para mirar capturas) y grep/head. Las
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
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
)

//go:embed ask.md
var askInstructions string

// Los sitios de práctica: ahí se pueden inventar datos de prueba.
const practiceHosts = "127.0.0.1, localhost y los dominios .test"

func ask(args []string) error {
	fs := flag.NewFlagSet("ask", flag.ExitOnError)
	start := fs.String("url", "", "abre la sesión en vivo en esta URL antes de empezar (si no, usa la que está abierta)")
	steps := fs.Int("pasos", 40, "cuántas acciones como mucho")
	model := fs.String("modelo", "", "el modelo de Claude (por defecto, el de tu Claude Code)")
	fs.Usage = func() {
		fmt.Fprintln(os.Stderr, `uso: bin/navegador ask [--url URL] [--pasos 40] [--modelo M] "<meta>"`)
		fs.PrintDefaults()
	}
	_ = fs.Parse(args)
	goal := strings.TrimSpace(strings.Join(fs.Args(), " "))
	if goal == "" {
		fs.Usage()
		os.Exit(2)
	}

	// Cada meta empieza con los pasos en cero: el script del final es SU camino, no el de la corrida anterior.
	// Se limpia antes de navegar, así el goto a --url queda como primer paso.
	_ = call(http.MethodDelete, "/api/live/steps", nil, nil)
	if *start != "" {
		if err := open([]string{*start}); err != nil {
			return err
		}
		fmt.Println()
	}
	var st liveState
	if err := call(http.MethodGet, "/api/live/state", nil, &st); err != nil {
		return err
	}
	if !st.Active {
		return errors.New("no hay sesión en vivo: pasá --url o abrí una con `bin/navegador open`")
	}

	claude, err := claudeBinary()
	if err != nil {
		return err
	}
	self, err := os.Executable()
	if err != nil {
		return err
	}
	dir := filepath.Join(must(os.UserCacheDir()), "navegador", "ask")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	system := strings.NewReplacer("{{NAV}}", self, "{{PASOS}}", fmt.Sprint(*steps), "{{DIR}}", dir, "{{PRACTICA}}", practiceHosts).Replace(askInstructions)
	prompt := fmt.Sprintf("META: %s\n\nLa sesión en vivo está en %s (%s).", goal, st.URL, st.Title)

	base := []string{
		"-p", "--output-format", "stream-json", "--verbose",
		"--append-system-prompt", system,
		"--allowedTools", "Bash(" + self + ":*)", "Bash(" + self + " *)", "Read", "Bash(grep:*)", "Bash(head:*)",
		"--setting-sources", "user", "--strict-mcp-config",
	}
	if *model != "" {
		base = append(base, "--model", *model)
	}

	fmt.Printf("meta: %s\n\n", goal)
	session := ""
	for round := 0; ; round++ {
		argv := append([]string{}, base...)
		if session != "" {
			argv = append(argv, "--resume", session)
		}
		argv = append(argv, prompt)
		res, err := runClaude(claude, dir, argv, self, *steps)
		if err != nil {
			return err
		}
		session = res.session
		fmt.Printf("\n%s\n", res.text)
		fmt.Printf("\n(%d turnos · %.1f s · US$ %.4f)\n", res.turns, res.seconds, res.cost)
		head := strings.ToUpper(strings.TrimSpace(res.text))
		if !strings.HasPrefix(head, "NECESITO:") && !strings.HasPrefix(head, "CONFIRMAR:") {
			break
		}
		fmt.Print("\n› tu respuesta (vacío para terminar): ")
		answer, _ := bufio.NewReader(os.Stdin).ReadString('\n')
		answer = strings.TrimSpace(answer)
		if answer == "" {
			break
		}
		prompt = answer
	}
	fmt.Println("\nlos pasos: bin/navegador steps · como script de Playwright: bin/navegador script")
	return nil
}

type claudeResult struct {
	text    string
	session string
	turns   int
	cost    float64
	seconds float64
}

// runClaude corre una vuelta de claude -p y va mostrando lo que hace; corta si se pasa de acciones.
func runClaude(claude, dir string, argv []string, self string, maxActions int) (claudeResult, error) {
	cmd := exec.Command(claude, argv...)
	cmd.Dir = dir
	cmd.Env = childEnv()
	cmd.Stderr = os.Stderr
	out, err := cmd.StdoutPipe()
	if err != nil {
		return claudeResult{}, err
	}
	if err := cmd.Start(); err != nil {
		return claudeResult{}, fmt.Errorf("no pude lanzar Claude Code (%s): %w", claude, err)
	}
	var res claudeResult
	actions := 0
	sc := bufio.NewScanner(out)
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
			Message   struct {
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
		switch ev.Type {
		case "assistant":
			for _, c := range ev.Message.Content {
				switch {
				case c.Type == "text" && strings.TrimSpace(c.Text) != "":
					fmt.Printf("  · %s\n", oneLine(c.Text, 160))
				case c.Type == "tool_use" && c.Name == "Bash":
					command := strings.ReplaceAll(c.Input.Command, self, "navegador")
					fmt.Printf("  → %s\n", oneLine(command, 160))
					if isAction(command) {
						actions++
					}
				case c.Type == "tool_use" && c.Name == "Read":
					fmt.Printf("  👁 mira %s\n", filepath.Base(c.Input.FilePath))
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
					fmt.Printf("    ✗ %s\n", oneLine(strings.ReplaceAll(toolText(c.Result), self, "navegador"), 160))
				}
			}
		case "result":
			res.text = ev.Result
			res.turns = ev.NumTurns
			res.cost = ev.Cost
			res.seconds = ev.Duration / 1000
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
	case "look", "text", "steps", "script", "shot", "sites", "wait":
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
