// ramas — ¿en qué ramas vive cada tarea, y hasta dónde llegó cada una?
//
// Lee el patrón `ramas:` del frontmatter de cada tarea y MIDE contra los repos: qué ramas remotas
// matchean y, por patch-id, en qué ramas de ambiente está ya el cambio. Escribe un snapshot en
// `data/cache/ramas.json` con la FECHA de la medición, que es lo que después muestra la card.
//
// NO habla con la red: lee lo que el último `git fetch` dejó en cada repo. Si un dato se ve viejo, el
// arreglo es fetchear, no que esto lo haga por su cuenta — un comando de lectura que sale a internet
// sorprende, y en 13 repos tardaría lo suficiente para que nadie lo corriera.
//
// uso:
//
//	go run ./cmd/ramas            # mide todas las tareas con patrón y guarda el snapshot
//	go run ./cmd/ramas -json      # además lo imprime
//	go run ./cmd/ramas -n <slug>  # sólo esa tarea
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"sort"
	"strconv"
	"strings"
	"time"

	"creditop/tablero/server/internal/store"
)

func main() {
	var (
		soloJSON = flag.Bool("json", false, "imprimir el snapshot además de guardarlo")
		soloUna  = flag.String("n", "", "medir sólo esta tarea (slug)")
		root     = flag.String("root", "", "dónde viven los repos (default: ~/Desktop/CREDITOP/github)")
		sugerir  = flag.Bool("sugerir", false, "las tareas que NO declaran `ramas:`: qué patrón las cubriría, y qué ramas traería")
		espera   = flag.Duration("timeout", 5*time.Minute, "cuánto esperar la medición entera antes de devolver lo que haya")
	)
	flag.Parse()

	if *root == "" {
		*root = filepath.Join(os.Getenv("HOME"), "Desktop", "CREDITOP", "github")
	}
	dataDir := os.Getenv("TABLERO_DATA")
	if dataDir == "" {
		dataDir = "../data"
	}

	st, err := store.Open(dataDir)
	if err != nil {
		fmt.Fprintf(os.Stderr, "no pude abrir las tareas: %v\n", err)
		os.Exit(1)
	}

	efforts, err := st.Efforts()
	if err != nil {
		fmt.Fprintf(os.Stderr, "no pude leer las tareas: %v\n", err)
		os.Exit(1)
	}
	if *sugerir {
		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancel()
		sugerencias(ctx, *root, dataDir, st.EffortsAll())
		return
	}
	// Los patrones se toman del frontmatter: la tarea declara CON QUÉ nombre trabaja, y el resto se mide.
	// La clave es el ID (no el slug): el nombre del archivo se puede renombrar a mano.
	patrones := map[string]string{}
	titulos := map[string]string{}
	for _, e := range efforts {
		id := strconv.FormatInt(e.ID, 10)
		// `-n` acepta el id o un trozo del título: pedir el slug obligaría a exponerlo, y el título
		// es lo que uno tiene en la cabeza.
		if e.RamasPatron == "" {
			continue
		}
		if *soloUna != "" && *soloUna != id && !strings.Contains(strings.ToLower(e.Title), strings.ToLower(*soloUna)) {
			continue
		}
		patrones[id] = e.RamasPatron
		titulos[id] = e.Title
	}
	if len(patrones) == 0 {
		if *soloUna != "" {
			fmt.Printf("ninguna tarea que matchee %q declara `ramas:` en su frontmatter\n", *soloUna)
		} else {
			fmt.Println("ninguna tarea declara `ramas:` — agregá el patrón al frontmatter y volvé a medir")
			fmt.Println("  ej:  ramas: pais-como-dato")
		}
		return
	}

	// Si se pasa del tiempo, se devuelve lo medido hasta ahí antes que colgar a quien espera en la
	// terminal — pero DICIENDO qué faltó: el snapshot guarda las tareas que no alcanzó y acá se avisa.
	ctx, cancel := context.WithTimeout(context.Background(), *espera)
	defer cancel()

	snap := store.MedirRamas(ctx, *root, patrones, nil)
	if len(snap.Incompletas) > 0 {
		fmt.Fprintf(os.Stderr, "⚠ se venció el tiempo (%s): %d tarea(s) sin medir —ids %s—. Subí -timeout o medí una con -n\n",
			*espera, len(snap.Incompletas), strings.Join(snap.Incompletas, ", "))
	}
	cacheDir := filepath.Join(dataDir, "cache")
	// MEDIR UNA TAREA NO PUEDE BORRAR LAS DEMÁS. Con `-n` sólo se mide una, y guardar el resultado tal
	// cual dejaba el snapshot con esa sola: el tablero mostraba que ninguna otra tarea tiene ramas, sin
	// avisar. Se fusiona con lo que había; cada tarea lleva su propia fecha, así que lo viejo se ve viejo.
	if *soloUna != "" {
		previo := store.LeerSnapshotRamas(cacheDir)
		for id, t := range previo.Tareas {
			if _, remedida := snap.Tareas[id]; !remedida {
				snap.Tareas[id] = t
			}
		}
	}
	if err := store.GuardarSnapshotRamas(cacheDir, snap); err != nil {
		fmt.Fprintf(os.Stderr, "no pude guardar el snapshot: %v\n", err)
		os.Exit(1)
	}

	if *soloJSON {
		b, _ := json.MarshalIndent(snap, "", "  ")
		fmt.Println(string(b))
		return
	}

	imprimir(snap, titulos)
	fmt.Printf("\n  snapshot → %s\n", filepath.Join(cacheDir, "ramas.json"))
}

