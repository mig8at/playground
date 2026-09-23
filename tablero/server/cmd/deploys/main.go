// deploys — qué pasó en los despliegues, y CUÁNDO fallan, POR QUÉ.
//
// Es la pregunta del día a día que hasta hoy se contestaba abriendo GitHub en el navegador, repo por
// repo: ¿esto se desplegó? ¿a qué ambiente? ¿el que falló, falló en el deploy o antes? Se contesta con
// `gh`, que ya está autenticado — no hace falta ningún token nuevo.
//
//	deploys                  los últimos días de los tres repos
//	deploys -fallas          SÓLO lo que falló, con el error del log — es el modo de «¿qué se rompió?»
//	deploys -dias 14         otra ventana
//	deploys -repo legacy-backend
//	deploys -json
//
// ⚠ Y «falló el sonar» son dos cosas: el PASO del deploy (raro, y tumba el despliegue) o el GATE de
// calidad (el análisis corrió y el código no pasó el umbral). Cómo se consulta cada uno, con los
// comandos: `tablero/CLAUDE.md` §«SONAR».
//
// ⚠ DE UNA CORRIDA FALLIDA SE MUESTRA EL JOB Y EL PASO, no «falló». Medido el 2026-09-15 sobre las 8
// últimas fallas de `legacy-backend`: dos eran de Dependabot (ni siquiera son despliegues), tres del
// deploy a ECS, dos del análisis de SonarCloud y una del build de la imagen. Leerlas todas como «falló
// el deploy» son cuatro conclusiones equivocadas de ocho — y la más cara es la de Sonar: **el deploy a
// producción del 2026-09-02 se cayó en el paso de SonarCloud**, porque el scanner no pudo cargar los
// perfiles de calidad del proyecto. El código estaba bien; lo que falló fue la herramienta de análisis.
//
// Los despliegues se distinguen del ruido por el NOMBRE del workflow: Dependabot abre decenas de
// corridas por semana y ahogarían la lista. Ver `isDeploy`.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

// DefaultRepos son los tres donde se despliega lo que se trabaja acá. `legacy-application` nombra
// sus workflows con la ruta del archivo (`.github/workflows/main-prod.yaml`) en vez de un título, así
// que el ambiente se saca igual del nombre — por eso el detector mira el texto completo.
var DefaultRepos = []string{"legacy-backend", "frontend-monorepo", "legacy-application"}

const org = "Creditop-SAS"

type run struct {
	Repo        string `json:"repo"`
	Name        string `json:"workflow"`
	Branch      string `json:"rama"`
	State       string `json:"estado"` // success | failure | cancelled | in_progress…
	Title       string `json:"titulo"`
	Created     string `json:"creada"`
	URL         string `json:"url"`
	ID          int64  `json:"id"`
	Environment string `json:"ambiente,omitempty"`
	FailedJob   string `json:"jobFallido,omitempty"`
	FailedStep  string `json:"pasoQueFallo,omitempty"`
	Error       string `json:"error,omitempty"` // la línea del log que dice POR QUÉ; sólo con -fallas
}

var (
	reDependabot = regexp.MustCompile(`(?i)dependabot|composer in |npm_and_yarn|bump `)
	reDeploy     = regexp.MustCompile(`(?i)deploy|main-(dev|prod|qa|stg|canary|lab)`)
	reProd       = regexp.MustCompile(`(?i)production|prod|main-prod`)
	reQA         = regexp.MustCompile(`(?i)\bqa\b|main-qa`)
	reStg        = regexp.MustCompile(`(?i)staging|stg`)
	reDev        = regexp.MustCompile(`(?i)develop|dev\b|main-dev`)
	reCanary     = regexp.MustCompile(`(?i)canary`)
)

