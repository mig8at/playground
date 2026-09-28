package hooks

/* ask-guard: frena que una sesión de este playground le PREGUNTE a canon (`/api/ask`, `-pregunta`).
 *
 * Canon es el contexto de CreditOp y se trabaja LEYÉNDOLO: `canon-search`, `canon-read`, `canon-mapa`, que
 * son gratis y devuelven lo que el equipo escribió. `/api/ask` pone un modelo en el medio: cuesta (Bedrock),
 * tarda, y devuelve una respuesta armada en vez del texto que la sostiene. Es para credibot y las
 * herramientas externas. Decisión de Miguel (2026-09-27).
 *
 * Qué frena, sólo en posición de comando (nombrar `/api/ask` en un grep o en un mensaje no cuenta):
 *   - un cliente HTTP que le MANDA algo a `/api/ask` (`-d`, `--data`, `--json`, `-F`, `-X POST`). Un GET
 *     pelado contesta 405 y no toca el modelo: es la sonda de «¿existe?», y pasa;
 *   - un intérprete cuyo código, en línea o en un heredoc, nombra `/api/ask`;
 *   - `-pregunta`, el modo del CLI de canon que pasa por el modelo (`go run . -pregunta`, `/tmp/canon-x -pregunta`).
 *
 * Medido el 2026-09-27 sobre las sesiones reales del último mes: 58 usos, todos DESARROLLO de canon
 * (calibraciones y sondas), ninguno de trabajo diario. Calibrar canon es legítimo y deliberado: se hace con
 * I_AM_CALIBRATING_CANON=1 en el comando. */

import (
	"fmt"
	"path/filepath"
	"regexp"
	"strings"

	"creditop/playground/lib/shell"
)

// AskOverride es lo que deja pasar una pregunta a canon cuando se está calibrando el corpus a propósito.
const AskOverride = "I_AM_CALIBRATING_CANON=1"

var (
	httpClients  = map[string]bool{"curl": true, "wget": true, "http": true, "https": true, "xh": true}
	interpreters = map[string]bool{"python": true, "python3": true, "node": true, "bun": true, "deno": true, "ruby": true}
	// sendFlags: lo que convierte un pedido en un POST con cuerpo.
	sendFlags = []string{"-d", "--data", "--data-raw", "--data-binary", "--data-urlencode", "--json", "-F", "--form", "--post-data", "--body-data"}
)

// sends: si los argumentos de un cliente HTTP mandan un cuerpo (o piden POST).
func sends(args []string) bool {
	for i, a := range args {
		for _, f := range sendFlags {
			if a == f || strings.HasPrefix(a, f+"=") {
				return true
			}
		}
		if (a == "-X" || a == "--request") && i+1 < len(args) && strings.EqualFold(args[i+1], "POST") {
			return true
		}
		if strings.HasPrefix(a, "-XPOST") || strings.EqualFold(a, "--request=POST") {
			return true
		}
	}
	return false
}

// AskGuard es la decisión sobre un comando: los motivos para frenarlo (ninguno = pasa).
func AskGuard(cmd string) []string {
	if cmd == "" || strings.Contains(cmd, AskOverride) || !(strings.Contains(cmd, "/api/ask") || strings.Contains(cmd, "-pregunta")) {
		return nil
	}
	var reasons []string
	add := func(r string) {
		for _, x := range reasons {
			if x == r {
				return
			}
		}
		reasons = append(reasons, r)
	}
	const why = "canon se LEE —`make canon-search`, `make canon-read`, `make canon-mapa`, gratis y con el texto que " +
		"sostiene cada cosa—; `/api/ask` pone un modelo en el medio y es para credibot. Si estás calibrando canon a " +
		"propósito, agregá " + AskOverride + " al comando."
	for _, seg := range shell.Segments(cmd) {
		toks := shell.Program(seg)
		if len(toks) == 0 {
			continue
		}
		prog, args := filepath.Base(toks[0]), toks[1:]
		rest := strings.Join(args, " ")
		switch {
		case httpClients[prog] && strings.Contains(rest, "/api/ask") && sends(args):
			add("un POST a `/api/ask` le pregunta a un modelo: " + why)
		case interpreters[prog] && callsAsk(cmd):
			// el código puede venir en línea (-c/-e) o en un heredoc, que Segments saca del segmento: se mira
			// el comando entero, pero SÓLO si en él corre un intérprete.
			add("un script que llama a `/api/ask` le pregunta a un modelo: " + why)
		case (prog == "go" || strings.HasPrefix(prog, "canon")) && containsWord(args, "-pregunta"):
			add("`-pregunta` pasa por el modelo: " + why)
		}
	}
	return reasons
}

/* callsAsk: si el código LLAMA a `/api/ask`, no si lo nombra. Una línea cuenta cuando tiene la ruta y una
 * llamada HTTP a la vez. Medido el 2026-09-27: de 16 scripts que mencionaban `/api/ask`, 15 editaban
 * archivos que lo nombran (`s.replace("/api/ask", …)`) y uno sólo lo llamaba (`urllib.request.Request(…)`). */
func callsAsk(code string) bool {
	for _, line := range strings.Split(code, "\n") {
		if strings.Contains(line, "/api/ask") && httpCall.MatchString(line) {
			return true
		}
	}
	return false
}

var httpCall = regexp.MustCompile(`urlopen|urllib\.request|Request\(|requests\.(post|get|request)|httpx|fetch\(|axios|http\.(request|post)|curl_exec`)

func containsWord(args []string, w string) bool {
	for _, a := range args {
		if a == w {
			return true
		}
	}
	return false
}

// AskGuardHook es el hook PreToolUse (Bash).
func AskGuardHook(env Env) int {
	payload, ok := readPayload(env.Stdin)
	if !ok {
		return 0
	}
	if tool, present := payload["tool_name"]; present && tool != nil && tool != "Bash" {
		return 0
	}
	reasons := AskGuard(str(toolInput(payload), "command"))
	if len(reasons) == 0 {
		return 0
	}
	fmt.Fprint(env.Stderr, "⛔ Bloqueado por el hook ask-guard (tablero/server/internal/hooks/ask_guard.go): desde acá canon se lee, no se le pregunta.\n")
	for _, r := range reasons {
		fmt.Fprintf(env.Stderr, "  ✗ %s\n", r)
	}
	return 2
}
