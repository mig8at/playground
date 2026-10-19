package main

/* La parte pura del ensayo: calificar una corrida contra su juez y comparar dos tandas. Sin red, sin
 * modelo y sin archivos, para que las pruebas la cubran entera. */

import (
	"fmt"
	"regexp"
	"sort"
	"strings"
)

// Question es una pregunta fija del banco (preguntas.json).
type Question struct {
	ID      string   `json:"id"`
	Why     string   `json:"why"`
	Prompt  string   `json:"prompt"`
	Judge   string   `json:"judge"`
	Must    []string `json:"must"`
	MustNot []string `json:"must_not"`
}

// Verdict es lo que dio el juez: las piezas que la respuesta tiene que nombrar, o por qué no se sabe.
type Verdict struct {
	Tokens []string `json:"tokens"`
	Error  string   `json:"error,omitempty"`
}

// Run es una corrida de una pregunta, calificada.
type Run struct {
	Question string  `json:"question"`
	Session  string  `json:"session"`
	Answer   string  `json:"answer"`
	CostUSD  float64 `json:"cost_usd"`
	Turns    int     `json:"turns"`
	Millis   int     `json:"duration_ms"`
	// Graded es falso si el juez no contestó: esa corrida NO cuenta ni como acierto ni como error.
	Graded   bool     `json:"graded"`
	Correct  bool     `json:"correct"`
	Missing  []string `json:"missing,omitempty"`
	RouteOK  bool     `json:"route_ok"`
	RouteBad []string `json:"route_bad,omitempty"`
	Friction int      `json:"friction"`
	Error    string   `json:"error,omitempty"` // la corrida misma falló (claude -p, presupuesto, transcripción)
}

var digitRun = regexp.MustCompile(`\d[\d.,]*`)

// numbersIn: los números de un texto, sin separadores de miles («1.234» y «1,234» son 1234).
func numbersIn(s string) map[string]bool {
	out := map[string]bool{}
	for _, m := range digitRun.FindAllString(s, -1) {
		out[strings.NewReplacer(".", "", ",", "").Replace(m)] = true
	}
	return out
}

func isNumber(s string) bool {
	return s != "" && strings.Trim(s, "0123456789") == ""
}

// Grade: qué piezas del juez faltan en la respuesta. Un número se busca como número; el resto, como texto
// sin distinguir mayúsculas ni espacios repetidos.
func Grade(answer string, tokens []string) (missing []string) {
	norm := func(s string) string { return strings.Join(strings.Fields(strings.ToLower(s)), " ") }
	text, nums := norm(answer), numbersIn(answer)
	for _, t := range tokens {
		if isNumber(t) {
			if !nums[t] {
				missing = append(missing, t)
			}
		} else if !strings.Contains(text, norm(t)) {
			missing = append(missing, t)
		}
	}
	return missing
}

// Route: qué reglas de ruta rompió la sesión. `ok` son las llamadas que salieron bien y `all` todas, enteras
// (herramienta + comando). Lo que `must` pide tiene que haber PASADO: un `git grep` que el permiso frenó no
// es haber mirado main. Lo que `must_not` prohíbe cuenta con sólo intentarlo.
func Route(q Question, ok, all []string) (bad []string, err error) {
	for _, pat := range q.Must {
		re, err := regexp.Compile("(?i)" + pat)
		if err != nil {
			return nil, fmt.Errorf("%s: must %q: %w", q.ID, pat, err)
		}
		hit := false
		for _, c := range ok {
			if re.MatchString(c) {
				hit = true
				break
			}
		}
		if !hit {
			bad = append(bad, "faltó: "+pat)
		}
	}
	for _, pat := range q.MustNot {
		re, err := regexp.Compile("(?i)" + pat)
		if err != nil {
			return nil, fmt.Errorf("%s: must_not %q: %w", q.ID, pat, err)
		}
		for _, c := range all {
			if re.MatchString(c) {
				bad = append(bad, "prohibido: "+pat)
				break
			}
		}
	}
	return bad, nil
}

