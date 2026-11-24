package knowledge

import (
	"context"
	"fmt"
	"os/exec"
	"strings"
	"time"

	"creditop/my-tools/connectors/repos"
)

type SourceState struct {
	Topic  string `json:"topic"`
	Repo   string `json:"repo"`
	Path   string `json:"path"`
	Ref    string `json:"ref"`
	State  string `json:"state"`
	Detail string `json:"detail"`
}

// Check contrasta el respaldo y la deriva con las refs de main disponibles en disco. Nunca hace fetch.
func (l Library) Check(client *repos.Client) ([]SourceState, error) {
	states := []SourceState{}
	if len(l.Topics) == 0 {
		return states, fmt.Errorf("knowledge no tiene temas: no hay nada verificado")
	}
	var bad int
	trees := treeCache{}
	blobAt := trees.blobAt
	for _, t := range l.Topics {
		for _, s := range t.Sources {
			state := SourceState{Topic: t.ID, Repo: s.Repo, Path: s.Path}
			root := client.MainRoot(s.Repo)
			if root == "" {
				state.State, state.Detail = "unavailable", "repo desconocido en tools/repos.json"
			} else if blob, err := blobAt(root, s.Commit, s.Path); err != nil {
				state.State, state.Detail = "unavailable", "no pude leer el archivo del commit revisado"
			} else if blob != s.Blob {
				state.State, state.Detail = "invalid", "el hash no coincide con el commit revisado"
			} else {
				ref, reason := client.RefToIndex(root)
				state.Ref = ref
				if ref == "" {
					state.State, state.Detail = "unavailable", reason
				} else if blob, err := blobAt(root, ref, s.Path); err != nil {
					state.State, state.Detail = "missing", "el archivo no se pudo leer en "+ref
				} else if blob != s.Blob {
					state.State, state.Detail = "changed", "cambió desde la revisión: releer la regla antes de actualizar la fuente"
				} else {
					state.State, state.Detail = "unchanged", "archivo sin cambios en "+ref+" ("+reason+")"
				}
			}
			if state.State != "unchanged" {
				bad++
			}
			states = append(states, state)
		}
	}
	if bad > 0 {
		return states, fmt.Errorf("%d fuente(s) requieren revisión", bad)
	}
	return states, nil
}

// treeCache: el árbol entero de cada repo y commit, leído una vez con `git ls-tree -r`. Antes eran cuatro procesos de git
// por fuente (~6.000 en fila) y `cat-file -t` bajaba el contenido de cada archivo de los clones parciales (`blob:none`):
// la comprobación tardaba 6,5 minutos (2026-11-24). El árbol trae el hash y el tipo sin bajar ningún archivo.
type treeCache map[string]map[string][2]string

func (c treeCache) blobAt(root, ref, path string) (string, error) {
	key := root + "\x00" + ref
	tree, ok := c[key]
	if !ok {
		tree = map[string][2]string{}
		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		out, err := exec.CommandContext(ctx, "git", "-C", root, "ls-tree", "-r", "-z", "--full-tree", ref).Output()
		cancel()
		if err != nil {
			c[key] = nil
			return blobAtSlow(root, ref, path)
		}
		for _, line := range strings.Split(string(out), "\x00") {
			meta, file, ok := strings.Cut(line, "\t")
			if f := strings.Fields(meta); ok && len(f) == 3 {
				tree[file] = [2]string{f[1], f[2]}
			}
		}
		c[key] = tree
	}
	if tree == nil {
		return blobAtSlow(root, ref, path)
	}
	e, ok := tree[path]
	if !ok {
		return "", fmt.Errorf("%s no está en %s", path, ref)
	}
	if e[0] != "blob" {
		return "", fmt.Errorf("la fuente no es un archivo Git")
	}
	return e[1], nil
}

// blobAtSlow: el camino de antes, por si el árbol no se pudo leer.
func blobAtSlow(root, ref, path string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "git", "-C", root, "rev-parse", "--verify", ref+":"+path).Output()
	if err != nil {
		return "", err
	}
	blob := strings.TrimSpace(string(out))
	kind, err := exec.CommandContext(ctx, "git", "-C", root, "cat-file", "-t", blob).Output()
	if err != nil || strings.TrimSpace(string(kind)) != "blob" {
		return "", fmt.Errorf("la fuente no es un archivo Git")
	}
	return blob, nil
}
