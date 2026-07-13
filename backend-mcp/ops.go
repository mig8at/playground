package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
)

// looksLikeImage: true si la URL apunta a un archivo de imagen (ignora querystring). Para detectar el
// caso #3 (url_utm cargado con un .jpg en vez del link de continuación).
func looksLikeImage(u string) bool {
	u = strings.ToLower(strings.TrimSpace(u))
	if i := strings.IndexByte(u, '?'); i >= 0 {
		u = u[:i]
	}
	for _, ext := range []string{".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".bmp", ".avif"} {
		if strings.HasSuffix(u, ext) {
			return true
		}
	}
	return false
}

// opCryptoCheck confirma que APP_KEY sea el de dev SIN exponer PII: recomputa el HMAC de una fila
// Experian real (sobre el ciphertext, no el texto plano) y lo compara con el mac guardado. mac_valid=true
// ⇒ la llave es la correcta. No desencripta nada.
func opCryptoCheck(db *sql.DB, appKey string) (map[string]any, error) {
	out := map[string]any{}
	if appKey == "" {
		return out, fmt.Errorf("falta APP_KEY en .env.dev")
	}
	rcID := experianRiskCentralID(db)
	out["experian_risk_central_id"] = rcID
	if rcID == 0 {
		return out, fmt.Errorf("no encontré risk_central Experian")
	}
	// Probamos contra una fila REAL (excluye las sintéticas: doc en rango 2.9B) para validar la llave.
	var data string
	err := db.QueryRow(`SELECT rcud.data FROM risk_central_user_data rcud
		JOIN users u ON u.id = rcud.user_id
		WHERE rcud.risk_central_id=? AND rcud.data IS NOT NULL AND COALESCE(u.document_number,'') NOT LIKE '29%'
		ORDER BY rcud.id DESC LIMIT 1`, rcID).Scan(&data)
	if err != nil {
		return out, fmt.Errorf("no hay fila Experian real para probar: %w", err)
	}
	ok, verr := laravelVerifyMAC(appKey, data)
	if verr != nil {
		out["mac_valid"] = false
		out["error"] = verr.Error()
		return out, nil
	}
	out["mac_valid"] = ok
	if ok {
		out["veredicto"] = "APP_KEY correcto (coincide con el de dev)"
	} else {
		out["veredicto"] = "APP_KEY NO coincide con el de dev (o el cifrado difiere) → Laravel no podrá desencriptar lo que forjemos"
	}
	return out, nil
}

// Operaciones compartidas por los tools MCP y el modo CLI. Cada una recibe la *sql.DB (abierta por
// el caller) + la Config, y devuelve structs tipados. NO imprimen (eso es del adaptador).

type MerchantRow struct {
	AlliedID int    `json:"allied_id"`
	Name     string `json:"name"`
	Hash     string `json:"hash"`
	Slug     string `json:"slug"`
}

