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
	Ruta string
	Src  []byte
}

// listar — los archivos de `rama` con la extensión pedida, como (sha, ruta).
func listar(repo, rama, ext string) ([][2]string, error) {
	out, err := exec.Command("git", "-C", repo, "ls-tree", "-r", rama).Output()
	if err != nil {
		return nil, fmt.Errorf("git ls-tree en %s: %w", repo, err)
	}
	var res [][2]string
	for _, l := range strings.Split(string(out), "\n") {
		// <mode> <type> <sha>\t<ruta>
		tab := strings.IndexByte(l, '\t')
		if tab < 0 {
			continue
		}
		ruta := l[tab+1:]
		if !strings.HasSuffix(ruta, ext) {
			continue
		}
		// Lo que no es código propio no aporta aristas y sí distorsiona los conteos.
		if strings.Contains(ruta, "vendor/") || strings.Contains(ruta, "node_modules/") {
			continue
		}
		campos := strings.Fields(l[:tab])
		if len(campos) < 3 {
			continue
		}
		res = append(res, [2]string{campos[2], ruta})
	}
	return res, nil
}

// leer — dispara un `cat-file --batch` y manda cada blob al canal. Escribe stdin en su propia
// goroutine: hacerlo en línea se deadlockea en cuanto el pipe de salida se llena.
func leer(repo string, archivos [][2]string, out chan<- blob) error {
	defer close(out)
	cmd := exec.Command("git", "-C", repo, "cat-file", "--batch")
	in, err := cmd.StdinPipe()
	if err != nil {
		return err
	}
	sal, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	go func() {
		w := bufio.NewWriter(in)
		for _, a := range archivos {
			fmt.Fprintln(w, a[0])
		}
		w.Flush()
		in.Close()
	}()

	r := bufio.NewReaderSize(sal, 1<<20)
	for _, a := range archivos {
		cab, err := r.ReadString('\n') // <sha> blob <tamaño>
		if err != nil {
			return err
		}
		campos := strings.Fields(cab)
		if len(campos) != 3 {
			return fmt.Errorf("cabecera inesperada de cat-file: %q", strings.TrimSpace(cab))
		}
		n, err := strconv.Atoi(campos[2])
		if err != nil {
			return err
		}
		buf := make([]byte, n)
		if _, err := io.ReadFull(r, buf); err != nil {
			return err
		}
		r.ReadByte() // el \n que cierra el blob
		out <- blob{Ruta: a[1], Src: buf}
	}
	return cmd.Wait()
}
