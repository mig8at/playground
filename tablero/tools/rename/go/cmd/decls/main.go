// decls: lista cada identificador DECLARADO en los .go de un árbol, con su posición.
// Formato: archivo:línea:col<TAB>nombre<TAB>clase
package main

import (
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strings"
)

func main() {
	root := os.Args[1]
	fset := token.NewFileSet()
	filepath.Walk(root, func(p string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() || !strings.HasSuffix(p, ".go") {
			return nil
		}
		f, err := parser.ParseFile(fset, p, nil, 0)
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			return nil
		}
		emit := func(id *ast.Ident, kind string) {
			if id == nil || id.Name == "_" {
				return
			}
			pos := fset.Position(id.Pos())
			fmt.Printf("%s:%d:%d\t%s\t%s\n", pos.Filename, pos.Line, pos.Column, id.Name, kind)
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
}
