package naming

// extract.go — lo que se DECLARA en cada lenguaje, con su posición.
//
// Go se lee con `go/ast` acá mismo (hasta el 2026-09-23 eran dos comandos aparte en
// `tools/rename/go/cmd/{decls,json-keys}`; `cmd/naming -decls|-json-keys` los reemplaza con el mismo
// formato). Vue/JS lo lee `tools/rename/js/decls.mjs`, con los parsers de babel y de Vue. El Python que
// queda en el tablero lo lee el `ast` de Python: es el único parser que lo entiende de verdad, y un
// extractor a mano diría «todo en inglés» sobre lo que no supo leer.

import (
	"bufio"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"sort"
	"strconv"
	"strings"
)

// Decl es un nombre declarado: dónde, cuál y de qué clase (func, param, var, type…).
type Decl struct {
	Path string
	Line int
	Col  int
	Name string
	Kind string
}

// GoDecls: cada identificador DECLARADO en los .go de un árbol, en el orden en que aparecen.
func GoDecls(root string, errs io.Writer) []Decl {
	var out []Decl
	fset := token.NewFileSet()
	_ = filepath.Walk(root, func(p string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() || !strings.HasSuffix(p, ".go") {
			return nil
		}
		f, err := parser.ParseFile(fset, p, nil, 0)
		if err != nil {
			fmt.Fprintln(errs, err)
			return nil
		}
		emit := func(id *ast.Ident, kind string) {
			if id == nil || id.Name == "_" {
				return
			}
			pos := fset.Position(id.Pos())
			out = append(out, Decl{pos.Filename, pos.Line, pos.Column, id.Name, kind})
		}
		fields := func(fl *ast.FieldList, kind string) {
			if fl == nil {
				return
			}
			for _, fd := range fl.List {
				for _, n := range fd.Names {
					emit(n, kind)
				}
			}
		}
		ast.Inspect(f, func(n ast.Node) bool {
			switch x := n.(type) {
			case *ast.FuncDecl:
				if x.Recv != nil {
					emit(x.Name, "method")
				} else {
					emit(x.Name, "func")
				}
				fields(x.Recv, "param")
				fields(x.Type.Params, "param")
				fields(x.Type.Results, "param")
			case *ast.FuncLit:
				fields(x.Type.Params, "param")
				fields(x.Type.Results, "param")
			case *ast.Field:
				// parámetros de un TIPO función (un campo o parámetro `f func(tema string)`)
				if ft, ok := x.Type.(*ast.FuncType); ok {
					fields(ft.Params, "param")
					fields(ft.Results, "param")
				}
			case *ast.TypeSpec:
				emit(x.Name, "type")
			case *ast.ValueSpec:
				for _, id := range x.Names {
					emit(id, "var")
				}
			case *ast.StructType:
				fields(x.Fields, "field")
			case *ast.InterfaceType:
				fields(x.Methods, "method")
			case *ast.AssignStmt:
				if x.Tok == token.DEFINE {
					for _, l := range x.Lhs {
						if id, ok := l.(*ast.Ident); ok {
							emit(id, "local")
						}
					}
				}
			case *ast.RangeStmt:
				if x.Tok == token.DEFINE {
					if id, ok := x.Key.(*ast.Ident); ok {
						emit(id, "local")
					}
					if id, ok := x.Value.(*ast.Ident); ok {
						emit(id, "local")
					}
				}
			case *ast.LabeledStmt:
				emit(x.Label, "label")
			}
			return true
		})
		return nil
	})
	return out
}

// Key es una clave JSON que el server emite: dónde (relativo al árbol), de qué clase —`tag` de struct,
// `map` literal o `index` (`output["canon"]`)— y en qué contexto (`Tipo.Campo` para una etiqueta).
type Key struct {
	Path string
	Line int
	Kind string
	Ctx  string
	Key  string
}

