package database

import (
	"creditop-tests/pkg/client"
	"creditop-tests/pkg/config"
	"database/sql"
	"fmt"

	_ "github.com/go-sql-driver/mysql"
)

func Connect(cfg config.TestConfig) *sql.DB {
	dsn := fmt.Sprintf("%s:%s@tcp(%s:%s)/%s?parseTime=true", cfg.DBUser, cfg.DBPass, cfg.DBHost, cfg.DBPort, cfg.DBName)
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		client.FatalError("Error conectando a DB", err, nil)
	}
	return db
}

func AssertRowExists(db *sql.DB, table string, condition string, args ...interface{}) bool {
	var count int
	query := fmt.Sprintf("SELECT COUNT(*) FROM %s WHERE %s", table, condition)
	err := db.QueryRow(query, args...).Scan(&count)
	if err != nil {
		return false
	}
	return count > 0
}

func Clean(db *sql.DB, phone, doc, email string) {
	tx, _ := db.Begin()
	tx.Exec("SET FOREIGN_KEY_CHECKS = 0")

	userIDsQuery := "SELECT id FROM users WHERE cell_phone = ? OR document_number = ? OR email = ?"

	// Capturar ANTES de borrar: los ecommerce_requests de ESTE usuario (por su user_request, directo
	// o vía la tabla de enlace). Reemplaza el viejo `DELETE ... WHERE id > 0` (bulk PROHIBIDO en todo
	// target): se borran SOLO los del usuario, uno a uno por id.
	reqSel := "SELECT id FROM user_requests WHERE user_id IN (" + userIDsQuery + ")"
	ecomIDs := scanInts(tx,
		"SELECT id FROM ecommerce_requests WHERE user_request_id IN ("+reqSel+") "+
			"UNION SELECT ecommerce_request_id FROM user_requests_by_ecommerce_request WHERE user_request_id IN ("+reqSel+")",
		phone, doc, email, phone, doc, email)

	tables := []string{
		"confirmation_email_logs", "lender_transactions", "user_request_products",
		"user_request_modes", "user_request_device_infos", "user_requests",
		"risk_central_user_data", "user_summaries", "user_field_values",
		"creditop_x_consents", "revolving_credits", "promissory_notes",
		"otps", "logs", "twilio_logs", "users",
		"creditop_x_user_requests_records", "creditop_x_revolving_credits",
		"user_requests_by_ecommerce_request", "ecommerce_requests",
	}

	for _, table := range tables {
		switch table {
		case "users":
			tx.Exec(fmt.Sprintf("DELETE FROM %s WHERE cell_phone = ? OR document_number = ? OR email = ?", table), phone, doc, email)
		case "otps":
			tx.Exec("DELETE FROM otps WHERE cell_phone = ?", phone)
		case "ecommerce_requests":
			for _, id := range ecomIDs { // uno a uno, por id — NUNCA bulk
				tx.Exec("DELETE FROM ecommerce_requests WHERE id = ?", id)
			}
		default:
			tx.Exec(fmt.Sprintf("DELETE FROM %s WHERE user_id IN (%s)", table, userIDsQuery), phone, doc, email)
		}
	}
	tx.Exec("SET FOREIGN_KEY_CHECKS = 1")
	tx.Commit()
}

