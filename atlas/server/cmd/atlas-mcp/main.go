// Command atlas-mcp es un servidor MCP (stdio) que expone el mapa de repos y
// los flujos de Atlas. Un host MCP (Claude, Cursor…) lo usa para:
//
//  1. escanear uno o varios repos          → atlas_scan
//  2. ver el mapa barato (node-lite)        → atlas_map
//  3. seguir conexiones entre archivos/repos→ atlas_connections
//  4. GUARDAR un flujo (array de IDs)       → atlas_save_flow
//  5. leer/listar flujos ya guardados       → atlas_list_flows / atlas_get_flow
//  6. hidratar el código de unos IDs        → atlas_get_content
//
// Comparte el directorio de datos con el server web (ATLAS_DATA_DIR, por
// defecto ~/.creditop-atlas): lo que el host guarda aquí, la UI lo muestra.
package main

import (
	"context"
	"log"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"creditop/atlas/server/internal/engine"
)

func main() {
	log.SetFlags(0)
	log.SetPrefix("[atlas-mcp] ")

	eng, err := engine.New()
	if err != nil {
		log.Fatalf("engine: %v", err)
	}

	server := mcp.NewServer(&mcp.Implementation{
		Name:    "creditop-atlas",
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

	log.Printf("iniciado (datos: %s); esperando peticiones MCP por stdio…", eng.Dir())
	if err := server.Run(context.Background(), &mcp.StdioTransport{}); err != nil {
		log.Fatalf("el servidor terminó con error: %v", err)
	}
}
