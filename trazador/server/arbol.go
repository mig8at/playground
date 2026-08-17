// arbol.go — DÓNDE QUEDÓ, con el detalle fino: los 39 pasos del árbol de negocio.
//
// POR QUÉ SUMA, teniendo ya las etapas. Las 7 etapas de esta herramienta contestan «hasta dónde
// llegó» a grano grueso, y están ancladas en la BD —son hechos—. El árbol contesta lo mismo con 39
// puntos y anclado en los LOGS, así que dice cosas que la etapa no puede: no «falló la validación»
// sino «falló en la cascada de identidad de Registraduría, y la biometría facial ni se intentó».
//
// ⚠ EL ÁRBOL NO SE CONSTRUYE ACÁ. Vive en `workers/negocio.json` y este archivo sólo lo consume. La
// parte cara —proponerlo leyendo el corpus, verificar que las señales existan, medir cuáles ocurren
// de verdad en producción— se hizo una vez y con Python al lado de los otros mapas. Acá se lee.
//
// ⚠ Y SI EL ARCHIVO NO ESTÁ, la sección no aparece. Un árbol vacío se leería como «no hizo ninguno
// de los 39 pasos», que es la conclusión más equivocada posible sobre una solicitud que llegó a
// estado 11.
package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

type pasoArbol struct {
	Key         string   `json:"key"`
	N           string   `json:"n"`
	Senal       []string `json:"senal"`
	VistoEnProd bool     `json:"visto_en_prod"`
	Falla       string   `json:"falla,omitempty"`
}

type tramoArbol struct {
	Key    string      `json:"key"`
	N      string      `json:"n"`
	Cuando string      `json:"cuando"`
	Pasos  []pasoArbol `json:"pasos"`
}

// PasoAlcanzado es lo que se reporta: un paso del árbol y si esta traza lo tocó.
type PasoAlcanzado struct {
	Tramo  string `json:"tramo"`
	Paso   string `json:"paso"`
	N      string `json:"n"`
	Lineas int    `json:"lineas"`
	Falla  string `json:"falla,omitempty"`
}

func cargarArbol() []tramoArbol {
	for _, p := range []string{
		filepath.Join("..", "..", "workers", "negocio.json"),
		filepath.Join("workers", "negocio.json"),
	} {
		b, err := os.ReadFile(p)
		if err != nil {
			continue
		}
		// El JSON usa el ORDEN de las claves como el orden del flujo, y Go lo pierde al deserializar
		// en un map. Por eso se decodifica a RawMessage y se recorre el texto en orden de aparición:
		// un recorrido mostrado alfabéticamente no es un recorrido.
		var raiz struct {
			Arbol json.RawMessage `json:"arbol"`
		}
		if json.Unmarshal(b, &raiz) != nil || len(raiz.Arbol) == 0 {
			continue
		}
		var crudo map[string]json.RawMessage
		if json.Unmarshal(raiz.Arbol, &crudo) != nil {
			continue
		}
		var out []tramoArbol
		for _, k := range clavesEnOrden(raiz.Arbol) {
			var campos map[string]json.RawMessage
			if json.Unmarshal(crudo[k], &campos) != nil {
				continue
			}
			t := tramoArbol{Key: k}
			_ = json.Unmarshal(campos["_n"], &t.N)
			_ = json.Unmarshal(campos["_cuando"], &t.Cuando)
			for _, sk := range clavesEnOrden(crudo[k]) {
				if strings.HasPrefix(sk, "_") {
					continue
				}
				var p pasoArbol
				if json.Unmarshal(campos[sk], &p) == nil {
					p.Key = sk
					t.Pasos = append(t.Pasos, p)
				}
			}
			out = append(out, t)
		}
		return out
	}
	return nil
}

// clavesEnOrden devuelve las claves de un objeto JSON EN EL ORDEN DEL TEXTO, que es la información
// que `map[string]…` tira a la basura y que acá es justamente el dato: el orden es el flujo.
func clavesEnOrden(raw json.RawMessage) []string {
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
		var descarte json.RawMessage
		if dec.Decode(&descarte) != nil {
			break
		}
	}
	return ks
}

// pasosAlcanzados dice qué pasos del árbol tocó esta traza, en el orden del flujo.
//
// ⚠ Devuelve TAMBIÉN los no alcanzados (con Lineas=0) a propósito: el valor está en el contraste.
// «Llegó hasta acá y estos tres de abajo no se intentaron» es una respuesta; una lista de lo que sí
// pasó, no.
func pasosAlcanzados(mensajes []string) ([]PasoAlcanzado, int) {
	arb := cargarArbol()
	if len(arb) == 0 {
		return nil, -1
	}
	bajos := make([]string, len(mensajes))
	for i, m := range mensajes {
		bajos[i] = strings.ToLower(m)
	}
	var out []PasoAlcanzado
	ultimo := -1
	for _, t := range arb {
		for _, p := range t.Pasos {
			n := 0
			for _, m := range bajos {
				for _, s := range p.Senal {
					if s != "" && strings.Contains(m, strings.ToLower(s)) {
						n++
						break
					}
				}
			}
			if n > 0 {
				ultimo = len(out)
			}
			out = append(out, PasoAlcanzado{Tramo: t.Key, Paso: p.Key, N: p.N, Lineas: n, Falla: p.Falla})
		}
	}
	return out, ultimo
}
