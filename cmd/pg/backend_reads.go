package main

import (
	"crypto/sha256"
	"encoding/hex"
	"flag"
	"fmt"
	"regexp"
	"sort"
	"strings"
)

// Lecturas de la base de legacy-backend que se armaban a mano en cada prueba. Todas pasan por `connectors/sql` (sólo
// lectura, argumentos de dígitos) y, salvo `otp last`, valen también en producción.
//
//   settings diff    en qué difieren las settings entre ambientes (las credenciales sólo se comparan, nunca se muestran)
//   request timeline los estados por los que pasó una solicitud, cuándo y quién la movió
//   client fields    los campos guardados de un cliente, con su nombre (los que deciden, p. ej., si se pide el formulario laboral)
//   jobs failed      los trabajos en cola que fallaron en una ventana, agrupados por clase y error
//   otp last         los últimos OTP de un celular: si se mandó, si se validó y si entró por el bypass — NUNCA en producción

// ── settings diff ────────────────────────────────────────────────────────────────────────────────

// Las settings guardan credenciales de proveedores (Crosscore, Evidente…). Su valor no sale nunca: se compara su huella.
var sensitiveKey = regexp.MustCompile(`(?i)pass|secret|token|client_id|username|api_key|apikey|private|credential`)

type settingCell struct {
	Value     string `json:"value,omitempty"`
	Hash      string `json:"hash,omitempty"`
	Sensitive bool   `json:"sensitive,omitempty"`
}

type settingDiff struct {
	Key     string                  `json:"key"`
	Values  map[string]*settingCell `json:"values"` // por ambiente; ausente = el ambiente no la tiene
	Differs bool                    `json:"differs"`
}

func runSettingsDiff(args []string) int {
	fs := flag.NewFlagSet("settings diff", flag.ContinueOnError)
	targets := fs.String("targets", "local,dev,prod", "ambientes a comparar, separados por coma")
	key := fs.String("key", "", "sólo las claves que contienen este texto")
	all := fs.Bool("all", false, "también las que son iguales en todos")
	asJSON := fs.Bool("json", false, "el resultado en JSON")
	if fs.Parse(args) != nil {
		return 2
	}
	envs := strings.Split(*targets, ",")
	if len(envs) < 2 {
		return fail(2, "--targets necesita al menos dos ambientes")
	}
	byKey := map[string]*settingDiff{}
	for _, t := range envs {
		t = strings.TrimSpace(t)
		src, code := openSource(t)
		if src == nil {
			return code
		}
		rows, err := rowsOf(src, "SELECT code, `key`, value, country_id FROM settings")
		src.Close()
		if err != nil {
			return fail(1, "settings de %s: %v", t, err)
		}
		for _, r := range rows {
			k := rowCell(r, "key")
			if c := rowCell(r, "country_id"); c != "" && c != "1" {
				k += " (país " + c + ")"
			}
			if code := rowCell(r, "code"); code != "" && code != "setting" {
				k = code + "/" + k
			}
			if *key != "" && !strings.Contains(strings.ToLower(k), strings.ToLower(*key)) {
				continue
			}
			d := byKey[k]
			if d == nil {
				d = &settingDiff{Key: k, Values: map[string]*settingCell{}}
				byKey[k] = d
			}
			v := strings.TrimSpace(rowCell(r, "value"))
			sum := sha256.Sum256([]byte(v))
			c := &settingCell{Hash: hex.EncodeToString(sum[:])[:10]}
			if sensitiveKey.MatchString(k) {
				c.Sensitive = true
			} else {
				c.Value = v
			}
			d.Values[t] = c
		}
	}
	var out []*settingDiff
	for _, d := range byKey {
		var first string
		for i, t := range envs {
			c, ok := d.Values[strings.TrimSpace(t)]
			h := "∅"
			if ok {
				h = c.Hash
			}
			if i == 0 {
				first = h
			} else if h != first {
				d.Differs = true
			}
		}
		if d.Differs || *all {
			out = append(out, d)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Key < out[j].Key })
	if *asJSON {
		return printJSON(out)
	}
	fmt.Printf("  settings: %d claves %s entre %s\n", len(out), map[bool]string{true: "en total", false: "distintas"}[*all], strings.Join(envs, " · "))
	for _, d := range out {
		fmt.Printf("\n  %s\n", d.Key)
		for _, t := range envs {
			t = strings.TrimSpace(t)
			c, ok := d.Values[t]
			switch {
			case !ok:
				fmt.Printf("    %-8s (no la tiene)\n", t)
			case c.Sensitive:
				fmt.Printf("    %-8s ••• credencial, huella %s\n", t, c.Hash)
			default:
				v := strings.Join(strings.Fields(c.Value), " ") // un JSON de varias líneas, en una
				if len(v) > 160 {
					v = v[:160] + "…"
				}
				fmt.Printf("    %-8s %s\n", t, v)
			}
		}
	}
	return 0
}

