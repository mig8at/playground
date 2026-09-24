package hooks

/* destructive.go · PreToolUse sobre Bash: frena los comandos que pueden recrear una base de datos desde
 * `legacy-backend`.
 *
 * EL 2026-08-19 LA BASE COMPARTIDA DE DEV+STAGING QUEDÓ VACÍA. `phpunit.xml` fija `DB_DATABASE=testing`
 * pero nunca fijó `DB_HOST`, así que los tests se conectan al servidor que diga el `.env` — y las
 * credenciales que circulan son las del usuario maestro del RDS. Dos tests usaban `RefreshDatabase`
 * (`migrate:fresh`: borra todas las tablas). La guarda de CORE-431 ya contiene la suite a los hosts de
 * esta máquina, pero `make fresh` no pasa por ella, y correr una carpeta con el trait recrea TU base
 * local sin avisar. La regla completa: CLAUDE.md §«La suite de PHPUnit de legacy-backend NO se corre
 * entera».
 *
 * Esa regla era texto. Esto la vuelve un `PreToolUse` sobre Bash, que corre ANTES y de verdad impide:
 *
 *	1. `artisan test` / `phpunit` / `pest` SIN ruta                    → siempre (corre los 140 archivos)
 *	2. `migrate:fresh` · `migrate:refresh` · `db:wipe` · `make fresh`   → siempre
 *	3. `make test` desde legacy-backend                                → siempre (es `artisan test` pelado)
 *	4. `artisan test <ruta>` cuya ruta arrastra `RefreshDatabase`      → salvo que el comando lleve
 *	   (el trait en la clase, `uses(RefreshDatabase::class)` por         I_KNOW_THIS_RECREATES_MY_LOCAL_DB=1
 *	   archivo, o un `Pest.php` que lo ata al directorio)
 *
 * SÓLO CUENTA LO QUE ESTÁ EN POSICIÓN DE COMANDO. La primera versión miraba el texto entero y frenó un
 * `git commit` cuya descripción decía «make test»: un comando que NOMBRA la palabra no la ejecuta. Por
 * eso el comando se parte en segmentos (`&&`, `||`, `;`, `|`, salto de línea), se descartan los cuerpos
 * de heredoc, y de cada segmento se mira el ejecutable y sus argumentos.
 *
 * Sólo mira comandos que hablen de legacy-backend (por el cwd o por la ruta en el comando): un
 * `make test` en otro repo no es asunto de este hook. Exit 2 = bloquea y el motivo vuelve al modelo.
 * Cualquier error interno sale 0: un hook roto no puede impedir trabajar.
 *
 * Nació como `.claude/hooks/tests-destructivos.py` y pasó a Go el 2026-09-23, comparado comando por
 * comando contra esa versión. */

import (
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"unicode/utf8"

	"creditop/playground/tablero/server/internal/shell"
	"creditop/playground/tablero/server/internal/text"
)

const (
	legacyBackend = "legacy-backend"
	// Override es lo que el comando tiene que llevar para correr a propósito una ruta con el trait.
	Override = "I_KNOW_THIS_RECREATES_MY_LOCAL_DB=1"
)

var (
	segmentSep     = regexp.MustCompile(`&&|\|\||;|\||\n`)
	envPrefix      = regexp.MustCompile(`^(?:` + text.Space + `*[A-Za-z_][A-Za-z0-9_]*=` + text.NotSpace + `*` + text.Space + `+)*`)
	traitRe        = regexp.MustCompile(`(?m)^` + text.Space + `*use RefreshDatabase;|uses\(.*RefreshDatabase::class`)
	prefixes       = map[string]bool{"sudo": true, "time": true, "nohup": true, "env": true, "exec": true}
	artisanRunners = map[string]bool{"php": true, "sail": true, "docker": true, "docker-compose": true, "artisan": true}
	artisanSub     = []string{"test", "migrate:fresh", "migrate:refresh", "db:wipe"}
)

func runeAt(s string, i int) rune {
	r, _ := utf8.DecodeRuneInString(s[i:])
	return r
}

// spaceEnds: las posiciones donde puede terminar una corrida de espacios que empieza en `i`, de la más
// larga a la más corta (incluida `i`, la corrida vacía): el orden en que las prueba una expresión voraz.
func spaceEnds(s string, i int) []int {
	ends := []int{i}
	for j := i; j < len(s); {
		r, size := utf8.DecodeRuneInString(s[j:])
		if !text.IsSpace(r) {
			break
		}
		j += size
		ends = append(ends, j)
	}
	for a, b := 0, len(ends)-1; a < b; a, b = a+1, b-1 {
		ends[a], ends[b] = ends[b], ends[a]
	}
	return ends
}

