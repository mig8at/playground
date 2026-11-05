// sala — agentes independientes que barren temas de knowledge/ en paralelo, y un verificador al final.
//
//	make sala              la página (http://127.0.0.1:5201): elegís temas, la larga y ves trabajar a cada agente
//	make barrido TEMAS=…   lo mismo por consola, sin página
//	make barrido-canon     el barrido sobre los temas de CANON que la ronda marca con archivos cambiados (canon.go)
//
// Cada agente es una sesión larga de `claude -p` con todas las herramientas de lectura del playground, sobre UN tema:
// no habla con los otros ni espera turno. Cuando terminan todos, un verificador que no escribió nada comprueba cada
// hallazgo. El porqué y la historia (la sala de llamadas entre agentes que se retiró el 2026-11-03) están en barrido.go.
//
// Gasta el límite del asiento de Miguel: los US$ que muestra son equivalentes a precio de API, no se cobran aparte.
// Con MOCK=1 (o la casilla «Simulado») los agentes son de mentira y no gastan nada.
package main

import (
	_ "embed"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

//go:embed index.html
var indexHTML []byte

func main() {
	addr := flag.String("addr", "127.0.0.1:5201", "dónde escucha")
	sweepTopics := flag.String("barrido", "", "corre un barrido por consola y sale: temas separados por coma, o «auto» para los de revisión más vieja")
	sweepN := flag.Int("n", 3, "cuántos temas toma el barrido en «auto»")
	sweepBudget := flag.Float64("tope", 2.5, "tope de cada agente del barrido, en US$ equivalentes")
	sweepCheck := flag.Float64("tope-verificador", 3, "tope del verificador del barrido, en US$ equivalentes")
	sweepMode := flag.String("modo", "knowledge", "sobre qué barre: knowledge (los temas locales) o canon (los que la ronda marca)")
	flag.Parse()
	root, _ := os.Getwd()
	if _, err := os.Stat(filepath.Join(root, "tools", "ui", "theme.css")); err != nil {
		log.Fatal("corré la sala desde la raíz del playground (make sala)")
	}
	mock := os.Getenv("SALA_MOCK") == "1"
	sw := &sweeper{root: root}

	if *sweepTopics != "" {
		done := make(chan struct{})
		var topics []string
		if *sweepTopics != "auto" {
			topics = splitTopics(*sweepTopics)
		}
		err := sw.start(*sweepMode, topics, *sweepN, *sweepBudget, *sweepCheck, mock, func(path string, err error) {
			if err != nil {
				log.Print(err)
			}
			sw.mu.Lock()
			fmt.Print(sw.b.Report)
			sw.mu.Unlock()
			fmt.Println("\ninforme:", path)
			close(done)
		})
		if err != nil {
			log.Fatal(err)
		}
		sw.mu.Lock()
		if sw.b.Mode == "canon" {
			fmt.Printf("barrido canon sobre %s: %d cadena(s) en paralelo (agente US$%.2f → su verificador US$%.2f → ensayo)\n",
				topicNames(sw.b), len(sw.b.Agents), *sweepBudget, *sweepCheck)
		} else {
			fmt.Printf("barrido %s sobre %s: %d agente(s) en paralelo, US$%.2f eq. cada uno, y el verificador con US$%.2f\n",
				sw.b.Mode, topicNames(sw.b), len(sw.b.Agents), *sweepBudget, *sweepCheck)
		}
		sw.mu.Unlock()
		<-done
		return
	}

	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("content-type", "text/html; charset=utf-8")
		_, _ = w.Write(indexHTML)
	})
	// El tema es UNO para todas las herramientas: se sirve desde su fuente, no se copia.
	http.HandleFunc("/theme.css", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, filepath.Join(root, "tools", "ui", "theme.css"))
	})
	http.HandleFunc("/api/topics", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("mode") == "canon" {
			// Los temas de canon con archivos cambiados en main, de más a menos: la ronda del servidor.
			_, work, err := canonRound(r.Context(), nil, 0)
			if err != nil {
				http.Error(w, err.Error(), 502)
				return
			}
			out := []topicInfo{}
			for t, changes := range work {
				out = append(out, topicInfo{ID: t, Title: fmt.Sprintf("%d archivo(s) cambiados en main", len(changes)), Reviewed: fmt.Sprintf("%04d", len(changes))})
			}
			sort.Slice(out, func(i, j int) bool {
				return out[i].Reviewed > out[j].Reviewed || (out[i].Reviewed == out[j].Reviewed && out[i].ID < out[j].ID)
			})
			writeJSON(w, out)
			return
		}
		writeJSON(w, allTopics(root))
	})
	// El estado del barrido en curso (o el último): la página lo pide cada segundo.
	http.HandleFunc("/api/state", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("content-type", "application/json")
		_, _ = w.Write(sw.snapshot())
	})
	http.HandleFunc("/api/start", func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			Mode        string   `json:"mode"`
			Topics      []string `json:"topics"`
			N           int      `json:"n"`
			Budget      float64  `json:"budget"`
			CheckBudget float64  `json:"checkBudget"`
			Mock        bool     `json:"mock"`
		}
		if r.Method != http.MethodPost || json.NewDecoder(r.Body).Decode(&in) != nil {
			http.Error(w, "POST con {topics, n, budget, checkBudget, mock}", 400)
			return
		}
		if in.Budget <= 0 || in.Budget > 6 {
			in.Budget = *sweepBudget
		}
		if in.CheckBudget <= 0 || in.CheckBudget > 8 {
			in.CheckBudget = *sweepCheck
		}
		if in.N <= 0 || in.N > 8 {
			in.N = *sweepN
		}
		if len(in.Topics) > 8 {
			http.Error(w, "hasta 8 temas por barrido: cada uno gasta del asiento", 400)
			return
		}
		if err := sw.start(in.Mode, in.Topics, in.N, in.Budget, in.CheckBudget, in.Mock || mock, nil); err != nil {
			http.Error(w, err.Error(), 409)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	http.HandleFunc("/api/stop", func(w http.ResponseWriter, r *http.Request) {
		sw.stop()
		w.WriteHeader(http.StatusNoContent)
	})
	// Los barridos anteriores, para volver a mirarlos: sala/.barridos/<id>/barrido.json.
	http.HandleFunc("/api/history", func(w http.ResponseWriter, r *http.Request) {
		if id := r.URL.Query().Get("id"); id != "" {
			if strings.ContainsAny(id, "/\\.") {
				http.Error(w, "id inválido", 400)
				return
			}
			raw, err := os.ReadFile(filepath.Join(root, "sala", ".barridos", id, "barrido.json"))
			if err != nil {
				http.NotFound(w, r)
				return
			}
			w.Header().Set("content-type", "application/json")
			_, _ = w.Write(raw)
			return
		}
		writeJSON(w, history(root))
	})

	log.Printf("sala: http://%s", *addr)
	log.Fatal(http.ListenAndServe(*addr, nil))
}

