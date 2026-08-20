// Command web es el servidor de la herramienta personal.
//
// Levanta un WebSocket y, por ahora, saluda con "hola mundo". Además acepta un
// mensaje {type:"send_slack", text:"..."} y lo publica en el canal de pruebas
// de Slack (reutiliza el cliente interno que usan los conectores MCP).
// Al arrancar imprime "server on".
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/coder/websocket"

	"creditop/tablero/server/internal/atlassian"
	"creditop/tablero/server/internal/env"
	"creditop/tablero/server/internal/guard"
	"creditop/tablero/server/internal/pulso"
	"creditop/tablero/server/internal/slack"
	"creditop/tablero/server/internal/store"
)

// ── guard: lo que se registra termina en Jira, y no puede filtrar el playground ─────────────────
// Los patrones se movieron a `internal/guard` para que sigan siendo UNA sola fuente ahora que
// también los necesita `cmd/issue-create` (publicar por consola sin el guard sería un agujero en el
// control, y copiarlos acá era la tercera copia que este comentario venía advirtiendo).
// El POST los sigue re-aplicando antes de escribir. `/api/guard` queda expuesto pero sin consumidor:
// la UI no los compila, manda el POST y muestra los `problems` que vuelven.

// issueKeyRe valida una clave de issue antes de interpolarla en un JQL o en una URL de Jira.
var issueKeyRe = regexp.MustCompile(`^[A-Z][A-Z0-9]+-\d+$`)

// ── traer de Jira ───────────────────────────────────────────────────────────────────────────────
// La JQL del cruce: por ASIGNACIÓN (no por sprint, que es la ventana angosta del resto del tablero) y
// acotada al PROYECTO del tablero — el mismo `JIRA_PROJECT_KEY` donde crea las tareas, CORE.
//
// El proyecto acota a propósito: a mi nombre quedaron 42 tareas de LO, el tablero anterior que ya no se
// usa, y ofrecerlas cada vez que uno abre el cruce es ruido permanente sobre trabajo que no va a volver.
// Para mirar otro proyecto alguna vez está `?jql=` (por ejemplo `project = QC AND assignee =
// currentUser()`), sin tener que tocar la configuración.
//
// `ORDER BY updated DESC` pone arriba lo que se movió hace poco, que es lo que uno reconoce.
func jqlMias(project string, incluirTerminadas bool) string {
	jql := fmt.Sprintf("assignee = currentUser() AND project = %q", project)
	if !incluirTerminadas {
		jql += " AND statusCategory != Done"
	}
	return jql + " ORDER BY updated DESC"
}

// palabrasRe parte un título en palabras, ignorando puntuación y comillas.
var palabrasRe = regexp.MustCompile(`[^\p{L}\p{N}]+`)

// parecido mide cuánto se parecen dos títulos: palabras compartidas sobre palabras totales (Jaccard),
// entre 0 y 1.
//
// No es difuso ni inteligente, y no hace falta que lo sea: los casos que importan son las tareas que
// este tablero redactó y publicó en Jira, donde el título viajó TAL CUAL y el parecido da ~1. Un
// umbral (0.5 en el handler) alcanza para pescarlas y no molestar con coincidencias flojas — la
// decisión de enlazar la toma Miguel, esto solo la propone.
func parecido(a, b string) float64 {
	tok := func(s string) map[string]bool {
		out := map[string]bool{}
		for _, p := range palabrasRe.Split(strings.ToLower(s), -1) {
			// las palabras de 2 letras o menos son conectores (de, la, el, en): suman ruido
			if len([]rune(p)) > 2 {
				out[p] = true
			}
		}
		return out
	}
	x, y := tok(a), tok(b)
	if len(x) == 0 || len(y) == 0 {
		return 0
	}
	comunes := 0
	for p := range x {
		if y[p] {
			comunes++
		}
	}
	return float64(comunes) / float64(len(x)+len(y)-comunes)
}

// comillas envuelve cada clave en comillas dobles para armar un `key in (...)` de JQL. Las claves ya
// pasaron issueKeyRe, así que no hay nada que escapar.
func comillas(keys []string) []string {
	out := make([]string, len(keys))
	for i, k := range keys {
		out[i] = `"` + k + `"`
	}
	return out
}

// cuerpoImportado redacta el cuerpo de una tarea traída de Jira.
//
// El texto de Jira va en la parte PRIVADA (arriba), no bajo `## Tarea (publicable)`, por dos razones.
// Una: ya está publicado — el borrador publicable existe para las tareas que NACEN acá. Dos: las
// descripciones traen rutas de archivo y nombres de repo que el guard rechaza (CORE-159 trae una ruta
// .php), así que ponerlo abajo haría que guardar una tarea importada desde la UI fallara por un texto
// que nadie escribió acá — un muro sin culpable.
func cuerpoImportado(d atlassian.IssueDetail, hoy string) string {
	var b strings.Builder
	fmt.Fprintf(&b, "# %s\n\n", d.Summary)

	fmt.Fprintf(&b, "> Traída de Jira el %s · **%s** · `%s` · creada %s · actualizada %s\n",
		hoy, d.Key, d.Status, d.Created, d.Updated)
	if d.Reporter != "" {
		fmt.Fprintf(&b, "> · la reporta %s\n", d.Reporter)
	}
	if len(d.Sprints) > 0 {
		fmt.Fprintf(&b, "> · sprints: %s\n", strings.Join(d.Sprints, ", "))
	}
	b.WriteString(">\n")
	b.WriteString("> Abajo está lo que hoy dice Jira, tal cual. **Lo que averigües va acá arriba**:\n")
	b.WriteString("> decisiones, riesgos, preguntas abiertas. Si al mergear algo sigue siendo cierto del\n")
	b.WriteString("> sistema, gradúa al nodo de contexto y esta tarea se archiva.\n\n")

	b.WriteString("## Lo que dice Jira\n\n")
	desc := strings.TrimSpace(d.Description)
	if desc == "" {
		b.WriteString("_El issue no tiene descripción en Jira._\n")
		return b.String()
	}
	// Si el texto de Jira trajera la marca del guard, la frontera del archivo se movería y lo de
	// abajo pasaría a ser publicable sin que nadie lo decidiera. Se desarma dejándola visible.
	desc = strings.ReplaceAll(desc, store.SECCION, "## Tarea (según Jira)")
	b.WriteString(desc + "\n")
	return b.String()
}

// violations devuelve qué reglas rompe una nota (vacío = publicable). Delega en `internal/guard`,
// que es la fuente única compartida con `cmd/issue-create`.
func violations(note string) []map[string]string { return guard.Violations(note) }

type app struct {
	slack       *slack.Client     // bot token (xoxb-): mensajes "como CrediBot"
	userSlack   *slack.Client     // user token (xoxp-): mensajes "como yo"
	jira        *atlassian.Client // Jira Cloud (crear tareas)
	st          *store.Store      // SQLite: bitácora + snapshots de sprints/tareas
	testChannel string            // canal de pruebas para el botón "enviar mensaje"

	jiraSite    string // https://<site>.atlassian.net (para armar el link del issue)
	myAccountID string // accountId del usuario Jira autenticado (asignado por defecto)
	jiraProject string // clave del proyecto (ej CORE)
	jiraTypeID  string // id del tipo de issue (ej 10005 = Tarea en CORE)
	jiraBoardID int    // board cuyo sprint activo recibe la tarea (ej 384)

	qaEmail       string // email de quien valida: recibe el DM cuando la tarea pasa a pruebas
	testingStatus string // subcadena del estado "listo para probar"; en CORE es "🧪 En pruebas"

	dataDir string // raíz de `data/`: de ahí sale el snapshot de ramas (data/cache/ramas.json)
}

