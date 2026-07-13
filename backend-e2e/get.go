// get — inspector read-only de UN recurso. Espejo de `kubectl get` / `gh pr view`.
// Portado de creditop-cli/src/lib/inspect.ts + bin/get.ts.
//
//	go run . get user-request <id> [--json]
//	go run . get merchant <alias>  [--json]   (id/slug/hash-allied/hash-branch/nombre)
//	go run . get lender <alias>    [--json]   (id/slug/nombre)
//
// stdout = datos · stderr = errores. Exit: 0 OK · 1 not found · 2 args inválidos.
// Sin --json: pretty-print con colores ANSI (respeta NO_COLOR). Con --json: contrato
// estable para pipes (jq).

package main

import (
	"creditop-tests/lender"
	"creditop-tests/merchant"
	"creditop-tests/pkg/config"
	"creditop-tests/pkg/database"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"
)

func runGet(args []string) int {
	var positional []string
	asJSON := false
	for _, a := range args {
		if a == "--json" {
			asJSON = true
		} else {
			positional = append(positional, a)
		}
	}
	if len(positional) < 2 {
		fmt.Fprintln(os.Stderr, "uso: go run . get <user-request|merchant|lender> <arg> [--json]")
		return 2
	}
	kind, arg := positional[0], positional[1]
	useColor := os.Getenv("NO_COLOR") != "1"

	db := database.Connect(config.GetConfig(target))
	defer db.Close()

	switch kind {
	case "user-request", "ur", "request":
		var id int
		if _, err := fmt.Sscanf(arg, "%d", &id); err != nil || id <= 0 {
			fmt.Fprintf(os.Stderr, "id inválido para user-request: %q\n", arg)
			return 2
		}
		snap, ok := getUserRequest(db, id)
		if !ok {
			fmt.Fprintf(os.Stderr, "No existe user_request #%d\n", id)
			return 1
		}
		emit(snap, formatUserRequestGo(snap, useColor), asJSON)
	case "merchant", "m":
		snap, ok := getMerchantSnap(db, arg)
		if !ok {
			fmt.Fprintf(os.Stderr, "No existe comercio: %q (probá id, slug, hash de allied/branch o nombre).\n", arg)
			return 1
		}
		emit(snap, formatMerchantGo(snap, useColor), asJSON)
	case "lender", "l":
		snap, ok := getLenderSnap(db, arg)
		if !ok {
			fmt.Fprintf(os.Stderr, "No existe lender: %q (probá id, slug o nombre).\n", arg)
			return 1
		}
		emit(snap, formatLenderGo(snap, useColor), asJSON)
	default:
		fmt.Fprintf(os.Stderr, "kind desconocido: %q (user-request|merchant|lender)\n", kind)
		return 2
	}
	return 0
}

func emit(v any, human string, asJSON bool) {
	if asJSON {
		b, _ := json.MarshalIndent(v, "", "  ")
		fmt.Println(string(b))
	} else {
		fmt.Println(human)
	}
}

// ─── colores / tiempo ────────────────────────────────────────────────────────

type ansi struct{ on bool }

func (c ansi) wrap(code, s string) string {
	if !c.on {
		return s
	}
	return "\033[" + code + "m" + s + "\033[0m"
}
func (c ansi) cyan(s string) string   { return c.wrap("36", s) }
func (c ansi) gray(s string) string   { return c.wrap("90", s) }
func (c ansi) green(s string) string  { return c.wrap("32", s) }
func (c ansi) yellow(s string) string { return c.wrap("33", s) }
func (c ansi) red(s string) string    { return c.wrap("31", s) }
func (c ansi) bold(s string) string   { return c.wrap("1", s) }

func isoUTC(t time.Time) string { return t.UTC().Format("2006-01-02T15:04:05.000Z") }

func timeAgo(t time.Time) string {
	if t.IsZero() {
		return "?"
	}
	d := time.Since(t)
	if d < 0 {
		return "futuro"
	}
	s := int(d.Seconds())
	if s < 60 {
		return fmt.Sprintf("%ds", s)
	}
	m := s / 60
	if m < 60 {
		return fmt.Sprintf("%dm", m)
	}
	h := m / 60
	if h < 24 {
		return fmt.Sprintf("%dh %dm", h, m%60)
	}
	return fmt.Sprintf("%dd %dh", h/24, h%24)
}