// ── request timeline ─────────────────────────────────────────────────────────────────────────────

func runRequestTimeline(args []string) int {
	fs := flag.NewFlagSet("request timeline", flag.ContinueOnError)
	target := fs.String("target", "", "ambiente (obligatorio)")
	ureq := fs.Int("ureq", 0, "el id de la solicitud (user_requests.id)")
	asJSON := fs.Bool("json", false, "el resultado en JSON")
	if fs.Parse(args) != nil {
		return 2
	}
	if *ureq <= 0 {
		return fail(2, "falta --ureq <id de la solicitud>")
	}
	src, code := openSource(*target)
	if src == nil {
		return code
	}
	defer src.Close()
	head, err := rowsOf(src, `SELECT q.id, q.user_id, q.allied_id, a.name AS allied, q.allied_branch_id, q.lender_id, l.name AS lender,
			q.user_request_status_id, s.name AS status, q.flow_id, q.created_at, q.updated_at
		FROM user_requests q LEFT JOIN allieds a ON a.id = q.allied_id LEFT JOIN lenders l ON l.id = q.lender_id
		LEFT JOIN user_request_statuses s ON s.id = q.user_request_status_id WHERE q.id = ?`, *ureq)
	if err != nil {
		return fail(1, "solicitud: %v", err)
	}
	if len(head) == 0 {
		return fail(1, "no existe la solicitud %d en %s (si la borró una corrida, mirá harness/.runs/ureq-%d.json)", *ureq, *target, *ureq)
	}
	// `update_by` es el usuario que hizo el cambio (un asesor, un usuario del admin o el propio cliente); su perfil dice cuál.
	recs, err := rowsOf(src, `SELECT r.created_at, r.user_request_status_id, s.name AS status, r.update_by, u.user_profile_id AS by_profile,
			TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.surname, ''))) AS by_name, LEFT(r.comment, 120) AS comment
		FROM user_request_records r LEFT JOIN user_request_statuses s ON s.id = r.user_request_status_id
		LEFT JOIN users u ON u.id = r.update_by WHERE r.user_request_id = ? ORDER BY r.id`, *ureq)
	if err != nil {
		return fail(1, "historial: %v", err)
	}
	if *asJSON {
		return printJSON(map[string]any{"target": *target, "source": src.Name(), "request": head[0], "records": recs})
	}
	h := head[0]
	fmt.Printf("  solicitud %s en %s (%s)\n  comercio %s «%s» · sucursal %s · entidad %s %s · flujo %s\n  hoy: %s «%s» · creada %s · actualizada %s\n\n",
		rowCell(h, "id"), *target, src.Name(), rowCell(h, "allied_id"), rowCell(h, "allied"), rowCell(h, "allied_branch_id"),
		rowCell(h, "lender_id"), rowCell(h, "lender"), rowCell(h, "flow_id"), rowCell(h, "user_request_status_id"), rowCell(h, "status"),
		rowCell(h, "created_at"), rowCell(h, "updated_at"))
	if len(recs) == 0 {
		fmt.Println("  sin historial de estados (user_request_records)")
	}
	for _, r := range recs {
		by := rowCell(r, "update_by")
		if n := rowCell(r, "by_name"); n != "" {
			by += " " + n + " (perfil " + rowCell(r, "by_profile") + ")"
		}
		line := fmt.Sprintf("  %s  %3s %-32s por %s", rowCell(r, "created_at"), rowCell(r, "user_request_status_id"), rowCell(r, "status"), by)
		if c := rowCell(r, "comment"); c != "" {
			line += " · " + c
		}
		fmt.Println(line)
	}
	return 0
}

