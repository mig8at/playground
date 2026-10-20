package ansi

import (
	"bytes"
	"fmt"
	"testing"
)

func TestStripKeepsTheTextAndDropsTheColors(t *testing.T) {
	if got := Strip("  \033[1mMi jornada\033[0m · \033[32m▂▄\033[0m"); got != "  Mi jornada · ▂▄" {
		t.Fatalf("%q", got)
	}
	if got := Strip("\033 suelto sin cerrar, que no es color ni se come el texto m"); got != "\033 suelto sin cerrar, que no es color ni se come el texto m" {
		t.Fatalf("se comió el texto: %q", got)
	}
}

func TestTheStripperReportsWhatItWasGiven(t *testing.T) {
	var b bytes.Buffer
	n, err := fmt.Fprintf(stripper{&b}, "\033[2m%d\033[0m", 7)
	if err != nil || n != len("\033[2m7\033[0m") || b.String() != "7" {
		t.Fatalf("n=%d err=%v out=%q", n, err, b.String())
	}
}
