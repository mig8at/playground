package main

/* Las tiendas de prueba listas para comprar, desde la interfaz: un botón levanta lo que en la consola eran comandos
 * (`shopify app dev` + apuntar la extensión al túnel nuevo, y `vtex link`) y un semáforo dice si todo está al día.
 *
 * Cada chequeo mide lo que importa para comprar, no si un proceso existe: en Shopify, que la extensión de pagos
 * apunte a un túnel que CONTESTA (un túnel viejo es el «There was an issue processing your payment»); en VTEX, que
 * la sesión sea de la cuenta creditop en el workspace de desarrollo y que el conector conteste en él.
 *
 * Lo que levanta este servidor lo puede parar. Lo que corre en otra terminal se detecta y se respeta: no se mata ni
 * se levanta otro encima (dos `shopify app dev` se pisan la URL de la app). Los procesos van en su propio grupo y se
 * paran por ese grupo, nunca por un patrón. VTEX nunca se linkea fuera de `migueldev`: `master` es producción. */

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"syscall"
	"time"
)

const (
	vtexAccount   = "creditop"
	vtexWorkspace = "migueldev"
	vtexManifest  = "https://migueldev--creditop.myvtex.com/_v/creditop.creditop/v4/manifest"
	// La firma del proceso de cada tienda, para reconocerlo si lo levantó otra terminal (sólo se lee con pgrep).
	shopifySignature = "shopify app dev --config shopify.app.creditop-ecommerce-payments-local.toml"
	vtexSignature    = "vtex link"
	logLines         = 200
)

var (
	tunnelRe     = regexp.MustCompile(`https://[a-z0-9-]+\.trycloudflare\.com`)
	extensionRe  = regexp.MustCompile(`(?m)^payment_session_url = "(https://[^/"]+)`)
	whoamiRe     = regexp.MustCompile(`Logged into (\S+) as \S+ at \S+ workspace (\S+)`)
	ansiRe       = regexp.MustCompile(`\x1b\[[0-9;?]*[a-zA-Z]`)
	storeProcs   = map[string]*storeProc{}
	storeProcsMu sync.Mutex
)

// storeProc es un proceso de tienda levantado por este servidor, con lo último que imprimió.
type storeProc struct {
	mu      sync.Mutex
	cmd     *exec.Cmd
	started time.Time
	lines   []string
	tunnel  string
	since   time.Time // cuándo apareció el túnel
	linked  bool // VTEX terminó de compilar lo que subió `vtex link` (la salida se recorta, el dato no)
	exited  string
}

func (p *storeProc) log(line string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.lines = append(p.lines, line)
	if len(p.lines) > logLines {
		p.lines = p.lines[len(p.lines)-logLines:]
	}
}

func (p *storeProc) running() bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.exited == ""
}

// Check es un chequeo del semáforo.
type Check struct {
	Name   string `json:"name"`
	OK     bool   `json:"ok"`
	Detail string `json:"detail"`
}

// StoreStatus es el estado de una tienda: verde si todos los chequeos dan.
type StoreStatus struct {
	Store    string   `json:"store"`
	Ready    bool     `json:"ready"`
	Checks   []Check  `json:"checks"`
	Managed  bool     `json:"managed"`  // lo levantó tests y lo puede parar
	External bool     `json:"external"` // corre en otra terminal
	Started  string   `json:"started,omitempty"`
	Exited   string   `json:"exited,omitempty"`
	Log      []string `json:"log"`
}

func githubRepo(name string) string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, "Desktop", "CREDITOP", "github", name)
}

func shopifyExtensionFile() string {
	return filepath.Join(githubRepo("shopify"), "extensions", "creditop-offsite", "shopify.extension.toml")
}

// extensionBase es el origen al que la extensión de pagos manda la sesión, o "" si no se pudo leer.
func extensionBase() string {
	raw, err := os.ReadFile(shopifyExtensionFile())
	if err != nil {
		return ""
	}
	if m := extensionRe.FindSubmatch(raw); m != nil {
		return string(m[1])
	}
	return ""
}

// runningElsewhere dice si hay un proceso con esa firma que no es el de este servidor.
func runningElsewhere(signature string, own *storeProc) bool {
	out, err := exec.Command("pgrep", "-f", signature).Output()
	if err != nil {
		return false
	}
	ownPid := 0
	if own != nil && own.running() && own.cmd.Process != nil {
		ownPid = own.cmd.Process.Pid
	}
	for _, f := range strings.Fields(string(out)) {
		var pid int
		fmt.Sscan(f, &pid)
		if pid == os.Getpid() || pid == ownPid || (ownPid > 0 && sameGroup(pid, ownPid)) {
			continue
		}
		return true
	}
	return false
}

func sameGroup(pid, leader int) bool {
	g, err := syscall.Getpgid(pid)
	return err == nil && g == leader
}

