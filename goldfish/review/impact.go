package review

// EL MAPA DE IMPACTO de un cambio: qué toca, cuánto depende de eso y qué vigilar después. Sin modelo.
//
// Por qué existe. Los goldfish leen el diff en frío y el elephant le da veredicto a lo que encontraron; ninguno de los
// dos sabe, antes de empezar, qué partes del sistema conoce my-tools que el diff está tocando. Eso se puede calcular:
// las secciones de `knowledge/` que respaldan los archivos cambiados (el índice al revés, `knowledge.Touched`), las
// trampas (`F-xx`) que los citan, cuántos archivos dependen de cada uno, cuántos arreglos recibieron en los últimos 90
// días y si el cambio trae migraciones o rutas. Es la idea de los «diff risk score» que usan otros equipos (el riesgo
// de un cambio sale del cambio y de la historia de lo que toca), pero con reglas que se pueden leer, no un puntaje
// opaco: cada nivel dice por qué.
//
// Lo usan tres lugares: el elephant (lo recibe como `impact.md`, fuera de la carpeta de los goldfish, que siguen en
// frío), el informe y el resumen de la consola. `make goldfish-impact` lo da solo, en segundos, sin agentes.

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"creditop/my-tools/connectors/repos"
	"creditop/my-tools/knowledge"
	"creditop/my-tools/knowledge/traps"
)

// Impact: el mapa de impacto de un cambio.
type Impact struct {
	Level      string         `json:"level"` // high · medium · low
	Reasons    []string       `json:"reasons"`
	Files      int            `json:"files"`
	Added      int            `json:"added"`
	Deleted    int            `json:"deleted"`
	Areas      []string       `json:"areas"` // módulos o apps que toca
	Signals    []FileSignal   `json:"signals"`
	Knowledge  []KnowledgeHit `json:"knowledge"`
	Traps      []TrapHit      `json:"traps"`
	AfterMerge []string       `json:"afterMerge"` // qué hacer o vigilar después de mergear y desplegar
	NoTests    bool           `json:"noTests"`    // cambia código y ninguna prueba
	Notes      []string       `json:"notes,omitempty"`

	alias, base, repo string // para «después de mergear»
}

// FileSignal: lo que dice un archivo cambiado. Sólo se listan los que tienen algo que decir.
type FileSignal struct {
	Path      string   `json:"path"`
	Kinds     []string `json:"kinds"`     // migration · route · config · test
	FanIn     int      `json:"fanIn"`     // archivos de la base que lo nombran (cuánto depende de él)
	Commits90 int      `json:"commits90"` // commits en la base en los últimos 90 días
	Fixes90   int      `json:"fixes90"`   // de esos, los que son arreglos (fix, hotfix, bug, revert)
	OtherTwin string   `json:"otherTwin"` // la clase con el mismo nombre en el otro monolito, si la hay
}

// KnowledgeHit: una sección de knowledge que respaldan los archivos cambiados.
type KnowledgeHit struct {
	ID    string   `json:"id"`
	Title string   `json:"title"`
	Files []string `json:"files"`
}

// TrapHit: una trampa del sistema que cita un archivo cambiado.
type TrapHit struct {
	ID    string   `json:"id"`
	Title string   `json:"title"`
	Files []string `json:"files"`
}

// Thresholds: los umbrales del nivel. Están a la vista para poder discutirlos, y `make goldfish-calibrate` mide con
// qué valores el nivel separa los cambios que después necesitaron un arreglo.
type Thresholds struct {
	FixesHigh int // un archivo con tantos arreglos en 90 días: ya viene dando problemas
	FanInHigh int // un archivo que nombran tantos de la base
	BigFiles  int // un cambio de tantos archivos
}

// DefaultThresholds: calibrados el 2026-11-18 sobre 200 días de PRs (legacy-backend 314, frontend-monorepo 179): con
// dos de las tres señales, «alto» marca ~16 % y 63 % / 83 % de ésos necesitó un arreglo en 21 días (promedio 39 % / 53 %).
var DefaultThresholds = Thresholds{FixesHigh: 5, FanInHigh: 15, BigFiles: 20}

