package main

// LA TRANSCRIPCIÓN: la grabadora deja tramos WAV de 16 kHz mono en audio/mic y audio/system (el nombre es su comienzo
// en ms); `watch` los pasa por Whisper (whisper.cpp, el mismo large-v3-turbo del dictado del chat) a medida que
// aparecen y agrega cada frase a transcript.jsonl con su tiempo en la reunión. El texto sale ~un tramo (15 s) detrás
// de lo dicho.
//
// Dos cosas que Whisper hace mal y se cuidan acá:
//   - con silencio INVENTA («Gracias.», «Subtítulos realizados por…»): un tramo casi mudo no se transcribe (rms) y las
//     frases típicas de silencio se tiran (hallucination).
//   - sin audífonos el micrófono vuelve a grabar lo que suena por los parlantes: una frase del micrófono que repite a
//     una del sistema en el mismo momento queda marcada `echo` (no se muestra ni entra al resumen).

import (
	"encoding/binary"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"

	"creditop/my-tools/lib/models"
)

// Segment: una frase transcrita, con su tiempo en segundos desde el arranque de la grabación.
type Segment struct {
	Start  float64 `json:"start"`
	End    float64 `json:"end"`
	Source string  `json:"source"` // mic | system
	Text   string  `json:"text"`
	Chunk  string  `json:"chunk"`
	Echo   bool    `json:"echo,omitempty"`
	// Words: los pedazos de texto con su tiempo (sólo del sistema): con ellos una frase se corta donde cambia quién
	// habla (splitBySpeaker), porque Whisper junta en una frase a dos personas que hablan seguido.
	Words []Word `json:"words,omitempty"`
	// Speaker: quién de la reunión (diarize.go), al armar el resumen; sin él, «reunión»
	Speaker *int `json:"speaker,omitempty"`
}

// Word: un pedazo de texto de Whisper (una palabra o parte de una) con su tiempo en la grabación.
type Word struct {
	Start float64 `json:"s"`
	End   float64 `json:"e"`
	Text  string  `json:"t"`
}

// silenceRMS: por debajo, el tramo no se transcribe (≈ -46 dBFS: una sala callada; una voz baja pasa de 0,01).
const silenceRMS = 0.005

func whisperModel() (string, error) {
	if m := os.Getenv("MINUTES_WHISPER_MODEL"); m != "" {
		return m, nil
	}
	paths, err := models.For(models.FindRoot(), "minutes", "openai/whisper-large-v3-turbo")
	if err != nil {
		return "", fmt.Errorf("el Whisper de minutes: %v (bin/models list)", err)
	}
	return paths[0], nil
}

type chunk struct {
	Source string
	Path   string
	Start  float64
}

// pendingChunks: los tramos que todavía no están en transcript.jsonl (ni en la lista de tramos mudos), en orden de
// tiempo; a igual tiempo, el sistema antes que el micrófono, para que el eco se pueda comparar.
func pendingChunks(d string) []chunk {
	done := map[string]bool{}
	for _, s := range loadTranscript(d) {
		done[s.Chunk] = true
	}
	if b, err := os.ReadFile(filepath.Join(d, "audio", "done.txt")); err == nil {
		for _, l := range strings.Split(string(b), "\n") {
			done[strings.TrimSpace(l)] = true
		}
	}
	var out []chunk
	for _, src := range []string{"system", "mic"} {
		files, _ := filepath.Glob(filepath.Join(d, "audio", src, "*.wav"))
		for _, f := range files {
			rel := src + "/" + filepath.Base(f)
			if done[rel] {
				continue
			}
			ms, err := strconv.Atoi(strings.TrimSuffix(filepath.Base(f), ".wav"))
			if err != nil {
				continue
			}
			out = append(out, chunk{Source: src, Path: f, Start: float64(ms) / 1000})
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		if math.Abs(out[i].Start-out[j].Start) < 1 {
			return out[i].Source == "system" && out[j].Source == "mic"
		}
		return out[i].Start < out[j].Start
	})
	return out
}

func (c chunk) rel() string { return c.Source + "/" + filepath.Base(c.Path) }

