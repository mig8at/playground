package admin

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"strings"
)

// La BAJA de un CLIENTE de prueba, para volver a probar el registro con la misma cédula: lo mismo que la papelera de
// «Usuarios» en el admin (`UserController::disableUser`, ruta GET `/usuarios/{id}/eliminar`). No borra nada: pone `status = 0`,
// le agrega a la cédula `-t<n>` (el siguiente libre) y vacía correo, celular y `cognito_id`. Las solicitudes y las consultas a
// las centrales quedan en la cuenta vieja; con la cédula libre, el próximo registro crea un cliente nuevo y las centrales se
// consultan otra vez.
//
// ⚠ LA LISTA DE «USUARIOS» NO FILTRA POR ROL, y su búsqueda es una expresión regular sobre la cédula: buscar `1031138508`
// trae también al Administrador `2-1031138508` y al comercial `4-10311385089`, y la papelera sale en todas las filas. Por eso
// acá sólo se actúa sobre la fila cuya cédula es EXACTAMENTE la pedida, activa y con perfil de cliente (`user_profile_id = 1`;
// las cuentas internas llevan su perfil como prefijo de la cédula y del celular).

// ClientRow es una fila de la lista de «Usuarios» del admin.
type ClientRow struct {
	ID        int    `json:"id"`
	Document  string `json:"document"`
	Name      string `json:"name"`
	Status    int    `json:"status"`
	ProfileID int    `json:"profileId"`
	HasPhone  bool   `json:"hasPhone"`
}

// ClientPlan es lo que haría la baja, para mostrar antes de hacerla.
type ClientPlan struct {
	Document string      `json:"document"`
	ActingAs string      `json:"actingAs"`
	Target   *ClientRow  `json:"target"`
	Disabled []ClientRow `json:"disabled"`
}

var digitsOnly = regexp.MustCompile(`^\d{5,15}$`)

// SearchClients lee (sólo lee) las filas de «Usuarios» cuya cédula es `document` o una baja suya (`document-t<n>`).
func (c *Client) SearchClients(ctx context.Context, document string) ([]ClientRow, error) {
	r, err := c.Get(ctx, "/usuarios?per-page=100&search="+url.QueryEscape(regexp.QuoteMeta(document)))
	if err != nil {
		return nil, err
	}
	if r.Page == nil {
		return nil, fmt.Errorf("el admin no devolvió la lista de usuarios (HTTP %d)", r.Status)
	}
	users, _ := r.Page.Props["users"].(map[string]any)
	data, _ := users["data"].([]any)
	var out []ClientRow
	for _, raw := range data {
		u, _ := raw.(map[string]any)
		doc := str(u["document_number"])
		if doc != document && !strings.HasPrefix(doc, document+"-t") {
			continue
		}
		out = append(out, ClientRow{ID: num(u["id"]), Document: doc, Status: num(u["status"]), ProfileID: num(u["user_profile_id"]),
			Name: strings.TrimSpace(str(u["first_name"]) + " " + str(u["surname"])), HasPhone: str(u["cell_phone"]) != ""})
	}
	return out, nil
}

// PlanClientDisable busca el cliente ACTIVO con esa cédula exacta y dice con quién actuaría. Error si no hay uno solo, o si
// la cuenta no es de cliente.
func (c *Client) PlanClientDisable(ctx context.Context, document string) (*ClientPlan, error) {
	document = strings.TrimSpace(document)
	if !digitsOnly.MatchString(document) {
		return nil, fmt.Errorf("la cédula tiene que ser sólo dígitos, sin prefijo ni sufijo (llegó %q)", document)
	}
	if who, err := c.Probe(ctx); err != nil || who == "" {
		return nil, fmt.Errorf("la sesión guardada del admin no sirve (%v): entrá con `pg admin login --target <ambiente>`", errOr(err, "el admin manda al login"))
	}
	rows, err := c.SearchClients(ctx, document)
	if err != nil {
		return nil, err
	}
	plan := &ClientPlan{Document: document, ActingAs: c.ActingAs()}
	var active []ClientRow
	for _, r := range rows {
		if r.Document == document && r.Status == 1 {
			active = append(active, r)
		} else {
			plan.Disabled = append(plan.Disabled, r)
		}
	}
	switch {
	case len(active) == 0:
		return plan, nil
	case len(active) > 1:
		return nil, fmt.Errorf("hay %d cuentas activas con la cédula %s: no sé cuál dar de baja", len(active), document)
	case active[0].ProfileID != 1:
		return nil, fmt.Errorf("la cuenta %d con la cédula %s tiene perfil %d, no de cliente (1): no se da de baja desde acá", active[0].ID, document, active[0].ProfileID)
	}
	plan.Target = &active[0]
	return plan, nil
}

// DisableClient aprieta la papelera de esa fila y comprueba, releyendo la lista, que la cuenta quedó dada de baja. ESCRIBE: lo
// llama quien ya mostró el plan y recibió `--apply`.
func (c *Client) DisableClient(ctx context.Context, plan *ClientPlan) (*ClientRow, error) {
	if plan == nil || plan.Target == nil {
		return nil, errors.New("no hay un cliente activo que dar de baja")
	}
	r, err := c.Get(ctx, fmt.Sprintf("/usuarios/%d/eliminar", plan.Target.ID))
	if err != nil {
		return nil, err
	}
	if r.Status == 403 {
		return nil, errors.New("el admin no lo permite (HTTP 403): hace falta una sesión con perfil Administrador")
	}
	if r.Status >= 400 {
		return nil, fmt.Errorf("el admin contestó HTTP %d al dar de baja", r.Status)
	}
	rows, err := c.SearchClients(ctx, plan.Document)
	if err != nil {
		return nil, fmt.Errorf("se pidió la baja pero no pude releer la lista: %w", err)
	}
	for _, row := range rows {
		if row.Document == plan.Document && row.Status == 1 {
			return nil, fmt.Errorf("el admin respondió pero la cuenta %d sigue activa con la cédula %s", row.ID, plan.Document)
		}
	}
	for _, row := range rows {
		if row.ID == plan.Target.ID {
			return &row, nil
		}
	}
	return nil, fmt.Errorf("la cédula %s quedó libre, pero no encontré la cuenta %d en la lista para confirmar su sufijo", plan.Document, plan.Target.ID)
}
