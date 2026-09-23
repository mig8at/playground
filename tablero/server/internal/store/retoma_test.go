package store

import "testing"

func TestResumeAndNextStepUseCurrentSection(t *testing.T) {
	body := `# Tarea vieja

Nota histórica que no es el estado.

## 0 · SI RETOMÁS ESTO SIN CONTEXTO, EMPEZÁ ACÁ

El estado vigente está acá.

**El próximo paso es:** validar el caso con QA
antes de promoverlo.

## Registro

### 2026-09-18

Historia que no debe aparecer en la retoma.`

	if got, want := Resume(body), "El estado vigente está acá.\n\n**El próximo paso es:** validar el caso con QA\nantes de promoverlo."; got != want {
		t.Fatalf("Retoma() = %q, want %q", got, want)
	}
	if got, want := NextStep(body), "validar el caso con QA antes de promoverlo."; got != want {
		t.Fatalf("ProximoPaso() = %q, want %q", got, want)
	}
}