func loadTranscript(d string) []Segment {
	b, err := os.ReadFile(filepath.Join(d, "transcript.jsonl"))
	if err != nil {
		return nil
	}
	var out []Segment
	for _, l := range strings.Split(string(b), "\n") {
		var s Segment
		if json.Unmarshal([]byte(l), &s) == nil && s.Chunk != "" {
			out = append(out, s)
		}
	}
	return out
}

func appendSegments(d string, segs []Segment) error {
	f, err := os.OpenFile(filepath.Join(d, "transcript.jsonl"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return err
	}
	defer f.Close()
	for _, s := range segs {
		b, _ := json.Marshal(s)
		f.Write(append(b, '\n'))
	}
	return nil
}

func markDone(d, rel string) {
	f, err := os.OpenFile(filepath.Join(d, "audio", "done.txt"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err == nil {
		fmt.Fprintln(f, rel)
		f.Close()
	}
}

// markFailed anota un tramo que Whisper no pudo transcribir (audio/failed.txt: el tramo y el error).
func markFailed(d, rel string, cause error) {
	f, err := os.OpenFile(filepath.Join(d, "audio", "failed.txt"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err == nil {
		fmt.Fprintf(f, "%s\t%s\n", rel, strings.ReplaceAll(tail(cause.Error(), 200), "\n", " "))
		f.Close()
	}
}

// watch: transcribe mientras la grabadora corre y sale cuando ya no queda nada.
func watch(d string) error {
	fmt.Fprintln(os.Stderr, time.Now().Format(time.TimeOnly), "transcribiendo", d)
	for {
		finished := recorderDone(d)
		if err := transcribePending(d, false); err != nil {
			fmt.Fprintln(os.Stderr, "error:", err)
		}
		if finished && len(pendingChunks(d)) == 0 {
			fmt.Fprintln(os.Stderr, time.Now().Format(time.TimeOnly), "listo")
			return nil
		}
		time.Sleep(time.Second)
	}
}

// transcribePending pasa por Whisper los tramos que faltan. verbose: cuenta el avance (al frenar).
func transcribePending(d string, verbose bool) error {
	pend := pendingChunks(d)
	if len(pend) == 0 {
		return nil
	}
	model, err := whisperModel()
	if err != nil {
		return err
	}
	var meta Meta
	readJSON(filepath.Join(d, "meta.json"), &meta)
	lang := firstNonEmpty(meta.Lang, "es")
	prev := map[string]string{} // el final de lo último dicho por fuente: Whisper sigue mejor con contexto
	for _, s := range loadTranscript(d) {
		if !s.Echo {
			prev[s.Source] = tail(prev[s.Source]+" "+s.Text, 200)
		}
	}
	for i, c := range pend {
		if verbose {
			fmt.Fprintf(os.Stderr, "\r  · transcribiendo %d/%d", i+1, len(pend))
		}
		rms, err := wavRMS(c.Path)
		if err != nil {
			return err
		}
		if rms < silenceRMS {
			markDone(d, c.rel())
			continue
		}
		segs, err := whisper(model, c, prev[c.Source], lang)
		if err != nil {
			// whisper-cli a veces se cae (abort trap) con la GPU ocupada, y no se repite: un reintento sin el texto
			// anterior; si vuelve a fallar, el tramo queda anotado en audio/failed.txt y se sigue. Antes se reintentaba
			// para siempre y «Frenar» no terminaba nunca (visto el 2026-11-23).
			time.Sleep(time.Second)
			if segs, err = whisper(model, c, "", lang); err != nil {
				fmt.Fprintf(os.Stderr, "\n  ⚠ %s no se pudo transcribir, se salta: %v\n", c.rel(), tail(err.Error(), 160))
				markFailed(d, c.rel(), err)
				markDone(d, c.rel())
				continue
			}
		}
		if c.Source == "mic" {
			markEcho(segs, loadTranscript(d))
		}
		if len(segs) == 0 {
			markDone(d, c.rel())
			continue
		}
		for _, s := range segs {
			if !s.Echo {
				prev[c.Source] = tail(prev[c.Source]+" "+s.Text, 200)
			}
		}
		if err := appendSegments(d, segs); err != nil {
			return err
		}
	}
	if verbose {
		fmt.Fprintln(os.Stderr)
	}
	return nil
}

func tail(s string, n int) string {
	s = strings.TrimSpace(s)
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[len(r)-n:])
}

func whisper(model string, c chunk, prompt, lang string) ([]Segment, error) {
	tmp, err := os.MkdirTemp("", "minutes-whisper")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(tmp)
	base := filepath.Join(tmp, "out")
	args := []string{"-m", model, "-l", lang, "-ojf", "-of", base, "-np", "-sns", "-f", c.Path}
	if prompt != "" {
		args = append(args, "--prompt", prompt)
	}
	cmd := exec.Command(findTool("whisper-cli"), args...)
	if out, err := cmd.CombinedOutput(); err != nil {
		return nil, fmt.Errorf("whisper-cli %s: %v: %s", c.rel(), err, tail(string(out), 400))
	}
	var r struct {
		Transcription []struct {
			Offsets struct {
				From int `json:"from"`
				To   int `json:"to"`
			} `json:"offsets"`
			Text   string `json:"text"`
			Tokens []struct {
				Text    string `json:"text"`
				Offsets struct {
					From int `json:"from"`
					To   int `json:"to"`
				} `json:"offsets"`
			} `json:"tokens"`
		} `json:"transcription"`
	}
	b, err := os.ReadFile(base + ".json")
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(b, &r); err != nil {
		return nil, err
	}
	var segs []Segment
	for _, t := range r.Transcription {
		text := strings.TrimSpace(t.Text)
		if text == "" || hallucination(text) {
			continue
		}
		g := Segment{
			Start: round1(c.Start + float64(t.Offsets.From)/1000), End: round1(c.Start + float64(t.Offsets.To)/1000),
			Source: c.Source, Text: text, Chunk: c.rel(),
		}
		if c.Source == "system" {
			for _, k := range t.Tokens {
				if strings.HasPrefix(k.Text, "[_") || k.Text == "" { // [_BEG_], [_TT_150]: marcas, no texto
					continue
				}
				g.Words = append(g.Words, Word{Start: c.Start + float64(k.Offsets.From)/1000, End: c.Start + float64(k.Offsets.To)/1000, Text: k.Text})
			}
		}
		segs = append(segs, g)
	}
	return segs, nil
}

func round1(f float64) float64 { return math.Round(f*10) / 10 }

// Lo que Whisper escribe sobre silencio o ruido (medido con tramos mudos de esta Mac y lo conocido de large-v3).
var hallucinationRe = regexp.MustCompile(`(?i)^[¡¿ ]*(gracias( por ver)?|muchas gracias|subt[ií]tulos.*|amara\.org.*|\[.*\]|\(.*\)|\.+|♪+|thank you\.?|you)[.!¡ ]*$`)

func hallucination(text string) bool {
	return hallucinationRe.MatchString(strings.TrimSpace(text))
}

// markEcho marca las frases del micrófono que repiten a una del sistema dicha al mismo tiempo (±3 s): sin audífonos,
// el micrófono graba los parlantes.
func markEcho(mic []Segment, all []Segment) {
	for i := range mic {
		mw := words(mic[i].Text)
		if len(mw) == 0 {
			continue
		}
		heard := map[string]bool{}
		for _, s := range all {
			if s.Source == "system" && s.Start <= mic[i].End+3 && s.End >= mic[i].Start-3 {
				for _, w := range words(s.Text) {
					heard[w] = true
				}
			}
		}
		common := 0
		for _, w := range mw {
			if heard[w] {
				common++
			}
		}
		if float64(common)/float64(len(mw)) >= 0.6 {
			mic[i].Echo = true
		}
	}
}

func words(s string) []string {
	return strings.FieldsFunc(strings.ToLower(s), func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsDigit(r) })
}

// wavRMS: la energía del tramo (Int16 mono, el formato de la grabadora), de 0 a 1.
func wavRMS(path string) (float64, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return 0, err
	}
	if len(b) <= 44 {
		return 0, nil
	}
	data := b[44:]
	n := len(data) / 2
	var sum float64
	for i := 0; i < n; i++ {
		v := float64(int16(binary.LittleEndian.Uint16(data[i*2:]))) / 32768
		sum += v * v
	}
	return math.Sqrt(sum / float64(n)), nil
}