const maxFanIn = 40 // archivos a los que se les mide la dependencia, para que tarde segundos y no minutos

var (
	reFix       = regexp.MustCompile(`(?i)\b(fix|hotfix|bug|revert)`)
	reMigration = regexp.MustCompile(`(?i)(^|/)(database/)?migrations/`)
	// las rutas del backend (routes/api.php y compañía): en el frontend, `app/routes/` son pantallas, no un contrato
	reRoute  = regexp.MustCompile(`(^|/)routes/[^/]+\.php$`)
	reConfig = regexp.MustCompile(`(^|/)(config/|\.env)`)
	reTest   = regexp.MustCompile(`(?i)(^|/)tests?/|\.(test|spec)\.[jt]sx?$|Test\.php$`)
	reArea   = regexp.MustCompile(`^(Modules/[^/]+|apps/[^/]+|packages/[^/]+)/`)
	// en una trampa, una cita de archivo: `ruta/Archivo.php:12` o `Archivo.php`
	reCitedFile = regexp.MustCompile("[A-Za-z0-9_./-]+\\.(?:php|tsx?|jsx?|go|py|mjs)")
)

// los monolitos: lo que se arregla en uno suele vivir también en el otro
var otherMonolith = map[string]string{"legacy-backend": "legacy-application", "legacy-application": "legacy-backend"}

// nombres de archivo que aparecen en todos lados: citados solos, no dicen qué archivo es
var genericNames = map[string]bool{"index.ts": true, "index.tsx": true, "index.js": true, "main.go": true, "api.php": true,
	"web.php": true, "routes.ts": true, "app.tsx": true, "root.tsx": true, "utils.ts": true, "types.ts": true}

// Assess calcula el mapa de impacto del cambio `base...head` en el clon `repoDir`. `myTools` es la raíz de my-tools
// (de ahí salen knowledge, las trampas y tools/repos.json). Nada de esto escribe ni trae nada.
func Assess(ctx context.Context, myTools, repoDir, base, head string) Impact {
	src := source{myTools: myTools, knowledgeDir: filepath.Join(myTools, "knowledge")}
	if raw, err := os.ReadFile(traps.Doc(src.knowledgeDir)); err == nil {
		src.traps = string(raw)
	}
	im := measure(ctx, src, repoDir, base, head)
	im.Grade(DefaultThresholds)
	return im
}

// source: de dónde sale lo que my-tools sabe. Hoy, o como estaba un día (la calibración no puede mirar el futuro).
type source struct {
	myTools      string
	knowledgeDir string // "" = sin knowledge
	traps        string // el registro de trampas; "" = sin trampas
}

