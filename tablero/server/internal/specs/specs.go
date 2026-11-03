// Package specs lee la sección `## Specs` de una tarea: cada `S#` con lo que tiene que ser cierto, la cita de
// quién lo pidió y el comando que lo comprueba. La corre `cmd/verify` (`make tarea-verify`) y la anuncia
// `cmd/agent` (`make agente`). La forma, en `tablero/TASK-TEMPLATE.md`.
package specs

import (
	"regexp"
	"strconv"
	"strings"
)

// Spec es una `S#` de la tarea.
type Spec struct {
	ID      string `json:"id"`
	What    string `json:"what"`
	Command string `json:"command"`
	Dir     string `json:"dir,omitempty"`
	Expect  int    `json:"expect"`
	Says    string `json:"says,omitempty"`
}

var (
	reSection = regexp.MustCompile(`(?m)^## Specs[ \t]*$`)
	reNext    = regexp.MustCompile(`(?m)^## `)
	reSpec    = regexp.MustCompile(`^- \*\*(S[0-9]+)\*\*\s*·?\s*(.*)$`)
	reCommand = regexp.MustCompile("^\\s+`([^`]+)`\\s*$")
	reExpect  = regexp.MustCompile(`^\s+sale:\s*([0-9]+)\s*$`)
	reDir     = regexp.MustCompile(`^\s+dir:\s*(\S+)\s*$`)
	reSays    = regexp.MustCompile(`^\s+dice:\s*(.+?)\s*$`)
)

// Parse: las `S#` de la sección `## Specs`, en orden. Lo que no sigue la forma se ignora.
func Parse(body string) []Spec {
	loc := reSection.FindStringIndex(body)
	if loc == nil {
		return nil
	}
	rest := body[loc[1]:]
	if next := reNext.FindStringIndex(rest); next != nil {
		rest = rest[:next[0]]
	}
	var out []Spec
	for _, l := range strings.Split(rest, "\n") {
		if m := reSpec.FindStringSubmatch(l); m != nil {
			out = append(out, Spec{ID: m[1], What: strings.TrimSpace(m[2])})
			continue
		}
		if len(out) == 0 {
			continue
		}
		cur := &out[len(out)-1]
		if m := reCommand.FindStringSubmatch(l); m != nil && cur.Command == "" {
			cur.Command = m[1]
		} else if m := reExpect.FindStringSubmatch(l); m != nil {
			cur.Expect, _ = strconv.Atoi(m[1])
		} else if m := reDir.FindStringSubmatch(l); m != nil {
			cur.Dir = m[1]
		} else if m := reSays.FindStringSubmatch(l); m != nil {
			cur.Says = m[1]
		}
	}
	return out
}
