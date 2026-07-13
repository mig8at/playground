package main

// create — crea un usuario sintético con ROL + COMERCIO + BRANCH (verbo de primera clase,
// simétrico con `[channel] merchant lender`). NO DESTRUCTIVO: solo UPSERT (idempotente por
// cognito_id). Reusa merchant.Resolve + ensureBranch + createAsesor (cero divergencia de SQL).
//
//   go run . create <role> <merchant> [branchHash]
//   go run . create comercial pullman
//   go run . create --target=dev comercial pullman      # requiere I_KNOW_THIS_TOUCHES_SHARED_DEV=1
//
// Borrado: NUNCA hay opción de borrado masivo. Para limpiar ESTE recurso (uno solo, por clave):
//   DELETE FROM users WHERE cognito_id='<el cognito_id que imprime>'

import (
	"creditop-tests/merchant"
	"creditop-tests/pkg/client"
	"creditop-tests/pkg/config"
	"creditop-tests/pkg/database"
	"creditop-tests/pkg/identity"
	"creditop-tests/pkg/ledger"
	"fmt"
	"os"
	"strings"
)

// roleProfiles mapea slugs amigables → el nombre EXACTO de user_profiles.name.
var roleProfiles = map[string]string{
	"comercial":     "Comercial",
	"asesor":        "Comercial",
	"administrador": "Administrador",
	"admin":         "Administrador",
	"analista":      "Analista",
	"superadmin":    "Superadmin comercio",
	"admincomercio": "Admin comercio",
}

// roleSlugs mapea el rol → un slug DESCRIPTIVO en inglés para el identificador del usuario
// (ej. comercial → "adviser"). El cognito_id queda `{seed}-adviser-test`, más legible que el
// viejo `comercial__{seed}_test`.
var roleSlugs = map[string]string{
	"comercial":     "adviser",
	"asesor":        "adviser",
	"administrador": "administrator",
	"admin":         "administrator",
	"analista":      "analyst",
	"superadmin":    "super-admin",
	"admincomercio": "merchant-admin",
}

func descriptiveRoleSlug(role string) string {
	if s, ok := roleSlugs[strings.ToLower(role)]; ok {
		return s
	}
	return sanitizeSlug(role)
}

// sanitizeSlug deja a-z0-9 y guiones (seguro para cognito_id/columnas únicas y SQL LIKE).
func sanitizeSlug(s string) string {
	var b strings.Builder
	for _, c := range strings.ToLower(s) {
		if (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-' {
			b.WriteRune(c)
		}
	}
	if out := b.String(); out != "" {
		return out
	}
	return "user"
}

// domainSlug deriva el dominio del email del comercio (sin guiones): "pullman" → "pullman".
func domainSlug(merchant string) string {
	d := strings.ReplaceAll(sanitizeSlug(merchant), "-", "")
	if d == "" {
		return "creditop"
	}
	return d
}

func runCreate(args []string) {
	var pos []string
	for _, a := range args {
		if !strings.HasPrefix(a, "-") {
			pos = append(pos, a)
		}
	}
	if len(pos) < 2 {
		fmt.Fprintln(os.Stderr, "uso: go run . create <role> <merchant> [branchHash] [--target=dev]")
		fmt.Fprintln(os.Stderr, "  roles: comercial|asesor, administrador|admin, analista, superadmin, admincomercio")
		os.Exit(2)
	}
	roleArg, merchantQ := strings.ToLower(pos[0]), pos[1]
	branchHash := ""
	if len(pos) > 2 {
		branchHash = pos[2]
	}
	profile := roleProfiles[roleArg]
	if profile == "" {
		profile = pos[0] // si no está en el mapa, se asume el nombre exacto de user_profiles.name
	}

	cfg := config.GetConfig(target)
	// Guard: escribir en un ambiente COMPARTIDO exige confirmación explícita (CONVENCIONES #4).
	if cfg.IsShared() && os.Getenv("I_KNOW_THIS_TOUCHES_SHARED_DEV") != "1" {
		fmt.Fprintf(os.Stderr, "%s✗ create --target=%s ESCRIBE en una BD compartida.%s\n", client.CRed, cfg.Target, client.CReset)
		fmt.Fprintln(os.Stderr, "  Exportá I_KNOW_THIS_TOUCHES_SHARED_DEV=1 para confirmar el write.")
		os.Exit(2)
	}

	db := database.Connect(cfg)
	defer db.Close()

	m, err := merchant.Resolve(db, merchantQ)
	if err != nil {
		fmt.Fprintf(os.Stderr, "%s✗ comercio no encontrado: %v%s\n", client.CRed, err, client.CReset)
		os.Exit(1)
	}
	branch, err := ensureBranch(db, m.AlliedID, branchHash)
	if err != nil {
		fmt.Fprintf(os.Stderr, "%s✗ branch: %v%s\n", client.CRed, err, client.CReset)
		os.Exit(1)
	}
	seed := identity.Seed()
	nameSlug := descriptiveRoleSlug(roleArg)
	domain := domainSlug(merchantQ)
	a, err := createAsesor(db, nameSlug, domain, m.AlliedID, branch.id, profile, seed)
	if err != nil {
		fmt.Fprintf(os.Stderr, "%s✗ crear usuario: %v%s\n", client.CRed, err, client.CReset)
		os.Exit(1)
	}

	// Anotar en el ledger lo que se creó → `clean` lo borra UNO A UNO después (por clave),
	// incluso si se cierra la consola. Idempotente.
	_ = ledger.Record(ledger.Entry{Target: cfg.Target, Table: "users", KeyCol: "id", KeyVal: fmt.Sprint(a.id), Note: fmt.Sprintf("create %s @ %s", profile, m.Name)})
	_ = ledger.Record(ledger.Entry{Target: cfg.Target, Table: "model_has_roles", KeyCol: "model_id", KeyVal: fmt.Sprint(a.id)})

	// Resumen humano → stderr.
	g := client.CGreen
	r := client.CReset
	fmt.Fprintf(os.Stderr, "%s✓ Usuario:%s   %s (id %d, perfil %q)\n", g, r, a.email, a.id, profile)
	fmt.Fprintf(os.Stderr, "%s✓ Comercio:%s  %s (allied #%d)\n", g, r, m.Name, m.AlliedID)
	fmt.Fprintf(os.Stderr, "%s✓ Branch:%s    %s (#%d, hash %s)\n", g, r, branch.name, branch.id, branch.hash)
	fmt.Fprintf(os.Stderr, "%s✓ Target:%s    %s\n", g, r, cfg.Target)
	fmt.Fprintf(os.Stderr, "  login (header): x-cognito-identity-id: %s\n", a.cognitoID)
	fmt.Fprintf(os.Stderr, "  borrar SOLO este recurso: DELETE FROM users WHERE cognito_id='%s'\n", a.cognitoID)

	// Exports eval-friendly → stdout (simétrico con prep).
	fmt.Printf("export E2E_COGNITO_ID=%q\n", a.cognitoID)
	fmt.Printf("export E2E_PARTNER_HASH=%q\n", branch.hash)
	fmt.Printf("export E2E_MERCHANT_ID=%q\n", fmt.Sprint(m.AlliedID))
	fmt.Printf("export E2E_BRANCH_ID=%q\n", fmt.Sprint(branch.id))
	fmt.Printf("export E2E_SEED=%q\n", seed)
}