type pastSweep struct {
	ID       string  `json:"id"`
	Topics   string  `json:"topics"`
	Findings int     `json:"findings"`
	Verified int     `json:"verified"`
	Cost     float64 `json:"cost"`
	Mock     bool    `json:"mock"`
}

// history: los barridos guardados, del más nuevo al más viejo.
func history(root string) []pastSweep {
	files, _ := filepath.Glob(filepath.Join(root, "sala", ".barridos", "*", "barrido.json"))
	out := []pastSweep{}
	for _, f := range files {
		raw, err := os.ReadFile(f)
		if err != nil {
			continue
		}
		var b struct {
			board
			Runs []agent `json:"runs"` // el formato del primer barrido, antes de la página
		}
		if json.Unmarshal(raw, &b) != nil {
			continue
		}
		p := pastSweep{ID: filepath.Base(filepath.Dir(f)), Findings: len(b.Findings), Cost: b.Cost, Mock: b.Mock}
		var topics []string
		for _, a := range append(b.Agents, ptrs(b.Runs)...) {
			topics = append(topics, a.Topic)
			if b.Cost == 0 && len(b.Runs) > 0 {
				p.Cost += a.Cost
			}
		}
		if b.Cost == 0 && b.Verifier != nil {
			p.Cost += b.Verifier.Cost
		}
		p.Topics = strings.Join(topics, ", ")
		for _, fd := range b.Findings {
			if fd.Verdict == "✓" {
				p.Verified++
			}
		}
		out = append(out, p)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID > out[j].ID })
	return out
}

func ptrs(as []agent) []*agent {
	out := make([]*agent, len(as))
	for i := range as {
		out[i] = &as[i]
	}
	return out
}

func splitTopics(s string) []string {
	var out []string
	for _, t := range strings.Split(s, ",") {
		if t = strings.TrimSpace(t); t != "" {
			out = append(out, t)
		}
	}
	return out
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("content-type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

func topicNames(b *board) string {
	var names []string
	for _, a := range b.Agents {
		names = append(names, a.Topic)
	}
	return strings.Join(names, ", ")
}
