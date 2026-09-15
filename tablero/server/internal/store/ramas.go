package store

// Ramas: EN QUÉ RAMAS vive una tarea, y hasta dónde llegó cada una.
//
// POR QUÉ SE DERIVA Y NO SE ESCRIBE A MANO. La tarea declara UN patrón (`ramas: pais-como-dato`) y todo
// lo demás sale de git: qué ramas matchean en cada repo, y contra qué ramas de ambiente está mergeado el
// commit. Una lista de ramas escrita a mano miente en silencio en cuanto algo se mergea, se renombra o
// se abre otra — pasó tres veces en un día con la tarea de países (`-onto-develop`, `-onto-staging`, y
// un PR viejo a `main` que ya no era el camino). Es la misma decisión que ya tomaron los prototipos (el
// vínculo es el NOMBRE del archivo) y las anotaciones (salen del cuerpo).
//
// POR QUÉ POR PATCH-ID Y NO POR NOMBRE. `git cherry` compara por patch-id, así que detecta un commit que
// llegó por SQUASH — donde el hash cambia y el nombre de la rama ya no existe. Preguntar `git branch
// --merged` diría "no está" para un cambio que sí está en producción. La diferencia no es teórica: es
// cómo se supo que el backend de países estaba en `develop` y en `staging` pero no en `main`.
//
// POR QUÉ ES UN SNAPSHOT. Medir esto son varias invocaciones de git por repo. Hacerlo en cada render de
// la card haría lenta la UI, así que se mide con `make tareas-ramas` y se guarda con la FECHA de la
// medición — igual que el sprint. Un estado de git sin fecha se lee como actual y no lo es.
//
// LA PARTE QUE SÍ HABLA CON LA RED: los PRs. Git sólo sabe de commits, y "en qué PR va esto y quién lo
// tiene que revisar" es la mitad que falta para responder «¿por qué esto no avanza?» — hoy hay que
// reconstruirla a mano con `gh`. Se pide UNA vez por repo (no una por rama) y **degrada sin ruido**: sin
// `gh`, sin sesión o sin red, las ramas salen igual y sólo faltan sus PRs. La parte de git sigue siendo
// offline, que es lo que permite medir con la VPN caída.

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

// AmbientesPorDefecto son las ramas que cuentan como "ambiente": si el commit está acá, está desplegado
// (o en camino). El orden es de menor a mayor riesgo, que es como conviene leerlas.
var AmbientesPorDefecto = []string{"develop", "staging", "qa", "main"}

// RamaTarea es UNA rama de trabajo de la tarea, con hasta dónde llegó.
type RamaTarea struct {
	Repo string `json:"repo"` // nombre corto del repo (no la ruta absoluta: la card muestra esto)
	Rama string `json:"rama"` // sin el prefijo `origin/`
	// Local: la rama sólo existe en esta máquina. Pasa sobre todo con las MERGEADAS —al aprobar el PR se
	// borra la remota y queda la copia local—, así que no equivale a "sin pushear": mirá los ambientes.
	Local  bool   `json:"local,omitempty"`
	Commit string `json:"commit"` // punta de la rama, corto
	Asunto string `json:"asunto"` // primera línea del commit de punta
	// En dice si EL COMMIT DE PUNTA de la rama —el cambio de la tarea— ya está en cada ambiente,
	// medido por patch-id. Es la respuesta a "¿esto ya llegó a develop?" y es la señal principal.
	//
	// ⚠ Se mira la PUNTA y no "¿le queda algo propio?" porque eso último engaña: una rama cortada de
	// `main` arrastra ~190 commits ajenos contra `develop`, y decir "falta en develop(190)" sugiere 190
	// cambios pendientes cuando el pendiente es UNO. Visto midiendo la tarea de países.
	En map[string]bool `json:"en"`
	// Propios es cuántos commits de la rama NO están en cada ambiente: el contexto de cuánta deriva
	// arrastra la rama. NO es "cuánto falta de esta tarea" — para eso está `En`.
	Propios map[string]int `json:"propios"`
	// Como dice CÓMO se supo que el cambio está en cada ambiente, y existe porque las dos señales no
	// valen lo mismo:
	//
	//	"patch"  el patch-id de la punta aparece en el ambiente (`git cherry`). Es la señal fuerte:
	//	         dice que ESE CAMBIO está ahí, aunque haya llegado por squash de un commit.
	//	"pr"     el patch-id NO aparece, pero el PR de la rama se mergeó y su commit resultante SÍ es
	//	         ancestro del ambiente. Pasa con el squash de VARIOS commits o cuando el mensaje/contenido
	//	         se editó al mergear: el patch-id cambia y `git cherry` deja de reconocerlo.
	//
	// Medido el 2026-09-15: sin la segunda señal, `frontend-monorepo#983` —squasheado a `3f3f8700`, que
	// está en `main`— salía como «en ningún ambiente», y la tarea de Alta Fleet afirmaba que nada suyo
	// había llegado a `main`. Se guarda la procedencia en vez de mezclarlas porque la señal por PR habla
	// del PR, no de la punta: si alguien siguió commiteando en la rama después del merge, la punta de
	// verdad no está y el ✓ tiene que poder explicarse.
	Como map[string]string `json:"como,omitempty"`
	// PR de esta rama, si lo hay. Nil = no se pudo preguntar (sin `gh`/sin red) o la rama no tiene PR;
	// los dos casos se ven igual en la card a propósito: "no hay PR" es la información útil, y
	// distinguir "no pude preguntar" pediría un tercer estado que nadie va a mirar.
	PR *PullRequest `json:"pr,omitempty"`
}

