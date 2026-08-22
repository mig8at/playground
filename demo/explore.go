// explore.go — PARSEAR SÓLO LO QUE HACE FALTA. El grep no es sólo la semilla: es el resolvedor.
//
// LA IDEA. Para contestar «¿qué archivos tocan esto?» no hace falta un índice del repo entero. Hace
// falta: los archivos que matchean el término, aquellos de los que dependen, y los que los llaman. Eso
// se descubre con dos o tres `git grep` y se parsea en el orden de las decenas de archivos, no de los
// miles. No hay paso de construcción, no hay archivo de índice que envejezca, y un modelo parado en
// cualquier repo tira UN comando.
//
// CÓMO SE RESUELVE UNA DEPENDENCIA SIN ÍNDICE. Una semilla dice `private LenderRepo $repo`. Para saber
// qué archivo es `LenderRepo` no hace falta composer ni PSR-4: se le pregunta al repo con
// `git grep -n "class LenderRepo"`. Y todos los nombres que hagan falta van en UN grep con varios
// `-e`, porque de a uno costaba ~80 ms cada uno.
//
// ⚠ EL GRAFO QUE SALE ES PARCIAL A PROPÓSITO. `resolve()` sólo ve los archivos cargados, así que una
// arista hacia algo que no se cargó simplemente no aparece. Eso es correcto para un vecindario —el
// alcance es lo pedido— pero NO sirve para afirmar «nadie llama a esto». Los comandos que necesitan esa
// afirmación cargan el repo entero, y lo dicen.
package main

import (
	"fmt"
	"regexp"
	"runtime"
	"sync"
)

type explorer struct {
	r       *repo
	ex      *extractor
	files   map[string]*sourceFile // ruta -> parseado (caché de la corrida)
	classAt map[string]string      // nombre corto de clase -> ruta
	looked  map[string]bool        // nombres que ya se buscaron (aunque no se hayan encontrado)
	parsed  int
}

func newExplorer(r *repo) *explorer {
	return &explorer{r: r, ex: newExtractor(), files: map[string]*sourceFile{},
		classAt: map[string]string{}, looked: map[string]bool{}}
}

func (x *explorer) close() { x.ex.close() }

// parse — un archivo, cacheado. Devuelve nil si no se puede leer (borrado, binario, fuera del ref).
func (x *explorer) parse(path string) *sourceFile {
	if s, ok := x.files[path]; ok {
		return s
	}
	src, err := x.r.read(path)
	if err != nil {
		x.files[path] = nil
		return nil
	}
	s := x.ex.extract(path, src)
	x.files[path] = s
	x.parsed++
	if s.Class != "" {
		x.classAt[shortName(s.Class)] = path
	}
	return s
}

// parseMany — muchos archivos: se leen en UN lote y se parsean en paralelo, un parser de tree-sitter
// por goroutine (el parser no es seguro para compartir). Sobre 2.529 archivos la diferencia contra
// hacerlo de a uno es de 30 s a segundos.
func (x *explorer) parseMany(paths []string) {
	var pending []string
	for _, p := range paths {
		if _, ok := x.files[p]; !ok {
			pending = append(pending, p)
		}
	}
	if len(pending) == 0 {
		return
	}
	blobs := x.r.readMany(pending)

	type result struct {
		path string
		file *sourceFile
	}
	jobs := make(chan string, len(pending))
	for _, p := range pending {
		jobs <- p
	}
	close(jobs)
	results := make(chan result, len(pending))
	var wg sync.WaitGroup
	for i := 0; i < runtime.NumCPU(); i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			ex := newExtractor()
			defer ex.close()
			for p := range jobs {
				src, ok := blobs[p]
				if !ok {
					results <- result{p, nil}
					continue
				}
				results <- result{p, ex.extract(p, src)}
			}
		}()
	}
	wg.Wait()
	close(results)
	for r := range results {
		x.files[r.path] = r.file
		if r.file != nil {
			x.parsed++
			if r.file.Class != "" {
				x.classAt[shortName(r.file.Class)] = r.path
			}
		}
	}
}

var reDecl = regexp.MustCompile(`(?:class|interface|trait)\s+([A-Za-z_][A-Za-z0-9_]*)`)

