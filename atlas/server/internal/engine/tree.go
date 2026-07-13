package engine

import (
	"fmt"
	"regexp"
	"sort"
	"strings"

	"creditop/atlas/server/internal/scan"
)

// FlowTree devuelve el árbol Rino de un flujo (sus archivos) con header de contexto.
func (e *Engine) FlowTree(flowID string) string {
	f, ok := e.Flow(flowID)
	if !ok {
		return ""
	}
	nodes := e.NodesByID(f.NodeIDs)
	return e.groupHeader([]Flow{f}, nodes) + e.Tree(f.NodeIDs)
}

// groupHeader arma el bloque de CONTEXTO TÉCNICO que abre el árbol: qué
// representa el flujo (descripciones + summary del enriquecimiento), los repos
// que usa y las tablas/BD involucradas. Es lo que un LLM lee primero.
func (e *Engine) groupHeader(flows []Flow, nodes []scan.Node) string {
	var stages []string
	descSeen := map[string]bool{}
	var descs, summaries []string
	for _, f := range flows {
		stages = append(stages, f.Name)
		if d := strings.TrimSpace(f.Description); d != "" && !descSeen[d] {
			descSeen[d] = true
			descs = append(descs, d)
		}
		if a, err := e.GetAnalysis(f.ID); err == nil && strings.TrimSpace(a.Summary) != "" {
			summaries = append(summaries, strings.TrimSpace(a.Summary))
		}
	}
	repoSet, tblSet := map[string]bool{}, map[string]bool{}
	var repos, tbls []string
	for _, n := range nodes {
		if !repoSet[n.Repo] {
			repoSet[n.Repo] = true
			repos = append(repos, n.Repo)
		}
		for _, t := range n.Tables {
			if !tblSet[t] {
				tblSet[t] = true
				tbls = append(tbls, t)
			}
		}
	}
	sort.Strings(repos)
	sort.Strings(tbls)

	rule := strings.Repeat("═", 74)
	var b strings.Builder
	b.WriteString("# " + rule + "\n")
	b.WriteString("# FLUJO: " + strings.Join(stages, " → ") + "\n")
	b.WriteString("# " + rule + "\n#\n")
	for _, d := range descs {
		b.WriteString(wrapComment(d) + "#\n")
	}
	for _, s := range summaries {
		b.WriteString(wrapComment(s) + "#\n")
	}
	b.WriteString("# Repos:    " + strings.Join(repos, ", ") + "\n")
	if len(tbls) > 0 {
		b.WriteString(wrapComment("Tablas/BD: " + strings.Join(tbls, ", ")))
	}
	b.WriteString("# Etapas:   " + strings.Join(stages, " → ") + "\n")
	b.WriteString(fmt.Sprintf("# Archivos: %d\n", len(nodes)))
	b.WriteString("# " + rule + "\n\n")
	return b.String()
}

// wrapComment envuelve un texto largo a ~78 cols con prefijo "# ".
func wrapComment(s string) string {
	const width = 78
	var b strings.Builder
	for _, para := range strings.Split(s, "\n") {
		words := strings.Fields(para)
		line := "# "
		for _, w := range words {
			if len(line)+len(w)+1 > width && line != "# " {
				b.WriteString(strings.TrimRight(line, " ") + "\n")
				line = "# "
			}
			line += w + " "
		}
		b.WriteString(strings.TrimRight(line, " ") + "\n")
	}
	return b.String()
}

// ComboTree arma el árbol Rino de TODOS los flujos de una combinación (unión
// dedup). Útil para el MCP (atlas_tree combination).
func (e *Engine) ComboTree(comboID string) string {
	seen := map[string]bool{}
	var ids []string
	for _, f := range e.Flows() {
		if f.Combination != comboID {
			continue
		}
		for _, id := range f.NodeIDs {
			if !seen[id] {
				seen[id] = true
				ids = append(ids, id)
			}
		}
	}
	return e.Tree(ids)
}

// groupOf devuelve la fila/flujo de negocio de un flujo (fallback: su id).
func groupOf(f Flow) string {
	if f.Group != "" {
		return f.Group
	}
	return f.ID
}

