package main

// EL REVISOR DE CRITERIOS (2026-11-18, Miguel: «la 2»: que el agente no se ponga la nota solo). Un agente escribe sus
// propios criterios y después se aprueba con ellos: nada le impide escribir criterios fáciles, o dejar sin criterio
// algo que se pidió. Antes de dejar cerrar una corrida automática que escribió en pruebas/, una pregunta APARTE —sin la
// conversación del agente, sin su código: sólo lo que pidió Miguel y el criterios.json— dice qué pedido no tiene un
// criterio que lo compruebe y qué criterio pasaría aunque lo pedido estuviera mal. Si hay algo, el agente no cierra.

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const reviewPrompt = `Sos un REVISOR. Un agente construyó algo y escribió criterios.json: las pruebas automáticas con las que él mismo se va a aprobar. Vos no ves su conversación ni su código: sólo lo que le PIDIERON y sus criterios. Tu trabajo es que no se apruebe con pruebas fáciles.

Fijate dos cosas, y nada más:
1. FALTAN: algo que se pidió y que ningún criterio comprueba. Cada cosa pedida (cada ruta, cada regla, cada caso de error, cada validación, cada número que se tiene que calcular) necesita al menos un criterio que verifique su RESULTADO.
2. DÉBILES: un criterio que pasaría aunque lo pedido estuviera mal hecho. Por ejemplo: sólo mira el código de estado y no el contenido; busca un texto que está siempre en la página (un título, una etiqueta) en vez del resultado; comprueba que algo aparece pero no que el valor sea el correcto; un cálculo sin el número esperado.

No inventes requisitos que no se pidieron. No opines del código, del diseño ni del estilo. Si todo lo pedido está cubierto con criterios que de verdad lo comprueban, está bien.

Contestá SÓLO con un objeto JSON, sin texto antes ni después:
{"ok": true o false, "faltan": ["lo pedido que no tiene criterio", …], "debiles": ["qué criterio y por qué es débil", …]}
Cada ítem en una línea corta, en español. "ok" es true sólo si las dos listas están vacías.`

type reviewVerdict struct {
	OK      bool     `json:"ok"`
	Faltan  []string `json:"faltan"`
	Debiles []string `json:"debiles"`
}

// isRoundNote: lo que le manda Wally al modelo entre vueltas (no es un pedido de Miguel).
func isRoundNote(text string) bool {
	for _, p := range []string{"Listo: corrí ", "Ninguno de esos comandos", "No corrí ninguno de esos comandos", "Todavía no terminaste:"} {
		if strings.HasPrefix(strings.TrimSpace(text), p) {
			return true
		}
	}
	return false
}

// requestsOf: lo que pidió Miguel sobre ESTE proyecto (sus preguntas, sin las vueltas automáticas): las de esta
// corrida (desde `from`) y, de antes, las que nombran el proyecto (un cambio de hoy se lee con el pedido original).
// Sin esto, en una conversación con varios proyectos el revisor reclamaba criterios de otro.
func requestsOf(msgs []Message, from int, project string, last int) []string {
	var out []string
	for i, m := range msgs {
		t := strings.TrimSpace(m.Text)
		if m.Role != "user" || t == "" || isRoundNote(t) {
			continue
		}
		if i >= from || strings.Contains(strings.ToLower(t), strings.ToLower(project)) {
			out = append(out, shorten(t, 3000))
		}
	}
	if len(out) > last {
		out = out[len(out)-last:]
	}
	return out
}

