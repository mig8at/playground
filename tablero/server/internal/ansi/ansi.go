// Package ansi decide si una salida lleva colores de terminal. Un agente lee la salida por un pipe, y ahí los
// códigos son ruido: medido el 2026-10-20, la ayuda de `make` y `make pulso` se limpiaban con `sed` en casi
// cada llamada de una sesión. Sigue la convención de https://no-color.org: con NO_COLOR, nunca.
package ansi

import (
	"io"
	"os"
	"strings"
)

// Enabled dice si f es una terminal y nadie pidió NO_COLOR.
func Enabled(f *os.File) bool {
	if os.Getenv("NO_COLOR") != "" {
		return false
	}
	info, err := f.Stat()
	return err == nil && info.Mode()&os.ModeCharDevice != 0
}

// Strip saca las secuencias de color (ESC … m). Una secuencia rara que no cierra en 12 caracteres no se
// come el texto.
func Strip(s string) string {
	if !strings.Contains(s, "\033") {
		return s
	}
	var out strings.Builder
	for i := 0; i < len(s); {
		if s[i] == '\033' {
			if end := strings.IndexByte(s[i:], 'm'); end != -1 && end < 12 {
				i += end + 1
				continue
			}
		}
		out.WriteByte(s[i])
		i++
	}
	return out.String()
}

type stripper struct{ w io.Writer }

// Write saca los colores de lo que escribe. Supone que cada secuencia llega entera en una escritura,
// que es lo que hace fmt: cada Printf es una sola.
func (s stripper) Write(p []byte) (int, error) {
	if _, err := io.WriteString(s.w, Strip(string(p))); err != nil {
		return 0, err
	}
	return len(p), nil
}

// Out es f tal cual en una terminal, y f sin colores en cualquier otro lado.
func Out(f *os.File) io.Writer {
	if Enabled(f) {
		return f
	}
	return stripper{f}
}
