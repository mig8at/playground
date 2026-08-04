// Package pulso contesta UNA pregunta: ¿en qué momentos del día toqué el código de la compañía?
//
// LA UNIDAD ES EL SLOT DE 5 MINUTOS, no "los minutos trabajados". Estimar minutos desde git es mentira
// prolija: un commit a las 18:00 no dice cuándo empezaste. Un tick que sólo contesta *¿hubo cambios, sí o
// no?* no se puede falsear. Una hora tiene 12 slots, así que la celda de la jornada se llena de 0 a 12 y
// el total del día es slots × 5' — tiempo con cambios REALES, no una estimación.
//
// CADA SEÑAL LLEVA SU PROPIO INSTANTE, no el del tick. Eso es lo que hace que un tick corrido después de
// un hueco (Mac dormido, agente caído, fin de semana) reparta lo que encuentra en las horas en las que de
// verdad pasó, en vez de amontonarlo en el momento en que se despertó. Y es lo que permite SEMBRAR hacia
// atrás: los commits y el reflog ya viven en git con su fecha, así que el mapa se llena el día uno.
//
// TRES SEÑALES, en orden de cuánto prueban:
//
//	edit    archivo sucio (según git) con mtime dentro de la ventana  → estabas editando en ese momento
//	commit  commit tuyo con fecha de commit dentro de la ventana      → cerraste algo
//	reflog  checkout, rebase, stash, pull, amend                      → estabas operando el repo
//
// Las tres hacen falta y ninguna sobra. `commit` sola deja huecos donde sí trabajaste (los commits se
// agrupan). `reflog` es lo ÚNICO que registra trabajo que no deja commit — hoy legacy-backend tiene 6
// stashes. Y `edit` es lo único que ve el trabajo en curso: el mtime se pierde al commitear, así que si
// nadie lo muestrea esas horas no existen para nadie. De ahí que esto tenga que correr como cron y no
// al abrir el tablero.
//
// git se invoca con --no-optional-locks a propósito: esto corre en background cada 5 minutos y no puede
// quedarse con el lock del index justo cuando estás haciendo un commit a mano.
//
// CONVENCIÓN: identificadores en inglés, comentarios y texto visible en español (como el resto del
// tablero).
package pulso

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Slot es la unidad de tiempo del pulso: la resolución con la que se puede decir "acá hubo trabajo".
const Slot = 5 * time.Minute

// SlotsPerHour es cuántos slots entran en una hora — el máximo que puede marcar una celda de la jornada.
const SlotsPerHour = int(time.Hour / Slot) // 12

// perRepoTimeout corta un git colgado (repo en un disco de red, index bloqueado por otra cosa). Sin esto
// un solo repo trabado dejaría al agente sin registrar el resto.
const perRepoTimeout = 20 * time.Second

// Signal es UN indicio de actividad, con el instante en que ocurrió. `At` es el instante de la SEÑAL, no
// el del tick que la encontró: es lo que hace que el reparto por horas sea correcto tras un hueco.
type Signal struct {
	Repo   string `json:"repo"`
	Branch string `json:"branch,omitempty"`
	At     string `json:"at"`  // RFC3339 con offset local
	Why    string `json:"why"` // edit | commit | reflog
	Files  int    `json:"files,omitempty"`
	Ins    int    `json:"ins,omitempty"`
	Del    int    `json:"del,omitempty"`
	What   string `json:"what,omitempty"` // asunto del commit o acción del reflog: para leer la línea sin abrir git
}

// Tick es una corrida del pulso: qué ventana miró y qué encontró. Se anota SIEMPRE, incluso vacío —
// un tick sin señales dice "el equipo estaba prendido y no toqué nada", que es distinto de que no haya
// tick (equipo apagado o agente caído). La jornada muestra esa diferencia en vez de inventarla.
type Tick struct {
	T       string   `json:"t"`
	Since   string   `json:"since"`
	Signals []Signal `json:"signals,omitempty"`
}

// Config es lo que el pulso necesita saber. Todo tiene default y todo se puede pisar por entorno, porque
// el agente de launchd corre sin shell: lo que no venga en el plist no existe.
type Config struct {
	Root   string        // dónde viven los repos de la compañía
	Emails []string      // qué autor soy yo (los commits ajenos que llegan por `pull` NO son mi jornada)
	MaxGap time.Duration // techo de la ventana de un tick: acota el costo tras un hueco largo
}