func opListMerchants(db *sql.DB, query string, limit int) ([]MerchantRow, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	like := "%" + query + "%"
	rows, err := db.Query(`
		SELECT a.id, a.name, COALESCE(MIN(ab.hash),''), COALESCE(a.slug,'')
		FROM allieds a JOIN allied_branches ab ON ab.allied_id = a.id AND ab.status = 1
		WHERE (? = '' OR a.name LIKE ? OR a.slug LIKE ? OR ab.hash = ?)
		GROUP BY a.id ORDER BY a.id DESC LIMIT ?`,
		query, like, like, query, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []MerchantRow
	for rows.Next() {
		var m MerchantRow
		rows.Scan(&m.AlliedID, &m.Name, &m.Hash, &m.Slug)
		out = append(out, m)
	}
	return out, nil
}

// EcommerceBranch — una sucursal HABILITADA para ecommerce (tiene allied_ecommerce_credentials).
type EcommerceBranch struct {
	AlliedID int    `json:"allied_id"`
	Name     string `json:"name"`
	Hash     string `json:"hash"`
}

// opListEcommerce lista las sucursales con credencial ecommerce (token) — las únicas que pueden
// hacer el handshake base64. Filtro opcional por nombre/slug del comercio.
func opListEcommerce(db *sql.DB, query string) ([]EcommerceBranch, error) {
	like := "%" + query + "%"
	rows, err := db.Query(`
		SELECT a.id, a.name, COALESCE(ab.hash,'')
		FROM allied_ecommerce_credentials aec
		JOIN allied_branches ab ON ab.id = aec.allied_branch_id
		JOIN allieds a ON a.id = ab.allied_id
		WHERE (? = '' OR a.name LIKE ? OR a.slug LIKE ?)
		ORDER BY a.id DESC LIMIT 40`, query, like, like)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []EcommerceBranch
	for rows.Next() {
		var e EcommerceBranch
		rows.Scan(&e.AlliedID, &e.Name, &e.Hash)
		out = append(out, e)
	}
	return out, nil
}

// SummaryShape — esquema de user_summaries + un row de muestra (para aprender el shape a fabricar).
type SummaryShape struct {
	Columns []string          `json:"columns"`
	Sample  map[string]string `json:"sample"`
}

// opUserSummaryShape: SHOW COLUMNS de user_summaries + un row de ejemplo (con agildata no nulo, o por
// doc). Read-only — solo para aprender la forma del JSON que después fabricamos sintético.
func opUserSummaryShape(db *sql.DB, doc string) (SummaryShape, error) {
	var s SummaryShape
	crows, err := db.Query("SHOW COLUMNS FROM user_summaries")
	if err != nil {
		return s, err
	}
	for crows.Next() {
		var f, t, n, k, e string
		var d sql.NullString
		crows.Scan(&f, &t, &n, &k, &d, &e)
		null := "NOT NULL"
		if n == "YES" {
			null = "NULL"
		}
		s.Columns = append(s.Columns, fmt.Sprintf("%s %s %s", f, t, null))
	}
	crows.Close()

	q := "SELECT * FROM user_summaries WHERE agildata IS NOT NULL ORDER BY id DESC LIMIT 1"
	var args []any
	if doc != "" {
		q = "SELECT * FROM user_summaries WHERE user_id IN (SELECT id FROM users WHERE document_number = ?) ORDER BY id DESC LIMIT 1"
		args = []any{doc}
	}
	rows, err := db.Query(q, args...)
	if err != nil {
		return s, err
	}
	defer rows.Close()
	cols, _ := rows.Columns()
	if rows.Next() {
		vals := make([]sql.RawBytes, len(cols))
		ptrs := make([]any, len(cols))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		rows.Scan(ptrs...)
		s.Sample = map[string]string{}
		for i, c := range cols {
			v := string(vals[i])
			if len(v) > 1800 {
				v = v[:1800] + "…(trunc)"
			}
			if v != "" {
				s.Sample[c] = v
			}
		}
	}
	return s, nil
}

// opReqDiag vuelca (read-only) el estado de un user_request: la fila user_requests, los records
// CreditopX (process_status 5=iniciado, 11=aprobado/Estado 11) y el ecommerce_request vinculado
// (processed + process_url). Para verificar el sello Estado 11 y el webhook sobre un request sintético.
func opReqDiag(db *sql.DB, uReqID int) (map[string]any, error) {
	out := map[string]any{"user_request_id": uReqID}
	if ur, err := dumpWhere(db, "user_requests", "id", uReqID); err == nil && len(ur) > 0 {
		out["user_request"] = ur[0]
	}
	if cx, err := dumpWhere(db, "creditop_x_user_requests_records", "user_request_id", uReqID); err == nil {
		out["creditop_x_records"] = cx
	}
	// vínculo ecommerce → processed / process_url
	var ecomID int
	db.QueryRow("SELECT ecommerce_request_id FROM user_requests_by_ecommerce_request WHERE user_request_id = ? ORDER BY id DESC LIMIT 1", uReqID).Scan(&ecomID)
	if ecomID > 0 {
		out["ecommerce_request_id"] = ecomID
		if er, err := dumpWhere(db, "ecommerce_requests", "id", ecomID); err == nil && len(er) > 0 {
			out["ecommerce_request"] = er[0]
		}
	}
	return out, nil
}

// opInPlatformLenders descubre (read-only) los lenders IN-PLATFORM (rt 2 CreditopX, 3 cupo rotativo) —
// los que deciden 100% en legacy y por eso el synth puede validar — con un comercio/branch que los
// ofrece y si ese branch es ecommerce. Para elegir contra qué correr el synth (rule-driven).
func opInPlatformLenders(db *sql.DB) ([]map[string]any, error) {
	rows, err := db.Query(`
		SELECT l.id, COALESCE(l.name,''), l.response_type, a.name, COALESCE(ab.hash,''),
		       EXISTS(SELECT 1 FROM allied_ecommerce_credentials aec WHERE aec.allied_branch_id = ab.id) AS ecom
		FROM lenders l
		JOIN lenders_by_allied_branches lab ON lab.lender_id = l.id
		JOIN allied_branches ab ON ab.id = lab.allied_branch_id AND ab.status = 1 AND ab.hash IS NOT NULL
		JOIN allieds a ON a.id = ab.allied_id
		WHERE l.status = 1 AND l.response_type IN (2, 3)
		GROUP BY l.id, ab.id
		ORDER BY l.response_type, l.id, ecom DESC LIMIT 60`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var lid, rt, ecom int
		var lname, merchant, hash string
		rows.Scan(&lid, &lname, &rt, &merchant, &hash, &ecom)
		out = append(out, map[string]any{
			"lender_id": lid, "lender": lname, "response_type": rt,
			"merchant": merchant, "hash": hash, "ecommerce": ecom == 1,
		})
	}
	return out, nil
}

// opLenderOffers descubre (read-only) qué sucursales OFRECEN un lender (match por nombre/id), con su
// hash, response_type y si tienen credencial ecommerce. Para elegir contra qué comercio correr synth.
func opLenderOffers(db *sql.DB, lenderQuery string) ([]map[string]any, error) {
	like := "%" + lenderQuery + "%"
	rows, err := db.Query(`
		SELECT a.name, COALESCE(ab.hash,''), l.id, l.name, l.response_type,
		       EXISTS(SELECT 1 FROM allied_ecommerce_credentials aec WHERE aec.allied_branch_id = ab.id) AS ecom
		FROM lenders_by_allied_branches lab
		JOIN lenders l ON l.id = lab.lender_id AND (l.name LIKE ? OR CAST(l.id AS CHAR) = ?)
		JOIN allied_branches ab ON ab.id = lab.allied_branch_id AND ab.status = 1 AND ab.hash IS NOT NULL
		JOIN allieds a ON a.id = ab.allied_id
		GROUP BY ab.id, l.id
		ORDER BY ecom DESC, a.id DESC LIMIT 30`, like, lenderQuery)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var allied, hash, lname string
		var lid, rt, ecom int
		rows.Scan(&allied, &hash, &lid, &lname, &rt, &ecom)
		out = append(out, map[string]any{
			"merchant": allied, "hash": hash, "lender_id": lid, "lender": lname,
			"response_type": rt, "ecommerce": ecom == 1,
		})
	}
	return out, nil
}

