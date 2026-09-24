// Package citations contesta si las referencias `archivo:línea` de un documento siguen apuntando a lo
// que dicen. Vive en el tablero porque el tablero es quien lo necesita para siempre: las trampas del
// sistema (`F-xx`) guardan ~150 citas al código de la compañía y sin esto envejecen en silencio.
//
// ⚠ NACIÓ EN `context/tools/refs.py`, se mudó a `tablero/tools/citations.py` el 2026-09-21 y pasó a Go
// el 2026-09-23 comparando salida contra salida. Es el mismo motor, no una copia: dos motores de citas
// derivan, y el síntoma de la deriva sería un verde. La lista de repos y el índice de «qué existe en
// main» son de `internal/repos`, porque también los usan el trazador y `workers`.
//
// CÓMO LO SABE: el ANCLA DE GIT, no el símbolo de la prosa.
//
// La versión anterior buscaba en el texto del doc un símbolo en backticks pegado a la cita y verificaba
// que estuviera cerca de la línea. **Nunca funcionó ni una vez.** La cita misma va entre backticks
// (“ `routes/customer.php:236-239` “), así que lo que hay justo antes es el backtick de APERTURA y la
// regex jamás cerraba par. Medido el 2026-07-31: de 889 citas «ok», **889 eran solo chequeo de rango**
// —«el archivo tiene al menos 236 líneas»— y CERO habían comprobado un símbolo. Una cita corrida seis
// líneas pasó en verde y se selló un nodo con ella.
//
// Y emparejar la cita con el símbolo contiguo TAMPOCO se puede: los documentos no tienen convención
// fija —a veces va antes, a veces después, y muchas veces lo de al lado es una celda de tabla o un
// string de ruta—. Al probarlo, los matches agarraban el símbolo equivocado. Forzarlo produce «movidas»
// falsas, que es peor que no chequear: te manda a arreglar lo que está bien.
//
// Lo confiable no está en la prosa, está en git:
//
//  1. ¿cuándo se afirmó esta cita? `max(sello del documento, fecha en que se escribió esa línea)` — el
//     sello sale de un `map.json` al lado del documento, si lo hay; la otra de `git blame` sobre el
//     propio documento. El `max` NO es un detalle: sin él, corregir una cita la vuelve a romper (ver
//     `writtenAt`);
//  2. se abre el archivo citado en `main` **a esa fecha** y se guarda el TEXTO de la línea — el ancla;
//  3. se busca ese texto en `main` hoy → si está en otra línea, se dice en cuál.
//
// Sin convención que imponer, sin adivinar, y funciona igual para las citas sin símbolo (la mayoría).
// Sigue renombres: un archivo pudo cambiar de ruta desde entonces —pasó con `frontend-e2e/` →
// `harness/` el 2026-07-31— y sin seguirlos todas las citas de ese documento dirían «no existía».
//
// BALDES, y separarlos es lo que hace que se le pueda creer:
//
//	✓ ok         el ancla sigue exactamente en esa línea.
//	· corrida    desalineada ≤3 líneas: el bloque es el mismo, el archivo ganó algo arriba. No falla.
//	⚠ movida     el ancla está en OTRA línea → viene el número correcto. No marca: corrige.
//	⚠ reescrita  el ancla ya no está en el archivo: la línea se editó o se borró. Pide leer.
//	⚠ fuera      la línea no existe: el archivo tiene menos líneas.
//	· sin ancla  NO se pudo anclar (línea en blanco al sellar, ancla demasiado corta para ser única, el
//	             archivo no existía, o el documento no tiene sello). Se cae al chequeo de rango, que es
//	             débil — y por eso va en su propio balde en vez de disfrazarse de ✓.
//	? ambigua    el nombre matchea varios archivos y NINGUNO valida: el destino dependería de cuál se
//	             elija, así que no se ofrece corrección. Se listan los veredictos de todos.
//	? corta      “ `:123` “ relativa al contexto: NADIE la valida. Son la mitad de las citas con número
//	             de línea, así que el resumen las declara — un verde que cubre el 50 % y no lo dice es
//	             la misma trampa que el chequeo débil de antes. Se arreglan escribiendo la ruta
//	             completa; por qué no se resuelven solas, en el comentario de `short`.
//	? no existe  ningún archivo matchea en `main`.
package citations

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"creditop/tablero/server/internal/repos"
	"creditop/tablero/server/internal/text"
)

const (
	// el ancla es TEXTO EXACTO: o está en esa línea o no está. La tolerancia de ±3 venía del método
	// viejo (buscaba un símbolo "cerca") y acá miente: con ±3, un bloque corrido 2 líneas se reportaba
	// como «inicio bien, fin movido» — media verdad.
	near = 0
	// hasta acá una cita desalineada es «corrida» (el archivo ganó un import arriba) y no «movida»
	// (apunta a otra parte). Se separan por prioridad, no se esconden.
	Minor = 3
	// caracteres no-espacio mínimos. Una línea `}` o `]);` matchea en 200 lugares: como ancla no
	// afirma nada, y tratarla como válida inventaría «movidas» al azar.
	anchorMin = 10
)

