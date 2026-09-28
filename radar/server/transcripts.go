package main

/* Las transcripciones de Claude Code de ESTE playground, leídas como llamadas a herramientas.
 *
 * Claude Code guarda cada sesión en `~/.claude/projects/<carpeta>/<sesión>.jsonl`, y la carpeta es la ruta
 * donde arrancó con `/` cambiada por `-`. Una sesión que arranca en `harness/` cae en `…-playground-harness`,
 * así que «este playground» es la carpeta de la raíz MÁS las que empiezan con su nombre y un guion.
 *
 * De cada línea sólo interesa lo que la sesión HIZO (`tool_use`) y cómo le fue (`tool_result`): el texto de
 * las respuestas no se lee. */

import (
	"bufio"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"creditop/playground/lib/shell"
)

// Call es una llamada a una herramienta y cómo terminó.
type Call struct {
	Session string    `json:"session"`
	Time    time.Time `json:"time"`
	Tool    string    `json:"tool"`
	// Keys son las herramientas del playground que la llamada usó: `make tareas`, `git commit`,
	// `skill harness-local`… Un comando de Bash con `&&` usa varias.
	Keys    []string `json:"keys"`
	Command string   `json:"command,omitempty"` // cortado y sin secretos
	Outcome string   `json:"outcome"`           // ok · denied · rejected · blocked · error
	Hook    string   `json:"hook,omitempty"`    // el hook que la frenó, si fue eso
	// Culprit: de las Keys, las que causaron la fricción. Un comando de cinco tramos donde uno pidió
	// aprobación no es fricción de los cinco.
	Culprit []string `json:"culprit,omitempty"`
}

// Session es una transcripción: de dónde se lanzó y qué hizo.
type Session struct {
	ID         string    `json:"id"`
	Entrypoint string    `json:"entrypoint"`
	Start      time.Time `json:"start"`
	// Human: alguien escribió en la sesión (`turnOrigin: human`). Las corridas automáticas —`claude -p`, un
	// banco de pruebas— heredan el `entrypoint` de la app que las lanzó, así que ése no las distingue.
	Human bool   `json:"human"`
	Calls []Call `json:"calls"`
}

// Outcomes, en el orden en que se chequean contra el texto del resultado.
const (
	OutcomeOK       = "ok"
	OutcomeDenied   = "denied"   // pidió aprobación y no la tuvo (modo no interactivo o permiso negado)
	OutcomeRejected = "rejected" // Miguel dijo que no
	OutcomeBlocked  = "blocked"  // lo frenó un hook
	OutcomeError    = "error"
)

var (
	blockedBy  = regexp.MustCompile(`Bloqueado por el hook ([a-z][a-z-]*)`)
	approvalOf = regexp.MustCompile(`requires approval: ([^\n]+)`)
	// readOnly son las lecturas que suelen acompañar al tramo que un hook frenó: no son el motivo.
	readOnly = map[string]bool{"grep": true, "head": true, "tail": true, "cat": true, "ls": true, "sed": true, "wc": true,
		"git status": true, "git log": true, "git diff": true, "git show": true, "git grep": true, "cut": true, "sort": true}
	secrets = []*regexp.Regexp{
		regexp.MustCompile(`\b(glc_|ghp_|gho_|github_pat_|xox[abp]-|sk-|AKIA)[A-Za-z0-9_\-]{8,}`),
		regexp.MustCompile(`(?i)\b(password|passwd|token|secret|api[_-]?key)=\S+`),
		regexp.MustCompile(`(?i)Bearer\s+\S+`),
	}
	// noise son los programas que no son herramientas: armar el comando, no usarlo.
	noise = map[string]bool{"cd": true, "echo": true, "printf": true, "sleep": true, "true": true, "false": true,
		"do": true, "done": true, "then": true, "else": true, "fi": true, "for": true, "while": true, "if": true,
		"export": true, "set": true, "local": true, "[": true, "{": true, "}": true, "(": true, ")": true, "S": true}
	// makeFlagsWithValue son los flags de `make` que se comen el token siguiente.
	makeFlagsWithValue = map[string]bool{"-C": true, "-f": true, "-j": true, "-I": true, "-o": true, "-W": true}
)

// Redact corta el comando y le saca lo que parezca una credencial.
func Redact(cmd string, max int) string {
	for _, re := range secrets {
		cmd = re.ReplaceAllStringFunc(cmd, func(m string) string {
			if i := strings.IndexAny(m, "= "); i >= 0 {
				return m[:i+1] + "‹secreto›"
			}
			return "‹secreto›"
		})
	}
	cmd = strings.Join(strings.Fields(cmd), " ")
	if r := []rune(cmd); len(r) > max {
		cmd = string(r[:max]) + "…"
	}
	return cmd
}