// locate — encuentra en qué archivo se DECLARA cada nombre de clase, con un solo grep para todos.
// Los que ya se buscaron antes no se vuelven a pedir, encontrados o no: un nombre que vive en vendor
// no aparece nunca y no tiene sentido pagarlo dos veces.
func (x *explorer) locate(names []string) {
	var want []string
	for _, n := range names {
		if n == "" || x.looked[n] {
			continue
		}
		x.looked[n] = true
		if _, ya := x.classAt[n]; !ya {
			want = append(want, n)
		}
	}
	if len(want) == 0 {
		return
	}
	var pats []string
	for _, n := range want {
		pats = append(pats, fmt.Sprintf(`(class|interface|trait)[[:space:]]+%s([[:space:]]|$|\{)`,
			regexp.QuoteMeta(n)))
	}
	// -n para saber QUÉ nombre matcheó en qué archivo: con `-l` volvería la unión sin poder atribuirla.
	out, _ := x.r.grepLines(pats)
	for _, hit := range out {
		if m := reDecl.FindStringSubmatch(hit.line); m != nil {
			if _, ya := x.classAt[m[1]]; !ya {
				x.classAt[m[1]] = hit.path
			}
		}
	}
}

// refs — los nombres de clase que un archivo NOMBRA: lo que inyecta, de quién hereda, sus traits y sus
// interfaces. Es la lista de sus vecinos salientes candidatos.
//
// ⚠ CADA NOMBRE PASA POR EL MAPA DE IMPORTS ANTES DE SALIR, y no es un detalle: PHP permite
// `use A\B\LenderUserCategoryService as LenderUserCategoryServiceCtopX`, y en este repo se usa. Sin
// traducir el alias, el resolvedor grepea `class LenderUserCategoryServiceCtopX` —que no existe en
// ningún archivo— y el vecino se pierde EN SILENCIO. Se detectó comparando el vecindario a demanda
// contra el que daba la versión con índice: 6 vecinos contra 7.
func refs(s *sourceFile) []string {
	seen := map[string]bool{}
	var out []string
	add := func(n string) {
		if n == "" {
			return
		}
		if fqcn, ok := s.Imports[n]; ok {
			n = shortName(fqcn) // el alias se traduce al nombre real de la clase
		}
		if !seen[n] {
			seen[n] = true
			out = append(out, n)
		}
	}
	for _, t := range s.Props {
		add(t)
	}
	for _, t := range s.CtorProps {
		add(t)
	}
	add(s.Extends)
	for _, t := range s.Traits {
		add(t)
	}
	for _, t := range s.Implements {
		add(t)
	}
	// Las llamadas estáticas también nombran una clase: Foo::bar().
	for _, c := range s.Calls {
		if c.Form == "static" {
			add(c.Object)
		}
	}
	return out
}

// ⚠ ACÁ VIVÍA `expand`, Y SE FUE POR MEDICIÓN. Cargaba sólo las semillas, sus dependencias y sus
// llamadores: la idea era no parsear el repo entero. Medido en legacy-backend (2.529 archivos):
//
//	find <término>       con expand 2,01 s  →  con fullGraph 1,13 s
//	neighbors <hub>      con expand 1,23 s  →  con fullGraph 0,56 s
//
// Y no sólo más rápido: COMPLETO. `neighbors app/Otel/TracerService.php` devuelve 1.675 llamadores;
// con `--max-callers 300` la respuesta venía topeada al 18% y con una nota al pie.
//
// El cuello nunca fue el parseo —2.529 archivos son 0,55 s con un parser por goroutine— sino el
// `git grep` que busca quién nombra a cada semilla. La maquinaria a demanda pagaba ese grep para
// ahorrar un parseo que resultaba más barato que el grep.
//
// Lo que SÍ quedó a demanda es lo que de verdad rinde: `show <archivo>` (0,05 s, un archivo) y
// `hierarchy` (0,15 s, la cadena resuelta con greps puntuales). Si algún día aparece un repo donde
// 0,55 s se vuelvan 30 s, esto se reconstruye — con la medición que lo justifique, no antes.

// fullGraph — el repo entero. Sin archivo de índice: parsear 2.529 archivos son ~0,5 s con un parser
// por goroutine, así que cachearlo en disco era resolver un problema que no existe — y traía el que sí
// existe, un índice que envejece sin avisar.
func (x *explorer) fullGraph(ext string) *graph {
	paths, err := x.r.paths(ext)
	if err != nil {
		die(err)
	}
	x.parseMany(paths)
	g := &graph{Repo: x.r.name(), Branch: x.r.fuente(), Files: map[string]*sourceFile{},
		Stats: map[string]int{}}
	for p, s := range x.files {
		if s != nil {
			g.Files[p] = s
		}
	}
	g.resolve()
	g.Stats["files"] = len(g.Files)
	g.Stats["edges"] = len(g.Edges)
	return g
}

func plural(n int, sing, plu string) string {
	if n == 1 {
		return sing
	}
	return plu
}
