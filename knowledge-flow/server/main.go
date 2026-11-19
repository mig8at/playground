// Knowledge (knowledge-flow): el vigía de la biblioteca (Miguel, 2026-11-18: «que esté al pendiente de cuando queda
// vieja, y que arranque la recontextualización como un flujo, paso a paso, como los workflows de GitHub»).
//
// Cada `lookEvery` mira main (pasos 1 y 2: traer main a los clones sólo-main y `knowledge check`). Si alguna fuente
// cambió, arranca una CORRIDA con los diez pasos de knowledge-drift (run.go, steps.go, model.go). Mientras corre, lo
// que entra NO se mezcla: queda en cola, y al terminar mira otra vez y arranca otra si hace falta, hasta que no quede
// nada. Una corrida que FRENÓ (la verificación encontró algo, una sección sin decidir) no se repite sobre los mismos
// cambios: espera a que la mires o a que entre un cambio nuevo. Aplica solo (decisión de Miguel, 2026-11-18) y
// commitea lo aplicado con el número de corrida.
//
//	knowledge-flow -serve 127.0.0.1:5233     la API (y el vigía)
//	knowledge-flow -once                      una mirada y, si hace falta, una corrida, por consola
//	knowledge-flow -install|-uninstall|-status   de fondo (LaunchAgent), como Sentinel
package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"creditop/my-tools/lib/background"
	"creditop/my-tools/lib/launchagent"
	"creditop/my-tools/lib/notice"
)

// lookEvery: cada cuánto se mira main. main cambia unas veces por día; mirar es barato (fetch y un check, sin modelo).
const lookEvery = 30 * time.Minute

type flow struct {
	root string
	runs *runStore

	mu      sync.Mutex
	look    Look
	running *Run
	wake    chan struct{}
	once    bool // -once: una mirada y, como mucho, una corrida
	// modelDown: el modelo no contestaba en la última pregunta; mientras tanto el vigía pregunta cada modelWait.
	modelDown bool
}

// Look: la última mirada a main.
type Look struct {
	At       string   `json:"at,omitempty"`
	Next     string   `json:"next,omitempty"`
	Looking  bool     `json:"looking"`
	Since    string   `json:"lookingSince,omitempty"` // desde cuándo mira (la interfaz muestra cuánto lleva)
	Changes  []Change `json:"changes"`                // las fuentes viejas ahora
	Sources  int      `json:"sources"`                // cuántas fuentes tiene la biblioteca
	Topics   int      `json:"topics"`                 // cuántos temas
	Queued   []Change `json:"queued"`                 // las que entraron mientras corría una corrida
	Waiting  string   `json:"waiting"`                // por qué no arranca otra (una frenada sobre los mismos cambios)
	Error    string   `json:"error,omitempty"`
	FetchSec float64  `json:"fetchSec"`
	CheckSec float64  `json:"checkSec"`
}

