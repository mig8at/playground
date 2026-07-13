// CLI del suite E2E, organizado por el modelo [channel] → [merchant] → [lender].
//
//	go run . <web|asesor> <comercio> <lender[,lender2,...]>   compone y corre el flujo (lista = matriz)
//	go run . list                                             lista comercios y lenders (de la BD)
//	go run . setup                                            migra el esquema base + seed (BD local nueva)
//
// Subcomandos de operación sobre la BD local (consolidados del extinto creditop-cli):
//
//	go run . prep --merchant X --lender Y     siembra precondicionales (exports E2E_* para eval)
//	go run . get <kind> <arg> [--json]        inspector read-only (user-request|merchant|lender)
//	go run . doctor [--json]                  diagnóstico del setup local (8 checks)
//	go run . clean [--seed X]                 borra el namespace que sembró prep
//
// (Ver `go run . help` para la lista completa, incl. offer/perfilador/random/smartpay.)
//
// Ejemplos:
//
//	go run . web pullman credipullman
//	go run . asesor alkosto 160
//	go run . asesor standard 77,160        # matriz multi-lender
package main

import (
	"creditop-tests/channel"
	"creditop-tests/lender"
	"creditop-tests/merchant"
	"creditop-tests/pkg/client"
	"creditop-tests/pkg/config"
	"creditop-tests/pkg/database"
	"creditop-tests/pkg/flow"
	"creditop-tests/pkg/mocks"
	"database/sql"
	"fmt"
	"math/rand"
	"os"
	"strconv"
	"strings"
)

// explain = modo documentación: imprime el paso a paso de los flujos SIN ejecutar (flag --explain).
var explain bool

// target = ambiente destino: "local" (default) | "dev" (flag --target=dev). En dev se permiten los
// comandos read-only (list/get/doctor/login) + los acotados por namespace/clave (create/clean); el
// flujo de origination completo rehúsa --target≠local hasta endurecerlo contra hosts compartidos.
var target = "local"

func main() {
	args := stripTarget(stripExplain(os.Args[1:]))
	if len(args) == 0 || args[0] == "help" || args[0] == "-h" || args[0] == "--help" {
		usage()
		return
	}
	// Guarda de seguridad para --target=dev (BD compartida). Permitido: comandos READ-ONLY (list/get/
	// doctor/login) + los WRITE acotados por NAMESPACE/clave con guard I_KNOW: `create` siembra una fila
	// namespaced y `clean` borra SOLO el namespace del seed + el ledger del target (nunca bulk — ver clean.go).
	// BLOQUEADO en dev: el flujo de origination completo (web/asesor), setup, prep, random — escriben
	// solicitudes reales fuera de un namespace acotado; pendiente de endurecer antes de abrirlos a dev.
	devAllowed := map[string]bool{"list": true, "get": true, "doctor": true, "login": true, "create": true, "clean": true, "scenarios": true}
	// Flujo completo (web/vtex/asesor) contra dev: permitido SOLO con el guard explícito
	// I_KNOW_THIS_TOUCHES_SHARED_DEV. Escribe a shared dev (1 user_request + ecommerce_request
	// sintéticos), útil para validar un deploy contra dev de extremo a extremo.
	flowOnDev := (args[0] == "web" || args[0] == "vtex" || args[0] == "asesor" || args[0] == "aggregator" || args[0] == "flow" || args[0] == "scenario" || args[0] == "offer" || args[0] == "perfilador") &&
		os.Getenv("I_KNOW_THIS_TOUCHES_SHARED_DEV") == "1"
	if target != "local" && !devAllowed[args[0]] && !flowOnDev {
		fmt.Fprintf(os.Stderr, "%s✗ --target=%s no está soportado en `%s` (solo: list/get/doctor/login/create/clean)%s\n", client.CRed, target, args[0], client.CReset)
		fmt.Fprintln(os.Stderr, "  el flujo completo escribe solicitudes reales fuera de un namespace acotado — exporta I_KNOW_THIS_TOUCHES_SHARED_DEV=1 para habilitarlo contra dev")
		os.Exit(2)
	}
	switch args[0] {
	case "list":
		listCatalog()
	case "setup":
		setup()
	case "offer":
		if len(args) < 2 {
			usage()
			os.Exit(2)
		}
		runOffer(args[1])
	case "comparev2":
		if len(args) < 2 {
			fmt.Println("uso: go run . comparev2 <comercio>   (onboardea y compara /lenders v1 vs /lenders-v2)")
			os.Exit(2)
		}
		runCompareV2(args[1])
	case "smartpay":
		branch := "3e67eade"
		if len(args) > 1 {
			branch = args[1]
		}
		runSmartpay(branch)
	case "aggregator":
		if len(args) < 2 {
			fmt.Println("uso: go run . aggregator <comercio> [status=11]   (simula el webhook de un lender agregador)")
			os.Exit(2)
		}
		status := 11
		if len(args) > 2 {
			if v, err := strconv.Atoi(args[2]); err == nil {
				status = v
			}
		}
		runAggregatorSim(args[1], status)
	case "flow":
		if len(args) < 4 {
			fmt.Println("uso: go run . flow <ecommerce> <merchant> <lender> [state=approved]   (comando unificado)")
			fmt.Println("ej:  go run . flow vtex pullman credipullman      ·      go run . flow vtex pullman bancolombia rejected")
			os.Exit(2)
		}
		state := "approved"
		if len(args) > 4 {
			state = args[4]
		}
		runFlow(args[1], args[2], args[3], state)
	case "scenario":
		if len(args) < 2 {
			fmt.Println("uso: go run . scenario <name>   (presets.json · `go run . scenarios` lista)")
			os.Exit(2)
		}
		runScenario(args[1])
	case "scenarios":
		listScenarios()
	case "perfilador":
		if len(args) < 3 {
			fmt.Println("uso: go run . perfilador <comercio> <lender>")
			os.Exit(2)
		}
		runPerfilador(args[1], args[2])
	case "random":
		n := 5
		if len(args) > 1 {
			if v, err := strconv.Atoi(args[1]); err == nil && v > 0 {
				n = v
			}
		}
		runRandom(n)
	case "prep":
		runPrep(args[1:])
	case "get":
		os.Exit(runGet(args[1:]))
	case "doctor":
		os.Exit(runDoctor(args[1:]))
	case "login":
		os.Exit(runLogin(args[1:]))
	case "create":
		runCreate(args[1:])
	case "clean":
		os.Exit(runClean(args[1:]))
	default:
		if len(args) < 3 {
			usage()
			os.Exit(2)
		}
		runDynamic(args[0], args[1], args[2])
	}
}

