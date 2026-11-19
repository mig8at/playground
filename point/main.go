// point — le pasás una captura y una pregunta («¿dónde le doy para continuar?») y devuelve el punto donde tocar, en
// píxeles de la imagen. Corre en la Mac con Qwen3-VL-4B (Apache 2.0) en llama-server; el servidor se levanta solo la
// primera vez y se apaga solo después de 15 minutos sin uso. Medido el 2026-11-19: 39 de 42 preguntas, 2–3 s por
// captura nueva y ~0,5 s por otra pregunta sobre la misma (point/CLAUDE.md).
//
//	bin/point <imagen> '<pregunta>' [--box] [--mark marcada.png] [--json]
//	bin/point status · bin/point stop
//
// El punto es el centro del recuadro del control; --box también lo imprime (con --json va siempre). --mark guarda una
// copia de la imagen con el recuadro y el punto dibujados, para verlo.
package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"syscall"
	"time"
)

const (
	port     = 5251
	idle     = 15 * time.Minute
	model    = "Qwen3VL-4B-Instruct-Q4_K_M.gguf"
	mmproj   = "mmproj-Qwen3VL-4B-Instruct-Q8_0.gguf"
	modelURL = "https://huggingface.co/Qwen/Qwen3-VL-4B-Instruct-GGUF/resolve/main/"
)

// Se pide el recuadro del control que hay que tocar (bbox_2d, de 0 a 1000, el formato de Qwen3-VL) y el punto es su
// centro: medido el 2026-11-19, 39 de 42 contra 37 pidiendo el punto directo. Pedir «el control a tocar» y
// «ajustado» importa: con «el elemento» devolvía la tarjeta entera que lo contiene. La salida «no está» evita que
// invente un lugar.
const boxPrompt = `Locate the single clickable UI element (button, link, input, checkbox) that the user should interact with for the request below, and output its tight bounding box as JSON {"bbox_2d": [x1, y1, x2, y2]}, coordinates normalized 0-1000.
If the target is not on the screen, output {"bbox_2d": []}
Request: `

var base = fmt.Sprintf("http://127.0.0.1:%d", port)

func dir() string {
	if xdg := os.Getenv("XDG_CACHE_HOME"); xdg != "" {
		return filepath.Join(xdg, "my-tools")
	}
	home, err := os.UserHomeDir()
	if err != nil {
		panic(err)
	}
	return filepath.Join(home, ".cache", "my-tools")
}

func stateDir() string { return filepath.Join(dir(), "point") }
func modelPath(f string) string {
	return filepath.Join(dir(), "models", f)
}

func main() {
	args := os.Args[1:]
	var o options
	var rest []string
	for i := 0; i < len(args); i++ {
		switch a := args[i]; {
		case a == "--json":
			o.json = true
		case a == "--box":
			o.box = true
		case a == "--mark" && i+1 < len(args):
			i++
			o.mark = args[i]
		default:
			rest = append(rest, a)
		}
	}
	switch {
	case len(rest) == 1 && rest[0] == "serve":
		serve()
	case len(rest) == 1 && rest[0] == "status":
		status()
	case len(rest) == 1 && rest[0] == "stop":
		stop()
	case len(rest) == 2:
		os.Exit(locate(rest[0], rest[1], o))
	default:
		fmt.Fprintln(os.Stderr, "uso: bin/point <imagen> '<pregunta>' [--box] [--mark marcada.png] [--json]   ·   bin/point status   ·   bin/point stop")
		os.Exit(2)
	}
}

type options struct {
	json, box bool
	mark      string
}

type answer struct {
	Found   bool    `json:"found"`
	X       int     `json:"x,omitempty"`
	Y       int     `json:"y,omitempty"`
	Box     []int   `json:"box,omitempty"` // x1, y1, x2, y2 en píxeles
	Mark    string  `json:"mark,omitempty"`
	Width   int     `json:"width"`
	Height  int     `json:"height"`
	Raw     string  `json:"raw"`
	Seconds float64 `json:"seconds"`
}