// BashKeys: las herramientas que usa un comando de Bash, tramo por tramo, con el MISMO parser que los hooks.
func BashKeys(cmd string) []string {
	var keys []string
	seen := map[string]bool{}
	for _, seg := range shell.Segments(cmd) {
		toks := shell.Program(seg)
		if len(toks) == 0 {
			continue
		}
		prog := filepath.Base(toks[0])
		if noise[prog] || !isCommand(toks[0]) {
			continue
		}
		key := prog
		switch prog {
		case "make":
			t, ok := makeTarget(toks[1:])
			if !ok {
				continue // `make` seguido de algo que no es un target: texto partido, no una llamada
			}
			if t != "" {
				key = "make " + t
			}
		case "git", "go", "gh", "npm", "pnpm", "docker", "claude":
			if sub := firstWord(toks[1:]); sub != "" {
				key = prog + " " + sub
			}
		case "pg":
			if sub := firstWord(toks[1:]); sub != "" {
				key = "pg " + sub
			}
		}
		if !seen[key] {
			seen[key] = true
			keys = append(keys, key)
		}
	}
	return keys
}

// known son los programas de las herramientas, aunque el PATH de quien corre radar no los tenga.
var known = map[string]bool{"make": true, "git": true, "go": true, "gh": true, "npm": true, "pnpm": true, "docker": true,
	"claude": true, "pg": true, "node": true, "python3": true, "curl": true}

var (
	inPath      = map[string]bool{}
	commandWord = regexp.MustCompile(`^[A-Za-z0-9_./+-]+$`)
)

/* isCommand: si la primera palabra de un tramo es un programa de verdad. El parser de los hooks parte en
 * cada salto de línea aunque esté entre comillas —para frenar alcanza—, así que el cuerpo de un
 * `python3 -c "…"` sale como tramos (`import`, `print(…`). Cuenta lo conocido, lo que tiene ruta
 * (`bin/pg`, `./x`) y lo que está en el PATH; lo demás es código, no una herramienta. */
func isCommand(word string) bool {
	if !commandWord.MatchString(word) {
		return false
	}
	name := filepath.Base(word)
	if known[name] || strings.Contains(word, "/") {
		return true
	}
	if ok, hit := inPath[name]; hit {
		return ok
	}
	_, err := exec.LookPath(name)
	inPath[name] = err == nil
	return err == nil
}

// makeTarget: el primer target de `make`, salteando flags (y el valor de los que llevan uno), VAR=valor y
// redirecciones. ok=false si lo que sigue no tiene forma de target: `make` pelado (el catálogo) es ("", true).
func makeTarget(args []string) (string, bool) {
	for i := 0; i < len(args); i++ {
		a := args[i]
		switch {
		case makeFlagsWithValue[a]:
			i++
		case strings.HasPrefix(a, "-"), strings.Contains(a, "="), strings.ContainsAny(a, "<>&|"):
			// flags, VAR=valor y redirecciones (`2>/dev/null`): nada de eso es un target
		case targetName.MatchString(a):
			return a, true
		default:
			return "", false // un patrón de grep partido en `|` (`[a-z-]+`), una variable (`$c`): no es un target
		}
	}
	return "", true
}

var targetName = regexp.MustCompile(`^[a-z][a-zA-Z0-9_-]*$`)

// firstWord: el subcomando, salteando opciones globales (`git -C x log` → `log`).
func firstWord(args []string) string {
	for i := 0; i < len(args); i++ {
		a := args[i]
		if a == "-C" || a == "-c" {
			i++
			continue
		}
		if !strings.HasPrefix(a, "-") {
			return a
		}
	}
	return ""
}

// outcomeOf: cómo terminó una llamada, según el texto de su resultado.
// ⚠ Sólo un resultado con ERROR es fricción: un comando que imprime «Bloqueado por el hook» como salida
// (una prueba del propio hook) terminó bien.
func outcomeOf(text string, isError bool) (string, string) {
	if !isError {
		return OutcomeOK, ""
	}
	switch {
	case strings.Contains(text, "requires approval"):
		return OutcomeDenied, ""
	case strings.Contains(text, "doesn't want to proceed"):
		return OutcomeRejected, ""
	case strings.Contains(text, "Bloqueado por el hook"):
		hook := ""
		if m := blockedBy.FindStringSubmatch(text); m != nil {
			hook = m[1]
		}
		return OutcomeBlocked, hook
	}
	return OutcomeError, ""
}

