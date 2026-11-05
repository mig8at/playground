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
	_ "embed"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
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

//go:embed canon-guia.md
var canonGuide string

// El formato de salida es lo único que la guía no dice: es de la sala, no de canon.
const canonFormat = `## Cómo entregás las piezas

Ya estás en la raíz del playground: make y bin/pg van sin -C. Hoy es la fecha de «verified». Cada pieza va en un bloque de ` +
	"código con la etiqueta `pieza` y UN objeto JSON válido. Los repos van con el nombre que traen en la lista. Las tres formas:\n\n" +
	"```pieza\n" + `{"node":"<tema>/context","operacion":"verificado","source":"verified","verified":"<AAAA-MM-DD>","as_asked":"<la pregunta que contestan esas secciones>","archivos":{"<repo>":["<ruta>"]}}` + "\n```\n\n" +
	"```pieza\n" + `{"node":"<tema>/context","section":"<título exacto de la sección>","kind":"correction|addition","source":"verified","verified":"<AAAA-MM-DD>","as_asked":"…","objetivo":"<la responsabilidad, una frase de negocio>","se_deduce_leyendo":"<lo que resuelven los archivos>","archivos":{"<repo>":["<ruta>"]},"tablas":["…"],"text":"<la prosa en markdown, sin el título>"}` + "\n```\n\n" +
	"```pieza\n" + `{"node":"<tema>/context","operacion":"declarar","source":"verified","verified":"<AAAA-MM-DD>","as_asked":"…","objetivo":"<qué respaldan estos archivos>","archivos":{"<repo>":["<ruta nueva>"]}}` + "\n```\n\n" +
	"Una corrección va ANTES de su `verificado`. Al final, una línea `PREGUNTA: …` por cada cosa que no pudiste comprobar. " +
	"Nada se escribe: las piezas las comprueba otro y las publica una persona. "

var canonSystem = "Sos un AGENTE DE TEMA: trabajás SOLO sobre el tema de canon que te tocó y lo ponés al día con main, siguiendo esta guía.\n\n" +
	canonGuide + "\n\n" + canonFormat + sweepRules

var canonVerifierSystem = "Sos el VERIFICADOR de un tema: otro agente armó las piezas y vos no escribiste ninguna. Seguí el método de " +
	"«Cómo se comprueba» de esta guía, volviendo a la fuente, sin repetir el razonamiento de quien las escribió.\n\n" + canonGuide + "\n\n" +
	`## Qué hacés vos

Por cada pieza: en un «verificado», leé las secciones de la prosa vigente que dependen de esos archivos y comprobá que CADA frase siga ` +
	`siendo cierta con el código de hoy; si una quedó falsa, la pieza es ✗ y decís qué frase y por qué. En una sección, partí el texto ` +
	`en afirmaciones (reglas, nombres, códigos, números, condiciones) y comprobá cada una en los DOS monolitos cuando la regla los cruza; ` +
	`buscá la excepción de cada absoluto y de cada lista cerrada; mirá que no pierda una condición que la prosa vigente tenía, que las ` +
	`tablas existan en prod y que no traiga mediciones, fechas de descubrimiento ni crónica. Una pieza con una parte falsa es ✗ aunque ` +
	`el resto sea cierto. Por cada pieza, una línea exacta «VEREDICTO: P<n> | ✓, ✗ o — | <el comando que corriste> | <una frase: qué ` +
	`viste y, si es ✗, la corrección exacta>», donde — es «no se pudo comprobar». Las piezas se publican juntas y en el orden en que ` +
	`vienen: un «verificado» que sigue a una corrección del mismo lote se juzga contra la prosa YA corregida por esa pieza. Si el presupuesto no alcanza, empezá por las secciones. ` + sweepRules

