package store

import (
	"regexp"
	"strings"
)

// PENDIENTES: lo que queda por hacer en una tarea, sacado del CUERPO y no de una lista aparte.
//
// Ya se escribían —7 de las 41 tareas tienen su sección de pendientes y 9 usan casillas— pero el
// tablero no los veía: había que abrir el `.md` para saber si algo quedaba abierto. Esto es el mismo
// movimiento que las anotaciones, los prototipos y las ramas: el dato vive en su fuente natural y la
// UI lo DERIVA. Un campo en el frontmatter sería otra lista que mantener a mano, y una lista a mano
// miente en silencio en cuanto alguien resuelve el pendiente sin tocar el archivo.
//
// La forma es la casilla de markdown, que ya se estaba usando:
//
//	- [ ] backfill de `allied_documents` no idempotente → cambiar `insert` por `updateOrInsert`
//	- [x] renombrar las rutas a nombres genéricos
//
// ⚠ SÓLO DEL CUERPO PRIVADO. El llamador pasa `notas` (lo que `partirCuerpo` deja ANTES del marcador
// de la publicable), y eso no es un detalle de implementación: de las 37 casillas que hay hoy en las
// tareas, 17 son «Criterios de aceptación» de la sección publicable — la checklist de QA, que no es un
// pendiente de nadie. Contarlas daría 5 pendientes en tareas que tienen 0. Es el mismo error de corte
// que ya se cometió una vez midiendo la publicable.
//
// ⚠ Y NO se tildan solas. Medido el 2026-08-20 sobre las 41 tareas: 37 casillas escritas y **1** sola
// tildada. O sea que `Hecho` dice poco y el número que importa es el de las ABIERTAS — por eso
// `Abiertos()` existe y es lo que cuenta la tarjeta. Un pendiente resuelto se borra o se tilda, pero
// nadie vuelve; asumir lo contrario haría que el contador mienta hacia abajo.
type Pendiente struct {
	Que     string `json:"que"`     // el texto del ítem, una línea
	Hecho   bool   `json:"hecho"`   // la casilla está tildada
	Seccion string `json:"seccion"` // el encabezado bajo el que vive, para agrupar en el cajón
}

// La casilla, con la indentación que tenga: los pendientes anidados cuentan igual. Se acepta `-`, `*`
// y `+` porque son los tres marcadores de lista de markdown y quien escribe no debería recordar cuál
// entiende el parser.
var rePendiente = regexp.MustCompile(`^\s*[-*+]\s+\[([ xX])\]\s+(.+)$`)

// Cualquier encabezado markdown: el más cercano por encima es el contexto del ítem.
var reEncabezado = regexp.MustCompile(`^#{1,6}\s+(.+?)\s*$`)

// Pendientes recoge las casillas del cuerpo, en el orden en que aparecen.
func Pendientes(cuerpo string) []Pendiente {
	out := []Pendiente{}
	seccion := ""
	for _, linea := range strings.Split(cuerpo, "\n") {
		if h := reEncabezado.FindStringSubmatch(linea); h != nil {
			seccion = strings.TrimSpace(h[1])
			continue
		}
		m := rePendiente.FindStringSubmatch(linea)
		if m == nil {
			continue
		}
		que := strings.TrimSpace(m[2])
		if que == "" {
			continue
		}
		out = append(out, Pendiente{
			Que:     que,
			Hecho:   m[1] != " ",
			Seccion: seccion,
		})
	}
	return out
}

// Abiertos cuenta los que quedan. Es el número de la tarjeta: los tildados ya no son trabajo, y
// mostrar el total haría que una tarea terminada siguiera pareciendo que tiene deuda.
func Abiertos(ps []Pendiente) int {
	n := 0
	for _, p := range ps {
		if !p.Hecho {
			n++
		}
	}
	return n
}
