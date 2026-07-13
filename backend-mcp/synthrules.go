package main

import (
	"database/sql"
	"fmt"
	"strconv"
	"strings"
)

// synthReq es el perfil DERIVADO de las reglas (comercio + lender) que el usuario sintético debe tener
// para que lo OFREZCAN. En vez de inyectar valores fijos, leemos las reglas y armamos el perfil mínimo
// que las cumple — genérico para cualquier (comercio, lender).
type synthReq struct {
	fields map[int]string // user_field_values a setear (29 ocupación, 160 reportado, 87 ingreso, …)
	gender string         // users.gender (M)
	age    int            // users.age, dentro del rango que piden las group rules
	income int            // ingreso (field 87) — el mayor umbral `>=` encontrado
	score  int            // datacrédito score — por encima del mayor min_score del lender
}

// resolveLender resuelve un lender por id o nombre, RESTRINGIDO a los que ofrece la sucursal
// (lenders_by_allied_branches) — así "bancolombia" en Samsung resuelve el #68 que el comercio ofrece,
// no otro "Bancolombia" suelto que no aplica.
func resolveLender(db *sql.DB, branchHash, q string) (int, int, string, error) {
	var id, rt int
	var name string
	err := db.QueryRow(
		`SELECT l.id, l.response_type, COALESCE(l.name,'') FROM lenders l
		 JOIN lenders_by_allied_branches lab ON lab.lender_id = l.id
		 JOIN allied_branches ab ON ab.id = lab.allied_branch_id AND ab.hash = ?
		 WHERE l.status = 1 AND (CAST(l.id AS CHAR) = ? OR l.name LIKE ?) ORDER BY l.id LIMIT 1`,
		branchHash, q, "%"+q+"%").Scan(&id, &rt, &name)
	return id, rt, name, err
}

func firstPipe(s string) string {
	if i := strings.IndexByte(s, '|'); i >= 0 {
		return s[:i]
	}
	return s
}

// deriveSynthReq LEE las reglas y deriva el perfil que el usuario debe tener:
//   - capa COMERCIO: group_rules + lender_rules de la sucursal que aplican al lender (ocupación,
//     reportado, ingreso, género, edad).
//   - capa LENDER: min_score de lender_users_category_rules (rt=2) o lender_datacredito_rules (rt=1).
// Arranca de defaults sanos y los AJUSTA según lo que piden las reglas (umbrales `>=`, rangos de edad,
// listas `A|B|C` → primer valor permitido).
func deriveSynthReq(db *sql.DB, branchHash string, lenderID, lenderRT int) synthReq {
	req := synthReq{
		fields: map[int]string{29: "Empleado", 160: "no"},
		gender: "M", age: 35, income: 2_500_000, score: 700,
	}
	var abID int
	db.QueryRow("SELECT id FROM allied_branches WHERE hash = ? LIMIT 1", branchHash).Scan(&abID)

	ageMin, ageMax := 18, 90
	// --- capa comercio: group rules que aplican al lender ---
	rows, err := db.Query("SELECT lr.field_id, COALESCE(lr.specific_table,''), COALESCE(lr.`column`,''), lr.operator, lr.value "+
		"FROM group_rules gr JOIN lender_rules lr ON lr.group_rule_id = gr.id "+
		"WHERE gr.allied_branch_id = ? AND gr.id IN (SELECT group_rule_id FROM lender_rules WHERE lender_id = ?)", abID, lenderID)
	if err == nil {
		for rows.Next() {
			var fid sql.NullInt64
			var tbl, col, op, val string
			rows.Scan(&fid, &tbl, &col, &op, &val)
			op = strings.TrimSpace(op)
			if fid.Valid && fid.Int64 > 0 {
				f := int(fid.Int64)
				switch {
				case f == 87 && (op == ">=" || op == ">"):
					if n, e := strconv.Atoi(strings.TrimSpace(val)); e == nil && n > req.income {
						req.income = n
					}
				case op == "=":
					req.fields[f] = firstPipe(val) // primer valor permitido de la lista A|B|C
				}
			} else if tbl == "users" {
				switch col {
				case "gender":
					req.gender = firstPipe(val) // "M|F" → M
				case "age":
					if n, e := strconv.Atoi(strings.TrimSpace(val)); e == nil {
						if (op == ">=" || op == ">") && n > ageMin {
							ageMin = n
						}
						if (op == "<=" || op == "<") && n < ageMax {
							ageMax = n
						}
					}
				}
			}
		}
		rows.Close()
	}
	// edad: un valor cómodo dentro del rango exigido
	req.age = 35
	if req.age < ageMin {
		req.age = ageMin
	}
	if req.age > ageMax {
		req.age = ageMax
	}
	req.fields[87] = fmt.Sprint(req.income)

	// --- capa lender: mayor min_score que pide ---
	maxMin := 0
	scoreQ := "SELECT min_score FROM lender_users_category_rules WHERE lender_id = ?"
	args := []any{lenderID}
	if lenderRT != 2 {
		scoreQ = "SELECT score FROM lender_datacredito_rules WHERE lender_id = ? AND (allied_branch_id = ? OR allied_branch_id IS NULL)"
		args = []any{lenderID, abID}
	}
	if srows, e := db.Query(scoreQ, args...); e == nil {
		for srows.Next() {
			var s sql.NullInt64
			srows.Scan(&s)
			if int(s.Int64) > maxMin {
				maxMin = int(s.Int64)
			}
		}
		srows.Close()
	}
	if maxMin+50 > req.score {
		req.score = maxMin + 50 // por encima del umbral más estricto
	}
	return req
}
