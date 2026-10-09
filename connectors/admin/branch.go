package admin

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
)

// LO QUE HACE EL ADMIN AL GUARDAR UN PUNTO DE VENTA (`AlliedAlliedBranchController@update`), y por qué este archivo lee antes de
// escribir: el guardado REESCRIBE la sucursal entera —nombre, dirección, ciudad, zona, contacto— con lo que reciba, BORRA sus
// entidades y crea las que vengan marcadas, y por cada una le COPIA a la sucursal las reglas duras y las de Datacrédito de la
// entidad. Mandar sólo las entidades dejaría la sucursal sin nombre ni contacto. Así que se lee la sucursal desde la misma
// página que usa el admin y se reenvían sus datos tal cual: lo único que cambia es qué entidades quedan activas.

// BranchLender es una entidad del comercio vista desde una sucursal: si está asignada ahí y su enlace (el de la sucursal si lo
// tiene, si no el del comercio: así lo arma el admin).
type BranchLender struct {
	LenderID int    `json:"lender_id"`
	Name     string `json:"name"`
	Active   bool   `json:"active"`
	URLUTM   string `json:"-"`
}

// BranchState es una sucursal tal como la muestra el admin para editarla.
type BranchState struct {
	ID      int            `json:"id"`
	Hash    string         `json:"hash"`
	Name    string         `json:"name"`
	Lenders []BranchLender `json:"lenders"`
	fields  map[string]any
}

// Active son los ids de las entidades asignadas a la sucursal.
func (b *BranchState) Active() []int {
	var ids []int
	for _, l := range b.Lenders {
		if l.Active {
			ids = append(ids, l.LenderID)
		}
	}
	sort.Ints(ids)
	return ids
}

func num(v any) int {
	switch n := v.(type) {
	case float64:
		return int(n)
	case string:
		var i int
		fmt.Sscan(n, &i)
		return i
	}
	return 0
}

func str(v any) string {
	if v == nil {
		return ""
	}
	if s, ok := v.(string); ok {
		return s
	}
	return fmt.Sprint(v)
}

// BranchIDByHash busca el id de una sucursal ACTIVA del comercio por su hash, en el listado de puntos de venta del admin.
func (c *Client) BranchIDByHash(ctx context.Context, alliedID int, hash string) (int, error) {
	r, err := c.Get(ctx, fmt.Sprintf("/aliados/%d/puntosdeventa?per-page=1000", alliedID))
	if err != nil {
		return 0, err
	}
	if r.Page == nil {
		return 0, fmt.Errorf("el admin no devolvió los puntos de venta del comercio %d (HTTP %d)", alliedID, r.Status)
	}
	list, _ := r.Page.Props["alliedBranches"].(map[string]any)
	data, _ := list["data"].([]any)
	for _, d := range data {
		m, _ := d.(map[string]any)
		if strings.EqualFold(str(m["hash"]), hash) {
			return num(m["id"]), nil
		}
	}
	return 0, fmt.Errorf("el comercio %d no tiene una sucursal activa con hash %s", alliedID, hash)
}

// ReadBranch lee una sucursal con sus entidades, de la página de edición del admin (sólo lee).
func (c *Client) ReadBranch(ctx context.Context, alliedID, branchID int) (*BranchState, error) {
	r, err := c.Get(ctx, fmt.Sprintf("/aliados/%d/puntosdeventa?per-page=1&allied_branch_id=%d", alliedID, branchID))
	if err != nil {
		return nil, err
	}
	if r.Page == nil {
		return nil, fmt.Errorf("el admin no devolvió la sucursal %d (HTTP %d)", branchID, r.Status)
	}
	b, _ := r.Page.Props["alliedBranch"].(map[string]any)
	if b == nil || num(b["id"]) != branchID {
		return nil, fmt.Errorf("el admin no devolvió la sucursal %d del comercio %d", branchID, alliedID)
	}
	st := &BranchState{ID: branchID, Hash: str(b["hash"]), Name: str(b["name"]), fields: b}
	allied, _ := b["allied"].(map[string]any)
	ls, _ := allied["lenders"].([]any)
	for _, x := range ls {
		m, _ := x.(map[string]any)
		lender, _ := m["lender"].(map[string]any)
		st.Lenders = append(st.Lenders, BranchLender{LenderID: num(m["lender_id"]), Name: str(lender["name"]),
			Active: num(m["is_active"]) > 0, URLUTM: str(m["url_utm"])})
	}
	if len(st.Lenders) == 0 {
		return nil, fmt.Errorf("el comercio %d no tiene entidades: no hay qué asignar", alliedID)
	}
	return st, nil
}