func main() {
	log.SetFlags(0)
	log.SetPrefix("[web] ")

	env.LoadDefaults()

	a := &app{
		testChannel: envDefault("SLACK_TEST_CHANNEL", "C0BG5GP5JN7"),
		jiraSite:    os.Getenv("ATLASSIAN_SITE"),
		jiraProject: envDefault("JIRA_PROJECT_KEY", "CORE"),
		jiraTypeID:  envDefault("JIRA_TASK_TYPE_ID", "10005"),
		jiraBoardID: atoiDefault(os.Getenv("JIRA_BOARD_ID"), 384),
		qaEmail:     envDefault("QA_SLACK_EMAIL", "duncan.estrada@creditop.com"),
		// Subcadena, no el nombre exacto: en CORE el estado se llama "🧪 En pruebas" (con emoji) y
		// NO existe "En revisión". Matchear por subcadena evita cablear el emoji y sobrevive a que
		// alguien lo cambie en el workflow.
		testingStatus: envDefault("JIRA_TESTING_STATUS", "pruebas"),
	}
	if token := os.Getenv("SLACK_BOT_TOKEN"); token != "" {
		a.slack = slack.New(token)
	}
	if token := os.Getenv("SLACK_USER_TOKEN"); token != "" {
		a.userSlack = slack.New(token)
	}
	if site, email, token := os.Getenv("ATLASSIAN_SITE"), os.Getenv("ATLASSIAN_EMAIL"), os.Getenv("ATLASSIAN_API_TOKEN"); site != "" && email != "" && token != "" {
		a.jira = atlassian.New(site, email, token)
	}

	// La bitácora es el corazón de la herramienta: sin persistencia no arranca (mejor un error claro
	// acá que una UI que parece guardar y pierde todo). Ahora son ARCHIVOS y viven FUERA de server/: si
	// el server algún día se reduce a un proxy de Jira/Slack, los datos no pueden vivir dentro de él.
	// El default es relativo al cwd (npm corre el server desde server/, o sea ../data); TABLERO_DATA lo pisa.
	dataDir := envDefault("TABLERO_DATA", filepath.Join("..", "data"))
	st, err := store.Open(dataDir)
	if err != nil {
		log.Fatalf("no se pudo abrir el directorio de datos: %v", err)
	}
	a.st = st
	a.dataDir = dataDir

	integrations := a.connectIntegrations()

	port := envDefault("WEB_PORT", "8787")

	mux := http.NewServeMux()
	mux.HandleFunc("/ws", a.handleWS)
	mux.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) { w.Write([]byte("ok")) })

	// PROTOTIPOS de las tareas: `data/artifacts/<slug>.html`, servidos tal cual para que el botón
	// «play» del tablero los abra en una pestaña. Los sirve este server y no uno aparte a propósito:
	// un prototipo que necesita levantar su propio puerto deja de abrirse, y entonces no se mira.
	mux.Handle("/artifacts/", http.StripPrefix("/artifacts/",
		http.FileServer(http.Dir(filepath.Join(dataDir, store.ArtifactsDir)))))

	// Sprint + mis tareas, en JSON. Existe para el tablero: el WS sirve el dashboard viejo, pero para
	// prototipar alcanza con un GET y evita cablear mensajes nuevos por cada campo.
	//
	//   /api/sprints?board=&n=3   → los n sprints más recientes (para el selector)
	//   /api/sprint?board=&id=    → un sprint y mis tareas; sin `id`, el activo
	mux.HandleFunc("/api/sprints", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("content-type", "application/json")
		w.Header().Set("access-control-allow-origin", "*")
		if a.jira == nil {
			json.NewEncoder(w).Encode(map[string]any{"error": "sin credenciales de Jira (.env)"})
			return
		}
		board := atoiDefault(r.URL.Query().Get("board"), a.jiraBoardID)
		sps, err := a.jira.RecentSprints(r.Context(), board, atoiDefault(r.URL.Query().Get("n"), 3))
		if err != nil {
			json.NewEncoder(w).Encode(map[string]any{"error": err.Error(), "board": board})
			return
		}
		for _, sp := range sps { // navegar el tablero ES la sincronización de dimensiones
			_ = a.st.SaveSprint(int64(sp.ID), board, sp.Name, sp.State, sp.StartDate, sp.EndDate)
		}
		json.NewEncoder(w).Encode(map[string]any{"sprints": sps, "board": board, "site": strings.TrimRight(a.jiraSite, "/")})
	})

	mux.HandleFunc("/api/sprint", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("content-type", "application/json")
		w.Header().Set("access-control-allow-origin", "*")
		if a.jira == nil {
			json.NewEncoder(w).Encode(map[string]any{"error": "sin credenciales de Jira (.env)"})
			return
		}
		board := atoiDefault(r.URL.Query().Get("board"), a.jiraBoardID)

		var sp *atlassian.Sprint
		var err error
		if id := atoiDefault(r.URL.Query().Get("id"), 0); id > 0 {
			sp, err = a.jira.SprintByID(r.Context(), id)
		} else {
			sp, err = a.jira.DefaultSprint(r.Context(), board) // activo, o el próximo, o el último cerrado
		}
		if err != nil {
			json.NewEncoder(w).Encode(map[string]any{"error": err.Error(), "board": board})
			return
		}
		iss, err := a.jira.MySprintIssues(r.Context(), sp.ID)
		if err != nil {
			json.NewEncoder(w).Encode(map[string]any{"error": err.Error(), "sprint": sp})
			return
		}
		// snapshot de dimensiones para el análisis local (JOINs sin depender de Jira)
		_ = a.st.SaveSprint(int64(sp.ID), board, sp.Name, sp.State, sp.StartDate, sp.EndDate)
		for _, it := range iss {
			var pts *float64
			if it.HasPoints {
				p := it.Points
				pts = &p
			}
			_ = a.st.SaveTask(it.Key, it.Summary, pts, it.Status, it.StatusCategory, int64(sp.ID))
		}
		// `site` va en la respuesta para que el front arme el link a la tarea sin hardcodear el sitio:
		// la URL de Jira sale del .env del server, que es donde ya vive esa verdad.
		json.NewEncoder(w).Encode(map[string]any{"sprint": sp, "issues": iss, "board": board, "site": strings.TrimRight(a.jiraSite, "/")})
	})

	// ── bitácora (SQLite) ───────────────────────────────────────────────────────────────────────
	// GET  /api/entries?days=30&sprint=ID → ventana de días ∪ sprint (el mapa mira por fecha, la
	//                                       bitácora por sprint; una sola llamada sirve a ambos)
	// POST /api/entries                   → crea; 422 si la nota viola el guard
	// DELETE /api/entries/{id}            → borrado suave
	mux.HandleFunc("/api/guard", func(w http.ResponseWriter, _ *http.Request) {
		cors(w)
		json.NewEncoder(w).Encode(map[string]any{"patterns": guard.Patterns})
	})

	// GET  /api/settings → flags del tablero (trackTime, trackPoints); PUT actualiza los que vengan
	mux.HandleFunc("/api/settings", func(w http.ResponseWriter, r *http.Request) {
		cors(w)
		switch r.Method {
		case http.MethodOptions:
			return
		case http.MethodGet:
			st, err := a.st.Settings()
			if err != nil {
				json.NewEncoder(w).Encode(map[string]any{"error": err.Error()})
				return
			}
			json.NewEncoder(w).Encode(st)
		case http.MethodPut:
			var in map[string]bool
			if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
				w.WriteHeader(http.StatusBadRequest)
				json.NewEncoder(w).Encode(map[string]any{"error": "JSON inválido"})
				return
			}
			for k, v := range in {
				if err := a.st.SetSetting(k, v); err != nil {
					w.WriteHeader(http.StatusUnprocessableEntity)
					json.NewEncoder(w).Encode(map[string]any{"error": err.Error()})
					return
				}
			}
			st, _ := a.st.Settings()
			json.NewEncoder(w).Encode(st)
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	})

	// RAMAS de las tareas: el SNAPSHOT que dejó `make tareas-ramas`, tal cual. No se mide acá a
	// propósito — son varias invocaciones de git por repo y hacerlo en cada render haría lenta la
	// card. Por eso viaja con `medidoEn`: la card muestra la antigüedad y el humano decide si re-medir.
	// Si no hay snapshot devuelve vacío, que no es un error: no haber medido todavía es normal.
	mux.HandleFunc("/api/ramas", func(w http.ResponseWriter, r *http.Request) {
		cors(w)
		if r.Method == http.MethodOptions {
			return
		}
		json.NewEncoder(w).Encode(store.LeerSnapshotRamas(filepath.Join(a.dataDir, "cache")))
	})

	// esfuerzos privados (agrupan tareas). GET lista · POST crea {title}. El título es privado → sin guard.
	mux.HandleFunc("/api/efforts", func(w http.ResponseWriter, r *http.Request) {
		cors(w)
		switch r.Method {
		case http.MethodOptions:
			return
		case http.MethodGet:
			efforts, err := a.st.Efforts()
			if err != nil {
				json.NewEncoder(w).Encode(map[string]any{"error": err.Error()})
				return
			}
			json.NewEncoder(w).Encode(map[string]any{"efforts": efforts})
		case http.MethodPost:
			var in struct {
				Title string `json:"title"`
			}
			if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
				w.WriteHeader(http.StatusBadRequest)
				json.NewEncoder(w).Encode(map[string]any{"error": "JSON inválido"})
				return
			}
			in.Title = strings.TrimSpace(in.Title)
			if in.Title == "" {
				w.WriteHeader(http.StatusUnprocessableEntity)
				json.NewEncoder(w).Encode(map[string]any{"error": "el esfuerzo necesita un nombre"})
				return
			}
			e, err := a.st.CreateEffort(in.Title)
			if err != nil {
				w.WriteHeader(http.StatusInternalServerError)
				json.NewEncoder(w).Encode(map[string]any{"error": err.Error()})
				return
			}
			json.NewEncoder(w).Encode(map[string]any{"effort": e})
		case http.MethodPut: // guardar el BORRADOR de la tarea de Jira sobre un esfuerzo
			var in struct {
				ID              int64   `json:"id"`
				JiraTitle       *string `json:"jiraTitle"`
				JiraDescription *string `json:"jiraDescription"`
				TechNotes       *string `json:"techNotes"`    // privado: NO pasa por el guard
				ContextNodes    *string `json:"contextNodes"` // slugs de nodos de contexto
				Stage           *string `json:"stage"`        // evaluation | work | tasks
			}
			if err := json.NewDecoder(r.Body).Decode(&in); err != nil || in.ID == 0 {
				w.WriteHeader(http.StatusBadRequest)
				json.NewEncoder(w).Encode(map[string]any{"error": "JSON inválido o sin id"})
				return
			}
			// título y descripción TERMINAN EN JIRA → mismo guard que las notas
			var borrador string
			if in.JiraTitle != nil {
				borrador += *in.JiraTitle + "\n"
			}
			if in.JiraDescription != nil {
				borrador += *in.JiraDescription
			}
			if v := violations(borrador); v != nil {
				w.WriteHeader(http.StatusUnprocessableEntity)
				json.NewEncoder(w).Encode(map[string]any{"error": "el borrador viola el guard", "problems": v})
				return
			}
			// el detalle técnico es PRIVADO (nunca va a Jira) → sin guard. Los campos que no vengan
			// quedan intactos (COALESCE en el store), así guardar uno no borra el otro.
			if in.TechNotes != nil || in.ContextNodes != nil {
				if err := a.st.SaveEffortTech(in.ID, in.TechNotes, in.ContextNodes); err != nil {
					w.WriteHeader(http.StatusUnprocessableEntity)
					json.NewEncoder(w).Encode(map[string]any{"error": err.Error()})
					return
				}
			}
			if in.Stage != nil {
				if err := a.st.SetEffortStage(in.ID, *in.Stage); err != nil {
					w.WriteHeader(http.StatusUnprocessableEntity)
					json.NewEncoder(w).Encode(map[string]any{"error": err.Error()})
					return
				}
			}
			if in.JiraTitle != nil || in.JiraDescription != nil {
				if err := a.st.SaveEffortDraft(in.ID, in.JiraTitle, in.JiraDescription); err != nil {
					w.WriteHeader(http.StatusUnprocessableEntity)
					json.NewEncoder(w).Encode(map[string]any{"error": err.Error()})
					return
				}
			}
			efforts, _ := a.st.Efforts()
			json.NewEncoder(w).Encode(map[string]any{"efforts": efforts})
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	})

	// todas las capas locales (para agrupar el listado por esfuerzo sin pedir tarea por tarea)
	mux.HandleFunc("/api/task-locals", func(w http.ResponseWriter, _ *http.Request) {
		cors(w)
		tls, err := a.st.AllTaskLocals()
		if err != nil {
			json.NewEncoder(w).Encode(map[string]any{"error": err.Error()})
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"taskLocals": tls})
	})

	// capa local privada de una tarea (estado real, definición, estimado). GET ?key= · PUT con el body.
	mux.HandleFunc("/api/task", func(w http.ResponseWriter, r *http.Request) {
		cors(w)
		switch r.Method {
		case http.MethodOptions:
			return
		case http.MethodGet:
			key := r.URL.Query().Get("key")
			if key == "" {
				w.WriteHeader(http.StatusBadRequest)
				json.NewEncoder(w).Encode(map[string]any{"error": "falta key"})
				return
			}
			tl, err := a.st.GetTaskLocal(key)
			if err != nil {
				json.NewEncoder(w).Encode(map[string]any{"error": err.Error()})
				return
			}
			json.NewEncoder(w).Encode(tl)
		case http.MethodPut:
			var tl store.TaskLocal
			if err := json.NewDecoder(r.Body).Decode(&tl); err != nil || tl.TaskKey == "" {
				w.WriteHeader(http.StatusBadRequest)
				json.NewEncoder(w).Encode(map[string]any{"error": "JSON inválido o sin taskKey"})
				return
			}
			tl.Definition = strings.TrimSpace(tl.Definition)
			// la definición TERMINA EN JIRA → el mismo guard que las notas. Nada del playground se filtra.
			if v := violations(tl.Definition); v != nil {
				w.WriteHeader(http.StatusUnprocessableEntity)
				json.NewEncoder(w).Encode(map[string]any{"error": "la definición viola el guard", "problems": v})
				return
			}
			saved, err := a.st.SaveTaskLocal(tl)
			if err != nil {
				w.WriteHeader(http.StatusInternalServerError)
				json.NewEncoder(w).Encode(map[string]any{"error": err.Error()})
				return
			}
			json.NewEncoder(w).Encode(saved)
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	})

	// ── traer de Jira: las tareas a mi nombre que el registro local no tiene ────────────────────
	//
	// POR QUÉ EXISTE. El resto del tablero mira el SPRINT del board 384: lo que cae fuera de esa
	// ventana —otro board, un sprint viejo, otro proyecto— no aparece en ninguna vista, así que no
	// había dónde registrarlo ni forma de notar que faltaba. Estas dos rutas preguntan por
	// ASIGNACIÓN, no por sprint, y son la única entrada que CREA una tarea local desde Jira.
	//
	//	GET  /api/jira-inbox[?jql=…][&all=1]  el CRUCE, no escribe nada. Cada issue a mi nombre con
	//	                                      `linkedTo` (en qué archivo ya está) o `suggestion` (el
	//	                                      archivo local que se le parece), para no registrar dos
	//	                                      veces algo que ya está con otro nombre.
	//	POST /api/jira-import                 registra: {"create":["CORE-30"],"link":{"CORE-317":12}}
	//
	// `all=1` incluye las cerradas: el historial también sirve, y nacen archivadas.
	mux.HandleFunc("/api/jira-inbox", func(w http.ResponseWriter, r *http.Request) {
		cors(w)
		if a.jira == nil {
			json.NewEncoder(w).Encode(map[string]any{"error": "Jira no está configurado (falta ATLASSIAN_*)"})
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
		defer cancel()

		jql := strings.TrimSpace(r.URL.Query().Get("jql"))
		if jql == "" {
			jql = jqlMias(a.jiraProject, r.URL.Query().Get("all") == "1")
		}
		issues, err := a.jira.SearchIssuesDetailed(ctx, jql)
		if err != nil {
			w.WriteHeader(http.StatusBadGateway)
			json.NewEncoder(w).Encode(map[string]any{"error": err.Error()})
			return
		}

		vinculadas := a.st.TareasVinculadas()
		efforts := a.st.EffortsAll()
		type ref struct {
			ID    int64   `json:"id"`
			File  string  `json:"file"`
			Title string  `json:"title"`
			Score float64 `json:"score,omitempty"`
		}
		// La lista devuelve SOLO lo que falta. Las que ya están registradas no son una fila con la que
		// se pueda hacer algo —el vínculo ya existe— así que salen como número, no como renglón: la
		// vista es una bandeja de pendientes, y mezclarlas obliga a leer 70 filas para encontrar las 3
		// que importan.
		salida := make([]map[string]any, 0, len(issues))
		registradas := 0
		for _, d := range issues {
			if _, ok := vinculadas[d.Key]; ok {
				registradas++
				continue
			}
			fila := map[string]any{"issue": d}
			// El candidato se busca contra los DOS títulos: el privado (mío) y el publicado en Jira.
			// Los que importan son los segundos —los redactó este tablero y salieron tal cual—, y ahí
			// el parecido es casi 1.
			mejor := ref{}
			for _, e := range efforts {
				for _, t := range []string{e.JiraTitle, e.Title} {
					if sc := parecido(d.Summary, t); sc > mejor.Score {
						mejor = ref{ID: e.ID, File: e.File, Title: e.Title, Score: sc}
					}
				}
			}
			if mejor.Score >= 0.5 {
				fila["suggestion"] = mejor
			}
			salida = append(salida, fila)
		}

		json.NewEncoder(w).Encode(map[string]any{
			"jql": jql, "count": len(issues), "registered": registradas, "pending": len(salida),
			"issues": salida, "efforts": efforts,
			"site": strings.TrimRight(a.jiraSite, "/"),
		})
	})

	mux.HandleFunc("/api/jira-import", func(w http.ResponseWriter, r *http.Request) {
		cors(w)
		switch r.Method {
		case http.MethodOptions:
			return
		case http.MethodPost:
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		if a.jira == nil {
			json.NewEncoder(w).Encode(map[string]any{"error": "Jira no está configurado (falta ATLASSIAN_*)"})
			return
		}
		var in struct {
			Create []string         `json:"create"` // claves que nacen como tarea local nueva
			Link   map[string]int64 `json:"link"`   // clave → id de la tarea local que ya la cubre
			Nodes  string           `json:"nodes"`  // nodos de contexto para las creadas (opcional)
		}
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]any{"error": "JSON inválido"})
			return
		}

		// Las claves se validan ANTES de tocar Jira: van interpoladas en un JQL.
		claves := append([]string{}, in.Create...)
		for k := range in.Link {
			claves = append(claves, k)
		}
		for _, k := range claves {
			if !issueKeyRe.MatchString(k) {
				w.WriteHeader(http.StatusUnprocessableEntity)
				json.NewEncoder(w).Encode(map[string]any{"error": "clave de issue inválida: " + k})
				return
			}
		}
		if len(claves) == 0 {
			w.WriteHeader(http.StatusUnprocessableEntity)
			json.NewEncoder(w).Encode(map[string]any{"error": "no viene ninguna clave"})
			return
		}

		resultados := []map[string]any{}

		// Enlazar no necesita a Jira: la clave ya la conocemos y el vínculo es local.
		for k, id := range in.Link {
			file, err := a.st.VincularTarea(k, id)
			if err != nil {
				resultados = append(resultados, map[string]any{"key": k, "action": "error", "error": err.Error()})
				continue
			}
			log.Printf("jira-import: %s enlazado a %s", k, file)
			resultados = append(resultados, map[string]any{"key": k, "action": "linked", "effortId": id, "file": file})
		}

		// Crear sí: el archivo nace con lo que dice Jira, así que hay que leerlo.
		if len(in.Create) > 0 {
			ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
			defer cancel()
			jql := fmt.Sprintf("key in (%s)", strings.Join(comillas(in.Create), ", "))
			issues, err := a.jira.SearchIssuesDetailed(ctx, jql)
			if err != nil {
				w.WriteHeader(http.StatusBadGateway)
				json.NewEncoder(w).Encode(map[string]any{"error": err.Error(), "results": resultados})
				return
			}
			hoy := time.Now().Format("2006-01-02")
			for _, d := range issues {
				e, creada, err := a.st.ImportarDeJira(store.ImportIssue{
					Key: d.Key, Summary: d.Summary, Body: cuerpoImportado(d, hoy),
					Closed: d.Category == "done", Nodes: in.Nodes,
				})
				if err != nil {
					resultados = append(resultados, map[string]any{"key": d.Key, "action": "error", "error": err.Error()})
					continue
				}
				accion := "created"
				if !creada {
					accion = "already" // ya estaba registrada: el POST es idempotente
				}
				file := ""
				for _, ref := range a.st.EffortsAll() {
					if ref.ID == e.ID {
						file = ref.File
					}
				}
				log.Printf("jira-import: %s %s → %s", d.Key, accion, file)
				resultados = append(resultados, map[string]any{
					"key": d.Key, "action": accion, "effortId": e.ID, "file": file,
					"archived": d.Category == "done",
				})
			}
			// Una clave que Jira no devolvió (borrada, o sin permiso) tiene que decirse: si no, el
			// listado se recarga sin ella y parece que se importó.
			vistas := map[string]bool{}
			for _, d := range issues {
				vistas[d.Key] = true
			}
			for _, k := range in.Create {
				if !vistas[k] {
					resultados = append(resultados, map[string]any{"key": k, "action": "error", "error": "Jira no devolvió este issue"})
				}
			}
		}

		json.NewEncoder(w).Encode(map[string]any{"results": resultados})
	})

	// ── handoff a QA: mover la tarea a pruebas y avisarle a quien valida ────────────────────────
	// La ÚNICA escritura del tablero sobre el estado de una tarea (el resto de la vista es de
	// lectura). Existe porque en la vida real los dos pasos son uno: cuando la tarea queda lista
	// para probar, alguien tiene que enterarse — y separarlos es exactamente lo que hace que el
	// aviso se olvide. Un click hace la transición Y manda el DM.
	//
	//   GET  /api/qa-notice?key=CORE-321 → PREVIEW. No escribe nada: devuelve la transición que se
	//                                      aplicaría, a quién le llega el DM y el texto ya armado
	//                                      (la UI lo deja editar antes de mandar).
	//   POST /api/qa-notice {key, text}  → aplica la transición y manda el DM.
	//
	// El texto pasa por el MISMO guard que la bitácora: sale del tablero hacia Slack, así que no
	// puede filtrar repos, rutas de archivo ni hallazgos internos.
	mux.HandleFunc("/api/qa-notice", func(w http.ResponseWriter, r *http.Request) {
		cors(w)
		if a.jira == nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			json.NewEncoder(w).Encode(map[string]any{"error": "sin credenciales de Jira (.env)"})
			return
		}

		switch r.Method {
		case http.MethodOptions:
			return

		case http.MethodGet:
			key := strings.ToUpper(strings.TrimSpace(r.URL.Query().Get("key")))
			if !issueKeyRe.MatchString(key) {
				w.WriteHeader(http.StatusBadRequest)
				json.NewEncoder(w).Encode(map[string]any{"error": "falta key o no parece una clave de issue (ej CORE-321)"})
				return
			}
			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()

			iss, err := a.jira.SearchIssues(ctx, `key = "`+key+`"`, 1)
			if err != nil || len(iss) == 0 {
				w.WriteHeader(http.StatusNotFound)
				json.NewEncoder(w).Encode(map[string]any{"error": "no pude leer " + key + " en Jira"})
				return
			}
			out := map[string]any{
				"key":     iss[0].Key,
				"summary": iss[0].Summary,
				"status":  iss[0].Status,
				"text":    a.qaNoticeText(iss[0]),
				"email":   a.qaEmail,
			}
			// La transición y el destinatario se resuelven ACÁ, no al mandar: si el estado actual no
			// tiene salida a pruebas o el token de Slack no alcanza, se ve ANTES de escribir nada.
			if tr, err := a.qaTransition(ctx, key); err == nil {
				out["transition"] = map[string]string{"id": tr.ID, "name": tr.Name, "to": tr.To}
			} else {
				out["blocked"] = err.Error()
			}
			if a.userSlack != nil {
				if u, err := a.userSlack.LookupUserByEmail(ctx, a.qaEmail); err == nil {
					out["name"] = u.RealName
				}
			}
			json.NewEncoder(w).Encode(out)

		case http.MethodPost:
			var in struct {
				Key  string `json:"key"`
				Text string `json:"text"`
			}
			if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
				w.WriteHeader(http.StatusBadRequest)
				json.NewEncoder(w).Encode(map[string]any{"error": "JSON inválido"})
				return
			}
			in.Key = strings.ToUpper(strings.TrimSpace(in.Key))
			in.Text = strings.TrimSpace(in.Text)
			if !issueKeyRe.MatchString(in.Key) || in.Text == "" {
				w.WriteHeader(http.StatusBadRequest)
				json.NewEncoder(w).Encode(map[string]any{"error": "faltan key (ej CORE-321) o el texto del aviso"})
				return
			}
			if v := violations(in.Text); v != nil {
				w.WriteHeader(http.StatusUnprocessableEntity)
				json.NewEncoder(w).Encode(map[string]any{"error": "el aviso viola el guard", "problems": v})
				return
			}

			ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
			defer cancel()

			tr, err := a.qaTransition(ctx, in.Key)
			if err != nil {
				w.WriteHeader(http.StatusUnprocessableEntity)
				json.NewEncoder(w).Encode(map[string]any{"error": err.Error()})
				return
			}
			if err := a.jira.TransitionIssue(ctx, in.Key, tr.ID); err != nil {
				w.WriteHeader(http.StatusBadGateway)
				json.NewEncoder(w).Encode(map[string]any{"error": "no se pudo mover en Jira: " + err.Error()})
				return
			}

			// La transición YA ocurrió: si el DM falla, se reporta movida-pero-sin-avisar. Mentir con
			// un 200 pelado dejaría a la tarea en pruebas y a nadie enterado.
			name, posted, err := a.dmAsMe(ctx, a.qaEmail, in.Text)
			if err != nil {
				log.Printf("qa-notice %s: movida a %q pero el DM falló: %v", in.Key, tr.To, err)
				json.NewEncoder(w).Encode(map[string]any{
					"key": in.Key, "moved": tr.To, "sent": false, "error": err.Error(),
				})
				return
			}
			log.Printf("qa-notice %s → %s · DM a %s (ts %s)", in.Key, tr.To, name, posted.TS)
			json.NewEncoder(w).Encode(map[string]any{
				"key": in.Key, "moved": tr.To, "sent": true, "name": name, "ts": posted.TS,
			})

		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	})

	// ── /api/transitions — el MECANISMO DE JIRA, no una lista escrita acá ────────────────────────
	//
	// Antes el tablero tenía un solo movimiento cableado ("a pruebas") y adivinaba que existía. Medido
	// el 2026-08-19 contra el workflow real de CORE: NINGÚN estado avanza a «En pruebas» —la única
	// transición que llega ahí sale de «Terminada» y se llama «Se devuelve a pruebas», o sea es un
	// retorno—. El flujo real es En progreso → En revisión → Terminada. Así que el botón cableado
	// fallaba en todos los estados salvo el que menos sentido tenía.
	//
	// La lección: los estados permitidos NO se escriben acá. Se le preguntan a Jira, que es quien los
	// define y quien los va a cambiar sin avisarnos.
	//
	//   GET  /api/transitions?key=CORE-431 → las transiciones que Jira permite DESDE su estado actual
	//   POST /api/transitions {key, id}    → aplica una. Sin Slack: el aviso a QA sigue en /api/qa-notice,
	//                                        porque ahí mover y avisar son un mismo acto.
	mux.HandleFunc("/api/transitions", func(w http.ResponseWriter, r *http.Request) {
		cors(w)
		if a.jira == nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			json.NewEncoder(w).Encode(map[string]any{"error": "sin credenciales de Jira (.env)"})
			return
		}
		switch r.Method {
		case http.MethodOptions:
			return

		case http.MethodGet:
			key := strings.ToUpper(strings.TrimSpace(r.URL.Query().Get("key")))
			if !issueKeyRe.MatchString(key) {
				w.WriteHeader(http.StatusBadRequest)
				json.NewEncoder(w).Encode(map[string]any{"error": "falta key o no parece una clave de issue (ej CORE-321)"})
				return
			}
			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()
			trs, err := a.jira.IssueTransitions(ctx, key)
			if err != nil {
				w.WriteHeader(http.StatusBadGateway)
				json.NewEncoder(w).Encode(map[string]any{"error": err.Error()})
				return
			}
			out := make([]map[string]string, 0, len(trs))
			for _, t := range trs {
				out = append(out, map[string]string{"id": t.ID, "name": t.Name, "to": t.To})
			}
			// `testing` viaja para que la UI sepa CUÁL de estos destinos merece el aviso a QA, sin
			// tener que repetir la subcadena en el cliente.
			json.NewEncoder(w).Encode(map[string]any{"key": key, "transitions": out, "testing": a.testingStatus})

		case http.MethodPost:
			var in struct {
				Key string `json:"key"`
				ID  string `json:"id"`
			}
			if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
				w.WriteHeader(http.StatusBadRequest)
				json.NewEncoder(w).Encode(map[string]any{"error": "json inválido"})
				return
			}
			in.Key = strings.ToUpper(strings.TrimSpace(in.Key))
			if !issueKeyRe.MatchString(in.Key) || strings.TrimSpace(in.ID) == "" {
				w.WriteHeader(http.StatusBadRequest)
				json.NewEncoder(w).Encode(map[string]any{"error": "hacen falta key e id de la transición"})
				return
			}
			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()
			// Se re-lee la lista antes de aplicar: el id que mandó la UI pudo quedar viejo si alguien
			// movió la tarjeta desde Jira mientras el menú estaba abierto, y un id que ya no aplica da
			// un 400 de Jira difícil de leer. Acá se contesta con el estado real.
			trs, err := a.jira.IssueTransitions(ctx, in.Key)
			if err != nil {
				w.WriteHeader(http.StatusBadGateway)
				json.NewEncoder(w).Encode(map[string]any{"error": err.Error()})
				return
			}
			var elegida *atlassian.Transition
			for i := range trs {
				if trs[i].ID == in.ID {
					elegida = &trs[i]
					break
				}
			}
			if elegida == nil {
				w.WriteHeader(http.StatusConflict)
				json.NewEncoder(w).Encode(map[string]any{
					"error": "esa transición ya no está disponible — alguien movió " + in.Key + " en Jira. Refrescá.",
				})
				return
			}
			if err := a.jira.TransitionIssue(ctx, in.Key, elegida.ID); err != nil {
				w.WriteHeader(http.StatusBadGateway)
				json.NewEncoder(w).Encode(map[string]any{"error": err.Error()})
				return
			}
			log.Printf("transitions %s → %s (%s)", in.Key, elegida.To, elegida.Name)
			json.NewEncoder(w).Encode(map[string]any{"ok": true, "to": elegida.To, "name": elegida.Name})

		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	})

	mux.HandleFunc("/api/entries", func(w http.ResponseWriter, r *http.Request) {
		cors(w)
		switch r.Method {
		case http.MethodOptions: // preflight del browser (POST con JSON desde :5191)
			return
		case http.MethodGet:
			entries, err := a.st.List(atoiDefault(r.URL.Query().Get("days"), 30), int64(atoiDefault(r.URL.Query().Get("sprint"), 0)))
			if err != nil {
				json.NewEncoder(w).Encode(map[string]any{"error": err.Error()})
				return
			}
			json.NewEncoder(w).Encode(map[string]any{"entries": entries})
		case http.MethodPost:
			var in struct {
				Task      string `json:"task"`
				FreeTitle string `json:"freeTitle"`
				SprintID  int64  `json:"sprintId"`
				EffortID  int64  `json:"effortId"` // trabajo que aún no es tarea de Jira: cuelga del esfuerzo
				Kind      string `json:"kind"`
				StartedMs int64  `json:"startedMs"` // epoch ms; 0 = terminó ahora (inicio = ahora − minutos)
				Minutes   int    `json:"minutes"`
				Note      string `json:"note"`
			}
			if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
				w.WriteHeader(http.StatusBadRequest)
				json.NewEncoder(w).Encode(map[string]any{"error": "JSON inválido"})
				return
			}
			in.Note = strings.TrimSpace(in.Note)
			switch {
			case in.Note == "":
				w.WriteHeader(http.StatusUnprocessableEntity)
				json.NewEncoder(w).Encode(map[string]any{"error": "la nota está vacía"})
				return
			case in.Minutes <= 0 || in.Minutes > 720:
				w.WriteHeader(http.StatusUnprocessableEntity)
				json.NewEncoder(w).Encode(map[string]any{"error": "minutos fuera de rango (1–720)"})
				return
			case in.Kind == "" || in.Task == "" && in.FreeTitle == "" && in.EffortID == 0:
				w.WriteHeader(http.StatusUnprocessableEntity)
				json.NewEncoder(w).Encode(map[string]any{"error": "falta tipo, o un ancla (tarea, título o esfuerzo)"})
				return
			}
			// el guard del server es el que VALE: la UI ya bloqueó con los mismos patrones, pero nada
			// sucio puede entrar a la base aunque el cliente se lo salte
			if v := violations(in.Note); v != nil {
				w.WriteHeader(http.StatusUnprocessableEntity)
				json.NewEncoder(w).Encode(map[string]any{"error": "la nota viola el guard", "problems": v})
				return
			}
			started := time.Now().Add(-time.Duration(in.Minutes) * time.Minute)
			if in.StartedMs > 0 {
				started = time.UnixMilli(in.StartedMs)
			}
			entry, err := a.st.Create(in.Task, in.FreeTitle, in.SprintID, in.EffortID, in.Kind, started, in.Minutes, in.Note)
			if err != nil {
				w.WriteHeader(http.StatusInternalServerError)
				json.NewEncoder(w).Encode(map[string]any{"error": err.Error()})
				return
			}
			json.NewEncoder(w).Encode(map[string]any{"entry": entry})
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	})

	mux.HandleFunc("/api/entries/", func(w http.ResponseWriter, r *http.Request) {
		cors(w)
		if r.Method == http.MethodOptions {
			return
		}
		if r.Method != http.MethodDelete {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		id, err := strconv.ParseInt(strings.TrimPrefix(r.URL.Path, "/api/entries/"), 10, 64)
		if err != nil || id <= 0 {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]any{"error": "id inválido"})
			return
		}
		if err := a.st.SoftDelete(id); err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]any{"error": err.Error()})
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"ok": true})
	})

	// El PULSO: cuándo toqué los repos de la compañía, en tramos de 5 minutos. Lo escribe el agente
	// (`cmd/pulso`, un LaunchAgent cada 5'), acá sólo se AGREGA y se sirve — el server no lo genera,
	// porque tiene que registrarse aunque el tablero esté cerrado, que es cuando más se programa.
	//
	//   /api/pulse?days=20 → una celda por (día, hora), con slots, cobertura, commits y desglose por repo
	mux.HandleFunc("/api/pulse", func(w http.ResponseWriter, r *http.Request) {
		cors(w)
		if r.Method == http.MethodOptions {
			return
		}
		days := atoiDefault(r.URL.Query().Get("days"), 20)
		ticks, err := pulso.Read(dataDir, days)
		if err != nil {
			json.NewEncoder(w).Encode(map[string]any{"error": err.Error()})
			return
		}
		// `installed` distingue "no trabajaste" de "nadie estaba mirando": sin un solo tick, la grilla
		// vacía no significa nada y la UI tiene que decirlo en vez de dejarte sacar conclusiones.
		ult, hay := pulso.LastTick(dataDir)
		res := map[string]any{
			"hours":        pulso.Aggregate(ticks, days),
			"slotsPerHour": pulso.SlotsPerHour,
			"slotMinutes":  int(pulso.Slot / time.Minute),
			"installed":    hay,
		}
		if hay {
			res["lastTick"] = ult.Format(time.RFC3339)
		}
		json.NewEncoder(w).Encode(res)
	})

	log.Printf("server on · ws://localhost:%s/ws · integraciones: %s", port, integrations)
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		log.Fatalf("server error: %v", err)
	}
}