// PullRequest es lo mínimo para contestar «¿por qué esto no avanza?»: a dónde va, en qué estado está y
// si alguien lo tiene que revisar.
type PullRequest struct {
	Numero   int    `json:"numero"`
	Estado   string `json:"estado"` // OPEN | MERGED | CLOSED
	Base     string `json:"base"`   // contra qué rama
	URL      string `json:"url"`
	Revision string `json:"revision"` // APPROVED | REVIEW_REQUIRED | CHANGES_REQUESTED | "" (sin revisor pedido)
	Draft    bool   `json:"draft"`
	Mergeado string `json:"mergeado,omitempty"` // fecha, si ya se mergeó
	// MergeCommit es el commit que quedó en la base al mergear (el del squash, si fue squash). Es lo que
	// permite contestar «¿llegó a main?» cuando el patch-id ya no coincide — ver `RamaTarea.Como`.
	MergeCommit string `json:"mergeCommit,omitempty"`
}

// RamasDeTarea es el resultado por tarea.
type RamasDeTarea struct {
	Patron string      `json:"patron"`
	Ramas  []RamaTarea `json:"ramas"`
	// MedidoEn es cuándo se midió ESTA tarea, y existe porque el snapshot se puede actualizar de a una
	// (`ramas -n 62`). Con una sola fecha global, una tarea medida hace una semana se leía con la fecha
	// de la corrida de hoy — un dato viejo presentado como fresco.
	MedidoEn string `json:"medidoEn,omitempty"`
}

// SnapshotRamas es lo que se guarda en disco.
type SnapshotRamas struct {
	MedidoEn string `json:"medidoEn"` // RFC3339: la card muestra "medido hace X"
	Root     string `json:"root"`     // dónde se buscaron los repos
	// Por ID de tarea (como cadena, que es lo que permite JSON). Se usa el ID y no el slug porque el
	// nombre del archivo se puede renombrar a mano —el id vive en el frontmatter y es la identidad—,
	// así que una clave por slug se orfanaría con un renombre.
	Tareas map[string]RamasDeTarea `json:"tareas"`
	// Incompletas: ids que NO se alcanzaron a medir (se venció el tiempo). Van declaradas porque un
	// snapshot que calla lo que le falta se lee como entero: el 2026-09-14 cinco tareas salieron con
	// cero ramas por un timeout y parecían tareas sin ramas.
	Incompletas []string `json:"incompletas,omitempty"`
}

var gitBin = func() string {
	if p, err := exec.LookPath("git"); err == nil {
		return p
	}
	return "/usr/bin/git"
}()

// git corre un comando en `dir`. Sin terminal ni credenciales: un repo cuyo remoto pida usuario dejaría
// esto esperando para siempre, y acá NO se habla con la red — se lee lo que el último `fetch` dejó.
func git(ctx context.Context, dir string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, gitBin, append([]string{"--no-optional-locks"}, args...)...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0", "GIT_OPTIONAL_LOCKS=0")
	var sb strings.Builder
	cmd.Stdout = &sb
	if err := cmd.Run(); err != nil {
		return sb.String(), err
	}
	return sb.String(), nil
}

