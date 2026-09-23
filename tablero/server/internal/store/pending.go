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
//   - [ ] backfill de `allied_documents` no idempotente → cambiar `insert` por `updateOrInsert`
//   - [x] renombrar las rutas a nombres genéricos
//
// ⚠ SÓLO DEL CUERPO PRIVADO. El llamador pasa `notes` (lo que `splitBody` deja ANTES del marcador
// de la publicable), y eso no es un detalle de implementación: de las 37 casillas que hay hoy en las
// tareas, 17 son «Criterios de aceptación» de la sección publicable — la checklist de QA, que no es un
// pendiente de nadie. Contarlas daría 5 pendientes en tareas que tienen 0. Es el mismo error de corte
// que ya se cometió una vez midiendo la publicable.
//
// ⚠ Y NO se tildan solas. Medido el 2026-08-20 sobre las 41 tareas: 37 casillas escritas y **1** sola
// tildada. O sea que `Done` dice poco y el número que importa es el de las ABIERTAS — por eso
// `OpenItems()` existe y es lo que cuenta la tarjeta. Un pendiente resuelto se borra o se tilda, pero
// nadie vuelve; asumir lo contrario haría que el contador mienta hacia abajo.
type PendingItem struct {
	What    string `json:"que"`     // el texto del ítem, una línea
	Done    bool   `json:"hecho"`   // la casilla está tildada
	Section string `json:"seccion"` // el encabezado bajo el que vive, para agrupar en el cajón
}

// La casilla, con la indentación que tenga: los pendientes anidados cuentan igual. Se acepta `-`, `*`
// y `+` porque son los tres marcadores de lista de markdown y quien escribe no debería recordar cuál
// entiende el parser.
var rePending = regexp.MustCompile(`^\s*[-*+]\s+\[([ xX])\]\s+(.+)$`)

// Cualquier encabezado markdown: el más cercano por encima es el contexto del ítem.
var reHeading = regexp.MustCompile(`^#{1,6}\s+(.+?)\s*$`)

// Pending recoge las casillas del cuerpo, en el orden en que aparecen.
func Pending(body string) []PendingItem {
	out := []PendingItem{}
	section := ""
	for _, line := range strings.Split(body, "\n") {
		if h := reHeading.FindStringSubmatch(line); h != nil {
			section = strings.TrimSpace(h[1])
			continue
		}
		m := rePending.FindStringSubmatch(line)
		if m == nil {
			continue
		}
		what := strings.TrimSpace(m[2])
		if what == "" {
			continue
		}
		out = append(out, PendingItem{
			What:    what,
			Done:    m[1] != " ",
			Section: section,
		})
	}
	return out
}

// OpenItems cuenta los que quedan. Es el número de la tarjeta: los tildados ya no son trabajo, y
// mostrar el total haría que una tarea terminada siguiera pareciendo que tiene deuda.
func OpenItems(ps []PendingItem) int {
	n := 0
	for _, p := range ps {
		if !p.Done {
			n++
		}
	}
	return n
}
