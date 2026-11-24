package main

// LO QUE USA UN AGENTE: las salidas por máquina de `status`, `list` y `stop` (--json), y `show`, `context`, `wait` y
// `search`. La app de Cockpit es para VER; quien trabaja con las reuniones es un agente por consola, así que todo lo
// que sabe la app tiene que poder pedirse acá, con un formato fijo y códigos de salida que distingan los casos.
//
// El formato es `minutes.recording/v1` (una grabación) y `minutes.search/v1` (una búsqueda). Un campo nuevo no cambia
// la versión; quitar o cambiar uno, sí.

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode"

	"golang.org/x/text/runes"
	"golang.org/x/text/transform"
	"golang.org/x/text/unicode/norm"
)

// Los códigos de salida. 0 salió bien; 2 se pidió mal. Los demás dicen qué pasó sin tener que leer el texto.
const (
	exitFailed    = 1 // falló (el mensaje dice por qué)
	exitUsage     = 2 // comando o argumentos mal
	exitBusy      = 3 // hay algo en curso: una grabación, o alguien frenando o armando el resumen de ésta
	exitNotFound  = 4 // no existe la grabación pedida, o no hay ninguna
	exitTimeout   = 5 // `wait` se cansó de esperar
	exitNoSummary = 6 // terminó, pero sin resumen (se cortó a mitad o falló: `summarize` lo rearma)
)

// codeError: un error con su código de salida.
type codeError struct {
	code int
	err  error
}

func (e codeError) Error() string { return e.err.Error() }
func (e codeError) Unwrap() error { return e.err }

func withCode(code int, format string, a ...any) error {
	return codeError{code, fmt.Errorf(format, a...)}
}

func exitCode(err error) int {
	var ce codeError
	if errors.As(err, &ce) {
		return ce.code
	}
	return exitFailed
}

// busyState: busy.json, lo que deja `stepsLog` mientras alguien frena o arma el resumen. Con el pid se sabe desde
// otra terminal si sigue trabajando o se cortó (el servidor reiniciado a mitad, un Ctrl-C).
type busyState struct {
	Pid     int    `json:"pid"`
	Step    string `json:"step"` // frenando · armando el resumen
	Started string `json:"started"`
}

func readBusy(d string) (busyState, bool) {
	var b busyState
	if readJSON(filepath.Join(d, "busy.json"), &b) != nil {
		return b, false
	}
	return b, true
}

// Los estados de una grabación, para quien la llama:
//
//	recording    la grabadora corre
//	finishing    alguien la frenó y está terminando de transcribir (y después arma el resumen)
//	summarizing  alguien está armando el resumen
//	done         tiene resumen
//	no_summary   terminó sin resumen: nunca se armó, o se cortó a mitad (`interrupted`)
func recordingState(d string) (state string, interrupted bool) {
	if !recorderDone(d) {
		return "recording", false
	}
	if b, ok := readBusy(d); ok {
		if alive(b.Pid) {
			if b.Step == "frenando" {
				return "finishing", false
			}
			return "summarizing", false
		}
		interrupted = true
	}
	if fileExists(filepath.Join(d, "timeline.json")) {
		return "done", interrupted
	}
	return "no_summary", interrupted
}

// recordingJSON: minutes.recording/v1. `segments` y `screens` sólo con detail (show); `list` y `status` van livianos.
type recordingJSON struct {
	Schema       string            `json:"schema"`
	ID           string            `json:"id"`
	Dir          string            `json:"dir"`
	Title        string            `json:"title"`
	Started      string            `json:"started"`
	Seconds      float64           `json:"seconds"`
	State        string            `json:"state"`
	Interrupted  bool              `json:"interrupted,omitempty"`
	AudioOnly    bool              `json:"audio_only"`
	Lang         string            `json:"lang,omitempty"`
	Frames       int               `json:"frames"`
	Segments     int               `json:"segment_count"`
	Pending      int               `json:"pending_chunks"`
	Failed       int               `json:"failed_chunks"`
	SummaryModel string            `json:"summary_model,omitempty"`
	Speakers     []Speaker         `json:"speakers,omitempty"`
	Files        map[string]string `json:"files"`
	Summary      string            `json:"summary,omitempty"`
	ScreenList   []*Screen         `json:"screens,omitempty"`
	SegmentList  []agentSegment    `json:"segments,omitempty"`
}

