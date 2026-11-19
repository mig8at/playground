// Package llamaserve levanta un llama-server a pedido y lo deja apagarse solo cuando no se usa: el primero que lo
// necesita lo arranca desprendido de su terminal, cada uso deja una marca de tiempo, y un vigía de shell lo apaga al
// pasar el tiempo sin uso. No depende de que el que lo arrancó siga vivo (sirve también desde `go run`).
package llamaserve

import (
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
)

// Spec: qué servidor y dónde lleva su estado (~/.cache/my-tools/<Name>: pid, last-use y server.log).
type Spec struct {
	Name string        // p. ej. "knowledge-embed"
	Port int           // en 127.0.0.1
	Args []string      // lo que va después de `llama-server` (-m, --embedding…), sin --host ni --port
	Idle time.Duration // sin uso tanto tiempo, se apaga
}

func (s Spec) dir() string {
	base := os.Getenv("XDG_CACHE_HOME")
	if base == "" {
		home, _ := os.UserHomeDir()
		base = filepath.Join(home, ".cache")
	}
	return filepath.Join(base, "my-tools", s.Name)
}

func (s Spec) URL() string { return "http://127.0.0.1:" + strconv.Itoa(s.Port) }

// Healthy: el servidor contesta /health.
func (s Spec) Healthy() bool {
	c := http.Client{Timeout: 2 * time.Second}
	resp, err := c.Get(s.URL() + "/health")
	if err != nil {
		return false
	}
	resp.Body.Close()
	return resp.StatusCode == http.StatusOK
}

// Touch deja la marca de uso que mira el vigía.
func (s Spec) Touch() {
	os.MkdirAll(s.dir(), 0o755)
	p := filepath.Join(s.dir(), "last-use")
	if f, err := os.Create(p); err == nil {
		f.Close()
	}
	now := time.Now()
	os.Chtimes(p, now, now)
}

// Ensure deja el servidor contestando: si no está, lo arranca con su vigía y espera hasta `wait`.
func (s Spec) Ensure(wait time.Duration) error {
	if s.Healthy() {
		s.Touch()
		return nil
	}
	if _, err := exec.LookPath("llama-server"); err != nil {
		return fmt.Errorf("falta llama-server: brew install llama.cpp")
	}
	os.MkdirAll(s.dir(), 0o755)
	logf, err := os.OpenFile(filepath.Join(s.dir(), "server.log"), os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
	if err != nil {
		return err
	}
	defer logf.Close()
	s.Touch()
	args := append([]string{"--host", "127.0.0.1", "--port", strconv.Itoa(s.Port), "--no-webui"}, s.Args...)
	cmd := exec.Command("llama-server", args...)
	cmd.Stdout, cmd.Stderr = logf, logf
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if err := cmd.Start(); err != nil {
		return err
	}
	pid := cmd.Process.Pid
	cmd.Process.Release()
	os.WriteFile(filepath.Join(s.dir(), "pid"), []byte(strconv.Itoa(pid)), 0o644)
	// el vigía: cada 30 s, si el servidor ya no está, termina; si la marca de uso es más vieja que Idle, lo apaga
	mins := int(s.Idle.Minutes())
	if mins < 1 {
		mins = 1
	}
	watch := fmt.Sprintf(`while sleep 30; do kill -0 %d 2>/dev/null || exit 0; `+
		`if [ -n "$(find %q -mmin +%d 2>/dev/null)" ]; then kill %d; exit 0; fi; done`,
		pid, filepath.Join(s.dir(), "last-use"), mins, pid)
	w := exec.Command("/bin/sh", "-c", watch)
	w.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if err := w.Start(); err == nil {
		w.Process.Release()
	}
	deadline := time.Now().Add(wait)
	for time.Now().Before(deadline) {
		if s.Healthy() {
			return nil
		}
		time.Sleep(300 * time.Millisecond)
	}
	return fmt.Errorf("llama-server (%s) no contestó en %s (mirá %s)", s.Name, wait, filepath.Join(s.dir(), "server.log"))
}

// Stop apaga el servidor que arrancó este paquete (por su pid guardado).
func (s Spec) Stop() bool {
	raw, err := os.ReadFile(filepath.Join(s.dir(), "pid"))
	pid, _ := strconv.Atoi(strings.TrimSpace(string(raw)))
	if err != nil || pid <= 0 {
		return false
	}
	p, err := os.FindProcess(pid)
	return err == nil && p.Signal(syscall.SIGTERM) == nil
}
