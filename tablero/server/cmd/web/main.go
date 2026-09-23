// Command web es el servidor del tablero: la API JSON que lee la UI (:5191) y los artifacts de cada
// tarea. Casi todo es lectura —las tareas, la bitácora, el sprint de Jira, el pulso—; lo único que
// escribe es lo que la UI dispara con un clic explícito: importar tareas de Jira, mover una tarea de
// estado y avisarle a QA.
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
	"slices"
	"strconv"
	"strings"
	"time"

	"creditop/tablero/server/internal/atlassian"
	"creditop/tablero/server/internal/canon"
	"creditop/tablero/server/internal/env"
	"creditop/tablero/server/internal/guard"
	"creditop/tablero/server/internal/layout"
	"creditop/tablero/server/internal/pulse"
	"creditop/tablero/server/internal/repos"
	"creditop/tablero/server/internal/slack"
	"creditop/tablero/server/internal/store"
)

// ── guard: lo que se registra termina en Jira, y no puede filtrar el playground ─────────────────
// Los patrones se movieron a `internal/guard` para que sigan siendo UNA sola fuente ahora que
// también los necesita `cmd/issue-create` (publicar por consola sin el guard sería un agujero en el
// control, y copiarlos acá era la tercera copia que este comentario venía advirtiendo).
// Acá los aplica el aviso a QA antes de mandar el DM; la UI muestra los `problems` que vuelven.

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
func myJQL(project string, includeDone bool) string {
	jql := fmt.Sprintf("assignee = currentUser() AND project = %q", project)
	if !includeDone {
		jql += " AND statusCategory != Done"
	}
	return jql + " ORDER BY updated DESC"
}

// wordsRe parte un título en palabras, ignorando puntuación y comillas.
var wordsRe = regexp.MustCompile(`[^\p{L}\p{N}]+`)