// Los baldes, con los nombres que imprime la salida.
const (
	OK         = "ok"
	Shifted    = "corrida"
	Moved      = "movida"
	Rewritten  = "reescrita"
	Outside    = "fuera"
	Unanchored = "sin-ancla"
	Ambiguous  = "ambigua"
	Short      = "corta"
	Missing    = "no-existe"
)

// `ruta/archivo.ext:123` o `…:123-145` — con o sin backticks. La extensión es obligatoria para no
// capturar cualquier `palabra:123`. El FIN del rango se captura a propósito: corregir solo el inicio
// de `:180-226` deja el final mintiendo, y un bloque que creció mueve las dos puntas distinto (pasó
// con `otp-verification.tsx`: el inicio se corrió 8 líneas y el fin 10, porque la función ganó dos
// líneas adentro). `\w` se escribe con clases Unicode: así matchea lo mismo que matcheaba en Python.
var ref = regexp.MustCompile(`([\p{L}\p{N}_][\p{L}\p{N}_./+\-]*\.(?:ts|tsx|php|mjs|cjs|js|jsx|vue|go)):([0-9]+)(?:-([0-9]+))?`)

// ── Citas en formato CORTO: “ `:169` “, relativas al archivo que nombra el contexto ─────────────────
// Son la MITAD de las citas con número de línea del árbol, y hasta el 2026-08-08 la herramienta no
// las veía: decía «0 movidas» sobre el 59% de las citas y el resto podía correrse en silencio. Es la
// misma familia del bug del encabezado —un verde que cubre menos de lo que aparenta—, por otra puerta.
//
// ⚠ NO SE RESUELVEN, Y ESO ES UNA DECISIÓN MEDIDA, NO PEREZA. Se intentó el 2026-08-08: resolver la
// cita corta contra el único archivo nombrado en la línea (o en la sección). Parecía seguro —440 de
// 903 tenían exactamente un candidato— y produjo **22 fallos falsos**, porque los docs nombran al
// sujeto por CLASE y no por archivo. El caso que lo tumbó:
//
//	hereda `ApiController` (`app/Http/Controllers/ApiController.php:7`) y responde con el trait
//	`App\Traits\ApiResponse`: `{success…}` (`:9`) o `{success:false…}` (`:33`)
//
// `:9` y `:33` son de `ApiResponse.php`, pero el trait no lleva extensión, así que la línea "nombra
// un solo archivo" y la resolución apunta al controller — que tiene 10 líneas. Forzar el
// emparejamiento manda a corregir lo que está bien. Así que se CUENTAN y se declaran, no se validan:
// el número honesto vale más que un verde que cubre la mitad. La salida es convertirlas a ruta
// completa, que sí se ancla.
var short = regexp.MustCompile("`:([0-9]+)(?:-([0-9]+))?`")

// Los docs eliden tramos con `...` o `…` (`Modules/Risk/.../SistecreditoController.php`).
var elision = regexp.MustCompile(`(?:\.{3}|…)/?`)

var blameHeader = regexp.MustCompile(`^[0-9a-f]{40} [0-9]+ ([0-9]+)`)

// Item es una cita en su balde: dónde está en el documento, cómo está escrita y qué se comprobó.
type Item struct{ Where, Citation, Note string }

func less(a, b Item) bool {
	if a.Where != b.Where {
		return a.Where < b.Where
	}
	if a.Citation != b.Citation {
		return a.Citation < b.Citation
	}
	return a.Note < b.Note
}

// Sorted devuelve una copia ordenada como la tupla (dónde, cita, nota).
func Sorted(items []Item) []Item {
	out := append([]Item(nil), items...)
	sort.SliceStable(out, func(i, j int) bool { return less(out[i], out[j]) })
	return out
}

// Checker guarda lo que ya le preguntó a git: el mismo archivo se abre muchas veces por documento.
type Checker struct {
	repos      *repos.Client
	playground string

	repoOf   map[string][2]string
	shaAt    map[string]string
	renames  map[string]map[string]string
	contents map[string][]string
	absent   map[string]bool

	existing map[string]bool
	byRel    map[string][][2]string
	byBase   map[string][][2]string
	indexed  []string // los alias indexados
}

// New arma el verificador sobre la lista de repos.
func New(client *repos.Client) *Checker {
	aliases := make([]string, 0, len(client.Indexed()))
	for alias := range client.Indexed() {
		aliases = append(aliases, alias)
	}
	sort.Strings(aliases) // el orden no decide nada: los candidatos se ordenan antes de evaluarse
	return &Checker{
		repos: client, playground: client.Playground, indexed: aliases,
		repoOf: map[string][2]string{}, shaAt: map[string]string{}, renames: map[string]map[string]string{},
		contents: map[string][]string{}, absent: map[string]bool{},
	}
}

