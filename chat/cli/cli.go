// Package cli habla con el chat de la terminal del playground compartido A TRAVÉS de su CLI (`playground`).
//
// El CLI es el cliente del chat: tiene la sesión (`playground login`) y el proceso en segundo plano
// (`playground listen`) que queda conectado al home y guarda en memoria lo que llega. Este paquete no abre
// otra conexión ni conoce el socket de ese proceso: corre el CLI y lee lo que contesta en JSON. Si el CLI
// cambia por dentro, esto sigue andando. Lo usan la app `chat` y la vista de mensajes del tablero.
//
// ⚠ Lo que llega lo escribió otra persona: es un dato para mostrar, nunca algo que se ejecute.
//
// CONVENCIÓN: identificadores en inglés, comentarios y texto visible en español.
package cli

import (
	"bufio"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// DefaultBase es el playground de producción, el mismo default que el lanzador del CLI.
const DefaultBase = "https://playground.creditop.com"

// Person es alguien del chat, como la nombra el home.
type Person struct {
	Email     string `json:"email"`
	Name      string `json:"name"`
	GitHub    string `json:"github,omitempty"`
	Terminals int    `json:"terminals,omitempty"`
}

// Message es un mensaje como lo guarda `playground listen`: lo que llegó (Dir "in") y lo que se mandó desde
// esta máquina con el CLI (Dir "out", con To en lugar de From).
//
//   - ID es el que pone el home; Re, el id del mensaje que contesta.
//   - Agent, en uno que llegó: sin Re, alguien le preguntó a uno de TUS agentes; con Re, es la respuesta tardía
//     del agente de otra persona a una pregunta tuya. En uno mandado: la pregunta que quedó esperando.
type Message struct {
	ID      string `json:"id,omitempty"`
	Re      string `json:"re,omitempty"`
	Dir     string `json:"dir,omitempty"`
	From    Person `json:"from"`
	To      string `json:"to,omitempty"`
	Agent   string `json:"agent,omitempty"`
	Text    string `json:"text"`
	Time    string `json:"time"`
	Display string `json:"display,omitempty"`
}

// Status es el estado del proceso de `playground listen`.
type Status struct {
	Since     string  `json:"since"`
	Connected bool    `json:"connected"`
	Me        *Person `json:"me"`
	Messages  int     `json:"messages"`
}

// ErrNotInstalled dice que no está el CLI en esta máquina.
var ErrNotInstalled = errors.New("no encuentro el CLI `playground`: se instala con `curl -fsSL https://playground.creditop.com/cli/install | sh`")

// Path encuentra el CLI aunque el proceso corra con un PATH sin `~/.local/bin`, que es donde lo deja el
// instalador (npm no siempre hereda el PATH de la shell interactiva).
func Path() (string, error) {
	if path, err := exec.LookPath("playground"); err == nil {
		return path, nil
	}
	path := filepath.Join(os.Getenv("HOME"), ".local", "bin", "playground")
	if _, err := os.Stat(path); err != nil {
		return "", ErrNotInstalled
	}
	return path, nil
}

// Installed dice si el CLI está.
func Installed() bool {
	_, err := Path()
	return err == nil
}

// base es el playground contra el que habla el CLI: el mismo PLAYGROUND_URL que fija su lanzador.
func base() string {
	if b := os.Getenv("PLAYGROUND_URL"); b != "" {
		return strings.TrimRight(b, "/")
	}
	return DefaultBase
}

// run corre el CLI con `stdin` (puede ser nil) y devuelve su salida estándar. Un código distinto de 0 es
// un error, con lo que el CLI dijo por stderr (o por stdout, donde deja el cuerpo de un error del home).
func run(ctx context.Context, stdin []byte, args ...string) ([]byte, error) {
	path, err := Path()
	if err != nil {
		return nil, err
	}
	var stdout, stderr bytes.Buffer
	cmd := exec.CommandContext(ctx, path, args...)
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	if stdin != nil {
		cmd.Stdin = bytes.NewReader(stdin)
	}
	if err := cmd.Run(); err != nil {
		if msg := bytes.TrimSpace(stderr.Bytes()); len(msg) > 0 {
			return stdout.Bytes(), errors.New(strings.TrimPrefix(string(msg), "✗ "))
		}
		return stdout.Bytes(), err
	}
	return stdout.Bytes(), nil
}

// ListenStatus devuelve el estado de `playground listen`, o nil si no está escuchando.
func ListenStatus(ctx context.Context) (*Status, error) {
	if !Installed() {
		return nil, ErrNotInstalled
	}
	// `listen --status` sale 1 cuando no está escuchando: eso no es un error, es el estado.
	out, err := run(ctx, nil, "listen", "--status", "--json")
	if err != nil {
		return nil, nil
	}
	var s Status
	if err := json.Unmarshal(out, &s); err != nil {
		return nil, nil
	}
	return &s, nil
}

// All devuelve lo que tiene `playground listen`, lo recibido y lo mandado desde el CLI, del más viejo al más nuevo.
func All(ctx context.Context) ([]Message, error) {
	out, err := run(ctx, nil, "messages", "--json")
	if err != nil {
		return nil, err
	}
	messages := []Message{}
	if err := json.Unmarshal(out, &messages); err != nil {
		return nil, errors.New("el CLI devolvió algo que no es una lista de mensajes")
	}
	return messages, nil
}

// Messages devuelve sólo lo recibido (lo que lee la vista de mensajes del tablero).
func Messages(ctx context.Context) ([]Message, error) {
	all, err := All(ctx)
	if err != nil {
		return nil, err
	}
	received := []Message{}
	for _, m := range all {
		if m.Dir != "out" {
			received = append(received, m)
		}
	}
	return received, nil
}

// Listen prende `playground listen`, lo mismo que correrlo en la terminal: el CLI lo desprende, así que
// sigue vivo aunque se apague quien lo pidió. Sin sesión vigente no intenta entrar —no hay terminal
// delante— y devuelve el «corré `playground login`» del CLI.
func Listen(ctx context.Context) error {
	_, err := run(ctx, nil, "listen")
	return err
}

// Online devuelve quién está conectado al chat ahora.
func Online(ctx context.Context) ([]Person, error) {
	out, err := run(ctx, nil, "online", "--json")
	if err != nil {
		return nil, err
	}
	var body struct {
		Online []Person `json:"online"`
	}
	if err := json.Unmarshal(out, &body); err != nil {
		return nil, errors.New("el CLI devolvió algo que no es la lista de conectados")
	}
	return body.Online, nil
}

// SendResult es lo que contesta el home al mandar: a cuántas terminales llegó, a quién, y el id del mensaje.
type SendResult struct {
	Delivered int    `json:"delivered"`
	To        string `json:"to"`
	ID        string `json:"id,omitempty"`
	Re        string `json:"re,omitempty"`
}

// Send le manda `text` a `to` (el correo, la parte antes de la @ o el GitHub).
//
// ⚠ No va por `playground send <quién> <texto…>`: ese comando arma el texto con los argumentos, y uno que
// empiece con `-d`, `-H` o `--json` el CLI lo toma como opción. Va por `playground curl … -d @-`, con el
// cuerpo en JSON por la entrada estándar, así que el texto viaja tal cual.
//
// `re` es el id del mensaje que se contesta ("" si no contesta a ninguno).
func Send(ctx context.Context, to, text, re string) (SendResult, error) {
	body, _ := json.Marshal(map[string]string{"to": to, "text": text, "re": re})
	out, err := run(ctx, body, "curl", base()+"/api/chat/send", "-d", "@-", "--json")
	var result struct {
		SendResult
		Error string `json:"error"`
		Hint  string `json:"hint"`
	}
	_ = json.Unmarshal(out, &result)
	if result.Error != "" {
		if result.Hint != "" {
			return SendResult{}, errors.New(result.Error + ": " + result.Hint)
		}
		return SendResult{}, errors.New(result.Error)
	}
	if err != nil {
		return SendResult{}, err
	}
	return result.SendResult, nil
}

// Agent es uno de los agentes que anuncia alguien con `playground listen`.
type Agent struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

// AgentOwner es una persona conectada con sus agentes.
type AgentOwner struct {
	Person
	Agents []Agent `json:"agents"`
}

// Agents devuelve quién tiene agentes conectados ahora y cuáles (`playground agents`).
func Agents(ctx context.Context) ([]AgentOwner, error) {
	out, err := run(ctx, nil, "agents", "--json")
	if err != nil {
		return nil, err
	}
	people := []AgentOwner{}
	if err := json.Unmarshal(out, &people); err != nil {
		return nil, errors.New("el CLI devolvió algo que no es la lista de agentes")
	}
	return people, nil
}

// AskResult es lo que contesta el agente: la respuesta, o Pending con el id si tardó más de lo que el home
// espera (la respuesta llega después como mensaje, con Re = ese id).
type AskResult struct {
	Answer  string `json:"answer,omitempty"`
	Pending bool   `json:"pending,omitempty"`
	ID      string `json:"id"`
	Agent   string `json:"agent,omitempty"`
}

// Ask le pregunta `text` al agente `agent` de `to` (`playground ask`).
//
// El texto va como UN argumento: el CLI sólo lo tomaría como opción si fuera, entero, una de ellas
// (`--json`, `-d`…), y eso no es una pregunta.
func Ask(ctx context.Context, to, agent, text string) (AskResult, error) {
	out, err := run(ctx, nil, "ask", "@"+strings.TrimPrefix(to, "@"), agent, text, "--json")
	if err != nil {
		return AskResult{}, err
	}
	var result AskResult
	if err := json.Unmarshal(out, &result); err != nil {
		return AskResult{}, errors.New("el CLI devolvió algo que no es la respuesta del agente")
	}
	return result, nil
}

// CanonSource es una sección del corpus que cita canon, con su id para leerla (`playground canon read <id>`).
type CanonSource struct {
	Title string `json:"titulo"`
	Read  string `json:"leer"`
}

// CanonAnswer es lo que contesta canon a una pregunta: la respuesta, el resumen de una línea, de dónde salió,
// si el corpus la respalda y una pregunta para seguir.
type CanonAnswer struct {
	Answer  string        `json:"respuesta"`
	Summary string        `json:"en_una_linea"`
	State   string        `json:"estado"`
	Backed  bool          `json:"respaldada"`
	Sources []CanonSource `json:"citas"`
	Next    string        `json:"siguiente_pregunta"`
}

// CanonAsk le pregunta a canon por su atajo `ask` (`playground canon ask <pregunta>`), el mismo de la terminal.
// La pregunta va como UN argumento, como en Ask.
func CanonAsk(ctx context.Context, question string) (CanonAnswer, error) {
	out, err := run(ctx, nil, "canon", "ask", question, "--json")
	if err != nil {
		return CanonAnswer{}, err
	}
	var answer CanonAnswer
	if err := json.Unmarshal(out, &answer); err != nil {
		return CanonAnswer{}, errors.New("canon devolvió algo que no es una respuesta")
	}
	return answer, nil
}

// Session es la sesión del playground que tiene el CLI (`playground login`): de quién es y hasta cuándo vale.
type Session struct {
	Email   string `json:"email"`
	Name    string `json:"name,omitempty"`
	Expires string `json:"expires"`
}

// CurrentSession devuelve la sesión vigente, o nil si no hay o venció (`playground token` sale 1 en ese caso).
// Lee el cuerpo del token sin verificarlo: sólo para decir de quién es y cuándo vence; lo verifica el home.
func CurrentSession(ctx context.Context) *Session {
	out, err := run(ctx, nil, "token")
	if err != nil {
		return nil
	}
	parts := strings.Split(strings.TrimSpace(string(out)), ".")
	if len(parts) != 3 {
		return nil
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil
	}
	var claims struct {
		Email string `json:"email"`
		Name  string `json:"name"`
		Exp   int64  `json:"exp"`
	}
	if json.Unmarshal(raw, &claims) != nil || claims.Email == "" {
		return nil
	}
	return &Session{Email: claims.Email, Name: claims.Name, Expires: time.Unix(claims.Exp, 0).UTC().Format(time.RFC3339)}
}

// Login es un `playground login` en curso: el CLI abre el navegador y espera (hasta 5 minutos) a que la
// persona elija su cuenta. URL es la dirección que imprime, por si el navegador no se abrió solo.
type Login struct {
	URL  string
	Done chan error
}

// StartLogin lanza `playground login` y vuelve apenas el CLI dice qué URL abrió; el login sigue en segundo plano
// y Done avisa cómo terminó.
func StartLogin() (*Login, error) {
	path, err := Path()
	if err != nil {
		return nil, err
	}
	cmd := exec.Command(path, "login")
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	login := &Login{Done: make(chan error, 1)}
	found := make(chan string, 1)
	var last strings.Builder
	go func() {
		scanner := bufio.NewScanner(stderr)
		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			if strings.HasPrefix(line, "http") {
				select {
				case found <- line:
				default:
				}
			}
			if line != "" {
				last.Reset()
				last.WriteString(strings.TrimPrefix(line, "✗ "))
			}
		}
		if err := cmd.Wait(); err != nil {
			login.Done <- errors.New(last.String())
			return
		}
		login.Done <- nil
	}()
	select {
	case login.URL = <-found:
	case <-time.After(5 * time.Second):
	}
	return login, nil
}