// inbound es lo que el frontend puede mandar por el WS.
type inbound struct {
	Type        string `json:"type"`
	Text        string `json:"text"`
	To          string `json:"to"`          // destinatario (email) para un DM
	Summary     string `json:"summary"`     // título de la tarea Jira
	Description string `json:"description"` // descripción de la tarea Jira
	EffortID    int64  `json:"effortId"`    // tarea local que publica: recibe la clave de vuelta
}

func (a *app) handleWS(w http.ResponseWriter, r *http.Request) {
	c, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		OriginPatterns: []string{"*"}, // dev: el frontend corre en :5191
	})
	if err != nil {
		return
	}
	defer c.Close(websocket.StatusNormalClosure, "")

	// Contexto propio de la conexión: r.Context() puede cancelarse tras el
	// hijack del WebSocket, lo que mataría el loop de lectura.
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Saludo inicial.
	send(ctx, c, map[string]any{"type": "hello", "message": "hola mundo"})

	for {
		_, data, err := c.Read(ctx)
		if err != nil {
			return
		}
		var msg inbound
		if json.Unmarshal(data, &msg) != nil {
			continue
		}
		switch msg.Type {
		case "send_slack": // canal de pruebas, como el bot
			a.sendSlack(ctx, c, msg.Text)
		case "dm": // DM a alguien, como yo (user token)
			a.sendDM(ctx, c, msg.To, msg.Text)
		case "create_task": // crear tarea Jira + agregar al sprint activo
			a.createTask(ctx, c, msg.Summary, msg.Description, msg.EffortID)
		case "dashboard": // datos del sprint activo del usuario
			a.dashboard(ctx, c)
		case "activity": // heatmap de actividad por día (estilo GitHub)
			a.activity(ctx, c)
		}
	}
}

