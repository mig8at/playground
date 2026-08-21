// vecindario.go — EL GREP PONE LA INTENCIÓN, EL GRAFO PONE EL VECINDARIO.
//
// EL PROBLEMA QUE RESUELVE. Un mapa entero es detalle uniforme SIN intención: el mismo nivel para los
// 2.529 archivos, sin importar la pregunta. Medido, eso costaba 265.000 tokens y empataba con una
// herramienta que pedía 7 archivos. Acá la semilla la pone la pregunta —lo que matcheó el grep— y el
// grafo sólo agrega lo que está pegado a eso.
//
// LO QUE APORTA SOBRE EL GREP SOLO, que es la única razón para que exista: el archivo que **no
// matcheó** pero está a un salto de varios que sí. Ese es el caso del triaje —la respuesta estaba en un
// archivo que no contenía ninguno de los términos de la pregunta— y es lo que un grep no puede ver por
// construcción.
//
// ⚠ LA EXPANSIÓN EXPLOTA SI NO SE LA ATA. Medido en este mismo repo: 41 archivos a 4 saltos desde UN
// controller. Por eso hay tres frenos: el ranking (primero lo CO-ACTIVADO, lo que toca a varias
// semillas), el tope de saltos, y un presupuesto en tokens que —cuando corta— DICE que cortó. Un corte
// silencioso se lee como «esto es todo el vecindario», que es la conclusión más equivocada posible.
package main

import (
	"fmt"
	"os"
	"os/exec"
	"sort"
	"strings"
)

type vecino struct {
	Ruta    string
	Saltos  int
	Toca    map[string]bool // qué semillas lo tocan: co-activación
	Aristas []arista
}