func usage() {
	fmt.Print(`uso:

flujo E2E:
  go run . <web|asesor|vtex> <comercio> <lender[,lender2,...]>   compone y corre el flujo (lista = matriz)
                                                            vtex: el harness hace de conector VTEX (init base64 → create → cierre → webhook → settel)
  go run . aggregator <comercio> [status=11]                simula el webhook de un lender agregador (entrada ecommerce + cambio de estado → observer notifica)

descubrimiento / diagnóstico de flujos:
  go run . list                                             lista comercios y lenders (de la BD)
  go run . offer <comercio>                                 qué lenders ofrece un comercio (GET /lenders)
  go run . perfilador <comercio> <lender>                   valida el motor de riesgo (perfil → ¿ofrecido?)
  go run . random [N]                                       N tripletas VÁLIDAS al azar (lenders_by_allieds) E2E
  go run . smartpay [branch]                                cadena OTP+submit de SmartPay (sin microservicio)

operación (BD local):
  go run . prep --merchant X --lender Y [--asesor n] [--branch h]   siembra precondicionales (exports para eval)
  go run . get <user-request|merchant|lender> <arg> [--json]   inspector read-only de un recurso
  go run . create <role> <merchant> [branchHash]           crea un usuario sintético (rol+comercio+branch) namespaced
  go run . doctor [--json]                                  diagnóstico del setup local (8 checks)
  go run . login [--show-token]                             prueba de login Cognito REAL (env E2E_COGNITO_*; read-only, no toca BD)
  go run . clean [--seed X]                                 borra el namespace del seed + recursos del ledger (uno a uno, nunca bulk)

target (list/get/doctor/login read-only + create/clean acotados; el flujo completo aún no):
  --target=dev   apunta a dev compartido (lee E2E_DB_*/E2E_API_BASE_URL de .env.dev).
                 Los WRITE/DELETE exigen I_KNOW_THIS_TOUCHES_SHARED_DEV=1. Default: local.
  go run . setup                                            migra el esquema base + seed

flag global:
  --explain   imprime el paso a paso DOCUMENTADO del flujo sin ejecutar (no toca el backend)

ejemplos:
  go run . web pullman credipullman
  go run . vtex pullman credipullman    # simula VTEX: legacy genera el base64, valida webhook + settel
  go run . aggregator pullman           # simula un agregador: cambia el estado → el observer notifica al comercio
  go run . asesor alkosto 160
  go run . asesor standard 77,160        # matriz multi-lender
  go run . asesor 3e67eade 77 --explain  # documenta el flujo, no lo corre
`)
}

// stripExplain saca el flag --explain (en cualquier posición) y setea la variable global.
func stripExplain(args []string) []string {
	out := args[:0:0]
	for _, a := range args {
		if a == "--explain" || a == "-explain" {
			explain = true
			continue
		}
		out = append(out, a)
	}
	return out
}

// stripTarget saca --target=X / --target X (en cualquier posición) y setea la global target.
func stripTarget(args []string) []string {
	out := args[:0:0]
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
	return out
}

// runDynamic resuelve comercio+lender(es) por nombre desde la BD y corre [canal]→[comercio]→[lender].
// Si <lender> trae comas, corre una matriz (un cierre por lender, con datos aislados).
func runDynamic(channelArg, comercioArg, lenderArg string) {
	ch := channel.Channel(channelArg)
	if !ch.Valid() {
		client.FatalError(fmt.Sprintf("canal %q inválido (usa web|asesor|vtex)", channelArg), nil, nil)
	}

	base := config.GetConfig(target)
	db := database.Connect(base)
	m, err := merchant.Resolve(db, comercioArg)
	if err != nil {
		db.Close()
		client.FatalError("resolviendo comercio", err, nil)
	}
	var lenders []lender.Lender
	for _, q := range strings.Split(lenderArg, ",") {
		l, err := lender.Resolve(db, strings.TrimSpace(q))
		if err != nil {
			db.Close()
			client.FatalError("resolviendo lender", err, nil)
		}
		lenders = append(lenders, l)
	}
	db.Close()
	base.PartnerHash = m.Hash

	fail := 0
	for i, l := range lenders {
		cfg := variant(base, i)
		if err := runOne(cfg, ch, m, l); err != nil {
			fail++
		}
	}
	if len(lenders) > 1 {
		fmt.Printf("\n=== MATRIZ: %d ✅ / %d ❌ (de %d lenders) ===\n", len(lenders)-fail, fail, len(lenders))
	}
	if fail > 0 {
		os.Exit(1)
	}
}

