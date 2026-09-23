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
//	go run ./cmd/branches            # mide todas las tareas con patrón y guarda el snapshot
//	go run ./cmd/branches -json      # además lo imprime
//	go run ./cmd/branches -n <slug>  # sólo esa tarea
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
		onlyJSON = flag.Bool("json", false, "imprimir el snapshot además de guardarlo")
		onlyOne  = flag.String("n", "", "medir sólo esta tarea (slug)")
		root     = flag.String("root", "", "dónde viven los repos (default: ~/Desktop/CREDITOP/github)")
		suggest  = flag.Bool("sugerir", false, "las tareas que NO declaran `ramas:`: qué patrón las cubriría, y qué ramas traería")
		wait     = flag.Duration("timeout", 5*time.Minute, "cuánto esperar la medición entera antes de devolver lo que haya")
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
	if *suggest {
		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancel()
		suggestions(ctx, *root, dataDir, st.EffortsAll())
		return
	}
	// Los patrones se toman del frontmatter: la tarea declara CON QUÉ nombre trabaja, y el resto se mide.
	// La clave es el ID (no el slug): el nombre del archivo se puede renombrar a mano.
	patterns := map[string]string{}
	titles := map[string]string{}
	for _, e := range efforts {
		id := strconv.FormatInt(e.ID, 10)
		// `-n` acepta el id o un trozo del título: pedir el slug obligaría a exponerlo, y el título
		// es lo que uno tiene en la cabeza.
		if e.BranchPatterns == "" {
			continue
		}
		if *onlyOne != "" && *onlyOne != id && !strings.Contains(strings.ToLower(e.Title), strings.ToLower(*onlyOne)) {
			continue
		}
		patterns[id] = e.BranchPatterns
		titles[id] = e.Title
	}
	if len(patterns) == 0 {
		if *onlyOne != "" {
			fmt.Printf("ninguna tarea que matchee %q declara `ramas:` en su frontmatter\n", *onlyOne)
		} else {
			fmt.Println("ninguna tarea declara `ramas:` — agregá el patrón al frontmatter y volvé a medir")
			fmt.Println("  ej:  ramas: pais-como-dato")
		}
		return
	}

	// Si se pasa del tiempo, se devuelve lo medido hasta ahí antes que colgar a quien espera en la
	// terminal — pero DICIENDO qué faltó: el snapshot guarda las tareas que no alcanzó y acá se avisa.
	ctx, cancel := context.WithTimeout(context.Background(), *wait)
	defer cancel()

	snap := store.MeasureBranches(ctx, *root, patterns, nil)
	if len(snap.Incomplete) > 0 {
		fmt.Fprintf(os.Stderr, "⚠ se venció el tiempo (%s): %d tarea(s) sin medir —ids %s—. Subí -timeout o medí una con -n\n",
			*wait, len(snap.Incomplete), strings.Join(snap.Incomplete, ", "))
	}
	cacheDir := filepath.Join(dataDir, "cache")
	// MEDIR UNA TAREA NO PUEDE BORRAR LAS DEMÁS. Con `-n` sólo se mide una, y guardar el resultado tal
	// cual dejaba el snapshot con esa sola: el tablero mostraba que ninguna otra tarea tiene ramas, sin
	// avisar. Se fusiona con lo que había; cada tarea lleva su propia fecha, así que lo viejo se ve viejo.
	if *onlyOne != "" {
		previous := store.ReadBranchSnapshot(cacheDir)
		for id, t := range previous.Tasks {
			if _, remeasured := snap.Tasks[id]; !remeasured {
				snap.Tasks[id] = t
			}
		}
	}
	if err := store.SaveBranchSnapshot(cacheDir, snap); err != nil {
		fmt.Fprintf(os.Stderr, "no pude guardar el snapshot: %v\n", err)
		os.Exit(1)
	}

	if *onlyJSON {
		b, _ := json.MarshalIndent(snap, "", "  ")
		fmt.Println(string(b))
		return
	}

	printReport(snap, titles)
	fmt.Printf("\n  snapshot → %s\n", filepath.Join(cacheDir, "ramas.json"))
}

// ── sugerir patrones ────────────────────────────────────────────────────────────────────────────

