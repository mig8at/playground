package main

/* DOS ATAJOS PARA NO REPETIR TRABAJO, sin cambiar lo que se contesta:
 *
 *  1. LA PANTALLA YA LEÍDA Y TRADUCIDA. Abrir una pantalla en la interfaz son varios pedidos de la MISMA pantalla
 *     (el HTML, su reporte, las cajas de las capas, el detalle de una capa), y cada uno volvía a parsear el JSON del
 *     nodo —megas, en una pantalla grande— y a traducirlo entero. Se guarda por clave|versión|id el nodo leído y,
 *     aparte, el HTML con su reporte. El HTML depende además de las variantes de la casilla y de los tokens del
 *     archivo, que van llegando mientras corre el server: se guarda con QUÉ variantes y QUÉ tokens se tradujo, y si
 *     hoy son otros se traduce de nuevo. Con tope de entradas: se va la que hace más que no se usa.
 *
 *  2. UN SOLO PEDIDO A FIGMA POR MAPA. Dos pedidos simultáneos del mismo mapa (la interfaz al arrancar pide el de
 *     la ruta y el del bloque que quedó abierto) bajaban los dos el mismo archivo: el segundo espera al primero. */

import (
	"context"
	"reflect"
	"sync"

	"creditop/my-tools/connectors/figma"
	"creditop/my-tools/visor/render"
)

// screenMemoMax: cuántas pantallas se guardan leídas. Recorrer un flujo es ir y volver entre vecinas.
const screenMemoMax = 48

type screenEntry struct {
	raw  *byte // el JSON del que salió el nodo: si screenRaw entrega otro, se vuelve a leer
	size int
	node render.Node
	// La traducción, y con qué se hizo.
	hasDoc   bool
	doc      string
	rep      render.Report
	variants uintptr       // identidad del mapa de variantes (fileVariants entrega el mismo mientras no cambie)
	tokens   *figma.Tokens // los tokens del archivo de ese momento
	used     uint64
}

type screenMemo struct {
	mu      sync.Mutex
	tick    uint64
	entries map[string]*screenEntry
}

// touch devuelve la entrada de esa pantalla si salió de ESTE JSON, o una nueva (echando la más vieja si no hay
// lugar). Se llama con el candado tomado.
func (m *screenMemo) touch(k string, raw []byte) *screenEntry {
	if m.entries == nil {
		m.entries = map[string]*screenEntry{}
	}
	m.tick++
	var first *byte
	if len(raw) > 0 {
		first = &raw[0]
	}
	if e := m.entries[k]; e != nil && e.raw == first && e.size == len(raw) {
		e.used = m.tick
		return e
	}
	if _, replacing := m.entries[k]; !replacing && len(m.entries) >= screenMemoMax {
		oldest, at := "", m.tick
		for name, e := range m.entries {
			if e.used < at {
				oldest, at = name, e.used
			}
		}
		delete(m.entries, oldest)
	}
	e := &screenEntry{raw: first, size: len(raw), used: m.tick}
	m.entries[k] = e
	return e
}

// parsedNode: render.Parse, una vez por JSON. El nodo se comparte entre pedidos: nadie lo modifica (el traductor y
// las capas sólo lo leen).
func (s *server) parsedNode(k string, raw []byte) (render.Node, error) {
	s.screens.mu.Lock()
	e := s.screens.touch(k, raw)
	if e.node.Box != nil {
		n := e.node
		s.screens.mu.Unlock()
		return n, nil
	}
	s.screens.mu.Unlock()
	n, err := render.Parse(raw)
	if err != nil {
		return n, err
	}
	s.screens.mu.Lock()
	s.screens.touch(k, raw).node = n
	s.screens.mu.Unlock()
	return n, nil
}

// renderScreen traduce la pantalla a HTML, o devuelve la traducción guardada si el nodo, las variantes y los
// tokens son los mismos con que se hizo. El reporte guardado se comparte: quien lo recibe sólo lo lee.
func (s *server) renderScreen(key, version, id string, n render.Node) (string, render.Report) {
	variants := s.fileVariants(key, version)
	tokens := s.fileTokens(key)
	vid := reflect.ValueOf(variants).Pointer()
	k := key + "|" + version + "|" + id
	s.screens.mu.Lock()
	e := s.screens.entries[k]
	// Sólo vale si la entrada es la del nodo que se está traduciendo (misma lectura del mismo JSON).
	if e != nil && e.hasDoc && e.variants == vid && e.tokens == tokens && e.node.Box == n.Box {
		s.screens.tick++
		e.used = s.screens.tick
		doc, rep := e.doc, e.rep
		s.screens.mu.Unlock()
		return doc, rep
	}
	s.screens.mu.Unlock()
	doc, rep := render.HTML(n, assets(key, variants, styleTokensOf(tokens)))
	s.screens.mu.Lock()
	if e := s.screens.entries[k]; e != nil && e.node.Box == n.Box {
		e.hasDoc, e.doc, e.rep, e.variants, e.tokens = true, doc, rep, vid, tokens
	}
	s.screens.mu.Unlock()
	return doc, rep
}

// ─── un solo pedido por mapa ─────────────────────────────────────────────────────────────────────────

type mapFlight struct {
	done chan struct{}
	st   figma.Structure
	err  error
}

type mapFlights struct {
	mu sync.Mutex
	m  map[string]*mapFlight
}

// do corre `read` una sola vez por clave a la vez: quien llega con uno en curso espera su resultado (o a que se
// venza su propio pedido). `read` no recibe el contexto de quien lo lanzó: si ese cliente se va, los que esperan no
// se quedan sin respuesta.
func (f *mapFlights) do(ctx context.Context, k string, read func() (figma.Structure, error)) (figma.Structure, error) {
	f.mu.Lock()
	if f.m == nil {
		f.m = map[string]*mapFlight{}
	}
	fl, running := f.m[k]
	if !running {
		fl = &mapFlight{done: make(chan struct{})}
		f.m[k] = fl
		go func() {
			fl.st, fl.err = read()
			f.mu.Lock()
			delete(f.m, k)
			f.mu.Unlock()
			close(fl.done)
		}()
	}
	f.mu.Unlock()
	select {
	case <-fl.done:
		return fl.st, fl.err
	case <-ctx.Done():
		return figma.Structure{}, ctx.Err()
	}
}
