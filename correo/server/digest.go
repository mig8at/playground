package main

// EL DESGLOSE DE UN HILO, EN ESPAÑOL. Al abrir un correo, el panel derecho muestra el hilo entero «digerido»: un
// resumen, en qué está y qué te toca, y la conversación mensaje por mensaje (ellos / vos) en puntos cortos, en
// español aunque el hilo venga en inglés. Lo arma Claude con `claude -p` (Claude Code de consola, la sesión de Miguel;
// decisión de Miguel, 2026-11-13: primero fue Gemini), corrido desde una carpeta neutra, sin herramientas ni MCP: sólo
// lee el hilo y contesta un JSON. Quién escribió y cuándo NO los decide el modelo: salen de Gmail.
//
// Se guarda por hilo en correo/.data/digests/<hilo>.json y vale mientras el hilo tenga los mismos mensajes: si llega
// uno nuevo (otro último mensaje), se vuelve a armar. ⚠ El texto del hilo sale a la API de Anthropic.

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"creditop/playground/connectors/gmail"
)

// Turn es un mensaje del hilo, desglosado.
type Turn struct {
	ID     string    `json:"id"`
	From   string    `json:"from"`
	Mine   bool      `json:"mine"` // lo escribiste vos
	Date   time.Time `json:"date"`
	Points []string  `json:"points"`
}

// Digest es el desglose de un hilo.
type Digest struct {
	ThreadID string `json:"threadId"`
	Subject  string `json:"subject"`
	Count    int    `json:"count"`  // cuántos mensajes tenía el hilo al armarlo
	LastID   string `json:"lastId"` // el último mensaje al armarlo: si cambia, se rearma
	Summary  string `json:"summary"`
	Status   string `json:"status"` // en qué está la conversación
	Next     string `json:"next"`   // qué te toca (o qué se espera de ellos)
	Turns    []Turn `json:"turns"`
	// La respuesta: si vale la pena contestar (Reply) y por qué, y el borrador en el idioma del hilo con su traducción
	// al español. Sin borrador cuando lo último es tuyo, es un acuse automático o sólo cabría un «gracias».
	Reply    bool      `json:"reply"`
	ReplyWhy string    `json:"replyWhy"`
	Draft    string    `json:"draft,omitempty"`
	DraftEs  string    `json:"draftEs,omitempty"`
	Model    string    `json:"model"`
	At       time.Time `json:"at"`
	Version  int       `json:"version"` // digestVersion con que se armó: uno más viejo se rearma
}

// digestVersion sube cuando cambia lo que el desglose trae (2: el borrador de respuesta, 2026-11-13).
const digestVersion = 2

type digester struct {
	dir   string
	mu    sync.Mutex
	locks map[string]*sync.Mutex // uno por hilo: dos clics no arman dos veces
}

func newDigester(dir string) *digester {
	return &digester{dir: filepath.Join(dir, "digests"), locks: map[string]*sync.Mutex{}}
}

func (d *digester) lock(thread string) *sync.Mutex {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.locks[thread] == nil {
		d.locks[thread] = &sync.Mutex{}
	}
	return d.locks[thread]
}

var threadIDRe = regexp.MustCompile(`^[0-9a-f]{6,32}$`)

func (d *digester) path(thread string) string { return filepath.Join(d.dir, thread+".json") }

func (d *digester) cached(thread string) (Digest, bool) {
	var g Digest
	b, err := os.ReadFile(d.path(thread))
	if err != nil || json.Unmarshal(b, &g) != nil {
		return g, false
	}
	return g, true
}

// get devuelve el desglose del hilo: el guardado si el hilo no cambió, o uno nuevo.
func (d *digester) get(c *gmail.Client, thread string, force bool) (Digest, error) {
	if !threadIDRe.MatchString(thread) {
		return Digest{}, errors.New("id de hilo inválido")
	}
	l := d.lock(thread)
	l.Lock()
	defer l.Unlock()
	ctx, cancel := ctxTimeout(time.Minute)
	defer cancel()
	msgs, err := c.ThreadFull(ctx, thread)
	if err != nil {
		return Digest{}, err
	}
	if len(msgs) == 0 {
		return Digest{}, errors.New("el hilo está vacío")
	}
	last := msgs[len(msgs)-1]
	if g, ok := d.cached(thread); ok && !force && g.Count == len(msgs) && g.LastID == last.ID && g.Version >= digestVersion {
		return g, nil
	}
	g, err := digest(thread, msgs, c.Email())
	if err != nil {
		return Digest{}, err
	}
	if err := os.MkdirAll(d.dir, 0o700); err == nil {
		b, _ := json.MarshalIndent(g, "", "  ")
		_ = os.WriteFile(d.path(thread), b, 0o600)
	}
	return g, nil
}

