package main

/* LOS AVISOS, DECIDIDOS POR EL SERVIDOR. El servidor corre dentro de Cockpit (cockpit/, la app de escritorio) y recibe
 * cada mensaje aunque su ventana esté cerrada, así que es él quien decide si un mensaje avisa, con la
 * configuración que elegís en la app (notify-settings.json, junto al historial):
 *
 *   - por tipo: los mensajes directos, los de grupos (todos, sólo cuando te mencionan, o ninguno) y los de agentes;
 *   - por conversación, por encima de su tipo (#shopify sólo menciones, alguien en silencio);
 *   - una mención es un aviso importante.
 *
 * Lo que sale pasa por lib/notice, como todos los avisos de my-tools: Cockpit aplica el «no molestar» y el nivel del
 * chat, lo guarda en su bandeja y lo muestra con su avisador, que al tocarlo abre esa conversación
 * (`cockpit://chat/#/c/…`). Si estás mirando esa misma conversación con la ventana al frente, no avisa.
 */

import (
	"context"
	sysnotice "creditop/my-tools/lib/notice"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"creditop/my-tools/chat/cli"
)

// Cómo avisa un tipo de conversación o una conversación: todo, sólo cuando te mencionan, o nada.
const (
	notifyAll      = "all"
	notifyMentions = "mentions"
	notifyOff      = "off"
)

type notifySettings struct {
	Enabled bool   `json:"enabled"`
	Sound   bool   `json:"sound"`
	Preview bool   `json:"preview"` // mostrar el texto del mensaje; si no, sólo quién escribió
	Direct  string `json:"direct"`  // all | off
	Groups  string `json:"groups"`  // all | mentions | off
	Agents  string `json:"agents"`  // all | off: lo que contestan o publican los agentes
	// Por conversación (`#shopify`, `ana@creditop.com`): gana sobre su tipo.
	Conversations map[string]string `json:"conversations"`
	// El horario de no molestar ya no es del chat: es de todos los avisos, en Cockpit (lib/notice). Una mención es un
	// aviso importante, y atraviesa ese horario si así está puesto allá.
}

func defaultNotifySettings() notifySettings {
	return notifySettings{Enabled: true, Sound: true, Preview: true, Direct: notifyAll, Groups: notifyAll, Agents: notifyAll,
		Conversations: map[string]string{}}
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
	Title   string `json:"title"`
	Body    string `json:"body"`
	Key     string `json:"key"` // la conversación, para abrirla al tocar el aviso
	ID      string `json:"id"`
	Sound   bool   `json:"sound"`
	Mention bool   `json:"mention"`
}

type me struct {
	user   string // la parte del correo antes de la @
	email  string
	agents []string // tus agentes (los que guarda el home), para `@vos/agente`
}

// decide: si este mensaje avisa y con qué texto. Las reglas, en orden: apagado → tuyo o viejo → la conversación
// que estás mirando → su ajuste (el de la conversación gana sobre el del tipo). El no molestar lo aplica Cockpit.
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
	via, err := macNotify(n)
	if err != nil {
		log.Printf("aviso de macOS: %v", err)
		return
	}
	log.Printf("aviso (%s): %s", via, n.Title)
}

// macNotify: por lib/notice, como todos los avisos de my-tools: Cockpit decide el silencio (el no molestar, el nivel
// del chat) y lo guarda en su bandeja; tocarlo abre la conversación. Una mención es importante.
func macNotify(n notice) (string, error) {
	return sysnotice.Send(sysnotice.Notice{App: "chat", Title: n.Title, Body: n.Body, URL: chatURL(n.Key),
		Group: "creditop-chat-" + n.Key, Important: n.Mention, Sound: n.Sound})
}

// La interfaz de `make chat`; CHAT_UI_URL la cambia.
func chatURL(key string) string {
	base := os.Getenv("CHAT_UI_URL")
	if base == "" {
		base = "cockpit://chat/" // Cockpit (cockpit/): abre la conversación en el chat de la app
	}
	if key == "" {
		return base
	}
	return base + "#/c/" + url.PathEscape(key)
}

// Con qué avisa macOS: el permiso del avisador de Cockpit (authorized · denied · notDetermined · missing) y el
// silencio de Cockpit que le toca al chat, para que la configuración del chat lo diga.
func notifyStatus() map[string]any {
	s := sysnotice.ReadSettings()
	return map[string]any{"notifier": sysnotice.NotifierStatus(), "level": s.Level("chat"), "quiet": s.Quiet}
}

func registerNotify(mux *http.ServeMux) {
	// El horario de no molestar pasó a Cockpit: si sus ajustes todavía no existen, nacen con el que tenía el chat.
	if err := sysnotice.EnsureSettings(); err != nil {
		log.Printf("avisos: no pude dejar los ajustes de Cockpit: %v", err)
	}
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
	// Un aviso de prueba, como saldría uno de verdad.
	mux.HandleFunc("POST /api/notify/test", func(w http.ResponseWriter, r *http.Request) {
		s := readNotifySettings()
		n := notice{Title: "Chat", Body: "Así te va a llegar un aviso.", Sound: s.Sound}
		if _, err := macNotify(n); err != nil {
			fail(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, http.StatusOK, notifyStatus())
	})
}
