package engine

import (
	"fmt"
	"sort"
	"strings"
	"unicode"
)

// ── L0: el BRIEF ───────────────────────────────────────────────────────────────
//
// El árbol de context es documentación curada (un doc.md rico por nodo + una
// superficie de archivos verificada). El problema al usarlo desde un LLM no es
// que falte información: es que sobra. Volcar el árbol entero no entra en una
// ventana de contexto, y las tools viejas exigen que YA sepas el id del nodo.
//
// El brief es el escalón que faltaba — una ESCALERA de disclosure, barata primero:
//
//	L0  Brief(task)     índice de nodos (1 línea c/u) + candidatos     ~1.5k tokens
//	L1  Doc(id)         el doc.md completo del nodo + vecinos          ~2-5k por nodo
//	L2  Surface(id)     la superficie de código, agrupada              ~0.5-2k
//	L3  Content(ids)    el código real                                 lo que pidas
//
// El ruteo lo hace EL MODELO, no el servidor: acá se devuelve el índice + la
// evidencia léxica de qué nodos menciona la tarea, y el modelo elige. Sin
// embeddings a propósito — es determinista, explicable y no se desincroniza
// cuando se edita un doc.

// NodeBrief es un nodo del árbol en 1 línea: lo justo para decidir si abrirlo.
type NodeBrief struct {
	ID       string   `json:"id"`
	Name     string   `json:"name"`
	Role     string   `json:"role"`            // raiz | contexto | task
	Group    string   `json:"group,omitempty"` // padre lógico (de dónde cuelga)
	When     string   `json:"when,omitempty"`  // CUÁNDO usar este nodo ← la señal de ruteo
	TLDR     string   `json:"tldr,omitempty"`  // qué ES (status line del doc)
	Files    int      `json:"files"`           // tamaño de su superficie de código
	DocLines int      `json:"doc_lines"`       // costo aproximado de abrirlo (L1)
	Children []string `json:"children,omitempty"`
	Contexts []string `json:"contexts,omitempty"` // (task) los nodos que compone
}

// Hint = un nodo candidato para la tarea, con la evidencia de por qué.
type Hint struct {
	ID      string   `json:"id"`
	Score   int      `json:"score"`
	Matched []string `json:"matched"`         // términos de la tarea que pegaron
	Where   []string `json:"where,omitempty"` // líneas del doc como evidencia
}

// Brief es la respuesta de L0: con esto un modelo sabe por dónde entrar.
type Brief struct {
	Task       string      `json:"task,omitempty"`
	Index      []NodeBrief `json:"index"`
	Hints      []Hint      `json:"hints,omitempty"`
	Precedents []Precedent `json:"precedents,omitempty"` // tareas parecidas YA resueltas (ver tasklog.go)
	Protocol   []string    `json:"protocol"`
	Note       string      `json:"note,omitempty"`
}

// roleFromKind traduce el kind del map.json al rol del modelo contexto/task.
func roleFromKind(kind string) string {
	switch kind {
	case "root":
		return "raiz"
	case "task":
		return "task"
	default:
		return "contexto"
	}
}

// tldrFrom extrae el resumen de 1 línea de un doc.md. Convención de las plantillas:
// la línea 2 es la status line — "> **estado:** al día con main · <TL;DR>" en los
// contextos, o "> **rama:** … **estado:** …" en las tasks (donde el TL;DR va después,
// tras una línea ">" vacía).
func tldrFrom(doc string) string {
	lines := strings.Split(doc, "\n")
	var quoted []string
	for i := 1; i < len(lines) && i < 8; i++ {
		l := strings.TrimSpace(lines[i])
		if !strings.HasPrefix(l, ">") {
			if len(quoted) > 0 {
				break
			}
			continue
		}
		if t := strings.TrimSpace(strings.TrimPrefix(l, ">")); t != "" {
			quoted = append(quoted, t)
		}
	}
	if len(quoted) == 0 {
		return ""
	}
	// en las tasks el TL;DR real es la línea siguiente a la de rama/PR
	s := quoted[0]
	if strings.Contains(s, "**rama:**") && len(quoted) > 1 {
		s = quoted[1]
	} else if i := strings.Index(s, " · "); i >= 0 && strings.Contains(s[:i], "estado:") {
		s = s[i+len(" · "):] // saca el "**estado:** al día con main · "
	}
	s = strings.NewReplacer("**", "", "`", "").Replace(s)
	return truncate(s, 240)
}