// ─── get user-request ────────────────────────────────────────────────────────

type idName struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
}
type customerInfo struct {
	ID             int     `json:"id"`
	FirstName      *string `json:"firstName"`
	Surname        *string `json:"surname"`
	DocumentNumber *string `json:"documentNumber"`
	DocumentType   *string `json:"documentType"`
	Email          *string `json:"email"`
	CellPhone      *string `json:"cellPhone"`
	CognitoID      *string `json:"cognitoId"`
}
type urMerchant struct {
	ID   int     `json:"id"`
	Name string  `json:"name"`
	Slug *string `json:"slug"`
	Hash *string `json:"hash"`
}
type urBranch struct {
	ID   int     `json:"id"`
	Name string  `json:"name"`
	Hash *string `json:"hash"`
}
type urLender struct {
	ID           int     `json:"id"`
	Name         string  `json:"name"`
	ResponseType int     `json:"responseType"`
	Action       *string `json:"action"`
}
type urAsesor struct {
	ID        int     `json:"id"`
	Email     *string `json:"email"`
	CognitoID *string `json:"cognitoId"`
}
type urTx struct {
	ID         int     `json:"id"`
	LenderID   int     `json:"lenderId"`
	StatusID   int     `json:"statusId"`
	StatusName *string `json:"statusName"`
	OrderID    string  `json:"orderId"`
	CreatedAt  string  `json:"createdAt"`
}
type urSnapshot struct {
	ID             int           `json:"id"`
	Amount         float64       `json:"amount"`
	OriginalAmount float64       `json:"originalAmount"`
	FeeNumber      int           `json:"feeNumber"`
	Rate           *float64      `json:"rate"`
	InitialFee     float64       `json:"initialFee"`
	Status         idName        `json:"status"`
	Customer       *customerInfo `json:"customer"`
	Merchant       *urMerchant   `json:"merchant"`
	Branch         *urBranch     `json:"branch"`
	Lender         *urLender     `json:"lender"`
	Asesor         *urAsesor     `json:"asesor"`
	Transactions   []urTx        `json:"transactions"`
	CreatedAt      string        `json:"createdAt"`
	UpdatedAt      string        `json:"updatedAt"`
}

