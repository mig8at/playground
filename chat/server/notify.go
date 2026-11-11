package main

/* LOS AVISOS, DECIDIDOS POR EL SERVIDOR. El servidor corre como servicio del Mac (scripts/service.sh) y recibe cada
 * mensaje aunque la pestaña del chat esté cerrada, así que es él quien decide si un mensaje avisa, con la
 * configuración que elegís en la app (notify-settings.json, junto al historial):
 *
 *   - por tipo: los mensajes directos, los de grupos (todos, sólo cuando te mencionan, o ninguno) y los de agentes;
 *   - por conversación, por encima de su tipo (#shopify sólo menciones, alguien en silencio);
 *   - «no molestar» en un horario, salvo, si querés, cuando te mencionan.
 *
 * Y lo entrega por donde se pueda tocar: si hay una pestaña del chat abierta con permiso de avisos, ella muestra el
 * aviso (un evento `notify` del stream; tocarlo abre la conversación). Si no hay ninguna, lo muestra macOS con
 * terminal-notifier si está instalado (tocarlo abre el chat) o, si no, con osascript. Si estás mirando esa misma
 * conversación con la pestaña al frente, no avisa.
 */

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"creditop/playground/chat/cli"
)

// Cómo avisa un tipo de conversación o una conversación: todo, sólo cuando te mencionan, o nada.
const (
	notifyAll      = "all"
	notifyMentions = "mentions"
	notifyOff      = "off"
)

type quietHours struct {
	On   bool   `json:"on"`
	From string `json:"from"` // "19:00"
	To   string `json:"to"`   // "08:00" (si es menor que From, cruza la medianoche)
}

type notifySettings struct {
	Enabled bool   `json:"enabled"`
	Sound   bool   `json:"sound"`
	Preview bool   `json:"preview"` // mostrar el texto del mensaje; si no, sólo quién escribió
	Direct  string `json:"direct"`  // all | off
	Groups  string `json:"groups"`  // all | mentions | off
	Agents  string `json:"agents"`  // all | off: lo que contestan o publican los agentes
	// Por conversación (`#shopify`, `ana@creditop.com`): gana sobre su tipo.
	Conversations map[string]string `json:"conversations"`
	Quiet         quietHours        `json:"quiet"`
	// Una mención avisa aunque sea horario de no molestar.
	MentionsBreakQuiet bool `json:"mentionsBreakQuiet"`
}

func defaultNotifySettings() notifySettings {
	return notifySettings{Enabled: true, Sound: true, Preview: true, Direct: notifyAll, Groups: notifyAll, Agents: notifyAll,
		Conversations: map[string]string{}, Quiet: quietHours{From: "19:00", To: "08:00"}, MentionsBreakQuiet: true}
}

func notifySettingsPath() (string, error) {
	dir, err := historyDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "notify-settings.json"), nil
}

var notifySettingsMu sync.Mutex

func readNotifySettings() notifySettings {
	notifySettingsMu.Lock()
	defer notifySettingsMu.Unlock()
	s := defaultNotifySettings()
	if p, err := notifySettingsPath(); err == nil {
		if b, err := os.ReadFile(p); err == nil {
			_ = json.Unmarshal(b, &s)
		}
	}
	return s.normalized()
}

func (s notifySettings) normalized() notifySettings {
	valid := func(v string, allowMentions bool, def string) string {
		if v == notifyAll || v == notifyOff || (allowMentions && v == notifyMentions) {
			return v
		}
		return def
	}
	s.Direct = valid(s.Direct, false, notifyAll)
	s.Groups = valid(s.Groups, true, notifyAll)
	s.Agents = valid(s.Agents, false, notifyAll)
	clean := map[string]string{}
	for k, v := range s.Conversations {
		k = strings.ToLower(strings.TrimSpace(k))
		if k != "" && (v == notifyAll || v == notifyMentions || v == notifyOff) {
			clean[k] = v
		}
	}
	s.Conversations = clean
	if _, err := time.Parse("15:04", s.Quiet.From); err != nil {
		s.Quiet.From = "19:00"
	}
	if _, err := time.Parse("15:04", s.Quiet.To); err != nil {
		s.Quiet.To = "08:00"
	}
	return s
}

