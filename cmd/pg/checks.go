package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"regexp"
	"strings"
	"time"

	dbsql "creditop/playground/connectors/sql"
)

// Dos preguntas que se contestaban armando consultas a mano, cada vez, en cada ambiente. Las dos son SÓLO LECTURA (pasan por
// `connectors/sql`, que rechaza cualquier escritura y sólo acepta argumentos de dígitos) y valen también en producción.
//
//   client state    ¿qué hay de esta CÉDULA? El cliente activo y sus bajas (`-t<n>`), sus últimas solicitudes, qué centrales
//                   se le consultaron y cuándo, y qué central decidió su nombre.
//   experian check  ¿esta SUCURSAL va a consultar Experian, y por qué? La copia de las etapas 3 y 4 del disparador
//                   (`Modules/RiskV2/App/Services/CheckExperianTriggerService.php`, que a su vez copia el orden de v1): los
//                   atajos que obligan a consultar y, si ninguno aplica, la periodicidad del comercio.

var docDigits = regexp.MustCompile(`^\d{5,15}$`)

// openSource abre la base del ambiente por el conector (MySQL directo; Redash en prod).
func openSource(target string) (dbsql.Source, int) {
	if !dbsql.ValidTarget(target) {
		return nil, fail(2, "falta o no es válido --target (%s)", strings.Join(dbsql.Targets, " · "))
	}
	cfg, _, err := dbsql.LoadConfig(target)
	if err != nil {
		return nil, fail(2, "%v", err)
	}
	src, err := dbsql.Open(cfg)
	if err != nil {
		return nil, fail(1, "base de %s: %v", target, err)
	}
	return src, 0
}

func rowsOf(src dbsql.Source, query string, args ...any) ([]dbsql.Row, error) {
	if err := dbsql.ValidateReadOnly(query); err != nil {
		return nil, err
	}
	return src.Rows(query, args...)
}

func rowCell(r dbsql.Row, k string) string {
	v, ok := r[k]
	if !ok || v == nil {
		return ""
	}
	switch x := v.(type) {
	case []byte:
		return string(x)
	case time.Time:
		return x.Format("2006-01-02 15:04")
	}
	return fmt.Sprint(v)
}

func intCell(r dbsql.Row, k string) int {
	var n int
	fmt.Sscan(strings.TrimSuffix(rowCell(r, k), ".0"), &n)
	return n
}

// daysAgo dice hace cuántos días fue una fecha de la base («2026-09-21 10:00» o «2026-09-21T10:00:00»), o "".
func daysAgo(s string) string {
	s = strings.Replace(s, "T", " ", 1)
	for _, layout := range []string{"2006-01-02 15:04:05", "2006-01-02 15:04", "2006-01-02"} {
		if len(s) >= len(layout) {
			if t, err := time.Parse(layout, s[:len(layout)]); err == nil {
				return fmt.Sprintf("hace %d días", int(time.Since(t).Hours()/24))
			}
		}
	}
	return ""
}

// ── client state ─────────────────────────────────────────────────────────────────────────────────

type clientState struct {
	Target   string         `json:"target"`
	Source   string         `json:"source"`
	Document string         `json:"document"`
	Accounts []dbsql.Row    `json:"accounts"`
	Active   map[string]any `json:"active,omitempty"`
	Requests []dbsql.Row    `json:"requests,omitempty"`
	Centrals []dbsql.Row    `json:"centrals,omitempty"`
	Names    []dbsql.Row    `json:"nameChecks,omitempty"`
	Notes    []string       `json:"notes,omitempty"`
}

