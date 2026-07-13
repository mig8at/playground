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
		f, err := eng.SaveFlow(in.ID, in.Name, in.Description, in.NodeIDs)
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
