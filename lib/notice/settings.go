package notice

// EL SILENCIO, EN UN SOLO LUGAR: `settings.json`, junto a la bandeja. Lo editan Cockpit (engranaje → Avisos) y
// `bin/cockpit mute`; lo aplica Send antes de mandar, así vale también con Cockpit cerrado. Lo que se calla queda en la
// bandeja con su motivo.
//
// El horario de no molestar vivía en el chat (notify-settings.json) y valía sólo para él: si este archivo todavía no
// existe, arranca con el del chat.

import (
	"encoding/json"
	"os"
	"path/filepath"
	"time"
)

// Los niveles de una herramienta.
const (
	LevelAll       = "all"       // todos
	LevelImportant = "important" // sólo los importantes (una alerta, una mención, una corrida que frenó)
	LevelNone      = "none"      // ninguno: igual quedan en la bandeja
)

// QuietHours: el «no molestar» de todos los días. De 19:00 a 08:00 cruza la medianoche.
type QuietHours struct {
	On   bool   `json:"on"`
	From string `json:"from"`
	To   string `json:"to"`
}

// Settings: las claves JSON son el contrato con Cockpit (src-tauri/src/notices.rs).
type Settings struct {
	Quiet QuietHours `json:"quiet"`
	// ImportantBreaksQuiet: un aviso importante sale aunque sea horario de no molestar (el chat lo tenía para menciones).
	ImportantBreaksQuiet bool `json:"importantBreaksQuiet"`
	// PausedUntil: hasta cuándo no sale ninguno (RFC3339; vacío es sin pausa). Los importantes tampoco.
	PausedUntil string `json:"pausedUntil,omitempty"`
	// Apps: el nivel de cada herramienta; la que no está, «all».
	Apps map[string]string `json:"apps"`
}

func settingsPath() string { return filepath.Join(Dir(), "settings.json") }

// DefaultSettings: sin silencio, con el horario que tenía el chat si lo había.
func DefaultSettings() Settings {
	s := Settings{Quiet: QuietHours{From: "19:00", To: "08:00"}, ImportantBreaksQuiet: true, Apps: map[string]string{}}
	home, _ := os.UserHomeDir()
	if b, err := os.ReadFile(filepath.Join(home, "Library", "Application Support", "creditop-my-tools-chat", "notify-settings.json")); err == nil {
		var chat struct {
			Quiet              QuietHours `json:"quiet"`
			MentionsBreakQuiet *bool      `json:"mentionsBreakQuiet"`
		}
		if json.Unmarshal(b, &chat) == nil {
			if chat.Quiet.From != "" && chat.Quiet.To != "" {
				s.Quiet = chat.Quiet
			}
			if chat.MentionsBreakQuiet != nil {
				s.ImportantBreaksQuiet = *chat.MentionsBreakQuiet
			}
		}
	}
	return s
}

// ReadSettings lee los ajustes; sin archivo (o roto), los de DefaultSettings.
func ReadSettings() Settings {
	b, err := os.ReadFile(settingsPath())
	if err != nil {
		return DefaultSettings()
	}
	s := DefaultSettings()
	if json.Unmarshal(b, &s) != nil {
		return DefaultSettings()
	}
	if s.Apps == nil {
		s.Apps = map[string]string{}
	}
	return s
}

// WriteSettings los guarda (de una: archivo temporal y rename).
func WriteSettings(s Settings) error {
	if err := os.MkdirAll(Dir(), 0o755); err != nil {
		return err
	}
	for app, lvl := range s.Apps {
		if lvl != LevelImportant && lvl != LevelNone {
			delete(s.Apps, app) // «all» es no estar
		}
	}
	b, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	tmp := settingsPath() + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, settingsPath())
}

// Level: el nivel de una herramienta.
func (s Settings) Level(app string) string {
	if l, ok := s.Apps[app]; ok && (l == LevelImportant || l == LevelNone) {
		return l
	}
	return LevelAll
}

// Silences: por qué se calla este aviso ahora, o "" si sale. En orden: la pausa, el nivel de la herramienta, el
// horario de no molestar.
func (s Settings) Silences(n Notice, now time.Time) string {
	if t, err := time.Parse(time.RFC3339, s.PausedUntil); err == nil && now.Before(t) {
		return "pausa hasta las " + t.Local().Format("15:04")
	}
	switch s.Level(n.App) {
	case LevelNone:
		return n.App + " en «ninguno»"
	case LevelImportant:
		if !n.Important {
			return n.App + " en «sólo importantes»"
		}
	}
	if s.Quiet.In(now) && !(n.Important && s.ImportantBreaksQuiet) {
		return "no molestar"
	}
	return ""
}

// In: ¿esta hora cae en el horario de no molestar?
func (q QuietHours) In(now time.Time) bool {
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

// EnsureSettings deja el archivo de ajustes si todavía no está, con DefaultSettings (el horario que tenía el chat). Lo
// llama el chat al arrancar: el chat deja de guardar su horario, y así no se pierde.
func EnsureSettings() error {
	if _, err := os.Stat(settingsPath()); err == nil {
		return nil
	}
	return WriteSettings(DefaultSettings())
}