func writeNotifySettings(s notifySettings) (notifySettings, error) {
	s = s.normalized()
	b, _ := json.MarshalIndent(s, "", "  ")
	p, err := notifySettingsPath()
	if err != nil {
		return s, err
	}
	notifySettingsMu.Lock()
	defer notifySettingsMu.Unlock()
	return s, writePrivate(p, b)
}

// inQuiet: ¿esta hora cae en el horario de no molestar? (de 19:00 a 08:00 cruza la medianoche).
func (q quietHours) inQuiet(now time.Time) bool {
	if !q.On {
		return false
	}
	from, err1 := time.Parse("15:04", q.From)
	to, err2 := time.Parse("15:04", q.To)
	if err1 != nil || err2 != nil || q.From == q.To {
		return false
	}
	m := now.Hour()*60 + now.Minute()
	f, t := from.Hour()*60+from.Minute(), to.Hour()*60+to.Minute()
	if f < t {
		return m >= f && m < t
	}
	return m >= f || m < t
}

// ── menciones: las mismas reglas que src/mentions.js (`@usuario`, `@usuario/agente`, `@todos`) ──
var mentionRe = regexp.MustCompile(`(?i)(^|[^\w@./-])@([a-z0-9][a-z0-9._-]*(?:/[a-z0-9][a-z0-9._-]*)?)`)

func mentionsMe(text, myUser string, myAgents []string) bool {
	if myUser == "" {
		return false
	}
	mine := map[string]bool{strings.ToLower(myUser): true, "todos": true}
	for _, a := range myAgents {
		mine[strings.ToLower(myUser+"/"+a)] = true
	}
	for _, m := range mentionRe.FindAllStringSubmatch(text, -1) {
		if mine[strings.ToLower(strings.TrimRight(m[2], "._-"))] {
			return true
		}
	}
	return false
}

// ── lo que está mirando la pestaña (la informa ella: POST /api/notify/view) ──
type notifyView struct {
	Key     string    `json:"key"`
	Focused bool      `json:"focused"`
	At      time.Time `json:"at"`
}

var (
	viewMu      sync.Mutex
	currentView notifyView
)

// watching: ¿la pestaña está al frente y en esa conversación? Sólo vale si hay una pestaña conectada al stream.
func watching(key string) bool {
	viewMu.Lock()
	v := currentView
	viewMu.Unlock()
	return events.count() > 0 && v.Focused && v.Key == key && time.Since(v.At) < 10*time.Minute
}

// ── la decisión ──
type notice struct {
	Title    string `json:"title"`
	Body     string `json:"body"`
	Key      string `json:"key"` // la conversación, para abrirla al tocar el aviso
	ID       string `json:"id"`
	Sound    bool   `json:"sound"`
	Mention  bool   `json:"mention"`
	Delivery string `json:"delivery"` // tab | mac
}

type me struct {
	user   string // la parte del correo antes de la @
	email  string
	agents []string // tus agentes (los que guarda el home), para `@vos/agente`
}

