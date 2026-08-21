// php.go — DE UN ARCHIVO PHP A SU ESQUELETO Y SUS LLAMADAS, con AST de verdad.
//
// POR QUÉ TREE-SITTER Y NO REGEX. El techo del extractor de `workers` está medido: para
// `LenderUserCategoryService` el índice regex encuentra 11 archivos y `git grep` 22. La mitad de las
// aristas se pierde y —lo peor— se pierde en silencio: una respuesta parcial a «¿quién llama a esto?»
// se lee como código muerto. Con AST el parseo no adivina.
//
// LO QUE SACA, y para qué sirve cada cosa:
//
//	· namespace + use  → resolver un nombre corto a su FQCN sin leer composer.json
//	· clase + métodos  → EL ESQUELETO: la interfaz del archivo, ~15x más chica que el archivo
//	· props TIPADAS    → la llave de la resolución. `private LenderRepo $repo` + `$this->repo->x()`
//	                     resuelve a `LenderRepo::x` SIN inferencia de tipos. Laravel inyecta por
//	                     constructor en casi todos lados, así que esto cubre mucho.
//	· llamadas         → los call sites, cada uno con la FORMA de la que salió (su procedencia)
package main

import (
	"strings"

	ts "github.com/tree-sitter/go-tree-sitter"
	php "github.com/tree-sitter/tree-sitter-php/bindings/go"
)

type metodo struct {
	Nombre string `json:"n"`
	Firma  string `json:"f"`
	Linea  int    `json:"l"`
}

// llamada — un call site SIN resolver todavía. `Objeto` es el nombre de la propiedad o de la clase;
// la resolución a un archivo concreto pasa después, cuando ya se leyeron todos los archivos.
type llamada struct {
	Objeto string `json:"o,omitempty"` // "repo" en $this->repo->x() · "Foo" en Foo::x() · "" si es $this->x()
	Metodo string `json:"m"`
	Linea  int    `json:"l"`
	Forma  string `json:"fo"` // prop | estatico | interno | libre
}

type archivo struct {
	Ruta      string            `json:"ruta"`
	Namespace string            `json:"ns,omitempty"`
	Clase     string            `json:"clase,omitempty"`
	Extiende  string            `json:"extiende,omitempty"`
	Usa       map[string]string `json:"usa,omitempty"`   // nombre corto -> FQCN
	Props     map[string]string `json:"props,omitempty"` // $prop -> tipo, DECLARADO (promoción o property)
	Ctor      map[string]string `json:"ctor,omitempty"`  // $prop -> tipo, INFERIDO del parámetro del constructor
	Metodos   []metodo          `json:"metodos,omitempty"`
	Llamadas  []llamada         `json:"llamadas,omitempty"`
	Bytes     int               `json:"bytes"`
	BytesEsq  int               `json:"bytes_esq"`
}

type extractor struct{ p *ts.Parser }

func nuevoExtractor() *extractor {
	p := ts.NewParser()
	_ = p.SetLanguage(ts.NewLanguage(php.LanguagePHP()))
	return &extractor{p: p}
}

func (e *extractor) cerrar() { e.p.Close() }

func txt(src []byte, n *ts.Node) string {
	if n == nil {
		return ""
	}
	return string(src[n.StartByte():n.EndByte()])
}

// corto — el último segmento de un FQCN. `App\Repos\LenderRepo` → `LenderRepo`.
func corto(fqcn string) string {
	if i := strings.LastIndex(fqcn, "\\"); i >= 0 {
		return fqcn[i+1:]
	}
	return fqcn
}

