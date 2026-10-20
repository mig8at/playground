package hooks

/* index-guard: frena los comandos de git que stagean o commitean MÁS de lo que la sesión nombró.
 *
 * EL PROBLEMA: Miguel corre varias sesiones sobre el mismo worktree, y el índice de git es UNO para
 * todas. Un `git add -A` se lleva los cambios de otra sesión; un `git commit` sin rutas se lleva lo que
 * otra sesión dejó stageado. Pasó más de una vez (2026-09-10, 09-19, 09-23: el trabajo quedó bajo el
 * mensaje de otro commit) y el 2026-09-27 una sesión entera corrió con un archivo ajeno en el índice.
 * Estaba escrito como regla en la memoria; una regla que depende de acordarse se olvida.
 *
 * Por qué no un worktree por sesión: medido ese mismo día, el playground no anda desde un worktree
 * —los `.env`, la bitácora y las cachés están fuera de git—, y falla en silencio (`make bitacora` dice
 * «0 asientos»). Esto ataca el choque real sin cambiar cómo se trabaja.
 *
 * Qué frena, sólo en posición de comando (nombrar `git commit` en un grep o en un mensaje no cuenta):
 *   - `git add -A|--all|-u|--update|.|:/` SIN otras rutas — con rutas (`git add -A -- tools/x`) pasa;
 *   - `git commit -a|--all` (también combinado: `-am`, `-qam`);
 *   - `git commit` SIN rutas, salvo que el MISMO comando haya stageado antes rutas explícitas
 *     (`git add x && git commit …`): ése es el patrón seguro, porque no deja ventana entre los dos.
 * Si de verdad el índice es tuyo, se mira con `git diff --cached --name-only` y se agrega
 * I_CHECKED_THE_INDEX=1 al comando.
 *
 * SÓLO DENTRO DEL PLAYGROUND: el índice compartido es el de este worktree. En otro repo (vtex, shopify,
 * legacy-backend) cada sesión tiene el suyo, y frenar ahí sólo estorbaba: el 2026-10-20 bloqueó el squash de
 * un PR (`reset --soft` + `commit`). La carpeta se sigue por el `cwd` del hook, los `cd <carpeta>` del comando
 * y `git -C <carpeta>`; si no se puede saber (un `cd $repo`), se frena igual. */

import (
	"fmt"
	"path/filepath"
	"strings"

	"creditop/playground/lib/shell"
)

// IndexOverride es lo que deja pasar un commit sin rutas cuando ya se miró el índice.
const IndexOverride = "I_CHECKED_THE_INDEX=1"

// gitGlobalWithValue son las opciones de `git` que van ANTES del subcomando y llevan un valor aparte.
var gitGlobalWithValue = map[string]bool{"-C": true, "-c": true, "--git-dir": true, "--work-tree": true, "--namespace": true}

// commitWithValue son las opciones de `git commit` que consumen el token siguiente.
var commitWithValue = map[string]bool{
	"-m": true, "--message": true, "-F": true, "--file": true, "-C": true, "--reuse-message": true,
	"-c": true, "--reedit-message": true, "--author": true, "--date": true, "--fixup": true, "--squash": true,
	"-t": true, "--template": true, "--cleanup": true, "--trailer": true,
}

// broadAdd son las formas de `git add` que toman el árbol entero.
var broadAdd = map[string]bool{"-A": true, "--all": true, "-u": true, "--update": true, ".": true, ":/": true, "--no-ignore-removal": true}

// gitCall: el subcomando de git de un segmento y sus argumentos, o "" si el segmento no corre git.
// Se parte el segmento UNA vez: `executable` devuelve el resto re-unido con espacios, sin las comillas,
// y re-partirlo convertía el mensaje «quita el flag -a» en un `-a` de verdad.
func gitCall(seg string) (string, []string) {
	toks := shell.Program(seg)
	if len(toks) == 0 || name(toks[0]) != "git" {
		return "", nil
	}
	toks = toks[1:]
	i := 0
	for i < len(toks) && strings.HasPrefix(toks[i], "-") {
		if gitGlobalWithValue[toks[i]] {
			i++
		}
		i++
	}
	if i >= len(toks) {
		return "", nil
	}
	return toks[i], toks[i+1:]
}

// commitPaths: si el commit nombra rutas (posicionales, después de `--` o por archivo), y si lleva -a.
func commitPaths(args []string) (paths bool, all bool) {
	for i := 0; i < len(args); i++ {
		a := args[i]
		switch {
		case a == "--":
			return i+1 < len(args) || paths, all
		case strings.HasPrefix(a, "--pathspec-from-file"):
			paths = true
		case a == "--all":
			all = true
		case strings.HasPrefix(a, "--"):
			if name, _, hasValue := strings.Cut(a, "="); !hasValue && commitWithValue[name] {
				i++
			}
		case strings.HasPrefix(a, "-") && len(a) > 1:
			// flags cortos combinados: `-qam "msg"`. Uno que lleva valor corta el grupo: lo que sigue
			// pegado es su valor (`-mmsg`) o, si no hay nada, el valor es el token siguiente.
			for j := 1; j < len(a); j++ {
				f := "-" + string(a[j])
				if f == "-a" {
					all = true
				}
				if commitWithValue[f] {
					if j == len(a)-1 {
						i++
					}
					break
				}
			}
		case isRedirect(a):
			// `>/dev/null`, `2>&1`: no son rutas. Contarlas dejaba pasar un commit sin rutas (2026-10-20).
		default:
			paths = true
		}
	}
	return paths, all
}

