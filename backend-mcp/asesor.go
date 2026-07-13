package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"strings"
)

// asesor.go — asociar/desasociar un asesor (fila users por cognito_id) a la sucursal de un comercio
// en DEV. El backend resuelve el asesor logueado por cognito_id (header x-cognito-identity-id) y de su
// fila users saca allied_id/allied_branch_id → el comercio. Reversible: assign guarda un snapshot del
// estado previo y revoke lo restaura (o borra la fila si la creamos). Todo bajo la guarda de dev.

// AsesorRow — fila users relevante para la asociación asesor↔comercio.
type AsesorRow struct {
	ID               int    `json:"id"`
	CognitoID        string `json:"cognito_id"`
	Email            string `json:"email"`
	FullName         string `json:"full_name"`
	AlliedID         *int   `json:"allied_id"`
	AlliedBranchID   *int   `json:"allied_branch_id"`
	AlliedBranchHash string `json:"allied_branch_hash"` // hash de la sucursal actual (para comparar sin más queries)
	UserProfileID    *int   `json:"user_profile_id"`
	Status           int    `json:"status"`
}

const asesorSnapshotFile = ".asesor-snapshot.json"

// alnum deja sólo [a-z0-9] (para derivar email/doc de un cognito_id).
func alnum(s string) string {
	return strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			return r
		}
		return -1
	}, strings.ToLower(s))
}

