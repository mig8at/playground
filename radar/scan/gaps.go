package scan

/* Los huecos de canon: dónde se le preguntó al corpus y no alcanzó. Canon sólo sabe lo que alguien
 * escribió, y su silencio se lee igual que «no existe»; esto junta la evidencia de cuándo pasó, leída de
 * las transcripciones, para que el hueco se escriba en vez de volver a caer en él.
 *
 * Tres señales:
 *   - «sin resultados»: una búsqueda que volvió vacía (`⚠ nada:`, o `"matches_found": 0` en la API);
 *   - «buscó y se fue al código» · «leyó y se fue al código»: después de una consulta, la sesión fue a
 *     leer los repos reales (o le delegó a `main-verifier`) antes de volver a canon. No prueba que canon
 *     no lo tuviera —puede que se fuera a verificar—, pero donde se repite, el corpus no alcanzó.
 *
 * ⚠ CONSULTAR canon no es DESARROLLAR canon. Medido el 2026-09-27: de 793 llamadas a la API de canon en
 * las sesiones de este playground, casi todas eran bancos de prueba contra `localhost`, bucles y ediciones
 * de su servidor. Ésas no son preguntas de una tarea y se dejan afuera (`Dev`, sólo contadas). */

import (
	"net/url"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"creditop/playground/lib/shell"
)

// CanonLookup es una consulta a canon hecha para trabajar (no para desarrollar canon).
type CanonLookup struct {
	Kind  string `json:"kind"`            // search · read · context · write
	Query string `json:"query,omitempty"` // la búsqueda, o los ids leídos
	Empty bool   `json:"empty,omitempty"` // la búsqueda no encontró nada
	Dev   bool   `json:"dev,omitempty"`   // desarrollo de canon: se cuenta, no es un hueco
}

const (
	LookupSearch  = "search"
	LookupRead    = "read"
	LookupContext = "context"
	LookupWrite   = "write"
)

var (
	canonAPI    = regexp.MustCompile(`canon\.playground\.creditop\.com/api/(search|read|context|draft)`)
	canonLocal  = regexp.MustCompile(`(localhost|127\.0\.0\.1):\d+/api/(search|read|context)`)
	canonTarget = map[string]string{"canon-search": LookupSearch, "canon-read": LookupRead, "canon-code": LookupRead,
		"canon-write": LookupWrite, "canon-propose": LookupWrite}
	emptySearch = regexp.MustCompile(`⚠ nada:|"matches_found":\s*0\b`)
	// shellLoop: un bucle de SHELL, que se reconoce por su `do`. Mirar el primer token de cada tramo no
	// sirve: el parser parte las líneas aunque estén entre comillas, y el `for` de un `python3 -c "…"`
	// pegado a un curl suelto lo hacía pasar por un banco de pruebas.
	shellLoop = regexp.MustCompile(`(^|[;&|(\n])\s*(for|while|until)\s[^\n]*?(;|\n)\s*do(\s|$)`)
	jsonQuery = regexp.MustCompile(`"q"\s*:\s*"([^"]*)"`)
	// realRepo: un repo de CreditOp bajo github/ (el playground compartido no es código del producto).
	realRepo = regexp.MustCompile(`CREDITOP/github/([A-Za-z0-9_.-]+)`)
)

