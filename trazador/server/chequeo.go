package main

// CHEQUEO — lo que se puede validar del mapa SIN correr nada y SIN insumos.
//
// POR QUÉ EXISTE, y de dónde viene la idea. `-validar` audita el mapa contra un CORPUS de líneas reales
// (solapes, patrones mudos, cobertura) y es lo que hay que correr cuando se tocan los matchers. Pero
// exige tener un corpus a mano, así que en la práctica **no se corre casi nunca** — y hay una clase
// entera de mentiras del mapa que no necesita corpus para detectarse.
//
// El harness ya resolvió exactamente esto con `bin/steps-check.ts`, y su nota lo dice mejor que
// cualquier resumen: *«el mapa dice "este paso toca N archivos"; ese número sólo vale si los archivos
// existen de verdad. Si alguien mueve o renombra uno, el panel seguiría mostrando el conteo viejo —dato
// con cara de verdad— y nadie se enteraría.»* Acá el equivalente son las TABLAS que cada etapa declara
// como su evidencia, y los IDS DE RAMAL que este mapa afirma compartir con el del harness.
//
// La regla que se hereda: **lo no verificado se cae, y se cae RUIDOSAMENTE.** Sale 1 si algo no resuelve,
// así se puede encadenar.
//
//	go run . -chequeo                 → valida y sale 0/1
//	go run . -chequeo -target local   → además comprueba las tablas contra el esquema de ese ambiente

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// dondeVivenLosSteps: el mapa del harness, relativo a `trazador/server/`. Si el archivo no está —otra
// máquina, un checkout parcial— NO es un fallo: se declara que no se pudo comprobar. Un chequeo que
// falla por lo que no tiene enseña a ignorarlo.
const dondeVivenLosSteps = "../../harness/panel/steps.json"

type hallazgo struct {
	grave bool // true = sale 1; false = se informa y no rompe
	texto string
}

// ChequeoDelMapa corre las comprobaciones y DEVUELVE los hallazgos, sin imprimir: así el mismo chequeo
// alimenta la consola y la API que consume la Vue. `tablasDelEsquema` puede ser nil — entonces esa
// comprobación se declara no realizada en vez de omitirse en silencio.
func ChequeoDelMapa(tablasDelEsquema map[string]bool) []hallazgo {
	var hs []hallazgo
	nota := func(g bool, f string, a ...any) { hs = append(hs, hallazgo{g, fmt.Sprintf(f, a...)}) }

	m, err := Cargar()
	if err != nil {
		return []hallazgo{{true, "el mapa no carga: " + err.Error()}}
	}
	sub, errSub := CargarSub()

	etapas := map[string]bool{}
	for _, e := range m.Etapas {
		etapas[e.ID] = true
	}

	// 1 · COHERENCIA INTERNA: nadie puede nombrar una etapa que no existe.
	for _, r := range m.Ramales {
		for _, p := range r.Pasos {
			if !etapas[p.ID] {
				nota(true, "el ramal %s declara la etapa %q, que no existe en etapas.json", r.ID, p.ID)
			}
		}
	}
	if errSub != nil {
		nota(true, "substeps.json no carga: %v", errSub)
	} else {
		for id := range sub.Etapas {
			if !etapas[id] {
				nota(true, "substeps declara la etapa %q, que no existe en etapas.json", id)
			}
		}
	}

	// 2 · EL VOCABULARIO COMPARTIDO CON EL HARNESS. `ramales.json` afirma, en su propia nota, que los ids
	// son los MISMOS que los de `harness/panel/steps.json` «a propósito: dos vocabularios para lo mismo es
	// como empiezan a derivar». Esa afirmación no la comprobaba nadie — o sea que era exactamente la clase
	// de deriva que decía estar evitando.
	mios := []string{}
	for _, r := range m.Ramales {
		mios = append(mios, r.ID)
	}
	sort.Strings(mios)
	suyos, dondeMira, err := ramalesDelHarness()
	switch {
	case err != nil:
		nota(false, "no se pudo leer %s (%v): el vocabulario compartido queda SIN comprobar", dondeMira, err)
	default:
		for _, id := range mios {
			if !suyos[id] {
				// No es grave por sí solo: el harness puede llamarlo `extensión` en vez de `ramal`, que es
				// el caso real de `credifamilia`. Lo que importa es que se VEA, no que rompa el build.
				nota(false, "el ramal %q no existe como ramal en el mapa del harness — comprobá que no sea deriva", id)
			}
		}
		for id := range suyos {
			if !contiene(mios, id) {
				nota(false, "el harness tiene el ramal %q y este mapa no lo conoce", id)
			}
		}
	}

	// 3 · LAS TABLAS DECLARADAS COMO EVIDENCIA. Es el análogo directo de las rutas de archivo del
	// `steps-check`: una etapa dice «a mí me prueba esta tabla», y si la tabla se renombró el mapa sigue
	// afirmándolo igual.
	tablas := map[string][]string{} // tabla → etapas que la declaran
	for _, e := range m.Etapas {
		for _, t := range e.BD.Tablas {
			tablas[t] = append(tablas[t], e.ID)
		}
	}
	nombres := make([]string, 0, len(tablas))
	for t := range tablas {
		nombres = append(nombres, t)
	}
	sort.Strings(nombres)
	switch {
	case tablasDelEsquema == nil:
		nota(false, "las %d tablas declaradas quedan SIN comprobar: correlo con -target local|dev para mirarlas contra el esquema", len(nombres))
	default:
		for _, t := range nombres {
			if !tablasDelEsquema[t] {
				nota(true, "la tabla %q (la declaran: %s) no existe en el esquema", t, strings.Join(tablas[t], ", "))
			}
		}
	}

	// 4 · UNA ETAPA SIN NINGUNA FORMA DE PROBARSE. No es un error —hay etapas que sólo viven en los
	// logs— pero sí es lo que hay que saber para leer el árbol: su ausencia no prueba nada.
	mudas := 0
	for _, e := range m.Etapas {
		if len(e.BD.Estados) == 0 && len(e.BD.Tablas) == 0 && len(e.Matchers) == 0 {
			nota(true, "la etapa %q no declara ni estados, ni tablas, ni matchers: no hay forma de que se encienda", e.ID)
			mudas++
		}
	}

	return hs
}