// reRamaPatron valida CADA patrón del frontmatter. Se acota a propósito: es una subcadena de nombre de
// rama, no una expresión — un patrón libre acabaría matcheando ramas ajenas y la card mentiría al revés.
var reRamaPatron = regexp.MustCompile(`^[\w][\w./-]{2,}$`)

// patronesDe parte el valor del frontmatter en la LISTA de subcadenas a buscar, separadas por coma.
//
// Hace falta una lista porque la relación rama↔tarea es muchos-a-muchos: acá se cortan las ramas unas
// de otras, así que una rama carga trabajo de varias tareas y una tarea vive en varias ramas. Medido el
// 2026-08-19 sobre 16 tareas: CORE-268 vive en `monto-actualizando-sin-banner` Y en `motai-v2`, que no
// comparten ninguna subcadena — con un solo patrón había que elegir cuál de las dos mitades mostrar.
//
// La alternativa era ensanchar el patrón (`kyc` en vez de los dos slugs de CORE-420) y eso arrastra
// ramas ajenas: `kyc` trae también `obs-kyc-03-codes`, que es observabilidad. Un patrón ancho no
// falla — miente en silencio, que es lo que este campo existe para evitar.
func patronesDe(v string) []string {
	var out []string
	for _, p := range strings.Split(v, ",") {
		p = strings.TrimSpace(p)
		if reRamaPatron.MatchString(p) {
			out = append(out, p)
		}
	}
	return out
}

// MedirRamas mide, para cada (id de tarea → patrón), las ramas que matchean en los repos bajo `root`.
//
// `ambientes` puede venir vacío y usa los de por defecto. El contexto acota el tiempo total: son
// muchas invocaciones de git y esto lo dispara una persona esperando en la terminal.
func MedirRamas(ctx context.Context, root string, patrones map[string]string, ambientes []string) SnapshotRamas {
	if len(ambientes) == 0 {
		ambientes = AmbientesPorDefecto
	}
	snap := SnapshotRamas{MedidoEn: time.Now().Format(time.RFC3339), Root: root, Tareas: map[string]RamasDeTarea{}}

	repos := reposEn(root)
	prs := &prCache{porRepo: map[string]map[string]*PullRequest{}}

	// LAS TAREAS SE MIDEN EN PARALELO, de a cuatro. Medido el 2026-09-14 en serie: 1 min 30 para 21
	// tareas, justo el timeout de la consola — y cuando se pasaba, las últimas tareas salían con CERO
	// ramas y el snapshot no decía que estaba truncado. Cuatro y no más: son comandos de git contra
	// disco y llamadas a gh; más goroutines no aceleran, compiten.
	var (
		mu   sync.Mutex
		wg   sync.WaitGroup
		cola = make(chan struct{}, 4)
	)
	for id, patron := range patrones {
		pats := patronesDe(patron)
		if len(pats) == 0 {
			continue
		}
		wg.Add(1)
		go func(id, patron string, pats []string) {
			defer wg.Done()
			cola <- struct{}{}
			defer func() { <-cola }()
			if ctx.Err() != nil {
				mu.Lock()
				snap.Incompletas = append(snap.Incompletas, id)
				mu.Unlock()
				return
			}
			res := medirTarea(ctx, repos, patron, pats, ambientes, prs)
			res.MedidoEn = time.Now().Format(time.RFC3339)
			mu.Lock()
			defer mu.Unlock()
			if ctx.Err() != nil {
				// Se venció en el medio: lo medido está a medias y NO se guarda como si fuera entero.
				snap.Incompletas = append(snap.Incompletas, id)
				return
			}
			snap.Tareas[id] = res
		}(id, patron, pats)
	}
	wg.Wait()
	sort.Strings(snap.Incompletas)
	return snap
}