// canonLookupOf clasifica un comando de Bash: nil si no toca canon.
func canonLookupOf(cmd string) *CanonLookup {
	dev := strings.Contains(cmd, "tools/canon") || strings.Contains(cmd, "-pregunta") || canonLocal.MatchString(cmd) ||
		shellLoop.MatchString(cmd)
	var found *CanonLookup
	for _, seg := range shell.Segments(cmd) {
		toks := shell.Program(seg)
		for len(toks) > 1 && (toks[0] == "do" || toks[0] == "then" || toks[0] == "else") {
			toks = toks[1:] // el cuerpo de un bucle o un if: `do curl …`
		}
		if len(toks) == 0 {
			continue
		}
		switch prog := filepath.Base(toks[0]); prog {
		case "make":
			t, _ := makeTarget(toks[1:])
			kind, ok := canonTarget[t]
			if t == "retomar" && hasArg(toks, "CANON=") {
				kind, ok = LookupContext, true
			}
			if ok && found == nil {
				found = &CanonLookup{Kind: kind, Query: argValue(toks, "Q=", "IDS=", "CANON_Q=")}
			}
		case "go":
			// `go run ./cmd/canon search …` desde tablero/server
			for i, tok := range toks {
				if strings.HasSuffix(tok, "cmd/canon") && i+1 < len(toks) && found == nil {
					switch toks[i+1] {
					case "search":
						found = &CanonLookup{Kind: LookupSearch, Query: strings.Join(toks[i+2:], " ")}
					case "read":
						found = &CanonLookup{Kind: LookupRead, Query: strings.Join(toks[i+2:], " ")}
					}
				}
			}
		case "curl":
			for _, tok := range toks[1:] {
				m := canonAPI.FindStringSubmatch(tok)
				if m == nil || found != nil {
					continue
				}
				kind := map[string]string{"search": LookupSearch, "read": LookupRead, "context": LookupContext, "draft": LookupWrite}[m[1]]
				found = &CanonLookup{Kind: kind, Query: curlQuery(tok, toks)}
			}
		}
	}
	if found != nil {
		found.Dev = dev
	}
	return found
}

func hasArg(toks []string, prefix string) bool { return argValue(toks, prefix) != "" }

func argValue(toks []string, prefixes ...string) string {
	for _, tok := range toks {
		for _, p := range prefixes {
			if strings.HasPrefix(tok, p) {
				return strings.Trim(strings.TrimPrefix(tok, p), `'"`)
			}
		}
	}
	return ""
}

// curlQuery: la consulta de un curl a canon, venga en la URL, en `--data-urlencode q=…` o en un cuerpo JSON.
func curlQuery(rawURL string, toks []string) string {
	if u, err := url.Parse(strings.Trim(rawURL, `'"`)); err == nil {
		for _, k := range []string{"q", "ids"} {
			if v := u.Query().Get(k); v != "" {
				return v
			}
		}
	}
	for _, tok := range toks {
		if strings.HasPrefix(tok, "q=") || strings.HasPrefix(tok, "ids=") {
			return tok[strings.Index(tok, "=")+1:]
		}
		if m := jsonQuery.FindStringSubmatch(tok); m != nil {
			return m[1]
		}
	}
	return ""
}

// codeRepoOf: el repo real que lee una llamada ("" si ninguno). Bash por la ruta; Read, Grep y Glob por su
// `path`; y un pedido a `main-verifier`, que es leer los dos monolitos por delegación.
func codeRepoOf(tool string, input map[string]any) string {
	var text string
	switch tool {
	case "Bash":
		text, _ = input["command"].(string)
	case "Read", "Grep", "Glob":
		for _, k := range []string{"file_path", "path", "pattern"} {
			if v, _ := input[k].(string); v != "" {
				text += " " + v
			}
		}
	case "Agent", "Task":
		if kind, _ := input["subagent_type"].(string); kind == "main-verifier" {
			return "main-verifier"
		}
		return ""
	default:
		return ""
	}
	for _, m := range realRepo.FindAllStringSubmatch(text, -1) {
		if m[1] != "playground" {
			return m[1]
		}
	}
	return ""
}

// Gap es un hueco: una consulta que no alcanzó, agrupada por lo que se preguntó.
type Gap struct {
	Query    string    `json:"query"`
	Signal   string    `json:"signal"` // empty · searched-then-code · read-then-code
	Times    int       `json:"times"`
	Sessions int       `json:"sessions"`
	Last     time.Time `json:"last"`
	Repos    []string  `json:"repos,omitempty"`
	// Recheck: lo que da HOY la misma búsqueda (sólo con -recheck, sólo para las vacías): «cubierto» o «sigue vacío».
	Recheck string `json:"recheck,omitempty"`
}

// Gaps es la vista de huecos.
type Gaps struct {
	Lookups int       `json:"lookups"` // consultas para trabajar, en el período
	Dev     int       `json:"dev"`     // llamadas de desarrollo de canon, que no cuentan
	Writes  int       `json:"writes"`  // piezas escritas o ensayadas en canon
	Gaps    []Gap     `json:"gaps"`
	Since   time.Time `json:"since"`
}

