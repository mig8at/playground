// archivos.go — de los MENSAJES de una traza a los ARCHIVOS que los emitieron.
//
// POR QUÉ ACÁ. El trazador ya contesta «hasta dónde llegó y por qué se rompió»; lo que no decía es
// DÓNDE, en el código. Esa pregunta es la siguiente que hace cualquiera que lea una traza, y hasta
// ahora obligaba a irse a otra herramienta con el mensaje copiado a mano.
//
// ⚠ DE DÓNDE SALE EL MAPA, Y POR QUÉ NO SE CONSTRUYE ACÁ. `workers/logs.json` lo arma Python leyendo
// el código de los 12 repos (`workers/logs.py`), y este archivo SOLO LO CONSUME. La construcción
// —qué formas de log existen, cómo se normaliza una clave— vive en un solo lado a propósito: ya nos
// costó dos veces tener la misma tabla en dos lenguajes (`roots.py` y el `guard` del tablero), y una
// divergencia acá no fallaría, sólo atribuiría líneas al archivo equivocado.
//
// Lo único que se reimplementa es la BÚSQUEDA (prefijo más largo) y la normalización, que son dos
// líneas mecánicas — y hay una prueba que compara Go contra Python sobre mensajes reales para que la
// coincidencia no dependa de la buena voluntad: `go test ./... -run Mapa`.
//
// ⚠ Y si el mapa NO está construido, esto no inventa nada: no agrega la sección y dice cómo armarla.
// Un bloque «0 archivos» se leería como «no corrió ninguno», que es falso.
package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
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

var reEspacios = regexp.MustCompile(`\s+`)

// normalizarMsg tiene que dar EXACTAMENTE lo mismo que `_normalizar` de workers/logs.py. Si un día
// cambia allá, la prueba de `archivos_test.go` lo caza antes que un usuario.
func normalizarMsg(m string) string {
	return strings.TrimRight(strings.TrimSpace(reEspacios.ReplaceAllString(m, " ")), " :.-,")
}

// cargarMapaLogs busca `workers/logs.json` desde el cwd habitual (trazador/server) y desde la raíz.
func cargarMapaLogs() *mapaLogs {
	for _, p := range []string{
		filepath.Join("..", "..", "workers", "logs.json"),
		filepath.Join("workers", "logs.json"),
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
