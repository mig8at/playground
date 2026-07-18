package engine

import (
	"strings"
	"testing"
)

// Estos tests cubren las piezas PURAS del ruteo (las que no dependen del índice
// ni de los repos escaneados): extracción de términos, lematización y TL;DR. Son
// las que deciden si una tarea encuentra su nodo, así que conviene fijarlas.

func TestTermsDropsNoise(t *testing.T) {
	got := terms("necesito que el listado no muestre CrediPullman en el comercio X")
	joined := " " + strings.Join(got, " ") + " "
	for _, want := range []string{"listado", "credipullman", "comercio"} {
		if !strings.Contains(joined, " "+want+" ") {
			t.Errorf("falta el término %q en %v", want, got)
		}
	}
	// stopwords y palabras cortas no deben sobrevivir: no discriminan un nodo de otro
	for _, unwanted := range []string{"necesito", "que", "el", "no", "en"} {
		if strings.Contains(joined, " "+unwanted+" ") {
			t.Errorf("el término de ruido %q sobrevivió en %v", unwanted, got)
		}
	}
}

func TestTermsFoldsAccents(t *testing.T) {
	got := terms("por qué falla la validación de identidad")
	joined := strings.Join(got, " ")
	if !strings.Contains(joined, "validacion") || !strings.Contains(joined, "identidad") {
		t.Errorf("no plegó acentos: %v", got)
	}
}

func TestStem(t *testing.T) {
	cases := map[string]string{
		"desembolsar": "desembols", // debe pegar con "desembolso" en los docs
		"listado":     "listado",   // recortar "ado" dejaría "list" (<5): la guarda lo impide
		"solicitudes": "solicitud",
		"cupo":        "cupo", // corta: no se toca
		"score":       "score",
	}
	for in, want := range cases {
		if got := stem(in); got != want {
			t.Errorf("stem(%q) = %q, quería %q", in, got, want)
		}
	}
}

// La raíz nunca debe quedar tan corta que matchee cualquier cosa.
func TestStemNuncaDejaRaizCorta(t *testing.T) {
	for _, w := range []string{"pagares", "estados", "montos", "cuotas", "usuarios"} {
		if s := stem(w); len(s) < 5 {
			t.Errorf("stem(%q) = %q: raíz demasiado corta (ensucia el ruteo)", w, s)
		}
	}
}

func TestTLDRDeContexto(t *testing.T) {
	doc := "# KYC · contexto\n> **estado:** al día con main · El estudio del cliente por burós: Experian da el ÚNICO score.\n\n## Qué es\nblah"
	got := tldrFrom(doc)
	if strings.Contains(got, "estado:") || strings.Contains(got, "al día con main") {
		t.Errorf("no sacó el prefijo de estado: %q", got)
	}
	if !strings.HasPrefix(got, "El estudio del cliente") {
		t.Errorf("TL;DR inesperado: %q", got)
	}
	if strings.Contains(got, "**") {
		t.Errorf("quedó markdown crudo: %q", got)
	}
}

// En una TASK la status line es la de rama/PR y el TL;DR viene en la línea
// siguiente del blockquote — no en la primera.
func TestTLDRDeTask(t *testing.T) {
	doc := "# Motai v2 · task\n> **rama:** `feature/motai-v2` · **estado:** en pruebas\n>\n> Des-motaizar la originación de Motai.\n\n## Objetivo"
	got := tldrFrom(doc)
	if !strings.HasPrefix(got, "Des-motaizar") {
		t.Errorf("en una task debe tomar el TL;DR, no la línea de rama; obtuvo %q", got)
	}
}

func TestRoleFromKind(t *testing.T) {
	for kind, want := range map[string]string{"root": "raiz", "task": "task", "reference": "contexto", "": "contexto"} {
		if got := roleFromKind(kind); got != want {
			t.Errorf("roleFromKind(%q) = %q, quería %q", kind, got, want)
		}
	}
}