// isDeploy: un despliegue de verdad, no el ruido de las actualizaciones de dependencias. Dependabot
// abre decenas de corridas por semana en estos repos y, contadas como despliegues, dan una tasa de
// fallas que no es la del despliegue de nadie.
func isDeploy(name string) bool {
	return !reDependabot.MatchString(name) && reDeploy.MatchString(name)
}

// environmentOf sale del NOMBRE del workflow, no de la rama: la rama dice de dónde salió el código y el
// nombre dice a dónde va. Un tag `v0.4.69` que despliega a producción no se puede leer desde la rama.
func environmentOf(name string) string {
	switch {
	// `canary` va primero: su archivo es `main-canary.yaml` y `reProd` no lo matchea, pero sin esta
	// rama caía en el `?` — un ambiente real que se leía como «no se supo».
	case reCanary.MatchString(name):
		return "canary"
	case reProd.MatchString(name):
		return "producción"
	case reQA.MatchString(name):
		return "qa"
	case reStg.MatchString(name):
		return "staging"
	case reDev.MatchString(name):
		return "develop"
	}
	return ""
}

func gh(args ...string) ([]byte, error) {
	cmd := exec.Command("gh", args...)
	var out, errb strings.Builder
	cmd.Stdout, cmd.Stderr = &out, &errb
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("%v: %s", err, strings.TrimSpace(errb.String()))
	}
	return []byte(out.String()), nil
}

func runsOf(repo string, since time.Time, limit int) ([]run, error) {
	b, err := gh("run", "list", "--repo", org+"/"+repo, "--limit", fmt.Sprint(limit),
		"--json", "databaseId,name,headBranch,conclusion,status,displayTitle,createdAt,url")
	if err != nil {
		return nil, err
	}
	var raw []struct {
		DatabaseID   int64  `json:"databaseId"`
		Name         string `json:"name"`
		HeadBranch   string `json:"headBranch"`
		Conclusion   string `json:"conclusion"`
		Status       string `json:"status"`
		DisplayTitle string `json:"displayTitle"`
		CreatedAt    string `json:"createdAt"`
		URL          string `json:"url"`
	}
	if err := json.Unmarshal(b, &raw); err != nil {
		return nil, err
	}
	var out []run
	for _, c := range raw {
		if !isDeploy(c.Name) {
			continue
		}
		t, err := time.Parse(time.RFC3339, c.CreatedAt)
		if err != nil || t.Before(since) {
			continue
		}
		state := c.Conclusion
		if state == "" {
			state = c.Status // todavía corriendo
		}
		out = append(out, run{
			Repo: repo, Name: c.Name, Branch: c.HeadBranch, State: state, Title: c.DisplayTitle,
			Created: c.CreatedAt, URL: c.URL, ID: c.DatabaseID, Environment: environmentOf(c.Name),
		})
	}
	return out, nil
}

// failureReason pide el detalle SÓLO de las fallidas: es una llamada por corrida y no vale pagarla por
// las que anduvieron. Devuelve el job y el paso, que es lo que distingue «no compiló» de «no desplegó»
// de «falló el análisis de calidad».
func failureReason(repo string, id int64) (job, step string) {
	b, err := gh("run", "view", fmt.Sprint(id), "--repo", org+"/"+repo, "--json", "jobs")
	if err != nil {
		return "", ""
	}
	var d struct {
		Jobs []struct {
			Name       string `json:"name"`
			Conclusion string `json:"conclusion"`
			Steps      []struct {
				Name       string `json:"name"`
				Conclusion string `json:"conclusion"`
			} `json:"steps"`
		} `json:"jobs"`
	}
	if json.Unmarshal(b, &d) != nil {
		return "", ""
	}
	for _, j := range d.Jobs {
		if j.Conclusion != "failure" {
			continue
		}
		var steps []string
		for _, s := range j.Steps {
			if s.Conclusion == "failure" {
				steps = append(steps, s.Name)
			}
		}
		return j.Name, strings.Join(steps, ", ")
	}
	return "", ""
}

