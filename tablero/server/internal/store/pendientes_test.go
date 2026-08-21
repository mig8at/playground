package store

import "testing"

func TestPendientes(t *testing.T) {
	cuerpo := "" +
		"Prosa cualquiera, con un guion normal que NO es un pendiente.\n" +
		"- esto es una viñeta, no una casilla\n" +
		"\n" +
		"## Pendientes\n" +
		"- [ ] backfill de `allied_documents` no idempotente\n" +
		"- [x] renombrar las rutas a nombres genéricos\n" +
		"  - [ ] anidado: cuenta igual\n" +
		"* [X] con asterisco y equis mayúscula\n" +
		"\n" +
		"### Cerrar con negocio\n" +
		"+ [ ] score mínimo del titular\n" +
		"- [ ]   \n" +
		"\n" +
		"[ ] sin marcador de lista: no cuenta\n"

	got := Pendientes(cuerpo)
	if len(got) != 5 {
		t.Fatalf("esperaba 5 pendientes, hubo %d: %+v", len(got), got)
	}

	// El texto llega limpio y la sección es el encabezado más cercano por encima: es lo que agrupa el
	// cajón, y sin eso una lista larga de pendientes de tareas distintas se lee toda igual.
	if got[0].Que != "backfill de `allied_documents` no idempotente" || got[0].Hecho {
		t.Errorf("primer pendiente mal parseado: %+v", got[0])
	}
	if got[0].Seccion != "Pendientes" {
		t.Errorf("sección esperada «Pendientes», hubo %q", got[0].Seccion)
	}
	if !got[1].Hecho {
		t.Errorf("`- [x]` tiene que quedar como hecho: %+v", got[1])
	}
	if got[2].Que != "anidado: cuenta igual" {
		t.Errorf("el anidado tiene que contar y llegar sin indentación: %+v", got[2])
	}
	if !got[3].Hecho {
		t.Errorf("`* [X]` (asterisco, mayúscula) tiene que quedar como hecho: %+v", got[3])
	}
	// El encabezado cambia el contexto aunque sea de otro nivel.
	if got[4].Seccion != "Cerrar con negocio" {
		t.Errorf("la sección tiene que seguir al último encabezado, hubo %q", got[4].Seccion)
	}

	// Lo que cuenta la tarjeta son los ABIERTOS: 5 ítems, 2 tildados.
	if n := Abiertos(got); n != 3 {
		t.Errorf("esperaba 3 abiertos, hubo %d", n)
	}
}

// La trampa que motivó el corte: las casillas de la sección publicable son los CRITERIOS DE ACEPTACIÓN
// de QA, no pendientes. El corte lo hace `partirCuerpo` antes de llamar acá — este test lo fija, porque
// si alguna vez se le pasa el cuerpo entero el contador miente hacia arriba y nadie lo nota.
func TestPendientesSoloDelCuerpoPrivado(t *testing.T) {
	archivo := "" +
		"## Pendientes\n" +
		"- [ ] un pendiente de verdad\n" +
		"\n" +
		SECCION + "\n" +
		"\n" +
		"## Criterios de aceptación\n" +
		"- [ ] la tarjeta muestra el pago semanal\n" +
		"- [ ] las entidades de crédito no cambiaron\n"

	notas, publicable := partirCuerpo(archivo)
	if publicable == "" {
		t.Fatal("el fixture tiene que tener mitad publicable, si no el test no prueba nada")
	}
	if n := len(Pendientes(notas)); n != 1 {
		t.Errorf("del cuerpo privado esperaba 1 pendiente, hubo %d", n)
	}
	if n := len(Pendientes(archivo)); n != 3 {
		t.Errorf("el fixture entero tiene 3 casillas; si no, el test no está midiendo la diferencia (hubo %d)", n)
	}
}