// ── sugerir patrones ────────────────────────────────────────────────────────────────────────────

// PALABRAS que no distinguen nada: aparecen en el nombre de cualquier rama o de cualquier tarea.
var vacias = map[string]bool{
	"para": true, "como": true, "desde": true, "hasta": true, "sobre": true, "entre": true, "todos": true,
	"todas": true, "cuando": true, "donde": true, "porque": true, "sino": true, "esta": true, "este": true,
	"local": true, "main": true, "test": true, "tests": true, "fix": true, "feat": true, "feature": true,
	"nuevo": true, "nueva": true, "puede": true, "tiene": true, "hace": true, "solo": true, "mismo": true,
	"que": true, "con": true, "por": true, "del": true, "las": true, "los": true, "una": true, "uno": true,
	"chore": true, "refactor": true, "obs": true, "perf": true, "docs": true,
}

var reJira = regexp.MustCompile(`(?i)\b(CORE|CRED)-\d+\b`)

func trozos(s string) []string {
	return strings.FieldsFunc(strings.ToLower(s), func(r rune) bool {
		return !('a' <= r && r <= 'z') && !('0' <= r && r <= '9')
	})
}

// SE RANKEAN RAMAS, NO PALABRAS. La primera versión proponía un patrón por cada trozo del slug y
// ofrecía «estado» o «lista», que traen ramas de cualquier tarea — justo el patrón ancho que el repo
// prohíbe. Lo que decide si una rama es de esta tarea no es compartir UNA palabra, sino compartir algo
// RARO: un trozo que aparece en pocas ramas de todo el universo (`df`) vale mucho más que uno común.
// Por eso una rama entra si comparte dos trozos, o uno solo cuando ese trozo es casi único.
const (
	dfEspecifico = 3  // un trozo en 3 ramas o menos ya identifica por sí solo
	dfGenerico   = 40 // por encima de esto no aporta nada, ni sumando
)

type candidata struct {
	r       store.RamaSuelta
	comunes []string
	puntaje int
}

// clavesDe lee las claves de Jira del frontmatter de una tarea. Se lee el archivo en vez de pedirle el
// dato al store porque `Effort` no las expone: el store las usa para su índice `locals`, no como campo.
func clavesDe(dir, file string) []string {
	b, err := os.ReadFile(filepath.Join(dir, file))
	if err != nil {
		return nil
	}
	partes := strings.SplitN(string(b), "---", 3)
	if len(partes) < 3 {
		return nil
	}
	for _, l := range strings.Split(partes[1], "\n") {
		if strings.HasPrefix(l, "jira:") {
			return reJira.FindAllString(l, -1)
		}
	}
	return nil
}