// Signals.
const (
	SignalEmpty        = "empty"
	SignalSearchedCode = "searched-then-code"
	SignalReadCode     = "read-then-code"
)

// gapWindow: hasta cuándo una ida al código se atribuye a la consulta anterior.
const gapWindow = 20 * time.Minute

/* canonDevSession: desde cuántos comandos en `tools/canon` una sesión es de DESARROLLO de canon, y
 * ninguna de sus consultas cuenta. Un curl suelto a la API de prod en medio de esa sesión es una sonda
 * (¿qué forma tiene la respuesta?), no una pregunta de trabajo, y por comando no se distingue. Medido el
 * 2026-09-27: las sesiones de trabajo tienen de 0 a 6 comandos ahí, las de desarrollo de 131 a 2.235. */
const canonDevSession = 20

func isCanonDevSession(s Session) bool {
	n := 0
	for _, c := range s.Calls {
		if strings.Contains(c.Command, "tools/canon") {
			n++
		}
	}
	return n >= canonDevSession
}

// GapsView recorre cada sesión en orden: una consulta abre una ventana, la próxima consulta o el tiempo
// la cierran, y lo que cae adentro decide la señal.
func GapsView(sessions []Session, since time.Time) Gaps {
	out := Gaps{Since: since}
	type event struct {
		signal, query, session string
		at                     time.Time
		repos                  []string
	}
	var events []event
	for _, s := range sessions {
		devSession := isCanonDevSession(s)
		var open *event
		flush := func() {
			if open != nil && len(open.repos) > 0 {
				events = append(events, *open)
			}
			open = nil
		}
		for _, c := range s.Calls {
			if c.Time.Before(since) {
				continue
			}
			if l := c.Canon; l != nil {
				switch {
				case l.Dev || devSession:
					out.Dev++
					continue
				case l.Kind == LookupWrite:
					out.Writes++
					continue
				}
				flush()
				out.Lookups++
				if l.Empty {
					events = append(events, event{signal: SignalEmpty, query: l.Query, session: s.ID, at: c.Time})
					continue
				}
				signal := SignalSearchedCode
				if l.Kind != LookupSearch {
					signal = SignalReadCode
				}
				open = &event{signal: signal, query: l.Query, session: s.ID, at: c.Time}
				continue
			}
			if open != nil && c.Code != "" {
				if c.Time.Sub(open.at) > gapWindow {
					flush()
					continue
				}
				if !contains(open.repos, c.Code) {
					open.repos = append(open.repos, c.Code)
				}
			}
		}
		flush()
	}
	byKey := map[string]*Gap{}
	sessionsOf := map[string]map[string]bool{}
	for _, e := range events {
		key := e.signal + "\x00" + normalizeQuery(e.query)
		g := byKey[key]
		if g == nil {
			g = &Gap{Query: e.query, Signal: e.signal}
			byKey[key], sessionsOf[key] = g, map[string]bool{}
		}
		g.Times++
		sessionsOf[key][e.session] = true
		if e.at.After(g.Last) {
			g.Last = e.at
		}
		for _, r := range e.repos {
			if !contains(g.Repos, r) {
				g.Repos = append(g.Repos, r)
			}
		}
	}
	for key, g := range byKey {
		g.Sessions = len(sessionsOf[key])
		sort.Strings(g.Repos)
		out.Gaps = append(out.Gaps, *g)
	}
	sort.Slice(out.Gaps, func(i, j int) bool {
		a, b := out.Gaps[i], out.Gaps[j]
		if a.Sessions != b.Sessions {
			return a.Sessions > b.Sessions
		}
		return a.Last.After(b.Last)
	})
	return out
}

// normalizeQuery: la misma pregunta con otras mayúsculas, tildes o espacios es la misma.
func normalizeQuery(q string) string {
	q = strings.ToLower(strings.Join(strings.Fields(q), " "))
	return strings.NewReplacer("á", "a", "é", "e", "í", "i", "ó", "o", "ú", "u").Replace(q)
}

func contains(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}
