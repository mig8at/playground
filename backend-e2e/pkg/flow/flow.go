// Package flow es un runner de "flujos de pasos" autodocumentados para el harness E2E.
//
// Cada flujo es una secuencia de pasos {Título, Descripción, Acción}. El runner:
//   - numera los pasos automáticamente (sin totales hardcodeados),
//   - imprime QUÉ hace cada paso (la descripción) antes de ejecutarlo,
//   - ejecuta la acción y muestra el resultado (✓ detalle / ✗ error),
//   - se detiene en el primer paso que falle, y
//   - imprime un resumen final (N/N pasos · tiempo).
//
// Con Explain() imprime SOLO la documentación del flujo (sin ejecutar nada): sirve para entender
// el paso a paso de un comando sin tocar el backend.
//
// Los datos que un paso necesita de otro (p.ej. el user_request_id de la entrada que usa el cierre)
// viajan por el Ctx. Las dependencias estáticas (db, cfg) las captura cada closure de paso.
package flow

import (
	"fmt"
	"time"

	"creditop-tests/pkg/client"
)

// Ctx transporta valores entre pasos del mismo flujo.
type Ctx struct{ vals map[string]interface{} }

// NewCtx crea un contexto vacío (para correr pasos embebidos con RunInline).
func NewCtx() *Ctx { return &Ctx{vals: map[string]interface{}{}} }

// Set guarda un valor para que lo lean pasos posteriores.
func (c *Ctx) Set(k string, v interface{}) { c.vals[k] = v }

// Get devuelve el valor crudo (nil si no existe).
func (c *Ctx) Get(k string) interface{} { return c.vals[k] }

// Int64 devuelve el valor como int64 (0 si no existe o no es numérico).
func (c *Ctx) Int64(k string) int64 {
	switch v := c.vals[k].(type) {
	case int64:
		return v
	case int:
		return int64(v)
	case float64:
		return int64(v)
	}
	return 0
}

// Int devuelve el valor como int.
func (c *Ctx) Int(k string) int { return int(c.Int64(k)) }

// Str devuelve el valor como string ("" si no existe).
func (c *Ctx) Str(k string) string { s, _ := c.vals[k].(string); return s }

// Step es un paso del flujo: un título (qué), una descripción (qué hace / por qué) y la acción.
// Run devuelve un detalle corto del resultado (se imprime junto al ✓) y un error si el paso falla.
type Step struct {
	Title string
	Desc  string
	Run   func(c *Ctx) (string, error)
}

// Flow es una secuencia de pasos autodocumentada.
type Flow struct {
	Name    string
	Summary string
	steps   []Step
}

// New crea un flujo con nombre (cabecera) y un resumen de una línea.
func New(name, summary string) *Flow { return &Flow{Name: name, Summary: summary} }

// Step agrega un paso (encadenable).
func (f *Flow) Step(title, desc string, run func(*Ctx) (string, error)) *Flow {
	f.steps = append(f.steps, Step{Title: title, Desc: desc, Run: run})
	return f
}

// Add agrega pasos ya construidos (encadenable). Útil para componer entrada + comercio + cierre.
func (f *Flow) Add(steps ...Step) *Flow { f.steps = append(f.steps, steps...); return f }

// Len es la cantidad de pasos.
func (f *Flow) Len() int { return len(f.steps) }

func (f *Flow) header() {
	client.Banner(f.Name)
	if f.Summary != "" {
		fmt.Printf("  %s%s%s\n", client.CGray, f.Summary, client.CReset)
	}
}

func (f *Flow) printStep(i int, s Step) {
	client.PrintStep(i+1, len(f.steps), s.Title)
	if s.Desc != "" {
		client.PrintRule(s.Desc)
	}
}

// Explain imprime el paso a paso DOCUMENTADO del flujo sin ejecutar ninguna acción.
func (f *Flow) Explain() {
	f.header()
	for i, s := range f.steps {
		f.printStep(i, s)
	}
	fmt.Printf("\n%s(--explain: documentación del flujo; no se ejecutó nada)%s\n", client.CGray, client.CReset)
}

// Run ejecuta el flujo con cabecera + resumen. Devuelve error en el primer paso que falle.
func (f *Flow) Run() error {
	f.header()
	start := time.Now()
	c := NewCtx()
	if err := f.exec(c, start); err != nil {
		return err
	}
	fmt.Printf("\n%s🟢 FLUJO OK · %d/%d pasos · %s%s\n", client.CGreen, len(f.steps), len(f.steps), since(start), client.CReset)
	return nil
}

// RunInline ejecuta los pasos sobre un Ctx dado, SIN cabecera ni resumen (para embeber un sub-flujo,
// p.ej. la entrada del canal cuando el comando trae su propio encabezado). Devuelve el primer error.
func (f *Flow) RunInline(c *Ctx) error { return f.exec(c, time.Now()) }

// RunAll ejecuta TODOS los pasos SIN detenerse en el primer fallo (para baterías de aserciones
// independientes, p.ej. rutas negativas/anti-fraude). Imprime ✓/✗ por paso y un resumen N/M;
// devuelve error si alguno falló.
func (f *Flow) RunAll() error {
	f.header()
	start := time.Now()
	c := NewCtx()
	failed := 0
	for i, s := range f.steps {
		f.printStep(i, s)
		detail, err := s.Run(c)
		if err != nil {
			failed++
			client.PrintFail(fmt.Sprintf("%s: %v", s.Title, err))
			continue
		}
		if detail != "" {
			client.PrintOK(detail)
		}
	}
	ok := len(f.steps) - failed
	if failed > 0 {
		fmt.Printf("\n%s🔴 %d/%d pasos OK · %d fallaron · %s%s\n", client.CRed, ok, len(f.steps), failed, since(start), client.CReset)
		return fmt.Errorf("%d/%d pasos fallaron", failed, len(f.steps))
	}
	fmt.Printf("\n%s🟢 FLUJO OK · %d/%d pasos · %s%s\n", client.CGreen, ok, len(f.steps), since(start), client.CReset)
	return nil
}

func (f *Flow) exec(c *Ctx, start time.Time) error {
	for i, s := range f.steps {
		f.printStep(i, s)
		detail, err := s.Run(c)
		if err != nil {
			client.PrintFail(fmt.Sprintf("%s: %v", s.Title, err))
			fmt.Printf("\n%s🔴 FLUJO DETENIDO en el paso %d/%d (%s) · %s%s\n",
				client.CRed, i+1, len(f.steps), s.Title, since(start), client.CReset)
			return err
		}
		if detail != "" {
			client.PrintOK(detail)
		}
	}
	return nil
}

func since(start time.Time) string { return fmt.Sprintf("%.1fs", time.Since(start).Seconds()) }