func getUserRequest(db *sql.DB, id int) (urSnapshot, bool) {
	var s urSnapshot
	var (
		userID, alliedID, branchID, lenderID, corpID sql.NullInt64
		statusID                                     sql.NullInt64
		rate                                         sql.NullFloat64
		statusName                                   sql.NullString
		cFirst, cSurname, cDoc, cDocType             sql.NullString
		cEmail, cPhone, cCognito                     sql.NullString
		mName, mSlug, mHash                          sql.NullString
		bName, bHash                                 sql.NullString
		lName                                        sql.NullString
		lRt                                          sql.NullInt64
		lAction                                      sql.NullString
		aEmail, aCognito                             sql.NullString
		createdAt, updatedAt                         time.Time
	)
	err := db.QueryRow(`
		SELECT ur.id, ur.user_id, ur.allied_id, ur.allied_branch_id, ur.lender_id,
		       ur.corporate_user_id, ur.amount, ur.original_amount, ur.fee_number, ur.rate,
		       ur.initial_fee, ur.user_request_status_id, ur.created_at, ur.updated_at,
		       urs.name, u.first_name, u.surname, u.document_number, u.document_type,
		       u.email, u.cell_phone, u.cognito_id,
		       a.name, a.slug, a.hash, ab.name, ab.hash,
		       l.name, l.response_type, l.action, cu.email, cu.cognito_id
		FROM user_requests ur
		LEFT JOIN user_request_statuses urs ON urs.id = ur.user_request_status_id
		LEFT JOIN users u ON u.id = ur.user_id
		LEFT JOIN allieds a ON a.id = ur.allied_id
		LEFT JOIN allied_branches ab ON ab.id = ur.allied_branch_id
		LEFT JOIN lenders l ON l.id = ur.lender_id
		LEFT JOIN users cu ON cu.id = ur.corporate_user_id
		WHERE ur.id = ? LIMIT 1`, id).Scan(
		&s.ID, &userID, &alliedID, &branchID, &lenderID, &corpID,
		&s.Amount, &s.OriginalAmount, &s.FeeNumber, &rate, &s.InitialFee, &statusID,
		&createdAt, &updatedAt, &statusName,
		&cFirst, &cSurname, &cDoc, &cDocType, &cEmail, &cPhone, &cCognito,
		&mName, &mSlug, &mHash, &bName, &bHash,
		&lName, &lRt, &lAction, &aEmail, &aCognito)
	if err != nil {
		return s, false
	}

	s.Status = idName{ID: int(statusID.Int64), Name: nz(statusName, "?")}
	s.Rate = f64ptr(rate)
	s.CreatedAt, s.UpdatedAt = isoUTC(createdAt), isoUTC(updatedAt)
	if userID.Valid {
		s.Customer = &customerInfo{
			ID: int(userID.Int64), FirstName: sptr(cFirst), Surname: sptr(cSurname),
			DocumentNumber: sptr(cDoc), DocumentType: sptr(cDocType),
			Email: sptr(cEmail), CellPhone: sptr(cPhone), CognitoID: sptr(cCognito),
		}
	}
	if alliedID.Valid {
		s.Merchant = &urMerchant{ID: int(alliedID.Int64), Name: nz(mName, ""), Slug: sptr(mSlug), Hash: sptr(mHash)}
	}
	if branchID.Valid {
		s.Branch = &urBranch{ID: int(branchID.Int64), Name: nz(bName, ""), Hash: sptr(bHash)}
	}
	if lenderID.Valid {
		s.Lender = &urLender{ID: int(lenderID.Int64), Name: nz(lName, ""), ResponseType: int(lRt.Int64), Action: sptr(lAction)}
	}
	if corpID.Valid {
		s.Asesor = &urAsesor{ID: int(corpID.Int64), Email: sptr(aEmail), CognitoID: sptr(aCognito)}
	}

	s.Transactions = []urTx{}
	rows, err := db.Query(`
		SELECT lt.id, lt.lender_id, lt.status_id, COALESCE(lt.order_id,''), lt.created_at, lts.name
		FROM lender_transactions lt
		LEFT JOIN lender_transaction_statuses lts ON lts.id = lt.status_id
		WHERE lt.user_request_id = ? ORDER BY lt.id`, id)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var t urTx
			var sName sql.NullString
			var created time.Time
			if rows.Scan(&t.ID, &t.LenderID, &t.StatusID, &t.OrderID, &created, &sName) == nil {
				t.StatusName = sptr(sName)
				t.CreatedAt = isoUTC(created)
				s.Transactions = append(s.Transactions, t)
			}
		}
	}
	return s, true
}

