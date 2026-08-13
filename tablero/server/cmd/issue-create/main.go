// Command issue-create crea una tarea en Jira, la mete al sprint activo del board y —si se piden—
// le pone Story Points y la mueve a un estado. Reutiliza el cliente y las credenciales del tablero
// (ATLASSIAN_* del .env), sin depender del server en ejecución.
//
// Existe porque el camino del server (el botón con vista previa) crea y mete al sprint pero **no
// puede estimar**: `CreateIssueParams` no tenía campo de puntos. Por consola hace falta cuando la
// tarea ya está escrita y revisada, y lo único que queda es publicarla.
//
// Uso:
//
//	go run ./cmd/issue-create <archivo.json>
//
// donde el JSON es:
//
//	{
//	  "summary":     "título",
//	  "description": "cuerpo en markdown simple (se convierte a ADF)",
//	  "points":      3,            // opcional
//	  "status":      ["progreso","prueba"],  // opcional: SUBCADENAS de estados, EN ORDEN. El workflow de
//	                                         // CORE no deja saltar: para pruebas hay que pasar por progreso.
//	  "sprint":      true          // opcional (default true): meter al sprint activo
//	}
//
// ⚠ ESCRIBE EN JIRA Y NOTIFICA AL EQUIPO. Imprime el payload y pide confirmación explícita salvo
// que se pase `-y`: publicar una tarjeta al sprint activo no es una operación que convenga hacer
// por accidente, y el protocolo del tablero es que nada se publica sin verlo antes.
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"strings"

	"creditop/tablero/server/internal/atlassian"
	"creditop/tablero/server/internal/env"
	"creditop/tablero/server/internal/guard"
)