func sugerencias(ctx context.Context, root, dataDir string, efforts []store.EffortRef) {
	todas := store.TodasLasRamas(ctx, root)
	// df: en cuántas ramas del universo aparece cada trozo
	df := map[string]int{}
	tokRama := make([][]string, len(todas))
	for i, r := range todas {
		vistos := map[string]bool{}
		for _, t := range trozos(r.Rama) {
			if len(t) < 3 || vacias[t] || vistos[t] {
				continue
			}
			vistos[t] = true
			tokRama[i] = append(tokRama[i], t)
			df[t]++
		}
	}

	fmt.Printf("\n  Tareas SIN `ramas:` — qué ramas parecen suyas (%d ramas miradas en %s)\n", len(todas), root)
	fmt.Print("  ⚠ Es una PROPUESTA, no una medición: el patrón es lo único que se escribe a mano, y uno\n" +
		"    ancho no falla, MIENTE. Copiá al frontmatter sólo lo que reconozcas.\n\n")

	sinNada := 0
	for _, e := range efforts {
		if e.RamasPatron != "" || e.Archived != "" {
			continue
		}
		slug := strings.TrimSuffix(e.File, ".md")
		// lo que la tarea aporta para buscar: los trozos de su slug y sus claves de Jira
		quiero := map[string]bool{}
		for _, t := range trozos(slug) {
			if len(t) >= 4 && !vacias[t] {
				quiero[t] = true
			}
		}
		// Las claves salen del FRONTMATTER, no del cuerpo: el cuerpo de una tarea menciona las claves de
		// otras (las que la bloquean, las que la originaron), y buscarlas ahí le adjudicaba a la tarea de
		// Motai las ramas de CORE-258 y CORE-431, que son de otras dos.
		claves := map[string]bool{}
		for _, k := range clavesDe(dataDir, e.File) {
			claves[strings.ToLower(k)] = true
		}

		var cs []candidata
		for i, r := range todas {
			var comunes []string
			puntaje, hayClave := 0, false
			for _, t := range tokRama[i] {
				if claves[t] || (len(t) > 4 && claves[strings.ToLower(r.Rama)]) {
					hayClave = true
				}
				if !quiero[t] || df[t] > dfGenerico {
					continue
				}
				comunes = append(comunes, t)
				if df[t] <= dfEspecifico {
					puntaje += 3
				} else {
					puntaje++
				}
			}
			for c := range claves {
				if strings.Contains(strings.ToLower(r.Rama), c) {
					hayClave = true
					if !slices.Contains(comunes, c) {
						comunes = append(comunes, c)
					}
				}
			}
			if hayClave {
				puntaje += 5 // la clave de Jira en el nombre de la rama es la señal más fuerte que hay
			}
			// El mínimo es 6, o sea: la clave de Jira de la tarea en el nombre de la rama, o DOS trozos
			// raros compartidos. Con 3 —un solo trozo específico— entraban ramas de canon en tareas de
			// negocio por compartir «logs», «lista» o «crédito»: una palabra sola no identifica nada.
			if puntaje >= 6 {
				cs = append(cs, candidata{r, comunes, puntaje})
			}
		}
		if len(cs) == 0 {
			sinNada++
			continue
		}
		sort.Slice(cs, func(i, j int) bool {
			if cs[i].puntaje != cs[j].puntaje {
				return cs[i].puntaje > cs[j].puntaje
			}
			return cs[i].r.Fecha > cs[j].r.Fecha
		})
		// el patrón propuesto: el trozo compartido más RARO de la mejor candidata
		mejor, rareza := "", 1<<30
		for _, t := range cs[0].comunes {
			if df[t] < rareza {
				mejor, rareza = t, df[t]
			}
		}
		fmt.Printf("  #%d %s\n", e.ID, e.Title)
		if mejor != "" {
			fmt.Printf("     ramas: %s        ← candidato (aparece en %d rama(s) de todo el universo)\n", mejor, df[mejor])
		}
		vistas := map[string]bool{}
		mostradas := 0
		for _, c := range cs {
			k := c.r.Repo + "/" + c.r.Rama
			if vistas[k] {
				continue // la misma rama remota y local: se muestra una vez
			}
			vistas[k] = true
			if mostradas == 5 {
				fmt.Printf("       … y %d más\n", len(cs)-mostradas)
				break
			}
			mostradas++
			fmt.Printf("       %s  %-20s %-52s [%s]\n", c.r.Fecha, c.r.Repo, c.r.Rama, strings.Join(c.comunes, " "))
		}
		fmt.Println()
	}
	fmt.Printf("  %d tarea(s) sin `ramas:` no se parecen a ninguna rama — probablemente todavía no tienen código.\n\n", sinNada)
}

