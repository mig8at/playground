package review

// LOS VALORES EN INGLÉS Y LO QUE SE LEE EN ESPAÑOL (2026-11-18, regla de my-tools: el código en inglés, lo que se ve
// en español). Los veredictos, los resultados de comprobar corriendo y la gravedad son valores del código —el
// esquema que contestan los agentes, lo guardado, la interfaz—; el informe y la consola los muestran con estas
// etiquetas. Las validaciones guardadas antes tienen los valores en español: se traducen al cargarlas.

var verdictLabels = map[string]string{"confirmed": "confirmado", "plausible": "plausible", "dismissed": "descartado", "out-of-scope": "fuera de alcance"}

var proofLabels = map[string]string{"proven": "comprobado", "refuted": "refutado", "untested": "sin probar"}

var severityLabels = map[string]string{"high": "alta", "medium": "media", "low": "baja"}

// label: la etiqueta en español de un valor (o el valor, si no tiene).
func label(labels map[string]string, value string) string {
	if l, ok := labels[value]; ok {
		return l
	}
	return value
}

// legacyValues: los valores de antes → los de ahora.
var legacyValues = map[string]string{
	"confirmado": "confirmed", "descartado": "dismissed", "fuera de alcance": "out-of-scope",
	"comprobado": "proven", "refutado": "refuted", "sin probar": "untested",
	"alta": "high", "media": "medium", "baja": "low",
}

// migrateRun pasa una validación guardada a los valores de ahora.
func migrateRun(r *Run) {
	for i := range r.Findings {
		f := &r.Findings[i]
		if v, ok := legacyValues[f.Verdict]; ok {
			f.Verdict = v
		}
		if v, ok := legacyValues[f.Severity]; ok {
			f.Severity = v
		}
		if f.Proof != nil {
			if v, ok := legacyValues[f.Proof.Status]; ok {
				f.Proof.Status = v
			}
		}
	}
}