func main() {
	serve := flag.String("serve", "", "levantar la API y el vigía en host:puerto")
	once := flag.Bool("once", false, "una mirada y, si hace falta, una corrida, por consola")
	install := flag.Bool("install", false, "dejarlo de fondo (LaunchAgent)")
	uninstall := flag.Bool("uninstall", false, "sacarlo de fondo")
	status := flag.Bool("status", false, "¿corre de fondo?")
	flag.Parse()

	root := os.Getenv("MY_TOOLS_ROOT")
	if root == "" {
		wd, _ := os.Getwd()
		root = wd
	}
	agent := launchagent.Agent{Label: "com.creditop.my-tools.knowledge", Args: []string{"-serve", "127.0.0.1:5233"}, Root: root, Log: "my-tools-knowledge.log"}
	switch {
	case *install:
		exit(agent.Install())
	case *uninstall:
		exit(agent.Uninstall())
	case *status:
		fmt.Println(agent.Status())
	}
	if *install || *uninstall || *status {
		return
	}
	f := &flow{root: root, runs: &runStore{dir: filepath.Join(root, "knowledge-flow", ".data", "runs")}, wake: make(chan struct{}, 1)}
	f.recover()
	f.once = *once
	if *once {
		f.cycle()
		f.mu.Lock()
		fmt.Printf("%d fuentes viejas · %s\n", len(f.look.Changes), f.look.Waiting)
		f.mu.Unlock()
		for _, id := range f.runs.ids()[:min(1, len(f.runs.ids()))] {
			r, _ := f.runs.load(id)
			fmt.Printf("corrida #%d · %s · %s\n", r.ID, r.State, r.Result)
		}
		return
	}
	if *serve == "" {
		fmt.Fprintln(os.Stderr, "knowledge-flow -serve 127.0.0.1:5233 | -once | -install | -uninstall | -status")
		os.Exit(2)
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/state", f.state)
	mux.HandleFunc("GET /api/runs/{id}", f.getRun)
	mux.HandleFunc("POST /api/look", func(w http.ResponseWriter, _ *http.Request) {
		select {
		case f.wake <- struct{}{}:
		default:
		}
		writeJSON(w, 202, map[string]bool{"ok": true})
	})
	// Dos servidores no se pisan: si el puerto ya lo tiene otro de Knowledge (el de fondo, o el de Cockpit), éste
	// espera su turno. Sólo el que escucha mira main y corre: dos corridas a la vez se pisarían los temas.
	for {
		ln, err := net.Listen("tcp", *serve)
		if err != nil {
			log.Printf("knowledge-flow: %v; reintento en 30 s", err)
			time.Sleep(30 * time.Second)
			continue
		}
		log.Printf("knowledge-flow: escuchando en %s", *serve)
		go f.loop()
		log.Fatal(http.Serve(ln, mux))
	}
}

// recover: una corrida que quedó «corriendo» de un proceso cortado no se retoma a mitad (el modelo y aplicar no son
// idempotentes): se marca fallada, y la próxima mirada arranca otra limpia.
func (f *flow) recover() {
	for _, id := range f.runs.ids() {
		r, err := f.runs.load(id)
		if err != nil || r.State != stRunning {
			continue
		}
		for i := range r.Steps {
			if r.Steps[i].State == stRunning {
				r.Steps[i].State, r.Steps[i].FinishedAt = stFailed, now()
			}
		}
		r.State, r.Result, r.FinishedAt = stFailed, "se cortó: Knowledge se reinició a mitad de la corrida", now()
		f.undoApply(r)
		f.runs.save(r)
	}
}

func (f *flow) loop() {
	for {
		f.cycle()
		// Si quedaron fuentes viejas esperando al modelo, se vuelve a mirar pronto: apenas entres con `playground
		// login`, arranca sin esperar la media hora.
		every := lookEvery
		f.mu.Lock()
		if f.modelDown && len(f.look.Changes) > 0 {
			every = modelWait
		}
		f.look.Next = time.Now().Add(every).Format(time.RFC3339)
		f.mu.Unlock()
		select {
		case <-time.After(every):
		case <-f.wake:
		}
	}
}

// cycle: mirar; si hay fuentes viejas y no son las de una frenada, una corrida; al terminar, mirar otra vez.
func (f *flow) cycle() {
	for {
		start := time.Now()
		changes, sources, topics, fetchSec, checkSec, err := f.lookAtMain()
		f.mu.Lock()
		f.look.At, f.look.Changes, f.look.Sources, f.look.Topics, f.look.Queued = start.Format(time.RFC3339), changes, sources, topics, nil
		f.look.FetchSec, f.look.CheckSec, f.look.Error, f.look.Waiting = fetchSec, checkSec, "", ""
		if err != nil {
			f.look.Error = err.Error()
		}
		f.mu.Unlock()
		if err != nil || len(changes) == 0 {
			return
		}
		fp := fingerprint(changes)
		// Los mismos cambios que la última corrida no se vuelven a correr: si frenó, espera a que la mires; si pasó y
		// siguen viejos, algo no selló, y repetirla sería un bucle que gasta modelo sin arreglar nada.
		// Una que FALLÓ sí se reintenta (algo se rompió, no hubo veredicto): sin límite si fue porque el modelo no
		// contestaba, y hasta maxFailedTries si fue otra cosa, para no girar sobre un error que no se arregla solo.
		if last := f.lastRun(); last != nil && last.Fingerprint == fp && !f.retryable(last, fp) {
			why := "frenó"
			switch last.State {
			case stPassed:
				why = "terminó pero estas fuentes siguen viejas"
			case stFailed:
				why = fmt.Sprintf("falló %d veces seguidas", maxFailedTries)
			}
			f.mu.Lock()
			f.look.Waiting = fmt.Sprintf("la corrida #%d %s sobre estos mismos cambios: espera a que la mires o a que entre uno nuevo", last.ID, why)
			f.mu.Unlock()
			return
		}
		// Sin modelo no se arranca: una corrida que falla en el triaje no sirve, y antes quedaba «falló» con su huella
		// (2026-11-19: tres corridas seguidas con la sesión de `playground login` vencida). Se espera, se avisa una
		// vez, y se vuelve a preguntar cada modelWait: apenas contesta, arranca sola.
		if ok, why := f.modelReady(); !ok {
			f.mu.Lock()
			f.look.Waiting = "esperando al modelo: " + why + ". Arranca sola apenas conteste"
			f.mu.Unlock()
			return
		}
		// Si la última corrida sobre estos mismos cambios cayó porque el modelo no contestaba, se RETOMA esa misma desde
		// el paso donde cayó (los anteriores ya están hechos): no nace otra que repita los pasos 1 a 3 y deje la vieja
		// como ruido en la lista.
		var r *Run
		if last := f.lastRun(); last != nil && last.Fingerprint == fp && last.State == stFailed && last.ModelDown {
			r = f.resume(last)
		} else {
			r = f.newRun(changes, fp, start, fetchSec, checkSec)
		}
		f.mu.Lock()
		f.running = r
		f.mu.Unlock()
		ctx, cancel := context.WithTimeout(context.Background(), 90*time.Minute)
		f.execute(ctx, r)
		cancel()
		f.mu.Lock()
		f.running = nil
		f.mu.Unlock()
		f.tell(r)
		if r.State != stPassed || f.once {
			return // frenó o falló: no se insiste; la próxima mirada decide (y -once hace una sola)
		}
		// Terminó bien: mirar otra vez ya, por si entró algo mientras corría.
	}
}

// lookAtMain: pasos 1 y 2. Devuelve las fuentes viejas (sin las de las corridas: las de los temas que tocaría).
func (f *flow) lookAtMain() (changes []Change, sources, topics int, fetchSec, checkSec float64, err error) {
	f.mu.Lock()
	f.look.Looking, f.look.Since = true, time.Now().Format(time.RFC3339)
	f.mu.Unlock()
	defer func() { f.mu.Lock(); f.look.Looking, f.look.Since = false, ""; f.mu.Unlock() }()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	t := time.Now()
	if _, err = f.sh(ctx, "go", "run", "./cmd/knowledge", "fetch"); err != nil {
		return
	}
	fetchSec = time.Since(t).Seconds()
	t = time.Now()
	out, _ := f.sh(ctx, "go", "run", "./cmd/knowledge", "check", "--json") // sale 1 si hay algo viejo
	checkSec = time.Since(t).Seconds()
	var all []Change
	if err = json.Unmarshal([]byte(out), &all); err != nil {
		err = fmt.Errorf("knowledge check no devolvió su JSON: %v", err)
		return
	}
	seen := map[string]bool{}
	for _, c := range all {
		seen[c.Topic] = true
		if c.State != "unchanged" {
			changes = append(changes, c)
		}
	}
	return changes, len(all), len(seen), fetchSec, checkSec, nil
}

// maxFailedTries: cuántas veces seguidas se reintenta una corrida que falló por algo que no es el modelo.
const maxFailedTries = 3

// modelWait: cada cuánto se vuelve a preguntar si el modelo contesta, mientras hay fuentes viejas esperándolo.
const modelWait = 2 * time.Minute

// retryable: si la última corrida sobre esta huella falló y se puede intentar otra vez.
func (f *flow) retryable(last *Run, fp string) bool {
	if last.State != stFailed {
		return false
	}
	if last.ModelDown {
		return true
	}
	tries := 0
	for _, id := range f.runs.ids() {
		r, err := f.runs.load(id)
		if err != nil || r.Fingerprint != fp || r.State != stFailed {
			break
		}
		if !r.ModelDown {
			tries++
		}
	}
	return tries < maxFailedTries
}

// modelReady: si el modelo de segundo plano contesta. Avisa UNA vez cuando deja de contestar (con lo que lo arregla)
// y otra cuando vuelve, no en cada mirada.
func (f *flow) modelReady() (bool, string) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	st := background.Info(ctx, f.root)
	f.mu.Lock()
	was := f.modelDown
	f.modelDown = !st.Ready
	f.mu.Unlock()
	if st.Ready {
		if was {
			_, _ = notice.Send(notice.Notice{Title: "Knowledge · el modelo volvió", Body: "Retoma la puesta al día que estaba esperando.",
				URL: "cockpit://knowledge/", Group: "creditop-knowledge"})
		}
		return true, ""
	}
	why := st.Detail
	if st.Fix != "" {
		why += " (se arregla con `" + st.Fix + "`)"
	}
	if !was {
		_, _ = notice.Send(notice.Notice{Title: "Knowledge · sin modelo", Body: "Hay fuentes viejas y el modelo no contesta: " + why,
			URL: "cockpit://knowledge/", Group: "creditop-knowledge", Sound: true})
	}
	return false, why
}