func formatUserRequestGo(s urSnapshot, color bool) string {
	c := ansi{color}
	var b strings.Builder
	p := func(format string, a ...any) { fmt.Fprintf(&b, format, a...) }
	p("%s\n", c.bold(c.cyan(fmt.Sprintf("USER REQUEST #%d", s.ID))))
	if s.Customer != nil {
		p("  %s     %s %s %s\n", c.gray("Cliente:"), ptos(s.Customer.FirstName), ptos(s.Customer.Surname),
			c.gray(fmt.Sprintf("(id %d, %s=%s, %s)", s.Customer.ID, ptos(s.Customer.DocumentType), ptos(s.Customer.DocumentNumber), ptos(s.Customer.Email))))
	} else {
		p("  %s     %s\n", c.gray("Cliente:"), c.gray("—"))
	}
	if s.Merchant != nil {
		p("  %s    %s %s\n", c.gray("Comercio:"), s.Merchant.Name, c.gray(fmt.Sprintf("(allied #%d, hash %s)", s.Merchant.ID, ptos(s.Merchant.Hash))))
	}
	if s.Branch != nil {
		p("  %s      %s %s\n", c.gray("Branch:"), s.Branch.Name, c.gray(fmt.Sprintf("(#%d, hash %s)", s.Branch.ID, ptos(s.Branch.Hash))))
	}
	if s.Lender != nil {
		action := ""
		if s.Lender.Action != nil {
			action = " · " + lastSegment(*s.Lender.Action)
		}
		p("  %s      %s %s\n", c.gray("Lender:"), s.Lender.Name, c.gray(fmt.Sprintf("(#%d, rt=%d%s)", s.Lender.ID, s.Lender.ResponseType, action)))
	} else {
		p("  %s      %s\n", c.gray("Lender:"), c.gray("— sin lender seleccionado"))
	}
	rateStr := ""
	if s.Rate != nil {
		rateStr = fmt.Sprintf(", rate: %g", *s.Rate)
	}
	p("  %s       %s %s\n", c.gray("Monto:"), money(s.Amount), c.gray(fmt.Sprintf("(original: %s, cuotas: %d%s)", money(s.OriginalAmount), s.FeeNumber, rateStr)))
	p("  %s      %s\n", c.gray("Estado:"), fmtState(c, s.Status.ID, s.Status.Name))
	if s.Asesor != nil {
		p("  %s      %s %s\n", c.gray("Asesor:"), ptos(s.Asesor.Email), c.gray(fmt.Sprintf("(corporate_user_id %d, cognito_id %s)", s.Asesor.ID, ptos(s.Asesor.CognitoID))))
	} else {
		p("  %s      %s\n", c.gray("Asesor:"), c.gray("— sin asesor (autogestión)"))
	}
	p("  %s      %s %s\n", c.gray("Creada:"), timeAgoStr(s.CreatedAt), c.gray("("+s.CreatedAt+")"))
	p("  %s %s %s", c.gray("Actualizada:"), timeAgoStr(s.UpdatedAt), c.gray("("+s.UpdatedAt+")"))
	if len(s.Transactions) > 0 {
		p("\n\n%s\n", c.bold(fmt.Sprintf("  TRANSACCIONES (%d):", len(s.Transactions))))
		for i, t := range s.Transactions {
			line := fmt.Sprintf("    lender_transactions #%d · lender %d · status_id=%d %s · order %s · hace %s",
				t.ID, t.LenderID, t.StatusID, c.gray("("+ptosDefault(t.StatusName, "?")+")"), t.OrderID, timeAgoStr(t.CreatedAt))
			if i < len(s.Transactions)-1 {
				line += "\n"
			}
			p("%s", line)
		}
	}
	return b.String()
}

func fmtState(c ansi, id int, name string) string {
	switch id {
	case 11:
		return fmt.Sprintf("%d (%s)", id, c.green(name))
	case 6, 8:
		return fmt.Sprintf("%d (%s)", id, c.yellow(name))
	}
	return fmt.Sprintf("%d (%s)", id, name)
}

// ─── get merchant ────────────────────────────────────────────────────────────

type merchantBranchSample struct {
	ID     int     `json:"id"`
	Name   string  `json:"name"`
	Hash   *string `json:"hash"`
	Status int     `json:"status"`
}
type merchantBranches struct {
	Total  int                    `json:"total"`
	Active int                    `json:"active"`
	Sample []merchantBranchSample `json:"sample"`
}
type merchantSnapshot struct {
	ID            int                `json:"id"`
	Name          string             `json:"name"`
	Slug          *string            `json:"slug"`
	Hash          *string            `json:"hash"`
	Status        int                `json:"status"`
	CountryID     *int               `json:"countryId"`
	HaveCreditopX bool               `json:"haveCreditopX"`
	Kind          string             `json:"kind"`
	Branches      merchantBranches   `json:"branches"`
	OfferedLender []offeredLenderRef `json:"offeredLenders"`
}
type offeredLenderRef struct {
	ID           int    `json:"id"`
	Name         string `json:"name"`
	ResponseType int    `json:"responseType"`
}

