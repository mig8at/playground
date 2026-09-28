package canon

/* El paquete de contexto de canon: secciones ENTERAS, elegidas por búsqueda léxica, dentro de un
 * presupuesto de bytes. No pasa por ningún modelo —canon lo aclara en `nota`: «no es una respuesta ni
 * verifica afirmaciones»—, así que es lo que una tarea puede pedir para trabajar sin preguntarle nada a
 * nadie. Lo usa `make retomar CANON=1`. */

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
)

// ContextRequest: qué pedir. Con `Topics` la selección queda dentro de esos temas; `Q` la ordena.
type ContextRequest struct {
	Q        string   `json:"q,omitempty"`
	IDs      []string `json:"ids,omitempty"`
	Topics   []string `json:"temas,omitempty"`
	MaxBytes int      `json:"max_bytes,omitempty"`
}

// ContextBacking es un área del código que respalda una sección.
type ContextBacking struct {
	Goal      string `json:"objetivo"`
	Reference string `json:"referencia"`
}

/* ContextSection es un ítem del paquete, y tiene DOS formas (medido el 2026-09-27): una sección de prosa
 * —`titulo`, `texto`, `respaldo`— o un ÁREA del mapa de código —`area`, `archivos`, `respalda`, `nota`—,
 * que canon devuelve cuando la consulta pega en el código y no en la prosa. Decodificar sólo la primera
 * mostraba un área como una sección sin título ni texto. `Area != nil` distingue una de la otra. */
type ContextSection struct {
	ID       string           `json:"id"`
	Title    string           `json:"titulo"`
	Text     string           `json:"texto"`
	Verified string           `json:"verificado"`
	Backing  []ContextBacking `json:"respaldo"`

	Area     *ContextArea        `json:"area,omitempty"`
	Files    map[string][]string `json:"archivos,omitempty"` // repo → archivos
	Supports []ContextSupport    `json:"respalda,omitempty"` // la prosa que esta área sostiene
}

// ContextArea es la cabecera de un área del mapa de código.
type ContextArea struct {
	N     int    `json:"n"`
	Goal  string `json:"objetivo"`
	Topic string `json:"tema"`
}

// ContextSupport es una sección de prosa que un área respalda, con su id para leerla.
type ContextSupport struct {
	Read    string `json:"leer"`
	Section string `json:"seccion"`
}

// ContextPackage es lo que devuelve canon: lo que entró, lo que quedó afuera por el presupuesto, y lo que
// se pidió por id y no existe.
type ContextPackage struct {
	Sections []ContextSection `json:"secciones"`
	Pending  []string         `json:"pendientes"`
	Omitted  int              `json:"omitidas"`
	Missing  []string         `json:"faltantes"`
	Note     string           `json:"nota"`
	MaxBytes int              `json:"max_bytes"`
}

// Context pide el paquete de contexto.
func (c *Client) Context(ctx context.Context, in ContextRequest) (ContextPackage, error) {
	body, err := json.Marshal(in)
	if err != nil {
		return ContextPackage{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/api/context", bytes.NewReader(body))
	if err != nil {
		return ContextPackage{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := c.http.Do(req)
	if err != nil {
		return ContextPackage{}, fmt.Errorf("no pude consultar Canon (%s): %w", c.baseURL, err)
	}
	defer res.Body.Close()
	var out ContextPackage
	if res.StatusCode != http.StatusOK {
		var e struct {
			Error string `json:"error"`
		}
		_ = json.NewDecoder(res.Body).Decode(&e)
		return ContextPackage{}, fmt.Errorf("Canon respondió HTTP %d: %s", res.StatusCode, e.Error)
	}
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		return ContextPackage{}, fmt.Errorf("Canon devolvió un contexto inválido: %w", err)
	}
	return out, nil
}
