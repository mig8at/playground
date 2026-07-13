package main

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"creditop/atlas/server/internal/engine"
)

// ok arma un CallToolResult de texto + el output tipado.
func ok[T any](text string, out T) (*mcp.CallToolResult, T, error) {
	return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: text}}}, out, nil
}
func fail[T any](err error) (*mcp.CallToolResult, T, error) {
	var zero T
	return &mcp.CallToolResult{IsError: true, Content: []mcp.Content{&mcp.TextContent{Text: err.Error()}}}, zero, nil
}
func jsonText(v any) string {
	b, _ := json.MarshalIndent(v, "", "  ")
	return string(b)
}

// ── atlas_scan ───────────────────────────────────────────────────────────────

type ScanInput struct {
	Path string `json:"path" jsonschema:"ruta absoluta a la raíz del repo a indexar (se puede usar ~)"`
}
type ScanOutput struct {
	Repo      string `json:"repo"`
	NodeCount int    `json:"node_count"`
}

func registerScan(s *mcp.Server, eng *engine.Engine) {
	mcp.AddTool(s, &mcp.Tool{
		Name:        "atlas_scan",
		Description: "Indexa (o re-indexa) un repo: extrae node-lite (imports, definiciones, rutas) de cada archivo de código. Llamar una vez por repo. Los IDs son estables entre escaneos.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in ScanInput) (*mcp.CallToolResult, ScanOutput, error) {
		repo, err := eng.Scan(in.Path)
		if err != nil {
			return fail[ScanOutput](err)
		}
		out := ScanOutput{Repo: repo.Alias, NodeCount: repo.NodeCount}
		return ok(fmt.Sprintf("Indexado %s: %d nodos.", repo.Alias, repo.NodeCount), out)
	})
}

// ── atlas_map ────────────────────────────────────────────────────────────────

type MapInput struct {
	Query string `json:"query,omitempty" jsonschema:"filtro opcional por substring del path. Vacío = todo el mapa"`
}
type MapNode struct {
	ID          string   `json:"id"`
	Repo        string   `json:"repo"`
	Path        string   `json:"path"`
	Lang        string   `json:"lang"`
	Lines       int      `json:"lines"`
	Definitions []string `json:"definitions,omitempty"`
	Routes      []string `json:"routes,omitempty"`
	Tables      []string `json:"tables,omitempty"`
}
type MapOutput struct {
	Count int       `json:"count"`
	Nodes []MapNode `json:"nodes"`
}

func registerMap(s *mcp.Server, eng *engine.Engine) {
	mcp.AddTool(s, &mcp.Tool{
		Name:        "atlas_map",
		Description: "Devuelve el catálogo node-lite (barato, sin código): id, path, definiciones y rutas por archivo. Úsalo para ubicar archivos por ID antes de pedir su contenido con atlas_get_content.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in MapInput) (*mcp.CallToolResult, MapOutput, error) {
		nodes := eng.Search(in.Query)
		out := MapOutput{Count: len(nodes)}
		for _, n := range nodes {
			var routes []string
			for _, r := range n.Routes {
				routes = append(routes, fmt.Sprintf("[%s] %s %s", r.Kind, r.Method, r.Path))
			}
			out.Nodes = append(out.Nodes, MapNode{
				ID: n.ID, Repo: n.Repo, Path: n.Path, Lang: n.Lang,
				Lines: n.Lines, Definitions: n.Definitions, Routes: routes, Tables: n.Tables,
			})
		}
		return ok(jsonText(out), out)
	})
}

// ── atlas_connections ────────────────────────────────────────────────────────

type ConnInput struct {
	ID string `json:"id" jsonschema:"ID de nodo (ej legacy-backend:a1b2c3d4)"`
}
type ConnOutput struct {
	ID    string `json:"id"`
	Edges []struct {
		From   string `json:"from"`
		To     string `json:"to"`
		Kind   string `json:"kind"`
		Detail string `json:"detail"`
	} `json:"edges"`
}

func registerConnections(s *mcp.Server, eng *engine.Engine) {
	mcp.AddTool(s, &mcp.Tool{
		Name:        "atlas_connections",
		Description: "Edges de un nodo: imports (intra-repo) y rutas (cross-repo, match cliente↔servidor por método+path). Sirve para trazar un flujo saltando entre repos.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in ConnInput) (*mcp.CallToolResult, ConnOutput, error) {
		edges := eng.Connections(in.ID)
		var out ConnOutput
		out.ID = in.ID
		for _, e := range edges {
			out.Edges = append(out.Edges, struct {
				From   string `json:"from"`
				To     string `json:"to"`
				Kind   string `json:"kind"`
				Detail string `json:"detail"`
			}{e.From, e.To, e.Kind, e.Detail})
		}
		return ok(jsonText(out), out)
	})
}

