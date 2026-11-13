package main

// LOS SERVICIOS EN PRODUCCIÓN: cada servicio que escribe en el Loki de producción, con la versión que se desplegó (el tag
// del último despliegue a producción en GitHub), sus errores y su señal de vida (cuántas líneas escribe). Es lo que
// muestran las tarjetas de la derecha.
//
// ⚠ La versión es lo que GitHub dice que se DESPLEGÓ, no lo que está corriendo: eso lo sabe ECS, que pide credenciales
//   de AWS de producción. El `service_version` de Loki no sirve: casi todos los servicios dicen «1.0.0».

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

// serviceRepos: el repo de cada `service_name` de Loki, cuando no se llaman igual. Lo que no está acá se busca con el
// mismo nombre; sin repo (backoffice-cognito-authorizer es un lambda de infraestructura) la tarjeta va sin versión.
var serviceRepos = map[string]string{
	"preapprovals-service":          "pre-approvals-service",
	"merchant-gateways-service":     "merchant-gateways",
	"kyc-gateway-service":           "kyc-gateway",
	"backoffice-cognito-authorizer": "",
}

func repoOf(service string) string {
	if r, ok := serviceRepos[service]; ok {
		return r
	}
	return service
}

// Release es el último despliegue a producción de un repo; LastOK, el último que salió bien (si el último falló).
type Release struct {
	Version string   `json:"version"`
	At      string   `json:"at"` // hora de Bogotá, RFC3339
	OK      bool     `json:"ok"`
	URL     string   `json:"url"`
	Title   string   `json:"title"`
	LastOK  *Release `json:"lastOk,omitempty"`
}

// App es una tarjeta: el servicio, su repo y su versión, y las dos señales.
type App struct {
	Service string   `json:"service"`
	Repo    string   `json:"repo"`
	Release *Release `json:"release,omitempty"`
	Errors  *Subject `json:"errors,omitempty"`
	Lines   *Subject `json:"lines,omitempty"`
	State   string   `json:"state"` // el peor de los dos
}

var prodWorkflow = regexp.MustCompile(`(?i)prod`)

var relMu sync.Mutex

// lastRelease: los últimos despliegues a producción de un repo, por `gh` (ya autenticado). Mira las últimas 100
// corridas: un repo que no despliega hace meses puede no tener ninguna ahí.
//
// Devuelve el error aparte de «no hay ninguno»: sin él, `gh` sin autenticar o sin red se veía igual que un repo que
// nunca desplegó.
func lastRelease(repo string) (*Release, error) {
	out, err := runTool(ghTimeout, "", "gh", "run", "list", "--repo", "Creditop-SAS/"+repo, "--limit", "100",
		"--json", "workflowName,headBranch,conclusion,status,createdAt,url,displayTitle")
	if err != nil {
		return nil, err
	}
	var runs []struct {
		WorkflowName, HeadBranch, Conclusion, Status, CreatedAt, URL, DisplayTitle string
	}
	if err := json.Unmarshal(out, &runs); err != nil {
		return nil, err
	}
	var first *Release
	for _, r := range runs {
		if !prodWorkflow.MatchString(r.WorkflowName) || r.Status != "completed" {
			continue
		}
		t, err := time.Parse(time.RFC3339, r.CreatedAt)
		if err != nil {
			continue
		}
		rel := &Release{Version: r.HeadBranch, At: t.In(bogota).Format(time.RFC3339), OK: r.Conclusion == "success", URL: r.URL, Title: r.DisplayTitle}
		if first == nil {
			first = rel
			if rel.OK {
				return first, nil
			}
			continue
		}
		if rel.OK {
			first.LastOK = rel
			return first, nil
		}
	}
	return first, nil
}

// Los procesos de afuera (`gh`, `go run`) llevan PLAZO. Sin él, uno colgado (la red a medias, `gh` esperando una
// credencial) detenía la pasada para siempre: el lazo es síncrono y no hay pasada siguiente.
const (
	ghTimeout = 30 * time.Second
	// `go run ./tablero/server/cmd/deploys` compila antes de correr (lento con la caché fría) y adentro llama a `gh`
	// por cada repo: le hace falta más que a un `gh` suelto.
	deploysTimeout = 2 * time.Minute
)

// runTool corre un proceso con plazo y devuelve su salida. Al vencer el plazo lo mata; `WaitDelay` hace que además se
// deje de esperar su salida: `go run` deja un hijo con la tubería abierta y, sin eso, `Output` seguiría esperando.
func runTool(timeout time.Duration, dir, name string, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Dir = dir
	cmd.WaitDelay = 2 * time.Second
	out, err := cmd.Output()
	if ctx.Err() == context.DeadlineExceeded {
		return nil, fmt.Errorf("%s no contestó en %s", name, timeout)
	}
	if err != nil {
		// Lo que el proceso dijo por stderr explica más que «exit status 1» (p. ej. «gh auth login»).
		var exit *exec.ExitError
		if errors.As(err, &exit) {
			if line, _, _ := strings.Cut(strings.TrimSpace(string(exit.Stderr)), "\n"); line != "" {
				return nil, fmt.Errorf("%s: %s", name, line)
			}
		}
		return nil, fmt.Errorf("%s: %w", name, err)
	}
	return out, nil
}

