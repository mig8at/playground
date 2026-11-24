package main

// EL RESUMEN: junta en una línea de tiempo lo dicho (transcript.jsonl) con lo visto (frames.jsonl) y arma el
// recordatorio de la reunión.
//
//  1. Pantallas: cada captura guardada vale hasta la siguiente. Las que se vieron un rato (stableSeconds) o mientras
//     alguien decía «esto», «acá», «les muestro»… (deictic) son candidatas a momento clave; quedan las mejores
//     MaxScreens, en orden de tiempo.
//  2. Para cada una, Qwen3-VL-4B en esta Mac (su propio llama-server en :5252, se apaga solo) ve la captura y lo que se
//     dijo mientras estaba a la vista, y contesta qué se ve, si lo dicho habla de eso y la frase que lo muestra.
//  3. El resumen de lo dicho (resumen, decisiones, pendientes, citando las pantallas [P3]) lo escribe Claude Haiku 5.5
//     por `claude -p` (askHaiku; decisión de Miguel del 2026-11-23: el de 4B se perdía los pendientes, y con Claude
//     Code no se depende del playground ni de Bedrock).
//     Sale de la Mac SÓLO ese texto (la transcripción y lo que se vio en cada pantalla, en palabras): el audio y las
//     capturas no. Si Claude Code no contesta, lo escribe Qwen3-VL-4B acá; --local lo fuerza.
//  4. Quedan timeline.json, summary.md y summary.html (las imágenes por ruta relativa a frames/).

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"html"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"creditop/my-tools/lib/llamaserve"
	"creditop/my-tools/lib/models"
	"creditop/my-tools/lib/notice"
)

type summarizeOptions struct {
	Local      bool // el resumen con Qwen3-VL-4B en esta Mac, sin sacar el texto
	MaxScreens int
}

func summarizeCmd(args []string) error {
	fs := flag.NewFlagSet("summarize", flag.ContinueOnError)
	local := fs.Bool("local", false, "el resumen con Qwen3-VL-4B en esta Mac, sin sacar el texto (por defecto lo escribe Claude Haiku 5.5 por claude -p)")
	fs.Bool("remote", true, "ya es lo de siempre (queda por compatibilidad)")
	maxScreens := fs.Int("max-screens", 20, "cuántas pantallas mira el modelo de visión, como mucho")
	if err := fs.Parse(args); err != nil {
		return err
	}
	var pos []string
	if fs.NArg() > 0 { // la carpeta puede ir antes de las opciones
		pos = fs.Args()[:1]
		if err := fs.Parse(fs.Args()[1:]); err != nil {
			return err
		}
	}
	d, err := pick(pos)
	if err != nil {
		return err
	}
	if !recorderDone(d) {
		return errors.New("la grabación sigue en curso: bin/minutes stop la frena y arma el resumen")
	}
	if err := transcribePending(d, true); err != nil {
		return err
	}
	return summarize(d, summarizeOptions{Local: *local, MaxScreens: *maxScreens})
}

// Frame: una captura guardada (frames.jsonl).
type Frame struct {
	T      float64 `json:"t"`
	File   string  `json:"file"`
	Change float64 `json:"change"`
}

// Screen: una captura y el tiempo que estuvo a la vista, con lo que dijo el modelo de visión.
type Screen struct {
	ID       string   `json:"id"` // P1, P2… (pantalla)
	Start    float64  `json:"start"`
	End      float64  `json:"end"`
	File     string   `json:"file"`
	Deictic  []string `json:"deictic,omitempty"` // «esto», «acá»… dichos mientras estaba a la vista
	Said     string   `json:"said,omitempty"`
	Seen     string   `json:"seen,omitempty"`     // qué se ve, según el modelo
	Refers   bool     `json:"refers"`             // lo dicho habla de lo que se ve
	Evidence string   `json:"evidence,omitempty"` // la frase que lo muestra
	Key      int      `json:"key"`                // 0-3, cuán importante parece
	score    float64
}

