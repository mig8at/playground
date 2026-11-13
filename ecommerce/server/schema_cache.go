package main

/* EL ESQUEMA, EN CACHÉ PARA LAS LECTURAS. Qué tablas cuelgan de una solicitud y qué columnas tiene cada una se
 * preguntaba a `information_schema` en CADA pedido: abrir una solicitud son 1 + N pedidos (contar + las filas de
 * cada tabla), o sea N+1 veces la misma consulta de esquema, y por Redash (prod) cada una son segundos.
 *
 * El esquema de una base no cambia de un clic al otro: se guarda por ambiente unos minutos.
 *
 * ⚠ SÓLO para lo que LEE (contar y mostrar las tablas del editor). El plan de borrado y el borrado mismo siguen
 * preguntándole a la base cada vez (childTables, sin caché): ahí una tabla nueva que no se vea es una fila huérfana. */

import (
	"sync"
	"time"
)

// schemaTTL: cuánto vale lo leído. Una migración que agrega una tabla se ve, a lo sumo, este rato después.
const schemaTTL = 5 * time.Minute

type schemaEntry struct {
	at       time.Time
	children []childTable
	columns  map[string][]string // tabla → columnas en el orden de la base (ya sin las secretas)
}

var (
	schemaMu    sync.Mutex
	schemaByEnv = map[string]*schemaEntry{}
)

// schemaFor devuelve la entrada vigente del ambiente (o una nueva, vacía). Se llama con schemaMu tomado.
func schemaFor(target string) *schemaEntry {
	e := schemaByEnv[target]
	if e == nil || time.Since(e.at) > schemaTTL {
		e = &schemaEntry{at: time.Now(), columns: map[string][]string{}}
		schemaByEnv[target] = e
	}
	return e
}

// cachedChildTables: childTables, pero de la caché del ambiente. La consulta corre fuera del candado: dos pedidos
// simultáneos en frío la hacen dos veces (es de lectura y da lo mismo), y ninguno espera al otro.
func cachedChildTables(target string, src Source) ([]childTable, error) {
	schemaMu.Lock()
	got := schemaFor(target).children
	schemaMu.Unlock()
	if got != nil {
		return got, nil
	}
	list, err := childTables(src)
	if err != nil {
		return nil, err
	}
	if list == nil {
		list = []childTable{} // «ninguna» también se recuerda
	}
	schemaMu.Lock()
	schemaFor(target).children = list
	schemaMu.Unlock()
	return list, nil
}

// cachedColumns: las columnas de una tabla, leídas con `read` sólo si no están en la caché del ambiente.
func cachedColumns(target, table string, read func() ([]string, error)) ([]string, error) {
	schemaMu.Lock()
	got, ok := schemaFor(target).columns[table]
	schemaMu.Unlock()
	if ok {
		return got, nil
	}
	cols, err := read()
	if err != nil {
		return nil, err
	}
	schemaMu.Lock()
	schemaFor(target).columns[table] = cols
	schemaMu.Unlock()
	return cols, nil
}

// forgetSchema olvida lo guardado de un ambiente (lo usan las pruebas).
func forgetSchema(target string) {
	schemaMu.Lock()
	delete(schemaByEnv, target)
	schemaMu.Unlock()
}
