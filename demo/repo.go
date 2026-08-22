// repo.go — DÓNDE ESTAMOS, y de dónde se leen los archivos.
//
// EL CAMBIO DE PROPÓSITO QUE ESTE ARCHIVO IMPLEMENTA. Antes había un `roots.json` con alias de repos
// conocidos: servía para que una persona construyera el mapa de un repo que ya tenía fichado. No es el
// caso de uso. El caso de uso es que un modelo esté parado en un repo cualquiera y tire UN comando —
// sin saber el alias, sin construir nada antes. Así que el repo se DESCUBRE del directorio actual.
//
// ⚠ POR DEFECTO SE LEE EL WORKING TREE, no `main`, y es un cambio deliberado respecto de la versión
// anterior. El razonamiento de antes ("los repos viven en ramas, leer el disco borraría del mapa un
// módulo que sólo existe en main") valía para un índice que se comparaba contra `context/`, que
// describe main. Para un modelo que está EDITANDO este checkout, lo que hay en disco es lo correcto:
// si `Modules/Backoffice` no está en su rama, es verdad que no lo tiene. `--rev main` lee la rama, y
// la salida siempre dice cuál de las dos se usó — la ambigüedad es la que causaba el problema.
package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

type repo struct {
	root string // el toplevel de git
	rev  string // "" = working tree; si no, un ref de git
}

func openRepo(dir, rev string) (*repo, error) {
	if dir == "" {
		dir, _ = os.Getwd()
	}
	out, err := exec.Command("git", "-C", dir, "rev-parse", "--show-toplevel").Output()
	if err != nil {
		return nil, fmt.Errorf("%s no está dentro de un repo git (y el descubrimiento del repo es "+
			"por git). Pasá -C <ruta> con un repo, o corré esto desde adentro de uno", dir)
	}
	r := &repo{root: strings.TrimSpace(string(out)), rev: rev}
	if rev != "" {
		if err := exec.Command("git", "-C", r.root, "rev-parse", "--verify", rev).Run(); err != nil {
			return nil, fmt.Errorf("el ref %q no existe en %s", rev, r.root)
		}
	}
	return r, nil
}

func (r *repo) name() string { return filepath.Base(r.root) }

func (r *repo) fuente() string {
	if r.rev == "" {
		return "working tree"
	}
	return r.rev
}

// read — el contenido de un archivo, del working tree o del ref.
func (r *repo) read(path string) ([]byte, error) {
	if r.rev == "" {
		return os.ReadFile(filepath.Join(r.root, path))
	}
	out, err := exec.Command("git", "-C", r.root, "show", r.rev+":"+path).Output()
	if err != nil {
		return nil, fmt.Errorf("no pude leer %s de %s: %w", path, r.rev, err)
	}
	return out, nil
}

// paths — todos los archivos con la extensión pedida.
func (r *repo) paths(ext string) ([]string, error) {
	args := []string{"-C", r.root, "ls-files"}
	if r.rev != "" {
		args = []string{"-C", r.root, "ls-tree", "-r", "--name-only", r.rev}
	}
	out, err := exec.Command("git", args...).Output()
	if err != nil {
		return nil, err
	}
	var found []string
	for _, p := range strings.Split(string(out), "\n") {
		if !strings.HasSuffix(p, ext) {
			continue
		}
		if strings.Contains(p, "vendor/") || strings.Contains(p, "node_modules/") {
			continue
		}
		found = append(found, p)
	}
	return found, nil
}

type grepHit struct {
	path string
	line string
}

// grepLines — como grep pero devuelve la LÍNEA que matcheó, no sólo el archivo. Hace falta para poder
// atribuir: con varios `-e` en un `grep -l` vuelve la unión de archivos sin decir qué patrón matcheó
// cuál, y resolver `class LenderRepo` exige saber exactamente eso.
func (r *repo) grepLines(patterns []string) ([]grepHit, error) {
	if len(patterns) == 0 {
		return nil, nil
	}
	args := []string{"-C", r.root, "grep", "-n", "-I", "-E"}
	for _, p := range patterns {
		args = append(args, "-e", p)
	}
	if r.rev != "" {
		args = append(args, r.rev)
	}
	out, err := exec.Command("git", args...).Output()
	if err != nil && len(out) == 0 {
		return nil, nil
	}
	var hits []grepHit
	for _, l := range strings.Split(string(out), "\n") {
		if r.rev != "" {
			l = strings.TrimPrefix(l, r.rev+":")
		}
		// ruta:línea:contenido — la ruta puede tener ':'? en git no, así que dos cortes alcanzan.
		i := strings.IndexByte(l, ':')
		if i < 0 {
			continue
		}
		j := strings.IndexByte(l[i+1:], ':')
		if j < 0 {
			continue
		}
		path := l[:i]
		if strings.Contains(path, "vendor/") || strings.Contains(path, "node_modules/") {
			continue
		}
		hits = append(hits, grepHit{path: path, line: l[i+1+j+1:]})
	}
	return hits, nil
}

// grep — los archivos que matchean. `patterns` se unen con OR en UNA sola invocación, y eso no es una
// optimización cosmética: resolver los vecinos de una semilla necesita buscar N nombres de clase, y
// hacerlo de a uno costaba ~80 ms cada uno. Con un grep son 80 ms para los N.
func (r *repo) grep(patterns []string, literal bool) ([]string, error) {
	if len(patterns) == 0 {
		return nil, nil
	}
	args := []string{"-C", r.root, "grep", "-l", "-I"}
	if literal {
		args = append(args, "-F")
	} else {
		args = append(args, "-E")
	}
	for _, p := range patterns {
		args = append(args, "-e", p)
	}
	if r.rev != "" {
		args = append(args, r.rev)
	}
	out, err := exec.Command("git", args...).Output()
	if err != nil && len(out) == 0 {
		return nil, nil // git grep sale 1 sin matches: no es un error
	}
	var found []string
	for _, line := range strings.Split(string(out), "\n") {
		p := strings.TrimSpace(line)
		if r.rev != "" {
			p = strings.TrimPrefix(p, r.rev+":")
		}
		if p == "" || strings.Contains(p, "vendor/") || strings.Contains(p, "node_modules/") {
			continue
		}
		found = append(found, p)
	}
	return found, nil
}
