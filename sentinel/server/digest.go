package main

// LA MEMORIA DE SENTINEL PARA UN MODELO DE VENTANA GRANDE. Idea de Miguel (2026-11-26): que Sentinel vaya guardando
// resúmenes que le sirvan a Gemini, para que cada tanda que se le mande tenga el contexto completo.
//
//   - El RESUMEN DE UN DÍA (`.data/digests/<día>.md`, `digestDay`): el día contra lo normal (lo de `bin/sentinel day`),
//     los errores por etapa con sus mensajes, las solicitudes tocadas y su estado, lo que se desplegó con sus commits, y
//     los avisos con su porqué. Lo arma Sentinel sin modelo, una vez que el día terminó, y queda para siempre: la
//     memoria no depende de los 28 días que guarda lo demás.
//   - EL PAQUETE (`buildPack`): el contexto fijo (qué es CreditOp, el índice de knowledge y de las trampas), los
//     informes anteriores, los resúmenes de los últimos días, el mes a la fecha y el CÓDIGO de lo que se desplegó (los
//     cambios de cada despliegue). Lo que justifica una ventana de cientos de miles de tokens es poder cruzar el código
//     que salió con los errores que aparecieron después.
//   - EL INFORME (`runReport`): el paquete a Gemini por la web de AI Studio (`bin/aistudio --file`, hasta ~500 mil
//     tokens), guardado en `.data/reports/<día>.md`, con la verificación de las rutas de código que cita.
//
// ⚠ AI Studio por la web es una cuenta de consumidor: lo que se manda puede revisarlo Google. Por eso el paquete lleva
// sólo lo agregado y normalizado: conteos, mensajes sin números ni correos (`normalizeMessage`), estados; ningún número
// de solicitud, cédula, celular ni nombre. El código sí va, como ya va para poner al día knowledge.

import (
	"bufio"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	digestMessages  = 8         // mensajes por etapa en el resumen del día
	packDays        = 28        // días de resúmenes en el paquete
	packCodeDays    = 7         // días de código desplegado en el paquete
	packDeployBytes = 60 << 10  // tope del cambio de UN despliegue (el resto se resume en la lista de archivos)
	packCodeBytes   = 900 << 10 // tope de todo el código del paquete
	packReports     = 4         // informes anteriores que vuelven a entrar
)

func (s *sentinel) digestDir() string { return filepath.Join(s.store.dir, "digests") }
func (s *sentinel) reportDir() string { return filepath.Join(s.store.dir, "reports") }

// ── el resumen de un día ─────────────────────────────────────────────────────────────────────────────────────────

