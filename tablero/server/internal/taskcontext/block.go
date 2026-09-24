package taskcontext

import (
	"context"
	"fmt"
	"regexp"
	"strings"
	"time"

	"creditop/playground/tablero/server/internal/dbquery"
)

// BlockSchema es el formato de la pila desde el 2026-09-23: la tarea es una pila de BLOQUES de
// documentación que entran con el tiempo, sin más estructura fija que el bloque mismo.
//
// Un bloque muestra dos cosas: un título —una línea, la conclusión y no la actividad— y una
// descripción en prosa libre. Lo estricto no está en la forma sino en lo que la descripción NOMBRA:
// un archivo va con su repo y fijado al commit en que se escribió, un tema de canon tiene que existir
// y un comando dice contra qué ambiente corrió y qué dio. Eso es lo que permite volver a comprobar un
// bloque meses después.
//
// Internos, en el JSON y nunca en pantalla: `id`, `at` —que sólo agrupa los bloques por día— y `via`,
// quién lo agregó. No hay «siguiente paso»: obliga a hacer algo después, y eso es decisión de cómo se
// va desarrollando la tarea (Miguel, 2026-09-23).
const BlockSchema = "tablero.task-context/v2"

const (
	titleLimit = 120
	bodyLimit  = 3000
	fenceHelp  = "harness · trazador · sql <ambiente> · sh · json · text"
)

// vias: quién agregó el bloque. `migration`, los 37 hitos del formato viejo convertidos el 2026-09-23.
var vias = map[string]bool{"manual": true, "harness": true, "trazador": true, "db": true, "migration": true}

// Los bloques de código de COMANDO llevan su `Resultado:` debajo; los de material, no.
var (
	commandFences  = map[string]bool{"harness": true, "trazador": true, "sql": true, "sh": true}
	materialFences = map[string]bool{"json": true, "text": true}
)

var (
	blockLinkRe   = regexp.MustCompile(`\[([^\[\]\n]+)\]\(([^()\s]+)\)`)
	canonTargetRe = regexp.MustCompile(`^canon:([A-Za-z0-9][A-Za-z0-9._/#-]*)$`)
	repoTargetRe  = regexp.MustCompile(`^repo:([a-z0-9][a-z0-9-]*)(?:@([0-9a-f]{7,40}))?/([^#\s]+?)(#L\d+(?:-L\d+)?)?$`)
	prTargetRe    = regexp.MustCompile(`^pr:([a-z0-9][a-z0-9-]*)#\d+$`)
	jiraTargetRe  = regexp.MustCompile(`^jira:[A-Z][A-Z0-9]+-\d+$`)
	blockTargetRe = regexp.MustCompile(`^bloque:(blk_[A-Za-z0-9._-]+)$`)
	httpsTargetRe = regexp.MustCompile(`^https://\S+$`)
	fenceRe       = regexp.MustCompile("^```(\\S*)(?:[ \\t]+(\\S+))?[ \\t]*$")
	fenceCloseRe  = regexp.MustCompile("^```[ \\t]*$")
	resultRe      = regexp.MustCompile(`^Resultado:\s*\S`)
	localPathRe   = regexp.MustCompile(`(?:^|[\s(\x60'"=])(?:/Users/|/home/|~/)`)
	barePathRe    = regexp.MustCompile(`(?:^|[\s(\x60'"])((?:[\w.@-]+/)+[\w.-]+\.(?:php|go|ts|tsx|js|jsx|mjs|cjs|vue|py|md|json|ya?ml|sql|sh|css|html))(?:$|[\s)\x60'".,;:])`)
	inlineCodeRe  = regexp.MustCompile("`[^`\\n]*`")
	htmlTagRe     = regexp.MustCompile(`<[A-Za-z/!]`)
)

