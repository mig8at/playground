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
	"creditop/tablero/server/internal/slack"
	"creditop/tablero/server/internal/store"
)

// ── guard: lo que se registra termina en Jira, y no puede filtrar el playground ─────────────────
// FUENTE ÚNICA de los patrones prohibidos. La UI los pide por /api/guard (para bloquear el botón con
// feedback inmediato) y el POST los re-aplica antes del INSERT (para que nada sucio entre a la base
// aunque el cliente se lo salte). Dos copias —una en JS, otra acá— ya habrían derivado.
// Sintaxis compatible RE2 (Go) y JS a la vez: nada de lookbehind ni named groups.
var prohibido = []struct {
	Re  string `json:"re"`
	Que string `json:"que"`
}{
	{`\bF-\d+\b`, "referencia a un hallazgo interno"},
	{`playground`, "menciona el playground"},
	{`frontend-e2e|backend-e2e|legacy-backend|frontend-monorepo|creditop-woocommerce`, "nombra un repo interno"},
	{`[\w/-]+\.(ts|tsx|php|go|vue|json|mjs)\b`, "incluye una ruta de archivo"},
}

var prohibidoRe = func() []*regexp.Regexp {
	out := make([]*regexp.Regexp, len(prohibido))
	for i, p := range prohibido {
		out[i] = regexp.MustCompile(`(?i)` + p.Re)
	}
	return out
}()