// agentSegment: una frase como la lee un agente: quién, cuándo, qué, y la pantalla clave si la había.
type agentSegment struct {
	Start  float64 `json:"start"`
	End    float64 `json:"end"`
	Who    string  `json:"who"`
	Text   string  `json:"text"`
	Screen string  `json:"screen,omitempty"`
}

func recordingInfo(d string, detail bool) recordingJSON {
	var m Meta
	readJSON(filepath.Join(d, "meta.json"), &m)
	st, _ := recorderState(d)
	state, interrupted := recordingState(d)
	r := recordingJSON{Schema: "minutes.recording/v1", ID: filepath.Base(d), Dir: d, Title: m.Title,
		Started: firstNonEmpty(st.Started, m.Started), Seconds: round1(st.Seconds), State: state, Interrupted: interrupted,
		AudioOnly: m.AudioOnly, Lang: m.Lang, Frames: countLines(filepath.Join(d, "frames.jsonl")),
		Pending: len(pendingChunks(d)), Failed: countLines(filepath.Join(d, "audio", "failed.txt")), Files: map[string]string{}}
	if state == "recording" {
		if t, err := time.Parse(time.RFC3339, st.Started); err == nil {
			r.Seconds = round1(time.Since(t).Seconds())
		}
	}
	for key, name := range map[string]string{"summary_md": "summary.md", "summary_html": "summary.html", "timeline": "timeline.json", "transcript": "transcript.jsonl", "steps_log": "steps.log"} {
		if p := filepath.Join(d, name); fileExists(p) {
			r.Files[key] = p
		}
	}
	var tl Timeline
	hasTL := readJSON(filepath.Join(d, "timeline.json"), &tl) == nil
	names := speakerNames(d)
	if hasTL {
		r.SummaryModel = tl.Model
		r.Segments = len(tl.Segments)
		for _, sp := range tl.Speakers {
			if n := names[fmt.Sprint(sp.ID)]; n != "" {
				sp.Name = n
			}
			r.Speakers = append(r.Speakers, sp)
		}
	} else {
		r.Segments = len(cleanSegments(loadTranscript(d)))
	}
	if !detail {
		return r
	}
	if hasTL {
		r.Summary = renameSpeakers(tl.Summary, names)
		for _, s := range tl.Screens {
			s.File = filepath.Join(d, s.File)
			r.ScreenList = append(r.ScreenList, s)
		}
	}
	r.SegmentList = agentSegments(d, tl, hasTL, names)
	return r
}

// agentSegments: las frases con quién las dijo. Con el resumen armado salen de timeline.json (ya cortadas por voz);
// antes, de la transcripción cruda, con «yo» y «reunión».
func agentSegments(d string, tl Timeline, hasTL bool, names map[string]string) []agentSegment {
	var out []agentSegment
	if hasTL {
		for _, g := range tl.Segments {
			who := g.Who
			if g.Speaker != nil {
				if n := names[fmt.Sprint(*g.Speaker)]; n != "" {
					who = n
				}
			}
			out = append(out, agentSegment{Start: round1(g.Start), End: round1(g.End), Who: who, Text: g.Text, Screen: g.Screen})
		}
		return out
	}
	segs := cleanSegments(loadTranscript(d))
	sort.SliceStable(segs, func(i, j int) bool { return segs[i].Start < segs[j].Start })
	for _, g := range segs {
		out = append(out, agentSegment{Start: round1(g.Start), End: round1(g.End), Who: speakerLabel(g.Source), Text: g.Text})
	}
	return out
}

