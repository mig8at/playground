// Publicar en CUADRILLA las ramas de una tarea del tablero.
//
// El tablero es de Miguel y vive en esta máquina; cuadrilla es del equipo y vive en el cluster. Una
// tarea de acá es LA PARTE DE UNO dentro de una épica de allá, y cuadrilla ya modela eso: `/epica/
// <épica>/<quien>` es «lo que una persona hace dentro de una épica», con sus ramas y su documentación
// separadas de las de los demás. Este comando llena esa parte, y ninguna otra.
//
// ⚠ VIAJA LO QUE SE MIDE, NO LO QUE SE OPINA. De la tarea salen sus ramas —medidas contra git por
// `tareas-ramas`, con repo y nombre— y nada más. Quién está en la épica, la rama base y la
// documentación de otros son del equipo y se deciden allá. Así esto NO PUEDE pisar el trabajo de
// nadie: sólo toca las ramas cuyo autor sos vos.
//
// ⚠ Y NO CREA ÉPICAS. Una épica es un acuerdo del equipo; si se pudiera abrir desde acá, el tablero
// compartido terminaría siendo el espejo de las tareas de una persona — que es justo lo contrario de
// para qué existe.
//
// ⚠ No manda el ESTADO de cada rama (PR, días, mergeada) aunque el tablero lo tenga medido: eso
// cuadrilla lo deriva sola de GitHub. Mandarlo sería declarar algo derivable, que es el error que las
// dos herramientas evitan a propósito.
package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"net/http"
	neturl "net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"creditop/tablero/server/internal/store"
)

func main() {
	var which, en string
	var apply bool
	flag.StringVar(&which, "n", "", "tarea: su id o parte de su título")
	flag.StringVar(&en, "en", env("CUADRILLA_URL", "https://cuadrilla.playground.creditop.com"), "a qué cuadrilla")
	flag.BoolVar(&apply, "aplicar", false, "escribir de verdad (sin esto sólo dice qué haría)")
	flag.Parse()

	if err := runCommand(which, strings.TrimRight(en, "/"), apply); err != nil {
		fmt.Fprintln(os.Stderr, "  ✗ "+err.Error())
		os.Exit(1)
	}
}

func env(k, defaults string) string {
	if v := strings.TrimSpace(os.Getenv(k)); v != "" {
		return v
	}
	return defaults
}

// task: lo poco que hace falta del frontmatter. No se reusa el lector de `cmd/tasks` porque vive en
// su propio `package main`; sacarlo a `internal/` para tres claves sería mover código de un comando
// que ya anda. Si algún día hacen falta más, esa mudanza sí vale.
type task struct {
	id    int
	title string
	file  string
	epic  string // de `cuadrilla: <épica>/<quien>`
	who   string
}

func findTask(dir, which string) (task, error) {
	files, _ := filepath.Glob(filepath.Join(dir, "*.md"))
	var found []task
	for _, a := range files {
		t, err := readTask(a)
		if err != nil || t.id == 0 {
			continue
		}
		slug := strings.TrimSuffix(filepath.Base(a), ".md")
		if which == strconv.Itoa(t.id) || strings.Contains(strings.ToLower(t.title), strings.ToLower(which)) ||
			strings.Contains(slug, strings.ToLower(which)) {
			found = append(found, t)
		}
	}
	switch len(found) {
	case 0:
		return task{}, fmt.Errorf("no encontré ninguna tarea que sea %q", which)
	case 1:
		return found[0], nil
	}
	var names []string
	for _, t := range found {
		names = append(names, fmt.Sprintf("%d (%s)", t.id, t.title))
	}
	return task{}, fmt.Errorf("%q matchea varias: %s — usá el id", which, strings.Join(names, ", "))
}

