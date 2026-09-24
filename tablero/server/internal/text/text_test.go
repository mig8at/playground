package text

import (
	"regexp"
	"strings"
	"testing"
)

func TestSplitLinesCutsWhereStrSplitlinesCuts(t *testing.T) {
	got := SplitLines("a\r\nb\rc\fd\x1ee f\n")
	if strings.Join(got, "|") != "a|b|c|d|e|f" {
		t.Errorf("SplitLines = %q", got)
	}
	if got := SplitLines(""); len(got) != 0 {
		t.Errorf("SplitLines(\"\") = %q, quería nada", got)
	}
}

func TestStripAlsoRemovesTheInformationSeparators(t *testing.T) {
	if got := Strip("\x1f\t  $x = 1;  "); got != "$x = 1;" {
		t.Errorf("Strip = %q", got)
	}
}

// La clase de la expresión y la función tienen que decir lo mismo de cada carácter, o una expresión
// portada y el código de al lado no estarían de acuerdo sobre qué es un espacio.
func TestTheSpaceClassAgreesWithIsSpace(t *testing.T) {
	space := regexp.MustCompile(`^` + Space + `$`)
	for r := rune(0); r <= 0x3100; r++ {
		if space.MatchString(string(r)) != IsSpace(r) {
			t.Errorf("U+%04X: la clase dice %v y IsSpace %v", r, space.MatchString(string(r)), IsSpace(r))
		}
	}
}
