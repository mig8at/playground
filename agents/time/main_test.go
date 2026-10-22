package main

import (
	"testing"
	"time"
)

// 2026-10-22 19:45 UTC: 2:45 p. m. en Bogotá.
var now = time.Date(2026, 10, 22, 19, 45, 0, 0, time.UTC)

func TestReply(t *testing.T) {
	cases := map[string]string{
		"¿qué hora es?":                    "En Bogotá son las 2:45 p. m. del jueves 22 de octubre.",
		"¿qué hora es en Madrid?":          "En Madrid son las 9:45 p. m. del jueves 22 de octubre.",
		"¿y en Tokio y en Lima?":           "En Tokio son las 4:45 a. m. del viernes 23 de octubre; en Lima son las 2:45 p. m. del jueves 22 de octubre.",
		"hora en santiago de chile":        "En Santiago de Chile son las 4:45 p. m. del jueves 22 de octubre.",
		"¿en Medellín y en Bogotá?":        "En Medellín son las 2:45 p. m. del jueves 22 de octubre.",
		"¿qué hora es en Bogotá y México?": "En Bogotá son las 2:45 p. m. del jueves 22 de octubre; en Ciudad de México es la 1:45 p. m. del jueves 22 de octubre.",
	}
	for q, want := range cases {
		if got := reply(q, now); got != want {
			t.Errorf("%q\n  dio   %q\n  quería %q", q, got, want)
		}
	}
}