func fingerprint(changes []Change) string {
	var keys []string
	for _, c := range changes {
		keys = append(keys, c.Topic+"|"+c.Repo+"|"+c.Path+"|"+c.State)
	}
	sort.Strings(keys)
	sum := sha256.Sum256([]byte(strings.Join(keys, "\n")))
	return hex.EncodeToString(sum[:8])
}

func (f *flow) lastRun() *Run {
	if ids := f.runs.ids(); len(ids) > 0 {
		r, err := f.runs.load(ids[0])
		if err == nil {
			return r
		}
	}
	return nil
}

func (f *flow) newRun(changes []Change, fp string, lookedAt time.Time, fetchSec, checkSec float64) *Run {
	r := &Run{ID: f.runs.next(), State: stRunning, StartedAt: now(), Changes: changes, Fingerprint: fp, Steps: newSteps()}
	r.dir = filepath.Join(f.runs.dir, strconv.Itoa(r.ID))
	topics := map[string]bool{}
	for _, c := range changes {
		topics[c.Topic] = true
	}
	for t := range topics {
		r.Topics = append(r.Topics, t)
	}
	sort.Strings(r.Topics)
	// Los pasos 1 y 2 los hizo la mirada que la disparó: se anotan con sus horas.
	sec := func(x float64) time.Duration { return time.Duration(x * float64(time.Second)) }
	fetched := lookedAt.Add(sec(fetchSec))
	for _, x := range []struct {
		id, summary string
		from, to    time.Time
	}{
		{"fetch", "los clones sólo-main, al día con origin", lookedAt, fetched},
		{"detect", fmt.Sprintf("%d fuente(s) de %d tema(s): %s", len(changes), len(r.Topics), strings.Join(r.Topics, ", ")), fetched, fetched.Add(sec(checkSec))},
	} {
		st := r.step(x.id)
		st.State, st.Summary, st.StartedAt, st.FinishedAt = stDone, x.summary, x.from.Format(time.RFC3339), x.to.Format(time.RFC3339)
	}
	f.runs.save(r)
	return r
}

