package main

import "testing"

// Lo que se probó acá es lo que ya dio un diagnóstico equivocado: los reportes que ninguna regex
// reconoce se contaban y se tiraban, así que el veredicto hablaba de las regex creyendo hablar del
// canal. La prueba fija las dos mitades — que vuelvan con su texto, y que entren al denominador.
func TestReportesSinCategoriaVuelvenConSuTexto(t *testing.T) {
	msgs := []mensajeSlack{
		{TS: "1758200000.0", Text: "no puede firmar el pagaré, Deceval lo rechaza"},    // categoría conocida
		{TS: "1758200001.0", Text: "gracias"},                                          // ruido: menos de 4 palabras
		{TS: "1758200002.0", Text: "el reporte de comisiones sale duplicado este mes"}, // nadie lo cubre
		{TS: "1758200003.0", Bot: "B123", Text: "alerta automática de un bot cualquiera"},
	}
	hits, sinCat, porCat := clasificarReportes(msgs)
	if len(hits) != 1 || len(sinCat) != 1 {
		t.Fatalf("un reporte clasificado y uno sin categoría (el bot y el «gracias» no son reportes): %d hits, %d sin", len(hits), len(sinCat))
	}
	if sinCat[0].text != msgs[2].Text {
		t.Fatalf("el sin clasificar tiene que volver con su TEXTO para poder mirarlo, no sólo contarse: %q", sinCat[0].text)
	}
	if sinCat[0].cat != "" || sinCat[0].ts.IsZero() {
		t.Fatalf("sin categoría y con su fecha, que es lo que lo hace legible en la lista: %+v", sinCat[0])
	}
	if porCat[hits[0].cat] != 1 {
		t.Fatalf("el clasificado suma en SU categoría: %v", porCat)
	}

	// El veredicto: con el denominador viejo (sólo clasificados) este canal daba 100 % de cobertura
	// teniendo la mitad sin reconocer. Con el de hoy da 50 %, que es lo que pasa de verdad.
	clasificados := len(hits)
	total := clasificados + len(sinCat)
	if 100*clasificados/total != 50 {
		t.Fatalf("los sin clasificar entran al denominador: %d de %d", clasificados, total)
	}
}
