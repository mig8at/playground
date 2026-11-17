package main

// LA CONFIGURACIÓN DE WALLY (idea de Miguel, 2026-11-17, como la de avisos del chat): con qué proveedor contesta y
// cómo, guardada en `.data/config.json` y aplicada desde la próxima pregunta. La interfaz la cambia al tocarla
// (`PUT /api/config`, por partes). Lo que no se elige queda en el valor de siempre (`defaultConfig`).

import (
	"bufio"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type Config struct {
	// Provider: «aistudio» (Gemini 4 Hydrogen por la web de AI Studio), «deepseek» (chat.deepseek.com) o «chatgpt»
	// (chatgpt.com, en chat temporal), todos por su web.
	Provider string `json:"provider"`
	// Thinking: el «Thinking level» de AI Studio (Low, Medium, High).
	Thinking string `json:"thinking"`
	// DeepThink y Search: los interruptores de DeepSeek («Pensamiento Profundo», «Búsqueda inteligente»).
	DeepThink bool `json:"deepThink"`
	Search    bool `json:"search"`
	// ChatGPTThink: el «Pensar» de ChatGPT.
	ChatGPTThink bool `json:"chatgptThink"`
	// GroqModel: el modelo de Groq Chat (el ultra rápido), su id en la URL.
	GroqModel string `json:"groqModel"`
	// AgentsOther: si los agentes y el asistente pueden ir por un proveedor que no sea AI Studio. Apagado: llevan
	// contexto interno de CreditOp (knowledge, código de main), que DeepSeek guarda en China y ChatGPT puede guardar
	// 30 días; además, ChatGPT gratis no acepta mensajes de ~77 mil caracteres (sí ~40 mil). Siguen por AI Studio.
	AgentsOther bool `json:"agentsOther"`
	// AgentsDeepSeek: el nombre de AgentsOther hasta que llegó ChatGPT (2026-11-17); se lee y se pasa a AgentsOther.
	AgentsDeepSeek bool `json:"agentsDeepSeek,omitempty"`
	// Window: dónde trabaja el pool en Chrome (minimized · aside · tab), como AISTUDIO_WINDOW.
	Window string `json:"window"`
}

var defaultConfig = Config{Provider: "aistudio", Thinking: "High", DeepThink: true, Search: false, GroqModel: "openai/gpt-oss-120b", Window: "minimized"}

// groqModels: los de texto que ofrecía Groq Chat el 2026-11-17 (los demás eran de voz o de guardia).
var groqModels = []string{"openai/gpt-oss-120b", "openai/gpt-oss-20b"}

// Los modelos que puede usar Wally, por proveedor: el nombre es lo que queda en cada respuesta.
var providerModels = map[string]Model{
	"aistudio": {Name: "gemini-4-hydrogen", DisplayName: "Gemini 4 Hydrogen", Note: "Gemini, por la web de AI Studio"},
	"deepseek": {Name: "deepseek-web", DisplayName: "DeepSeek", Note: "chat.deepseek.com"},
	"chatgpt":  {Name: "chatgpt-web", DisplayName: "ChatGPT", Note: "chatgpt.com, chat temporal"},
	"groq":     {Name: "groq-web", DisplayName: "Groq", Note: "chat.groq.com, el ultra rápido"},
}

type configStore struct {
	mu   sync.Mutex
	file string
	cfg  Config
}

func (s *configStore) load() {
	s.cfg = defaultConfig
	if raw, err := os.ReadFile(s.file); err == nil {
		_ = json.Unmarshal(raw, &s.cfg)
	}
	s.cfg = s.cfg.valid()
}

func (s *configStore) get() Config {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.cfg
}

// valid deja cada campo en un valor conocido (uno raro vuelve al de siempre).
func (c Config) valid() Config {
	if c.AgentsDeepSeek {
		c.AgentsOther, c.AgentsDeepSeek = true, false
	}
	if _, ok := providerModels[c.Provider]; !ok {
		c.Provider = defaultConfig.Provider
	}
	switch c.Thinking {
	case "Low", "Medium", "High":
	default:
		c.Thinking = defaultConfig.Thinking
	}
	ok := false
	for _, m := range groqModels {
		ok = ok || m == c.GroqModel
	}
	if !ok {
		c.GroqModel = defaultConfig.GroqModel
	}
	switch c.Window {
	case "minimized", "aside", "tab":
	default:
		c.Window = defaultConfig.Window
	}
	return c
}

// providerFor: por dónde va una pregunta. Un agente o el asistente no van por DeepSeek salvo que se haya permitido.
func (c Config) providerFor(mode string, agent bool) string {
	if c.Provider != "aistudio" && (agent || mode != "") && !c.AgentsOther {
		return "aistudio"
	}
	return c.Provider
}

func (a *app) getConfig(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, a.config.get())
}