// Chequear es la capa de consola: corre el chequeo y lo imprime. Sale 1 si hay algo GRAVE, para poder
// encadenarlo — la misma convención que `bin/steps-check.ts` del harness.
func Chequear(tablasDelEsquema map[string]bool) int {
	m, err := Cargar()
	if err != nil {
		fmt.Printf("  %s el mapa no carga: %v\n", paint("31", "✘"), err)
		return 1
	}
	fmt.Printf("\n  %s\n", bold("── CHEQUEO DEL MAPA (sin corpus) ──"))
	fmt.Printf("     mapa v%s · %d etapas · %d ramales\n", m.Version, len(m.Etapas), len(m.Ramales))

	hs := ChequeoDelMapa(tablasDelEsquema)
	graves := 0
	for _, h := range hs {
		if h.grave {
			graves++
		}
	}
	if len(hs) == 0 {
		fmt.Printf("\n     %s todo resuelve\n\n", paint("32", "✓"))
		return 0
	}
	fmt.Println()
	for _, h := range hs {
		if h.grave {
			fmt.Printf("     %s %s\n", paint("31", "✘"), h.texto)
		} else {
			fmt.Printf("     %s %s\n", paint("33", "▲"), h.texto)
		}
	}
	fmt.Printf("\n     %s\n\n", gray(fmt.Sprintf("%d que rompen · %d para mirar", graves, len(hs)-graves)))
	if graves > 0 {
		return 1
	}
	return 0
}

// ParaLaUI devuelve los hallazgos en la forma que consume la Vue.
func ParaLaUI(hs []hallazgo) []map[string]any {
	out := []map[string]any{}
	for _, h := range hs {
		out = append(out, map[string]any{"grave": h.grave, "texto": h.texto})
	}
	return out
}

// ramalesDelHarness lee los ids de ramal del mapa del panel. Devuelve también la ruta mirada, para que
// el aviso diga DÓNDE buscó cuando no lo encuentra.
func ramalesDelHarness() (map[string]bool, string, error) {
	ruta, err := filepath.Abs(dondeVivenLosSteps)
	if err != nil {
		ruta = dondeVivenLosSteps
	}
	b, err := os.ReadFile(ruta)
	if err != nil {
		return nil, ruta, err
	}
	var doc struct {
		Ramales map[string]json.RawMessage `json:"ramales"`
	}
	if err := json.Unmarshal(b, &doc); err != nil {
		return nil, ruta, err
	}
	out := map[string]bool{}
	for k := range doc.Ramales {
		out[k] = true
	}
	return out, ruta, nil
}