// locate: 0 si encontró el punto, 3 si el modelo dice que no está, 1 si falló.
func locate(img, question string, o options) int {
	data, err := os.ReadFile(img)
	if err != nil {
		return fail(err)
	}
	cfg, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return fail(fmt.Errorf("%s no es PNG ni JPEG: %v", img, err))
	}
	if err := ensure(); err != nil {
		return fail(err)
	}
	touch()
	began := time.Now()
	body, _ := json.Marshal(map[string]any{
		"messages": []any{map[string]any{"role": "user", "content": []any{
			map[string]any{"type": "image_url", "image_url": map[string]string{"url": "data:image/" + format + ";base64," + base64.StdEncoding.EncodeToString(data)}},
			map[string]any{"type": "text", "text": boxPrompt + question},
		}}},
		"temperature": 0, "max_tokens": 64,
		"chat_template_kwargs": map[string]bool{"enable_thinking": false},
	})
	resp, err := (&http.Client{Timeout: 2 * time.Minute}).Post(base+"/v1/chat/completions", "application/json", bytes.NewReader(body))
	if err != nil {
		return fail(err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return fail(fmt.Errorf("llama-server %d: %s", resp.StatusCode, strings.TrimSpace(string(raw))))
	}
	var r struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(raw, &r); err != nil || len(r.Choices) == 0 {
		return fail(fmt.Errorf("respuesta sin contenido: %s", raw))
	}
	a := answer{Width: cfg.Width, Height: cfg.Height, Raw: strings.TrimSpace(r.Choices[0].Message.Content), Seconds: time.Since(began).Round(10 * time.Millisecond).Seconds()}
	b, ok := parseBox(a.Raw)
	if !ok {
		return fail(fmt.Errorf("no entendí la respuesta del modelo: %q", a.Raw))
	}
	if b != nil {
		a.Found = true
		a.Box = []int{toPixels(b[0], cfg.Width), toPixels(b[1], cfg.Height), toPixels(b[2], cfg.Width), toPixels(b[3], cfg.Height)}
		a.X, a.Y = (a.Box[0]+a.Box[2])/2, (a.Box[1]+a.Box[3])/2
	}
	if o.mark != "" && a.Found {
		if err := mark(data, o.mark, a); err != nil {
			return fail(err)
		}
		a.Mark = o.mark
	}
	if o.json {
		json.NewEncoder(os.Stdout).Encode(a)
	} else if a.Found && o.box {
		fmt.Printf("%d %d  (recuadro %d,%d–%d,%d)\n", a.X, a.Y, a.Box[0], a.Box[1], a.Box[2], a.Box[3])
	} else if a.Found {
		fmt.Printf("%d %d\n", a.X, a.Y)
	} else {
		fmt.Println("no está en la pantalla")
	}
	if !a.Found {
		return 3
	}
	return 0
}

var (
	boxRe   = regexp.MustCompile(`\[\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\]`)
	emptyRe = regexp.MustCompile(`\[\s*\]`)
)

// parseBox: el recuadro x1, y1, x2, y2 (de 0 a 1000), ordenado; nil y ok si el modelo dice que no está.
func parseBox(text string) ([]float64, bool) {
	m := boxRe.FindStringSubmatch(text)
	if m == nil {
		return nil, emptyRe.MatchString(text)
	}
	b := make([]float64, 4)
	for i := range b {
		b[i], _ = strconv.ParseFloat(m[i+1], 64)
	}
	if b[0] < 0 || b[1] < 0 {
		return nil, true
	}
	if b[2] < b[0] {
		b[0], b[2] = b[2], b[0]
	}
	if b[3] < b[1] {
		b[1], b[3] = b[3], b[1]
	}
	return b, true
}

func toPixels(v float64, size int) int {
	if v > 1000 { // vino en píxeles
		return min(int(v+0.5), size-1)
	}
	return min(int(v/1000*float64(size)+0.5), size-1)
}

func fail(err error) int {
	fmt.Fprintln(os.Stderr, "point:", err)
	return 1
}

// ── el servidor: se levanta a pedido y se apaga solo ──────────────────────────────────────────────────────────

func healthy() bool {
	c := http.Client{Timeout: 2 * time.Second}
	resp, err := c.Get(base + "/health")
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode == http.StatusOK
}