func (e *extractor) extraer(ruta string, src []byte) *archivo {
	tree := e.p.Parse(src, nil)
	defer tree.Close()
	a := &archivo{Ruta: ruta, Usa: map[string]string{}, Props: map[string]string{}, Ctor: map[string]string{}, Bytes: len(src)}
	var esq strings.Builder

	var caminar func(n *ts.Node)
	caminar = func(n *ts.Node) {
		switch n.Kind() {
		case "namespace_definition":
			if c := n.ChildByFieldName("name"); c != nil {
				a.Namespace = txt(src, c)
				esq.WriteString("namespace " + a.Namespace + ";\n")
			}
		case "namespace_use_declaration":
			for i := uint(0); i < n.NamedChildCount(); i++ {
				cl := n.NamedChild(i)
				if cl.Kind() != "namespace_use_clause" {
					continue
				}
				fq := strings.TrimSpace(txt(src, cl))
				alias := ""
				if p := cl.ChildByFieldName("alias"); p != nil { // use A\B as C;
					alias = txt(src, p)
					fq = strings.TrimSpace(strings.Split(fq, " as ")[0])
				}
				fq = strings.TrimPrefix(fq, "\\")
				if alias == "" {
					alias = corto(fq)
				}
				a.Usa[alias] = fq
				esq.WriteString("use " + fq + ";\n")
			}
		case "class_declaration", "interface_declaration", "trait_declaration":
			if c := n.ChildByFieldName("name"); c != nil && a.Clase == "" {
				a.Clase = txt(src, c)
				if a.Namespace != "" {
					a.Clase = a.Namespace + "\\" + a.Clase
				}
			}
			// ⚠ `base_clause` NO es un field en esta gramática: es un hijo nombrado. Buscarlo por
			// ChildByFieldName devolvía nil siempre y el campo quedaba vacío en los 2.529 archivos, sin
			// que nada fallara — el modo exacto en que un índice miente.
			for i := uint(0); i < n.NamedChildCount(); i++ {
				if c := n.NamedChild(i); c.Kind() == "base_clause" {
					a.Extiende = corto(strings.TrimLeft(strings.TrimSpace(strings.TrimPrefix(txt(src, c), "extends")), "\\"))
				}
			}
			decl := txt(src, n) // la declaración, sin el cuerpo
			if i := strings.Index(decl, "{"); i > 0 {
				decl = decl[:i]
			}
			esq.WriteString(strings.Join(strings.Fields(decl), " ") + "\n")
		case "property_promotion_parameter":
			// `private LenderRepo $repo` en el constructor: la forma que más rinde en Laravel.
			tipo := txt(src, n.ChildByFieldName("type"))
			nom := strings.TrimPrefix(txt(src, n.ChildByFieldName("name")), "$")
			if tipo != "" && nom != "" {
				a.Props[nom] = corto(strings.TrimLeft(tipo, "?\\"))
			}
		case "property_declaration":
			// `private LenderRepo $repo;` declarada aparte y asignada en el constructor.
			var tipo string
			for i := uint(0); i < n.NamedChildCount(); i++ {
				c := n.NamedChild(i)
				switch c.Kind() {
				case "named_type", "primitive_type", "optional_type", "union_type":
					tipo = txt(src, c)
				case "property_element":
					nom := strings.TrimPrefix(txt(src, c.ChildByFieldName("name")), "$")
					if tipo != "" && nom != "" {
						a.Props[nom] = corto(strings.TrimLeft(tipo, "?\\"))
					}
				}
			}
		case "method_declaration":
			nom := txt(src, n.ChildByFieldName("name"))
			firma := txt(src, n)
			if i := strings.Index(firma, "{"); i > 0 {
				firma = firma[:i]
			}
			firma = strings.Join(strings.Fields(firma), " ")
			a.Metodos = append(a.Metodos, metodo{Nombre: nom, Firma: firma, Linea: int(n.StartPosition().Row) + 1})
			esq.WriteString("  " + firma + "\n")
			if nom == "__construct" {
				// `public function __construct(TracerService $tracer)` + `$this->tracer = $tracer` en el
				// cuerpo. NO se lee la asignación: en Laravel el parámetro y la propiedad se llaman
				// igual en la práctica totalidad de los casos, así que se asume — y por eso la arista
				// que salga de acá se marca `ctor`, no `prop`. La procedencia distingue lo inferido de
				// lo declarado; sin ese campo esta suposición se leería como un hecho.
				if fp := n.ChildByFieldName("parameters"); fp != nil {
					for i := uint(0); i < fp.NamedChildCount(); i++ {
						pm := fp.NamedChild(i)
						if pm.Kind() != "simple_parameter" {
							continue
						}
						tipo := txt(src, pm.ChildByFieldName("type"))
						pn := strings.TrimPrefix(txt(src, pm.ChildByFieldName("name")), "$")
						if tipo != "" && pn != "" {
							a.Ctor[pn] = corto(strings.TrimLeft(tipo, "?\\"))
						}
					}
				}
			}
		case "member_call_expression":
			nom := txt(src, n.ChildByFieldName("name"))
			ln := int(n.StartPosition().Row) + 1
			ot := txt(src, n.ChildByFieldName("object"))
			switch {
			case ot == "$this":
				a.Llamadas = append(a.Llamadas, llamada{Metodo: nom, Linea: ln, Forma: "interno"})
			case strings.HasPrefix(ot, "$this->") && !strings.ContainsAny(strings.TrimPrefix(ot, "$this->"), "->()[] "):
				// $this->repo->metodo() — el caso resoluble por tipo de propiedad.
				a.Llamadas = append(a.Llamadas, llamada{Objeto: strings.TrimPrefix(ot, "$this->"), Metodo: nom, Linea: ln, Forma: "prop"})
			default:
				a.Llamadas = append(a.Llamadas, llamada{Metodo: nom, Linea: ln, Forma: "libre"})
			}
		case "scoped_call_expression":
			// Foo::bar() — resoluble por el mapa de `use`.
			esc := txt(src, n.ChildByFieldName("scope"))
			nom := txt(src, n.ChildByFieldName("name"))
			ln := int(n.StartPosition().Row) + 1
			if esc != "" && !strings.HasPrefix(esc, "$") {
				a.Llamadas = append(a.Llamadas, llamada{Objeto: corto(strings.TrimLeft(esc, "\\")), Metodo: nom, Linea: ln, Forma: "estatico"})
			} else {
				a.Llamadas = append(a.Llamadas, llamada{Metodo: nom, Linea: ln, Forma: "libre"})
			}
		}
		for i := uint(0); i < n.ChildCount(); i++ {
			caminar(n.Child(i))
		}
	}
	caminar(tree.RootNode())
	a.BytesEsq = esq.Len()
	return a
}
