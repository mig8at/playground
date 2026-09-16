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
	var cual, en string
	var aplicar bool
	flag.StringVar(&cual, "n", "", "tarea: su id o parte de su título")
	flag.StringVar(&en, "en", env("CUADRILLA_URL", "https://cuadrilla.playground.creditop.com"), "a qué cuadrilla")
	flag.BoolVar(&aplicar, "aplicar", false, "escribir de verdad (sin esto sólo dice qué haría)")
	flag.Parse()

	if err := correr(cual, strings.TrimRight(en, "/"), aplicar); err != nil {
		fmt.Fprintln(os.Stderr, "  ✗ "+err.Error())
		os.Exit(1)
	}
}

func env(k, porDefecto string) string {
	if v := strings.TrimSpace(os.Getenv(k)); v != "" {
		return v
	}
	return porDefecto
}

// tarea: lo poco que hace falta del frontmatter. No se reusa el lector de `cmd/tareas` porque vive en
// su propio `package main`; sacarlo a `internal/` para tres claves sería mover código de un comando
// que ya anda. Si algún día hacen falta más, esa mudanza sí vale.
type tarea struct {
	id      int
	titulo  string
	archivo string
	epica   string // de `cuadrilla: <épica>/<quien>`
	quien   string
}

func buscarTarea(dir, cual string) (tarea, error) {
	archivos, _ := filepath.Glob(filepath.Join(dir, "*.md"))
	var halladas []tarea
	for _, a := range archivos {
		t, err := leerTarea(a)
		if err != nil || t.id == 0 {
			continue
		}
		slug := strings.TrimSuffix(filepath.Base(a), ".md")
		if cual == strconv.Itoa(t.id) || strings.Contains(strings.ToLower(t.titulo), strings.ToLower(cual)) ||
			strings.Contains(slug, strings.ToLower(cual)) {
			halladas = append(halladas, t)
		}
	}
	switch len(halladas) {
	case 0:
		return tarea{}, fmt.Errorf("no encontré ninguna tarea que sea %q", cual)
	case 1:
		return halladas[0], nil
	}
	var nombres []string
	for _, t := range halladas {
		nombres = append(nombres, fmt.Sprintf("%d (%s)", t.id, t.titulo))
	}
	return tarea{}, fmt.Errorf("%q matchea varias: %s — usá el id", cual, strings.Join(nombres, ", "))
}

func leerTarea(ruta string) (tarea, error) {
	b, err := os.ReadFile(ruta)
	if err != nil {
		return tarea{}, err
	}
	t := tarea{archivo: ruta}
	partes := strings.SplitN(string(b), "---", 3)
	if len(partes) < 3 {
		return t, nil
	}
	for _, l := range strings.Split(partes[1], "\n") {
		v := func() string {
			_, x, _ := strings.Cut(l, ":")
			return strings.Trim(strings.TrimSpace(x), `"'`)
		}
		switch {
		case strings.HasPrefix(l, "id:"):
			t.id, _ = strconv.Atoi(v())
		case strings.HasPrefix(l, "title:"):
			t.titulo = v()
		case strings.HasPrefix(l, "cuadrilla:"):
			// `<épica>/<quien>`: la épica de allá y con qué nombre figurás en ella.
			epica, quien, _ := strings.Cut(v(), "/")
			t.epica, t.quien = strings.TrimSpace(epica), strings.TrimSpace(quien)
		}
	}
	return t, nil
}

// ── LO QUE VIAJA ───────────────────────────────────────────────────────────────────────────────