// PALABRAS que no distinguen nada: aparecen en el nombre de cualquier rama o de cualquier tarea.
var stopWords = map[string]bool{
	"para": true, "como": true, "desde": true, "hasta": true, "sobre": true, "entre": true, "todos": true,
	"todas": true, "cuando": true, "donde": true, "porque": true, "sino": true, "esta": true, "este": true,
	"local": true, "main": true, "test": true, "tests": true, "fix": true, "feat": true, "feature": true,
	"nuevo": true, "nueva": true, "puede": true, "tiene": true, "hace": true, "solo": true, "mismo": true,
	"que": true, "con": true, "por": true, "del": true, "las": true, "los": true, "una": true, "uno": true,
	"chore": true, "refactor": true, "obs": true, "perf": true, "docs": true,
}

var reJira = regexp.MustCompile(`(?i)\b(CORE|CRED)-\d+\b`)

func chunks(s string) []string {
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
	dfSpecific = 3  // un trozo en 3 ramas o menos ya identifica por sí solo
	dfGeneric  = 40 // por encima de esto no aporta nada, ni sumando
)

type candidate struct {
	r      store.LooseBranch
	common []string
	score  int
}

// keysOf lee las claves de Jira del frontmatter de una tarea. Se lee el archivo en vez de pedirle el
// dato al store porque `Effort` no las expone: el store las usa para su índice `locals`, no como campo.
func keysOf(dir, file string) []string {
	b, err := os.ReadFile(filepath.Join(dir, file))
	if err != nil {
		return nil
	}
	parts := strings.SplitN(string(b), "---", 3)
	if len(parts) < 3 {
		return nil
	}
	for _, l := range strings.Split(parts[1], "\n") {
		if strings.HasPrefix(l, "jira:") {
			return reJira.FindAllString(l, -1)
		}
	}
	return nil
}

func suggestions(ctx context.Context, root, dataDir string, efforts []store.EffortRef) {
	all := store.AllBranches(ctx, root)
	// df: en cuántas ramas del universo aparece cada trozo
	df := map[string]int{}
	branchToken := make([][]string, len(all))
	for i, r := range all {
		seenBranches := map[string]bool{}
		for _, t := range chunks(r.Branch) {
			if len(t) < 3 || stopWords[t] || seenBranches[t] {
				continue
			}
			seenBranches[t] = true
			branchToken[i] = append(branchToken[i], t)
			df[t]++
		}
	}

	fmt.Printf("\n  Tareas SIN `ramas:` — qué ramas parecen suyas (%d ramas miradas en %s)\n", len(all), root)
	fmt.Print("  ⚠ Es una PROPUESTA, no una medición: el patrón es lo único que se escribe a mano, y uno\n" +
		"    ancho no falla, MIENTE. Copiá al frontmatter sólo lo que reconozcas.\n\n")

	noMatches := 0
	for _, e := range efforts {
		if e.BranchPatterns != "" || e.Archived != "" {
			continue
		}
		slug := strings.TrimSuffix(e.File, ".md")
		// lo que la tarea aporta para buscar: los trozos de su slug y sus claves de Jira
		want := map[string]bool{}
		for _, t := range chunks(slug) {
			if len(t) >= 4 && !stopWords[t] {
				want[t] = true
			}
		}
		// Las claves salen del FRONTMATTER, no del cuerpo: el cuerpo de una tarea menciona las claves de
		// otras (las que la bloquean, las que la originaron), y buscarlas ahí le adjudicaba a la tarea de
		// Motai las ramas de CORE-258 y CORE-431, que son de otras dos.
		keys := map[string]bool{}
		for _, k := range keysOf(dataDir, e.File) {
			keys[strings.ToLower(k)] = true
		}

		var cs []candidate
		for i, r := range all {
			var common []string
			score, hasKey := 0, false
			for _, t := range branchToken[i] {
				if keys[t] || (len(t) > 4 && keys[strings.ToLower(r.Branch)]) {
					hasKey = true
				}
				if !want[t] || df[t] > dfGeneric {
					continue
				}
				common = append(common, t)
				if df[t] <= dfSpecific {
					score += 3
				} else {
					score++
				}
			}
			for c := range keys {
				if strings.Contains(strings.ToLower(r.Branch), c) {
					hasKey = true
					if !slices.Contains(common, c) {
						common = append(common, c)
					}
				}
			}
			if hasKey {
				score += 5 // la clave de Jira en el nombre de la rama es la señal más fuerte que hay
			}
			// El mínimo es 6, o sea: la clave de Jira de la tarea en el nombre de la rama, o DOS trozos
			// raros compartidos. Con 3 —un solo trozo específico— entraban ramas de canon en tareas de
			// negocio por compartir «logs», «lista» o «crédito»: una palabra sola no identifica nada.
			if score >= 6 {
				cs = append(cs, candidate{r, common, score})
			}
		}
		if len(cs) == 0 {
			noMatches++
			continue
		}
		sort.Slice(cs, func(i, j int) bool {
			if cs[i].score != cs[j].score {
				return cs[i].score > cs[j].score
			}
			return cs[i].r.Date > cs[j].r.Date
		})
		// el patrón propuesto: el trozo compartido más RARO de la mejor candidata
		best, rarity := "", 1<<30
		for _, t := range cs[0].common {
			if df[t] < rarity {
				best, rarity = t, df[t]
			}
		}
		fmt.Printf("  #%d %s\n", e.ID, e.Title)
		if best != "" {
			fmt.Printf("     ramas: %s        ← candidato (aparece en %d rama(s) de todo el universo)\n", best, df[best])
		}
		seen := map[string]bool{}
		shown := 0
		for _, c := range cs {
			k := c.r.Repo + "/" + c.r.Branch
			if seen[k] {
				continue // la misma rama remota y local: se muestra una vez
			}
			seen[k] = true
			if shown == 5 {
				fmt.Printf("       … y %d más\n", len(cs)-shown)
				break
			}
			shown++
			fmt.Printf("       %s  %-20s %-52s [%s]\n", c.r.Date, c.r.Repo, c.r.Branch, strings.Join(c.common, " "))
		}
		fmt.Println()
	}
	fmt.Printf("  %d tarea(s) sin `ramas:` no se parecen a ninguna rama — probablemente todavía no tienen código.\n\n", noMatches)
}