// sendSlack publica el texto en el canal de pruebas y responde por el WS.
func (a *app) sendSlack(ctx context.Context, c *websocket.Conn, text string) {
	text = strings.TrimSpace(text)
	if text == "" {
		send(ctx, c, map[string]any{"type": "sent", "ok": false, "error": "el mensaje está vacío"})
		return
	}
	if a.slack == nil {
		send(ctx, c, map[string]any{"type": "sent", "ok": false, "error": "Slack no está configurado (falta SLACK_BOT_TOKEN)"})
		return
	}

	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	posted, err := a.slack.PostMessage(ctx, a.testChannel, text)
	if err != nil {
		log.Printf("send_slack ERROR: %v", err)
		send(ctx, c, map[string]any{"type": "sent", "ok": false, "error": err.Error()})
		return
	}
	log.Printf("send_slack OK → canal %s (ts %s)", posted.Channel, posted.TS)
	send(ctx, c, map[string]any{"type": "sent", "ok": true, "channel": posted.Channel, "ts": posted.TS})
}

// sendDM envía un DM al destinatario (por email) COMO EL USUARIO (user token).
func (a *app) sendDM(ctx context.Context, c *websocket.Conn, to, text string) {
	name, posted, err := a.dmAsMe(ctx, to, text)
	if err != nil {
		log.Printf("dm ERROR: %v", err)
		send(ctx, c, map[string]any{"type": "dm_sent", "ok": false, "error": err.Error()})
		return
	}
	log.Printf("dm OK → %s <%s> (ts %s)", name, to, posted.TS)
	send(ctx, c, map[string]any{"type": "dm_sent", "ok": true, "to": name, "ts": posted.TS})
}

