package main

/* QUÉ SE GUARDA DE UNA META (`bin/jarvis start --keep …`, 2026-11-20).
 *
 * Claude usa Jarvis casi siempre para investigar, y guardar todo dejaba flujos que nadie iba a reproducir. Cada meta
 * dice al arrancar qué quiere dejar, en niveles que se incluyen (la receta necesita el flujo, y el flujo la corrida):
 *   none   — sólo investigar: al terminar (o al cerrarse la sesión) se borra la corrida, con sus fotos, consola y red;
 *   run    — la corrida (fotos, consola, red en .data, fuera de git), sin flujo: el defecto del CLI;
 *   flow   — la corrida y, si terminó en LISTO, el flujo en jarvis/flows/;
 *   recipe — además, la receta por API que sale de la red de esa corrida (recipes/api-from-flow.ts).
 * Lo decide el CLI en `finish` (que puede subir o bajar el nivel con su propio --keep); el servidor lo recuerda para
 * mostrarlo y para borrar la corrida de una meta «none» que se cierra sin `finish`. Sin nivel (una sesión abierta a
 * mano, un `ask`), todo queda como antes. */

import (
	"fmt"
	"os"
)

const (
	keepNone   = "none"
	keepRun    = "run"
	keepFlow   = "flow"
	keepRecipe = "recipe"
)

// checkKeep valida un nivel ("" vale: sin nivel).
func checkKeep(k string) error {
	switch k {
	case "", keepNone, keepRun, keepFlow, keepRecipe:
		return nil
	}
	return fmt.Errorf("--keep %q no existe: none · run · flow · recipe", k)
}

func (r *Runner) SetKeep(k string) {
	r.mu.Lock()
	r.keep = k
	r.mu.Unlock()
}

func (r *Runner) Keep() string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.keep
}

// DiscardRun borra la corrida en curso (sus fotos y lo que se haya escrito de ella) y empieza los pasos de cero.
// Devuelve la carpeta borrada ("" si no había).
func (r *Runner) DiscardRun() string {
	l := r.liveSession()
	if l == nil {
		return ""
	}
	l.mu.Lock()
	dir := l.runDir
	l.mu.Unlock()
	r.LiveClearSteps()
	if dir != "" {
		_ = os.RemoveAll(dir)
	}
	return dir
}
