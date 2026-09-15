package store

import (
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// ultimosToques: para cada archivo de tarea, la fecha (YYYY-MM-DD) del último commit que lo tocó, o
// HOY si está modificado en el working tree. Sale de git y no del mtime porque el mtime cambia con
// un checkout o un stash y diría «tocada hoy» de algo que nadie leyó en semanas.
//
// Dos llamadas para todas las tareas, no una por archivo: `git log --name-only` lista los commits del
// directorio del más nuevo al más viejo, así que la PRIMERA vez que aparece un archivo es su último
// toque. Con 65 tareas la diferencia es 2 llamadas contra 65.
//
// Para qué existe: la tarjeta muestra «N días sin tocar» y marca DORMIDA a los 14. Medido el
// 2026-09-14: 22 de las 39 abiertas llevaban 14 días o más sin tocarse y nada lo decía; la etapa
// (`work`) no distingue lo vivo de lo abandonado.
func ultimosToques(dir string) map[string]string {
	out := map[string]string{}
	git := func(args ...string) string {
		b, err := exec.Command("git", append([]string{"-C", dir}, args...)...).Output()
		if err != nil {
			return ""
		}
		return string(b)
	}
	hoy := time.Now().Format("2006-01-02")
	for _, l := range strings.Split(git("status", "--porcelain", "--", "."), "\n") {
		if len(l) > 3 {
			out[filepath.Base(strings.TrimSpace(l[3:]))] = hoy
		}
	}
	fecha := ""
	for _, l := range strings.Split(git("log", "--format=%cs", "--name-only", "--", "."), "\n") {
		l = strings.TrimSpace(l)
		switch {
		case l == "":
		case len(l) == 10 && l[4] == '-' && l[7] == '-':
			fecha = l
		default:
			nombre := filepath.Base(l)
			if _, visto := out[nombre]; !visto && fecha != "" {
				out[nombre] = fecha
			}
		}
	}
	return out
}
