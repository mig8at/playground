// deploys — qué pasó en los despliegues, y CUÁNDO fallan, POR QUÉ.
//
// Es la pregunta del día a día que hasta hoy se contestaba abriendo GitHub en el navegador, repo por
// repo: ¿esto se desplegó? ¿a qué ambiente? ¿el que falló, falló en el deploy o antes? Se contesta con
// `gh`, que ya está autenticado — no hace falta ningún token nuevo.
//
//	deploys                  los últimos días de los tres repos
//	deploys -dias 14         otra ventana
//	deploys -repo legacy-backend
//	deploys -json
//
// ⚠ DE UNA CORRIDA FALLIDA SE MUESTRA EL JOB Y EL PASO, no «falló». Medido el 2026-09-15 sobre las 8
// últimas fallas de `legacy-backend`: dos eran de Dependabot (ni siquiera son despliegues), tres del
// deploy a ECS, dos del análisis de SonarCloud y una del build de la imagen. Leerlas todas como «falló
// el deploy» son cuatro conclusiones equivocadas de ocho — y la más cara es la de Sonar: **el deploy a
// producción del 2026-09-02 se cayó en el paso de SonarCloud**, porque el scanner no pudo cargar los
// perfiles de calidad del proyecto. El código estaba bien; lo que falló fue la herramienta de análisis.
//
// Los despliegues se distinguen del ruido por el NOMBRE del workflow: Dependabot abre decenas de
// corridas por semana y ahogarían la lista. Ver `esDespliegue`.
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
	"time"
)

// ReposPorDefecto son los tres donde se despliega lo que se trabaja acá. `legacy-application` nombra
// sus workflows con la ruta del archivo (`.github/workflows/main-prod.yaml`) en vez de un título, así
// que el ambiente se saca igual del nombre — por eso el detector mira el texto completo.
var ReposPorDefecto = []string{"legacy-backend", "frontend-monorepo", "legacy-application"}

const org = "Creditop-SAS"

type corrida struct {
	Repo       string `json:"repo"`
	Nombre     string `json:"workflow"`
	Rama       string `json:"rama"`
	Estado     string `json:"estado"` // success | failure | cancelled | in_progress…
	Titulo     string `json:"titulo"`
	Creada     string `json:"creada"`
	URL        string `json:"url"`
	ID         int64  `json:"id"`
	Ambiente   string `json:"ambiente,omitempty"`
	JobFallido string `json:"jobFallido,omitempty"`
	PasoFallo  string `json:"pasoQueFallo,omitempty"`
}

var (
	reDependabot = regexp.MustCompile(`(?i)dependabot|composer in |npm_and_yarn|bump `)
	reDespliegue = regexp.MustCompile(`(?i)deploy|main-(dev|prod|qa|stg|canary|lab)`)
	reProd       = regexp.MustCompile(`(?i)production|prod|main-prod`)
	reQA         = regexp.MustCompile(`(?i)\bqa\b|main-qa`)
	reStg        = regexp.MustCompile(`(?i)staging|stg`)
	reDev        = regexp.MustCompile(`(?i)develop|dev\b|main-dev`)
	reCanary     = regexp.MustCompile(`(?i)canary`)
)

// esDespliegue: un despliegue de verdad, no el ruido de las actualizaciones de dependencias. Dependabot
// abre decenas de corridas por semana en estos repos y, contadas como despliegues, dan una tasa de
// fallas que no es la del despliegue de nadie.
func esDespliegue(nombre string) bool {
	return !reDependabot.MatchString(nombre) && reDespliegue.MatchString(nombre)
}