// Timeline: timeline.json.
type Timeline struct {
	Title    string         `json:"title"`
	Started  string         `json:"started"`
	Seconds  float64        `json:"seconds"`
	Frames   int            `json:"frames"`
	Screens  []*Screen      `json:"screens"`
	Segments []TimedSegment `json:"segments"`
	Speakers []Speaker      `json:"speakers,omitempty"`
	Summary  string         `json:"summary"`
	Model    string         `json:"model"`
}

// TimedSegment: una frase y la captura que estaba en pantalla mientras se decía.
type TimedSegment struct {
	Segment
	Frame  string `json:"frame"`            // la captura a la vista
	Screen string `json:"screen,omitempty"` // el id de la pantalla clave, si es una
	Who    string `json:"who"`              // en palabras, al armar el resumen: yo · Persona 2 · Laura · reunión
}

const stableSeconds = 4.0

// Lo que se dice al señalar algo de la pantalla. Sin \b: en Go \b es sólo ASCII y «acá» o «aquí» no lo cumplen.
var deicticRe = regexp.MustCompile(`(?i)(?:^|[^\p{L}])(esto|esta|este|estos|estas|ac[aá]|aqu[ií]|ah[ií]|les muestro|te muestro|como ven|como pueden ver|vean|miren|f[ií]jense|en pantalla|la pantalla|comparto|compartiendo|este de ac[aá]|lo que ven|ven ac[aá]|arriba|abajo|a la derecha|a la izquierda|este bot[oó]n|esta tabla|este gr[aá]fico|esta l[ií]nea)(?:[^\p{L}]|$)`)

func loadFrames(d string) []Frame {
	b, err := os.ReadFile(filepath.Join(d, "frames.jsonl"))
	if err != nil {
		return nil
	}
	var out []Frame
	for _, l := range strings.Split(string(b), "\n") {
		var f Frame
		if json.Unmarshal([]byte(l), &f) == nil && f.File != "" {
			out = append(out, f)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].T < out[j].T })
	return out
}

// cleanSegments: sin eco ni vacíos, con el eco recalculado sobre todo (en vivo pudo faltar el tramo del sistema).
func cleanSegments(all []Segment) []Segment {
	var mic []Segment
	var out []Segment
	for _, s := range all {
		if s.Source == "mic" {
			s.Echo = false
			mic = append(mic, s)
		} else {
			out = append(out, s)
		}
	}
	markEcho(mic, all)
	for _, s := range mic {
		if !s.Echo {
			out = append(out, s)
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Start < out[j].Start })
	return out
}

// buildScreens: una pantalla por captura, con lo dicho mientras estaba a la vista, y las candidatas a momento clave.
func buildScreens(frames []Frame, segs []Segment, total float64, max int) []*Screen {
	var all []*Screen
	for i, f := range frames {
		end := total
		if i+1 < len(frames) {
			end = frames[i+1].T
		}
		s := &Screen{Start: f.T, End: end, File: f.File}
		var said []string
		seen := map[string]bool{}
		for _, g := range segs {
			// lo dicho un poco antes también cuenta: se anuncia («ahora les muestro…») y después cambia la pantalla
			if g.End >= s.Start-3 && g.Start <= s.End {
				said = append(said, g.Text)
				if g.Start >= s.Start-1 {
					for _, sm := range deicticRe.FindAllStringSubmatch(g.Text, -1) {
						m := strings.ToLower(sm[1])
						if !seen[m] {
							seen[m] = true
							s.Deictic = append(s.Deictic, m)
						}
					}
				}
			}
		}
		s.Said = tail(strings.Join(said, " "), 1500)
		dur := s.End - s.Start
		s.score = min(dur, 120)/10 + float64(len(s.Deictic))*3 + float64(len(words(s.Said)))/40
		if dur >= stableSeconds || (len(s.Deictic) > 0 && dur >= 1.5) {
			all = append(all, s)
		}
	}
	// si nada se quedó quieto (un video, una pantalla que no para), al menos la primera y la última
	if len(all) == 0 && len(frames) > 0 {
		for _, i := range []int{0, len(frames) - 1} {
			end := total
			if i+1 < len(frames) {
				end = frames[i+1].T
			}
			all = append(all, &Screen{Start: frames[i].T, End: end, File: frames[i].File})
			if len(frames) == 1 {
				break
			}
		}
	}
	if len(all) > max {
		sort.SliceStable(all, func(i, j int) bool { return all[i].score > all[j].score })
		all = all[:max]
	}
	sort.Slice(all, func(i, j int) bool { return all[i].Start < all[j].Start })
	for i, s := range all {
		s.ID = fmt.Sprintf("P%d", i+1)
	}
	return all
}