// runOne compone el triplete como UN flujo numerado: entrada del canal → verificación del comercio →
// cierre del lender. Con --explain solo imprime la documentación del flujo (sin ejecutar ni tocar la BD).
// Los overrides específicos del lender (p.ej. TestDoc de Bancolombia) los aplica la estrategia.
func runOne(cfg config.TestConfig, ch channel.Channel, m merchant.Merchant, l lender.Lender) error {
	cfg = l.ApplyOverrides(cfg)
	db := database.Connect(cfg)
	defer db.Close()

	var entry []flow.Step
	var store *channel.StoreWebhook
	// process_url público (webhook.site) tiene prioridad: necesario para --target=dev (el cluster no
	// alcanza el mock local). Si está, NO levantamos el listener local; verificamos con processed=1.
	publicStore := os.Getenv("E2E_STORE_WEBHOOK_URL")
	// web y vtex son entradas ecommerce: ambas notifican al comercio al cerrar (process_url).
	ecommerce := ch == channel.Web || ch == channel.Vtex
	if ecommerce {
		if publicStore != "" {
			client.PrintRule(fmt.Sprintf("webhook de tienda → %s (URL pública; se verifica processed=1 + el payload allá)", publicStore))
		} else if sw, err := channel.StartStoreWebhook(); err == nil {
			// Mock store listener: capture the close-time webhook (process_url) so we can
			// assert the store was notified. Only point process_url at it if it came up.
			store = sw
			channel.StoreWebhookURL = sw.URL()
			defer func() { channel.StoreWebhookURL = ""; sw.Close() }()
		} else {
			client.PrintRule(fmt.Sprintf("⚠ listener de tienda no disponible en :9099 (%v) — webhook no se verificará", err))
		}
		if ch == channel.Vtex {
			entry = channel.VtexSteps(db, cfg, m, channel.Person{})
		} else {
			entry = channel.WebSteps(db, cfg, m, channel.Person{})
		}
	} else {
		entry = channel.AsesorSteps(db, cfg, m, channel.Person{})
	}

	f := flow.New(
		fmt.Sprintf("%s → %s (%s) → %s #%d (rt=%d)", ch, m.Name, m.Hash, l.Name, l.ID, l.ResponseType),
		l.Summary(),
	)
	f.Add(entry...)
	f.Step(
		fmt.Sprintf("Verificación de comercio (%s)", m.Kind),
		"Diagnóstico del comportamiento que el comercio dispara en el backend (Quanto/Corbeta/Motai). No bloquea el cierre: el cierre siembra el perfil aprobado de todos modos.",
		func(c *flow.Ctx) (string, error) {
			if err := m.Verify(db, c.Int64("uReqID")); err != nil {
				return fmt.Sprintf("diagnóstico %s: %v (no bloquea)", m.Kind, err), nil
			}
			if m.Kind == merchant.Standard {
				return "comercio estándar (sin comportamiento especial)", nil
			}
			return fmt.Sprintf("comportamiento %s verificado", m.Kind), nil
		},
	)
	f.Add(lender.CloseSteps(db, cfg, l)...)

	// Ecommerce (web/vtex): assert the close-time webhook actually fired (el gap previo — Estado 11
	// solo nunca probó la notificación). Con listener local verificamos el POST; con URL pública
	// (dev/webhook.site) verificamos processed=1 y el payload se revisa allá.
	if ecommerce {
		f.Step(
			"Notificación al comercio (webhook de cierre)",
			"Tras Estado 11 el backend notifica al process_url (processEcommerceTransaction) y marca ecommerce_requests.processed=1.",
			func(c *flow.Ctx) (string, error) {
				return storeNotifyAssert(db, store, publicStore, c.Int64("uReqID"))
			},
		)
	}

	// VTEX only: confirma el settle del protocolo (POST /vtex/settel). Solo aprueba en Estado 11.
	if ch == channel.Vtex {
		f.Step(
			"VTEX settle (/vtex/settel) — verifica Estado 11",
			"El harness (como conector VTEX) confirma el settle: POST /vtex/settel. Legacy responde success:true solo si el user_request llegó a Estado 11 (Autorizada).",
			func(c *flow.Ctx) (string, error) {
				resp, err := channel.VtexSettle(cfg, c.Str("vtexPaymentId"), c.Str("vtexOrderId"))
				if err != nil {
					return "", fmt.Errorf("vtex/settel: %w", err)
				}
				if ok, _ := resp["success"].(bool); !ok {
					return "", fmt.Errorf("settel no aprobó (¿Estado != 11?): %v", resp)
				}
				settleID, _ := resp["settleId"].(string)
				return fmt.Sprintf("settle aprobado · settleId=%s", settleID), nil
			},
		)
	}

	if explain {
		f.Explain()
		return nil
	}
	database.Clean(db, cfg.TestPhone, cfg.TestDoc, cfg.TestEmail)
	return f.Run()
}

// runAggregatorSim simula el webhook de un lender AGREGADOR (Bancolombia/Sistecrédito): hace la
// entrada ecommerce (init+create+onboarding, SIN cierre — el harness no puede cerrar agregadores) y
// luego cambia el estado del user_request vía el simulador (que hace el update por Eloquent en el
// backend) → UserRequestObserver notifica al comercio. Verifica processed=1 + el POST capturado.
func runAggregatorSim(merchantArg string, status int) {
	base := config.GetConfig(target)
	db := database.Connect(base)
	m, err := merchant.Resolve(db, merchantArg)
	if err != nil {
		db.Close()
		client.FatalError("resolviendo comercio", err, nil)
	}
	base.PartnerHash = m.Hash
	cfg := base
	defer db.Close()

	// Receptor del webhook: público (E2E_STORE_WEBHOOK_URL, p.ej. dev/webhook.site) o mock local.
	publicStore := os.Getenv("E2E_STORE_WEBHOOK_URL")
	var store *channel.StoreWebhook
	if publicStore != "" {
		client.PrintRule(fmt.Sprintf("webhook de tienda → %s (URL pública)", publicStore))
	} else if sw, err := channel.StartStoreWebhook(); err == nil {
		store = sw
		channel.StoreWebhookURL = sw.URL()
		defer func() { channel.StoreWebhookURL = ""; sw.Close() }()
	} else {
		client.PrintRule(fmt.Sprintf("⚠ listener de tienda no disponible en :9099 (%v) — webhook no se verificará", err))
	}

	f := flow.New(
		fmt.Sprintf("aggregator-sim → %s (%s) → estado %d", m.Name, m.Hash, status),
		"Simula el webhook de un lender agregador: entrada ecommerce (sin cierre) + cambio de estado vía Eloquent → UserRequestObserver notifica al comercio.",
	)
	// Entrada ecommerce (sin cierre): crea el user_request ligado al ecommerce_request.
	f.Add(channel.VtexSteps(db, cfg, m, channel.Person{})...)

	f.Step(
		"Simular resultado del agregador (cambio de estado)",
		fmt.Sprintf("POST al simulador → cambia el user_request a estado %d vía Eloquent (como el webhook de Bancolombia/Sistecrédito). Dispara UserRequestObserver.", status),
		func(c *flow.Ctx) (string, error) {
			uReqID := c.Int64("uReqID")
			resp, err := channel.SimulateAggregatorResult(cfg, uReqID, status)
			if err != nil {
				return "", fmt.Errorf("simulador: %w", err)
			}
			if ok, _ := resp["simulated"].(bool); !ok {
				return "", fmt.Errorf("el simulador no confirmó (¿prod? ¿estado no final?): %v", resp)
			}
			return fmt.Sprintf("user_request #%d → estado %d (simulado como agregador)", uReqID, status), nil
		},
	)

	f.Step(
		"Notificación al comercio (UserRequestObserver)",
		"El observer, al ver el estado final, notifica al process_url (processEcommerceTransaction) y marca ecommerce_requests.processed=1.",
		func(c *flow.Ctx) (string, error) {
			return storeNotifyAssert(db, store, publicStore, c.Int64("uReqID"))
		},
	)

	if explain {
		f.Explain()
		return
	}
	database.Clean(db, cfg.TestPhone, cfg.TestDoc, cfg.TestEmail)
	if err := f.Run(); err != nil {
		os.Exit(1)
	}
}

