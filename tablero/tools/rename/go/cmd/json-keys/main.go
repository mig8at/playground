// json-keys: etiquetas json de structs y claves string de mapas literales, con archivo:línea y contexto.
package main

import (
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
)

func main() {
	root := os.Args[1]
	fset := token.NewFileSet()
	filepath.Walk(root, func(p string, info os.FileInfo, err error) error {
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
					fmt.Printf("%s:%d\ttag\t%s.%s\t%s\n", rel, fset.Position(fl.Tag.Pos()).Line, ctx, name, j) // la línea de la ETIQUETA: en un campo de varias líneas va al final
				}
			case *ast.CompositeLit:
				if mt, ok := x.Type.(*ast.MapType); ok {
					if k, ok := mt.Key.(*ast.Ident); ok && k.Name == "string" {
						for _, el := range x.Elts {
							if kv, ok := el.(*ast.KeyValueExpr); ok {
								if bl, ok := kv.Key.(*ast.BasicLit); ok && bl.Kind == token.STRING {
									s, _ := strconv.Unquote(bl.Value)
									fmt.Printf("%s:%d\tmap\t-\t%s\n", rel, fset.Position(bl.Pos()).Line, s)
								}
							}
						}
					}
				}
			case *ast.IndexExpr: // output["canon"] = …
				if bl, ok := x.Index.(*ast.BasicLit); ok && bl.Kind == token.STRING {
					s, _ := strconv.Unquote(bl.Value)
					fmt.Printf("%s:%d\tindex\t-\t%s\n", rel, fset.Position(bl.Pos()).Line, s)
				}
			}
			return true
		})
		return nil
	})
}