var canonNotesSystem = "Sos un AGENTE DE ARCHIVO COMPARTIDO: los archivos que te tocan los declaran varios temas de canon, y tu nota evita " +
	"que cada tema relea el mismo cambio y lo cuente distinto. No escribís piezas.\n\n" + canonGuide + "\n\n" +
	`## Qué hacés vos

Por cada archivo, mirá qué cambió en origin/main desde el hash más viejo declarado (git -C <repo> log y diff de esa ruta; ` +
	`ubicá el commit con git log --format=%h -- <ruta> y compará contra el blob con git rev-list si hace falta). Escribí la nota en ` +
	`un bloque que empiece con una línea exacta «NOTA: <repo>:<ruta>» y siga con: qué cambió (las reglas, con archivo:línea), qué no ` +
	`cambió aunque el diff lo toque (renombres, formato, tipos) y si el archivo se borró o se movió (con la ruta nueva). Sin opinar ` +
	`sobre la prosa de ningún tema: eso lo hace cada agente de tema. Máximo 250 palabras por archivo. ` + sweepRules

var canonIntegratorSystem = "Sos el INTEGRADOR: recibís las piezas ya verificadas de varios temas de canon que tocan los mismos archivos, " +
	"y buscás lo que ningún verificador de tema puede ver solo.\n\n" + canonGuide + "\n\n" +
	`## Qué hacés vos

Compará las piezas de distintos temas que comparten archivos: la misma regla contada distinto (decí cuál es la cierta, comprobándola ` +
	`en main), la misma regla escrita en dos temas (la segunda debería enlazar a la primera con [[tema/context#ancla]]), un enlace a ` +
	`una sección que otra pieza renombró, y un «verificado» de un tema que contradice la corrección de otro. Por cada problema, una ` +
	`línea exacta «INTEGRACIÓN: <sólo las piezas que HAY QUE CAMBIAR> | <el problema, nombrando si hace falta la otra pieza> | ` +
	`<la corrección exacta>». Una pieza que está bien y sólo sirve de contraste NO va en el primer campo: queda frenada sin ` +
	`motivo. Si no hay ninguno, una línea «INTEGRACIÓN: ninguna». ` + sweepRules

var rePieceBlock = regexp.MustCompile("(?s)```pieza\\s*\\n(.*?)\\n```")

// canonWork: los temas de la ronda con los archivos que cambiaron en cada uno.
type canonWork map[string][]canon.RoundChange

