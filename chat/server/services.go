package main

// TUS SERVICIOS DEL PLAYGROUND: servidores de esta máquina que el equipo alcanza por la VPN con un nombre fijo,
// `<alias>.<tu usuario>.com` en https://<playground>/s/<nombre> (`playground serve`). Se prenden y se apagan desde
// Servers, como tus agentes.
//
// Cómo funciona `playground serve` (cli/playground.js del playground compartido), y por qué esto es así:
//   - lee ~/playground/team/services.json UNA vez, al arrancar: prender o apagar un servicio es reiniciarlo;
//   - el archivo tiene que ser una lista con al menos un servicio: los apagados van aparte, en services.off.json, y sin
//     ninguno prendido el chat apaga `serve`.
// El `serve` y los programas que arranca el chat corren en su propio grupo de procesos (sobreviven al chat); sus pid
// quedan en el directorio de caché del usuario.
//
// El servicio de ejemplo es `faker` (services/faker): personas inventadas para pruebas. Arranca apagado.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"creditop/playground/chat/cli"
)

type teamService struct {
	Alias       string `json:"alias"`
	To          string `json:"to"`
	Description string `json:"description"`
}

// Los programas del playground que el chat sabe levantar, por alias. Un servicio sin programa (otro servidor tuyo) se
// prende y se apaga igual, pero levantarlo es cosa tuya.
type knownProgram struct {
	Dir string // carpeta del programa, relativa al playground
}

var knownPrograms = map[string]knownProgram{
	"faker": {Dir: "services/faker"},
}

var defaultServices = []teamService{
	{Alias: "faker", To: "http://127.0.0.1:5293", Description: "personas inventadas para pruebas: GET /persona, /personas?n=5"},
}

var servicesMu sync.Mutex

func teamDir() string {
	if dir := os.Getenv("PLAYGROUND_TEAM_DIR"); dir != "" {
		return dir
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, "playground", "team")
}

func readServiceList(path string) []teamService {
	var list []teamService
	if raw, err := os.ReadFile(path); err == nil {
		_ = json.Unmarshal(raw, &list)
	}
	return list
}

