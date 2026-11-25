package cockpit

// LAS PREFERENCIAS DE COCKPIT QUE OTROS LEEN (Miguel, 2026-11-18: «Claude como configuración en Cockpit, para las
// tareas en segundo plano que se van a ejecutar a ciertas horas»). Se eligen en el engranaje de Cockpit («Modelo») y
// viven en ~/.config/creditop-cockpit/settings.json, al lado del archivo de control; las lee quien corre sin
// Cockpit abierto (`bin/pg model ask`, lo agendado). A diferencia del control, este archivo NO se borra al salir.

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

// Los modelos de segundo plano: los que contestan lo que corre solo (agendado, sin una persona mirando).
//
//	claude  Claude Sonnet 5.5 en el Bedrock de CreditOp, por el puente de canon (connectors/claude). Opción manual
//	        desde el 2026-11-24: el puente se cortaba y volvía, y comparte cuenta con el canon de producción del equipo.
//	gemini  Gemini por su API, con la llave de connectors/.env (connectors/gemini): gasta la cuota de esa llave.
//
//	aistudio  Gemini (gemini-4-hydrogen) por la web de AI Studio, en el Chrome de Miguel con Jarvis (bin/aistudio). EL DE
//	          POR DEFECTO (Miguel, 2026-11-24): sin costo y aguantó ~5 millones de tokens en un día. Necesita Chrome
//	          abierto con la extensión, va de a una pregunta y tiene cupo diario por modelo; en pausa, Info lo dice.
var BackgroundModels = []string{"claude", "gemini", "aistudio"}

const DefaultBackgroundModel = "aistudio"

// Settings: lo que se guarda. Lo que falta vale lo de siempre.
type Settings struct {
	BackgroundModel string `json:"backgroundModel"`
}

func settingsPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".config", "creditop-cockpit", "settings.json"), nil
}

// LoadSettings: las preferencias, con lo de siempre donde falta o no se reconoce.
func LoadSettings() Settings {
	s := Settings{}
	if path, err := settingsPath(); err == nil {
		if raw, err := os.ReadFile(path); err == nil {
			_ = json.Unmarshal(raw, &s)
		}
	}
	if !knownModel(s.BackgroundModel) {
		s.BackgroundModel = DefaultBackgroundModel
	}
	return s
}

func knownModel(m string) bool {
	for _, x := range BackgroundModels {
		if x == m {
			return true
		}
	}
	return false
}

// SetBackgroundModel guarda el modelo de segundo plano (lo mismo que elegirlo en Cockpit).
func SetBackgroundModel(m string) error {
	if !knownModel(m) {
		return fmt.Errorf("modelo desconocido %q: son %v", m, BackgroundModels)
	}
	path, err := settingsPath()
	if err != nil {
		return err
	}
	s := LoadSettings()
	s.BackgroundModel = m
	raw, _ := json.MarshalIndent(s, "", "  ")
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, append(raw, '\n'), 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
