// ren: renombra identificadores de un módulo Go según un mapa viejo→nuevo, con el type checker.
//
// Cada objeto declarado cuyo nombre está en el mapa se renombra en su declaración y en todos sus
// usos (Defs + Uses de go/types). Antes de escribir, rechaza el rename si el nombre newIdent ya existe
// donde chocaría: en el mismo scope o uno anidado/ancestro para locales, en el paquete para los de
// nivel paquete, y en el conjunto de campos/métodos del tipo para campos y métodos.
//
// Uso: ren -map <mapa.tsv> [-w] ./...   desde la raíz del módulo que se renombra. Compilalo con
// `go build -o <bin> ./cmd/ren` acá y corré el binario allá: `go run` lo resolvería contra este módulo.
package main

import (
	"bufio"
	"flag"
	"fmt"
	"go/ast"
	"go/token"
	"go/types"
	"os"
	"sort"
	"strings"

	"golang.org/x/tools/go/packages"
)

type edit struct {
	off int
	old string
	new string
}

func main() {
	mapPath := flag.String("map", "", "tsv viejo<TAB>nuevo")
	write := flag.Bool("w", false, "escribir los archivos")
	flag.Parse()

	renames := map[string]string{}
	overrides := map[string]string{} // "cmd/x/main.go:12:3" → newIdent
	f, err := os.Open(*mapPath)
	if err != nil {
		panic(err)
	}
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		parts := strings.Fields(line)
		if len(parts) != 2 {
			fmt.Fprintln(os.Stderr, "línea inválida:", line)
			os.Exit(2)
		}
		if strings.Contains(parts[0], ".go:") {
			overrides[parts[0]] = parts[1]
			continue
		}
		renames[parts[0]] = parts[1]
	}

	cwd, _ := os.Getwd()
	cfg := &packages.Config{Mode: packages.NeedName | packages.NeedFiles | packages.NeedSyntax |
		packages.NeedTypes | packages.NeedTypesInfo | packages.NeedDeps | packages.NeedImports, Tests: true}
	pkgs, err := packages.Load(cfg, flag.Args()...)
	if err != nil {
		panic(err)
	}
	if packages.PrintErrors(pkgs) > 0 {
		os.Exit(1)
	}
	fset := pkgs[0].Fset

	// Con Tests:true un paquete aparece dos veces (normal y con sus _test); los objetos son
	// distintos en cada carga, así que se identifica un objeto por la POSICIÓN de su declaración.
	key := func(o types.Object) string { return fset.Position(o.Pos()).String() }
	newName := func(o types.Object) string {
		rel := strings.TrimPrefix(key(o), cwd+"/")
		if n, ok := overrides[rel]; ok {
			return n
		}
		return renames[o.Name()]
	}

	chosen := map[string]types.Object{}   // decl pos → objeto (uno representativo)
	uses := map[string]map[string]bool{}   // decl pos → posiciones de identificadores
	conflicts := map[string]string{}
	var fileOf = map[string]bool{}

	for _, p := range pkgs {
		for _, file := range p.Syntax {
			fileOf[fset.Position(file.Pos()).Filename] = true
		}
		visit := func(id *ast.Ident, o types.Object) {
			if o == nil || o.Pkg() == nil || !o.Pos().IsValid() {
				return
			}
			if _, ok := renames[o.Name()]; !ok {
				return
			}
			if _, isPkg := o.(*types.PkgName); isPkg {
				return
			}
			dp := fset.Position(o.Pos())
			if !strings.HasPrefix(dp.Filename, cwd+"/") {
				return
			}
			k := key(o)
			if _, ok := chosen[k]; !ok {
				chosen[k] = o
				uses[k] = map[string]bool{}
				if c := conflict(p, o, newName(o)); c != "" {
					conflicts[k] = c
				}
			}
			uses[k][fset.Position(id.Pos()).String()] = true
		}
		for id, o := range p.TypesInfo.Defs {
			visit(id, o)
		}
		for id, o := range p.TypesInfo.Uses {
			visit(id, o)
		}
		// campo embebido implícito: el identificador del tipo también nombra el campo
		for id, o := range p.TypesInfo.Implicits {
			_ = id
			_ = o
		}
	}

	// Dos objetos que van al MISMO nombre newIdent: si sus scopes se anidan (o uno es de paquete y el
	// otro local del mismo paquete), el de adentro sombrearía al de afuera sin error de compilación.
	byNew := map[string][]string{}
	for k, o := range chosen {
		byNew[newName(o)] = append(byNew[newName(o)], k)
	}
	for newIdent, group := range byNew {
		for i := 0; i < len(group); i++ {
			for j := 0; j < len(group); j++ {
				if i == j {
					continue
				}
				a, b := chosen[group[i]], chosen[group[j]]
				if a.Pkg() == nil || b.Pkg() == nil || a.Pkg().Path() != b.Pkg().Path() {
					continue
				}
				if a.Name() == b.Name() && newName(a) == renames[a.Name()] && newName(b) == renames[b.Name()] {
					continue // el sombreado ya existía con el nombre viejo: el rename lo conserva igual
				}
				pa, pb := a.Parent(), b.Parent()
				if pa == nil || pb == nil {
					continue
				}
				if encloses(pa, pb) && conflicts[group[j]] == "" {
					conflicts[group[j]] = "sombrearía a " + group[i] + " (los dos van a " + newIdent + ")"
				}
			}
		}
	}

	bad := 0
	var ks []string
	for k := range conflicts {
		ks = append(ks, k)
	}
	sort.Strings(ks)
	for _, k := range ks {
		o := chosen[k]
		fmt.Printf("CONFLICTO %s %s→%s: %s\n", k, o.Name(), newName(o), conflicts[k])
		bad++
	}

	edits := map[string][]edit{}
	n := 0
	for k, set := range uses {
		if conflicts[k] != "" {
			continue
		}
		o := chosen[k]
		for posStr := range set {
			// posStr = archivo:línea:col; recalculamos offset con el fset
			_ = posStr
		}
		n++
		_ = o
	}
	// offsets: segunda pasada por los identificadores con Defs/Uses
	seen := map[string]bool{}
	for _, p := range pkgs {
		add := func(id *ast.Ident, o types.Object) {
			if o == nil || !o.Pos().IsValid() {
				return
			}
			k := key(o)
			if _, ok := uses[k]; !ok || conflicts[k] != "" {
				return
			}
			pos := fset.Position(id.Pos())
			s := pos.String()
			if seen[s] {
				return
			}
			seen[s] = true
			edits[pos.Filename] = append(edits[pos.Filename], edit{pos.Offset, id.Name, newName(o)})
		}
		for id, o := range p.TypesInfo.Defs {
			add(id, o)
		}
		for id, o := range p.TypesInfo.Uses {
			add(id, o)
		}
	}
	total := 0
	for file, es := range edits {
		sort.Slice(es, func(i, j int) bool { return es[i].off > es[j].off })
		src, err := os.ReadFile(file)
		if err != nil {
			panic(err)
		}
		for _, e := range es {
			if string(src[e.off:e.off+len(e.old)]) != e.old {
				panic(fmt.Sprintf("desfase en %s@%d: esperaba %q", file, e.off, e.old))
			}
			src = append(src[:e.off], append([]byte(e.new), src[e.off+len(e.old):]...)...)
			total++
		}
		if *write {
			if err := os.WriteFile(file, src, 0o644); err != nil {
				panic(err)
			}
		}
	}
	fmt.Printf("objetos %d · conflictos %d · ediciones %d en %d archivos · escrito=%v\n", n, bad, total, len(edits), *write)
	if bad > 0 {
		os.Exit(3)
	}
}

