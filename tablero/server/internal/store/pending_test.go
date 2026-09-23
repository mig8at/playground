package store

import "testing"

func TestPendingItems(t *testing.T) {
	body := "" +
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

	got := Pending(body)
	if len(got) != 5 {
		t.Fatalf("esperaba 5 pendientes, hubo %d: %+v", len(got), got)
	}

	// El texto llega limpio y la sección es el encabezado más cercano por encima: es lo que agrupa el
	// cajón, y sin eso una lista larga de pendientes de tareas distintas se lee toda igual.
	if got[0].What != "backfill de `allied_documents` no idempotente" || got[0].Done {
		t.Errorf("primer pendiente mal parseado: %+v", got[0])
	}
	if got[0].Section != "Pendientes" {
		t.Errorf("sección esperada «Pendientes», hubo %q", got[0].Section)
	}
	if !got[1].Done {
		t.Errorf("`- [x]` tiene que quedar como hecho: %+v", got[1])
	}
	if got[2].What != "anidado: cuenta igual" {
		t.Errorf("el anidado tiene que contar y llegar sin indentación: %+v", got[2])
	}
	if !got[3].Done {
		t.Errorf("`* [X]` (asterisco, mayúscula) tiene que quedar como hecho: %+v", got[3])
	}
	// El encabezado cambia el contexto aunque sea de otro nivel.
	if got[4].Section != "Cerrar con negocio" {
		t.Errorf("la sección tiene que seguir al último encabezado, hubo %q", got[4].Section)
	}

	// Lo que cuenta la tarjeta son los ABIERTOS: 5 ítems, 2 tildados.
	open := 0
	for _, p := range got {
		if !p.Done {
			open++
		}
	}
	if open != 3 {
		t.Errorf("esperaba 3 abiertos, hubo %d", open)
	}
}

// La trampa que motivó el corte: las casillas de la sección publicable son los CRITERIOS DE ACEPTACIÓN
// de QA, no pendientes. El corte lo hace `splitBody` antes de llamar acá — este test lo fija, porque
// si alguna vez se le pasa el cuerpo entero el contador miente hacia arriba y nadie lo nota.
func TestPendingItemsOnlyFromPrivateBody(t *testing.T) {
	file := "" +
		"## Pendientes\n" +
		"- [ ] un pendiente de verdad\n" +
		"\n" +
		SECTION + "\n" +
		"\n" +
		"## Criterios de aceptación\n" +
		"- [ ] la tarjeta muestra el pago semanal\n" +
		"- [ ] las entidades de crédito no cambiaron\n"

	notes, publishable := splitBody(file)
	if publishable == "" {
		t.Fatal("el fixture tiene que tener mitad publicable, si no el test no prueba nada")
	}
	if n := len(Pending(notes)); n != 1 {
		t.Errorf("del cuerpo privado esperaba 1 pendiente, hubo %d", n)
	}
	if n := len(Pending(file)); n != 3 {
		t.Errorf("el fixture entero tiene 3 casillas; si no, el test no está midiendo la diferencia (hubo %d)", n)
	}
}

// Una pregunta abierta a alguien es un pendiente que espera: la línea «Depende de:» de abajo dice a quién.
func TestPendingReadsWhoItIsWaitingOn(t *testing.T) {
	body := "## Pendientes\n\n" +
		"- [ ] Validar los tres canales en qa; termina cuando QA da el visto bueno.\n" +
		"  El guion está en «Cómo validar».\n" +
		"  Depende de: QA — el visto bueno de los tres canales.\n" +
		"- [ ] Decidir el cobro de la cuota inicial.\n" +
		"Prosa que corta.\n" +
		"  Depende de: nadie, porque ya no es continuación\n" +
		"- [x] Preparar el caso.\n"
	got := Pending(body)
	if len(got) != 3 {
		t.Fatalf("esperaba 3 pendientes, hubo %d: %+v", len(got), got)
	}
	if got[0].WaitingOn != "QA — el visto bueno de los tres canales." {
		t.Errorf("la dependencia de la primera no se leyó: %q", got[0].WaitingOn)
	}
	if got[1].WaitingOn != "" || got[2].WaitingOn != "" {
		t.Errorf("una línea sin sangría corta la continuación: %+v", got[1:])
	}
}
