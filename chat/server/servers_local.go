package main

// ECOMMERCE · LOCAL: todo el recorrido de una compra de tienda en esta máquina, sin qa ni túneles, para probar un
// cambio de ecommerce ANTES de abrir un PR (la cancelación de la tarea #112, un cambio en payment-link, el wizard).
// Cinco piezas, cada una con su chequeo; «Levantar» prende sólo lo que falta, en orden:
//
//   1. legacy-backend local (sail, :80): la rama que tengas en el repo; escribe en TU base local.
//   2. el wizard local (:5174) contra ese backend (`make harness-wizard TARGET=local`).
//   3. el conector VTEX real fuera de VTEX IO (:8114, `yarn --cwd node local` en el repo vtex), apuntado al backend
//      local: authorize, settle y cancel van a `http://localhost/api`.
//   4. la app de Shopify `app-local` (:8120, el docker del repo shopify, secreto `local.json`).
//   5. la tienda demo del harness (:8113): hace de VTEX y de Shopify y les manda lo que mandaría cada plataforma.
//
// Nada sale de la máquina y nada toca la base compartida: «local» a propósito, para no confundirlo con el dev real.
// El conector corre en su propio grupo de procesos y sobrevive al chat; «Apagar» lo cierra. Lo demás (Docker, el
// wizard, la tienda) tiene su propio ciclo y se apaga con sus comandos.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
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
	localBackendProbe   = "http://localhost/api/ecommerce/status/probe" // 401 sin token: el backend contesta
	localWizardURL      = "http://localhost:5174"
	localConnectorPort  = "8114"
	localShopifyAppPort = "8120"
	localStorePort      = "8113"
)

var localSrv shopifyServer

func githubDir(name, env string) string {
	if dir := os.Getenv(env); dir != "" {
		return dir
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, "Desktop", "CREDITOP", "github", name)
}

func playgroundDir() string {
	if dir := os.Getenv("PLAYGROUND_DIR"); dir != "" {
		return dir
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, "Desktop", "CREDITOP", "playground")
}

func localPidPath() string {
	return filepath.Join(filepath.Dir(memoryPath()), "ecommerce-local-connector.pid")
}
func localConnectorLog() string {
	return filepath.Join(filepath.Dir(memoryPath()), "ecommerce-local-connector.log")
}