func variant(cfg config.TestConfig, n int) config.TestConfig {
	cfg.TestPhone = fmt.Sprintf("30%08d", 99000000+n)
	cfg.TestDoc = fmt.Sprintf("10%08d", 99000000+n)
	cfg.TestEmail = fmt.Sprintf("dynamic.%d@creditop.com", n)
	return cfg
}

// runSmartpay valida la cadena OTP+submit de SmartPay replicando lo que el microservicio
// onboarding-forms-service hace contra el legacy-backend (el micro es solo un proxy). Cadena:
//  1. backdoor/create-temporary-user   (lo que dispara send-otp)      → BDUS002
//  2. backdoor/check-user-exists        (lo que dispara validate-otp)  → BDUS003
//  3. backdoor/accept-terms             (validate-otp, terms 14/15)    → BDTM002
//  4. dynamic-forms/create-user         (el SUBMIT: originación)       → DYFS1001 (+ userRequestId)
//  5. backdoor/resolve-lenders-redirect (redirect final, best-effort)  → BDUS005
//
// El esquema del formulario (que pide create-user al micro) lo sirve el fake del legacy-backend
// (AppServiceProvider::fakeDynamicFormsServiceForLocal). El paso OTP generate/validate en sí es un
// hop micro↔otp-service (sin endpoint en legacy-backend), fuera de este alcance legacy-only.
func runSmartpay(branch string) {
	cfg := config.GetConfig(target)
	// Teléfono en formato internacional: createTemporaryUser guarda el phone CRUDO, pero
	// check-user-exists/resolve normalizan a "+"+dígitos para el lookup. Usar el mismo "+57…" en
	// toda la cadena hace que lo guardado coincida con lo buscado (si no, BDUS004 usuario no encontrado).
	cfg.TestPhone = "+573098000123"
	cfg.TestDoc = "1098000123"
	cfg.TestEmail = "smartpay.e2e@creditop.com"
	auth := map[string]string{"Authorization": "Bearer " + cfg.BackdoorAPIKey}
	bd := cfg.ApiBaseURL + "/onboarding/backdoor"

	f := flow.New(
		fmt.Sprintf("SMARTPAY · cadena OTP+submit · branch=%s", branch),
		"Replica lo que el microservicio onboarding-forms-service hace contra legacy-backend (el micro es solo un proxy; no se levanta).",
	)
	f.Step("create-temporary-user (send-otp)",
		"backdoor/create-temporary-user: lo que el send-otp del formulario dinámico dispara en el backend → BDUS002.",
		func(c *flow.Ctx) (string, error) {
			r, err := client.PostWithHeaders(bd+"/create-temporary-user",
				map[string]interface{}{"phoneNumber": cfg.TestPhone, "alliedBranchId": branch, "amount": cfg.TestAmount, "original_amount": cfg.TestAmount}, auth)
			return codeStep(r, err, "BDUS002")
		})
	f.Step("check-user-exists (validate-otp)",
		"backdoor/check-user-exists: lo que el validate-otp consulta → BDUS003 (+ userId).",
		func(c *flow.Ctx) (string, error) {
			r, err := client.PostWithHeaders(bd+"/check-user-exists",
				map[string]interface{}{"phoneNumber": cfg.TestPhone, "alliedBranchId": branch}, auth)
			if d, e := codeStep(r, err, "BDUS003"); e != nil {
				return d, e
			}
			c.Set("userID", nestedInt(r, "data", "userId"))
			return fmt.Sprintf("BDUS003 · userId=%d", c.Int("userID")), nil
		})
	f.Step("accept-terms (políticas SmartPay 14/15)",
		"backdoor/accept-terms: acepta los términos 14/15 dentro de validate-otp → BDTM002.",
		func(c *flow.Ctx) (string, error) {
			r, err := client.PostWithHeaders(bd+"/accept-terms",
				map[string]interface{}{"userId": c.Int("userID"), "termsAndConditionsIds": []int{14, 15}}, auth)
			return codeStep(r, err, "BDTM002")
		})
	f.Step("dynamic-forms/create-user (SUBMIT → originación)",
		"El SUBMIT del formulario dinámico: crea users + user_request + user_field_values → DYFS1001 (+ userRequestId).",
		func(c *flow.Ctx) (string, error) {
			r, err := client.Post(cfg.ApiBaseURL+"/onboarding/dynamic-forms/create-user",
				map[string]interface{}{
					"id": "550e8400-e29b-41d4-a716-446655440000", "hash": branch,
					"data": map[string]interface{}{
						"phoneNumber": cfg.TestPhone, "firstName": "Test", "lastName": "Smartpay",
						"email": cfg.TestEmail, "documentType": "CC", "nationalIdentityNumber": cfg.TestDoc,
						"birthDate": "1990-05-15", "amount": fmt.Sprint(cfg.TestAmount),
					},
				})
			if d, e := codeStep(r, err, "DYFS1001"); e != nil {
				return d, e
			}
			return fmt.Sprintf("DYFS1001 · user_request #%d creado", nestedInt(r, "data", "userRequestId")), nil
		})
	f.Step("resolve-lenders-redirect (best-effort)",
		"backdoor/resolve-lenders-redirect: arma el redirect final al marketplace (depende de UrlGenerationService; el SUBMIT ya quedó validado).",
		func(c *flow.Ctx) (string, error) {
			r, err := client.PostWithHeaders(bd+"/resolve-lenders-redirect",
				map[string]interface{}{"hash": branch, "phoneNumber": cfg.TestPhone}, auth)
			if err != nil || codeOf(r) != "BDUS005" {
				return fmt.Sprintf("⚠ no completó (code=%q) — best-effort; el SUBMIT ya quedó validado", codeOf(r)), nil
			}
			return fmt.Sprintf("BDUS005 · redirect=%v", nested(r, "data", "redirectUrl")), nil
		})

	if explain {
		f.Explain()
		return
	}
	db := database.Connect(cfg)
	database.Clean(db, cfg.TestPhone, cfg.TestDoc, cfg.TestEmail)
	db.Close()
	if err := f.Run(); err != nil {
		os.Exit(1)
	}
}

