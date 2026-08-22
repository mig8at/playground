// vecindario.go — EL GREP PONE LA INTENCIÓN, EL GRAFO PONE EL VECINDARIO. La entrada útil.
//
// EL PROBLEMA QUE RESUELVE. Un mapa entero es detalle uniforme SIN intención: el mismo nivel para los
// 2.529 archivos, sin importar la pregunta. Medido, eso costaba 265.000 tokens y empataba con darle la
// lista de rutas y dejarlo pedir detalle de los pocos que le importan. Acá la semilla la pone la
// pregunta —lo que matcheó el grep— y el grafo sólo agrega lo pegado a eso.
//
// LO QUE APORTA SOBRE EL GREP SOLO, que es la única razón para que exista: el archivo que **no
// matcheó** pero está a un salto. Grepeando `can_check_preapproval` aparece `ProfilingRulesService`,
// que no contiene el término y es uno de los cuatro archivos que el experimento del triaje tuvo que
// rescatar a mano. Un grep no puede verlo por construcción.
//
// ⚠ LA EXPANSIÓN EXPLOTA SI NO SE LA ATA. Medido en 5 términos: a 1 salto son 2-39 archivos, todos del
// vecindario real; a 2 saltos, 198-342, con OTP, ecommerce y contadores de Experian adentro — el
// fan-out del padre arrastra el módulo entero. Por eso el default es 1 salto y `--saltos 2` avisa con
// esos números en vez de bajarlo en silencio.
package main

import (
	"fmt"
	"os/exec"
	"sort"
	"strings"
)

type vecino struct {
	Ruta    string          `json:"ruta"`
	Saltos  int             `json:"saltos"`
	Toca    map[string]bool `json:"-"`
	Semilla int             `json:"tocado_por"`
	Aristas []arista        `json:"por,omitempty"`
}

func cmdVecindario(args []string) {
	c := nuevoCtx("vecindario", "un término → los archivos que lo contienen + sus vecinos", true)
	var saltos, presupuesto int
	var regex, soloNuevos bool
	c.fs.IntVar(&saltos, "saltos", 1, "cuántos saltos expandir (⚠ 2 explota: ver la advertencia)")
	c.fs.IntVar(&presupuesto, "tokens", 25000, "presupuesto; al cortar lo DICE")
	c.fs.BoolVar(&regex, "regex", false, "tratar el término como regex en vez de texto literal")
	c.fs.BoolVar(&soloNuevos, "solo-nuevos", false, "sólo lo que el grep NO encontró: el aporte del grafo")
	resto := c.parsear(args)
	if len(resto) != 1 {
		salir(fmt.Errorf("pasá un término:  demo vecindario can_check_preapproval"))
	}
	termino := resto[0]
	g := c.grafo()

	// ── LA SEMILLA: lo que matcheó el grep, contra `main` y no contra el working tree.
	modo := "-F"
	if regex {
		modo = "-E"
	}
	out, _ := exec.Command("git", "-C", repoDe(c.alias), "grep", "-l", modo, "--", termino, rama).Output()
	entran, salen := g.grado()
	semillas := map[string]bool{}
	for _, l := range strings.Split(string(out), "\n") {
		r := strings.TrimPrefix(strings.TrimSpace(l), rama+":")
		if a := g.Archivos[r]; a != nil && c.f.aplica(a, entran, salen) {
			semillas[r] = true
		}
	}
	if len(semillas) == 0 {
		fmt.Printf("«%s» no matcheó ningún archivo indexado de %s:%s\n", termino, c.alias, rama)
		return
	}

	// ── LA EXPANSIÓN, en las dos direcciones: para «¿por qué no apareció?» los que LLAMAN importan
	// tanto como los llamados.
	ady := map[string][]arista{}
	for _, e := range g.Aristas {
		if e.De == e.A {
			continue
		}
		ady[e.De] = append(ady[e.De], e)
		ady[e.A] = append(ady[e.A], arista{De: e.A, A: e.De, Clase: e.Clase, Met: e.Met,
			Linea: e.Linea, Como: e.Como, Via: e.Via})
	}
	vec := map[string]*vecino{}
	frente := make([]string, 0, len(semillas))
	for s := range semillas {
		vec[s] = &vecino{Ruta: s, Toca: map[string]bool{s: true}}
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

	// ── EL RANKING: semillas primero, después lo CO-ACTIVADO, después por cercanía.
	//
	// ⚠ RESULTADO NEGATIVO, medido: a 1 salto la co-activación NO DISPARA. Con las 5 semillas de
	// `can_check_preapproval`, a cada uno de los 7 vecinos lo toca UNA sola semilla — el grafo es
	// demasiado ralo (77,8% de los call sites sin resolver) para que compartan vecinos. Recién aparece
	// a 2 saltos, que es donde el vecindario ya no sirve. Queda el criterio porque no cuesta y porque
	// un grafo más denso lo activaría, pero HOY el orden efectivo es semillas → cercanía → ruta.
	lista := make([]*vecino, 0, len(vec))
	for _, v := range vec {
		v.Semilla = len(v.Toca)
		if soloNuevos && v.Saltos == 0 {
			continue
		}
		if a := g.Archivos[v.Ruta]; a == nil || !c.f.aplica(a, entran, salen) {
			continue
		}
		lista = append(lista, v)
	}
	sort.Slice(lista, func(i, j int) bool {
		a, b := lista[i], lista[j]
		if (a.Saltos == 0) != (b.Saltos == 0) {
			return a.Saltos == 0
		}
		if a.Semilla != b.Semilla {
			return a.Semilla > b.Semilla
		}
		if a.Saltos != b.Saltos {
			return a.Saltos < b.Saltos
		}
		return a.Ruta < b.Ruta
	})
	if c.emitir(map[string]any{"termino": termino, "semillas": len(semillas), "vecindario": lista}) {
		return
	}

	fmt.Printf("«%s» en %s:%s — %d semillas, %d más en el vecindario a %d salto(s)\n",
		termino, c.alias, rama, len(semillas), len(vec)-len(semillas), saltos)
	if saltos > 1 {
		fmt.Printf("  ⚠ MEDIDO: a 1 salto son 2-39 archivos; a 2 saltos, 198-342. El segundo salto\n" +
			"    arrastra el fan-out del padre (OTP, ecommerce, Experian) y deja de ser un vecindario.\n")
	}
	fmt.Println()
	gastado, cortados := 0, 0
	for _, v := range lista {
		txt := renderizar(g.Archivos[v.Ruta])
		if presupuesto > 0 && gastado+len(txt)/4 > presupuesto {
			cortados++
			continue
		}
		gastado += len(txt) / 4
		marca := "[GREP]"
		if v.Saltos > 0 {
			marca = fmt.Sprintf("[+%d salto]", v.Saltos)
			if v.Semilla > 1 {
				marca = fmt.Sprintf("[+%d salto · CO-ACTIVADO por %d semillas]", v.Saltos, v.Semilla)
			}
		}
		fmt.Printf("%s\n%s", marca, txt)
		for _, e := range v.Aristas[:min(len(v.Aristas), 3)] {
			fmt.Printf("    ← %s ::%s %s\n", acortar(e.A, 62), e.Met, etiqueta(e))
		}
	}
	fmt.Printf("\n  ~%d tokens", gastado)
	if cortados > 0 {
		fmt.Printf("  ⚠ %d archivos quedaron FUERA por presupuesto (subí --tokens)", cortados)
	}
	fmt.Println()
}