// ComboGroupTrees arma, POR FILA (group), el árbol Rino del flujo completo de
// esa fila: la unión dedup de las etapas de esa fila. Cada fila tiene su propio
// (copiar). Mapa group→árbol.
func (e *Engine) ComboGroupTrees(comboID string) map[string]string {
	flowsByGroup := map[string][]Flow{}
	idsByGroup := map[string][]string{}
	seen := map[string]map[string]bool{}
	for _, f := range e.Flows() {
		if f.Combination != comboID {
			continue
		}
		g := groupOf(f)
		if seen[g] == nil {
			seen[g] = map[string]bool{}
		}
		flowsByGroup[g] = append(flowsByGroup[g], f)
		for _, id := range f.NodeIDs {
			if !seen[g][id] {
				seen[g][id] = true
				idsByGroup[g] = append(idsByGroup[g], id)
			}
		}
	}
	out := map[string]string{}
	for g, ids := range idsByGroup {
		fls := flowsByGroup[g]
		sort.SliceStable(fls, func(i, j int) bool { return fls[i].Created.Before(fls[j].Created) }) // etapas en orden canal→lender
		header := e.groupHeader(fls, e.NodesByID(ids))
		out[g] = header + e.Tree(ids)
	}
	return out
}

// Tree arma, para un set de archivos, el "árbol estilo Rino": la estructura de
// carpetas con box-drawing (├─/└─) y el CONTENIDO de cada archivo inline y
// colapsado (saltos de línea → ↵, espacios colapsados). Es el blob pegable a un
// LLM. Agrupa por repo (cada repo es una raíz).
func (e *Engine) Tree(ids []string) string {
	nodes := e.NodesByID(ids)
	content, _ := e.Content(ids)

	// agrupa nodos por repo, preservando aparición
	byRepo := map[string]*tnode{}
	var repoOrder []string
	for _, n := range nodes {
		root, ok := byRepo[n.Repo]
		if !ok {
			root = &tnode{name: n.Repo}
			byRepo[n.Repo] = root
			repoOrder = append(repoOrder, n.Repo)
		}
		cur := root
		parts := strings.Split(n.Path, "/")
		for i, p := range parts {
			cur = cur.child(p)
			if i == len(parts)-1 {
				cur.file = true
				cur.content = collapse(content[n.ID])
			}
		}
	}

	var sb strings.Builder
	for i, repo := range repoOrder {
		if i > 0 {
			sb.WriteString("\n")
		}
		renderTree(&sb, byRepo[repo], "", true, true)
	}
	return sb.String()
}

type tnode struct {
	name     string
	children map[string]*tnode
	order    []string
	file     bool
	content  string
}

func (t *tnode) child(name string) *tnode {
	if t.children == nil {
		t.children = map[string]*tnode{}
	}
	c, ok := t.children[name]
	if !ok {
		c = &tnode{name: name}
		t.children[name] = c
		t.order = append(t.order, name)
	}
	return c
}

func renderTree(sb *strings.Builder, n *tnode, indent string, isLast, root bool) {
	var childIndent string
	if root {
		sb.WriteString(n.name + "/\n")
		childIndent = ""
	} else {
		conn := "├─ "
		if isLast {
			conn = "└─ "
		}
		if n.file {
			line := indent + conn + n.name
			if n.content != "" {
				line += " " + n.content
			}
			sb.WriteString(line + "\n")
		} else {
			sb.WriteString(indent + conn + n.name + "/\n")
		}
		if isLast {
			childIndent = indent + "   "
		} else {
			childIndent = indent + "│  "
		}
	}

	// ordena: carpetas primero, luego archivos, alfabético
	kids := make([]*tnode, 0, len(n.order))
	for _, k := range n.order {
		kids = append(kids, n.children[k])
	}
	sort.SliceStable(kids, func(i, j int) bool {
		if kids[i].file != kids[j].file {
			return !kids[i].file // dirs antes que files
		}
		return kids[i].name < kids[j].name
	})
	for i, c := range kids {
		renderTree(sb, c, childIndent, i == len(kids)-1, false)
	}
}

var (
	reNewline = regexp.MustCompile(`[\r\n]+`)
	reReturns = regexp.MustCompile(`↵+`)
	reSpaces  = regexp.MustCompile(`\s+`)
)

// collapse replica el formatContent de Rino: saltos de línea → ↵ (colapsados),
// espacios colapsados a uno.
func collapse(s string) string {
	if strings.TrimSpace(s) == "" {
		return ""
	}
	s = reNewline.ReplaceAllString(s, "↵")
	s = reReturns.ReplaceAllString(s, "↵")
	s = reSpaces.ReplaceAllString(s, " ")
	return strings.TrimSpace(s)
}