// reError es el marcador estándar de GitHub Actions: la línea que el runner marcó como el error.
var reError = regexp.MustCompile(`##\[error\](.*)`)

// errorFromLog baja el log del job fallido y saca la línea que dice POR QUÉ. Es lo que convierte
// «falló en Build Docker image» en «la definición de tarea mide 65.558 bytes y el máximo es 65.536».
//
// ⚠ NO SIEMPRE HAY MARCADOR: medido el 2026-09-15 sobre las 4 fallas de la última semana, 3 lo traen y
// 1 no (un build del front). Por eso hay un respaldo que busca líneas con «error» y, si tampoco hay,
// se dice que no se pudo leer y queda la URL. Inventar un motivo es peor que no darlo: quien lo lee
// va a dejar de abrir el log, que es justo donde está la respuesta.
func errorFromLog(repo string, id int64) string {
	b, err := gh("run", "view", fmt.Sprint(id), "--repo", org+"/"+repo, "--log-failed")
	if err != nil {
		return ""
	}
	lines := strings.Split(string(b), "\n")
	for _, l := range lines {
		if m := reError.FindStringSubmatch(l); m != nil {
			if t := strings.TrimSpace(m[1]); t != "" {
				return t
			}
		}
	}
	// respaldo: la última línea que hable de un error y no sea el ruido del runner
	for i := len(lines) - 1; i >= 0; i-- {
		l := strings.TrimSpace(lines[i])
		if !strings.Contains(strings.ToLower(l), "error") || strings.Contains(l, "##[group]") {
			continue
		}
		if i := strings.Index(l, "\t"); i >= 0 && i+1 < len(l) {
			l = strings.TrimSpace(l[strings.LastIndex(l, "\t")+1:])
		}
		if len(l) > 12 {
			return l
		}
	}
	return ""
}

func main() {
	var (
		days       = flag.Int("dias", 7, "cuántos días hacia atrás")
		repo       = flag.String("repo", "", "un solo repo (por defecto: los tres donde se despliega)")
		limit      = flag.Int("limite", 80, "cuántas corridas pedirle a GitHub por repo antes de filtrar")
		onlyFailed = flag.Bool("fallas", false, "sólo lo que falló, con el error del log")
		asJSON     = flag.Bool("json", false, "salida en JSON")
	)
	flag.Parse()

	repos := DefaultRepos
	if *repo != "" {
		repos = []string{*repo}
	}
	since := time.Now().AddDate(0, 0, -*days)

	var all []run
	for _, r := range repos {
		cs, err := runsOf(r, since, *limit)
		if err != nil {
			fmt.Fprintf(os.Stderr, "⚠ %s: %v\n", r, err)
			continue
		}
		all = append(all, cs...)
	}
	// El porqué, SÓLO de las fallidas y EN PARALELO. Cada falla cuesta una llamada por el detalle y otra
	// por el log (~30 KB), y en fila eran 19 s para tres: un comando que se usa cuando algo se rompió no
	// puede hacer esperar. De a cuatro, que es el techo útil contra la API de GitHub.
	var wg sync.WaitGroup
	queue := make(chan struct{}, 4)
	for i := range all {
		if all[i].State != "failure" {
			continue
		}
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			queue <- struct{}{}
			defer func() { <-queue }()
			all[i].FailedJob, all[i].FailedStep = failureReason(all[i].Repo, all[i].ID)
			// el log se baja SÓLO en el modo de fallas: no vale pagarlo mirando la lista entera
			if *onlyFailed {
				all[i].Error = errorFromLog(all[i].Repo, all[i].ID)
			}
		}(i)
	}
	wg.Wait()
	sort.Slice(all, func(i, j int) bool { return all[i].Created > all[j].Created })

	if *onlyFailed {
		var failed []run
		for _, c := range all {
			if c.State == "failure" {
				failed = append(failed, c)
			}
		}
		if *asJSON {
			_ = json.NewEncoder(os.Stdout).Encode(failed)
			return
		}
		printFailures(failed, all, *days, repos)
		return
	}
	if *asJSON {
		_ = json.NewEncoder(os.Stdout).Encode(all)
		return
	}
	printReport(all, *days, repos)
}