// JSONKeys: las etiquetas json de structs y las claves string de mapas literales e índices, sin tests.
func JSONKeys(root string) []Key {
	var out []Key
	fset := token.NewFileSet()
	_ = filepath.Walk(root, func(p string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() || !strings.HasSuffix(p, ".go") || strings.HasSuffix(p, "_test.go") {
			return nil
		}
		f, err := parser.ParseFile(fset, p, nil, 0)
		if err != nil {
			return nil
		}
		rel, _ := filepath.Rel(root, p)
		var stack []string
		ast.Inspect(f, func(n ast.Node) bool {
			switch x := n.(type) {
			case *ast.TypeSpec:
				stack = append(stack[:0], x.Name.Name)
			case *ast.StructType:
				for _, fl := range x.Fields.List {
					if fl.Tag == nil {
						continue
					}
					tag, _ := strconv.Unquote(fl.Tag.Value)
					j := strings.Split(reflect.StructTag(tag).Get("json"), ",")[0]
					if j == "" || j == "-" {
						continue
					}
					name := ""
					if len(fl.Names) > 0 {
						name = fl.Names[0].Name
					}
					ctx := "?"
					if len(stack) > 0 {
						ctx = stack[0]
					}
					// la línea de la ETIQUETA: en un campo de varias líneas va al final
					out = append(out, Key{rel, fset.Position(fl.Tag.Pos()).Line, "tag", ctx + "." + name, j})
				}
			case *ast.CompositeLit:
				if mt, ok := x.Type.(*ast.MapType); ok {
					if k, ok := mt.Key.(*ast.Ident); ok && k.Name == "string" {
						for _, el := range x.Elts {
							if kv, ok := el.(*ast.KeyValueExpr); ok {
								if bl, ok := kv.Key.(*ast.BasicLit); ok && bl.Kind == token.STRING {
									s, _ := strconv.Unquote(bl.Value)
									out = append(out, Key{rel, fset.Position(bl.Pos()).Line, "map", "-", s})
								}
							}
						}
					}
				}
			case *ast.IndexExpr: // output["canon"] = …
				if bl, ok := x.Index.(*ast.BasicLit); ok && bl.Kind == token.STRING {
					s, _ := strconv.Unquote(bl.Value)
					out = append(out, Key{rel, fset.Position(bl.Pos()).Line, "index", "-", s})
				}
			}
			return true
		})
		return nil
	})
	return out
}

// tsv corre un extractor externo y parte cada línea de su salida en campos.
func tsv(cmd *exec.Cmd, what string) ([][]string, error) {
	var stderr strings.Builder
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("no pude listar las declaraciones de %s:\n%s", what, stderr.String())
	}
	var rows [][]string
	sc := bufio.NewScanner(strings.NewReader(string(out)))
	sc.Buffer(make([]byte, 1<<20), 1<<24)
	for sc.Scan() {
		if line := sc.Text(); line != "" {
			rows = append(rows, strings.Split(line, "\t"))
		}
	}
	return rows, nil
}

// JSDecls: lo que declaran esos archivos de Vue/JS, según `decls.mjs`.
func JSDecls(declsScript string, files []string) ([]Decl, error) {
	if len(files) == 0 {
		return nil, nil
	}
	rows, err := tsv(exec.Command("node", append([]string{declsScript}, files...)...), "Vue/JS")
	if err != nil {
		return nil, err
	}
	out := make([]Decl, 0, len(rows))
	for _, r := range rows {
		line, _ := strconv.Atoi(r[1])
		out = append(out, Decl{Path: r[0], Line: line, Name: r[2], Kind: r[3]})
	}
	return out, nil
}

// pyDecls recorre el árbol con `ast.walk` —a lo ancho, como siempre lo hizo— e imprime cada nombre que
// el archivo CREA: funciones y clases, parámetros, asignaciones, atributos asignados, el `except … as` y
// los `import … as`.
const pyDecls = `
import ast, sys
for f in sys.argv[1:]:
    tree = ast.parse(open(f, encoding="utf-8").read(), filename=f)
    for n in ast.walk(tree):
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            print(f, n.lineno, n.name, "class" if isinstance(n, ast.ClassDef) else "func", sep="\t")
        elif isinstance(n, ast.arg):
            print(f, n.lineno, n.arg, "param", sep="\t")
        elif isinstance(n, ast.Name) and isinstance(n.ctx, ast.Store):
            print(f, n.lineno, n.id, "var", sep="\t")
        elif isinstance(n, ast.Attribute) and isinstance(n.ctx, ast.Store):
            print(f, n.lineno, n.attr, "attr", sep="\t")
        elif isinstance(n, ast.ExceptHandler) and n.name:
            print(f, n.lineno, n.name, "var", sep="\t")
        elif isinstance(n, (ast.Import, ast.ImportFrom)):
            for alias in n.names:
                if alias.asname:
                    print(f, n.lineno, alias.asname, "import", sep="\t")
`

