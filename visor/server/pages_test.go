package main

import (
	"strings"
	"testing"

	"creditop/playground/connectors/figma"
)

// El buscador lee todas las páginas: una pantalla que no está en la de flujo se encuentra en la suya, con
// todas las palabras (sin tildes), y el nombre de la página también cuenta. Con `id` dice dónde vive.
func TestSearchPagesFindsScreensInEveryPage(t *testing.T) {
	lane := func(label string, screens ...figma.Screen) figma.Structure {
		return figma.Structure{Lanes: []figma.Lane{{Label: label, Screens: screens}}}
	}
	pages := []pageMap{
		{ID: "0:1", Name: "🟦 Cover"},
		{ID: "3:26", Name: "✏️ Flujo", St: lane("Cargando", figma.Screen{ID: "6448:24283", Title: "Mis créditos"})},
		{ID: "9448:11256", Name: "App_Q3_2026_v1.0", St: lane("Asesor",
			figma.Screen{ID: "10171:5278", Name: "Monto a solicitar", Title: "Ingresa el monto a solicitar"},
			figma.Screen{ID: "10171:5300", Title: "Créditos del cliente"})},
	}
	hits, total := searchPages(pages, "monto SOLICITAR", "")
	if total != 1 || hits[0].ID != "10171:5278" || hits[0].Page != "9448:11256" || hits[0].PageName != "App_Q3_2026_v1.0" || hits[0].Index != 1 || hits[0].Total != 2 {
		t.Fatalf("monto solicitar → %d %+v", total, hits)
	}
	if hits, _ := searchPages(pages, "creditos", ""); len(hits) != 2 {
		t.Errorf("«creditos» sin tilde tiene que encontrar las dos: %+v", hits)
	}
	if hits, _ := searchPages(pages, "q3 asesor", ""); len(hits) != 2 {
		t.Errorf("el nombre de la página y el carril cuentan: %+v", hits)
	}
	if hits, _ := searchPages(pages, "", "6448:24283"); len(hits) != 1 || hits[0].Page != "3:26" {
		t.Errorf("por id, la página donde vive: %+v", hits)
	}
	if hits, total := searchPages(pages, "   ", ""); total != 0 || len(hits) != 0 {
		t.Errorf("sin palabras no hay resultados: %+v", hits)
	}
}

// Las páginas que no son de pantallas no se leen: la portada, el benchmark y los separadores con rayas.
func TestHiddenPagesAreNotScreens(t *testing.T) {
	for name, hidden := range map[string]bool{
		"🟦 Cover": true, "Portada": true, "🔍 Bechmarck": true, "Benchmark": true, "———": true, "--- ": true, "": true,
		"✏️ Flujo": false, "App_Q3_2026_v1.0": false, "📲Prototipo": false, "Research - v2": false,
	} {
		if got := reHiddenPage.MatchString(name); got != hidden {
			t.Errorf("«%s»: oculta %v, se esperaba %v", name, got, hidden)
		}
	}
}

// Lo que DICE la pantalla también se busca: una palabra de un botón o de un párrafo la encuentra, con el
// pedazo donde está; y las que se encontraron por el título van primero en su página.
func TestSearchPagesFindsWhatTheScreenSays(t *testing.T) {
	st := figma.Structure{Lanes: []figma.Lane{{Label: "Asesor", Screens: []figma.Screen{
		{ID: "1:1", Title: "Tu cupo", Text: "Tu cupo · Tienes $8.000.000 disponibles para usar en Pullman · Solicitar crédito"},
		{ID: "1:2", Title: "Solicitar crédito"},
	}}}}
	pages := []pageMap{{ID: "3:26", Name: "Flujo", St: st}}
	hits, total := searchPages(pages, "solicitar credito", "")
	if total != 2 || hits[0].ID != "1:2" || hits[0].Match != "" || hits[1].ID != "1:1" {
		t.Fatalf("primero por el título, después por el texto: %+v", hits)
	}
	if hits[1].Match == "" || !strings.Contains(hits[1].Match, "Solicitar crédito") {
		t.Errorf("el pedazo tiene que mostrar dónde lo dice, con sus tildes: %q", hits[1].Match)
	}
	hits, _ = searchPages(pages, "pullman", "")
	if len(hits) != 1 || hits[0].ID != "1:1" || !strings.HasPrefix(hits[0].Match, "…") || !strings.Contains(hits[0].Match, "Pullman") {
		t.Errorf("una palabra del medio del texto, con «…» adelante: %+v", hits)
	}
}
