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

// Y el TIPO sale de un set cerrado. `date` todavía no lo usa ninguna clave, pero está
// declarado porque el diccionario tiene que poder decir "esto es una fecha" el día que
// entre una. `boolean`, `list` y `object` están porque el dato REALMENTE es eso —
// aplastarlos a string sería mentir sobre lo que guarda la columna.
var tiposValidos = map[string]bool{
	"string": true, "number": true, "float": true, "date": true,
	"boolean": true, "list": true, "object": true,
}

// LA CLASE dice QUÉ ES el dato, no de qué tipo es. Y no es cosmética: decide si un
// FALLBACK es legal.
//
//   - `atributo`  describe a la persona o su historia (monthlyIncome, creditScore).
//     Se puede tomar de quien lo tenga: por eso una cascada tiene sentido.
//   - `veredicto` es el RESULTADO de una verificación: decide, no describe (amlHit,
//     identityMatch, biometricStatus). No tiene sustituto. Si no corrió, no hay un
//     valor alternativo: hay una AUSENCIA, y una ausencia de veredicto tiene que
//     fallar cerrado. Poner un default acá no es una decisión de negocio, es un bug.
//   - `evidencia` es el respaldo de un veredicto (por qué dio eso). Una regla puede
//     leer un veredicto; no debería ramificar sobre la evidencia.
//   - `artefacto` es algo que el flujo PRODUCE, no que averigua (el pagaré).
//   - `operativo` es metadata de la llamada, no del solicitante (el job de AML).
var clasesValidas = map[string]bool{
	"atributo": true, "veredicto": true, "evidencia": true, "artefacto": true, "operativo": true,
}

// Todo es `atributo` salvo lo que diga acá. Se listan las excepciones y no las 59
// para que agregar una clave no obligue a decidir de nuevo lo obvio — y para que la
// lista de lo que NO es un atributo se lea de un vistazo.
var claseDe = map[string]string{
	"identityMatch":   "veredicto",
	"amlHit":          "veredicto",
	"amlLevel":        "veredicto",
	"biometricStatus": "veredicto",

	"identityFindings": "evidencia",
	"amlDetails":       "evidencia",

	"promissoryNote": "artefacto",

	// ⚠ Clase de uno, y eso es la señal: `amlJob` no es un dato del solicitante, es
	// plumbing de la llamada. Probablemente no debería estar en el diccionario.
	"amlJob": "operativo",
}

