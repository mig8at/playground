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
// normalización (`normalizarLiteral`), así que no hay dos versiones que puedan divergir.
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

type destinoLog struct {
	Ruta  string `json:"ruta"`
	Linea string `json:"linea"`
	Test  bool   `json:"es_test"`
	H     string `json:"h"`
}

type mapaLogs struct {
	porMensaje map[string][]destinoLog
	orden      []string // claves de más larga a más corta: gana el prefijo más específico
}

// normalizarMsg es la normalización con la que se construyeron las claves: la misma función, no una copia.
func normalizarMsg(m string) string { return normalizarLiteral(m) }

// cargarMapaLogs busca `trazador/logs.json` desde el cwd habitual (trazador/server) y desde la raíz.
func cargarMapaLogs() *mapaLogs {
	for _, p := range []string{
		rutaIndiceLogs,                         // desde trazador/server, que es de donde corre
		filepath.Join("trazador", "logs.json"), // desde la raíz del playground
	} {
		b, err := os.ReadFile(p)
		if err != nil {
			continue
		}
		var crudo map[string][]destinoLog
		if json.Unmarshal(b, &crudo) != nil || len(crudo) == 0 {
			continue
		}
		m := &mapaLogs{porMensaje: crudo}
		for k := range crudo {
			m.orden = append(m.orden, k)
		}
		sort.Slice(m.orden, func(i, j int) bool { return len(m.orden[i]) > len(m.orden[j]) })
		return m
	}
	return nil
}

// resolverArchivo devuelve el archivo que emitió ese mensaje, o "" si el mapa no lo conoce.
// El literal del código es un PREFIJO de lo que llega en runtime (el resto son valores
// interpolados), nunca al revés — por eso se compara con `HasPrefix` y gana el más largo.
func (m *mapaLogs) resolverArchivo(mensaje string) (destinoLog, bool) {
	if m == nil {
		return destinoLog{}, false
	}
	n := normalizarMsg(mensaje)
	if n == "" {
		return destinoLog{}, false
	}
	for _, k := range m.orden {
		if strings.HasPrefix(n, k) {
			for _, d := range m.porMensaje[k] {
				if !d.Test {
					return d, true
				}
			}
			return m.porMensaje[k][0], true
		}
	}
	return destinoLog{}, false
}

// ArchivoDeTraza es una fila del resumen: un archivo y cuántas líneas de esta traza salieron de él.
type ArchivoDeTraza struct {
	Ruta   string   `json:"ruta"`
	H      string   `json:"h"`
	Veces  int      `json:"veces"`
	Lineas []string `json:"lineas,omitempty"`
}

// archivosDeTraza resuelve los mensajes en orden de PRIMERA APARICIÓN, que es lo más cercano a la
// secuencia de ejecución que se puede afirmar sin instrumentar: las horas de Loki no son monótonas
// entre servicios. Devuelve además cuántos mensajes quedaron sin resolver, que es información sobre
// el mapa y no sobre la traza.
func archivosDeTraza(mensajes []string) ([]ArchivoDeTraza, int) {
	m := cargarMapaLogs()
	if m == nil {
		return nil, -1 // -1 = el mapa no está construido; distinto de «0 sin resolver»
	}
	var orden []string
	porRuta := map[string]*ArchivoDeTraza{}
	sin := 0
	for _, msg := range mensajes {
		d, ok := m.resolverArchivo(msg)
		if !ok {
			sin++
			continue
		}
		a, existe := porRuta[d.Ruta]
		if !existe {
			a = &ArchivoDeTraza{Ruta: d.Ruta, H: d.H}
			porRuta[d.Ruta] = a
			orden = append(orden, d.Ruta)
		}
		a.Veces++
		if d.Linea != "" && d.Linea != "?" && !contieneStr(a.Lineas, d.Linea) && len(a.Lineas) < 8 {
			a.Lineas = append(a.Lineas, d.Linea)
		}
	}
	fuera := make([]ArchivoDeTraza, 0, len(orden))
	for _, r := range orden {
		fuera = append(fuera, *porRuta[r])
	}
	return fuera, sin
}

func contieneStr(xs []string, x string) bool {
	for _, v := range xs {
		if v == x {
			return true
		}
	}
	return false
}
