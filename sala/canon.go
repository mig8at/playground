package main

/* EL BARRIDO DE CANON (Miguel, 2026-11-05): el mismo barrido, pero sobre los temas de CANON y para ponerlos al día.
 *
 * DE DÓNDE SALE EL TRABAJO. De la ronda del servidor (`/api/round`): los archivos que cada tema declara y que cambiaron
 * en main desde el hash que tiene. Sin temas pedidos, van los N con más archivos cambiados. Cada agente recibe su tema,
 * la prosa vigente y SU lista de archivos: no elige a ciegas qué mirar.
 *
 * QUÉ ENTREGA. Piezas de canon, no hallazgos sueltos, en dos formas:
 *   · `verificado`: releyó el archivo y la prosa sigue siendo cierta → sube el hash, sin tocar la prosa;
 *   · una sección (`correction` / `addition`): la prosa dejó de ser cierta o le falta una regla → la reescribe, con
 *     sus `archivos`, así que el hash se mueve junto con la prosa que lo relee.
 * El verificador comprueba cada pieza contra main y, a las que confirma, la sala las ensaya en canon (`DryWrite`:
 * borrador → pieza → abandono). NADA SE PUBLICA: las piezas quedan en sala/.barridos/<id>/piezas/ y el informe da el
 * comando para que Miguel las publique con make canon-write. */

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"creditop/playground/connectors/canon"
)

// Las herramientas de un agente de canon: las del barrido más la lectura de canon.
var canonTools = append(append([]string(nil), sweepTools...),
	"Bash(make canon-search *)", "Bash(make canon-read *)", "Bash(make canon-route *)", "Bash(make canon-mapa*)",
	// En la primera corrida real (2026-11-05) los agentes llamaron con -C a la raíz, y eso pedía aprobación: sin la
	// prosa, 3 de 8 piezas quedaron en «—».
	"Bash(make -C * canon-read *)", "Bash(make -s -C * canon-read *)", "Bash(make -C * canon-search *)")

// La prosa entera va en el brief: un tema de canon tiene un tope de 8.000 palabras, y recortarla dejaba al agente
// pidiendo el resto por una herramienta.
const maxCanonBriefRunes = 60000

const canonSystem = `Trabajás SOLO sobre un TEMA de CANON, el corpus compartido del equipo de CreditOp, y lo ponés al día con main. ` +
	`Recibís la prosa vigente del tema y los archivos que declara y que CAMBIARON en main desde que se verificó. Por cada archivo: ` +
	`mirá qué cambió (git -C <repo> log/diff/show contra origin/main, en los DOS monolitos si la regla los cruza), releé las ` +
	`secciones que dependen de él (make canon-read IDS='<tema>/context#<ancla>') y decidí: ¿la prosa sigue siendo cierta? ` +
	`Si sí, la pieza es un «verificado» que sube el hash. Si no, o si el cambio agregó una regla que el tema no cuenta, la pieza ` +
	`reescribe la sección (mismo node y section reemplaza; corregir es reescribir, no agregar otra al lado). ` +
	`REGLAS DE LA PROSA: sólo lo que está en main; directa, sin rellenos; sin mediciones del ambiente, sin cifras de prod y sin ` +
	`fechas de cuándo se descubrió algo; sin la crónica de cómo lo comprobaste; hasta 600 palabras por sección. ` +
	`Ya estás en la raíz del playground: make y bin/pg van sin -C. ` +
	`Una sección reescrita sobre archivos que el tema YA declara no mueve su hash (queda enlazada al área): después de esa pieza ` +
	`agregá un «verificado» con esos mismos archivos, que es lo que saca la deriva. En «tablas», sólo tablas que existen en el ` +
	`esquema de producción (comprobalo con bin/pg sql --target prod --query "SELECT table_name FROM information_schema.tables WHERE table_name LIKE '<prefijo>%'"; SHOW no está permitido); si dudás, no la pongas. ` +
	`Cada pieza va en un bloque de código con la etiqueta pieza, con UN objeto JSON válido. Las dos formas:` + "\n" +
	"```pieza\n" + `{"node":"<tema>/context","operacion":"verificado","source":"verified","verified":"<AAAA-MM-DD>","as_asked":"<la pregunta que contesta la sección>","archivos":{"<repo>":["<ruta>"]}}` + "\n```\n" +
	"```pieza\n" + `{"node":"<tema>/context","section":"<título exacto de la sección>","kind":"correction|addition","source":"verified","verified":"<AAAA-MM-DD>","as_asked":"…","objetivo":"<la responsabilidad, una frase de negocio>","se_deduce_leyendo":"<lo que resuelven los archivos>","archivos":{"<repo>":["<ruta>"]},"tablas":["…"],"text":"<la prosa en markdown, sin el título>"}` + "\n```\n" +
	`Los repos con el nombre de canon (legacy-backend, legacy-application, frontend-monorepo…), tal como vienen en la lista. ` +
	`Un archivo que cambió sólo en algo que la prosa no menciona también es un «verificado». Si un archivo ya no existe en main, ` +
	`decilo como «PREGUNTA:», no armes pieza. Antes de cada pieza comprobá la afirmación volviendo a la fuente. Al final, una línea ` +
	`«PREGUNTA: …» por cada duda. Nada se escribe: las piezas las comprueba otro y las publica Miguel. ` + sweepRules