func imprimir(snap store.SnapshotRamas, titulos map[string]string) {
	slugs := make([]string, 0, len(snap.Tareas))
	for s := range snap.Tareas {
		slugs = append(slugs, s)
	}
	sort.Strings(slugs)

	fmt.Printf("Ramas por tarea · medido %s\n", snap.MedidoEn)
	for _, id := range slugs {
		t := snap.Tareas[id]
		fmt.Printf("\n  #%s  %s\n", id, titulos[id])
		fmt.Printf("  patrón: %s\n", t.Patron)
		if len(t.Ramas) == 0 {
			fmt.Println("    (ninguna rama remota matchea — ¿está pusheada?)")
			continue
		}
		for _, r := range t.Ramas {
			// Se listan los ambientes donde YA está y los que faltan, por separado: "está en develop"
			// y "no está en main" son las dos mitades de la respuesta y leerlas juntas confunde.
			var en, falta []string
			ambs := make([]string, 0, len(r.Propios))
			for a := range r.Propios {
				ambs = append(ambs, a)
			}
			sort.Strings(ambs)
			for _, a := range ambs {
				if r.En[a] {
					en = append(en, a)
				} else {
					falta = append(falta, a)
				}
			}
			// «(local)» importa: en las MERGEADAS la remota se borra al aprobar el PR, así que una rama
			// local no significa "sin pushear" — los ambientes de abajo dicen cuál de las dos es.
			marca := ""
			if r.Local {
				marca = "  (local)"
			}
			fmt.Printf("    %-22s %-46s %s%s\n", r.Repo, r.Rama, r.Commit, marca)
			if len(en) > 0 {
				fmt.Printf("      ✅ el cambio ya está en: %s\n", strings.Join(en, ", "))
			}
			if len(falta) > 0 {
				fmt.Printf("      ⧗ falta en:              %s\n", strings.Join(falta, ", "))
			}
			// El PR es la mitad que git no sabe: contesta «¿por qué esto no avanza?». Un OPEN con
			// REVIEW_REQUIRED dice "nadie lo miró", que es distinto de "falta trabajo".
			if pr := r.PR; pr != nil {
				extra := ""
				switch {
				case pr.Draft:
					extra = " · borrador"
				case pr.Estado == "OPEN" && pr.Revision == "APPROVED":
					extra = " · aprobado, listo para mergear"
				case pr.Estado == "OPEN" && pr.Revision == "CHANGES_REQUESTED":
					extra = " · piden cambios"
				case pr.Estado == "OPEN" && pr.Revision == "REVIEW_REQUIRED":
					extra = " · esperando revisión"
				case pr.Estado == "OPEN":
					extra = " · sin revisor pedido"
				case pr.Estado == "MERGED" && pr.Mergeado != "":
					extra = " · " + pr.Mergeado[:10]
				}
				fmt.Printf("      ⇢ PR #%d → %s   %s%s\n", pr.Numero, pr.Base, pr.Estado, extra)
			} else {
				fmt.Printf("      ⇢ sin PR\n")
			}
		}
	}
}