// --- helpers SmartPay ---

func codeOf(r map[string]interface{}) string { s, _ := r["code"].(string); return s }

// codeStep valida que la respuesta traiga el code esperado; devuelve (detalle, error) para un paso.
func codeStep(r map[string]interface{}, err error, want string) (string, error) {
	if err != nil {
		return "", fmt.Errorf("error HTTP: %w", err)
	}
	if got := codeOf(r); got != want {
		return "", fmt.Errorf("code=%q (esperado %q)", got, want)
	}
	return "→ " + want, nil
}

func nested(r map[string]interface{}, k1, k2 string) interface{} {
	if d, ok := r[k1].(map[string]interface{}); ok {
		return d[k2]
	}
	return nil
}

func nestedInt(r map[string]interface{}, k1, k2 string) int {
	if f, ok := nested(r, k1, k2).(float64); ok {
		return int(f)
	}
	return 0
}

type perfiladorCase struct {
	name          string
	profile       mocks.RiskProfile
	expectOffered bool
}

// perfiladorOracle: umbrales REALES leídos de la BD local (no hardcodeados), para que las
// expectativas sobrevivan a cambios de config y validen la regla VIGENTE. Solo lectura (SELECT).
type perfiladorOracle struct {
	AlliedID        int
	RT              int    // response_type del lender (2/3 = CreditopX → group rules clasifican, no excluyen)
	IncomeThreshold int    // MAX(value) de lender_rules field 87 (ingreso) del allied → umbral del group rule
	IncomeOp        string // operador de esa regla (ej. ">=")
	ScoreMin        int    // MIN(min_score) de lender_users_category_rules → tier de categoría más laxo
}

// loadPerfiladorOracle lee de la BD los umbrales que gatean al lender objetivo para el allied del
// comercio. NO modifica nada (solo SELECT). Si no halla una regla, deja 0 → ese caso se omite.
func loadPerfiladorOracle(db *sql.DB, branchHash string, lenderID int) perfiladorOracle {
	var o perfiladorOracle
	db.QueryRow("SELECT allied_id FROM allied_branches WHERE hash = ? LIMIT 1", branchHash).Scan(&o.AlliedID)
	db.QueryRow("SELECT response_type FROM lenders WHERE id = ? LIMIT 1", lenderID).Scan(&o.RT)
	// Ingreso: la regla MÁS estricta (MAX) sobre field 87 entre los group_rules del allied.
	db.QueryRow(`SELECT CAST(lr.value AS UNSIGNED) v, lr.operator
		FROM lender_rules lr
		JOIN group_rules gr ON gr.id = lr.group_rule_id
		JOIN allied_branches ab ON ab.id = gr.allied_branch_id
		WHERE ab.allied_id = ? AND lr.field_id = 87 AND CAST(lr.value AS UNSIGNED) > 0
		ORDER BY v DESC LIMIT 1`, o.AlliedID).Scan(&o.IncomeThreshold, &o.IncomeOp)
	o.IncomeOp = strings.TrimSpace(o.IncomeOp)
	if o.IncomeOp == "" {
		o.IncomeOp = ">="
	}
	// Score: el tier de categoría MÁS laxo (menor min_score) del lender rt=2.
	db.QueryRow("SELECT COALESCE(MIN(min_score),0) FROM lender_users_category_rules WHERE lender_id = ?", lenderID).Scan(&o.ScoreMin)
	return o
}

// buildPerfiladorCases arma la matriz de borde DERIVANDO los valores del oracle (umbrales reales de
// BD), no hardcodeados. Así "1M exacto" deja de ser una expectativa stale: si el umbral real es 1.3M,
// el caso "ingreso = umbral-1" espera RECHAZO y "= umbral" espera oferta según el operador leído.
func buildPerfiladorCases(o perfiladorOracle) []perfiladorCase {
	goodScore := o.ScoreMin + 300
	if goodScore < 800 {
		goodScore = 800
	}
	goodIncome := o.IncomeThreshold + 1_000_000
	if goodIncome < 2_500_000 {
		goodIncome = 2_500_000
	}
	cs := []perfiladorCase{
		{"BUENO: perfil limpio (score e ingreso por encima del umbral)", mocks.RiskProfile{Score: goodScore, Income: goodIncome}, true},
	}
	if o.ScoreMin > 0 {
		cs = append(cs,
			perfiladorCase{fmt.Sprintf("RECHAZO score: %d (< min_score categoría %d)", o.ScoreMin-1, o.ScoreMin), mocks.RiskProfile{Score: o.ScoreMin - 1, Income: goodIncome}, false},
			perfiladorCase{fmt.Sprintf("BORDE score: %d exacto (>= %d)", o.ScoreMin, o.ScoreMin), mocks.RiskProfile{Score: o.ScoreMin, Income: goodIncome}, true},
		)
	}
	// Ingreso (group rule field 87): es FILTRO DURO solo para rt!=2. Para rt=2/3 (CreditopX) los
	// group rules CLASIFICAN (no excluyen) — verificado: ingreso justo bajo el umbral igual se ofrece;
	// el gate de ingreso real para rt=2 es indirecto (capacidad de endeudamiento de la categoría), no
	// un borde limpio, así que no se asevera aquí.
	if o.IncomeThreshold > 0 && o.RT != 2 && o.RT != 3 {
		atOffered := o.IncomeOp != ">" // ">=" → el umbral exacto SÍ se ofrece; ">" → no
		cs = append(cs,
			perfiladorCase{fmt.Sprintf("RECHAZO ingreso: %d (< umbral %d, field 87)", o.IncomeThreshold-1, o.IncomeThreshold), mocks.RiskProfile{Score: goodScore, Income: o.IncomeThreshold - 1}, false},
			perfiladorCase{fmt.Sprintf("BORDE ingreso: %d exacto (%s %d)", o.IncomeThreshold, o.IncomeOp, o.IncomeThreshold), mocks.RiskProfile{Score: goodScore, Income: o.IncomeThreshold}, atOffered},
		)
	}
	cs = append(cs,
		perfiladorCase{"RECHAZO reportado en centrales (field 160=si)", mocks.RiskProfile{Score: goodScore, Income: goodIncome, Reportado: true}, false},
		perfiladorCase{"RECHAZO edad: 95 (sobre cualquier tope)", mocks.RiskProfile{Score: goodScore, Income: goodIncome, Age: 95}, false},
		perfiladorCase{"BORDE edad: 18 (mínimo)", mocks.RiskProfile{Score: goodScore, Income: goodIncome, Age: 18}, true},
	)
	return cs
}