// contactOf lee el contacto de la sucursal, que el admin guarda como JSON en una columna de texto.
func contactOf(v any) (map[string]any, error) {
	var m map[string]any
	switch c := v.(type) {
	case map[string]any:
		m = c
	case string:
		if err := json.Unmarshal([]byte(c), &m); err != nil {
			return nil, fmt.Errorf("el contacto de la sucursal no es JSON: %v", err)
		}
	}
	for _, k := range []string{"name", "document_number", "cell_phone"} {
		if str(m[k]) == "" {
			return nil, fmt.Errorf("la sucursal no tiene %s en su contacto y el admin lo exige para guardarla: completalo desde el admin", k)
		}
	}
	return m, nil
}

// SetBranchLenders guarda la sucursal desde el formulario del admin dejando activas EXACTAMENTE `lenderIDs`, con el resto de sus
// datos como estaban. ESCRIBE (en dev, la base compartida con qa y staging) y copia las reglas de cada entidad a la sucursal.
// Lo llama quien ya mostró el plan y recibió `--apply`.
func (c *Client) SetBranchLenders(ctx context.Context, alliedID int, b *BranchState, lenderIDs []int) error {
	contact, err := contactOf(b.fields["contact"])
	if err != nil {
		return err
	}
	want := map[int]bool{}
	for _, id := range lenderIDs {
		want[id] = true
	}
	var selected []map[string]any
	for _, l := range b.Lenders {
		active := 0
		if want[l.LenderID] {
			active = 1
		}
		selected = append(selected, map[string]any{"lender_id": l.LenderID, "is_active": active, "url_utm": l.URLUTM})
	}
	body := map[string]any{
		"_method":          "PUT",
		"name":             b.fields["name"],
		"address":          b.fields["address"],
		"city_id":          b.fields["country_city_id"],
		"allied_zone_id":   b.fields["allied_zone_id"],
		"amount_label":     b.fields["amount_label"],
		"contact_name":     contact["name"],
		"document_number":  contact["document_number"],
		"cell_phone":       contact["cell_phone"],
		"lenders_selected": selected,
	}
	if s := num(b.fields["sort"]); s > 0 {
		body["sort"] = s
	}
	raw, _ := json.Marshal(body)
	page := fmt.Sprintf("/aliados/%d/puntosdeventa", alliedID)
	r, err := c.post(ctx, fmt.Sprintf("%s/%d", page, b.ID), "application/json", raw, page)
	if err != nil {
		return err
	}
	if r.Status == 419 {
		return errors.New("el admin rechazó el token CSRF (HTTP 419): la sesión caducó o la cookie XSRF no viajó")
	}
	if r.Status >= 400 {
		return fmt.Errorf("el admin contestó HTTP %d al guardar la sucursal", r.Status)
	}
	if r.Location == "" {
		return fmt.Errorf("el admin no redirigió (HTTP %d): no aceptó el guardado", r.Status)
	}
	if back, err := c.Follow(ctx, r.Location); err == nil {
		if detail := errorsOf(back.Page); detail != "" {
			return fmt.Errorf("el admin rechazó el formulario: %s", detail)
		}
	}
	return nil
}
