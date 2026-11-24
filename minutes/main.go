// minutes — graba una reunión sin tomar notas: la pantalla (≈1 captura por segundo, sólo las que cambian), el
// micrófono y el audio del sistema, los transcribe en vivo con Whisper en esta Mac y al final arma un recordatorio que
// cruza lo dicho con lo que estaba en pantalla, con Qwen3-VL-4B también en esta Mac. Nada sale a un servicio externo
// salvo el texto del resumen, que lo escribe Claude Haiku 5.5 por `claude -p` (`--local` lo deja en la Mac).
//
//	bin/minutes start [--title '…'] [--no-mic] [--no-system]   arranca (la grabadora y la transcripción, de fondo)
//	bin/minutes stop                                            frena, termina de transcribir y arma el resumen
//	bin/minutes status | live | list | open [carpeta]
//	bin/minutes summarize [carpeta] [--local] [--max-screens N]  lo vuelve a armar
//
// Las piezas: la grabadora es nativa (recorder/main.swift, Minutes.app); `watch` transcribe los tramos a medida que
// aparecen (transcribe.go); `summarize` arma la línea de tiempo y el resumen (summarize.go). Todo queda en
// minutes/recordings/<fecha>/, fuera de git.
package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"syscall"
	"time"

	"creditop/my-tools/lib/models"
)

func usage() {
	fmt.Fprint(os.Stdout, `minutes — grabar una reunión: pantalla, micrófono y sistema, transcripción en vivo y un resumen que cruza lo dicho con lo visto

  bin/minutes start [--title '…'] [--lang es|en|auto] [--no-screen] [--no-mic] [--no-system] [--chunk 15] [--direct]
  bin/minutes stop [--no-summary] [--json]
  bin/minutes status [--json]   la grabación en curso
  bin/minutes live [carpeta]    la transcripción a medida que sale (Ctrl-C sale sin frenar nada)
  bin/minutes list [--json]     las grabaciones
  bin/minutes summarize [carpeta] [--local] [--max-screens 20]
  bin/minutes open [carpeta]    abre el resumen (summary.html)
  bin/minutes serve [127.0.0.1:5249]  la API de la app de Cockpit (make minutes)

  para un agente (la grabación es su id, o la carpeta; sin ella, la en curso o la última):
  bin/minutes show [id] [--json]          todo: resumen, personas, pantallas y frases (minutes.recording/v1)
  bin/minutes context [id] [--max-chars N] [--no-summary]   la reunión en texto compacto, para pasarle a un modelo
  bin/minutes wait [id] [--timeout 30m] [--json]   espera a que termine de grabar, transcribir y resumir
  bin/minutes search --q '…' [--json] [--limit 50]  una frase en todas las grabaciones (sin tildes ni mayúsculas)

  salida: 0 bien · 1 falló · 2 mal pedido · 3 ocupado (grabando, o alguien frenando o resumiendo) ·
          4 no existe (o no hay en curso, o search sin resultados) · 5 wait se cansó · 6 terminó sin resumen
`)
}

func main() {
	if len(os.Args) < 2 {
		usage()
		return
	}
	cmd, args := os.Args[1], os.Args[2:]
	var err error
	switch cmd {
	case "start":
		err = start(args)
	case "stop":
		err = stop(args)
	case "status":
		err = status(args)
	case "live":
		err = live(args)
	case "list":
		err = list(args)
	case "show":
		err = show(args)
	case "context":
		err = contextCmd(args)
	case "wait":
		err = waitCmd(args)
	case "search":
		err = searchCmd(args)
	case "summarize":
		err = summarizeCmd(args)
	case "open":
		var d string
		if d, err = pick(args); err == nil {
			err = exec.Command("open", filepath.Join(d, "summary.html")).Run()
		}
	case "serve": // la API de la app (server.go)
		addr := "127.0.0.1:5249"
		if len(args) > 0 {
			addr = args[0]
		}
		err = serve(addr)
	case "watch": // interno: lo lanza start, de fondo
		if len(args) != 1 {
			err = errors.New("watch <carpeta>")
		} else {
			err = watch(args[0])
		}
	case "-h", "--help", "help":
		usage()
	default:
		fmt.Fprintf(os.Stderr, "minutes: no conozco «%s» (bin/minutes help)\n", cmd)
		os.Exit(exitUsage)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "minutes:", err)
		os.Exit(exitCode(err))
	}
}

func root() string {
	if r := models.FindRoot(); r != "" {
		return r
	}
	wd, _ := os.Getwd()
	return wd
}

func recordingsDir() string { return filepath.Join(root(), "minutes", "recordings") }
func currentFile() string   { return filepath.Join(recordingsDir(), "current") }

