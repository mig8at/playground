package client

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"
)

const (
	CReset = "\033[0m"
	CGreen = "\033[32m"
	CBlue  = "\033[34m"
	CRed   = "\033[31m"
	CCyan  = "\033[36m"
	CGray  = "\033[90m"
)

// Host es el vhost que la API legacy local resuelve por el header Host (Sail
// responde por vhost). Se aplica a req.Host en cada request. Vacío = no se fuerza.
var Host = "legacy-backend.inertia-develop"

func PrintStep(current, total int, title string) {
	fmt.Printf("\n%s[%d/%d] %s%s\n", CBlue, current, total, title, CReset)
}

func PrintRule(rule string) {
	fmt.Printf("  ↳ %s%s%s\n", CGray, rule, CReset)
}

func PrintSuccess(msg string) {
	fmt.Printf("  %s🟢 ÉXITO: %s%s\n", CGreen, msg, CReset)
}

// PrintOK imprime el resultado exitoso de un paso (verde, conciso).
func PrintOK(msg string) {
	fmt.Printf("  %s✓ %s%s\n", CGreen, msg, CReset)
}

// PrintFail imprime el resultado fallido de un paso (rojo).
func PrintFail(msg string) {
	fmt.Printf("  %s✗ %s%s\n", CRed, msg, CReset)
}

func FatalError(msg string, err error, data map[string]interface{}) {
	fmt.Printf("\n%s🔴 ERROR: %s%s\n", CRed, msg, CReset)
	if err != nil {
		fmt.Printf("    Detalle: %v\n", err)
	}
	if data != nil {
		p, _ := json.MarshalIndent(data, "", "  ")
		fmt.Printf("\n    Respuesta:\n%s\n", string(p))
	}
	os.Exit(1)
}

func Banner(t string) {
	fmt.Printf("%s======================================================================\n %s \n======================================================================%s\n", CCyan, t, CReset)
}

func Post(url string, body map[string]interface{}) (map[string]interface{}, error) {
	return PostWithHeaders(url, body, nil)
}

// PostWithHeaders is the same as Post but injects extra headers on the
// outgoing request. Used by E2E flows that need to drive backend fake
// drivers via per-request scenario headers (e.g. X-Fake-Scenario).
func PostWithHeaders(url string, body map[string]interface{}, headers map[string]string) (map[string]interface{}, error) {
	var req *http.Request
	if body != nil {
		b, _ := json.Marshal(body)
		req, _ = http.NewRequest("POST", url, bytes.NewBuffer(b))
	} else {
		req, _ = http.NewRequest("POST", url, nil)
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	return doReq(req)
}

func Get(url string) (map[string]interface{}, error) {
	req, _ := http.NewRequest("GET", url, nil)
	return doReq(req)
}

func doReq(req *http.Request) (map[string]interface{}, error) {
	c := &http.Client{Timeout: 40 * time.Second}
	if Host != "" {
		req.Host = Host // vhost del legacy local
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1")
	resp, err := c.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	var res map[string]interface{}
	if err := json.Unmarshal(body, &res); err != nil {
		res = map[string]interface{}{"raw_body": string(body)}
	}
	if resp.StatusCode >= 400 {
		return res, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	return res, nil
}
