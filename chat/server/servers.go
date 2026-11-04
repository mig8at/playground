package main

// LOS SERVERS: lo que hay que tener prendido en esta máquina para que otra persona pruebe contra ella. Hoy uno, la
// app de pagos de Shopify (el repo shopify): su contenedor app-qa (:8121, contra qa), un túnel público hacia él y la
// tienda de desarrollo apuntada a ese túnel. Shopify llama desde internet: el playground no sirve (sólo deja entrar
// la VPN), por eso el túnel.
//
// «Levantar» hace sólo lo que falta, en orden. El túnel corre en su propio grupo de procesos y sobrevive al chat
// (quien prueba no se queda colgado si se cierra); su pid y su dirección quedan en el directorio de caché del
// usuario, y «Apagar» lo cierra. Nada de esto escribe en ninguna base: escribe los archivos de prueba del repo shopify
// (vía docker/usar-tunel.sh) y sube la extensión como vista previa de la tienda de desarrollo.

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
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

const (
	shopifyAppPort = "8121"
	shopifyStore   = "creditop-dev-store.myshopify.com"
	shopifyConfig  = "shopify.app.creditop-ecommerce-payments-local.toml"
)

type serverCheck struct {
	Name   string `json:"name"`
	OK     bool   `json:"ok"`
	Detail string `json:"detail"`
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
}

// Lo que se recuerda entre arranques del chat: el túnel que se abrió y para qué dirección se subió la extensión.
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

var shopifySrv shopifyServer