// Lo citado de una respuesta («> …», «On … wrote:» y lo que sigue) se saca: ya está en el mensaje anterior del hilo.
var (
	quoteHeadRe = regexp.MustCompile(`(?m)^(On .{5,200} wrote:|El .{5,200} escribió:|-----Original Message-----)\s*$`)
	quotedRe    = regexp.MustCompile(`(?m)^>.*$\n?`)
)

// maxBody: lo que se manda de cada mensaje. Un hilo reenviado puede traer meses de historia adentro.
const maxBody = 6000

// cleanQuoted saca lo citado de una respuesta, sin cortar el largo: es lo que se muestra en la conversación.
func cleanQuoted(s string) string {
	if loc := quoteHeadRe.FindStringIndex(s); loc != nil {
		s = s[:loc[0]]
	}
	return quotedRe.ReplaceAllString(s, "")
}

func cleanBody(s string) string {
	s = strings.TrimSpace(cleanQuoted(s))
	if r := []rune(s); len(r) > maxBody {
		s = string(r[:maxBody]) + "\n[… sigue]"
	}
	return s
}

const digestInstructions = `Sos el asistente de Miguel Ochoa (Creditop, una fintech colombiana de crédito BNPL). Te paso un hilo de correo, mensaje por mensaje, y lo desglosás EN ESPAÑOL (aunque venga en inglés), para que Miguel lo entienda de un vistazo.

- resumen: dos o tres frases: de qué trata el hilo y qué se sabe hoy.
- estado: en qué quedó, en una frase (por ejemplo «VTEX está revisando la homologación»).
- siguiente: qué le toca a Miguel, o qué se espera de la otra parte, en una frase. Si a Miguel no le toca nada, decilo.
- mensajes: uno por cada mensaje del hilo, en el MISMO orden e índice que te paso, con 1 a 4 puntos cortos en español: lo que dice o pide ese mensaje, con los datos concretos (números de ticket, fechas, nombres, errores, pasos). Sin saludos ni firmas. Un acuse automático se resume en un punto.

- responder: true SÓLO si el último mensaje del hilo es de ellos (no de Miguel) y pide algo a Miguel (un dato, una decisión, una confirmación, un archivo, una corrección) o le hace una pregunta. false si lo último es de Miguel (se espera a ellos), si es un acuse automático o un aviso sin pedido, o si lo único que cabría es agradecer: en tickets de soporte (Zendesk, Shopify Support) un «gracias» suelto reabre el ticket y no se manda.
- por_que: una frase en español que explique por qué conviene responder o por qué no.
- borrador: si responder es true, la respuesta lista para pegar, EN EL IDIOMA DEL HILO (si ellos escriben en inglés, en inglés), corta, cordial y concreta, firmada «Miguel». Contesta cada pedido o pregunta; donde falte un dato que no está en el hilo, dejá un marcador entre corchetes ([confirmar la URL], [adjuntar captura]) en vez de inventarlo. Si responder es false, cadena vacía.
- borrador_es: la traducción al español del borrador (vacía si el borrador ya está en español o no hay borrador).

No inventes nada que no esté en los mensajes. Contestá SÓLO con un objeto JSON, sin texto antes ni después ni bloque de código, con esta forma:
{"resumen": "…", "estado": "…", "siguiente": "…", "mensajes": [{"indice": 0, "puntos": ["…", "…"]}], "responder": false, "por_que": "…", "borrador": "", "borrador_es": ""}`

