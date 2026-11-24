package main

// QUIÉN DIJO QUÉ dentro de «reunión»: diarize.py (Nemotron-3-Diarization, en esta Mac) separa el audio del sistema
// en personas, y acá cada frase del sistema se queda con la persona que más habló mientras se decía. El micrófono no
// pasa por acá: ya es «yo».
//
// Es opcional: si el entorno del registro (`env:diarization`) no está o el modelo falla, el resumen sale igual, con
// «reunión» como antes. Los nombres los pone Miguel desde la app (speakers.json: {"0": "Laura"}); sin nombre, es
// «Persona N» (N = el número del modelo + 1: el orden en que cada uno habló por primera vez).

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"creditop/my-tools/lib/models"
)

const diarizationModel = "nvidia/Nemotron-3-Diarization"

// TurnSpan: un tramo en que habla una persona (diarization.json).
type TurnSpan struct {
	Speaker int     `json:"speaker"`
	Start   float64 `json:"start"`
	End     float64 `json:"end"`
}

// Speaker: una persona de la reunión, para la leyenda y para renombrarla.
type Speaker struct {
	ID      int     `json:"id"`
	Name    string  `json:"name"`
	Seconds float64 `json:"seconds"`
}

// diarize corre diarize.py si hace falta (no hay diarization.json, o hay audio del sistema más nuevo) y lo lee.
func diarize(d string) ([]TurnSpan, error) {
	out := filepath.Join(d, "diarization.json")
	wavs, _ := filepath.Glob(filepath.Join(d, "audio", "system", "*.wav"))
	if len(wavs) == 0 {
		return nil, nil
	}
	fresh := false
	if st, err := os.Stat(out); err == nil {
		fresh = true
		for _, w := range wavs {
			if ws, err := os.Stat(w); err == nil && ws.ModTime().After(st.ModTime()) {
				fresh = false
				break
			}
		}
	}
	if !fresh {
		paths, err := models.For(models.FindRoot(), "minutes", diarizationModel)
		if err != nil {
			return nil, err
		}
		python := filepath.Join(paths[0], ".venv", "bin", "python")
		if !fileExists(python) {
			return nil, fmt.Errorf("no está el Python de %s", paths[0])
		}
		began := time.Now()
		cmd := exec.Command(python, filepath.Join(root(), "minutes", "diarize.py"), d)
		cmd.Env = append(os.Environ(), "HF_HUB_OFFLINE=1", "TRANSFORMERS_VERBOSITY=error", "TOKENIZERS_PARALLELISM=false")
		if b, err := cmd.CombinedOutput(); err != nil {
			return nil, fmt.Errorf("diarize.py: %v: %s", err, tail(string(b), 400))
		}
		fmt.Fprintf(logw, "  · quién habla: %s\n", time.Since(began).Round(100*time.Millisecond))
	}
	var r struct {
		Segments []TurnSpan `json:"segments"`
	}
	if err := readJSON(out, &r); err != nil {
		return nil, err
	}
	return r.Segments, nil
}

// assignSpeakers le pone a cada frase del sistema la persona que más habló mientras se decía; si ninguna se cruza
// (el modelo dejó un hueco), la del tramo más cercano a menos de 1 s.
func assignSpeakers(segs []TimedSegment, turns []TurnSpan) {
	for i := range segs {
		g := &segs[i]
		if g.Source != "system" || len(turns) == 0 || g.Speaker != nil { // ya lo decidió splitBySpeaker
			continue
		}
		talk := map[int]float64{}
		for _, t := range turns {
			if o := min(g.End, t.End) - max(g.Start, t.Start); o > 0 {
				talk[t.Speaker] += o
			}
		}
		best, bestTalk := -1, 0.0
		for sp, s := range talk {
			if s > bestTalk || (s == bestTalk && sp < best) {
				best, bestTalk = sp, s
			}
		}
		if best < 0 {
			gap := 1.0
			for _, t := range turns {
				dist := max(t.Start-g.End, g.Start-t.End)
				if dist < gap {
					gap, best = dist, t.Speaker
				}
			}
		}
		if best >= 0 {
			sp := best
			g.Speaker = &sp
		}
	}
}

// speakerNames: speakers.json, los nombres que puso Miguel.
func speakerNames(d string) map[string]string {
	names := map[string]string{}
	readJSON(filepath.Join(d, "speakers.json"), &names)
	return names
}

