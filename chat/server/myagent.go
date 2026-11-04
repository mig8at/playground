package main

// TU AGENTE EN «MI CHAT»: le escribís y contesta él, con el modelo que elegiste en su panel, con Claude Code en esta
// máquina. Corre DENTRO del playground y puede LEER: los archivos del playground (knowledge/, tablero/, las herramientas
// y sus CLAUDE.md) y una lista cerrada de comandos que sólo consultan (playgroundReadCommands). Nada que escriba: ni
// editar archivos, ni harness, ni Jira o Slack con --apply. Lo que no está en la lista se rechaza solo (dontAsk).
//
// `--restricted` deja afuera los ajustes del proyecto: sus hooks (el de Stop corre `make cierre`) no corren acá. Y
// confina la lectura a la carpeta del playground.
//
// ⚠ `claude -p` gasta el límite del asiento del plan de equipo de quien corre el chat, como usar Claude Code.

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// Los comandos que tu agente puede correr: sólo consultan. Cada uno es un prefijo de Claude Code (`Bash(prefijo:*)`).
// ⚠ Se agrega uno sólo si NO escribe: ni en un ambiente, ni a nombre de nadie, ni en archivos.
var playgroundReadCommands = []string{
	"make knowledge-search", "make knowledge-read", "make knowledge-map",
	"make tareas", "make retomar", "make trampas INDICE=1",
	"bin/pg tareas", "bin/pg tarea pila", "bin/pg jira search", "bin/pg jira myself",
	"bin/pg logs", "bin/pg confluence search", "bin/pg confluence read",
	"git log", "git grep", "git show", "git status",
}

// Lo que tu agente NO puede tocar aunque sea de lectura: las credenciales (los .env de connectors/ y de cada herramienta,
// llaves, secretos) y los comandos que leen archivos por fuera de Read (Claude Code aprueba solos algunos, como `cat`).
// Lo que lee queda en la conversación, guardada en el navegador. Grep y Glob ya saltan lo que está en .gitignore.
var playgroundDenied = []string{
	"Read(**/.env)", "Read(**/.env.*)", "Read(**/*.pem)", "Read(**/*.key)", "Read(**/secrets/**)", "Read(**/.backups/**)",
}

// Los programas que abren o buscan dentro de archivos por la terminal. Claude Code aprueba solos los que «sólo leen»
// (medido: `grep -r` sacó el valor de un .env de prueba), así que se niegan todos: para leer están Read y Grep, que
// respetan las reglas de arriba y .gitignore. `git grep` y `git show` quedan: sólo ven lo versionado.
var terminalReaders = []string{"cat", "head", "tail", "less", "more", "grep", "egrep", "fgrep", "rg", "ag", "ack", "find",
	"xargs", "sort", "uniq", "cut", "tr", "nl", "diff", "cmp", "comm", "jq", "yq", "awk", "sed", "strings", "xxd", "od",
	"hexdump", "base64", "openssl", "python", "python3", "node", "perl", "ruby", "sh", "bash", "zsh", "env", "printenv",
	"source", ".", "eval", "exec", "open", "pbcopy", "curl", "wget"}

func deniedTools() []string {
	out := append([]string{}, playgroundDenied...)
	for _, c := range terminalReaders {
		out = append(out, "Bash("+c+":*)", "Bash("+c+")")
	}
	return out
}

// Los ids del panel, en los alias que entiende Claude Code (el id completo no está en su catálogo).
var claudeAlias = map[string]string{"claude-opus-5-5": "opus", "claude-sonnet-5-5": "sonnet", "claude-haiku-5-5": "haiku"}

// La raíz del playground: PLAYGROUND_ROOT, o la carpeta desde la que corre el chat (`make chat` corre desde ahí).
func playgroundRoot() (string, error) {
	dir := os.Getenv("PLAYGROUND_ROOT")
	if dir == "" {
		dir, _ = os.Getwd()
	}
	for d := dir; d != "/" && d != "."; d = filepath.Dir(d) {
		if fileExists(filepath.Join(d, "knowledge")) && fileExists(filepath.Join(d, "tablero")) && fileExists(filepath.Join(d, "CLAUDE.md")) {
			return d, nil
		}
	}
	return "", fmt.Errorf("no encuentro el playground desde %s (PLAYGROUND_ROOT)", dir)
}

