package main

// EL CONTACTO PARA LA PROPUESTA: Claude busca en internet, con `claude -p` y SÓLO dos herramientas (WebSearch y
// WebFetch), el canal por el que la empresa recibe propuestas de un proveedor —alianzas, compras, comercial— y, si no
// existe, el comercial general. Cada dato viene con la URL donde aparece. Es Claude Code de consola con la sesión de
// Miguel (como el resumen de Correo): gasta el asiento del plan; medido el 2026-11-21, entre 80 y 95 s y el equivalente
// a US$0,40–0,48 por empresa.
//
// Corre desde una carpeta neutra (sin el CLAUDE.md ni los hooks de my-tools), sin MCP, y sin las variables de una
// sesión de Claude Code anfitriona (con ellas el hijo se cree parte de esa sesión y falla la autenticación).

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// Contact: un canal de la empresa, con a qué área llega y dónde se vio.
type Contact struct {
	Channel string `json:"channel"` // email · phone · whatsapp · form
	Value   string `json:"value"`
	Area    string `json:"area"`
	Fit     string `json:"fit"`    // proposals (recibe propuestas de aliados) · commercial · general
	Source  string `json:"source"` // la URL exacta
}

// Research: lo que devolvió una búsqueda.
type Research struct {
	Matched bool     `json:"matched"`
	Brands  []string `json:"brands,omitempty"`
	// Client: si por su marca o su sitio resultó ser un comercio que ya trabaja con CreditOp (con ese nombre).
	Client   string    `json:"client,omitempty"`
	Website  string    `json:"website"`
	Summary  string    `json:"summary"`
	Contacts []Contact `json:"contacts"`
	At       string    `json:"at"`
	Seconds  int       `json:"seconds"`
	CostUSD  float64   `json:"costUsd"`
}

const researchSchema = `{"type":"object","properties":{
 "matched":{"type":"boolean","description":"si encontraste la empresa y es la misma"},
 "brands":{"type":"array","items":{"type":"string"},"description":"los nombres comerciales o marcas con que vende (ej. la razón social Inversiones Crear Rama vende como Dentisalud)"},
 "website":{"type":"string","description":"el sitio oficial, o vacío si no tiene"},
 "summary":{"type":"string","description":"en español, 1 a 3 frases: qué es la empresa y qué canal conviene usar para la propuesta"},
 "contacts":{"type":"array","items":{"type":"object","properties":{
   "channel":{"type":"string","enum":["email","phone","whatsapp","form"]},
   "value":{"type":"string"},
   "area":{"type":"string","description":"a qué área llega: alianzas, compras, comercial, servicio al cliente, general..."},
   "fit":{"type":"string","enum":["proposals","commercial","general"],"description":"proposals: el área que recibe propuestas de aliados o proveedores; commercial: ventas o comercial; general: contacto general"},
   "source":{"type":"string","description":"la URL exacta donde aparece"}
 },"required":["channel","value","area","fit","source"]}}
},"required":["matched","website","summary","contacts"]}`

func researchPrompt(c *Company) string {
	var b strings.Builder
	co := countryOf(c.Country)
	fmt.Fprintf(&b, "Investigá en internet esta empresa %s y encontrá el canal oficial por el que recibe propuestas comerciales B2B de un proveedor (una fintech que ofrece financiación a crédito para sus clientes en el punto de venta y en línea).\n\n", co.Adjective)
	fmt.Fprintf(&b, "Empresa: %s\nPaís: %s\n", c.Name, co.Name)
	if c.NIT != "" {
		fmt.Fprintf(&b, "%s: %s\n", co.TaxID, c.NIT)
	}
	if s := sectorByID(c.Sector); s != nil {
		fmt.Fprintf(&b, "Sector: %s\n", s.Name)
	}
	if c.Points > 0 {
		fmt.Fprintf(&b, "Establecimientos activos: %d\n", c.Points)
	}
	if c.Region != "" {
		fmt.Fprintf(&b, "Ciudad: %s\n", c.Region)
	}
	if c.Website != "" {
		fmt.Fprintf(&b, "Sitio conocido: %s\n", c.Website)
	}
	b.WriteString(`
Lo que busco, en este orden de preferencia:
1. El correo o teléfono del área que recibe propuestas de aliados o proveedores: alianzas, convenios, compras, comercial corporativo, mercadeo, gerencia comercial, o "proveedores / trabaja con nosotros".
2. Si no existe, el canal comercial general de la empresa (ventas@, contacto@, el WhatsApp o la línea que publica).

Reglas:
- Sólo fuentes oficiales de la empresa (su sitio web, sus redes verificadas) o directorios empresariales públicos. Cada dato con la URL exacta donde lo viste.
- No inventes nada. Si no lo encontraste, no lo pongas.
- No uses el correo de notificación judicial del registro mercantil ni el de la entidad tributaria.
- No pongas correos o celulares personales de empleados salvo que la empresa los publique como contacto comercial.
- Revisá las páginas de contacto, sedes, post-venta y el pie de página del sitio: los enlaces de WhatsApp (wa.me) y los mailto suelen estar ahí.
- El valor de cada canal es el dato exacto: un correo completo o un número con todos sus dígitos. Un usuario de Instagram o una red social no es un canal.
- Confirmá que la empresa es la misma (nombre, ciudad, actividad).
`)
	return b.String()
}

