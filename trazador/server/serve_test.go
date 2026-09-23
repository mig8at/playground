package main

import (
	"os"
	"regexp"
	"testing"
)

func TestResumenPerfilamiento(t *testing.T) {
	tests := []struct {
		name string
		p    *Perfilamiento
		want string
	}{
		{name: "sin corrida", want: "No llegó al perfilamiento"},
		{
			name: "resultado completo",
			p: &Perfilamiento{
				Perfilador: "PerfiladorNuevo", Recomendado: 4, Desembolsado: 9,
				Mostrados: []LenderMostrado{{ID: 4, Nombre: "Addi"}, {ID: 9, Nombre: "Sistecrédito"}},
			},
			want: "PerfiladorNuevo · 2 entidades mostradas · recomendada: Addi · desembolsada: Sistecrédito",
		},
		{
			name: "snapshot sin entidades",
			p:    &Perfilamiento{},
			want: "Sin resultado registrado",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := resumenPerfilamiento(tt.p); got != tt.want {
				t.Fatalf("resumenPerfilamiento() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestPerfilesCupo(t *testing.T) {
	s := &Solicitud{
		Lender: "CrediPullman",
		Categorias: []Categoria{
			{LenderID: 9, Lender: "Otra entidad", CatID: 1, CatNombre: "Standard", Cupo: 900000, Ventana: "misma"},
			{LenderID: 4, Lender: "CrediPullman", CatID: 2, CatNombre: "Premium", Cupo: 1353200, Ventana: "misma"},
			// La cascada puede dejar el mismo resultado varias veces; la ficha muestra una sola decisión.
			{LenderID: 4, Lender: "CrediPullman", CatID: 2, CatNombre: "Premium", Cupo: 1353200, Ventana: "misma"},
			// Esta fila es de la misma persona pero de otra corrida: no es el perfil de esta solicitud.
			{LenderID: 7, Lender: "Intento anterior", CatID: 3, CatNombre: "Oro", Cupo: 500000, Ventana: "otra"},
			{LenderID: 6, Lender: "Sin categoría", CatID: 0, CatNombre: "", Cupo: 0, Ventana: "misma"},
		},
	}

	got := perfilesCupo(s)
	want := []perfilCupoUI{
		{Categoria: "Premium", Entidad: "CrediPullman", Cupo: 1353200},
		{Categoria: "Standard", Entidad: "Otra entidad", Cupo: 900000},
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
func TestLosAmbientesSonLosMismosEnServerStoreYSelector(t *testing.T) {
	leer := func(ruta string) string {
		b, err := os.ReadFile(ruta)
		if err != nil {
			t.Fatalf("no se pudo leer %s: %v", ruta, err)
		}
		return string(b)
	}
	store := regexp.MustCompile(`const targetsValidos = new Set\(\[([^\]]*)\]\)`).FindStringSubmatch(leer("../src/stores/trazador.js"))
	if store == nil {
		t.Fatal("no encontré `targetsValidos` en el store: si se renombró, actualizá esta prueba")
	}
	enStore := map[string]bool{}
	for _, m := range regexp.MustCompile(`'([a-z]+)'`).FindAllStringSubmatch(store[1], -1) {
		enStore[m[1]] = true
	}
	enSelector := map[string]bool{}
	for _, m := range regexp.MustCompile(`<option value="([a-z]+)">`).FindAllStringSubmatch(leer("../src/components/Buscador.vue"), -1) {
		enSelector[m[1]] = true
	}
	for nombre, lista := range map[string]map[string]bool{"store": enStore, "selector": enSelector} {
		for t2 := range targetsPermitidos {
			if !lista[t2] {
				t.Errorf("%s: falta %q, que el server permite", nombre, t2)
			}
		}
		for t2 := range lista {
			if !targetsPermitidos[t2] {
				t.Errorf("%s: ofrece %q, que el server rechaza", nombre, t2)
			}
		}
	}
}