func summarize(d string, o summarizeOptions) error {
	var meta Meta
	readJSON(filepath.Join(d, "meta.json"), &meta)
	st, _ := recorderState(d)
	frames := loadFrames(d)
	segs := cleanSegments(loadTranscript(d))
	total := st.Seconds
	if len(segs) > 0 && segs[len(segs)-1].End > total {
		total = segs[len(segs)-1].End
	}
	if o.MaxScreens <= 0 {
		o.MaxScreens = 20
	}
	// quién habla, antes de cruzar con las pantallas: una frase de dos personas se corta en dos
	turns, derr := diarize(d)
	if derr != nil {
		fmt.Fprintf(os.Stderr, "  ⚠ sin quién habla (queda «reunión»): %v\n", derr)
	}
	segs = splitBySpeaker(segs, turns)
	screens := buildScreens(frames, segs, total, o.MaxScreens)
	fmt.Fprintf(os.Stderr, "  · %d frases, %d capturas, %d pantallas para mirar\n", len(segs), len(frames), len(screens))

	vision := visionSpec()
	visionUp := false
	ensureVision := func() error {
		if visionUp {
			return nil
		}
		fmt.Fprintln(os.Stderr, "  · levantando Qwen3-VL-4B en esta Mac…")
		if err := vision.Ensure(90 * time.Second); err != nil {
			return fmt.Errorf("el modelo de visión: %w", err)
		}
		visionUp = true
		return nil
	}
	if len(screens) > 0 {
		if err := ensureVision(); err != nil {
			return err
		}
	}
	for i, s := range screens {
		fmt.Fprintf(os.Stderr, "\r  · mirando la pantalla %d/%d", i+1, len(screens))
		if err := lookAt(vision, d, s); err != nil {
			fmt.Fprintf(os.Stderr, "\n  ⚠ %s: %v\n", s.ID, err)
		}
	}
	if len(screens) > 0 {
		fmt.Fprintln(os.Stderr)
	}

	if screens == nil {
		screens = []*Screen{} // sólo audio: una lista vacía, no null
	}
	tl := Timeline{Title: meta.Title, Started: st.Started, Seconds: total, Frames: len(frames), Screens: screens}
	for _, g := range segs {
		ts := TimedSegment{Segment: g}
		ts.Words = nil // ya sirvieron para cortar; en timeline.json sólo pesarían
		mid := (g.Start + g.End) / 2
		for _, f := range frames {
			if f.T <= mid {
				ts.Frame = f.File
			}
		}
		for _, s := range screens {
			if mid >= s.Start && mid < s.End {
				ts.Screen = s.ID
			}
		}
		tl.Segments = append(tl.Segments, ts)
	}
	assignSpeakers(tl.Segments, turns)
	names := speakerNames(d)
	for i := range tl.Segments {
		tl.Segments[i].Who = who(tl.Segments[i], names)
	}
	tl.Speakers = speakersOf(tl.Segments, names)

	fmt.Fprintln(os.Stderr, "  · escribiendo el resumen…")
	prompt := summaryPrompt(tl)
	var summary string
	var err error
	if !o.Local {
		tl.Model = "Claude Haiku 5.5 (claude -p)"
		summary, err = askHaiku(prompt)
		if err != nil {
			fmt.Fprintf(os.Stderr, "  ⚠ el resumen no salió de Claude Haiku (%v): lo escribe Qwen3-VL-4B en esta Mac\n", err)
			o.Local = true
		}
	}
	if o.Local {
		tl.Model = "Qwen3-VL-4B en esta Mac"
		if err = ensureVision(); err == nil {
			summary, err = chat(vision, []any{map[string]any{"type": "text", "text": prompt}}, 1200)
		}
	}
	if err != nil {
		summary = "_(no se pudo escribir el resumen: " + err.Error() + ")_"
	}
	tl.Summary = strings.TrimSpace(stripThinking(summary))
	if len(segs) == 0 {
		tl.Summary = "_(no se transcribió nada: ¿el audio estaba mudo, o faltó el permiso de Micrófono?)_"
	}

	if err := writeJSON(filepath.Join(d, "timeline.json"), tl); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(d, "summary.md"), []byte(renderMarkdown(tl)), 0o644); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(d, "summary.html"), []byte(renderHTML(tl)), 0o644); err != nil {
		return err
	}
	out := filepath.Join(d, "summary.html")
	fmt.Fprintf(os.Stderr, "✓ resumen: %s\n", out)
	fmt.Println(out)
	notice.Send(notice.Notice{App: "minutes", Title: "El resumen de la reunión está listo", Body: firstNonEmpty(meta.Title, filepath.Base(d)), Group: "minutes"})
	return nil
}

