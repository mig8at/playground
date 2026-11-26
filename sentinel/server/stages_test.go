package main

import (
	"strings"
	"testing"
	"text/template"
)

// Mensajes reales de producción (de sentinel/.data/messages.json, 2026-11-26) con la etapa que les toca.
var stageCases = []struct {
	service, code, msg, want string
	lender, ctx              string
}{
	{"legacy-backend", "ONB002", "OnboardingController::validateOtpCodeAndRedirectOrchestrator: temporal user without corbeta onboarding, returning ONB002", "personal", "", ""},
	{"legacy-backend", "ONB004", "OnboardingController::validateAndStorePersonalInfoOrchestrator: user has no laboral information, returning ONB004", "labor", "", ""},
	{"legacy-backend", "ONB001", "OnboardingController::validateOtpCodeAndRedirectOrchestrator: OTP validation failed, returning ONB001", "otp", "", ""},
	{"legacy-backend", "", "OnboardingController::validateAndStorePersonalInfoOrchestrator: document already exists, returning ONB005 DOCUMENT_DUPLICATE", "personal", "", ""},
	{"legacy-backend", "ONB005", "TusDatos errors, returning ONB005", "bureaus", "", ""},
	{"legacy-backend", "", "Risk central data rejected by pre-processor.", "bureaus", "", ""},
	{"legacy-backend", "", "Exception in lenderServiceFactory->consult()", "lender", "", ""},
	{"legacy-backend", "", "Error al validar cupo con Bancolombia BNPL", "lender", "", ""},
	{"legacy-backend", "", "Error al aplicar reglas de perfilamiento", "profiling", "", ""},
	{"legacy-backend", "", "OtpService::validateOtpCode: provider rejected the code, returning CODE_INVALID", "otp", "", ""},
	{"legacy-backend", "", "device_lock.unlock.api_failure", "disbursement", "", ""},
	{"legacy-backend", "", "ecommerce_store_notify_failed", "ecommerce", "", ""},
	{"legacy-backend", "", "ado.enroll.document_mismatch", "identity", "", ""},
	{"legacy-backend", "", "Jumio onboarding failed with CrossCoreException.", "identity", "", ""},
	{"legacy-backend", "", "Error al generar pagaré Deceval", "promissory", "", ""},
	{"legacy-backend", "", "Welli update amount API returned error", "payment", "", ""},
	{"legacy-backend", "", "SQLSTATE[42S22]: Column not found: 1054 Unknown column 'starred' in 'field list'", "platform", "", ""},
	{"legacy-backend", "", "Class \"App\\Models\\LenderCredentialKey\" not found", "platform", "", ""},
	{"legacy-backend", "", "Identity bureau could not be reached.", "bureaus", "", ""},
	{"legacy-backend", "", "El correo electrónico ya está asociado a otro usuario.", "personal", "", ""},
	{"legacy-backend", "", "Validación rechazada por el usuario", "other", "", ""}, // «rechazado» no es ADO
	{"preapprovals-service", "", "failed to save workflow audit leg", "lender", "", ""},
	{"customer-service", "", "get customer by cognito sub failed", "app", "", ""},
	{"messaging-service", "", "failed to send SMS message via LabsMobile", "otp", "", ""},
	{"merchant-gateways-service", "", "device enrollment failed", "disbursement", "", ""},
	{"legacy-application", "", "http_exception_rendering", "http", "", ""},
	{"legacy-backend", "", "La firma del evento no es valida.", "payment", "", ""},
	{"legacy-backend", "", "error interno en el orquestador de eliminacion", "app", "", ""},
	{"legacy-application", "", "http_exception_rendering", "http", "", "https://admin.creditop.com/build/assets/CDataTable.js"},
	{"legacy-backend", "", "HTTP request returned status code 404:", "lender", "bancolombia_bnpl", "App\\Actions\\Lenders\\BancolombiaBnpl"},
	{"legacy-backend", "", "HTTP request returned status code 403: Intituci\\u00f3n Errada", "lender", "", ""},
	{"legacy-backend", "", "OnboardingController::validateAndStorePersonalInfoOrchestrator: storePersonalInfo failed, propagating error", "personal", "", ""},
}

func TestClassifyStage(t *testing.T) {
	for _, c := range stageCases {
		if got := classifyStage(stageFields{Service: c.service, Code: c.code, Message: c.msg, Lender: c.lender, Context: c.ctx}); got != c.want {
			t.Errorf("%s %q: %s, quería %s", c.service, c.msg, got, c.want)
		}
	}
}

// La plantilla de Loki tiene que clasificar igual que Go: se ejecuta con text/template y las funciones de Loki que usa
// (`lower`, `contains` con la subcadena primero, `__line__`).
func TestStageTemplateMatchesGo(t *testing.T) {
	for _, c := range stageCases {
		line := c.msg
		funcs := template.FuncMap{
			"lower":    strings.ToLower,
			"contains": func(sub, s string) bool { return strings.Contains(s, sub) },
			"__line__": func() string { return line },
		}
		tpl, err := template.New("stage").Funcs(funcs).Parse(stageTemplate())
		if err != nil {
			t.Fatal(err)
		}
		var b strings.Builder
		// Como en Loki: los monolitos traen el mensaje en `msg`; los servicios en Go, en `exception_message`.
		labels := map[string]string{"service_name": c.service, "code": c.code, "msg": c.msg, "exception_message": "", "lender": c.lender, "ctrl": c.ctx, "url": ""}
		if c.service != "legacy-backend" && c.service != "legacy-application" {
			labels["msg"], labels["exception_message"] = "", c.msg
		}
		if err := tpl.Execute(&b, labels); err != nil {
			t.Fatal(err)
		}
		if got, want := b.String(), classifyStage(stageFields{Service: c.service, Code: c.code, Message: c.msg, Lender: c.lender, Context: c.ctx}); got != want {
			t.Errorf("%q: la plantilla dice %s y Go %s", c.msg, got, want)
		}
	}
}

func TestEveryRuleStageExists(t *testing.T) {
	for _, r := range stageRules {
		if stageByKey(r.Stage) == nil {
			t.Errorf("la regla apunta a una etapa que no existe: %s", r.Stage)
		}
	}
}