// Score califica una corrida ya hecha.
func Score(r *Run, q Question, v Verdict, ok, all []string) error {
	r.Friction = len(all) - len(ok)
	bad, err := Route(q, ok, all)
	if err != nil {
		return err
	}
	r.RouteBad, r.RouteOK = bad, len(bad) == 0
	if v.Error != "" || len(v.Tokens) == 0 || r.Error != "" {
		r.Graded = false
		return nil
	}
	r.Graded = true
	r.Missing = Grade(r.Answer, v.Tokens)
	r.Correct = len(r.Missing) == 0
	return nil
}

// Summary es una pregunta dentro de una tanda.
type Summary struct {
	Runs     int
	Graded   int
	Correct  int
	RouteOK  int
	Friction float64
	Cost     float64
	Turns    float64
}

func (s Summary) rate() float64 {
	if s.Graded == 0 {
		return -1
	}
	return float64(s.Correct) / float64(s.Graded)
}

// Summarize agrupa las corridas por pregunta.
func Summarize(runs []Run) map[string]Summary {
	out := map[string]Summary{}
	for _, r := range runs {
		s := out[r.Question]
		s.Runs++
		if r.Graded {
			s.Graded++
			if r.Correct {
				s.Correct++
			}
		}
		if r.RouteOK {
			s.RouteOK++
		}
		s.Friction += float64(r.Friction)
		s.Cost += r.CostUSD
		s.Turns += float64(r.Turns)
		out[r.Question] = s
	}
	for k, s := range out {
		n := float64(s.Runs)
		s.Friction, s.Cost, s.Turns = s.Friction/n, s.Cost/n, s.Turns/n
		out[k] = s
	}
	return out
}

// Row es una pregunta comparada entre A y B.
type Row struct {
	Question string
	A, B     Summary
	Status   string // mejor · igual · peor · sin juez · falta
	Reason   string
}

// maxCostRise: cuánto más puede costar B empatando en lo demás. Un tercio, puesto a ojo: se ajusta con la
// línea base.
const maxCostRise = 1.0 / 3

// Compare decide pregunta por pregunta. B se adopta si ninguna sale «peor» y alguna «mejor»; una «sin
// juez» se dice y no cuenta para ningún lado: menos se lee igual que «no existe».
func Compare(a, b []Run) (rows []Row, adopt bool) {
	sa, sb := Summarize(a), Summarize(b)
	ids := map[string]bool{}
	for k := range sa {
		ids[k] = true
	}
	for k := range sb {
		ids[k] = true
	}
	var keys []string
	for k := range ids {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	better, worse := 0, 0
	for _, k := range keys {
		x, okA := sa[k]
		y, okB := sb[k]
		row := Row{Question: k, A: x, B: y}
		routeA, routeB := float64(x.RouteOK)/max(1, float64(x.Runs)), float64(y.RouteOK)/max(1, float64(y.Runs))
		switch {
		case !okA || !okB:
			row.Status, row.Reason = "falta", "la pregunta no corrió en las dos tandas"
		case x.rate() < 0 || y.rate() < 0:
			row.Status, row.Reason = "sin juez", "el juez no contestó en alguna tanda: no se compara el acierto"
			if routeB < routeA {
				row.Status, row.Reason = "peor", "sin juez, pero la ruta empeoró"
			}
		case y.rate() < x.rate():
			row.Status, row.Reason = "peor", "bajó el acierto"
		case y.rate() > x.rate():
			row.Status, row.Reason = "mejor", "subió el acierto"
		case routeB < routeA:
			row.Status, row.Reason = "peor", "mismo acierto, peor ruta"
		case x.Cost > 0 && y.Cost > x.Cost*(1+maxCostRise):
			row.Status, row.Reason = "peor", fmt.Sprintf("mismo acierto, cuesta más de %.0f%% extra", maxCostRise*100)
		case routeB > routeA || y.Friction < x.Friction:
			row.Status, row.Reason = "mejor", "mismo acierto, mejor ruta o menos fricción"
		default:
			row.Status = "igual"
		}
		switch row.Status {
		case "mejor":
			better++
		case "peor":
			worse++
		}
		rows = append(rows, row)
	}
	return rows, worse == 0 && better > 0
}