func truncate(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return strings.TrimSpace(string(r[:n])) + "…"
}

// Index arma el índice completo del árbol (L0). Es barato: no lee código, solo
// los doc.md ya cargados en Flow.Description.
func (e *Engine) Index() []NodeBrief {
	children := map[string][]string{}
	contexts := map[string][]string{}
	for _, c := range e.Combinations() {
		if c.Parent != "" {
			children[c.Parent] = append(children[c.Parent], c.ID)
		}
		if len(c.Contexts) > 0 {
			contexts[c.ID] = c.Contexts
		}
	}
	var out []NodeBrief
	for _, f := range e.Flows() {
		doc := f.Description
		// when/tldr se truncan SOLO acá (el render del índice): el matching del
		// Brief usa f.When/doc completos, así que recortar no cambia el ruteo —
		// solo mantiene el L0 barato aunque los docs crezcan.
		out = append(out, NodeBrief{
			ID: f.ID, Name: f.Name, Role: roleFromKind(f.Kind), Group: f.Group,
			When: truncate(f.When, 200), TLDR: truncate(tldrFrom(doc), 140), Files: len(f.NodeIDs),
			DocLines: strings.Count(doc, "\n") + 1,
			Children: children[f.ID], Contexts: contexts[f.ID],
		})
	}
	// raíz primero, después contextos, después tasks; alfabético dentro de cada rol
	rank := map[string]int{"raiz": 0, "contexto": 1, "task": 2}
	sort.Slice(out, func(i, j int) bool {
		if rank[out[i].Role] != rank[out[j].Role] {
			return rank[out[i].Role] < rank[out[j].Role]
		}
		return out[i].ID < out[j].ID
	})
	return out
}

// stopwords: ruido que no discrimina un nodo de otro (es + en el vocabulario con
// el que llega una tarea, con algo de inglés por los términos técnicos).
var stopwords = map[string]bool{
	"para": true, "pero": true, "como": true, "cuando": true, "donde": true, "porque": true,
	"esta": true, "este": true, "esto": true, "esos": true, "esas": true, "hace": true,
	"hacer": true, "tiene": true, "tengo": true, "necesito": true, "quiero": true,
	"puede": true, "debe": true, "sobre": true, "desde": true, "hasta": true, "entre": true,
	"todo": true, "toda": true, "todos": true, "cada": true, "otro": true, "otra": true,
	"nuevo": true, "nueva": true, "bien": true, "solo": true, "algo": true, "algun": true,
	"tarea": true, "issue": true, "ticket": true, "favor": true, "ayuda": true,
	"with": true, "that": true, "this": true, "from": true, "have": true, "need": true,
	"should": true, "would": true, "does": true, "what": true, "when": true, "where": true,
}

// fold normaliza para comparar: minúsculas y sin acentos.
func fold(s string) string {
	s = strings.ToLower(s)
	rep := strings.NewReplacer("á", "a", "é", "e", "í", "i", "ó", "o", "ú", "u", "ü", "u", "ñ", "n")
	return rep.Replace(s)
}

// stem recorta sufijos flexivos del español para que "desembolsar" pegue con
// "desembolso" y "listado" con "listar". Conservador a propósito: solo actúa en
// palabras largas y nunca deja una raíz de menos de 5 letras (una raíz corta
// matchea cualquier cosa y ensucia el ruteo más de lo que ayuda).
func stem(w string) string {
	if len(w) < 7 {
		return w
	}
	for _, suf := range []string{"ciones", "ando", "endo", "ados", "idos", "ar", "er", "ir", "ado", "ido", "es", "s"} {
		if strings.HasSuffix(w, suf) && len(w)-len(suf) >= 5 {
			return w[:len(w)-len(suf)]
		}
	}
	return w
}

