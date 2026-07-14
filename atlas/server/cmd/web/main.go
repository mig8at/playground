// Command web es el servidor de Atlas para la UI local.
//
// Levanta un WebSocket (:8788). La UI se conecta y recibe el estado (repos +
// flujos). El estado vive en disco, así que cuando el conector MCP crea un
// flujo, el web lo detecta (poll de mtime) y lo empuja a la UI en vivo.
//
// Mensajes que acepta de la UI:
//
//	{type:"scan", path:"/ruta/al/repo"}   → indexa un repo
//	{type:"flow", id:"..."}               → detalle de un flujo (nodos + edges)
//	{type:"connections", id:"nodeId"}     → edges de un nodo
//	{type:"delete_flow", id:"..."}        → borra un flujo
//	{type:"refresh"}                      → reenvía el estado
package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/coder/websocket"

	"creditop/atlas/server/internal/engine"
)

type server struct {
	eng *engine.Engine

	mu      sync.Mutex
	clients map[*websocket.Conn]context.Context
}

func main() {
	log.SetFlags(0)
	log.SetPrefix("[atlas-web] ")

	eng, err := engine.New()
	if err != nil {
		log.Fatalf("engine: %v", err)
	}
	s := &server{eng: eng, clients: map[*websocket.Conn]context.Context{}}

	port := envDefault("ATLAS_WEB_PORT", "8788")

	mux := http.NewServeMux()
	mux.HandleFunc("/ws", s.handleWS)
	mux.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) { w.Write([]byte("ok")) })

	go s.watchDisk() // detecta cambios que hace el MCP y refresca la UI

	log.Printf("server on · ws://localhost:%s/ws · datos: %s", port, eng.Dir())
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		log.Fatalf("server error: %v", err)
	}
}

func (s *server) handleWS(w http.ResponseWriter, r *http.Request) {
	c, err := websocket.Accept(w, r, &websocket.AcceptOptions{OriginPatterns: []string{"*"}})
	if err != nil {
		return
	}
	defer c.Close(websocket.StatusNormalClosure, "")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	s.mu.Lock()
	s.clients[c] = ctx
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		delete(s.clients, c)
		s.mu.Unlock()
	}()

	s.sendState(ctx, c) // estado inicial

	for {
		_, data, err := c.Read(ctx)
		if err != nil {
			return
		}
		var msg inbound
		if json.Unmarshal(data, &msg) != nil {
			continue
		}
		s.handle(ctx, c, msg)
	}
}

type inbound struct {
	Type    string            `json:"type"`
	Path    string            `json:"path"`
	ID      string            `json:"id"`
	Repo    string            `json:"repo"`
	Lang    string            `json:"lang"`
	IDs     []string          `json:"ids"`
	Name    string            `json:"name"`
	Parent  string            `json:"parent"`
	Targets map[string]string `json:"targets"`
	Tasks   []engine.Task     `json:"tasks"`
}

func (s *server) handle(ctx context.Context, c *websocket.Conn, msg inbound) {
	switch msg.Type {
	case "scan":
		repo, err := s.eng.Scan(msg.Path)
		if err != nil {
			send(ctx, c, map[string]any{"type": "scan_result", "ok": false, "error": err.Error()})
			return
		}
		log.Printf("scan OK · %s (%d nodos)", repo.Alias, repo.NodeCount)
		send(ctx, c, map[string]any{"type": "scan_result", "ok": true, "repo": repo})
		s.broadcastState()
	case "flow":
		f, ok := s.eng.Flow(msg.ID)
		if !ok {
			send(ctx, c, map[string]any{"type": "flow_detail", "ok": false, "error": "flujo no encontrado"})
			return
		}
		nodes := s.eng.NodesByID(f.NodeIDs)
		send(ctx, c, map[string]any{"type": "flow_detail", "ok": true, "flow": f, "nodes": nodes})
	case "connections":
		send(ctx, c, map[string]any{"type": "connections", "ok": true, "id": msg.ID, "edges": s.eng.Connections(msg.ID)})
	case "node_files":
		files, total := s.eng.RepoFiles(msg.Repo, msg.Lang, 80)
		send(ctx, c, map[string]any{
			"type": "node_files", "ok": true, "repo": msg.Repo, "lang": msg.Lang,
			"total": total, "files": files,
		})
	case "flow_files":
		f, found := s.eng.Flow(msg.ID)
		if !found {
			send(ctx, c, map[string]any{"type": "flow_files", "ok": false, "id": msg.ID, "error": "flujo no encontrado"})
			return
		}
		st, _ := s.eng.FlowStatus(f.ID)
		send(ctx, c, map[string]any{
			"type": "flow_files", "ok": true, "id": f.ID, "name": f.Name,
			"description": f.Description, "files": s.eng.NodesByID(f.NodeIDs),
			"status": st,
		})
	case "save_analysis":
		path, err := s.eng.ExportAnalysis(msg.ID)
		if err != nil {
			send(ctx, c, map[string]any{"type": "analysis_saved", "ok": false, "id": msg.ID, "error": err.Error()})
			return
		}
		log.Printf("análisis guardado · %s → %s", msg.ID, path)
		send(ctx, c, map[string]any{"type": "analysis_saved", "ok": true, "id": msg.ID, "path": path})
	case "tree":
		send(ctx, c, map[string]any{"type": "tree", "ok": true, "text": s.eng.Tree(msg.IDs)})
	case "combo_graphs":
		send(ctx, c, map[string]any{"type": "combo_graphs", "ok": true, "id": msg.ID, "graphs": s.eng.ComboGraphs(msg.ID)})
	case "align_combination":
		log.Printf("alineando repos a la combinación %s…", msg.ID)
		results := s.eng.AlignCombination(msg.ID)
		for _, r := range results {
			if r.Error != "" {
				log.Printf("  ✗ %s: %s", r.Alias, r.Error)
			} else {
				log.Printf("  ✓ %s → %s%s", r.Alias, r.Now, map[bool]string{true: " (pull)"}[r.Pulled])
			}
		}
		send(ctx, c, map[string]any{"type": "alignment", "ok": true, "id": msg.ID, "results": results})
		s.broadcastState()
	case "repo_branches":
		out := map[string][]string{}
		for _, r := range s.eng.Repos() {
			out[r.Alias] = s.eng.RepoBranches(r.Alias)
		}
		send(ctx, c, map[string]any{"type": "repo_branches", "ok": true, "branches": out})
	case "save_combination":
		cb, err := s.eng.SaveCombination(msg.ID, msg.Name, msg.Parent, msg.Targets)
		if err != nil {
			send(ctx, c, map[string]any{"type": "combination_saved", "ok": false, "error": err.Error()})
			return
		}
		log.Printf("combinación guardada · %s", cb.Name)
		send(ctx, c, map[string]any{"type": "combination_saved", "ok": true, "id": cb.ID})
		s.broadcastState()
	case "delete_combination":
		_ = s.eng.DeleteCombination(msg.ID)
		s.broadcastState()
	case "set_tasks":
		if _, err := s.eng.SetTasks(msg.ID, msg.Tasks); err == nil {
			s.broadcastState()
		}
	case "refresh":
		s.sendState(ctx, c)
	case "delete_flow":
		_ = s.eng.DeleteFlow(msg.ID)
		s.broadcastState()
	}
}