// runPerfilador VALIDA EL MOTOR DE RIESGO (no solo la mecánica de cierre): varía el perfil del usuario
// (score, reportado, ingreso, edad) y comprueba que el marketplace OFRECE o RECHAZA el lender objetivo
// según sus reglas duras (lender_rules) + datacrédito (lender_datacredito_rules). Cada caso corre en un
// usuario fresco: entrada → siembra perfil controlado → GET /lenders → ¿ofrecido? + lee
// profiling_reviews.hard_rules. La matriz de casos vive en `perfiladorCases` (calibrada a #77).
func runPerfilador(comercioArg, lenderArg string) {
	base := config.GetConfig(target)
	db := database.Connect(base)
	m, err := merchant.Resolve(db, comercioArg)
	if err != nil {
		db.Close()
		client.FatalError("resolviendo comercio", err, nil)
	}
	l, err := lender.Resolve(db, lenderArg)
	if err != nil {
		db.Close()
		client.FatalError("resolviendo lender", err, nil)
	}
	base.PartnerHash = m.Hash

	oracle := loadPerfiladorOracle(db, m.Hash, l.ID)
	cases := buildPerfiladorCases(oracle)

	client.Banner(fmt.Sprintf("PERFILADOR · ¿%s (#%d) se ofrece según el perfil? · comercio %s", l.Name, l.ID, m.Name))
	incomeNote := "FILTRO DURO"
	if oracle.RT == 2 || oracle.RT == 3 {
		incomeNote = "CLASIFICADOR (rt=2/3 no excluye) → no se asevera borde duro"
	}
	fmt.Printf("Oracle (BD, allied %d, rt=%d): score categoría >= %d (gate duro) · ingreso group-rule %s %d → %s\n",
		oracle.AlliedID, oracle.RT, oracle.ScoreMin, oracle.IncomeOp, oracle.IncomeThreshold, incomeNote)

	fail := 0
	for i, c := range cases {
		cfg := variant(base, i+20) // offset para no chocar con otros flujos
		database.Clean(db, cfg.TestPhone, cfg.TestDoc, cfg.TestEmail)
		fmt.Printf("\n=== [%d] %s ===\n", i+1, c.name)

		uReqID, err := channel.Entry(db, cfg, channel.Asesor, m, channel.Person{})
		if err != nil {
			fmt.Printf("  🔴 entrada: %v\n", err)
			fail++
			continue
		}
		mocks.SeedRiskProfile(db, cfg.TestPhone, uReqID, c.profile)

		offered := channel.Marketplace(cfg, m.Hash, uReqID)
		isOffered := false
		var prob string
		for _, o := range offered {
			if o.ID == l.ID {
				isOffered = true
			}
		}
		prob = profilingSummary(db, uReqID, l.ID)

		ok := isOffered == c.expectOffered
		mark := "🟢"
		if !ok {
			mark = "🔴"
			fail++
		}
		estado := "NO ofrecido"
		if isOffered {
			estado = "OFRECIDO"
		}
		pr := c.profile.WithDefaults()
		fmt.Printf("  %s perfil(score=%d, ingreso=%d, edad=%d, neg=%d, reportado=%v) → %s (esperado: ofrecido=%v)\n",
			mark, pr.Score, pr.Income, pr.Age, pr.Negatives, pr.Reportado, estado, c.expectOffered)
		if prob != "" {
			fmt.Printf("     profiling_reviews: %s\n", prob)
		}
		fmt.Printf("     lenders ofrecidos: %s\n", offeredNames(offered))
	}
	db.Close()

	fmt.Printf("\n=== PERFILADOR: %d/%d casos como se esperaba ===\n", len(cases)-fail, len(cases))
	if fail > 0 {
		os.Exit(1)
	}
	fmt.Println("\n🟢 Motor de riesgo validado: la oferta cambia según el perfil (reglas duras + categorías).")
}

// profilingSummary lee la decisión del Perfilador para esta solicitud: la categoría/probabilidad del lender
// y si hay registro en profiling_reviews (hard_rules).
func profilingSummary(db *sql.DB, uReqID int64, lenderID int) string {
	var hardRules sql.NullString
	var recommended sql.NullInt64
	db.QueryRow("SELECT hard_rules, recommended_lender FROM profiling_reviews WHERE user_request_id = ? ORDER BY id DESC LIMIT 1", uReqID).Scan(&hardRules, &recommended)
	rec := "—"
	if recommended.Valid {
		rec = fmt.Sprint(recommended.Int64)
	}
	hr := "(sin registro)"
	if hardRules.Valid && hardRules.String != "" {
		hr = hardRules.String
		if len(hr) > 220 {
			hr = hr[:220] + "…"
		}
	}
	return fmt.Sprintf("recommended_lender=%s · hard_rules=%s", rec, hr)
}

