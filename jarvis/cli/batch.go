package main

/* LOTES: un flujo repetido con muchos datos, en varias sesiones a la vez.
 *
 *	bin/jarvis batch <app>/<flujo> --data datos.csv [--parallel 3] [--group G] [--color C] [--aside]
 *	                 [--start /ruta] [--mode auto|fill] [--timeout 10m] [--json]
 *
 * Cada columna del CSV es un DATO del flujo, por su nombre (el `param` de su paso: «Título», «Prioridad»…; sin tildes
 * ni mayúsculas da igual). Las filas se reparten entre N sesiones de un mismo grupo (por defecto «Lote · <flujo>»), que
 * reproducen el flujo cada una con su fila: en modo `auto` la herramienta hace todo salvo lo irreversible, que espera
 * el sí de la persona y la avisa (🔔, borde rojo en Cockpit: attention.go). Lo que no es de la persona se ve en vivo en
 * la vista «Todas». Al final, un resumen por fila: cómo terminó, cuántos pasos hizo la herramienta y cuántos la
 * persona, los errores de consola y de red que hubo mientras corría (devlog.go) y cuánto tardó.
 *
 * `--start`: otra página de entrada. Un lote que crea varias cosas no puede entrar por una que borra lo anterior (la
 * demo de tareas entra por «/?reset»). */

import (
	"bytes"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"
)

type batchRow struct {
	N      int               `json:"row"`
	Values map[string]string `json:"values"`
}

type batchResult struct {
	Row        int     `json:"row"`
	Session    string  `json:"session"`
	Status     string  `json:"status"` // done · stopped · timeout · error
	Did        int     `json:"did"`
	ByHand     int     `json:"byHand"`
	Skipped    int     `json:"skipped"`
	Note       string  `json:"note,omitempty"`
	ConsoleErr int     `json:"consoleErrors"`
	NetFailed  int     `json:"networkFailed"`
	Seconds    float64 `json:"seconds"`
	Run        string  `json:"run,omitempty"`
}

// tabCall es call() para una sesión dada (los trabajadores del lote hablan con varias a la vez: tabID es global).
func tabCall(tab, method, path string, body, out any, cli bool) error {
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, api+path, rd)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Jarvis-Tab", tab)
	if cli {
		req.Header.Set("X-Jarvis-Client", "cli")
	}
	res, err := (&http.Client{Timeout: 120 * time.Second}).Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	if res.StatusCode >= 300 {
		var e struct{ Error string }
		if json.Unmarshal(raw, &e) == nil && e.Error != "" {
			return errors.New(e.Error)
		}
		return fmt.Errorf("HTTP %d", res.StatusCode)
	}
	if out != nil {
		return json.Unmarshal(raw, out)
	}
	return nil
}