// decide: si este mensaje avisa y con qué texto. Las reglas, en orden: apagado → tuyo o viejo → la conversación
// que estás mirando → su ajuste (el de la conversación gana sobre el del tipo) → no molestar.
func decide(m cli.Message, s notifySettings, who me, now time.Time) (notice, bool) {
	if !s.Enabled || m.Dir == "out" || m.From.Email == "" || strings.EqualFold(m.From.Email, who.email) {
		return notice{}, false
	}
	if m.Kind == "publish" && m.Agent == "" {
		return notice{}, false
	}
	if t, err := time.Parse(time.RFC3339Nano, m.Time); err == nil && now.Sub(t) > 15*time.Minute {
		return notice{}, false // lo viejo que vuelve a pasar (el listen se reinició) no avisa
	}
	key := conversationOf(m)
	isGroup := m.Group != nil && m.Group.ID != ""
	isAgent := !isGroup && (m.Agent != "" || m.Via != nil)
	mention := isGroup && mentionsMe(m.Text, who.user, who.agents)

	mode := s.Direct
	if isGroup {
		mode = s.Groups
	} else if isAgent {
		mode = s.Agents
	}
	if v, ok := s.Conversations[key]; ok {
		mode = v
	}
	switch {
	case mode == notifyOff:
		return notice{}, false
	case mode == notifyMentions && !mention:
		return notice{}, false
	}
	if s.Quiet.inQuiet(now) && !(mention && s.MentionsBreakQuiet) {
		return notice{}, false
	}

	name := m.From.Name
	if name == "" {
		name = m.From.Email
	}
	title := name
	if m.Via != nil && m.Via.Name != "" {
		title = fmt.Sprintf("%s · %s", name, m.Via.Name)
	}
	if isGroup {
		if mention {
			title += " te mencionó en #" + m.Group.ID
		} else {
			title += " en #" + m.Group.ID
		}
	}
	body := "Nuevo mensaje"
	if s.Preview {
		body = strings.TrimSpace(m.Text)
		var files []string
		for _, f := range m.Files {
			files = append(files, "📎 "+f.Name)
		}
		if len(files) > 0 {
			body = strings.TrimSpace(body + "\n" + strings.Join(files, " · "))
		}
		if r := []rune(body); len(r) > 240 {
			body = string(r[:239]) + "…"
		}
		if body == "" {
			body = "Nuevo mensaje"
		}
	}
	return notice{Title: title, Body: body, Key: key, ID: m.ID, Sound: s.Sound, Mention: mention}, true
}

// whoAmI: tu usuario (de la sesión del CLI) y tus agentes. Se guarda unos minutos: cada aviso no pide la sesión.
var (
	whoMu    sync.Mutex
	whoCache me
	whoAt    time.Time
)

func whoAmI(ctx context.Context) me {
	whoMu.Lock()
	defer whoMu.Unlock()
	if whoCache.email != "" && time.Since(whoAt) < 5*time.Minute {
		return whoCache
	}
	w := me{}
	if s := cli.CurrentSession(ctx); s != nil {
		w.email = strings.ToLower(s.Email)
		w.user = strings.SplitN(w.email, "@", 2)[0]
	}
	if people, err := cli.Agents(ctx); err == nil {
		for _, p := range people {
			if strings.EqualFold(p.Email, w.email) {
				for _, a := range p.Agents {
					w.agents = append(w.agents, a.Name)
				}
			}
		}
	}
	if w.email != "" {
		whoCache, whoAt = w, time.Now()
	}
	return w
}

// whoLookup es whoAmI; las pruebas lo cambian para no preguntarle al CLI.
var whoLookup = whoAmI

