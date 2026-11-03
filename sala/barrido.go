package main

/* EL BARRIDO (Miguel, 2026-11-03): varios agentes SOLOS, en paralelo y sin turnos, cada uno sobre un tema de
 * knowledge/, y al final un verificador que no escribió nada comprueba cada hallazgo.
 *
 * POR QUÉ NO LA SALA. Se compararon el 2026-11-03 sobre lender-profile-rules, con el mismo brief y el mismo tope:
 * un agente solo dio 10 hallazgos (9 comprobados, los 9 ciertos) con US$2,13 eq.; la sala dio 0 con US$2,49 eq.
 * Cada turno de la sala vuelve a pagar el contexto base (~55k tokens de entrada nueva) y cada rol alcanzó a trabajar
 * un turno; el agente solo hizo 44 pasos en una sesión con caché. El barrido se queda con lo que funcionó (sesión
 * larga, todas las herramientas) y con lo único bueno de la sala: lo que se afirma lo comprueba otro.
 *
 * REPARTO. Por TEMA, no por especialidad: con todas las herramientas cada agente ya es «experto en todo», y dos
 * sobre el mismo tema se repiten. Sin temas pedidos, van los de revisión más vieja (`reviewedAt` de sources.json).
 *
 * RETROALIMENTACIÓN. Lo que el verificador confirma queda en sala/.barridos/conocidos/<tema>.md, y el próximo
 * barrido de ese tema lo recibe en su brief para no redescubrirlo. A knowledge/ no se escribe nada: lo aprueba Miguel. */

import (
	"context"
	"encoding/json"
	"fmt"
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
	sweepModel    = "claude-opus-5-5"
	sweepEffort   = "medium"
	verifierModel = "claude-opus-5-5"
	verifierLevel = "high"
)

// Las herramientas de un agente del barrido: la unión de las de los roles de la sala, todas de lectura.
var sweepTools = []string{"Read", "Grep", "Glob",
	"Bash(git grep *)", "Bash(git -C *)", "Bash(git show *)", "Bash(git log *)", "Bash(go run ./cmd/repos *)",
	"Bash(make knowledge-*)", "Bash(make retomar *)", "Bash(make tareas *)", "Bash(make trampas *)",
	"Bash(bin/pg confluence *)", "Bash(bin/pg jira search *)", "Bash(bin/pg tareas *)", "Bash(bin/pg tarea pila *)",
	"Bash(bin/pg sql *)", "Bash(bin/pg events *)", "Bash(bin/pg request *)", "Bash(bin/pg logs *)", "Bash(bin/pg client *)",
	"Bash(make harness-case *)", "Bash(make harness-listing *)", "Bash(make harness-suite *)", "Bash(make harness-walk-wizard *)",
	"Bash(make harness-doctor *)", "Bash(make tarea-verify *)", "Bash(make agente *)", "Bash(lsof -nP -iTCP*)", "Bash(grep *)"}

const sweepRules = `No edites archivos, no commitees y no corras nada contra producción salvo lecturas de bin/pg. ` +
	`Un comando por llamada a Bash, sin cd, sin ;, && ni |: usá git -C <repo> y bin/pg con ruta relativa. ` +
	`En una consulta a Loki, buscá texto sin rayas ni comillas tipográficas: un «—» que no coincide da 0 sin fallar.`

const sweepSystem = `Trabajás SOLO sobre un TEMA del conocimiento local del playground de CreditOp. Hacés todo: traer lo que ya se ` +
	`sabe (knowledge/, trampas del tablero, Confluence), mirar dónde se decide en main (git grep / git show contra origin/main en los DOS ` +
	`monolitos, legacy-backend y legacy-application), medir en prod sólo leyendo (bin/pg sql, bin/pg logs) y correr el harness si sirve. ` +
	`Buscás contradicciones entre el tema y main, huecos (reglas en main que ningún tema nombra), afirmaciones sin suite que las pruebe y ` +
	`posibles defectos. Antes de escribir un hallazgo comprobalo vos mismo volviendo a la fuente; no repitas lo que el tema ya dice ni lo ` +
	`que figura como YA CONOCIDO. Terminá con la lista: cada hallazgo en UNA sola línea, con la forma exacta «HALLAZGO: ` +
	`<contradicción|hueco|sin prueba|defecto> | <qué es, con archivo:línea> | <destino: el tema a corregir, la suite a crear o «incidencia»> | ` +
	`COMANDO: <el comando que lo muestra>», y después las dudas como «PREGUNTA: …». Nada se escribe en knowledge/ ni en el harness: la ` +
	`lista es un borrador que comprueba otro y aprueba Miguel. ` + sweepRules

