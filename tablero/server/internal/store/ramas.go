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
	"time"
)

// AmbientesPorDefecto son las ramas que cuentan como "ambiente": si el commit está acá, está desplegado
// (o en camino). El orden es de menor a mayor riesgo, que es como conviene leerlas.
var AmbientesPorDefecto = []string{"develop", "staging", "qa", "main"}

// RamaTarea es UNA rama de trabajo de la tarea, con hasta dónde llegó.
type RamaTarea struct {
	Repo   string `json:"repo"`   // nombre corto del repo (no la ruta absoluta: la card muestra esto)
	Rama   string `json:"rama"`   // sin el prefijo `origin/`
	// Local: la rama sólo existe en esta máquina. Pasa sobre todo con las MERGEADAS —al aprobar el PR se
	// borra la remota y queda la copia local—, así que no equivale a "sin pushear": mirá los ambientes.
	Local bool `json:"local,omitempty"`
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
}

// RamasDeTarea es el resultado por tarea.
type RamasDeTarea struct {
	Patron string      `json:"patron"`
	Ramas  []RamaTarea `json:"ramas"`
}

// SnapshotRamas es lo que se guarda en disco.
type SnapshotRamas struct {
	MedidoEn string `json:"medidoEn"` // RFC3339: la card muestra "medido hace X"
	Root     string `json:"root"`     // dónde se buscaron los repos
	// Por ID de tarea (como cadena, que es lo que permite JSON). Se usa el ID y no el slug porque el
	// nombre del archivo se puede renombrar a mano —el id vive en el frontmatter y es la identidad—,
	// así que una clave por slug se orfanaría con un renombre.
	Tareas map[string]RamasDeTarea `json:"tareas"`
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
	// Los PRs se piden UNA vez por repo y se reusan para todas las tareas: dos tareas que tocan el
	// mismo repo no deben pagar dos llamadas a la red.
	prsPorRepo := map[string]map[string]*PullRequest{}
	for id, patron := range patrones {
		pats := patronesDe(patron)
		if len(pats) == 0 {
			continue
		}
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
				}
				if out, err := git(ctx, repo, "log", "-1", "--format=%h|%s", ref); err == nil {
					if h, asunto, ok := strings.Cut(strings.TrimSpace(out), "|"); ok {
						r.Commit, r.Asunto = h, asunto
					}
				}
				for _, amb := range ambientes {
					// `git cherry <upstream> <head>` lista los commits de head que NO están en upstream,
					// comparando por patch-id. Si el ambiente no existe en este repo, se omite: decir
					// "no está mergeado en staging" cuando staging no existe sería una falsedad.
					if _, err := git(ctx, repo, "rev-parse", "--verify", "--quiet", "origin/"+amb); err != nil {
						continue
					}
					out, err := git(ctx, repo, "cherry", "origin/"+amb, ref)
					if err != nil {
						continue
					}
					// `git cherry` lista en orden cronológico: la ÚLTIMA línea es la punta. `+` = no está
					// en el ambiente, `-` = sí está (llegó, incluso por squash). Sin líneas = nada propio.
					propios, puntaDentro := 0, true
					for _, l := range strings.Split(strings.TrimSpace(out), "\n") {
						l = strings.TrimSpace(l)
						if l == "" {
							continue
						}
						if strings.HasPrefix(l, "+") {
							propios++
						}
						puntaDentro = strings.HasPrefix(l, "-")
					}
					r.Propios[amb] = propios
					r.En[amb] = puntaDentro
				}
				if _, visto := prsPorRepo[repo]; !visto {
					prsPorRepo[repo] = prsDelRepo(ctx, repo)
				}
				if pr, ok := prsPorRepo[repo][rm.Nombre]; ok {
					r.PR = pr
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
		snap.Tareas[id] = res
	}
	return snap
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
func prsDelRepo(ctx context.Context, dir string) map[string]*PullRequest {
	if ghBin == "" {
		return nil
	}
	slug := ownerRepo(ctx, dir)
	if slug == "" {
		return nil
	}
	cmd := exec.CommandContext(ctx, ghBin, "pr", "list", "--repo", slug, "--state", "all", "--limit", "200",
		"--json", "number,state,headRefName,baseRefName,url,reviewDecision,mergedAt,isDraft")
	cmd.Dir = dir
	var sb strings.Builder
	cmd.Stdout = &sb
	if err := cmd.Run(); err != nil {
		return nil
	}
	var crudos []struct {
		Number         int    `json:"number"`
		State          string `json:"state"`
		HeadRefName    string `json:"headRefName"`
		BaseRefName    string `json:"baseRefName"`
		URL            string `json:"url"`
		ReviewDecision string `json:"reviewDecision"`
		MergedAt       string `json:"mergedAt"`
		IsDraft        bool   `json:"isDraft"`
	}
	if err := json.Unmarshal([]byte(sb.String()), &crudos); err != nil {
		return nil
	}
	out := map[string]*PullRequest{}
	for _, p := range crudos {
		// Si una rama tuvo VARIOS PRs, gana el de número más alto: es el intento vigente. Quedarse con
		// el primero mostraría un PR viejo y cerrado como si fuera el estado de hoy.
		if prev, ok := out[p.HeadRefName]; ok && prev.Numero > p.Number {
			continue
		}
		out[p.HeadRefName] = &PullRequest{
			Numero: p.Number, Estado: p.State, Base: p.BaseRefName, URL: p.URL,
			Revision: p.ReviewDecision, Draft: p.IsDraft, Mergeado: p.MergedAt,
		}
	}
	return out
}
