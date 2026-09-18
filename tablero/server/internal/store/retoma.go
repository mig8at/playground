package store

import (
	"regexp"
	"strings"
)

// La retoma y el próximo paso viven en el markdown para que quien lo lee a pelo y la UI partan de la
// misma fuente. Estas funciones sólo los hacen disponibles sin obligar a cada cliente a recorrer el
// registro cronológico buscando cuál párrafo sigue vigente.
var (
	reRetoma      = regexp.MustCompile(`(?mi)^##\s+[0-9.·\s]*si retom[áa]s[^\n]*\n`)
	reSiguienteH2 = regexp.MustCompile(`(?m)^##\s+`)
	reProximoPaso = regexp.MustCompile(`(?is)\*\*El pr[óo]ximo paso es:?\*\*\s*(.*?)(?:\n\s*\n|\n##|\z)`)
)

// Retoma devuelve solamente la sección vigente, sin el título. Las tareas antiguas pueden numerarla y
// cambiar mayúsculas: ambas variantes se reconocen para no declarar ausente información que sí existe.
func Retoma(cuerpo string) string {
	m := reRetoma.FindStringIndex(cuerpo)
	if m == nil {
		return ""
	}
	resto := cuerpo[m[1]:]
	if fin := reSiguienteH2.FindStringIndex(resto); fin != nil {
		resto = resto[:fin[0]]
	}
	return strings.TrimSpace(resto)
}

// ProximoPaso devuelve una acción en una sola línea. Los saltos de línea son formato del documento,
// no parte de la acción que se muestra en la agenda.
func ProximoPaso(cuerpo string) string {
	m := reProximoPaso.FindStringSubmatch(cuerpo)
	if m == nil {
		return ""
	}
	paso := strings.TrimLeft(strings.TrimSpace(m[1]), "*: ")
	return strings.Join(strings.Fields(paso), " ")
}
