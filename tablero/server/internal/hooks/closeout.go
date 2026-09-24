package hooks

/* closeout.go · Stop: el cierre de sesión del tablero deja de depender de que alguien se acuerde.
 *
 * EL PROBLEMA: `tablero/CLAUDE.md` pide tres cosas al terminar de trabajar en una tarea (un bloque del
 * día en su pila, declarar `ramas:`, escribir la bitácora con minutos medidos). Se olvidaron todas el
 * 26/8 y el tablero mintió ocho días. Olvidarlo no rompe nada, y por eso se olvida.
 *
 * QUÉ HACE: cuando el modelo termina de responder, corre `closeout -json` y mira SÓLO las tareas que
 * ESTA sesión tocó —las que el transcript escribió, o las de una rama que la sesión nombró—. Si a alguna
 * le falta una pieza, devuelve `decision: block` con la lista: el modelo vuelve a tomar el turno y la
 * completa (o dice que sigue en el medio). Las tareas que tocó otra sesión no son asunto de ésta.
 *
 * UNA VEZ POR SESIÓN Y POR DÍA: deja una marca en `tablero/data/cache/` (fuera de git). Sin eso, cada
 * turno volvería a bloquear. Y `stop_hook_active` corta el bucle que el propio block dispara.
 *
 * Si algo falla —sin Go, sin transcript, sin tablero— sale 0 en silencio: un cierre que no se pudo
 * calcular no puede ser motivo de que la sesión no termine. */

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"creditop/playground/lib/text"
)

// piece es lo que la sesión le MANDÓ a una herramienta: su nombre y su entrada, como texto.
type piece struct{ tool, input string }

/* pyDumps escribe un valor JSON como `json.dumps(v, ensure_ascii=False)` de Python: `, ` y `: ` entre
 * elementos, las claves en su orden, los no ASCII tal cual. No es cosmética: los patrones de «esta
 * sesión escribió tal archivo» se buscan sobre este texto, y un separador distinto cambia qué matchea. */
func pyDumps(raw []byte) (string, error) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var sb strings.Builder
	if err := dumpValue(dec, &sb); err != nil {
		return "", err
	}
	return sb.String(), nil
}

func dumpValue(dec *json.Decoder, sb *strings.Builder) error {
	tok, err := dec.Token()
	if err != nil {
		return err
	}
	switch t := tok.(type) {
	case json.Delim:
		closing, sep := byte('}'), ", "
		if t == '[' {
			closing = ']'
		}
		sb.WriteByte(byte(t))
		first := true
		for dec.More() {
			if !first {
				sb.WriteString(sep)
			}
			first = false
			if t == '{' {
				key, err := dec.Token()
				if err != nil {
					return err
				}
				writeString(sb, key.(string))
				sb.WriteString(": ")
			}
			if err := dumpValue(dec, sb); err != nil {
				return err
			}
		}
		if _, err := dec.Token(); err != nil {
			return err
		}
		sb.WriteByte(closing)
	case string:
		writeString(sb, t)
	case json.Number:
		sb.WriteString(pyNumber(t))
	case bool:
		if t {
			sb.WriteString("true")
		} else {
			sb.WriteString("false")
		}
	case nil:
		sb.WriteString("null")
	}
	return nil
}

// pyNumber: un entero queda como está; un real sale como `repr(float)` de Python (`1.0`, `1e+16`).
func pyNumber(n json.Number) string {
	s := n.String()
	if !strings.ContainsAny(s, ".eE") {
		return s
	}
	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return s
	}
	switch {
	case math.IsInf(f, 1):
		return "Infinity"
	case math.IsInf(f, -1):
		return "-Infinity"
	}
	// el exponente decimal, leído del formato científico: `1.5e-07` → -7
	sci := strconv.FormatFloat(f, 'e', -1, 64)
	exp, _ := strconv.Atoi(sci[strings.Index(sci, "e")+1:])
	if exp < -4 || exp >= 16 {
		return sci
	}
	out := strconv.FormatFloat(f, 'f', -1, 64)
	if !strings.Contains(out, ".") {
		out += ".0"
	}
	return out
}