// DefaultEmails son las identidades con las que Miguel firma. Son TRES porque los repos no están
// configurados igual (legacy-backend commitea como `mig-creditop@users.noreply.github.com`), y filtrar
// por una sola dejaría fuera justo el repo donde más se trabaja.
var DefaultEmails = []string{
	"miguel.ochoa@creditop.com",
	"miguel@creditop.com",
	"mig-creditop@users.noreply.github.com",
}

// Load arma la config desde el entorno.
func Load() Config {
	c := Config{
		Root:   envOr("PULSO_ROOT", filepath.Join(os.Getenv("HOME"), "Desktop", "CREDITOP", "github")),
		MaxGap: 24 * time.Hour,
	}
	for _, e := range strings.Split(envOr("PULSO_EMAILS", strings.Join(DefaultEmails, ",")), ",") {
		if e = strings.TrimSpace(e); e != "" {
			c.Emails = append(c.Emails, e)
		}
	}
	return c
}

func envOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

// ── descubrir los repos ─────────────────────────────────────────────────────────────────────────

// Repos lista los repos git bajo `root`, bajando UN nivel extra: en `github/` conviven repos sueltos
// (`legacy-backend`) y una carpeta paraguas (`microservices/`) con un repo por servicio adentro. Se
// descubren en cada tick en vez de fijarlos en una lista: clonar un repo nuevo no debería obligar a
// editar configuración para que empiece a contar.
//
// Se BAJA aunque el padre ya sea un repo. `microservices/` es las dos cosas a la vez —repo propio y
// paraguas—, y cortar ahí dejaba fuera `pdf-mapper-service`, que es justo donde hay trabajo reciente. Los
// repos anidados no son el mismo trabajo contado dos veces: tienen historia propia.
func Repos(root string) []string {
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
			// `.git` puede ser carpeta o ARCHIVO (worktrees y submódulos): mirar sólo carpetas dejaría
			// fuera cualquier worktree, que es justo donde uno trabaja en paralelo.
			if _, err := os.Stat(filepath.Join(hijo, ".git")); err == nil {
				out = append(out, hijo)
			}
			if depth > 0 {
				mirar(hijo, depth-1)
			}
		}
	}
	mirar(root, 1)
	sort.Strings(out)
	return out
}

// Name es cómo se llama un repo en el registro: su ruta RELATIVA a la raíz, no el último segmento. Con el
// último segmento, `onboarding-forms-service` (que existe suelto y dentro de `microservices/`) sería el
// mismo nombre para dos repos distintos, y las dos jornadas se sumarían en una.
func Name(root, repo string) string {
	if rel, err := filepath.Rel(root, repo); err == nil {
		return rel
	}
	return filepath.Base(repo)
}

// ── el tick ─────────────────────────────────────────────────────────────────────────────────────

// Run mira todos los repos en paralelo y devuelve el tick. La ventana es [since, now): quien llama la
// decide (el tick normal usa "desde el tick anterior", la siembra usa "hace N días").
//
// En paralelo porque son ~19 repos × 3 comandos de git: en serie son un par de segundos cada 5 minutos,
// y un agente de fondo que se hace notar termina desinstalado.
func Run(cfg Config, since, now time.Time) Tick {
	repos := Repos(cfg.Root)
	res := make([][]Signal, len(repos))
	var wg sync.WaitGroup
	for i, r := range repos {
		wg.Add(1)
		go func(i int, r string) {
			defer wg.Done()
			res[i] = Probe(cfg.Root, r, since, cfg.Emails)
		}(i, r)
	}
	wg.Wait()

	t := Tick{T: now.Format(time.RFC3339), Since: since.Format(time.RFC3339)}
	for _, s := range res {
		t.Signals = append(t.Signals, s...)
	}
	sort.Slice(t.Signals, func(i, j int) bool { return t.Signals[i].At < t.Signals[j].At })
	return t
}

// Probe interroga UN repo y devuelve las señales que caen en la ventana. Nunca falla: un repo roto o a
// medio clonar simplemente no aporta señales — el pulso no puede caerse por un repo.
func Probe(root, repo string, since time.Time, emails []string) []Signal {
	ctx, cancel := context.WithTimeout(context.Background(), perRepoTimeout)
	defer cancel()

	name := Name(root, repo)
	branch, _ := git(ctx, repo, "rev-parse", "--abbrev-ref", "HEAD")
	branch = strings.TrimSpace(branch)

	var out []Signal
	if s, ok := editSignal(ctx, repo, name, branch, since); ok {
		out = append(out, s)
	}
	out = append(out, commitSignals(ctx, repo, name, branch, since, emails)...)
	out = append(out, reflogSignals(ctx, repo, name, branch, since)...)
	return out
}