// dmAsMe manda un DM COMO YO (user token xoxp-): busca al destinatario por email, abre el DM y
// publica. Devuelve el nombre real para poder decir a quién le llegó, no solo el email.
//
// Lo comparten el WS ("dm") y el handoff a QA. Va como YO y no como el bot a propósito: un aviso de
// trabajo lo manda una persona; de un bot se lee como notificación automática y se ignora.
func (a *app) dmAsMe(ctx context.Context, to, text string) (string, *slack.PostedMessage, error) {
	to = strings.TrimSpace(to)
	text = strings.TrimSpace(text)
	if to == "" || text == "" {
		return "", nil, fmt.Errorf("faltan destinatario (email) o mensaje")
	}
	if a.userSlack == nil {
		return "", nil, fmt.Errorf("falta SLACK_USER_TOKEN (tu token personal xoxp-)")
	}

	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	user, err := a.userSlack.LookupUserByEmail(ctx, to)
	if err != nil {
		return "", nil, err
	}
	dm, err := a.userSlack.OpenDM(ctx, user.ID)
	if err != nil {
		return "", nil, err
	}
	posted, err := a.userSlack.PostMessage(ctx, dm, text)
	if err != nil {
		return "", nil, err
	}
	return user.RealName, posted, nil
}

// qaTransition envuelve la búsqueda de la transición a pruebas con el estado configurado. La lógica
// vive en el cliente (`FindTransitionTo`) porque issue-transition ya la necesitaba: dos copias del
// "cómo elegir la transición" habrían derivado.
func (a *app) qaTransition(ctx context.Context, key string) (atlassian.Transition, error) {
	return a.jira.FindTransitionTo(ctx, key, a.testingStatus)
}

