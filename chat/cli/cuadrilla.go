package cli

// CUADRILLA, por el mismo CLI: las épicas y tareas del equipo (`playground cuadrilla …`). Se lee el tablero entero y
// se escribe con los atajos de la terminal (`note`, `block`, `unblock`, `edit`), con la sesión de quien usa el chat:
// el tablero del navegador es de sólo lectura y escribe la terminal, así que el chat escribe como terminal.

import (
	"context"
	"encoding/json"
	"errors"
	"net/url"
	"strings"
)

// CuadrillaNote es una nota de la bitácora de una tarea: un avance, un bloqueo (con de quién depende) o un desbloqueo.
type CuadrillaNote struct {
	At    string `json:"fecha"`
	By    string `json:"autor"`
	Kind  string `json:"tipo"`
	Text  string `json:"texto"`
	Owner string `json:"depende_de,omitempty"`
}

// CuadrillaTask es una tarea de una épica, con su código corto (el de la URL) y su bitácora.
type CuadrillaTask struct {
	ID        string          `json:"id"`
	Code      string          `json:"codigo"`
	Title     string          `json:"titulo"`
	Owner     string          `json:"responsable,omitempty"`
	Done      bool            `json:"hecha,omitempty"`
	CreatedBy string          `json:"creada_por"`
	Notes     []CuadrillaNote `json:"notas"`
}

// CuadrillaEpic es una épica con sus tareas.
type CuadrillaEpic struct {
	ID    string          `json:"id"`
	Code  string          `json:"codigo"`
	Name  string          `json:"nombre"`
	Tasks []CuadrillaTask `json:"tareas"`
}

// CuadrillaBoard devuelve las épicas del tablero, con sus tareas y notas.
func CuadrillaBoard(ctx context.Context) ([]CuadrillaEpic, error) {
	out, err := run(ctx, nil, "cuadrilla", "/api/epics", "--json")
	if err != nil {
		return nil, err
	}
	var epics []CuadrillaEpic
	if err := json.Unmarshal(out, &epics); err != nil {
		return nil, errors.New("cuadrilla devolvió algo que no es el tablero")
	}
	return epics, nil
}

// Me es la cuenta de GitHub de quien usa el chat: es su nombre en cuadrilla.
func Me(ctx context.Context) (string, error) {
	out, err := run(ctx, nil, "whoami", "--json")
	if err != nil {
		return "", err
	}
	var who struct {
		GitHub string `json:"github"`
	}
	if err := json.Unmarshal(out, &who); err != nil {
		return "", errors.New("whoami devolvió algo que no se entiende")
	}
	return who.GitHub, nil
}

// CuadrillaWrite corre un atajo de escritura de cuadrilla (`note`, `block`, `unblock`, `edit`) con sus parámetros
// como `clave=valor`. Van con su nombre y no por posición: un texto que empezara con `owner=` se tomaría por otro
// parámetro si fuera suelto.
func CuadrillaWrite(ctx context.Context, shortcut string, params map[string]string) error {
	args := []string{"cuadrilla", shortcut}
	for k, v := range params {
		args = append(args, k+"="+v)
	}
	_, err := run(ctx, nil, append(args, "view=json")...)
	return err
}

// CuadrillaURL es la dirección de cuadrilla del mismo playground: el subdominio `cuadrilla.` de la base.
func CuadrillaURL() string {
	u, err := url.Parse(base())
	if err != nil || u.Host == "" {
		return ""
	}
	return u.Scheme + "://cuadrilla." + strings.TrimPrefix(u.Host, "www.")
}