// ── atlas_save_flow ──────────────────────────────────────────────────────────

type SaveFlowInput struct {
	ID          string   `json:"id,omitempty" jsonschema:"id del flujo; vacío para crear uno nuevo (se genera del nombre)"`
	Name        string   `json:"name" jsonschema:"nombre del flujo, ej 'Onboarding CreditopX rt=2'"`
	Description string   `json:"description,omitempty" jsonschema:"qué representa el flujo"`
	Combination string   `json:"combination,omitempty" jsonschema:"id de la combinación de ramas a la que pertenece (ej 'produccion')"`
	Group       string   `json:"group,omitempty" jsonschema:"fila/flujo de negocio que agrupa etapas (canal→lender). Ej: Pullman y CrediPullman comparten group 'pullman' = una fila; SmartPay va en su propia fila"`
	NodeIDs     []string `json:"node_ids" jsonschema:"array de IDs de nodo que componen el flujo (pueden ser de varios repos)"`
}
type SaveFlowOutput struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Files int    `json:"files"`
}

func registerSaveFlow(s *mcp.Server, eng *engine.Engine) {
	mcp.AddTool(s, &mcp.Tool{
		Name:        "atlas_save_flow",
		Description: "Guarda un flujo: un array curado de IDs de archivo (posiblemente de varios repos) con nombre. Aparece en vivo en la UI de Atlas. Es la forma de persistir 'este flujo = estos archivos'.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in SaveFlowInput) (*mcp.CallToolResult, SaveFlowOutput, error) {
		f, err := eng.SaveFlow(in.ID, in.Name, in.Description, in.Combination, in.Group, in.NodeIDs)
		if err != nil {
			return fail[SaveFlowOutput](err)
		}
		out := SaveFlowOutput{ID: f.ID, Name: f.Name, Files: len(f.NodeIDs)}
		return ok(fmt.Sprintf("Flujo guardado: %s (%d archivos).", f.Name, len(f.NodeIDs)), out)
	})
}

// ── atlas_list_flows ─────────────────────────────────────────────────────────

type ListFlowsInput struct{}
type FlowLite struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	Files       int    `json:"files"`
}
type ListFlowsOutput struct {
	Flows []FlowLite `json:"flows"`
}

func registerListFlows(s *mcp.Server, eng *engine.Engine) {
	mcp.AddTool(s, &mcp.Tool{
		Name:        "atlas_list_flows",
		Description: "Lista los flujos guardados (id, nombre, nº de archivos).",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, _ ListFlowsInput) (*mcp.CallToolResult, ListFlowsOutput, error) {
		var out ListFlowsOutput
		for _, f := range eng.Flows() {
			out.Flows = append(out.Flows, FlowLite{ID: f.ID, Name: f.Name, Description: f.Description, Files: len(f.NodeIDs)})
		}
		return ok(jsonText(out), out)
	})
}

// ── atlas_get_flow ───────────────────────────────────────────────────────────

type GetFlowInput struct {
	ID string `json:"id" jsonschema:"id del flujo"`
}
type GetFlowOutput struct {
	ID      string    `json:"id"`
	Name    string    `json:"name"`
	NodeIDs []string  `json:"node_ids"`
	Nodes   []MapNode `json:"nodes"`
}

func registerGetFlow(s *mcp.Server, eng *engine.Engine) {
	mcp.AddTool(s, &mcp.Tool{
		Name:        "atlas_get_flow",
		Description: "Devuelve un flujo con sus nodos resueltos (node-lite). Combínalo con atlas_get_content para hidratar el código.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in GetFlowInput) (*mcp.CallToolResult, GetFlowOutput, error) {
		f, found := eng.Flow(in.ID)
		if !found {
			return fail[GetFlowOutput](fmt.Errorf("flujo no encontrado: %s", in.ID))
		}
		out := GetFlowOutput{ID: f.ID, Name: f.Name, NodeIDs: f.NodeIDs}
		for _, n := range eng.NodesByID(f.NodeIDs) {
			out.Nodes = append(out.Nodes, MapNode{ID: n.ID, Repo: n.Repo, Path: n.Path, Lang: n.Lang, Lines: n.Lines, Definitions: n.Definitions, Tables: n.Tables})
		}
		return ok(jsonText(out), out)
	})
}

// ── atlas_get_content ────────────────────────────────────────────────────────

type GetContentInput struct {
	IDs []string `json:"ids" jsonschema:"array de IDs de nodo a hidratar (leer código real)"`
}
type GetContentOutput struct {
	Contents map[string]string `json:"contents"`
}