// renameSpeakers: «Persona 2» → el nombre que le pusieron después de armar el resumen.
func renameSpeakers(text string, names map[string]string) string {
	for id, n := range names {
		var i int
		if _, err := fmt.Sscan(id, &i); err == nil && n != "" {
			text = strings.ReplaceAll(text, fmt.Sprintf("Persona %d", i+1), n)
		}
	}
	return text
}

func printJSON(v any) error {
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	enc.SetEscapeHTML(false)
	return enc.Encode(v)
}

// pickOrCode: pick, con el código «no existe».
func pickOrCode(args []string) (string, error) {
	d, err := pick(args)
	if err != nil {
		return "", codeError{exitNotFound, err}
	}
	return d, nil
}

// splitFlags: parsea las opciones aunque la grabación venga antes (`show 2026-… --json`).
func splitFlags(fs *flag.FlagSet, args []string) ([]string, error) {
	var pos []string
	for {
		if err := fs.Parse(args); err != nil {
			return nil, codeError{exitUsage, err}
		}
		if fs.NArg() == 0 {
			return pos, nil
		}
		pos = append(pos, fs.Arg(0))
		args = fs.Args()[1:]
	}
}

// ---- show ----

func show(args []string) error {
	fs := flag.NewFlagSet("show", flag.ContinueOnError)
	asJSON := fs.Bool("json", false, "minutes.recording/v1 entero: resumen, personas, pantallas y frases")
	pos, err := splitFlags(fs, args)
	if err != nil {
		return err
	}
	d, err := pickOrCode(pos)
	if err != nil {
		return err
	}
	r := recordingInfo(d, true)
	if *asJSON {
		return printJSON(r)
	}
	fmt.Printf("%s · %s · %s · %s\n", r.ID, firstNonEmpty(r.Title, "(sin título)"), clock(r.Seconds), r.State)
	if r.Summary != "" {
		fmt.Println()
		fmt.Println(r.Summary)
	}
	fmt.Printf("\n%d frases · %d pantallas · %d personas. Entero para un modelo: bin/minutes context %s\n", len(r.SegmentList), len(r.ScreenList), len(r.Speakers), r.ID)
	return nil
}

// ---- context ----

// context: la reunión en el texto más compacto que sirve para pasarle a un modelo: quiénes y cuánto hablaron, el
// resumen, lo que se vio en cada pantalla clave y lo dicho, con las frases seguidas de la misma persona juntas.
func contextCmd(args []string) error {
	fs := flag.NewFlagSet("context", flag.ContinueOnError)
	maxChars := fs.Int("max-chars", 0, "recorta lo dicho por el medio pasado este largo (0: entero)")
	noSummary := fs.Bool("no-summary", false, "sin el resumen del modelo: sólo lo que pasó (para que otro modelo saque sus conclusiones)")
	pos, err := splitFlags(fs, args)
	if err != nil {
		return err
	}
	d, err := pickOrCode(pos)
	if err != nil {
		return err
	}
	fmt.Print(meetingContext(recordingInfo(d, true), *maxChars, !*noSummary))
	return nil
}