type rama struct {
	Repo  string `json:"repo"`
	Rama  string `json:"rama"`
	Base  string `json:"base,omitempty"`
	Autor string `json:"autor,omitempty"`
	Nota  string `json:"nota,omitempty"`
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
func loQueViaja(medidas []store.RamaTarea, quien string, baseDe map[string]string) (viajan []rama, quedan []string, sinRepo []string) {
	for _, r := range medidas {
		if r.Local && r.PR == nil {
			quedan = append(quedan, r.Repo+" "+r.Rama+" (sólo en esta máquina, sin PR)")
			continue
		}
		base, declarado := baseDe[r.Repo]
		if !declarado {
			// La épica no declara ese repo. Igual se manda —el trabajo existe— pero se avisa: es el
			// equipo el que decide qué repos toca una épica, y esto lo está estirando.
			sinRepo = append(sinRepo, r.Repo)
		}
		viajan = append(viajan, rama{Repo: r.Repo, Rama: r.Rama, Base: base, Autor: quien, Nota: nota(r)})
	}
	sort.Slice(viajan, func(i, j int) bool {
		if viajan[i].Repo != viajan[j].Repo {
			return viajan[i].Repo < viajan[j].Repo
		}
		return viajan[i].Rama < viajan[j].Rama
	})
	return viajan, quedan, unicos(sinRepo)
}

func unicos(xs []string) []string {
	visto, out := map[string]bool{}, []string(nil)
	for _, x := range xs {
		if !visto[x] {
			visto[x], out = true, append(out, x)
		}
	}
	sort.Strings(out)
	return out
}

// nota: el asunto del commit de punta, que es lo más cerca de «en qué trabajás» que el tablero mide.
// Recortado porque cuadrilla lo muestra en una línea debajo de la rama.
func nota(r store.RamaTarea) string {
	n := strings.TrimSpace(r.Asunto)
	if len(n) > 90 {
		n = strings.TrimSpace(n[:90]) + "…"
	}
	return n
}

// ── HABLAR CON CUADRILLA ───────────────────────────────────────────────────────────────────────

type epica struct {
	ID     string   `json:"id"`
	Nombre string   `json:"nombre"`
	Devs   []string `json:"devs"`
	Repos  []struct {
		Repo string `json:"repo"`
		Base string `json:"base"`
	} `json:"repos"`
	Ramas []struct {
		Repo  string `json:"repo"`
		Rama  string `json:"rama"`
		Autor string `json:"autor"`
	} `json:"ramas"`
}

type cliente struct {
	base  string
	token string
}

func (c cliente) pedir(metodo, ruta string, cuerpo any) ([]byte, error) {
	var cuerpoLeido *bytes.Reader
	if cuerpo != nil {
		crudo, _ := json.Marshal(cuerpo)
		cuerpoLeido = bytes.NewReader(crudo)
	} else {
		cuerpoLeido = bytes.NewReader(nil)
	}
	r, err := http.NewRequest(metodo, c.base+ruta, cuerpoLeido)
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

func correr(cual, base string, aplicar bool) error {
	if strings.TrimSpace(cual) == "" {
		return errors.New("falta la tarea: `N=<id o parte del título>`")
	}
	raiz, err := raizDeDatos()
	if err != nil {
		return err
	}
	t, err := buscarTarea(raiz, cual)
	if err != nil {
		return err
	}
	if t.epica == "" || t.quien == "" {
		return fmt.Errorf("la tarea %d no dice a qué épica de cuadrilla va.\n"+
			"    Agregale al frontmatter de %s:\n\n        cuadrilla: <épica>/<con-qué-nombre-figurás>\n\n"+
			"    La épica tiene que existir ya en cuadrilla: esto no las crea.",
			t.id, filepath.Base(t.archivo))
	}

	// ⚠ `LeerSnapshotRamas` recibe la carpeta que CONTIENE `ramas.json`, que es `data/cache` y no
	// `data`. Y devuelve un snapshot vacío si no lo encuentra, sin fallar — así que pasarle la
	// carpeta de más arriba se lee como «esta tarea no tiene ramas», que es otra cosa.
	snap := store.LeerSnapshotRamas(filepath.Join(raiz, "cache"))
	medidas, hay := snap.Tareas[strconv.Itoa(t.id)]
	if !hay || len(medidas.Ramas) == 0 {
		return fmt.Errorf("la tarea %d no tiene ramas medidas. Corré primero: make tareas-ramas N=%d", t.id, t.id)
	}
	cuando := medidas.MedidoEn
	if cuando == "" {
		cuando = snap.MedidoEn
	}

	c := cliente{base: base, token: strings.TrimSpace(os.Getenv("CUADRILLA_TOKEN"))}
	crudo, err := c.pedir("GET", "/api/epicas/"+t.epica, nil)
	if err != nil {
		return err
	}
	var e epica
	if err := json.Unmarshal(crudo, &e); err != nil {
		return fmt.Errorf("no entendí la épica: %w", err)
	}

	/* La rama base sale de la ÉPICA, no de la tarea: es lo que el equipo declaró para ese repo. Hay
	   que mandarla porque el server no la completa —lo hacía el front al agregar a mano— y sin ella la
	   rama queda sin base y la pantalla no puede decir si se desvió. */
	baseDe := map[string]string{}
	for _, r := range e.Repos {
		baseDe[r.Repo] = r.Base
	}
	viajan, quedan, sinRepo := loQueViaja(medidas.Ramas, t.quien, baseDe)

	// Lo que YA está allá a tu nombre. Sólo eso se compara y sólo eso se toca.
	tuyasAlla := map[string]bool{}
	for _, r := range e.Ramas {
		if strings.EqualFold(r.Autor, t.quien) {
			tuyasAlla[r.Repo+" "+r.Rama] = true
		}
	}
	quiero := map[string]bool{}
	for _, r := range viajan {
		quiero[r.Repo+" "+r.Rama] = true
	}

	var sumar []rama
	for _, r := range viajan {
		if !tuyasAlla[r.Repo+" "+r.Rama] {
			sumar = append(sumar, r)
		}
	}
	var sacar []string
	for k := range tuyasAlla {
		if !quiero[k] {
			sacar = append(sacar, k)
		}
	}
	sort.Strings(sacar)

	// ── decir qué va a pasar, siempre: aplicar o no, el informe es el mismo ──
	fmt.Printf("\n  tarea %d · %s\n", t.id, t.titulo)
	fmt.Printf("  →  %s/epica/%s/%s\n", base, e.ID, t.quien)
	fmt.Printf("     «%s», con %s\n\n", e.Nombre, enumerar(e.Devs))
	fmt.Printf("  %d ramas medidas (%s)\n", len(medidas.Ramas), hace(cuando))
	for _, q := range quedan {
		fmt.Printf("     · se queda acá: %s\n", q)
	}
	fmt.Printf("  %d ya están allá a tu nombre\n", len(tuyasAlla))
	for _, r := range sinRepo {
		fmt.Printf("  ⚠ la épica no declara el repo %s — la rama se manda igual, pero sin rama base\n", r)
	}

	if len(sumar) == 0 && len(sacar) == 0 {
		fmt.Printf("\n  ✓ nada que hacer: cuadrilla ya dice lo mismo que tu tarea\n\n")
		return nil
	}
	fmt.Println()
	for _, r := range sumar {
		fmt.Printf("  + %-20s %s\n", r.Repo, r.Rama)
	}
	for _, k := range sacar {
		fmt.Printf("  − %s   (ya no está en tu tarea)\n", k)
	}

	if !aplicar {
		fmt.Printf("\n  Esto es lo que HARÍA. Para hacerlo: agregá APLICAR=1\n\n")
		return nil
	}
	if c.token == "" {
		return errors.New("falta `CUADRILLA_TOKEN` para escribir.\n" +
			"    Lo mejor es una llave `cua_` —se emite desde /api en cuadrilla— porque sólo puede tocar\n" +
			"    TUS ramas y tu documentación, que es exactamente lo que hace esto.")
	}

	fmt.Println()
	for _, r := range sumar {
		if _, err := c.pedir("POST", "/api/epicas/"+t.epica+"/ramas", r); err != nil {
			return err
		}
		fmt.Printf("  + %s %s\n", r.Repo, r.Rama)
	}
	for _, k := range sacar {
		repo, ramaNombre, _ := strings.Cut(k, " ")
		ruta := fmt.Sprintf("/api/epicas/%s/ramas?repo=%s&rama=%s", t.epica, url(repo), url(ramaNombre))
		if _, err := c.pedir("DELETE", ruta, nil); err != nil {
			return err
		}
		fmt.Printf("  − %s\n", k)
	}
	fmt.Printf("\n  ✓ listo · %s/epica/%s/%s\n\n", base, e.ID, t.quien)
	return nil
}

// ── menudencias ────────────────────────────────────────────────────────────────────────────────

func url(s string) string { return strings.ReplaceAll(neturl.QueryEscape(s), "+", "%20") }

// raizDeDatos: `tablero/data`, tanto si se corre desde `tablero/server` (el molde de los otros
// comandos) como desde la raíz del repo.
func raizDeDatos() (string, error) {
	for _, c := range []string{"../data", "tablero/data", "data"} {
		if st, err := os.Stat(c); err == nil && st.IsDir() {
			return c, nil
		}
	}
	return "", errors.New("no encontré `tablero/data`: corré esto desde el repo")
}

func enumerar(xs []string) string {
	switch len(xs) {
	case 0:
		return "nadie declarado todavía"
	case 1:
		return xs[0]
	}
	return strings.Join(xs[:len(xs)-1], ", ") + " y " + xs[len(xs)-1]
}

// hace: cuánto pasó desde la medición. Va porque publicar una medición vieja es publicar algo que ya
// no es cierto, y el número solo no lo dice.
func hace(iso string) string {
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