func git(dir string, args ...string) (string, bool) {
	out, err := exec.Command("git", append([]string{"-C", dir}, args...)...).Output()
	if err != nil {
		return "", false
	}
	return toValid(out), true
}

// toValid reemplaza cada byte inválido por U+FFFD, como el `errors="replace"` con que se leía antes.
func toValid(b []byte) string {
	if utf8.Valid(b) {
		return string(b)
	}
	var sb strings.Builder
	for len(b) > 0 {
		r, size := utf8.DecodeRune(b)
		if r == utf8.RuneError && size == 1 {
			sb.WriteRune(utf8.RuneError)
		} else {
			sb.Write(b[:size])
		}
		b = b[size:]
	}
	return sb.String()
}

func runes(s string) int { return utf8.RuneCountInString(s) }

func head(s string, n int) string {
	if runes(s) <= n {
		return s
	}
	return string([]rune(s)[:n])
}

/* repoOfAlias: (raíz del repo, prefijo del alias dentro de esa raíz).
 *
 * ⚠ El alias `harness` NO es un repo: es un subdirectorio de `playground`. Sin normalizar acá, unos
 * comandos de git devuelven rutas relativas al subdirectorio y otros relativas a la raíz, y esa
 * asimetría ya causó dos bugs reales (alinear.py contaba 1 de 44 en vez de 16; refs.py armaba
 * `legacy-backend/legacy-backend/...`). Con toplevel+prefix hay una sola forma de nombrar un archivo. */
func (c *Checker) repoOfAlias(alias string) (string, string) {
	if got, ok := c.repoOf[alias]; ok {
		return got[0], got[1]
	}
	dir := c.repos.Indexed()[alias]
	top, ok := git(dir, "rev-parse", "--show-toplevel")
	pre, _ := git(dir, "rev-parse", "--show-prefix")
	res := [2]string{"", ""}
	if ok && strings.TrimSpace(top) != "" {
		res = [2]string{strings.TrimSpace(top), strings.TrimSpace(pre)}
	}
	c.repoOf[alias] = res
	return res[0], res[1]
}

func (c *Checker) refOf(repo string) string {
	if r, _ := c.repos.RefToIndex(repo); r != "" {
		return r
	}
	return "main"
}

/* shaAtDate: el commit al cierre de ese día — el estado que el documento dice haber verificado.
 *
 * ⚠ `repo` acá es el TOPLEVEL del clon, no un alias, así que la ref se resuelve desde la ruta. Contra
 * un `main` local atrasado el «cierre de hoy» cae en un commit de días atrás y toda la comparación se
 * corre con él. */
func (c *Checker) shaAtDate(repo, date string) string {
	key := repo + "\x00" + date
	if sha, ok := c.shaAt[key]; ok {
		return sha
	}
	out, _ := git(repo, "rev-list", "-1", "--before="+date+" 23:59:59", c.refOf(repo))
	c.shaAt[key] = strings.TrimSpace(out)
	return c.shaAt[key]
}

// renamesSince: {ruta_hoy: ruta_cuando_se_selló}, siguiendo cadenas (un archivo pudo renombrarse dos veces).
func (c *Checker) renamesSince(repo, sha string) map[string]string {
	key := repo + "\x00" + sha
	if got, ok := c.renames[key]; ok {
		return got
	}
	out, _ := git(repo, "log", "--diff-filter=R", "-M", "--name-status", "--format=", sha+".."+c.refOf(repo))
	direct := map[string]string{}
	for _, ln := range text.SplitLines(out) {
		p := strings.Split(ln, "\t")
		if len(p) == 3 && strings.HasPrefix(p[0], "R") {
			direct[p[2]] = p[1] // nuevo -> viejo
		}
	}
	origin := func(p string) string {
		seen := map[string]bool{}
		for {
			prev, ok := direct[p]
			if !ok || seen[p] {
				return p
			}
			seen[p] = true
			p = prev
		}
	}
	res := map[string]string{}
	for n := range direct {
		res[n] = origin(n)
	}
	c.renames[key] = res
	return res
}

// content: el archivo tal como está en ese commit, o nil si ahí no existe.
func (c *Checker) content(repo, sha, path string) []string {
	key := repo + "\x00" + sha + "\x00" + path
	if c.absent[key] {
		return nil
	}
	if got, ok := c.contents[key]; ok {
		return got
	}
	out, ok := git(repo, "show", sha+":"+path)
	if !ok {
		c.absent[key] = true
		return nil
	}
	lines := text.SplitLines(out)
	if lines == nil {
		lines = []string{}
	}
	c.contents[key] = lines
	return lines
}