// medirTarea es el trabajo de UNA tarea: sus ramas en cada repo, hasta dónde llegaron y su PR.
func medirTarea(ctx context.Context, repos []string, patron string, pats, ambientes []string, prs *prCache) RamasDeTarea {
	{
		res := RamasDeTarea{Patron: patron}
		for _, repo := range repos {
			// Dos patrones pueden traer la MISMA rama (`motai` y `motai-v2`): se mide una sola vez, o la
			// card mostraría la rama repetida y el conteo del botón diría más de las que hay.
			vistas := map[string]bool{}
			var ramas []rama
			for _, pat := range pats {
				for _, rm := range ramasQueMatchean(ctx, repo, pat) {
					if !vistas[rm.Nombre] {
						vistas[rm.Nombre] = true
						ramas = append(ramas, rm)
					}
				}
			}
			for _, rm := range ramas {
				// Una rama local se referencia por su nombre pelado; una remota, con `origin/`. Todo lo
				// que sigue —el log, el `cherry` contra cada ambiente— usa este ref, no el nombre.
				ref := "origin/" + rm.Nombre
				if rm.Local {
					ref = rm.Nombre
				}
				r := RamaTarea{
					Repo:    filepath.Base(repo),
					Rama:    rm.Nombre,
					Local:   rm.Local,
					En:      map[string]bool{},
					Propios: map[string]int{},
					Como:    map[string]string{},
				}
				if out, err := git(ctx, repo, "log", "-1", "--format=%h|%s", ref); err == nil {
					if h, asunto, ok := strings.Cut(strings.TrimSpace(out), "|"); ok {
						r.Commit, r.Asunto = h, asunto
					}
				}
				// El PR se pide ANTES de medir los ambientes: su commit de merge es la segunda señal
				// cuando el patch-id ya no coincide (squash con el mensaje o el contenido editados).
				r.PR = prs.de(ctx, repo, rm.Nombre)
				for _, amb := range ambientes {
					en, propios, como := alcanza(ctx, repo, ref, amb, r.PR)
					if como == "" && !en && propios == 0 {
						continue // el ambiente no existe en este repo: no se inventa un "no llegó"
					}
					r.En[amb], r.Propios[amb], r.Como[amb] = en, propios, como
				}
				res.Ramas = append(res.Ramas, r)
			}
		}
		sort.Slice(res.Ramas, func(i, j int) bool {
			if res.Ramas[i].Repo != res.Ramas[j].Repo {
				return res.Ramas[i].Repo < res.Ramas[j].Repo
			}
			return res.Ramas[i].Rama < res.Ramas[j].Rama
		})
		return res
	}
}

// prCache: los PRs se piden UNA vez por repo y se reusan para todas las tareas —dos tareas que tocan el
// mismo repo no deben pagar dos llamadas a la red—, y las ramas que la lista no cubrió se preguntan una
// vez cada una. Con las tareas en paralelo, el mapa necesita candado.
type prCache struct {
	mu      sync.Mutex
	porRepo map[string]map[string]*PullRequest // nil = gh no contestó para ese repo
}

func (c *prCache) de(ctx context.Context, repo, rama string) *PullRequest {
	c.mu.Lock()
	defer c.mu.Unlock()
	m, visto := c.porRepo[repo]
	if !visto {
		m = prsDelRepo(ctx, repo)
		c.porRepo[repo] = m
	}
	if m == nil {
		return nil
	}
	if pr, ok := m[rama]; ok {
		return pr
	}
	// gh SÍ contestó y esta rama no estaba entre los 200 más nuevos: se pregunta por ella. Se guarda
	// aunque sea nil, para no repetir la llamada si otra tarea declara la misma rama.
	pr := prDeRama(ctx, repo, rama)
	m[rama] = pr
	return pr
}

