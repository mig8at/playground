package main

import "testing"

// Lo que se pega sale de la barra del navegador: con o sin query, con o sin el tramo final.
func TestParseInput(t *testing.T) {
	cases := []struct {
		raw     string
		request int
		hash    string
	}{
		{"504059", 504059, ""},
		{"  504059 \n", 504059, ""},
		{"https://originaciones-qa.dev.creditop.com/ecommerce/8ffe96e2/504059/lenders", 504059, "8ffe96e2"},
		{"https://originaciones-qa.dev.creditop.com/ecommerce/8ffe96e2/504059", 504059, "8ffe96e2"},
		{"https://originaciones-qa.dev.creditop.com/ecommerce/8ffe96e2/504059/lenders?x=1", 504059, "8ffe96e2"},
		{"http://localhost:5174/c390eed9/467513/profile", 467513, "c390eed9"},
	}
	// El celular, como se copia de cualquier lado: siempre los 10 dígitos sin indicativo.
	for _, raw := range []string{"3016992677", "+573016992677", "57 301 699 2677", "301-699-2677", "(301) 699 2677"} {
		in, err := ParseInput(raw)
		if err != nil || in.Phone != "3016992677" || in.Request != 0 {
			t.Errorf("ParseInput(%q) = %+v, %v; quería el celular 3016992677", raw, in, err)
		}
	}
	for _, c := range cases {
		in, err := ParseInput(c.raw)
		if err != nil || in.Request != c.request || in.Hash != c.hash {
			t.Errorf("ParseInput(%q) = %+v, %v; quería %d %q", c.raw, in, err, c.request, c.hash)
		}
	}
	for _, bad := range []string{"", "hola", "https://originaciones-qa.dev.creditop.com/ecommerce/", "6011234567", "1234567890123"} {
		if _, err := ParseInput(bad); err == nil {
			t.Errorf("ParseInput(%q) no dio error", bad)
		}
	}
}

// El aviso de «la tienda mandó otro nombre» es el que destapó la 504059: no puede saltar por tildes,
// mayúsculas ni por un segundo nombre que la tienda no mandó, y sí tiene que saltar con otra persona.
func TestSameName(t *testing.T) {
	same := [][2]string{
		{"Miguel Ochoa", "MIGUEL ANGEL OCHOA TORRES"},
		{"José Pérez", "JOSE PEREZ GOMEZ"},
		{"Miguel Angel Ochoa Torres", "miguel angel ochoa torres"},
	}
	for _, p := range same {
		if !sameName(p[0], p[1]) {
			t.Errorf("sameName(%q, %q) = false; es la misma persona", p[0], p[1])
		}
	}
	if sameName("Miguel Angel Ochoa Torres", "JUAN CARLOZ PEREZ GOMEZ") {
		t.Error("sameName dio true para dos personas distintas")
	}
}

// Sin variable de permiso (decisión de Miguel, 2026-10-26): qa se puede borrar si tiene credenciales. Lo que
// no puede es prod, que ni siquiera es un ambiente de tests.
func TestWriteTargets(t *testing.T) {
	t.Setenv("I_KNOW_THIS_TOUCHES_SHARED_DEV", "")
	if validTarget("prod") {
		t.Fatal("prod quedó como ambiente de tests")
	}
	if _, err := writeConfig("qa"); err == nil && writeBlocked("qa") != "" {
		t.Fatalf("qa sigue bloqueado sin la variable: %s", writeBlocked("qa"))
	}
}
