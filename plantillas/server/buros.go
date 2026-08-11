package main

import (
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"regexp"
	"sort"
	"strings"
)

// LA CONVENCIÓN, y una guarda que la obliga: claves en INGLÉS, camelCase, sin guiones
// bajos y sin prefijos redundantes (`docType`, no `documento_tipo` ni `document_type`).
// Es la misma forma que ya usa la capa de datos real —`approximate_real_salary` aparte,
// las APIs y los mappers de pdf-mapper son camelCase— y la que evita que dentro de tres
// meses convivan `salario_mensual`, `monthly_income` y `monthlyIncome` como si fueran
// tres cosas distintas.
var claveValida = regexp.MustCompile(`^[a-z][a-zA-Z0-9]*$`)

// Los burós dejan de ser "APIs que devuelven datos" y pasan a ser un CONTRATO:
// qué necesito para llamarlo (entrada) y qué me devuelve (salida), los dos escritos
// en las claves del MISMO diccionario.
//
// Con eso se puede preguntar al revés —«¿quién me da salario_mensual?»— en vez de
// tener que saber de antemano a quién llamar; que es lo que hoy está cableado en el
// código (la cascada de `getSalary`).
//
// Igual que un mapper de pdf-mapper-service: un documento declarativo, con una sola
// fuente, en vez de lógica repartida.

const esquemaBuros = `
CREATE TABLE IF NOT EXISTS claves (
  clave TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  tipo  TEXT NOT NULL,
  grupo TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS proveedores (
  proveedor TEXT PRIMARY KEY,
  rol       TEXT NOT NULL,
  entrada   TEXT NOT NULL,  -- JSON: ["docType", …] claves del diccionario
  salida    TEXT NOT NULL   -- JSON: ["monthlyIncome", …] claves del diccionario
);
`

// EL DICCIONARIO. Una clave, una fila: es el punto de todo esto. Los `tipo` y `grupo`
// salen del mapeo real (`docs/codigo/mapeo-datos-buros.json`, hoy solo en git).
var claves = []struct{ clave, label, tipo, grupo string }{
	{"docType", "Tipo de documento", "enum", "identidad"},
	{"docNumber", "Número de documento", "texto", "identidad"},
	{"firstName", "Primer nombre", "texto", "identidad"},
	{"middleName", "Segundo nombre", "texto", "identidad"},
	{"lastName", "Primer apellido", "texto", "identidad"},
	{"secondLastName", "Segundo apellido", "texto", "identidad"},
	{"fullName", "Nombre completo", "texto", "identidad"},
	{"age", "Edad", "numero", "identidad"},
	{"gender", "Género", "enum", "identidad"},

	{"monthlyIncome", "Ingreso mensual estimado", "money", "ingreso"},
	{"incomeMin", "Ingreso estimado (límite inferior)", "money", "ingreso"},
	{"incomeMax", "Ingreso estimado (límite superior)", "money", "ingreso"},
	{"contributionBase", "Ingreso Base de Cotización por mes", "lista", "ingreso"},
	{"lastPayment", "Valor del último pago", "money", "ingreso"},
	{"lowestPayment", "Valor del menor pago", "money", "ingreso"},
	{"fixedExpenses", "Gastos fijos estimados", "money", "ingreso"},
	{"incomeStats", "Estadísticas de ingreso (Mareigua)", "objeto", "ingreso"},

	{"employmentStatus", "Situación laboral / ocupación", "enum", "empleo"},
	{"employerName", "Nombre del empleador o aportante", "texto", "empleo"},
	{"employerTaxId", "NIT del empleador o aportante", "texto", "empleo"},
	{"employmentContinuity", "Continuidad laboral (3/6/12 meses)", "bool", "empleo"},
	{"socialSecurity", "AFP / EPS", "texto", "empleo"},
	{"educationLevel", "Nivel educativo", "texto", "empleo"},
	{"publicServant", "Servidor público o contratos con el Estado", "bool", "empleo"},

	{"declaredNegativeReports", "¿Reportes negativos? (AUTO-DECLARADO)", "enum", "declarado"},
}