func getMerchantSnap(db *sql.DB, query string) (merchantSnapshot, bool) {
	var s merchantSnapshot
	m, err := merchant.Resolve(db, query)
	if err != nil {
		return s, false
	}
	var (
		name, slug, hash sql.NullString
		status           sql.NullInt64
		countryID        sql.NullInt64
		haveCtopx        sql.NullInt64
	)
	err = db.QueryRow("SELECT name, slug, hash, status, country_id, have_ctopx FROM allieds WHERE id = ? LIMIT 1", m.AlliedID).
		Scan(&name, &slug, &hash, &status, &countryID, &haveCtopx)
	if err != nil {
		return s, false
	}
	s.ID = m.AlliedID
	s.Name = nz(name, "")
	s.Slug, s.Hash = sptr(slug), sptr(hash)
	s.Status = int(status.Int64)
	if countryID.Valid {
		v := int(countryID.Int64)
		s.CountryID = &v
	}
	s.HaveCreditopX = haveCtopx.Int64 == 1
	s.Kind = string(m.Kind) // Resolve ya infiere Standard/Corbeta/Pullman/Motai/Ecommerce

	db.QueryRow("SELECT COUNT(*), COALESCE(SUM(status = 1),0) FROM allied_branches WHERE allied_id = ?", m.AlliedID).
		Scan(&s.Branches.Total, &s.Branches.Active)
	s.Branches.Sample = []merchantBranchSample{}
	if rows, err := db.Query("SELECT id, name, hash, status FROM allied_branches WHERE allied_id = ? ORDER BY status DESC, id LIMIT 6", m.AlliedID); err == nil {
		defer rows.Close()
		for rows.Next() {
			var bs merchantBranchSample
			var h sql.NullString
			if rows.Scan(&bs.ID, &bs.Name, &h, &bs.Status) == nil {
				bs.Hash = sptr(h)
				s.Branches.Sample = append(s.Branches.Sample, bs)
			}
		}
	}

	s.OfferedLender = []offeredLenderRef{}
	if rows, err := db.Query(`SELECT lba.lender_id, COALESCE(l.name,''), COALESCE(l.response_type,0)
		FROM lenders_by_allieds lba JOIN lenders l ON l.id = lba.lender_id
		WHERE lba.allied_id = ? AND lba.status = 1 ORDER BY l.name`, m.AlliedID); err == nil {
		defer rows.Close()
		for rows.Next() {
			var o offeredLenderRef
			if rows.Scan(&o.ID, &o.Name, &o.ResponseType) == nil {
				s.OfferedLender = append(s.OfferedLender, o)
			}
		}
	}
	return s, true
}

func formatMerchantGo(s merchantSnapshot, color bool) string {
	c := ansi{color}
	var b strings.Builder
	p := func(format string, a ...any) { fmt.Fprintf(&b, format, a...) }
	p("%s\n", c.bold(c.cyan(fmt.Sprintf("MERCHANT #%d · %s", s.ID, s.Name))))
	p("  %s   %s %s\n", c.gray("Slug/Hash:"), ptosDefault(s.Slug, "—"), c.gray("(hash "+ptosDefault(s.Hash, "—")+")"))
	estado := c.green("activo")
	if s.Status != 1 {
		estado = c.yellow(fmt.Sprintf("inactivo (%d)", s.Status))
	}
	country := "?"
	if s.CountryID != nil {
		country = fmt.Sprint(*s.CountryID)
	}
	p("  %s      %s %s\n", c.gray("Estado:"), estado, c.gray("· país "+country))
	p("  %s        %s\n", c.gray("Kind:"), s.Kind)
	ctopx := c.gray("sin Creditop X")
	if s.HaveCreditopX {
		ctopx = c.green("Creditop X")
	}
	p("  %s       %s\n", c.gray("Flags:"), ctopx)
	p("  %s    %d activos / %d total\n", c.gray("Branches:"), s.Branches.Active, s.Branches.Total)
	for _, br := range s.Branches.Sample {
		dot := "○"
		if br.Status == 1 {
			dot = "●"
		}
		p("    %s #%d %s %s\n", dot, br.ID, br.Name, c.gray("(hash "+ptosDefault(br.Hash, "—")+")"))
	}
	if s.Branches.Total > len(s.Branches.Sample) {
		p("%s\n", c.gray(fmt.Sprintf("    … %d más", s.Branches.Total-len(s.Branches.Sample))))
	}
	p("\n%s\n", c.bold(fmt.Sprintf("  LENDERS OFRECIDOS (%d):", len(s.OfferedLender))))
	if len(s.OfferedLender) == 0 {
		p("%s", c.gray("    — ninguno activo en lenders_by_allieds"))
	}
	for i, o := range s.OfferedLender {
		p("    #%d %s %s", o.ID, o.Name, c.gray(fmt.Sprintf("(rt=%d)", o.ResponseType)))
		if i < len(s.OfferedLender)-1 {
			p("\n")
		}
	}
	return b.String()
}