// digestDay arma el resumen de `date` (AAAA-MM-DD). Lee lo guardado, Loki (las etapas) y git (los commits).
func (s *sentinel) digestDay(rules Rules, date string, deploys []Deploy) (string, error) {
	day, err := time.ParseInLocation("2006-01-02", date, bogota)
	if err != nil {
		return "", err
	}
	end := day.AddDate(0, 0, 1)
	reach := s.store.reach()
	if reach.IsZero() {
		return "", fmt.Errorf("no hay nada guardado")
	}
	c := &cli{s: s, e: s.evaluator(rules), rules: rules, reach: reach.In(bogota)}
	var b strings.Builder
	fmt.Fprintf(&b, "# Resumen de producción del %s\n\n", date)
	if d, err := c.day(date); err == nil {
		b.WriteString(stripTitle(d.Text()) + "\n")
	} else {
		fmt.Fprintf(&b, "(sin el resumen del día: %v)\n\n", err)
	}

	// Los errores por etapa, el día entero.
	b.WriteString("## Errores por etapa del recorrido (el día entero)\n\n")
	for _, st := range stages {
		dd, err := stageDetail(st.Key, day, end)
		if err != nil {
			fmt.Fprintf(&b, "- %s: sin leer (%v)\n", st.Label, err)
			continue
		}
		if dd.Lines == 0 {
			continue
		}
		capped := ""
		if dd.Capped {
			capped = fmt.Sprintf(" (llegó al tope de %d: los conteos son de las más recientes)", stageDetailLimit)
		}
		fmt.Fprintf(&b, "### %s — %d errores%s; %d nombran una solicitud, %d solicitudes distintas\n", st.Label, dd.Lines, capped, dd.Named, dd.Requests)
		if len(dd.Statuses) > 0 {
			var parts []string
			for _, x := range dd.Statuses {
				parts = append(parts, fmt.Sprintf("%d en «%s»", x.Count, x.Name))
			}
			b.WriteString("Estado de hoy de las solicitudes tocadas: " + strings.Join(parts, ", ") + ".\n")
		}
		for i, m := range dd.Messages {
			if i >= digestMessages {
				break
			}
			code := ""
			if m.Code != "" {
				code = " [" + m.Code + "]"
			}
			fmt.Fprintf(&b, "- %d × %s%s: %s\n", m.Count, m.Service, code, m.Text)
		}
		b.WriteString("\n")
	}

	// Lo que se desplegó ese día, con sus commits.
	b.WriteString("## Lo que se desplegó a producción\n\n")
	any := false
	for _, dp := range deploysOn(deploys, date) {
		any = true
		state := ""
		if !dp.OK {
			state = " · FALLÓ"
		}
		at, _ := time.Parse(time.RFC3339, dp.At)
		fmt.Fprintf(&b, "### %s %s a las %s%s\n%s\n", dp.Repo, dp.Version, at.In(bogota).Format("15:04"), state, dp.Title)
		if prev := previousDeploy(deploys, dp); prev != nil {
			if log, err := commitLog(s.root, dp.Repo, prev.Version, dp.Version, 60); err == nil && log != "" {
				fmt.Fprintf(&b, "Commits desde %s:\n%s\n", prev.Version, log)
			}
		}
		b.WriteString("\n")
	}
	if !any {
		b.WriteString("Ninguno.\n\n")
	}

	// Los avisos del día y su porqué.
	notes := noticesOn(s.store.dir, date)
	if len(notes) > 0 {
		b.WriteString("## Los avisos que salieron (y el porqué del modelo, si lo hubo)\n\n")
		for _, n := range notes {
			at, _ := time.Parse(time.RFC3339, n.At)
			fmt.Fprintf(&b, "- %s · %s · %s: %s\n", at.In(bogota).Format("15:04"), n.Level, n.Name, n.Text)
		}
		b.WriteString("\n")
	}
	return scrub(b.String()), nil
}

// stripTitle: el resumen del día sin su primera línea (el título): el resumen lleva el suyo.
func stripTitle(s string) string {
	if strings.HasPrefix(s, "# ") {
		if i := strings.IndexByte(s, '\n'); i >= 0 {
			return strings.TrimLeft(s[i+1:], "\n")
		}
	}
	return s
}

var (
	reScrubUReq  = regexp.MustCompile(`(?i)(ureq|solicitud(?:es)?|user_request)(\s*[#:=]?\s*)\d{4,}`)
	reScrubLong  = regexp.MustCompile(`\b\d{7,}\b`) // cédulas, celulares, números de solicitud sueltos
	reScrubEmail = regexp.MustCompile(`[\w.+-]+@[\w-]+\.[\w.]+`)
)

var reSecretValue = regexp.MustCompile(`(?i)((?:secret|password|passwd|token|api[_-]?key|private[_-]?key|client[_-]?secret|access[_-]?key)[A-Za-z0-9_\-]*["']?\s*(?:=|:|=>)\s*["']?)([^\s"',;]{6,})`)

// scrubSecrets: el valor de lo que parece un secreto (`API_KEY=…`, `'password' => '…'`), cambiado por <secreto>.
func scrubSecrets(s string) string {
	return reSecretValue.ReplaceAllString(s, "${1}<secreto>")
}

// scrub: lo que no sale de la Mac aunque se haya colado en un texto (un número de solicitud en un porqué, un correo
// en un mensaje): el paquete va a una cuenta de consumidor.
func scrub(s string) string {
	s = reScrubEmail.ReplaceAllString(s, "<correo>")
	s = reScrubUReq.ReplaceAllString(s, "$1$2<n>")
	s = reScrubLong.ReplaceAllString(s, "<n>")
	return s
}

func deploysOn(list []Deploy, date string) []Deploy {
	var out []Deploy
	for _, d := range list {
		if strings.HasPrefix(d.At, date) {
			out = append(out, d)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].At < out[j].At })
	return out
}

