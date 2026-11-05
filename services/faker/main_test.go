package main

import (
	"encoding/json"
	"math/rand"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
)

// Las personas son inventadas y no traen nada que pueda ser de alguien: ni cédula, ni celular, y el correo es de
// example.com, sin tildes.
func TestPersonas(t *testing.T) {
	srv := httptest.NewServer(handler(rand.New(rand.NewSource(1))))
	defer srv.Close()

	res, err := http.Get(srv.URL + "/personas?n=20")
	if err != nil {
		t.Fatal(err)
	}
	var list []map[string]string
	if err := json.NewDecoder(res.Body).Decode(&list); err != nil {
		t.Fatal(err)
	}
	if len(list) != 20 {
		t.Fatalf("pedí 20, llegaron %d", len(list))
	}
	mail := regexp.MustCompile(`^[a-z]+\.[a-z]+\.\d{3}@example\.com$`)
	for _, p := range list {
		if len(p) != 4 || p["nombres"] == "" || len(strings.Fields(p["apellidos"])) != 2 || p["ciudad"] == "" {
			t.Errorf("persona incompleta o con campos de más: %v", p)
		}
		if names := strings.Fields(p["nombres"]); len(names) == 2 && (contains(femaleNames, names[0]) != contains(femaleNames, names[1])) {
			t.Errorf("mezcla nombres de mujer y de hombre: %q", p["nombres"])
		}
		if !mail.MatchString(p["correo"]) {
			t.Errorf("correo raro: %q", p["correo"])
		}
	}

	res, _ = http.Get(srv.URL + "/personas?n=999")
	_ = json.NewDecoder(res.Body).Decode(&list)
	if len(list) != 50 {
		t.Errorf("el tope es 50, llegaron %d", len(list))
	}
}

func contains(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}
