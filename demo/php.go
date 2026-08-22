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

type method struct {
	Name      string `json:"n"`
	Signature string `json:"f"`
	Line      int    `json:"l"`
}

// callSite — una llamada SIN resolver todavía. `Object` es el nombre de la propiedad o de la clase;
// la resolución a un archivo concreto pasa después, cuando ya se leyeron todos los archivos.
type callSite struct {
	Object string `json:"o,omitempty"` // "repo" en $this->repo->x() · "Foo" en Foo::x() · "" si es $this->x()
	Method string `json:"m"`
	Line   int    `json:"l"`
	Form   string `json:"fo"` // prop | static | self | free
}

type sourceFile struct {
	Path       string            `json:"path"`
	Namespace  string            `json:"ns,omitempty"`
	Class      string            `json:"class,omitempty"`
	Extends    string            `json:"extends,omitempty"`
	Traits     []string          `json:"traits,omitempty"` // `use X;` DENTRO de la clase
	Implements []string          `json:"implements,omitempty"`
	Imports    map[string]string `json:"imports,omitempty"` // nombre corto -> FQCN
	Props      map[string]string `json:"props,omitempty"`   // $prop -> tipo, DECLARADO
	CtorProps  map[string]string `json:"ctor,omitempty"`    // $prop -> tipo, INFERIDO del constructor
	Methods    []method          `json:"methods,omitempty"`
	Calls      []callSite        `json:"calls,omitempty"`
	Cases      []string          `json:"cases,omitempty"`  // Pest: la descripción de cada it()/test()
	Tables     []string          `json:"tables,omitempty"` // sólo migraciones: Schema::create/table('x')
	Tier       string            `json:"tier"`
	Bytes      int               `json:"bytes"`
	BytesTier  int               `json:"bytes_tier"` // lo que el mapa manda DE VERDAD, según su tier
	BytesFull  int               `json:"bytes_full"` // el esqueleto completo, para poder medir el ahorro
}

type extractor struct{ p *ts.Parser }

func newExtractor() *extractor {
	p := ts.NewParser()
	_ = p.SetLanguage(ts.NewLanguage(php.LanguagePHP()))
	return &extractor{p: p}
}

func (e *extractor) close() { e.p.Close() }

func text(src []byte, n *ts.Node) string {
	if n == nil {
		return ""
	}
	return string(src[n.StartByte():n.EndByte()])
}

// shortName — el último segmento de un FQCN. `App\Repos\LenderRepo` → `LenderRepo`.
func shortName(fqcn string) string {
	if i := strings.LastIndex(fqcn, "\\"); i >= 0 {
		return fqcn[i+1:]
	}
	return fqcn
}