// opLenderConf vuelca (read-only, config) la config de redirect de un lender: su image/url propios +
// el url_utm por comercio (lenders_by_allieds) y por sucursal (lenders_by_allied_branches). Para
// diagnosticar el caso #3 (Lagobo): el WhatsApp de autogestión manda url_utm verbatim, así que si llega
// la URL de una imagen es porque url_utm == la imagen (dato malo, no código).
func opLenderConf(db *sql.DB, lenderID int) (map[string]any, error) {
	out := map[string]any{"lender_id": lenderID}
	var id, rt int
	var name, image, url string
	if err := db.QueryRow(`SELECT id, COALESCE(name,''), COALESCE(image,''), COALESCE(url,''), response_type
		FROM lenders WHERE id = ? LIMIT 1`, lenderID).Scan(&id, &name, &image, &url, &rt); err != nil {
		return out, fmt.Errorf("lender %d no encontrado: %w", lenderID, err)
	}
	out["lender"] = map[string]any{"id": id, "name": name, "image": image, "url": url, "response_type": rt}
	if rows, err := dumpWhere(db, "lenders_by_allieds", "lender_id", lenderID); err == nil {
		out["lenders_by_allieds"] = rows
	}
	if rows, err := dumpWhere(db, "lenders_by_allied_branches", "lender_id", lenderID); err == nil {
		out["lenders_by_allied_branches"] = rows
	}
	return out, nil
}

// opLendersByType lista (read-only, config) los lenders de un response_type con su url/image propios y
// marca cuáles parecen imagen. Para sacar el "deber ser": cómo organizan url vs image los rt=0 sanos y
// por qué Lagobo (35) las tiene todas con imagen.
func opLendersByType(db *sql.DB, rt int) ([]map[string]any, error) {
	rows, err := db.Query(`SELECT id, COALESCE(name,''), COALESCE(url,''), COALESCE(image,''), status
		FROM lenders WHERE response_type = ? ORDER BY id`, rt)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, st int
		var name, url, image string
		rows.Scan(&id, &name, &url, &image, &st)
		out = append(out, map[string]any{
			"id": id, "name": name, "status": st,
			"url": url, "url_is_image": looksLikeImage(url),
			"image": image, "image_is_image": looksLikeImage(image),
		})
	}
	return out, nil
}

// opUserReqs (read-only): busca los user_requests de un teléfono y, para el más reciente, vuelca el
// SNAPSHOT de perfilamiento (profiling_reviews.displayed_lenders) + la sucursal. Para reconciliar si el
// perfilamiento es una "foto" del marketplace (Duncan) vs. recálculo en vivo.
func opUserReqs(db *sql.DB, phone string) (map[string]any, error) {
	out := map[string]any{"phone": phone}
	rows, err := db.Query(`SELECT ur.id, ur.allied_id, ur.allied_branch_id, COALESCE(ab.hash,''),
		ur.lender_id, ur.user_request_status_id, ur.created_at
		FROM user_requests ur JOIN users u ON u.id = ur.user_id
		LEFT JOIN allied_branches ab ON ab.id = ur.allied_branch_id
		WHERE u.cell_phone = ? ORDER BY ur.id DESC LIMIT 10`, phone)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	var reqs []map[string]any
	var latestID int
	for rows.Next() {
		var id, allied, branch, st int
		var hash, created string
		var lender sql.NullInt64
		rows.Scan(&id, &allied, &branch, &hash, &lender, &st, &created)
		if latestID == 0 {
			latestID = id
		}
		reqs = append(reqs, map[string]any{"user_request_id": id, "allied_id": allied,
			"allied_branch_id": branch, "branch_hash": hash, "selected_lender_id": lender.Int64,
			"status": st, "created_at": created})
	}
	out["user_requests"] = reqs
	if latestID != 0 {
		if pr, err := dumpWhere(db, "profiling_reviews", "user_request_id", latestID); err == nil {
			out["profiling_reviews_latest"] = pr
		}
	}
	return out, nil
}