func firstNonEmpty(a ...string) string {
	for _, s := range a {
		if s != "" {
			return s
		}
	}
	return ""
}

// ---- el modelo de visión ----

const visionPort = 5252

func visionSpec() llamaserve.Spec {
	paths, err := models.For(models.FindRoot(), "minutes", "Qwen/Qwen3-VL-4B-Instruct")
	args := []string{"-ngl", "99", "-c", "16384", "--reasoning-budget", "0"}
	if err == nil && len(paths) >= 2 {
		args = append([]string{"-m", paths[0], "--mmproj", paths[1]}, args...)
	}
	return llamaserve.Spec{Name: "minutes-vision", Port: visionPort, Args: args, Idle: 3 * time.Minute}
}

const lookPrompt = `Esta es una captura de la pantalla compartida en una reunión, en el minuto %s. Lo que se dijo mientras estaba a la vista (transcripción automática, puede tener errores):
«%s»

Contestá SÓLO este JSON, en español:
{"seen": "qué se ve, en una o dos frases: la app o el documento y lo legible que importe (títulos, cifras, nombres)",
 "refers": true si lo dicho habla de lo que se ve: lo señala («esto que les muestro», «acá ven»), lo lee o lo comenta; false si habla de otra cosa o no se dijo nada,
 "evidence": "la frase de lo dicho que habla de la pantalla, copiada tal cual; vacío si refers es false",
 "key": de 0 a 3, cuán importante parece este momento para recordar la reunión}`