func envDefault(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

// comoLista acepta `"status"` como texto o como LISTA de textos.
//
// La lista no es un lujo: el workflow de CORE **no permite saltar** estados. Una tarea nace en «Por
// hacer» y desde ahí solo sale a «En progreso» o «Invalidada» — pedirle «pruebas» directo falla con
// «no sale a prueba; solo a: 🚧 En progreso, ❌ Invalidada». Así que para dejarla en pruebas hay que
// pasar por el medio: ["progreso", "prueba"]. Medido creando CORE-420 el 2026-08-13.
func comoLista(v any) ([]string, error) {
	switch x := v.(type) {
	case nil:
		return nil, nil
	case string:
		if strings.TrimSpace(x) == "" {
			return nil, nil
		}
		return []string{x}, nil
	case []any:
		out := make([]string, 0, len(x))
		for _, e := range x {
			s, ok := e.(string)
			if !ok {
				return nil, fmt.Errorf("la lista debe ser de textos, encontré %T", e)
			}
			if strings.TrimSpace(s) != "" {
				out = append(out, s)
			}
		}
		return out, nil
	default:
		return nil, fmt.Errorf("debe ser texto o lista de textos, no %T", v)
	}
}

func main() {
	log.SetFlags(0)
	yes := flag.Bool("y", false, "no preguntar antes de publicar")
	flag.Parse()

	if flag.NArg() < 1 {
		log.Fatal("uso: issue-create [-y] <archivo.json con {summary,description,points,status,sprint}>")
	}
	raw, err := os.ReadFile(flag.Arg(0))
	if err != nil {
		log.Fatalf("leyendo %s: %v", flag.Arg(0), err)
	}

	var in struct {
		Summary     string   `json:"summary"`
		Description string   `json:"description"`
		Points      *float64 `json:"points"`
		Status      any      `json:"status"`
		Sprint      *bool    `json:"sprint"`
	}
	if err := json.Unmarshal(raw, &in); err != nil {
		log.Fatalf("json inválido: %v", err)
	}
	if strings.TrimSpace(in.Summary) == "" {
		log.Fatal("falta 'summary' en el JSON")
	}
	estados, err := comoLista(in.Status)
	if err != nil {
		log.Fatalf("'status': %v", err)
	}
	alSprint := in.Sprint == nil || *in.Sprint

	// El MISMO guard que aplica la UI y el POST del server: lo que sale del playground no puede
	// nombrar repos, rutas de archivo ni hallazgos internos. Un camino de publicación sin guard es un
	// agujero en el control, y por consola es más fácil olvidarse que en un formulario.
	if v := guard.Violations(in.Summary + "\n" + in.Description); len(v) > 0 {
		log.Printf("el texto no es publicable — %d regla(s) rota(s):", len(v))
		for _, x := range v {
			log.Printf("  · %s → %q", x["what"], x["found"])
		}
		log.Fatal("corregí el texto y volvé a correr (nada se creó)")
	}

	env.LoadDefaults()
	site, email, token := os.Getenv("ATLASSIAN_SITE"), os.Getenv("ATLASSIAN_EMAIL"), os.Getenv("ATLASSIAN_API_TOKEN")
	if site == "" || email == "" || token == "" {
		log.Fatal("faltan credenciales ATLASSIAN_* (revisá server/.env)")
	}
	project := envDefault("JIRA_PROJECT_KEY", "CORE")
	typeID := envDefault("JIRA_TASK_TYPE_ID", "10005")
	boardID := 384
	if v := os.Getenv("JIRA_BOARD_ID"); v != "" {
		if _, err := fmt.Sscanf(v, "%d", &boardID); err != nil {
			log.Fatalf("JIRA_BOARD_ID inválido: %q", v)
		}
	}

	ctx := context.Background()
	c := atlassian.New(site, email, token)

	me, err := c.GetMyself(ctx)
	if err != nil {
		log.Fatalf("no pude resolver quién soy en Jira: %v", err)
	}

	// El sprint se resuelve ANTES de crear: si el board no tiene sprint activo, mejor enterarse
	// ahora que dejar la tarjeta creada y huérfana del sprint.
	var sprint *atlassian.Sprint
	if alSprint {
		if sprint, err = c.ActiveSprint(ctx, boardID); err != nil {
			log.Fatalf("buscando el sprint activo del board %d: %v", boardID, err)
		}
		if sprint == nil {
			log.Fatalf("el board %d no tiene sprint activo — corré con \"sprint\": false si querés dejarla en el backlog", boardID)
		}
	}

	fmt.Fprintf(os.Stderr, "\n  Va a CREARSE en Jira (%s) y le llega al equipo:\n\n", site)
	fmt.Fprintf(os.Stderr, "    proyecto    %s · tipo %s · asignada a %s\n", project, typeID, me.DisplayName)
	if sprint != nil {
		fmt.Fprintf(os.Stderr, "    sprint      %s\n", sprint.Name)
	} else {
		fmt.Fprintf(os.Stderr, "    sprint      (ninguno: queda en el backlog)\n")
	}
	if in.Points != nil {
		fmt.Fprintf(os.Stderr, "    puntos      %g\n", *in.Points)
	}
	if len(estados) > 0 {
		fmt.Fprintf(os.Stderr, "    estado      → %s\n", strings.Join(estados, " → "))
	}
	fmt.Fprintf(os.Stderr, "    título      %s\n", in.Summary)
	fmt.Fprintf(os.Stderr, "    descripción %d caracteres\n\n", len(in.Description))

	if !*yes {
		fmt.Fprint(os.Stderr, "  ¿Publico? [escribí \"si\"]: ")
		linea, _ := bufio.NewReader(os.Stdin).ReadString('\n')
		if r := strings.ToLower(strings.TrimSpace(linea)); r != "si" && r != "sí" {
			log.Fatal("cancelado, no se creó nada")
		}
	}

	created, err := c.CreateIssue(ctx, atlassian.CreateIssueParams{
		ProjectKey:  project,
		Summary:     strings.TrimSpace(in.Summary),
		IssueTypeID: typeID,
		AssigneeID:  me.AccountID,
		Description: strings.TrimSpace(in.Description),
		Points:      in.Points,
	})
	if err != nil {
		log.Fatalf("create ERROR: %v", err)
	}
	log.Printf("✓ creada %s", created.Key)

	// De acá en adelante, best-effort y ruidoso: la tarjeta YA existe, así que un fallo se reporta
	// pero no se presenta como si no se hubiera creado nada.
	if sprint != nil {
		if err := c.AddIssuesToSprint(ctx, sprint.ID, []string{created.Key}); err != nil {
			log.Printf("⚠ %s quedó creada pero NO entró al sprint %q: %v", created.Key, sprint.Name, err)
		} else {
			log.Printf("✓ %s al sprint %s", created.Key, sprint.Name)
		}
	}

	// En orden y cortando al primer fallo: si un paso intermedio no se pudo aplicar, seguir pidiendo
	// los siguientes solo produce errores en cascada que esconden el primero, que es el que importa.
	for _, destino := range estados {
		tr, err := c.FindTransitionTo(ctx, created.Key, destino)
		if err != nil {
			log.Printf("⚠ %s se quedó antes de %q: %v", created.Key, destino, err)
			break
		}
		if err := c.TransitionIssue(ctx, created.Key, tr.ID); err != nil {
			log.Printf("⚠ %s: la transición a %q falló: %v", created.Key, tr.To, err)
			break
		}
		log.Printf("✓ %s → %s", created.Key, tr.To)
	}

	fmt.Printf("%s\n", created.Key)
	if site != "" {
		log.Printf("  %s/browse/%s", strings.TrimRight(site, "/"), created.Key)
	}
}