func writeString(sb *strings.Builder, s string) {
	sb.WriteByte('"')
	for _, r := range s {
		switch r {
		case '"':
			sb.WriteString(`\"`)
		case '\\':
			sb.WriteString(`\\`)
		case '\n':
			sb.WriteString(`\n`)
		case '\r':
			sb.WriteString(`\r`)
		case '\t':
			sb.WriteString(`\t`)
		case '\b':
			sb.WriteString(`\b`)
		case '\f':
			sb.WriteString(`\f`)
		default:
			if r < 0x20 {
				fmt.Fprintf(sb, `\u%04x`, r)
			} else {
				sb.WriteRune(r)
			}
		}
	}
	sb.WriteByte('"')
}

/* readTranscript: sólo lo que la sesión ESCRIBIÓ en sus herramientas — rutas editadas, comandos,
 * contenido. No el transcript entero: una sesión que corre `make tareas` o `make cierre` recibe TODOS los
 * slugs en la salida, y con eso cualquier tarea parecería tocada. Lo que se lee (tool_result) no cuenta;
 * lo que se manda (tool_use.input) sí. Si el formato no es el esperado, devuelve el texto crudo — mejor un
 * aviso de más que un hook que calla porque cambió una clave. */
func readTranscript(path string) []piece {
	raw, err := os.ReadFile(path)
	if err != nil || path == "" {
		return nil
	}
	body := dropInvalid(raw)
	var pieces []piece
	shaped := false
	for _, line := range text.SplitLines(body) {
		var ev struct {
			Message struct {
				Content json.RawMessage `json:"content"`
			} `json:"message"`
		}
		if json.Unmarshal([]byte(line), &ev) != nil {
			continue
		}
		var content []json.RawMessage
		if json.Unmarshal(ev.Message.Content, &content) != nil {
			continue
		}
		for _, block := range content {
			var b struct {
				Type  string          `json:"type"`
				Name  string          `json:"name"`
				Input json.RawMessage `json:"input"`
			}
			if json.Unmarshal(block, &b) != nil || b.Type != "tool_use" {
				continue
			}
			shaped = true
			input := "null"
			if len(b.Input) > 0 {
				if s, err := pyDumps(b.Input); err == nil {
					input = s
				}
			}
			pieces = append(pieces, piece{b.Name, input})
		}
	}
	if !shaped {
		if body == "" {
			return []piece{{"", ""}}
		}
		return []piece{{"", body}}
	}
	return pieces
}

func dropInvalid(b []byte) string {
	if utf8.Valid(b) {
		return string(b)
	}
	var sb strings.Builder
	for len(b) > 0 {
		r, size := utf8.DecodeRune(b)
		if !(r == utf8.RuneError && size == 1) {
			sb.Write(b[:size])
		}
		b = b[size:]
	}
	return sb.String()
}

/* ¿ESTA SESIÓN ESCRIBIÓ ESE ARCHIVO? Tiene que ser preciso en las dos direcciones, y las dos fallas ya
 * pasaron:
 *
 *   - LEER NO ES TOCAR. Un `head -60 data/sdk-del-comercio.md` del día anterior hizo que el cierre le
 *     reclamara las piezas a una tarea que esta sesión sólo había mirado — y que además estaba
 *     modificada por OTRA sesión sobre el mismo worktree, que es como se trabaja acá.
 *   - NOMBRAR JUNTO A UNA ESCRITURA TAMPOCO. Buscar «la ruta aparece Y el comando escribe algo» seguía
 *     marcándola: un comando que escribía `.claude/settings.json` mencionaba esa ruta adentro de un
 *     `echo`. Casi todo comando escribe algo, así que la señal tiene que ser la ADYACENCIA — la ruta
 *     pegada al verbo, no en la misma línea.
 *
 * De ahí los tres modos, que son los tres con los que se escribe de verdad acá. */