func (s *shopifyServer) logf(format string, args ...any) {
	s.mu.Lock()
	defer s.mu.Unlock()
	line := time.Now().Format("15:04:05") + "  " + fmt.Sprintf(format, args...)
	s.log = append(s.log, line)
	if len(s.log) > 200 {
		s.log = s.log[len(s.log)-200:]
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

func tunnelLogPath() string { return filepath.Join(filepath.Dir(memoryPath()), "shopify-tunnel.log") }

func readMemory() shopifyMemory {
	var m shopifyMemory
	if raw, err := os.ReadFile(memoryPath()); err == nil {
		_ = json.Unmarshal(raw, &m)
	}
	return m
}

func writeMemory(m shopifyMemory) {
	_ = os.MkdirAll(filepath.Dir(memoryPath()), 0o700)
	raw, _ := json.MarshalIndent(m, "", "  ")
	_ = os.WriteFile(memoryPath(), raw, 0o600)
}

// El chat puede arrancar desde la app de escritorio, con un PATH corto: ahí no están Homebrew ni Docker.
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
	for _, dir := range []string{"/opt/homebrew/bin", "/usr/local/bin", "/Applications/Docker.app/Contents/Resources/bin"} {
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

func secretAppURL(repo string) string {
	raw, err := os.ReadFile(filepath.Join(repo, "docker", "secrets", "qa.json"))
	if err != nil {
		return ""
	}
	var s struct {
		AppURL string `json:"SHOPIFY_APP_URL"`
	}
	_ = json.Unmarshal(raw, &s)
	return strings.TrimRight(s.AppURL, "/")
}

var paymentSessionURL = regexp.MustCompile(`(?m)^payment_session_url = "([^"]+)/payments/session"`)

func extensionURL(repo string) string {
	raw, err := os.ReadFile(filepath.Join(repo, "extensions", "creditop-offsite", "shopify.extension.toml"))
	if err != nil {
		return ""
	}
	if m := paymentSessionURL.FindSubmatch(raw); m != nil {
		return string(m[1])
	}
	return ""
}

// El túnel que está vivo y llega a la app, o "". `external`: no lo abrió el chat (se abrió en una terminal, con
// `cloudflared tunnel --url …` y `usar-tunel.sh`): se usa igual, pero se cierra en esa terminal.
func liveTunnel(m shopifyMemory, repo string) (url string, external bool) {
	if m.TunnelURL != "" && processAlive(m.TunnelPID) && httpOK(m.TunnelURL+"/", 10*time.Second) {
		return m.TunnelURL, false
	}
	if u := secretAppURL(repo); tunnelURL.MatchString(u) && httpOK(u+"/", 10*time.Second) {
		return u, true
	}
	return "", false
}

func shopifyStatus() serverView {
	repo := shopifyRepo()
	m := readMemory()
	view := serverView{ID: "shopify", Name: "Shopify · app de pagos", Log: []string{}}

	app := serverCheck{Name: "Servidor de la app"}
	switch {
	case !fileExists(filepath.Join(repo, "docker", "docker-compose.yml")):
		app.Detail = "no está el repo shopify en " + repo + " (SHOPIFY_REPO)"
	case httpOK("http://localhost:"+shopifyAppPort+"/", 3*time.Second):
		app.OK, app.Detail = true, "app-qa contesta en :"+shopifyAppPort+" (Docker, contra qa)"
	default:
		app.Detail = "app-qa no contesta en :" + shopifyAppPort
	}

	tunnel := serverCheck{Name: "Túnel"}
	live, external := "", false
	if app.OK {
		live, external = liveTunnel(m, repo)
	}
	switch {
	case live != "" && external:
		tunnel.OK, tunnel.Detail = true, live+" (abierto en una terminal)"
		view.TunnelURL = live
	case live != "":
		tunnel.OK, tunnel.Detail = true, live
		view.TunnelURL = live
	case processAlive(m.TunnelPID):
		tunnel.Detail = "cloudflared corre, pero su dirección todavía no llega a la app"
	default:
		tunnel.Detail = "apagado"
	}

	store := serverCheck{Name: "Tienda"}
	switch {
	case live == "":
		store.Detail = shopifyStore + " necesita el túnel"
	case secretAppURL(repo) != live || extensionURL(repo) != live:
		store.Detail = "la app o la extensión apuntan a otra dirección"
	case m.PreviewForURL != live && !external:
		store.Detail = "falta subir la extensión a la tienda"
	default:
		store.OK, store.Detail = true, shopifyStore+" apunta a este túnel"
	}

	view.Checks = []serverCheck{app, tunnel, store}
	view.Ready = app.OK && tunnel.OK && store.OK

	shopifySrv.mu.Lock()
	view.Busy, view.Step, view.Error = shopifySrv.busy, shopifySrv.step, shopifySrv.err
	view.Log = append(view.Log, shopifySrv.log...)
	shopifySrv.mu.Unlock()
	return view
}

// ---- levantar ----------------------------------------------------------------------------------------------------

func runLogged(ctx context.Context, dir string, name string, args ...string) error {
	path, err := lookTool(name)
	if err != nil {
		return fmt.Errorf("no está %s en esta máquina", name)
	}
	cmd := exec.CommandContext(ctx, path, args...)
	cmd.Dir, cmd.Env = dir, toolEnv()
	out, err := cmd.CombinedOutput()
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		if line = strings.TrimSpace(line); line != "" {
			shopifySrv.logf("   %s", line)
		}
	}
	return err
}

var tunnelURL = regexp.MustCompile(`https://[a-z0-9-]+\.trycloudflare\.com`)

// Abre el túnel rápido de Cloudflare hacia app-qa, en su propio grupo de procesos, y espera su dirección.
func startTunnel(ctx context.Context) (shopifyMemory, error) {
	path, err := lookTool("cloudflared")
	if err != nil {
		return shopifyMemory{}, errors.New("no está cloudflared: brew install cloudflared")
	}
	_ = os.MkdirAll(filepath.Dir(memoryPath()), 0o700)
	logFile, err := os.Create(tunnelLogPath())
	if err != nil {
		return shopifyMemory{}, err
	}
	cmd := exec.Command(path, "tunnel", "--no-autoupdate", "--url", "http://localhost:"+shopifyAppPort)
	cmd.Stdout, cmd.Stderr, cmd.Env = logFile, logFile, toolEnv()
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := cmd.Start(); err != nil {
		logFile.Close()
		return shopifyMemory{}, err
	}
	pid := cmd.Process.Pid
	_ = cmd.Process.Release()
	logFile.Close()
	shopifySrv.logf("   cloudflared prendido (pid %d)", pid)

	deadline := time.Now().Add(60 * time.Second)
	for time.Now().Before(deadline) {
		if ctx.Err() != nil {
			return shopifyMemory{}, ctx.Err()
		}
		raw, _ := os.ReadFile(tunnelLogPath())
		if url := tunnelURL.Find(raw); url != nil {
			m := readMemory()
			m.TunnelPID, m.TunnelURL = pid, string(url)
			writeMemory(m)
			// Cloudflare tarda unos segundos en propagar la dirección nueva.
			for time.Now().Before(deadline) {
				if httpOK(m.TunnelURL+"/", 10*time.Second) {
					return m, nil
				}
				time.Sleep(2 * time.Second)
			}
			return m, fmt.Errorf("el túnel %s no llegó a la app en 60 s", m.TunnelURL)
		}
		if !processAlive(pid) {
			return shopifyMemory{}, errors.New("cloudflared se cerró: " + tailLog(raw))
		}
		time.Sleep(time.Second)
	}
	return shopifyMemory{}, errors.New("cloudflared no dio una dirección en 60 s")
}

func tailLog(raw []byte) string {
	lines := strings.Split(strings.TrimSpace(string(raw)), "\n")
	if len(lines) > 3 {
		lines = lines[len(lines)-3:]
	}
	return strings.Join(lines, " · ")
}

// `shopify app dev --no-update` sube la extensión como vista previa de la tienda de desarrollo. Es una TUI que no
// termina: se corre hasta que dice «Ready» y se corta; la vista previa queda.
func uploadPreview(ctx context.Context, repo string) error {
	path, err := lookTool("npx")
	if err != nil {
		return errors.New("no está npx")
	}
	ctx, cancel := context.WithTimeout(ctx, 4*time.Minute)
	defer cancel()
	cmd := exec.Command(path, "shopify", "app", "dev", "--config", shopifyConfig, "--store", shopifyStore, "--no-update")
	cmd.Dir, cmd.Env = repo, append(toolEnv(), "CI=1", "FORCE_COLOR=0")
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	out, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	cmd.Stderr = cmd.Stdout
	if err := cmd.Start(); err != nil {
		return err
	}
	stop := func() { _ = syscall.Kill(-cmd.Process.Pid, syscall.SIGINT) }
	defer func() {
		stop()
		done := make(chan struct{})
		go func() { _ = cmd.Wait(); close(done) }()
		select {
		case <-done:
		case <-time.After(15 * time.Second):
			_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
		}
	}()

	ready := make(chan error, 1)
	go func() {
		accepted := false
		scanner := bufio.NewScanner(out)
		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			if line == "" {
				continue
			}
			shopifySrv.logf("   %s", line)
			if strings.Contains(line, "Configuration accepted") {
				accepted = true
			}
			if strings.Contains(line, "Ready, watching for changes") || (accepted && strings.Contains(line, "Using URL")) {
				ready <- nil
				return
			}
		}
		ready <- errors.New("shopify app dev terminó sin decir «Ready»: corre el comando de abajo en una terminal")
	}()
	select {
	case err := <-ready:
		return err
	case <-ctx.Done():
		return errors.New("shopify app dev no terminó en 4 min")
	}
}

func (s *shopifyServer) up() {
	defer func() {
		s.mu.Lock()
		s.busy, s.step = false, ""
		s.mu.Unlock()
	}()
	ctx := context.Background()
	repo := shopifyRepo()
	docker := filepath.Join(repo, "docker")
	fail := func(err error) {
		s.mu.Lock()
		s.err = err.Error()
		s.mu.Unlock()
		s.logf("✗ %s", err)
	}

	if !fileExists(filepath.Join(docker, "docker-compose.yml")) {
		fail(fmt.Errorf("no está el repo shopify en %s", repo))
		return
	}
	if !httpOK("http://localhost:"+shopifyAppPort+"/", 3*time.Second) {
		s.setStep("Prendiendo la app (docker compose up -d)")
		if err := runLogged(ctx, docker, "docker", "compose", "up", "-d"); err != nil {
			fail(fmt.Errorf("docker compose up falló: %w", err))
			return
		}
		for i := 0; i < 40 && !httpOK("http://localhost:"+shopifyAppPort+"/", 3*time.Second); i++ {
			time.Sleep(3 * time.Second)
		}
		if !httpOK("http://localhost:"+shopifyAppPort+"/", 3*time.Second) {
			fail(errors.New("app-qa no contesta: docker compose logs app-qa"))
			return
		}
	}
	s.logf("✓ la app contesta en :%s", shopifyAppPort)

	m := readMemory()
	url, external := liveTunnel(m, repo)
	if url == "" {
		if processAlive(m.TunnelPID) {
			_ = syscall.Kill(-m.TunnelPID, syscall.SIGTERM)
		}
		s.setStep("Abriendo el túnel (cloudflared)")
		var err error
		if m, err = startTunnel(ctx); err != nil {
			fail(err)
			return
		}
		url = m.TunnelURL
	}
	s.logf("✓ túnel %s", url)

	if secretAppURL(repo) != url || extensionURL(repo) != url {
		s.setStep("Apuntando la app al túnel (usar-tunel.sh)")
		if err := runLogged(ctx, docker, "sh", "usar-tunel.sh", url, "--sin-dev"); err != nil {
			fail(fmt.Errorf("usar-tunel.sh falló: %w", err))
			return
		}
	}
	// Un túnel abierto en una terminal ya pasó por usar-tunel.sh, que sube la extensión.
	if readMemory().PreviewForURL != url && !external {
		s.setStep("Subiendo la extensión a la tienda (shopify app dev)")
		if err := uploadPreview(ctx, repo); err != nil {
			fail(fmt.Errorf("%w · npx shopify app dev --config %s --store %s --no-update", err, shopifyConfig, shopifyStore))
			return
		}
		m = readMemory()
		m.PreviewForURL = url
		writeMemory(m)
	}
	s.logf("✓ listo: %s apunta a %s", shopifyStore, url)
}

func (s *shopifyServer) down() {
	m := readMemory()
	if url, external := liveTunnel(m, shopifyRepo()); external {
		s.logf("el túnel %s se abrió en una terminal: ciérralo ahí (Ctrl-C)", url)
		return
	}
	if processAlive(m.TunnelPID) {
		_ = syscall.Kill(-m.TunnelPID, syscall.SIGTERM)
		s.logf("túnel apagado (pid %d)", m.TunnelPID)
	} else {
		s.logf("no había túnel prendido")
	}
	m.TunnelPID, m.TunnelURL = 0, ""
	writeMemory(m)
}

func serverHandlers(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/servers", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"servers": []serverView{shopifyStatus()}})
	})
	mux.HandleFunc("POST /api/servers/shopify/up", func(w http.ResponseWriter, r *http.Request) {
		shopifySrv.mu.Lock()
		if shopifySrv.busy {
			shopifySrv.mu.Unlock()
			writeJSON(w, http.StatusConflict, map[string]string{"error": "ya se está levantando"})
			return
		}
		shopifySrv.busy, shopifySrv.err, shopifySrv.log, shopifySrv.since = true, "", nil, time.Now()
		shopifySrv.mu.Unlock()
		go shopifySrv.up()
		writeJSON(w, http.StatusAccepted, map[string]bool{"started": true})
	})
	mux.HandleFunc("POST /api/servers/shopify/down", func(w http.ResponseWriter, r *http.Request) {
		shopifySrv.mu.Lock()
		busy := shopifySrv.busy
		shopifySrv.mu.Unlock()
		if busy {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "se está levantando: espera a que termine"})
			return
		}
		shopifySrv.down()
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	})
}
