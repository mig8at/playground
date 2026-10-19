package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"

	"creditop/playground/connectors/jev"
)

// `pg jev ask`: Jev como servicio para cualquier herramienta del playground. Lee el pedido (JSON) por la entrada estándar,
// lo manda por el cliente único (`connectors/jev`: sin redirecciones y sin el token ni el cuerpo en los errores) y escribe la
// respuesta en la salida. Desde otro lenguaje se llama como proceso, igual que el resto de los conectores: así la URL y el
// token viven en un solo lugar. El token sale de JEV_TOKEN o TYPESAFE_API_KEY (proceso, o connectors/.env).
//
// Salida 0 con la respuesta; 1 si Jev falló (el mensaje dice el código HTTP, p. ej. «Jev HTTP 429»); 2 si el pedido no sirve.

const maxJevRequest = 1_000_000

func runJevAsk(args []string) int {
	if len(args) > 0 {
		return fail(2, "pg jev ask no lleva argumentos: el pedido va por la entrada estándar, en JSON")
	}
	raw, err := io.ReadAll(io.LimitReader(os.Stdin, maxJevRequest+1))
	if err != nil {
		return fail(2, "no pude leer el pedido: %v", err)
	}
	if len(raw) > maxJevRequest {
		return fail(2, "el pedido supera %d bytes", maxJevRequest)
	}
	var body map[string]any
	if err := json.Unmarshal(raw, &body); err != nil {
		return fail(2, "el pedido no es un objeto JSON")
	}
	token, err := jev.Token()
	if err != nil {
		return fail(1, "%v", err)
	}
	answer, err := jev.Request(context.Background(), jev.New(token), body, func(answer, _ any) (any, error) { return answer, nil })
	if err != nil {
		return fail(1, "%v", err)
	}
	out, err := json.Marshal(answer)
	if err != nil {
		return fail(1, "la respuesta de Jev no se puede escribir")
	}
	fmt.Println(string(out))
	return 0
}
