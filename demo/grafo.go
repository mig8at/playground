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
	Via   string `json:"via,omitempty"` // el ancestro donde apareció el método, si no era la clase misma
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
	for _, a := range g.Archivos {
		if a.Clase != "" {
			porFQCN[a.Clase] = a
		}
	}

	st := map[string]int{}
	// destino — de un nombre corto de clase al archivo que la define, usando el mapa de `use` del
	// archivo que la NOMBRA. Si el `use` no lo tiene, se prueba el mismo namespace. Nada más: adivinar
	// por nombre corto global es exactamente el error que este archivo existe para no cometer.
	destino := func(desde *archivo, nombreCorto string) *archivo {
		if fq, ok := desde.Usa[nombreCorto]; ok {
			if d := porFQCN[fq]; d != nil {
				return d
			}
			return nil // vendor, o un repo que no indexamos: no es una arista nuestra
		}
		if desde.Namespace != "" {
			if d := porFQCN[desde.Namespace+"\\"+nombreCorto]; d != nil {
				return d
			}
		}
		return nil
	}

	// ── LA JERARQUÍA ────────────────────────────────────────────────────────────────────────────
	// Sin esto, `$this->getLenders()` en una subclase no resuelve a nada y el bucket honesto de «no
	// resolví» se comía 6.552 call sites. Medido: 1.045 de 2.529 archivos heredan o usan un trait.
	//
	// El caso que lo motivó: LenderListingService inyecta 10 servicios y no llama a ninguno — los pasa
	// a parent::__construct, y viven en LenderRetrievalService. Sin subir, el mapa del archivo más
	// importante del listado mostraba 12 aristas y ninguna al motor de riesgo.
	//
	// ⚠ El orden es PHP: la clase primero, después sus traits, después el padre. Y la arista apunta al
	// archivo que DEFINE el método, no a la clase por la que se entró — si no, el mapa manda a leer un
	// archivo donde el método no está.
	anc := map[string][]*archivo{}
	var ancestros func(a *archivo) []*archivo
	ancestros = func(a *archivo) []*archivo {
		if v, ok := anc[a.Ruta]; ok {
			return v
		}
		var out []*archivo
		visto := map[string]bool{}
		cola := []*archivo{a}
		for len(cola) > 0 && len(out) < 24 { // el tope corta jerarquías absurdas, no las normales
			cur := cola[0]
			cola = cola[1:]
			if cur == nil || visto[cur.Ruta] {
				continue
			}
			visto[cur.Ruta] = true
			out = append(out, cur)
			for _, t := range cur.Traits {
				if d := destino(cur, t); d != nil {
					cola = append(cola, d)
				}
			}
			if cur.Extiende != "" {
				if d := destino(cur, cur.Extiende); d != nil {
					cola = append(cola, d)
				}
			}
		}
		anc[a.Ruta] = out
		return out
	}

	tiene := func(a *archivo, met string) bool {
		for _, m := range a.Metodos {
			if m.Nombre == met {
				return true
			}
		}
		return false
	}
	// metodoEn — el primer ancestro que DEFINE el método. El bool dice si hubo que subir.
	metodoEn := func(a *archivo, met string) (*archivo, bool) {
		for i, x := range ancestros(a) {
			if tiene(x, met) {
				return x, i > 0
			}
		}
		return nil, false
	}
	// propEn — quién declara la propiedad, con qué tipo y de qué forma. Devuelve el DUEÑO porque el
	// tipo hay que resolverlo con SU mapa de `use`, no con el del que llama: la propiedad heredada se
	// declara en el padre, que es el que importó la clase.
	propEn := func(a *archivo, prop string) (*archivo, string, string) {
		for _, x := range ancestros(a) {
			if t, ok := x.Props[prop]; ok {
				return x, t, "prop"
			}
			if t, ok := x.Ctor[prop]; ok {
				return x, t, "ctor"
			}
		}
		return nil, "", ""
	}
	// arista hacia el archivo que define el método, marcando por dónde se llegó.
	agregar := func(desde *archivo, def *archivo, subio bool, met string, ln int, como string) {
		via := ""
		if subio {
			via = corto(def.Clase)
		}
		g.Aristas = append(g.Aristas, arista{De: desde.Ruta, A: def.Ruta, Clase: def.Clase, Met: met, Linea: ln, Como: como, Via: via})
		st["resueltas"]++
		st["como_"+como]++
		if subio {
			st["por_jerarquia"]++
		}
	}

	for _, a := range g.Archivos {
		for _, ll := range a.Llamadas {
			st["llamadas"]++
			switch ll.Forma {
			case "interno":
				st["f_interno"]++
				d, subio := metodoEn(a, ll.Metodo)
				if d == nil {
					st["no_hallado"]++ // ni en la clase ni en su jerarquía indexada: no se inventa
					continue
				}
				agregar(a, d, subio, ll.Metodo, ll.Linea, "interno")

			case "prop":
				st["f_prop"]++
				dueno, tipo, forma := propEn(a, ll.Objeto)
				if dueno == nil {
					st["sin_tipo"]++ // ni promovida, ni declarada, ni parámetro, ni heredada
					continue
				}
				clase := destino(dueno, tipo)
				if clase == nil {
					st["fuera_del_repo"]++
					continue
				}
				d, subio := metodoEn(clase, ll.Metodo)
				if d == nil {
					st["no_hallado"]++
					continue
				}
				agregar(a, d, subio || clase != d, ll.Metodo, ll.Linea, forma)

			case "estatico":
				st["f_estatico"]++
				clase := destino(a, ll.Objeto)
				if clase == nil {
					st["fuera_del_repo"]++
					continue
				}
				d, subio := metodoEn(clase, ll.Metodo)
				if d == nil {
					st["no_hallado"]++
					continue
				}
				agregar(a, d, subio || clase != d, ll.Metodo, ll.Linea, "estatico")

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