func registerGetContent(s *mcp.Server, eng *engine.Engine) {
	mcp.AddTool(s, &mcp.Tool{
		Name:        "atlas_get_content",
		Description: "Hidrata: lee el código real de los IDs pedidos. Este es el paso 'caro'; pídelo solo para los pocos archivos que de verdad necesitas.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in GetContentInput) (*mcp.CallToolResult, GetContentOutput, error) {
		contents, err := eng.Content(in.IDs)
		if err != nil {
			return fail[GetContentOutput](err)
		}
		var b strings.Builder
		for id, c := range contents {
			fmt.Fprintf(&b, "// ===== %s =====\n%s\n\n", id, c)
		}
		return ok(b.String(), GetContentOutput{Contents: contents})
	})
}

// ── atlas_export_analysis ────────────────────────────────────────────────────

type ExportAnalysisInput struct {
	ID string `json:"id" jsonschema:"id del flujo a exportar; el JSON va a <ATLAS_DATA_DIR>/analysis/<id>.json"`
}
type ExportAnalysisOutput struct {
	ID   string `json:"id"`
	Path string `json:"path"`
}

func registerExportAnalysis(s *mcp.Server, eng *engine.Engine) {
	mcp.AddTool(s, &mcp.Tool{
		Name:        "atlas_export_analysis",
		Description: "Guarda el 'primer análisis' de un flujo como JSON en la carpeta analysis/ (flujo + archivos node-lite + slots de enriquecimiento role/note/summary). PRESERVA el enriquecimiento previo si el archivo ya existe. Base para enriquecer luego.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in ExportAnalysisInput) (*mcp.CallToolResult, ExportAnalysisOutput, error) {
		path, err := eng.ExportAnalysis(in.ID)
		if err != nil {
			return fail[ExportAnalysisOutput](err)
		}
		return ok(fmt.Sprintf("Análisis guardado en %s", path), ExportAnalysisOutput{ID: in.ID, Path: path})
	})
}

// ── atlas_get_analysis ───────────────────────────────────────────────────────

type GetAnalysisInput struct {
	ID string `json:"id" jsonschema:"id del flujo"`
}

func registerGetAnalysis(s *mcp.Server, eng *engine.Engine) {
	mcp.AddTool(s, &mcp.Tool{
		Name:        "atlas_get_analysis",
		Description: "Devuelve el JSON de análisis guardado de un flujo (con el enriquecimiento acumulado). Úsalo para leer y luego enriquecer.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in GetAnalysisInput) (*mcp.CallToolResult, engine.Analysis, error) {
		a, err := eng.GetAnalysis(in.ID)
		if err != nil {
			return fail[engine.Analysis](err)
		}
		return ok(jsonText(a), a)
	})
}

// ── atlas_enrich_analysis ────────────────────────────────────────────────────

type EnrichFile struct {
	ID   string `json:"id" jsonschema:"id del archivo dentro del flujo"`
	Role string `json:"role,omitempty" jsonschema:"qué hace ese archivo en el flujo"`
	Note string `json:"note,omitempty" jsonschema:"nota libre"`
}
type EnrichAnalysisInput struct {
	ID      string       `json:"id" jsonschema:"id del flujo"`
	Summary string       `json:"summary,omitempty" jsonschema:"análisis libre del flujo (reemplaza el summary si se envía)"`
	Files   []EnrichFile `json:"files,omitempty" jsonschema:"enriquecimiento por archivo (role/note)"`
}

func registerEnrichAnalysis(s *mcp.Server, eng *engine.Engine) {
	mcp.AddTool(s, &mcp.Tool{
		Name:        "atlas_enrich_analysis",
		Description: "Enriquece el análisis guardado de un flujo: fija un summary y/o role/note por archivo. Fusiona (no pisa lo no enviado). Si no existe el análisis, lo exporta primero.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in EnrichAnalysisInput) (*mcp.CallToolResult, engine.Analysis, error) {
		fm := map[string][2]string{}
		for _, f := range in.Files {
			fm[f.ID] = [2]string{f.Role, f.Note}
		}
		a, err := eng.EnrichAnalysis(in.ID, in.Summary, fm)
		if err != nil {
			return fail[engine.Analysis](err)
		}
		return ok(fmt.Sprintf("Análisis de %s enriquecido (%d archivos con role/note).", a.Name, len(in.Files)), a)
	})
}

// ── atlas_flow_status ────────────────────────────────────────────────────────

type FlowStatusInput struct {
	ID string `json:"id,omitempty" jsonschema:"id del flujo; vacío = estado de TODOS los flujos"`
}
type FlowStatusOne struct {
	ID       string   `json:"id"`
	Name     string   `json:"name"`
	UpToDate bool     `json:"up_to_date"`
	HasBase  bool     `json:"has_base"`
	Changed  []string `json:"changed,omitempty"`
	Removed  []string `json:"removed,omitempty"`
}
type FlowStatusOutput struct {
	Flows []FlowStatusOne `json:"flows"`
}