// reviewCriteria le pregunta al revisor por un proyecto. Un error o una respuesta que no se entiende NO frena: el
// revisor es una ayuda, y no puede dejar a una corrida trabada por su culpa.
func (a *app) reviewCriteria(ctx context.Context, conv Conversation, from int, project string, ask summarizer) (reviewVerdict, error) {
	raw, err := os.ReadFile(filepath.Join(a.root, sandboxDir, project, "criterios.json"))
	if err != nil {
		return reviewVerdict{OK: true}, nil // sin criterios no hay qué revisar: eso ya lo frena `probar`
	}
	reqs := requestsOf(conv.Messages, from, project, 6)
	if len(reqs) == 0 {
		return reviewVerdict{OK: true}, nil
	}
	kind := map[string]string{"rust": "una API en Rust (cada criterio: un pedido HTTP —método, ruta, cuerpo— y lo que se espera: estado, contiene, no_contiene; se corren en orden contra el mismo proceso)",
		"pagina": "una página web (cada criterio: pasos tocar, escribir, elegir, marcar, ver, no_ver, desde la página recién cargada)"}[a.sandboxKind(project)]
	if kind == "" {
		return reviewVerdict{OK: true}, nil
	}
	var b strings.Builder
	b.WriteString(reviewPrompt)
	fmt.Fprintf(&b, "\n\nLo que se construyó: %s, en el proyecto %s.\n\n", kind, project)
	b.WriteString("===== LO QUE PIDIÓ MIGUEL (en orden; lo último manda) =====\n")
	for i, r := range reqs {
		fmt.Fprintf(&b, "%d. %s\n", i+1, r)
	}
	b.WriteString("===== criterios.json =====\n")
	b.WriteString(shorten(string(raw), 60_000))
	b.WriteString("\n===== fin =====\n")
	answer, _, err := ask(ctx, b.String())
	if err != nil {
		return reviewVerdict{OK: true}, err
	}
	v, ok := parseVerdict(answer)
	if !ok {
		return reviewVerdict{OK: true}, fmt.Errorf("el revisor no contestó un JSON: %s", shorten(answer, 200))
	}
	return v, nil
}

// parseVerdict saca el objeto JSON de la respuesta (puede venir con ``` o con texto alrededor).
func parseVerdict(answer string) (reviewVerdict, bool) {
	i, j := strings.Index(answer, "{"), strings.LastIndex(answer, "}")
	if i < 0 || j <= i {
		return reviewVerdict{}, false
	}
	var v reviewVerdict
	if json.Unmarshal([]byte(answer[i:j+1]), &v) != nil {
		return reviewVerdict{}, false
	}
	// Lo que manda son las listas: un «ok» con cosas que faltan no es ok.
	v.OK = len(v.Faltan) == 0 && len(v.Debiles) == 0
	return v, true
}

// reviewNudge: lo que se le dice al agente cuando el revisor encontró algo.
func reviewNudge(project string, v reviewVerdict) string {
	var b strings.Builder
	fmt.Fprintf(&b, "Todavía no terminaste: un revisor que no vio tu trabajo comparó lo que se pidió con pruebas/%s/criterios.json y encontró huecos:\n", project)
	for _, f := range v.Faltan {
		fmt.Fprintf(&b, "- Falta un criterio para: %s\n", f)
	}
	for _, d := range v.Debiles {
		fmt.Fprintf(&b, "- Criterio débil: %s\n", d)
	}
	b.WriteString("Agregá o reforzá esos criterios para que comprueben el RESULTADO de lo pedido (y corregí lo que haga falta para que pasen), y volvé a probar. Si creés que uno de estos puntos no corresponde a lo pedido, decilo en una línea y seguí.")
	return b.String()
}

// maxReviews: cuántas veces se le pregunta al revisor en una corrida. Las dos primeras que ve huecos, el agente sigue;
// la tercera, la corrida cierra pero marcada «sin quedar bien», con lo que vio: que no gire para siempre.
const maxReviews = 3

// lastWrittenProject: el último proyecto de pruebas/ que escribió esta corrida (los mensajes desde `from`).
func lastWrittenProject(msgs []Message, from int) string {
	if from < 0 {
		from = 0
	}
	project := ""
	for i := from; i < len(msgs); i++ {
		for _, k := range msgs[i].Commands {
			f := strings.Fields(k.Cmd)
			if k.Status != "corrido" || len(f) < 2 || !strings.HasPrefix(f[1], "pruebas/") || k.Exit != 0 {
				continue
			}
			if f[0] == "escribir" || f[0] == "parchar" || (f[0] == "consola" && k.Touched) {
				project = strings.SplitN(strings.TrimPrefix(f[1], "pruebas/"), "/", 2)[0]
			}
		}
	}
	return project
}
