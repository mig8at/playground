// creditop-mcp — valida la ORIGINACIÓN de crédito contra dev (default) o local (--target local).
// Standalone (no toca backend-e2e). Dos modos:
//   - sin args  → servidor MCP por stdio (tools tipados para un cliente MCP).
//   - con args  → CLI rápido con las MISMAS ops (el comando kebab-case es alias del tool snake_case).
//
// Ops (CLI ⇄ tool MCP, en paridad):
//   reads:  list · ecommerce · ecommerce-url · whois · bypassphones · inplatform · offers · summary ·
//           branchdiag · grouprules · rules · dcrules · modediag · reqdiag · cryptocheck
//   writes (exigen I_KNOW_THIS_TOUCHES_SHARED_DEV=1 en dev; en local no): create · assign · revoke ·
//           scrubphone · synth · synth-fill · notify · clean
//
// Seguridad: WRITE a dev exige I_KNOW_THIS_TOUCHES_SHARED_DEV=1 (en local no). Borrado por clave, nunca bulk.
// Config + secretos en backend-mcp/.env.<target> (.env.dev | .env.local, gitignored), autocargado.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

var cfg Config

func main() {
	target, rest := resolveTarget(os.Args[1:]) // dev (default) | local — elige .env.<target>
	envFile := ".env." + target
	_ = loadEnvFile(envFile)
	if exe, err := os.Executable(); err == nil {
		_ = loadEnvFile(filepath.Join(filepath.Dir(exe), envFile))
	}
	// Hechos del entorno COMPARTIDOS con backend-e2e y frontend-e2e (BD, API, APP_KEY).
	// Va DESPUÉS a propósito: loadEnvFile solo setea lo ausente, así el .env propio gana.
	_ = loadEnvFile(filepath.Join("..", "env", target+".env"))
	cfg = configFromEnv()
	cfg.Target = target

	if len(rest) > 0 {
		os.Exit(runCLI(rest))
	}
	s := mcp.NewServer(&mcp.Implementation{Name: "creditop-dev", Version: "0.1.0"}, nil)
	registerTools(s)
	if err := s.Run(context.Background(), &mcp.StdioTransport{}); err != nil {
		fmt.Fprintln(os.Stderr, "creditop-mcp:", err)
		os.Exit(1)
	}
}

// resolveTarget saca --target=X / --target X de args (default E2E_TARGET o "dev") y devuelve
// (target, restoArgs). Elige qué .env.<target> cargar; el resto de args va al CLI.
func resolveTarget(args []string) (string, []string) {
	target := getenvOr("E2E_TARGET", "dev")
	out := make([]string, 0, len(args))
	for i := 0; i < len(args); i++ {
		a := args[i]
		if v, ok := strings.CutPrefix(a, "--target="); ok {
			target = v
			continue
		}
		if a == "--target" && i+1 < len(args) {
			target = args[i+1]
			i++
			continue
		}
		out = append(out, a)
	}
	return strings.ToLower(target), out
}

// ───────────────────────── modo CLI ─────────────────────────

