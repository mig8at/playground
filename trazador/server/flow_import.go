package main

// Endpoints de lectura para Flow. No aceptan SQL ni exponen credenciales: cada endpoint
// construye una consulta acotada sobre prod y el navegador sólo recibe el mínimo catálogo.

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"unicode"
)

func registrarFlowImport(mux *http.ServeMux) {
	mux.HandleFunc("/api/flow/comercios", flowComercios)
	mux.HandleFunc("/api/flow/sucursales", flowSucursales)
	mux.HandleFunc("/api/flow/entidades", flowEntidades)
	mux.HandleFunc("/api/flow/configuracion", flowConfiguracion)
}

// textoCatalogo permite nombres humanos, pero elimina los caracteres con significado SQL antes
// de interpolar el LIKE. Redash no ofrece parámetros para texto; por eso esta excepción está
// aislada aquí, en vez de abrir Runner.Filas a argumentos arbitrarios.
func textoCatalogo(s string) (string, error) {
	s = strings.TrimSpace(s)
	if len([]rune(s)) < 2 || len([]rune(s)) > 60 {
		return "", fmt.Errorf("la búsqueda debe tener entre 2 y 60 caracteres")
	}
	for _, r := range s {
		if !(unicode.IsLetter(r) || unicode.IsDigit(r) || unicode.IsSpace(r) || strings.ContainsRune("&.-'", r)) {
			return "", fmt.Errorf("la búsqueda contiene un carácter no permitido")
		}
	}
	// Aun con la lista blanca se escapan comilla y barra: el texto queda dentro de un literal.
	return strings.ReplaceAll(strings.ReplaceAll(strings.ToLower(s), "\\", "\\\\"), "'", "\\'"), nil
}

func enteroFlow(r *http.Request, key string) (int64, error) {
	n, err := strconv.ParseInt(r.URL.Query().Get(key), 10, 64)
	if err != nil || n <= 0 {
		return 0, fmt.Errorf("%s debe ser un identificador numérico", key)
	}
	return n, nil
}

func fuenteProdFlow() (Runner, error) {
	c, _ := loadConfig("prod")
	return abrirFuente(c)
}

func flowComercios(w http.ResponseWriter, r *http.Request) {
	q, err := textoCatalogo(r.URL.Query().Get("q"))
	if err != nil {
		jsonErr(w, 400, err.Error())
		return
	}
	limit := 10
	if r.URL.Query().Get("limit") == "5" {
		limit = 5
	}
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	if page < 0 || page > 100 {
		jsonErr(w, 400, "página no permitida")
		return
	}
	f, err := fuenteProdFlow()
	if err != nil {
		jsonErr(w, 502, err.Error())
		return
	}
	defer f.Close()
	rows, err := f.Filas(fmt.Sprintf("SELECT id, name, country_id FROM allieds WHERE status = 1 AND LOWER(name) LIKE '%%%s%%' ORDER BY name, id LIMIT %d OFFSET %d", q, limit, limit*page))
	if err != nil {
		jsonErr(w, 502, "no se pudieron buscar comercios: "+err.Error())
		return
	}
	jsonOK(w, map[string]any{"items": rows, "page": page, "limit": limit, "hasMore": len(rows) == limit, "source": f.Nombre()})
}

func flowSucursales(w http.ResponseWriter, r *http.Request) {
	allied, err := enteroFlow(r, "allied")
	if err != nil {
		jsonErr(w, 400, err.Error())
		return
	}
	f, err := fuenteProdFlow()
	if err != nil {
		jsonErr(w, 502, err.Error())
		return
	}
	defer f.Close()
	rows, err := f.Filas("SELECT id, name, status FROM allied_branches WHERE allied_id = ? ORDER BY status DESC, name, id", allied)
	if err != nil {
		jsonErr(w, 502, "no se pudieron cargar sucursales: "+err.Error())
		return
	}
	jsonOK(w, map[string]any{"items": rows, "source": f.Nombre()})
}

func flowEntidades(w http.ResponseWriter, r *http.Request) {
	branch, err := enteroFlow(r, "sucursal")
	if err != nil {
		jsonErr(w, 400, err.Error())
		return
	}
	f, err := fuenteProdFlow()
	if err != nil {
		jsonErr(w, 502, err.Error())
		return
	}
	defer f.Close()
	rows, err := f.Filas("SELECT l.id, l.name, l.response_type, l.country_id, l.status, lbab.status AS branch_status, lbab.document_types FROM lenders_by_allied_branches lbab JOIN lenders l ON l.id = lbab.lender_id WHERE lbab.allied_branch_id = ? ORDER BY lbab.status DESC, l.name, l.id", branch)
	if err != nil {
		jsonErr(w, 502, "no se pudieron cargar entidades: "+err.Error())
		return
	}
	jsonOK(w, map[string]any{"items": rows, "source": f.Nombre()})
}