// terms saca los términos con carga semántica del enunciado de una tarea.
func terms(task string) []string {
	f := fold(task)
	raw := strings.FieldsFunc(f, func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r)
	})
	seen := map[string]bool{}
	var out []string
	for _, w := range raw {
		if len(w) < 4 || stopwords[w] || seen[w] {
			continue
		}
		seen[w] = true
		out = append(out, w)
	}
	return out
}

// Brief resuelve L0: índice + candidatos para una tarea. Si task viene vacío
// devuelve solo el índice (útil para "mostrame el árbol").
func (e *Engine) Brief(task string) Brief {
	b := Brief{
		Task:  strings.TrimSpace(task),
		Index: e.Index(),
		Protocol: []string{
			"L0 (estás acá): elegí 2-4 nodos del índice. 'when' dice cuándo sirve cada nodo; 'hints' son candidatos por match léxico con tu tarea — son una PISTA, no un veredicto: decidí vos.",
			"L1: context_get_doc {id} por cada nodo elegido → el doc completo + sus vecinos. Empezá por el de score más alto; si el doc te manda a un hermano, seguilo.",
			"L2: context_files {id} → la superficie de código curada del nodo, agrupada por repo/subsistema. Sirve para elegir QUÉ abrir sin adivinar rutas.",
			"L3: context_get_content {ids} → el código real de los archivos que elegiste.",
			"Si la tarea toca datos/tablas, estados, frontera de pruebas o deuda técnica, abrí la raíz 'creditop': es el hogar de lo transversal que ningún contexto dueña.",
			"Al RESOLVER la tarea, cerrá el ciclo: context_record_task {task, nodes} con los nodos que DE VERDAD sirvieron — la próxima tarea parecida arranca con ese precedente.",
		},
	}
	ts := terms(task)
	if len(ts) == 0 {
		b.Note = "Sin tarea: devuelvo solo el índice. Pasá 'task' con el enunciado para recibir candidatos."
		return b
	}
	for _, f := range e.Flows() {
		doc := f.Description
		fID, fName, fWhen := fold(f.ID), fold(f.Name), fold(f.When)
		fTLDR, fDoc := fold(tldrFrom(doc)), fold(doc)
		h := Hint{ID: f.ID}
		for _, t := range ts {
			// se prueba el término tal cual y, si no pega, su raíz (desembolsar→desembols)
			hit := func(hay string) bool {
				if strings.Contains(hay, t) {
					return true
				}
				if s := stem(t); s != t {
					return strings.Contains(hay, s)
				}
				return false
			}
			w := 0
			switch {
			case hit(fID) || hit(fName):
				w = 5
			case hit(fWhen):
				w = 4
			case hit(fTLDR):
				w = 3
			case hit(fDoc):
				w = 1
			}
			if w > 0 {
				h.Score += w
				h.Matched = append(h.Matched, t)
			}
		}
		if h.Score == 0 {
			continue
		}
		h.Where = evidence(doc, h.Matched, 2)
		b.Hints = append(b.Hints, h)
	}
	sort.Slice(b.Hints, func(i, j int) bool {
		if b.Hints[i].Score != b.Hints[j].Score {
			return b.Hints[i].Score > b.Hints[j].Score
		}
		return b.Hints[i].ID < b.Hints[j].ID
	})
	if len(b.Hints) > 8 {
		b.Hints = b.Hints[:8] // más allá de esto ya es ruido
	}
	if b.Precedents = e.Precedents(task, 3); len(b.Precedents) > 0 {
		b.Protocol = append(b.Protocol,
			"PRECEDENTES: tareas parecidas YA resueltas y con qué nodos — la señal más confiable (es uso real, no inferencia léxica). Arrancá por sus nodos y validá contra el 'when'.")
	}
	return b
}

// evidence devuelve hasta n líneas del doc donde pegaron los términos (la prueba
// de por qué el nodo es candidato; sin esto el score es un número sin respaldo).
func evidence(doc string, matched []string, n int) []string {
	var out []string
	for _, line := range strings.Split(doc, "\n") {
		l := strings.TrimSpace(line)
		if len(l) < 20 || strings.HasPrefix(l, "#") {
			continue
		}
		fl := fold(l)
		for _, t := range matched {
			if strings.Contains(fl, t) || strings.Contains(fl, stem(t)) {
				out = append(out, truncate(strings.NewReplacer("**", "", "`", "").Replace(l), 140))
				break
			}
		}
		if len(out) >= n {
			break
		}
	}
	return out
}