/* inRef: el archivo tal como está en `ref` (por defecto `main`), NO como está en disco.
 *
 * ⚠ ESTE ES EL MISMO BUG QUE SE ARREGLÓ EN `oracle.py`, y reapareció una vez. Leer el working tree hace
 * que el veredicto dependa de **qué rama tengas checkeada**: con una feature branch puesta, tus propios
 * cambios sin mergear se reportan como citas movidas. Pasó el 2026-08-03 — 6 líneas agregadas a
 * `config/services.php` en una rama de trabajo hicieron aparecer una «movida» en el nodo
 * `bancolombia`, y la cita contra `main` estaba perfecta. Se compara main-entonces contra main-hoy, y
 * el disco no entra. */
func (c *Checker) inRef(alias, ref, rel string) []string {
	repo, pre := c.repoOfAlias(alias)
	if repo == "" {
		return nil
	}
	return c.content(repo, ref, pre+rel)
}

/* writtenAt: {nº de línea del doc: fecha en que se escribió esa línea} — `git blame` sobre el propio doc.
 *
 * ⚠ ESTO NO ES UN LUJO, ES LO QUE HACE QUE LA HERRAMIENTA SE PUEDA USAR DOS VECES. El ancla se lee
 * del archivo citado «en la fecha del sello», y el número de línea de la cita solo tiene sentido contra
 * ESA fecha: son un par. Si alguien corrige `:180`→`:185` sin re-sellar, la corrida siguiente lee el
 * baseline viejo en la línea 185 —donde entonces había otro código— y vuelve a «corregir» con el mismo
 * desplazamiento. Pasó en la primera prueba: las 8 correcciones recién aplicadas reaparecieron como
 * movidas, +5 otra vez.
 *
 * El baseline correcto de cada cita es el momento en que ALGUIEN AFIRMÓ que era cierta, o sea
 * `max(sello, fecha en que se escribió esa línea)`. Una línea corregida hoy se ancla contra hoy y no da
 * falso positivo; una línea vieja en un documento viejo sigue detectando la deriva.
 *
 * Las líneas sin commitear salen con fecha de hoy (blame las marca `0000…`), que es lo correcto:
 * acabás de escribirlas. */
func (c *Checker) writtenAt(doc string) map[int]string {
	out, _ := git(c.playground, "blame", "--line-porcelain", "-w", "--", doc)
	dates := map[int]string{}
	ln, ts, haveTS := 0, int64(0), false
	for _, row := range text.SplitLines(out) {
		if m := blameHeader.FindStringSubmatch(row); m != nil {
			ln, _ = strconv.Atoi(m[1])
			haveTS = false
		} else if ln != 0 && strings.HasPrefix(row, "committer-time ") {
			ts, _ = strconv.ParseInt(strings.Fields(row)[1], 10, 64)
			haveTS = true
		} else if ln != 0 && haveTS && strings.HasPrefix(row, "committer-tz ") {
			// ⚠ la fecha va en la zona de quien commiteó, NO en UTC. En UTC, un commit de las 19:00 en
			// Colombia (UTC-5) salía fechado al DÍA SIGUIENTE, y un baseline un día más nuevo de la
			// cuenta se come la deriva de ese día sin avisar.
			tz := strings.Fields(row)[1]
			hh, _ := strconv.Atoi(tz[1:3])
			mm, _ := strconv.Atoi(tz[3:5])
			off := int64(hh*3600 + mm*60)
			if tz[0] != '+' {
				off = -off
			}
			dates[ln] = time.Unix(ts+off, 0).UTC().Format("2006-01-02")
		}
	}
	return dates
}

// locate: (línea de hoy más cercana a `expected`, cuántas coincidencias) · (0, 0) si el ancla no sirve.
// Un ancla corta (`}`, `});`, `return;`) matchea en decenas de lugares: no afirma nada, y tratarla como
// válida inventa correcciones al azar. Se rechaza antes de buscar.
func locate(anchor string, today []string, expected int) (int, int) {
	if runes(strings.ReplaceAll(anchor, " ", "")) < anchorMin {
		return 0, 0
	}
	hits := hitsOf(anchor, today)
	if len(hits) == 0 {
		return 0, 0
	}
	return closest(hits, expected), len(hits)
}

func hitsOf(anchor string, today []string) []int {
	var hits []int
	for i, l := range today {
		if text.Strip(l) == anchor {
			hits = append(hits, i+1)
		}
	}
	return hits
}

// closest: la coincidencia más cercana; ante un empate, la primera.
func closest(hits []int, n int) int {
	best := hits[0]
	for _, h := range hits[1:] {
		if abs(h-n) < abs(best-n) {
			best = h
		}
	}
	return best
}

func abs(x int) int {
	if x < 0 {
		return -x
	}
	return x
}

// lineAt: la línea `n` (desde 1). Con `n` = 0 devuelve la última, como el índice -1 de antes.
func lineAt(lines []string, n int) string {
	if n == 0 {
		return lines[len(lines)-1]
	}
	return lines[n-1]
}