func touch() {
	os.MkdirAll(stateDir(), 0o755)
	os.WriteFile(filepath.Join(stateDir(), "last-use"), nil, 0o644)
	now := time.Now()
	os.Chtimes(filepath.Join(stateDir(), "last-use"), now, now)
}

// ensure deja el servidor contestando: si no está, arranca `point serve` desprendido de esta terminal y espera.
func ensure() error {
	if healthy() {
		return nil
	}
	for _, f := range []string{model, mmproj} {
		if _, err := os.Stat(modelPath(f)); err != nil {
			return fmt.Errorf("falta %s (Qwen/Qwen3-VL-4B-Instruct-GGUF en Hugging Face): curl -L -o %s '%s%s'", f, modelPath(f), modelURL, f)
		}
	}
	if _, err := exec.LookPath("llama-server"); err != nil {
		return errors.New("falta llama-server: brew install llama.cpp")
	}
	self, err := os.Executable()
	if err != nil {
		return err
	}
	os.MkdirAll(stateDir(), 0o755)
	logf, err := os.OpenFile(filepath.Join(stateDir(), "server.log"), os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
	if err != nil {
		return err
	}
	touch()
	cmd := exec.Command(self, "serve")
	cmd.Stdout, cmd.Stderr = logf, logf
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if err := cmd.Start(); err != nil {
		return err
	}
	cmd.Process.Release()
	fmt.Fprintln(os.Stderr, "point: levantando Qwen3-VL-4B…")
	for i := 0; i < 120; i++ {
		if healthy() {
			return nil
		}
		time.Sleep(500 * time.Millisecond)
	}
	return fmt.Errorf("llama-server no contestó en 60 s (mirá %s)", filepath.Join(stateDir(), "server.log"))
}

// serve corre llama-server como hijo y lo apaga cuando pasan `idle` sin uso (la marca last-use).
func serve() {
	os.WriteFile(filepath.Join(stateDir(), "pid"), []byte(strconv.Itoa(os.Getpid())), 0o644)
	defer os.Remove(filepath.Join(stateDir(), "pid"))
	cmd := exec.Command("llama-server", "-m", modelPath(model), "--mmproj", modelPath(mmproj),
		"--host", "127.0.0.1", "--port", strconv.Itoa(port), "-ngl", "99", "-c", "8192", "--reasoning-budget", "0", "--no-webui")
	cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
	if err := cmd.Start(); err != nil {
		fmt.Fprintln(os.Stderr, "point:", err)
		os.Exit(1)
	}
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	sigs := make(chan os.Signal, 1)
	signalNotify(sigs)
	tick := time.NewTicker(30 * time.Second)
	defer tick.Stop()
	for {
		select {
		case err := <-done:
			fmt.Fprintln(os.Stderr, "point: llama-server terminó:", err)
			return
		case <-sigs:
			cmd.Process.Signal(syscall.SIGTERM)
			<-done
			return
		case <-tick.C:
			st, err := os.Stat(filepath.Join(stateDir(), "last-use"))
			if err != nil || time.Since(st.ModTime()) > idle {
				fmt.Fprintln(os.Stderr, "point: sin uso, se apaga")
				cmd.Process.Signal(syscall.SIGTERM)
				<-done
				return
			}
		}
	}
}

func status() {
	if !healthy() {
		fmt.Println("apagado (se levanta solo con la primera pregunta)")
		return
	}
	left := ""
	if st, err := os.Stat(filepath.Join(stateDir(), "last-use")); err == nil {
		left = fmt.Sprintf("; se apaga en %s sin uso", (idle - time.Since(st.ModTime())).Round(time.Second))
	}
	fmt.Printf("arriba en :%d con Qwen3-VL-4B%s\n", port, left)
}

func stop() {
	raw, err := os.ReadFile(filepath.Join(stateDir(), "pid"))
	pid, _ := strconv.Atoi(strings.TrimSpace(string(raw)))
	if err != nil || pid <= 0 {
		fmt.Println("no está corriendo")
		return
	}
	if p, err := os.FindProcess(pid); err == nil && p.Signal(syscall.SIGTERM) == nil {
		fmt.Println("apagado")
		return
	}
	fmt.Println("no está corriendo")
}