// claudeBinary: SABUESO_CLAUDE, `claude` en el PATH, o los lugares de siempre (un LaunchAgent no trae el PATH).
func claudeBinary() (string, error) {
	if p := os.Getenv("SABUESO_CLAUDE"); p != "" {
		return p, nil
	}
	if p, err := exec.LookPath("claude"); err == nil {
		return p, nil
	}
	home, _ := os.UserHomeDir()
	for _, p := range []string{filepath.Join(home, ".local", "bin", "claude"), "/opt/homebrew/bin/claude", "/usr/local/bin/claude"} {
		if st, err := os.Stat(p); err == nil && !st.IsDir() {
			return p, nil
		}
	}
	return "", errors.New("no encuentro Claude Code (`claude`): instalalo o indicá el binario con SABUESO_CLAUDE")
}

// runClaude corre `claude -p` con sólo WebSearch y WebFetch, la instrucción por stdin y la salida atada a un esquema
// JSON. Devuelve el JSON, cuánto costó (equivalente) y cuánto tardó.
func runClaude(ctx context.Context, prompt, schema string) (json.RawMessage, float64, int, error) {
	return runClaudeWith(ctx, prompt, schema)
}

// runClaudeWith: como runClaude, con reglas de permiso que niegan herramientas o dominios
// («WebFetch(domain:linkedin.com)»): las niega el permiso, no la instrucción.
func runClaudeWith(ctx context.Context, prompt, schema string, deny ...string) (json.RawMessage, float64, int, error) {
	bin, err := claudeBinary()
	if err != nil {
		return nil, 0, 0, err
	}
	dir := filepath.Join(os.TempDir(), "sabueso-claude")
	_ = os.MkdirAll(dir, 0o700)
	ctx, cancel := context.WithTimeout(ctx, 8*time.Minute)
	defer cancel()
	model := os.Getenv("SABUESO_CLAUDE_MODEL")
	if model == "" {
		model = "sonnet"
	}
	cmd := exec.CommandContext(ctx, bin, "-p", "--output-format", "json", "--model", model,
		"--tools", "WebSearch", "WebFetch", "--allowedTools", "WebSearch", "WebFetch",
		"--strict-mcp-config", "--disable-slash-commands", "--json-schema", schema)
	if len(deny) > 0 {
		cmd.Args = append(cmd.Args, append([]string{"--disallowedTools"}, deny...)...)
	}
	cmd.Dir = dir
	cmd.Stdin = strings.NewReader(prompt)
	for _, kv := range os.Environ() {
		k := kv[:strings.IndexByte(kv, '=')]
		if (strings.HasPrefix(k, "CLAUDE_CODE_") || k == "CLAUDECODE" || k == "CLAUDE_AGENT_SDK_VERSION" || k == "ANTHROPIC_BASE_URL") && k != "CLAUDE_CODE_OAUTH_TOKEN" {
			continue
		}
		cmd.Env = append(cmd.Env, kv)
	}
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	start := time.Now()
	if err := cmd.Run(); err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = strings.TrimSpace(stdout.String())
		}
		return nil, 0, 0, fmt.Errorf("claude -p: %v %.300s", err, msg)
	}
	var out struct {
		IsError    bool            `json:"is_error"`
		Result     string          `json:"result"`
		Structured json.RawMessage `json:"structured_output"`
		Cost       float64         `json:"total_cost_usd"`
	}
	if err := json.Unmarshal(stdout.Bytes(), &out); err != nil {
		return nil, 0, 0, fmt.Errorf("claude -p devolvió algo que no es JSON: %.200s", stdout.String())
	}
	if out.IsError {
		return nil, 0, 0, fmt.Errorf("claude -p: %s", out.Result)
	}
	raw := out.Structured
	if len(raw) == 0 {
		raw = json.RawMessage(out.Result)
	}
	return raw, out.Cost, int(time.Since(start).Seconds()), nil
}

