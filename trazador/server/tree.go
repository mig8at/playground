// tree.go — DÓNDE QUEDÓ, con el detalle fino: los 39 pasos del árbol de negocio.
//
// POR QUÉ SUMA, teniendo ya las etapas. Las 7 etapas de esta herramienta contestan «hasta dónde
// llegó» a grano grueso, y están ancladas en la BD —son hechos—. El árbol contesta lo mismo con 39
// puntos y anclado en los LOGS, así que dice cosas que la etapa no puede: no «falló la validación»
// sino «falló en la cascada de identidad de Registraduría, y la biometría facial ni se intentó».
//
// ⚠ EL ÁRBOL NO SE CONSTRUYE ACÁ: se escribió a mano, y vive en `mapa/negocio.json`, embebido con los
// otros mapas. La parte cara —proponerlo leyendo el corpus, verificar que las señales existan, medir
// cuáles ocurren de verdad en producción— se hizo una vez. Hasta el 2026-09-24 el archivo vivía en
// `workers/`, que lo había armado; al retirarse workers se mudó acá, que es su único lector.
//
// ⚠ Y SI EL ARCHIVO NO ESTÁ, la sección no aparece. Un árbol vacío se leería como «no hizo ninguno
// de los 39 pasos», que es la conclusión más equivocada posible sobre una solicitud que llegó a
// estado 11.
package main

import (
	"encoding/json"
	"strings"
)

type treeStep struct {
	Key        string   `json:"key"`
	N          string   `json:"n"`
	Signal     []string `json:"signal"`
	SeenInProd bool     `json:"seen_in_prod"`
	Failure    string   `json:"failure,omitempty"`
}

type treeSegment struct {
	Key   string     `json:"key"`
	N     string     `json:"n"`
	When  string     `json:"when"`
	Steps []treeStep `json:"steps"`
}

// ReachedStep es lo que se reporta: un paso del árbol y si esta traza lo tocó.
type ReachedStep struct {
	Segment string `json:"segment"`
	Step    string `json:"step"`
	N       string `json:"n"`
	Lines   int    `json:"lines"`
	Failure string `json:"failure,omitempty"`
}

func loadTree() []treeSegment {
	for _, p := range []string{"mapa/negocio.json"} {
		b, err := mapFS.ReadFile(p)
		if err != nil {
			continue
		}
		// El JSON usa el ORDEN de las claves como el orden del flujo, y Go lo pierde al deserializar
		// en un map. Por eso se decodifica a RawMessage y se recorre el texto en orden de aparición:
		// un recorrido mostrado alfabéticamente no es un recorrido.
		var root struct {
			Tree json.RawMessage `json:"tree"`
		}
		if json.Unmarshal(b, &root) != nil || len(root.Tree) == 0 {
			continue
		}
		var raw map[string]json.RawMessage
		if json.Unmarshal(root.Tree, &raw) != nil {
			continue
		}
		var out []treeSegment
		for _, k := range keysInOrder(root.Tree) {
			var fields map[string]json.RawMessage
			if json.Unmarshal(raw[k], &fields) != nil {
				continue
			}
			t := treeSegment{Key: k}
			_ = json.Unmarshal(fields["_n"], &t.N)
			_ = json.Unmarshal(fields["_when"], &t.When)
			for _, sk := range keysInOrder(raw[k]) {
				if strings.HasPrefix(sk, "_") {
					continue
				}
				var p treeStep
				if json.Unmarshal(fields[sk], &p) == nil {
					p.Key = sk
					t.Steps = append(t.Steps, p)
				}
			}
			out = append(out, t)
		}
		return out
	}
	return nil
}

// keysInOrder devuelve las claves de un objeto JSON EN EL ORDEN DEL TEXTO, que es la información
// que `map[string]…` tira a la basura y que acá es justamente el dato: el orden es el flujo.
func keysInOrder(raw json.RawMessage) []string {
	dec := json.NewDecoder(strings.NewReader(string(raw)))
	if _, err := dec.Token(); err != nil { // abre '{'
		return nil
	}
	var ks []string
	for dec.More() {
		t, err := dec.Token()
		if err != nil {
			break
		}
		k, ok := t.(string)
		if !ok {
			break
		}
		ks = append(ks, k)
		var discard json.RawMessage
		if dec.Decode(&discard) != nil {
			break
		}
	}
	return ks
}

// reachedSteps dice qué pasos del árbol tocó esta traza, en el orden del flujo.
//
// ⚠ Devuelve TAMBIÉN los no alcanzados (con Lineas=0) a propósito: el valor está en el contraste.
// «Llegó hasta acá y estos tres de abajo no se intentaron» es una respuesta; una lista de lo que sí
// pasó, no.
func reachedSteps(messages []string) ([]ReachedStep, int) {
	tree := loadTree()
	if len(tree) == 0 {
		return nil, -1
	}
	lowered := make([]string, len(messages))
	for i, m := range messages {
		lowered[i] = strings.ToLower(m)
	}
	var out []ReachedStep
	last := -1
	for _, t := range tree {
		for _, p := range t.Steps {
			n := 0
			for _, m := range lowered {
				for _, s := range p.Signal {
					if s != "" && strings.Contains(m, strings.ToLower(s)) {
						n++
						break
					}
				}
			}
			if n > 0 {
				last = len(out)
			}
			out = append(out, ReachedStep{Segment: t.Key, Step: p.Key, N: p.N, Lines: n, Failure: p.Failure})
		}
	}
	return out, last
}