// alcanza contesta, para UNA rama y UN ambiente: ¿el cambio ya está ahí, cuántos commits propios le
// quedan, y CÓMO se supo? Devuelve como="" cuando el ambiente no existe en este repo — decir "no está
// mergeado en staging" donde staging no existe sería una falsedad, y es distinto de "no llegó".
//
// DOS SEÑALES, en orden de fuerza:
//
//  1. patch-id (`git cherry`): la punta de la rama aparece en el ambiente. Reconoce el squash de UN
//     commit, porque el patch no cambia.
//  2. el commit del PR: si el PR se mergeó y su commit resultante ya es ancestro del ambiente, el
//     cambio está aunque el patch-id no coincida. Pasa con el squash de VARIOS commits, y con el de uno
//     solo cuando se edita el mensaje o el contenido al mergear.
//
// Medido el 2026-09-15: sin la segunda señal, `frontend-monorepo#983` —squasheado a `3f3f8700`, que ya
// estaba en `main`— salía como «en ningún ambiente», y la tarea de Alta Fleet afirmaba que nada suyo
// había llegado a `main`.
func alcanza(ctx context.Context, repo, ref, amb string, pr *PullRequest) (en bool, propios int, como string) {
	if _, err := git(ctx, repo, "rev-parse", "--verify", "--quiet", "origin/"+amb); err != nil {
		return false, 0, ""
	}
	out, err := git(ctx, repo, "cherry", "origin/"+amb, ref)
	if err != nil {
		return false, 0, ""
	}
	// `git cherry` lista en orden cronológico: la ÚLTIMA línea es la punta. `+` = no está en el
	// ambiente, `-` = sí está. Sin líneas = la rama no tiene nada propio, o sea que ya está entera.
	puntaDentro := true
	for _, l := range strings.Split(strings.TrimSpace(out), "\n") {
		if l = strings.TrimSpace(l); l == "" {
			continue
		}
		if strings.HasPrefix(l, "+") {
			propios++
		}
		puntaDentro = strings.HasPrefix(l, "-")
	}
	if puntaDentro {
		return true, propios, "patch"
	}
	if pr != nil && pr.Estado == "MERGED" && pr.MergeCommit != "" {
		if _, err := git(ctx, repo, "merge-base", "--is-ancestor", pr.MergeCommit, "origin/"+amb); err == nil {
			return true, propios, "pr"
		}
	}
	return false, propios, "no"
}

// RamaSuelta es una rama vista en un repo, sin atarla a ninguna tarea. Es la materia prima de la
// SUGERENCIA de patrones: las tareas que no declaran `ramas:` no se pueden medir, y adivinar el patrón
// a ciegas es peor que no tenerlo (un patrón ancho no falla, MIENTE). Así que se listan las ramas
// reales, con su fecha, y quien decide ve qué traería cada candidato antes de escribirlo.
type RamaSuelta struct {
	Repo   string `json:"repo"`
	Rama   string `json:"rama"`
	Fecha  string `json:"fecha"` // YYYY-MM-DD del último commit
	Local  bool   `json:"local,omitempty"`
	Asunto string `json:"asunto,omitempty"`
}

// TodasLasRamas lista las ramas de todos los repos bajo root en UNA pasada (dos llamadas a git por
// repo), para poder cruzarlas en memoria contra muchas tareas sin pagar una búsqueda por tarea.
func TodasLasRamas(ctx context.Context, root string) []RamaSuelta {
	var out []RamaSuelta
	for _, repo := range reposEn(root) {
		nombre := filepath.Base(repo)
		for _, ref := range []string{"refs/remotes/origin", "refs/heads"} {
			txt, err := git(ctx, repo, "for-each-ref", "--format=%(refname:short)|%(committerdate:short)|%(contents:subject)", ref)
			if err != nil {
				continue
			}
			for _, l := range strings.Split(txt, "\n") {
				partes := strings.SplitN(strings.TrimSpace(l), "|", 3)
				if len(partes) < 2 || partes[0] == "" || strings.HasSuffix(partes[0], "/HEAD") {
					continue
				}
				nom, local := partes[0], ref == "refs/heads"
				if !local {
					nom = strings.TrimPrefix(nom, "origin/")
				}
				asunto := ""
				if len(partes) == 3 {
					asunto = partes[2]
				}
				out = append(out, RamaSuelta{Repo: nombre, Rama: nom, Fecha: partes[1], Local: local, Asunto: asunto})
			}
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Fecha > out[j].Fecha })
	return out
}

// reposEn lista los repos git bajo root, bajando un nivel extra (en `github/` conviven repos sueltos y
// una carpeta paraguas con un repo por servicio adentro). Mismo criterio que el pulso.
func reposEn(root string) []string {
	var out []string
	var mirar func(dir string, depth int)
	mirar = func(dir string, depth int) {
		entradas, err := os.ReadDir(dir)
		if err != nil {
			return
		}
		for _, e := range entradas {
			if !e.IsDir() || strings.HasPrefix(e.Name(), ".") || e.Name() == "node_modules" || e.Name() == "vendor" {
				continue
			}
			hijo := filepath.Join(dir, e.Name())
			if _, err := os.Stat(filepath.Join(hijo, ".git")); err == nil {
				out = append(out, hijo)
			}
			if depth > 0 {
				mirar(hijo, depth-1)
			}
		}
	}
	mirar(root, 1)
	return out
}

