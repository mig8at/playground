// clean — borra TODO el namespace de un seed en la BD de desarrollo compartida (asesores +
// clientes + solicitudes + filas hijas + comercios/branches creados por API). Seguro: solo
// matchea filas con el marcador del seed (cognito_id/email '__{seed}_test', allieds 'COM_{seed}',
// branches 'BR_{seed}'). Portado de creditop-cli/src/lib/asesor.ts (cleanNamespace + cleanSession).
//
//	go run . clean [--seed X]    (default: seed de la máquina, igual que prep)
//
// Complementa a `prep`: lo que prep siembra namespaced, clean lo borra. Corre con
// FOREIGN_KEY_CHECKS=0 y es best-effort (no falla si una tabla no existe).

package main

import (
	"creditop-tests/pkg/client"
	"creditop-tests/pkg/config"
	"creditop-tests/pkg/database"
	"creditop-tests/pkg/identity"
	"creditop-tests/pkg/ledger"
	"database/sql"
	"fmt"
	"os"
	"strings"
)

// childTables: filas hijas de una solicitud (mismas que limpia el flujo). users/otps/
// allieds/branches se manejan aparte por su criterio propio.
var childTables = []string{
	"confirmation_email_logs", "lender_transactions", "user_request_products",
	"user_request_modes", "user_request_device_infos", "risk_central_user_data",
	"user_summaries", "user_field_values", "creditop_x_consents",
	"revolving_credits", "promissory_notes", "logs", "twilio_logs",
	"creditop_x_user_requests_records", "creditop_x_revolving_credits",
	"user_requests_by_ecommerce_request",
}

func runClean(args []string) int {
	seed := identity.Seed()
	for i := 0; i < len(args); i++ {
		key, val, hasEq := strings.Cut(args[i], "=")
		if key == "--seed" {
			if hasEq {
				seed = val
			} else if i+1 < len(args) {
				i++
				seed = args[i]
			}
		}
	}

	cfg := config.GetConfig(target)
	// Modificar una BD compartida (dev) exige confirmación explícita (aunque el borrado sea por clave).
	if cfg.IsShared() && os.Getenv("I_KNOW_THIS_TOUCHES_SHARED_DEV") != "1" {
		fmt.Fprintf(os.Stderr, "%s✗ clean --target=%s modifica una BD compartida. Exportá I_KNOW_THIS_TOUCHES_SHARED_DEV=1.%s\n", client.CRed, cfg.Target, client.CReset)
		return 2
	}
	db := database.Connect(cfg)
	defer db.Close()

	like := identity.TestLike(seed) // "{seed}-%-test"

	// Usuarios del namespace: por cognito_id o email (cualquier dominio de comercio).
	asesorIDs := queryIDs(db, "SELECT id FROM users WHERE cognito_id LIKE ? OR email LIKE ?",
		like, like+"@%")
	alliedIDs := queryIDs(db, "SELECT id FROM allieds WHERE name LIKE ?", "COM\\_"+seed+"%")
	branchIDs := queryIDs(db, "SELECT id FROM allied_branches WHERE name LIKE ?", "BR\\_"+seed+"%")

	var reqIDs []int
	if len(asesorIDs) > 0 {
		reqIDs = queryIDs(db, "SELECT id FROM user_requests WHERE corporate_user_id IN ("+placeholders(len(asesorIDs))+")", toAny(asesorIDs)...)
	}

	res := cleanNamespace(db, asesorIDs, reqIDs, alliedIDs, branchIDs)
	fmt.Fprintf(os.Stderr, "✓ namespace %q (%s) limpiado: %d usuarios, %d solicitudes, %d comercios, %d branches\n",
		seed, cfg.Target, res.users, len(reqIDs), len(alliedIDs), len(branchIDs))

	// Ledger: borra UNO A UNO los recursos anotados para este target (idempotente: encuentre el row
	// o no). Sobrevive cerrar la consola — el ledger persiste lo creado entre sesiones.
	led := cleanLedger(db, cfg.Target)
	fmt.Fprintf(os.Stderr, "✓ ledger (%s): %d recursos anotados borrados\n", cfg.Target, led)
	return 0
}

