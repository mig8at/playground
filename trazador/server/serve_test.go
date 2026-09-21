package main

import "testing"

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
