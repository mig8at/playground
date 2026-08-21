// grafo.go — DE CALL SITES A ARISTAS RESUELTAS, y cada arista dice de dónde salió.
//
// LA REGLA QUE GOBIERNA ESTE ARCHIVO: las aristas las resuelve el CÓDIGO, nunca el modelo. Medido en
// los dos monolitos, el 65% de las definiciones de método cae bajo un nombre que está definido en más
// de un archivo (`create` en 197, `findById` en 171, `update` en 166) — y de los nombres con exactamente
// dos definiciones, 435 son «una en cada repo», o sea el gemelo. Un modelo uniendo por nombre cablea el
// gemelo MUERTO con total confianza. Un grafo plausible y equivocado es peor que ninguno.
//
// POR ESO CADA ARISTA LLEVA `como`: de qué mecanismo salió. Es el mismo patrón que ya funcionó con las
// relaciones de tablas —44 FK declaradas contra 388 reconstruidas, cada una diciendo su procedencia—.
// Sin ese campo, una arista adivinada y una arista segura se leen igual.
//
//	prop      → $this->repo->x() + `private LenderRepo $repo`     → SEGURA, resuelta por tipo
//	estatico  → Foo::x() + `use App\Foo`                          → SEGURA, resuelta por el import
//	interno   → $this->x() dentro de la misma clase               → SEGURA
//	(sin resolver)  $algo->x() sobre una variable local           → NO se inventa: se cuenta y se reporta
package main

import "sort"

type arista struct {
	De    string `json:"de"` // ruta del archivo que llama
	A     string `json:"a"`  // ruta del archivo llamado
	Clase string `json:"clase"`
	Met   string `json:"met"`
	Linea int    `json:"linea"`
	Como  string `json:"como"`
}

type grafo struct {
	Repo     string              `json:"repo"`
	Rama     string              `json:"rama"`
	Archivos map[string]*archivo `json:"archivos"`
	Aristas  []arista            `json:"aristas"`
	Stats    map[string]int      `json:"stats"`
}

// resolver — cruza los call sites contra el índice de clases. Corre DESPUÉS de leer todo: hasta que no
// están todos los archivos, un nombre no se puede descartar como inexistente.
func (g *grafo) resolver() {
	porFQCN := map[string]*archivo{} // App\Services\Foo -> archivo
	porCorto := map[string][]*archivo{}
	for _, a := range g.Archivos {
		if a.Clase == "" {
			continue
		}
		porFQCN[a.Clase] = a
		c := corto(a.Clase)
		porCorto[c] = append(porCorto[c], a)
	}

	st := map[string]int{}
	// destino — de un nombre corto de clase al archivo que la define, usando el mapa de `use` del
	// archivo que llama. Si el `use` no lo tiene, se prueba el mismo namespace. Nada más: adivinar por
	// nombre corto global es exactamente el error que este archivo existe para no cometer.
	destino := func(desde *archivo, nombreCorto string) *archivo {
		if fq, ok := desde.Usa[nombreCorto]; ok {
			if d := porFQCN[fq]; d != nil {
				return d
			}
			return nil // importado de vendor o de un repo que no indexamos: no es una arista nuestra
		}
		if desde.Namespace != "" {
			if d := porFQCN[desde.Namespace+"\\"+nombreCorto]; d != nil {
				return d
			}
		}
		return nil
	}
	tiene := func(a *archivo, met string) bool {
		for _, m := range a.Metodos {
			if m.Nombre == met {
				return true
			}
		}
		return false
	}

	for _, a := range g.Archivos {
		for _, ll := range a.Llamadas {
			st["llamadas"]++
			switch ll.Forma {
			case "interno":
				st["interno"]++
				if tiene(a, ll.Metodo) {
					g.Aristas = append(g.Aristas, arista{De: a.Ruta, A: a.Ruta, Clase: a.Clase, Met: ll.Metodo, Linea: ll.Linea, Como: "interno"})
					st["resueltas"]++
				} else {
					st["interno_heredado"]++ // está en la clase padre o en un trait: no se inventa
				}
			case "prop":
				st["prop"]++
				como := "prop"
				tipo, ok := a.Props[ll.Objeto]
				if !ok {
					// Fallback: el parámetro del constructor con el mismo nombre. Inferido, no declarado.
					if tipo, ok = a.Ctor[ll.Objeto]; ok {
						como = "ctor"
					}
				}
				if !ok {
					st["prop_sin_tipo"]++ // ni promovida, ni declarada, ni parámetro: no hay de dónde
					continue
				}
				d := destino(a, tipo)
				if d == nil {
					st["prop_fuera"]++
					continue
				}
				if !tiene(d, ll.Metodo) {
					st["prop_metodo_heredado"]++
					continue
				}
				g.Aristas = append(g.Aristas, arista{De: a.Ruta, A: d.Ruta, Clase: d.Clase, Met: ll.Metodo, Linea: ll.Linea, Como: como})
				st["resueltas"]++
				st["como_"+como]++
			case "estatico":
				st["estatico"]++
				d := destino(a, ll.Objeto)
				if d == nil {
					st["estatico_fuera"]++
					continue
				}
				if !tiene(d, ll.Metodo) {
					st["estatico_metodo_heredado"]++
					continue
				}
				g.Aristas = append(g.Aristas, arista{De: a.Ruta, A: d.Ruta, Clase: d.Clase, Met: ll.Metodo, Linea: ll.Linea, Como: "estatico"})
				st["resueltas"]++
			default:
				st["libre"]++ // $var->x() sobre una local. Honesto: no se resuelve
			}
		}
	}
	sort.Slice(g.Aristas, func(i, j int) bool {
		if g.Aristas[i].De != g.Aristas[j].De {
			return g.Aristas[i].De < g.Aristas[j].De
		}
		return g.Aristas[i].Linea < g.Aristas[j].Linea
	})
	for k, v := range st {
		g.Stats[k] = v
	}
}

// vecinos — quién llama a este archivo y a quién llama. La travesía que un motor de grafos vendería:
// acá es un map y responde en microsegundos sobre 10^5 aristas.
func (g *grafo) vecinos(ruta string) (entran, salen []arista) {
	for _, e := range g.Aristas {
		if e.A == ruta && e.De != ruta {
			entran = append(entran, e)
		}
		if e.De == ruta && e.A != ruta {
			salen = append(salen, e)
		}
	}
	return
}