func clase(clave string) string {
	if c, ok := claseDe[clave]; ok {
		return c
	}
	return "atributo"
}

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
  grupo TEXT NOT NULL,
  clase TEXT NOT NULL
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
	{"docType", "Tipo de documento", "string", "identidad"},
	{"docNumber", "Número de documento", "string", "identidad"},
	{"firstName", "Primer nombre", "string", "identidad"},
	{"middleName", "Segundo nombre", "string", "identidad"},
	{"lastName", "Primer apellido", "string", "identidad"},
	{"secondLastName", "Segundo apellido", "string", "identidad"},
	{"fullName", "Nombre completo", "string", "identidad"},
	{"age", "Edad", "number", "identidad"},
	{"gender", "Género", "string", "identidad"},

	{"monthlyIncome", "Ingreso mensual estimado", "float", "ingreso"},
	{"incomeMin", "Ingreso estimado (límite inferior)", "float", "ingreso"},
	{"incomeMax", "Ingreso estimado (límite superior)", "float", "ingreso"},
	{"contributionBase", "Ingreso Base de Cotización por mes", "list", "ingreso"},
	{"lastPayment", "Valor del último pago", "float", "ingreso"},
	{"lowestPayment", "Valor del menor pago", "float", "ingreso"},
	{"fixedExpenses", "Gastos fijos estimados", "float", "ingreso"},
	{"incomeStats", "Estadísticas de ingreso (Mareigua)", "object", "ingreso"},

	{"employmentStatus", "Situación laboral / ocupación", "string", "empleo"},
	{"employerName", "Nombre del empleador o aportante", "string", "empleo"},
	{"employerTaxId", "NIT del empleador o aportante", "string", "empleo"},
	{"employmentContinuity", "Continuidad laboral (3/6/12 meses)", "boolean", "empleo"},
	{"socialSecurity", "AFP / EPS", "string", "empleo"},
	{"educationLevel", "Nivel educativo", "string", "empleo"},
	{"publicServant", "Servidor público o contratos con el Estado", "boolean", "empleo"},

	{"declaredNegativeReports", "¿Reportes negativos? (AUTO-DECLARADO)", "boolean", "declarado"},

	{"docIssueDate", "Fecha de expedición del documento", "date", "identidad"},
	{"docIssuePlace", "Lugar de expedición del documento", "string", "identidad"},
	{"docStatus", "Estado del documento en la registraduría", "string", "identidad"},

	{"creditScore", "Score de crédito (0–1000)", "number", "buro"},
	{"inquiries6m", "Consultas al buró en los últimos 6 meses", "number", "buro"},
	{"negativeReports12m", "Reportes negativos en los últimos 12 meses", "number", "buro"},
	{"currentNegativeAccounts", "Créditos con reporte negativo vigente", "number", "buro"},
	{"creditHistorySince", "Inicio de la historia crediticia (maduración)", "date", "buro"},
	{"openDisputes", "Reclamaciones abiertas", "number", "buro"},
	{"totalDisputes", "Reclamaciones históricas", "number", "buro"},
	{"openAccounts", "Créditos vigentes", "number", "buro"},
	{"closedAccounts", "Créditos cerrados", "number", "buro"},
	{"savingsAccounts", "Productos de ahorro reportados", "list", "buro"},
	{"microcreditProfile", "Perfil de microcrédito", "object", "buro"},
	{"inquiryFootprints", "Huellas de consulta dejadas por otros", "list", "buro"},

	{"monthlyDebtPayment", "Cuota mensual de las deudas vigentes", "float", "deuda"},
	{"totalDebt", "Saldo total de deuda", "float", "deuda"},
	{"pastDueBalance", "Saldo en mora", "float", "deuda"},
	{"pastDueByAge", "Saldo en mora por altura de mora", "list", "deuda"},
	{"debtBySector", "Saldo de deuda por sector (banca, real, etc.)", "list", "deuda"},
	{"balanceHistory24m", "Vector de saldos de los últimos 24 meses", "list", "deuda"},
	{"liabilities", "Detalle de pasivos reportados", "list", "deuda"},
	{"creditCards", "Detalle de tarjetas de crédito", "list", "deuda"},
	{"debtTrend", "Evolución de la deuda en el tiempo", "object", "deuda"},

	{"identityMatch", "Coincidencia de identidad (0 no / 1 parcial / 2 total)", "number", "kyc"},
	{"identityFindings", "Hallazgos de la validación de identidad", "list", "kyc"},
	{"amlHit", "¿Aparece en listas restrictivas / AML?", "boolean", "kyc"},
	{"amlLevel", "Nivel del hallazgo AML", "string", "kyc"},
	{"amlDetails", "Detalle de los hallazgos AML", "object", "kyc"},
	{"amlJob", "Job asíncrono de AML (id + estado)", "object", "kyc"},
	{"biometricStatus", "Resultado de la validación biométrica/documental", "string", "kyc"},

	{"promissoryNote", "Pagaré firmado electrónicamente", "object", "formalizacion"},

	// Capturadas en el flujo, no por un proveedor. Están acá porque el diccionario es UNO:
	// si lo que se captura vive en otro vocabulario, el día que un componente pida un dato
	// de buró hay que traducir — y ahí es donde nacen los sinónimos.
	{"phone", "Celular, como lo tipea la persona", "string", "contacto"},
	{"phoneE164", "Celular en formato internacional (+57…)", "string", "contacto"},
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


	{"acierta", "buró Experian: score, comportamiento crediticio y deuda (decisivo para el listado)",
		[]string{"docType", "docNumber", "firstName", "lastName"},
		[]string{"docType", "docNumber", "fullName", "firstName", "lastName", "secondLastName",
			"gender", "age", "docIssueDate", "docIssuePlace", "docStatus", "fixedExpenses",
			"creditScore", "inquiries6m", "negativeReports12m", "currentNegativeAccounts",
			"creditHistorySince", "openDisputes", "totalDisputes", "openAccounts", "closedAccounts",
			"savingsAccounts", "microcreditProfile", "inquiryFootprints",
			"monthlyDebtPayment", "totalDebt", "pastDueBalance", "pastDueByAge", "debtBySector",
			"balanceHistory24m", "liabilities", "creditCards", "debtTrend"}},


	{"tusdatosId", "KYC: validación de identidad contra registraduría (CC/CE)",
		[]string{"docType", "docNumber", "firstName", "lastName"},
		[]string{"fullName", "docIssueDate", "docStatus", "identityMatch", "identityFindings"}},

	{"tusdatosAml", "KYC: background y listas restrictivas (AML)",
		[]string{"docType", "docNumber", "firstName", "lastName"},
		[]string{"amlHit", "amlLevel", "amlDetails", "amlJob"}},

	// ⚠ ADO además necesita una CAPTURA (selfie + foto del documento) que no es una clave
	// del diccionario. Es el límite del modelo: la entrada asume que todo insumo es un dato
	// con nombre, y hay insumos que son un archivo.
	{"ado", "KYC: validación biométrica y documental",
		[]string{"docType", "docNumber"},
		[]string{"docNumber", "biometricStatus"}},

	// ⚠ deceval NO es un buró: firma el pagaré por SOAP. Entra igual porque el modelo
	// —entrada → salida sobre el diccionario— sirve para cualquier servicio externo, no
	// solo para los que devuelven datos de riesgo. Su entrada es la MENOS confiable de
	// todas: no está en el mapeo y no la miré en el código.
	{"deceval", "formalización: firma electrónica del pagaré (SOAP)",
		[]string{"docType", "docNumber", "fullName"},
		[]string{"promissoryNote"}},

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
		if !tiposValidos[c.tipo] {
			log.Fatalf("la clave %q declara el tipo %q, que no está en el set", c.clave, c.tipo)
		}
		if !clasesValidas[clase(c.clave)] {
			log.Fatalf("la clave %q declara la clase %q, que no está en el set", c.clave, clase(c.clave))
		}
		if _, err := db.Exec(`INSERT INTO claves (clave, label, tipo, grupo, clase) VALUES (?,?,?,?,?)`,
			c.clave, c.label, c.tipo, c.grupo, clase(c.clave)); err != nil {
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
	filas, err := s.db.Query(`SELECT clave, label, tipo, grupo, clase FROM claves ORDER BY grupo, clave`)
	if err != nil {
		errorJSON(w, 500, "no se pudo leer el diccionario")
		return
	}
	defer filas.Close()
	// El índice invertido viaja con cada clave: la pregunta "¿quién me la da?" es la que
	// se hace todo el tiempo, y calcularla en el front sería una segunda implementación.
	cs, _ := s.contratos()
	laDan := map[string][]string{}
	for _, c := range cs {
		for _, k := range c.Salida {
			laDan[k] = append(laDan[k], c.Proveedor)
		}
	}

	type cl struct {
		Clave string   `json:"clave"`
		Label string   `json:"label"`
		Tipo  string   `json:"tipo"`
		Grupo string   `json:"grupo"`
		Clase string   `json:"clase"`
		LaDan []string `json:"la_dan"`
	}
	out := []cl{}
	for filas.Next() {
		var c cl
		if filas.Scan(&c.Clave, &c.Label, &c.Tipo, &c.Grupo, &c.Clase) == nil {
			c.LaDan = laDan[c.Clave]
			if c.LaDan == nil {
				c.LaDan = []string{}
			}
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
	var existe int
	s.db.QueryRow(`SELECT COUNT(*) FROM claves WHERE clave = ?`, quiero).Scan(&existe)
	if existe == 0 {
		errorJSON(w, 404, "esa clave no está en el diccionario")
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

	// Acá la CLASE deja de ser informativa. Para un atributo, varias opciones son una
	// cascada: se toma de quien lo tenga. Para un veredicto NO son intercambiables —
	// dos chequeos de listas no se sustituyen entre sí, cubren cosas distintas—, y si
	// no corrió no hay valor alternativo: hay una ausencia, y se falla cerrado.
	cl := clase(quiero)
	res := map[string]any{
		"quiero": quiero, "clase": cl, "tengo": claveSet(tengo), "opciones": opciones,
	}
	if cl == "atributo" {
		res["fallback"] = "permitido: cualquiera de las opciones sirve"
	} else {
		res["fallback"] = "NO permitido: un " + cl + " no tiene sustituto — si no corre, falta, y falta se resuelve cerrado"
	}
	responder(w, 200, res)
}

// planDeSolicitud es el mismo plan, pero leyendo lo que la solicitud YA capturó en vez
// de que el llamador lo pase a mano. Es donde se cierra el círculo: el formulario captura
// claves del diccionario, y con esas claves el sistema sabe solo a qué servicio puede
// llamar. Nadie escribió "para el score llamá a acierta".
func (s *srv) planDeSolicitud(w http.ResponseWriter, r *http.Request) {
	solicitudID := r.PathValue("id")
	sol, err := s.leer(solicitudID)
	if err != nil {
		errorJSON(w, 404, "solicitud no encontrada")
		return
	}
	q := r.URL.Query()
	tengo := make([]string, 0, len(sol.Valores))
	for k := range sol.Valores {
		tengo = append(tengo, k)
	}
	sort.Strings(tengo)
	q.Set("tengo", strings.Join(tengo, ","))
	r.URL.RawQuery = q.Encode()
	s.plan(w, r)
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
