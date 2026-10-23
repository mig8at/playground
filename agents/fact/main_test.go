package main

import (
	"context"
	"slices"
	"strings"
	"testing"
)

func first(int) int { return 0 }

func TestFallbackReply(t *testing.T) {
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
		if got := fallbackReply(q, first); got != "Dato curioso: "+want {
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

func TestReplyAsksTheModel(t *testing.T) {
	defer func(orig func(context.Context, string) string) { claudeWrite = orig }(claudeWrite)
	var prompt string
	claudeWrite = func(_ context.Context, p string) string { prompt = p; return "Dato curioso: algo nuevo." }
	if got := reply(context.Background(), "un dato de volcanes", first); got != "Dato curioso: algo nuevo." {
		t.Errorf("dio %q", got)
	}
	if !strings.Contains(prompt, "«un dato de volcanes»") || !strings.Contains(prompt, hints[0]) {
		t.Errorf("el prompt no lleva la pregunta o la pista:\n%s", prompt)
	}
}

func TestReplyFallsBackWithoutModel(t *testing.T) {
	defer func(orig func(context.Context, string) string) { claudeWrite = orig }(claudeWrite)
	claudeWrite = func(context.Context, string) string { return "" }
	if got := reply(context.Background(), "algo del espacio", first); got != "Dato curioso: "+topics[0].facts[0] {
		t.Errorf("dio %q", got)
	}
}
