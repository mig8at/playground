package main

import (
	"os"
	"regexp"
	"testing"
)

func TestProfilingSummary(t *testing.T) {
	tests := []struct {
		name string
		p    *Profiling
		want string
	}{
		{name: "sin corrida", want: "No llegó al perfilamiento"},
		{
			name: "resultado completo",
			p: &Profiling{
				Profiler: "PerfiladorNuevo", Recommended: 4, Disbursed: 9,
				Shown: []ShownLender{{ID: 4, Name: "Addi"}, {ID: 9, Name: "Sistecrédito"}},
			},
			want: "PerfiladorNuevo · 2 entidades mostradas · recomendada: Addi · desembolsada: Sistecrédito",
		},
		{
			name: "snapshot sin entidades",
			p:    &Profiling{},
			want: "Sin resultado registrado",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := profilingSummary(tt.p); got != tt.want {
				t.Fatalf("resumenPerfilamiento() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestQuotaProfiles(t *testing.T) {
	s := &LoanRequest{
		Lender: "CrediPullman",
		Categories: []Category{
			{LenderID: 9, Lender: "Otra entidad", CatID: 1, CatName: "Standard", Quota: 900000, Window: "misma"},
			{LenderID: 4, Lender: "CrediPullman", CatID: 2, CatName: "Premium", Quota: 1353200, Window: "misma"},
			// La cascada puede dejar el mismo resultado varias veces; la ficha muestra una sola decisión.
			{LenderID: 4, Lender: "CrediPullman", CatID: 2, CatName: "Premium", Quota: 1353200, Window: "misma"},
			// Esta fila es de la misma persona pero de otra corrida: no es el perfil de esta solicitud.
			{LenderID: 7, Lender: "Intento anterior", CatID: 3, CatName: "Oro", Quota: 500000, Window: "otra"},
			{LenderID: 6, Lender: "Sin categoría", CatID: 0, CatName: "", Quota: 0, Window: "misma"},
		},
	}

	got := quotaProfiles(s)
	want := []quotaProfileUI{
		{Category: "Premium", Entity: "CrediPullman", Quota: 1353200},
		{Category: "Standard", Entity: "Otra entidad", Quota: 900000},
	}
	if len(got) != len(want) {
		t.Fatalf("perfilesCupo() = %#v, want %#v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("perfilesCupo()[%d] = %#v, want %#v", i, got[i], want[i])
		}
	}
}

// Los ambientes están escritos en TRES lugares —la lista blanca del server, la del store de la Vue y las
// opciones del selector— y agregar `qa` pedía tocar los tres. Uno olvidado no falla: el selector ofrece
// un ambiente que el server rechaza, o la URL `#/traza/qa/…` se descarta en silencio y abre prod.
func TestEnvironmentsAreTheSameInServerStoreAndSelector(t *testing.T) {
	read := func(path string) string {
		b, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("no se pudo leer %s: %v", path, err)
		}
		return string(b)
	}
	store := regexp.MustCompile(`const targetsValidos = new Set\(\[([^\]]*)\]\)`).FindStringSubmatch(read("../src/stores/trazador.js"))
	if store == nil {
		t.Fatal("no encontré `targetsValidos` en el store: si se renombró, actualizá esta prueba")
	}
	inStore := map[string]bool{}
	for _, m := range regexp.MustCompile(`'([a-z]+)'`).FindAllStringSubmatch(store[1], -1) {
		inStore[m[1]] = true
	}
	inSelector := map[string]bool{}
	for _, m := range regexp.MustCompile(`<option value="([a-z]+)">`).FindAllStringSubmatch(read("../src/components/Buscador.vue"), -1) {
		inSelector[m[1]] = true
	}
	for name, list := range map[string]map[string]bool{"store": inStore, "selector": inSelector} {
		for t2 := range allowedTargets {
			if !list[t2] {
				t.Errorf("%s: falta %q, que el server permite", name, t2)
			}
		}
		for t2 := range list {
			if !allowedTargets[t2] {
				t.Errorf("%s: ofrece %q, que el server rechaza", name, t2)
			}
		}
	}
}
