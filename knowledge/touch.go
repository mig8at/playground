package knowledge

import (
	"context"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"creditop/playground/connectors/repos"
)

/* ── EL ÍNDICE AL REVÉS: DE UN ARCHIVO A LAS SECCIONES QUE RESPALDA ────────────────────────────────
 *
 * Cada fuente ya dice qué secciones respalda. Leído al revés contesta dos preguntas sin modelo y sin red:
 * «¿qué tengo que leer para tocar estos archivos?» (los de las ramas de una tarea) y «¿qué secciones hay
 * que releer después de este cambio?» (los de un PR o un rango de main).
 *
 * POR QUÉ EXISTE. Medido el 2026-11-11: la mitad de las tareas no declaraba `knowledge:` y 20 de 43 temas
 * no los había enlazado ninguna; la biblioteca se escribía y no se leía. Declarar a mano el tema correcto
 * exige saber que existe: los archivos que una tarea toca lo dicen solos. */

// RepoFile es un archivo de un repo, por el alias de tools/repos.json.
type RepoFile struct {
	Repo string `json:"repo"`
	Path string `json:"path"`
}

// TouchedSection es una sección cuyas fuentes incluyen archivos de la lista.
type TouchedSection struct {
	ID    string   `json:"id"` // tema#ancla
	Topic string   `json:"topic"`
	Title string   `json:"title"`
	Files []string `json:"files"` // repo/ruta, los que la tocan
	// Score: cuánto dicen esos archivos de ESTA sección. Un archivo que citan veinte secciones (unas rutas, un
	// servicio central) aporta un veinteavo; uno que sólo cita ésta, uno entero.
	Score float64 `json:"score"`
}

// Touched devuelve las secciones que respaldan esos archivos, primero las más específicas (ver Score).
func (l Library) Touched(files []RepoFile) []TouchedSection {
	want := map[RepoFile]bool{}
	for _, f := range files {
		want[f] = true
	}
	found := map[string]*TouchedSection{}
	cited := map[RepoFile]int{} // en cuántas secciones de toda la biblioteca aparece cada archivo
	for _, t := range l.Topics {
		for _, s := range t.Sources {
			cited[RepoFile{s.Repo, s.Path}] += len(s.Sections)
		}
	}
	for _, t := range l.Topics {
		titles := map[string]string{}
		for _, s := range t.Sections {
			titles[strings.SplitN(s.ID, "#", 2)[1]] = s.Title
		}
		for _, s := range t.Sources {
			if !want[RepoFile{s.Repo, s.Path}] {
				continue
			}
			for _, anchor := range s.Sections {
				id := t.ID + "#" + anchor
				if found[id] == nil {
					found[id] = &TouchedSection{ID: id, Topic: t.ID, Title: titles[anchor]}
				}
				found[id].Files = append(found[id].Files, s.Repo+"/"+s.Path)
				found[id].Score += 1 / float64(cited[RepoFile{s.Repo, s.Path}])
			}
		}
	}
	out := make([]TouchedSection, 0, len(found))
	for _, s := range found {
		sort.Strings(s.Files)
		out = append(out, *s)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Score != out[j].Score {
			return out[i].Score > out[j].Score
		}
		return out[i].ID < out[j].ID
	})
	return out
}

// AliasOf traduce la carpeta de un clon (`legacy-application`) al alias con que la biblioteca lo cita
// (`application`). Devuelve "" si tools/repos.json no lo conoce.
func AliasOf(client *repos.Client, folder string) string {
	aliases := make([]string, 0, len(client.Citable()))
	for alias := range client.Citable() {
		aliases = append(aliases, alias)
	}
	sort.Strings(aliases)
	for _, alias := range aliases {
		if alias == folder || filepath.Base(client.Citable()[alias]) == folder {
			return alias
		}
	}
	return ""
}

/* ChangedBy: los archivos que trae un commit respecto de `base` (la ref de main del clon). Si el commit ya
 * está dentro de base —la rama se mergeó con merge commit— el diff contra el punto de bifurcación da vacío,
 * y entonces se usa el commit de merge del PR, si se conoce. Sólo lee el clon: nunca hace fetch. */
func ChangedBy(root, base, commit, mergeCommit string) []string {
	git := func(args ...string) string {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		out, err := exec.CommandContext(ctx, "git", append([]string{"-C", root}, args...)...).Output()
		if err != nil {
			return ""
		}
		return strings.TrimSpace(string(out))
	}
	lines := func(s string) []string {
		if s == "" {
			return nil
		}
		return strings.Split(s, "\n")
	}
	if fork := git("merge-base", base, commit); fork != "" {
		if files := lines(git("diff", "--name-only", fork, commit)); len(files) > 0 {
			return files
		}
	}
	if mergeCommit != "" {
		return lines(git("diff", "--name-only", mergeCommit+"^1", mergeCommit))
	}
	return nil
}

// ChangedBetween: los archivos que cambiaron entre dos refs del clon (`a..b`), para «¿qué releo después de esto?».
func ChangedBetween(root, a, b string) []string {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "git", "-C", root, "diff", "--name-only", a, b).Output()
	if err != nil || strings.TrimSpace(string(out)) == "" {
		return nil
	}
	return strings.Split(strings.TrimSpace(string(out)), "\n")
}