// ─── get lender ──────────────────────────────────────────────────────────────

type lenderRules struct {
	LenderRules     int `json:"lenderRules"`
	DatacreditoRule int `json:"datacreditoRules"`
}
type lenderOfferedBy struct {
	Merchants int      `json:"merchants"`
	Sample    []string `json:"sample"`
}
type lenderSnapshot struct {
	ID                           int             `json:"id"`
	Name                         string          `json:"name"`
	Slug                         *string         `json:"slug"`
	ResponseType                 int             `json:"responseType"`
	Action                       *string         `json:"action"`
	OriginatorNit                *string         `json:"originatorNit"`
	Status                       int             `json:"status"`
	ValidationType               *string         `json:"validationType"`
	RequiresRestrictiveListCheck bool            `json:"requiresRestrictiveListCheck"`
	Rules                        lenderRules     `json:"rules"`
	OfferedBy                    lenderOfferedBy `json:"offeredBy"`
	Credentials                  int             `json:"credentials"`
}

func getLenderSnap(db *sql.DB, query string) (lenderSnapshot, bool) {
	var s lenderSnapshot
	l, err := lender.Resolve(db, query)
	if err != nil {
		return s, false
	}
	var (
		name, slug, action, nit, valType sql.NullString
		status, restrictive              sql.NullInt64
	)
	err = db.QueryRow(`SELECT name, slug, response_type, action, originator_nit, status,
		validation_type, requires_restrictive_list_check FROM lenders WHERE id = ? LIMIT 1`, l.ID).
		Scan(&name, &slug, &s.ResponseType, &action, &nit, &status, &valType, &restrictive)
	if err != nil {
		return s, false
	}
	s.ID = l.ID
	s.Name = nz(name, "")
	s.Slug, s.Action, s.OriginatorNit, s.ValidationType = sptr(slug), sptr(action), sptr(nit), sptr(valType)
	s.Status = int(status.Int64)
	s.RequiresRestrictiveListCheck = restrictive.Int64 == 1

	db.QueryRow("SELECT (SELECT COUNT(*) FROM lender_rules WHERE lender_id = ?), (SELECT COUNT(*) FROM lender_datacredito_rules WHERE lender_id = ?)", l.ID, l.ID).
		Scan(&s.Rules.LenderRules, &s.Rules.DatacreditoRule)
	db.QueryRow("SELECT COUNT(DISTINCT allied_id) FROM lenders_by_allieds WHERE lender_id = ? AND status = 1", l.ID).Scan(&s.OfferedBy.Merchants)
	db.QueryRow("SELECT COUNT(*) FROM lender_allied_credentials WHERE lender_id = ?", l.ID).Scan(&s.Credentials)

	s.OfferedBy.Sample = []string{}
	if rows, err := db.Query(`SELECT DISTINCT a.name FROM lenders_by_allieds lba JOIN allieds a ON a.id = lba.allied_id
		WHERE lba.lender_id = ? AND lba.status = 1 ORDER BY a.name LIMIT 5`, l.ID); err == nil {
		defer rows.Close()
		for rows.Next() {
			var n string
			if rows.Scan(&n) == nil {
				s.OfferedBy.Sample = append(s.OfferedBy.Sample, n)
			}
		}
	}
	return s, true
}