const canonVerifierSystem = `Sos el VERIFICADOR de un barrido de CANON: otros agentes armaron piezas para poner al día temas del corpus del ` +
	`equipo de CreditOp y vos no escribiste ninguna. Por cada pieza comprobá, volviendo a la fuente (git grep / git show contra ` +
	`origin/main en los DOS monolitos, make canon-read para la prosa vigente): en un «verificado», que la prosa vigente de ese tema ` +
	`SIGA siendo cierta con el archivo de hoy; en una sección, que cada afirmación del texto esté en main, que cada archivo:línea y ` +
	`cada cita digan lo que dice, que no traiga mediciones de prod ni fechas de descubrimiento, y que no pierda una condición que ` +
	`la prosa vigente tenía. Una pieza con una parte falsa es ✗ aunque el resto sea cierto. Por cada pieza, una línea exacta ` +
	`«VEREDICTO: P<n> | ✓, ✗ o — | <el comando que corriste> | <una frase: qué viste>», donde — es «no se pudo comprobar». Si el ` +
	`presupuesto no alcanza para todas, empezá por las secciones reescritas. ` + sweepRules

var rePieceBlock = regexp.MustCompile("(?s)```pieza\\s*\\n(.*?)\\n```")

// canonWork: los temas de la ronda con los archivos que cambiaron en cada uno.
type canonWork map[string][]canon.RoundChange

// canonRound pide la ronda y agrupa por tema; sin temas pedidos devuelve los n con más archivos cambiados.
func canonRound(ctx context.Context, topics []string, n int) ([]string, canonWork, error) {
	round, err := canon.FromEnv().Round(ctx, false)
	if err != nil && ctx.Err() == nil {
		// La primera medición después de que el servidor la invalida tarda más que el cliente (8 s); para la segunda
		// ya la tiene en caché. Pasó el 2026-11-05 al lanzar desde la página.
		round, err = canon.FromEnv().Round(ctx, false)
	}
	if err != nil {
		return nil, nil, fmt.Errorf("canon no devolvió la ronda (%s): %w", canon.URL(), err)
	}
	work := canonWork{}
	for _, c := range round.Changes {
		work[c.Topic] = append(work[c.Topic], c)
	}
	if len(topics) > 0 {
		return topics, work, nil
	}
	for t := range work {
		topics = append(topics, t)
	}
	sort.Slice(topics, func(i, j int) bool {
		if len(work[topics[i]]) != len(work[topics[j]]) {
			return len(work[topics[i]]) > len(work[topics[j]])
		}
		return topics[i] < topics[j]
	})
	if len(topics) > n {
		topics = topics[:n]
	}
	return topics, work, nil
}

// canonBrief: el tema, sus archivos cambiados, la prosa vigente y lo ya confirmado en barridos anteriores.
func canonBrief(ctx context.Context, root, topic string, changes []canon.RoundChange) string {
	var b strings.Builder
	fmt.Fprintf(&b, "Tema de canon: %s (node %s/context). Hoy es %s.\n\n", topic, topic, time.Now().Format("2006-01-02"))
	if len(changes) == 0 {
		b.WriteString("La ronda no marca archivos cambiados en este tema: buscá en main reglas que la prosa no cuente o que ya no sean ciertas.\n")
	} else {
		fmt.Fprintf(&b, "Archivos que el tema declara y cambiaron en main (%d):\n", len(changes))
		for _, c := range changes {
			fmt.Fprintf(&b, "- %s:%s  (blob %s → %s)\n", c.Repo, c.Path, c.Before, c.Now)
		}
	}
	text, err := canon.FromEnv().Markdown(ctx, topic+"/context")
	if err == nil && strings.TrimSpace(text) != "" {
		if r := []rune(text); len(r) > maxCanonBriefRunes {
			text = string(r[:maxCanonBriefRunes]) + "\n…(recortado: el resto con make canon-read IDS=" + topic + "/context#<ancla>)"
		}
		b.WriteString("\nLa prosa vigente:\n\n" + text)
	} else {
		b.WriteString("\n(No pude leer la prosa: make canon-read IDS=" + topic + "/context)")
	}
	if known, err := os.ReadFile(knownPath(root, "canon-"+topic)); err == nil && len(known) > 0 {
		b.WriteString("\n\nYA CONFIRMADO en barridos anteriores (no lo repitas):\n" + string(known))
	}
	return b.String()
}