// previousDeploy: el despliegue a producción anterior del mismo repo que salió bien.
func previousDeploy(list []Deploy, d Deploy) *Deploy {
	var best *Deploy
	for i := range list {
		x := &list[i]
		if x.Repo == d.Repo && x.OK && x.At < d.At && x.Version != d.Version && (best == nil || x.At > best.At) {
			best = x
		}
	}
	return best
}

// repoDir: el clon sólo-main del repo (~/Desktop/CREDITOP/main-clones/<repo>), o el de trabajo si no hay.
func repoDir(repo string) string {
	home, _ := os.UserHomeDir()
	for _, d := range []string{filepath.Join(home, "Desktop", "CREDITOP", "main-clones", repo), filepath.Join(home, "Desktop", "CREDITOP", "github", repo)} {
		if _, err := os.Stat(filepath.Join(d, ".git")); err == nil {
			return d
		}
	}
	return ""
}

var fetchedTags = map[string]bool{}

// gitRef: `ref` si existe como commit en el clon (trae los tags una vez por proceso: los locales se atrasan).
func gitRef(dir, ref string) bool {
	if !fetchedTags[dir] {
		fetchedTags[dir] = true
		_, _ = runTool(60*time.Second, dir, "git", "fetch", "-q", "--tags", "origin")
	}
	_, err := runTool(10*time.Second, dir, "git", "rev-parse", "--verify", "-q", ref+"^{commit}")
	return err == nil
}

// commitLog: los títulos de los commits de prev..cur (sin merges), hasta `max`.
func commitLog(root, repo, prev, cur string, max int) (string, error) {
	dir := repoDir(repo)
	if dir == "" || !gitRef(dir, prev) || !gitRef(dir, cur) {
		return "", fmt.Errorf("sin el rango %s..%s", prev, cur)
	}
	out, err := runTool(20*time.Second, dir, "git", "log", "--no-merges", "--format=- %s", fmt.Sprintf("-%d", max), prev+".."+cur)
	return strings.TrimSpace(string(out)), err
}

// deployDiff: lo que cambió en un despliegue: la lista de archivos y el cambio, sin lo generado (locks, json, svg,
// imágenes) y hasta `limit` bytes.
func deployDiff(repo, prev, cur string, limit int) (string, error) {
	dir := repoDir(repo)
	if dir == "" || !gitRef(dir, prev) || !gitRef(dir, cur) {
		return "", fmt.Errorf("sin el rango %s..%s", prev, cur)
	}
	excl := []string{"--", ".", ":!*.lock", ":!*lock.yaml", ":!*lock.json", ":!*.json", ":!*.svg", ":!*.png", ":!*.jpg", ":!*.snap", ":!*.min.js", ":!*.map", ":!*.env*", ":!**/.env*", ":!*.pem", ":!*.key", ":!*.p12", ":!*.crt"}
	stat, _ := runTool(30*time.Second, dir, "git", append([]string{"diff", "--stat=160", prev + ".." + cur}, excl...)...)
	patch, err := runTool(60*time.Second, dir, "git", append([]string{"diff", "-U2", prev + ".." + cur}, excl...)...)
	if err != nil {
		return "", err
	}
	// El código va a una cuenta de consumidor: sin datos de prueba con cédulas o correos, ni el valor de un secreto.
	p := scrub(scrubSecrets(string(patch)))
	if len(p) > limit {
		p = p[:limit] + fmt.Sprintf("\n… (cortado: el cambio entero pesa %d KB; la lista de archivos de arriba está completa)\n", len(patch)>>10)
	}
	return "Archivos:\n" + string(stat) + "\n```diff\n" + p + "\n```\n", nil
}

func noticesOn(dir, date string) []Notice {
	f, err := os.Open(filepath.Join(dir, "notices.jsonl"))
	if err != nil {
		return nil
	}
	defer f.Close()
	var out []Notice
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 1<<20), 1<<20)
	for sc.Scan() {
		var n Notice
		if json.Unmarshal(sc.Bytes(), &n) == nil && strings.HasPrefix(n.At, date) && n.Level != "recovered" {
			out = append(out, n)
		}
	}
	return out
}

// saveDigest escribe el resumen de un día ya terminado.
func (s *sentinel) saveDigest(rules Rules, date string, deploys []Deploy) error {
	text, err := s.digestDay(rules, date, deploys)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(s.digestDir(), 0o755); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(s.digestDir(), date+".md"), []byte(text), 0o644)
}