func runCLI(args []string) int {
	cmd := args[0]
	var pos []string
	keep, identity, ecommerce, notify := false, false, false, false
	income, score := 0, 0
	notifyURL := ""
	for _, a := range args[1:] {
		switch {
		case a == "--keep":
			keep = true
		case a == "--identity":
			identity = true
		case a == "--ecommerce":
			ecommerce = true
		case a == "--notify":
			notify = true // receiver loopback del MCP
		case strings.HasPrefix(a, "--notify="):
			notify, notifyURL = true, a[len("--notify="):]
		case strings.HasPrefix(a, "--income="):
			income, _ = strconv.Atoi(a[len("--income="):])
		case strings.HasPrefix(a, "--score="):
			score, _ = strconv.Atoi(a[len("--score="):])
		case !strings.HasPrefix(a, "-"):
			pos = append(pos, a)
		}
	}
	at := func(i int, def string) string {
		if i < len(pos) {
			return pos[i]
		}
		return def
	}

	// webhook-server: mini-server de larga vida (no necesita DB) para testear el webhook a mano.
	if cmd == "webhook-server" || cmd == "serve" {
		if err := serveWebhook(at(0, "")); err != nil {
			fmt.Fprintln(os.Stderr, "webhook-server:", err)
			return 1
		}
		return 0
	}

	db, err := connect(cfg)
	if err != nil {
		fmt.Fprintln(os.Stderr, "DB dev:", err)
		return 3
	}
	defer db.Close()

	switch cmd {
	case "list", "list_merchants":
		ms, err := opListMerchants(db, at(0, ""), 25)
		return done(printJSON(ms), err)
	case "ecommerce", "list_ecommerce":
		es, err := opListEcommerce(db, at(0, ""))
		return done(printJSON(es), err)
	case "ecommerce-url", "ecommerce_url":
		eu, err := opEcommerceURL(db, at(0, ""), at(1, ""), 0)
		return done(printJSON(eu), err)
	case "summary", "summary_shape":
		sh, err := opUserSummaryShape(db, at(0, ""))
		return done(printJSON(sh), err)
	case "cryptocheck", "crypto_check":
		rc, err := opCryptoCheck(db, cfg.AppKey)
		return done(printJSON(rc), err)
	case "inplatform", "in_platform":
		ip, err := opInPlatformLenders(db)
		return done(printJSON(ip), err)
	case "offers", "lender_offers":
		of, err := opLenderOffers(db, at(0, ""))
		return done(printJSON(of), err)
	case "lenderconf", "lender_conf":
		lid, _ := strconv.Atoi(at(0, ""))
		lc, err := opLenderConf(db, lid)
		return done(printJSON(lc), err)
	case "lendersbytype", "lenders_by_type":
		rt, _ := strconv.Atoi(at(0, "0"))
		lt, err := opLendersByType(db, rt)
		return done(printJSON(lt), err)
	case "branchdiag", "branch_diag":
		bd, err := opBranchDiag(db, at(0, ""))
		return done(printJSON(bd), err)
	case "modediag", "mode_diag":
		uid, _ := strconv.Atoi(at(0, ""))
		lid, _ := strconv.Atoi(at(1, ""))
		md, err := opModeDiag(db, uid, lid)
		return done(printJSON(md), err)
	case "reqdiag", "req_diag":
		uid, _ := strconv.Atoi(at(0, ""))
		rd, err := opReqDiag(db, uid)
		return done(printJSON(rd), err)
	case "grouprules", "group_rules":
		lid := 77
		if v, e := strconv.Atoi(at(1, "")); e == nil {
			lid = v
		}
		gr, err := opGroupRules(db, at(0, "17f7b360"), lid)
		return done(printJSON(gr), err)
	case "dcrules", "datacredito_rules":
		lid, _ := strconv.Atoi(at(1, ""))
		dr, err := opLenderDatacreditoRules(db, at(0, ""), lid)
		return done(printJSON(dr), err)
	case "rules", "lender_rules":
		lid := 77
		if v, e := strconv.Atoi(at(0, "")); e == nil {
			lid = v
		}
		rl, err := opLenderRules(db, lid)
		return done(printJSON(rl), err)
	case "whois", "asesor_whois":
		wi, err := opAsesorWhois(db, at(0, ""))
		return done(printJSON(wi), err)
	case "bypassphones", "otp_bypass_phones":
		bp, err := opOtpBypassPhones(db)
		return done(printJSON(bp), err)
	case "scrubphone", "scrub_phone":
		if !guardOK() {
			return guardFail()
		}
		sp, err := opScrubPhone(db, at(0, ""))
		return done(printJSON(sp), err)
	case "userreqs", "user_reqs":
		ur, err := opUserReqs(db, at(0, ""))
		return done(printJSON(ur), err)
	case "seedpreapproval", "seed_preapproval":
		if !guardOK() {
			return guardFail()
		}
		ur, _ := strconv.Atoi(at(0, ""))
		lid, _ := strconv.Atoi(at(1, ""))
		amt, _ := strconv.Atoi(at(2, "500000"))
		sp, err := opSeedPreApproval(db, ur, lid, amt)
		return done(printJSON(sp), err)
	case "branchrule-add", "branch_rule_add":
		if !guardOK() {
			return guardFail()
		}
		lid, _ := strconv.Atoi(at(1, ""))
		br, err := opAddBranchRule(db, at(0, ""), lid)
		return done(printJSON(br), err)
	case "branchrule-del", "branch_rule_del":
		if !guardOK() {
			return guardFail()
		}
		grid, _ := strconv.Atoi(at(0, ""))
		br, err := opDelBranchRule(db, grid)
		return done(printJSON(br), err)
	case "create", "create_asesor":
		if !guardOK() {
			return guardFail()
		}
		if len(pos) == 0 {
			fmt.Fprintln(os.Stderr, "uso: create <merchant> [role]")
			return 2
		}
		a, err := opCreateAsesor(db, cfg, at(0, ""), at(1, "comercial"), "")
		return done(printJSON(a), err)
	case "assign", "assign_asesor":
		if !guardOK() {
			return guardFail()
		}
		as, err := opAsesorAssign(db, cfg, at(0, ""), at(1, ""), at(2, ""), at(3, ""))
		return done(printJSON(as), err)
	case "revoke", "revoke_asesor":
		if !guardOK() {
			return guardFail()
		}
		rv, err := opAsesorRevoke(db)
		return done(printJSON(rv), err)
	case "synth", "run_synth":
		if !guardOK() {
			return guardFail()
		}
		r, err := opSynth(db, cfg, at(0, "pullman"), at(1, ""), income, score, ecommerce, keep, notify, notifyURL)
		printJSON(r)
		return done(0, err)
	case "synth-fill", "synth_fill":
		if !guardOK() {
			return guardFail()
		}
		uid, _ := strconv.Atoi(at(0, ""))
		sf, err := opSynthFill(db, cfg, uid, at(1, ""), income, score)
		return done(printJSON(sf), err)
	case "notify", "notify_ecommerce":
		if !guardOK() {
			return guardFail()
		}
		uid, _ := strconv.Atoi(at(0, ""))
		if uid == 0 {
			fmt.Fprintln(os.Stderr, "uso: notify <user_request_id> [url]   (sin url usa el receiver loopback del MCP)")
			return 2
		}
		nr, err := notifyEcommerce(db, uid, at(1, ""))
		return done(printJSON(nr), err)
	case "clean":
		if !guardOK() {
			return guardFail()
		}
		out := map[string]int{"seed_deleted": cleanSeed(db, cfg.Seed)}
		if identity {
			out["identity_deleted"] = scrubIdentity(db, os.Getenv("E2E_SCRUB_PHONE"), os.Getenv("E2E_CUSTOMER_DOC"), os.Getenv("E2E_SCRUB_EMAIL"))
		}
		return done(printJSON(out), nil)
	default:
		fmt.Fprintln(os.Stderr, "comandos: list [q] · ecommerce [q] · summary [doc] · branchdiag <hash> · grouprules <hash> [lender] · rules [lender] · whois <email|sub> · bypassphones · scrubphone <tel> · create <merchant> [role] · assign <email|sub> <merchant> [branchHash] [realSub] · revoke · synth [merchant] [--income=N] [--score=N] [--ecommerce] [--notify[=url]] [--keep] · notify <uReqID> [url] · webhook-server [addr] · clean [--identity]")
		return 2
	}
}