func runClientState(args []string) int {
	fs := flag.NewFlagSet("client state", flag.ContinueOnError)
	target := fs.String("target", "", "ambiente (obligatorio)")
	document := fs.String("document", "", "la cédula, sólo dígitos")
	asJSON := fs.Bool("json", false, "el resultado en JSON")
	if fs.Parse(args) != nil {
		return 2
	}
	doc := strings.TrimSpace(*document)
	if !docDigits.MatchString(doc) {
		return fail(2, "--document va sólo con dígitos, sin prefijo ni sufijo (llegó %q)", doc)
	}
	src, code := openSource(*target)
	if src == nil {
		return code
	}
	defer src.Close()
	st := clientState{Target: *target, Source: src.Name(), Document: doc}

	// Las cuentas de CLIENTE con esa cédula: la activa (cédula exacta) y sus bajas (`-t<n>`). Las cuentas internas llevan
	// el perfil como prefijo (`2-…`, `4-…`) y no entran: no son de esta pregunta.
	accounts, err := rowsOf(src, `SELECT id, document_number, status, user_profile_id, first_name, surname, created_at, updated_at
		FROM users WHERE document_number = ? OR document_number LIKE CONCAT(?, '-t%') ORDER BY id`, doc, doc)
	if err != nil {
		return fail(1, "cuentas: %v", err)
	}
	st.Accounts = accounts
	var activeID int
	for _, a := range accounts {
		if rowCell(a, "document_number") == doc && intCell(a, "status") == 1 {
			if activeID != 0 {
				st.Notes = append(st.Notes, "hay más de una cuenta ACTIVA con la cédula exacta")
			}
			activeID = intCell(a, "id")
			st.Active = a
		}
	}
	if activeID != 0 {
		if st.Requests, err = rowsOf(src, `SELECT id, user_request_status_id, allied_id, allied_branch_id, lender_id, created_at
			FROM user_requests WHERE user_id = ? ORDER BY id DESC LIMIT 5`, activeID); err != nil {
			return fail(1, "solicitudes: %v", err)
		}
		// `codRespuesta` sólo lo trae Ágil Data en `additional_info` (01/21 = conoce a la persona); el resto va cifrado.
		if st.Centrals, err = rowsOf(src, `SELECT c.name AS central, d.updated_at,
				JSON_UNQUOTE(JSON_EXTRACT(d.additional_info, '$.codRespuesta')) AS agildata_code
			FROM risk_central_user_data d JOIN risk_centrals c ON c.id = d.risk_central_id
			WHERE d.user_id = ? ORDER BY d.updated_at`, activeID); err != nil {
			return fail(1, "centrales: %v", err)
		}
		if st.Names, err = rowsOf(src, `SELECT central, reason, passed, created_at FROM kyc_name_checks WHERE user_id = ? ORDER BY id`, activeID); err != nil {
			st.Notes = append(st.Notes, "no pude leer kyc_name_checks: "+err.Error())
		}
	}
	if *asJSON {
		return printJSON(st)
	}

	fmt.Printf("  cédula %s en %s (%s)\n", doc, st.Target, st.Source)
	var bajas []string
	for _, a := range accounts {
		if rowCell(a, "document_number") != doc || intCell(a, "status") != 1 {
			bajas = append(bajas, fmt.Sprintf("%s (id %s)", rowCell(a, "document_number"), rowCell(a, "id")))
		}
	}
	if len(bajas) > 0 {
		fmt.Printf("  bajas anteriores: %s\n", strings.Join(bajas, " · "))
	}
	if st.Active == nil {
		fmt.Println("  sin cliente ACTIVO: el próximo registro con esta cédula crea uno nuevo y consulta las centrales.")
		for _, n := range st.Notes {
			fmt.Println("  ⚠ " + n)
		}
		return 0
	}
	a := st.Active
	fmt.Printf("  cliente ACTIVO %s · %s / %s · perfil %s · creado %s\n", rowCell(a, "id"), rowCell(a, "first_name"), rowCell(a, "surname"), rowCell(a, "user_profile_id"), rowCell(a, "created_at"))
	if intCell(a, "user_profile_id") != 1 {
		fmt.Println("  ⚠ el perfil no es de cliente (1)")
	}
	fmt.Println("  ⚠ el próximo registro con esta cédula REUSA esta cuenta: para volver a consultar centrales, darla de baja antes")
	fmt.Printf("\n  solicitudes (últimas %d)\n", len(st.Requests))
	for _, r := range st.Requests {
		fmt.Printf("    %s · estado %s · comercio %s · sucursal %s · %s\n", rowCell(r, "id"), rowCell(r, "user_request_status_id"), rowCell(r, "allied_id"), rowCell(r, "allied_branch_id"), rowCell(r, "created_at"))
	}
	fmt.Println("\n  centrales consultadas")
	if len(st.Centrals) == 0 {
		fmt.Println("    ninguna")
	}
	for _, c := range st.Centrals {
		extra := ""
		if code := rowCell(c, "agildata_code"); code != "" {
			known := map[bool]string{true: "la conoce", false: "no la conoce"}[code == "01" || code == "21"]
			extra = fmt.Sprintf(" · codRespuesta %s (%s)", code, known)
		}
		fmt.Printf("    %-45s %s · %s%s\n", rowCell(c, "central"), rowCell(c, "updated_at"), daysAgo(rowCell(c, "updated_at")), extra)
	}
	fmt.Println("\n  quién decidió el nombre (kyc_name_checks)")
	if len(st.Names) == 0 {
		fmt.Println("    sin registros")
	}
	for _, n := range st.Names {
		fmt.Printf("    %s · %s · %s · %s\n", rowCell(n, "central"), rowCell(n, "reason"), map[bool]string{true: "pasó", false: "no pasó"}[rowCell(n, "passed") == "1" || rowCell(n, "passed") == "true"], rowCell(n, "created_at"))
	}
	for _, n := range st.Notes {
		fmt.Println("  ⚠ " + n)
	}
	return 0
}