// opSeedPreApproval (WRITE): siembra un lender_transaction APROBADO para que validatePreApproveLender
// pre-apruebe a un lender SIN llamada HTTP externa (Credifamilia lee el txn cacheado). Para validar #12
// localmente. Reversible (borra por id). status_id=41 (APPROVED, lo que el código chequea literal).
func opSeedPreApproval(db *sql.DB, uReqID, lenderID, amount int) (map[string]any, error) {
	var stExists int
	db.QueryRow("SELECT COUNT(*) FROM lender_transaction_statuses WHERE id = 41").Scan(&stExists)
	if stExists == 0 {
		return nil, fmt.Errorf("no existe lender_transaction_statuses.id=41 (APPROVED) en esta BD — el FK fallaría")
	}
	db.Exec("DELETE FROM lender_transactions WHERE user_request_id = ? AND lender_id = ?", uReqID, lenderID)
	resp := fmt.Sprintf(`{"status_detail":"APROBADO","valor_disponible_para_comprar":%d}`, amount)
	order := fmt.Sprintf("mock-seed-%d-%d", uReqID, lenderID)
	res, err := db.Exec(`INSERT INTO lender_transactions (lender_id, user_request_id, status_id, order_id, request, response, created_at, updated_at)
		VALUES (?, ?, 41, ?, '{}', ?, NOW(), NOW())`, lenderID, uReqID, order, resp)
	if err != nil {
		return nil, fmt.Errorf("insert lender_transaction: %w", err)
	}
	id, _ := res.LastInsertId()
	return map[string]any{"lender_transaction_id": id, "lender_id": lenderID, "user_request_id": uReqID,
		"status_id": 41, "status_detail": "APROBADO", "available": amount, "order_id": order,
		"cleanup": fmt.Sprintf("DELETE lender_transactions id=%d", id)}, nil
}

// opAddBranchRule (WRITE, I_KNOW): inserta un group_rule + un lender_rule trivial-true (age != -1) para
// un lender en una sucursal (hash). Sirve para validar el caso #13: un candidato SIN group rule se cae;
// al darle una regla debe reaparecer. Devuelve los IDs para poder borrarlos (branchrule-del). Reversible.
func opAddBranchRule(db *sql.DB, hash string, lenderID int) (map[string]any, error) {
	var abID int
	if err := db.QueryRow("SELECT id FROM allied_branches WHERE hash = ? LIMIT 1", hash).Scan(&abID); err != nil {
		return nil, fmt.Errorf("sucursal %s no encontrada: %w", hash, err)
	}
	res, err := db.Exec("INSERT INTO group_rules (allied_branch_id, rule_name, created_at, updated_at) VALUES (?, ?, NOW(), NOW())",
		abID, fmt.Sprintf("E2E-TEST-lender-%d (borrar)", lenderID))
	if err != nil {
		return nil, fmt.Errorf("insert group_rule: %w", err)
	}
	grID, _ := res.LastInsertId()
	res2, err := db.Exec("INSERT INTO lender_rules (group_rule_id, lender_id, name, specific_table, `column`, operator, value, status, created_at, updated_at)"+
		" VALUES (?, ?, 'E2E test (age != -1)', 'users', 'age', '!=', '-1', 1, NOW(), NOW())", grID, lenderID)
	if err != nil {
		db.Exec("DELETE FROM group_rules WHERE id = ?", grID) // rollback parcial
		return nil, fmt.Errorf("insert lender_rule: %w", err)
	}
	lrID, _ := res2.LastInsertId()
	return map[string]any{"allied_branch_id": abID, "lender_id": lenderID, "group_rule_id": grID, "lender_rule_id": lrID,
		"cleanup": fmt.Sprintf("branchrule-del %d", grID)}, nil
}

// opDelBranchRule (WRITE, I_KNOW): borra un group_rule + sus lender_rules (cleanup del test #13).
func opDelBranchRule(db *sql.DB, groupRuleID int) (map[string]any, error) {
	r1, _ := db.Exec("DELETE FROM lender_rules WHERE group_rule_id = ?", groupRuleID)
	r2, _ := db.Exec("DELETE FROM group_rules WHERE id = ?", groupRuleID)
	n1, _ := r1.RowsAffected()
	n2, _ := r2.RowsAffected()
	return map[string]any{"group_rule_id": groupRuleID, "lender_rules_deleted": n1, "group_rules_deleted": n2}, nil
}

