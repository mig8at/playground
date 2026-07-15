// Command context-mcp es un servidor MCP (stdio) que expone el mapa de repos y
// los flujos de Context. Un host MCP (Claude, Cursor…) lo usa para:
//
//  1. escanear uno o varios repos          → context_scan
//  2. ver el mapa barato (node-lite)        → context_map
//  3. seguir conexiones entre archivos/repos→ context_connections
//  4. GUARDAR un flujo (array de IDs)       → context_save_flow
//  5. leer/listar flujos ya guardados       → context_list_flows / context_get_flow
//  6. hidratar el código de unos IDs        → context_get_content
//
// Comparte el directorio de datos con el server web (CONTEXT_DATA_DIR, por
// defecto ~/.creditop-context): lo que el host guarda aquí, la UI lo muestra.
package main

import (
	"context"
	"log"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"creditop/context/server/internal/engine"
)

func main() {
	log.SetFlags(0)
	log.SetPrefix("[context-mcp] ")

	eng, err := engine.New()
	if err != nil {
		log.Fatalf("engine: %v", err)
	}

	server := mcp.NewServer(&mcp.Implementation{
		Name:    "creditop-context",
		Version: "0.1.0",
	}, nil)

	registerScan(server, eng)
	registerMap(server, eng)
	registerConnections(server, eng)
	registerSaveFlow(server, eng)
	registerListFlows(server, eng)
	registerGetFlow(server, eng)
	registerGetContent(server, eng)
	registerExportAnalysis(server, eng)
	registerGetAnalysis(server, eng)
	registerEnrichAnalysis(server, eng)
	registerFlowStatus(server, eng)
	registerCombinations(server, eng)
	registerSaveCombination(server, eng)
	registerTree(server, eng)

	log.Printf("iniciado (datos: %s); esperando peticiones MCP por stdio…", eng.Dir())
	if err := server.Run(context.Background(), &mcp.StdioTransport{}); err != nil {
		log.Fatalf("el servidor terminó con error: %v", err)
	}
}
