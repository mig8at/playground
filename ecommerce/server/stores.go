package main

/* Las tiendas de prueba listas para comprar, desde la interfaz: un semáforo dice si todo está al día y, en VTEX, un
 * botón levanta `vtex link`.
 *
 * Cada chequeo mide lo que importa para comprar, no si un proceso existe. En Shopify, que la app de pagos desplegada
 * en dev conteste: desde el 2026-11-09 la versión publicada de la app apunta ahí y no se levanta nada (antes era
 * `shopify app dev` con un túnel de Cloudflare). En VTEX, que la sesión sea de la cuenta creditop en el workspace de
 * desarrollo y que el conector conteste en él.
 *
 * Lo que levanta este servidor lo puede parar. Lo que corre en otra terminal se detecta y se respeta: no se mata ni
 * se levanta otro encima. Los procesos van en su propio grupo y se paran por ese grupo, nunca por un patrón. VTEX sólo
 * se linkea en `develop`, el workspace de desarrollo de la cuenta de pruebas. */

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
	vtexWorkspace = "develop"
	vtexManifest  = "https://develop--creditop.myvtex.com/_v/creditop.creditop/v5/manifest"
	// La app de pagos de Shopify, desplegada en dev (contra qa).
	shopifyAppURL = "https://shopify-app.dev.creditop.com"
	// La firma del proceso de VTEX, para reconocerlo si lo levantó otra terminal (sólo se lee con pgrep).
	vtexSignature = "vtex link"
	logLines      = 200
)

var (
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
	Deployed bool     `json:"deployed"` // vive desplegada: no hay nada que levantar ni parar desde acá
	Managed  bool     `json:"managed"`  // lo levantó ecommerce y lo puede parar
	External bool     `json:"external"` // corre en otra terminal
	Started  string   `json:"started,omitempty"`
	Exited   string   `json:"exited,omitempty"`
	Log      []string `json:"log"`
}

func githubRepo(name string) string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, "Desktop", "CREDITOP", "github", name)
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
		st.Deployed = true
		ok, detail := reachable(shopifyAppURL + "/")
		st.Checks = append(st.Checks, Check{Name: "La app de pagos contesta en dev", OK: ok, Detail: detail})
	case "vtex":
		account, workspace := vtexWhoami()
		session := account == vtexAccount && workspace == vtexWorkspace
		detail := "sin sesión"
		if account != "" {
			detail = account + " · " + workspace
		}
		if account == vtexAccount && workspace != vtexWorkspace {
			detail += " · Levantar la pasa a " + vtexWorkspace
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
		return fmt.Errorf("ya está corriendo desde ecommerce")
	}
	var cmd *exec.Cmd
	switch store {
	case "shopify":
		return fmt.Errorf("la app de Shopify vive desplegada en dev (%s): no hay nada que levantar", shopifyAppURL)
	case "vtex":
		if runningElsewhere(vtexSignature, nil) {
			return fmt.Errorf("vtex link ya corre en otra terminal: cerralo ahí (Ctrl+C) para levantarlo desde acá")
		}
		// Nunca fuera del workspace de desarrollo: linkear en master cambia la tienda real. En la cuenta correcta pero en
		// otro workspace (el piloto, master) se pasa a develop, que ya existe; la cuenta no se cambia acá porque pide
		// login en el navegador.
		if account, workspace := vtexWhoami(); account == vtexAccount && workspace != vtexWorkspace {
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			out, err := exec.CommandContext(ctx, "vtex", "use", vtexWorkspace).CombinedOutput()
			cancel()
			if err != nil {
				return fmt.Errorf("no se pudo pasar a %s: %s", vtexWorkspace, strings.TrimSpace(ansiRe.ReplaceAllString(string(out), "")))
			}
		}
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

// read guarda la salida y marca cuándo VTEX terminó de compilar lo linkeado.
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
	}
	err := p.cmd.Wait()
	p.mu.Lock()
	p.exited = time.Now().Format("15:04:05")
	if err != nil {
		p.exited += " · " + err.Error()
	}
	p.mu.Unlock()
}

// StopStore para lo que levantó este servidor, por su grupo de procesos.
func StopStore(store string) error {
	p := procOf(store)
	if p == nil || !p.running() {
		return fmt.Errorf("no hay nada levantado desde ecommerce (si corre en otra terminal, se para ahí)")
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