// opModeDiag lee el allied_mode del user_request (lo que usa filterAvailableLenderIds): la fila
// user_request_modes (latest) → allied_modes.config → config['lenders'] (whitelist). Si esa whitelist
// existe y NO incluye al lender objetivo, el marketplace lo filtra aunque cumpla todas las reglas.
func opModeDiag(db *sql.DB, uReqID, targetLender int) (map[string]any, error) {
	out := map[string]any{"user_request_id": uReqID, "target_lender": targetLender}
	urm, err := dumpWhere(db, "user_request_modes", "user_request_id", uReqID)
	if err != nil {
		out["user_request_modes"] = fmt.Sprintf("error: %v", err)
	} else {
		out["user_request_modes"] = urm
	}
	var modeID int
	db.QueryRow("SELECT allied_mode_id FROM user_request_modes WHERE user_request_id = ? ORDER BY id DESC LIMIT 1", uReqID).Scan(&modeID)
	out["latest_allied_mode_id"] = modeID
	if modeID == 0 {
		out["veredicto"] = "sin user_request_mode → filterAvailableLenderIds NO filtra (no es por allied_mode)"
		return out, nil
	}
	var name, config sql.NullString
	db.QueryRow("SELECT COALESCE(name,''), COALESCE(config,'') FROM allied_modes WHERE id = ? LIMIT 1", modeID).Scan(&name, &config)
	out["allied_mode_name"] = name.String
	out["allied_mode_config"] = config.String
	// ¿config['lenders'] incluye al target?
	var cfg map[string]any
	if json.Unmarshal([]byte(config.String), &cfg) == nil {
		if ls, ok := cfg["lenders"].([]any); ok && len(ls) > 0 {
			has := false
			var ids []int
			for _, v := range ls {
				if f, ok := v.(float64); ok {
					ids = append(ids, int(f))
					if int(f) == targetLender {
						has = true
					}
				}
			}
			out["whitelist_lenders"] = ids
			out["target_in_whitelist"] = has
			if has {
				out["veredicto"] = "el target SÍ está en la whitelist del allied_mode → el filtro NO es allied_mode (probá perfilador)"
			} else {
				out["veredicto"] = "el target NO está en la whitelist del allied_mode → AQUÍ se filtra"
			}
		} else {
			out["veredicto"] = "config sin whitelist 'lenders' → filterAvailableLenderIds NO filtra (no es allied_mode)"
		}
	}
	return out, nil
}

// opBranchDiag vuelca (read-only, SIN PII) la config de listado de una sucursal: have_ctopx, los lenders
// candidatos (lenders_by_allied_branch) con nombre/response_type/status, y si la sucursal tiene group_rules.
// Sirve para ver si #77 es siquiera candidato y qué filtros del listado podrían tirarlo.
func opBranchDiag(db *sql.DB, hash string) (map[string]any, error) {
	out := map[string]any{"hash": hash}
	var abID, alliedID int
	var haveCtopx sql.NullInt64
	if err := db.QueryRow(`SELECT ab.id, ab.allied_id, COALESCE(a.have_ctopx,0)
		FROM allied_branches ab JOIN allieds a ON a.id = ab.allied_id WHERE ab.hash = ? LIMIT 1`, hash).
		Scan(&abID, &alliedID, &haveCtopx); err != nil {
		return out, fmt.Errorf("sucursal %s no encontrada: %w", hash, err)
	}
	out["allied_branch_id"], out["allied_id"], out["have_ctopx"] = abID, alliedID, haveCtopx.Int64

	rows, err := db.Query(`SELECT l.id, l.name, l.response_type, l.status
		FROM lenders_by_allied_branches lab JOIN lenders l ON l.id = lab.lender_id
		WHERE lab.allied_branch_id = ? ORDER BY l.sort ASC`, abID)
	if err != nil {
		return out, fmt.Errorf("lenders_by_allied_branches: %w", err)
	}
	defer rows.Close()
	var cands []map[string]any
	has77 := false
	for rows.Next() {
		var id, rt, st int
		var name string
		rows.Scan(&id, &name, &rt, &st)
		if id == 77 {
			has77 = true
		}
		cands = append(cands, map[string]any{"id": id, "name": name, "response_type": rt, "status": st})
	}
	out["candidate_lenders"] = cands
	out["has_credipullman_77"] = has77

	var gr int
	db.QueryRow("SELECT COUNT(*) FROM group_rules WHERE allied_branch_id = ?", abID).Scan(&gr)
	out["group_rules_count"] = gr
	return out, nil
}

// opGroupRules vuelca (read-only, config) las GROUP RULES de una sucursal que aplican a un lender: para
// cada group_rule que contiene al lender, lista TODAS sus lender_rules (field_id/operator/value o
// specific_table/column) — que se evalúan en AND. Es lo que `validateRulesByLender` exige para que el
// lender pase a `return_lenders`. Con esto sé qué campos inyectar al usuario sintético.
func opGroupRules(db *sql.DB, hash string, lenderID int) (map[string]any, error) {
	out := map[string]any{"hash": hash, "lender_id": lenderID}
	var abID int
	if err := db.QueryRow("SELECT id FROM allied_branches WHERE hash = ? LIMIT 1", hash).Scan(&abID); err != nil {
		return out, fmt.Errorf("sucursal %s no encontrada: %w", hash, err)
	}
	out["allied_branch_id"] = abID
	rows, err := db.Query("SELECT gr.id, lr.id, lr.lender_id, COALESCE(lr.name,''), COALESCE(lr.field_id,0), COALESCE(lr.specific_table,''), COALESCE(lr.`column`,''), lr.operator, lr.value, lr.status FROM group_rules gr JOIN lender_rules lr ON lr.group_rule_id = gr.id WHERE gr.allied_branch_id = ? ORDER BY gr.id, lr.id", abID)
	if err != nil {
		return out, fmt.Errorf("group/lender rules: %w", err)
	}
	defer rows.Close()
	type rule struct {
		RuleID, LenderID, FieldID, Status              int
		Name, SpecificTable, Column, Operator, Value string
	}
	groups := map[int][]rule{}
	var order []int
	for rows.Next() {
		var g int
		var r rule
		rows.Scan(&g, &r.RuleID, &r.LenderID, &r.Name, &r.FieldID, &r.SpecificTable, &r.Column, &r.Operator, &r.Value, &r.Status)
		if _, ok := groups[g]; !ok {
			order = append(order, g)
		}
		groups[g] = append(groups[g], r)
	}
	var applicable []map[string]any
	for _, g := range order {
		contains := false
		for _, r := range groups[g] {
			if r.LenderID == lenderID {
				contains = true
				break
			}
		}
		if !contains {
			continue
		}
		var rs []map[string]any
		for _, r := range groups[g] {
			rs = append(rs, map[string]any{
				"rule_id": r.RuleID, "lender_id": r.LenderID, "name": r.Name, "field_id": r.FieldID,
				"specific_table": r.SpecificTable, "column": r.Column, "operator": r.Operator, "value": r.Value, "status": r.Status,
			})
		}
		applicable = append(applicable, map[string]any{"group_rule_id": g, "rules_AND": rs})
	}
	out["applicable_group_rules"] = applicable
	return out, nil
}

