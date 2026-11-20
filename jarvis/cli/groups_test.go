package main

import (
	"reflect"
	"testing"
)

// El nombre automático sale de las primeras palabras con sentido de la meta y entra en la tira de pestañas.
func TestAutoGroupName(t *testing.T) {
	for goal, want := range map[string]string{
		"Validar que Creditop esté activo y el pedido X3RMQ3R82 pagado": "Validar Creditop esté",
		"Compra de prueba rechazada con Creditop (ticket 72090155)":     "Compra prueba rechazada",
		"crear producto en VTEX": "Crear producto VTEX",
		"!!!":                    "Tarea",
		"Supercalifragilisticoespialidosamenteeee": "Supercalifragilisticoesp",
	} {
		if got := autoGroupName(goal); got != want {
			t.Errorf("%q → %q, quería %q", goal, got, want)
		}
		if n := len([]rune(autoGroupName(goal))); n > autoGroupMax {
			t.Errorf("%q dio %d letras (tope %d)", goal, n, autoGroupMax)
		}
	}
}

// Un nombre automático que ya usa otro Claude trabajando se numera; uno libre (sin Claude) se reusa.
func TestUniqueAutoGroup(t *testing.T) {
	tabs := []tabInfo{{ID: "1", Group: "Crear producto VTEX", Busy: true}, {ID: "2", Group: "Crear producto VTEX 2", Busy: true}, {ID: "3", Group: "Shopify"}}
	if got := uniqueAutoGroup("crear producto vtex", tabs); got != "crear producto vtex 3" {
		t.Errorf("quedó %q", got)
	}
	if got := uniqueAutoGroup("Shopify", tabs); got != "Shopify" {
		t.Errorf("un grupo sin Claude trabajando se reusa, quedó %q", got)
	}
}

// --group y --color salen de los argumentos esté donde estén, como --session.
func TestTakeGroupFlags(t *testing.T) {
	groupName, groupColor, tabID = "", "", ""
	got := takeTabFlag([]string{"jarvis", "start", "--group", " VTEX ", "--color", "green", "crear producto"})
	if want := []string{"jarvis", "start", "crear producto"}; !reflect.DeepEqual(got, want) || groupName != "VTEX" || groupColor != "green" {
		t.Fatalf("quedó %v con grupo %q y color %q", got, groupName, groupColor)
	}
	groupName, groupColor = "", ""
}