// PyDecls: lo que declaran esos archivos de Python, según el `ast` de Python.
func PyDecls(files []string) ([]Decl, error) {
	if len(files) == 0 {
		return nil, nil
	}
	rows, err := tsv(exec.Command("python3", append([]string{"-c", pyDecls}, files...)...), "Python")
	if err != nil {
		return nil, err
	}
	out := make([]Decl, 0, len(rows))
	for _, r := range rows {
		line, _ := strconv.Atoi(r[1])
		out = append(out, Decl{Path: r[0], Line: line, Name: r[2], Kind: r[3]})
	}
	return out, nil
}

// Glob: los archivos que matchean esos patrones, relativos a `board`, sin repetir y en el orden de
// sus partes (así ordenaba `pathlib`: `rename/x` va antes que `rename-x/…`).
func Glob(board string, patterns []string) []string {
	seen := map[string]bool{}
	var out []string
	for _, pat := range patterns {
		matches, _ := filepath.Glob(filepath.Join(board, pat))
		for _, m := range matches {
			if !seen[m] {
				seen[m] = true
				out = append(out, m)
			}
		}
	}
	sort.Slice(out, func(i, j int) bool {
		a, b := strings.Split(out[i], "/"), strings.Split(out[j], "/")
		for k := 0; k < len(a) && k < len(b); k++ {
			if a[k] != b[k] {
				return a[k] < b[k]
			}
		}
		return len(a) < len(b)
	})
	return out
}

// TrackedPaths: los archivos del tablero que git sigue o seguiría si los agregás (los nuevos cuentan
// antes del commit), y que existen en disco.
func TrackedPaths(board string) ([]string, error) {
	out, err := exec.Command("git", "-C", board, "ls-files", "--cached", "--others", "--exclude-standard", "--", ".").Output()
	if err != nil {
		return nil, fmt.Errorf("git ls-files en %s: %w", board, err)
	}
	var paths []string
	for _, p := range strings.Split(string(out), "\n") {
		if p == "" {
			continue
		}
		if _, err := os.Stat(filepath.Join(board, p)); err == nil {
			paths = append(paths, p)
		}
	}
	return paths, nil
}

// PathName es una carpeta o archivo a revisar, con el nombre que se le mira.
type PathName struct{ Rel, Stem string }

/* PathNames: cada carpeta y archivo a revisar. Lo que es CONTENIDO no se revisa: dentro de `tasks/`, la
 * carpeta de cada tarea es su slug —su título, en español— y sus artifacts se llaman como los nombró
 * quien los hizo; dentro de `data/`, los archivos son datos. De `data/` sí se revisan las carpetas
 * (`traps`, `cache`), que son estructura. */
func PathNames(paths []string) []PathName {
	seen := map[string]bool{}
	var out []PathName
	for _, rel := range paths {
		parts := strings.Split(rel, "/")
		names := parts
		switch parts[0] {
		case "tasks":
			names = parts[:1]
		case "data":
			names = parts[:len(parts)-1]
		}
		for i, part := range names {
			key := strings.Join(parts[:i+1], "/")
			if seen[key] {
				continue
			}
			seen[key] = true
			// un archivo pierde sólo su última extensión: `task.v2.schema.json` → task, v2, schema
			stem := part
			if i == len(parts)-1 && len(part) > 1 && strings.Contains(part[1:], ".") {
				stem = part[:strings.LastIndex(part, ".")]
			}
			out = append(out, PathName{key, stem})
		}
	}
	return out
}