// ParseBlockMarkdown lee un bloque como se escribe: la primera línea con texto es `# el título`; lo que
// sigue, la descripción.
func ParseBlockMarkdown(src string) (title, body string, err error) {
	lines := strings.Split(strings.ReplaceAll(src, "\r\n", "\n"), "\n")
	for len(lines) > 0 && strings.TrimSpace(lines[0]) == "" {
		lines = lines[1:]
	}
	if len(lines) == 0 || !strings.HasPrefix(strings.TrimSpace(lines[0]), "# ") {
		return "", "", fmt.Errorf("la primera línea es el título: «# La conclusión, en una línea»")
	}
	title = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(lines[0]), "# "))
	return title, strings.TrimSpace(strings.Join(lines[1:], "\n")), nil
}

type fence struct {
	lang, arg, code string
	line            int
}

// scanBody separa la prosa de los bloques de código y exige el `Resultado:` de cada comando. La prosa
// vuelve línea por línea, con cada bloque de código cambiado por una línea vacía, para que los
// chequeos de texto no miren adentro de un comando.
func scanBody(body string) (prose []string, fences []fence, err error) {
	lines := strings.Split(body, "\n")
	for i := 0; i < len(lines); i++ {
		line := lines[i]
		if !strings.HasPrefix(line, "```") {
			if strings.HasPrefix(strings.TrimSpace(line), "```") {
				return nil, nil, fmt.Errorf("línea %d: un bloque de código se abre al principio de la línea", i+1)
			}
			prose = append(prose, line)
			continue
		}
		m := fenceRe.FindStringSubmatch(line)
		if m == nil {
			return nil, nil, fmt.Errorf("línea %d: bloque de código mal abierto: %s", i+1, fenceHelp)
		}
		end := i + 1
		for end < len(lines) && !fenceCloseRe.MatchString(lines[end]) {
			end++
		}
		if end == len(lines) {
			return nil, nil, fmt.Errorf("línea %d: el bloque de código no se cierra", i+1)
		}
		f := fence{lang: m[1], arg: m[2], code: strings.TrimSpace(strings.Join(lines[i+1:end], "\n")), line: i + 1}
		if err := checkFence(f); err != nil {
			return nil, nil, fmt.Errorf("línea %d: %w", f.line, err)
		}
		if commandFences[f.lang] {
			next := end + 1
			for next < len(lines) && strings.TrimSpace(lines[next]) == "" {
				next++
			}
			if next == len(lines) || !resultRe.MatchString(strings.TrimSpace(lines[next])) {
				return nil, nil, fmt.Errorf("línea %d: un comando va seguido de su «Resultado: …»", f.line)
			}
		}
		fences = append(fences, f)
		prose = append(prose, "")
		i = end
	}
	return prose, fences, nil
}

func checkFence(f fence) error {
	if !commandFences[f.lang] && !materialFences[f.lang] {
		if f.lang == "" {
			return fmt.Errorf("al bloque de código le falta el tipo: %s", fenceHelp)
		}
		return fmt.Errorf("el tipo de bloque de código %q no existe: %s", f.lang, fenceHelp)
	}
	if f.code == "" {
		return fmt.Errorf("el bloque %s está vacío", f.lang)
	}
	if f.lang == "sql" {
		if !dbquery.ValidTarget(f.arg) {
			return fmt.Errorf("sql lleva su ambiente: ```sql local · dev · staging · prod")
		}
		if err := dbquery.ValidateReadOnly(f.code); err != nil {
			return fmt.Errorf("la consulta no es de sólo lectura: %w", err)
		}
		return nil
	}
	if f.arg != "" {
		return fmt.Errorf("sólo sql lleva algo después del tipo; el ambiente de %s va en su TARGET=", f.lang)
	}
	if (f.lang == "harness" || f.lang == "trazador") && !strings.Contains(f.code, "TARGET=") {
		return fmt.Errorf("el comando de %s dice contra qué ambiente corrió: escribí su TARGET=", f.lang)
	}
	return nil
}

