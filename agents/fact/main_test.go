package main

import (
	"slices"
	"strings"
	"testing"
)

func first(int) int { return 0 }

func TestReply(t *testing.T) {
	cases := map[string]string{
		"dime algo del espacio":  topics[0].facts[0],
		"¿un dato de ANIMALES?":  topics[1].facts[0],
		"algo del cuerpo humano": topics[2].facts[0],
		"cuéntame de historia":   topics[3].facts[0],
		"un dato de física":      topics[4].facts[0],
		"dime un dato curioso":   topics[0].facts[0],
		"solamente algo":         topics[0].facts[0], // «sol» dentro de otra palabra no cuenta como tema
	}
	for q, want := range cases {
		if got := reply(q, first); got != "Dato curioso: "+want {
			t.Errorf("%q\n  dio    %q\n  quería %q", q, got, want)
		}
	}
}

func TestWithoutTopicUsesEveryFact(t *testing.T) {
	all := candidates("sorpréndeme")
	for _, topic := range topics {
		for _, f := range topic.facts {
			if !slices.Contains(all, f) {
				t.Errorf("falta %q", f)
			}
			if !strings.HasSuffix(f, ".") {
				t.Errorf("sin punto final: %q", f)
			}
		}
	}
}