// ── client fields ────────────────────────────────────────────────────────────────────────────────

func runClientFields(args []string) int {
	fs := flag.NewFlagSet("client fields", flag.ContinueOnError)
	target := fs.String("target", "", "ambiente (obligatorio)")
	document := fs.String("document", "", "la cédula del cliente activo")
	ureq := fs.Int("ureq", 0, "o el id de una solicitud: sus campos")
	only := fs.String("fields", "", "sólo estos ids de campo, separados por coma (p. ej. 29,87,160: situación laboral, ingreso y reportes negativos)")
	asJSON := fs.Bool("json", false, "el resultado en JSON")
	if fs.Parse(args) != nil {
		return 2
	}
	if (*document == "") == (*ureq <= 0) {
		return fail(2, "pasá --document <cédula> o --ureq <solicitud>, uno de los dos")
	}
	if *document != "" && !docDigits.MatchString(*document) {
		return fail(2, "--document va sólo con dígitos")
	}
	var ids []string
	for _, f := range strings.Split(*only, ",") {
		if f = strings.TrimSpace(f); f != "" {
			if !regexp.MustCompile(`^\d+$`).MatchString(f) {
				return fail(2, "--fields lleva ids numéricos")
			}
			ids = append(ids, f)
		}
	}
	src, code := openSource(*target)
	if src == nil {
		return code
	}
	defer src.Close()
	var userID int
	if *document != "" {
		us, err := rowsOf(src, `SELECT id FROM users WHERE document_number = ? AND status = 1`, *document)
		if err != nil {
			return fail(1, "cliente: %v", err)
		}
		if len(us) != 1 {
			return fail(1, "hay %d clientes activos con la cédula %s en %s (bin/pg client state lo detalla)", len(us), *document, *target)
		}
		userID = intCell(us[0], "id")
	} else {
		us, err := rowsOf(src, `SELECT user_id FROM user_requests WHERE id = ?`, *ureq)
		if err != nil || len(us) != 1 {
			return fail(1, "no encontré la solicitud %d en %s", *ureq, *target)
		}
		userID = intCell(us[0], "user_id")
	}
	filter := ""
	if len(ids) > 0 {
		filter = " AND v.field_id IN (" + strings.Join(ids, ",") + ")" // ids validados como dígitos arriba
	}
	if *ureq > 0 {
		filter += fmt.Sprintf(" AND (v.user_request_id = %d OR v.user_request_id IS NULL)", *ureq)
	}
	// Un campo puede tener varias filas (una por solicitud o por formulario): va la última de cada uno.
	rows, err := rowsOf(src, `SELECT v.field_id, f.name AS field, LEFT(v.value, 80) AS value, v.user_request_id, v.form_id, v.updated_at
		FROM user_field_values v JOIN fields f ON f.id = v.field_id
		WHERE v.user_id = ?`+filter+` AND v.id IN (SELECT MAX(id) FROM user_field_values WHERE user_id = ? GROUP BY field_id)
		ORDER BY v.field_id`, userID, userID)
	if err != nil {
		return fail(1, "campos: %v", err)
	}
	if *asJSON {
		return printJSON(map[string]any{"target": *target, "source": src.Name(), "userId": userID, "fields": rows})
	}
	fmt.Printf("  campos del cliente %d en %s (%s): %d\n", userID, *target, src.Name(), len(rows))
	for _, r := range rows {
		fmt.Printf("  %4s %-38s %-30s solicitud %s · %s\n", rowCell(r, "field_id"), rowCell(r, "field"), rowCell(r, "value"), map[bool]string{true: "—", false: rowCell(r, "user_request_id")}[rowCell(r, "user_request_id") == ""], rowCell(r, "updated_at"))
	}
	return 0
}

// ── jobs failed ──────────────────────────────────────────────────────────────────────────────────