// ── L2: la SUPERFICIE ──────────────────────────────────────────────────────────

// FileGroup agrupa la superficie de un nodo por repo + subsistema, para poder
// leerla de un vistazo en vez de como una lista plana de 100 rutas.
type FileGroup struct {
	Repo  string   `json:"repo"`
	Dir   string   `json:"dir"`
	Count int      `json:"count"`
	Files []string `json:"files"` // relativas a Dir
}

// Surface es la respuesta de L2. Los campos self (Total/ByRepo/Groups) describen
// SIEMPRE el nodo pedido; Members/UnionTotal/Truncated solo se llenan cuando se pide
// composición (include=children|contexts) — nunca hay herencia en los datos, solo
// agregación bajo demanda en la lectura.
type Surface struct {
	ID         string          `json:"id"`
	Name       string          `json:"name"`
	Total      int             `json:"total"`
	ByRepo     map[string]int  `json:"by_repo"`
	Groups     []FileGroup     `json:"groups"`
	Members    []MemberSurface `json:"members,omitempty"`     // (include) subcontextos/chips agregados
	UnionTotal int             `json:"union_total,omitempty"` // (include) self ∪ members, deduplicado
	Truncated  bool            `json:"truncated,omitempty"`   // (include) unión > tope: members traen solo conteos
	Note       string          `json:"note,omitempty"`
}

// MemberSurface es la superficie de un nodo agregado (hijo o chip) dentro de una
// lectura compuesta. Groups viene vacío si la unión superó el tope (solo conteos).
type MemberSurface struct {
	ID     string         `json:"id"`
	Name   string         `json:"name"`
	Rel    string         `json:"rel"` // child | context
	Total  int            `json:"total"`
	ByRepo map[string]int `json:"by_repo"`
	Groups []FileGroup    `json:"groups,omitempty"`
}

// flatKeys devuelve las claves "repo/relpath" que RESUELVEN de un nodo (las mismas
// que cuenta Surface). Base para deduplicar la unión en la lectura compuesta.
func (e *Engine) flatKeys(id string) []string {
	f, ok := e.Flow(id)
	if !ok {
		return nil
	}
	_, byID := e.pathMaps()
	var out []string
	for _, nid := range f.NodeIDs {
		if k, ok := byID[nid]; ok {
			out = append(out, k)
		}
	}
	return out
}

// maxComposedFiles es el tope anti-saturación de la lectura compuesta: si la unión
// self ∪ members lo supera, se devuelven conteos por nodo en vez de volcar archivos.
// Es el guardarraíl que impide que include reconstruya el monolito que se fragmentó.
const maxComposedFiles = 150

// SurfaceComposed agrega, BAJO DEMANDA y UN SOLO NIVEL, la superficie de los hijos
// (include="children") o de los chips de una task (include="contexts") a la del nodo.
// No hay herencia persistida: esto compone al leer, deduplica para el conteo honesto,
// y si la unión pasa el tope devuelve solo conteos (el modelo elige qué pedir).
func (e *Engine) SurfaceComposed(id, include string) (Surface, bool) {
	base, ok := e.Surface(id)
	if !ok {
		return Surface{}, false
	}
	n := e.Neighbors(id)
	var memberIDs []string
	rel := "child"
	switch include {
	case "children":
		memberIDs = n.Children
	case "contexts":
		memberIDs, rel = n.Contexts, "context"
	default:
		return base, true // include desconocido/vacío → self, sin cambios
	}
	if len(memberIDs) == 0 {
		base.Note = fmt.Sprintf("El nodo %q no tiene %s; devuelvo solo su superficie.", id, include)
		return base, true
	}
	// unión deduplicada (self ∪ members) para decidir el tope y dar un conteo honesto
	union := map[string]bool{}
	for _, k := range e.flatKeys(id) {
		union[k] = true
	}
	for _, mid := range memberIDs {
		for _, k := range e.flatKeys(mid) {
			union[k] = true
		}
	}
	base.UnionTotal = len(union)
	base.Truncated = len(union) > maxComposedFiles
	for _, mid := range memberIDs {
		f, okf := e.Flow(mid)
		if !okf {
			continue
		}
		keys := e.flatKeys(mid)
		m := MemberSurface{ID: mid, Name: f.Name, Rel: rel, Total: len(keys), ByRepo: map[string]int{}}
		for _, k := range keys {
			repo, _, _ := strings.Cut(k, "/")
			m.ByRepo[repo]++
		}
		if !base.Truncated {
			if sf, oks := e.Surface(mid); oks {
				m.Groups = sf.Groups
			}
		}
		base.Members = append(base.Members, m)
	}
	if base.Truncated {
		base.Note = fmt.Sprintf("Unión = %d archivos (> %d): devuelvo la superficie de %q + CONTEOS por %s. Pedí context_files del/los que necesites para ver sus archivos.", base.UnionTotal, maxComposedFiles, id, include)
	} else {
		base.Note = fmt.Sprintf("Superficie de %q + la de sus %d %s (agregada, deduplicada = %d). Rutas completas = <repo>/<dir>/<file>.", id, len(base.Members), include, base.UnionTotal)
	}
	return base, true
}