// ramasQueMatchean devuelve las ramas cuyo nombre contiene el patrón: primero las REMOTAS (sin el
// `origin/`) y después las locales que no tengan remota con el mismo nombre, marcadas como locales.
//
// Al principio esto miraba SÓLO remotas —"lo que importa es qué existe para el equipo"— y eso tenía un
// agujero sistemático: al mergear un PR la rama remota se borra, así que el campo dejaba de encontrar
// nada justo para las tareas TERMINADAS, que es cuando más se quiere el historial. Medido el 2026-08-19:
// `feat/credifamilia-add-ciudad-nacimiento-field` mergeó por el PR #1013, su remota ya no está y la única
// copia viva es local. Con sólo remotas, esa tarea no tenía ramas y el hueco se leía como "nunca se
// trabajó". Se marcan para no confundir "nadie la vio" con "ya está adentro": la columna del ambiente
// dice cuál de las dos es.
func ramasQueMatchean(ctx context.Context, repo, patron string) []rama {
	var out []rama
	vistas := map[string]bool{}
	if txt, err := git(ctx, repo, "for-each-ref", "--format=%(refname:short)", "refs/remotes/origin"); err == nil {
		for _, l := range strings.Split(txt, "\n") {
			l = strings.TrimSpace(l)
			if l == "" || strings.HasSuffix(l, "/HEAD") || !strings.HasPrefix(l, "origin/") {
				continue
			}
			corta := strings.TrimPrefix(l, "origin/")
			if strings.Contains(corta, patron) && !vistas[corta] {
				vistas[corta] = true
				out = append(out, rama{Nombre: corta})
			}
		}
	}
	if txt, err := git(ctx, repo, "for-each-ref", "--format=%(refname:short)", "refs/heads"); err == nil {
		for _, l := range strings.Split(txt, "\n") {
			l = strings.TrimSpace(l)
			if l == "" || !strings.Contains(l, patron) || vistas[l] {
				continue
			}
			vistas[l] = true
			out = append(out, rama{Nombre: l, Local: true})
		}
	}
	return out
}

// rama es el resultado interno de la búsqueda: el nombre y si sólo existe en esta máquina.
type rama struct {
	Nombre string
	Local  bool
}

// GuardarSnapshotRamas escribe el snapshot. Va a `data/cache/` porque es descartable: se regenera
// midiendo de nuevo, y por eso está fuera de git (igual que el snapshot del sprint y el pulso).
func GuardarSnapshotRamas(dir string, s SnapshotRamas) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	b, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, "ramas.json"), append(b, '\n'), 0o644)
}

// LeerSnapshotRamas devuelve el snapshot guardado. Si no existe, devuelve uno vacío sin error: no
// haber medido todavía es un estado normal, no una falla — la card lo dice y ofrece medir.
func LeerSnapshotRamas(dir string) SnapshotRamas {
	var s SnapshotRamas
	b, err := os.ReadFile(filepath.Join(dir, "ramas.json"))
	if err != nil {
		return SnapshotRamas{Tareas: map[string]RamasDeTarea{}}
	}
	if err := json.Unmarshal(b, &s); err != nil || s.Tareas == nil {
		return SnapshotRamas{Tareas: map[string]RamasDeTarea{}}
	}
	return s
}

// ── PRs: la mitad que git no sabe ────────────────────────────────────────────────────────────────

var ghBin = func() string {
	if p, err := exec.LookPath("gh"); err == nil {
		return p
	}
	return ""
}()

// reRemoto saca `owner/repo` de la URL del remoto. Cubre las tres formas que aparecen en estos repos:
// `git@github.com:o/r.git`, `https://github.com/o/r.git` y —la que casi se pasó— `git@github.com-alias:o/r.git`,
// que es un host SSH con alias para usar otra llave.
var reRemoto = regexp.MustCompile(`[:/]([\w.-]+)/([\w.-]+?)(?:\.git)?$`)

func ownerRepo(ctx context.Context, dir string) string {
	out, err := git(ctx, dir, "remote", "get-url", "origin")
	if err != nil {
		return ""
	}
	m := reRemoto.FindStringSubmatch(strings.TrimSpace(out))
	if m == nil {
		return ""
	}
	return m[1] + "/" + m[2]
}

