package shopifyapp

import (
	"strings"
	"testing"
)

func TestConnStringIsReadOnlyAndEncodesPassword(t *testing.T) {
	c := DBConfig{Target: "dev", Host: "h", Database: "shopify", User: "lector", Password: "a@b/c:d#e", Schema: "public"}
	s := c.ConnString()
	for _, want := range []string{"default_transaction_read_only=on", "sslmode=require", "search_path=public", "a%40b%2Fc%3Ad%23e@h:5432/shopify"} {
		if !strings.Contains(s, want) {
			t.Errorf("falta %q en la cadena", want)
		}
	}
}

func TestMissingAndTargets(t *testing.T) {
	if got := (DBConfig{}).Missing(); len(got) != 4 {
		t.Errorf("Missing() de una config vacía = %v", got)
	}
	if got := (DBConfig{Host: "h", Database: "d", User: "u", AWSProfile: "dev"}).Missing(); len(got) != 0 {
		t.Errorf("Missing() de una config vacía = %v", got)
	}
	if ValidDBTarget("prod") || !ValidDBTarget("dev") {
		t.Errorf("hoy sólo dev tiene base")
	}
	if redact("pass=s3cr3t", "s3cr3t") != "pass=***" {
		t.Errorf("redact no tapó la contraseña")
	}
}