type verdict struct{ key, note string }

// byAnchor: (ok | corrida | movida | reescrita, nota), o false si no se pudo anclar (→ cae al rango).
func (c *Checker) byAnchor(alias, rel string, n, end int, date string, today []string) (verdict, bool) {
	repo, pre := c.repoOfAlias(alias)
	if repo == "" || date == "" {
		return verdict{}, false
	}
	sha := c.shaAtDate(repo, date)
	if sha == "" {
		return verdict{}, false
	}
	full := pre + rel
	was := full
	if old, ok := c.renamesSince(repo, sha)[full]; ok {
		was = old
	}
	base := c.content(repo, sha, was)
	if base == nil || n > len(base) || len(base) == 0 {
		return verdict{}, false // el archivo (o la línea) no existía al sellar
	}
	anchor := text.Strip(lineAt(base, n))
	if runes(strings.ReplaceAll(anchor, " ", "")) < anchorMin {
		return verdict{}, false // ancla demasiado corta para afirmar nada
	}
	hits := hitsOf(anchor, today)
	if len(hits) == 0 {
		return verdict{Rewritten, "la línea de entonces ya no está: «" + head(anchor, 56) + "»"}, true
	}
	moved := true
	for _, h := range hits {
		if abs(h-n) <= near {
			moved = false
		}
	}
	ini := closest(hits, n)

	// El fin del rango, si lo hay. NO se calcula como «inicio nuevo + largo viejo»: el bloque pudo
	// crecer por dentro. Se ancla igual que el inicio, y si su ancla no sirve se DICE, en vez de
	// devolver un número inventado que el que corrige va a copiar tal cual.
	tail := ""
	if end != 0 && n < end && end <= len(base) {
		start := n
		if moved {
			start = ini
		}
		endAnchor := text.Strip(base[end-1])
		fNew, fCount := locate(endAnchor, today, start+(end-n))
		switch {
		case fNew == 0:
			tail = fmt.Sprintf(" · el fin (:%d) no se ancla («%s»): revisalo a mano", end, head(endAnchor, 18))
		case fCount > 1:
			tail = fmt.Sprintf(" · fin ≈ :%d, pero ese ancla se repite %d×: confirmalo", fNew, fCount)
		case moved:
			tail = fmt.Sprintf(" → rango :%d-%d", ini, fNew)
		case fNew != end:
			// el inicio no se movió pero el bloque creció: el rango igual quedó mal
			degree := Moved
			if abs(fNew-end) <= Minor {
				degree = Shifted
			}
			return verdict{degree, fmt.Sprintf("%s: el inicio :%d sigue bien, pero el rango termina en :%d", alias, n, fNew)}, true
		}
	}

	if !moved {
		return verdict{OK, "ancla" + tail}, true
	}
	extra := ""
	if len(hits) > 1 {
		extra = fmt.Sprintf(" (y %d coincidencia(s) más)", len(hits)-1)
	}
	// Se separa por MAGNITUD, y no es cosmética. Con match exacto aparecen 37 citas desalineadas, pero
	// 31 lo están por 1-3 líneas (el archivo ganó un import arriba) y 6 apuntan a otra parte del
	// archivo. Mezclarlas ahoga las que importan; esconder las chicas bajo una tolerancia es afirmar
	// que una cita es correcta cuando no lo es. Van en baldes distintos y solo las grandes fallan.
	degree := Moved
	if abs(ini-n) <= Minor {
		degree = Shifted
	}
	// El alias va SIEMPRE en la corrección: cuando la cita matchea varios repos (`config/app.php` vive
	// en dos, `UserRequestController.php` en cinco), un «está en :178» pelado no dice en cuál se
	// comprobó — y editar el doc a ciegas con ese número es cambiar una cita correcta por otra.
	return verdict{degree, fmt.Sprintf("%s: está en :%d%s%s", alias, ini, extra, tail)}, true
}

// index arma los mapas para resolver una cita: por relpath completo y por basename. Cada repo se mira
// con la ref que contiene a la otra (`repos.RefToIndex`).
func (c *Checker) index() {
	if c.existing != nil {
		return
	}
	have, _, _ := c.repos.InRef("")
	c.existing, c.byRel, c.byBase = map[string]bool{}, map[string][][2]string{}, map[string][][2]string{}
	for _, f := range have {
		c.existing[f] = true
		alias, rel, _ := strings.Cut(f, "/")
		c.byRel[rel] = append(c.byRel[rel], [2]string{alias, rel})
		c.byBase[filepath.Base(rel)] = append(c.byBase[filepath.Base(rel)], [2]string{alias, rel})
	}
}