// missingDigests: los días terminados con datos guardados y sin resumen, del más reciente al más viejo.
func (s *sentinel) missingDigests(now time.Time) []string {
	var out []string
	today := now.In(bogota).Format("2006-01-02")
	for _, date := range s.store.dates() {
		if date >= today {
			continue
		}
		if _, err := os.Stat(filepath.Join(s.digestDir(), date+".md")); err == nil {
			continue
		}
		out = append(out, date)
	}
	sort.Sort(sort.Reverse(sort.StringSlice(out)))
	return out
}

// ── el paquete ───────────────────────────────────────────────────────────────────────────────────────────────────

// PackInfo: qué entró al paquete y cuánto pesa.
type PackInfo struct {
	Path    string         `json:"path"`
	Bytes   int            `json:"bytes"`
	Tokens  int            `json:"tokens"` // estimado: 1 token cada ~3,6 caracteres (español y código)
	Parts   map[string]int `json:"parts"`  // bytes por sección
	Days    int            `json:"days"`
	Deploys int            `json:"deploys"`
	Missing []string       `json:"missing,omitempty"` // días sin resumen
}

const packQuestion = `Sos el analista de producción de CreditOp (fintech colombiana de originación de crédito). Recibís la memoria de Sentinel,
su vigía de producción: resúmenes diarios (errores por etapa del recorrido de una solicitud, despliegues con sus commits,
avisos), el mes a la fecha, el código que se desplegó la última semana, tus informes anteriores y el contexto del
negocio. Escribí en español, en Markdown, el informe del día. El foco es lo que CAMBIÓ desde tu informe anterior
(normalmente el de ayer) y lo que pasó en las últimas 24 horas, incluido el resumen PARCIAL de hoy; los 28 días son
para reconocer qué es nuevo, qué se repite y qué viene de antes:

1. **Lo que se rompió**: cada problema real, con cuándo empezó, a quién tocó (etapa, entidad, comercio, cuántas
   solicitudes) y si sigue. Separá lo que es una caída de lo que es un caso suelto o un reintento.
2. **El despliegue que lo explica**: cuando un error aparece después de un despliegue, el commit y el archivo que lo
   explican, citando la ruta EXACTA del diff (por ejemplo «Modules/Backoffice/App/Services/LenderCatalogService.php»).
   Si no hay un cambio que lo explique, decilo.
3. **Lo que se repite**: problemas que tus informes anteriores ya habían visto y siguen, y lo que se resolvió desde
   el último. Si algo que dijiste antes resultó no ser así, decilo.
4. **Tendencias lentas**: comercios o entidades que vienen bajando en el mes sin una alerta.
5. **Qué mirar primero**: hasta 5 acciones concretas, de la más urgente a la menos.
6. **La vista para el tablero**: al final, un bloque json con el esquema que se explica al final del paquete.

Reglas: cada afirmación lleva su evidencia entre paréntesis (el día y la sección del resumen, o el archivo del diff). Lo
que es hipótesis se dice «hipótesis». No inventes rutas, versiones ni números: si no está en el paquete, no lo afirmes.`