// optional: con un carácter opcional en `i`, primero consumirlo y después no (así lo prueba `x?`).
func optional(s string, i int, chars string) []int {
	if i < len(s) && strings.IndexByte(chars, s[i]) >= 0 {
		return []int{i + 1, i}
	}
	return []int{i}
}

/* heredocAt emula, desde `i`, la expresión con que la guarda borraba los cuerpos de heredoc:
 *
 *	<<-?\s*['"]?(\w+)['"]?[^\n]*\n.*?\n\1\s*$        (con re.S y re.M)
 *
 * RE2 no tiene referencias hacia atrás (`\1`), así que se recorren las mismas alternativas en el mismo
 * orden en que las prueba un motor con retroceso, y gana la primera que cierra. Devuelve dónde termina. */
func heredocAt(s string, i int) (int, bool) {
	if !strings.HasPrefix(s[i:], "<<") {
		return 0, false
	}
	for _, j1 := range optional(s, i+2, "-") {
		for _, j2 := range spaceEnds(s, j1) {
			for _, j3 := range optional(s, j2, `'"`) {
				var wordEnds []int
				for j := j3; j < len(s); {
					r, size := utf8.DecodeRuneInString(s[j:])
					if !text.IsWord(r) {
						break
					}
					j += size
					wordEnds = append(wordEnds, j)
				}
				for w := len(wordEnds) - 1; w >= 0; w-- {
					word := s[j3:wordEnds[w]]
					for _, j4 := range optional(s, wordEnds[w], `'"`) {
						nl := strings.IndexByte(s[j4:], '\n')
						if nl < 0 {
							continue
						}
						for p := j4 + nl + 1; p < len(s); p++ {
							if s[p] != '\n' || !strings.HasPrefix(s[p+1:], word) {
								continue
							}
							after := p + 1 + len(word)
							for _, e := range spaceEnds(s, after) {
								if e == len(s) || s[e] == '\n' {
									return e, true
								}
							}
						}
					}
				}
			}
		}
	}
	return 0, false
}

// withoutHeredocs borra cada cuerpo de heredoc, de izquierda a derecha y sin solaparse, como `re.sub`.
func withoutHeredocs(s string) string {
	var out strings.Builder
	last := 0
	for i := 0; i < len(s); {
		if end, ok := heredocAt(s, i); ok {
			out.WriteString(s[last:i])
			last, i = end, end
			continue
		}
		_, size := utf8.DecodeRuneInString(s[i:])
		i += size
	}
	out.WriteString(s[last:])
	return out.String()
}

// Segments: los tramos del comando que corren cada uno su programa, sin los cuerpos de heredoc.
func Segments(cmd string) []string {
	var out []string
	for _, seg := range segmentSep.Split(withoutHeredocs(cmd), -1) {
		if seg = text.Strip(seg); seg != "" {
			out = append(out, seg)
		}
	}
	return out
}

// parts es `pathlib.Path(p).parts`: sin partes vacías ni `.`, y con `/` como primera si es absoluta.
func parts(p string) []string {
	var out []string
	if strings.HasPrefix(p, "/") {
		out = append(out, "/")
	}
	for _, part := range strings.Split(p, "/") {
		if part != "" && part != "." {
			out = append(out, part)
		}
	}
	return out
}

// name es `pathlib.Path(p).name`: la última parte, o nada si es la raíz o `.`.
func name(p string) string {
	ps := parts(p)
	if len(ps) == 0 || ps[len(ps)-1] == "/" {
		return ""
	}
	return ps[len(ps)-1]
}

func joinParts(ps []string) string {
	if len(ps) > 0 && ps[0] == "/" {
		return "/" + strings.Join(ps[1:], "/")
	}
	return strings.Join(ps, "/")
}

// executable: el nombre corto del programa que corre en este segmento, y el resto de la línea.
func executable(seg string) (string, string) {
	loc := envPrefix.FindStringIndex(seg)
	seg = text.Strip(seg[loc[1]:])
	toks := shell.Tokens(seg)
	for len(toks) > 0 && prefixes[name(toks[0])] {
		toks = toks[1:]
	}
	if len(toks) == 0 {
		return "", ""
	}
	return name(toks[0]), strings.Join(toks[1:], " ")
}

func wordBoundaryAfter(s string, i int) bool {
	return i >= len(s) || !text.IsWord(runeAt(s, i))
}

// artisanCall busca `artisan\s+(test|migrate:fresh|migrate:refresh|db:wipe)\b(.*)$` en la línea.
func artisanCall(line string) (string, string, bool) {
	for k := 0; ; {
		at := strings.Index(line[k:], "artisan")
		if at < 0 {
			return "", "", false
		}
		start := k + at
		j := start + len("artisan")
		ends := spaceEnds(line, j)
		if ends[0] > j {
			for _, sub := range artisanSub {
				if strings.HasPrefix(line[ends[0]:], sub) && wordBoundaryAfter(line, ends[0]+len(sub)) {
					return sub, line[ends[0]+len(sub):], true
				}
			}
		}
		k = start + 1
	}
}