// resolve: los candidatos [(alias, relpath)] para una cita tal como está escrita en el doc.
func (c *Checker) resolve(citation string) [][2]string {
	// Los docs eliden tramos con `...` o `…`. Es un estilo de escritura, no una ruta rota: se toma lo
	// que va DESPUÉS de la última elisión y se resuelve por sufijo. Sin esto, 7 citas válidas caían en
	// "no existe".
	if strings.Contains(citation, "...") || strings.Contains(citation, "…") {
		parts := elision.Split(citation, -1)
		citation = strings.TrimLeft(parts[len(parts)-1], "/")
	}
	// 0) la cita YA trae el alias. Sin este caso primero, el paso 1 le pega otro alias delante y arma
	//    `legacy-backend/legacy-backend/app/...`: no resuelve y el archivo aparece como inexistente.
	if c.existing[citation] {
		alias, rel, _ := strings.Cut(citation, "/")
		return [][2]string{{alias, rel}}
	}
	// 1) con cada alias por delante — y se RECOLECTAN TODOS, no se devuelve el primero. Devolver el
	//    primero hacía que `config/services.php` resolviera a `legacy-application` (267 líneas) y
	//    reportara como deriva las citas :297/:303/:317, válidas en `legacy-backend` (371). Seis falsos
	//    positivos de una: el mismo archivo vive en dos repos, y elegir por orden de la lista es al azar.
	var inAlias [][2]string
	for _, alias := range c.indexed {
		if c.existing[alias+"/"+citation] {
			inAlias = append(inAlias, [2]string{alias, citation})
		}
	}
	if len(inAlias) > 0 {
		return inAlias
	}
	if got, ok := c.byRel[citation]; ok {
		return got
	}
	var suffix [][2]string
	for rel, vs := range c.byRel {
		if strings.HasSuffix(rel, "/"+citation) {
			suffix = append(suffix, vs...)
		}
	}
	if len(suffix) > 0 {
		return suffix
	}
	// el basename SOLO si la cita no traía directorio. Con directorio, caer al basename es
	// mis-resolución: `backend-e2e/main.go` (herramienta borrada) se pegaba al `main.go` de otro repo
	// y salía reportado como "fuera de rango", o sea deriva inventada.
	if strings.Contains(citation, "/") {
		return nil
	}
	return c.byBase[citation]
}

var order = []string{OK, Shifted, Moved, Rewritten, Unanchored, Outside}

func rank(key string) int {
	for i, k := range order {
		if k == key {
			return i
		}
	}
	return len(order)
}

// evaluate: (balde, nota) de una cita ya separada en archivo, línea y fin.
func (c *Checker) evaluate(citation string, n, end int, since string) (string, string) {
	cands := c.resolve(citation)
	if len(cands) == 0 {
		return Missing, ""
	}
	unique := map[[2]string]bool{}
	for _, cand := range cands {
		unique[cand] = true
	}
	sortedCands := make([][2]string, 0, len(unique))
	for cand := range unique {
		sortedCands = append(sortedCands, cand)
	}
	sort.Slice(sortedCands, func(i, j int) bool {
		if sortedCands[i][0] != sortedCands[j][0] {
			return sortedCands[i][0] < sortedCands[j][0]
		}
		return sortedCands[i][1] < sortedCands[j][1]
	})

	var verdicts []verdict
	for _, cand := range sortedCands {
		alias, rel := cand[0], cand[1]
		today := c.inRef(alias, c.repos.TodayRef(alias), rel)
		if today == nil {
			continue
		}
		if n > len(today) || len(today) == 0 {
			verdicts = append(verdicts, verdict{Outside, fmt.Sprintf("%s/%s: tiene %d líneas", alias, rel, len(today))})
			continue
		}
		if v, ok := c.byAnchor(alias, rel, n, end, since, today); ok {
			verdicts = append(verdicts, v)
		} else {
			verdicts = append(verdicts, verdict{Unanchored, "solo se verificó que la línea existe"})
		}
	}

	// Con varios candidatos NO se adivina, pero tampoco se tira la toalla: si ALGUNO valida, la cita
	// está bien. Con el ancla esto además DESAMBIGUA solo — el archivo equivocado no contiene ese texto.
	if len(verdicts) == 0 {
		return Missing, "no se pudo leer"
	}
	best := verdicts[0]
	for _, v := range verdicts[1:] {
		if rank(v.key) < rank(best.key) {
			best = v
		}
	}
	key, note := best.key, best.note

	if len(cands) > 1 {
		if key != Moved && key != Rewritten && key != Outside {
			// ALGUNO valida (`ok`/`corrida`), o el chequeo fue débil y NO propone ningún destino
			// (`sin-ancla`). En los dos casos no hay corrección que pueda salir del candidato
			// equivocado. Cuántos había se dice igual, porque saber que el nombre es compartido cambia
			// cómo se lee la cita.
			note += fmt.Sprintf(" · %d candidatos", len(cands))
		} else {
			// ⚠ NINGUNO VALIDA, Y ACÁ LA CORRECCIÓN NO SE PUEDE OFRECER. El destino que saldría es el
			// del candidato que el ranking puso primero, no el que la evidencia señala — y aplicarlo
			// rompe citas buenas. Medido el 2026-09-18 en el nodo `actors`: cinco citas a
			// `app/Models/User.php` (que existe en los DOS monolitos) salían como «movidas» a
			// `application`, con saltos de ~54 líneas; eran de `legacy-backend` y estaban corridas +1.
			// Se listan los veredictos de TODOS los candidatos, que es lo que deja decidir a quien lee.
			sorted := append([]verdict(nil), verdicts...)
			sort.SliceStable(sorted, func(i, j int) bool { return rank(sorted[i].key) < rank(sorted[j].key) })
			parts := make([]string, len(sorted))
			for i, v := range sorted {
				parts[i] = "[" + v.key + "] " + v.note
			}
			key = Ambiguous
			note = fmt.Sprintf("%d candidatos y ninguno valida — %s", len(cands), strings.Join(parts, " · "))
		}
	}
	return key, note
}

