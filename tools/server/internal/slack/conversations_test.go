package slack

import "testing"

func TestNormalizeChannelName(t *testing.T) {
	cases := map[string]string{
		"prueba canal":      "prueba-canal",
		"Prueba Canal!!":    "prueba-canal",
		"  Hola  Mundo  ":   "hola-mundo",
		"equipo_loan":       "equipo_loan",
		"###":               "",
		"canal-2026":        "canal-2026",
	}
	for in, want := range cases {
		if got := NormalizeChannelName(in); got != want {
			t.Errorf("NormalizeChannelName(%q) = %q, quería %q", in, got, want)
		}
	}
}