// conflict dice por qué renombrar o a newIdent chocaría, o "" si no choca.
func conflict(p *packages.Package, o types.Object, newIdent string) string {
	switch x := o.(type) {
	case *types.Var:
		if x.IsField() {
			return fieldConflict(p, x, newIdent)
		}
	case *types.Func:
		if sig, ok := x.Type().(*types.Signature); ok && sig.Recv() != nil {
			recv := sig.Recv().Type()
			if ms, _, _ := types.LookupFieldOrMethod(recv, true, x.Pkg(), newIdent); ms != nil {
				return "el receptor ya tiene " + newIdent
			}
			return ""
		}
	}
	scope := o.Parent()
	if scope == nil {
		return ""
	}
	if scope == o.Pkg().Scope() {
		if scope.Lookup(newIdent) != nil {
			return "el paquete ya declara " + newIdent
		}
		// ¿algún archivo lo usa como nombre de import o local que quedaría sombreado?
		for _, inner := range walkScopes(scope) {
			if inner.Lookup(newIdent) != nil {
				return "un scope interno ya declara " + newIdent + " (sombreado)"
			}
		}
		if types.Universe.Lookup(newIdent) != nil {
			return newIdent + " es un predeclarado"
		}
		return ""
	}
	// local: el nombre newIdent no puede estar visible en el scope de o, ni declarado en uno interno
	if _, obj := scope.LookupParent(newIdent, token.NoPos); obj != nil {
		return "ya visible desde el scope: " + obj.String()
	}
	for _, inner := range walkScopes(scope) {
		if inner.Lookup(newIdent) != nil {
			return "un scope interno ya declara " + newIdent
		}
	}
	return ""
}

