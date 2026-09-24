// Package gemini es la conexión del playground con la API de Gemini: la llave, el modelo, las llamadas y
// el bucle de function calling. No sabe nada de CreditOp a propósito: quien lo use le pasa sus
// herramientas y su pregunta, y esto se encarga de la mecánica.
//
// Vivía en `workers/gemini.py` y se mudó acá el 2026-09-24, cuando workers se retiró: la conexión se
// quedó porque sirve para lo que venga; los agentes de workers, no.
//
// CÓMO ES EL BUCLE, que es todo el secreto:
//
//  1. se manda la pregunta + la declaración de las herramientas;
//  2. el modelo contesta con una `functionCall` («corré tal herramienta con tales argumentos») o con texto;
//  3. si pidió función, LA CORRE EL CÓDIGO, no el modelo, y le devuelve el resultado como
//     `functionResponse`; se vuelve al paso 2 con la conversación acumulada;
//  4. termina cuando contesta texto, cuando una herramienta TERMINAL entrega, o cuando se acaban los pasos.
//
// El modelo NUNCA ejecuta nada: elige qué se ejecuta, y el código decide qué existe y qué hace.
package gemini

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"creditop/playground/connectors/env"
)

// API es la base de la API de Gemini (una variable para que las pruebas la apunten a un servidor falso).
var API = "https://generativelanguage.googleapis.com/v1beta"

// Timeout: ⚠ 300 s y no 120. Un agente acumula TODO en la conversación —cada resultado de herramienta—, y
// las últimas vueltas mandan un payload grande y tardan: con 120 s se cortaba en el paso 5, después de
// haber hecho bien el trabajo. Si igual se corta, el problema no es el tope sino cuánto se acumula.
const Timeout = 300 * time.Second

// DefaultModel es el modelo cuando `GEMINI_MODEL` no dice otro.
const DefaultModel = "gemini-2.5-flash"

// Config es la cuenta de Gemini. No depende del ambiente: vive en `connectors/.env`.
type Config struct {
	Key      string
	Model    string
	MaxSteps int
	File     string
}

// LoadConfig lee `GEMINI_API_KEY`, `GEMINI_MODEL` y `MAX_PASOS` de `connectors/.env` (el proceso gana).
func LoadConfig() (Config, error) {
	v, err := env.LoadShared()
	if err != nil {
		return Config{}, err
	}
	c := Config{Key: v.Get("GEMINI_API_KEY"), Model: v.Get("GEMINI_MODEL"), MaxSteps: 12, File: v.File}
	if c.Model == "" {
		c.Model = DefaultModel
	}
	if n, err := strconv.Atoi(v.Get("MAX_PASOS")); err == nil && n > 0 {
		c.MaxSteps = n
	}
	if c.Key == "" {
		return c, errors.New("falta GEMINI_API_KEY en connectors/.env: sacá una en https://aistudio.google.com/apikey")
	}
	return c, nil
}

// Client habla con la API.
type Client struct {
	HTTP   *http.Client
	Config Config
}

// New arma el cliente.
func New(c Config) *Client { return &Client{HTTP: &http.Client{Timeout: Timeout}, Config: c} }

// request hace una llamada. La llave va en una CABECERA (`x-goog-api-key`) y no en la URL, como iba en
// Python: en la URL queda en cualquier log que registre direcciones.
func (cl *Client) request(path string, body any, dest any) error {
	var r io.Reader
	method := http.MethodGet
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return err
		}
		r, method = bytes.NewReader(raw), http.MethodPost
	}
	req, err := http.NewRequest(method, API+"/"+path, r)
	if err != nil {
		return err
	}
	req.Header.Set("x-goog-api-key", cl.Config.Key)
	req.Header.Set("Content-Type", "application/json")
	resp, err := cl.HTTP.Do(req)
	if err != nil {
		var ne net.Error
		if errors.As(err, &ne) && ne.Timeout() {
			return fmt.Errorf("la API no contestó en %s. Casi siempre es que la conversación se hizo grande: "+
				"cada herramienta que corre queda acumulada. Leé rangos en vez de archivos enteros, o acotá la "+
				"pregunta; subir el tope tapa el síntoma, no la causa", Timeout)
		}
		return fmt.Errorf("no se pudo llegar a la API: %w", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<20))
	if resp.StatusCode/100 != 2 {
		return explain(resp.StatusCode, raw)
	}
	return json.Unmarshal(raw, dest)
}