func readTask(path string) (task, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return task{}, err
	}
	t := task{file: path}
	parts := strings.SplitN(string(b), "---", 3)
	if len(parts) < 3 {
		return t, nil
	}
	for _, l := range strings.Split(parts[1], "\n") {
		v := func() string {
			_, x, _ := strings.Cut(l, ":")
			return strings.Trim(strings.TrimSpace(x), `"'`)
		}
		switch {
		case strings.HasPrefix(l, "id:"):
			t.id, _ = strconv.Atoi(v())
		case strings.HasPrefix(l, "title:"):
			t.title = v()
		case strings.HasPrefix(l, "cuadrilla:"):
			// `<épica>/<quien>`: la épica de allá y con qué nombre figurás en ella.
			epic, who, _ := strings.Cut(v(), "/")
			t.epic, t.who = strings.TrimSpace(epic), strings.TrimSpace(who)
		}
	}
	return t, nil
}

// ── LO QUE VIAJA ───────────────────────────────────────────────────────────────────────────────

type branch struct {
	Repo   string `json:"repo"`
	Branch string `json:"rama"`
	Base   string `json:"base,omitempty"`
	Author string `json:"autor,omitempty"`
	Note   string `json:"nota,omitempty"`
}

/*
loQueViaja: de las ramas medidas, las que el equipo puede ver.

	⚠ NO viajan las que viven sólo en esta máquina y no tienen PR: cuadrilla las marcaría en ámbar como
	«no está en origin» y ensuciaría el tablero de todos con ramas que nadie más puede mirar.

	⚠ Pero `local` NO alcanza como filtro, y es la trampa: al mergear un PR se borra la rama remota y
	queda la copia local, así que media tarea terminada figura como «local». Ésas SÍ viajan —cuadrilla
	las resuelve por su PR, que es lo primero que mira— y son justamente las que cuentan el trabajo
	hecho. Por eso la condición es «tiene PR, o sigue en origin».
*/
func payload(measurements []store.TaskBranch, who string, baseOf map[string]string) (sent []branch, remaining []string, withoutRepo []string) {
	for _, r := range measurements {
		if r.Local && r.PR == nil {
			remaining = append(remaining, r.Repo+" "+r.Branch+" (sólo en esta máquina, sin PR)")
			continue
		}
		base, declared := baseOf[r.Repo]
		if !declared {
			// La épica no declara ese repo. Igual se manda —el trabajo existe— pero se avisa: es el
			// equipo el que decide qué repos toca una épica, y esto lo está estirando.
			withoutRepo = append(withoutRepo, r.Repo)
		}
		sent = append(sent, branch{Repo: r.Repo, Branch: r.Branch, Base: base, Author: who, Note: note(r)})
	}
	sort.Slice(sent, func(i, j int) bool {
		if sent[i].Repo != sent[j].Repo {
			return sent[i].Repo < sent[j].Repo
		}
		return sent[i].Branch < sent[j].Branch
	})
	return sent, remaining, unique(withoutRepo)
}

func unique(xs []string) []string {
	seen, out := map[string]bool{}, []string(nil)
	for _, x := range xs {
		if !seen[x] {
			seen[x], out = true, append(out, x)
		}
	}
	sort.Strings(out)
	return out
}

// note: el asunto del commit de punta, que es lo más cerca de «en qué trabajás» que el tablero mide.
// Recortado porque cuadrilla lo muestra en una línea debajo de la rama.
func note(r store.TaskBranch) string {
	n := strings.TrimSpace(r.Subject)
	if len(n) > 90 {
		n = strings.TrimSpace(n[:90]) + "…"
	}
	return n
}

// ── HABLAR CON CUADRILLA ───────────────────────────────────────────────────────────────────────

type epic struct {
	ID    string   `json:"id"`
	Name  string   `json:"nombre"`
	Devs  []string `json:"devs"`
	Repos []struct {
		Repo string `json:"repo"`
		Base string `json:"base"`
	} `json:"repos"`
	Branches []struct {
		Repo   string `json:"repo"`
		Branch string `json:"rama"`
		Author string `json:"autor"`
	} `json:"ramas"`
}

type client struct {
	base  string
	token string
}

