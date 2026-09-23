package store

import (
	"regexp"
	"strings"
)

// CanonUse es una evidencia explícita de cómo una referencia de Canon ayudó a
// avanzar una tarea. No se infiere al abrir Canon: declarar una referencia sólo
// dice que es pertinente; marcarla como leída o validada es una afirmación que
// debe quedar escrita junto al trabajo que produjo.
type CanonUse struct {
	Fecha      string `json:"fecha"`
	Referencia string `json:"referencia"`
	Uso        string `json:"uso"`
	Leido      bool   `json:"leido"`
	Validado   bool   `json:"validado"`
}

// La evidencia vive en el cuerpo privado, cerca del registro y las decisiones,
// con una forma breve que se puede escribir a mano o por un agente:
//
//	> **CANON · 2026-09-22 · leído · validado** — `listado/context#regla` — Se usó para decidir…
//
// Los estados son deliberadamente opcionales: una exploración puede quedar
// sólo como «leído». No se acepta prosa libre dentro del encabezado porque una
// etiqueta que el tablero no entiende se vería como una validación que no fue.
var reCanonUse = regexp.MustCompile(`(?mi)^>\s*\*\*CANON\s*·\s*(\d{4}-\d{2}-\d{2})(?:\s*·\s*([^*]+?))?\s*\*\*\s*—\s*` + "`" + `([^` + "`" + `]+)` + "`" + `\s*—\s*(.+?)\s*$`)

func CanonUses(cuerpo string) []CanonUse {
	var uses []CanonUse
	for _, match := range reCanonUse.FindAllStringSubmatch(cuerpo, -1) {
		state := strings.ToLower(match[2])
		use := CanonUse{
			Fecha:      match[1],
			Referencia: strings.TrimSpace(match[3]),
			Uso:        strings.Join(strings.Fields(match[4]), " "),
			Leido:      strings.Contains(state, "leído") || strings.Contains(state, "leido"),
			Validado:   strings.Contains(state, "validado"),
		}
		if use.Referencia != "" && use.Uso != "" {
			uses = append(uses, use)
		}
	}
	return uses
}
