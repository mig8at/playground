package main

import (
	"fmt"
	"strings"
)

// fileChange: lo que cambió una escritura en la carpeta de pruebas, para mostrarlo en la tarjeta del comando.
type fileChange struct {
	Diff    string `json:"diff,omitempty"` // renglones con « », «+» o «-» adelante, y «@@» entre tramos
	Added   int    `json:"added"`
	Removed int    `json:"removed"`
	New     bool   `json:"new,omitempty"`
}

const (
	diffMaxLines = 3000 // por lado: más que eso, sólo las cuentas
	diffMaxOut   = 400  // renglones de diff que se guardan
)

// lineDiff compara dos textos por renglones (la subsecuencia común más larga) y devuelve los tramos que cambiaron
// con dos renglones de contexto. Para archivos de una página alcanza y sobra; uno enorme devuelve sólo las cuentas.
func lineDiff(before, after string) fileChange {
	if before == "" {
		lines := strings.Split(after, "\n")
		ch := fileChange{New: true, Added: len(lines)}
		for i, l := range lines {
			if i >= diffMaxOut {
				ch.Diff += fmt.Sprintf("@@ … y %d renglones más\n", len(lines)-i)
				break
			}
			ch.Diff += "+" + l + "\n"
		}
		return ch
	}
	a, b := strings.Split(before, "\n"), strings.Split(after, "\n")
	if len(a) > diffMaxLines || len(b) > diffMaxLines {
		return fileChange{Added: len(b), Removed: len(a), Diff: "@@ archivo demasiado largo para mostrar el cambio renglón por renglón\n"}
	}
	// lcs[i][j]: largo de la subsecuencia común de a[i:] y b[j:].
	lcs := make([][]int32, len(a)+1)
	for i := range lcs {
		lcs[i] = make([]int32, len(b)+1)
	}
	for i := len(a) - 1; i >= 0; i-- {
		for j := len(b) - 1; j >= 0; j-- {
			if a[i] == b[j] {
				lcs[i][j] = lcs[i+1][j+1] + 1
			} else if lcs[i+1][j] >= lcs[i][j+1] {
				lcs[i][j] = lcs[i+1][j]
			} else {
				lcs[i][j] = lcs[i][j+1]
			}
		}
	}
	type op struct {
		kind byte
		text string
	}
	var ops []op
	i, j := 0, 0
	for i < len(a) && j < len(b) {
		switch {
		case a[i] == b[j]:
			ops = append(ops, op{' ', a[i]})
			i, j = i+1, j+1
		case lcs[i+1][j] >= lcs[i][j+1]:
			ops = append(ops, op{'-', a[i]})
			i++
		default:
			ops = append(ops, op{'+', b[j]})
			j++
		}
	}
	for ; i < len(a); i++ {
		ops = append(ops, op{'-', a[i]})
	}
	for ; j < len(b); j++ {
		ops = append(ops, op{'+', b[j]})
	}
	var ch fileChange
	keep := make([]bool, len(ops))
	for k, o := range ops {
		if o.kind == ' ' {
			continue
		}
		if o.kind == '+' {
			ch.Added++
		} else {
			ch.Removed++
		}
		for c := k - 2; c <= k+2; c++ {
			if c >= 0 && c < len(ops) {
				keep[c] = true
			}
		}
	}
	var out strings.Builder
	shown, last := 0, -1
	for k, o := range ops {
		if !keep[k] {
			continue
		}
		if shown >= diffMaxOut {
			out.WriteString("@@ … el cambio sigue\n")
			break
		}
		if last >= 0 && k != last+1 {
			out.WriteString("@@\n")
		}
		out.WriteByte(o.kind)
		out.WriteString(o.text)
		out.WriteByte('\n')
		shown, last = shown+1, k
	}
	ch.Diff = out.String()
	return ch
}
