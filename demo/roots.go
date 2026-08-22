// roots.go — DE DÓNDE SALEN LOS REPOS, y por qué no están escritos acá.
//
// La fuente única es `context/tools/roots.py`: la importan el indexador del árbol y el oráculo, y
// tenerla dos veces es una divergencia esperando a pasar (un repo agregado de un solo lado no falla:
// da un veredicto sobre un universo distinto). Este archivo NO declara rutas — lee `roots.json`, que
// se DERIVA de roots.py con el one-liner del README.
//
// ⚠ Si falta el archivo, el programa corta con instrucciones en vez de asumir un default. Un mapa
// construido sobre la mitad de los repos se lee igual que uno completo.
package main

import (
	"encoding/json"
	"fmt"
	"os"
)

type roots map[string]string

func loadRoots(path string) (roots, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("no encontré %s — generalo con:\n"+
			`  python3 -c "import sys,json; sys.path.insert(0,'../context/tools'); `+
			`from roots import ROOTS; print(json.dumps(ROOTS,indent=2,sort_keys=True))" > roots.json`, path)
	}
	var r roots
	if err := json.Unmarshal(b, &r); err != nil {
		return nil, fmt.Errorf("%s no es JSON válido: %w", path, err)
	}
	if len(r) == 0 {
		return nil, fmt.Errorf("%s está vacío", path)
	}
	return r, nil
}