// similar mide cuánto se parecen dos títulos: palabras compartidas sobre palabras totales (Jaccard),
// entre 0 y 1.
//
// No es difuso ni inteligente, y no hace falta que lo sea: los casos que importan son las tareas que
// este tablero redactó y publicó en Jira, donde el título viajó TAL CUAL y el parecido da ~1. Un
// umbral (0.5 en el handler) alcanza para pescarlas y no molestar con coincidencias flojas — la
// decisión de enlazar la toma Miguel, esto solo la propone.
func similar(a, b string) float64 {
	tok := func(s string) map[string]bool {
		out := map[string]bool{}
		for _, p := range wordsRe.Split(strings.ToLower(s), -1) {
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
	common := 0
	for p := range x {
		if y[p] {
			common++
		}
	}
	return float64(common) / float64(len(x)+len(y)-common)
}

// quoted envuelve cada clave en comillas dobles para armar un `key in (...)` de JQL. Las claves ya
// pasaron issueKeyRe, así que no hay nada que escapar.
func quoted(keys []string) []string {
	out := make([]string, len(keys))
	for i, k := range keys {
		out[i] = `"` + k + `"`
	}
	return out
}

// importedBody redacta el cuerpo de una tarea traída de Jira.
//
// El texto de Jira va en la parte PRIVADA (arriba), no bajo `## Tarea (publicable)`, por dos razones.
// Una: ya está publicado — el borrador publicable existe para las tareas que NACEN acá. Dos: las
// descripciones traen rutas de archivo y nombres de repo que el guard rechaza (CORE-159 trae una ruta
// .php), así que ponerlo abajo haría que guardar una tarea importada desde la UI fallara por un texto
// que nadie escribió acá — un muro sin culpable.
func importedBody(d atlassian.IssueDetail, today string) string {
	var b strings.Builder
	fmt.Fprintf(&b, "# %s\n\n", d.Summary)

	fmt.Fprintf(&b, "> Traída de Jira el %s · **%s** · `%s` · creada %s · actualizada %s\n",
		today, d.Key, d.Status, d.Created, d.Updated)
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
	desc = strings.ReplaceAll(desc, store.SECTION, "## Tarea (según Jira)")
	b.WriteString(desc + "\n")
	return b.String()
}

// violations devuelve qué reglas rompe una nota (vacío = publicable). Delega en `internal/guard`,
// que es la fuente única compartida con `cmd/issue-create`.
func violations(note string) []map[string]string { return guard.Violations(note) }

type app struct {
	userSlack *slack.Client     // user token (xoxp-): mensajes "como yo"
	jira      *atlassian.Client // Jira Cloud: el sprint, las transiciones y traer tareas
	st        *store.Store      // avances persistentes + snapshots de sprints/tareas

	jiraSite    string // https://<site>.atlassian.net (para armar el link del issue)
	jiraProject string // clave del proyecto (ej CORE)
	jiraBoardID int    // board cuyo sprint activo recibe la tarea (ej 384)

	qaEmail       string // email de quien valida: recibe el DM cuando la tarea pasa a pruebas
	testingStatus string // subcadena del estado "listo para probar"; en CORE es "🧪 En pruebas"

	dataDir string // raíz de `data/`: de ahí sale el snapshot de ramas (data/cache/ramas.json)
	// branchesRoot es el árbol de checkouts que se mide cuando la consola pide una actualización
	// explícita. Coincide con el default de `make tareas-ramas`; abrir el tablero nunca ejecuta git.
	branchesRoot string
	// Los enlaces de herramientas no se queman en la UI: local y el entorno compartido pueden tener
	// direcciones distintas. El server los entrega juntos desde server/.env.
	canonURL  string
	tracerURL string
	// repos dice dónde se ve en la web cada repo que un bloque puede citar. Sale de tools/repos.py,
	// la lista única: la UI arma el enlace a GitHub de un archivo fijado a su commit.
	repos *repos.Client
}

func main() {
	log.SetFlags(0)
	log.SetPrefix("[web] ")

	env.LoadDefaults()

	a := &app{
		canonURL:    canon.URL(),
		tracerURL:   envDefault("TRACER_URL", "http://localhost:5192"),
		jiraSite:    os.Getenv("ATLASSIAN_SITE"),
		jiraProject: envDefault("JIRA_PROJECT_KEY", "CORE"),
		jiraBoardID: atoiDefault(os.Getenv("JIRA_BOARD_ID"), 384),
		qaEmail:     envDefault("QA_SLACK_EMAIL", "duncan.estrada@creditop.com"),
		// Subcadena, no el nombre exacto: en CORE el estado se llama "🧪 En pruebas" (con emoji) y
		// NO existe "En revisión". Matchear por subcadena evita cablear el emoji y sobrevive a que
		// alguien lo cambie en el workflow.
		testingStatus: envDefault("JIRA_TESTING_STATUS", "pruebas"),
	}
	if token := os.Getenv("SLACK_USER_TOKEN"); token != "" {
		a.userSlack = slack.New(token)
	}
	if site, email, token := os.Getenv("ATLASSIAN_SITE"), os.Getenv("ATLASSIAN_EMAIL"), os.Getenv("ATLASSIAN_API_TOKEN"); site != "" && email != "" && token != "" {
		a.jira = atlassian.New(site, email, token)
	}

	// El historial de avances es el corazón de la herramienta: sin persistencia no arranca (mejor un error claro
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
	a.repos = repos.New(layout.At(dataDir).Tools())
	a.branchesRoot = envDefault("TABLERO_RAMAS_ROOT", filepath.Join(os.Getenv("HOME"), "Desktop", "CREDITOP", "github"))

	integrations := a.connectIntegrations()

	port := envDefault("WEB_PORT", "8787")

	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) { w.Write([]byte("ok")) })
	mux.HandleFunc("/api/config", a.config)

	// ARTIFACTS de las tareas: `/artifacts/<slug>/<archivo>` sirve `tasks/<slug>/artifacts/<archivo>`,
	// tal cual, para que el tablero los abra en una pestaña. Los sirve este server y no uno aparte a
	// propósito: un prototipo que necesita levantar su propio puerto deja de abrirse, y entonces no se
	// mira. Sólo esa forma exacta: nada de subir de nivel, ni de listar una carpeta.
	tasks := layout.At(dataDir)
	mux.HandleFunc("/artifacts/", func(w http.ResponseWriter, r *http.Request) {
		slug, name, ok := strings.Cut(strings.TrimPrefix(r.URL.Path, "/artifacts/"), "/")
		if !ok || !layout.ValidSlug(slug) || name == "" || strings.ContainsAny(name, `/\`) || strings.HasPrefix(name, ".") {
			http.NotFound(w, r)
			return
		}
		http.ServeFile(w, r, filepath.Join(tasks.ArtifactsPath(slug), name))
	})

	// Sprint + mis tareas, en JSON.
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

	// RAMAS de las tareas: el SNAPSHOT que dejó `make tareas-ramas`, tal cual. No se mide al cargar
	// porque son varias invocaciones de git por repo; la consola lo hace sólo cuando se pide
	// explícitamente actualizar la tarea enfocada. Por eso viaja con `measuredAt`: la card muestra la
	// antigüedad y el humano decide si re-medir. Si no hay snapshot devuelve vacío, que no es un error.
	mux.HandleFunc("/api/ramas", func(w http.ResponseWriter, r *http.Request) {
		cors(w)
		if r.Method == http.MethodOptions {
			return
		}
		if r.Method != http.MethodGet {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		json.NewEncoder(w).Encode(store.ReadBranchSnapshot(filepath.Join(a.dataDir, "cache")))
	})
	mux.HandleFunc("/api/ramas/refresh", a.refreshBranches)

	// Las tareas, para la UI. Es de SOLO LECTURA desde el 2026-07-21: las tareas las escribe el asistente
	// en su `task.md` y el tablero las muestra, así que el alta y el borrador de Jira ya no pasan por acá.
	mux.HandleFunc("/api/efforts", func(w http.ResponseWriter, r *http.Request) {
		cors(w)
		if r.Method != http.MethodGet { // un cliente viejo que escribe tiene que enterarse de que no se guardó
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		efforts, err := a.st.Efforts()
		if err != nil {
			json.NewEncoder(w).Encode(map[string]any{"error": err.Error()})
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"efforts": efforts})
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
			jql = myJQL(a.jiraProject, r.URL.Query().Get("all") == "1")
		}
		issues, err := a.jira.SearchIssuesDetailed(ctx, jql)
		if err != nil {
			w.WriteHeader(http.StatusBadGateway)
			json.NewEncoder(w).Encode(map[string]any{"error": err.Error()})
			return
		}

		linked := a.st.LinkedTasks()
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
		output := make([]map[string]any, 0, len(issues))
		registered := 0
		for _, d := range issues {
			if _, ok := linked[d.Key]; ok {
				registered++
				continue
			}
			row := map[string]any{"issue": d}
			// El candidato se busca contra los DOS títulos: el privado (mío) y el publicado en Jira.
			// Los que importan son los segundos —los redactó este tablero y salieron tal cual—, y ahí
			// el parecido es casi 1.
			best := ref{}
			for _, e := range efforts {
				for _, t := range []string{e.JiraTitle, e.Title} {
					if sc := similar(d.Summary, t); sc > best.Score {
						best = ref{ID: e.ID, File: e.File, Title: e.Title, Score: sc}
					}
				}
			}
			if best.Score >= 0.5 {
				row["suggestion"] = best
			}
			output = append(output, row)
		}

		json.NewEncoder(w).Encode(map[string]any{
			"jql": jql, "count": len(issues), "registered": registered, "pending": len(output),
			"issues": output, "efforts": efforts,
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
		keys := append([]string{}, in.Create...)
		for k := range in.Link {
			keys = append(keys, k)
		}
		for _, k := range keys {
			if !issueKeyRe.MatchString(k) {
				w.WriteHeader(http.StatusUnprocessableEntity)
				json.NewEncoder(w).Encode(map[string]any{"error": "clave de issue inválida: " + k})
				return
			}
		}
		if len(keys) == 0 {
			w.WriteHeader(http.StatusUnprocessableEntity)
			json.NewEncoder(w).Encode(map[string]any{"error": "no viene ninguna clave"})
			return
		}

		results := []map[string]any{}

		// Enlazar no necesita a Jira: la clave ya la conocemos y el vínculo es local.
		for k, id := range in.Link {
			file, err := a.st.LinkTask(k, id)
			if err != nil {
				results = append(results, map[string]any{"key": k, "action": "error", "error": err.Error()})
				continue
			}
			log.Printf("jira-import: %s enlazado a %s", k, file)
			results = append(results, map[string]any{"key": k, "action": "linked", "effortId": id, "file": file})
		}

		// Crear sí: el archivo nace con lo que dice Jira, así que hay que leerlo.
		if len(in.Create) > 0 {
			ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
			defer cancel()
			jql := fmt.Sprintf("key in (%s)", strings.Join(quoted(in.Create), ", "))
			issues, err := a.jira.SearchIssuesDetailed(ctx, jql)
			if err != nil {
				w.WriteHeader(http.StatusBadGateway)
				json.NewEncoder(w).Encode(map[string]any{"error": err.Error(), "results": results})
				return
			}
			today := time.Now().Format("2006-01-02")
			for _, d := range issues {
				e, created, err := a.st.ImportFromJira(store.ImportIssue{
					Key: d.Key, Summary: d.Summary, Body: importedBody(d, today),
					Closed: d.Category == "done", Nodes: in.Nodes,
				})
				if err != nil {
					results = append(results, map[string]any{"key": d.Key, "action": "error", "error": err.Error()})
					continue
				}
				action := "created"
				if !created {
					action = "already" // ya estaba registrada: el POST es idempotente
				}
				file := ""
				for _, ref := range a.st.EffortsAll() {
					if ref.ID == e.ID {
						file = ref.File
					}
				}
				log.Printf("jira-import: %s %s → %s", d.Key, action, file)
				results = append(results, map[string]any{
					"key": d.Key, "action": action, "effortId": e.ID, "file": file,
					"archived": d.Category == "done",
				})
			}
			// Una clave que Jira no devolvió (borrada, o sin permiso) tiene que decirse: si no, el
			// listado se recarga sin ella y parece que se importó.
			seen := map[string]bool{}
			for _, d := range issues {
				seen[d.Key] = true
			}
			for _, k := range in.Create {
				if !seen[k] {
					results = append(results, map[string]any{"key": k, "action": "error", "error": "Jira no devolvió este issue"})
				}
			}
		}

		json.NewEncoder(w).Encode(map[string]any{"results": results})
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
			var chosen *atlassian.Transition
			for i := range trs {
				if trs[i].ID == in.ID {
					chosen = &trs[i]
					break
				}
			}
			if chosen == nil {
				w.WriteHeader(http.StatusConflict)
				json.NewEncoder(w).Encode(map[string]any{
					"error": "esa transición ya no está disponible — alguien movió " + in.Key + " en Jira. Refrescá.",
				})
				return
			}
			if err := a.jira.TransitionIssue(ctx, in.Key, chosen.ID); err != nil {
				w.WriteHeader(http.StatusBadGateway)
				json.NewEncoder(w).Encode(map[string]any{"error": err.Error()})
				return
			}
			log.Printf("transitions %s → %s (%s)", in.Key, chosen.To, chosen.Name)
			json.NewEncoder(w).Encode(map[string]any{"ok": true, "to": chosen.To, "name": chosen.Name})

		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	})

	// La bitácora, para mostrarla. Se escribe con `make bitacora-add`, que mide los minutos: desde el
	// 2026-07-21 el tablero no carga avances, así que ni el alta ni el borrado pasan por acá.
	mux.HandleFunc("/api/entries", func(w http.ResponseWriter, r *http.Request) {
		cors(w)
		if r.Method != http.MethodGet { // un cliente viejo que escribe tiene que enterarse de que no se guardó
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		entries, err := a.st.List(atoiDefault(r.URL.Query().Get("days"), 30), int64(atoiDefault(r.URL.Query().Get("sprint"), 0)))
		if err != nil {
			json.NewEncoder(w).Encode(map[string]any{"error": err.Error()})
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"entries": entries})
	})

	// El contexto de tarea es un JSONL privado y versionable, distinto de entries/: entries mide
	// tiempo y puede subir a Jira; estos hitos sólo explican decisiones y comprobaciones para retomar.
	mux.HandleFunc("/api/task-context", func(w http.ResponseWriter, r *http.Request) {
		cors(w)
		if r.Method == http.MethodOptions {
			return
		}
		if r.Method != http.MethodGet {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		effort := int64(atoiDefault(r.URL.Query().Get("effort"), 0))
		if effort == 0 {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]any{"error": "falta effort"})
			return
		}
		events, err := a.st.TaskContext(effort)
		if err != nil {
			w.WriteHeader(http.StatusUnprocessableEntity)
			json.NewEncoder(w).Encode(map[string]any{"error": err.Error()})
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"events": events})
	})

	// El PULSO: cuándo toqué los repos de la compañía, en tramos de 5 minutos. Lo escribe el agente
	// (`cmd/pulse`, un LaunchAgent cada 5'), acá sólo se AGREGA y se sirve — el server no lo genera,
	// porque tiene que registrarse aunque el tablero esté cerrado, que es cuando más se programa.
	//
	//   /api/pulse?days=20 → una celda por (día, hora), con slots, cobertura, commits y desglose por repo
	mux.HandleFunc("/api/pulse", func(w http.ResponseWriter, r *http.Request) {
		cors(w)
		if r.Method == http.MethodOptions {
			return
		}
		days := atoiDefault(r.URL.Query().Get("days"), 20)
		ticks, err := pulse.Read(dataDir, days)
		if err != nil {
			json.NewEncoder(w).Encode(map[string]any{"error": err.Error()})
			return
		}
		// `installed` distingue "no trabajaste" de "nadie estaba mirando": sin un solo tick, la grilla
		// vacía no significa nada y la UI tiene que decirlo en vez de dejarte sacar conclusiones.
		ult, found := pulse.LastTick(dataDir)
		res := map[string]any{
			"hours":        pulse.Aggregate(ticks, days),
			"slotsPerHour": pulse.SlotsPerHour,
			"slotMinutes":  int(pulse.Slot / time.Minute),
			"installed":    found,
		}
		if found {
			res["lastTick"] = ult.Format(time.RFC3339)
		}
		json.NewEncoder(w).Encode(res)
	})

	log.Printf("server on · http://localhost:%s · integraciones: %s", port, integrations)
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		log.Fatalf("server error: %v", err)
	}
}

// dmAsMe manda un DM COMO YO (user token xoxp-): busca al destinatario por email, abre el DM y
// publica. Devuelve el nombre real para poder decir a quién le llegó, no solo el email.
//
// Lo usa el aviso a QA. Va como YO y no como el bot a propósito: un aviso de
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

// connectIntegrations valida Jira y Slack (si hay credenciales) para el log.
func (a *app) connectIntegrations() string {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()

	var parts []string

	if a.jira != nil {
		if me, err := a.jira.GetMyself(ctx); err == nil {
			parts = append(parts, "Jira("+me.DisplayName+")")
		} else {
			parts = append(parts, "Jira(error)")
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

var branchesTaskIDRe = regexp.MustCompile(`^[1-9]\d*$`)

// refreshBranches vuelve a medir UNA tarea desde la consola. Repite la semántica de
// `make tareas-ramas N=<id>`: lee los refs que el último fetch dejó localmente y consulta los PRs si
// `gh` está disponible, pero no hace fetch ni modifica ninguna rama. Medir sólo la tarea enfocada
// mantiene esta acción interactiva y, al guardar, preserva las mediciones de las demás tareas.
func (a *app) refreshBranches(w http.ResponseWriter, r *http.Request) {
	cors(w)
	if r.Method == http.MethodOptions {
		return
	}
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	id := r.URL.Query().Get("id")
	if !branchesTaskIDRe.MatchString(id) {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "id de tarea inválido"})
		return
	}

	efforts, err := a.st.Efforts()
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "no pude leer las tareas: " + err.Error()})
		return
	}
	var pattern string
	for _, effort := range efforts {
		if strconv.FormatInt(effort.ID, 10) == id {
			pattern = effort.BranchPatterns
			break
		}
	}
	if pattern == "" {
		w.WriteHeader(http.StatusUnprocessableEntity)
		json.NewEncoder(w).Encode(map[string]string{"error": "esta tarea no declara un patrón de ramas"})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
	defer cancel()
	measured := store.MeasureBranches(ctx, a.branchesRoot, map[string]string{id: pattern}, nil)
	if ctx.Err() != nil {
		w.WriteHeader(http.StatusGatewayTimeout)
		json.NewEncoder(w).Encode(map[string]string{"error": "la medición de ramas tardó demasiado; intentá de nuevo"})
		return
	}
	updated, ok := measured.Tasks[id]
	if !ok {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "la medición no devolvió la tarea solicitada"})
		return
	}

	cacheDir := filepath.Join(a.dataDir, "cache")
	snapshot := store.ReadBranchSnapshot(cacheDir)
	if snapshot.Tasks == nil {
		snapshot.Tasks = map[string]store.TaskBranches{}
	}
	snapshot.MeasuredAt = measured.MeasuredAt
	snapshot.Root = measured.Root
	snapshot.Tasks[id] = updated
	// Si esta tarea había quedado incompleta en una corrida anterior, ya no debe conservar esa marca.
	snapshot.Incomplete = slices.DeleteFunc(snapshot.Incomplete, func(incomplete string) bool {
		return incomplete == id
	})
	if err := store.SaveBranchSnapshot(cacheDir, snapshot); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "no pude guardar la medición: " + err.Error()})
		return
	}
	json.NewEncoder(w).Encode(snapshot)
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
