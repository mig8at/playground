package store

import (
	"regexp"
	"strings"
)

// La retoma y el próximo paso viven en el markdown para que quien lo lee a pelo y la UI partan de la
// misma fuente. Estas funciones sólo los hacen disponibles sin obligar a cada cliente a recorrer el
// registro cronológico buscando cuál párrafo sigue vigente.
var (
	reResume   = regexp.MustCompile(`(?mi)^##\s+[0-9.·\s]*si retom[áa]s[^\n]*\n`)
	reNextH2   = regexp.MustCompile(`(?m)^##\s+`)
	reNextStep = regexp.MustCompile(`(?is)\*\*El pr[óo]ximo paso es:?\*\*\s*(.*?)(?:\n\s*\n|\n##|\z)`)
)

// Resume devuelve solamente la sección vigente, sin el título. Las tareas antiguas pueden numerarla y
// cambiar mayúsculas: ambas variantes se reconocen para no declarar ausente información que sí existe.
func Resume(body string) string {
	m := reResume.FindStringIndex(body)
	if m == nil {
		return ""
	}
	rest := body[m[1]:]
	if end := reNextH2.FindStringIndex(rest); end != nil {
		rest = rest[:end[0]]
	}
	return strings.TrimSpace(rest)
}

// NextStep devuelve una acción en una sola línea. Los saltos de línea son formato del documento,
// no parte de la acción que se muestra en la agenda.
func NextStep(body string) string {
	m := reNextStep.FindStringSubmatch(body)
	if m == nil {
		return ""
	}
	step := strings.TrimLeft(strings.TrimSpace(m[1]), "*: ")
	return strings.Join(strings.Fields(step), " ")
}
