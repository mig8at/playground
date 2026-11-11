package main

import (
	"path/filepath"

	"creditop/playground/connectors/repos"
	"fmt"
	"strings"

	"creditop/playground/knowledge"
)

const knowledgeContextBytes = 12000

func buildKnowledgeContext(refs []string, dir string) knowledge.Context {
	if len(refs) == 0 {
		return knowledge.Context{Topics: []knowledge.Topic{}, Missing: []string{}, Pending: []string{}}
	}
	library, err := knowledge.Open(dir)
	if err != nil {
		return knowledge.Context{Topics: []knowledge.Topic{}, Missing: refs, Pending: []string{}, Error: err.Error()}
	}
	return library.Select(refs, knowledgeContextBytes)
}

func printKnowledgeContext(c knowledge.Context) {
	fmt.Println("\n  ── Conocimiento local ──")
	if c.Error != "" {
		fmt.Println("  ⚠ " + c.Error)
	}
	if len(c.Missing) > 0 {
		fmt.Println("  ⚠ referencias locales ausentes: " + strings.Join(c.Missing, ", "))
	}
	if len(c.Topics) == 0 && len(c.Missing) == 0 && len(c.Pending) == 0 {
		fmt.Println("  La tarea no declara knowledge:. Buscá si hace falta con make knowledge-search Q='…'; el código y las fuentes siguen disponibles.")
	}
	for _, topic := range c.Topics {
		fmt.Printf("\n  ▌ %s · %s\n  archivo: %s · fuentes: knowledge/%s/sources.json\n", topic.Title, topic.ID, topic.File, topic.ID)
		fmt.Println("  Revisión registrada: " + topic.ReviewedAt + "; knowledge-check contrasta las fuentes, sin certificar despliegues.")
		if topic.Intro != "" {
			fmt.Println("  " + strings.ReplaceAll(topic.Intro, "\n", "\n  "))
		}
		for _, section := range topic.Sections {
			fmt.Printf("\n  %s · %s\n  %s\n", section.Title, section.ID, strings.ReplaceAll(section.Text, "\n", "\n  "))
		}
	}
	if len(c.Pending) > 0 {
		fmt.Println("  No entraron completos en el presupuesto: " + strings.Join(c.Pending, ", ") + ". Leelos con make knowledge-read ID=<referencia>.")
	}
}

// Cuántas secciones se sugieren: más que esto deja de ser una pista y pasa a ser un índice.
const suggestedSections = 6

/* suggestKnowledge: las secciones que respaldan los archivos de las ramas de la tarea y que su `knowledge:`
 * no declara. Sale del snapshot de ramas y de los clones, sin red ni modelo. Un archivo central (unas rutas,
 * un servicio grande) toca muchas secciones: `Touched` las ordena por lo específico que es cada archivo. */
func suggestKnowledge(declared []string, branches []branchSnap, dir string) []knowledge.TouchedSection {
	if len(branches) == 0 {
		return nil
	}
	library, err := knowledge.Open(dir)
	if err != nil {
		return nil
	}
	client := repos.New(filepath.Join(filepath.Dir(dir), "tools"))
	seen, files := map[knowledge.RepoFile]bool{}, []knowledge.RepoFile{}
	for _, b := range branches {
		alias := knowledge.AliasOf(client, b.Repo)
		if alias == "" || b.Commit == "" {
			continue
		}
		root := client.Citable()[alias]
		base, _ := client.RefToIndex(root)
		merge := ""
		if b.PR != nil {
			merge = b.PR.MergeCommit
		}
		for _, path := range knowledge.ChangedBy(root, base, b.Commit, merge) {
			if f := (knowledge.RepoFile{Repo: alias, Path: path}); !seen[f] {
				seen[f] = true
				files = append(files, f)
			}
		}
	}
	has := map[string]bool{}
	for _, ref := range declared {
		has[ref], has[strings.SplitN(ref, "#", 2)[0]+"#*"] = true, !strings.Contains(ref, "#")
	}
	out := []knowledge.TouchedSection{}
	for _, s := range library.Touched(files) {
		if has[s.ID] || has[s.Topic+"#*"] {
			continue
		}
		out = append(out, s)
		if len(out) == suggestedSections {
			break
		}
	}
	return out
}

func printKnowledgeSuggested(sections []knowledge.TouchedSection) {
	if len(sections) == 0 {
		return
	}
	fmt.Println("\n  ── Conocimiento que tocan sus ramas y la tarea no declara ──")
	for _, s := range sections {
		fmt.Printf("  %s · %s (%d archivo(s) de la tarea)\n", s.ID, s.Title, len(s.Files))
	}
	fmt.Println("  Leelas con make knowledge-read ID=<referencia>; si sirven, sumalas a knowledge: de la tarea.")
}