func (c client) request(method, path string, body any) ([]byte, error) {
	var readBody *bytes.Reader
	if body != nil {
		raw, _ := json.Marshal(body)
		readBody = bytes.NewReader(raw)
	} else {
		readBody = bytes.NewReader(nil)
	}
	r, err := http.NewRequest(method, c.base+path, readBody)
	if err != nil {
		return nil, err
	}
	r.Header.Set("content-type", "application/json")
	if c.token != "" {
		r.Header.Set("authorization", "Bearer "+c.token)
	}
	resp, err := (&http.Client{Timeout: 25 * time.Second}).Do(r)
	if err != nil {
		return nil, fmt.Errorf("no se pudo hablar con cuadrilla (%s): %w", c.base, err)
	}
	defer resp.Body.Close()
	var buf bytes.Buffer
	_, _ = buf.ReadFrom(resp.Body)
	if resp.StatusCode >= 300 {
		var e struct {
			Error string `json:"error"`
		}
		_ = json.Unmarshal(buf.Bytes(), &e)
		if e.Error == "" {
			e.Error = strings.TrimSpace(buf.String())
		}
		return nil, fmt.Errorf("cuadrilla contestó %d: %s", resp.StatusCode, e.Error)
	}
	return buf.Bytes(), nil
}

// ── EL TRABAJO ─────────────────────────────────────────────────────────────────────────────────

func runCommand(which, base string, apply bool) error {
	if strings.TrimSpace(which) == "" {
		return errors.New("falta la tarea: `N=<id o parte del título>`")
	}
	root, err := dataRoot()
	if err != nil {
		return err
	}
	t, err := findTask(root, which)
	if err != nil {
		return err
	}
	if t.epic == "" || t.who == "" {
		return fmt.Errorf("la tarea %d no dice a qué épica de cuadrilla va.\n"+
			"    Agregale al frontmatter de %s:\n\n        cuadrilla: <épica>/<con-qué-nombre-figurás>\n\n"+
			"    La épica tiene que existir ya en cuadrilla: esto no las crea.",
			t.id, filepath.Base(t.file))
	}

	// ⚠ `ReadBranchSnapshot` recibe la carpeta que CONTIENE `ramas.json`, que es `data/cache` y no
	// `data`. Y devuelve un snapshot vacío si no lo encuentra, sin fallar — así que pasarle la
	// carpeta de más arriba se lee como «esta tarea no tiene ramas», que es otra cosa.
	snap := store.ReadBranchSnapshot(filepath.Join(root, "cache"))
	measurements, found := snap.Tasks[strconv.Itoa(t.id)]
	if !found || len(measurements.Branches) == 0 {
		return fmt.Errorf("la tarea %d no tiene ramas medidas. Corré primero: make tareas-ramas N=%d", t.id, t.id)
	}
	when := measurements.MeasuredAt
	if when == "" {
		when = snap.MeasuredAt
	}

	c := client{base: base, token: strings.TrimSpace(os.Getenv("CUADRILLA_TOKEN"))}
	raw, err := c.request("GET", "/api/epicas/"+t.epic, nil)
	if err != nil {
		return err
	}
	var e epic
	if err := json.Unmarshal(raw, &e); err != nil {
		return fmt.Errorf("no entendí la épica: %w", err)
	}

	/* La rama base sale de la ÉPICA, no de la tarea: es lo que el equipo declaró para ese repo. Hay
	   que mandarla porque el server no la completa —lo hacía el front al agregar a mano— y sin ella la
	   rama queda sin base y la pantalla no puede decir si se desvió. */
	baseOf := map[string]string{}
	for _, r := range e.Repos {
		baseOf[r.Repo] = r.Base
	}
	sent, remaining, withoutRepo := payload(measurements.Branches, t.who, baseOf)

	// Lo que YA está allá a tu nombre. Sólo eso se compara y sólo eso se toca.
	yoursThere := map[string]bool{}
	for _, r := range e.Branches {
		if strings.EqualFold(r.Author, t.who) {
			yoursThere[r.Repo+" "+r.Branch] = true
		}
	}
	want := map[string]bool{}
	for _, r := range sent {
		want[r.Repo+" "+r.Branch] = true
	}

	var sum []branch
	for _, r := range sent {
		if !yoursThere[r.Repo+" "+r.Branch] {
			sum = append(sum, r)
		}
	}
	var remove []string
	for k := range yoursThere {
		if !want[k] {
			remove = append(remove, k)
		}
	}
	sort.Strings(remove)

	// ── decir qué va a pasar, siempre: aplicar o no, el informe es el mismo ──
	fmt.Printf("\n  tarea %d · %s\n", t.id, t.title)
	fmt.Printf("  →  %s/epica/%s/%s\n", base, e.ID, t.who)
	fmt.Printf("     «%s», con %s\n\n", e.Name, enumerate(e.Devs))
	fmt.Printf("  %d ramas medidas (%s)\n", len(measurements.Branches), ago(when))
	for _, q := range remaining {
		fmt.Printf("     · se queda acá: %s\n", q)
	}
	fmt.Printf("  %d ya están allá a tu nombre\n", len(yoursThere))
	for _, r := range withoutRepo {
		fmt.Printf("  ⚠ la épica no declara el repo %s — la rama se manda igual, pero sin rama base\n", r)
	}

	if len(sum) == 0 && len(remove) == 0 {
		fmt.Printf("\n  ✓ nada que hacer: cuadrilla ya dice lo mismo que tu tarea\n\n")
		return nil
	}
	fmt.Println()
	for _, r := range sum {
		fmt.Printf("  + %-20s %s\n", r.Repo, r.Branch)
	}
	for _, k := range remove {
		fmt.Printf("  − %s   (ya no está en tu tarea)\n", k)
	}

	if !apply {
		fmt.Printf("\n  Esto es lo que HARÍA. Para hacerlo: agregá APLICAR=1\n\n")
		return nil
	}
	if c.token == "" {
		return errors.New("falta `CUADRILLA_TOKEN` para escribir.\n" +
			"    Lo mejor es una llave `cua_` —se emite desde /api en cuadrilla— porque sólo puede tocar\n" +
			"    TUS ramas y tu documentación, que es exactamente lo que hace esto.")
	}

	fmt.Println()
	for _, r := range sum {
		if _, err := c.request("POST", "/api/epicas/"+t.epic+"/ramas", r); err != nil {
			return err
		}
		fmt.Printf("  + %s %s\n", r.Repo, r.Branch)
	}
	for _, k := range remove {
		repo, branchName, _ := strings.Cut(k, " ")
		path := fmt.Sprintf("/api/epicas/%s/ramas?repo=%s&rama=%s", t.epic, url(repo), url(branchName))
		if _, err := c.request("DELETE", path, nil); err != nil {
			return err
		}
		fmt.Printf("  − %s\n", k)
	}
	fmt.Printf("\n  ✓ listo · %s/epica/%s/%s\n\n", base, e.ID, t.who)
	return nil
}