func cmdVecindario() {
	alias := arg(2, "el alias del repo")
	termino := arg(3, "el término a grepear")
	saltos := 1
	presupuesto := 25000 // tokens
	for i := 4; i < len(os.Args)-1; i++ {
		switch os.Args[i] {
		case "-saltos":
			fmt.Sscanf(os.Args[i+1], "%d", &saltos)
		case "-tokens":
			fmt.Sscanf(os.Args[i+1], "%d", &presupuesto)
		}
	}

	raices, err := cargarRaices(dirBase() + "/roots.json")
	if err != nil {
		salir(err)
	}
	repo, ok := raices[alias]
	if !ok {
		salir(fmt.Errorf("alias desconocido %q", alias))
	}
	g := cargarGrafo(alias)

	// ── LA SEMILLA: lo que matcheó el grep, contra `main` y no contra el working tree.
	out, _ := exec.Command("git", "-C", repo, "grep", "-l", "-F", "--", termino, "main").Output()
	semillas := map[string]bool{}
	for _, l := range strings.Split(string(out), "\n") {
		r := strings.TrimPrefix(strings.TrimSpace(l), "main:")
		if r != "" && g.Archivos[r] != nil {
			semillas[r] = true
		}
	}
	if len(semillas) == 0 {
		fmt.Printf("«%s» no matcheó ningún archivo indexado de %s:main\n", termino, alias)
		return
	}

	// ── LA EXPANSIÓN: en las dos direcciones. Para «¿por qué no apareció?» los que LLAMAN importan
	// tanto como los llamados.
	ady := map[string][]arista{}
	for _, e := range g.Aristas {
		if e.De == e.A {
			continue
		}
		ady[e.De] = append(ady[e.De], e)
		ady[e.A] = append(ady[e.A], arista{De: e.A, A: e.De, Clase: e.Clase, Met: e.Met, Linea: e.Linea, Como: e.Como, Via: e.Via})
	}
	vec := map[string]*vecino{}
	for s := range semillas {
		vec[s] = &vecino{Ruta: s, Saltos: 0, Toca: map[string]bool{s: true}}
	}
	frente := make([]string, 0, len(semillas))
	for s := range semillas {
		frente = append(frente, s)
	}
	sort.Strings(frente)
	for h := 1; h <= saltos; h++ {
		var sig []string
		for _, f := range frente {
			origen := vec[f].Toca
			for _, e := range ady[f] {
				v := vec[e.A]
				if v == nil {
					v = &vecino{Ruta: e.A, Saltos: h, Toca: map[string]bool{}}
					vec[e.A] = v
					sig = append(sig, e.A)
				}
				for s := range origen {
					v.Toca[s] = true
				}
				if v.Saltos == h {
					v.Aristas = append(v.Aristas, e)
				}
			}
		}
		sort.Strings(sig)
		frente = sig
	}

	// ── EL RANKING: primero las semillas, después lo CO-ACTIVADO (lo que toca a más semillas es lo que
	// más probablemente sea el puente que el grep no vio), después por cercanía.
	//
	// ⚠ RESULTADO NEGATIVO, medido: a 1 salto la co-activación NO DISPARA. Con 5 semillas de
	// `can_check_preapproval`, los 7 vecinos los toca UNA sola semilla cada uno — el grafo es
	// suficientemente ralo (77,8% de los call sites sin resolver) como para que las semillas no
	// compartan vecinos. Recién aparece a 2 saltos, que es justo donde el vecindario deja de servir.
	// Se deja el criterio porque no cuesta nada y porque un grafo más denso lo activaría; pero hoy el
	// orden efectivo es semillas → cercanía → ruta, y decirlo evita que alguien crea que rankea.
	lista := make([]*vecino, 0, len(vec))
	for _, v := range vec {
		lista = append(lista, v)
	}
	sort.Slice(lista, func(i, j int) bool {
		a, b := lista[i], lista[j]
		if (a.Saltos == 0) != (b.Saltos == 0) {
			return a.Saltos == 0
		}
		if len(a.Toca) != len(b.Toca) {
			return len(a.Toca) > len(b.Toca)
		}
		if a.Saltos != b.Saltos {
			return a.Saltos < b.Saltos
		}
		return a.Ruta < b.Ruta
	})

	fmt.Printf("«%s» en %s:main — %d semillas, %d en el vecindario a %d salto(s)\n",
		termino, alias, len(semillas), len(vec)-len(semillas), saltos)
	if saltos > 1 {
		// El acantilado está MEDIDO, y es abrupto. Un salto: 2 a 39 archivos, todos del vecindario
		// real. Dos saltos: 198 a 342, y entra OTP, ecommerce y contadores de Experian — el fan-out
		// del padre arrastra el módulo entero. Avisar es más honesto que bajar el default en silencio.
		fmt.Printf("  ⚠ MEDIDO: a 1 salto son 2-39 archivos; a 2 saltos, 198-342. El segundo salto\n" +
			"    arrastra el fan-out del padre (OTP, ecommerce, Experian) y deja de ser un vecindario.\n")
	}
	fmt.Println()
	gastado, cortados := 0, 0
	for _, v := range lista {
		txt := renderizar(g.Archivos[v.Ruta])
		if gastado+len(txt)/4 > presupuesto {
			cortados++
			continue
		}
		gastado += len(txt) / 4
		marca := fmt.Sprintf("[+%d salto", v.Saltos)
		if v.Saltos == 0 {
			marca = "[GREP"
		} else if len(v.Toca) > 1 {
			marca = fmt.Sprintf("[+%d salto · CO-ACTIVADO por %d semillas", v.Saltos, len(v.Toca))
		}
		fmt.Printf("%s]\n%s", marca, txt)
		for _, e := range v.Aristas[:min(len(v.Aristas), 3)] {
			fmt.Printf("    ← %s::%s %s\n", acortar(e.A), e.Met, etiqueta(e))
		}
	}
	fmt.Printf("\n  ~%d tokens", gastado)
	if cortados > 0 {
		// El corte se DICE. Un vecindario truncado en silencio se lee como completo.
		fmt.Printf("  ⚠ %d archivos quedaron FUERA por presupuesto (subí -tokens)", cortados)
	}
	fmt.Println()
}
