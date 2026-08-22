// graph.go — DE CALL SITES A ARISTAS RESUELTAS, y cada arista dice de dónde salió.
//
// LA REGLA QUE GOBIERNA ESTE ARCHIVO: las aristas las resuelve el CÓDIGO, nunca el modelo. Medido en
// los dos monolitos, el 65% de las definiciones de método cae bajo un nombre definido en más de un
// archivo (`create` en 197, `findById` en 171, `update` en 166) — y de los nombres con exactamente dos
// definiciones, 435 son «una en cada repo», o sea el gemelo. Un modelo uniendo por nombre cablea el
// gemelo MUERTO con total confianza. Un grafo plausible y equivocado es peor que ninguno.
//
// POR ESO CADA ARISTA LLEVA `Kind`: de qué mecanismo salió. Es el mismo patrón que ya funcionó con las
// relaciones de tablas —44 FK declaradas contra 388 reconstruidas, cada una diciendo su procedencia—.
// Sin ese campo, una arista adivinada y una arista segura se leen igual.
//
//	self    → $this->x() en la misma clase                      → declarada
//	prop    → $this->repo->x() + `private LenderRepo $repo`      → declarada (tipo explícito)
//	static  → Foo::x() + `use App\Foo`                           → declarada (import explícito)
//	ctor    → $this->tracer->x() + __construct(TracerService $t)  → INFERIDA
//	(sin resolver) $var->x() sobre una local                      → NO se inventa: se cuenta y se reporta
package main

import "sort"

type edge struct {
	From   string `json:"from"`
	To     string `json:"to"`
	Class  string `json:"class"`
	Method string `json:"method"`
	Line   int    `json:"line"`
	Kind   string `json:"kind"`
	Via    string `json:"via,omitempty"` // el ancestro donde apareció el método, si no era la clase misma
}

type graph struct {
	Repo   string                 `json:"repo"`
	Branch string                 `json:"branch"`
	Files  map[string]*sourceFile `json:"files"`
	Edges  []edge                 `json:"edges"`
	Stats  map[string]int         `json:"stats"`
}

