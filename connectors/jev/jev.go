// Package jev es la conexión con la API de Jev (TypeSafe), sin ningún uso encima — a propósito.
//
// El 2026-09-23 se retiró todo lo que la usaba en el tablero (el botón «Orientar», la revisión de
// pendientes y el laboratorio con su banco de casos): metían ruido sin haber encontrado un uso que lo
// justificara. Esto queda para cuando aterrice uno mejor: el endpoint y el modelo, de dónde sale el token
// y un pedido acotado que no sigue redirecciones ni filtra el cuerpo, el token o la respuesta en un error.
//
// Hasta el 2026-09-24 vivía en Python (`tablero/tools/jev_transport.py`); se portó con sus pruebas.
package jev

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"

	"creditop/playground/connectors/env"
)

const (
	Endpoint = "https://api.typesafe.ai/v1/systemone"
	Model    = "jev-1.13.0"
	// maxAnswer es el tope de la respuesta: más que esto es un error, no algo que se lee a medias.
	maxAnswer = 1_000_000
)

// Error es un fallo de Jev. ⚠ Su texto NUNCA lleva el cuerpo pedido, el token ni la respuesta: un error
// termina en un log o en una pantalla, y eso sería filtrarlos.
type Error struct{ msg string }

func (e *Error) Error() string { return e.msg }

func jevError(format string, args ...any) error { return &Error{fmt.Sprintf(format, args...)} }

// Token lee `JEV_TOKEN` o `TYPESAFE_API_KEY`, del proceso o de `connectors/.env` (el proceso gana). Un
// `.env` nunca se ejecuta como shell: se lee como texto.
func Token() (string, error) {
	v, err := env.LoadShared()
	if err != nil {
		return "", err
	}
	if t := v.Get("JEV_TOKEN", "TYPESAFE_API_KEY"); t != "" {
		return t, nil
	}
	return "", jevError("falta JEV_TOKEN o TYPESAFE_API_KEY en el entorno o en connectors/.env")
}

// Client hace pedidos a Jev.
type Client struct {
	Endpoint string
	token    string
	http     *http.Client
}

// New arma el cliente: un intento de 15 s como máximo, y sin seguir redirecciones — una redirección es
// una respuesta, no un lugar al que mandarle el token.
func New(token string) *Client {
	return &Client{Endpoint: Endpoint, token: token, http: &http.Client{
		Timeout:       15 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}}
}

// Request manda `body` y devuelve lo que `validate` acepte de la respuesta. Un solo intento.
func Request[T any](ctx context.Context, c *Client, body any, validate func(answer, body any) (T, error)) (T, error) {
	var zero T
	raw, err := json.Marshal(body)
	if err != nil {
		return zero, jevError("el pedido no se puede serializar")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.Endpoint, bytes.NewReader(raw))
	if err != nil {
		return zero, jevError("pedido inválido")
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return zero, jevError("Jev no disponible o timeout")
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return zero, jevError("Jev HTTP %d", resp.StatusCode)
	}
	answer, err := io.ReadAll(io.LimitReader(resp.Body, maxAnswer+1))
	if err != nil {
		return zero, jevError("Jev no disponible o timeout")
	}
	if len(answer) > maxAnswer {
		return zero, jevError("respuesta demasiado grande")
	}
	var decoded any
	if err := json.Unmarshal(answer, &decoded); err != nil {
		return zero, jevError("respuesta JSON inválida")
	}
	var original any
	_ = json.Unmarshal(raw, &original)
	return validate(decoded, original)
}

// IsError dice si err es un fallo de Jev (y no, por ejemplo, del validador).
func IsError(err error) bool {
	var e *Error
	return errors.As(err, &e)
}