// reachable dice si el origen contesta algo que no sea un error del túnel o del servidor.
func reachable(url string) (bool, string) {
	client := &http.Client{Timeout: 6 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	res, err := client.Get(url)
	if err != nil {
		return false, "no contesta"
	}
	_, _ = io.Copy(io.Discard, io.LimitReader(res.Body, 4096))
	res.Body.Close()
	return res.StatusCode < 500, fmt.Sprintf("HTTP %d", res.StatusCode)
}

func vtexWhoami() (account, workspace string) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	out, _ := exec.CommandContext(ctx, "vtex", "whoami").CombinedOutput()
	if m := whoamiRe.FindStringSubmatch(ansiRe.ReplaceAllString(string(out), "")); m != nil {
		return m[1], m[2]
	}
	return "", ""
}

func (p *storeProc) isLinked() bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.linked
}

func procOf(store string) *storeProc {
	storeProcsMu.Lock()
	defer storeProcsMu.Unlock()
	return storeProcs[store]
}

// StoreState mide una tienda ("shopify" o "vtex").
func StoreState(store string) (*StoreStatus, error) {
	p := procOf(store)
	st := &StoreStatus{Store: store, Log: []string{}}
	if p != nil {
		p.mu.Lock()
		st.Managed = p.exited == ""
		st.Started = p.started.Format("15:04:05")
		st.Exited = p.exited
		st.Log = append(st.Log, p.lines...)
		p.mu.Unlock()
	}
	switch store {
	case "shopify":
		st.External = runningElsewhere(shopifySignature, p)
		running := st.Managed || st.External
		st.Checks = append(st.Checks, Check{Name: "La app de pagos corre", OK: running, Detail: map[bool]string{true: "shopify app dev", false: "apagada"}[running]})
		base := extensionBase()
		tunnel := ""
		if p != nil && st.Managed {
			p.mu.Lock()
			tunnel = p.tunnel
			p.mu.Unlock()
		}
		switch {
		case base == "":
			st.Checks = append(st.Checks, Check{Name: "La extensión apunta al túnel", Detail: "no se pudo leer la extensión"})
		case st.Managed && tunnel == "":
			st.Checks = append(st.Checks, Check{Name: "La extensión apunta al túnel", Detail: "esperando el túnel nuevo"})
		case tunnel != "":
			st.Checks = append(st.Checks, Check{Name: "La extensión apunta al túnel", OK: base == tunnel, Detail: strings.TrimPrefix(base, "https://")})
		default:
			// Levantada en otra terminal: el túnel no se conoce, así que vale que el de la extensión conteste.
			st.Checks = append(st.Checks, Check{Name: "La extensión apunta al túnel", OK: running, Detail: strings.TrimPrefix(base, "https://")})
		}
		ok, detail := false, "sin URL"
		if base != "" {
			ok, detail = reachable(base + "/payments/session")
		}
		// Un túnel recién abierto da 530 unos segundos; si sigue así pasado un minuto, cloudflared no lo registró y no
		// se arregla esperando (medido el 2026-10-28: el siguiente arranque contestó a los 25 s).
		if !ok && p != nil && st.Managed && tunnel != "" && base == tunnel {
			p.mu.Lock()
			stuck := time.Since(p.since) > time.Minute
			p.mu.Unlock()
			if stuck {
				detail += " · el túnel no conectó: Parar y Levantar de nuevo"
			}
		}
		st.Checks = append(st.Checks, Check{Name: "El túnel de la extensión contesta", OK: ok && running, Detail: detail})
	case "vtex":
		account, workspace := vtexWhoami()
		session := account == vtexAccount && workspace == vtexWorkspace
		detail := "sin sesión"
		if account != "" {
			detail = account + " · " + workspace
		}
		st.Checks = append(st.Checks, Check{Name: "Sesión en " + vtexAccount + " · " + vtexWorkspace, OK: session, Detail: detail})
		st.External = runningElsewhere(vtexSignature, p)
		running := st.Managed || st.External
		linked, linkDetail := running, map[bool]string{true: "vtex link", false: "vtex link no corre"}[running]
		// Levantado desde acá, el link está al día recién cuando VTEX termina de compilar lo que se subió: antes, el
		// workspace sigue sirviendo la versión anterior.
		if st.Managed && !p.isLinked() {
			linked, linkDetail = false, "compilando en VTEX…"
		}
		st.Checks = append(st.Checks, Check{Name: "El conector está linkeado", OK: linked, Detail: linkDetail})
		ok, d := reachable(vtexManifest)
		st.Checks = append(st.Checks, Check{Name: "El conector contesta en " + vtexWorkspace, OK: ok, Detail: d})
	default:
		return nil, fmt.Errorf("tienda desconocida %q", store)
	}
	st.Ready = true
	for _, c := range st.Checks {
		st.Ready = st.Ready && c.OK
	}
	return st, nil
}