func printReport(cs []run, days int, repos []string) {
	ok, failures := 0, 0
	byEnv := map[string][2]int{} // ambiente → [ok, falla]
	for _, c := range cs {
		a := byEnv[c.Environment]
		switch c.State {
		case "success":
			ok++
			a[0]++
		case "failure":
			failures++
			a[1]++
		}
		byEnv[c.Environment] = a
	}
	fmt.Printf("\n  DESPLIEGUES · últimos %d días · %s\n", days, strings.Join(repos, ", "))
	fmt.Printf("  %d corrida(s): %d ok · %d fallidas", len(cs), ok, failures)
	envs := make([]string, 0, len(byEnv))
	for a := range byEnv {
		if a != "" {
			envs = append(envs, a)
		}
	}
	sort.Strings(envs)
	for _, a := range envs {
		fmt.Printf("  ·  %s %d/%d", a, byEnv[a][0], byEnv[a][0]+byEnv[a][1])
	}
	fmt.Print("\n\n")
	if len(cs) == 0 {
		fmt.Print("  no hubo despliegues en la ventana (o `gh` no pudo contestar)\n\n")
		return
	}
	for _, c := range cs {
		mark := map[string]string{"success": "✔", "failure": "✗", "cancelled": "–"}[c.State]
		if mark == "" {
			mark = "…"
		}
		env := c.Environment
		if env == "" {
			env = "?"
		}
		fmt.Printf("  %s %s  %-18s %-11s %-26s %s\n", mark, c.Created[:10], truncate(c.Repo, 18), env,
			truncate(c.Branch, 26), truncate(c.Title, 44))
		if c.State == "failure" {
			// EL PASO, no «falló»: es lo que distingue no compiló / no desplegó / falló el análisis
			det := c.FailedJob
			if c.FailedStep != "" {
				det += " → " + c.FailedStep
			}
			if det == "" {
				det = "(no se pudo leer el detalle)"
			}
			fmt.Printf("      ↳ %s\n      ↳ %s\n", det, c.URL)
		}
	}
	fmt.Println()
}

// printFailures contesta «¿qué se rompió?»: sólo lo fallido, con el error y el enlace. El total de
// despliegues va igual en la primera línea, porque «3 fallas» y «3 de 200» no son la misma noticia.
func printFailures(failed, all []run, days int, repos []string) {
	fmt.Printf("\n  FALLAS · últimos %d días · %s\n", days, strings.Join(repos, ", "))
	fmt.Printf("  %d de %d despliegues\n\n", len(failed), len(all))
	if len(failed) == 0 {
		fmt.Print("  ✔ nada falló en la ventana.\n\n")
		return
	}
	for _, c := range failed {
		env := c.Environment
		if env == "" {
			env = "?"
		}
		fmt.Printf("  ✗ %s  %s → %s\n", c.Created[:10], c.Repo, env)
		fmt.Printf("     rama    %s\n", c.Branch)
		fmt.Printf("     qué     %s\n", truncate(c.Title, 96))
		step := c.FailedJob
		if c.FailedStep != "" {
			step += " → " + c.FailedStep
		}
		fmt.Printf("     dónde   %s\n", step)
		if c.Error != "" {
			fmt.Printf("     por qué %s\n", truncate(c.Error, 150))
		} else {
			fmt.Printf("     por qué (el log no marcó un error legible — está en el enlace)\n")
		}
		fmt.Printf("     %s\n\n", c.URL)
	}
}

func truncate(s string, n int) string {
	if len([]rune(s)) <= n {
		return s
	}
	return string([]rune(s)[:n-1]) + "…"
}