// state es el snapshot que ve la UI: repos + resumen de flujos.
func (s *server) sendState(ctx context.Context, c *websocket.Conn) {
	send(ctx, c, s.stateMsg())
}

func (s *server) stateMsg() map[string]any {
	repos := s.eng.Repos()
	flows := s.eng.Flows()
	nodes := s.eng.Nodes()

	// resumen por flujo: cuántos archivos, de qué repos, y si está al día
	type flowSummary struct {
		engine.Flow
		Files    int      `json:"files"`
		Repos    []string `json:"repos"`
		UpToDate bool     `json:"up_to_date"`
		HasBase  bool     `json:"has_base"`
		Changed  int      `json:"changed"`
	}
	repoOf := map[string]string{}
	for _, n := range nodes {
		repoOf[n.ID] = n.Repo
	}
	statuses := s.eng.FlowStatuses()
	summaries := make([]flowSummary, 0, len(flows))
	for _, f := range flows {
		seen := map[string]bool{}
		var rs []string
		for _, id := range f.NodeIDs {
			if r := repoOf[id]; r != "" && !seen[r] {
				seen[r] = true
				rs = append(rs, r)
			}
		}
		st := statuses[f.ID]
		summaries = append(summaries, flowSummary{
			Flow: f, Files: len(f.NodeIDs), Repos: rs,
			UpToDate: st.UpToDate, HasBase: st.HasBase, Changed: len(st.Changed) + len(st.Removed),
		})
	}

	// workspaces (combinaciones de ramas) con su estado de alineación + el
	// resumen liviano de su flujo (heredado del padre si es un hijo derivado)
	type combo struct {
		engine.Combination
		Status engine.CombStatus `json:"status"`
		Flow   *engine.StageInfo `json:"flow"`
	}
	var combos []combo
	for _, c := range s.eng.Combinations() {
		st, _ := s.eng.CombinationStatus(c.ID)
		combos = append(combos, combo{Combination: c, Status: st, Flow: s.eng.ComboFlow(c.ID)})
	}

	return map[string]any{
		"type":         "state",
		"repos":        repos,
		"flows":        summaries,
		"nodes":        len(nodes),
		"summary":      s.eng.Summary(),
		"combinations": combos,
		"server":       "server on",
	}
}

func (s *server) broadcastState() {
	msg := s.stateMsg()
	s.mu.Lock()
	defer s.mu.Unlock()
	for c, ctx := range s.clients {
		send(ctx, c, msg)
	}
}

// watchDisk observa el mtime de los archivos de datos; si el MCP (u otro
// proceso) los cambia, reenvía el estado a todos los clientes.
func (s *server) watchDisk() {
	var lastIdx, lastFlows, lastCombos time.Time
	for {
		time.Sleep(1 * time.Second)
		idx, flows, combos := s.eng.ModTimes()
		if idx.After(lastIdx) || flows.After(lastFlows) || combos.After(lastCombos) {
			if !lastIdx.IsZero() || !lastFlows.IsZero() || !lastCombos.IsZero() {
				s.broadcastState()
			}
			lastIdx, lastFlows, lastCombos = idx, flows, combos
		}
	}
}

func send(ctx context.Context, c *websocket.Conn, v any) {
	if b, err := json.Marshal(v); err == nil {
		_ = c.Write(ctx, websocket.MessageText, b)
	}
}

func envDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