// scanInts corre una query dentro del tx y devuelve la 1ª columna como []int (best-effort).
// Drena y cierra los rows antes de volver (para no chocar con los Exec siguientes del mismo tx).
func scanInts(tx *sql.Tx, q string, args ...any) []int {
	rows, err := tx.Query(q, args...)
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

func Migrations(db *sql.DB) {
	db.Exec("SET FOREIGN_KEY_CHECKS = 0")

	schemaQueries := []string{
		`CREATE TABLE IF NOT EXISTS countries (id INT PRIMARY KEY, name VARCHAR(100), iso_code_1 VARCHAR(5), currency VARCHAR(5), locale VARCHAR(10), phone_code VARCHAR(10))`,
		`CREATE TABLE IF NOT EXISTS lender_paths (id INT PRIMARY KEY, name VARCHAR(100))`,
		`CREATE TABLE IF NOT EXISTS settings (id INT AUTO_INCREMENT PRIMARY KEY, code VARCHAR(100), ` + "`key`" + ` VARCHAR(100), value TEXT, country_id INT)`,
		`CREATE TABLE IF NOT EXISTS allieds (id INT PRIMARY KEY, name VARCHAR(100), slug VARCHAR(100), hash VARCHAR(100), country_id INT, status INT, have_ctopx INT, allied_caterogy_id INT)`,
		`CREATE TABLE IF NOT EXISTS allied_branches (id INT PRIMARY KEY, allied_id INT, name VARCHAR(100), slug VARCHAR(100), hash VARCHAR(100), status INT, country_city_id INT, have_ctopx INT DEFAULT 0)`,
		`CREATE TABLE IF NOT EXISTS lenders (id INT PRIMARY KEY, name VARCHAR(100), slug VARCHAR(100), status INT, country_id INT, response_type INT, lender_path_id INT, action VARCHAR(255), originator_nit VARCHAR(50))`,
		`CREATE TABLE IF NOT EXISTS lenders_by_allieds (lender_id INT, allied_id INT, iva INT, status INT, guarantee_fund_percentage DECIMAL(5,2), administrative_costs_percentage DECIMAL(5,2), PRIMARY KEY (lender_id, allied_id))`,
		`CREATE TABLE IF NOT EXISTS lenders_by_allied_branches (lender_id INT, allied_branch_id INT, PRIMARY KEY (lender_id, allied_branch_id))`,
		`CREATE TABLE IF NOT EXISTS credit_lines (id INT PRIMARY KEY, name VARCHAR(100), slug VARCHAR(100), country_id INT, status INT)`,
		`CREATE TABLE IF NOT EXISTS credit_line_by_lenders (lender_id INT, credit_line_id INT, rate DECIMAL(5,2), rate_suffix VARCHAR(50), min_fee_number INT, max_fee_number INT, fee_numbers VARCHAR(100), min_amount INT, max_amount INT, status INT, PRIMARY KEY (lender_id, credit_line_id))`,
		`CREATE TABLE IF NOT EXISTS user_requests (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT, allied_id INT, lender_id INT, credit_line_id INT, user_request_status_id INT, status INT, rate DECIMAL(5,2), fee_number INT, initial_fee INT, allied_branch_id INT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, request_number VARCHAR(100), amount DECIMAL(15,2), original_amount DECIMAL(15,2), final_amount DECIMAL(15,2))`,
		`CREATE TABLE IF NOT EXISTS otps (id INT AUTO_INCREMENT PRIMARY KEY, cell_phone VARCHAR(20), otp_code VARCHAR(10), validated INT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
		`CREATE TABLE IF NOT EXISTS creditop_x_user_requests_process_statuses (id INT PRIMARY KEY, name VARCHAR(100))`,
		`CREATE TABLE IF NOT EXISTS creditop_x_user_requests_records (id INT AUTO_INCREMENT PRIMARY KEY, user_request_id INT, user_id INT, allied_branch_id INT, creditop_x_user_requests_process_statuses_id INT, status INT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)`,
		`CREATE TABLE IF NOT EXISTS lender_users_categories (id INT PRIMARY KEY, lender_id INT, name VARCHAR(100), min_score INT, max_score INT, rate DECIMAL(5,2), FGA DECIMAL(5,2), min_initial_fee DECIMAL(5,2), max_fee_number INT, loan_limit INT)`,
		`CREATE TABLE IF NOT EXISTS lender_datacredito_rules (id INT AUTO_INCREMENT PRIMARY KEY, allied_branch_id INT, lender_id INT, score INT, current_dues INT, time_finance_sector INT, negative_historical_last_12_months INT, consulted_last_6_months INT, allow_0_score INT, status INT)`,
		`CREATE TABLE IF NOT EXISTS creditop_x_revolving_credits (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT, lender_id INT, status INT, installment_amount INT, fga INT, approved_limit INT, used_limit INT)`,
		`CREATE TABLE IF NOT EXISTS creditop_x_consents (id INT AUTO_INCREMENT PRIMARY KEY, user_request_id INT, user_id INT, otp_id INT, creditop_x_consent_type_id INT, creditop_x_revolving_credit_id INT, consent_url TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
		`CREATE TABLE IF NOT EXISTS ecommerce_requests (id INT AUTO_INCREMENT PRIMARY KEY, order_key VARCHAR(100), user_request_id INT, processed INT DEFAULT 0)`,
		`CREATE TABLE IF NOT EXISTS user_requests_by_ecommerce_request (id INT AUTO_INCREMENT PRIMARY KEY, user_request_id INT, ecommerce_request_id INT)`,
		`CREATE TABLE IF NOT EXISTS user_field_values (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT, user_request_id INT, field_id INT, form_id INT, value VARCHAR(255), status INT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
		`CREATE TABLE IF NOT EXISTS product_categories (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100), slug VARCHAR(100), status INT)`,
		`CREATE TABLE IF NOT EXISTS products (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255), brand VARCHAR(100), model VARCHAR(100), product_category_id INT, status INT, requires_imei INT, allied_id INT, initial_fee DECIMAL(15,2), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)`,
		`CREATE TABLE IF NOT EXISTS user_request_products (id INT AUTO_INCREMENT PRIMARY KEY, user_request_id INT, product_id INT, imei VARCHAR(100), quantity INT, amount DECIMAL(15,2), initial_fee DECIMAL(15,2))`,
	}

	for _, q := range schemaQueries {
		db.Exec(q)
	}

	db.Exec("ALTER TABLE lenders ADD COLUMN action VARCHAR(255)")
	db.Exec("ALTER TABLE lenders ADD COLUMN originator_nit VARCHAR(50)")
	db.Exec("ALTER TABLE allied_branches ADD COLUMN have_ctopx INT DEFAULT 0")
	db.Exec("ALTER TABLE products ADD COLUMN brand VARCHAR(100) AFTER name")
	db.Exec("ALTER TABLE products ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP")
	db.Exec("ALTER TABLE products ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP")

	dataQueries := []string{
		`INSERT IGNORE INTO product_categories (id, name, slug, status) VALUES (1, 'Celulares', 'celulares', 1)`,
		`INSERT IGNORE INTO countries (id, name, iso_code_1, currency, locale, phone_code) VALUES (1, 'Colombia', 'CO', 'COP', 'es_CO', '+57'), (60, 'República Dominicana', 'DO', 'DOP', 'es_DO', '+1')`,
		`INSERT IGNORE INTO lender_paths (id, name) VALUES (1, 'DEFAULT'), (2, 'IMEI')`,
		`REPLACE INTO settings (code, ` + "`key`" + `, value, country_id) VALUES ('setting', 'mobile_onboarding_settings', '{"mock_rules": {"enable": false}}', 1), ('setting', 'corbeta_allieds', '[209, 210, 211, 32]', 1), ('setting', 'personal_info_settings', '{"rate_limit_rules": {"store_personal_info_max_requests_per_hour": 100}}', 1)`,
		`REPLACE INTO allieds (id, name, slug, hash, country_id, status, have_ctopx) VALUES (209, 'Corbeta / Alkosto', 'corbeta', 'corbeta-ally-hash', 1, 1, 1), (94, 'Pullman', 'pullman', 'pullman-ally-hash', 1, 1, 0), (1, 'Standard Store', 'std', 'standard-ally-hash', 1, 1, 0), (32, 'Allied 32', 'a32', 'hash32', 1, 1, 0)`,
		`REPLACE INTO allied_branches (id, allied_id, name, slug, hash, status, country_city_id) VALUES (209, 209, 'Alkosto Venecia', 'alkosto-venecia', '01a0d6a3', 1, 1), (94, 94, 'Pullman Norte', 'pullman-norte', 'pullman-branch-hash', 1, 1), (1, 1, 'Std Branch', 'std-branch', 'standard-branch-hash', 1, 1)`,
		`REPLACE INTO lenders (id, name, slug, status, country_id, response_type, lender_path_id, action, originator_nit) VALUES (160, 'Creditop X Core', 'ctop-x', 1, 1, 2, 1, 'App\\Actions\\Lenders\\CreditopCash', '901329011-3'), (68, 'Bancolombia BNPL', 'bnpl', 1, 1, 1, 1, '', ''), (100, 'Bancolombia Consumo', 'consumo', 1, 1, 1, 1, '', ''), (24, 'Credifamilia', 'credifamilia', 1, 1, 1, 1, 'App\\Actions\\Lenders\\Credifamilia', '')`,
		`INSERT IGNORE INTO creditop_x_user_requests_process_statuses (id, name) VALUES (4, 'INICIO PERFILAMIENTO'), (5, 'VISTA ENTIDADES'), (11, 'APROBADO')`,
		`REPLACE INTO lender_users_categories (id, lender_id, name, min_score, max_score, rate, FGA, min_initial_fee, max_fee_number, loan_limit) VALUES (1, 160, 'ORO', 0, 999, 2.1, 10, 0, 12, 10000000)`,
	}

	tx, _ := db.Begin()
	for _, q := range dataQueries {
		tx.Exec(q)
	}
	tx.Commit()

	db.Exec("SET FOREIGN_KEY_CHECKS = 1")
}