// Lo que hizo para contestar: cada archivo que leyó, cada búsqueda y cada comando.
type myAgentStep struct {
	Tool   string `json:"tool"`
	Detail string `json:"detail"`
}

func stepOf(name string, input map[string]any) myAgentStep {
	str := func(k string) string { v, _ := input[k].(string); return v }
	switch name {
	case "Read":
		return myAgentStep{"leyó", str("file_path")}
	case "Grep":
		return myAgentStep{"buscó", strings.TrimSpace(str("pattern") + " " + str("path"))}
	case "Glob":
		return myAgentStep{"listó", str("pattern")}
	case "Bash":
		return myAgentStep{"corrió", str("command")}
	}
	return myAgentStep{name, ""}
}

// claudeAskPlayground contesta con Claude Code dentro del playground, con herramientas de lectura.
func claudeAskPlayground(ctx context.Context, model, prompt string) (string, []myAgentStep, error) {
	path, err := lookTool("claude")
	if err != nil {
		return "", nil, errors.New("no está `claude` (Claude Code) en esta máquina")
	}
	root, err := playgroundRoot()
	if err != nil {
		return "", nil, err
	}
	allowed := []string{"Read", "Grep", "Glob"}
	for _, c := range playgroundReadCommands {
		allowed = append(allowed, "Bash("+c+":*)")
	}
	args := []string{"-p", "--model", claudeAlias[model], "--output-format", "stream-json", "--verbose",
		"--restricted", "--strict-mcp-config", "--no-session-persistence",
		"--tools", "Read,Grep,Glob,Bash", "--allowedTools", strings.Join(allowed, ","),
		"--disallowedTools", strings.Join(deniedTools(), ","), "--permission-mode", "dontAsk"}
	cmd := exec.CommandContext(ctx, path, args...)
	cmd.Dir, cmd.Env = root, toolEnv()
	cmd.Stdin = strings.NewReader(prompt)
	out, err := cmd.StdoutPipe()
	if err != nil {
		return "", nil, err
	}
	var errOut bytes.Buffer
	cmd.Stderr = &errOut
	if err := cmd.Start(); err != nil {
		return "", nil, err
	}
	steps := []myAgentStep{}
	result, resultErr := "", ""
	scanner := bufio.NewScanner(out)
	scanner.Buffer(make([]byte, 64*1024), 8*1024*1024)
	for scanner.Scan() {
		var ev struct {
			Type    string `json:"type"`
			Subtype string `json:"subtype"`
			IsError bool   `json:"is_error"`
			Result  string `json:"result"`
			Message struct {
				Content []struct {
					Type  string         `json:"type"`
					Name  string         `json:"name"`
					Input map[string]any `json:"input"`
				} `json:"content"`
			} `json:"message"`
		}
		if json.Unmarshal(scanner.Bytes(), &ev) != nil {
			continue
		}
		switch ev.Type {
		case "assistant":
			for _, c := range ev.Message.Content {
				if c.Type == "tool_use" {
					steps = append(steps, stepOf(c.Name, c.Input))
				}
			}
		case "result":
			if ev.IsError {
				resultErr = strings.TrimSpace(ev.Subtype + " " + ev.Result)
			} else {
				result = strings.TrimSpace(ev.Result)
			}
		}
	}
	waitErr := cmd.Wait()
	switch {
	case ctx.Err() != nil:
		return "", steps, errors.New("claude no contestó a tiempo")
	case resultErr != "":
		return "", steps, fmt.Errorf("claude falló: %s", resultErr)
	case result == "" && waitErr != nil:
		msg := strings.TrimSpace(errOut.String())
		if len(msg) > 300 {
			msg = msg[:300] + "…"
		}
		return "", steps, fmt.Errorf("claude falló: %s", strings.TrimSpace(msg+" ("+waitErr.Error()+")"))
	case result == "":
		return "", steps, errors.New("claude no devolvió nada")
	}
	return result, steps, nil
}

// Los modelos del panel de tu agente (src/stores/myAgent.js): otro no se acepta.
var myAgentModels = map[string]bool{"claude-opus-5-5": true, "claude-sonnet-5-5": true, "claude-haiku-5-5": true}

type myAgentTask struct {
	Title string `json:"titulo"`
	State string `json:"estado"`
}

type myAgentTurn struct {
	From string `json:"from"` // "yo" o "agente"
	Text string `json:"text"`
}