// research corre la búsqueda del contacto. Puede tardar un par de minutos.
var research = func(ctx context.Context, c *Company) (*Research, error) {
	raw, cost, secs, err := runClaude(ctx, researchPrompt(c), researchSchema)
	if err != nil {
		return nil, err
	}
	var r Research
	if err := json.Unmarshal(raw, &r); err != nil {
		return nil, fmt.Errorf("la respuesta no trae el JSON pedido: %.200s", string(raw))
	}
	r.At, r.Seconds, r.CostUSD = now(), secs, cost
	r.Website = cleanWebsite(r.Website)
	var clean []Contact
	for _, ct := range r.Contacts {
		ct.Value = strings.TrimSpace(ct.Value)
		if validContact(ct) {
			clean = append(clean, ct)
		}
	}
	// Lo que el sitio publica como enlace, leído sin modelo, va primero: es exacto.
	site := r.Website
	if site == "" {
		site = c.Website
	}
	r.Contacts = mergeContacts(readSite(ctx, site), clean)
	if r.Contacts == nil {
		r.Contacts = []Contact{}
	}
	return &r, nil
}

func cleanWebsite(s string) string {
	s = strings.TrimSpace(s)
	low := strings.ToLower(s)
	if s == "" || strings.Contains(low, "no encontr") || strings.Contains(low, "no tiene") || !strings.Contains(s, ".") {
		return ""
	}
	return s
}

var fitRank = map[string]int{"proposals": 0, "commercial": 1, "general": 2}

// best: el canal a usar primero: el del área de propuestas, después el comercial, después el general; a igual
// nivel, correo antes que WhatsApp, teléfono y formulario.
func best(cs []Contact) *Contact {
	chRank := map[string]int{"email": 0, "whatsapp": 1, "phone": 2, "form": 3}
	var b *Contact
	for i := range cs {
		c := &cs[i]
		if b == nil || fitRank[c.Fit] < fitRank[b.Fit] || (fitRank[c.Fit] == fitRank[b.Fit] && chRank[c.Channel] < chRank[b.Channel]) {
			b = c
		}
	}
	return b
}

var channelName = map[string]string{"email": "Correo", "phone": "Teléfono", "whatsapp": "WhatsApp", "form": "Formulario"}

// applyResearch guarda lo encontrado en la empresa y lo deja en su bitácora.
func applyResearch(c *Company, r *Research) {
	c.Research = r
	if r.Website != "" && c.Website == "" {
		c.Website = r.Website
	}
	for _, ct := range r.Contacts {
		switch ct.Channel {
		case "email":
			if c.Email == "" {
				c.Email = ct.Value
			}
		case "phone", "whatsapp":
			if c.Phone == "" {
				c.Phone = ct.Value
			}
		}
	}
	if r.Client != "" {
		c.log("research", "Ya es comercio de CreditOp: "+r.Client+". "+r.Summary)
		return
	}
	if b := best(r.Contacts); b != nil {
		c.log("research", fmt.Sprintf("Contacto para la propuesta: %s %s (%s). %s", strings.ToLower(channelName[b.Channel]), b.Value, b.Area, r.Summary))
	} else if !r.Matched {
		c.log("research", "No encontró la empresa en internet. "+r.Summary)
	} else {
		c.log("research", "Sin canal público para la propuesta. "+r.Summary)
	}
}

// clientByBrand: si la empresa ya es comercio de CreditOp por alguna de sus marcas o por el nombre de su sitio
// (dentisalud.com.co → «dentisalud»). Devuelve el nombre con que está en CreditOp.
func clientByBrand(m *Measured, c *Company, r *Research) string {
	if m == nil {
		return ""
	}
	names := append([]string{}, r.Brands...)
	if host := hostStem(r.Website); host != "" {
		names = append(names, host)
	}
	for _, n := range names {
		if cl := m.IsClient("", n); cl != "" {
			return cl
		}
	}
	// El sitio puede traer el nombre del cliente con algo adelante: «clinicasodontofamily» contiene «odontofamily».
	if stem := hostStem(r.Website); stem != "" {
		for _, cl := range m.Clients {
			if n := strings.ReplaceAll(normalizeName(cl.Name), " ", ""); len(n) >= 6 && strings.Contains(stem, n) {
				return cl.Name
			}
		}
	}
	return ""
}

// hostStem: el nombre de un sitio sin www, sin el dominio y sin prefijos de ruido («clinicasodontofamily.com» →
// «clinicasodontofamily»).
func hostStem(site string) string {
	site = strings.TrimSpace(strings.ToLower(site))
	site = strings.TrimPrefix(strings.TrimPrefix(site, "https://"), "http://")
	site = strings.TrimPrefix(site, "www.")
	if i := strings.IndexAny(site, "/?#"); i >= 0 {
		site = site[:i]
	}
	if i := strings.IndexByte(site, '.'); i > 0 {
		return site[:i]
	}
	return ""
}