const verifierSystem = `Sos el VERIFICADOR de un barrido: otros agentes dejaron hallazgos sobre temas del conocimiento local de ` +
	`CreditOp y vos no escribiste ninguno. Comprobá cada uno volviendo a la fuente, sin repetir el razonamiento de quien lo dijo: git grep / ` +
	`git show contra origin/main en los DOS monolitos, bin/pg sql o logs en sólo lectura. Comprobá también la PREMISA (qué ids, qué rama, ` +
	`qué clave). Por cada hallazgo, una línea exacta «VEREDICTO: H<n> | ✓, ✗ o — | <el comando que corriste> | <una frase: qué viste>», ` +
	`donde ✗ es «es falso o exagera», y — es «no se pudo comprobar». Si el presupuesto no alcanza para todos, empezá por los defectos y las ` +
	`contradicciones. ` + sweepRules

type sweepFinding struct {
	ID      string `json:"id"`
	Topic   string `json:"topic"`
	Text    string `json:"text"`
	Verdict string `json:"verdict"` // ✓ ✗ — o vacío si el verificador no llegó
	Check   string `json:"check"`
}

type sweepRun struct {
	Topic    string  `json:"topic"`
	Cost     float64 `json:"cost"`
	Turns    int     `json:"turns"`
	Seconds  int     `json:"seconds"`
	Err      string  `json:"err,omitempty"`
	Findings int     `json:"findings"`
	text     string
}

var (
	reVerdict   = regexp.MustCompile(`(?m)^\s*VEREDICTO:\s*(H[0-9]+)\s*\|\s*(✓|✗|—)\s*\|\s*(.+?)\s*$`)
	reFindStart = regexp.MustCompile(`^\s*(?:[-*]\s*)?HALLAZGO:`)
)

// sweep es `make barrido`: corre el barrido entero, escribe el informe y devuelve su ruta.
func sweep(root string, topics []string, n int, budget, verifierBudget float64, mock bool) (string, error) {
	if len(topics) == 0 {
		topics = oldestTopics(root, n)
	}
	if len(topics) == 0 {
		return "", fmt.Errorf("no encontré temas en knowledge/")
	}
	dir := filepath.Join(root, "sala", ".barridos", time.Now().Format("20060102-150405"))
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	fmt.Printf("barrido: %s · %d agente(s) en paralelo, US$%.2f eq. cada uno, y el verificador con US$%.2f\n",
		strings.Join(topics, ", "), len(topics), budget, verifierBudget)

	runs := make([]*sweepRun, len(topics))
	var wg sync.WaitGroup
	for i, t := range topics {
		wg.Add(1)
		go func(i int, topic string) {
			defer wg.Done()
			start := time.Now()
			r := &sweepRun{Topic: topic}
			if mock {
				r.text, r.Cost, r.Turns = mockSweepAgent(topic), 0.5, 7
			} else {
				res, err := runAgent(root, sweepBrief(root, topic), sweepSystem, sweepModel, sweepEffort, budget)
				r.text, r.Cost, r.Turns = res.Result, res.Cost, res.Turns
				if err != nil {
					r.Err = err.Error()
				}
			}
			r.Seconds = int(time.Since(start).Seconds())
			_ = os.WriteFile(filepath.Join(dir, topic+".md"), []byte(r.text), 0o644)
			runs[i] = r
			fmt.Printf("  · %s: US$%.2f eq., %d pasos, %d s%s\n", topic, r.Cost, r.Turns, r.Seconds, map[bool]string{true: " · ⚠ " + r.Err}[r.Err != ""])
		}(i, t)
	}
	wg.Wait()

	var findings []*sweepFinding
	for _, r := range runs {
		for _, text := range parseFindings(r.text) {
			findings = append(findings, &sweepFinding{ID: fmt.Sprintf("H%d", len(findings)+1), Topic: r.Topic, Text: text})
			r.Findings++
		}
	}

	var verifier sweepRun
	verifier.Topic = "verificador"
	if len(findings) > 0 {
		start := time.Now()
		var b strings.Builder
		b.WriteString("Hallazgos del barrido. Comprobá cada uno:\n\n")
		for _, f := range findings {
			fmt.Fprintf(&b, "%s [%s] %s\n\n", f.ID, f.Topic, f.Text)
		}
		if mock {
			verifier.text, verifier.Cost, verifier.Turns = mockVerifier(findings), 0.4, 5
		} else {
			res, err := runAgent(root, b.String(), verifierSystem, verifierModel, verifierLevel, verifierBudget)
			verifier.text, verifier.Cost, verifier.Turns = res.Result, res.Cost, res.Turns
			if err != nil {
				verifier.Err = err.Error()
			}
		}
		verifier.Seconds = int(time.Since(start).Seconds())
		byID := map[string]*sweepFinding{}
		for _, f := range findings {
			byID[f.ID] = f
		}
		for _, m := range reVerdict.FindAllStringSubmatch(verifier.text, -1) {
			if f := byID[m[1]]; f != nil {
				f.Verdict, f.Check = m[2], m[3]
			}
		}
		_ = os.WriteFile(filepath.Join(dir, "verificador.md"), []byte(verifier.text), 0o644)
	}

	if !mock { // lo simulado no alimenta lo conocido
		remember(root, findings)
	}
	report := sweepReport(runs, &verifier, findings)
	path := filepath.Join(dir, "informe.md")
	if err := os.WriteFile(path, []byte(report), 0o644); err != nil {
		return "", err
	}
	raw, _ := json.MarshalIndent(map[string]any{"runs": runs, "verifier": verifier, "findings": findings}, "", "  ")
	_ = os.WriteFile(filepath.Join(dir, "barrido.json"), raw, 0o644)
	fmt.Print(report)
	return path, nil
}