func digest(thread string, msgs []gmail.Message, me string) (Digest, error) {
	me = strings.ToLower(me)
	var b strings.Builder
	b.WriteString(digestInstructions + "\n\n")
	fmt.Fprintf(&b, "Asunto: %s\n\n", msgs[0].Subject)
	turns := make([]Turn, len(msgs))
	for i, m := range msgs {
		mine := me != "" && strings.Contains(strings.ToLower(m.From), me)
		who := "ellos"
		if mine {
			who = "Miguel"
		}
		turns[i] = Turn{ID: m.ID, From: m.From, Mine: mine, Date: m.Date}
		fmt.Fprintf(&b, "=== Mensaje %d · de %s (%s) · %s ===\n%s\n\n", i, m.From, who, m.Date.Format("2006-01-02 15:04"), cleanBody(m.Body))
	}
	raw, model, err := askClaude(b.String())
	if err != nil {
		return Digest{}, err
	}
	var out struct {
		Resumen   string `json:"resumen"`
		Estado    string `json:"estado"`
		Siguiente string `json:"siguiente"`
		Mensajes  []struct {
			Indice int      `json:"indice"`
			Puntos []string `json:"puntos"`
		} `json:"mensajes"`
		Responder  bool   `json:"responder"`
		PorQue     string `json:"por_que"`
		Borrador   string `json:"borrador"`
		BorradorEs string `json:"borrador_es"`
	}
	if err := json.Unmarshal([]byte(jsonObject(raw)), &out); err != nil {
		return Digest{}, fmt.Errorf("Claude no devolvió el desglose en JSON: %v", err)
	}
	for _, m := range out.Mensajes {
		if m.Indice < 0 || m.Indice >= len(turns) {
			continue
		}
		for _, p := range m.Puntos {
			if p = strings.TrimSpace(p); p != "" {
				turns[m.Indice].Points = append(turns[m.Indice].Points, p)
			}
		}
	}
	g := Digest{
		ThreadID: thread, Subject: msgs[0].Subject, Count: len(msgs), LastID: msgs[len(msgs)-1].ID,
		Summary: strings.TrimSpace(out.Resumen), Status: strings.TrimSpace(out.Estado), Next: strings.TrimSpace(out.Siguiente),
		Turns: turns, Model: model, At: time.Now(), Version: digestVersion,
		Reply: out.Responder && strings.TrimSpace(out.Borrador) != "", ReplyWhy: strings.TrimSpace(out.PorQue),
		Draft: strings.TrimSpace(out.Borrador), DraftEs: strings.TrimSpace(out.BorradorEs),
	}
	// Lo último es tuyo: no hay nada que contestar, diga lo que diga el modelo.
	if turns[len(turns)-1].Mine {
		g.Reply, g.Draft, g.DraftEs = false, "", ""
		if g.ReplyWhy == "" {
			g.ReplyWhy = "Lo último del hilo es tuyo: se espera a ellos."
		}
	}
	return g, nil
}

// jsonObject saca el objeto JSON de la respuesta, por si viene envuelto en un bloque de código o con texto alrededor.
func jsonObject(s string) string {
	if i, j := strings.Index(s, "{"), strings.LastIndex(s, "}"); i >= 0 && j > i {
		return s[i : j+1]
	}
	return s
}

// claudeModel: con qué modelo se desglosa (CORREO_CLAUDE_MODEL; por defecto sonnet: rápido y barato para esto).
func claudeModel() string {
	if m := os.Getenv("CORREO_CLAUDE_MODEL"); m != "" {
		return m
	}
	return "sonnet"
}

// claudeBinary: CORREO_CLAUDE, `claude` en el PATH, o el de ~/.local/bin (launchd no trae el PATH de la shell).
func claudeBinary() (string, error) {
	if p := os.Getenv("CORREO_CLAUDE"); p != "" {
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
	return "", errors.New("no encuentro Claude Code (`claude`): instalalo o indicá el binario con CORREO_CLAUDE")
}

// askClaude corre `claude -p` con el texto por stdin y devuelve lo que contestó. Desde una carpeta neutra (sin el
// CLAUDE.md ni los hooks del playground), sin herramientas ni MCP, y sin las variables de una sesión de Claude Code
// anfitriona (como hace Jarvis: con ellas el hijo se cree parte de esa sesión y falla la autenticación).
func askClaude(prompt string) (string, string, error) {
	bin, err := claudeBinary()
	if err != nil {
		return "", "", err
	}
	dir := filepath.Join(os.TempDir(), "correo-claude")
	_ = os.MkdirAll(dir, 0o700)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	model := claudeModel()
	cmd := exec.CommandContext(ctx, bin, "-p", "--output-format", "json", "--model", model,
		"--tools", "", "--strict-mcp-config", "--disable-slash-commands")
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
	if err := cmd.Run(); err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = strings.TrimSpace(stdout.String())
		}
		return "", model, fmt.Errorf("claude -p: %v %s", err, msg)
	}
	var res struct {
		Result  string `json:"result"`
		IsError bool   `json:"is_error"`
	}
	if err := json.Unmarshal(stdout.Bytes(), &res); err != nil {
		return "", model, fmt.Errorf("claude -p devolvió algo que no es JSON: %.200s", stdout.String())
	}
	if res.IsError {
		return "", model, fmt.Errorf("claude -p: %s", res.Result)
	}
	return res.Result, "claude " + model, nil
}
