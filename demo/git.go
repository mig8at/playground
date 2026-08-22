// git.go — LEER TODO `main` DE UNA VEZ, sin checkout y sin N procesos.
//
// ⚠ SE LEE `main`, NO EL WORKING TREE, y no es un detalle: los repos viven en ramas. Medido el
// 2026-08-15, `legacy-backend` estaba checkeado en una rama donde `Modules/Backoffice` no existe — un
// indexador que caminara el disco lo habría borrado del mapa sin que nada avisara.
//
// POR QUÉ `cat-file --batch` Y NO `git show` POR ARCHIVO. `git show` son 2.500 procesos; `--batch` es
// UNO que recibe shas por stdin y devuelve los blobs por stdout. Es la diferencia entre minutos y
// segundos, y es la única razón por la que este mapa se puede reconstruir cada vez en vez de cachear.
package main

import (
	"bufio"
	"fmt"
	"io"
	"os/exec"
	"strconv"
	"strings"
)

type blob struct {
	Path string
	Src  []byte
}

// listFiles — los archivos de `branch` con la extensión pedida, como (sha, path).
func listFiles(repo, branch, ext string) ([][2]string, error) {
	out, err := exec.Command("git", "-C", repo, "ls-tree", "-r", branch).Output()
	if err != nil {
		return nil, fmt.Errorf("git ls-tree en %s: %w", repo, err)
	}
	var found [][2]string
	for _, line := range strings.Split(string(out), "\n") {
		// <mode> <type> <sha>\t<path>
		tab := strings.IndexByte(line, '\t')
		if tab < 0 {
			continue
		}
		path := line[tab+1:]
		if !strings.HasSuffix(path, ext) {
			continue
		}
		// Lo que no es código propio no aporta aristas y sí distorsiona los conteos.
		if strings.Contains(path, "vendor/") || strings.Contains(path, "node_modules/") {
			continue
		}
		fields := strings.Fields(line[:tab])
		if len(fields) < 3 {
			continue
		}
		found = append(found, [2]string{fields[2], path})
	}
	return found, nil
}

// readBlobs — dispara un `cat-file --batch` y manda cada blob al canal. Escribe stdin en su propia
// goroutine: hacerlo en línea se deadlockea en cuanto el pipe de salida se llena.
func readBlobs(repo string, files [][2]string, out chan<- blob) error {
	defer close(out)
	cmd := exec.Command("git", "-C", repo, "cat-file", "--batch")
	in, err := cmd.StdinPipe()
	if err != nil {
		return err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	go func() {
		w := bufio.NewWriter(in)
		for _, f := range files {
			fmt.Fprintln(w, f[0])
		}
		w.Flush()
		in.Close()
	}()

	r := bufio.NewReaderSize(stdout, 1<<20)
	for _, f := range files {
		header, err := r.ReadString('\n') // <sha> blob <size>
		if err != nil {
			return err
		}
		fields := strings.Fields(header)
		if len(fields) != 3 {
			return fmt.Errorf("cabecera inesperada de cat-file: %q", strings.TrimSpace(header))
		}
		size, err := strconv.Atoi(fields[2])
		if err != nil {
			return err
		}
		buf := make([]byte, size)
		if _, err := io.ReadFull(r, buf); err != nil {
			return err
		}
		r.ReadByte() // el \n que cierra el blob
		out <- blob{Path: f[1], Src: buf}
	}
	return cmd.Wait()
}