// Surface devuelve la superficie de código curada del nodo, agrupada. Solo
// incluye lo que RESUELVE contra el índice actual (igual que la UI): si un
// archivo se movió o el repo no está escaneado, no aparece.
func (e *Engine) Surface(id string) (Surface, bool) {
	f, ok := e.Flow(id)
	if !ok {
		return Surface{}, false
	}
	_, byID := e.pathMaps()
	s := Surface{ID: f.ID, Name: f.Name, ByRepo: map[string]int{}}
	// agrupa por repo + los 2 primeros segmentos del path (el "subsistema")
	idx := map[string]int{}
	for _, nid := range f.NodeIDs {
		key, okp := byID[nid]
		if !okp {
			continue
		}
		repo, rel, _ := strings.Cut(key, "/")
		s.Total++
		s.ByRepo[repo]++
		segs := strings.Split(rel, "/")
		cut := len(segs) - 1
		if cut > 2 {
			cut = 2
		}
		dir := strings.Join(segs[:cut], "/")
		gk := repo + "\x00" + dir
		gi, seen := idx[gk]
		if !seen {
			gi = len(s.Groups)
			idx[gk] = gi
			s.Groups = append(s.Groups, FileGroup{Repo: repo, Dir: dir})
		}
		s.Groups[gi].Files = append(s.Groups[gi].Files, strings.TrimPrefix(strings.TrimPrefix(rel, dir), "/"))
		s.Groups[gi].Count++
	}
	sort.Slice(s.Groups, func(i, j int) bool {
		if s.Groups[i].Repo != s.Groups[j].Repo {
			return s.Groups[i].Repo < s.Groups[j].Repo
		}
		return s.Groups[i].Dir < s.Groups[j].Dir
	})
	s.Note = "Rutas completas = <repo>/<dir>/<file>. Para el código real: context_get_content con esas rutas."
	return s, true
}

// Neighbors devuelve los vecinos de un nodo en el árbol (padre, hijos, hermanos)
// para que un modelo pueda navegar sin volver a pedir el índice completo.
type Neighbors struct {
	Parent   string   `json:"parent,omitempty"`
	Children []string `json:"children,omitempty"`
	Siblings []string `json:"siblings,omitempty"`
	Contexts []string `json:"contexts,omitempty"` // (task) los contextos que compone
}

func (e *Engine) Neighbors(id string) Neighbors {
	var n Neighbors
	combos := e.Combinations()
	var parent string
	for _, c := range combos {
		if c.ID == id {
			parent = c.Parent
			n.Parent = c.Parent
			n.Contexts = c.Contexts
			break
		}
	}
	for _, c := range combos {
		switch {
		case c.Parent == id:
			n.Children = append(n.Children, c.ID)
		case parent != "" && c.Parent == parent && c.ID != id:
			n.Siblings = append(n.Siblings, c.ID)
		}
	}
	sort.Strings(n.Children)
	sort.Strings(n.Siblings)
	return n
}