// qaNoticeText arma el aviso siguiendo la convención del README: DE USTED (no tutear), coloquial,
// corto y con el link. Corto a propósito: el detalle de CÓMO validar ya está en la tarea, y repetirlo
// acá garantiza que las dos versiones se desincronicen.
func (a *app) qaNoticeText(iss atlassian.Issue) string {
	var b strings.Builder
	fmt.Fprintf(&b, "Perrito 🐶 le dejé %s en pruebas.\n\n*%s*\n", iss.Key, iss.Summary)
	if a.jiraSite != "" {
		fmt.Fprintf(&b, "%s/browse/%s\n", strings.TrimRight(a.jiraSite, "/"), iss.Key)
	}
	b.WriteString("\nÉchele ojo cuando pueda: en la tarea le dejé el ambiente, la precondición y los " +
		"pasos, en *Dónde probar* y *Cómo validar*. Cualquier cosa me escribe 🙌")
	return b.String()
}

// createTask crea una tarea en Jira (asignada a mí) y la agrega al sprint activo.
// createTask crea el issue en Jira, lo mete al sprint activo y —si vino `effortId`— le devuelve la
// clave al archivo de la tarea local que lo publicó.
func (a *app) createTask(ctx context.Context, c *websocket.Conn, summary, description string, effortID int64) {
	summary = strings.TrimSpace(summary)
	if summary == "" {
		send(ctx, c, map[string]any{"type": "task_created", "ok": false, "error": "falta el título de la tarea"})
		return
	}
	if a.jira == nil {
		send(ctx, c, map[string]any{"type": "task_created", "ok": false, "error": "Jira no está configurado (falta ATLASSIAN_*)"})
		return
	}

	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()

	created, err := a.jira.CreateIssue(ctx, atlassian.CreateIssueParams{
		ProjectKey:  a.jiraProject,
		Summary:     summary,
		IssueTypeID: a.jiraTypeID,
		AssigneeID:  a.myAccountID,
		Description: strings.TrimSpace(description),
	})
	if err != nil {
		log.Printf("create_task ERROR: %v", err)
		send(ctx, c, map[string]any{"type": "task_created", "ok": false, "error": err.Error()})
		return
	}

	// Agregar al sprint activo del board (best-effort: la tarea ya quedó creada).
	sprintName := ""
	if a.jiraBoardID > 0 {
		if sp, serr := a.jira.ActiveSprint(ctx, a.jiraBoardID); serr == nil {
			if aerr := a.jira.AddIssuesToSprint(ctx, sp.ID, []string{created.Key}); aerr == nil {
				sprintName = sp.Name
			}
		}
	}

	// La clave VUELVE al archivo de la tarea que la publicó. Sin esto la tarea local queda con
	// `jira: []` aunque su issue exista, y el vínculo hay que rehacerlo a mano desde la vista del
	// sprint — que solo alcanza si el issue sigue en la ventana de sprints que el tablero carga.
	// Pasó de verdad: dos tareas publicadas desde acá quedaron sin clave por meses.
	// Best-effort: el issue ya está creado, así que un fallo acá se avisa pero no invalida nada.
	file := ""
	if effortID != 0 {
		f, verr := a.st.VincularTarea(created.Key, effortID)
		if verr != nil {
			log.Printf("create_task: %s creado pero NO enlazado al esfuerzo %d: %v", created.Key, effortID, verr)
		} else {
			file = f
		}
	}

	url := strings.TrimRight(a.jiraSite, "/") + "/browse/" + created.Key
	log.Printf("create_task OK → %s (sprint %q, archivo %q)", created.Key, sprintName, file)
	send(ctx, c, map[string]any{
		"type": "task_created", "ok": true,
		"key": created.Key, "url": url, "sprint": sprintName, "file": file,
	})
}