// parseFindings toma cada HALLAZGO y las líneas de lista que lo siguen (algunos agentes lo parten en viñetas).
func parseFindings(text string) []string {
	var out []string
	cur := ""
	flush := func() {
		if cur != "" {
			out = append(out, strings.TrimSpace(cur))
			cur = ""
		}
	}
	for _, line := range strings.Split(text, "\n") {
		t := strings.TrimSpace(line)
		switch {
		case reFindStart.MatchString(line):
			flush()
			cur = strings.TrimSpace(strings.TrimLeft(t, "-* "))
		case cur != "" && (strings.HasPrefix(t, "- ") || strings.HasPrefix(t, "Destino") || strings.HasPrefix(t, "COMANDO")):
			cur += " " + t
		case t == "": // una línea en blanco no corta: hay quien separa la viñeta del destino
		default:
			flush()
		}
	}
	flush()
	return out
}

// oldestTopics: los n temas de knowledge/ con la revisión más vieja.
func oldestTopics(root string, n int) []string {
	files, _ := filepath.Glob(filepath.Join(root, "knowledge", "*", "sources.json"))
	type topic struct {
		id string
		at string
	}
	var all []topic
	for _, f := range files {
		raw, err := os.ReadFile(f)
		if err != nil {
			continue
		}
		var meta struct {
			ReviewedAt string `json:"reviewedAt"`
		}
		_ = json.Unmarshal(raw, &meta)
		all = append(all, topic{filepath.Base(filepath.Dir(f)), meta.ReviewedAt})
	}
	sort.Slice(all, func(i, j int) bool { return all[i].at < all[j].at })
	var ids []string
	for i := 0; i < len(all) && i < n; i++ {
		ids = append(ids, all[i].id)
	}
	return ids
}

func knownPath(root, topic string) string {
	return filepath.Join(root, "sala", ".barridos", "conocidos", topic+".md")
}

// sweepBrief: lo que se busca, lo que dice hoy el tema y lo que ya se encontró y comprobó en barridos anteriores.
func sweepBrief(root, topic string) string {
	brief := (&hub{root: root}).understandingBrief(topic, []string{"contradicciones", "huecos", "sin-prueba", "defectos"})
	if known, err := os.ReadFile(knownPath(root, topic)); err == nil && len(known) > 0 {
		brief += "\n\nYA CONOCIDO (comprobado en barridos anteriores; no lo repitas):\n" + string(known)
	}
	return brief
}

