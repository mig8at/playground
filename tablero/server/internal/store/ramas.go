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

// reRamaPatron valida el patrón del frontmatter. Se acota a propósito: es una subcadena de nombre de
// rama, no una expresión — un patrón libre acabaría matcheando ramas ajenas y la card mentiría al revés.
var reRamaPatron = regexp.MustCompile(`^[\w][\w./-]{2,}$`)

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
	for id, patron := range patrones {
		if !reRamaPatron.MatchString(patron) {
			continue
		}
		res := RamasDeTarea{Patron: patron}
		for _, repo := range repos {
			for _, rama := range ramasQueMatchean(ctx, repo, patron) {
				r := RamaTarea{
					Repo:    filepath.Base(repo),
					Rama:    rama,
					En:      map[string]bool{},
					Propios: map[string]int{},
				}
				if out, err := git(ctx, repo, "log", "-1", "--format=%h|%s", "origin/"+rama); err == nil {
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
					out, err := git(ctx, repo, "cherry", "origin/"+amb, "origin/"+rama)
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

// ramasQueMatchean devuelve las ramas REMOTAS (sin el `origin/`) cuyo nombre contiene el patrón. Se usan
// las remotas y no las locales a propósito: lo que importa es qué existe para el equipo, no qué quedó en
// esta máquina — y una rama local sin pushear todavía no es un estado que la tarea deba anunciar.
func ramasQueMatchean(ctx context.Context, repo, patron string) []string {
	out, err := git(ctx, repo, "for-each-ref", "--format=%(refname:short)", "refs/remotes/origin")
	if err != nil {
		return nil
	}
	var ramas []string
	for _, l := range strings.Split(out, "\n") {
		l = strings.TrimSpace(l)
		if l == "" || strings.HasSuffix(l, "/HEAD") || !strings.HasPrefix(l, "origin/") {
			continue
		}
		corta := strings.TrimPrefix(l, "origin/")
		if strings.Contains(corta, patron) {
			ramas = append(ramas, corta)
		}
	}
	return ramas
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