func runJobsFailed(args []string) int {
	fs := flag.NewFlagSet("jobs failed", flag.ContinueOnError)
	target := fs.String("target", "", "ambiente (obligatorio)")
	hours := fs.Int("hours", 24, "la ventana, en horas")
	limit := fs.Int("limit", 20, "cuántos grupos mostrar")
	asJSON := fs.Bool("json", false, "el resultado en JSON")
	if fs.Parse(args) != nil {
		return 2
	}
	if *hours <= 0 || *limit <= 0 {
		return fail(2, "--hours y --limit tienen que ser positivos")
	}
	src, code := openSource(*target)
	if src == nil {
		return code
	}
	defer src.Close()
	// Del payload sólo sale la clase del trabajo: el resto puede traer datos de personas. Del error, la primera línea.
	rows, err := rowsOf(src, `SELECT JSON_UNQUOTE(JSON_EXTRACT(payload, '$.displayName')) AS job, queue,
			LEFT(SUBSTRING_INDEX(exception, '\n', 1), 200) AS error, COUNT(*) AS n, MAX(failed_at) AS last
		FROM failed_jobs WHERE failed_at >= NOW() - INTERVAL ? HOUR
		GROUP BY job, queue, error ORDER BY n DESC, last DESC LIMIT ?`, *hours, *limit)
	if err != nil {
		return fail(1, "failed_jobs: %v", err)
	}
	if *asJSON {
		return printJSON(map[string]any{"target": *target, "source": src.Name(), "hours": *hours, "groups": rows})
	}
	fmt.Printf("  trabajos fallidos en %s (%s), últimas %d h: %d grupos\n", *target, src.Name(), *hours, len(rows))
	for _, r := range rows {
		fmt.Printf("\n  %s ×%s · cola %s · último %s\n    %s\n", rowCell(r, "job"), rowCell(r, "n"), rowCell(r, "queue"), rowCell(r, "last"), rowCell(r, "error"))
	}
	return 0
}

// ── otp last ─────────────────────────────────────────────────────────────────────────────────────

func runOtpLast(args []string) int {
	fs := flag.NewFlagSet("otp last", flag.ContinueOnError)
	target := fs.String("target", "", "local | dev | qa | staging (nunca prod)")
	phone := fs.String("phone", "", "el celular, sólo dígitos (sin + ni indicativo hace falta)")
	limit := fs.Int("limit", 3, "cuántos códigos mostrar")
	asJSON := fs.Bool("json", false, "el resultado en JSON")
	if fs.Parse(args) != nil {
		return 2
	}
	// Un código OTP de producción es una llave de la cuenta de una persona real: no se lee desde acá.
	if strings.EqualFold(*target, "prod") {
		return fail(2, "otp last no lee producción: un código de prod es la llave de la cuenta de una persona")
	}
	p := strings.TrimPrefix(strings.TrimSpace(*phone), "+")
	if !regexp.MustCompile(`^\d{7,15}$`).MatchString(p) {
		return fail(2, "--phone va sólo con dígitos")
	}
	src, code := openSource(*target)
	if src == nil {
		return code
	}
	defer src.Close()
	// El celular se guarda con o sin indicativo y con el prefijo de perfil: se busca por cómo TERMINA.
	rows, err := rowsOf(src, `SELECT created_at, otp, validated, qa_bypass, source, status FROM otps
		WHERE cell_phone LIKE CONCAT('%', ?) ORDER BY id DESC LIMIT ?`, p, *limit)
	if err != nil {
		return fail(1, "otps: %v", err)
	}
	if *asJSON {
		return printJSON(map[string]any{"target": *target, "source": src.Name(), "codes": rows})
	}
	if len(rows) == 0 {
		fmt.Printf("  ningún OTP para …%s en %s\n", p, *target)
		return 0
	}
	for _, r := range rows {
		// El código se guarda cifrado con la APP_KEY del ambiente (un JSON de Laravel en base64, `eyJpdiI6…`): sin esa
		// clave no se puede leer, así que no se muestra. Lo útil es lo de al lado: si se mandó, si se validó y si fue bypass.
		otp := rowCell(r, "otp")
		if strings.HasPrefix(otp, "eyJpdiI6") {
			otp = "cifrado"
		}
		fmt.Printf("  %s · código %s · validado %s · bypass de QA %s · %s\n", rowCell(r, "created_at"), otp, rowCell(r, "validated"), rowCell(r, "qa_bypass"), rowCell(r, "source"))
	}
	return 0
}