// foldName: para emparejar columnas con datos sin que importen tildes, mayúsculas, espacios ni signos (usa fold de
// main.go: minúsculas y sin acentos).
func foldName(s string) string {
	var b strings.Builder
	for _, r := range fold(strings.TrimSpace(s)) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func batchCmd(args []string) error {
	if len(args) < 1 || !strings.Contains(args[0], "/") {
		usage()
	}
	app, id, _ := strings.Cut(args[0], "/")
	// --group y --color los toma el CLI como opciones generales (takeTabFlag) antes de llegar acá: se usan de ahí.
	data, parallel, group, color, start, mode, asJSON, aside := "", 3, groupName, groupColor, "", "auto", false, false
	rowTimeout := 10 * time.Minute
	for i := 1; i < len(args); i++ {
		next := func() string {
			if i+1 >= len(args) {
				usage()
			}
			i++
			return args[i]
		}
		switch args[i] {
		case "--data":
			data = next()
		case "--parallel":
			n, err := strconv.Atoi(next())
			if err != nil || n < 1 {
				return errors.New("--parallel: un número desde 1")
			}
			parallel = n
		case "--group":
			group = next()
		case "--color":
			color = next()
		case "--start":
			start = next()
		case "--mode":
			mode = next()
		case "--timeout":
			d, err := time.ParseDuration(next())
			if err != nil {
				return fmt.Errorf("--timeout: %v (por ejemplo 5m)", err)
			}
			rowTimeout = d
		case "--aside":
			aside = true
		case "--json":
			asJSON = true
		default:
			usage()
		}
	}
	// El --group global de este comando no tiene que mandar los pedidos a otra sesión: el lote elige las suyas.
	groupName, tabID = "", ""
	if data == "" {
		return errors.New("falta --data datos.csv")
	}

	var fl struct {
		Name  string `json:"name"`
		Start string `json:"start"`
		Steps []struct {
			Action string `json:"action"`
			Target string `json:"target"`
			Param  string `json:"param"`
			Value  string `json:"value"`
		} `json:"steps"`
	}
	var got struct {
		Flow json.RawMessage `json:"flow"`
	}
	if err := call(http.MethodGet, "/api/flows/"+url.PathEscape(app)+"/"+url.PathEscape(id), nil, &got); err != nil {
		return fmt.Errorf("el flujo %s/%s: %w", app, id, err)
	}
	if err := json.Unmarshal(got.Flow, &fl); err != nil || len(fl.Steps) == 0 {
		return fmt.Errorf("el flujo %s/%s no tiene pasos", app, id)
	}
	params := map[string]int{} // dato (doblado) → número de paso
	var names []string
	for i, s := range fl.Steps {
		if s.Param == "" {
			continue
		}
		if _, ok := params[foldName(s.Param)]; !ok {
			params[foldName(s.Param)] = i
			names = append(names, fmt.Sprintf("%s (por defecto %q)", s.Param, s.Value))
		}
	}

	f, err := os.Open(data)
	if err != nil {
		return err
	}
	defer f.Close()
	cr := csv.NewReader(f)
	cr.TrimLeadingSpace = true
	records, err := cr.ReadAll()
	if err != nil {
		return fmt.Errorf("el CSV: %w", err)
	}
	if len(records) < 2 {
		return errors.New("el CSV necesita una fila de encabezados y al menos una de datos")
	}
	cols := make([]int, len(records[0])) // columna → número de paso
	for c, h := range records[0] {
		i, ok := params[foldName(h)]
		if !ok {
			return fmt.Errorf("la columna %q no es un dato del flujo «%s». Sus datos: %s", h, fl.Name, strings.Join(names, " · "))
		}
		cols[c] = i
	}
	var rows []batchRow
	for n, rec := range records[1:] {
		r := batchRow{N: n + 1, Values: map[string]string{}}
		for c, v := range rec {
			if c < len(cols) {
				r.Values[strconv.Itoa(cols[c])] = v
			}
		}
		rows = append(rows, r)
	}
	if parallel > len(rows) {
		parallel = len(rows)
	}
	if group == "" {
		group = "Lote · " + fl.Name
		if r := []rune(group); len(r) > 40 {
			group = string(r[:40])
		}
	}
	if start == "" && strings.Contains(fl.Start, "reset") {
		fmt.Fprintf(os.Stderr, "⚠ el flujo entra por %q: cada fila borraría lo de las otras. Pasale --start (por ejemplo --start /).\n", fl.Start)
	}

	// Las sesiones del lote: una por trabajador, en el grupo, reservadas por el servidor (Claim).
	var sessions []string
	for w := 0; w < parallel; w++ {
		var nt struct{ ID string }
		if err := call(http.MethodPost, "/api/tabs/claim", map[string]any{"group": group, "color": color, "aside": aside}, &nt); err != nil {
			return err
		}
		sessions = append(sessions, nt.ID)
	}
	if !asJSON {
		fmt.Printf("lote de «%s»: %d fila(s) en %d sesión(es) (%s) del grupo «%s»%s\n", fl.Name, len(rows), parallel, strings.Join(sessions, ", "), group, map[bool]string{true: ", en la ventana aparte", false: ""}[aside])
	}

	var mu sync.Mutex
	say := func(format string, a ...any) {
		if asJSON {
			return
		}
		mu.Lock()
		fmt.Printf(format+"\n", a...)
		mu.Unlock()
	}
	queue := make(chan batchRow)
	results := make([]batchResult, 0, len(rows))
	var wg sync.WaitGroup
	t0 := time.Now()
	for _, s := range sessions {
		wg.Add(1)
		go func(tab string) {
			defer wg.Done()
			for row := range queue {
				res := runBatchRow(tab, app, id, mode, start, row, rowTimeout, say)
				mu.Lock()
				results = append(results, res)
				mu.Unlock()
			}
		}(s)
	}
	for _, r := range rows {
		queue <- r
	}
	close(queue)
	wg.Wait()
	sort.Slice(results, func(i, j int) bool { return results[i].Row < results[j].Row })

	if asJSON {
		b, _ := json.MarshalIndent(results, "", "  ")
		fmt.Println(string(b))
		return nil
	}
	ok := 0
	fmt.Printf("\n── resumen (%.1f s) ──\n", time.Since(t0).Seconds())
	for _, r := range results {
		mark := map[string]string{"done": "✓ hecho", "stopped": "✗ frenado", "timeout": "⏱ venció", "error": "✗ error"}[r.Status]
		if r.Status == "done" {
			ok++
		}
		extra := ""
		if r.ConsoleErr > 0 || r.NetFailed > 0 {
			extra = fmt.Sprintf(" · ⚠ %d error(es) de consola, %d pedido(s) fallido(s)", r.ConsoleErr, r.NetFailed)
		}
		note := ""
		if r.Note != "" && r.Status != "done" {
			note = " · " + r.Note
		}
		run := ""
		if r.Run != "" {
			run = " · corrida " + r.Run
		}
		fmt.Printf("  fila %d · sesión %s · %s en %.1f s · herramienta %d, vos %d, saltados %d%s%s%s\n", r.Row, r.Session, mark, r.Seconds, r.Did, r.ByHand, r.Skipped, extra, note, run)
	}
	fmt.Printf("%d de %d filas hechas. La consola y la red de cada una: bin/jarvis console --run <id> (las corridas quedan en .data/runs)\n", ok, len(results))
	return nil
}

// runBatchRow reproduce el flujo con una fila en una sesión y espera a que termine.
func runBatchRow(tab, app, id, mode, start string, row batchRow, timeout time.Duration, say func(string, ...any)) (res batchResult) {
	res = batchResult{Row: row.N, Session: tab}
	t0 := time.Now()
	defer func() { res.Seconds = time.Since(t0).Seconds() }() // resultado con nombre: el defer sí llega
	var mark struct{ Last int }
	_ = tabCall(tab, http.MethodGet, "/api/live/devlog?since=999999999", nil, &mark, false)
	values := map[string]string{}
	for k, v := range row.Values {
		values[k] = v
	}
	if err := tabCall(tab, http.MethodPost, "/api/flows/"+url.PathEscape(app)+"/"+url.PathEscape(id)+"/replay", map[string]any{"mode": mode, "values": values, "start": start}, nil, true); err != nil {
		res.Status, res.Note = "error", err.Error()
		say("  fila %d · sesión %s · ✗ no arrancó: %v", row.N, tab, err)
		return res
	}
	say("  fila %d · sesión %s · arrancó", row.N, tab)
	// En automático la reproducción pasa UN INSTANTE por «waiting» antes de actuar sola (trampa anotada en
	// CLAUDE.md): sólo se avisa si sigue esperando a la persona un rato.
	var waitingSince time.Time
	warned := false
	for {
		var st struct {
			Replay *struct {
				Status  string `json:"status"`
				Did     int    `json:"did"`
				ByHand  int    `json:"byHand"`
				Skipped int    `json:"skipped"`
				Note    string `json:"note"`
				Report  string `json:"report"`
			} `json:"replay"`
		}
		if err := tabCall(tab, http.MethodGet, "/api/live/state", nil, &st, false); err == nil && st.Replay != nil {
			rp := st.Replay
			switch rp.Status {
			case "done", "stopped":
				res.Status, res.Did, res.ByHand, res.Skipped, res.Note, res.Run = rp.Status, rp.Did, rp.ByHand, rp.Skipped, rp.Note, rp.Report
				var d struct {
					Console []struct{ Level string } `json:"console"`
					Network []struct {
						Status int    `json:"status"`
						Failed string `json:"failed"`
					} `json:"network"`
				}
				_ = tabCall(tab, http.MethodGet, "/api/live/devlog?since="+strconv.Itoa(mark.Last), nil, &d, false)
				for _, c := range d.Console {
					if c.Level == "error" || c.Level == "excepción" {
						res.ConsoleErr++
					}
				}
				for _, n := range d.Network {
					if n.Failed != "" || n.Status >= 400 {
						res.NetFailed++
					}
				}
				say("  fila %d · sesión %s · %s", row.N, tab, map[string]string{"done": "✓ hecha", "stopped": "✗ frenada"}[rp.Status])
				return res
			default:
				waitingSince = time.Time{}
			case "waiting", "person":
				if waitingSince.IsZero() {
					waitingSince = time.Now()
				}
				if !warned && time.Since(waitingSince) > 2500*time.Millisecond {
					warned = true
					say("  fila %d · sesión %s · 🔔 te necesita: %s", row.N, tab, strings.TrimSpace(rp.Note+" (decidilo en Cockpit o en su pestaña)"))
				}
			}
		}
		if time.Since(t0) > timeout {
			res.Status, res.Note = "timeout", fmt.Sprintf("no terminó en %s", timeout)
			_ = tabCall(tab, http.MethodPost, "/api/live/replay/answer", map[string]string{"answer": "stop"}, nil, true)
			return res
		}
		time.Sleep(700 * time.Millisecond)
	}
}