// opLenderDatacreditoRules vuelca (read-only) las reglas de datacrédito de un lender para una sucursal
// (la "capa de lender" de los rt=1/integración): score mínimo, negativos, consultas, etc. + si el
// lender tiene credencial de integración para ese comercio (allied_allied_credentials).
func opLenderDatacreditoRules(db *sql.DB, hash string, lenderID int) (map[string]any, error) {
	out := map[string]any{"hash": hash, "lender_id": lenderID}
	var abID, alliedID int
	if err := db.QueryRow("SELECT id, allied_id FROM allied_branches WHERE hash = ? LIMIT 1", hash).Scan(&abID, &alliedID); err != nil {
		return out, fmt.Errorf("sucursal %s no encontrada: %w", hash, err)
	}
	out["allied_branch_id"], out["allied_id"] = abID, alliedID

	// reglas datacrédito por (branch, lender) y como fallback por lender suelto
	rows, err := db.Query("SELECT * FROM lender_datacredito_rules WHERE lender_id = ? AND (allied_branch_id = ? OR allied_branch_id IS NULL) ORDER BY (allied_branch_id = ?) DESC LIMIT 10", lenderID, abID, abID)
	if err != nil {
		out["lender_datacredito_rules"] = fmt.Sprintf("error: %v", err)
	} else {
		defer rows.Close()
		cols, _ := rows.Columns()
		var dr []map[string]string
		for rows.Next() {
			vals := make([]sql.RawBytes, len(cols))
			ptrs := make([]any, len(cols))
			for i := range vals {
				ptrs[i] = &vals[i]
			}
			rows.Scan(ptrs...)
			m := map[string]string{}
			for i, c := range cols {
				if v := string(vals[i]); v != "" {
					m[c] = v
				}
			}
			dr = append(dr, m)
		}
		out["lender_datacredito_rules"] = dr
	}

	// ¿tiene credencial de integración para este comercio? (rt=1 la necesita para ofrecerse)
	var credCount int
	db.QueryRow("SELECT COUNT(*) FROM lender_allied_credentials WHERE lender_id = ? AND allied_id = ?", lenderID, alliedID).Scan(&credCount)
	out["lender_allied_credential"] = credCount > 0
	return out, nil
}

// opLenderRules vuelca (read-only) las reglas de elegibilidad de un lender: lender_users_category_rules
// + lender_users_categories. Sirve para saber qué inyectar (min_income, min_score, continuidad, etc.)
// para que el lender califique en el flujo sintético.
func opLenderRules(db *sql.DB, lenderID int) (map[string]any, error) {
	out := map[string]any{"lender_id": lenderID}
	for _, t := range []string{"lender_users_category_rules", "lender_users_categories"} {
		rows, err := dumpWhere(db, t, "lender_id", lenderID)
		if err != nil {
			out[t] = fmt.Sprintf("error: %v", err)
			continue
		}
		out[t] = rows
	}
	return out, nil
}

// dumpWhere: SELECT * FROM <table> WHERE <col>=? — devuelve filas como []map[string]string (genérico).
func dumpWhere(db *sql.DB, table, col string, val any) ([]map[string]string, error) {
	rows, err := db.Query(fmt.Sprintf("SELECT * FROM %s WHERE %s = ? LIMIT 50", table, col), val)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	cols, _ := rows.Columns()
	var out []map[string]string
	for rows.Next() {
		vals := make([]sql.RawBytes, len(cols))
		ptrs := make([]any, len(cols))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		rows.Scan(ptrs...)
		m := map[string]string{}
		for i, c := range cols {
			v := string(vals[i])
			if len(v) > 1200 {
				v = v[:1200] + "…(trunc)"
			}
			if v != "" {
				m[c] = v
			}
		}
		out = append(out, m)
	}
	return out, nil
}

// opCreateAsesor: resuelve comercio + branch y crea el asesor sintético (namespaced por seed).
func opCreateAsesor(db *sql.DB, cfg Config, merchantQ, role, branchHash string) (CreatedAsesor, error) {
	if role == "" {
		role = "comercial"
	}
	m, err := resolveMerchant(db, merchantQ)
	if err != nil {
		return CreatedAsesor{}, err
	}
	br, err := ensureBranch(db, m.AlliedID, branchHash)
	if err != nil {
		return CreatedAsesor{}, err
	}
	return createAsesor(db, role, m.Slug, m.AlliedID, br.ID, cfg.Seed)
}