// checkLinks valida cada enlace de la prosa. Sin `pinned`, un `repo:` puede venir sin commit —es como
// se escribe—; en la pila siempre lo trae, porque lo completó la herramienta.
func checkLinks(prose string, pinned bool) error {
	for _, m := range blockLinkRe.FindAllStringSubmatch(prose, -1) {
		target := m[2]
		switch {
		case canonTargetRe.MatchString(target), prTargetRe.MatchString(target), jiraTargetRe.MatchString(target),
			blockTargetRe.MatchString(target), httpsTargetRe.MatchString(target):
		case repoTargetRe.MatchString(target):
			if pinned && repoTargetRe.FindStringSubmatch(target)[2] == "" {
				return fmt.Errorf("el enlace %s no está fijado a un commit", target)
			}
		default:
			return fmt.Errorf("el enlace %q no tiene un tipo válido: canon:<tema> · repo:<repo>/<ruta> · pr:<repo>#N · jira:CLAVE-N · bloque:<id> · https://", target)
		}
	}
	return nil
}

// checkText mira lo que no es enlace: un archivo nombrado sin su repo y el HTML. El código entre
// comillas invertidas también cuenta para el archivo —es como se suele escribir una ruta— pero no
// para el HTML, porque `<div>` entre comillas es un ejemplo, no marcado.
func checkText(name, text string) error {
	outside := blockLinkRe.ReplaceAllString(text, " ")
	if m := barePathRe.FindStringSubmatch(outside); m != nil {
		return fmt.Errorf("%s nombra «%s» sin su repo: escribilo como [nombre](repo:<repo>/<ruta>)", name, m[1])
	}
	if htmlTagRe.MatchString(inlineCodeRe.ReplaceAllString(outside, " ")) {
		return fmt.Errorf("%s no lleva HTML", name)
	}
	return nil
}

func validateBlockText(title, body string, pinned bool) error {
	if _, err := cleanOne("el título", title, titleLimit, true); err != nil {
		return err
	}
	if blockLinkRe.MatchString(title) {
		return fmt.Errorf("el título va sin enlaces: los enlaces van en la descripción")
	}
	if strings.TrimSpace(body) == "" {
		return fmt.Errorf("falta la descripción")
	}
	if strings.Contains(body, "\r") {
		return fmt.Errorf("la descripción tiene retornos de carro")
	}
	if n := len([]rune(body)); n > bodyLimit {
		return fmt.Errorf("la descripción tiene %d caracteres y el tope es %d: partila en dos bloques", n, bodyLimit)
	}
	for _, text := range []string{title, body} {
		if localPathRe.MatchString(text) {
			return fmt.Errorf("hay una ruta local: un bloque nombra los archivos por repo, no por la máquina donde se escribió")
		}
	}
	if err := checkText("el título", title); err != nil {
		return err
	}
	prose, _, err := scanBody(body)
	if err != nil {
		return err
	}
	joined := strings.Join(prose, "\n")
	if err := checkLinks(joined, pinned); err != nil {
		return err
	}
	return checkText("la descripción", joined)
}

// ValidateBlock es la validación de un bloque ya escrito. No toca la red ni los clones —corre en cada
// lectura—: comprueba la forma, y que cada archivo venga con su commit fijado.
func ValidateBlock(e Event) error {
	if e.Schema != BlockSchema {
		return fmt.Errorf("schema %q no es un bloque", e.Schema)
	}
	if !strings.HasPrefix(e.ID, "blk_") {
		return fmt.Errorf("id de bloque inválido %q", e.ID)
	}
	if _, err := time.Parse(time.RFC3339, e.At); err != nil {
		return fmt.Errorf("at debe ser RFC3339: %w", err)
	}
	if !vias[e.Via] {
		return fmt.Errorf("via %q no existe: manual · harness · trazador · db · migration", e.Via)
	}
	return validateBlockText(e.Title, e.Body, true)
}

// FileResolver es la lista de repos (tools/repos.json): si un alias se puede citar y en qué commit
// existe una ruta.
type FileResolver interface {
	Pin(alias, path, sha string) (string, error)
	Knows(alias string) bool
}

// CanonCheck devuelve las referencias que canon no conoce. Un error es que no se pudo preguntar.
type CanonCheck func(ctx context.Context, refs []string) (missing []string, err error)

// BlockDeps son las comprobaciones que tocan el mundo —git, canon y la pila actual—. Van aparte para
// que la lectura no dependa de la red ni de los clones: sólo se pagan al agregar.
type BlockDeps struct {
	Files    FileResolver
	Canon    CanonCheck
	Existing []Event
}

