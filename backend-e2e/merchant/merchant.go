// Package merchant es el eje COMERCIO del modelo [channel] → [merchant] → [lender].
// Resuelve una branch desde la BD por nombre/slug/hash, infiere su "tipo" (qué hace especial al
// comercio) y verifica el comportamiento esperado que dispara durante la entrada.
package merchant

import (
	"database/sql"
	"fmt"
)

// Kind clasifica el comportamiento que el comercio dispara en el backend.
type Kind string

const (
	Standard  Kind = "standard"  // flujo estándar
	Corbeta   Kind = "corbeta"   // bypass: inyecta laboral dummy (field 87=1500000, 29=Empleado)
	Pullman   Kind = "pullman"   // Experian Quanto: auto-inyecta ingreso (field 87)
	Motai     Kind = "motai"     // renting IMEI + Abaco (isMotaiRenting)
	Ecommerce Kind = "ecommerce" // headless: entrada base64 (canal web)
)

// Merchant es un comercio (branch) resuelto desde la BD.
type Merchant struct {
	BranchID, AlliedID int
	Hash, Name, Slug   string
	HaveCtopx          bool
	Kind               Kind
}

// Resolve busca una branch por hash exacto o slug/name aproximado (de la branch o del aliado) e
// infiere su Kind. Permite `pullman`, `alkosto`, `motai`, un hash, etc.
func Resolve(db *sql.DB, q string) (Merchant, error) {
	var m Merchant
	like := "%" + q + "%"
	// slug/have_ctopx viven en `allieds`; `allied_branches` solo tiene id/allied_id/hash/name.
	err := db.QueryRow(`
		SELECT ab.id, ab.allied_id, ab.hash, a.name, COALESCE(a.slug,''), COALESCE(a.have_ctopx,0)
		FROM allied_branches ab JOIN allieds a ON a.id = ab.allied_id
		WHERE ab.hash = ? OR a.hash = ? OR ab.name LIKE ? OR a.slug LIKE ? OR a.name LIKE ?
		ORDER BY ab.id LIMIT 1`,
		q, q, like, like, like).Scan(&m.BranchID, &m.AlliedID, &m.Hash, &m.Name, &m.Slug, &m.HaveCtopx)
	if err != nil {
		return m, fmt.Errorf("comercio %q no encontrado en BD: %w", q, err)
	}
	m.Kind = inferKind(db, m)
	return m, nil
}

// inferKind deduce el tipo de comercio desde la config en BD (allied id, settings.corbeta_allieds,
// credenciales ecommerce).
func inferKind(db *sql.DB, m Merchant) Kind {
	switch {
	case m.AlliedID == 158:
		return Motai
	case m.AlliedID == 94 || m.AlliedID == 189:
		return Pullman
	}
	var inCorbeta int
	db.QueryRow("SELECT COALESCE(JSON_CONTAINS(value, ?),0) FROM settings WHERE `key`='corbeta_allieds' AND code='setting' LIMIT 1",
		fmt.Sprint(m.AlliedID)).Scan(&inCorbeta)
	if inCorbeta > 0 {
		return Corbeta
	}
	var ecom int
	db.QueryRow("SELECT COUNT(*) FROM allied_ecommerce_credentials WHERE allied_branch_id = ?", m.BranchID).Scan(&ecom)
	if ecom > 0 {
		return Ecommerce
	}
	return Standard
}

// SkipLaboral indica si el backend auto-inyecta el laboral (no hay que enviar el formulario).
func (m Merchant) SkipLaboral() bool { return m.Kind == Corbeta || m.Kind == Pullman }

// IsMotai indica el modo Motai Renting (flag isMotaiRenting en la entrada).
func (m Merchant) IsMotai() bool { return m.Kind == Motai }

// NeedsPersonalInfo indica que el flujo requiere que el endpoint personal-info ejecute realmente su
// lógica (no que sea tolerado como ONB005 DOCUMENT_DUPLICATE). Pullman lo necesita: ahí el backend
// corre Experian Acierta+Quanto y auto-inyecta el ingreso (field 87) desde el productValueList[62].
// Para estos comercios NO se manda el documento en register, así personal-info lo fija por primera
// vez y no choca con el guard de duplicado (que rechaza el doc aunque sea del mismo usuario).
func (m Merchant) NeedsPersonalInfo() bool { return m.Kind == Pullman }

// Verify comprueba el comportamiento esperado del comercio tras la entrada (post personal-info).
// Para Standard/Ecommerce/Motai es no-op (su validación vive en el cierre del lender).
func (m Merchant) Verify(db *sql.DB, uReqID int64) error {
	switch m.Kind {
	case Corbeta:
		income, err := fieldValue(db, uReqID, 87)
		if err != nil {
			return fmt.Errorf("corbeta: no se inyectó ingreso (field 87): %w", err)
		}
		if income != "1500000" {
			return fmt.Errorf("corbeta: ingreso esperado 1500000, backend inyectó %q", income)
		}
		if !rowExists(db, "SELECT COUNT(*) FROM user_field_values WHERE user_request_id=? AND field_id=29 AND value='Empleado'", uReqID) {
			return fmt.Errorf("corbeta: no se inyectó situación laboral (field 29)")
		}
	case Pullman:
		income, err := fieldValue(db, uReqID, 87)
		if err != nil || income == "" || income == "0" {
			return fmt.Errorf("pullman: Experian Quanto no inyectó ingreso (field 87): %v", err)
		}
	}
	return nil
}

func fieldValue(db *sql.DB, uReqID int64, fieldID int) (string, error) {
	var v string
	err := db.QueryRow("SELECT value FROM user_field_values WHERE user_request_id=? AND field_id=? ORDER BY id DESC LIMIT 1", uReqID, fieldID).Scan(&v)
	return v, err
}

func rowExists(db *sql.DB, q string, args ...any) bool {
	var n int
	if err := db.QueryRow(q, args...).Scan(&n); err != nil {
		return false
	}
	return n > 0
}

// List devuelve comercios activos para el catálogo del CLI.
func List(db *sql.DB, limit int) []Merchant {
	rows, err := db.Query(`
		SELECT ab.id, ab.allied_id, ab.hash, a.name, COALESCE(a.slug,''), COALESCE(a.have_ctopx,0)
		FROM allied_branches ab JOIN allieds a ON a.id = ab.allied_id
		WHERE ab.status = 1 ORDER BY a.name LIMIT ?`, limit)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []Merchant
	for rows.Next() {
		var m Merchant
		if rows.Scan(&m.BranchID, &m.AlliedID, &m.Hash, &m.Name, &m.Slug, &m.HaveCtopx) == nil {
			m.Kind = inferKind(db, m)
			out = append(out, m)
		}
	}
	return out
}