// FlowResult — resultado del flujo numero → otp → personal-info → lenders.
type FlowResult struct {
	Merchant           string          `json:"merchant"`
	AlliedID           int             `json:"allied_id"`
	BranchHash         string          `json:"branch_hash"`
	Origin             string          `json:"origin"`                          // "asesor" | "ecommerce"
	EcommerceRequestID int             `json:"ecommerce_request_id,omitempty"`
	UserRequestID      int             `json:"user_request_id"`
	KycSuccess    bool            `json:"kyc_success"`
	KycResponse   map[string]any  `json:"kyc_response"`
	TargetLender      string      `json:"target_lender,omitempty"`      // synth rule-driven: lender objetivo resuelto
	DerivedProfile    map[string]any `json:"derived_profile,omitempty"` // perfil derivado de las reglas (lo que se inyectó)
	LenderCredential  string      `json:"lender_credential,omitempty"`  // rt=1: estado de la credencial de integración
	DatacreditoForged string      `json:"datacredito_forged,omitempty"` // synth: "ok" o el error al forjar el row Experian
	Lenders       []OfferedLender `json:"lenders"`
	LendersStatus int             `json:"lenders_http_status"`
	LendersErr    string          `json:"lenders_error,omitempty"`
	LendersRaw    map[string]any  `json:"lenders_raw,omitempty"` // solo si no se parsearon lenders (debug)
	Notify        map[string]any  `json:"notify,omitempty"`      // synth --notify: webhook sintético + processed
	Cleaned       int             `json:"cleaned"`
}

// opSynth corre un flujo 100% SINTÉTICO (sin llamadas externas ni huella, sin CC real):
// fabrica un cliente (doc sintético namespaced) → [handshake ecommerce] → register → otp(bypass) →
// INYECTA el KYC armado (user_summaries agildata+datacredito + field 87) → GET lenders.
// ecommerce=true usa el handshake base64 (entrada web). income/score parametrizables.
func opSynth(db *sql.DB, cfg Config, merchantQ, lenderQ string, income, score int, ecommerce, keep, notify bool, notifyURL string) (FlowResult, error) {
	var r FlowResult
	r.Origin = "synth"
	if ecommerce {
		r.Origin = "synth-ecommerce"
	}
	phone := "3131010101" // tel de bypass (OTP = últimos 4); en qa_otp_bypass_phones de dev
	doc := synthDoc(cfg.Seed)
	synthEmail := fmt.Sprintf("synth-%s@creditop.com", doc)

	m, err := resolveMerchant(db, merchantQ)
	if err != nil {
		return r, err
	}
	r.Merchant, r.AlliedID, r.BranchHash = m.Name, m.AlliedID, m.Hash

	scrubIdentity(db, "", doc, "") // pre: liberar el doc sintético (no toca reales: rango 2.9B)

	ecomID := 0
	if ecommerce {
		token, terr := branchToken(db, m.Hash)
		if terr != nil || token == "" {
			return r, fmt.Errorf("token ecommerce no encontrado para %s (%s) — usá una sucursal del comando `ecommerce`: %v", m.Name, m.Hash, terr)
		}
		billing := PersonalInfo{DocType: "CC", Doc: doc, Name: "SYNTH", Surname: "TEST USER", Email: synthEmail}
		ecomID, err = createEcommerceRequest(cfg.APIBaseURL, m.Hash, token, phone, "https://tienda-mcp.test/webhook", billing, 1500000)
		if err != nil {
			return r, fmt.Errorf("handshake ecommerce: %w", err)
		}
		r.EcommerceRequestID = ecomID
	}

	if err := register(cfg.APIBaseURL, m.Hash, phone, doc, !needsPersonalInfo(m.AlliedID)); err != nil {
		return r, fmt.Errorf("register: %w", err)
	}
	uReqID, err := validateOtp(cfg.APIBaseURL, m.Hash, phone, 1500000, ecomID)
	if err != nil {
		return r, fmt.Errorf("otp-validate (¿bypass?): %w", err)
	}
	r.UserRequestID = uReqID
	userID := userIDOfRequest(db, uReqID)
	if userID == 0 {
		return r, fmt.Errorf("no se pudo resolver user_id del request %d", uReqID)
	}

	// Perfil DERIVADO de las reglas (RULE-DRIVEN): si se dio un lender, leemos sus group rules + reglas
	// de datacrédito y armamos el perfil mínimo que las cumple; si no, defaults sanos.
	req := synthReq{fields: map[int]string{29: "Empleado", 160: "no", 87: "2500000"}, gender: "M", age: 35, income: 2500000, score: 700}
	if lenderQ != "" {
		lid, rt, lname, lerr := resolveLender(db, m.Hash, lenderQ)
		if lerr != nil {
			r.TargetLender = "no resuelto: " + lenderQ
		} else {
			req = deriveSynthReq(db, m.Hash, lid, rt)
			r.TargetLender = fmt.Sprintf("%s #%d (rt=%d)", lname, lid, rt)
			if rt != 2 && rt != 3 { // rt=1/integración: asegurar la credencial para que se ofrezca
				r.LenderCredential = ensureLenderCredential(db, m.AlliedID, lid)
			}
		}
	}
	if income > 0 { // override explícito (--income)
		req.income = income
		req.fields[87] = fmt.Sprint(income)
	}
	if score > 0 { // override explícito (--score)
		req.score = score
	}
	r.DerivedProfile = map[string]any{"fields": req.fields, "gender": req.gender, "age": req.age, "income": req.income, "score": req.score}

	// KYC ARMADO: identidad + user_summaries + fields + datacredito, todo DERIVADO de las reglas.
	setSynthIdentity(db, userID, doc, synthEmail, req.gender, req.age)
	injectSummary(db, userID, req.income, req.score)
	injectIncomeFields(db, userID, uReqID, req.fields)
	// Forja el row Experian encriptado (risk_central_user_data) → habilita los lenders Creditop X.
	if err := injectDatacredito(db, cfg.AppKey, userID, req.income, req.score); err != nil {
		r.DatacreditoForged = err.Error()
	} else {
		r.DatacreditoForged = "ok"
	}
	r.KycSuccess = true
	r.KycResponse = map[string]any{"armado": true, "income": req.income, "score": req.score}

	lenders, raw, st, mErr := marketplace(cfg.APIBaseURL, uReqID)
	r.Lenders, r.LendersStatus = lenders, st
	if mErr != nil {
		r.LendersErr = mErr.Error()
	}
	if len(lenders) == 0 {
		r.LendersRaw = raw
	}
	// Webhook sintético (cierre): dispara la notificación ecommerce + processed. Solo tiene sentido en
	// entrada ecommerce (hay ecommerce_request vinculado). Antes del scrub (usa el vínculo + la fila).
	if notify && ecommerce {
		nr, nerr := notifyEcommerce(db, uReqID, notifyURL)
		if nerr != nil {
			nr = map[string]any{"error": nerr.Error()}
		}
		r.Notify = nr
	}
	if !keep {
		r.Cleaned = scrubIdentity(db, "", doc, "")
	}
	return r, nil
}