// ─── RECORRER DOCUMENTOS ─────────────────────────────────────────────────────────────────────────

/* stampOf: la fecha en que alguien declaró haber verificado el documento entero, si la hay.
 *
 * Sale de un `map.json` al lado del documento (`verified.date`) — el formato que usaba el árbol de
 * contexto. Un documento sin sello no queda sin validar: cada cita se ancla contra la fecha en que se
 * ESCRIBIÓ esa línea (`writtenAt`), que es más ajustada. Lo que se pierde es detectar deriva en una
 * línea vieja que nadie tocó, así que el resumen lo declara en vez de callarlo. */
func stampOf(doc string) string {
	raw, err := os.ReadFile(filepath.Join(filepath.Dir(doc), "map.json"))
	if err != nil {
		return ""
	}
	var m struct {
		Verified *struct {
			Date any `json:"date"`
		} `json:"verified"`
	}
	if json.Unmarshal(raw, &m) != nil || m.Verified == nil {
		return ""
	}
	date, _ := m.Verified.Date.(string)
	return date
}

// Label: cómo se nombra el documento en la salida, `<carpeta>/<archivo>`. La carpeta sola no alcanza
// (todos los documentos se llaman `doc.md`) y la ruta completa tampoco (ocupa media línea).
func Label(doc string) string {
	dir := filepath.Base(filepath.Dir(doc))
	if dir == string(filepath.Separator) {
		dir = "."
	}
	return dir + "/" + filepath.Base(doc)
}

// Result son los baldes y los documentos sin sello.
type Result struct {
	Buckets   map[string][]Item
	Unstamped []string
}

// Total: cuántas citas hay en todos los baldes.
func (r Result) Total() int {
	n := 0
	for _, items := range r.Buckets {
		n += len(items)
	}
	return n
}

// Review valida las citas de esos documentos.
func (c *Checker) Review(documents []string) Result {
	c.index()
	res := Result{Buckets: map[string][]Item{}}
	unstamped := map[string]bool{}
	for _, doc := range documents {
		info, err := os.Stat(doc)
		if err != nil || info.IsDir() {
			continue
		}
		name := Label(doc)
		date := stampOf(doc)
		if date == "" {
			unstamped[name] = true
		}
		abs, _ := filepath.Abs(doc)
		rel, err := filepath.Rel(c.playground, abs)
		if err != nil {
			rel = doc
		}
		blame := c.writtenAt(rel)
		raw, err := os.ReadFile(doc)
		if err != nil {
			continue
		}
		for i, line := range text.SplitLines(toValid(raw)) {
			where := fmt.Sprintf("%s:%d", name, i+1)
			// cuándo se afirmó esta cita: el sello del documento, o cuándo se escribió la línea si es
			// posterior (ver `writtenAt`). Sin este max, corregir una cita la rompe de nuevo.
			since := date
			if b := blame[i+1]; b > since {
				since = b
			}
			for _, m := range ref.FindAllStringSubmatch(line, -1) {
				citation := m[1]
				n, _ := strconv.Atoi(m[2])
				end := 0
				tag := fmt.Sprintf("%s:%d", citation, n)
				if m[3] != "" {
					end, _ = strconv.Atoi(m[3])
					tag += fmt.Sprintf("-%d", end)
				}
				key, note := c.evaluate(citation, n, end, since)
				res.Buckets[key] = append(res.Buckets[key], Item{where, tag, note})
			}
			// Cortas: se CUENTAN, no se validan (ver el comentario de `short`). Van por documento
			// para que se vea dónde conviene convertirlas a ruta completa.
			for _, m := range short.FindAllStringSubmatch(line, -1) {
				tag := ":" + m[1]
				if m[2] != "" {
					tag += "-" + m[2]
				}
				res.Buckets[Short] = append(res.Buckets[Short], Item{where, tag, "relativa al contexto: fuera del chequeo"})
			}
		}
	}
	for name := range unstamped {
		res.Unstamped = append(res.Unstamped, name)
	}
	sort.Strings(res.Unstamped)
	return res
}