// resume: vuelve a poner en marcha una corrida que cayó por el modelo, desde el paso que falló.
func (f *flow) resume(r *Run) *Run {
	for i := range r.Steps {
		if r.Steps[i].State == stFailed || r.Steps[i].State == stRunning {
			r.Steps[i] = Step{ID: r.Steps[i].ID, Label: r.Steps[i].Label, Who: r.Steps[i].Who, State: stQueued}
		}
	}
	r.State, r.Result, r.FinishedAt, r.ModelDown = stRunning, "", "", false
	r.Resumed++
	f.runs.save(r)
	return r
}

// tell: el aviso de cómo terminó (no avisa una corrida que pasó sin cambiar la prosa: eso es lo esperado).
func (f *flow) tell(r *Run) {
	title, sound := "Knowledge · al día", false
	switch r.State {
	case stStopped:
		title, sound = "Knowledge · frenó", true
	case stFailed:
		title, sound = "Knowledge · falló", true
	}
	_, _ = notice.Send(notice.Notice{Title: title, Body: fmt.Sprintf("#%d · %s", r.ID, r.Result),
		URL: fmt.Sprintf("cockpit://knowledge/#/run/%d", r.ID), Group: "creditop-knowledge", Sound: sound})
}

// ── la API ───────────────────────────────────────────────────────────────────────────────────────────────────────

func (f *flow) state(w http.ResponseWriter, _ *http.Request) {
	f.mu.Lock()
	look := f.look
	var current *Run
	if f.running != nil {
		cp := *f.running
		current = &cp
	}
	f.mu.Unlock()
	if current != nil {
		// lo que está viejo ahora y no está en la corrida: la cola
		in := map[string]bool{}
		for _, c := range current.Changes {
			in[c.Topic+"|"+c.Path] = true
		}
		for _, c := range look.Changes {
			if !in[c.Topic+"|"+c.Path] {
				look.Queued = append(look.Queued, c)
			}
		}
	}
	// Una corrida frenada o fallada queda SUPERADA cuando después pasó otra y ninguno de sus temas sigue viejo: ya no
	// pide nada, y la interfaz la esconde (Miguel, 2026-11-19: «que no quede ese ruido»). No se borra: es la pista si
	// algo vuelve a fallar.
	stale := map[string]bool{}
	for _, c := range look.Changes {
		stale[c.Topic] = true
	}
	var runs []Summary
	laterPassed := false
	for _, id := range f.runs.ids() {
		if len(runs) >= 40 {
			break
		}
		r, err := f.runs.load(id)
		if err != nil {
			continue
		}
		sum := r.summary()
		if (r.State == stFailed || r.State == stStopped) && laterPassed && look.At != "" {
			sum.Superseded = true
			for _, t := range r.Topics {
				if stale[t] {
					sum.Superseded = false
				}
			}
		}
		if r.State == stPassed {
			laterPassed = true
		}
		runs = append(runs, sum)
	}
	model := background.Chosen()
	writeJSON(w, 200, map[string]any{"look": look, "runs": runs, "running": current != nil, "model": model, "every": lookEvery.Minutes()})
}

func (f *flow) getRun(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.Atoi(r.PathValue("id"))
	run, err := f.runs.load(id)
	if err != nil {
		writeJSON(w, 404, map[string]string{"error": "no hay corrida #" + r.PathValue("id")})
		return
	}
	writeJSON(w, 200, run)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func exit(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, "knowledge-flow:", err)
		os.Exit(1)
	}
}