func lookAt(vision llamaserve.Spec, d string, s *Screen) error {
	img, err := os.ReadFile(filepath.Join(d, s.File))
	if err != nil {
		return err
	}
	said := s.Said
	if said == "" {
		said = "(no se dijo nada)"
	}
	content := []any{
		map[string]any{"type": "image_url", "image_url": map[string]string{"url": "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(img)}},
		map[string]any{"type": "text", "text": fmt.Sprintf(lookPrompt, clock(s.Start), said)},
	}
	text, err := chat(vision, content, 300)
	if err != nil {
		return err
	}
	var r struct {
		Seen     string `json:"seen"`
		Refers   bool   `json:"refers"`
		Evidence string `json:"evidence"`
		Key      int    `json:"key"`
	}
	if err := json.Unmarshal([]byte(jsonPart(text)), &r); err != nil {
		s.Seen = strings.TrimSpace(text)
		return fmt.Errorf("el modelo no devolvió JSON: %.120s", text)
	}
	// el modelo a veces trae la frase ya entre comillas, y la interfaz le pone las suyas
	s.Seen, s.Refers, s.Evidence, s.Key = r.Seen, r.Refers, strings.Trim(strings.TrimSpace(r.Evidence), `«»"“”`), max(0, min(3, r.Key))
	if s.Said == "" {
		s.Refers, s.Evidence = false, ""
	}
	return nil
}

func jsonPart(s string) string {
	s = stripThinking(s)
	i, j := strings.Index(s, "{"), strings.LastIndex(s, "}")
	if i < 0 || j < i {
		return s
	}
	return s[i : j+1]
}

var thinkRe = regexp.MustCompile(`(?s)<think>.*?</think>`)

func stripThinking(s string) string { return strings.TrimSpace(thinkRe.ReplaceAllString(s, "")) }

func chat(vision llamaserve.Spec, content []any, maxTokens int) (string, error) {
	vision.Touch()
	body, _ := json.Marshal(map[string]any{
		"messages":             []any{map[string]any{"role": "user", "content": content}},
		"temperature":          0.2,
		"max_tokens":           maxTokens,
		"chat_template_kwargs": map[string]bool{"enable_thinking": false},
	})
	resp, err := (&http.Client{Timeout: 5 * time.Minute}).Post(vision.URL()+"/v1/chat/completions", "application/json", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("llama-server %d: %.300s", resp.StatusCode, raw)
	}
	var r struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(raw, &r); err != nil || len(r.Choices) == 0 {
		return "", fmt.Errorf("respuesta sin contenido: %.300s", raw)
	}
	return r.Choices[0].Message.Content, nil
}

// haikuModel: el id completo. ⚠ El alias «haiku» de Claude Code da Haiku 4.5 (medido el 2026-11-23); con el id de 5.5
// la CLI avisa «unrecognized_model» por stderr pero lo corre (modelUsage dice claude-haiku-5-5).
const haikuModel = "claude-haiku-5-5"

// askHaiku: el resumen con Claude Haiku 5.5 por Claude Code (`claude -p`), como la ortografía de Captura: sin
// herramientas, sin MCP, sin ajustes, en una carpeta vacía y sin guardar la sesión. No depende del playground: entra con
// la sesión de claude.ai de Miguel. ⚠ Gasta el límite de su asiento (unos centavos eq. API por reunión).
func askHaiku(prompt string) (string, error) {
	claude := findTool("claude")
	if claude == "" {
		home, _ := os.UserHomeDir()
		if p := filepath.Join(home, ".local", "bin", "claude"); fileExists(p) {
			claude = p
		}
	}
	if claude == "" {
		return "", errors.New("no está `claude` (Claude Code) en esta máquina")
	}
	dir, err := os.MkdirTemp("", "minutes-summary")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(dir)
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, claude, "-p", "--model", haikuModel, "--output-format", "json", "--tools", "",
		"--strict-mcp-config", "--restricted", "--no-session-persistence")
	cmd.Dir = dir
	cmd.Stdin = strings.NewReader(prompt)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	var r struct {
		Result  string         `json:"result"`
		IsError bool           `json:"is_error"`
		Usage   map[string]any `json:"modelUsage"`
	}
	if jerr := json.Unmarshal(out, &r); jerr != nil {
		if err == nil {
			err = jerr
		}
		return "", fmt.Errorf("claude -p: %v: %s", err, tail(strings.TrimSpace(stderr.String()+" "+string(out)), 200))
	}
	if r.IsError || strings.TrimSpace(r.Result) == "" {
		return "", fmt.Errorf("claude -p no devolvió el resumen: %s", tail(r.Result, 200))
	}
	if _, ok := r.Usage[haikuModel]; !ok && len(r.Usage) > 0 {
		return "", fmt.Errorf("contestó otro modelo, no %s", haikuModel)
	}
	return r.Result, nil
}

// summaryPrompt: lo dicho con sus tiempos y quién (yo = el micrófono, reunión = el audio del sistema), y lo que se vio
// en cada pantalla clave. Un texto muy largo se recorta por el medio (el prototipo no resume por partes todavía).
func summaryPrompt(tl Timeline) string {
	var b strings.Builder
	b.WriteString("Sos el asistente que toma notas de una reunión. Abajo está la transcripción automática (con errores) y las pantallas que se mostraron.\n\n")
	b.WriteString("Escribí en español, en Markdown, SÓLO estas secciones:\n## Resumen\n3 a 6 viñetas con lo que se trató.\n## Decisiones\nviñetas con lo que se dio por decidido («decidimos», «quedamos en», «vamos a»…); «Ninguna clara.» si no hay.\n## Pendientes\nviñetas con quién y qué; «Ninguno claro.» si no hay.\n")
	b.WriteString("Cuando un punto se apoye en una pantalla, citala con su id entre corchetes, por ejemplo [P2]. No inventes nada que no esté abajo.\n\n### Pantallas\n")
	for _, s := range tl.Screens {
		fmt.Fprintf(&b, "[%s] %s–%s: %s", s.ID, clock(s.Start), clock(s.End), firstNonEmpty(s.Seen, "(sin descripción)"))
		if s.Refers {
			fmt.Fprintf(&b, " — se habló de ella: «%s»", s.Evidence)
		}
		b.WriteString("\n")
	}
	b.WriteString("\n### Transcripción (yo = quien graba; Persona N o un nombre = alguien de la reunión; reunión = no se supo quién)\n")
	var lines []string
	for _, g := range tl.Segments {
		ref := ""
		if g.Screen != "" {
			ref = " (" + g.Screen + ")"
		}
		lines = append(lines, fmt.Sprintf("[%s] %s%s: %s", clock(g.Start), g.Who, ref, g.Text))
	}
	text := strings.Join(lines, "\n")
	const limit = 30000
	if r := []rune(text); len(r) > limit {
		text = string(r[:limit/2]) + "\n[… se omite la mitad de la reunión …]\n" + string(r[len(r)-limit/2:])
	}
	b.WriteString(text)
	return b.String()
}

// ---- la salida ----

func renderMarkdown(tl Timeline) string {
	var b strings.Builder
	fmt.Fprintf(&b, "# %s\n\n", firstNonEmpty(tl.Title, "Reunión"))
	fmt.Fprintf(&b, "%s · %s · %d capturas distintas · resumen: %s\n\n", tl.Started, clock(tl.Seconds), tl.Frames, tl.Model)
	b.WriteString(tl.Summary + "\n\n## Momentos en pantalla\n\n")
	for _, s := range tl.Screens {
		fmt.Fprintf(&b, "### %s · %s–%s\n\n![%s](%s)\n\n%s\n\n", s.ID, clock(s.Start), clock(s.End), s.ID, s.File, firstNonEmpty(s.Seen, "_(sin descripción)_"))
		if s.Refers {
			fmt.Fprintf(&b, "> Se habló de esto: «%s»\n\n", s.Evidence)
		}
	}
	b.WriteString("## Transcripción\n\n")
	for _, g := range tl.Segments {
		ref := ""
		if g.Screen != "" {
			ref = " [" + g.Screen + "]"
		}
		fmt.Fprintf(&b, "- `%s` **%s**%s %s\n", clock(g.Start), g.Who, ref, g.Text)
	}
	return b.String()
}

var screenRefRe = regexp.MustCompile(`\[(P\d+)\]`)

// mdToHTML: lo poco de Markdown que escribe el modelo (títulos, viñetas, negrita) y los [P3] como enlaces.
func mdToHTML(md string) string {
	var b strings.Builder
	inList := false
	for _, l := range strings.Split(md, "\n") {
		t := strings.TrimSpace(l)
		isItem := strings.HasPrefix(t, "- ") || strings.HasPrefix(t, "* ")
		if inList && !isItem {
			b.WriteString("</ul>\n")
			inList = false
		}
		esc := html.EscapeString(t)
		esc = regexp.MustCompile(`\*\*(.+?)\*\*`).ReplaceAllString(esc, "<strong>$1</strong>")
		esc = screenRefRe.ReplaceAllString(esc, `<a class="ref" href="#$1">$1</a>`)
		switch {
		case t == "":
		case strings.HasPrefix(t, "#"):
			b.WriteString("<h3>" + strings.TrimSpace(strings.TrimLeft(esc, "#")) + "</h3>\n")
		case isItem:
			if !inList {
				b.WriteString("<ul>\n")
				inList = true
			}
			b.WriteString("<li>" + strings.TrimSpace(esc[2:]) + "</li>\n")
		default:
			b.WriteString("<p>" + esc + "</p>\n")
		}
	}
	if inList {
		b.WriteString("</ul>\n")
	}
	return b.String()
}

func renderHTML(tl Timeline) string {
	var b strings.Builder
	title := html.EscapeString(firstNonEmpty(tl.Title, "Reunión"))
	b.WriteString(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>` + title + `</title>
<style>
:root{--bg:#fafaf9;--fg:#1c1917;--muted:#78716c;--line:#e7e5e4;--card:#fff;--accent:#2563eb;--hit:#fef3c7}
@media (prefers-color-scheme:dark){:root{--bg:#1c1917;--fg:#f5f5f4;--muted:#a8a29e;--line:#44403c;--card:#292524;--accent:#60a5fa;--hit:#422006}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 -apple-system,system-ui,sans-serif}
main{max-width:1100px;margin:0 auto;padding:24px 16px}
h1{margin:0 0 4px;font-size:24px}.meta{color:var(--muted);margin-bottom:24px}
h2{font-size:18px;border-bottom:1px solid var(--line);padding-bottom:6px;margin-top:32px}
h3{font-size:15px;margin:18px 0 6px}
a{color:var(--accent)}a.ref{font-weight:600;text-decoration:none}
.screens{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px}
.screen{background:var(--card);border:1px solid var(--line);border-radius:8px;overflow:hidden;scroll-margin-top:16px}
.screen:target{outline:2px solid var(--accent)}
.screen img{width:100%;display:block;border-bottom:1px solid var(--line);cursor:zoom-in}
.screen .body{padding:10px 12px}.screen .when{color:var(--muted);font-size:13px}
.said{background:var(--hit);border-radius:6px;padding:6px 8px;margin-top:8px;font-size:14px}
.stars{color:#d97706}
table{border-collapse:collapse;width:100%}td{vertical-align:top;padding:4px 6px;border-bottom:1px solid var(--line)}
td.t{color:var(--muted);white-space:nowrap;font-variant-numeric:tabular-nums}td.who{color:var(--muted);white-space:nowrap}
tr.on td{background:var(--hit)}
</style></head><body><main>
`)
	fmt.Fprintf(&b, "<h1>%s</h1><div class=\"meta\">%s · %s · %d capturas distintas · %d momentos en pantalla · resumen: %s</div>\n",
		title, html.EscapeString(tl.Started), clock(tl.Seconds), tl.Frames, len(tl.Screens), html.EscapeString(tl.Model))
	b.WriteString("<h2>Recordatorio</h2>\n" + mdToHTML(tl.Summary))
	b.WriteString("<h2>Momentos en pantalla</h2>\n<div class=\"screens\">\n")
	for _, s := range tl.Screens {
		fmt.Fprintf(&b, `<div class="screen" id="%s"><a href="%s" target="_blank"><img src="%s" loading="lazy" alt="%s"></a><div class="body"><div class="when"><strong>%s</strong> · %s–%s <span class="stars">%s</span></div><div>%s</div>`,
			s.ID, s.File, s.File, s.ID, s.ID, clock(s.Start), clock(s.End), strings.Repeat("★", s.Key), html.EscapeString(firstNonEmpty(s.Seen, "(sin descripción)")))
		if s.Refers {
			fmt.Fprintf(&b, `<div class="said">Se habló de esto: «%s»</div>`, html.EscapeString(s.Evidence))
		}
		b.WriteString("</div></div>\n")
	}
	b.WriteString("</div>\n<h2>Transcripción</h2>\n<table>\n")
	refers := map[string]bool{}
	for _, s := range tl.Screens {
		refers[s.ID] = s.Refers
	}
	for _, g := range tl.Segments {
		cls, ref := "", ""
		if g.Screen != "" {
			ref = fmt.Sprintf(` <a class="ref" href="#%s">%s</a>`, g.Screen, g.Screen)
			if refers[g.Screen] {
				cls = ` class="on"`
			}
		} else if g.Frame != "" {
			ref = fmt.Sprintf(` <a href="%s" target="_blank" title="lo que estaba en pantalla">▣</a>`, g.Frame)
		}
		fmt.Fprintf(&b, "<tr%s><td class=\"t\">%s</td><td class=\"who\">%s</td><td>%s%s</td></tr>\n", cls, clock(g.Start), html.EscapeString(g.Who), html.EscapeString(g.Text), ref)
	}
	b.WriteString("</table>\n</main></body></html>\n")
	return b.String()
}