// putConfig aplica sólo los campos que llegan (la interfaz manda uno por toque).
func (a *app) putConfig(w http.ResponseWriter, r *http.Request) {
	var patch map[string]json.RawMessage
	if err := json.NewDecoder(r.Body).Decode(&patch); err != nil {
		writeErr(w, 400, err)
		return
	}
	a.config.mu.Lock()
	defer a.config.mu.Unlock()
	cur, _ := json.Marshal(a.config.cfg)
	var merged map[string]json.RawMessage
	_ = json.Unmarshal(cur, &merged)
	for k, v := range patch {
		if _, ok := merged[k]; !ok {
			writeErr(w, 400, errors.New("no existe el campo «"+k+"»"))
			return
		}
		merged[k] = v
	}
	raw, _ := json.Marshal(merged)
	var next Config
	if err := json.Unmarshal(raw, &next); err != nil {
		writeErr(w, 400, err)
		return
	}
	a.config.cfg = next.valid()
	out, _ := json.MarshalIndent(a.config.cfg, "", "  ")
	if err := os.WriteFile(a.config.file, out, 0o644); err != nil {
		writeErr(w, 500, err)
		return
	}
	writeJSON(w, 200, a.config.cfg)
}

// UsageDay: lo de hoy por modelo, del registro que deja cada pregunta (~/.cache/my-tools/aistudio-uso.jsonl).
type UsageDay struct {
	Model    string `json:"model"`
	Asked    int    `json:"asked"`
	OK       int    `json:"ok"`
	Cuts     int    `json:"cuts"`
	Errors   int    `json:"errors"`
	AvgMs    int64  `json:"avgMs"`
	DailyOut string `json:"dailyOut,omitempty"` // hora en que AI Studio dijo que se acabó el cupo diario
}

func (a *app) usage(w http.ResponseWriter, r *http.Request) {
	home, _ := os.UserHomeDir()
	f, err := os.Open(filepath.Join(home, ".cache", "my-tools", "aistudio-uso.jsonl"))
	byModel := map[string]*UsageDay{}
	var order []string
	if err == nil {
		defer f.Close()
		today := time.Now().Format("2006-01-02")
		sc := bufio.NewScanner(f)
		sc.Buffer(make([]byte, 1<<20), 1<<20)
		for sc.Scan() {
			var row struct {
				At     time.Time `json:"at"`
				Model  string    `json:"model"`
				Ms     int64     `json:"ms"`
				Result string    `json:"result"`
			}
			if json.Unmarshal(sc.Bytes(), &row) != nil || row.At.Local().Format("2006-01-02") != today {
				continue
			}
			u := byModel[row.Model]
			if u == nil {
				u = &UsageDay{Model: row.Model}
				byModel[row.Model] = u
				order = append(order, row.Model)
			}
			u.Asked++
			switch row.Result {
			case "ok":
				u.AvgMs += row.Ms
				u.OK++
			case "corte":
				u.Cuts++
			case "cupo-diario":
				u.Cuts++
				if u.DailyOut == "" {
					u.DailyOut = row.At.Local().Format("15:04")
				}
			default:
				u.Errors++
			}
		}
	}
	out := []UsageDay{}
	for _, m := range order {
		u := *byModel[m]
		if u.OK > 0 {
			u.AvgMs /= int64(u.OK)
		}
		out = append(out, u)
	}
	paused := map[string]string{}
	for m, until := range pauses() {
		paused[strings.TrimSpace(m)] = time.UnixMilli(until).Format("15:04")
	}
	writeJSON(w, 200, map[string]any{"today": out, "paused": paused})
}