// ── menudencias ────────────────────────────────────────────────────────────────────────────────

func url(s string) string { return strings.ReplaceAll(neturl.QueryEscape(s), "+", "%20") }

// dataRoot: `tablero/data`, tanto si se corre desde `tablero/server` (el molde de los otros
// comandos) como desde la raíz del repo.
func dataRoot() (string, error) {
	for _, c := range []string{"../data", "tablero/data", "data"} {
		if st, err := os.Stat(c); err == nil && st.IsDir() {
			return c, nil
		}
	}
	return "", errors.New("no encontré `tablero/data`: corré esto desde el repo")
}

func enumerate(xs []string) string {
	switch len(xs) {
	case 0:
		return "nadie declarado todavía"
	case 1:
		return xs[0]
	}
	return strings.Join(xs[:len(xs)-1], ", ") + " y " + xs[len(xs)-1]
}

// ago: cuánto pasó desde la medición. Va porque publicar una medición vieja es publicar algo que ya
// no es cierto, y el número solo no lo dice.
func ago(iso string) string {
	t, err := time.Parse(time.RFC3339, iso)
	if err != nil {
		return "sin fecha de medición"
	}
	d := time.Since(t)
	switch {
	case d < time.Hour:
		return fmt.Sprintf("medidas hace %d min", int(d.Minutes()))
	case d < 48*time.Hour:
		return fmt.Sprintf("medidas hace %d h", int(d.Hours()))
	default:
		return fmt.Sprintf("⚠ medidas hace %d días — conviene `make tareas-ramas` antes", int(d.Hours()/24))
	}
}