// mapProse aplica fn a cada línea de prosa, sin tocar lo que va adentro de un bloque de código.
func mapProse(body string, fn func(string) string) string {
	lines := strings.Split(body, "\n")
	inside := false
	for i, line := range lines {
		switch {
		case !inside && strings.HasPrefix(line, "```"):
			inside = true
		case inside && fenceCloseRe.MatchString(line):
			inside = false
		case !inside:
			lines[i] = fn(line)
		}
	}
	return strings.Join(lines, "\n")
}

// PrepareBlock convierte lo que se escribió en un bloque listo para apilar: fija cada archivo al commit
// en que existe, comprueba canon, los PR y los bloques citados, y completa `id`, `at` y `via`.
//
// Canon caído no frena: el bloque entra y vuelve un aviso, porque una red que falla no hace falsa una
// cita. Un tema que canon contesta que no existe, sí frena.
func PrepareBlock(ctx context.Context, title, body, via string, deps BlockDeps, now time.Time) (Event, []string, error) {
	title = strings.TrimSpace(title)
	body = strings.TrimSpace(strings.ReplaceAll(body, "\r\n", "\n"))
	if via == "" {
		via = "manual"
	}
	if !vias[via] {
		return Event{}, nil, fmt.Errorf("via %q no existe: manual · harness · trazador · db · migration", via)
	}
	if err := validateBlockText(title, body, false); err != nil {
		return Event{}, nil, err
	}
	var problems, warnings, canonRefs []string
	known := make(map[string]bool, len(deps.Existing))
	for _, e := range deps.Existing {
		known[e.ID] = true
	}
	body = mapProse(body, func(line string) string {
		return blockLinkRe.ReplaceAllStringFunc(line, func(link string) string {
			m := blockLinkRe.FindStringSubmatch(link)
			label, target := m[1], m[2]
			switch {
			case repoTargetRe.MatchString(target):
				r := repoTargetRe.FindStringSubmatch(target)
				alias, sha, path, anchor := r[1], r[2], r[3], r[4]
				pinned, err := deps.Files.Pin(alias, path, sha)
				if err != nil {
					problems = append(problems, err.Error())
					return link
				}
				return "[" + label + "](repo:" + alias + "@" + pinned + "/" + path + anchor + ")"
			case prTargetRe.MatchString(target):
				if alias := prTargetRe.FindStringSubmatch(target)[1]; !deps.Files.Knows(alias) {
					problems = append(problems, fmt.Sprintf("%s: el repo %q no se puede citar", target, alias))
				}
			case canonTargetRe.MatchString(target):
				canonRefs = append(canonRefs, strings.TrimPrefix(target, "canon:"))
			case blockTargetRe.MatchString(target):
				if id := strings.TrimPrefix(target, "bloque:"); !known[id] {
					problems = append(problems, fmt.Sprintf("%s no está en la pila de esta tarea", target))
				}
			}
			return link
		})
	})
	if len(canonRefs) > 0 && deps.Canon != nil {
		missing, err := deps.Canon(ctx, canonRefs)
		if err != nil {
			warnings = append(warnings, "no se pudo preguntar a canon ("+err.Error()+"): sus enlaces entran sin comprobar")
		}
		for _, ref := range missing {
			problems = append(problems, "canon:"+ref)
		}
	}
	if len(problems) > 0 {
		return Event{}, warnings, fmt.Errorf("%s", strings.Join(problems, " · "))
	}
	id, err := newID("blk_", now)
	if err != nil {
		return Event{}, warnings, err
	}
	e := Event{Schema: BlockSchema, ID: id, At: now.Format(time.RFC3339), Via: via, Title: title, Body: body}
	if err := ValidateBlock(e); err != nil {
		return Event{}, warnings, err
	}
	return e, warnings, nil
}

// HasCommand dice si algún bloque trae un comando con su resultado: la señal de que lo que se afirma en
// la pila se puede volver a correr.
func HasCommand(events []Event) bool {
	for _, e := range events {
		if _, fences, err := scanBody(e.Body); err == nil {
			for _, f := range fences {
				if commandFences[f.lang] {
					return true
				}
			}
		}
	}
	return false
}