// measure: todo lo que se cuenta, sin el nivel.
func measure(ctx context.Context, src source, repoDir, base, head string) Impact {
	myTools := src.myTools
	im := Impact{Reasons: []string{}, Areas: []string{}, Signals: []FileSignal{}, Knowledge: []KnowledgeHit{},
		Traps: []TrapHit{}, AfterMerge: []string{}, base: base, repo: filepath.Base(repoDir)}
	numstat, err := git(ctx, repoDir, "diff", "--numstat", base+"..."+head)
	if err != nil {
		im.Level = "low"
		im.Notes = append(im.Notes, "no se pudo leer el diff: "+err.Error())
		return im
	}
	var files []string
	areas := map[string]bool{}
	for _, line := range strings.Split(numstat, "\n") {
		parts := strings.SplitN(line, "\t", 3)
		if len(parts) != 3 {
			continue
		}
		a, _ := strconv.Atoi(parts[0]) // "-" en un binario: cuenta 0
		d, _ := strconv.Atoi(parts[1])
		path := renamedTo(parts[2])
		im.Added, im.Deleted = im.Added+a, im.Deleted+d
		files = append(files, path)
		if m := reArea.FindStringSubmatch(path); m != nil {
			areas[m[1]] = true
		}
	}
	im.Files = len(files)
	for a := range areas {
		im.Areas = append(im.Areas, a)
	}
	sort.Strings(im.Areas)

	client := repos.New(filepath.Join(myTools, "tools"))
	alias := knowledge.AliasOf(client, filepath.Base(repoDir))
	im.alias = alias
	until := commitDate(ctx, repoDir, base)

	// 1 · cada archivo: qué es, cuánto depende de él y cómo viene
	codeChanged, testChanged := false, false
	measured := 0
	for _, f := range files {
		s := FileSignal{Path: f}
		switch {
		case reMigration.MatchString(f):
			s.Kinds = append(s.Kinds, "migration")
		case reTest.MatchString(f):
			s.Kinds = append(s.Kinds, "test")
		}
		if reRoute.MatchString(f) {
			s.Kinds = append(s.Kinds, "route")
		}
		if reConfig.MatchString(f) {
			s.Kinds = append(s.Kinds, "config")
		}
		if contains(s.Kinds, "test") {
			testChanged = true
		} else if isCode(f) {
			codeChanged = true
		}
		if isCode(f) && !contains(s.Kinds, "test") && !contains(s.Kinds, "migration") && measured < maxFanIn {
			measured++
			s.FanIn = fanIn(ctx, repoDir, base, f)
			s.Commits90, s.Fixes90 = history(ctx, repoDir, base, f, until)
			if other, ok := otherMonolith[alias]; ok && strings.HasSuffix(f, ".php") {
				s.OtherTwin = twin(ctx, client.MainRoot(other), other, f)
			}
		}
		if len(s.Kinds) > 0 || s.FanIn > 0 || s.Fixes90 > 0 || s.OtherTwin != "" {
			im.Signals = append(im.Signals, s)
		}
	}
	sort.SliceStable(im.Signals, func(i, j int) bool { return weight(im.Signals[i]) > weight(im.Signals[j]) })

	// 2 · lo que my-tools sabe de esos archivos: secciones de knowledge y trampas
	im.NoTests = codeChanged && !testChanged
	if src.knowledgeDir == "" || alias == "" {
		// sin knowledge (no existía ese día, o el repo no es citable)
	} else if lib, err := knowledge.Open(src.knowledgeDir); err == nil {
		var rf []knowledge.RepoFile
		for _, f := range files {
			rf = append(rf, knowledge.RepoFile{Repo: alias, Path: f})
		}
		for _, t := range lib.Touched(rf) {
			im.Knowledge = append(im.Knowledge, KnowledgeHit{ID: t.ID, Title: t.Title, Files: t.Files})
		}
	} else {
		im.Notes = append(im.Notes, "no se pudo abrir knowledge: "+err.Error())
	}
	if src.traps == "" {
		im.Notes = append(im.Notes, "no se pudieron leer las trampas")
	} else if hits := trapsCiting(src.traps, files); hits != nil {
		im.Traps = hits
	}
	return im
}