// resolve — cruza los call sites contra el índice de clases. Corre DESPUÉS de leer todo: hasta que no
// están todos los archivos, un nombre no se puede descartar como inexistente.
func (g *graph) resolve() {
	byFQCN := map[string]*sourceFile{}
	for _, f := range g.Files {
		if f.Class != "" {
			byFQCN[f.Class] = f
		}
	}

	st := map[string]int{}
	// target — de un nombre corto de clase al archivo que la define, usando el mapa de imports del
	// archivo que la NOMBRA. Si no lo tiene, se prueba el mismo namespace. Nada más: adivinar por
	// nombre corto global es exactamente el error que este archivo existe para no cometer.
	target := func(from *sourceFile, short string) *sourceFile {
		if fqcn, ok := from.Imports[short]; ok {
			if d := byFQCN[fqcn]; d != nil {
				return d
			}
			return nil // vendor, o un repo que no indexamos: no es una arista nuestra
		}
		if from.Namespace != "" {
			if d := byFQCN[from.Namespace+"\\"+short]; d != nil {
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
	// ⚠ El orden es el de PHP: la clase primero, después sus traits, después el padre. Y la arista
	// apunta al archivo que DEFINE el método, no a la clase por la que se entró — si no, el mapa manda
	// a leer un archivo donde el método no está.
	cache := map[string][]*sourceFile{}
	ancestors := func(f *sourceFile) []*sourceFile {
		if v, ok := cache[f.Path]; ok {
			return v
		}
		var chain []*sourceFile
		seen := map[string]bool{}
		queue := []*sourceFile{f}
		for len(queue) > 0 && len(chain) < 24 { // el tope corta jerarquías absurdas, no las normales
			cur := queue[0]
			queue = queue[1:]
			if cur == nil || seen[cur.Path] {
				continue
			}
			seen[cur.Path] = true
			chain = append(chain, cur)
			for _, t := range cur.Traits {
				if d := target(cur, t); d != nil {
					queue = append(queue, d)
				}
			}
			if cur.Extends != "" {
				if d := target(cur, cur.Extends); d != nil {
					queue = append(queue, d)
				}
			}
		}
		cache[f.Path] = chain
		return chain
	}

	declares := func(f *sourceFile, name string) bool {
		for _, m := range f.Methods {
			if m.Name == name {
				return true
			}
		}
		return false
	}
	// methodIn — el primer ancestro que DEFINE el método. El bool dice si hubo que subir.
	methodIn := func(f *sourceFile, name string) (*sourceFile, bool) {
		for i, x := range ancestors(f) {
			if declares(x, name) {
				return x, i > 0
			}
		}
		return nil, false
	}
	// propIn — quién declara la propiedad, con qué tipo y de qué forma. Devuelve el DUEÑO porque el
	// tipo hay que resolverlo con SU mapa de imports, no con el del que llama: la propiedad heredada
	// se declara en el padre, que es el que importó la clase.
	propIn := func(f *sourceFile, prop string) (*sourceFile, string, string) {
		for _, x := range ancestors(f) {
			if t, ok := x.Props[prop]; ok {
				return x, t, "prop"
			}
			if t, ok := x.CtorProps[prop]; ok {
				return x, t, "ctor"
			}
		}
		return nil, "", ""
	}
	add := func(from, def *sourceFile, climbed bool, name string, line int, kind string) {
		via := ""
		if climbed {
			via = shortName(def.Class)
		}
		g.Edges = append(g.Edges, edge{From: from.Path, To: def.Path, Class: def.Class,
			Method: name, Line: line, Kind: kind, Via: via})
		st["resolved"]++
		st["kind_"+kind]++
		if climbed {
			st["by_hierarchy"]++
		}
	}

	for _, f := range g.Files {
		for _, c := range f.Calls {
			st["calls"]++
			switch c.Form {
			case "self":
				st["form_self"]++
				d, climbed := methodIn(f, c.Method)
				if d == nil {
					st["not_found"]++ // ni en la clase ni en su jerarquía indexada: no se inventa
					continue
				}
				add(f, d, climbed, c.Method, c.Line, "self")

			case "prop":
				st["form_prop"]++
				owner, typ, kind := propIn(f, c.Object)
				if owner == nil {
					st["untyped"]++ // ni promovida, ni declarada, ni parámetro, ni heredada
					continue
				}
				class := target(owner, typ)
				if class == nil {
					st["outside_repo"]++
					continue
				}
				d, climbed := methodIn(class, c.Method)
				if d == nil {
					st["not_found"]++
					continue
				}
				add(f, d, climbed || class != d, c.Method, c.Line, kind)

			case "static":
				st["form_static"]++
				class := target(f, c.Object)
				if class == nil {
					st["outside_repo"]++
					continue
				}
				d, climbed := methodIn(class, c.Method)
				if d == nil {
					st["not_found"]++
					continue
				}
				add(f, d, climbed || class != d, c.Method, c.Line, "static")

			default:
				st["free"]++ // $var->x() sobre una local. Honesto: no se resuelve
			}
		}
	}
	sort.Slice(g.Edges, func(i, j int) bool {
		if g.Edges[i].From != g.Edges[j].From {
			return g.Edges[i].From < g.Edges[j].From
		}
		return g.Edges[i].Line < g.Edges[j].Line
	})
	for k, v := range st {
		g.Stats[k] = v
	}
}

// neighbors — quién llama a este archivo y a quién llama. La travesía que un motor de grafos
// vendería: acá es un map y responde en microsegundos sobre 10^4 aristas.
func (g *graph) neighbors(path string) (in, out []edge) {
	for _, e := range g.Edges {
		if e.To == path && e.From != path {
			in = append(in, e)
		}
		if e.From == path && e.To != path {
			out = append(out, e)
		}
	}
	return
}

// degrees — cuántas aristas entran y salen de cada archivo. Se calcula una vez por corrida: los
// filtros --orphan/--leaf y el orden por grado lo necesitan para TODOS los archivos, así que hacerlo
// por archivo sería cuadrático sobre 11.000 aristas.
func (g *graph) degrees() (in, out map[string]int) {
	in, out = map[string]int{}, map[string]int{}
	for _, e := range g.Edges {
		if e.From == e.To {
			continue
		}
		in[e.To]++
		out[e.From]++
	}
	return
}