// LOS CONTRATOS. `salida` sale del mapeo real (qué campo declara a cada proveedor en
// su `presente_en`).
//
// ⚠ `entrada` es lo ÚNICO acá que NO está verificado contra el código: el mapeo viejo
// nunca declaró qué pide cada proveedor para responder. Está sembrada con el mínimo
// razonable —documento + nombre— y hay que confirmarla contra `pre-approvals-service`
// antes de creerle. Es la mitad más valiosa (es la que permite encadenar) y es la que
// falta comprobar.
var proveedores = []struct {
	proveedor, rol string
	entrada        []string
	salida         []string
}{
	{"agildata", "ingreso + empleo (seguridad social)",
		[]string{"docType", "docNumber", "firstName", "lastName"},
		[]string{"docType", "docNumber", "fullName", "age", "gender",
			"monthlyIncome", "contributionBase", "lastPayment", "lowestPayment", "fixedExpenses",
			"employmentStatus", "employerName", "employerTaxId", "employmentContinuity",
			"declaredNegativeReports"}},

	{"mareigua", "ingreso + empleo (fallback de agildata)",
		[]string{"docType", "docNumber", "firstName", "lastName"},
		[]string{"docType", "docNumber", "firstName", "middleName",
			"lastName", "secondLastName", "age", "gender", "monthlyIncome",
			"incomeStats", "lastPayment", "lowestPayment", "fixedExpenses",
			"employmentStatus", "employerName", "employerTaxId", "employmentContinuity",
			"socialSecurity", "educationLevel", "publicServant", "declaredNegativeReports"}},

	{"quanto", "estimación de ingreso (Experian)",
		[]string{"docType", "docNumber", "firstName", "lastName"},
		[]string{"monthlyIncome", "incomeMin", "incomeMax",
			"employmentStatus", "declaredNegativeReports"}},
}

func abrirBuros(db *sql.DB) {
	// Se rehace en cada arranque: es 100% semilla, igual que el catálogo.
	db.Exec(`DROP TABLE IF EXISTS claves`)
	db.Exec(`DROP TABLE IF EXISTS proveedores`)
	if _, err := db.Exec(esquemaBuros); err != nil {
		log.Fatalf("esquema buros: %v", err)
	}
	for _, c := range claves {
		if !claveValida.MatchString(c.clave) {
			log.Fatalf("la clave %q no sigue la convención (inglés, camelCase, sin guiones bajos)", c.clave)
		}
		if _, err := db.Exec(`INSERT INTO claves (clave, label, tipo, grupo) VALUES (?,?,?,?)`,
			c.clave, c.label, c.tipo, c.grupo); err != nil {
			// PRIMARY KEY: si alguien repite una clave, el diccionario deja de ser uno.
			log.Fatalf("clave duplicada en el diccionario: %q (%v)", c.clave, err)
		}
	}

	// LA GUARDA que hace que esto sirva: ningún proveedor puede nombrar una clave que
	// no esté en el diccionario. Sin esto, cada proveedor vuelve a inventar su propio
	// vocabulario y el diccionario se convierte en decoración.
	conocidas := map[string]bool{}
	for _, c := range claves {
		conocidas[c.clave] = true
	}
	for _, p := range proveedores {
		for _, lista := range [][]string{p.entrada, p.salida} {
			for _, k := range lista {
				if !conocidas[k] {
					log.Fatalf("el proveedor %q nombra la clave %q, que no está en el diccionario", p.proveedor, k)
				}
			}
		}
		ent, _ := json.Marshal(p.entrada)
		sal, _ := json.Marshal(p.salida)
		db.Exec(`INSERT INTO proveedores (proveedor, rol, entrada, salida) VALUES (?,?,?,?)`,
			p.proveedor, p.rol, string(ent), string(sal))
	}
}

type contrato struct {
	Proveedor string   `json:"proveedor"`
	Rol       string   `json:"rol"`
	Entrada   []string `json:"entrada"`
	Salida    []string `json:"salida"`
}