func fieldConflict(p *packages.Package, v *types.Var, newIdent string) string {
	// buscar el struct dueño del campo entre los tipos con nombre del paquete
	for _, name := range v.Pkg().Scope().Names() {
		tn, ok := v.Pkg().Scope().Lookup(name).(*types.TypeName)
		if !ok {
			continue
		}
		if c := structConflict(tn.Type(), v, newIdent); c != "" {
			return c
		}
	}
	// structs anónimos o de tipos locales: revisar todos los tipos del TypesInfo
	for _, tv := range p.TypesInfo.Types {
		if c := structConflict(tv.Type, v, newIdent); c != "" {
			return c
		}
	}
	for _, o := range p.TypesInfo.Defs {
		if tn, ok := o.(*types.TypeName); ok {
			if c := structConflict(tn.Type(), v, newIdent); c != "" {
				return c
			}
		}
	}
	return ""
}

func structConflict(t types.Type, v *types.Var, newIdent string) string {
	st, ok := t.Underlying().(*types.Struct)
	if !ok {
		return ""
	}
	owns := false
	for i := 0; i < st.NumFields(); i++ {
		if st.Field(i) == v {
			owns = true
		}
	}
	if !owns {
		return ""
	}
	for i := 0; i < st.NumFields(); i++ {
		if st.Field(i).Name() == newIdent {
			return "el struct ya tiene el campo " + newIdent
		}
	}
	if named, ok := t.(*types.Named); ok {
		for i := 0; i < named.NumMethods(); i++ {
			if named.Method(i).Name() == newIdent {
				return "el tipo ya tiene el método " + newIdent
			}
		}
	}
	return ""
}

func walkScopes(s *types.Scope) []*types.Scope {
	var out []*types.Scope
	for i := 0; i < s.NumChildren(); i++ {
		c := s.Child(i)
		out = append(out, c)
		out = append(out, walkScopes(c)...)
	}
	return out
}

// encloses: outer es outer o un ancestro de inner (comparando por posición, porque con Tests:true
// el mismo scope existe en dos cargas del paquete).
func encloses(outer, inner *types.Scope) bool {
	for s := inner; s != nil; s = s.Parent() {
		if s == outer {
			return true
		}
		if s.Pos().IsValid() && s.Pos() == outer.Pos() && s.End() == outer.End() {
			return true
		}
		if s.Parent() == types.Universe {
			// scope de archivo → paquete: el scope de paquete no tiene posición; comparar por paquete
			if outer.Parent() == types.Universe {
				return true
			}
		}
	}
	return false
}