func registerFlowStatus(s *mcp.Server, eng *engine.Engine) {
	mcp.AddTool(s, &mcp.Tool{
		Name:        "atlas_flow_status",
		Description: "Dice si un flujo (o todos) sigue AL DÍA vs la línea base guardada, comparando el hash de contenido de cada archivo con el índice actual. Úsalo tras re-escanear los repos para saber qué flujos necesitan re-análisis (Changed/Removed). Re-guardar el flujo (atlas_save_flow) refresca la línea base.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in FlowStatusInput) (*mcp.CallToolResult, FlowStatusOutput, error) {
		names := map[string]string{}
		for _, f := range eng.Flows() {
			names[f.ID] = f.Name
		}
		statuses := eng.FlowStatuses()
		var out FlowStatusOutput
		add := func(id string) {
			st, ok := statuses[id]
			if !ok {
				return
			}
			out.Flows = append(out.Flows, FlowStatusOne{
				ID: id, Name: names[id], UpToDate: st.UpToDate, HasBase: st.HasBase,
				Changed: st.Changed, Removed: st.Removed,
			})
		}
		if in.ID != "" {
			add(in.ID)
		} else {
			for _, f := range eng.Flows() {
				add(f.ID)
			}
		}
		return ok(jsonText(out), out)
	})
}

// ── atlas_combinations ───────────────────────────────────────────────────────

type CombinationsInput struct{}

func registerCombinations(s *mcp.Server, eng *engine.Engine) {
	mcp.AddTool(s, &mcp.Tool{
		Name:        "atlas_combinations",
		Description: "Lista las combinaciones de ramas guardadas con su estado de alineación vs el git actual: por repo, si está en la rama objetivo (aligned), en otra rama (off) o avanzó commits (moved). Úsalo para saber si el 'mapa' de ramas sigue vigente.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, _ CombinationsInput) (*mcp.CallToolResult, any, error) {
		type combo struct {
			engine.Combination
			Status engine.CombStatus `json:"status"`
		}
		var out []combo
		for _, c := range eng.Combinations() {
			st, _ := eng.CombinationStatus(c.ID)
			out = append(out, combo{Combination: c, Status: st})
		}
		return ok(jsonText(out), any(out))
	})
}

// ── atlas_save_combination ───────────────────────────────────────────────────

type SaveCombinationInput struct {
	ID      string            `json:"id,omitempty" jsonschema:"id; vacío para crear (se genera del nombre)"`
	Name    string            `json:"name" jsonschema:"nombre de la combinación, ej 'Producción' o 'Staging'"`
	Targets map[string]string `json:"targets" jsonschema:"mapa repo→rama objetivo, ej {\"legacy-backend\":\"main\",\"application\":\"main\"}"`
}

func registerSaveCombination(s *mcp.Server, eng *engine.Engine) {
	mcp.AddTool(s, &mcp.Tool{
		Name:        "atlas_save_combination",
		Description: "Guarda una combinación de ramas (repo→rama). Captura la línea base (commit por repo que ya esté en su rama objetivo). Aparece en vivo en la UI de Atlas.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in SaveCombinationInput) (*mcp.CallToolResult, engine.Combination, error) {
		cb, err := eng.SaveCombination(in.ID, in.Name, in.Targets)
		if err != nil {
			return fail[engine.Combination](err)
		}
		return ok(fmt.Sprintf("Combinación guardada: %s (%d repos).", cb.Name, len(cb.Targets)), cb)
	})
}

// ── atlas_tree ───────────────────────────────────────────────────────────────

type TreeInput struct {
	Flow        string `json:"flow,omitempty" jsonschema:"id de un flujo → árbol de ese flujo"`
	Combination string `json:"combination,omitempty" jsonschema:"id de una combinación → árbol del FLUJO COMPLETO (unión de sus flujos)"`
}
type TreeOutput struct {
	Text string `json:"text"`
}

func registerTree(s *mcp.Server, eng *engine.Engine) {
	mcp.AddTool(s, &mcp.Tool{
		Name:        "atlas_tree",
		Description: "Devuelve el árbol estilo Rino (estructura de carpetas + contenido inline colapsado) de un flujo (flow) o del flujo completo de una combinación (combination = unión dedup de sus flujos). Es el blob pegable a un LLM. Sin UI.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in TreeInput) (*mcp.CallToolResult, TreeOutput, error) {
		var text string
		switch {
		case in.Combination != "":
			text = eng.ComboTree(in.Combination)
		case in.Flow != "":
			text = eng.FlowTree(in.Flow)
		default:
			return fail[TreeOutput](fmt.Errorf("indicá 'flow' o 'combination'"))
		}
		return ok(text, TreeOutput{Text: text})
	})
}