// Grade le pone el nivel, las razones y lo de después de mergear, con esos umbrales.
func (im *Impact) Grade(th Thresholds) {
	// las tres señales que, medidas, separan los cambios que después necesitaron un arreglo (make goldfish-calibrate)
	var fixes, fans []string
	for _, s := range im.Signals {
		if s.Fixes90 >= th.FixesHigh && len(fixes) < 3 {
			fixes = append(fixes, fmt.Sprintf("`%s` viene con %d arreglos en 90 días", s.Path, s.Fixes90))
		}
		if s.FanIn >= th.FanInHigh && len(fans) < 3 {
			fans = append(fans, fmt.Sprintf("`%s` lo nombran %d archivos de la base", s.Path, s.FanIn))
		}
	}
	strong, reasons := 0, []string{}
	if len(fixes) > 0 {
		strong++
		reasons = append(reasons, fixes...)
	}
	if len(fans) > 0 {
		strong++
		reasons = append(reasons, fans...)
	}
	if im.Files >= th.BigFiles {
		strong++
		reasons = append(reasons, fmt.Sprintf("es grande: %d archivos, +%d −%d", im.Files, im.Added, im.Deleted))
	}
	secondary := false
	if len(im.Traps) > 0 {
		secondary = true
		reasons = append(reasons, fmt.Sprintf("toca archivos de %d trampa(s) ya vividas: mirá si este cambio las arregla o las vuelve a pisar", len(im.Traps)))
	}
	if len(im.Knowledge) > 0 {
		secondary = true
		reasons = append(reasons, fmt.Sprintf("toca lo que explican %d sección(es) de knowledge", len(im.Knowledge)))
	}
	// información que, medida, no predice arreglos: se dice, pero no cambia el nivel
	for _, s := range im.Signals {
		if contains(s.Kinds, "route") {
			reasons = append(reasons, fmt.Sprintf("(no cambia el nivel) cambia rutas: `%s`", s.Path))
			break
		}
	}
	for _, s := range im.Signals {
		if s.OtherTwin != "" {
			reasons = append(reasons, fmt.Sprintf("(no cambia el nivel) `%s` tiene su par en %s: la regla puede vivir en los dos monolitos", s.Path, s.OtherTwin))
			break
		}
	}
	im.AfterMerge = []string{}
	switch {
	case im.Files == 0:
		im.Level, im.Reasons = "low", []string{fmt.Sprintf("no hay cambios contra %s: la rama ya está ahí, o la base del clon está desactualizada", im.base)}
		return
	case strong >= 2:
		im.Level = "high"
	case strong == 1 || secondary:
		im.Level = "medium"
	default:
		im.Level = "low"
		reasons = append([]string{"no trae ninguna de las señales que, medidas, anticipan un arreglo"}, reasons...)
	}
	im.Reasons = reasons

	// 4 · después de mergear
	for _, s := range im.Signals {
		if contains(s.Kinds, "migration") {
			im.AfterMerge = append(im.AfterMerge, "las migraciones no se aplican al mergear: en local y qa, sólo la de la tarea con `--path`; en producción, a mano")
			break
		}
	}
	if len(im.Knowledge) > 0 {
		im.AfterMerge = append(im.AfterMerge, fmt.Sprintf("releer las secciones de knowledge que toca y actualizarlas si cambió la regla (`make knowledge-touch F='%s:%s..<merge>'`)", im.alias, im.base))
	}
	if im.alias != "" {
		im.AfterMerge = append(im.AfterMerge, fmt.Sprintf("después del despliegue, `bin/sentinel deploy %s`: las señales antes y después contra lo normal de esa franja", im.repo))
	}
}

// renamedTo: en un `--numstat`, un renombre sale `a/{b => c}/d` o `x => y`: queda la ruta nueva.
func renamedTo(p string) string {
	if i := strings.Index(p, "{"); i >= 0 && strings.Contains(p, " => ") {
		j := strings.Index(p, "}")
		inner := strings.SplitN(p[i+1:j], " => ", 2)
		return strings.ReplaceAll(p[:i]+inner[1]+p[j+1:], "//", "/")
	}
	if parts := strings.SplitN(p, " => ", 2); len(parts) == 2 {
		return parts[1]
	}
	return p
}

func isCode(p string) bool {
	switch strings.ToLower(filepath.Ext(p)) {
	case ".php", ".ts", ".tsx", ".js", ".jsx", ".go", ".py", ".mjs":
		return true
	}
	return false
}

// countHeavy: cuántas razones de una lista son de un archivo que pesa (las que empiezan con su ruta).
func countHeavy(reasons []string) int {
	n := 0
	for _, r := range reasons {
		if strings.HasPrefix(r, "`") && (strings.Contains(r, " lo nombran ") || strings.Contains(r, " arreglos en 90 días")) {
			n++
		}
	}
	return n
}

func contains(xs []string, x string) bool {
	for _, y := range xs {
		if y == x {
			return true
		}
	}
	return false
}

func weight(s FileSignal) int {
	w := s.FanIn + 3*s.Fixes90
	if contains(s.Kinds, "migration") {
		w += 1000
	}
	return w
}