func (s *srv) contratos() ([]contrato, error) {
	filas, err := s.db.Query(`SELECT proveedor, rol, entrada, salida FROM proveedores ORDER BY proveedor`)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	out := []contrato{}
	for filas.Next() {
		var c contrato
		var ent, sal string
		if filas.Scan(&c.Proveedor, &c.Rol, &ent, &sal) == nil {
			json.Unmarshal([]byte(ent), &c.Entrada)
			json.Unmarshal([]byte(sal), &c.Salida)
			out = append(out, c)
		}
	}
	return out, nil
}

func (s *srv) verClaves(w http.ResponseWriter, r *http.Request) {
	filas, err := s.db.Query(`SELECT clave, label, tipo, grupo FROM claves ORDER BY grupo, clave`)
	if err != nil {
		errorJSON(w, 500, "no se pudo leer el diccionario")
		return
	}
	defer filas.Close()
	type cl struct {
		Clave string `json:"clave"`
		Label string `json:"label"`
		Tipo  string `json:"tipo"`
		Grupo string `json:"grupo"`
	}
	out := []cl{}
	for filas.Next() {
		var c cl
		if filas.Scan(&c.Clave, &c.Label, &c.Tipo, &c.Grupo) == nil {
			out = append(out, c)
		}
	}
	responder(w, 200, out)
}

func (s *srv) verProveedores(w http.ResponseWriter, r *http.Request) {
	cs, err := s.contratos()
	if err != nil {
		errorJSON(w, 500, "no se pudieron leer los proveedores")
		return
	}
	responder(w, 200, cs)
}

// quienDa es la pregunta invertida, y es el punto de todo esto: en vez de «llamá a
// agildata y sacá el salario», es «¿quién me da salario_mensual, y qué le tengo que
// pasar?».
func (s *srv) quienDa(w http.ResponseWriter, r *http.Request) {
	clave := r.PathValue("clave")
	var existe int
	if s.db.QueryRow(`SELECT COUNT(*) FROM claves WHERE clave = ?`, clave).Scan(&existe); existe == 0 {
		errorJSON(w, 404, "esa clave no está en el diccionario")
		return
	}
	cs, err := s.contratos()
	if err != nil {
		errorJSON(w, 500, "no se pudieron leer los proveedores")
		return
	}
	quienes := []contrato{}
	for _, c := range cs {
		if contiene(c.Salida, clave) {
			quienes = append(quienes, c)
		}
	}
	responder(w, 200, map[string]any{"clave": clave, "la_dan": quienes})
}

// plan contesta lo operativo: teniendo estas claves en mano, ¿a quién puedo llamar YA
// para conseguir la que quiero, y a quién no y por qué falta.
//
//	GET /api/plan?quiero=ingreso_mensual&tengo=documento_tipo,documento_numero
func (s *srv) plan(w http.ResponseWriter, r *http.Request) {
	quiero := r.URL.Query().Get("quiero")
	if quiero == "" {
		errorJSON(w, 400, "falta ?quiero=<clave>")
		return
	}
	tengo := map[string]bool{}
	for _, k := range strings.Split(r.URL.Query().Get("tengo"), ",") {
		if k = strings.TrimSpace(k); k != "" {
			tengo[k] = true
		}
	}

	cs, err := s.contratos()
	if err != nil {
		errorJSON(w, 500, "no se pudieron leer los proveedores")
		return
	}

	type opcion struct {
		Proveedor string   `json:"proveedor"`
		Listo     bool     `json:"listo"`
		Faltan    []string `json:"faltan"`
	}
	opciones := []opcion{}
	for _, c := range cs {
		if !contiene(c.Salida, quiero) {
			continue
		}
		faltan := []string{}
		for _, k := range c.Entrada {
			if !tengo[k] {
				faltan = append(faltan, k)
			}
		}
		sort.Strings(faltan)
		opciones = append(opciones, opcion{c.Proveedor, len(faltan) == 0, faltan})
	}
	// Los que se pueden llamar ya, primero.
	sort.SliceStable(opciones, func(i, j int) bool { return opciones[i].Listo && !opciones[j].Listo })

	responder(w, 200, map[string]any{
		"quiero": quiero, "tengo": claveSet(tengo), "opciones": opciones,
	})
}

func contiene(xs []string, x string) bool {
	for _, v := range xs {
		if v == x {
			return true
		}
	}
	return false
}

func claveSet(m map[string]bool) []string {
	out := []string{}
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}
