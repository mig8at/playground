// Package traps revisa las TRAMPAS del sistema (`F-xx`): que su índice esté completo y que sus citas
// sigan apuntando bien.
//
// QUÉ SON Y POR QUÉ VIVEN ACÁ. Una trampa es un síntoma que ya costó tiempo, con su causa raíz
// verificada, su evidencia y su arreglo. Es **crónica**, y la crónica es justo lo que canon —el corpus
// que comparte el equipo— rechaza por regla escrita: allá van las reglas que existen en `main`, sin el
// relato de quién las descubrió. Vivieron en el árbol de `context/` hasta el 2026-09-21 y se mudaron
// al tablero cuando ese árbol empezó a apagarse: **el tablero ya era su lector real** —medido ese día,
// 12 de 45 tareas citaban 60 `F-xx` distintos, y canon no citaba ninguno—.
//
// ⚠ **No son los «Hallazgos» del tablero, y el nombre importa.** Un hallazgo es un bloque DENTRO de la
// pila de una tarea; una trampa es del sistema, no de una tarea, y se entra a ella por su SÍNTOMA.
//
// LOS DOS CHEQUEOS, y cada uno nació de un error medido:
//
//  1. **Un hallazgo entra por la PUERTA o no entra.** El documento declara la suya —«nadie lee este
//     archivo entero: entrá por acá, saltá al `F-xx`»— y esa puerta es un índice escrito a mano. Medido
//     el 2026-09-21: 9 de 239 hallazgos estaban fuera del índice de síntomas, justamente los últimos
//     agregados. Para quien entra por la puerta no existían, y su ausencia se lee «no nos pasó».
//  2. **Las citas `archivo:línea` se corren**, con `internal/citations`: ancla por CONTENIDO, así que
//     sigue renombres y no se deja engañar por un archivo que ganó un import arriba.
package traps

import (
	"regexp"
	"sort"
	"strconv"
	"strings"

	"creditop/tablero/server/internal/citations"
)

var (
	anchorRe   = regexp.MustCompile(`^### (F-[0-9]+)`)
	indexRe    = regexp.MustCompile(`^## (Índice[^\n]*)`)
	citationRe = regexp.MustCompile(`F-[0-9]+`)
	headingRe  = regexp.MustCompile(`^#{1,6} `)
)

// Index es un `## Índice` del documento con los `F-xx` que cita.
type Index struct {
	Title string
	Cited map[string]bool
}

/* Indices lee los `## Índice` del documento y lo que cita cada uno, y las trampas con ancla.
 *
 * ⚠ UN ÍNDICE TERMINA EN EL PRÓXIMO ENCABEZADO, DE CUALQUIER NIVEL. Hasta el 2026-09-23 terminaba sólo
 * en el próximo `## `, y el documento pone las trampas (`### F-xx`) justo después del último índice sin
 * ningún `## ` en el medio: ese índice «citaba» cada ancla que venía abajo, así que no podía faltarle
 * ninguna. El chequeo estaba vivo para el primer índice y muerto para el segundo — y al acotarlo
 * aparecieron 22 trampas (F-163 en adelante) que el índice de una línea no nombraba. */
func Indices(lines []string) (anchors map[string]bool, indices []Index) {
	anchors = map[string]bool{}
	open := false
	for _, l := range lines {
		if m := anchorRe.FindStringSubmatch(l); m != nil {
			anchors[m[1]] = true
		}
		if m := indexRe.FindStringSubmatch(l); m != nil {
			indices = append(indices, Index{Title: citations.Strip(m[1]), Cited: map[string]bool{}})
			open = true
			continue
		}
		if headingRe.MatchString(l) {
			open = false
			continue
		}
		if open {
			for _, f := range citationRe.FindAllString(l, -1) {
				indices[len(indices)-1].Cited[f] = true
			}
		}
	}
	return anchors, indices
}

func byNumber(set map[string]bool) []string {
	out := make([]string, 0, len(set))
	for f := range set {
		out = append(out, f)
	}
	sort.Slice(out, func(i, j int) bool {
		a, _ := strconv.Atoi(out[i][2:])
		b, _ := strconv.Atoi(out[j][2:])
		return a < b
	})
	return out
}

// ReviewIndex: cada `## Índice` tiene que citar todo lo que tiene ancla, y no citar lo que no existe.
// Devuelve cuántas trampas tienen ancla y las fallas, una por línea.
func ReviewIndex(lines []string) (int, []string) {
	anchors, indices := Indices(lines)
	var failures []string
	if len(anchors) > 0 && len(indices) == 0 {
		failures = append(failures, "  sin-índice · "+strconv.Itoa(len(anchors))+" trampas y ningún «## Índice»")
	}
	for _, idx := range indices {
		missing := map[string]bool{}
		for a := range anchors {
			if !idx.Cited[a] {
				missing[a] = true
			}
		}
		if len(missing) > 0 {
			list := byNumber(missing)
			shown, more := list, ""
			if len(list) > 12 {
				shown, more = list[:12], " …"
			}
			failures = append(failures, "  fuera-del-índice · «"+idx.Title+"» no cita "+strconv.Itoa(len(list))+": "+strings.Join(shown, ", ")+more)
		}
		dead := map[string]bool{}
		for f := range idx.Cited {
			if !anchors[f] {
				dead[f] = true
			}
		}
		for _, f := range byNumber(dead) {
			failures = append(failures, "  índice-a-trampa-inexistente · «"+idx.Title+"» cita "+f+", sin ancla `### "+f+"`")
		}
	}
	return len(anchors), failures
}