func writeServiceList(path string, list []teamService) error {
	if list == nil {
		list = []teamService{}
	}
	raw, _ := json.MarshalIndent(list, "", "  ")
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, append(raw, '\n'), 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// Los prendidos (services.json) y los apagados (services.off.json). Un servicio de ejemplo que no está en ninguno
// entra apagado.
func readServices() (on, off []teamService) {
	on = readServiceList(filepath.Join(teamDir(), "services.json"))
	off = readServiceList(filepath.Join(teamDir(), "services.off.json"))
	for _, d := range defaultServices {
		if !hasService(on, d.Alias) && !hasService(off, d.Alias) {
			off = append(off, d)
			_ = writeServiceList(filepath.Join(teamDir(), "services.off.json"), off)
		}
	}
	return on, off
}

func hasService(list []teamService, alias string) bool {
	for _, s := range list {
		if s.Alias == alias {
			return true
		}
	}
	return false
}

// ---- los procesos: `playground serve` y los programas de ejemplo ----------------------------------------------------

func pidPath(name string) string {
	dir, err := os.UserCacheDir()
	if err != nil {
		dir = os.TempDir()
	}
	return filepath.Join(dir, "creditop-chat", name+".pid")
}

func readPid(name string) int {
	raw, _ := os.ReadFile(pidPath(name))
	pid, _ := strconv.Atoi(strings.TrimSpace(string(raw)))
	if processAlive(pid) {
		return pid
	}
	return 0
}

// Arranca un proceso en su grupo, con su salida en un log al lado del pid, y anota el pid.
func startDetached(name, dir, path string, args ...string) error {
	_ = os.MkdirAll(filepath.Dir(pidPath(name)), 0o700)
	logFile, err := os.Create(strings.TrimSuffix(pidPath(name), ".pid") + ".log")
	if err != nil {
		return err
	}
	defer logFile.Close()
	cmd := exec.Command(path, args...)
	cmd.Dir, cmd.Env, cmd.Stdout, cmd.Stderr = dir, toolEnv(), logFile, logFile
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := cmd.Start(); err != nil {
		return err
	}
	pid := cmd.Process.Pid
	_ = cmd.Process.Release()
	return os.WriteFile(pidPath(name), []byte(strconv.Itoa(pid)), 0o600)
}

func stopDetached(name string) {
	if pid := readPid(name); pid > 0 {
		_ = syscall.Kill(-pid, syscall.SIGTERM)
		for i := 0; i < 20 && processAlive(pid); i++ {
			time.Sleep(100 * time.Millisecond)
		}
	}
	_ = os.Remove(pidPath(name))
}

func logTail(name string, lines int) string {
	raw, _ := os.ReadFile(strings.TrimSuffix(pidPath(name), ".pid") + ".log")
	all := strings.Split(strings.TrimSpace(string(raw)), "\n")
	if len(all) > lines {
		all = all[len(all)-lines:]
	}
	return strings.Join(all, "\n")
}

// Un programa del playground: se compila a la caché y se corre desde ahí (no `go run`, que al apagarlo deja vivo al
// binario).
func startProgram(alias string, prog knownProgram) error {
	root, err := playgroundRoot()
	if err != nil {
		return err
	}
	goPath, err := lookTool("go")
	if err != nil {
		return errors.New("no está `go` en esta máquina")
	}
	bin := strings.TrimSuffix(pidPath("svc-"+alias), ".pid")
	build := exec.Command(goPath, "build", "-o", bin, "./"+prog.Dir)
	build.Dir, build.Env = root, toolEnv()
	if out, err := build.CombinedOutput(); err != nil {
		return fmt.Errorf("no compiló %s: %s", prog.Dir, strings.TrimSpace(string(out)))
	}
	return startDetached("svc-"+alias, root, bin)
}

// Reinicia `playground serve` con lo que está prendido; sin nada prendido, lo deja apagado.
func restartServe(on []teamService) error {
	stopDetached("serve")
	if len(on) == 0 {
		return nil
	}
	path, err := cli.Path()
	if err != nil {
		return err
	}
	home, _ := os.UserHomeDir()
	return startDetached("serve", home, path, "serve")
}

// ---- lo que ve la interfaz ----------------------------------------------------------------------------------------

type serviceView struct {
	teamService
	On        bool   `json:"on"`
	Listening bool   `json:"listening"`
	Name      string `json:"name"`
	URL       string `json:"url"`
	Managed   bool   `json:"managed"` // lo levanta el chat
}

func myHandle(ctx context.Context) string {
	if s := cli.CurrentSession(ctx); s != nil && s.Email != "" {
		return strings.ReplaceAll(strings.Split(s.Email, "@")[0], ".", "-")
	}
	return "vos"
}

func servicesView(ctx context.Context) map[string]any {
	on, off := readServices()
	handle := myHandle(ctx)
	out := []serviceView{}
	add := func(s teamService, isOn bool) {
		name := s.Alias + "." + handle + ".com"
		_, managed := knownPrograms[s.Alias]
		out = append(out, serviceView{teamService: s, On: isOn, Listening: portAnswers(s.To), Name: name,
			URL: strings.TrimRight(cli.Base(), "/") + "/s/" + name, Managed: managed})
	}
	for _, s := range on {
		add(s, true)
	}
	for _, s := range off {
		add(s, false)
	}
	return map[string]any{"services": out, "serving": readPid("serve") > 0, "serveLog": logTail("serve", 12)}
}

func setServiceOn(alias string, on bool) error {
	servicesMu.Lock()
	defer servicesMu.Unlock()
	onList, offList := readServices()
	var target *teamService
	nextOn, nextOff := []teamService{}, []teamService{}
	for _, s := range append(append([]teamService{}, onList...), offList...) {
		s := s
		isOn := hasService(onList, s.Alias)
		if s.Alias == alias {
			target, isOn = &s, on
		}
		if isOn {
			nextOn = append(nextOn, s)
		} else {
			nextOff = append(nextOff, s)
		}
	}
	if target == nil {
		return errors.New("no hay un servicio con ese alias")
	}
	if prog, ok := knownPrograms[alias]; ok {
		if on && !portAnswers(target.To) {
			if err := startProgram(alias, prog); err != nil {
				return err
			}
			for i := 0; i < 30 && !portAnswers(target.To); i++ {
				time.Sleep(100 * time.Millisecond)
			}
		}
		if !on {
			stopDetached("svc-" + alias)
		}
	}
	if err := writeServiceList(filepath.Join(teamDir(), "services.json"), nextOn); err != nil {
		return err
	}
	if err := writeServiceList(filepath.Join(teamDir(), "services.off.json"), nextOff); err != nil {
		return err
	}
	return restartServe(nextOn)
}

func teamServiceHandlers(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/services", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()
		writeJSON(w, http.StatusOK, servicesView(ctx))
	})
	mux.HandleFunc("POST /api/services/{alias}", func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			On bool `json:"on"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&in); err != nil {
			fail(w, http.StatusBadRequest, errors.New("el cuerpo va en JSON: {on}"))
			return
		}
		if err := setServiceOn(r.PathValue("alias"), in.On); err != nil {
			fail(w, http.StatusBadRequest, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	})
	/* Una petición a un servicio, como Postman (ServicePanel.vue): la hace este servidor, así el navegador no choca con
	   CORS. Sólo va a la dirección de ESE servicio —su `to` en esta máquina, o su nombre en el playground, como le llega
	   al equipo—: la ruta se pega a esa base y no puede salir de ahí. */
	mux.HandleFunc("POST /api/services/{alias}/request", func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			Method  string            `json:"method"`
			Path    string            `json:"path"`
			Via     string            `json:"via"` // "local" o "playground"
			Headers map[string]string `json:"headers"`
			Body    string            `json:"body"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&in); err != nil {
			fail(w, http.StatusBadRequest, errors.New("el cuerpo va en JSON: {method, path, via, headers, body}"))
			return
		}
		on, off := readServices()
		var target *teamService
		for _, s := range append(on, off...) {
			if s.Alias == r.PathValue("alias") {
				s := s
				target = &s
			}
		}
		if target == nil {
			fail(w, http.StatusNotFound, errors.New("no hay un servicio con ese alias"))
			return
		}
		method := strings.ToUpper(strings.TrimSpace(in.Method))
		switch method {
		case "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS":
		default:
			fail(w, http.StatusBadRequest, fmt.Errorf("método no permitido: %q", in.Method))
			return
		}
		path := "/" + strings.TrimLeft(strings.TrimSpace(in.Path), "/")
		if strings.Contains(path, "://") || strings.HasPrefix(path, "//") || strings.Contains(path, "..") {
			fail(w, http.StatusBadRequest, errors.New("la ruta va sola (/persona), sin dominio ni «..»"))
			return
		}
		base := strings.TrimRight(target.To, "/")
		if in.Via == "playground" {
			base = strings.TrimRight(cli.Base(), "/") + "/s/" + target.Alias + "." + myHandle(r.Context()) + ".com"
		}
		var body io.Reader
		if in.Body != "" && method != "GET" && method != "HEAD" {
			body = strings.NewReader(in.Body)
		}
		ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
		defer cancel()
		req, err := http.NewRequestWithContext(ctx, method, base+path, body)
		if err != nil {
			fail(w, http.StatusBadRequest, err)
			return
		}
		for k, v := range in.Headers {
			if k = strings.TrimSpace(k); k != "" && !strings.EqualFold(k, "Host") {
				req.Header.Set(k, v)
			}
		}
		if body != nil && req.Header.Get("Content-Type") == "" {
			req.Header.Set("Content-Type", "application/json")
		}
		start := time.Now()
		res, err := (&http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}).Do(req)
		took := time.Since(start).Milliseconds()
		if err != nil {
			writeJSON(w, http.StatusOK, map[string]any{"error": err.Error(), "ms": took, "url": base + path})
			return
		}
		defer res.Body.Close()
		raw, _ := io.ReadAll(io.LimitReader(res.Body, 2<<20))
		headers := map[string]string{}
		for k := range res.Header {
			headers[k] = res.Header.Get(k)
		}
		writeJSON(w, http.StatusOK, map[string]any{"status": res.StatusCode, "statusText": http.StatusText(res.StatusCode),
			"ms": took, "size": len(raw), "headers": headers, "body": string(raw), "url": base + path})
	})
	/* Cómo se usa y cómo está: la convención de los servicios del playground es servir `/openapi.json` (el esquema) y
	   `/health`. Se piden a su `to` en esta máquina (el navegador no llega al puerto), y lo que falte se dice, sin
	   bloquear: un servicio sin esquema se sigue probando a mano. */
	mux.HandleFunc("GET /api/services/{alias}/schema", func(w http.ResponseWriter, r *http.Request) {
		on, off := readServices()
		var target *teamService
		for _, s := range append(on, off...) {
			if s.Alias == r.PathValue("alias") {
				s := s
				target = &s
			}
		}
		if target == nil {
			fail(w, http.StatusNotFound, errors.New("no hay un servicio con ese alias"))
			return
		}
		writeJSON(w, http.StatusOK, readSchema(r.Context(), strings.TrimRight(target.To, "/")))
	})
}

// Lo que el servicio dice de sí mismo: su esquema OpenAPI y su salud. Cada uno trae su error si no se pudo leer.
func readSchema(ctx context.Context, base string) map[string]any {
	client := &http.Client{Timeout: 3 * time.Second}
	get := func(path string) (any, string) {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, base+path, nil)
		if err != nil {
			return nil, err.Error()
		}
		res, err := client.Do(req)
		if err != nil {
			return nil, "no contesta: prendelo primero"
		}
		defer res.Body.Close()
		if res.StatusCode == http.StatusNotFound {
			return nil, "no tiene " + path
		}
		var v any
		if err := json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&v); err != nil {
			return nil, path + " no devuelve JSON"
		}
		if res.StatusCode >= 400 {
			return v, fmt.Sprintf("%s contesta %d", path, res.StatusCode)
		}
		return v, ""
	}
	out := map[string]any{}
	out["schema"], out["schemaError"] = get("/openapi.json")
	out["health"], out["healthError"] = get("/health")
	return out
}