// findAsesorUsers busca filas users por cognito_id EXACTO o email LIKE %q%.
func findAsesorUsers(db *sql.DB, q string) ([]AsesorRow, error) {
	rows, err := db.Query(
		"SELECT u.id, COALESCE(u.cognito_id,''), COALESCE(u.email,''), COALESCE(u.full_name,''), "+
			"u.allied_id, u.allied_branch_id, COALESCE(ab.hash,''), u.user_profile_id, COALESCE(u.status,0) "+
			"FROM users u LEFT JOIN allied_branches ab ON ab.id = u.allied_branch_id "+
			"WHERE u.cognito_id = ? OR u.email LIKE ? ORDER BY u.id LIMIT 20",
		q, "%"+q+"%")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AsesorRow
	for rows.Next() {
		var r AsesorRow
		var aid, abid, pid sql.NullInt64
		if err := rows.Scan(&r.ID, &r.CognitoID, &r.Email, &r.FullName, &aid, &abid, &r.AlliedBranchHash, &pid, &r.Status); err != nil {
			return nil, err
		}
		if aid.Valid {
			v := int(aid.Int64)
			r.AlliedID = &v
		}
		if abid.Valid {
			v := int(abid.Int64)
			r.AlliedBranchID = &v
		}
		if pid.Valid {
			v := int(pid.Int64)
			r.UserProfileID = &v
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// parsePhones extrae los teléfonos del value (JSON) de qa_otp_bypass_phones — soporta array de
// strings, array de objetos {phone|cell_phone|number|...}, o un string suelto.
func parsePhones(raw string) []string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	// Array genérico: soporta NÚMEROS sin comillas (`[3131010101, …]`, como lo guarda dev), strings u objetos.
	dec := json.NewDecoder(strings.NewReader(raw))
	dec.UseNumber()
	var arr []any
	if dec.Decode(&arr) == nil {
		seen := map[string]bool{}
		var out []string
		add := func(s string) {
			if s != "" && !seen[s] {
				seen[s] = true
				out = append(out, s)
			}
		}
		for _, e := range arr {
			switch v := e.(type) {
			case string:
				add(v)
			case json.Number:
				add(v.String())
			case map[string]any:
				for _, k := range []string{"phone", "cell_phone", "number", "numero", "telefono", "value"} {
					if pv, ok := v[k]; ok {
						add(fmt.Sprint(pv))
						break
					}
				}
			default:
				add(fmt.Sprint(v))
			}
		}
		return out
	}
	var single string
	if json.Unmarshal([]byte(raw), &single) == nil && single != "" {
		return []string{single}
	}
	return nil
}

// opOtpBypassPhones (read-only): lee los teléfonos de `qa_otp_bypass_phones` (settings de dev) para
// CONSULTARLOS. Para cada uno, el OTP de bypass = sus ÚLTIMOS 4 dígitos (válido solo en APP_ENV
// local/development). El flujo en sí usa el teléfono quemado en `.flows.json` (sin query); este comando
// sirve para descubrir/validar qué teléfonos están habilitados en dev.
func opOtpBypassPhones(db *sql.DB) (map[string]any, error) {
	out := map[string]any{"note": "OTP = últimos 4 dígitos (bypass QA, solo APP_ENV local/development)"}
	var raw, code string
	// El servicio usa code='setting'; probamos eso y, si viene vacío, cualquier code con esa key.
	err := db.QueryRow("SELECT value, code FROM settings WHERE `key`='qa_otp_bypass_phones' AND code='setting' LIMIT 1").Scan(&raw, &code)
	if err != nil || parsePhones(raw) == nil {
		var r2, c2 string
		if db.QueryRow("SELECT value, code FROM settings WHERE `key`='qa_otp_bypass_phones' ORDER BY (value IS NULL), CHAR_LENGTH(value) DESC LIMIT 1").Scan(&r2, &c2) == nil && parsePhones(r2) != nil {
			raw, code = r2, c2
		}
	}
	out["raw"], out["code"] = raw, code
	phones := parsePhones(raw)
	list := make([]map[string]string, 0, len(phones))
	for _, p := range phones {
		last4 := p
		if len(p) >= 4 {
			last4 = p[len(p)-4:]
		}
		list = append(list, map[string]string{"phone": p, "otp": last4})
	}
	out["count"], out["phones"] = len(list), list
	return out, nil
}

// opScrubPhone (WRITE · guardado): borra el/los usuarios CLIENTE de un teléfono (cell_phone) + sus
// user_requests/hijos, para que el próximo `register` cree un "TEMPORAL USER" fresco → el flujo del
// asesor caiga en /personal-info (no /lenders). Sólo clientes: NUNCA toca asesores (cognito_id no nulo).
func opScrubPhone(db *sql.DB, phone string) (map[string]any, error) {
	phone = strings.TrimSpace(phone)
	if phone == "" {
		return nil, fmt.Errorf("uso: scrubphone <telefono>")
	}
	ids := queryIDs(db, "SELECT id FROM users WHERE cell_phone=? AND (cognito_id IS NULL OR cognito_id='')", phone)
	n := deleteUsers(db, ids)
	return map[string]any{
		"phone": phone, "users_deleted": n, "user_ids": ids,
		"note": "el próximo register de ese teléfono crea un TEMPORAL USER → /personal-info",
	}, nil
}

// opAsesorWhois (read-only): muestra las filas users que matchean por cognito_id o email.
func opAsesorWhois(db *sql.DB, q string) (map[string]any, error) {
	if strings.TrimSpace(q) == "" {
		return nil, fmt.Errorf("uso: whois <email|cognito_id>")
	}
	rows, err := findAsesorUsers(db, q)
	if err != nil {
		return nil, err
	}
	return map[string]any{"query": q, "count": len(rows), "matches": rows}, nil
}

type asesorSnapshot struct {
	Query         string `json:"query"`
	CognitoID     string `json:"cognito_id"`     // el cognito_id que quedó en la fila tras el assign
	PrevCognitoID string `json:"prev_cognito_id"` // el que tenía antes (para revert si se cambió)
	Existed       bool   `json:"existed"`         // ¿había fila antes del assign?
	RowID         int    `json:"row_id"`
	PrevAlliedID  *int   `json:"prev_allied_id"`
	PrevBranchID  *int   `json:"prev_allied_branch_id"`
	PrevProfileID *int   `json:"prev_user_profile_id"`
	Merchant      string `json:"merchant"`
	NewAlliedID   int    `json:"new_allied_id"`
	NewBranchID   int    `json:"new_allied_branch_id"`
}

func sqlNullInt(p *int) any {
	if p == nil {
		return nil
	}
	return *p
}

// opAsesorAssign (WRITE · guardado): asocia el asesor (por cognito_id o email) a la sucursal del
// comercio. Si ya hay fila → UPDATE (guardando el estado previo). Si NO hay y q es un cognito_id →
// crea una fila de prueba. Guarda snapshot para revert.
func opAsesorAssign(db *sql.DB, cfg Config, q, merchantQ, branchHash, realSub string) (map[string]any, error) {
	if strings.TrimSpace(q) == "" || strings.TrimSpace(merchantQ) == "" {
		return nil, fmt.Errorf("uso: assign <email|cognito_id> <merchant> [branchHash] [realSub]")
	}
	// Resolver allied + sucursal ACTIVA. Si dan branchHash, resolvemos el allied DESDE el hash
	// (consistencia garantizada y el hash del asesor == el de la URL); si no, por merchant.
	var alliedID, branchID int
	var merchantLabel string
	resolved := false
	if branchHash != "" { // hash directo del registro de flujos (consistente y == el de la URL)
		if err := db.QueryRow("SELECT allied_id, id FROM allied_branches WHERE hash=? AND status=1 LIMIT 1", branchHash).
			Scan(&alliedID, &branchID); err == nil {
			merchantLabel, resolved = "branch:"+branchHash, true
		}
	}
	if !resolved { // sin hash, o el hash no resolvió → resolver por nombre de comercio
		m, err := resolveMerchant(db, merchantQ)
		if err != nil {
			return nil, fmt.Errorf("merchant %q: %w", merchantQ, err)
		}
		br, err := ensureBranch(db, m.AlliedID, branchHash) // prefiere branchHash si pertenece al allied
		if err != nil {
			return nil, err
		}
		alliedID, branchID, merchantLabel = m.AlliedID, br.ID, m.Slug
	}
	// hash de la sucursal resuelta (para que el caller arme la URL /merchant/{hash}).
	var resolvedHash string
	db.QueryRow("SELECT COALESCE(hash,'') FROM allied_branches WHERE id=? LIMIT 1", branchID).Scan(&resolvedHash)

	var profileID int
	db.QueryRow("SELECT id FROM user_profiles WHERE name=? LIMIT 1", "Comercial").Scan(&profileID)

	rows, err := findAsesorUsers(db, q)
	if err != nil {
		return nil, err
	}
	var target *AsesorRow
	for i := range rows {
		if rows[i].CognitoID == q { // match exacto por sub manda
			target = &rows[i]
			break
		}
	}
	if target == nil && len(rows) == 1 {
		target = &rows[0]
	}
	if target == nil && len(rows) > 1 {
		return nil, fmt.Errorf("%q matchea %d usuarios; pasá el cognito_id exacto", q, len(rows))
	}

	snap := asesorSnapshot{Query: q, Merchant: merchantLabel, NewAlliedID: alliedID, NewBranchID: branchID}
	createdNew := false

	if target != nil {
		newCognito := target.CognitoID
		if realSub != "" {
			newCognito = realSub // el sub REAL del login web (corrige cognito_id viejo/de otro pool)
		}
		snap.Existed, snap.RowID = true, target.ID
		snap.PrevCognitoID, snap.CognitoID = target.CognitoID, newCognito
		snap.PrevAlliedID, snap.PrevBranchID, snap.PrevProfileID = target.AlliedID, target.AlliedBranchID, target.UserProfileID
		if _, err := db.Exec(
			"UPDATE users SET cognito_id=?, allied_id=?, allied_branch_id=?, user_profile_id=?, status=1, updated_at=NOW() WHERE id=?",
			newCognito, alliedID, branchID, nullIfZero(profileID), target.ID); err != nil {
			return nil, err
		}
	} else {
		cognitoForRow := q
		if realSub != "" {
			cognitoForRow = realSub
		}
		if strings.Contains(cognitoForRow, "@") {
			return nil, fmt.Errorf("no hay usuario para %q (es un email) — pasá el cognito_id (sub) para crear la fila", q)
		}
		createdNew = true
		snap.Existed, snap.CognitoID = false, cognitoForRow
		clean := alnum(cognitoForRow)
		if len(clean) > 12 {
			clean = clean[:12]
		}
		email := "asesor-" + clean + "@creditop.com"
		doc := strings.ToUpper("TA" + clean)
		if len(doc) > 20 {
			doc = doc[:20]
		}
		res, err := db.Exec(
			"INSERT INTO users (cognito_id, first_name, surname, full_name, email, cell_phone, document_number, "+
				"document_type, country_id, allied_id, allied_branch_id, user_profile_id, status, password, created_at, updated_at) "+
				"VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,?,NOW(),NOW())",
			cognitoForRow, "ASESOR", "PRUEBA", "ASESOR PRUEBA", email, uniquePhone(cognitoForRow), doc, "CC", 1,
			alliedID, branchID, nullIfZero(profileID), placeholderPassword)
		if err != nil {
			return nil, err
		}
		id, _ := res.LastInsertId()
		snap.RowID = int(id)
	}

	if b, e := json.MarshalIndent(snap, "", "  "); e == nil {
		if werr := os.WriteFile(asesorSnapshotFile, b, 0o600); werr != nil {
			return nil, fmt.Errorf("no pude guardar el snapshot para revert: %w", werr)
		}
	}

	after, _ := findAsesorUsers(db, snap.CognitoID)
	return map[string]any{
		"assigned":           true,
		"merchant":           merchantLabel,
		"allied_id":          alliedID,
		"allied_branch_id":   branchID,
		"allied_branch_hash": resolvedHash,
		"cognito_id":         snap.CognitoID,
		"created_new_row":    createdNew,
		"snapshot":           asesorSnapshotFile,
		"after":              after,
		"revert":             "go run . revoke",
	}, nil
}

// opAsesorRevoke (WRITE · guardado): revierte el último assign usando el snapshot.
func opAsesorRevoke(db *sql.DB) (map[string]any, error) {
	b, err := os.ReadFile(asesorSnapshotFile)
	if err != nil {
		return nil, fmt.Errorf("no hay snapshot (%s) — nada que revertir: %w", asesorSnapshotFile, err)
	}
	var snap asesorSnapshot
	if err := json.Unmarshal(b, &snap); err != nil {
		return nil, err
	}
	out := map[string]any{"cognito_id": snap.CognitoID, "merchant": snap.Merchant, "row_id": snap.RowID}
	if snap.Existed {
		// si el assign cambió el cognito_id, lo restauramos también.
		if snap.PrevCognitoID != "" {
			if _, err := db.Exec(
				"UPDATE users SET cognito_id=?, allied_id=?, allied_branch_id=?, user_profile_id=?, updated_at=NOW() WHERE id=?",
				snap.PrevCognitoID, sqlNullInt(snap.PrevAlliedID), sqlNullInt(snap.PrevBranchID), sqlNullInt(snap.PrevProfileID), snap.RowID); err != nil {
				return nil, err
			}
		} else if _, err := db.Exec(
			"UPDATE users SET allied_id=?, allied_branch_id=?, user_profile_id=?, updated_at=NOW() WHERE id=?",
			sqlNullInt(snap.PrevAlliedID), sqlNullInt(snap.PrevBranchID), sqlNullInt(snap.PrevProfileID), snap.RowID); err != nil {
			return nil, err
		}
		out["restored"] = "estado previo (cognito_id/allied/branch/profile) restaurado"
	} else {
		if _, err := db.Exec("DELETE FROM users WHERE id=? AND cognito_id=?", snap.RowID, snap.CognitoID); err != nil {
			return nil, err
		}
		out["deleted"] = "fila de prueba creada por assign borrada"
	}
	_ = os.Remove(asesorSnapshotFile)
	return out, nil
}