// buildPack arma el paquete en `path`.
func (s *sentinel) buildPack(rules Rules, path string, now time.Time) (*PackInfo, error) {
	info := &PackInfo{Path: path, Parts: map[string]int{}}
	var b strings.Builder
	section := func(name, text string) {
		b.WriteString(text)
		info.Parts[name] += len(text)
	}
	section("instrucciones", "# La memoria de Sentinel · "+now.In(bogota).Format("2006-01-02 15:04")+"\n\n"+packQuestion+"\n\n")

	// El contexto fijo: qué es CreditOp, el índice del conocimiento y las trampas conocidas (sólo sus índices: las
	// trampas enteras traen casos de prueba con datos).
	for _, f := range []struct{ name, path, cut string }{
		{"negocio", "knowledge/business-context.md", ""},
		{"índice de knowledge", "CREDITOP.md", ""},
		{"trampas conocidas", "knowledge/traps/traps.md", "## Índice · ¿con qué síntoma llegás?"},
	} {
		raw, err := os.ReadFile(filepath.Join(s.root, f.path))
		if err != nil {
			continue
		}
		text := string(raw)
		if f.cut != "" {
			if i := strings.Index(text, f.cut); i >= 0 {
				text = text[i:]
				if j := strings.Index(text, "\n---\n\n## "); j >= 0 { // hasta después del índice de una línea
					if k := strings.Index(text[j+6:], "\n## "); k >= 0 && strings.Contains(text[:j+6+k], "Índice · los F-xx") {
						text = text[:j+6+k]
					}
				}
				if k := strings.Index(text, "\n### F-"); k >= 0 {
					text = text[:k]
				}
			}
		}
		section("contexto", fmt.Sprintf("# Contexto: %s (`%s`)\n\n%s\n\n", f.name, f.path, scrub(text)))
	}

	// Los ids de las señales: la vista las nombra por id y los resúmenes hablan con nombres (view.go).
	section("señales", scrub(s.signalTable(rules, now)))

	// Los informes anteriores: lo que ya se concluyó.
	if files, _ := filepath.Glob(filepath.Join(s.reportDir(), "*.md")); len(files) > 0 {
		sort.Sort(sort.Reverse(sort.StringSlice(files)))
		if len(files) > packReports {
			files = files[:packReports]
		}
		for i := len(files) - 1; i >= 0; i-- {
			raw, _ := os.ReadFile(files[i])
			section("informes anteriores", fmt.Sprintf("# Tu informe anterior del %s\n\n%s\n\n", strings.TrimSuffix(filepath.Base(files[i]), ".md"), raw))
		}
	}

	deps, _ := deploys(s.root, packCodeDays+30)

	// Los resúmenes de los días, del más viejo al más nuevo.
	var dates []string
	for i := packDays; i >= 1; i-- {
		dates = append(dates, now.In(bogota).AddDate(0, 0, -i).Format("2006-01-02"))
	}
	for _, date := range dates {
		raw, err := os.ReadFile(filepath.Join(s.digestDir(), date+".md"))
		if err != nil {
			info.Missing = append(info.Missing, date)
			continue
		}
		info.Days++
		section("resúmenes diarios", string(raw)+"\n")
	}

	// Hoy, hasta ahora: no se guarda (el día no terminó), pero sin esto el informe no ve lo que pasó hoy. Medido el
	// 26/11/2026: el primer informe no vio el despliegue de las 11:14 que rompió una columna, porque llegaba hasta ayer.
	if today, err := s.digestDay(rules, now.In(bogota).Format("2006-01-02"), deps); err == nil {
		section("resúmenes diarios", strings.Replace(today, "# Resumen de producción del ", "# Resumen PARCIAL (el día no terminó) del ", 1)+"\n")
	}

	// El mes a la fecha (month.go).
	if m, err := month(s.follow.all()); err == nil {
		section("mes a la fecha", "# El mes a la fecha\n\n"+m.Text()+"\n")
	}

	// El código de lo que se desplegó en la última semana.
	since := now.In(bogota).AddDate(0, 0, -packCodeDays).Format(time.RFC3339)
	var recent []Deploy
	for _, d := range deps {
		if d.At >= since && d.OK {
			recent = append(recent, d)
		}
	}
	sort.Slice(recent, func(i, j int) bool { return recent[i].At < recent[j].At })
	code := 0
	b.WriteString("# El código que se desplegó a producción la última semana\n\n")
	for _, d := range recent {
		prev := previousDeploy(deps, d)
		if prev == nil {
			continue
		}
		limit := min(packDeployBytes, packCodeBytes-code)
		if limit <= 2<<10 {
			section("código desplegado", fmt.Sprintf("## %s %s (%s): sin el cambio, se llegó al tope del paquete\n\n", d.Repo, d.Version, d.At))
			continue
		}
		diff, err := deployDiff(d.Repo, prev.Version, d.Version, limit)
		if err != nil {
			section("código desplegado", fmt.Sprintf("## %s %s (%s): %v\n\n", d.Repo, d.Version, d.At, err))
			continue
		}
		info.Deploys++
		code += len(diff)
		section("código desplegado", fmt.Sprintf("## %s %s, desplegado el %s (desde %s)\n%s\n\n%s\n", d.Repo, d.Version, d.At, prev.Version, d.Title, diff))
	}
	section("instrucciones", "\n# De nuevo, lo que se pide\n\n"+packQuestion+"\n\n"+viewInstructions+"\n")

	text := b.String()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}
	if err := os.WriteFile(path, []byte(text), 0o644); err != nil {
		return nil, err
	}
	info.Bytes = len(text)
	info.Tokens = int(float64(len([]rune(text))) / 3.6)
	return info, nil
}