func writePatterns(path string) []*regexp.Regexp {
	r := regexp.QuoteMeta(path)
	return []*regexp.Regexp{
		// open('…/x.md', 'w')
		regexp.MustCompile(`open\(` + text.Space + `*['"][^'"]*` + r + `['"]` + text.Space + `*,` + text.Space + `*['"][wa]`),
		// > x.md · >> x.md · tee x.md · sed -i … x.md · git add/rm/mv … x.md
		// El comando viaja DENTRO de un JSON, así que antes del verbo puede haber una comilla y no un
		// espacio. Entre el verbo y la ruta caben argumentos que no empiezan con `-`, pero NO otro
		// comando: `[^;&|\n]` corta en el separador, que es lo que evita cruzar de un comando al siguiente.
		regexp.MustCompile(`(?:^|[;&|` + text.SpaceChars + `"'({])(?:>>?|tee|sed` + text.Space + `+-i|git` + text.Space +
			`+add|git` + text.Space + `+rm|git` + text.Space + `+mv)(?:[^;&|\n]*?` + text.Space + `)?['"]?` + text.NotSpace + `*` + r),
	}
}

var (
	writesThroughVariable = regexp.MustCompile(`open\(` + text.Space + `*` + text.Word + `+` + text.Space + `*,` + text.Space + `*['"][wa]|\.write\(|writelines\(`)
)

// assignedAndWritten: el modo `p='…/x.md'` … `open(p,'w')`. Se exige que la ASIGNACIÓN sea de esta
// ruta — si no, cualquier script que escriba otro archivo contaría.
func assignedAndWritten(body, path string) bool {
	assigned := regexp.MustCompile(`=` + text.Space + `*['"][^'"]*` + regexp.QuoteMeta(path) + `['"]`)
	return assigned.MatchString(body) && writesThroughVariable.MatchString(body)
}

func wrote(pieces []piece, path string) bool {
	patterns := writePatterns(path)
	for _, p := range pieces {
		if !strings.Contains(p.input, path) {
			continue
		}
		if p.tool == "Write" || p.tool == "Edit" || p.tool == "NotebookEdit" {
			return true
		}
		if p.tool != "Bash" {
			continue
		}
		for _, re := range patterns {
			if re.MatchString(p.input) {
				return true
			}
		}
		if assignedAndWritten(p.input, path) {
			return true
		}
	}
	return false
}

type report struct {
	Day   string `json:"day"`
	Tasks []struct {
		ID        json.Number `json:"id"`
		Slug      string      `json:"slug"`
		Missing   []string    `json:"missing"`
		TouchedBy []string    `json:"touchedBy"`
	} `json:"tasks"`
	BranchesWithoutTask       []string    `json:"branchesWithoutTask"`
	PulseAvailable            bool        `json:"pulseAvailable"`
	PulseMinutes              json.Number `json:"pulseMinutes"`
	WorklogMinutes            json.Number `json:"worklogMinutes"`
	WorklogWithoutTaskMinutes json.Number `json:"worklogWithoutTaskMinutes"`
}

