// roots.go — DE DÓNDE SALEN LOS REPOS, y por qué no están escritos acá.
//
// La fuente única es `context/tools/roots.py`: la importan el indexador del árbol y el oráculo, y
// tenerla dos veces es una divergencia esperando a pasar (un repo agregado de un solo lado no falla:
// da un veredicto sobre un universo distinto). Este archivo NO declara rutas — lee `roots.json`, que
// se DERIVA de roots.py con `make demo-roots`.
//
// ⚠ Si falta el archivo, el programa corta con instrucciones en vez de asumir un default. Un mapa
// construido sobre la mitad de los repos se lee igual que uno completo.
package main

import (
	"encoding/json"
	"fmt"
	"os"
)

type raices map[string]string

func cargarRaices(ruta string) (raices, error) {
	b, err := os.ReadFile(ruta)
	if err != nil {
		return nil, fmt.Errorf("no encontré %s — generalo con:  make demo-roots", ruta)
	}
	var r raices
	if err := json.Unmarshal(b, &r); err != nil {
		return nil, fmt.Errorf("%s no es JSON válido: %w", ruta, err)
	}
	if len(r) == 0 {
		return nil, fmt.Errorf("%s está vacío", ruta)
	}
	return r, nil
}