func meetingContext(r recordingJSON, maxChars int, withSummary bool) string {
	var b strings.Builder
	fmt.Fprintf(&b, "# Reunión: %s\n", firstNonEmpty(r.Title, "(sin título)"))
	started := r.Started
	if t, err := time.Parse(time.RFC3339, started); err == nil {
		started = t.Local().Format("2006-01-02 15:04 MST")
	}
	fmt.Fprintf(&b, "id: %s · empezó: %s · duró: %s · estado: %s\n", r.ID, started, clock(r.Seconds), r.State)
	b.WriteString("Transcripción automática (puede tener errores). «yo» es quien grabó; «reunión» es alguien del otro lado sin identificar.\n")
	if len(r.Speakers) > 0 {
		var ps []string
		for _, sp := range r.Speakers {
			ps = append(ps, fmt.Sprintf("%s (%s)", sp.Name, clock(sp.Seconds)))
		}
		fmt.Fprintf(&b, "Personas de la reunión, por cuánto hablaron: %s\n", strings.Join(ps, ", "))
	}
	if withSummary && r.Summary != "" {
		// los títulos del resumen bajan un nivel: quedan adentro de éste
		sum := regexp.MustCompile(`(?m)^(#+) `).ReplaceAllString(strings.TrimSpace(r.Summary), "#$1 ")
		fmt.Fprintf(&b, "\n## El resumen que escribió %s\n%s\n", firstNonEmpty(r.SummaryModel, "un modelo"), sum)
	}
	if len(r.ScreenList) > 0 {
		b.WriteString("\n## Pantallas que se mostraron\n")
		for _, s := range r.ScreenList {
			fmt.Fprintf(&b, "[%s] %s–%s: %s", s.ID, clock(s.Start), clock(s.End), firstNonEmpty(s.Seen, "(sin descripción)"))
			if s.Refers && s.Evidence != "" {
				fmt.Fprintf(&b, " — se habló de ella: «%s»", s.Evidence)
			}
			b.WriteString("\n")
		}
	}
	b.WriteString("\n## Lo dicho\n")
	var lines []string
	for i := 0; i < len(r.SegmentList); {
		g := r.SegmentList[i]
		texts := []string{g.Text}
		screens := map[string]bool{}
		if g.Screen != "" {
			screens[g.Screen] = true
		}
		j := i + 1
		for ; j < len(r.SegmentList) && r.SegmentList[j].Who == g.Who && r.SegmentList[j].Start-r.SegmentList[j-1].End < 5; j++ {
			texts = append(texts, r.SegmentList[j].Text)
			if s := r.SegmentList[j].Screen; s != "" {
				screens[s] = true
			}
		}
		ref := ""
		if len(screens) > 0 {
			var ids []string
			for s := range screens {
				ids = append(ids, s)
			}
			sort.Strings(ids)
			ref = " (" + strings.Join(ids, ", ") + ")"
		}
		lines = append(lines, fmt.Sprintf("[%s] %s%s: %s", clock(g.Start), g.Who, ref, strings.Join(texts, " ")))
		i = j
	}
	text := strings.Join(lines, "\n")
	if rs := []rune(text); maxChars > 0 && len(rs) > maxChars {
		text = string(rs[:maxChars/2]) + "\n[… se omite el medio de la reunión …]\n" + string(rs[len(rs)-maxChars/2:])
	}
	b.WriteString(text + "\n")
	return b.String()
}

// ---- wait ----

// wait: espera a que la grabación termine de grabar, transcribir y armar el resumen, sin que el agente tenga que
// preguntar cada tanto. Sale 0 con resumen, 6 si terminó sin él y 5 si se cansó.
func waitCmd(args []string) error {
	fs := flag.NewFlagSet("wait", flag.ContinueOnError)
	timeout := fs.Duration("timeout", 30*time.Minute, "cuánto esperar, como mucho")
	asJSON := fs.Bool("json", false, "al terminar, minutes.recording/v1 liviano")
	pos, err := splitFlags(fs, args)
	if err != nil {
		return err
	}
	d, err := pickOrCode(pos)
	if err != nil {
		return err
	}
	deadline := time.Now().Add(*timeout)
	for {
		state, interrupted := recordingState(d)
		if state == "done" || state == "no_summary" {
			r := recordingInfo(d, false)
			if *asJSON {
				printJSON(r)
			} else {
				fmt.Println(d)
			}
			if state == "no_summary" {
				why := "nunca se armó"
				if interrupted {
					why = "se cortó a mitad"
				}
				return withCode(exitNoSummary, "%s terminó sin resumen (%s): bin/minutes summarize %s", r.ID, why, r.ID)
			}
			return nil
		}
		if time.Now().After(deadline) {
			return withCode(exitTimeout, "%s sigue %s después de %s", filepath.Base(d), state, *timeout)
		}
		time.Sleep(time.Second)
	}
}