// Closeout es el hook de Stop.
func Closeout(env Env) int {
	payload, ok := readPayload(env.Stdin)
	if !ok {
		return 0
	}
	if active, _ := payload["stop_hook_active"].(bool); active {
		return 0
	}
	session := "sin-id"
	if s := fmt.Sprint(payload["session_id"]); payload["session_id"] != nil && s != "" {
		session = s
	}
	if runes := []rune(session); len(runes) > 32 {
		session = string(runes[:32])
	}
	cache := filepath.Join(env.Root, "tablero", "data", "cache")
	mark := filepath.Join(cache, "cierre-avisado-"+session+"-"+env.Today())
	if _, err := os.Stat(mark); err == nil {
		return 0
	}

	_, out, _, err := run(filepath.Join(env.Root, "tablero", "server"), 90*time.Second, "go", "run", "./cmd/closeout", "-json")
	if err != nil {
		return 0
	}
	var rep report
	dec := json.NewDecoder(strings.NewReader(out))
	dec.UseNumber()
	if dec.Decode(&rep) != nil {
		return 0
	}

	pieces := readTranscript(str(payload, "transcript_path"))
	if len(pieces) == 0 {
		return 0 // sin transcript no se sabe qué tocó ESTA sesión; mejor callar que molestar a ciegas
	}

	type mine struct {
		id, slug           string
		missing, touchedBy []string
	}
	var mines []mine
	for _, t := range rep.Tasks {
		if len(t.Missing) == 0 {
			continue
		}
		m := mine{t.ID.String(), t.Slug, t.Missing, t.TouchedBy}
		// La RUTA del archivo, no el slug pelado: un comando que sólo nombra la tarea (un grep, un dato
		// de prueba, un `make tareas N=x`) no la tocó. Medido en la primera corrida real: marcó tres
		// tareas de otras sesiones porque sus slugs aparecían como texto en un script.
		if wrote(pieces, "tasks/"+t.Slug+"/task.md") {
			mines = append(mines, m)
			continue
		}
		// o la sesión trabajó en una rama que la tarea declara: ahí el trabajo existe aunque su archivo
		// no se haya tocado — que es justamente lo que el cierre viene a reclamar.
	branches:
		for _, by := range t.TouchedBy {
			rest, ok := strings.CutPrefix(by, "rama ")
			if !ok || !strings.Contains(rest, "/") {
				continue
			}
			_, branch, _ := strings.Cut(rest, "/")
			for _, p := range pieces {
				if strings.Contains(p.input, branch) {
					mines = append(mines, m)
					break branches
				}
			}
		}
	}
	if len(mines) == 0 {
		return 0
	}

	lines := []string{
		"CIERRE DEL TABLERO · " + rep.Day + " · a las tareas que tocaste en esta sesión les faltan piezas " +
			"(medido por `make cierre`; tablero/CLAUDE.md §«AL CERRAR UNA SESIÓN»):",
		"",
	}
	for _, m := range mines {
		lines = append(lines, "#"+m.id+" "+m.slug+"  (tocada por: "+strings.Join(m.touchedBy, " · ")+")")
		for _, f := range m.missing {
			lines = append(lines, "   ✗ "+f)
		}
		lines = append(lines, "")
	}
	if len(rep.BranchesWithoutTask) > 0 {
		lines = append(lines, "ramas tocadas hoy que ninguna tarea declara en `ramas:`: "+strings.Join(rep.BranchesWithoutTask, ", "), "")
	}
	if rep.PulseAvailable {
		without := rep.WorklogWithoutTaskMinutes.String()
		if without == "" {
			without = "0"
		}
		lines = append(lines, "pulso del día: "+rep.PulseMinutes.String()+"′ · bitácora: "+rep.WorklogMinutes.String()+"′ ("+
			without+"′ sin tarea). Los minutos se MIDEN (`make pulso`), no se estiman.")
	}
	lines = append(lines, "Si esta era la última respuesta de la sesión, completá lo que falta ahora. Si seguís en el medio del "+
		"trabajo, decilo en una línea y continuá: este aviso no se repite en esta sesión.")

	if os.MkdirAll(cache, 0o755) == nil {
		_ = os.WriteFile(mark, nil, 0o644)
	}
	var sb strings.Builder
	sb.WriteString(`{"decision": "block", "reason": `)
	writeString(&sb, strings.Join(lines, "\n"))
	sb.WriteString("}")
	fmt.Fprintln(env.Stdout, sb.String())
	return 0
}