func (p *PackInfo) Text() string {
	var b strings.Builder
	fmt.Fprintf(&b, "Paquete: %s\n%d KB · ~%d mil tokens · %d días de resúmenes · %d despliegues con su código\n\n", p.Path, p.Bytes>>10, p.Tokens/1000, p.Days, p.Deploys)
	names := make([]string, 0, len(p.Parts))
	for k := range p.Parts {
		names = append(names, k)
	}
	sort.Slice(names, func(i, j int) bool { return p.Parts[names[i]] > p.Parts[names[j]] })
	for _, k := range names {
		fmt.Fprintf(&b, "  %-20s %6d KB\n", k, p.Parts[k]>>10)
	}
	if len(p.Missing) > 0 {
		fmt.Fprintf(&b, "\nDías sin resumen (%d): %s · se arman solos de a uno por pasada, o con bin/sentinel digest <día>\n", len(p.Missing), strings.Join(p.Missing, ", "))
	}
	return b.String()
}

// ── el informe ───────────────────────────────────────────────────────────────────────────────────────────────────

var reCodePath = regexp.MustCompile(`[A-Za-z0-9_\-]+(?:/[A-Za-z0-9_.\-]+)+\.(?:php|ts|tsx|go|vue|js|py|sql)`)

// runReport: el paquete a Gemini por la web de AI Studio y el informe guardado, con la verificación de las rutas que
// cita contra main de los repos (una ruta inventada no falla en ningún lado: se dice).
func (s *sentinel) runReport(rules Rules, now time.Time) (string, *PackInfo, error) {
	date := now.In(bogota).Format("2006-01-02")
	pack := filepath.Join(s.reportDir(), "packs", date+".md")
	info, err := s.buildPack(rules, pack, now)
	if err != nil {
		return "", nil, err
	}
	out := filepath.Join(s.reportDir(), date+".md")
	cmd := exec.Command(filepath.Join(s.root, "bin", "aistudio"), "--file", pack, "--prompt",
		"Leé el archivo entero y escribí el informe que pide (las instrucciones están al principio y al final).", "--out", out+".tmp")
	cmd.Dir = s.root
	if raw, err := cmd.CombinedOutput(); err != nil {
		return "", info, fmt.Errorf("bin/aistudio: %v: %s", err, strings.TrimSpace(string(raw)))
	}
	raw, err := os.ReadFile(out + ".tmp")
	if err != nil {
		return "", info, err
	}
	_ = os.Remove(out + ".tmp")
	report := strings.TrimSpace(string(raw))
	// La vista para el tablero (view.go): se separa, se valida y se guarda aparte; el informe queda sin el bloque.
	view, rest, verr := parseView(report)
	if verr == nil {
		// Sin el bloque, el título de la sección de la vista queda vacío: se saca.
		report = strings.TrimSpace(regexp.MustCompile(`(?m)^#{1,3}\s*\d*\.?\s*La vista para el tablero\s*$`).ReplaceAllString(rest, ""))
		validateView(view, s.knownSignals(rules, now))
		if vraw, err := json.MarshalIndent(view, "", "  "); err == nil {
			_ = os.WriteFile(filepath.Join(s.reportDir(), date+".json"), vraw, 0o644)
		}
	} else {
		log.Printf("sentinel: el informe del %s sin vista: %v", date, verr)
	}
	report += "\n\n" + verifyPaths(report)
	header := fmt.Sprintf("<!-- Sentinel · informe del %s · paquete de ~%d mil tokens (%d días, %d despliegues) · Gemini por AI Studio -->\n\n", date, info.Tokens/1000, info.Days, info.Deploys)
	if err := os.WriteFile(out, []byte(header+report+"\n"), 0o644); err != nil {
		return "", info, err
	}
	return out, info, nil
}

