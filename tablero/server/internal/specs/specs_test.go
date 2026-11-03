package specs

import "testing"

// La sección se lee con su forma (comando, salida esperada, carpeta) y termina en el próximo `## `.
func TestParse(t *testing.T) {
	body := "## Objetivo\n\nalgo\n\n## Specs\n\n" +
		"- **S1** · prod es de sólo lectura — «que no escriba en prod» (Miguel, 2026-11-02)\n" +
		"  `npx playwright test pkg/target-policy.spec.ts`\n" +
		"  dir: harness\n" +
		"- **S2** · el runner se niega\n" +
		"  `E2E_TARGET=qa E2E_TARGET_READONLY=1 make harness-case TARGET=qa`\n" +
		"  sale: 2\n" +
		"  dice: SÓLO LECTURA\n" +
		"- **S3** · sin comando\n\n## Cómo se ataca\n\n- **S9** · no es una spec\n"
	got := Parse(body)
	if len(got) != 3 {
		t.Fatalf("quería 3 specs, vinieron %d: %+v", len(got), got)
	}
	if got[0].Dir != "harness" || got[0].Expect != 0 || got[0].Command == "" {
		t.Fatalf("S1 mal leída: %+v", got[0])
	}
	if got[1].Expect != 2 || got[1].Says != "SÓLO LECTURA" || got[2].Command != "" {
		t.Fatalf("S2/S3 mal leídas: %+v %+v", got[1], got[2])
	}
}