var sections = []struct{ key, title string }{
	{Moved, "⚠ MOVIDAS — el ancla está en otra parte del archivo (viene la corrección)"},
	{Shifted, fmt.Sprintf("· CORRIDAS ≤%d líneas — desalineadas pero apuntan al mismo bloque", Minor)},
	{Rewritten, "⚠ REESCRITAS — la línea de entonces ya no está: hay que leer y decidir"},
	{Outside, "⚠ FUERA DE RANGO — la línea no existe"},
	{Ambiguous, "? AMBIGUAS — el nombre vive en varios repos y ninguno valida: la corrección dependería de cuál se elija"},
	{Unanchored, "· SIN ANCLA — solo se verificó que la línea existe (chequeo débil)"},
	{Short, "? CORTAS `:NNN` — relativas al contexto, FUERA del chequeo: nadie las valida. Convertí a ruta completa las que sostengan una afirmación importante"},
	{Missing, "? NO EXISTEN en main — artefacto generado / otra rama / herramienta borrada"},
}

// Pad rellena a la derecha hasta `width` caracteres (no bytes), como el `{:34s}` de antes.
func Pad(s string, width int) string {
	if n := runes(s); n < width {
		return s + strings.Repeat(" ", width-n)
	}
	return s
}

// Broken: ¿hay algo que corregir? Movidas, reescritas o fuera de rango.
func (r Result) Broken() bool {
	return len(r.Buckets[Moved]) > 0 || len(r.Buckets[Rewritten]) > 0 || len(r.Buckets[Outside]) > 0
}

// Report imprime los baldes y el resumen, y dice si hay que salir con 1.
func Report(w io.Writer, r Result, showOK bool) bool {
	b := r.Buckets
	for _, s := range sections {
		items := b[s.key]
		if len(items) == 0 {
			continue
		}
		fmt.Fprintf(w, "\n%s  (%d)\n", s.title, len(items))
		howMany := len(items)
		if !showOK && s.key == Unanchored && howMany > 12 {
			howMany = 12
		}
		for _, it := range Sorted(items)[:howMany] {
			fmt.Fprintf(w, "  %s %s %s\n", Pad(it.Where, 34), Pad(it.Citation, 58), it.Note)
		}
		if len(items) > howMany {
			fmt.Fprintf(w, "  … y %d más (--ok para verlas todas)\n", len(items)-howMany)
		}
	}
	if showOK && len(b[OK]) > 0 {
		fmt.Fprintf(w, "\n✓ OK (%d)\n", len(b[OK]))
		for _, it := range Sorted(b[OK]) {
			fmt.Fprintf(w, "  %s %s %s\n", Pad(it.Where, 34), Pad(it.Citation, 58), it.Note)
		}
	}

	fmt.Fprintf(w, "\n%d referencias · ✓ %d ancladas · ⚠ %d movidas · · %d corridas · ⚠ %d reescritas · ⚠ %d fuera · · %d sin ancla · ? %d ambiguas · ? %d no existen\n",
		r.Total(), len(b[OK]), len(b[Moved]), len(b[Shifted]), len(b[Rewritten]), len(b[Outside]),
		len(b[Unanchored]), len(b[Ambiguous]), len(b[Missing]))
	if shortOnes := len(b[Short]); shortOnes > 0 {
		validated := 0
		for _, k := range []string{OK, Shifted, Moved, Rewritten, Outside, Unanchored} {
			validated += len(b[k])
		}
		pct := validated * 100 / (validated + shortOnes)
		// por documento, en el orden en que aparecen, y los empates se quedan en ese orden
		var docs []string
		count := map[string]int{}
		for _, it := range b[Short] {
			d := it.Where[:strings.LastIndex(it.Where, ":")]
			if count[d] == 0 {
				docs = append(docs, d)
			}
			count[d]++
		}
		sort.SliceStable(docs, func(i, j int) bool { return count[docs[i]] > count[docs[j]] })
		if len(docs) > 5 {
			docs = docs[:5]
		}
		top := make([]string, len(docs))
		for i, d := range docs {
			top[i] = fmt.Sprintf("%s %d", d, count[d])
		}
		fmt.Fprintf(w, "⚠ %d citas en formato corto `:NNN` quedan FUERA del chequeo → lo de arriba cubre el %d%% de las citas con número de línea. Peores: %s\n",
			shortOnes, pct, strings.Join(top, " · "))
	}
	if len(r.Unstamped) > 0 {
		fmt.Fprintf(w, "⚠ sin `verified.date` al lado (se ancla por `git blame` del documento): %s\n", strings.Join(r.Unstamped, ", "))
	}
	fmt.Fprintln(w, "Las ambiguas y las que no existen NO son deriva: piden juicio, no arreglo automático.")
	return r.Broken()
}
