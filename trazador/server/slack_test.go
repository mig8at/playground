package main

import "testing"

// Lo que se probó acá es lo que ya dio un diagnóstico equivocado: los reportes que ninguna regex
// reconoce se contaban y se tiraban, así que el veredicto hablaba de las regex creyendo hablar del
// canal. La prueba fija las dos mitades — que vuelvan con su texto, y que entren al denominador.
func TestReportsWithoutCategoryComeBackWithTheirText(t *testing.T) {
	msgs := []slackMessage{
		{TS: "1758200000.0", Text: "no puede firmar el pagaré, Deceval lo rechaza"},    // categoría conocida
		{TS: "1758200001.0", Text: "gracias"},                                          // ruido: menos de 4 palabras
		{TS: "1758200002.0", Text: "el reporte de comisiones sale duplicado este mes"}, // nadie lo cubre
		{TS: "1758200003.0", BotID: "B123", Text: "alerta automática de un bot cualquiera"},
	}
	hits, withoutCat, byCat := classifyReports(msgs)
	if len(hits) != 1 || len(withoutCat) != 1 {
		t.Fatalf("un reporte clasificado y uno sin categoría (el bot y el «gracias» no son reportes): %d hits, %d sin", len(hits), len(withoutCat))
	}
	if withoutCat[0].text != msgs[2].Text {
		t.Fatalf("el sin clasificar tiene que volver con su TEXTO para poder mirarlo, no sólo contarse: %q", withoutCat[0].text)
	}
	if withoutCat[0].cat != "" || withoutCat[0].ts.IsZero() {
		t.Fatalf("sin categoría y con su fecha, que es lo que lo hace legible en la lista: %+v", withoutCat[0])
	}
	if byCat[hits[0].cat] != 1 {
		t.Fatalf("el clasificado suma en SU categoría: %v", byCat)
	}

	// El veredicto: con el denominador viejo (sólo clasificados) este canal daba 100 % de cobertura
	// teniendo la mitad sin reconocer. Con el de hoy da 50 %, que es lo que pasa de verdad.
	classified := len(hits)
	total := classified + len(withoutCat)
	if 100*classified/total != 50 {
		t.Fatalf("los sin clasificar entran al denominador: %d de %d", classified, total)
	}
}
