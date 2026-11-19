// point — le pasás una captura y una pregunta («¿dónde le doy para continuar?») y devuelve el punto donde tocar, en
// píxeles de la imagen. Corre en la Mac con Qwen3-VL-4B (Apache 2.0) en llama-server; el servidor se levanta solo la
// primera vez y se apaga solo después de 15 minutos sin uso. Medido el 2026-11-18: 39 de 42 preguntas, 2–3 s por
// captura nueva y ~0,3 s por otra pregunta sobre la misma (point/CLAUDE.md).
//
//	bin/point <imagen> '<pregunta>' [--json]
//	bin/point status · bin/point stop
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

// El prompt de localización del recetario de Holo2 (la familia Qwen3-VL usa coordenadas de 0 a 1000), con la salida
// para lo que no está: sin ella el modelo inventa un lugar.
const prompt = `Localize an element on the GUI image according to the provided target and output a click position.
 * You must output a valid JSON following the format: {"x": int 0-1000 (normalized), "y": int 0-1000 (normalized)}
 * If the target is not on the screen, output {"x": -1, "y": -1}
Your target is:
`

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
	asJSON := false
	var rest []string
	for _, a := range args {
		if a == "--json" {
			asJSON = true
		} else {
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
		os.Exit(locate(rest[0], rest[1], asJSON))
	default:
		fmt.Fprintln(os.Stderr, "uso: bin/point <imagen> '<pregunta>' [--json]   ·   bin/point status   ·   bin/point stop")
		os.Exit(2)
	}
}

type answer struct {
	Found   bool    `json:"found"`
	X       int     `json:"x,omitempty"`
	Y       int     `json:"y,omitempty"`
	Width   int     `json:"width"`
	Height  int     `json:"height"`
	Raw     string  `json:"raw"`
	Seconds float64 `json:"seconds"`
}

// locate: 0 si encontró el punto, 3 si el modelo dice que no está, 1 si falló.
func locate(img, question string, asJSON bool) int {
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
			map[string]any{"type": "text", "text": prompt + question},
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
	x, y, ok := parse(a.Raw)
	if !ok {
		return fail(fmt.Errorf("no entendí la respuesta del modelo: %q", a.Raw))
	}
	if x >= 0 && y >= 0 {
		a.Found = true
		a.X, a.Y = toPixels(x, cfg.Width), toPixels(y, cfg.Height)
	}
	if asJSON {
		json.NewEncoder(os.Stdout).Encode(a)
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
	pairRe  = regexp.MustCompile(`"x"\s*:\s*"?(-?\d+(?:\.\d+)?)"?\D+?"y"\s*:\s*"?(-?\d+(?:\.\d+)?)`)
	looseRe = regexp.MustCompile(`(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)`)
)

// parse: las coordenadas que dio el modelo, en su escala de 0 a 1000 (negativas: «no está»). Acepta el número entre
// comillas, que Qwen3-VL a veces devuelve.
func parse(text string) (float64, float64, bool) {
	m := pairRe.FindStringSubmatch(text)
	if m == nil {
		m = looseRe.FindStringSubmatch(text)
	}
	if m == nil {
		return 0, 0, false
	}
	x, _ := strconv.ParseFloat(m[1], 64)
	y, _ := strconv.ParseFloat(m[2], 64)
	return x, y, true
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