// Contesta (cualquier código HTTP): para el backend, un 401 sin token ya dice que está arriba.
func httpAnswers(url string, timeout time.Duration) bool {
	client := &http.Client{Timeout: timeout, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	res, err := client.Get(url)
	if err != nil {
		return false
	}
	res.Body.Close()
	return res.StatusCode > 0 && res.StatusCode < 500
}

type localPiece struct {
	name   string
	how    string
	ok     func() bool
	okText string
	off    string
	up     func(ctx context.Context) error
}

func localPieces() []localPiece {
	backend := githubDir("legacy-backend", "LEGACY_BACKEND_REPO")
	vtex := githubDir("vtex", "VTEX_REPO")
	shopifyDocker := filepath.Join(shopifyRepo(), "docker")
	harness := filepath.Join(playgroundDir(), "harness")
	return []localPiece{
		{
			name: "Backend local", how: "vendor/bin/sail up -d en legacy-backend (la rama que tengas)", okText: "legacy-backend contesta en :80 (sail, tu base local)",
			off: "no contesta en :80", ok: func() bool { return httpAnswers(localBackendProbe, 3*time.Second) },
			up: func(ctx context.Context) error {
				if !fileExists(filepath.Join(backend, "vendor", "bin", "sail")) {
					return fmt.Errorf("no está legacy-backend con sail en %s (LEGACY_BACKEND_REPO)", backend)
				}
				return localSrv.run(ctx, backend, nil, "sh", "vendor/bin/sail", "up", "-d")
			},
		},
		{
			name: "Wizard local", how: "make harness-wizard TARGET=local", okText: "contesta en :5174",
			off: "no contesta en :5174", ok: func() bool { return httpAnswers(localWizardURL, 3*time.Second) },
			up: func(ctx context.Context) error {
				return localSrv.run(ctx, playgroundDir(), nil, "make", "-s", "harness-wizard", "TARGET=local")
			},
		},
		{
			name: "Conector VTEX", how: "yarn --cwd node local en el repo vtex, con CREDITOP_API_URL=http://localhost/api", okText: "el conector real contesta en :" + localConnectorPort + ", contra el backend local",
			off: "apagado", ok: func() bool { return httpOK("http://localhost:"+localConnectorPort+"/health", 2*time.Second) },
			up: func(ctx context.Context) error { return startLocalConnector(vtex) },
		},
		{
			name: "App de Shopify", how: "docker compose up -d app-local en el repo shopify", okText: "app-local contesta en :" + localShopifyAppPort + ", contra el backend local",
			off: "app-local no contesta en :" + localShopifyAppPort,
			ok:  func() bool { return httpOK("http://localhost:"+localShopifyAppPort+"/", 3*time.Second) },
			up: func(ctx context.Context) error {
				if !fileExists(filepath.Join(shopifyDocker, "secrets", "local.json")) {
					return errors.New("falta docker/secrets/local.json en el repo shopify (copiá local.example.json)")
				}
				return localSrv.run(ctx, shopifyDocker, nil, "docker", "compose", "up", "-d", "app-local")
			},
		},
		{
			name: "Token de la sucursal", how: "php artisan ecommerce:issue-token " + localBranch() + " en tu base local (LOCAL_ECOMMERCE_BRANCH); se guarda en la caché del chat, sin mostrarlo",
			okText: "la sucursal " + localBranch() + " tiene un token de payment-link que el backend acepta",
			off:    "falta el token de payment-link de " + localBranch(), ok: localTokenOK,
			up: func(ctx context.Context) error { return issueLocalToken(ctx, backend) },
		},
		{
			name: "Túnel de la tienda", how: "cloudflared hacia :" + localStorePort + ": payment-link exige https en la vuelta y en el aviso; queda prendido aunque cierres el chat",
			okText: "", off: "apagado", ok: func() bool { return localTunnelURL() != "" },
			up: func(ctx context.Context) error { return startLocalTunnel(ctx) },
		},
		{
			name: "Tienda demo", how: "bin/mock-payment-link start del harness, con el conector y la app locales", okText: "http://localhost:" + localStorePort + "/ (VTEX y Shopify, con los plugins reales)",
			off: "apagada, o prendida contra otra cosa", ok: localStoreOK,
			up: func(ctx context.Context) error {
				// La dirección del túnel se lee ANTES de apagar la tienda: con la tienda apagada el túnel no contesta.
				tunnel := localTunnelURL()
				if tunnel == "" {
					return errors.New("el túnel de la tienda no contesta")
				}
				// Corre con otra configuración (en modo qa, o sin el token o los plugins locales): se reinicia con ésta.
				if httpOK("http://localhost:"+localStorePort+"/health", 2*time.Second) {
					if err := localSrv.run(ctx, harness, nil, "sh", "bin/mock-payment-link", "stop"); err != nil {
						return err
					}
				}
				return localSrv.run(ctx, harness, []string{"MOCK_PAYMENT_LINK_PUBLIC=" + tunnel, "STORE_TOKENS=" + localTokensPath(), "SHOPIFY_APP_LOCAL_URL=http://localhost:" + localShopifyAppPort,
					"VTEX_CONNECTOR_URL=http://localhost:" + localConnectorPort}, "sh", "bin/mock-payment-link", "start")
			},
		},
	}
}

// La tienda sirve para esto sólo si está en modo local y habla con el conector y la app de Shopify locales: la misma
// tienda corre también en modo qa (con un túnel), y ahí la compra iría a qa.
func localStoreOK() bool {
	client := &http.Client{Timeout: 4 * time.Second}
	res, err := client.Get("http://localhost:" + localStorePort + "/api/config")
	if err != nil {
		return false
	}
	defer res.Body.Close()
	var cfg struct {
		Mode         string            `json:"mode"`
		Plugins      map[string]string `json:"plugins"`
		BranchTokens []string          `json:"branch_tokens"`
		FromBackend  string            `json:"from_backend"`
	}
	if json.NewDecoder(res.Body).Decode(&cfg) != nil {
		return false
	}
	hasToken := false
	for _, h := range cfg.BranchTokens {
		hasToken = hasToken || h == localBranch()
	}
	return cfg.Mode == "local" && hasToken && cfg.FromBackend != "" && cfg.FromBackend == localTunnelURL() && strings.Contains(cfg.Plugins["vtex"], ":"+localConnectorPort) &&
		strings.Contains(cfg.Plugins["shopify"], ":"+localShopifyAppPort)
}

func localTunnelPath() string {
	return filepath.Join(filepath.Dir(memoryPath()), "ecommerce-local-tunnel.json")
}

// La dirección del túnel hacia la tienda, si cloudflared sigue vivo y la dirección llega.
func localTunnelURL() string {
	var m shopifyMemory
	if raw, err := os.ReadFile(localTunnelPath()); err == nil {
		_ = json.Unmarshal(raw, &m)
	}
	if m.TunnelURL != "" && processAlive(m.TunnelPID) && httpOK(m.TunnelURL+"/health", 8*time.Second) {
		return m.TunnelURL
	}
	return ""
}

// Un túnel rápido de Cloudflare hacia la tienda, como el de Shopify (HTTP/2 por la VPN, conexiones cortas).
func startLocalTunnel(ctx context.Context) error {
	path, err := lookTool("cloudflared")
	if err != nil {
		return errors.New("no está cloudflared: brew install cloudflared")
	}
	logPath := filepath.Join(filepath.Dir(memoryPath()), "ecommerce-local-tunnel.log")
	_ = os.MkdirAll(filepath.Dir(logPath), 0o700)
	logFile, err := os.Create(logPath)
	if err != nil {
		return err
	}
	args := []string{"tunnel", "--no-autoupdate", "--protocol", "http2", "--proxy-keepalive-timeout", "4s", "--url", "http://localhost:" + localStorePort}
	localSrv.logf("$ cloudflared %s", strings.Join(args, " "))
	cmd := exec.Command(path, args...)
	cmd.Stdout, cmd.Stderr, cmd.Env = logFile, logFile, toolEnv()
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := cmd.Start(); err != nil {
		logFile.Close()
		return err
	}
	pid := cmd.Process.Pid
	_ = cmd.Process.Release()
	logFile.Close()
	// La tienda tiene que estar prendida para que el túnel llegue: si no, se prende sin túnel y se reinicia después.
	if !httpOK("http://localhost:"+localStorePort+"/health", 2*time.Second) {
		_ = localSrv.run(ctx, filepath.Join(playgroundDir(), "harness"), nil, "sh", "bin/mock-payment-link", "start")
	}
	for deadline := time.Now().Add(150 * time.Second); time.Now().Before(deadline); time.Sleep(2 * time.Second) {
		raw, _ := os.ReadFile(logPath)
		if url := tunnelURL.Find(raw); url != nil {
			m := shopifyMemory{TunnelPID: pid, TunnelURL: string(url)}
			b, _ := json.Marshal(m)
			_ = os.WriteFile(localTunnelPath(), b, 0o600)
			localSrv.logf("  esperando a que %s llegue a la tienda…", url)
			for time.Now().Before(deadline) {
				if httpOK(string(url)+"/health", 8*time.Second) {
					return nil
				}
				time.Sleep(2 * time.Second)
			}
			return fmt.Errorf("el túnel %s sigue sin llegar a la tienda", url)
		}
		if !processAlive(pid) {
			return errors.New("cloudflared se cerró: " + tailLog(raw))
		}
	}
	return errors.New("cloudflared no dio una dirección en 150 s")
}

// La sucursal de tu base local con la que compra la tienda (una VTEX con credencial de ecommerce).
func localBranch() string {
	if h := os.Getenv("LOCAL_ECOMMERCE_BRANCH"); h != "" {
		return h
	}
	return "69364350" // «PRUEBA AUTO · Mario Hernández · Tienda VTEX» en la base local
}

func localTokensPath() string {
	return filepath.Join(filepath.Dir(memoryPath()), "ecommerce-local-tokens.json")
}

func readLocalTokens() map[string]string {
	tokens := map[string]string{}
	if raw, err := os.ReadFile(localTokensPath()); err == nil {
		_ = json.Unmarshal(raw, &tokens)
	}
	return tokens
}

// El token sirve si el backend local lo acepta: con él, `status` de un pedido inexistente da 404 y no 401.
func localTokenOK() bool {
	token := readLocalTokens()[localBranch()]
	if token == "" {
		return false
	}
	req, _ := http.NewRequest(http.MethodGet, localBackendProbe, nil)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	res, err := (&http.Client{Timeout: 4 * time.Second}).Do(req)
	if err != nil {
		return false
	}
	res.Body.Close()
	return res.StatusCode != http.StatusUnauthorized && res.StatusCode != http.StatusForbidden && res.StatusCode < 500
}

var sanctumToken = regexp.MustCompile(`(?m)^\s*(\d+\|[A-Za-z0-9]{20,})\s*$`)

// Emite el token en la base LOCAL. La salida del comando no va a la consola: trae el token.
func issueLocalToken(ctx context.Context, backend string) error {
	sh, err := lookTool("sh")
	if err != nil {
		return err
	}
	localSrv.logf("$ sh vendor/bin/sail artisan ecommerce:issue-token %s   (la salida no se muestra: trae el token)", localBranch())
	cmd := exec.CommandContext(ctx, sh, "vendor/bin/sail", "artisan", "ecommerce:issue-token", localBranch())
	cmd.Dir, cmd.Env = backend, toolEnv()
	out, err := cmd.CombinedOutput()
	m := sanctumToken.FindSubmatch(out)
	if err != nil || m == nil {
		lines := strings.Split(strings.TrimSpace(string(out)), "\n")
		return fmt.Errorf("no salió el token: %s", sanctumToken.ReplaceAllString(lines[len(lines)-1], "<token>"))
	}
	tokens := readLocalTokens()
	tokens[localBranch()] = string(m[1])
	raw, _ := json.MarshalIndent(tokens, "", "  ")
	_ = os.MkdirAll(filepath.Dir(localTokensPath()), 0o700)
	if err := os.WriteFile(localTokensPath(), raw, 0o600); err != nil {
		return err
	}
	// La tienda lee los tokens al arrancar: si ya corría, se reinicia con el nuevo.
	if httpOK("http://localhost:"+localStorePort+"/health", 2*time.Second) {
		_ = localSrv.run(ctx, filepath.Join(playgroundDir(), "harness"), nil, "sh", "bin/mock-payment-link", "stop")
	}
	return nil
}

// El conector VTEX real (`yarn --cwd node local`), en su propio grupo de procesos, apuntado al backend local.
func startLocalConnector(repo string) error {
	if !fileExists(filepath.Join(repo, "local", "server.js")) {
		return fmt.Errorf("no está el repo vtex en %s (VTEX_REPO)", repo)
	}
	path, err := lookTool("yarn")
	if err != nil {
		return errors.New("no está yarn")
	}
	_ = os.MkdirAll(filepath.Dir(localPidPath()), 0o700)
	logFile, err := os.Create(localConnectorLog())
	if err != nil {
		return err
	}
	defer logFile.Close()
	localSrv.logf("$ yarn --cwd node local   (CREDITOP_API_URL=http://localhost/api, en %s)", repo)
	cmd := exec.Command(path, "--cwd", "node", "local")
	cmd.Dir = repo
	cmd.Env = append(toolEnv(), "CREDITOP_API_URL=http://localhost/api", "VTEX_LOCAL_PORT="+localConnectorPort, "CREDITOP_ENVIRONMENT=develop")
	cmd.Stdout, cmd.Stderr = logFile, logFile
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := cmd.Start(); err != nil {
		return err
	}
	pid := cmd.Process.Pid
	_ = cmd.Process.Release()
	_ = os.WriteFile(localPidPath(), []byte(strconv.Itoa(pid)), 0o600)
	for i := 0; i < 60; i++ { // compila con tsc antes de escuchar
		if httpOK("http://localhost:"+localConnectorPort+"/health", 2*time.Second) {
			return nil
		}
		if !processAlive(pid) {
			raw, _ := os.ReadFile(localConnectorLog())
			return errors.New("el conector se cerró: " + tailLog(raw))
		}
		time.Sleep(time.Second)
	}
	return errors.New("el conector no contestó en 60 s: " + localConnectorLog())
}

func localStatus() serverView {
	view := serverView{ID: "ecommerce-local", Name: "Ecommerce · local", Log: []string{}}
	ready := true
	for _, p := range localPieces() {
		c := serverCheck{Name: p.name, How: p.how}
		if p.ok() {
			c.OK, c.Detail = true, p.okText
			if c.Detail == "" {
				c.Detail = localTunnelURL()
			}
		} else {
			c.Detail, ready = p.off, false
		}
		view.Checks = append(view.Checks, c)
	}
	view.Ready = ready
	raw, _ := os.ReadFile(localPidPath())
	pid, _ := strconv.Atoi(strings.TrimSpace(string(raw)))
	view.DownLabel, view.CanDown = "Apagar conector y túnel", processAlive(pid) || localTunnelURL() != ""
	localSrv.mu.Lock()
	view.Busy, view.Step, view.Error = localSrv.busy, localSrv.step, localSrv.err
	view.Log = append(view.Log, localSrv.log...)
	localSrv.mu.Unlock()
	return view
}

func (s *shopifyServer) upLocal() {
	defer func() {
		s.mu.Lock()
		s.busy, s.step = false, ""
		s.mu.Unlock()
	}()
	ctx := context.Background()
	for _, p := range localPieces() {
		if p.ok() {
			s.logf("✓ %s: %s", p.name, p.okText)
			continue
		}
		s.setStep("Prendiendo: " + p.name)
		if err := p.up(ctx); err != nil {
			s.mu.Lock()
			s.err = fmt.Sprintf("%s: %s", p.name, err)
			s.mu.Unlock()
			s.logf("✗ %s: %s", p.name, err)
			return
		}
		for i := 0; i < 40 && !p.ok(); i++ {
			time.Sleep(3 * time.Second)
		}
		if !p.ok() {
			s.mu.Lock()
			s.err = p.name + " no quedó arriba: " + p.off
			s.mu.Unlock()
			s.logf("✗ %s no quedó arriba", p.name)
			return
		}
		s.logf("✓ %s: %s", p.name, p.okText)
	}
	s.logf("✓ listo: la tienda en http://localhost:%s/ compra contra tu backend local", localStorePort)
}

// Apaga lo que prendió el chat (el conector). Docker, el wizard y la tienda siguen: tienen su propio ciclo.
func (s *shopifyServer) downLocal() {
	raw, _ := os.ReadFile(localPidPath())
	pid, _ := strconv.Atoi(strings.TrimSpace(string(raw)))
	if processAlive(pid) {
		_ = syscall.Kill(-pid, syscall.SIGTERM)
		s.logf("conector VTEX apagado (pid %d)", pid)
	} else {
		s.logf("el conector no lo prendió el chat (o ya estaba apagado)")
	}
	_ = os.Remove(localPidPath())
	var m shopifyMemory
	if raw, err := os.ReadFile(localTunnelPath()); err == nil {
		_ = json.Unmarshal(raw, &m)
	}
	if processAlive(m.TunnelPID) {
		_ = syscall.Kill(-m.TunnelPID, syscall.SIGTERM)
		s.logf("túnel de la tienda apagado (pid %d)", m.TunnelPID)
	}
	_ = os.Remove(localTunnelPath())
	s.logf("el backend (sail down), el wizard y la tienda (bin/mock-payment-link stop) se apagan con sus comandos")
}

func localHandlers(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/servers/ecommerce-local/up", func(w http.ResponseWriter, r *http.Request) {
		localSrv.mu.Lock()
		if localSrv.busy {
			localSrv.mu.Unlock()
			writeJSON(w, http.StatusConflict, map[string]string{"error": "ya se está levantando"})
			return
		}
		localSrv.busy, localSrv.err, localSrv.log, localSrv.since = true, "", nil, time.Now()
		localSrv.mu.Unlock()
		go localSrv.upLocal()
		writeJSON(w, http.StatusAccepted, map[string]bool{"started": true})
	})
	mux.HandleFunc("POST /api/servers/ecommerce-local/down", func(w http.ResponseWriter, r *http.Request) {
		localSrv.mu.Lock()
		busy := localSrv.busy
		localSrv.mu.Unlock()
		if busy {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "se está levantando: espera a que termine"})
			return
		}
		localSrv.downLocal()
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	})
}
