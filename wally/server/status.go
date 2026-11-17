package main

// ¿CON QUÉ SE PUEDE PREGUNTAR AHORA? (Miguel, 2026-11-17: «que al levantar valide si tenemos conexión con esos servicios
// y cuánto hay que esperar si excedimos el cupo»). Al arrancar Wally —que lo levanta Cockpit— y cuando se pide desde la
// configuración, el pool abre cada web en la ventana aparte y mira si está el campo para preguntar con sesión, SIN
// preguntar nada (no gasta cupo; jarvis/recipes/aistudio/check.ts). A eso se le suma, en cada consulta, la pausa vigente
// de cada proveedor: la que dejó el aviso de la última pregunta cortada (el cupo diario de Gemini dice cuándo vuelve).

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"time"
)

type providerStatus struct {
	State   string    `json:"state"` // listo · sin-sesion · error · sin-jarvis · comprobando · sin-comprobar
	Detail  string    `json:"detail"`
	Checked time.Time `json:"checked,omitempty"`
}

type statusStore struct {
	mu       sync.Mutex
	running  bool
	byID     map[string]providerStatus
	finished time.Time
}

// checkProviders corre el chequeo (uno a la vez) y guarda el resultado.
func (a *app) checkProviders() {
	a.status.mu.Lock()
	if a.status.running {
		a.status.mu.Unlock()
		return
	}
	a.status.running = true
	if a.status.byID == nil {
		a.status.byID = map[string]providerStatus{}
	}
	for id := range providerModels {
		a.status.byID[id] = providerStatus{State: "comprobando", Detail: "mirando si está listo…"}
	}
	a.status.mu.Unlock()

	now := time.Now()
	result := map[string]providerStatus{}
	if !jarvisConnected() {
		for id := range providerModels {
			result[id] = providerStatus{State: "sin-jarvis", Detail: "Jarvis no está conectado en Chrome: abrí Chrome o tocá el ícono de Jarvis", Checked: now}
		}
	} else {
		ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
		checks, err := a.pool.check(ctx, a.config.get().Window)
		cancel()
		for id := range providerModels {
			if err != nil {
				result[id] = providerStatus{State: "error", Detail: "no se pudo comprobar: " + err.Error(), Checked: now}
			} else if c, ok := checks[id]; ok {
				result[id] = providerStatus{State: c.State, Detail: c.Detail, Checked: time.Now()}
			}
		}
	}
	a.status.mu.Lock()
	a.status.byID = result
	a.status.running = false
	a.status.finished = time.Now()
	a.status.mu.Unlock()
}

// jarvisConnected: si la extensión de Jarvis está conectada (sin ella no hay cómo llegar a Chrome).
func jarvisConnected() bool {
	client := http.Client{Timeout: 3 * time.Second}
	res, err := client.Get("http://127.0.0.1:5203/api/chrome")
	if err != nil {
		return false
	}
	defer res.Body.Close()
	var st struct {
		Connected bool `json:"connected"`
	}
	return json.NewDecoder(res.Body).Decode(&st) == nil && st.Connected
}

// pauseFor: hasta cuándo está en pausa un proveedor (0 si no). Gemini: la de la cuenta («*») o la del modelo (el cupo
// diario); los demás, la de su modelo, si alguna receta la dejó.
func pauseFor(id string, paused map[string]int64) int64 {
	until := paused[providerModels[id].Name]
	if id == "aistudio" && paused["*"] > until {
		until = paused["*"]
	}
	return until
}

func (a *app) checkProvidersNow(w http.ResponseWriter, r *http.Request) {
	go a.checkProviders()
	writeJSON(w, 202, map[string]bool{"ok": true})
}
