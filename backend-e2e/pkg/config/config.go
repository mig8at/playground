package config

import "os"

type TestConfig struct {
	DBUser, DBPass, DBHost, DBPort, DBName                 string
	ApiBaseURL, PartnerHash, TestPhone, TestDoc, TestEmail string
	BackdoorAPIKey                                         string
	TestAmount, LenderID                                   int
	// Target = "local" (default) | "dev". Marca si el config apunta a un ambiente COMPARTIDO.
	Target string
}

// IsShared = true cuando el config NO apunta a local (ej. dev). Los callers lo consultan para
// exigir el guard I_KNOW_THIS_TOUCHES_SHARED_DEV y para PROHIBIR operaciones bulk (Clean).
func (c TestConfig) IsShared() bool { return c.Target != "" && c.Target != "local" }

func GetDefault() TestConfig {
	return TestConfig{
		DBUser: "creditop", DBPass: "password", DBHost: "127.0.0.1", DBPort: "3306", DBName: "creditop",
		ApiBaseURL: "http://127.0.0.1:80/api", PartnerHash: "3e67eade", TestPhone: "3000000000",
		TestDoc: "1000000000", TestEmail: "test@creditop.com", TestAmount: 1500000, LenderID: 1,
		// SmartPay: el harness replica la cadena que el onboarding-forms-service hace contra el
		// legacy-backend (backdoor + dynamic-forms/create-user). Esta key debe coincidir con
		// BACKDOOR_API_KEY del backend (.env), que protege los endpoints backdoor/*.
		BackdoorAPIKey: "gKz9fG25ylWZmB7lfrH13F8CVZDuBBG2",
		Target:         "local",
	}
}

// GetConfig devuelve el config para el target dado. "local" (default) = valores hardcodeados.
// "dev" = parte de los defaults y SOBREESCRIBE BD + API desde env (.env.dev) — nada hardcodeado.
func GetConfig(target string) TestConfig {
	c := GetDefault()
	if target == "" {
		target = "local"
	}
	c.Target = target
	if target == "dev" {
		c.DBHost = envOr("E2E_DB_HOST", c.DBHost)
		c.DBPort = envOr("E2E_DB_PORT", c.DBPort)
		c.DBName = envOr("E2E_DB_NAME", c.DBName)
		c.DBUser = envOr("E2E_DB_USER", c.DBUser)
		c.DBPass = envOr("E2E_DB_PASS", c.DBPass)
		c.ApiBaseURL = envOr("E2E_API_BASE_URL", "http://legacy-backend.inertia-develop/api")
	}
	return c
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