func saveSpeakerNames(d string, names map[string]string) error {
	clean := map[string]string{}
	for k, v := range names {
		if _, err := strconv.Atoi(k); err != nil {
			return errors.New("cada persona va por su número")
		}
		if len([]rune(v)) > 60 {
			return errors.New("un nombre de hasta 60 letras")
		}
		if v != "" {
			clean[k] = v
		}
	}
	b, _ := json.MarshalIndent(clean, "", "  ")
	return os.WriteFile(filepath.Join(d, "speakers.json"), append(b, '\n'), 0o644)
}

// who: quién dijo una frase, en palabras.
func who(g TimedSegment, names map[string]string) string {
	if g.Source == "mic" {
		return "yo"
	}
	if g.Speaker == nil {
		return "reunión"
	}
	if n := names[strconv.Itoa(*g.Speaker)]; n != "" {
		return n
	}
	return fmt.Sprintf("Persona %d", *g.Speaker+1)
}

// speakersOf: las personas que hablaron, con cuánto, en el orden en que aparecieron.
func speakersOf(segs []TimedSegment, names map[string]string) []Speaker {
	talk := map[int]float64{}
	first := map[int]float64{}
	for _, g := range segs {
		if g.Speaker == nil {
			continue
		}
		if _, ok := talk[*g.Speaker]; !ok {
			first[*g.Speaker] = g.Start
		}
		talk[*g.Speaker] += g.End - g.Start
	}
	var out []Speaker
	for id, s := range talk {
		out = append(out, Speaker{ID: id, Name: who(TimedSegment{Segment: Segment{Source: "system", Speaker: &id}}, names), Seconds: round1(s)})
	}
	sort.Slice(out, func(i, j int) bool { return first[out[i].ID] < first[out[j].ID] })
	return out
}

// speakerAt: quién habla más durante [a, b], o -1.
func speakerAt(turns []TurnSpan, a, b float64) int {
	best, bestTalk := -1, 0.0
	for _, t := range turns {
		if o := min(b, t.End) - max(a, t.Start); o > bestTalk {
			best, bestTalk = t.Speaker, o
		}
	}
	return best
}

// snapCuts mueve cada corte entre dos voces a la pausa natural más cercana (a ±snapWindow, 1,2 s): el modelo de voces marca
// el cambio con ~0,3 s de error, y sin esto la última palabra de uno quedaba en boca del siguiente («the party.»).
// Una pausa vale por el silencio entre las dos palabras, más medio segundo si la anterior cierra con . ? o !
func snapCuts[G any](groups []G, words func(G) []Word, set func(G, []Word) G) []G {
	const snapWindow = 1.2
	var all []Word
	var cuts []int // índice en all de la primera palabra de cada grupo, salvo el primero
	for i, gr := range groups {
		if i > 0 {
			cuts = append(cuts, len(all))
		}
		all = append(all, words(gr)...)
	}
	lo := 1
	for k, c := range cuts {
		hi := len(all) - 1
		if k+1 < len(cuts) {
			hi = cuts[k+1] - 1
		}
		best, bestScore := c, math.Inf(-1)
		for j := lo; j <= hi; j++ {
			if !strings.HasPrefix(all[j].Text, " ") || math.Abs(all[j].Start-all[c].Start) > snapWindow {
				continue
			}
			score := max(0, all[j].Start-all[j-1].End)
			if strings.ContainsAny(strings.TrimSpace(all[j-1].Text), ".?!") {
				score += 0.5
			}
			// alejarse del corte del modelo cuesta: sin esto el punto de la frase siguiente ganaba («Hi, I'm Jane.»)
			score -= 0.5 * math.Abs(all[j].Start-all[c].Start)
			if score > bestScore || (score == bestScore && math.Abs(float64(j-c)) < math.Abs(float64(best-c))) {
				best, bestScore = j, score
			}
		}
		cuts[k] = best
		lo = best + 1
	}
	out := make([]G, len(groups))
	prev := 0
	for i := range groups {
		end := len(all)
		if i < len(cuts) {
			end = cuts[i]
		}
		out[i] = set(groups[i], all[prev:end])
		prev = end
	}
	// un corte que se corrió hasta vaciar un grupo lo saca
	var kept []G
	for _, gr := range out {
		if len(words(gr)) > 0 {
			kept = append(kept, gr)
		}
	}
	return kept
}