func rtLabel(rt int) string {
	switch rt {
	case 0:
		return "(UTM redirect — sin cierre de integración)"
	case 1:
		return "(integración externa)"
	case 2:
		return "(Creditop X in-platform)"
	case 3:
		return "(cupo rotativo Creditop X)"
	case 4:
		return "(integración async, fuera del catálogo 0-3)"
	}
	return ""
}

func formatLenderGo(s lenderSnapshot, color bool) string {
	c := ansi{color}
	var b strings.Builder
	p := func(format string, a ...any) { fmt.Fprintf(&b, format, a...) }
	p("%s\n", c.bold(c.cyan(fmt.Sprintf("LENDER #%d · %s", s.ID, s.Name))))
	p("  %s          %s\n", c.gray("Slug:"), ptosDefault(s.Slug, "—"))
	p("  %s %d %s\n", c.gray("Response type:"), s.ResponseType, c.gray(rtLabel(s.ResponseType)))
	act := c.gray("— (sin clase Action)")
	if s.Action != nil && *s.Action != "" {
		act = lastSegment(*s.Action)
	}
	p("  %s        %s\n", c.gray("Action:"), act)
	estado := c.green("activo")
	if s.Status != 1 {
		estado = c.yellow(fmt.Sprintf("inactivo (%d)", s.Status))
	}
	p("  %s        %s\n", c.gray("Estado:"), estado)
	restr := ""
	if s.RequiresRestrictiveListCheck {
		restr = " · chequea listas restrictivas"
	}
	p("  %s %s %s\n", c.gray("NIT originador:"), ptosDefault(s.OriginatorNit, "—"), c.gray("· validation_type "+ptosDefault(s.ValidationType, "—")+restr))
	p("  %s        %d lender_rules · %d datacrédito_rules\n", c.gray("Reglas:"), s.Rules.LenderRules, s.Rules.DatacreditoRule)
	p("  %s  %d %s\n", c.gray("Credenciales:"), s.Credentials, c.gray("(lender_allied_credentials)"))
	sampleStr := ""
	if len(s.OfferedBy.Sample) > 0 {
		sampleStr = c.gray("(ej: " + strings.Join(s.OfferedBy.Sample, ", ") + ")")
	}
	p("  %s  %d comercios %s", c.gray("Ofrecido por:"), s.OfferedBy.Merchants, sampleStr)
	return b.String()
}

// ─── helpers de nullable / formato ───────────────────────────────────────────

func sptr(n sql.NullString) *string {
	if !n.Valid {
		return nil
	}
	v := n.String
	return &v
}
func f64ptr(n sql.NullFloat64) *float64 {
	if !n.Valid {
		return nil
	}
	v := n.Float64
	return &v
}
func nz(n sql.NullString, def string) string {
	if n.Valid {
		return n.String
	}
	return def
}
func ptos(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}
func ptosDefault(p *string, def string) string {
	if p == nil || *p == "" {
		return def
	}
	return *p
}
func lastSegment(action string) string {
	parts := strings.Split(action, "\\")
	return parts[len(parts)-1]
}
func money(n float64) string {
	// $1.234.567 (separador de miles con punto, estilo es-CO).
	s := fmt.Sprintf("%.0f", n)
	neg := strings.HasPrefix(s, "-")
	s = strings.TrimPrefix(s, "-")
	var out []byte
	for i, ch := range []byte(s) {
		if i > 0 && (len(s)-i)%3 == 0 {
			out = append(out, '.')
		}
		out = append(out, ch)
	}
	res := "$" + string(out)
	if neg {
		res = "-" + res
	}
	return res
}

// timeAgoStr calcula "hace X" desde un ISO string (reparsea; las snapshots guardan ISO).
func timeAgoStr(iso string) string {
	t, err := time.Parse("2006-01-02T15:04:05.000Z", iso)
	if err != nil {
		return "?"
	}
	return timeAgo(t)
}