// notifyFresh: lo que llegó recién, por las reglas; cada aviso sale por la pestaña o por macOS.
func notifyFresh(fresh []cli.Message) {
	if len(fresh) == 0 {
		return
	}
	s := readNotifySettings()
	if !s.Enabled {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	who := whoLookup(ctx)
	now := time.Now()
	for _, m := range fresh {
		n, ok := decide(m, s, who, now)
		if !ok || watching(n.Key) {
			continue
		}
		deliver(n)
	}
}

// Las pruebas lo cambian para no mostrar nada.
var deliver = func(n notice) {
	if events.notifiers() > 0 {
		n.Delivery = "tab"
		events.publish("notify", n)
		log.Printf("aviso por la pestaña: %s", n.Title)
		return
	}
	n.Delivery = "mac"
	if err := macNotify(n); err != nil {
		log.Printf("aviso de macOS: %v", err)
		return
	}
	log.Printf("aviso por macOS (%s): %s", macTool(), n.Title)
}

func macTool() string {
	if notifierApp() != "" {
		return "chat-notifier"
	}
	if _, err := exec.LookPath("terminal-notifier"); err == nil {
		return "terminal-notifier"
	}
	return "osascript"
}

// notifierApp: el avisador propio («Chat del playground», scripts/notifier.sh), si está compilado.
func notifierApp() string {
	home, _ := os.UserHomeDir()
	bin := filepath.Join(home, "Applications", "Chat del playground.app", "Contents", "MacOS", "ChatNotifier")
	if st, err := os.Stat(bin); err == nil && !st.IsDir() {
		return bin
	}
	return ""
}

// macNotify: con el avisador propio (tiene su permiso de avisos y tocarlo abre la conversación); si no está, con
// terminal-notifier; y si tampoco, con osascript, que desde el servicio NO se ve si «Editor de Scripts» no tiene
// permiso de avisos (pasó el 2026-11-10: salía sin error y no aparecía nada).
func macNotify(n notice) error {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if bin := notifierApp(); bin != "" {
		args := []string{"--title", n.Title, "--body", n.Body, "--url", chatURL(n.Key), "--group", "creditop-chat-" + n.Key}
		if n.Sound {
			args = append(args, "--sound")
		}
		if out, err := exec.CommandContext(ctx, bin, args...).CombinedOutput(); err != nil {
			return fmt.Errorf("avisador: %v %s", err, strings.TrimSpace(string(out)))
		}
		return nil
	}
	if bin, err := exec.LookPath("terminal-notifier"); err == nil {
		args := []string{"-title", n.Title, "-message", n.Body, "-group", "creditop-chat-" + n.Key,
			"-open", chatURL(n.Key)}
		if n.Sound {
			args = append(args, "-sound", "default")
		}
		return exec.CommandContext(ctx, bin, args...).Run()
	}
	script := fmt.Sprintf("display notification %s with title %s", appleString(n.Body), appleString(n.Title))
	if n.Sound {
		script += ` sound name "Glass"`
	}
	return exec.CommandContext(ctx, "osascript", "-e", script).Run()
}

// La interfaz de `make chat`; CHAT_UI_URL la cambia.
func chatURL(key string) string {
	base := os.Getenv("CHAT_UI_URL")
	if base == "" && fileExists("/Applications/Chat.app") {
		base = "creditop-chat://open/" // la app de escritorio (chat/src-tauri): abre la conversación ahí
	}
	if base == "" {
		base = "http://localhost:5184/"
	}
	if key == "" {
		return base
	}
	return base + "#/c/" + url.PathEscape(key)
}

// appleString: un texto como literal de AppleScript (comillas y barras escapadas; sin saltos raros).
func appleString(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, `"`, `\"`)
	s = strings.ReplaceAll(s, "\r", "")
	return `"` + s + `"`
}

// Quién avisa ahora: la pestaña (si hay una con permiso) o macOS; y con qué.
func notifyStatus() map[string]any {
	via := "mac"
	if events.notifiers() > 0 {
		via = "tab"
	}
	return map[string]any{"via": via, "macTool": macTool(), "tabs": events.count(), "tabsWithPermission": events.notifiers()}
}

func registerNotify(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/notify/settings", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"settings": readNotifySettings(), "status": notifyStatus()})
	})
	mux.HandleFunc("PUT /api/notify/settings", func(w http.ResponseWriter, r *http.Request) {
		in := defaultNotifySettings()
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&in); err != nil {
			fail(w, http.StatusBadRequest, errors.New("el cuerpo va en JSON: la configuración de avisos"))
			return
		}
		saved, err := writeNotifySettings(in)
		if err != nil {
			fail(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"settings": saved, "status": notifyStatus()})
	})
	// Lo que está mirando la pestaña: para no avisar de la conversación que tenés al frente.
	mux.HandleFunc("POST /api/notify/view", func(w http.ResponseWriter, r *http.Request) {
		var v notifyView
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&v); err != nil {
			fail(w, http.StatusBadRequest, errors.New("el cuerpo va en JSON: {key, focused}"))
			return
		}
		v.Key, v.At = strings.ToLower(strings.TrimSpace(v.Key)), time.Now()
		viewMu.Lock()
		currentView = v
		viewMu.Unlock()
		w.WriteHeader(http.StatusNoContent)
	})
	// Un aviso de prueba, por donde saldría uno de verdad (o por macOS, con ?via=mac).
	mux.HandleFunc("POST /api/notify/test", func(w http.ResponseWriter, r *http.Request) {
		s := readNotifySettings()
		n := notice{Title: "Chat del playground", Body: "Así te va a llegar un aviso.", Sound: s.Sound}
		if r.URL.Query().Get("via") == "mac" {
			n.Delivery = "mac"
			if err := macNotify(n); err != nil {
				fail(w, http.StatusInternalServerError, err)
				return
			}
		} else {
			deliver(n)
		}
		writeJSON(w, http.StatusOK, notifyStatus())
	})
}
