// Validador de tráfico para pdf-mapper-service.
//
// Define los endpoints PROPIOS de este servicio y delega la mecánica de carga
// al motor compartido (validator/internal/engine). Para validar otro servicio,
// crea otra carpeta con su main.go y sus escenarios.
//
// Uso:
//
//	go run ./pdf-mapper-service --rate 15 --duration 3m
//	go run ./pdf-mapper-service --url http://localhost:8080 --external
package main

import (
	_ "embed"

	"validator/internal/engine"
)

// .env embebido: define VALIDATOR_URL por defecto. Se carga sin importar el CWD
// desde el que ejecutes `go run`. Override con --url o exportando VALIDATOR_URL.
//
//go:embed .env
var dotenv string

// Fallback por si el .env no define VALIDATOR_URL.
const fallbackURL = "http://pdf-mapper-service.inertia-develop:8080"

func main() {
	engine.LoadDotenv(dotenv)
	engine.Run(engine.Options{
		DefaultURL: fallbackURL,
		Scenarios: []engine.Scenario{
			// 2xx
			{Name: "health 200", Method: "GET", Path: "/health", Weight: 40},
			{Name: "list projects 200", Method: "GET", Path: "/api/projects", Weight: 15},
			{Name: "list documents 200", Method: "GET", Path: "/api/projects/demo/documents", Weight: 10},
			{Name: "doc status 200", Method: "GET", Path: "/api/projects/demo/documents/missing/status", Weight: 8},
			// 404
			{Name: "template 404", Method: "GET", Path: "/api/projects/demo/documents/missing/template", Weight: 7},
			{Name: "mapper 404", Method: "GET", Path: "/api/projects/demo/documents/missing/mapper", Weight: 5},
			// 200/404 según exista el catálogo
			{Name: "catalog (200/404)", Method: "GET", Path: "/api/fields", Weight: 4},
			// 400
			{
				Name: "merge-urls bad json 400", Method: "POST", Path: "/api/merge-urls",
				Body: "{not-json", ContentType: "application/json", Weight: 4,
			},
			{
				Name: "merge-urls empty 400", Method: "POST", Path: "/api/merge-urls",
				Body: `{"urls":[]}`, ContentType: "application/json", Weight: 3,
			},
			// 500 (el server intenta descargar 127.0.0.1:9 -> refused, rápido)
			{
				Name: "merge-urls fetch fail 500", Method: "POST", Path: "/api/merge-urls",
				Body: `{"urls":["http://127.0.0.1:9/x.pdf"]}`, ContentType: "application/json", Weight: 3,
			},
			// 200 con latencia alta (requiere egress: --external)
			{
				Name: "merge-urls real 200 (lento)", Method: "POST", Path: "/api/merge-urls",
				Body: `{"urls":[` +
					`"https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",` +
					`"https://upload.wikimedia.org/wikipedia/commons/3/3a/Cat03.jpg",` +
					`"https://pdfobject.com/pdf/sample.pdf"]}`,
				ContentType: "application/json", Weight: 5, External: true,
			},
		},
	})
}