// verifyPaths: cada ruta de código que cita el informe, buscada en main de los repos que se despliegan.
func verifyPaths(report string) string {
	paths := map[string]bool{}
	for _, p := range reCodePath.FindAllString(report, -1) {
		paths[p] = true
	}
	if len(paths) == 0 {
		return "## Verificación de lo citado\n\nNo cita rutas de código.\n"
	}
	var found, missing []string
	for p := range paths {
		ok := false
		for _, repo := range []string{"legacy-backend", "frontend-monorepo", "legacy-application", "pre-approvals-service"} {
			dir := repoDir(repo)
			if dir == "" {
				continue
			}
			if _, err := runTool(10*time.Second, dir, "git", "cat-file", "-e", "origin/main:"+p); err == nil {
				ok = true
				found = append(found, fmt.Sprintf("%s (%s)", p, repo))
				break
			}
		}
		if !ok {
			missing = append(missing, p)
		}
	}
	sort.Strings(found)
	sort.Strings(missing)
	var b strings.Builder
	fmt.Fprintf(&b, "## Verificación de lo citado (contra main, la hace Sentinel, no el modelo)\n\n%d de %d rutas existen.\n", len(found), len(paths))
	if len(missing) > 0 {
		b.WriteString("\n⚠ No existen en main (inventadas, de otra rama o mal copiadas):\n")
		for _, p := range missing {
			b.WriteString("- " + p + "\n")
		}
	}
	return b.String()
}

// ── lo automático, dentro de la API de fondo ────────────────────────────────────────────────────────────────────

// La memoria se arma sola: en cada pasada, a lo sumo UN resumen de un día que falte (~30 s de Loki, en segundo plano,
// para no cargarlo de golpe), y el informe TODOS los días desde las 6:30 si el de hoy no está (antes del dictamen de
// las 7:30, que también le pregunta a AI Studio, que contesta de a una; también fines de semana: el Black Friday cae
// viernes). Necesita Chrome con Jarvis; un intento fallido se reintenta a las 3 horas. Decisión de Miguel
// (2026-11-26): diario, no semanal. Con `memory.off` en .data, nada de esto corre.
var memoryState struct {
	mu          sync.Mutex
	busy        bool
	reportTried time.Time
	deps        []Deploy
	depsAt      time.Time
	failed      map[string]time.Time // un día que falló no se reintenta hasta 6 horas después
}

const reportHour, reportMinute = 6, 30

func (s *sentinel) maybeMemory(rules Rules) {
	if _, err := os.Stat(filepath.Join(s.store.dir, "memory.off")); err == nil {
		return
	}
	now := time.Now().In(bogota)
	st := &memoryState
	st.mu.Lock()
	if st.busy {
		st.mu.Unlock()
		return
	}
	var missing []string
	for _, d := range s.missingDigests(now) {
		if t, ok := st.failed[d]; !ok || time.Since(t) > 6*time.Hour {
			missing = append(missing, d)
		}
	}
	report := now.Hour()*60+now.Minute() >= reportHour*60+reportMinute && time.Since(st.reportTried) > 3*time.Hour
	if report {
		if _, err := os.Stat(filepath.Join(s.reportDir(), now.Format("2006-01-02")+".md")); err == nil {
			report = false
		}
	}
	if len(missing) == 0 && !report {
		st.mu.Unlock()
		return
	}
	st.busy = true
	if report {
		st.reportTried = time.Now()
	}
	st.mu.Unlock()
	go func() {
		defer func() { st.mu.Lock(); st.busy = false; st.mu.Unlock() }()
		if len(missing) > 0 {
			if time.Since(st.depsAt) > 6*time.Hour {
				if d, err := deploys(s.root, 40); err == nil {
					st.deps, st.depsAt = d, time.Now()
				}
			}
			if err := s.saveDigest(rules, missing[0], st.deps); err != nil {
				log.Printf("sentinel: el resumen del %s no salió: %v", missing[0], err)
				st.mu.Lock()
				if st.failed == nil {
					st.failed = map[string]time.Time{}
				}
				st.failed[missing[0]] = time.Now()
				st.mu.Unlock()
			}
			return // el informe, en la pasada siguiente: de a una cosa
		}
		out, info, err := s.runReport(rules, now)
		if err != nil {
			log.Printf("sentinel: el informe del día no salió: %v", err)
			return
		}
		log.Printf("sentinel: informe del día en %s (~%d mil tokens)", out, info.Tokens/1000)
		if s.notifier != nil {
			headline := "Listo"
			if v, err := s.latestReport(); err == nil && v.View != nil && v.View.Headline != "" {
				headline = v.View.Headline
			}
			s.notifier.tell(Notice{Signal: "report", Name: "Informe del día", Level: "verdict", Text: headline}, "Sentinel · informe del día", false)
		}
	}()
}