// opSynthFill INYECTA el KYC armado sobre un user_request YA CREADO (ej. el que arma el wizard al llegar
// a /personal-info), en vez de crear su propio flujo como opSynth. Reusa la misma maquinaria: identidad
// (deja de ser TEMPORAL USER) + user_summaries + fields 87/29/160 + fila Experian encriptada — SIN tocar
// AgilData/Mareigua/TusDatos/Experian. Tras esto, navegar a /lenders muestra las ofertas (el marketplace
// lee del KYC armado). Si se da `lender`, deriva el perfil de sus reglas; si no, defaults sanos.
// El doc es sintético y ÚNICO por request (rango [2.9B,3B) que el FE acepta y scrubIdentity trata como sintético).
func opSynthFill(db *sql.DB, cfg Config, uReqID int, lenderQ string, income, score int) (map[string]any, error) {
	if uReqID == 0 {
		return nil, fmt.Errorf("uso: synth-fill <uReqID> [lender]")
	}
	if cfg.AppKey == "" {
		return nil, fmt.Errorf("falta APP_KEY en .env.dev (para forjar el datacredito)")
	}
	userID := userIDOfRequest(db, uReqID)
	if userID == 0 {
		return nil, fmt.Errorf("no hay user_id para el request %d", uReqID)
	}
	branchHash := branchHashOfRequest(db, uReqID)

	req := synthReq{fields: map[int]string{29: "Empleado", 160: "no", 87: "2500000"}, gender: "M", age: 35, income: 2500000, score: 700}
	target := ""
	if lenderQ != "" && branchHash != "" {
		if lid, rt, lname, lerr := resolveLender(db, branchHash, lenderQ); lerr == nil {
			req = deriveSynthReq(db, branchHash, lid, rt)
			target = fmt.Sprintf("%s #%d (rt=%d)", lname, lid, rt)
			if rt != 2 && rt != 3 {
				var alliedID int
				db.QueryRow("SELECT allied_id FROM allied_branches WHERE hash=? LIMIT 1", branchHash).Scan(&alliedID)
				ensureLenderCredential(db, alliedID, lid)
			}
		}
	}
	if income > 0 {
		req.income = income
		req.fields[87] = fmt.Sprint(income)
	}
	if score > 0 {
		req.score = score
	}

	doc := fmt.Sprint(2900000000 + uReqID)
	email := fmt.Sprintf("synth-%d@creditop.com", uReqID)
	setSynthIdentity(db, userID, doc, email, req.gender, req.age)
	injectSummary(db, userID, req.income, req.score)
	injectIncomeFields(db, userID, uReqID, req.fields)
	dc := "ok"
	if err := injectDatacredito(db, cfg.AppKey, userID, req.income, req.score); err != nil {
		dc = err.Error()
	}

	return map[string]any{
		"user_request_id":    uReqID,
		"user_id":            userID,
		"branch_hash":        branchHash,
		"target_lender":      target,
		"doc":                doc,
		"profile":            map[string]any{"fields": req.fields, "gender": req.gender, "age": req.age, "income": req.income, "score": req.score},
		"datacredito_forged": dc,
		"note":               "KYC armado inyectado en el user_request del wizard → navegá a /lenders",
	}, nil
}