// culprit: qué tramo causó la fricción. Un pedido de aprobación lo dice; un hook frena por lo que no es
// una lectura; de lo demás no se sabe, y quedan todas.
func culprit(c Call, text string) []string {
	switch c.Outcome {
	case OutcomeOK:
		return nil
	case OutcomeDenied:
		if m := approvalOf.FindStringSubmatch(text); m != nil {
			if keys := BashKeys(m[1]); len(keys) > 0 {
				return keys
			}
		}
	case OutcomeBlocked:
		var keys []string
		for _, k := range c.Keys {
			if !readOnly[k] {
				keys = append(keys, k)
			}
		}
		if len(keys) > 0 {
			return keys
		}
	}
	return c.Keys
}

// resultText junta el contenido de un tool_result, que puede venir como texto o como lista de bloques.
func resultText(raw json.RawMessage) string {
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return s
	}
	var blocks []struct {
		Text string `json:"text"`
	}
	if json.Unmarshal(raw, &blocks) == nil {
		var b strings.Builder
		for _, x := range blocks {
			b.WriteString(x.Text)
		}
		return b.String()
	}
	return string(raw)
}

// ReadSession lee una transcripción entera.
func ReadSession(path string) (Session, error) {
	f, err := os.Open(path)
	if err != nil {
		return Session{}, err
	}
	defer f.Close()
	s := Session{ID: strings.TrimSuffix(filepath.Base(path), ".jsonl")}
	pending := map[string]int{} // id del tool_use → índice en Calls
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 1<<20), 64<<20)
	for sc.Scan() {
		var ev struct {
			Type       string `json:"type"`
			Entrypoint string `json:"entrypoint"`
			TurnOrigin string `json:"turnOrigin"`
			Origin     struct {
				Kind string `json:"kind"`
			} `json:"origin"`
			Timestamp time.Time `json:"timestamp"`
			Message   struct {
				Content json.RawMessage `json:"content"`
			} `json:"message"`
		}
		if json.Unmarshal(sc.Bytes(), &ev) != nil {
			continue
		}
		if ev.TurnOrigin == "human" || ev.Origin.Kind == "human" {
			s.Human = true
		}
		if s.Entrypoint == "" && ev.Entrypoint != "" {
			s.Entrypoint = ev.Entrypoint
		}
		if s.Start.IsZero() && !ev.Timestamp.IsZero() {
			s.Start = ev.Timestamp
		}
		var blocks []struct {
			Type      string          `json:"type"`
			ID        string          `json:"id"`
			Name      string          `json:"name"`
			Input     json.RawMessage `json:"input"`
			ToolUseID string          `json:"tool_use_id"`
			Content   json.RawMessage `json:"content"`
			IsError   bool            `json:"is_error"`
		}
		if json.Unmarshal(ev.Message.Content, &blocks) != nil {
			continue
		}
		for _, b := range blocks {
			switch b.Type {
			case "tool_use":
				c := Call{Session: s.ID, Time: ev.Timestamp, Tool: b.Name, Outcome: OutcomeOK}
				var in map[string]any
				_ = json.Unmarshal(b.Input, &in)
				switch b.Name {
				case "Bash":
					cmd, _ := in["command"].(string)
					c.Keys, c.Command = BashKeys(cmd), Redact(cmd, 160)
				case "Skill":
					name, _ := in["skill"].(string)
					c.Keys = []string{"skill " + name[strings.LastIndex(name, ":")+1:]}
				case "Agent", "Task":
					kind, _ := in["subagent_type"].(string)
					if kind == "" {
						kind = "general-purpose"
					}
					c.Keys = []string{"agent " + kind}
				default:
					c.Keys = []string{b.Name}
				}
				pending[b.ID] = len(s.Calls)
				s.Calls = append(s.Calls, c)
			case "tool_result":
				if i, ok := pending[b.ToolUseID]; ok {
					text := resultText(b.Content)
					c := &s.Calls[i]
					c.Outcome, c.Hook = outcomeOf(text, b.IsError)
					c.Culprit = culprit(*c, text)
				}
			}
		}
	}
	return s, sc.Err()
}

// TranscriptDirs: la carpeta de transcripciones de `root` y las de sus subcarpetas.
func TranscriptDirs(projects, root string) []string {
	name := strings.ReplaceAll(filepath.Clean(root), "/", "-")
	entries, err := os.ReadDir(projects)
	if err != nil {
		return nil
	}
	var dirs []string
	for _, e := range entries {
		if e.IsDir() && (e.Name() == name || strings.HasPrefix(e.Name(), name+"-")) {
			dirs = append(dirs, filepath.Join(projects, e.Name()))
		}
	}
	sort.Strings(dirs)
	return dirs
}
