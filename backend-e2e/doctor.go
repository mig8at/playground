// doctor — diagnóstico del setup local (espejo de flutter doctor / brew doctor).
// Corre 8 checks reales y reporta verde/rojo/warning + fix inline. Portado de
// creditop-cli/src/lib/doctor.ts. Exit: 0 si todo OK (warnings permitidos), 1 si hay fail.
//
//	go run . doctor [--json]
//
// Filosofía: cada check debe REALMENTE fallar en práctica (no chequeo trivial). Los fixes
// vienen del catálogo en docs/hallazgos-backend.md y de la experiencia operativa.

package main

import (
	"creditop-tests/pkg/client"
	"creditop-tests/pkg/config"
	"creditop-tests/pkg/database"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

type checkResult struct {
	Status  string `json:"status"` // "ok" | "fail" | "warn"
	Name    string `json:"name"`
	Message string `json:"message"`
	Fix     string `json:"fix,omitempty"`
}

func legacyBackendPath() string {
	if p := os.Getenv("LEGACY_BACKEND_PATH"); p != "" {
		return p
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, "Desktop", "CREDITOP", "github", "legacy-backend")
}

func frontendE2EPath() string {
	if p := os.Getenv("FRONTEND_E2E_PATH"); p != "" {
		return p
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, "Desktop", "CREDITOP", "playground", "frontend-e2e")
}

func runDoctor(args []string) int {
	asJSON := false
	for _, a := range args {
		if a == "--json" {
			asJSON = true
		} else if a == "-h" || a == "--help" {
			fmt.Fprintln(os.Stderr, "uso: go run . doctor [--json]\nCorre 8 checks del setup local (MySQL, esquema, scoring, OTP bypass, backend HTTP, drivers, stash, .cognito.json).")
			return 0
		}
	}

	cfg := config.GetConfig(target)
	db := database.Connect(cfg)
	defer db.Close()

	checks := []checkResult{
		checkMysqlUp(db),
		checkSchemaPopulated(db),
		checkScoringMigrations(db),
		checkOtpBypassSetting(db),
		checkBackendHTTP(cfg.ApiBaseURL),
		checkOnboardingResponds(cfg.ApiBaseURL),
		checkLegacyStash(),
		checkCognitoFile(),
	}

	if asJSON {
		out := map[string]any{"checks": checks, "summary": summarize(checks)}
		b, _ := json.MarshalIndent(out, "", "  ")
		fmt.Println(string(b))
	} else {
		fmt.Println(formatChecks(checks, os.Getenv("NO_COLOR") != "1"))
	}

	for _, c := range checks {
		if c.Status == "fail" {
			return 1
		}
	}
	return 0
}

func summarize(checks []checkResult) map[string]int {
	s := map[string]int{"total": len(checks), "ok": 0, "fail": 0, "warn": 0}
	for _, c := range checks {
		s[c.Status]++
	}
	return s
}

// ── Checks ───────────────────────────────────────────────────────────────────

func checkMysqlUp(db *sql.DB) checkResult {
	var one int
	if err := db.QueryRow("SELECT 1").Scan(&one); err != nil {
		return checkResult{"fail", "MySQL local", "error de conexión: " + truncate(err.Error(), 80),
			"cd ~/Desktop/CREDITOP/github/legacy-backend && make up"}
	}
	return checkResult{"ok", "MySQL local", "conexión OK · BD `creditop` accesible", ""}
}

func checkSchemaPopulated(db *sql.DB) checkResult {
	var count int
	if err := db.QueryRow("SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()").Scan(&count); err != nil {
		return checkResult{"fail", "Esquema BD", truncate(err.Error(), 80), ""}
	}
	if count < 50 {
		return checkResult{"fail", "Esquema BD", fmt.Sprintf("%d tablas (BD vacía o parcial)", count),
			"cd ~/Desktop/CREDITOP/github/legacy-backend && make setup (BD vacía) o restaurar dump"}
	}
	if count < 200 {
		return checkResult{"warn", "Esquema BD", fmt.Sprintf("%d tablas (esperado ~212; BD parcial)", count), ""}
	}
	return checkResult{"ok", "Esquema BD", fmt.Sprintf("%d tablas presentes", count), ""}
}

func checkScoringMigrations(db *sql.DB) checkResult {
	// hallazgos-backend.md #5: la BD local viene de un dump SQL; las migraciones de scoring
	// de Creditop X (feb 2026) no se corrieron → falta lender_user_fields_scoring_policy.
	// Sin ella, acceptance/promissory-note de CrediPullman tira 500.
	var n int
	err := db.QueryRow("SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'lender_user_fields_scoring_policy'").Scan(&n)
	if err != nil {
		return checkResult{"warn", "Scoring CreditopX", "no pudo verificarse: " + truncate(err.Error(), 60), ""}
	}
	if n > 0 {
		return checkResult{"ok", "Scoring CreditopX", "tabla `lender_user_fields_scoring_policy` presente", ""}
	}
	return checkResult{"fail", "Scoring CreditopX", "falta tabla `lender_user_fields_scoring_policy` (cierre rt=2 dará 500)",
		"cd ~/Desktop/CREDITOP/github/legacy-backend && php artisan migrate --path=Modules/Loans/database/migrations/2026_02_*"}
}

func checkOtpBypassSetting(db *sql.DB) checkResult {
	var v sql.NullString
	err := db.QueryRow("SELECT value FROM settings WHERE `key` = 'qa_otp_bypass_phones' AND code = 'setting' LIMIT 1").Scan(&v)
	if err == sql.ErrNoRows {
		return checkResult{"warn", "OTP bypass setting", "setting `qa_otp_bypass_phones` no existe (bypass por phone deshabilitado)",
			"INSERT INTO settings (code, `key`, value) VALUES ('setting', 'qa_otp_bypass_phones', '[]')"}
	}
	if err != nil {
		return checkResult{"warn", "OTP bypass setting", "no pudo verificarse", ""}
	}
	return checkResult{"ok", "OTP bypass setting", "`qa_otp_bypass_phones` configurado", ""}
}

func checkBackendHTTP(apiBaseURL string) checkResult {
	url := strings.TrimRight(apiBaseURL, "/") + "/"
	status, err := httpProbe("GET", url, nil)
	if err != nil {
		return checkResult{"fail", "Backend HTTP", fmt.Sprintf("%s no respondió (%s)", url, truncate(err.Error(), 60)),
			"cd ~/Desktop/CREDITOP/github/legacy-backend && make up && make restart"}
	}
	// Cualquier respuesta HTTP (incluso 404) significa que el backend está vivo.
	return checkResult{"ok", "Backend HTTP", fmt.Sprintf("%s respondió %d", url, status), ""}
}

func checkOnboardingResponds(apiBaseURL string) checkResult {
	url := strings.TrimRight(apiBaseURL, "/") + "/onboarding/phone/register"
	probePhone := fmt.Sprintf("30%08d", time.Now().UnixNano()/1e6%100000000)
	body := []byte(fmt.Sprintf(`{"phone_number":%q,"otp_length":4,"terms":true,"policies":true}`, probePhone))
	status, err := httpProbe("POST", url, body)
	if err != nil {
		return checkResult{"warn", "Onboarding drivers", "no pudo probarse: " + truncate(err.Error(), 60), ""}
	}
	if status >= 200 && status < 300 {
		return checkResult{"ok", "Onboarding drivers", fmt.Sprintf("phone/register OK (probe %s)", probePhone), ""}
	}
	return checkResult{"fail", "Onboarding drivers", fmt.Sprintf("phone/register devolvió %d (drivers no fake o bug)", status),
		"cd ~/Desktop/CREDITOP/github/legacy-backend && make mock-all && make restart"}
}

func checkLegacyStash() checkResult {
	path := legacyBackendPath()
	if _, err := os.Stat(path); err != nil {
		return checkResult{"warn", "legacy-backend stash", "repo no encontrado en " + path, ""}
	}
	stashOut, err := exec.Command("git", "-C", path, "stash", "list").Output()
	if err != nil {
		return checkResult{"warn", "legacy-backend stash", "no pudo listarse", ""}
	}
	stashes := 0
	for _, l := range strings.Split(string(stashOut), "\n") {
		if strings.TrimSpace(l) != "" {
			stashes++
		}
	}
	diffOut, _ := exec.Command("git", "-C", path, "diff", "--stat").Output()
	modified := strings.Count(string(diffOut), "|")
	if stashes == 0 && modified == 0 {
		return checkResult{"warn", "legacy-backend stash", "no hay stashes guardados ni cambios uncommitted (¿faltan los bypasses?)",
			"ver hallazgos-backend.md sección guards locales"}
	}
	if modified > 0 {
		return checkResult{"ok", "legacy-backend stash", fmt.Sprintf("%d archivos con cambios (bypasses aplicados)", modified), ""}
	}
	return checkResult{"warn", "legacy-backend stash", fmt.Sprintf("%d stash(es) guardados pero working tree limpio (¿aplicar?)", stashes),
		fmt.Sprintf("cd %s && git stash apply (verifica antes con git stash show -p)", path)}
}

func checkCognitoFile() checkResult {
	path := filepath.Join(frontendE2EPath(), ".cognito.json")
	if _, err := os.Stat(path); err == nil {
		return checkResult{"ok", ".cognito.json", "presente en frontend-e2e", ""}
	}
	return checkResult{"warn", ".cognito.json", "no encontrado (solo necesario para tests UI con Cognito)",
		"crear " + path + " con { user, pass } de cuenta merchant Cognito"}
}

// httpProbe hace un request con timeout corto + el vhost Host del legacy local. Devuelve el
// status HTTP (cualquier código, incluso >=400, es "vivo"); error solo si no se pudo conectar.
func httpProbe(method, url string, body []byte) (int, error) {
	var reader *strings.Reader
	if body != nil {
		reader = strings.NewReader(string(body))
	}
	var req *http.Request
	var err error
	if reader != nil {
		req, err = http.NewRequest(method, url, reader)
	} else {
		req, err = http.NewRequest(method, url, nil)
	}
	if err != nil {
		return 0, err
	}
	if client.Host != "" {
		req.Host = client.Host
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	c := &http.Client{Timeout: 4 * time.Second}
	resp, err := c.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	return resp.StatusCode, nil
}

func truncate(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}

// ── Formateador humano ─────────────────────────────────────────────────────

func formatChecks(checks []checkResult, color bool) string {
	c := ansi{color}
	icon := func(s string) string {
		switch s {
		case "ok":
			return c.green("✓")
		case "fail":
			return c.red("✗")
		default:
			return c.yellow("⚠")
		}
	}
	namePad := 0
	for _, ch := range checks {
		if len(ch.Name) > namePad {
			namePad = len(ch.Name)
		}
	}
	var b strings.Builder
	fmt.Fprintf(&b, "%s\n\n", c.bold("Diagnóstico del setup local:"))
	var ok, fail, warn int
	for _, ch := range checks {
		fmt.Fprintf(&b, "%s %-*s  %s\n", icon(ch.Status), namePad, ch.Name, ch.Message)
		if ch.Status != "ok" && ch.Fix != "" {
			fmt.Fprintf(&b, "  %s %s\n", c.gray("FIX:"), c.gray(ch.Fix))
		}
		switch ch.Status {
		case "ok":
			ok++
		case "fail":
			fail++
		case "warn":
			warn++
		}
	}
	summary := fmt.Sprintf("%d/%d OK", ok, len(checks))
	if fail > 0 {
		summary += fmt.Sprintf(" · %d fail", fail)
	}
	if warn > 0 {
		summary += fmt.Sprintf(" · %d warn", warn)
	}
	if fail > 0 {
		summary = c.red(summary)
	} else if warn > 0 {
		summary = c.yellow(summary)
	} else {
		summary = c.green(summary)
	}
	fmt.Fprintf(&b, "\n%s", summary)
	return b.String()
}