// prsDelRepo pide los PRs de un repo en UNA llamada y los indexa por rama de origen. Devuelve nil si no
// se puede preguntar (sin `gh`, sin sesión, sin red): las ramas se muestran igual, sólo sin sus PRs.
//
// `--state all` a propósito: un PR ya mergeado o cerrado es justamente lo que explica por qué una rama
// que "falta en main" en realidad ya llegó, o por qué otra quedó abandonada.
//
// ⚠ Trae los 200 MÁS NUEVOS, y eso es una ventana, no el repo: medido el 2026-09-14, en legacy-backend
// llegaba hasta el 24/8, en frontend-monorepo hasta el 13/8. Todo PR anterior salía como «sin PR» —
// incluido uno ABIERTO contra main (legacy-backend #1043). Por eso las ramas que quedan sin PR acá se
// vuelven a preguntar una por una con `prDeRama`: pocas llamadas, y sólo para los huecos.
func prsDelRepo(ctx context.Context, dir string) map[string]*PullRequest {
	slug := ownerRepo(ctx, dir)
	if ghBin == "" || slug == "" {
		return nil
	}
	crudos, ok := ghPRs(ctx, dir, slug, "--limit", "200")
	if !ok {
		return nil
	}
	return indexarPRs(crudos)
}

// prDeRama busca el PR de UNA rama, para las que la ventana de `prsDelRepo` no alcanzó. Devuelve nil si
// no hay o no se pudo preguntar.
//
// ⚠ `--search head:x` NO es exacto: `head:feature/pais-como-dato` devuelve también
// `feature/pais-como-dato-onto-develop`. Por eso se filtra por nombre exacto después de traerlos.
func prDeRama(ctx context.Context, dir, rama string) *PullRequest {
	slug := ownerRepo(ctx, dir)
	if ghBin == "" || slug == "" {
		return nil
	}
	crudos, ok := ghPRs(ctx, dir, slug, "--search", "head:"+rama, "--limit", "20")
	if !ok {
		return nil
	}
	return indexarPRs(crudos)[rama]
}

type prCrudo struct {
	Number         int    `json:"number"`
	State          string `json:"state"`
	HeadRefName    string `json:"headRefName"`
	BaseRefName    string `json:"baseRefName"`
	URL            string `json:"url"`
	ReviewDecision string `json:"reviewDecision"`
	MergedAt       string `json:"mergedAt"`
	IsDraft        bool   `json:"isDraft"`
	MergeCommit    struct {
		OID string `json:"oid"`
	} `json:"mergeCommit"`
}

// ghPRs es la única forma de hablar con `gh pr list` acá: mismos campos, misma degradación (ok=false si
// falló, y quien llama muestra la rama sin PR en vez de romper).
func ghPRs(ctx context.Context, dir, slug string, extra ...string) ([]prCrudo, bool) {
	args := append([]string{"pr", "list", "--repo", slug, "--state", "all",
		"--json", "number,state,headRefName,baseRefName,url,reviewDecision,mergedAt,isDraft,mergeCommit"}, extra...)
	cmd := exec.CommandContext(ctx, ghBin, args...)
	cmd.Dir = dir
	var sb strings.Builder
	cmd.Stdout = &sb
	if err := cmd.Run(); err != nil {
		return nil, false
	}
	var crudos []prCrudo
	if err := json.Unmarshal([]byte(sb.String()), &crudos); err != nil {
		return nil, false
	}
	return crudos, true
}

// indexarPRs pasa de la lista de gh al mapa rama → PR. Si una rama tuvo VARIOS PRs, gana el de número
// más alto: es el intento vigente. Quedarse con el primero mostraría un PR viejo y cerrado como si
// fuera el estado de hoy.
func indexarPRs(crudos []prCrudo) map[string]*PullRequest {
	out := map[string]*PullRequest{}
	for _, p := range crudos {
		if prev, ok := out[p.HeadRefName]; ok && prev.Numero > p.Number {
			continue
		}
		out[p.HeadRefName] = &PullRequest{
			Numero: p.Number, Estado: p.State, Base: p.BaseRefName, URL: p.URL,
			Revision: p.ReviewDecision, Draft: p.IsDraft, Mergeado: p.MergedAt,
			MergeCommit: p.MergeCommit.OID,
		}
	}
	return out
}