// StartStore levanta la tienda en segundo plano. Se niega si ya corre (acá o en otra terminal).
func StartStore(store string) error {
	if p := procOf(store); p != nil && p.running() {
		return fmt.Errorf("ya está corriendo desde tests")
	}
	var cmd *exec.Cmd
	switch store {
	case "shopify":
		if runningElsewhere(shopifySignature, nil) {
			return fmt.Errorf("shopify app dev ya corre en otra terminal: cerralo ahí (Ctrl+C) para levantarlo desde acá")
		}
		cmd = exec.Command("npx", "--yes", "shopify", "app", "dev",
			"--config", "shopify.app.creditop-ecommerce-payments-local.toml", "--store", "creditop-dev-store.myshopify.com")
		cmd.Dir = githubRepo("shopify")
		cmd.Env = append(os.Environ(), "CREDITOP_LOCAL=1", "CREDITOP_ENVIRONMENT=develop")
	case "vtex":
		if runningElsewhere(vtexSignature, nil) {
			return fmt.Errorf("vtex link ya corre en otra terminal: cerralo ahí (Ctrl+C) para levantarlo desde acá")
		}
		// Nunca fuera del workspace de desarrollo: linkear en master cambia la tienda real.
		if account, workspace := vtexWhoami(); account != vtexAccount || workspace != vtexWorkspace {
			return fmt.Errorf("la sesión de VTEX es %q · %q y tiene que ser %s · %s: en una terminal, `vtex login %s` (abre el navegador) y `vtex use %s`",
				account, workspace, vtexAccount, vtexWorkspace, vtexAccount, vtexWorkspace)
		}
		cmd = exec.Command("vtex", "link")
		cmd.Dir = githubRepo("vtex")
	default:
		return fmt.Errorf("tienda desconocida %q", store)
	}
	cmd.Stdin = nil
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	out, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	cmd.Stderr = cmd.Stdout
	p := &storeProc{cmd: cmd, started: time.Now()}
	if err := cmd.Start(); err != nil {
		return err
	}
	storeProcsMu.Lock()
	storeProcs[store] = p
	storeProcsMu.Unlock()
	go p.read(store, out)
	return nil
}

// read guarda la salida y, en Shopify, apunta la extensión al túnel apenas aparece.
func (p *storeProc) read(store string, out io.Reader) {
	sc := bufio.NewScanner(out)
	sc.Buffer(make([]byte, 64*1024), 1024*1024)
	for sc.Scan() {
		line := strings.TrimRight(ansiRe.ReplaceAllString(sc.Text(), ""), " ")
		if strings.TrimSpace(line) == "" {
			continue
		}
		p.log(line)
		if store == "vtex" && strings.Contains(line, "App linked successfully") {
			p.mu.Lock()
			p.linked = true
			p.mu.Unlock()
		}
		if store != "shopify" {
			continue
		}
		if t := tunnelRe.FindString(line); t != "" {
			p.mu.Lock()
			fresh := p.tunnel != t
			p.tunnel = t
			if fresh {
				p.since = time.Now()
			}
			p.mu.Unlock()
			if fresh && extensionBase() != t {
				p.pointExtension(t)
			}
		}
	}
	err := p.cmd.Wait()
	p.mu.Lock()
	p.exited = time.Now().Format("15:04:05")
	if err != nil {
		p.exited += " · " + err.Error()
	}
	p.mu.Unlock()
}

// pointExtension corre el script del repo que apunta la extensión de pagos al túnel.
func (p *storeProc) pointExtension(tunnel string) {
	cmd := exec.Command("npm", "run", "--silent", "extension:url", "--", tunnel)
	cmd.Dir = githubRepo("shopify")
	out, err := cmd.CombinedOutput()
	p.log("tests › " + strings.TrimSpace(string(out)))
	if err != nil {
		p.log("tests › no se pudo apuntar la extensión: " + err.Error())
	}
}

// StopStore para lo que levantó este servidor, por su grupo de procesos.
func StopStore(store string) error {
	p := procOf(store)
	if p == nil || !p.running() {
		return fmt.Errorf("no hay nada levantado desde tests (si corre en otra terminal, se para ahí)")
	}
	return syscall.Kill(-p.cmd.Process.Pid, syscall.SIGTERM)
}

// stopStoresOnExit para las tiendas levantadas desde acá cuando se cierra el servidor: si no, quedan huérfanas.
func stopStoresOnExit() {
	ch := make(chan os.Signal, 1)
	signal.Notify(ch, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-ch
		storeProcsMu.Lock()
		for _, p := range storeProcs {
			if p.running() {
				_ = syscall.Kill(-p.cmd.Process.Pid, syscall.SIGTERM)
			}
		}
		storeProcsMu.Unlock()
		os.Exit(0)
	}()
}