func flowConfiguracion(w http.ResponseWriter, r *http.Request) {
	branch, err := enteroFlow(r, "sucursal")
	if err != nil {
		jsonErr(w, 400, err.Error())
		return
	}
	lender, err := enteroFlow(r, "entidad")
	if err != nil {
		jsonErr(w, 400, err.Error())
		return
	}
	f, err := fuenteProdFlow()
	if err != nil {
		jsonErr(w, 502, err.Error())
		return
	}
	defer f.Close()
	// Una consulta por importación: línea de crédito y la regla efectiva de sucursal. Se limita a
	// una entidad seleccionada; perfiles y reglas no modeladas aún no se fingen como equivalentes.
	q := "SELECT l.id, l.name, l.response_type, l.country_id, l.status, lbab.document_types, " +
		"clbl.min_amount, clbl.max_amount, clbl.max_fee_number, clbl.fee_numbers, clbl.rate, " +
		"d.score AS min_score, d.negative_historical_last_12_months AS max_negatives, " +
		"d.consulted_last_6_months AS max_inquiries, d.time_finance_sector AS min_maturation, d.allow_0_score " +
		"FROM lenders l " +
		"JOIN lenders_by_allied_branches lbab ON lbab.lender_id = l.id AND lbab.allied_branch_id = ? " +
		"LEFT JOIN credit_line_by_lenders clbl ON clbl.lender_id = l.id " +
		"LEFT JOIN lender_datacredito_rules d ON d.lender_id = l.id AND d.allied_branch_id = ? " +
		"WHERE l.id = ? LIMIT 1"
	rows, err := f.Filas(q, branch, branch, lender)
	if err != nil {
		jsonErr(w, 502, "no se pudo importar la configuración: "+err.Error())
		return
	}
	if len(rows) == 0 {
		jsonErr(w, 404, "la entidad no pertenece a esa sucursal")
		return
	}
	// Las capas siguientes son pequeñas y sólo se leen tras escoger una entidad. Se consultan en
	// paralelo para no convertir la importación puntual en una cadena de esperas de Redash.
	type extra struct {
		key  string
		rows []Fila
		err  error
	}
	jobs := []struct {
		key, sql string
		args     []any
	}{
		{"profiles", "SELECT c.id, c.name, c.loan_limit, c.already_used_loan, c.min_initial_fee, c.max_fee_number, c.max_amount, c.`order` AS priority, r.occupation, r.min_age, r.max_age, r.monthly_income, r.gender, r.negative_reports_last_12_months, r.current_delinquencies, r.financial_history_length, r.min_score, r.employment_continuity, r.consulted_last_6_months FROM lender_users_categories c LEFT JOIN lender_users_category_rules r ON r.lender_users_category_id = c.id AND r.lender_id = c.lender_id AND r.lender_users_category_type_id = 1 WHERE c.lender_id = ? ORDER BY c.`order`, c.id", []any{lender}},
		{"tramos", "SELECT min_amount, max_amount, max_fee_number, mandatory_fee_number FROM creditop_x_conditions_by_amount_by_lender WHERE lender_id = ? ORDER BY min_amount, max_amount, id", []any{lender}},
		{"groupRules", "SELECT gr.id AS group_id, gr.rule_name, lr.name, lr.specific_table, lr.`column`, lr.operator, lr.value FROM group_rules gr JOIN lender_rules lr ON lr.group_rule_id = gr.id WHERE gr.allied_branch_id = ? AND lr.status = 1 ORDER BY gr.id, lr.id", []any{branch}},
	}
	ch := make(chan extra, len(jobs))
	for _, j := range jobs {
		go func(j struct {
			key, sql string
			args     []any
		}) {
			out, e := f.Filas(j.sql, j.args...)
			ch <- extra{j.key, out, e}
		}(j)
	}
	out := map[string]any{"item": rows[0], "source": f.Nombre(), "scope": "línea, Datacrédito, perfiles, tramos y group_rules"}
	for range jobs {
		x := <-ch
		if x.err != nil {
			jsonErr(w, 502, "no se pudo importar "+x.key+": "+x.err.Error())
			return
		}
		out[x.key] = x.rows
	}
	jsonOK(w, out)
}