// fanIn: cuántos archivos de la base nombran a este. En PHP, la clase (`\bNombre\b`); en TypeScript, un import que
// termina en su nombre. Es una aproximación —un nombre repetido en otro módulo suma— y se dice así en el informe.
func fanIn(ctx context.Context, repoDir, base, path string) int {
	name := strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
	if len(name) < 4 || name == "index" {
		return 0
	}
	var args []string
	switch filepath.Ext(path) {
	case ".php":
		args = []string{"grep", "-l", "-w", "-F", name, base, "--", "*.php"}
	case ".ts", ".tsx", ".js", ".jsx", ".mjs":
		args = []string{"grep", "-l", "-E", `from ['"][^'"]*/` + regexp.QuoteMeta(name) + `(\.[jt]sx?)?['"]`, base, "--", "*.ts", "*.tsx", "*.js", "*.jsx", "*.mjs"}
	default:
		return 0
	}
	out, err := git(ctx, repoDir, args...)
	if err != nil || out == "" {
		return 0
	}
	n := 0
	for _, l := range strings.Split(out, "\n") {
		_, file, _ := strings.Cut(l, ":")
		// ni él mismo ni pruebas ni migraciones: cuenta lo que se rompe en producción
		if file != "" && file != path && !reTest.MatchString(file) && !reMigration.MatchString(file) {
			n++
		}
	}
	return n
}

// commitDate: la fecha del commit de la base. Los 90 días de la historia se cuentan hasta ahí, no hasta hoy: para un
// cambio viejo (la calibración), hasta hoy sumaría arreglos que llegaron después.
func commitDate(ctx context.Context, repoDir, ref string) time.Time {
	out, err := git(ctx, repoDir, "log", "-1", "--format=%cI", ref)
	if t, perr := time.Parse(time.RFC3339, strings.TrimSpace(out)); err == nil && perr == nil {
		return t
	}
	return time.Now()
}

// history: commits en la base que tocaron el archivo en los 90 días antes de `until`, y cuántos son arreglos.
func history(ctx context.Context, repoDir, base, path string, until time.Time) (int, int) {
	since := until.AddDate(0, 0, -90).Format(time.RFC3339)
	out, err := git(ctx, repoDir, "log", "--no-merges", "--since="+since, "--format=%s", base, "--", path)
	if err != nil || out == "" {
		return 0, 0
	}
	all, fixes := 0, 0
	for _, s := range strings.Split(out, "\n") {
		all++
		if reFix.MatchString(s) {
			fixes++
		}
	}
	return all, fixes
}

// twin: una clase con el mismo nombre en el `main` del otro monolito ("" si no hay, o si no hay clon).
func twin(ctx context.Context, otherRoot, other, path string) string {
	name := strings.TrimSuffix(filepath.Base(path), ".php")
	if otherRoot == "" || len(name) < 6 {
		return ""
	}
	ref := "refs/remotes/origin/main"
	if _, err := git(ctx, otherRoot, "rev-parse", "--verify", "-q", ref); err != nil {
		ref = "HEAD"
	}
	// `-w` y no `\b`: el ERE de git grep en macOS no conoce `\b`, y así esto no encontró nunca nada
	out, err := git(ctx, otherRoot, "grep", "-l", "-w", "-E", `^(final |abstract )?class `+regexp.QuoteMeta(name), ref, "--", "*.php")
	if err != nil || out == "" {
		return ""
	}
	first := strings.SplitN(out, "\n", 2)[0]
	return other + ":" + strings.TrimPrefix(first, ref+":")
}

// trapsCiting: las trampas cuya sección cita alguno de los archivos. Una cita con ruta tiene que coincidir con el final
// de la ruta cambiada; una cita sólo con el nombre, con el nombre, salvo los que están en todos lados.
func trapsCiting(doc string, files []string) []TrapHit {
	var out []TrapHit
	var cur *TrapHit
	flush := func() {
		if cur != nil && len(cur.Files) > 0 {
			out = append(out, *cur)
		}
		cur = nil
	}
	for _, line := range strings.Split(doc, "\n") {
		if strings.HasPrefix(line, "### F-") {
			flush()
			head := strings.TrimPrefix(line, "### ")
			id, title, _ := strings.Cut(head, " · ")
			cur = &TrapHit{ID: strings.TrimSpace(id), Title: strings.TrimSpace(title)}
			continue
		}
		if strings.HasPrefix(line, "## ") {
			flush()
			continue
		}
		if cur == nil {
			continue
		}
		for _, cited := range reCitedFile.FindAllString(line, -1) {
			for _, f := range files {
				if citesFile(cited, f) && !contains(cur.Files, f) {
					cur.Files = append(cur.Files, f)
				}
			}
		}
	}
	flush()
	return out
}

