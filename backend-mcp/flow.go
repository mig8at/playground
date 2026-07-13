package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// vhost del legacy (dev resuelve por Host). Derivado de la API base.
func hostFromAPI(apiBase string) string {
	if u, err := url.Parse(apiBase); err == nil && u.Host != "" {
		return u.Host
	}
	return ""
}

// post hace POST JSON al backend de dev, devolviendo el body parseado (aun en >=400) + el status.
func post(apiBase, path string, body map[string]any) (map[string]any, int, error) {
	payload, _ := json.Marshal(body)
	req, err := http.NewRequest("POST", strings.TrimRight(apiBase, "/")+path, bytes.NewReader(payload))
	if err != nil {
		return nil, 0, err
	}
	return do(req, apiBase)
}

// postExternal hace un POST JSON a una URL ARBITRARIA (sin el vhost del legacy) — para el webhook
// ecommerce hacia el receiver del comercio. Devuelve status + body (recortado) + err.
func postExternal(rawURL string, body map[string]any) (int, string, error) {
	payload, _ := json.Marshal(body)
	req, err := http.NewRequest("POST", rawURL, bytes.NewReader(payload))
	if err != nil {
		return 0, "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	r, err := (&http.Client{Timeout: 30 * time.Second}).Do(req)
	if err != nil {
		return 0, "", err
	}
	defer r.Body.Close()
	raw, _ := io.ReadAll(r.Body)
	b := string(raw)
	if len(b) > 500 {
		b = b[:500] + "…"
	}
	return r.StatusCode, b, nil
}

func get(apiBase, path string) (map[string]any, int, error) {
	req, err := http.NewRequest("GET", strings.TrimRight(apiBase, "/")+path, nil)
	if err != nil {
		return nil, 0, err
	}
	return do(req, apiBase)
}

func do(req *http.Request, apiBase string) (map[string]any, int, error) {
	if h := hostFromAPI(apiBase); h != "" {
		req.Host = h
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148")
	r, err := (&http.Client{Timeout: 120 * time.Second}).Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer r.Body.Close()
	raw, _ := io.ReadAll(r.Body)
	var out map[string]any
	if json.Unmarshal(raw, &out) != nil {
		out = map[string]any{"raw_body": string(raw)}
	}
	return out, r.StatusCode, nil
}

// otpCode = últimos n dígitos del teléfono (el código de bypass de qa_otp_bypass_phones).
func otpCode(phone string, n int) string {
	if len(phone) < n {
		return phone
	}
	return phone[len(phone)-n:]
}

// findIntKey busca recursivamente una clave entera (ej. "user_request_id", "ecommerceRequestId").
func findIntKey(v any, key string) int {
	switch x := v.(type) {
	case map[string]any:
		for k, vv := range x {
			if k == key {
				switch n := vv.(type) {
				case float64:
					return int(n)
				case string:
					if i, err := strconv.Atoi(n); err == nil {
						return i
					}
				}
			}
			if id := findIntKey(vv, key); id != 0 {
				return id
			}
		}
	case []any:
		for _, e := range x {
			if id := findIntKey(e, key); id != 0 {
				return id
			}
		}
	}
	return 0
}

// register: POST /onboarding/phone/register. sendDoc=false cuando personal-info debe fijar el doc.
func register(apiBase, hash, phone, doc string, sendDoc bool) error {
	body := map[string]any{"phone_number": phone, "otp_length": 4, "terms": true, "policies": true, "partner_branch_hash": hash}
	if sendDoc {
		body["document_number"] = doc
	}
	_, _, err := post(apiBase, "/onboarding/phone/register", body)
	return err
}

// validateOtp: POST /otp-validate (OTP por bypass = últimos 4) → user_request_id. Si ecomID>0 ancla
// la orden ecommerce (entrada web headless).
func validateOtp(apiBase, hash, phone string, amount, ecomID int) (int, error) {
	body := map[string]any{
		"cell_phone": phone, "otp_code": otpCode(phone, 4), "original_amount": amount, "amount": amount,
	}
	if ecomID > 0 {
		body["ecommerce_request_id"] = fmt.Sprintf("%d", ecomID)
	}
	resp, _, err := post(apiBase, "/onboarding/loan-application/otp-validate/"+hash, body)
	if err != nil {
		return 0, err
	}
	id := findIntKey(resp, "user_request_id")
	if id == 0 {
		return 0, fmt.Errorf("otp-validate no devolvió user_request_id (resp: %v)", resp)
	}
	return id, nil
}

type PersonalInfo struct {
	DocType, Doc, Name, Surname, Email, Gender string
	ExpDay, ExpMonth, ExpYear                  int
	BirthDay, BirthMonth, BirthYear            int
}

// OfferedLender — un lender que el marketplace devuelve para una solicitud.
type OfferedLender struct {
	ID           int    `json:"id"`
	Name         string `json:"name"`
	ResponseType int    `json:"response_type"`
}

// marketplace: GET /lenders/{uReq} → lenders OFRECIDOS (id/name/rt) + el response crudo + status + err.
func marketplace(apiBase string, uReqID int) ([]OfferedLender, map[string]any, int, error) {
	resp, status, err := get(apiBase, fmt.Sprintf("/onboarding/loan-application/lenders/%d", uReqID))
	if err != nil {
		return nil, resp, status, err
	}
	seen := map[int]bool{}
	var out []OfferedLender
	var walk func(any)
	walk = func(v any) {
		switch x := v.(type) {
		case map[string]any:
			for k, vv := range x {
				if k == "lenders" {
					if arr, ok := vv.([]any); ok {
						for _, e := range arr {
							em, ok := e.(map[string]any)
							if !ok {
								continue
							}
							id := 0
							if f, ok := em["id"].(float64); ok {
								id = int(f)
							}
							if id == 0 || seen[id] {
								continue
							}
							seen[id] = true
							name, _ := em["name"].(string)
							rt := 0
							if f, ok := em["response_type"].(float64); ok {
								rt = int(f)
							}
							out = append(out, OfferedLender{ID: id, Name: name, ResponseType: rt})
						}
					}
				}
				walk(vv)
			}
		case []any:
			for _, e := range x {
				walk(e)
			}
		}
	}
	walk(resp)
	return out, resp, status, nil
}