// editSignal mira el working tree: qué archivos ve git como sucios y CUÁNDO se tocaron por última vez.
// Devuelve una sola señal —la del archivo tocado más recientemente— porque la pregunta es "¿estabas
// editando?", no "cuántos archivos". El conteo va adentro para el tooltip.
//
// Sólo cuenta si el mtime cae DENTRO de la ventana: un archivo que quedó sucio ayer no prueba que hoy
// estés trabajando, y sumarlo pintaría de verde un día que no existió.
func editSignal(ctx context.Context, repo, name, branch string, since time.Time) (Signal, bool) {
	// -uall lista los archivos sueltos en vez de colapsar la carpeta que los contiene. Importa para el
	// mtime: el de una CARPETA sólo cambia si se agregan o borran entradas, no si editás un archivo
	// adentro — con el default, editar dentro de una carpeta sin seguimiento no dejaba señal. Medido:
	// cuesta lo mismo (~25 ms en frontend-monorepo).
	salida, err := git(ctx, repo, "status", "--porcelain=v1", "-z", "--untracked-files=all")
	if err != nil || salida == "" {
		return Signal{}, false
	}

	var ultimo time.Time
	archivos := 0
	for _, chunk := range strings.Split(salida, "\x00") {
		if chunk == "" {
			continue
		}
		ruta := chunk
		// Formato porcelain: `XY <ruta>`. En un rename, el NUL siguiente trae la ruta ORIGEN sin
		// encabezado — se stat-ea igual y, como ya no existe, se descarta sola.
		if len(chunk) > 3 && chunk[2] == ' ' {
			ruta = chunk[3:]
		}
		completa := filepath.Join(repo, ruta)
		// Un REPO ANIDADO se ve como una entrada sin seguimiento y git no puede mirar adentro (ni con
		// -uall). `microservices/` es exactamente ese caso: ve sus 6 servicios como carpetas sueltas, así
		// que se "ensuciaba" cada vez que se trabajaba en cualquiera de ellos y se llevaba a su nombre
		// horas que eran de otro repo. Se salta: cada uno ya se mide por su cuenta.
		if strings.HasSuffix(ruta, "/") {
			if _, err := os.Stat(filepath.Join(completa, ".git")); err == nil {
				continue
			}
		}
		fi, err := os.Stat(completa)
		if err != nil {
			continue
		}
		archivos++
		if m := fi.ModTime(); m.After(ultimo) {
			ultimo = m
		}
	}
	if archivos == 0 || ultimo.Before(since) {
		return Signal{}, false
	}

	// +/- del working tree: es un ESTADO acumulado (no un delta), así que la agregación no lo suma —
	// se guarda para poder decir "3 archivos, +48/-7 sin commitear" en el tooltip.
	ins, del := 0, 0
	if st, err := git(ctx, repo, "diff", "--shortstat", "HEAD"); err == nil {
		ins, del = parseShortstat(st)
	}
	return Signal{
		Repo: name, Branch: branch, At: ultimo.Format(time.RFC3339), Why: "edit",
		Files: archivos, Ins: ins, Del: del,
	}, true
}

// commitSignals trae MIS commits de la ventana, con su fecha de COMMIT (no la de autoría). Es la fecha
// correcta para esto: un rebase o un amend reescriben la de commit, y ese momento —cuando la reescribiste—
// es cuando estabas trabajando. La de autoría se quedaría anclada al día original.
//
// Filtra por autor porque `--all` incluye lo que bajó de otras ramas: los commits de tus compañeros que
// llegan con un `pull` no son tu jornada.
func commitSignals(ctx context.Context, repo, name, branch string, since time.Time, emails []string) []Signal {
	args := []string{"log", "--all", "--since=" + since.Format(time.RFC3339)}
	for _, e := range emails {
		args = append(args, "--author="+e)
	}
	// \x1f (separador de campos de ASCII) en vez de `|`: los asuntos de commit traen pipes y comillas,
	// y elegir de separador un carácter que aparece en el dato es el bug de parseo casero de siempre.
	args = append(args, "--format=C\x1f%ct\x1f%s", "--shortstat")

	salida, err := git(ctx, repo, args...)
	if err != nil {
		return nil
	}
	var out []Signal
	for _, l := range strings.Split(salida, "\n") {
		if strings.HasPrefix(l, "C\x1f") {
			campos := strings.SplitN(l, "\x1f", 3)
			if len(campos) < 3 {
				continue
			}
			seg, err := strconv.ParseInt(campos[1], 10, 64)
			if err != nil {
				continue
			}
			out = append(out, Signal{
				Repo: name, Branch: branch, Why: "commit", What: campos[2],
				At: time.Unix(seg, 0).Local().Format(time.RFC3339),
			})
			continue
		}
		// El --shortstat del commit anterior. Los merges no lo traen (git no muestra su diff), así que
		// quedan con 0 líneas: correcto, un merge no es código escrito.
		if strings.Contains(l, "file") && strings.Contains(l, "changed") && len(out) > 0 {
			ins, del := parseShortstat(l)
			out[len(out)-1].Ins, out[len(out)-1].Del = ins, del
			out[len(out)-1].Files = parseFilesChanged(l)
		}
	}
	return out
}