// dashboard arma los datos del sprint activo del usuario y los envía por el WS.
func (a *app) dashboard(ctx context.Context, c *websocket.Conn) {
	if a.jira == nil {
		send(ctx, c, map[string]any{"type": "dashboard_data", "ok": false, "error": "Jira no está configurado"})
		return
	}

	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	sp, err := a.jira.ActiveSprint(ctx, a.jiraBoardID)
	if err != nil {
		send(ctx, c, map[string]any{"type": "dashboard_data", "ok": false, "error": err.Error()})
		return
	}
	issues, err := a.jira.MySprintIssues(ctx, sp.ID)
	if err != nil {
		send(ctx, c, map[string]any{"type": "dashboard_data", "ok": false, "error": err.Error()})
		return
	}

	var todo, inprog, done int
	var ptsTotal, ptsDone float64
	hasPoints := false
	estSecs, spentSecs := 0, 0
	tasks := make([]map[string]any, 0, len(issues))

	for _, it := range issues {
		switch it.StatusCategory {
		case "done":
			done++
		case "indeterminate":
			inprog++
		default:
			todo++
		}
		if it.HasPoints {
			hasPoints = true
			ptsTotal += it.Points
			if it.StatusCategory == "done" {
				ptsDone += it.Points
			}
		}
		estSecs += it.EstimateSecs
		spentSecs += it.SpentSecs

		var pts any
		if it.HasPoints {
			pts = it.Points
		}
		tasks = append(tasks, map[string]any{
			"key": it.Key, "summary": it.Summary, "status": it.Status,
			"category": it.StatusCategory, "points": pts,
			"url": strings.TrimRight(a.jiraSite, "/") + "/browse/" + it.Key,
		})
	}

	total := len(issues)
	donePct := 0
	if total > 0 {
		donePct = done * 100 / total
	}

	daysTotal, daysElapsed, daysLeft, timePct := 0, 0, 0, 0
	start, end := parseJiraDay(sp.StartDate), parseJiraDay(sp.EndDate)
	if !start.IsZero() && !end.IsZero() {
		daysTotal = int(end.Sub(start).Hours() / 24)
		if daysTotal < 1 {
			daysTotal = 1
		}
		daysElapsed = int(time.Now().Sub(start).Hours() / 24)
		if daysElapsed < 0 {
			daysElapsed = 0
		}
		if daysElapsed > daysTotal {
			daysElapsed = daysTotal
		}
		daysLeft = daysTotal - daysElapsed
		timePct = daysElapsed * 100 / daysTotal
	}

	send(ctx, c, map[string]any{
		"type": "dashboard_data", "ok": true,
		"sprint": map[string]any{
			"name": sp.Name, "start": dayStr(start), "end": dayStr(end),
			"daysTotal": daysTotal, "daysElapsed": daysElapsed, "daysLeft": daysLeft, "timePct": timePct,
		},
		"counts": map[string]any{"total": total, "todo": todo, "inProgress": inprog, "done": done, "donePct": donePct},
		"points": map[string]any{"hasData": hasPoints, "total": ptsTotal, "done": ptsDone},
		"time":   map[string]any{"hasData": estSecs > 0 || spentSecs > 0, "estimateHours": estSecs / 3600, "spentHours": spentSecs / 3600},
		"tasks":  tasks,
	})
}