// runnerCall busca `(phpunit|pest)\b(.*)$` en la línea: el primer lugar donde empieza uno de los dos.
func runnerCall(line string) (string, bool) {
	for i := 0; i < len(line); i++ {
		for _, runner := range []string{"phpunit", "pest"} {
			if strings.HasPrefix(line[i:], runner) && wordBoundaryAfter(line, i+len(runner)) {
				return line[i+len(runner):], true
			}
		}
	}
	return "", false
}

// Call es una invocación que de verdad EJECUTA algo de la lista: su tipo y el resto de su línea.
type Call struct{ Kind, Rest string }

// Calls: una por cada segmento que corre `make test|fresh`, artisan o un runner de tests.
func Calls(cmd string) []Call {
	var out []Call
	for _, seg := range Segments(cmd) {
		exe, rest := executable(seg)
		line := exe + " " + rest
		if exe == "make" {
			if fields := strings.FieldsFunc(rest, text.IsSpace); len(fields) > 0 && (fields[0] == "test" || fields[0] == "fresh") {
				out = append(out, Call{"make " + fields[0], ""})
			}
			continue
		}
		if artisanRunners[exe] || strings.HasSuffix(exe, "artisan") {
			if sub, r, ok := artisanCall(line); ok {
				out = append(out, Call{sub, r})
			}
			continue
		}
		if exe == "phpunit" || exe == "pest" {
			if r, ok := runnerCall(line); ok {
				out = append(out, Call{"test", r})
			}
		}
	}
	return out
}

// paths: los argumentos de `artisan test …` que son rutas, o sea lo que no empieza con `-`.
func paths(rest string) []string {
	var out []string
	for _, t := range shell.Tokens(rest) {
		if t != "" && !strings.HasPrefix(t, "-") {
			out = append(out, t)
		}
	}
	return out
}

func indexOf(ps []string, x string) int {
	for i, p := range ps {
		if p == x {
			return i
		}
	}
	return -1
}

// absolute lleva una ruta a absoluta como la ve la sesión: `~/` es el HOME y una relativa cuelga del cwd
// de la sesión, no del de este proceso.
func absolute(p, cwd, home string) string {
	if rest, ok := strings.CutPrefix(p, "~/"); ok {
		return filepath.Join(home, rest)
	}
	if p == "~" {
		return home
	}
	if !strings.HasPrefix(p, "/") && cwd != "" {
		return filepath.Join(cwd, p)
	}
	return p
}

/* repoRoot: la raíz de legacy-backend que el comando está usando — la de una ruta del comando, la del
 * cwd, o la de siempre.
 *
 * ⚠ DOS HUECOS QUE TENÍA LA VERSIÓN DE PYTHON, medidos el 2026-09-23 al portarla, y los dos dejaban
 * pasar lo que tenía que frenar:
 *   - `cd ~/Desktop/…/legacy-backend && sail artisan test <archivo con RefreshDatabase>` salía 0: la ruta
 *     se tomaba literal, con su `~`, y lo mismo una relativa (`cd legacy-backend`), que se resolvía contra
 *     la carpeta del hook y no contra la de la sesión. El archivo «no existía» y no había nada que frenar;
 *   - con un cwd que nombra el repo sin ser exactamente esa carpeta (un worktree `legacy-backend-x`), la
 *     búsqueda de la parte fallaba, la guarda caía en su «error interno, no se bloquea» y no revisaba
 *     la ruta. Ahí la raíz es la carpeta que lo nombra. */
func repoRoot(cmd, cwd, home string) string {
	for _, tok := range shell.Tokens(cmd) {
		if strings.Contains(tok, legacyBackend) {
			ps := parts(absolute(strings.Trim(tok, `'"`), cwd, home))
			if i := indexOf(ps, legacyBackend); i >= 0 {
				return joinParts(ps[:i+1])
			}
		}
	}
	if cwd != "" && strings.Contains(cwd, legacyBackend) {
		ps := parts(absolute(cwd, "", home))
		for i, p := range ps {
			if strings.Contains(p, legacyBackend) {
				return joinParts(ps[:i+1])
			}
		}
	}
	return filepath.Join(home, "Desktop", "CREDITOP", "github", legacyBackend)
}

func isFile(p string) bool {
	info, err := os.Stat(p)
	return err == nil && info.Mode().IsRegular()
}

func isDir(p string) bool {
	info, err := os.Stat(p)
	return err == nil && info.IsDir()
}