// ---- search ----

type searchHit struct {
	ID      string  `json:"id"`
	Title   string  `json:"title"`
	Started string  `json:"started"`
	Kind    string  `json:"kind"` // segment · screen · summary
	At      float64 `json:"at"`   // segundos desde el comienzo (0 para el resumen)
	Who     string  `json:"who,omitempty"`
	Screen  string  `json:"screen,omitempty"`
	Text    string  `json:"text"`
}

// search: una frase en todas las grabaciones (lo dicho, lo que se vio en cada pantalla y el resumen), sin importar
// mayúsculas ni tildes. Todas las palabras tienen que estar en el mismo pedazo. Sale 4 si no encontró nada.
func searchCmd(args []string) error {
	fs := flag.NewFlagSet("search", flag.ContinueOnError)
	q := fs.String("q", "", "lo que se busca (todas las palabras, en el mismo pedazo)")
	asJSON := fs.Bool("json", false, "minutes.search/v1")
	limit := fs.Int("limit", 50, "cuántos resultados, como mucho")
	pos, err := splitFlags(fs, args)
	if err != nil {
		return err
	}
	if *q == "" && len(pos) > 0 {
		*q = strings.Join(pos, " ")
	}
	terms := strings.Fields(fold(*q))
	if len(terms) == 0 {
		return withCode(exitUsage, "search --q '…'")
	}
	matches := func(s string) bool {
		f := fold(s)
		for _, t := range terms {
			if !strings.Contains(f, t) {
				return false
			}
		}
		return true
	}
	hits := []searchHit{}
	all := recordings()
	sort.Sort(sort.Reverse(sort.StringSlice(all))) // lo más nuevo primero
	for _, d := range all {
		r := recordingInfo(d, true)
		base := searchHit{ID: r.ID, Title: r.Title, Started: r.Started}
		for _, g := range r.SegmentList {
			if matches(g.Text) {
				h := base
				h.Kind, h.At, h.Who, h.Screen, h.Text = "segment", g.Start, g.Who, g.Screen, g.Text
				hits = append(hits, h)
			}
		}
		for _, s := range r.ScreenList {
			if matches(s.Seen + " " + s.Evidence) {
				h := base
				h.Kind, h.At, h.Screen, h.Text = "screen", round1(s.Start), s.ID, strings.TrimSpace(s.Seen+" "+s.Evidence)
				hits = append(hits, h)
			}
		}
		for _, l := range strings.Split(r.Summary, "\n") {
			if strings.TrimSpace(l) != "" && matches(l) {
				h := base
				h.Kind, h.Text = "summary", strings.TrimSpace(l)
				hits = append(hits, h)
			}
		}
	}
	total := len(hits)
	if *limit > 0 && len(hits) > *limit {
		hits = hits[:*limit]
	}
	if *asJSON {
		printJSON(map[string]any{"schema": "minutes.search/v1", "query": *q, "total": total, "hits": hits})
	} else {
		for _, h := range hits {
			who := h.Who
			if h.Kind != "segment" {
				who = h.Kind
			}
			fmt.Printf("%s [%s] %s: %s\n", h.ID, clock(h.At), who, h.Text)
		}
		if total > len(hits) {
			fmt.Printf("… y %d más (--limit)\n", total-len(hits))
		}
	}
	if total == 0 {
		return withCode(exitNotFound, "no está «%s» en ninguna grabación", *q)
	}
	return nil
}

// fold: minúsculas y sin tildes, para buscar «sesion» y encontrar «Sesión».
func fold(s string) string {
	t := transform.Chain(norm.NFD, runes.Remove(runes.In(unicode.Mn)), norm.NFC)
	out, _, err := transform.String(t, strings.ToLower(s))
	if err != nil {
		return strings.ToLower(s)
	}
	return out
}