// explain desenvuelve el error de la API y traduce los casos que de verdad pasan: un mensaje que no dice
// la verdad cuesta media hora.
func explain(code int, raw []byte) error {
	detail := string(raw)
	if len(detail) > 400 {
		detail = detail[:400]
	}
	var e struct {
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if json.Unmarshal(raw, &e) == nil && e.Error.Message != "" {
		detail = e.Error.Message
	}
	switch {
	case (code == 400 || code == 403) && strings.Contains(detail, "API key"):
		return fmt.Errorf("la API key no sirve (%d): %s", code, detail)
	case code == 404:
		return fmt.Errorf("el modelo no existe o tu key no lo tiene habilitado (%d): %s. `bin/pg gemini models` "+
			"lista los que SÍ podés usar; poné uno en GEMINI_MODEL", code, detail)
	case code == 429:
		return fmt.Errorf("cuota agotada o demasiadas llamadas (%d): %s", code, detail)
	}
	return fmt.Errorf("HTTP %d: %s", code, detail)
}

// Model es un modelo que la llave puede usar para generar.
type Model struct {
	Name        string `json:"name"`
	DisplayName string `json:"displayName"`
}

// Models: los modelos que ESTA llave puede usar hoy, contra suponer un nombre que ya no existe.
func (cl *Client) Models() ([]Model, error) {
	var r struct {
		Models []struct {
			Name        string   `json:"name"`
			DisplayName string   `json:"displayName"`
			Methods     []string `json:"supportedGenerationMethods"`
		} `json:"models"`
	}
	if err := cl.request("models", nil, &r); err != nil {
		return nil, err
	}
	var out []Model
	for _, m := range r.Models {
		for _, g := range m.Methods {
			if g == "generateContent" {
				out = append(out, Model{strings.TrimPrefix(m.Name, "models/"), m.DisplayName})
				break
			}
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

// Tool es una herramienta que el modelo puede pedir: su declaración (el esquema que ve: name,
// description, parameters) y lo que se ejecuta de verdad.
type Tool struct {
	Declaration map[string]any
	Run         func(args map[string]any) (any, error)
	// Terminal: se ejecuta y su resultado ES la respuesta. Sirve para que la salida sea ESTRUCTURADA: el
	// modelo no «escribe» una lista, llama a una función con la lista, y llega tipada.
	Terminal bool
}

type part = map[string]any

// Ask corre el bucle hasta que el modelo conteste, una herramienta terminal entregue, o se acaben los
// pasos. `trace` (puede ser nil) recibe cada paso, para que se vea cuánto se acumula.
func (cl *Client) Ask(question, instructions string, tools map[string]Tool, trace func(string)) (any, error) {
	say := func(format string, args ...any) {
		if trace != nil {
			trace(fmt.Sprintf(format, args...))
		}
	}
	contents := []map[string]any{{"role": "user", "parts": []part{{"text": question}}}}
	base := map[string]any{}
	if len(tools) > 0 {
		names := make([]string, 0, len(tools))
		for n := range tools {
			names = append(names, n)
		}
		sort.Strings(names)
		decls := make([]map[string]any, 0, len(names))
		for _, n := range names {
			decls = append(decls, tools[n].Declaration)
		}
		base["tools"] = []map[string]any{{"function_declarations": decls}}
	}
	if instructions != "" {
		base["system_instruction"] = map[string]any{"parts": []part{{"text": instructions}}}
	}
	for step := 1; step <= cl.Config.MaxSteps; step++ {
		body := map[string]any{"contents": contents}
		for k, v := range base {
			body[k] = v
		}
		if raw, err := json.Marshal(contents); err == nil {
			say("(%d KB acumulados)", len(raw)/1024)
		}
		var r struct {
			Candidates []struct {
				Content struct {
					Parts []part `json:"parts"`
				} `json:"content"`
			} `json:"candidates"`
		}
		if err := cl.request("models/"+cl.Config.Model+":generateContent", body, &r); err != nil {
			return nil, err
		}
		if len(r.Candidates) == 0 {
			// Sin candidatos suele ser un filtro de seguridad: decirlo es mejor que devolver vacío.
			return nil, errors.New("la API no devolvió candidatos (¿un filtro de seguridad?)")
		}
		parts := r.Candidates[0].Content.Parts
		var calls []map[string]any
		for _, p := range parts {
			if fc, ok := p["functionCall"].(map[string]any); ok {
				calls = append(calls, fc)
			}
		}
		if len(calls) == 0 {
			var text strings.Builder
			for _, p := range parts {
				if t, ok := p["text"].(string); ok {
					text.WriteString(t)
				}
			}
			say("contestó en el paso %d", step)
			if s := strings.TrimSpace(text.String()); s != "" {
				return s, nil
			}
			return "(el modelo no devolvió texto)", nil
		}
		contents = append(contents, map[string]any{"role": "model", "parts": parts})
		var responses []part
		for _, fc := range calls {
			name, _ := fc["name"].(string)
			args, _ := fc["args"].(map[string]any)
			say("[%d] %s(%v)", step, name, args)
			var result any
			tool, ok := tools[name]
			if !ok {
				result = map[string]any{"error": "no existe la herramienta '" + name + "'"}
			} else if out, err := tool.Run(args); err != nil {
				// El error se le DEVUELVE al modelo en vez de reventar: así puede corregir el argumento y
				// reintentar, que es media gracia de tener un bucle.
				result = map[string]any{"error": err.Error()}
			} else {
				if tool.Terminal {
					say("entregó en el paso %d", step)
					return out, nil
				}
				result = out
			}
			responses = append(responses, part{"functionResponse": map[string]any{
				"name": name, "response": map[string]any{"result": result}}})
		}
		contents = append(contents, map[string]any{"role": "user", "parts": responses})
	}
	return nil, fmt.Errorf("sin respuesta: se agotaron los %d pasos. Subí MAX_PASOS, o mirá si el modelo pide "+
		"la misma herramienta en círculo — suele ser una descripción que no dice bien qué devuelve", cl.Config.MaxSteps)
}
