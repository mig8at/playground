package main

// request verdict — EL DICTAMEN DE UNA SOLICITUD, en un solo bloque (2026-11-19): por qué estados pasó y quién la movió,
// cómo terminó (y el código si se canceló), qué centrales se consultaron y CON QUÉ CUENTA (la de la entidad o la de
// CreditOp), qué dejó el backend en su tabla `logs` y qué dice Loki de ella en su ventana. Antes eso eran tres o cuatro
// consultas a mano por solicitud (Finandina, 2026-11-19: 505165, 468444). Lo usan la consola, el panel del harness al
// terminar una corrida y `make harness-run`. Sólo lectura (también prod, salvo Loki, que en prod no se consulta desde acá).

import (
	"encoding/json"
	"flag"

	"creditop/my-tools/connectors/logs"

	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

var cancelCode = regexp.MustCompile(`(?i)c[oó]digo\s*(\d+)`)

// RUIDO CONOCIDO DE LOKI: líneas que el backend registra como `error` y son el camino normal. No cuentan como errores de
// la solicitud; el dictamen dice cuántas hubo, aparte. Al sumar una: el porqué, y dónde está en el código.
var knownLokiNoise = []struct {
	re  *regexp.Regexp
	why string
}{
	// `OnboardingController::validateOtpCodeAndRedirectOrchestrator` (legacy-backend, Modules/Onboarding): después del OTP,
	// un cliente nuevo (todavía «temporal») en un comercio que no es Corbeta recibe ONB002, y el front lo manda a los
	// datos personales. Sale en CADA solicitud nueva (qa 505175, local 468444 y 468451, 2026-11-19).
	{regexp.MustCompile(`temporal user without corbeta onboarding, returning ONB002`), "ONB002: cliente nuevo después del OTP, va a datos personales"},
}

func knownNoise(msg string) string {
	for _, k := range knownLokiNoise {
		if k.re.MatchString(msg) {
			return k.why
		}
	}
	return ""
}

func runRequestVerdict(args []string) int {
	fs := flag.NewFlagSet("request verdict", flag.ContinueOnError)
	target := fs.String("target", "", "ambiente (obligatorio)")
	ureq := fs.Int("ureq", 0, "el id de la solicitud (user_requests.id)")
	noLoki := fs.Bool("no-loki", false, "sin consultar Loki (más rápido)")
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
			q.user_request_status_id, s.name AS status, q.created_at, q.updated_at
		FROM user_requests q LEFT JOIN allieds a ON a.id = q.allied_id LEFT JOIN lenders l ON l.id = q.lender_id
		LEFT JOIN user_request_statuses s ON s.id = q.user_request_status_id WHERE q.id = ?`, *ureq)
	if err != nil {
		return fail(1, "solicitud: %v", err)
	}
	if len(head) == 0 {
		return fail(1, "no existe la solicitud %d en %s", *ureq, *target)
	}
	h := head[0]
	recs, err := rowsOf(src, `SELECT r.created_at, r.user_request_status_id, s.name AS status,
			TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.surname, ''))) AS by_name, LEFT(r.comment, 160) AS comment
		FROM user_request_records r LEFT JOIN user_request_statuses s ON s.id = r.user_request_status_id
		LEFT JOIN users u ON u.id = r.update_by WHERE r.user_request_id = ? ORDER BY r.id`, *ureq)
	if err != nil {
		return fail(1, "historial: %v", err)
	}
	// Las centrales consultadas PARA ESTA SOLICITUD: las del cliente desde un rato antes de crearla hasta su último cambio.
	// La cuenta es la de `credential_id` en lo que se le mandó a la central; sin él, la de CreditOp (la de config).
	centrals, err := rowsOf(src, `SELECT d.created_at, c.name AS central,
			JSON_UNQUOTE(JSON_EXTRACT(d.request, '$.credential_id')) AS credential_id,
			k.credentialable_type AS owner_type, COALESCE(ol.name, oa.name, ob.name) AS owner
		FROM user_requests q JOIN risk_central_user_data d ON d.user_id = q.user_id
		JOIN risk_centrals c ON c.id = d.risk_central_id
		LEFT JOIN risk_central_credentials k ON k.id = JSON_UNQUOTE(JSON_EXTRACT(d.request, '$.credential_id'))
		LEFT JOIN lenders ol ON k.credentialable_type LIKE '%Lender' AND ol.id = k.credentialable_id
		LEFT JOIN allieds oa ON k.credentialable_type LIKE '%Allied' AND oa.id = k.credentialable_id
		LEFT JOIN allied_branches ob ON k.credentialable_type LIKE '%AlliedBranch' AND ob.id = k.credentialable_id
		WHERE q.id = ? AND d.created_at >= q.created_at - INTERVAL 10 MINUTE AND d.created_at <= q.updated_at + INTERVAL 5 MINUTE
		ORDER BY d.id`, *ureq)
	if err != nil {
		centrals = nil
	}
	logRows, err := rowsOf(src, `SELECT created_at, name, LEFT(description, 200) AS description FROM logs
		WHERE user_request_id = ? ORDER BY id DESC LIMIT 10`, *ureq)
	if err != nil {
		logRows = nil
	}

	// Loki: las líneas que nombran la solicitud en su ventana, por nivel, y las primeras de error. No desde prod.
	type lokiOut struct {
		Skipped string         `json:"skipped,omitempty"`
		Lines   int            `json:"lines"`
		ByLevel map[string]int `json:"byLevel"`
		Errors  []string       `json:"errors"`
		Known   map[string]int `json:"known"`
	}
	lk := lokiOut{ByLevel: map[string]int{}, Errors: []string{}, Known: map[string]int{}}
	switch {
	case *noLoki:
		lk.Skipped = "--no-loki"
	case *target == "prod":
		lk.Skipped = "en prod se mira con el tracer del equipo"
	default:
		lk = lokiOut{ByLevel: map[string]int{}, Errors: []string{}, Known: map[string]int{}}
		// ⚠ La base local es una copia de dev: si el Loki de `local` apuntara al de dev, el mismo número de solicitud sería
		// la corrida de OTRA persona (la regla de harness/CLAUDE.md, `pkg/loki.ts:porQueNo`).
		if cfg, _, err := logs.LoadConfig(*target); *target == "local" && (err != nil || !logs.IsLocal(cfg.URL)) {
			lk.Skipped = "el Loki de local no es local (leería la corrida de otro con el mismo número)"
			break
		}
		cl, code := client(*target)
		if cl == nil {
			lk.Skipped = fmt.Sprintf("Loki de %s no está configurado (salió %d)", *target, code)
			break
		}
		created, updated := parseWhen(rowCell(h, "created_at")), parseWhen(rowCell(h, "updated_at"))
		// Con margen de horas: la base de qa guarda la hora de Colombia y la local UTC, y el filtro por el número de la
		// solicitud ya acota lo que trae.
		from, to := created.Add(-6*time.Hour), updated.Add(6*time.Hour)
		if created.IsZero() || updated.IsZero() || to.Before(from) {
			from, to = time.Now().Add(-24*time.Hour), time.Now()
		}
		streams, err := cl.Range(fmt.Sprintf(`{app=~".+"} |= "%d"`, *ureq), from, to, 500, "forward")
		if err != nil {
			lk.Skipped = "Loki: " + firstLine(err.Error())
			break
		}
		for _, st := range streams {
			lvl := st.Labels["level"]
			if lvl == "" {
				lvl = st.Labels["detected_level"]
			}
			for _, v := range st.Values {
				lk.Lines++
				isErr := lvl == "error" || lvl == "critical" || lvl == "emergency"
				if isErr {
					if why := knownNoise(v[1]); why != "" {
						lk.Known[why]++
						lk.ByLevel["known"]++
						continue
					}
				}
				lk.ByLevel[lvl]++
				if isErr && len(lk.Errors) < 3 {
					lk.Errors = append(lk.Errors, trimTo(logMessage(v[1]), 200))
				}
			}
		}
	}

	// EL DICTAMEN, en palabras: cómo terminó y qué lo sostiene.
	verdict := []string{}
	st, _ := strconv.Atoi(rowCell(h, "user_request_status_id"))
	switch st {
	case 11:
		verdict = append(verdict, "cerró: «Autorizada»")
	case 8:
		why := "cancelada"
		for i := len(recs) - 1; i >= 0; i-- {
			if c := rowCell(recs[i], "comment"); c != "" {
				why += ": " + c
				if m := cancelCode.FindStringSubmatch(c); m != nil && !strings.Contains(c, m[0]) {
					why += fmt.Sprintf(" (código %s)", m[1])
				}
				break
			}
		}
		verdict = append(verdict, why)
	default:
		verdict = append(verdict, fmt.Sprintf("quedó en %d «%s»", st, rowCell(h, "status")))
	}
	for _, c := range centrals {
		who := "la de CreditOp"
		if id := rowCell(c, "credential_id"); id != "" && id != "null" {
			who = "la de " + nonEmpty(rowCell(c, "owner"), "otro dueño") + " (credencial " + id + ")"
		}
		verdict = append(verdict, fmt.Sprintf("%s consultada con %s", rowCell(c, "central"), who))
	}
	if len(centrals) == 0 {
		verdict = append(verdict, "ninguna central consultada para esta solicitud (o el buró se sembró)")
	}
	for _, l := range logRows {
		if d := rowCell(l, "description"); d != "" {
			verdict = append(verdict, "logs: "+d)
		}
	}
	if lk.Skipped == "" && lk.ByLevel["error"]+lk.ByLevel["critical"] > 0 {
		n := lk.ByLevel["error"] + lk.ByLevel["critical"]
		verdict = append(verdict, fmt.Sprintf("Loki: %d %s que la nombra%s", n, map[bool]string{true: "error", false: "errores"}[n == 1], map[bool]string{true: "", false: "n"}[n == 1]))
	}

	if lk.Skipped == "" && len(lk.Known) > 0 {
		parts := []string{}
		for why, n := range lk.Known {
			parts = append(parts, fmt.Sprintf("%s (%d)", why, n))
		}
		sort.Strings(parts)
		verdict = append(verdict, "Loki, ruido conocido: "+strings.Join(parts, " · "))
	}
	if *asJSON {
		return printJSON(map[string]any{"target": *target, "source": src.Name(), "request": h, "records": recs,
			"centrals": centrals, "logs": logRows, "loki": lk, "verdict": verdict})
	}
	fmt.Printf("  DICTAMEN · solicitud %s en %s · %s «%s» · %s\n", rowCell(h, "id"), *target, rowCell(h, "allied_id"), rowCell(h, "allied"), nonEmpty(rowCell(h, "lender"), "sin entidad"))
	for _, v := range verdict {
		fmt.Println("  · " + v)
	}
	fmt.Println("\n  estados:")
	for _, r := range recs {
		line := fmt.Sprintf("    %s  %3s %s", rowCell(r, "created_at"), rowCell(r, "user_request_status_id"), rowCell(r, "status"))
		if n := rowCell(r, "by_name"); n != "" {
			line += " · " + n
		}
		if c := rowCell(r, "comment"); c != "" {
			line += " · " + c
		}
		fmt.Println(line)
	}
	if lk.Skipped != "" {
		fmt.Printf("\n  Loki: no se consultó (%s)\n", lk.Skipped)
	} else {
		fmt.Printf("\n  Loki: %d líneas la nombran (%s)\n", lk.Lines, levelsLine(lk.ByLevel))
		for _, e := range lk.Errors {
			fmt.Println("    ✗ " + e)
		}
	}
	return 0
}

// parseWhen lee las fechas de la base como las da el conector. Sin zona se leen como de Colombia, pero no todas las bases
// guardan lo mismo (qa la hora local, la base local UTC: medido el 2026-11-19), por eso la ventana de Loki va con margen.
func parseWhen(s string) time.Time {
	s = strings.TrimSpace(s)
	for _, f := range []string{time.RFC3339, "2006-01-02 15:04:05 -0700 MST"} {
		if t, err := time.Parse(f, s); err == nil {
			return t
		}
	}
	bogota := time.FixedZone("COT", -5*3600)
	for _, f := range []string{"2006-01-02 15:04:05", "2006-01-02 15:04"} {
		if t, err := time.ParseInLocation(f, s, bogota); err == nil {
			return t
		}
	}
	return time.Time{}
}

func nonEmpty(s, def string) string {
	if strings.TrimSpace(s) == "" {
		return def
	}
	return s
}

func trimTo(s string, n int) string {
	if len([]rune(s)) <= n {
		return s
	}
	return string([]rune(s)[:n]) + "…"
}

func firstLine(s string) string { return strings.SplitN(s, "\n", 2)[0] }

// logMessage: de una línea JSON de Laravel, su `message` (y la excepción del contexto, si la hay); si no es JSON, la línea.
func logMessage(line string) string {
	var j struct {
		Message string         `json:"message"`
		Context map[string]any `json:"context"`
	}
	if json.Unmarshal([]byte(line), &j) == nil && j.Message != "" {
		if ex, ok := j.Context["exception"].(string); ok && ex != "" {
			return j.Message + " · " + ex
		}
		return j.Message
	}
	return strings.Join(strings.Fields(line), " ")
}

// levelsLine: «61 info · 34 debug · 1 error», de más a menos.
func levelsLine(by map[string]int) string {
	type kv struct {
		k string
		v int
	}
	all := []kv{}
	for k, v := range by {
		label := map[string]string{"known": "conocido", "": "sin nivel"}[k]
		all = append(all, kv{nonEmpty(label, k), v})
	}
	sort.Slice(all, func(a, b int) bool { return all[a].v > all[b].v })
	parts := []string{}
	for _, x := range all {
		parts = append(parts, fmt.Sprintf("%d %s", x.v, x.k))
	}
	return strings.Join(parts, " · ")
}
