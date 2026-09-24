package main

// `pg mcp`: los mismos comandos de pg como herramientas MCP, por stdio.
//
// POR QUÉ ASÍ. Hasta el 2026-09-24 había dos servidores escritos a mano, `jira-mcp` y `slack-mcp`, cada
// uno con sus herramientas copiadas de lo que ya hacía el cliente — y ninguno llegaba a la base, a Loki,
// a PostHog ni a Confluence. Acá una herramienta ES un comando del registro (`registry.go`): su esquema
// sale de los parámetros que el comando declara, y llamarla corre ese comando. Agregar un comando lo
// agrega en la consola, en la ayuda, en el catálogo del hook de inicio y acá, sin escribir nada más.
//
// Y corre el comando como un PROCESO APARTE, no una función: la salida, el código de salida y los
// mensajes de error son exactamente los de la consola, y una herramienta que se cuelga o entra en pánico
// no se lleva puesto al servidor.
//
// ⚠ Las que escriben (Write) llevan el parámetro `apply`: sin él devuelven la vista previa. Es la
// misma regla que en la consola, y no es cosmética: el modelo ve lo que va a pasar ANTES de hacerlo.

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// toolTimeout: lo más que espera una herramienta. Una consulta a prod por Redash puede tardar.
const toolTimeout = 3 * time.Minute

// maxToolOutput: lo que se le devuelve al modelo. Más que esto se corta, y se dice.
const maxToolOutput = 200_000

func toolName(c command) string { return strings.NewReplacer(" ", "_", "-", "_").Replace(c.Name) }

func propName(p param) string { return strings.ReplaceAll(p.Name, "-", "_") }

// toolSchema es el esquema JSON del input, derivado de los parámetros del comando.
func toolSchema(c command) map[string]any {
	props := map[string]any{}
	var required []string
	for _, p := range c.Params {
		prop := map[string]any{"type": p.Type, "description": p.Desc}
		if len(p.Enum) > 0 {
			prop["enum"] = p.Enum
		}
		props[propName(p)] = prop
		if p.Required {
			required = append(required, propName(p))
		}
	}
	if c.Write {
		props["apply"] = map[string]any{"type": "boolean",
			"description": "false (default): devuelve la vista previa, sin escribir nada. true: lo hace."}
	}
	schema := map[string]any{"type": "object", "properties": props, "additionalProperties": false}
	if len(required) > 0 {
		schema["required"] = required
	}
	return schema
}

func toolDescription(c command) string {
	d := c.Summary + ". Equivale a: " + c.Usage
	if c.Write {
		d += ". ⚠ ESCRIBE hacia afuera: sin apply=true sólo muestra lo que haría, y el texto pasa por el guard."
	}
	return d
}

// argv arma la línea de comando a partir de los argumentos del modelo. Lo que no está declarado se
// rechaza: un argumento que se ignora en silencio hace creer que se aplicó.
func argv(c command, raw json.RawMessage) ([]string, error) {
	in := map[string]any{}
	if len(bytes.TrimSpace(raw)) > 0 {
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, fmt.Errorf("argumentos inválidos: %v", err)
		}
	}
	args := strings.Fields(c.Name)
	var positional []string
	known := map[string]bool{}
	for _, p := range c.Params {
		name := propName(p)
		known[name] = true
		v, ok := in[name]
		if !ok || v == nil {
			if p.Required {
				return nil, fmt.Errorf("falta %s", name)
			}
			continue
		}
		var text string
		switch x := v.(type) {
		case string:
			text = x
		case bool:
			if p.Type != "boolean" {
				return nil, fmt.Errorf("%s no es booleano", name)
			}
			if x {
				args = append(args, "--"+p.Name)
			}
			continue
		case float64:
			if p.Type != "integer" || x != float64(int64(x)) {
				return nil, fmt.Errorf("%s tiene que ser un entero", name)
			}
			text = strconv.FormatInt(int64(x), 10)
		default:
			return nil, fmt.Errorf("%s: tipo no soportado", name)
		}
		if p.Positional {
			positional = append(positional, text)
		} else {
			args = append(args, "--"+p.Name, text)
		}
	}
	if c.Write {
		known["apply"] = true
		if v, ok := in["apply"].(bool); ok && v {
			args = append(args, "--apply")
		}
	}
	for k := range in {
		if !known[k] {
			return nil, fmt.Errorf("parámetro desconocido: %s", k)
		}
	}
	return append(args, positional...), nil
}

// runTool corre el comando como proceso aparte y devuelve lo que imprimió.
func runTool(ctx context.Context, self string, args []string) (string, bool) {
	ctx, cancel := context.WithTimeout(ctx, toolTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, self, args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	err := cmd.Run()
	out := stdout.String()
	if s := strings.TrimSpace(stderr.String()); s != "" {
		if out != "" && !strings.HasSuffix(out, "\n") {
			out += "\n"
		}
		out += s
	}
	if len(out) > maxToolOutput {
		out = out[:maxToolOutput] + fmt.Sprintf("\n… (cortado: %d bytes en total; acotá la consulta)", len(out))
	}
	if ctx.Err() == context.DeadlineExceeded {
		return out + fmt.Sprintf("\n(se cortó a los %s)", toolTimeout), true
	}
	if strings.TrimSpace(out) == "" {
		out = "(sin salida)"
	}
	return out, err != nil
}

// tools son los comandos que se ofrecen como herramienta.
func tools() []command {
	var out []command
	for _, c := range commands {
		if !c.NoTool {
			out = append(out, c)
		}
	}
	return out
}

func runMCP(args []string) int {
	self, err := os.Executable()
	if err != nil {
		return fail(1, "no sé dónde estoy: %v", err)
	}
	server := mcp.NewServer(&mcp.Implementation{Name: "playground", Version: "1.0.0"}, nil)
	for _, c := range tools() {
		c := c
		server.AddTool(&mcp.Tool{Name: toolName(c), Description: toolDescription(c), InputSchema: toolSchema(c)},
			func(ctx context.Context, req *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
				a, err := argv(c, req.Params.Arguments)
				if err != nil {
					return &mcp.CallToolResult{IsError: true, Content: []mcp.Content{&mcp.TextContent{Text: err.Error()}}}, nil
				}
				text, failed := runTool(ctx, self, a)
				return &mcp.CallToolResult{IsError: failed, Content: []mcp.Content{&mcp.TextContent{Text: text}}}, nil
			})
	}
	if err := server.Run(context.Background(), &mcp.StdioTransport{}); err != nil {
		return fail(1, "%v", err)
	}
	return 0
}