func offeredNames(offered []channel.OfferedLender) string {
	if len(offered) == 0 {
		return "(ninguno)"
	}
	var b strings.Builder
	for i, o := range offered {
		if i > 0 {
			b.WriteString(", ")
		}
		fmt.Fprintf(&b, "%s(#%d,rt=%d)", o.Name, o.ID, o.ResponseType)
	}
	return b.String()
}

// runOffer hace onboarding (asesor) en un comercio y lista los lenders que el marketplace ofrece,
// para descubrir pares (comercio, lender) válidos.
func runOffer(comercio string) {
	cfg := config.GetConfig(target)
	cfg.TestPhone = "3099000000"
	cfg.TestDoc = "1009990001"
	cfg.TestEmail = "dynamic@creditop.com"
	db := database.Connect(cfg)
	defer db.Close()
	m, err := merchant.Resolve(db, comercio)
	if err != nil {
		client.FatalError("resolviendo comercio", err, nil)
	}
	cfg.PartnerHash = m.Hash
	database.Clean(db, cfg.TestPhone, cfg.TestDoc, cfg.TestEmail)

	client.Banner(fmt.Sprintf("OFFER · %s (%s) kind=%s", m.Name, m.Hash, m.Kind))
	uReqID, err := channel.Entry(db, cfg, channel.Asesor, m, channel.Person{})
	if err != nil {
		client.FatalError("entrada", err, nil)
	}
	// Sembramos perfil aprobado (datacrédito score 750) ANTES del marketplace: sin score el
	// filtrado por reglas duras deja la lista vacía (el usuario real llega con buró).
	mocks.SeedApprovedProfile(db, cfg.TestPhone, uReqID, 750)
	offered := channel.Marketplace(cfg, m.Hash, uReqID)
	fmt.Printf("\nLENDERS OFRECIDOS (%d):\n", len(offered))
	for _, l := range offered {
		fmt.Printf("  #%-4d  rt=%d  %s\n", l.ID, l.ResponseType, l.Name)
	}
}

// fetchLenders hace GET al endpoint de listado (v1 /lenders o v2 /lenders-v2) y devuelve los lenders
// crudos (data.lenders) como mapas, para comparar qué entidades y qué valores (probabilidad/cupo) trae cada uno.
func fetchLenders(cfg config.TestConfig, uReqID int64, v2 bool) []map[string]interface{} {
	path := "lenders"
	if v2 {
		path = "lenders-v2"
	}
	resp, err := client.Get(fmt.Sprintf("%s/onboarding/loan-application/%s/%d", cfg.ApiBaseURL, path, uReqID))
	if err != nil {
		fmt.Printf("  ⚠ GET /%s/%d: %v\n", path, uReqID, err)
		return nil
	}
	data, _ := resp["data"].(map[string]interface{})
	arr, _ := data["lenders"].([]interface{})
	var out []map[string]interface{}
	for _, it := range arr {
		if m, ok := it.(map[string]interface{}); ok {
			out = append(out, m)
		}
	}
	return out
}

func printLenders(title string, ls []map[string]interface{}) {
	fmt.Printf("\n%s (%d):\n", title, len(ls))
	for _, l := range ls {
		id := l["id"]
		name, _ := l["name"].(string)
		prob, _ := l["probability"].(string)
		avail := l["available"]
		if avail == nil {
			avail = l["available_amount"]
		}
		fmt.Printf("  id=%-5v rt=%-2v prob=%-22q cupo=%v  %s\n", id, l["response_type"], prob, avail, name)
	}
}

// runCompareV2 onboardea UNA vez y consulta los DOS endpoints de listado (v1 /lenders y v2 /lenders-v2)
// con el mismo user_request, para validar localmente el drift: qué entidades y qué valores (cupo/
// probabilidad) trae cada uno. (El wizard usa v2; el harness venía usando v1.)
func runCompareV2(comercioArg string) {
	cfg := config.GetConfig(target)
	cfg.TestPhone = "3000000000"
	cfg.TestDoc = "1000009999"
	cfg.TestEmail = "comparev2@creditop.com"
	db := database.Connect(cfg)
	defer db.Close()
	m, err := merchant.Resolve(db, comercioArg)
	if err != nil {
		client.FatalError("resolviendo comercio", err, nil)
	}
	cfg.PartnerHash = m.Hash
	database.Clean(db, cfg.TestPhone, cfg.TestDoc, cfg.TestEmail)

	client.Banner(fmt.Sprintf("COMPARE v1 vs v2 · %s (%s) kind=%s", m.Name, m.Hash, m.Kind))
	uReqID, err := channel.Entry(db, cfg, channel.Asesor, m, channel.Person{})
	if err != nil {
		client.FatalError("entrada", err, nil)
	}
	mocks.SeedApprovedProfile(db, cfg.TestPhone, uReqID, 750)
	fmt.Printf("user_request #%d\n", uReqID)

	v1 := fetchLenders(cfg, uReqID, false)
	v2 := fetchLenders(cfg, uReqID, true)
	printLenders("V1  /lenders        (ListLenderController · LenderRetrievalService)", v1)
	printLenders("V2  /lenders-v2     (LenderListingController · LenderListingService) ← el que usa el wizard", v2)

	idset := func(ls []map[string]interface{}) map[string]bool {
		s := map[string]bool{}
		for _, l := range ls {
			s[fmt.Sprintf("%v", l["id"])] = true
		}
		return s
	}
	s1, s2 := idset(v1), idset(v2)
	var onlyV1, onlyV2 []string
	for id := range s1 {
		if !s2[id] {
			onlyV1 = append(onlyV1, id)
		}
	}
	for id := range s2 {
		if !s1[id] {
			onlyV2 = append(onlyV2, id)
		}
	}
	fmt.Printf("\n── DIFF ──\n  solo en V1 (las que el wizard NO ve): %v\n  solo en V2: %v\n", onlyV1, onlyV2)
}