// reflogSignals lee el reflog de HEAD: checkout, rebase, stash, pull, amend, reset. Es la única señal que
// ve el trabajo que NO deja commit, y a diferencia de los commits no se filtra por autor — el reflog es
// local por definición: si está ahí, es porque vos corriste ese comando en esta máquina.
func reflogSignals(ctx context.Context, repo, name, branch string, since time.Time) []Signal {
	salida, err := git(ctx, repo, "reflog", "--date=iso-strict", "--format=%gd\x1f%gs", "-n", "200")
	if err != nil {
		return nil
	}
	var out []Signal
	for _, l := range strings.Split(salida, "\n") {
		campos := strings.SplitN(l, "\x1f", 2)
		if len(campos) < 2 {
			continue
		}
		// `%gd` con --date=iso-strict viene como `HEAD@{2026-08-03T15:10:11-05:00}`
		a, b := strings.Index(campos[0], "{"), strings.LastIndex(campos[0], "}")
		if a < 0 || b <= a {
			continue
		}
		cuando, err := time.Parse(time.RFC3339, campos[0][a+1:b])
		if err != nil {
			continue
		}
		// El reflog viene del más nuevo al más viejo: en cuanto uno queda fuera de la ventana, el resto
		// también. Cortar acá es lo que lo hace barato en repos con miles de entradas.
		if cuando.Before(since) {
			break
		}
		out = append(out, Signal{
			Repo: name, Branch: branch, Why: "reflog", What: campos[1],
			At: cuando.Local().Format(time.RFC3339),
		})
	}
	return out
}

// ── plomería de git ─────────────────────────────────────────────────────────────────────────────

// gitBin se resuelve una sola vez. El fallback absoluto importa: launchd corre el agente con un PATH
// mínimo, así que confiar en `git` a secas es la forma clásica de que el cron "no haga nada" en silencio.
var gitBin = func() string {
	if p, err := exec.LookPath("git"); err == nil {
		return p
	}
	return "/usr/bin/git"
}()

func git(ctx context.Context, dir string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, gitBin, append([]string{"--no-optional-locks"}, args...)...)
	cmd.Dir = dir
	// Sin terminal ni credenciales: un repo con remoto que pida usuario dejaría al agente esperando
	// para siempre, y nada de lo que hacemos acá habla con la red.
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0", "GIT_OPTIONAL_LOCKS=0")
	var sb strings.Builder
	cmd.Stdout = &sb
	if err := cmd.Run(); err != nil {
		return sb.String(), err
	}
	return sb.String(), nil
}

// parseShortstat saca las líneas de " 3 files changed, 48 insertions(+), 7 deletions(-)".
func parseShortstat(s string) (ins, del int) {
	for _, parte := range strings.Split(s, ",") {
		parte = strings.TrimSpace(parte)
		n, resto, ok := strings.Cut(parte, " ")
		if !ok {
			continue
		}
		v, err := strconv.Atoi(n)
		if err != nil {
			continue
		}
		switch {
		case strings.HasPrefix(resto, "insertion"):
			ins = v
		case strings.HasPrefix(resto, "deletion"):
			del = v
		}
	}
	return
}

func parseFilesChanged(s string) int {
	campo := strings.TrimSpace(s)
	n, _, ok := strings.Cut(campo, " ")
	if !ok {
		return 0
	}
	v, _ := strconv.Atoi(n)
	return v
}