type myAgentAsk struct {
	Model   string        `json:"model"`
	Name    string        `json:"name"`
	Owner   string        `json:"owner"`
	Rules   []string      `json:"rules"`
	Tasks   []myAgentTask `json:"tasks"`
	History []myAgentTurn `json:"history"`
	Text    string        `json:"text"`
}

const myAgentPrompt = `Sos %[1]s, el agente personal de %[2]s en CreditOp (una fintech colombiana de originación de crédito).
Estás en el chat privado de %[2]s: quien te escribe es %[2]s mismo, tu dueño, no otra persona.

Cómo sos:
%[3]s

Lo que sabés de %[2]s:
- Sus tareas en cuadrilla (JSON): %[4]s
- Y su playground, en la carpeta donde estás: leé el CLAUDE.md de la raíz para saber qué hay. Podés leer y buscar
  archivos (knowledge/ es el conocimiento técnico con fuentes; tablero/tasks/<slug>/task.md son sus tareas; cada
  herramienta tiene su CLAUDE.md) y correr SÓLO estos comandos, que consultan sin cambiar nada: %[7]s.
  No inventes: si no lo encontrás, decilo. Cuando uses algo del playground, nombrá el archivo o el comando.
- Las credenciales (.env, llaves, secrets/) no se leen ni se citan.
- NUNCA escribas, edites ni corras algo que cambie un archivo, un ambiente o mande algo a alguien (harness, --apply,
  Jira, Slack). Si hace falta, decile el comando exacto para que lo corra él.

La conversación hasta ahora (lo más nuevo al final):
%[5]s

Lo que te escribe ahora %[2]s:
%[6]s

Contestale en español, natural y al punto (sin títulos; listas cortas sólo si ayudan).`

func myAgentPromptFor(in myAgentAsk) string {
	rules := make([]string, 0, len(in.Rules))
	for _, r := range in.Rules {
		if r = strings.TrimSpace(r); r != "" {
			rules = append(rules, "- "+r)
		}
	}
	tasks, _ := json.Marshal(in.Tasks)
	history := []string{}
	start := 0
	if len(in.History) > 20 {
		start = len(in.History) - 20
	}
	for _, t := range in.History[start:] {
		who := in.Owner
		if t.From == "agente" {
			who = in.Name
		}
		history = append(history, fmt.Sprintf("%s: %s", who, strings.TrimSpace(t.Text)))
	}
	if len(history) == 0 {
		history = append(history, "(es el primer mensaje)")
	}
	return fmt.Sprintf(myAgentPrompt, in.Name, in.Owner, strings.Join(rules, "\n"), tasks, strings.Join(history, "\n"),
		strings.TrimSpace(in.Text), "`"+strings.Join(playgroundReadCommands, "`, `")+"`")
}

func myAgentHandlers(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/my-agent/ask", func(w http.ResponseWriter, r *http.Request) {
		var in myAgentAsk
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 256<<10)).Decode(&in); err != nil {
			fail(w, http.StatusBadRequest, errors.New("el cuerpo va en JSON: {model, name, owner, tasks, history, text}"))
			return
		}
		in.Text, in.Name, in.Owner = strings.TrimSpace(in.Text), strings.TrimSpace(in.Name), strings.TrimSpace(in.Owner)
		switch {
		case in.Text == "":
			fail(w, http.StatusBadRequest, errors.New("falta el mensaje"))
			return
		case len([]rune(in.Text)) > maxText:
			fail(w, http.StatusRequestEntityTooLarge, fmt.Errorf("el mensaje pasa de %d caracteres", maxText))
			return
		case !myAgentModels[in.Model]:
			fail(w, http.StatusBadRequest, fmt.Errorf("modelo desconocido: %q", in.Model))
			return
		}
		if in.Name == "" {
			in.Name = "Mi agente"
		}
		if in.Owner == "" {
			in.Owner = "tu dueño"
		}
		ctx, cancel := context.WithTimeout(r.Context(), 240*time.Second)
		defer cancel()
		text, steps, err := claudeAskPlayground(ctx, in.Model, myAgentPromptFor(in))
		if err != nil {
			writeJSON(w, http.StatusBadGateway, map[string]any{"error": err.Error(), "steps": steps})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"text": text, "model": in.Model, "steps": steps})
	})
}