// isRedirect: si el token es una redirección del shell (`>x`, `2>&1`, `<x`, `&>x`).
func isRedirect(tok string) bool {
	t := strings.TrimLeft(tok, "0123456789&")
	return strings.HasPrefix(t, ">") || strings.HasPrefix(t, "<")
}

// IndexGuard es la decisión sobre un comando sin saber en qué carpeta corre: frena como si fuera el playground.
func IndexGuard(cmd string) []string { return IndexGuardIn(cmd, "", "", "") }

// IndexGuardIn es la decisión sabiendo la carpeta donde arranca el comando (`cwd`), la raíz del playground
// (`root`) y el HOME (para `cd ~/…`): un git que corre fuera del playground no se frena.
func IndexGuardIn(cmd, cwd, root, home string) []string {
	if cmd == "" || !strings.Contains(cmd, "git") || strings.Contains(cmd, IndexOverride) {
		return nil
	}
	var reasons []string
	stagedExplicitly := false
	dir, known := cwd, cwd != "" && root != ""
	for _, seg := range shell.Segments(cmd) {
		if toks := shell.Program(seg); len(toks) > 0 && toks[0] == "cd" {
			if len(toks) < 2 {
				dir, known = home, home != ""
			} else if next, ok := resolveDir(dir, toks[1], home); ok && (known || anchored(toks[1])) {
				dir, known = next, true
			} else {
				known = false
			}
			continue
		}
		sub, args := gitCall(seg)
		if sub == "" {
			continue
		}
		at, atKnown := dir, known
		if target, ok := gitDirFlag(seg); ok {
			at, atKnown = resolveDir(dir, target, home)
			atKnown = atKnown && (known || anchored(target))
		}
		if atKnown && !inside(at, root) {
			continue
		}
		switch sub {
		case "add":
			broad, named := false, false
			for _, a := range args {
				switch {
				case broadAdd[a]:
					broad = true
				case a == "--" || strings.HasPrefix(a, "-") || isRedirect(a):
				default:
					named = true
				}
			}
			if broad && !named {
				reasons = append(reasons, "`git "+strings.TrimSpace(sub+" "+strings.Join(args, " "))+"` stagea el árbol ENTERO, "+
					"incluido lo que otra sesión está editando en este mismo worktree. Stageá por ruta: `git add <rutas>`.")
				continue
			}
			if named {
				stagedExplicitly = true
			}
		case "rm", "mv":
			stagedExplicitly = true
		case "commit":
			paths, all := commitPaths(args)
			if all {
				reasons = append(reasons, "`git commit -a` commitea TODO lo modificado, incluido lo de otra sesión. "+
					"Nombrá las rutas: `git commit -m … -- <rutas>`.")
				continue
			}
			if !paths && !stagedExplicitly {
				reasons = append(reasons, "`git commit` sin rutas se lleva TODO el índice, y el índice es uno para todas las "+
					"sesiones: lo que otra dejó stageado entra en tu commit. Nombrá las rutas (`git commit -m … -- <rutas>`) o "+
					"stageá y commiteá en el mismo comando (`git add <rutas> && git commit …`). Si miraste "+
					"`git diff --cached --name-only` y el índice es sólo tuyo, agregá "+IndexOverride+" al comando.")
			}
		}
	}
	return reasons
}

// IndexGuardHook es el hook PreToolUse (Bash).
func IndexGuardHook(env Env) int {
	payload, ok := readPayload(env.Stdin)
	if !ok {
		return 0
	}
	if tool, present := payload["tool_name"]; present && tool != nil && tool != "Bash" {
		return 0
	}
	reasons := IndexGuardIn(str(toolInput(payload), "command"), str(payload, "cwd"), env.Root, env.Home)
	if len(reasons) == 0 {
		return 0
	}
	fmt.Fprint(env.Stderr, "⛔ Bloqueado por el hook index-guard (tablero/server/internal/hooks/index_guard.go): varias sesiones "+
		"comparten este worktree y su índice de git.\n")
	for _, r := range reasons {
		fmt.Fprintf(env.Stderr, "  ✗ %s\n", r)
	}
	return 2
}

// gitDirFlag: el valor de `git -C <carpeta>` en el segmento, si lo tiene.
func gitDirFlag(seg string) (string, bool) {
	toks := shell.Program(seg)
	for i := 1; i < len(toks)-1 && strings.HasPrefix(toks[i], "-"); i++ {
		if toks[i] == "-C" {
			return toks[i+1], true
		}
		if gitGlobalWithValue[toks[i]] {
			i++
		}
	}
	return "", false
}

// resolveDir: la carpeta a la que lleva `target` desde `from`. No se sabe si usa variables o sustituciones.
func resolveDir(from, target, home string) (string, bool) {
	if strings.ContainsAny(target, "$`*?") {
		return "", false
	}
	switch {
	case target == "~" || strings.HasPrefix(target, "~/"):
		if home == "" {
			return "", false
		}
		return filepath.Clean(filepath.Join(home, strings.TrimPrefix(target, "~"))), true
	case filepath.IsAbs(target):
		return filepath.Clean(target), true
	case from == "":
		return "", false
	}
	return filepath.Clean(filepath.Join(from, target)), true
}

// inside: si dir es root o está adentro.
func inside(dir, root string) bool {
	rel, err := filepath.Rel(root, dir)
	return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

// anchored: si la ruta no depende de la carpeta actual (absoluta o desde el HOME).
func anchored(p string) bool { return filepath.IsAbs(p) || p == "~" || strings.HasPrefix(p, "~/") }