// parsePieces devuelve el JSON de cada bloque ```pieza; descarta lo que no es un objeto válido.
func parsePieces(text string) []canon.Piece {
	var out []canon.Piece
	for _, m := range rePieceBlock.FindAllStringSubmatch(text, -1) {
		var p canon.Piece
		if json.Unmarshal([]byte(strings.TrimSpace(m[1])), &p) == nil && p["node"] != nil {
			out = append(out, p)
		}
	}
	return out
}

// pieceLabel: la línea con que se ve una pieza en la interfaz y en el informe.
func pieceLabel(p canon.Piece) (kind, label string) {
	kind, _ = p["operacion"].(string)
	if kind == "" {
		kind, _ = p["kind"].(string)
	}
	var files []string
	if archivos, ok := p["archivos"].(map[string]any); ok {
		for repo, paths := range archivos {
			if list, ok := paths.([]any); ok {
				for _, path := range list {
					files = append(files, fmt.Sprintf("%s:%v", repo, path))
				}
			}
		}
	}
	sort.Strings(files)
	label = fmt.Sprintf("%v", p["node"])
	if s, ok := p["section"].(string); ok && s != "" {
		label += " · «" + s + "»"
	}
	if len(files) > 0 {
		label += " · " + strings.Join(files, ", ")
	}
	if t, ok := p["text"].(string); ok && t != "" {
		label += " — " + truncate(t, 280)
	}
	return kind, label
}

// rehearse guarda cada pieza confirmada y la ensaya en canon, de a una para que una mala no tape a las demás.
func rehearse(ctx context.Context, dir string, findings []*finding, mock bool, set func(f *finding, piece, rehearsal string)) {
	piecesDir := filepath.Join(dir, "piezas")
	_ = os.MkdirAll(piecesDir, 0o755)
	client := canon.FromEnv()
	author := os.Getenv("CANON_AUTHOR")
	if author == "" {
		author = "Miguel Ochoa"
	}
	for _, f := range findings {
		if f.piece == nil {
			continue
		}
		raw, _ := json.MarshalIndent(f.piece, "", "  ")
		path := filepath.Join(piecesDir, f.ID+".json")
		if os.WriteFile(path, raw, 0o644) == nil {
			set(f, path, "")
		}
		switch {
		case f.Verdict != "✓", ctx.Err() != nil:
			continue
		case mock:
			set(f, "", "simulado")
			continue
		}
		written, err := client.DryWrite(ctx, author, []canon.Piece{f.piece})
		if err != nil {
			set(f, "", "✗ "+truncate(err.Error(), 400))
			continue
		}
		note := "ok"
		if len(written.Pieces) > 0 {
			r := written.Pieces[0]
			note = "ok: " + r.Operation
			for k, v := range r.Notes {
				note += " · ⚠ " + k + ": " + truncate(v, 160)
			}
		}
		set(f, "", note)
	}
}

// mockCanonPieces: lo que contesta un agente de canon simulado, con una pieza de cada forma.
func mockCanonPieces(topic string) string {
	return "Revisé los archivos cambiados.\n\n```pieza\n" +
		`{"node":"` + topic + `/context","operacion":"verificado","source":"verified","verified":"` + time.Now().Format("2006-01-02") +
		`","as_asked":"¿qué hace X?","archivos":{"legacy-backend":["app/X.php"]}}` + "\n```\n\n```pieza\n" +
		`{"node":"` + topic + `/context","section":"Regla simulada","kind":"correction","source":"verified","verified":"` + time.Now().Format("2006-01-02") +
		`","as_asked":"¿y si Y?","objetivo":"Decidir Y.","se_deduce_leyendo":"cuándo pasa Y","archivos":{"legacy-backend":["app/Y.php"]},"text":"**Y ya no excluye.** Ahora sólo ordena."}` +
		"\n```\n\nPREGUNTA: ¿app/Z.php se movió?"
}

// canonProse: la prosa vigente de cada tema, para que el verificador compare sin tener que pedirla.
func canonProse(ctx context.Context, topics []string) string {
	var b strings.Builder
	for _, t := range topics {
		text, err := canon.FromEnv().Markdown(ctx, t+"/context")
		if err != nil || strings.TrimSpace(text) == "" {
			fmt.Fprintf(&b, "\n(No pude leer la prosa de %s: make canon-read IDS=%s/context)\n", t, t)
			continue
		}
		if r := []rune(text); len(r) > maxCanonBriefRunes {
			text = string(r[:maxCanonBriefRunes]) + "\n…(recortado)"
		}
		fmt.Fprintf(&b, "\n── PROSA VIGENTE DE %s ──\n%s\n", t, text)
	}
	return b.String()
}