func printReport(snap store.BranchSnapshot, titles map[string]string) {
	slugs := make([]string, 0, len(snap.Tasks))
	for s := range snap.Tasks {
		slugs = append(slugs, s)
	}
	sort.Strings(slugs)

	fmt.Printf("Ramas por tarea · medido %s\n", snap.MeasuredAt)
	for _, id := range slugs {
		t := snap.Tasks[id]
		fmt.Printf("\n  #%s  %s\n", id, titles[id])
		fmt.Printf("  patrón: %s\n", t.Pattern)
		if len(t.Branches) == 0 {
			fmt.Println("    (ninguna rama remota matchea — ¿está pusheada?)")
			continue
		}
		for _, r := range t.Branches {
			// Se listan los ambientes donde YA está y los que faltan, por separado: "está en develop"
			// y "no está en main" son las dos mitades de la respuesta y leerlas juntas confunde.
			var en, missing []string
			envs := make([]string, 0, len(r.Own))
			for a := range r.Own {
				envs = append(envs, a)
			}
			sort.Strings(envs)
			for _, a := range envs {
				if r.In[a] {
					en = append(en, a)
				} else {
					missing = append(missing, a)
				}
			}
			// «(local)» importa: en las MERGEADAS la remota se borra al aprobar el PR, así que una rama
			// local no significa "sin pushear" — los ambientes de abajo dicen cuál de las dos es.
			mark := ""
			if r.Local {
				mark = "  (local)"
			}
			fmt.Printf("    %-22s %-46s %s%s\n", r.Repo, r.Branch, r.Commit, mark)
			if len(en) > 0 {
				fmt.Printf("      ✅ el cambio ya está en: %s\n", strings.Join(en, ", "))
			}
			if len(missing) > 0 {
				fmt.Printf("      ⧗ falta en:              %s\n", strings.Join(missing, ", "))
			}
			// El PR es la mitad que git no sabe: contesta «¿por qué esto no avanza?». Un OPEN con
			// REVIEW_REQUIRED dice "nadie lo miró", que es distinto de "falta trabajo".
			if pr := r.PR; pr != nil {
				extra := ""
				switch {
				case pr.Draft:
					extra = " · borrador"
				case pr.State == "OPEN" && pr.Revision == "APPROVED":
					extra = " · aprobado, listo para mergear"
				case pr.State == "OPEN" && pr.Revision == "CHANGES_REQUESTED":
					extra = " · piden cambios"
				case pr.State == "OPEN" && pr.Revision == "REVIEW_REQUIRED":
					extra = " · esperando revisión"
				case pr.State == "OPEN":
					extra = " · sin revisor pedido"
				case pr.State == "MERGED" && pr.Merged != "":
					extra = " · " + pr.Merged[:10]
				}
				fmt.Printf("      ⇢ PR #%d → %s   %s%s\n", pr.Number, pr.Base, pr.State, extra)
			} else {
				fmt.Printf("      ⇢ sin PR\n")
			}
		}
	}
}
