package main

import "testing"

// Qué consultas se buscan por la palabra exacta: identificadores, rutas, números de trampa; no las preguntas.
func TestLooksLikeCode(t *testing.T) {
	for q, want := range map[string]bool{
		"lock_amount": true, "getInitialRegisterByUserRequest": true, "F-53": true, "app/Services/Foo.php": true,
		"`user_request_status_id`": true, "User.status": true,
		"¿por qué no se puede cancelar después de pagar la cuota inicial?": false, "monto listado": false,
		"Ecommerce: cancelación de pedidos": false, "pagaré Deceval": false,
	} {
		if got := looksLikeCode(q); got != want {
			t.Errorf("%q → %v, quería %v", q, got, want)
		}
	}
}