func printJSON(v any) int {
	b, _ := json.MarshalIndent(v, "", "  ")
	fmt.Println(string(b))
	return 0
}
func done(code int, err error) int {
	if err != nil {
		fmt.Fprintln(os.Stderr, "✗", err)
		return 1
	}
	return code
}
func guardFail() int {
	fmt.Fprintln(os.Stderr, "guard: exportá I_KNOW_THIS_TOUCHES_SHARED_DEV=1 para escribir en dev")
	return 2
}

// ───────────────────────── servidor MCP ─────────────────────────

func textResult(format string, a ...any) *mcp.CallToolResult {
	return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: fmt.Sprintf(format, a...)}}}
}
func errResult(format string, a ...any) *mcp.CallToolResult {
	return &mcp.CallToolResult{IsError: true, Content: []mcp.Content{&mcp.TextContent{Text: fmt.Sprintf(format, a...)}}}
}

func registerTools(s *mcp.Server) {
	type listIn struct {
		Query string `json:"query,omitempty"`
		Limit int    `json:"limit,omitempty"`
	}
	type listOut struct {
		Merchants []MerchantRow `json:"merchants"`
	}
	mcp.AddTool(s, &mcp.Tool{Name: "list_merchants",
		Description: "Lista comercios (allied + branch + hash) de dev. Read-only. Filtro opcional por nombre/slug/hash.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in listIn) (*mcp.CallToolResult, listOut, error) {
		db, err := connect(cfg)
		if err != nil {
			return errResult("DB dev: %v", err), listOut{}, nil
		}
		defer db.Close()
		ms, err := opListMerchants(db, in.Query, in.Limit)
		if err != nil {
			return errResult("query: %v", err), listOut{}, nil
		}
		return textResult("%d comercios", len(ms)), listOut{Merchants: ms}, nil
	})

	type createIn struct {
		Merchant string `json:"merchant"`
		Role     string `json:"role,omitempty"`
		Branch   string `json:"branch,omitempty"`
	}
	mcp.AddTool(s, &mcp.Tool{Name: "create_asesor",
		Description: "Crea un usuario sintético (rol+comercio+branch) en dev, namespaced `{seed}-{rol}-test`. Idempotente. Requiere I_KNOW_THIS_TOUCHES_SHARED_DEV=1.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in createIn) (*mcp.CallToolResult, CreatedAsesor, error) {
		if !guardOK() {
			return errResult("guard: I_KNOW_THIS_TOUCHES_SHARED_DEV=1"), CreatedAsesor{}, nil
		}
		if in.Merchant == "" {
			return errResult("falta 'merchant'"), CreatedAsesor{}, nil
		}
		db, err := connect(cfg)
		if err != nil {
			return errResult("DB dev: %v", err), CreatedAsesor{}, nil
		}
		defer db.Close()
		a, err := opCreateAsesor(db, cfg, in.Merchant, in.Role, in.Branch)
		if err != nil {
			return errResult("%v", err), CreatedAsesor{}, nil
		}
		return textResult("✓ %s (%s) · login header x-cognito-identity-id: %s", a.Email, a.Profile, a.CognitoID), a, nil
	})

	type synthIn struct {
		Merchant  string `json:"merchant,omitempty"`
		Lender    string `json:"lender,omitempty"`     // rule-driven: lender objetivo; lee sus reglas y arma el perfil
		Income    int    `json:"income,omitempty"`
		Score     int    `json:"score,omitempty"`
		Ecommerce bool   `json:"ecommerce,omitempty"`
		Keep      bool   `json:"keep,omitempty"`
		Notify    bool   `json:"notify,omitempty"`     // dispara el webhook sintético (cierre Estado 11)
		NotifyURL string `json:"notify_url,omitempty"` // receiver; vacío = loopback del MCP
	}
	mcp.AddTool(s, &mcp.Tool{Name: "run_synth",
		Description: "Flujo 100% SINTÉTICO hasta el LISTADO DE LENDERS (+ sello Estado 11 + webhook opcional), sin huella ni llamadas externas (sin CC real, sin Experian). Fabrica un cliente con doc sintético → [handshake ecommerce si ecommerce=true] → register → otp(bypass) → INYECTA el KYC armado (identidad+age, user_summaries, field 87/29/160, fila Experian encriptada) → GET marketplace. income/score parametrizan las ofertas. notify=true dispara el webhook ecommerce sintético (replica processEcommerceTransaction → POST + processed=1; notify_url vacío = receiver loopback del MCP). Crea y borra el cliente (keep=true para no borrar). Requiere I_KNOW_THIS_TOUCHES_SHARED_DEV=1.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in synthIn) (*mcp.CallToolResult, FlowResult, error) {
		if !guardOK() {
			return errResult("guard: I_KNOW_THIS_TOUCHES_SHARED_DEV=1"), FlowResult{}, nil
		}
		merchantQ := in.Merchant
		if merchantQ == "" {
			merchantQ = "pullman"
		}
		db, err := connect(cfg)
		if err != nil {
			return errResult("DB dev: %v", err), FlowResult{}, nil
		}
		defer db.Close()
		r, err := opSynth(db, cfg, merchantQ, in.Lender, in.Income, in.Score, in.Ecommerce, in.Keep, in.Notify, in.NotifyURL)
		if err != nil {
			return errResult("%v", err), r, nil
		}
		return textResult("KYC armado (income=%d score=%d) · %s · user_request #%d · %d lenders · webhook=%v", in.Income, in.Score, r.Origin, r.UserRequestID, len(r.Lenders), r.Notify["processed"]), r, nil
	})

	type cleanIn struct {
		ScrubIdentity bool `json:"scrub_identity,omitempty"`
	}
	type cleanOut struct {
		SeedDeleted     int `json:"seed_users_deleted"`
		IdentityDeleted int `json:"identity_users_deleted"`
	}
	mcp.AddTool(s, &mcp.Tool{Name: "clean",
		Description: "Borra en dev el namespace del seed (asesores `{seed}-%-test` + requests + hijos), por clave. scrub_identity=true también borra el cliente de prueba. Requiere I_KNOW_THIS_TOUCHES_SHARED_DEV=1.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in cleanIn) (*mcp.CallToolResult, cleanOut, error) {
		if !guardOK() {
			return errResult("guard: I_KNOW_THIS_TOUCHES_SHARED_DEV=1"), cleanOut{}, nil
		}
		db, err := connect(cfg)
		if err != nil {
			return errResult("DB dev: %v", err), cleanOut{}, nil
		}
		defer db.Close()
		out := cleanOut{SeedDeleted: cleanSeed(db, cfg.Seed)}
		if in.ScrubIdentity {
			out.IdentityDeleted = scrubIdentity(db, os.Getenv("E2E_SCRUB_PHONE"), os.Getenv("E2E_CUSTOMER_DOC"), os.Getenv("E2E_SCRUB_EMAIL"))
		}
		return textResult("seed=%d · identidad=%d", out.SeedDeleted, out.IdentityDeleted), out, nil
	})

	// --- ecommerce, webhook y diagnósticos (paridad con el CLI) ---
	// Las ops de diagnóstico devuelven un mapa libre; lo envolvemos para el schema de salida.
	type diagOut struct {
		Result map[string]any `json:"result"`
	}

	type ecomIn struct {
		Query string `json:"query,omitempty"`
	}
	type ecomOut struct {
		Branches []EcommerceBranch `json:"branches"`
	}
	mcp.AddTool(s, &mcp.Tool{Name: "list_ecommerce",
		Description: "Lista las sucursales con credencial ecommerce (las únicas que pueden hacer el handshake base64). Read-only. Filtro opcional por nombre/slug.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in ecomIn) (*mcp.CallToolResult, ecomOut, error) {
		db, err := connect(cfg)
		if err != nil {
			return errResult("DB dev: %v", err), ecomOut{}, nil
		}
		defer db.Close()
		es, err := opListEcommerce(db, in.Query)
		if err != nil {
			return errResult("%v", err), ecomOut{}, nil
		}
		return textResult("%d sucursales ecommerce", len(es)), ecomOut{Branches: es}, nil
	})

	type notifyIn struct {
		UserRequestID int    `json:"user_request_id"`
		URL           string `json:"url,omitempty"`
	}
	mcp.AddTool(s, &mcp.Tool{Name: "notify_ecommerce",
		Description: "Webhook ecommerce SINTÉTICO: replica processEcommerceTransaction (POST según ecommerce_id + marca ecommerce_requests.processed=1 si el receiver responde 2xx). url vacío = receiver loopback del propio MCP (autocontenido). NO firma documentos. Requiere I_KNOW_THIS_TOUCHES_SHARED_DEV=1.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in notifyIn) (*mcp.CallToolResult, diagOut, error) {
		if !guardOK() {
			return errResult("guard: I_KNOW_THIS_TOUCHES_SHARED_DEV=1"), diagOut{}, nil
		}
		db, err := connect(cfg)
		if err != nil {
			return errResult("DB dev: %v", err), diagOut{}, nil
		}
		defer db.Close()
		nr, err := notifyEcommerce(db, in.UserRequestID, in.URL)
		if err != nil {
			return errResult("%v", err), diagOut{Result: nr}, nil
		}
		return textResult("webhook → processed=%v", nr["processed"]), diagOut{Result: nr}, nil
	})

	type sumIn struct {
		Document string `json:"document,omitempty"`
	}
	mcp.AddTool(s, &mcp.Tool{Name: "summary_shape",
		Description: "Read-only: esquema (SHOW COLUMNS) + una fila de muestra de user_summaries, para aprender el shape del JSON a fabricar. document opcional para una fila puntual.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in sumIn) (*mcp.CallToolResult, SummaryShape, error) {
		db, err := connect(cfg)
		if err != nil {
			return errResult("DB dev: %v", err), SummaryShape{}, nil
		}
		defer db.Close()
		sh, err := opUserSummaryShape(db, in.Document)
		if err != nil {
			return errResult("%v", err), SummaryShape{}, nil
		}
		return textResult("%d columnas", len(sh.Columns)), sh, nil
	})

	type branchIn struct {
		Hash string `json:"hash"`
	}
	mcp.AddTool(s, &mcp.Tool{Name: "branch_diag",
		Description: "Read-only (config, no PII): have_ctopx, lenders candidatos de la sucursal (lenders_by_allied_branches) y group_rules_count. Para ver si un lender es candidato y qué filtros aplican.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in branchIn) (*mcp.CallToolResult, diagOut, error) {
		db, err := connect(cfg)
		if err != nil {
			return errResult("DB dev: %v", err), diagOut{}, nil
		}
		defer db.Close()
		bd, err := opBranchDiag(db, in.Hash)
		if err != nil {
			return errResult("%v", err), diagOut{Result: bd}, nil
		}
		return textResult("branch %s", in.Hash), diagOut{Result: bd}, nil
	})

	type grIn struct {
		Hash     string `json:"hash"`
		LenderID int    `json:"lender_id,omitempty"`
	}
	mcp.AddTool(s, &mcp.Tool{Name: "group_rules",
		Description: "Read-only (config): las group rules (en AND) que un lender exige para entrar al listado de una sucursal (field_id/operator/value o specific_table/column). lender_id por defecto 77 (CrediPullman).",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in grIn) (*mcp.CallToolResult, diagOut, error) {
		db, err := connect(cfg)
		if err != nil {
			return errResult("DB dev: %v", err), diagOut{}, nil
		}
		defer db.Close()
		lid := in.LenderID
		if lid == 0 {
			lid = 77
		}
		gr, err := opGroupRules(db, in.Hash, lid)
		if err != nil {
			return errResult("%v", err), diagOut{Result: gr}, nil
		}
		return textResult("group rules de %d en %s", lid, in.Hash), diagOut{Result: gr}, nil
	})

	type lrIn struct {
		LenderID int `json:"lender_id,omitempty"`
	}
	mcp.AddTool(s, &mcp.Tool{Name: "lender_rules",
		Description: "Read-only (config): lender_users_category_rules + lender_users_categories de un lender (elegibilidad / sello Estado 11). lender_id por defecto 77 (CrediPullman).",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in lrIn) (*mcp.CallToolResult, diagOut, error) {
		db, err := connect(cfg)
		if err != nil {
			return errResult("DB dev: %v", err), diagOut{}, nil
		}
		defer db.Close()
		lid := in.LenderID
		if lid == 0 {
			lid = 77
		}
		rl, err := opLenderRules(db, lid)
		if err != nil {
			return errResult("%v", err), diagOut{Result: rl}, nil
		}
		return textResult("rules de %d", lid), diagOut{Result: rl}, nil
	})

	type reqIn struct {
		UserRequestID int `json:"user_request_id"`
	}
	mcp.AddTool(s, &mcp.Tool{Name: "req_diag",
		Description: "Read-only: estado de un user_request — la fila + records CreditopX (process_status 5=iniciado, 11=aprobado/Estado 11) + el ecommerce_request vinculado (processed, process_url).",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in reqIn) (*mcp.CallToolResult, diagOut, error) {
		db, err := connect(cfg)
		if err != nil {
			return errResult("DB dev: %v", err), diagOut{}, nil
		}
		defer db.Close()
		rd, err := opReqDiag(db, in.UserRequestID)
		if err != nil {
			return errResult("%v", err), diagOut{Result: rd}, nil
		}
		return textResult("user_request #%d", in.UserRequestID), diagOut{Result: rd}, nil
	})

	mcp.AddTool(s, &mcp.Tool{Name: "crypto_check",
		Description: "Read-only: verifica que APP_KEY sea el del backend de dev recomputando el HMAC de una fila Experian real (sobre el ciphertext, sin desencriptar PII). mac_valid=true ⇒ la llave es correcta.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, diagOut, error) {
		db, err := connect(cfg)
		if err != nil {
			return errResult("DB dev: %v", err), diagOut{}, nil
		}
		defer db.Close()
		rc, err := opCryptoCheck(db, cfg.AppKey)
		if err != nil {
			return errResult("%v", err), diagOut{Result: rc}, nil
		}
		return textResult("mac_valid=%v", rc["mac_valid"]), diagOut{Result: rc}, nil
	})

	// ─── paridad con el CLI: reads de diagnóstico + writes de caso ───
	type listAnyOut struct {
		Result []map[string]any `json:"result"`
	}

	type whoisIn struct {
		Query string `json:"query"` // email o cognito_id (sub) del asesor
	}
	mcp.AddTool(s, &mcp.Tool{Name: "asesor_whois",
		Description: "Read-only: filas users que matchean por cognito_id (sub) o email, con allied/branch/hash/profile actuales. Para ver a qué comercio está asociado un asesor.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in whoisIn) (*mcp.CallToolResult, diagOut, error) {
		db, err := connect(cfg)
		if err != nil {
			return errResult("DB dev: %v", err), diagOut{}, nil
		}
		defer db.Close()
		wi, err := opAsesorWhois(db, in.Query)
		if err != nil {
			return errResult("%v", err), diagOut{Result: wi}, nil
		}
		return textResult("whois %q", in.Query), diagOut{Result: wi}, nil
	})

	mcp.AddTool(s, &mcp.Tool{Name: "otp_bypass_phones",
		Description: "Read-only: teléfonos en qa_otp_bypass_phones (settings) y su OTP de bypass (= últimos 4 dígitos). Válido solo en APP_ENV local/development. Para descubrir qué teléfono usar en un flujo.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, diagOut, error) {
		db, err := connect(cfg)
		if err != nil {
			return errResult("DB dev: %v", err), diagOut{}, nil
		}
		defer db.Close()
		bp, err := opOtpBypassPhones(db)
		if err != nil {
			return errResult("%v", err), diagOut{Result: bp}, nil
		}
		return textResult("%v teléfonos de bypass", bp["count"]), diagOut{Result: bp}, nil
	})

	type ecomURLIn struct {
		Merchant string `json:"merchant"`
		Phone    string `json:"phone,omitempty"`
		Amount   int    `json:"amount,omitempty"`
	}
	mcp.AddTool(s, &mcp.Tool{Name: "ecommerce_url",
		Description: "Read-only: arma la URL del checkout ecommerce (/ecommerce/{hash}/checkout?o=…&t=…) de una sucursal con credencial ecommerce — contrato base64 + token. Para abrir el flujo ecommerce en el wizard.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in ecomURLIn) (*mcp.CallToolResult, diagOut, error) {
		db, err := connect(cfg)
		if err != nil {
			return errResult("DB dev: %v", err), diagOut{}, nil
		}
		defer db.Close()
		eu, err := opEcommerceURL(db, in.Merchant, in.Phone, in.Amount)
		if err != nil {
			return errResult("%v", err), diagOut{Result: eu}, nil
		}
		return textResult("checkout %v", eu["hash"]), diagOut{Result: eu}, nil
	})

	mcp.AddTool(s, &mcp.Tool{Name: "in_platform",
		Description: "Read-only (config): lenders in-platform (response_type 2/3) candidatos por sucursal — id, nombre, rt, comercio, hash, si la branch es ecommerce. Para elegir contra qué (comercio, lender) correr el synth.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, listAnyOut, error) {
		db, err := connect(cfg)
		if err != nil {
			return errResult("DB dev: %v", err), listAnyOut{}, nil
		}
		defer db.Close()
		ip, err := opInPlatformLenders(db)
		if err != nil {
			return errResult("%v", err), listAnyOut{}, nil
		}
		return textResult("%d lenders in-platform", len(ip)), listAnyOut{Result: ip}, nil
	})

	type offersIn struct {
		Lender string `json:"lender"` // nombre o id del lender
	}
	mcp.AddTool(s, &mcp.Tool{Name: "lender_offers",
		Description: "Read-only (config): qué sucursales OFRECEN un lender (match por nombre/id), con hash, response_type y si tienen credencial ecommerce. Para elegir contra qué comercio correr el synth.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in offersIn) (*mcp.CallToolResult, listAnyOut, error) {
		db, err := connect(cfg)
		if err != nil {
			return errResult("DB dev: %v", err), listAnyOut{}, nil
		}
		defer db.Close()
		of, err := opLenderOffers(db, in.Lender)
		if err != nil {
			return errResult("%v", err), listAnyOut{}, nil
		}
		return textResult("%d sucursales ofrecen %q", len(of), in.Lender), listAnyOut{Result: of}, nil
	})

	type modeDiagIn struct {
		UserRequestID int `json:"user_request_id"`
		LenderID      int `json:"lender_id,omitempty"`
	}
	mcp.AddTool(s, &mcp.Tool{Name: "mode_diag",
		Description: "Read-only: diagnóstico de los user_request_modes (modos/categorías) de un user_request frente a un lender. Para entender por qué un lender se ofrece o no.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in modeDiagIn) (*mcp.CallToolResult, diagOut, error) {
		db, err := connect(cfg)
		if err != nil {
			return errResult("DB dev: %v", err), diagOut{}, nil
		}
		defer db.Close()
		md, err := opModeDiag(db, in.UserRequestID, in.LenderID)
		if err != nil {
			return errResult("%v", err), diagOut{Result: md}, nil
		}
		return textResult("mode_diag req #%d", in.UserRequestID), diagOut{Result: md}, nil
	})

	mcp.AddTool(s, &mcp.Tool{Name: "datacredito_rules",
		Description: "Read-only (config): lender_datacredito_rules (score mínimo Datacrédito/Experian por sucursal) de un lender. Para saber qué score exige (lenders de integración rt≠2).",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in grIn) (*mcp.CallToolResult, diagOut, error) {
		db, err := connect(cfg)
		if err != nil {
			return errResult("DB dev: %v", err), diagOut{}, nil
		}
		defer db.Close()
		dr, err := opLenderDatacreditoRules(db, in.Hash, in.LenderID)
		if err != nil {
			return errResult("%v", err), diagOut{Result: dr}, nil
		}
		return textResult("dc rules de %d en %s", in.LenderID, in.Hash), diagOut{Result: dr}, nil
	})

	type scrubIn struct {
		Phone string `json:"phone"`
	}
	mcp.AddTool(s, &mcp.Tool{Name: "scrub_phone",
		Description: "WRITE: borra los users CLIENTE (cognito_id NULL) de un teléfono + sus requests/hijos, por clave — para que el próximo register cree un TEMPORAL USER → /personal-info. NUNCA toca asesores. Requiere I_KNOW_THIS_TOUCHES_SHARED_DEV=1.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in scrubIn) (*mcp.CallToolResult, diagOut, error) {
		if !guardOK() {
			return errResult("guard: I_KNOW_THIS_TOUCHES_SHARED_DEV=1"), diagOut{}, nil
		}
		db, err := connect(cfg)
		if err != nil {
			return errResult("DB dev: %v", err), diagOut{}, nil
		}
		defer db.Close()
		sp, err := opScrubPhone(db, in.Phone)
		if err != nil {
			return errResult("%v", err), diagOut{Result: sp}, nil
		}
		return textResult("%v cliente(s) borrado(s)", sp["users_deleted"]), diagOut{Result: sp}, nil
	})

	type assignIn struct {
		Query      string `json:"query"`              // email o cognito_id del asesor
		Merchant   string `json:"merchant"`           // comercio destino (slug/nombre/hash)
		BranchHash string `json:"branch_hash,omitempty"`
		RealSub    string `json:"real_sub,omitempty"` // sub REAL del login web (corrige cognito_id viejo)
	}
	mcp.AddTool(s, &mcp.Tool{Name: "assign_asesor",
		Description: "WRITE: asocia un asesor (por email o cognito_id) a la sucursal de un comercio (UPDATE users; INSERT si q es un sub sin fila). Guarda snapshot para revoke. Requiere I_KNOW_THIS_TOUCHES_SHARED_DEV=1.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in assignIn) (*mcp.CallToolResult, diagOut, error) {
		if !guardOK() {
			return errResult("guard: I_KNOW_THIS_TOUCHES_SHARED_DEV=1"), diagOut{}, nil
		}
		db, err := connect(cfg)
		if err != nil {
			return errResult("DB dev: %v", err), diagOut{}, nil
		}
		defer db.Close()
		as, err := opAsesorAssign(db, cfg, in.Query, in.Merchant, in.BranchHash, in.RealSub)
		if err != nil {
			return errResult("%v", err), diagOut{Result: as}, nil
		}
		return textResult("%q → %s", in.Query, in.Merchant), diagOut{Result: as}, nil
	})

	mcp.AddTool(s, &mcp.Tool{Name: "revoke_asesor",
		Description: "WRITE: revierte el último assign_asesor usando el snapshot (.asesor-snapshot.json): restaura el estado previo o borra la fila si la creó el assign. Requiere I_KNOW_THIS_TOUCHES_SHARED_DEV=1.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, diagOut, error) {
		if !guardOK() {
			return errResult("guard: I_KNOW_THIS_TOUCHES_SHARED_DEV=1"), diagOut{}, nil
		}
		db, err := connect(cfg)
		if err != nil {
			return errResult("DB dev: %v", err), diagOut{}, nil
		}
		defer db.Close()
		rv, err := opAsesorRevoke(db)
		if err != nil {
			return errResult("%v", err), diagOut{Result: rv}, nil
		}
		return textResult("revertido"), diagOut{Result: rv}, nil
	})

	type synthFillIn struct {
		UserRequestID int    `json:"user_request_id"`
		Lender        string `json:"lender,omitempty"` // rule-driven: deriva el perfil de las reglas del lender
		Income        int    `json:"income,omitempty"`
		Score         int    `json:"score,omitempty"`
	}
	mcp.AddTool(s, &mcp.Tool{Name: "synth_fill",
		Description: "WRITE: INYECTA el KYC armado en un user_request EXISTENTE (identidad+age, user_summaries agildata+datacredito, field 87/29/160, fila Experian encriptada) — sin centrales. Navegá luego a /lenders. Requiere I_KNOW_THIS_TOUCHES_SHARED_DEV=1.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in synthFillIn) (*mcp.CallToolResult, diagOut, error) {
		if !guardOK() {
			return errResult("guard: I_KNOW_THIS_TOUCHES_SHARED_DEV=1"), diagOut{}, nil
		}
		db, err := connect(cfg)
		if err != nil {
			return errResult("DB dev: %v", err), diagOut{}, nil
		}
		defer db.Close()
		sf, err := opSynthFill(db, cfg, in.UserRequestID, in.Lender, in.Income, in.Score)
		if err != nil {
			return errResult("%v", err), diagOut{Result: sf}, nil
		}
		return textResult("KYC armado en req #%d", in.UserRequestID), diagOut{Result: sf}, nil
	})
}