// activity arma el heatmap de actividad (cambios por día) y lo envía por el WS.
func (a *app) activity(ctx context.Context, c *websocket.Conn) {
	if a.jira == nil {
		send(ctx, c, map[string]any{"type": "activity_data", "ok": false, "error": "Jira no está configurado"})
		return
	}

	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	days, err := a.jira.MyActivityByDay(ctx, a.myAccountID, 182) // ~26 semanas
	if err != nil {
		send(ctx, c, map[string]any{"type": "activity_data", "ok": false, "error": err.Error()})
		return
	}

	total, max := 0, 0
	for _, n := range days {
		total += n
		if n > max {
			max = n
		}
	}
	log.Printf("activity → %d cambios en %d días", total, len(days))
	send(ctx, c, map[string]any{
		"type": "activity_data", "ok": true,
		"days": days, "total": total, "max": max, "weeks": 26,
	})
}

// send serializa v a JSON y lo escribe por el WS (best-effort).
func send(ctx context.Context, c *websocket.Conn, v any) {
	if b, err := json.Marshal(v); err == nil {
		_ = c.Write(ctx, websocket.MessageText, b)
	}
}

// connectIntegrations valida Jira y Slack (si hay credenciales) para el log.
func (a *app) connectIntegrations() string {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()

	var parts []string

	if a.jira != nil {
		if me, err := a.jira.GetMyself(ctx); err == nil {
			a.myAccountID = me.AccountID // asignado por defecto en las tareas nuevas
			parts = append(parts, "Jira("+me.DisplayName+")")
		} else {
			parts = append(parts, "Jira(error)")
		}
	}

	if a.slack != nil {
		if info, err := a.slack.AuthTest(ctx); err == nil {
			parts = append(parts, "Slack("+info.Team+")")
		} else {
			parts = append(parts, "Slack(error)")
		}
	}

	if a.userSlack != nil {
		if info, err := a.userSlack.AuthTest(ctx); err == nil {
			parts = append(parts, "SlackUser("+info.User+")")
		} else {
			parts = append(parts, "SlackUser(error)")
		}
	}

	if len(parts) == 0 {
		return "ninguna (.env sin credenciales)"
	}
	return strings.Join(parts, ", ")
}

// cors habilita al frontend (:5191) contra este server (:8787). Los métodos con body (POST/DELETE)
// disparan preflight OPTIONS en el browser: sin allow-methods/headers, el fetch falla mudo.
func cors(w http.ResponseWriter) {
	w.Header().Set("content-type", "application/json")
	w.Header().Set("access-control-allow-origin", "*")
	w.Header().Set("access-control-allow-methods", "GET, POST, PUT, DELETE, OPTIONS")
	w.Header().Set("access-control-allow-headers", "content-type")
}

func envDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func atoiDefault(s string, def int) int {
	if n, err := strconv.Atoi(s); err == nil {
		return n
	}
	return def
}

// parseJiraDay toma una fecha de Jira (RFC3339) y devuelve solo el día.
func parseJiraDay(s string) time.Time {
	if len(s) < 10 {
		return time.Time{}
	}
	t, err := time.Parse("2006-01-02", s[:10])
	if err != nil {
		return time.Time{}
	}
	return t
}

func dayStr(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.Format("2006-01-02")
}
