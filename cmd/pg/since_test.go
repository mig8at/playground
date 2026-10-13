package main

import (
	"testing"
	"time"
)

// `--since` acepta días y semanas además de lo de Go: `16d` fallaba y la búsqueda no corría (2026-10-13).
func TestParseSince(t *testing.T) {
	cases := map[string]time.Duration{
		"30m":  30 * time.Minute,
		"6h":   6 * time.Hour,
		"16d":  16 * 24 * time.Hour,
		"2w":   14 * 24 * time.Hour,
		"1.5d": 36 * time.Hour,
	}
	for in, want := range cases {
		got, err := parseSince(in)
		if err != nil || got != want {
			t.Errorf("parseSince(%q) = %v, %v; quería %v", in, got, err, want)
		}
	}
	for _, bad := range []string{"", "d", "xd", "-1d", "16 días"} {
		if _, err := parseSince(bad); err == nil {
			t.Errorf("parseSince(%q) debió fallar", bad)
		}
	}
}
