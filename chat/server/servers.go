// LOS SERVERS: lo que hay que tener prendido en esta máquina para probar contra ella. Hoy uno, «Ecommerce · local»
// (servers_local.go). Acá quedan lo común a los servers y las rutas. El de la app de pagos de Shopify (app-qa, un túnel
// de Cloudflare y la tienda de desarrollo apuntada a él) se sacó el 2026-11-09: la app vive desplegada en dev
// (shopify-app.dev.creditop.com) y la tienda usa su versión publicada.

package main

import (
	"bufio"
	"context"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"syscall"
	"time"
)

type serverCheck struct {
	Name   string `json:"name"`
	OK     bool   `json:"ok"`
	Detail string `json:"detail"`
	How    string `json:"how,omitempty"` // qué hace «Levantar» con esta pieza
}

type serverView struct {
	ID        string        `json:"id"`
	Name      string        `json:"name"`
	Ready     bool          `json:"ready"`
	TunnelURL string        `json:"tunnelUrl,omitempty"`
	Checks    []serverCheck `json:"checks"`
	Busy      bool          `json:"busy"`
	Step      string        `json:"step,omitempty"`
	Log       []string      `json:"log"`
	Error     string        `json:"error,omitempty"`
	DownLabel string        `json:"downLabel,omitempty"` // el botón de apagar; vacío, no hay
	CanDown   bool          `json:"canDown"`
}

// Lo que se recuerda entre arranques del chat de un túnel que se abrió (lo usa el de «Ecommerce · local»).
type shopifyMemory struct {
	TunnelPID     int    `json:"tunnelPid,omitempty"`
	TunnelURL     string `json:"tunnelUrl,omitempty"`
	PreviewForURL string `json:"previewForUrl,omitempty"`
}

type shopifyServer struct {
	mu    sync.Mutex
	busy  bool
	step  string
	log   []string
	err   string
	since time.Time
}

func (s *shopifyServer) logf(format string, args ...any) {
	s.mu.Lock()
	defer s.mu.Unlock()
	line := time.Now().Format("15:04:05") + "  " + fmt.Sprintf(format, args...)
	s.log = append(s.log, line)
	if len(s.log) > 2000 {
		s.log = s.log[len(s.log)-2000:]
	}
}

func (s *shopifyServer) setStep(step string) {
	s.mu.Lock()
	s.step = step
	s.mu.Unlock()
	s.logf("%s", step)
}

// ---- dónde están las cosas ---------------------------------------------------------------------------------------

func shopifyRepo() string {
	if dir := os.Getenv("SHOPIFY_REPO"); dir != "" {
		return dir
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, "Desktop", "CREDITOP", "github", "shopify")
}

func memoryPath() string {
	dir, err := os.UserCacheDir()
	if err != nil {
		dir = os.TempDir()
	}
	return filepath.Join(dir, "creditop-chat", "shopify-server.json")
}

func toolEnv() []string {
	env := os.Environ()
	extra := "/opt/homebrew/bin:/usr/local/bin:/Applications/Docker.app/Contents/Resources/bin"
	for i, kv := range env {
		if strings.HasPrefix(kv, "PATH=") {
			env[i] = "PATH=" + extra + ":" + strings.TrimPrefix(kv, "PATH=")
			return env
		}
	}
	return append(env, "PATH="+extra+":/usr/bin:/bin")
}

func lookTool(name string) (string, error) {
	home, _ := os.UserHomeDir()
	for _, dir := range []string{"/opt/homebrew/bin", "/usr/local/bin", "/Applications/Docker.app/Contents/Resources/bin",
		filepath.Join(home, ".local", "bin"), filepath.Join(home, ".claude", "local")} {
		if p := filepath.Join(dir, name); fileExists(p) {
			return p, nil
		}
	}
	return exec.LookPath(name)
}

func fileExists(p string) bool { _, err := os.Stat(p); return err == nil }

// ---- el estado ---------------------------------------------------------------------------------------------------

func httpOK(url string, timeout time.Duration) bool {
	client := &http.Client{Timeout: timeout}
	res, err := client.Get(url)
	if err != nil {
		return false
	}
	res.Body.Close()
	return res.StatusCode == http.StatusOK
}

func processAlive(pid int) bool { return pid > 0 && syscall.Kill(pid, 0) == nil }

func (s *shopifyServer) run(ctx context.Context, dir string, env []string, name string, args ...string) error {
	path, err := lookTool(name)
	if err != nil {
		return fmt.Errorf("no está %s en esta máquina", name)
	}
	s.logf("$ %s %s", name, strings.Join(args, " "))
	cmd := exec.CommandContext(ctx, path, args...)
	cmd.Dir, cmd.Env = dir, append(toolEnv(), env...)
	out, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	cmd.Stderr = cmd.Stdout
	if err := cmd.Start(); err != nil {
		return err
	}
	s.streamLines(out)
	return cmd.Wait()
}

// Cada línea a la consola, sin los códigos de color ni los marcos de las TUIs.
var ansi = regexp.MustCompile(`\x1b\[[0-9;?]*[A-Za-z]`)

func (s *shopifyServer) streamLines(r interface{ Read([]byte) (int, error) }) {
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)
	for scanner.Scan() {
		if line := strings.TrimRight(ansi.ReplaceAllString(scanner.Text(), ""), " \r"); strings.TrimSpace(line) != "" {
			s.logf("  %s", line)
		}
	}
}

var tunnelURL = regexp.MustCompile(`https://[a-z0-9-]+\.trycloudflare\.com`)

func tailLog(raw []byte) string {
	lines := strings.Split(strings.TrimSpace(string(raw)), "\n")
	if len(lines) > 3 {
		lines = lines[len(lines)-3:]
	}
	return strings.Join(lines, " · ")
}

func serverHandlers(mux *http.ServeMux) {
	localHandlers(mux)
	mux.HandleFunc("GET /api/servers", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"servers": []serverView{localStatus()}})
	})
}