// loadReleases: el último despliegue de cada repo de los servicios, en paralelo. Devuelve una nota si no se pudieron
// leer (para la interfaz): sólo cuando fallaron TODOS, que es `gh` sin autenticar, sin red o colgado. Un repo suelto que
// falla (un servicio sin repo con su nombre) es lo de siempre y no se avisa. Del que falla se conserva la versión que ya
// se tenía: una lectura fallida no borra lo sabido.
func (s *sentinel) loadReleases() string {
	services := map[string]bool{}
	for sig := range s.store.dense() {
		if k := kindOf(sig); k == "logs" || k == "service" {
			services[sig[len(k)+1:]] = true
		}
	}
	relMu.Lock()
	known := s.releases != nil
	relMu.Unlock()
	if !known { // la API recién arrancada: lo guardado de la última vez es lo que se conserva si `gh` falla
		s.loadSavedReleases()
	}
	relMu.Lock()
	prev := s.releases
	relMu.Unlock()
	got := map[string]Release{}
	asked, failed := 0, 0
	var firstErr error
	var mu sync.Mutex
	var wg sync.WaitGroup
	for svc := range services {
		repo := repoOf(svc)
		if repo == "" {
			continue
		}
		asked++
		wg.Add(1)
		go func() {
			defer wg.Done()
			rel, err := lastRelease(repo)
			mu.Lock()
			defer mu.Unlock()
			switch {
			case err != nil:
				failed++
				if firstErr == nil {
					firstErr = err
				}
				if old, ok := prev[repo]; ok {
					got[repo] = old
				}
			case rel != nil:
				got[repo] = *rel
			}
		}()
	}
	wg.Wait()
	// El front: su versión sale de PostHog, no de un workflow de GitHub (steps.go).
	var front []Deploy
	cl, err := phClient()
	if err == nil {
		front, err = frontReleases(cl, 30)
	}
	if err == nil && len(front) > 0 {
		last := front[len(front)-1]
		got["frontend-monorepo"] = Release{Version: last.Version, At: last.At, OK: true, URL: last.URL, Title: last.Title}
	} else if old, ok := prev["frontend-monorepo"]; ok && err != nil {
		got["frontend-monorepo"] = old
	}
	relMu.Lock()
	s.releases = got
	relMu.Unlock()
	// Quedan en `releases.json`, para la consola sin la API.
	if raw, err := json.Marshal(got); err == nil {
		path := filepath.Join(s.store.dir, "releases.json")
		if os.WriteFile(path+".tmp", raw, 0o644) == nil {
			_ = os.Rename(path+".tmp", path)
		}
	}
	if asked > 0 && failed == asked {
		return fmt.Sprintf("no se pudo leer la versión de los servicios (%v): las tarjetas muestran la última que se supo", firstErr)
	}
	return ""
}

// loadSavedReleases: las versiones de la última vez que se pidieron a GitHub.
func (s *sentinel) loadSavedReleases() {
	raw, err := os.ReadFile(filepath.Join(s.store.dir, "releases.json"))
	if err != nil {
		return
	}
	var got map[string]Release
	if json.Unmarshal(raw, &got) == nil {
		relMu.Lock()
		s.releases = got
		relMu.Unlock()
	}
}

// apps: una tarjeta por servicio que aparece en los logs de producción, la peor arriba y después la desplegada más
// recientemente.
func (s *sentinel) apps(o *Overview) []App {
	relMu.Lock()
	releases := s.releases
	relMu.Unlock()
	byName := map[string]*App{}
	get := func(svc string) *App {
		a := byName[svc]
		if a == nil {
			a = &App{Service: svc, Repo: repoOf(svc)}
			if rel, ok := releases[a.Repo]; ok {
				r := rel
				a.Release = &r
			}
			byName[svc] = a
		}
		return a
	}
	// Copias, no punteros a la lista: la lista se ordena después y el puntero quedaba señalando a otra señal.
	for _, x := range o.Services {
		switch x.Kind {
		case "service":
			get(x.Name).Errors = &x
		case "jserr": // el front no escribe en Loki: su tarjeta es sus errores de JavaScript
			get("frontend-monorepo").Errors = &x
		}
	}
	for _, x := range o.Liveness {
		get(strings.TrimSuffix(x.Name, " · líneas")).Lines = &x
	}
	rank := map[string]int{"alert": 3, "warn": 2, "ok": 1, "quiet": 0}
	var out []App
	for _, a := range byName {
		a.State = "quiet"
		for _, x := range []*Subject{a.Errors, a.Lines} {
			if x != nil && rank[x.State] > rank[a.State] {
				a.State = x.State
			}
		}
		out = append(out, *a)
	}
	sort.Slice(out, func(i, j int) bool {
		if rank[out[i].State] != rank[out[j].State] && (out[i].State == "alert" || out[i].State == "warn" || out[j].State == "alert" || out[j].State == "warn") {
			return rank[out[i].State] > rank[out[j].State]
		}
		ai, aj := "", ""
		if out[i].Release != nil {
			ai = out[i].Release.At
		}
		if out[j].Release != nil {
			aj = out[j].Release.At
		}
		if ai != aj {
			return ai > aj
		}
		return out[i].Service < out[j].Service
	})
	return out
}