// Meta: lo que `start` sabe de la grabación (la grabadora escribe aparte su recorder.json).
type Meta struct {
	Title   string `json:"title"`
	Started string `json:"started"`
	Lang    string `json:"lang,omitempty"` // el idioma para Whisper: es (por defecto), en, auto…
	// AudioOnly: se grabó sin pantalla (--no-screen): no hay capturas ni momentos en pantalla
	AudioOnly bool `json:"audio_only,omitempty"`
}

// RecorderState: recorder.json, lo que escribe la grabadora.
type RecorderState struct {
	Pid        int     `json:"pid"`
	Started    string  `json:"started"`
	Ended      string  `json:"ended"`
	Seconds    float64 `json:"seconds"`
	FramesKept int     `json:"frames_kept"`
	FramesSeen int     `json:"frames_seen"`
}

func readJSON(path string, v any) error {
	b, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(b, v)
}

func writeJSON(path string, v any) error {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, append(b, '\n'), 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// logw: adonde van los pasos de frenar, transcribir y resumir. Además de la terminal (o del log del servidor), mientras
// dura una operación sobre una grabación quedan en su `steps.log`, que la app muestra en la consola de abajo. Las
// operaciones van de a una (el servidor las serializa con begin/end, la consola corre una), así que alcanza una variable.
var logw io.Writer = os.Stderr

// stepsLog manda logw también a <d>/steps.log hasta que se llame lo que devuelve, que anota cómo terminó. Si ya hay
// una operación anotando (stop llama a summarize), no abre otra.
//
// También es el CANDADO de la grabación: deja busy.json con su pid y el paso mientras trabaja (así `show`, `wait` y otra
// terminal saben que está frenando o resumiendo) y, si otro proceso vivo ya lo tiene, sale con exitBusy en vez de
// pisarle los archivos. Un busy.json de un proceso muerto quiere decir que se cortó a mitad: se toma.
func stepsLog(d, what string) (func(*error), error) {
	busyPath := filepath.Join(d, "busy.json")
	if logw != io.Writer(os.Stderr) {
		// anidada (stop → summarize): sólo cambia el paso
		if b, ok := readBusy(d); ok && b.Pid == os.Getpid() {
			b.Step = what
			writeJSON(busyPath, b)
		}
		return func(*error) {}, nil
	}
	if b, ok := readBusy(d); ok && b.Pid != os.Getpid() && alive(b.Pid) {
		return nil, withCode(exitBusy, "%s: el proceso %d ya está %s (bin/minutes wait %s)", filepath.Base(d), b.Pid, b.Step, filepath.Base(d))
	}
	writeJSON(busyPath, busyState{Pid: os.Getpid(), Step: what, Started: time.Now().Format(time.RFC3339)})
	f, err := os.OpenFile(filepath.Join(d, "steps.log"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return func(*error) { os.Remove(busyPath) }, nil
	}
	fmt.Fprintf(f, "── %s %s\n", time.Now().Format(time.TimeOnly), what)
	logw = io.MultiWriter(os.Stderr, f)
	return func(errp *error) {
		if errp != nil && *errp != nil {
			fmt.Fprintf(f, "✗ %v\n", *errp)
		}
		fmt.Fprintf(f, "── %s listo\n", time.Now().Format(time.TimeOnly))
		logw = os.Stderr
		f.Close()
		os.Remove(busyPath)
	}, nil
}

// jsonOut: el comando contesta en JSON por stdout, así que lo demás que imprime (la ruta del resumen) no va ahí.
var jsonOut bool

func alive(pid int) bool {
	return pid > 0 && syscall.Kill(pid, 0) == nil
}

func recorderState(d string) (RecorderState, error) {
	var st RecorderState
	err := readJSON(filepath.Join(d, "recorder.json"), &st)
	return st, err
}

// recorderDone: la grabadora terminó (escribió `ended`) o se murió sin escribirlo.
func recorderDone(d string) bool {
	st, err := recorderState(d)
	if err != nil {
		// sin recorder.json: no arrancó; si dejó errors.jsonl, no va a arrancar
		_, e := os.Stat(filepath.Join(d, "errors.jsonl"))
		return e == nil
	}
	return st.Ended != "" || !alive(st.Pid)
}

// pick: la carpeta pedida, o la grabación en curso, o la última.
func pick(args []string) (string, error) {
	for _, a := range args {
		if !strings.HasPrefix(a, "-") {
			if st, err := os.Stat(a); err == nil && st.IsDir() {
				return filepath.Abs(a)
			}
			d := filepath.Join(recordingsDir(), a)
			if st, err := os.Stat(d); err == nil && st.IsDir() {
				return d, nil
			}
			return "", fmt.Errorf("no existe la grabación %s", a)
		}
	}
	if b, err := os.ReadFile(currentFile()); err == nil {
		d := filepath.Join(recordingsDir(), strings.TrimSpace(string(b)))
		if _, err := os.Stat(d); err == nil {
			return d, nil
		}
	}
	all := recordings()
	if len(all) == 0 {
		return "", errors.New("no hay grabaciones (bin/minutes start)")
	}
	return all[len(all)-1], nil
}

func recordings() []string {
	entries, _ := os.ReadDir(recordingsDir())
	var out []string
	for _, e := range entries {
		if e.IsDir() && !strings.HasPrefix(e.Name(), ".") {
			out = append(out, filepath.Join(recordingsDir(), e.Name()))
		}
	}
	sort.Strings(out)
	return out
}

func start(args []string) error {
	fs := flag.NewFlagSet("start", flag.ContinueOnError)
	title := fs.String("title", "", "el nombre de la reunión")
	noMic := fs.Bool("no-mic", false, "sin el micrófono")
	noSystem := fs.Bool("no-system", false, "sin el audio del sistema")
	noScreen := fs.Bool("no-screen", false, "sólo audio: sin capturas de pantalla")
	chunk := fs.Int("chunk", 15, "segundos por tramo de audio (lo que tarda en salir el texto)")
	lang := fs.String("lang", "es", "el idioma de la reunión para Whisper (es, en, auto…)")
	direct := fs.Bool("direct", false, "corre la grabadora como hija de esta terminal: usa los permisos de la terminal y no los de Minutes.app")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if d, err := pick(nil); err == nil {
		if _, e := os.ReadFile(currentFile()); e == nil && !recorderDone(d) {
			return withCode(exitBusy, "ya hay una grabación en curso: %s (bin/minutes stop)", d)
		}
	}
	if err := checkTools(); err != nil {
		return err
	}
	build := exec.Command(filepath.Join(root(), "minutes", "recorder", "build.sh"))
	build.Stdout, build.Stderr = os.Stderr, os.Stderr
	if err := build.Run(); err != nil {
		return fmt.Errorf("no compila la grabadora: %w", err)
	}
	name := time.Now().Format("2006-01-02_15-04-05")
	d := filepath.Join(recordingsDir(), name)
	if err := os.MkdirAll(d, 0o755); err != nil {
		return err
	}
	if err := writeJSON(filepath.Join(d, "meta.json"), Meta{Title: *title, Started: time.Now().Format(time.RFC3339), Lang: *lang, AudioOnly: *noScreen}); err != nil {
		return err
	}
	// `open` para que macOS le pida los permisos a Minutes.app y no a la terminal que la lanzó
	app := filepath.Join(root(), "minutes", "recorder", ".build", "Minutes.app")
	ra := []string{"--out", d, "--chunk", fmt.Sprint(*chunk)}
	if *noMic {
		ra = append(ra, "--no-mic")
	}
	if *noSystem {
		ra = append(ra, "--no-system")
	}
	if *noScreen {
		ra = append(ra, "--no-screen")
	}
	if *direct {
		logf, err := os.OpenFile(filepath.Join(d, "recorder.out"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
		if err != nil {
			return err
		}
		r := exec.Command(filepath.Join(app, "Contents", "MacOS", "minutes-recorder"), ra...)
		r.Stdout, r.Stderr = logf, logf
		r.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
		if err := r.Start(); err != nil {
			return err
		}
		go r.Wait() // si quien la lanza sigue vivo (el servidor de la app), la recoge al terminar: sin esto queda zombi
	} else if out, err := exec.Command("open", append([]string{"-n", "-g", app, "--args"}, ra...)...).CombinedOutput(); err != nil {
		return fmt.Errorf("open Minutes.app: %v: %s", err, out)
	}
	// la grabadora escribe recorder.json cuando ya graba; si pide permisos, eso espera a que Miguel conteste
	deadline := time.Now().Add(60 * time.Second)
	for {
		if _, err := os.Stat(filepath.Join(d, "recorder.json")); err == nil {
			break
		}
		if b, err := os.ReadFile(filepath.Join(d, "errors.jsonl")); err == nil {
			os.RemoveAll(d)
			msg := strings.TrimSpace(string(b))
			if strings.Contains(msg, "TCC") || strings.Contains(strings.ToLower(msg), "declined") {
				// la primera vez macOS no pregunta siempre: hay que prenderla a mano, una sola vez (la firma no cambia al recompilar)
				exec.Command("open", "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture").Run()
				return fmt.Errorf("macOS no le dio a Minutes el permiso de grabar la pantalla: %s\n  Prendé «Minutes» en Ajustes → Privacidad y seguridad → Grabación de pantalla y audio del sistema (te lo abrí) y volvé a correr start.\n  Mientras tanto, --direct graba con los permisos de esta terminal", msg)
			}
			return fmt.Errorf("la grabadora no arrancó: %s", msg)
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("la grabadora no arrancó en 60 s: ¿macOS está pidiendo «Grabación de pantalla» o «Micrófono» para Minutes? (mirá %s)", filepath.Join(d, "recorder.log"))
		}
		time.Sleep(300 * time.Millisecond)
	}
	os.WriteFile(currentFile(), []byte(name+"\n"), 0o644)
	// la transcripción en vivo, desprendida de esta terminal
	self, _ := os.Executable()
	logf, err := os.OpenFile(filepath.Join(d, "watch.log"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return err
	}
	w := exec.Command(self, "watch", d)
	w.Stdout, w.Stderr = logf, logf
	w.Env = append(os.Environ(), "MY_TOOLS_ROOT="+root())
	w.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if err := w.Start(); err != nil {
		return err
	}
	os.WriteFile(filepath.Join(d, "watch.pid"), []byte(fmt.Sprint(w.Process.Pid)), 0o644)
	// Wait y no Release: lanzada por el servidor de la app (que no termina), una hija que sale sin que nadie la
	// recoja queda zombi, kill(pid, 0) la sigue viendo viva y `stop` la esperaba 10 min («Terminando de transcribir»
	// pegado, 2026-11-24). Desde la consola esto sale enseguida y la recoge launchd.
	go w.Wait()
	fmt.Fprintf(os.Stderr, "● grabando: %s\n  la transcripción en vivo: bin/minutes live · frenar: bin/minutes stop\n", d)
	fmt.Println(d)
	return nil
}

func stop(args []string) (err error) {
	fs := flag.NewFlagSet("stop", flag.ContinueOnError)
	noSummary := fs.Bool("no-summary", false, "sólo frenar y transcribir")
	fs.BoolVar(&jsonOut, "json", false, "al terminar, minutes.recording/v1 liviano (en vez de la ruta)")
	if err := fs.Parse(args); err != nil {
		return codeError{exitUsage, err}
	}
	b, err := os.ReadFile(currentFile())
	if err != nil {
		return withCode(exitNotFound, "no hay una grabación en curso")
	}
	d := filepath.Join(recordingsDir(), strings.TrimSpace(string(b)))
	// el JSON al final de todo, ya soltado el candado (los defer corren al revés: éste se registra primero)
	if jsonOut {
		defer func() {
			if err == nil {
				printJSON(recordingInfo(d, false))
			}
		}()
	}
	done, err := stepsLog(d, "frenando")
	if err != nil {
		return err
	}
	defer done(&err)
	os.WriteFile(filepath.Join(d, "stop"), nil, 0o644)
	for i := 0; !recorderDone(d); i++ {
		if i > 100 {
			return fmt.Errorf("la grabadora no frenó en 30 s (mirá %s)", filepath.Join(d, "recorder.log"))
		}
		time.Sleep(300 * time.Millisecond)
	}
	os.Remove(currentFile())
	st, _ := recorderState(d)
	fmt.Fprintf(logw, "■ frenada: %.0f s, %d capturas distintas de %d\n", st.Seconds, st.FramesKept, st.FramesSeen)
	// la transcripción de fondo termina los tramos que quedan y sale
	if pb, err := os.ReadFile(filepath.Join(d, "watch.pid")); err == nil {
		var pid int
		fmt.Sscan(string(pb), &pid)
		if alive(pid) {
			fmt.Fprintln(logw, "  · terminando de transcribir…")
		}
		// a lo sumo 10 min: si la de fondo se quedó trabada, se la corta y lo que falte se transcribe acá abajo
		for waited := time.Duration(0); alive(pid); waited += 500 * time.Millisecond {
			if waited > 10*time.Minute {
				fmt.Fprintln(logw, "  ⚠ la transcripción de fondo no terminó en 10 min: se corta y se sigue acá")
				syscall.Kill(pid, syscall.SIGTERM)
				break
			}
			time.Sleep(500 * time.Millisecond)
		}
	}
	// por si la de fondo se cayó: lo que falte, acá
	if err := transcribePending(d, true); err != nil {
		return err
	}
	if *noSummary {
		if !jsonOut {
			fmt.Println(d)
		}
		return nil
	}
	return summarize(d, summarizeOptions{MaxScreens: 20})
}

func status(args []string) error {
	fs := flag.NewFlagSet("status", flag.ContinueOnError)
	asJSON := fs.Bool("json", false, "minutes.status/v1: si se graba, y la grabación en curso")
	if err := fs.Parse(args); err != nil {
		return codeError{exitUsage, err}
	}
	b, err := os.ReadFile(currentFile())
	if *asJSON {
		out := map[string]any{"schema": "minutes.status/v1", "recording": false, "current": nil}
		if err == nil {
			if d := filepath.Join(recordingsDir(), strings.TrimSpace(string(b))); fileExists(d) {
				r := recordingInfo(d, false)
				out["recording"], out["current"] = r.State == "recording", r
			}
		}
		return printJSON(out)
	}
	if err != nil {
		fmt.Println("no hay una grabación en curso")
		return nil
	}
	d := filepath.Join(recordingsDir(), strings.TrimSpace(string(b)))
	st, _ := recorderState(d)
	frames := countLines(filepath.Join(d, "frames.jsonl"))
	segs := loadTranscript(d)
	pending := len(pendingChunks(d))
	started, _ := time.Parse(time.RFC3339, st.Started)
	state := "grabando"
	if recorderDone(d) {
		state = "frenada (la grabadora no corre)"
	}
	fmt.Printf("%s · %s · %s\n  capturas distintas: %d · tramos de texto: %d · tramos por transcribir: %d\n",
		filepath.Base(d), state, time.Since(started).Round(time.Second), frames, len(segs), pending)
	return nil
}

func countLines(path string) int {
	f, err := os.Open(path)
	if err != nil {
		return 0
	}
	defer f.Close()
	n := 0
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		if strings.TrimSpace(sc.Text()) != "" {
			n++
		}
	}
	return n
}

func list(args []string) error {
	fs := flag.NewFlagSet("list", flag.ContinueOnError)
	asJSON := fs.Bool("json", false, "minutes.recording/v1 liviano de cada una, la más nueva primero")
	if err := fs.Parse(args); err != nil {
		return codeError{exitUsage, err}
	}
	if *asJSON {
		all := recordings()
		sort.Sort(sort.Reverse(sort.StringSlice(all)))
		out := []recordingJSON{}
		for _, d := range all {
			out = append(out, recordingInfo(d, false))
		}
		return printJSON(map[string]any{"recordings": out})
	}
	for _, d := range recordings() {
		var m Meta
		readJSON(filepath.Join(d, "meta.json"), &m)
		st, _ := recorderState(d)
		sum := ""
		if _, err := os.Stat(filepath.Join(d, "summary.html")); err == nil {
			sum = " · resumen"
		}
		fmt.Printf("%s  %5.0f s  %3d capturas%s  %s\n", filepath.Base(d), st.Seconds, st.FramesKept, sum, m.Title)
	}
	return nil
}

// live imprime la transcripción a medida que sale.
func live(args []string) error {
	d, err := pick(args)
	if err != nil {
		return err
	}
	shown := 0
	for {
		segs := loadTranscript(d)
		for _, s := range segs[min(shown, len(segs)):] {
			if s.Echo {
				continue
			}
			fmt.Printf("[%s] %-8s %s\n", clock(s.Start), speakerLabel(s.Source), s.Text)
		}
		shown = len(segs)
		if recorderDone(d) && len(pendingChunks(d)) == 0 {
			return nil
		}
		time.Sleep(time.Second)
	}
}

func clock(sec float64) string {
	s := int(sec)
	if s >= 3600 {
		return fmt.Sprintf("%d:%02d:%02d", s/3600, s/60%60, s%60)
	}
	return fmt.Sprintf("%02d:%02d", s/60, s%60)
}

func speakerLabel(source string) string {
	if source == "mic" {
		return "yo"
	}
	return "reunión"
}

func checkTools() error {
	var missing []string
	for _, t := range []string{"whisper-cli", "llama-server", "swiftc"} {
		if findTool(t) == "" {
			missing = append(missing, t)
		}
	}
	if len(missing) > 0 {
		return fmt.Errorf("faltan %s (brew install whisper-cpp llama.cpp; swiftc viene con Xcode)", strings.Join(missing, ", "))
	}
	if _, err := whisperModel(); err != nil {
		return err
	}
	return nil
}

func findTool(name string) string {
	if p, err := exec.LookPath(name); err == nil {
		return p
	}
	for _, dir := range []string{"/opt/homebrew/bin", "/usr/local/bin"} {
		if p := filepath.Join(dir, name); fileExists(p) {
			return p
		}
	}
	return ""
}

func fileExists(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}
