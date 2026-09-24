// archivos.go — de los MENSAJES de una traza a los ARCHIVOS que los emitieron.
//
// POR QUÉ ACÁ. El trazador ya contesta «hasta dónde llegó y por qué se rompió»; lo que no decía es
// DÓNDE, en el código. Esa pregunta es la siguiente que hace cualquiera que lea una traza, y hasta
// ahora obligaba a irse a otra herramienta con el mensaje copiado a mano.
//
// ⚠ DE DÓNDE SALE EL MAPA. Lo arma `indice_logs.go` (`-indexar-logs`) leyendo el código de los repos, y
// queda en `trazador/logs.json`. Hasta el 2026-09-24 lo construía Python (`workers/logs.py`) y acá se
// reimplementaban la búsqueda y la normalización, con una prueba que comparaba las dos: ya nos había
// costado dos veces tener lo mismo en dos lenguajes. Ahora el constructor y el lector usan LA MISMA
// normalización (`normalizeLiteral`), así que no hay dos versiones que puedan divergir.
//
// ⚠ Y si el mapa NO está construido, esto no inventa nada: no agrega la sección y dice cómo armarla.
// Un bloque «0 archivos» se leería como «no corrió ninguno», que es falso.
package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

type logTarget struct {
	Path string `json:"ruta"`
	Line string `json:"linea"`
	Test bool   `json:"es_test"`
	H    string `json:"h"`
}

type logMap struct {
	byMessage map[string][]logTarget
	order     []string // claves de más larga a más corta: gana el prefijo más específico
}

// normalizeMessage es la normalización con la que se construyeron las claves: la misma función, no una copia.
func normalizeMessage(m string) string { return normalizeLiteral(m) }

// loadLogMap busca `trazador/logs.json` desde el cwd habitual (trazador/server) y desde la raíz.
func loadLogMap() *logMap {
	for _, p := range []string{
		logIndexPath,                           // desde trazador/server, que es de donde corre
		filepath.Join("trazador", "logs.json"), // desde la raíz del playground
	} {
		b, err := os.ReadFile(p)
		if err != nil {
			continue
		}
		var raw map[string][]logTarget
		if json.Unmarshal(b, &raw) != nil || len(raw) == 0 {
			continue
		}
		m := &logMap{byMessage: raw}
		for k := range raw {
			m.order = append(m.order, k)
		}
		sort.Slice(m.order, func(i, j int) bool { return len(m.order[i]) > len(m.order[j]) })
		return m
	}
	return nil
}

// resolveFile devuelve el archivo que emitió ese mensaje, o "" si el mapa no lo conoce.
// El literal del código es un PREFIJO de lo que llega en runtime (el resto son valores
// interpolados), nunca al revés — por eso se compara con `HasPrefix` y gana el más largo.
func (m *logMap) resolveFile(logMessage string) (logTarget, bool) {
	if m == nil {
		return logTarget{}, false
	}
	n := normalizeMessage(logMessage)
	if n == "" {
		return logTarget{}, false
	}
	for _, k := range m.order {
		if strings.HasPrefix(n, k) {
			for _, d := range m.byMessage[k] {
				if !d.Test {
					return d, true
				}
			}
			return m.byMessage[k][0], true
		}
	}
	return logTarget{}, false
}

// TraceFile es una fila del resumen: un archivo y cuántas líneas de esta traza salieron de él.
type TraceFile struct {
	Path  string   `json:"ruta"`
	H     string   `json:"h"`
	Times int      `json:"veces"`
	Lines []string `json:"lineas,omitempty"`
}

// traceFiles resuelve los mensajes en orden de PRIMERA APARICIÓN, que es lo más cercano a la
// secuencia de ejecución que se puede afirmar sin instrumentar: las horas de Loki no son monótonas
// entre servicios. Devuelve además cuántos mensajes quedaron sin resolver, que es información sobre
// el mapa y no sobre la traza.
func traceFiles(messages []string) ([]TraceFile, int) {
	m := loadLogMap()
	if m == nil {
		return nil, -1 // -1 = el mapa no está construido; distinto de «0 sin resolver»
	}
	var order []string
	byPath := map[string]*TraceFile{}
	without := 0
	for _, msg := range messages {
		d, ok := m.resolveFile(msg)
		if !ok {
			without++
			continue
		}
		a, exists := byPath[d.Path]
		if !exists {
			a = &TraceFile{Path: d.Path, H: d.H}
			byPath[d.Path] = a
			order = append(order, d.Path)
		}
		a.Times++
		if d.Line != "" && d.Line != "?" && !containsString(a.Lines, d.Line) && len(a.Lines) < 8 {
			a.Lines = append(a.Lines, d.Line)
		}
	}
	outside := make([]TraceFile, 0, len(order))
	for _, r := range order {
		outside = append(outside, *byPath[r])
	}
	return outside, without
}

func containsString(xs []string, x string) bool {
	for _, v := range xs {
		if v == x {
			return true
		}
	}
	return false
}