// remember agrega a lo conocido de cada tema lo que el verificador confirmó.
func remember(root string, findings []*sweepFinding) {
	byTopic := map[string][]string{}
	for _, f := range findings {
		if f.Verdict == "✓" {
			byTopic[f.Topic] = append(byTopic[f.Topic], "- "+time.Now().Format("2006-01-02")+" · "+f.Text)
		}
	}
	for topic, lines := range byTopic {
		path := knownPath(root, topic)
		_ = os.MkdirAll(filepath.Dir(path), 0o755)
		fh, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
		if err != nil {
			continue
		}
		_, _ = fh.WriteString(strings.Join(lines, "\n") + "\n")
		_ = fh.Close()
	}
}

func sweepReport(runs []*sweepRun, verifier *sweepRun, findings []*sweepFinding) string {
	var b strings.Builder
	total := verifier.Cost
	for _, r := range runs {
		total += r.Cost
	}
	count := map[string]int{}
	for _, f := range findings {
		count[f.Verdict]++
	}
	fmt.Fprintf(&b, "\n# Barrido · %s\n\n", time.Now().Format("2006-01-02 15:04"))
	fmt.Fprintf(&b, "%d hallazgo(s): %d ✓ · %d ✗ · %d — · %d sin veredicto. Costo: US$%.2f eq. (corre con el asiento; no se cobra aparte).\n\n",
		len(findings), count["✓"], count["✗"], count["—"], count[""], total)
	b.WriteString("| agente | US$ eq. | pasos | s | hallazgos |\n|---|---|---|---|---|\n")
	for _, r := range append(runs, verifier) {
		fmt.Fprintf(&b, "| %s%s | %.2f | %d | %d | %d |\n", r.Topic, map[bool]string{true: " ⚠"}[r.Err != ""], r.Cost, r.Turns, r.Seconds, r.Findings)
	}
	for _, f := range findings {
		v := f.Verdict
		if v == "" {
			v = "sin veredicto"
		}
		fmt.Fprintf(&b, "\n**%s · %s · %s**\n%s\n", f.ID, f.Topic, v, f.Text)
		if f.Check != "" {
			fmt.Fprintf(&b, "> %s\n", f.Check)
		}
	}
	return b.String()
}

type agentResult struct {
	Result string  `json:"result"`
	Cost   float64 `json:"total_cost_usd"`
	Turns  int     `json:"num_turns"`
}

// runAgent corre un agente de una sesión larga con `claude -p`, desde la raíz (carga el CLAUDE.md y sus guardas).
func runAgent(root, prompt, system, model, effort string, budget float64) (agentResult, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, "claude", "-p", prompt, "--output-format", "json",
		"--max-budget-usd", fmt.Sprintf("%.2f", budget), "--model", model, "--effort", effort,
		"--append-system-prompt", system,
		"--allowedTools", strings.Join(sweepTools, ","),
		"--disallowedTools", strings.Join(denied, ","),
		"--add-dir", filepath.Join(os.Getenv("HOME"), "Desktop", "CREDITOP", "github"),
		"--strict-mcp-config")
	cmd.Dir = root
	cmd.Env = childEnv()
	out, err := cmd.Output()
	lines := strings.Split(strings.TrimSpace(string(out)), "\n") // la CLI puede anteponer un aviso de modelo
	var res agentResult
	if jerr := json.Unmarshal([]byte(lines[len(lines)-1]), &res); jerr != nil && err == nil {
		err = fmt.Errorf("salida sin JSON")
	}
	return res, err
}

func mockSweepAgent(topic string) string {
	return "Revisé el tema contra main.\n\n" +
		"HALLAZGO: contradicción | " + topic + ": el tema dice X y `Service.php:10` hace Y | " + topic + " | COMANDO: git -C legacy-backend grep -n Y origin/main\n" +
		"HALLAZGO: hueco | regla en dos partes:\n- `A.php:3` filtra por estado\n- `B.php:9` lo repite | " + topic + " | COMANDO: git -C legacy-backend grep -n estado origin/main\n\n" +
		"PREGUNTA: ¿esto pesa en prod?"
}

func mockVerifier(findings []*sweepFinding) string {
	var b strings.Builder
	for i, f := range findings {
		mark := "✓"
		if i%3 == 2 {
			mark = "✗"
		}
		fmt.Fprintf(&b, "VEREDICTO: %s | %s | git -C legacy-backend grep -n … origin/main | visto en main\n", f.ID, mark)
	}
	return b.String()
}
