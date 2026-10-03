package main

import (
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