func readIgnoring(p string) (string, bool) {
	raw, err := os.ReadFile(p)
	if err != nil {
		return "", false
	}
	if utf8.Valid(raw) {
		return string(raw), true
	}
	var sb strings.Builder
	for len(raw) > 0 {
		r, size := utf8.DecodeRune(raw)
		if !(r == utf8.RuneError && size == 1) {
			sb.Write(raw[:size])
		}
		raw = raw[size:]
	}
	return sb.String(), true
}

// parent es `pathlib.Path(p).parent`.
func parent(p string) string {
	ps := parts(p)
	switch {
	case len(ps) == 0:
		return "."
	case len(ps) == 1 && ps[0] == "/":
		return "/"
	case len(ps) == 1:
		return "."
	}
	return joinParts(ps[:len(ps)-1])
}

func join(base, rel string) string {
	if strings.HasPrefix(rel, "/") {
		return rel
	}
	if base == "." || base == "" {
		return joinParts(parts(rel))
	}
	return joinParts(parts(base + "/" + rel))
}

/* dragsTrait: qué archivos de esa ruta activan RefreshDatabase, en cualquiera de las TRES formas: el
 * trait en la clase, `uses(...RefreshDatabase::class)` por archivo, y un `Pest.php` en la ruta o en sus
 * padres que lo ate al directorio con `->in(...)`. */
func dragsTrait(p string) []string {
	var found []string
	var files []string
	fileGiven := isFile(p)
	switch {
	case fileGiven:
		files = []string{p}
	case isDir(p):
		_ = filepath.WalkDir(p, func(f string, d os.DirEntry, err error) error {
			if err == nil && !d.IsDir() && strings.HasSuffix(d.Name(), ".php") {
				files = append(files, f)
			}
			return nil
		})
		sort.Strings(files)
	}
	for _, f := range files {
		body, ok := readIgnoring(f)
		if !ok || !traitRe.MatchString(body) {
			continue
		}
		base := p
		if fileGiven {
			base = parent(p)
		}
		rel, err := filepath.Rel(base, f)
		if err != nil {
			rel = f
		}
		found = append(found, rel)
	}
	base := p
	if !isDir(p) {
		base = parent(p)
	}
	for _, pest := range []string{join(base, "Pest.php"), join(parent(base), "Pest.php"), join(parent(parent(base)), "Pest.php")} {
		if body, ok := readIgnoring(pest); ok && strings.Contains(body, "RefreshDatabase") {
			found = append(found, pest+" (ata el trait al directorio con uses(...)->in(...))")
		}
	}
	return found
}

// Guard es la decisión sobre un comando: los motivos para frenarlo (ninguno = pasa).
func Guard(cmd, cwd, home string) []string {
	if cmd == "" || !(strings.Contains(cmd, legacyBackend) || strings.Contains(cwd, legacyBackend)) {
		return nil
	}
	var reasons []string
	for _, call := range Calls(cmd) {
		switch call.Kind {
		case "migrate:fresh", "migrate:refresh", "db:wipe", "make fresh":
			reasons = append(reasons, "recrea la base (`migrate:fresh`/`refresh`, `db:wipe` o `make fresh`): apunta a donde diga "+
				"el `.env` + el entorno + `DATABASE_URL`, y así quedó vacía la BD compartida el 2026-08-19. "+
				"No se corre; si creés que hace falta, preguntá.")
			continue
		case "make test":
			reasons = append(reasons, "`make test` en legacy-backend es `artisan test` pelado: corre los 140 archivos, incluido el "+
				"que lleva `RefreshDatabase`. Corré SOLO lo que valida la tarea, con ruta explícita.")
			continue
		}
		// call.Kind == "test": artisan test · phpunit · pest
		ps := paths(call.Rest)
		if len(ps) == 0 {
			reasons = append(reasons, "`artisan test`/`phpunit`/`pest` SIN ruta corre la suite entera. Siempre con ruta: "+
				"`./vendor/bin/sail artisan test <ruta/al/archivo o carpeta>` (y `--filter=` para acotar más).")
			continue
		}
		if strings.Contains(cmd, Override) {
			continue
		}
		root := repoRoot(cmd, cwd, home)
		for _, r := range ps {
			p := absolute(r, root, home)
			if found := dragsTrait(p); len(found) > 0 {
				shown, more := found, ""
				if len(found) > 5 {
					shown, more = found[:5], " …"
				}
				reasons = append(reasons, "la ruta `"+r+"` arrastra `RefreshDatabase` — recrea TU base local (`migrate:fresh`) "+
					"antes de correr. Archivos: "+strings.Join(shown, ", ")+more+". Si es lo que querés, agregá "+
					Override+" al comando.")
			}
		}
	}
	return reasons
}
