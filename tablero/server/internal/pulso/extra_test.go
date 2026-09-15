package pulso

import "testing"

func TestLoadParseaExtra(t *testing.T) {
	t.Setenv("PULSO_EXTRA", "playground-personal=/x/playground, otro=/y")
	c := Load()
	if len(c.Extra) != 2 || c.Extra[0].Name != "playground-personal" || c.Extra[0].Path != "/x/playground" || c.Extra[1].Name != "otro" {
		t.Fatalf("Extra mal parseado: %+v", c.Extra)
	}
	t.Setenv("PULSO_EXTRA", "")
	if len(Load().Extra) != 0 {
		t.Error("sin PULSO_EXTRA no puede haber extras")
	}
}