func citesFile(cited, file string) bool {
	cited = strings.TrimPrefix(strings.TrimPrefix(cited, "./"), "/")
	if strings.Contains(cited, "/") {
		// `routes/api.php` está en cada módulo: con un nombre genérico y una ruta corta, sólo la ruta exacta
		if genericNames[strings.ToLower(filepath.Base(cited))] && strings.Count(cited, "/") < 2 {
			return file == cited
		}
		return file == cited || strings.HasSuffix(file, "/"+cited)
	}
	if genericNames[strings.ToLower(cited)] {
		return false
	}
	return filepath.Base(file) == cited
}

// Markdown: el mapa para el informe y para el elephant.
func (im Impact) Markdown() string {
	var b strings.Builder
	fmt.Fprintf(&b, "## Impacto: %s\n\n", strings.ToUpper(label(impactLabels, im.Level)))
	fmt.Fprintf(&b, "Sin modelo: sale del diff, de la historia de la base y de lo que my-tools ya sabe. %d archivos, +%d −%d", im.Files, im.Added, im.Deleted)
	if len(im.Areas) > 0 {
		fmt.Fprintf(&b, " · %s", strings.Join(im.Areas, ", "))
	}
	b.WriteString(".\n\n")
	for _, r := range im.Reasons {
		fmt.Fprintf(&b, "- %s\n", r)
	}
	if len(im.Traps) > 0 {
		b.WriteString("\n**Trampas ya vividas en estos archivos** (`knowledge/traps/traps.md`):\n\n")
		for _, t := range im.Traps {
			fmt.Fprintf(&b, "- %s · %s — %s\n", t.ID, t.Title, strings.Join(t.Files, ", "))
		}
	}
	if len(im.Knowledge) > 0 {
		b.WriteString("\n**Lo que explica knowledge de estos archivos**:\n\n")
		for i, k := range im.Knowledge {
			if i == 8 {
				fmt.Fprintf(&b, "- … y %d más\n", len(im.Knowledge)-8)
				break
			}
			fmt.Fprintf(&b, "- `%s` · %s\n", k.ID, k.Title)
		}
	}
	if len(im.Signals) > 0 {
		b.WriteString("\n**Los archivos que más pesan** (dependen de ellos · commits y arreglos en 90 días):\n\n")
		for i, s := range im.Signals {
			if i == 8 {
				break
			}
			fmt.Fprintf(&b, "- `%s`", s.Path)
			var bits []string
			for _, k := range s.Kinds {
				bits = append(bits, label(kindLabels, k))
			}
			if s.FanIn > 0 {
				bits = append(bits, fmt.Sprintf("lo nombran %d", s.FanIn))
			}
			if s.Commits90 > 0 {
				bits = append(bits, fmt.Sprintf("%d commits, %d arreglos", s.Commits90, s.Fixes90))
			}
			if s.OtherTwin != "" {
				bits = append(bits, "par en "+s.OtherTwin)
			}
			if len(bits) > 0 {
				fmt.Fprintf(&b, " · %s", strings.Join(bits, " · "))
			}
			b.WriteString("\n")
		}
		b.WriteString("\n«Lo nombran» cuenta archivos de la base, sin pruebas ni migraciones, que mencionan el nombre de la clase o lo importan: una aproximación.\n")
	}
	if len(im.AfterMerge) > 0 {
		b.WriteString("\n**Después de mergear**:\n\n")
		for _, a := range im.AfterMerge {
			fmt.Fprintf(&b, "- %s\n", a)
		}
	}
	for _, n := range im.Notes {
		fmt.Fprintf(&b, "\n⚠ %s\n", n)
	}
	return b.String()
}

var (
	impactLabels = map[string]string{"high": "alto", "medium": "medio", "low": "bajo"}
	kindLabels   = map[string]string{"migration": "migración", "route": "rutas", "config": "configuración", "test": "prueba"}
)