// ── experian check ───────────────────────────────────────────────────────────────────────────────

type experianCheck struct {
	Target    string      `json:"target"`
	Source    string      `json:"source"`
	Branch    dbsql.Row   `json:"branch"`
	Lenders   []dbsql.Row `json:"lenders"`
	Frequency dbsql.Row   `json:"frequency,omitempty"`
	Count     *int        `json:"count,omitempty"`
	Verdict   string      `json:"verdict"`
	Why       string      `json:"why"`
	Caveats   []string    `json:"caveats"`
}

// Un hash de sucursal es hexadecimal: se valida acá y va LITERAL en la consulta, porque el conector sólo acepta argumentos
// de dígitos (en Redash los `?` se interpolan). Con esta regex no hay forma de colar otra cosa.
var branchHash = regexp.MustCompile(`^[0-9a-f]{6,16}$`)

func runExperianCheck(args []string) int {
	fs := flag.NewFlagSet("experian check", flag.ContinueOnError)
	target := fs.String("target", "", "ambiente (obligatorio)")
	hash := fs.String("hash", "", "el hash de la sucursal (8 hex)")
	branchID := fs.Int("branch", 0, "o el id de la sucursal (allied_branches.id)")
	asJSON := fs.Bool("json", false, "el resultado en JSON")
	if fs.Parse(args) != nil {
		return 2
	}
	h := strings.ToLower(strings.TrimSpace(*hash))
	if (h == "") == (*branchID <= 0) {
		return fail(2, "pasá --hash <sucursal> o --branch <id>, uno de los dos")
	}
	if h != "" && !branchHash.MatchString(h) {
		return fail(2, "--hash tiene que ser hexadecimal (llegó %q)", h)
	}
	src, code := openSource(*target)
	if src == nil {
		return code
	}
	defer src.Close()

	where, arg := "b.id = ?", any(*branchID)
	if h != "" {
		where, arg = "b.hash = '"+h+"'", nil
	}
	q := `SELECT b.id, b.name, b.hash, b.status, b.allied_id, a.name AS allied FROM allied_branches b JOIN allieds a ON a.id = b.allied_id WHERE ` + where
	var branches []dbsql.Row
	var err error
	if arg != nil {
		branches, err = rowsOf(src, q, arg)
	} else {
		branches, err = rowsOf(src, q)
	}
	if err != nil {
		return fail(1, "sucursal: %v", err)
	}
	if len(branches) != 1 {
		return fail(1, "encontré %d sucursales con eso en %s", len(branches), *target)
	}
	b := branches[0]
	bid, allied := intCell(b, "id"), intCell(b, "allied_id")
	ck := experianCheck{Target: *target, Source: src.Name(), Branch: b}

	if ck.Lenders, err = rowsOf(src, `SELECT l.id, l.name, l.response_type FROM lenders_by_allied_branches lb JOIN lenders l ON l.id = lb.lender_id
		WHERE lb.allied_branch_id = ? ORDER BY l.id`, bid); err != nil {
		return fail(1, "entidades: %v", err)
	}
	settings, err := rowsOf(src, "SELECT value FROM settings WHERE `key` = 'experian_trigger_bypass_rules' LIMIT 1")
	if err != nil {
		return fail(1, "setting: %v", err)
	}
	var rules struct {
		Allieds []int `json:"allieds"`
		Lenders []int `json:"lenders"`
	}
	if len(settings) == 1 {
		_ = json.Unmarshal([]byte(rowCell(settings[0], "value")), &rules)
	}
	freq, err := rowsOf(src, `SELECT f.frequency, f.every, q.count FROM datacredito_frequencies f
		LEFT JOIN datacredito_query_by_allieds q ON q.allied_id = f.allied_id WHERE f.allied_id = ? LIMIT 1`, allied)
	if err != nil {
		return fail(1, "periodicidad: %v", err)
	}

	contains := func(list []int, n int) bool {
		for _, x := range list {
			if x == n {
				return true
			}
		}
		return false
	}
	var bypassLenders, creditopX []string
	for _, l := range ck.Lenders {
		name := fmt.Sprintf("%s (%s)", rowCell(l, "name"), rowCell(l, "id"))
		if contains(rules.Lenders, intCell(l, "id")) {
			bypassLenders = append(bypassLenders, name)
		}
		if intCell(l, "response_type") == 2 {
			creditopX = append(creditopX, name)
		}
	}
	// El orden es el del disparador: los atajos (etapa 3) antes que la periodicidad (etapa 4).
	switch {
	case contains(rules.Allieds, allied):
		ck.Verdict, ck.Why = "SIEMPRE", fmt.Sprintf("el comercio %d está en experian_trigger_bypass_rules.allieds", allied)
	case len(bypassLenders) > 0:
		ck.Verdict, ck.Why = "SIEMPRE", "la sucursal tiene una entidad de experian_trigger_bypass_rules.lenders: "+strings.Join(bypassLenders, ", ")
	case len(creditopX) > 0:
		ck.Verdict, ck.Why = "SIEMPRE", "la sucursal tiene una entidad CreditopX (response_type 2): "+strings.Join(creditopX, ", ")
	case len(freq) == 0:
		ck.Verdict, ck.Why = "NUNCA", fmt.Sprintf("el comercio %d no tiene regla de periodicidad (datacredito_frequencies): el disparador omite Experian", allied)
	default:
		f := freq[0]
		ck.Frequency = f
		count := intCell(f, "count")
		ck.Count = &count
		every := intCell(f, "every")
		switch {
		case rowCell(f, "frequency") == "":
			ck.Verdict, ck.Why = "PASA LA PERIODICIDAD", "frequency vacía = consultar siempre"
		case every <= 0:
			ck.Verdict, ck.Why = "NUNCA", fmt.Sprintf("every = %d no es válido: el disparador omite Experian", every)
		case count%every == 0:
			ck.Verdict, ck.Why = "PASA LA PERIODICIDAD", fmt.Sprintf("contador %d es múltiplo de every %d: esta evaluación sí", count, every)
		default:
			ck.Verdict, ck.Why = "NO", fmt.Sprintf("1 de cada %d (contador %d): faltan %d evaluaciones para la próxima", every, count, every-count%every)
		}
	}
	ck.Caveats = []string{
		"si el cliente ya tiene un Experian guardado que su central todavía da por vigente, se reusa y no se consulta (etapa 1)",
		"el flujo de pre-aprobado ya confirmado omite Experian (etapa 2)",
	}
	if ck.Verdict == "PASA LA PERIODICIDAD" {
		ck.Caveats = append(ck.Caveats, "pasar la periodicidad no es consultar: después deciden las reglas del comercio, de la entidad y del punto de venta (etapas 5 a 7)")
	}
	if *asJSON {
		return printJSON(ck)
	}
	fmt.Printf("  sucursal %s «%s» (%s) · comercio %s «%s» · %s (%s)\n", rowCell(b, "id"), rowCell(b, "name"), rowCell(b, "hash"), rowCell(b, "allied_id"), rowCell(b, "allied"), *target, src.Name())
	fmt.Printf("  ¿consulta Experian?  %s\n  por qué              %s\n", ck.Verdict, ck.Why)
	fmt.Printf("  entidades (%d):", len(ck.Lenders))
	for _, l := range ck.Lenders {
		fmt.Printf(" %s:%s", rowCell(l, "id"), rowCell(l, "name"))
	}
	fmt.Println()
	for _, c := range ck.Caveats {
		fmt.Println("  · " + c)
	}
	return 0
}