func (e *extractor) extract(path string, src []byte) *sourceFile {
	tree := e.p.Parse(src, nil)
	defer tree.Close()
	f := &sourceFile{Path: path, Imports: map[string]string{}, Props: map[string]string{},
		CtorProps: map[string]string{}, Tier: classify(path), Bytes: len(src)}
	var skel strings.Builder

	var walk func(n *ts.Node)
	walk = func(n *ts.Node) {
		switch n.Kind() {
		case "namespace_definition":
			if c := n.ChildByFieldName("name"); c != nil {
				f.Namespace = text(src, c)
				skel.WriteString("namespace " + f.Namespace + ";\n")
			}

		case "namespace_use_declaration":
			for i := uint(0); i < n.NamedChildCount(); i++ {
				clause := n.NamedChild(i)
				if clause.Kind() != "namespace_use_clause" {
					continue
				}
				fqcn := strings.TrimSpace(text(src, clause))
				alias := ""
				if p := clause.ChildByFieldName("alias"); p != nil { // use A\B as C;
					alias = text(src, p)
					fqcn = strings.TrimSpace(strings.Split(fqcn, " as ")[0])
				}
				fqcn = strings.TrimPrefix(fqcn, "\\")
				if alias == "" {
					alias = shortName(fqcn)
				}
				f.Imports[alias] = fqcn
				skel.WriteString("use " + fqcn + ";\n")
			}

		case "use_declaration":
			// ⚠ `use X;` DENTRO del cuerpo de la clase es un TRAIT, y su nodo es `use_declaration` —
			// distinto de `namespace_use_declaration`, que es el import del archivo. Tratarlos igual
			// metía los imports como traits y la jerarquía quedaba inventada.
			for i := uint(0); i < n.NamedChildCount(); i++ {
				c := n.NamedChild(i)
				if k := c.Kind(); k == "name" || k == "qualified_name" {
					f.Traits = append(f.Traits, shortName(strings.TrimLeft(text(src, c), "\\")))
				}
			}

		case "class_declaration", "interface_declaration", "trait_declaration":
			if c := n.ChildByFieldName("name"); c != nil && f.Class == "" {
				f.Class = text(src, c)
				if f.Namespace != "" {
					f.Class = f.Namespace + "\\" + f.Class
				}
			}
			// ⚠ `base_clause` NO es un field en esta gramática: es un hijo nombrado. Buscarlo por
			// ChildByFieldName devolvía nil siempre y el campo quedaba vacío en los 2.529 archivos, sin
			// que nada fallara — el modo exacto en que un índice miente.
			for i := uint(0); i < n.NamedChildCount(); i++ {
				c := n.NamedChild(i)
				switch c.Kind() {
				case "base_clause":
					f.Extends = shortName(strings.TrimLeft(
						strings.TrimSpace(strings.TrimPrefix(text(src, c), "extends")), "\\"))
				case "class_interface_clause":
					for j := uint(0); j < c.NamedChildCount(); j++ {
						f.Implements = append(f.Implements,
							shortName(strings.TrimLeft(text(src, c.NamedChild(j)), "\\")))
					}
				}
			}
			decl := text(src, n) // la declaración, sin el cuerpo
			if i := strings.Index(decl, "{"); i > 0 {
				decl = decl[:i]
			}
			skel.WriteString(strings.Join(strings.Fields(decl), " ") + "\n")

		case "property_promotion_parameter":
			// `private LenderRepo $repo` en el constructor: la forma que más rinde en Laravel.
			typ := text(src, n.ChildByFieldName("type"))
			name := strings.TrimPrefix(text(src, n.ChildByFieldName("name")), "$")
			if typ != "" && name != "" {
				f.Props[name] = shortName(strings.TrimLeft(typ, "?\\"))
			}

		case "property_declaration":
			// `private LenderRepo $repo;` declarada aparte y asignada en el constructor.
			var typ string
			for i := uint(0); i < n.NamedChildCount(); i++ {
				c := n.NamedChild(i)
				switch c.Kind() {
				case "named_type", "primitive_type", "optional_type", "union_type":
					typ = text(src, c)
				case "property_element":
					name := strings.TrimPrefix(text(src, c.ChildByFieldName("name")), "$")
					if typ != "" && name != "" {
						f.Props[name] = shortName(strings.TrimLeft(typ, "?\\"))
					}
				}
			}

		case "method_declaration", "function_definition":
			name := text(src, n.ChildByFieldName("name"))
			sig := text(src, n)
			if i := strings.Index(sig, "{"); i > 0 {
				sig = sig[:i]
			}
			sig = strings.Join(strings.Fields(sig), " ")
			f.Methods = append(f.Methods, method{Name: name, Signature: sig,
				Line: int(n.StartPosition().Row) + 1})
			skel.WriteString("  " + sig + "\n")
			if name == "__construct" {
				// `public function __construct(TracerService $tracer)` + `$this->tracer = $tracer` en
				// el cuerpo. NO se lee la asignación: en Laravel el parámetro y la propiedad se llaman
				// igual en la práctica totalidad de los casos, así que se asume — y por eso la arista
				// que salga de acá se marca `ctor`, no `prop`. La procedencia distingue lo inferido de
				// lo declarado; sin ese campo esta suposición se leería como un hecho.
				if params := n.ChildByFieldName("parameters"); params != nil {
					for i := uint(0); i < params.NamedChildCount(); i++ {
						p := params.NamedChild(i)
						if p.Kind() != "simple_parameter" {
							continue
						}
						typ := text(src, p.ChildByFieldName("type"))
						pn := strings.TrimPrefix(text(src, p.ChildByFieldName("name")), "$")
						if typ != "" && pn != "" {
							f.CtorProps[pn] = shortName(strings.TrimLeft(typ, "?\\"))
						}
					}
				}
			}

		case "member_call_expression":
			name := text(src, n.ChildByFieldName("name"))
			line := int(n.StartPosition().Row) + 1
			obj := text(src, n.ChildByFieldName("object"))
			switch {
			case obj == "$this":
				f.Calls = append(f.Calls, callSite{Method: name, Line: line, Form: "self"})
			case strings.HasPrefix(obj, "$this->") &&
				!strings.ContainsAny(strings.TrimPrefix(obj, "$this->"), "->()[] "):
				// $this->repo->method() — el caso resoluble por tipo de propiedad.
				f.Calls = append(f.Calls, callSite{Object: strings.TrimPrefix(obj, "$this->"),
					Method: name, Line: line, Form: "prop"})
			default:
				f.Calls = append(f.Calls, callSite{Method: name, Line: line, Form: "free"})
			}

		case "function_call_expression":
			// Pest: it('...') / test('...') / describe('...'). La descripción ES la documentación de la
			// regla, y en prosa: mejor que cualquier nombre de método.
			fn := text(src, n.ChildByFieldName("function"))
			if fn != "it" && fn != "test" && fn != "describe" {
				break
			}
			if args := n.ChildByFieldName("arguments"); args != nil && args.NamedChildCount() > 0 {
				d := strings.Trim(strings.TrimSpace(text(src, args.NamedChild(0))), "'\"")
				if d != "" && !strings.ContainsAny(d, "$(){}") {
					f.Cases = append(f.Cases, d)
				}
			}

		case "scoped_call_expression":
			// Foo::bar() — resoluble por el mapa de `use`.
			scope := text(src, n.ChildByFieldName("scope"))
			name := text(src, n.ChildByFieldName("name"))
			line := int(n.StartPosition().Row) + 1
			if scope == "Schema" && (name == "create" || name == "table" || name == "drop" ||
				name == "dropIfExists" || name == "rename") {
				// La migración se representa por LAS TABLAS QUE TOCA, no por las firmas de up()/down().
				// Sacarlo acá y no en un pase aparte es gratis: el nodo ya está en la mano.
				if args := n.ChildByFieldName("arguments"); args != nil {
					for k := uint(0); k < args.NamedChildCount(); k++ {
						t := strings.Trim(text(src, args.NamedChild(k)), "'\"")
						if t == "" || strings.ContainsAny(t, "$(){} ") {
							continue
						}
						seen := false
						for _, x := range f.Tables {
							if x == t {
								seen = true
							}
						}
						if !seen {
							f.Tables = append(f.Tables, t)
						}
						break
					}
				}
			}
			if scope != "" && !strings.HasPrefix(scope, "$") {
				f.Calls = append(f.Calls, callSite{Object: shortName(strings.TrimLeft(scope, "\\")),
					Method: name, Line: line, Form: "static"})
			} else {
				f.Calls = append(f.Calls, callSite{Method: name, Line: line, Form: "free"})
			}
		}
		for i := uint(0); i < n.ChildCount(); i++ {
			walk(n.Child(i))
		}
	}
	walk(tree.RootNode())
	f.BytesFull = skel.Len()
	f.BytesTier = len(render(f))
	return f
}