// canonRound pide la ronda y agrupa por tema; sin temas pedidos devuelve los n con más archivos cambiados.
func canonRound(ctx context.Context, topics []string, n int) ([]string, canonWork, error) {
	// La medición después de que el servidor la invalida tarda más que el cliente (8 s), y sigue midiendo aunque el
	// cliente corte: el siguiente intento la encuentra en caché. Dos intentos no alcanzaron el 2026-11-05.
	round, err := canon.FromEnv().Round(ctx, false)
	for try := 0; err != nil && ctx.Err() == nil && try < 3; try++ {
		time.Sleep(5 * time.Second)
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
func canonBrief(ctx context.Context, root, topic string, changes []canon.RoundChange, notes map[string]string) string {
	var b strings.Builder
	fmt.Fprintf(&b, "Tema de canon: %s (node %s/context). Hoy es %s.\n\n", topic, topic, time.Now().Format("2006-01-02"))
	if len(changes) == 0 {
		b.WriteString("La ronda no marca archivos cambiados en este tema: buscá en main reglas que la prosa no cuente o que ya no sean ciertas.\n")
	} else {
		fmt.Fprintf(&b, "Archivos que el tema declara y cambiaron en main (%d):\n", len(changes))
		for _, c := range changes {
			now := c.Now
			if now == "" {
				now = "BORRADO de main"
			}
			fmt.Fprintf(&b, "- %s:%s  (blob %s → %s)\n", c.Repo, c.Path, c.Before, now)
		}
		var shared []string
		for _, c := range changes {
			if n := notes[c.Repo+":"+c.Path]; n != "" {
				shared = append(shared, n)
			}
		}
		if len(shared) > 0 {
			b.WriteString("\nNOTAS DE LOS ARCHIVOS COMPARTIDOS (otro agente ya leyó estos cambios; partí de acá y no releas el diff entero):\n\n")
			b.WriteString(strings.Join(shared, "\n\n") + "\n")
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
	/* Sin «lo ya confirmado»: en knowledge evita redescubrir, pero acá la ronda es la única verdad. Un agente de imei
	 * leyó que un barrido anterior había confirmado sus 15 archivos y no armó ninguna pieza, y ese «verificado» nunca se
	 * había publicado (lo frenó el integrador). Si un archivo está en la lista, canon no lo tiene verificado (2026-11-05). */
	b.WriteString("\n\nTodo archivo de la lista de arriba está SIN verificar en canon hoy, aunque algún barrido anterior lo haya " +
		"revisado: si no armás su pieza, sigue en la ronda.")
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

/* pipeline: cada tema corre su cadena sin esperar a los otros — agente → su verificador → ensayo de lo confirmado.
 * Con un solo verificador al final, el tema más lento frenaba a todos y el verificador cargaba con las piezas de
 * todos los temas en un presupuesto; con uno por tema, sumar temas suma cadenas en paralelo (Miguel, 2026-11-05). */
func (s *sweeper) pipeline(ctx context.Context, b *board, dir string) {
	notes := s.sharedNotes(ctx, b, dir)
	s.mu.Lock()
	if ctx.Err() == nil {
		b.Phase = "en cadena"
	}
	s.mu.Unlock()
	var wg sync.WaitGroup
	for i, a := range b.Agents {
		wg.Add(1)
		go func(a, v *agent) {
			defer wg.Done()
			s.runOne(ctx, a, canonBrief(ctx, s.root, a.Topic, s.work[a.Topic], notes), canonSystem, canonTools, sweepModel, sweepEffort, b.Budget, b.Mock, nil)
			_ = os.WriteFile(filepath.Join(dir, a.Topic+".md"), []byte(a.text), 0o644)

			s.mu.Lock()
			var mine []*finding
			for _, p := range parsePieces(a.text) {
				kind, label := pieceLabel(p)
				f := &finding{ID: fmt.Sprintf("P%d", len(b.Findings)+1), Topic: a.Topic, Kind: kind, Text: label, piece: p}
				b.Findings = append(b.Findings, f)
				mine = append(mine, f)
				a.Findings++
			}
			if len(mine) == 0 {
				v.Status = "sin piezas"
			}
			s.mu.Unlock()
			if len(mine) == 0 || ctx.Err() != nil {
				return
			}

			var p strings.Builder
			fmt.Fprintf(&p, "Piezas del tema %s. Comprobá cada una:\n\n", a.Topic)
			for _, f := range mine {
				raw, _ := json.Marshal(f.piece)
				fmt.Fprintf(&p, "%s\n%s\n\n", f.ID, raw)
			}
			p.WriteString(canonProse(ctx, []string{a.Topic}))
			s.runOne(ctx, v, p.String(), canonVerifierSystem, canonTools, verifierModel, verifierLevel, b.CheckBudget, b.Mock, mine)
			_ = os.WriteFile(filepath.Join(dir, "verificador-"+a.Topic+".md"), []byte(v.text), 0o644)
			s.mu.Lock()
			byID := map[string]*finding{}
			for _, f := range mine {
				byID[f.ID] = f
			}
			for _, m := range reVerdict.FindAllStringSubmatch(v.text, -1) {
				if f := byID[m[1]]; f != nil {
					f.Verdict, f.Check = m[2], m[3]
				}
			}
			s.mu.Unlock()
			set := func(f *finding, piece, rehearsal string) {
				s.mu.Lock()
				defer s.mu.Unlock()
				if piece != "" {
					f.Piece = piece
				}
				if rehearsal != "" {
					f.Rehearsal = rehearsal
				}
			}
			rehearse(ctx, dir, mine, b.Mock, set)
			s.correct(ctx, b, dir, a.Topic, mine, set)
		}(a, b.Verifiers[i])
	}
	wg.Wait()
	s.integrate(ctx, b, dir)
}

// ── LAS NOTAS DE ARCHIVO COMPARTIDO ─────────────────────────────────────────────────────────────────────────────────
/* Un archivo que declaran varios temas (las rutas de Onboarding, UserRequestService, el listado del asistente: hasta 10
 * temas cada uno) lo releían todos los agentes de esos temas, y cada uno podía contar el cambio distinto. Antes de las
 * cadenas, un agente lee cada archivo compartido UNA vez y deja una nota que reciben los temas. Las notas se guardan
 * por archivo y blob de hoy en sala/.barridos/notas/: el próximo barrido que toque el mismo archivo sin que cambie la
 * reusa sin gastar (Miguel, 2026-11-05). */

const (
	notesPerAgent = 5 // archivos por agente de notas
	maxNoteAgents = 4 // los que no entran van sin nota: el agente de tema lee el diff él mismo
)

var reNote = regexp.MustCompile(`(?m)^\s*NOTA:\s*(\S+)\s*$`)

// sharedChanges: los archivos de los temas elegidos que la ronda marca en más de un tema, con todos sus temas.
func sharedChanges(work canonWork, topics []string) map[string][]canon.RoundChange {
	byFile := map[string][]canon.RoundChange{}
	for _, changes := range work {
		for _, c := range changes {
			byFile[c.Repo+":"+c.Path] = append(byFile[c.Repo+":"+c.Path], c)
		}
	}
	chosen := map[string]bool{}
	for _, t := range topics {
		chosen[t] = true
	}
	out := map[string][]canon.RoundChange{}
	for key, cs := range byFile {
		if len(cs) < 2 {
			continue
		}
		for _, c := range cs {
			if chosen[c.Topic] {
				out[key] = cs
				break
			}
		}
	}
	return out
}

func notePath(root, key, now string) string {
	safe := strings.NewReplacer("/", "__", ":", "--").Replace(key)
	return filepath.Join(root, "sala", ".barridos", "notas", safe+"@"+now+".md")
}

// sharedNotes devuelve la nota de cada archivo compartido: las guardadas y las que escriben los agentes de notas.
func (s *sweeper) sharedNotes(ctx context.Context, b *board, dir string) map[string]string {
	notes := map[string]string{}
	var topics []string
	for _, a := range b.Agents {
		topics = append(topics, a.Topic)
	}
	shared := sharedChanges(s.work, topics)
	var pending []string
	for key, cs := range shared {
		if raw, err := os.ReadFile(notePath(s.root, key, cs[0].Now)); err == nil && !b.Mock {
			notes[key] = string(raw)
			continue
		}
		pending = append(pending, key)
	}
	// Los que más temas tocan primero: son los que más relecturas ahorran.
	sort.Slice(pending, func(i, j int) bool {
		if len(shared[pending[i]]) != len(shared[pending[j]]) {
			return len(shared[pending[i]]) > len(shared[pending[j]])
		}
		return pending[i] < pending[j]
	})
	if max := notesPerAgent * maxNoteAgents; len(pending) > max {
		pending = pending[:max]
	}
	var groups [][]string
	for i := 0; i < len(pending); i += notesPerAgent {
		end := i + notesPerAgent
		if end > len(pending) {
			end = len(pending)
		}
		groups = append(groups, pending[i:end])
	}
	s.mu.Lock()
	for i := range groups {
		b.Notes = append(b.Notes, &agent{Topic: fmt.Sprintf("notas · %d", i+1), Status: "esperando", Steps: []step{}})
	}
	b.SharedFiles, b.ReusedNotes = len(shared), len(notes)
	s.mu.Unlock()

	var wg sync.WaitGroup
	var mu sync.Mutex
	for i, group := range groups {
		wg.Add(1)
		go func(a *agent, group []string) {
			defer wg.Done()
			var p strings.Builder
			p.WriteString("Archivos compartidos que te tocan:\n\n")
			for _, key := range group {
				cs := shared[key]
				oldest, ts := cs[0].Before, []string{}
				for _, c := range cs {
					ts = append(ts, c.Topic)
					if c.Before < oldest { // sólo para mostrar uno; el agente compara contra cada hash si difieren
						oldest = c.Before
					}
				}
				now := cs[0].Now
				if now == "" {
					now = "BORRADO de main"
				}
				fmt.Fprintf(&p, "- %s  (blob declarado %s → hoy %s; lo declaran %s)\n", key, oldest, now, strings.Join(ts, ", "))
			}
			s.runOne(ctx, a, p.String(), canonNotesSystem, canonTools, sweepModel, sweepEffort, b.CheckBudget, b.Mock, nil)
			_ = os.WriteFile(filepath.Join(dir, strings.ReplaceAll(a.Topic, " · ", "-")+".md"), []byte(a.text), 0o644)
			found := parseNotes(a.text)
			mu.Lock()
			for _, key := range group {
				if n := found[key]; n != "" {
					notes[key] = n
					if !b.Mock {
						path := notePath(s.root, key, shared[key][0].Now)
						_ = os.MkdirAll(filepath.Dir(path), 0o755)
						_ = os.WriteFile(path, []byte(n), 0o644)
					}
				}
			}
			mu.Unlock()
			s.mu.Lock()
			a.Findings = len(found)
			s.mu.Unlock()
		}(b.Notes[i], group)
	}
	wg.Wait()
	return notes
}

// parseNotes corta la salida en bloques «NOTA: repo:ruta».
func parseNotes(text string) map[string]string {
	out := map[string]string{}
	idx := reNote.FindAllStringSubmatchIndex(text, -1)
	for i, m := range idx {
		end := len(text)
		if i+1 < len(idx) {
			end = idx[i+1][0]
		}
		key := text[m[2]:m[3]]
		out[key] = strings.TrimSpace(text[m[0]:end])
	}
	return out
}

func mockNotes(prompt string) string {
	var b strings.Builder
	for _, line := range strings.Split(prompt, "\n") {
		if strings.HasPrefix(line, "- ") {
			key := strings.Fields(strings.TrimPrefix(line, "- "))[0]
			fmt.Fprintf(&b, "NOTA: %s\nCambió la regla X (`A.php:10`); el resto es formato.\n\n", key)
		}
	}
	return b.String()
}

// ── EL INTEGRADOR ───────────────────────────────────────────────────────────────────────────────────────────────────
/* Cada verificador mira su tema; nadie veía que dos temas contaran distinto el mismo cambio, o que una corrección de un
 * tema contradijera el «verificado» de otro. El integrador corre al final, sólo si hay piezas ✓ de temas distintos que
 * comparten archivos, y marca las que hay que tocar: esas salen de «listas para publicar». */
func (s *sweeper) integrate(ctx context.Context, b *board, dir string) {
	s.mu.Lock()
	byFile := map[string]map[string][]*finding{}
	for _, f := range b.Findings {
		if f.Verdict != "✓" || f.piece == nil {
			continue
		}
		archivos, _ := f.piece["archivos"].(map[string]any)
		for repo, paths := range archivos {
			list, _ := paths.([]any)
			for _, path := range list {
				key := fmt.Sprintf("%s:%v", repo, path)
				if byFile[key] == nil {
					byFile[key] = map[string][]*finding{}
				}
				byFile[key][f.Topic] = append(byFile[key][f.Topic], f)
			}
		}
	}
	picked := map[string]*finding{}
	var crossed []string
	for key, topics := range byFile {
		if len(topics) < 2 {
			continue
		}
		crossed = append(crossed, key)
		for _, fs := range topics {
			for _, f := range fs {
				picked[f.ID] = f
			}
		}
	}
	if len(crossed) == 0 || ctx.Err() != nil {
		s.mu.Unlock()
		return
	}
	sort.Strings(crossed)
	var p strings.Builder
	fmt.Fprintf(&p, "Archivos que tocan piezas de más de un tema: %s\n\nLas piezas:\n\n", strings.Join(crossed, ", "))
	var ids []string
	for id := range picked {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	var topics []string
	seen := map[string]bool{}
	for _, id := range ids {
		f := picked[id]
		raw, _ := json.Marshal(f.piece)
		fmt.Fprintf(&p, "%s [%s]\n%s\n\n", id, f.Topic, raw)
		if !seen[f.Topic] {
			seen[f.Topic], topics = true, append(topics, f.Topic)
		}
	}
	b.Integrator = &agent{Topic: "integrador", Status: "esperando", Steps: []step{}}
	b.Phase = "integración"
	integ := b.Integrator
	s.mu.Unlock()
	p.WriteString(canonProse(ctx, topics))
	s.runOne(ctx, integ, p.String(), canonIntegratorSystem, canonTools, verifierModel, verifierLevel, b.CheckBudget, b.Mock, nil)
	_ = os.WriteFile(filepath.Join(dir, "integrador.md"), []byte(integ.text), 0o644)
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, line := range strings.Split(integ.text, "\n") {
		m := reIntegration.FindStringSubmatch(line)
		if m == nil {
			continue
		}
		for _, id := range reID.FindAllString(m[1], -1) {
			if f := picked[id]; f != nil {
				f.Integration = strings.TrimSpace(m[2])
				integ.Findings++
			}
		}
	}
}

var (
	reIntegration = regexp.MustCompile(`^\s*INTEGRACIÓN:\s*([^|]+?)\s*\|\s*(.+)$`)
	reID          = regexp.MustCompile(`P[0-9]+`)
)

// ── EL CORRECTOR ────────────────────────────────────────────────────────────────────────────────────────────────────
/* Con el verificador estricto, la mitad de las piezas vuelve ✗, y cada ✗ trae la frase falsa y la corrección exacta.
 * Aplicarlas a mano era el cuello de botella (2026-11-05: 10 de 16 en una tanda). El corrector reescribe cada pieza
 * rechazada con esa corrección —un «verificado» sobre prosa vencida pasa a sección corregida + «verificado»— y otro
 * verificador, que no vio ni la pieza original ni la corrección, la vuelve a revisar antes del ensayo. Una sola vuelta:
 * lo que vuelve a fallar queda para una persona. */

var canonCorrectorSystem = "Sos el CORRECTOR de un tema de canon: recibís piezas que el verificador rechazó, cada una con su motivo y la " +
	"corrección exacta, y las reescribís siguiendo esta guía.\n\n" + canonGuide + "\n\n" + canonFormat +
	`

## Qué hacés vos

Por cada pieza rechazada, aplicá la corrección del verificador y comprobala vos mismo en main antes de escribir (puede ` +
	`equivocarse). Si era una sección, entregá la sección entera corregida (mismo node y section). Si era un «verificado» ` +
	`rechazado porque una frase de la prosa vigente dejó de ser cierta, entregá esa sección vigente entera con la frase ` +
	`corregida (kind correction, con los archivos que la respaldan) y DESPUÉS el mismo «verificado». Si la corrección pide ` +
	`algo que no podés comprobar, no armes la pieza: dejalo como PREGUNTA. Antes de cada bloque pieza, una línea ` +
	`«CORRIGE: P<n>» con la pieza original que reemplaza. ` + sweepRules

// correctRounds: cuántas vueltas de corrector + reverificador tiene un tema. Con una, una corrección que volvía con otra
// observación se perdía, y imei y bcp no bajaban (2026-11-05).
const correctRounds = 2

func (s *sweeper) correct(ctx context.Context, b *board, dir, topic string, mine []*finding, set func(*finding, string, string)) {
	for round := 1; round <= correctRounds && ctx.Err() == nil; round++ {
		next := s.correctOnce(ctx, b, dir, topic, round, mine, set)
		if len(next) == 0 {
			return
		}
		mine = next
	}
}

// correctOnce corre una vuelta y devuelve las piezas corregidas, para que la siguiente vuelta tome las que volvieron ✗.
func (s *sweeper) correctOnce(ctx context.Context, b *board, dir, topic string, round int, mine []*finding, set func(*finding, string, string)) []*finding {
	s.mu.Lock()
	var bad []*finding
	for _, f := range mine {
		if f.Verdict == "✗" {
			bad = append(bad, f)
		}
	}
	if len(bad) == 0 || ctx.Err() != nil {
		s.mu.Unlock()
		return nil
	}
	suffix := ""
	if round > 1 {
		suffix = fmt.Sprintf(" (%d)", round)
	}
	fixer := &agent{Topic: "corrector · " + topic + suffix, Status: "esperando", Steps: []step{}}
	recheck := &agent{Topic: "reverificador · " + topic + suffix, Status: "esperando", Steps: []step{}}
	b.Correctors = append(b.Correctors, fixer, recheck)
	var p strings.Builder
	fmt.Fprintf(&p, "Piezas rechazadas del tema %s, con lo que dijo el verificador:\n\n", topic)
	for _, f := range bad {
		raw, _ := json.Marshal(f.piece)
		fmt.Fprintf(&p, "%s\n%s\nVERIFICADOR: %s\n\n", f.ID, raw, f.Check)
	}
	s.mu.Unlock()
	p.WriteString(canonProse(ctx, []string{topic}))
	s.runOne(ctx, fixer, p.String(), canonCorrectorSystem, canonTools, sweepModel, sweepEffort, b.Budget, b.Mock, nil)
	_ = os.WriteFile(filepath.Join(dir, fmt.Sprintf("corrector-%s-%d.md", topic, round)), []byte(fixer.text), 0o644)

	s.mu.Lock()
	var fixed []*finding
	for _, piece := range parsePieces(fixer.text) {
		kind, label := pieceLabel(piece)
		f := &finding{ID: fmt.Sprintf("P%d", len(b.Findings)+1), Topic: topic, Kind: kind, Text: "(corregida) " + label, piece: piece}
		b.Findings = append(b.Findings, f)
		fixed = append(fixed, f)
		fixer.Findings++
	}
	s.mu.Unlock()
	if len(fixed) == 0 || ctx.Err() != nil {
		return nil
	}
	var q strings.Builder
	fmt.Fprintf(&q, "Piezas del tema %s. Comprobá cada una:\n\n", topic)
	for _, f := range fixed {
		raw, _ := json.Marshal(f.piece)
		fmt.Fprintf(&q, "%s\n%s\n\n", f.ID, raw)
	}
	q.WriteString(canonProse(ctx, []string{topic}))
	s.runOne(ctx, recheck, q.String(), canonVerifierSystem, canonTools, verifierModel, verifierLevel, b.CheckBudget, b.Mock, fixed)
	_ = os.WriteFile(filepath.Join(dir, fmt.Sprintf("reverificador-%s-%d.md", topic, round)), []byte(recheck.text), 0o644)
	s.mu.Lock()
	byID := map[string]*finding{}
	for _, f := range fixed {
		byID[f.ID] = f
	}
	for _, m := range reVerdict.FindAllStringSubmatch(recheck.text, -1) {
		if f := byID[m[1]]; f != nil {
			f.Verdict, f.Check = m[2], m[3]
		}
	}
	s.mu.Unlock()
	rehearse(ctx, dir, fixed, b.Mock, set)
	return fixed
}