// cleanLedger borra los recursos del ledger para el target dado, uno a uno por clave. DELETE de 0
// filas no falla (idempotente). Las entradas borradas (o no encontradas) salen del ledger; las que
// fallan de verdad (ej. tabla inexistente) o son de otro target se conservan.
func cleanLedger(db *sql.DB, target string) int {
	es, _ := ledger.Load()
	if len(es) == 0 {
		return 0
	}
	db.Exec("SET FOREIGN_KEY_CHECKS = 0")
	var remaining []ledger.Entry
	deleted := 0
	for _, e := range es {
		if e.Target != target {
			remaining = append(remaining, e)
			continue
		}
		// Cascada: si la entrada es un user_request, borrar primero sus filas hijas por
		// user_request_id (evita huérfanos; sigue siendo por clave, nunca bulk).
		if e.Table == "user_requests" {
			for _, t := range childTables {
				db.Exec(fmt.Sprintf("DELETE FROM %s WHERE user_request_id = ?", t), e.KeyVal)
			}
		}
		if _, err := db.Exec(fmt.Sprintf("DELETE FROM `%s` WHERE `%s` = ?", e.Table, e.KeyCol), e.KeyVal); err != nil {
			remaining = append(remaining, e)
			continue
		}
		deleted++
	}
	db.Exec("SET FOREIGN_KEY_CHECKS = 1")
	ledger.Save(remaining)
	return deleted
}

type cleanResult struct{ users int }

func cleanNamespace(db *sql.DB, asesorIDs, reqIDs, alliedIDs, branchIDs []int) cleanResult {
	if len(asesorIDs) == 0 && len(reqIDs) == 0 && len(alliedIDs) == 0 && len(branchIDs) == 0 {
		return cleanResult{}
	}
	exec := func(q string, args ...any) { db.Exec(q, args...) } // best-effort

	db.Exec("SET FOREIGN_KEY_CHECKS = 0")

	// Clientes asociados a las solicitudes (user_requests.user_id) + asesores.
	customerIDs := []int{}
	if len(reqIDs) > 0 {
		customerIDs = queryIDs(db, "SELECT DISTINCT user_id FROM user_requests WHERE id IN ("+placeholders(len(reqIDs))+")", toAny(reqIDs)...)
	}
	allUserIDs := unionInts(asesorIDs, customerIDs)

	// Filas hijas por user_request_id y por user_id.
	for _, t := range childTables {
		if len(reqIDs) > 0 {
			exec(fmt.Sprintf("DELETE FROM %s WHERE user_request_id IN (%s)", t, placeholders(len(reqIDs))), toAny(reqIDs)...)
		}
		if len(allUserIDs) > 0 {
			exec(fmt.Sprintf("DELETE FROM %s WHERE user_id IN (%s)", t, placeholders(len(allUserIDs))), toAny(allUserIDs)...)
		}
	}

	// Solicitudes (por id y por atribución al asesor).
	if len(reqIDs) > 0 {
		exec("DELETE FROM user_requests WHERE id IN ("+placeholders(len(reqIDs))+")", toAny(reqIDs)...)
	}
	if len(asesorIDs) > 0 {
		exec("DELETE FROM user_requests WHERE corporate_user_id IN ("+placeholders(len(asesorIDs))+")", toAny(asesorIDs)...)
	}

	// Usuarios (asesor + cliente) y rol spatie.
	if len(allUserIDs) > 0 {
		exec("DELETE FROM users WHERE id IN ("+placeholders(len(allUserIDs))+")", toAny(allUserIDs)...)
	}
	if len(asesorIDs) > 0 {
		exec("DELETE FROM model_has_roles WHERE model_id IN ("+placeholders(len(asesorIDs))+")", toAny(asesorIDs)...)
	}

	// Comercios/branches creados por acciones de admin.
	if len(branchIDs) > 0 {
		exec("DELETE FROM allied_branches WHERE id IN ("+placeholders(len(branchIDs))+")", toAny(branchIDs)...)
	}
	if len(alliedIDs) > 0 {
		exec("DELETE FROM allied_branches WHERE allied_id IN ("+placeholders(len(alliedIDs))+")", toAny(alliedIDs)...)
		exec("DELETE FROM allieds WHERE id IN ("+placeholders(len(alliedIDs))+")", toAny(alliedIDs)...)
	}

	db.Exec("SET FOREIGN_KEY_CHECKS = 1")
	return cleanResult{users: len(allUserIDs)}
}

// ── helpers ──────────────────────────────────────────────────────────────────

func queryIDs(db *sql.DB, q string, args ...any) []int {
	rows, err := db.Query(q, args...)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []int
	for rows.Next() {
		var id int
		if rows.Scan(&id) == nil && id > 0 {
			out = append(out, id)
		}
	}
	return out
}

func placeholders(n int) string {
	if n <= 0 {
		return "NULL"
	}
	return strings.TrimSuffix(strings.Repeat("?, ", n), ", ")
}

func toAny(ids []int) []any {
	out := make([]any, len(ids))
	for i, v := range ids {
		out[i] = v
	}
	return out
}

func unionInts(a, b []int) []int {
	seen := map[int]bool{}
	var out []int
	for _, v := range append(append([]int{}, a...), b...) {
		if !seen[v] {
			seen[v] = true
			out = append(out, v)
		}
	}
	return out
}