// runRandom elige N tripletas VÁLIDAS al azar y corre cada una E2E. La validez sale de
// `lenders_by_allieds` (qué lender está asociado a qué comercio) filtrado a los response_type con
// cierre montado (2 in-platform, 3 revolving, 24 Credifamilia, 68/100 Bancolombia). El canal es web
// si el branch es ecommerce (al azar) y asesor si no. Es el "smoke aleatorio" del motor genérico.
func runRandom(n int) {
	cfg := config.GetConfig(target)
	db := database.Connect(cfg)

	type cand struct {
		alliedID, lenderID, rt int
		name                   string
	}
	var pool []cand
	rows, err := db.Query(`
		SELECT DISTINCT lba.allied_id, l.id, l.response_type, COALESCE(l.name,'')
		FROM lenders_by_allieds lba
		JOIN lenders l ON l.id = lba.lender_id AND l.status = 1
		WHERE lba.status = 1 AND (l.response_type IN (2,3) OR l.id IN (24,68,100))`)
	if err != nil {
		db.Close()
		client.FatalError("consultando lenders_by_allieds", err, nil)
	}
	for rows.Next() {
		var c cand
		if rows.Scan(&c.alliedID, &c.lenderID, &c.rt, &c.name) == nil {
			pool = append(pool, c)
		}
	}
	rows.Close()
	if len(pool) == 0 {
		db.Close()
		client.FatalError("sin candidatos válidos en lenders_by_allieds", nil, nil)
	}
	rand.Shuffle(len(pool), func(i, j int) { pool[i], pool[j] = pool[j], pool[i] })

	client.Banner(fmt.Sprintf("RANDOM · %d tripletas válidas (lenders_by_allieds, %d candidatos)", n, len(pool)))
	// Agregado por response_type para mapear completitud de config.
	type agg struct {
		ok, fail int
		errs     map[string]int
	}
	byRT := map[int]*agg{}
	ran, fail := 0, 0
	for i := 0; i < len(pool) && ran < n; i++ {
		c := pool[i]
		if byRT[c.rt] == nil {
			byRT[c.rt] = &agg{errs: map[string]int{}}
		}
		// Un branch (y si es ecommerce) para el allied del candidato.
		var hash string
		var ecom int
		db.QueryRow(`SELECT ab.hash, EXISTS(SELECT 1 FROM allied_ecommerce_credentials aec WHERE aec.allied_branch_id = ab.id)
			FROM allied_branches ab WHERE ab.allied_id = ? AND ab.status = 1 AND ab.hash IS NOT NULL ORDER BY ab.id LIMIT 1`,
			c.alliedID).Scan(&hash, &ecom)
		if hash == "" {
			continue
		}
		ch := channel.Asesor
		if ecom == 1 && rand.Intn(2) == 0 {
			ch = channel.Web
		}
		m, err := merchant.Resolve(db, hash)
		if err != nil {
			continue
		}
		// Construimos el lender EXACTO del candidato (no lender.Resolve, que es fuzzy por nombre/id).
		l := lender.Lender{ID: c.lenderID, Name: c.name, ResponseType: c.rt}
		runCfg := variant(cfg, ran)
		runCfg.PartnerHash = m.Hash
		ran++
		fmt.Printf("\n=== [%d] %s → %s (%s) → %s (#%d, rt=%d) ===\n", ran, ch, m.Name, m.Hash, l.Name, l.ID, l.ResponseType)
		if err := runOne(runCfg, ch, m, l); err != nil {
			fail++
			byRT[c.rt].fail++
			byRT[c.rt].errs[classifyErr(err.Error())]++
			fmt.Printf("  🔴 %v\n", err)
		} else {
			byRT[c.rt].ok++
			fmt.Printf("  🟢 cierre OK\n")
		}
	}
	db.Close()

	fmt.Printf("\n=== RANDOM: %d ✅  /  %d ❌  (de %d corridas) ===\n", ran-fail, fail, ran)
	fmt.Println("\n── Mapa de completitud por response_type ──")
	for _, rt := range []int{2, 3, 4, 1, 0} {
		a := byRT[rt]
		if a == nil {
			continue
		}
		fmt.Printf("  rt=%d:  %d ✅ / %d ❌", rt, a.ok, a.fail)
		if len(a.errs) > 0 {
			fmt.Printf("   →")
			for reason, k := range a.errs {
				fmt.Printf(" [%s ×%d]", reason, k)
			}
		}
		fmt.Println()
	}
	if fail > 0 {
		os.Exit(1)
	}
}

// classifyErr traduce el error de cierre a una categoría de gap de config (ver CASOS-ESPECIALES.md).
func classifyErr(e string) string {
	switch {
	case strings.Contains(e, "promissory-note") && strings.Contains(e, "500"):
		return "gap: promissory-note 500 (deceval-sin-cred / asociación allied faltante)"
	case strings.Contains(e, "authorize") && strings.Contains(e, "500"):
		return "gap: authorize 500 (guarantee_criteria mal formada)"
	case strings.Contains(e, "no asignó lender Bancolombia"):
		return "gap: comercio sin lender_allied_credentials Bancolombia"
	case strings.Contains(e, "!= 11"):
		return "no llegó a Estado 11"
	default:
		return "otro"
	}
}

// listCatalog muestra comercios y lenders disponibles en la BD para componer el CLI.
func listCatalog() {
	cfg := config.GetConfig(target)
	db := database.Connect(cfg)
	defer db.Close()
	client.Banner(fmt.Sprintf("CATÁLOGO (BD %s)", cfg.Target))
	fmt.Println("\nCOMERCIOS (hash · nombre · slug · kind):")
	for _, m := range merchant.List(db, 40) {
		fmt.Printf("  %-10s  %-26s  %-20s  %s\n", m.Hash, m.Name, m.Slug, m.Kind)
	}
	fmt.Println("\nLENDERS (id · nombre · response_type):")
	for _, l := range lender.List(db, 60) {
		fmt.Printf("  #%-4d  %-30s  rt=%d\n", l.ID, l.Name, l.ResponseType)
	}
}

// setup migra el esquema base + seed (para una BD local nueva).
func setup() {
	cfg := config.GetConfig(target)
	client.Banner("SETUP: migraciones + seed")
	db := database.Connect(cfg)
	defer db.Close()
	database.Migrations(db)
	fmt.Println("🟢 esquema base listo.")
}