// violaciones devuelve qué reglas rompe una nota (vacío = publicable).
func violaciones(nota string) []map[string]string {
	var out []map[string]string
	for i, re := range prohibidoRe {
		if m := re.FindString(nota); m != "" {
			out = append(out, map[string]string{"que": prohibido[i].Que, "hallado": m})
		}
	}
	return out
}

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
	// acá que una UI que parece guardar y pierde todo). El default es relativo al cwd (npm corre el
	// server desde server/, o sea server/data/); TABLERO_DB lo pisa.
	st, err := store.Abrir(envDefault("TABLERO_DB", filepath.Join("data", "tablero.db")))
	if err != nil {
		log.Fatalf("no se pudo abrir la base de la bitácora: %v", err)
	}
	a.st = st

	integrations := a.connectIntegrations()

	port := envDefault("WEB_PORT", "8787")

	mux := http.NewServeMux()
	mux.HandleFunc("/ws", a.handleWS)
	mux.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) { w.Write([]byte("ok")) })

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
			_ = a.st.GuardarSprint(int64(sp.ID), board, sp.Name, sp.State, sp.StartDate, sp.EndDate)
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
		_ = a.st.GuardarSprint(int64(sp.ID), board, sp.Name, sp.State, sp.StartDate, sp.EndDate)
		for _, it := range iss {
			var pts *float64
			if it.HasPoints {
				p := it.Points
				pts = &p
			}
			_ = a.st.GuardarTarea(it.Key, it.Summary, pts, it.Status, it.StatusCategory, int64(sp.ID))
		}
		// `site` va en la respuesta para que el front arme el link a la tarea sin hardcodear el sitio:
		// la URL de Jira sale del .env del server, que es donde ya vive esa verdad.
		json.NewEncoder(w).Encode(map[string]any{"sprint": sp, "issues": iss, "board": board, "site": strings.TrimRight(a.jiraSite, "/")})
	})

	// ── bitácora (SQLite) ───────────────────────────────────────────────────────────────────────
	// GET  /api/registros?dias=30&sprint=ID → ventana de días ∪ sprint (el mapa mira por fecha, la
	//                                         bitácora por sprint; una sola llamada sirve a ambos)
	// POST /api/registros                   → crea; 422 si la nota viola el guard
	// DELETE /api/registros/{id}            → borrado suave
	mux.HandleFunc("/api/guard", func(w http.ResponseWriter, _ *http.Request) {
		cors(w)
		json.NewEncoder(w).Encode(map[string]any{"patrones": prohibido})
	})

	mux.HandleFunc("/api/registros", func(w http.ResponseWriter, r *http.Request) {
		cors(w)
		switch r.Method {
		case http.MethodOptions: // preflight del browser (POST con JSON desde :5191)
			return
		case http.MethodGet:
			regs, err := a.st.Listar(atoiDefault(r.URL.Query().Get("dias"), 30), int64(atoiDefault(r.URL.Query().Get("sprint"), 0)))
			if err != nil {
				json.NewEncoder(w).Encode(map[string]any{"error": err.Error()})
				return
			}
			json.NewEncoder(w).Encode(map[string]any{"registros": regs})
		case http.MethodPost:
			var in struct {
				Tarea       string `json:"tarea"`
				TituloLibre string `json:"tituloLibre"`
				SprintID    int64  `json:"sprintId"`
				Tipo        string `json:"tipo"`
				InicioMs    int64  `json:"inicioMs"` // epoch ms; 0 = terminó ahora (inicio = ahora − minutos)
				Minutos     int    `json:"minutos"`
				Nota        string `json:"nota"`
			}
			if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
				w.WriteHeader(http.StatusBadRequest)
				json.NewEncoder(w).Encode(map[string]any{"error": "JSON inválido"})
				return
			}
			in.Nota = strings.TrimSpace(in.Nota)
			switch {
			case in.Nota == "":
				w.WriteHeader(http.StatusUnprocessableEntity)
				json.NewEncoder(w).Encode(map[string]any{"error": "la nota está vacía"})
				return
			case in.Minutos <= 0 || in.Minutos > 720:
				w.WriteHeader(http.StatusUnprocessableEntity)
				json.NewEncoder(w).Encode(map[string]any{"error": "minutos fuera de rango (1–720)"})
				return
			case in.Tipo == "" || in.Tarea == "" && in.TituloLibre == "":
				w.WriteHeader(http.StatusUnprocessableEntity)
				json.NewEncoder(w).Encode(map[string]any{"error": "falta tipo, o tarea/título"})
				return
			}
			// el guard del server es el que VALE: la UI ya bloqueó con los mismos patrones, pero nada
			// sucio puede entrar a la base aunque el cliente se lo salte
			if v := violaciones(in.Nota); v != nil {
				w.WriteHeader(http.StatusUnprocessableEntity)
				json.NewEncoder(w).Encode(map[string]any{"error": "la nota viola el guard", "problemas": v})
				return
			}
			ini := time.Now().Add(-time.Duration(in.Minutos) * time.Minute)
			if in.InicioMs > 0 {
				ini = time.UnixMilli(in.InicioMs)
			}
			reg, err := a.st.Crear(in.Tarea, in.TituloLibre, in.SprintID, in.Tipo, ini, in.Minutos, in.Nota)
			if err != nil {
				w.WriteHeader(http.StatusInternalServerError)
				json.NewEncoder(w).Encode(map[string]any{"error": err.Error()})
				return
			}
			json.NewEncoder(w).Encode(map[string]any{"registro": reg})
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	})

	mux.HandleFunc("/api/registros/", func(w http.ResponseWriter, r *http.Request) {
		cors(w)
		if r.Method == http.MethodOptions {
			return
		}
		if r.Method != http.MethodDelete {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		id, err := strconv.ParseInt(strings.TrimPrefix(r.URL.Path, "/api/registros/"), 10, 64)
		if err != nil || id <= 0 {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]any{"error": "id inválido"})
			return
		}
		if err := a.st.Borrar(id); err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]any{"error": err.Error()})
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"ok": true})
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
			a.createTask(ctx, c, msg.Summary, msg.Description)
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
	to = strings.TrimSpace(to)
	text = strings.TrimSpace(text)
	if to == "" || text == "" {
		send(ctx, c, map[string]any{"type": "dm_sent", "ok": false, "error": "faltan destinatario (email) o mensaje"})
		return
	}
	if a.userSlack == nil {
		send(ctx, c, map[string]any{"type": "dm_sent", "ok": false, "error": "falta SLACK_USER_TOKEN (tu token personal xoxp-)"})
		return
	}

	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	user, err := a.userSlack.LookupUserByEmail(ctx, to)
	if err != nil {
		send(ctx, c, map[string]any{"type": "dm_sent", "ok": false, "error": err.Error()})
		return
	}
	dm, err := a.userSlack.OpenDM(ctx, user.ID)
	if err != nil {
		send(ctx, c, map[string]any{"type": "dm_sent", "ok": false, "error": err.Error()})
		return
	}
	posted, err := a.userSlack.PostMessage(ctx, dm, text)
	if err != nil {
		log.Printf("dm ERROR: %v", err)
		send(ctx, c, map[string]any{"type": "dm_sent", "ok": false, "error": err.Error()})
		return
	}
	log.Printf("dm OK → %s <%s> (ts %s)", user.RealName, to, posted.TS)
	send(ctx, c, map[string]any{"type": "dm_sent", "ok": true, "to": user.RealName, "ts": posted.TS})
}

// createTask crea una tarea en Jira (asignada a mí) y la agrega al sprint activo.
func (a *app) createTask(ctx context.Context, c *websocket.Conn, summary, description string) {
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

	url := strings.TrimRight(a.jiraSite, "/") + "/browse/" + created.Key
	log.Printf("create_task OK → %s (sprint %q)", created.Key, sprintName)
	send(ctx, c, map[string]any{
		"type": "task_created", "ok": true,
		"key": created.Key, "url": url, "sprint": sprintName,
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
	w.Header().Set("access-control-allow-methods", "GET, POST, DELETE, OPTIONS")
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