// ambienteDe sale del NOMBRE del workflow, no de la rama: la rama dice de dónde salió el código y el
// nombre dice a dónde va. Un tag `v0.4.69` que despliega a producción no se puede leer desde la rama.
func ambienteDe(nombre string) string {
	switch {
	// `canary` va primero: su archivo es `main-canary.yaml` y `reProd` no lo matchea, pero sin esta
	// rama caía en el `?` — un ambiente real que se leía como «no se supo».
	case reCanary.MatchString(nombre):
		return "canary"
	case reProd.MatchString(nombre):
		return "producción"
	case reQA.MatchString(nombre):
		return "qa"
	case reStg.MatchString(nombre):
		return "staging"
	case reDev.MatchString(nombre):
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

func corridasDe(repo string, desde time.Time, limite int) ([]corrida, error) {
	b, err := gh("run", "list", "--repo", org+"/"+repo, "--limit", fmt.Sprint(limite),
		"--json", "databaseId,name,headBranch,conclusion,status,displayTitle,createdAt,url")
	if err != nil {
		return nil, err
	}
	var crudas []struct {
		DatabaseID   int64  `json:"databaseId"`
		Name         string `json:"name"`
		HeadBranch   string `json:"headBranch"`
		Conclusion   string `json:"conclusion"`
		Status       string `json:"status"`
		DisplayTitle string `json:"displayTitle"`
		CreatedAt    string `json:"createdAt"`
		URL          string `json:"url"`
	}
	if err := json.Unmarshal(b, &crudas); err != nil {
		return nil, err
	}
	var out []corrida
	for _, c := range crudas {
		if !esDespliegue(c.Name) {
			continue
		}
		t, err := time.Parse(time.RFC3339, c.CreatedAt)
		if err != nil || t.Before(desde) {
			continue
		}
		estado := c.Conclusion
		if estado == "" {
			estado = c.Status // todavía corriendo
		}
		out = append(out, corrida{
			Repo: repo, Nombre: c.Name, Rama: c.HeadBranch, Estado: estado, Titulo: c.DisplayTitle,
			Creada: c.CreatedAt, URL: c.URL, ID: c.DatabaseID, Ambiente: ambienteDe(c.Name),
		})
	}
	return out, nil
}

// porQueFallo pide el detalle SÓLO de las fallidas: es una llamada por corrida y no vale pagarla por
// las que anduvieron. Devuelve el job y el paso, que es lo que distingue «no compiló» de «no desplegó»
// de «falló el análisis de calidad».
func porQueFallo(repo string, id int64) (job, paso string) {
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
		var pasos []string
		for _, s := range j.Steps {
			if s.Conclusion == "failure" {
				pasos = append(pasos, s.Name)
			}
		}
		return j.Name, strings.Join(pasos, ", ")
	}
	return "", ""
}

func main() {
	var (
		dias     = flag.Int("dias", 7, "cuántos días hacia atrás")
		repo     = flag.String("repo", "", "un solo repo (por defecto: los tres donde se despliega)")
		limite   = flag.Int("limite", 80, "cuántas corridas pedirle a GitHub por repo antes de filtrar")
		comoJSON = flag.Bool("json", false, "salida en JSON")
	)
	flag.Parse()

	repos := ReposPorDefecto
	if *repo != "" {
		repos = []string{*repo}
	}
	desde := time.Now().AddDate(0, 0, -*dias)

	var todas []corrida
	for _, r := range repos {
		cs, err := corridasDe(r, desde, *limite)
		if err != nil {
			fmt.Fprintf(os.Stderr, "⚠ %s: %v\n", r, err)
			continue
		}
		todas = append(todas, cs...)
	}
	// el porqué sólo de las fallidas
	for i := range todas {
		if todas[i].Estado == "failure" {
			todas[i].JobFallido, todas[i].PasoFallo = porQueFallo(todas[i].Repo, todas[i].ID)
		}
	}
	sort.Slice(todas, func(i, j int) bool { return todas[i].Creada > todas[j].Creada })

	if *comoJSON {
		_ = json.NewEncoder(os.Stdout).Encode(todas)
		return
	}
	imprimir(todas, *dias, repos)
}

func imprimir(cs []corrida, dias int, repos []string) {
	ok, fallas := 0, 0
	porAmb := map[string][2]int{} // ambiente → [ok, falla]
	for _, c := range cs {
		a := porAmb[c.Ambiente]
		switch c.Estado {
		case "success":
			ok++
			a[0]++
		case "failure":
			fallas++
			a[1]++
		}
		porAmb[c.Ambiente] = a
	}
	fmt.Printf("\n  DESPLIEGUES · últimos %d días · %s\n", dias, strings.Join(repos, ", "))
	fmt.Printf("  %d corrida(s): %d ok · %d fallidas", len(cs), ok, fallas)
	ambs := make([]string, 0, len(porAmb))
	for a := range porAmb {
		if a != "" {
			ambs = append(ambs, a)
		}
	}
	sort.Strings(ambs)
	for _, a := range ambs {
		fmt.Printf("  ·  %s %d/%d", a, porAmb[a][0], porAmb[a][0]+porAmb[a][1])
	}
	fmt.Print("\n\n")
	if len(cs) == 0 {
		fmt.Print("  no hubo despliegues en la ventana (o `gh` no pudo contestar)\n\n")
		return
	}
	for _, c := range cs {
		marca := map[string]string{"success": "✔", "failure": "✗", "cancelled": "–"}[c.Estado]
		if marca == "" {
			marca = "…"
		}
		amb := c.Ambiente
		if amb == "" {
			amb = "?"
		}
		fmt.Printf("  %s %s  %-18s %-11s %-26s %s\n", marca, c.Creada[:10], corta(c.Repo, 18), amb,
			corta(c.Rama, 26), corta(c.Titulo, 44))
		if c.Estado == "failure" {
			// EL PASO, no «falló»: es lo que distingue no compiló / no desplegó / falló el análisis
			det := c.JobFallido
			if c.PasoFallo != "" {
				det += " → " + c.PasoFallo
			}
			if det == "" {
				det = "(no se pudo leer el detalle)"
			}
			fmt.Printf("      ↳ %s\n      ↳ %s\n", det, c.URL)
		}
	}
	fmt.Println()
}

func corta(s string, n int) string {
	if len([]rune(s)) <= n {
		return s
	}
	return string([]rune(s)[:n-1]) + "…"
}
