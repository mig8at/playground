package main

import (
	"reflect"
	"testing"
)

// --sesion N sale de los argumentos esté donde esté, y fija la pestaña de este comando.
func TestTakeTabFlag(t *testing.T) {
	tabID = ""
	got := takeTabFlag([]string{"navegador", "fill", "--sesion", "2", "3", "hola"})
	if want := []string{"navegador", "fill", "3", "hola"}; !reflect.DeepEqual(got, want) || tabID != "2" {
		t.Fatalf("quedó %v con pestaña %q", got, tabID)
	}
	tabID = ""
}