// splitBySpeaker corta lo dicho en el sistema donde cambia quién habla, con el tiempo de cada pedazo de texto. Decide
// sobre todo el audio del sistema junto (todas sus frases, de todos los tramos), porque Whisper a veces corta la frase justo donde no es
// («…voices to» | «the party.») y el corte de voz tiene que poder cruzar ese borde; después vuelve a partir en las
// frases de Whisper. Sólo corta antes de un pedazo que empieza palabra (con espacio): el resto de una palabra y la
// puntuación van con lo anterior. Un tramo de menos de minTurn se queda con el de antes (un «ajá» encima no parte).
func splitBySpeaker(segs []Segment, turns []TurnSpan) []Segment {
	const minTurn = 0.4
	if len(turns) == 0 {
		return segs
	}
	type tagged struct {
		Word
		sentence int // el índice en segs de la frase de Whisper de donde viene
	}
	type group struct {
		speaker int
		words   []tagged
	}
	var out []Segment
	byChunk := map[string][]int{}
	var order []string
	for i, g := range segs {
		if g.Source != "system" || len(g.Words) == 0 {
			out = append(out, g)
			continue
		}
		// todo el audio del sistema como una sola corriente: un cambio de voz puede caer en el borde entre dos tramos
		const stream = "system"
		if _, ok := byChunk[stream]; !ok {
			order = append(order, stream)
		}
		byChunk[stream] = append(byChunk[stream], i)
	}
	for _, chunk := range order {
		var groups []group
		for _, i := range byChunk[chunk] {
			for _, w := range segs[i].Words {
				tw := tagged{Word: w, sentence: i}
				sp := speakerAt(turns, w.Start, max(w.End, w.Start+0.01))
				startsWord := strings.HasPrefix(w.Text, " ")
				if n := len(groups); n > 0 && (!startsWord || sp < 0 || sp == groups[n-1].speaker) {
					groups[n-1].words = append(groups[n-1].words, tw)
					continue
				}
				groups = append(groups, group{speaker: sp, words: []tagged{tw}})
			}
		}
		var merged []group
		for _, gr := range groups {
			dur := gr.words[len(gr.words)-1].End - gr.words[0].Start
			if n := len(merged); n > 0 && (dur < minTurn || gr.speaker == merged[n-1].speaker) {
				merged[n-1].words = append(merged[n-1].words, gr.words...)
				continue
			}
			merged = append(merged, gr)
		}
		if len(merged) > 1 {
			merged = snapCuts(merged,
				func(gr group) []Word {
					ws := make([]Word, len(gr.words))
					for k, w := range gr.words {
						ws[k] = w.Word
					}
					return ws
				},
				func(gr group, ws []Word) group {
					// las palabras siguen en el mismo orden: se reparten de nuevo con su frase
					gr.words = nil
					for _, w := range ws {
						gr.words = append(gr.words, tagged{Word: w})
					}
					return gr
				})
			// snapCuts devuelve las palabras sin su frase: se la vuelve a poner por orden
			var flat []tagged
			for _, i := range byChunk[chunk] {
				for _, w := range segs[i].Words {
					flat = append(flat, tagged{Word: w, sentence: i})
				}
			}
			k := 0
			for gi := range merged {
				for wi := range merged[gi].words {
					merged[gi].words[wi].sentence = flat[k].sentence
					k++
				}
			}
		}
		// cada grupo de una voz, partido otra vez en las frases de Whisper
		for _, gr := range merged {
			for a := 0; a < len(gr.words); {
				b := a
				for b < len(gr.words) && gr.words[b].sentence == gr.words[a].sentence {
					b++
				}
				var text strings.Builder
				var ws []Word
				for _, w := range gr.words[a:b] {
					text.WriteString(w.Text)
					ws = append(ws, w.Word)
				}
				piece := segs[gr.words[a].sentence]
				piece.Start, piece.End = round1(ws[0].Start), round1(ws[len(ws)-1].End)
				piece.Text = strings.TrimSpace(text.String())
				piece.Words = ws
				if gr.speaker >= 0 {
					sp := gr.speaker
					piece.Speaker = &sp
				}
				if piece.Text != "" {
					out = append(out, piece)
				}
				a = b
			}
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Start < out[j].Start })
	return out
}
