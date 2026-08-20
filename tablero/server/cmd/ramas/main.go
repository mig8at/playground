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

	// 90s para 13 repos × N ramas × 4 ambientes: si se pasa, es que algo está bloqueado y conviene
	// devolver lo medido hasta ahí antes que colgar a quien está esperando en la terminal.
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	snap := store.MedirRamas(ctx, *root, patrones, nil)
	cacheDir := filepath.Join(dataDir, "cache")
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
			fmt.Printf("    %-22s %-46s %s\n", r.Repo, r.Rama, r.Commit)
			if len(en) > 0 {
				fmt.Printf("      ✅ el cambio ya está en: %s\n", strings.Join(en, ", "))
			}
			if len(falta) > 0 {
				fmt.Printf("      ⧗ falta en:              %s\n", strings.Join(falta, ", "))
			}
		}
	}
}
