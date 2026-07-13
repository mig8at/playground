package main

import (
	"bytes"
	"creditop-tests/pkg/client"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// runLogin: prueba de "solo login" contra el Cognito REAL (dev). NO toca la BD ni el API
// de dev — pega únicamente a cognito-idp.<region>.amazonaws.com con InitiateAuth
// (USER_PASSWORD_AUTH). Read-only por naturaleza: autenticar no escribe nada.
//
// Config por env (NUNCA hardcodear ni commitear secretos):
//
//	E2E_COGNITO_REGION         (default us-east-2)
//	E2E_COGNITO_CLIENT_ID      (requerido)
//	E2E_COGNITO_CLIENT_SECRET  (si el app client tiene secret → se calcula SECRET_HASH)
//	E2E_COGNITO_USER / _PASS   (si faltan, se leen de frontend-e2e/.cognito.json {user,pass})
//
// El app client de dev es confidencial (Hosted UI con secret). Si USER_PASSWORD_AUTH NO
// está habilitado en él, Cognito responde InvalidParameterException y el probe lo explica:
// es también el diagnóstico de qué auth flow permite el client.
//
// Flag: --show-token imprime el IdToken completo (off por defecto; es sensible).
func runLogin(args []string) int {
	showToken := false
	for _, a := range args {
		if a == "--show-token" {
			showToken = true
		}
	}

	region := envOr("E2E_COGNITO_REGION", "us-east-2")
	clientID := os.Getenv("E2E_COGNITO_CLIENT_ID")
	clientSecret := os.Getenv("E2E_COGNITO_CLIENT_SECRET")
	user, pass := loadCognitoUserPass()

	if clientID == "" {
		fmt.Fprintf(os.Stderr, "%s✗ falta E2E_COGNITO_CLIENT_ID%s\n", client.CRed, client.CReset)
		return 2
	}
	if user == "" || pass == "" {
		fmt.Fprintf(os.Stderr, "%s✗ faltan credenciales: exportá E2E_COGNITO_USER/PASS o creá frontend-e2e/.cognito.json {user,pass}%s\n", client.CRed, client.CReset)
		return 2
	}

	client.Banner(fmt.Sprintf("login Cognito · %s · %s", region, maskUser(user)))

	auth := map[string]string{"USERNAME": user, "PASSWORD": pass}
	if clientSecret != "" {
		auth["SECRET_HASH"] = secretHash(user, clientID, clientSecret)
	}
	resp, err := cognitoCall(region, "InitiateAuth", map[string]interface{}{
		"AuthFlow":       "USER_PASSWORD_AUTH",
		"ClientId":       clientID,
		"AuthParameters": auth,
	})
	if err != nil {
		fmt.Fprintf(os.Stderr, "%s✗ error de red contra Cognito: %v%s\n", client.CRed, err, client.CReset)
		return 3
	}

	// Error de Cognito (siempre viene como {__type, message}).
	if t, _ := resp["__type"].(string); t != "" {
		msg, _ := resp["message"].(string)
		fmt.Printf("%s✗ %s%s — %s\n", client.CRed, shortType(t), client.CReset, msg)
		if strings.Contains(t, "InvalidParameter") && strings.Contains(strings.ToLower(msg), "auth flow") {
			fmt.Printf("%s  → el app client NO tiene habilitado USER_PASSWORD_AUTH.%s\n", client.CGray, client.CReset)
			fmt.Printf("%s    (a) pedir a infra habilitar ALLOW_USER_PASSWORD_AUTH en un client de test, o%s\n", client.CGray, client.CReset)
			fmt.Printf("%s    (b) reusar el flujo Hosted UI por navegador (frontend-e2e/pkg/cognito.ts).%s\n", client.CGray, client.CReset)
		}
		return 1
	}

	// Challenge (ej. NEW_PASSWORD_REQUIRED): user+pass válidos pero falta completar un paso.
	if ch, _ := resp["ChallengeName"].(string); ch != "" {
		fmt.Printf("%s⚠ Cognito devolvió challenge: %s%s\n", client.CRed, ch, client.CReset)
		fmt.Printf("%s  user/pass válidos, pero el client requiere completar el challenge antes de emitir tokens%s\n", client.CGray, client.CReset)
		return 1
	}

	res, _ := resp["AuthenticationResult"].(map[string]interface{})
	idToken, _ := res["IdToken"].(string)
	if idToken == "" {
		fmt.Printf("%s✗ respuesta sin IdToken (shape inesperado)%s\n", client.CRed, client.CReset)
		p, _ := json.MarshalIndent(resp, "", "  ")
		fmt.Println(string(p))
		return 1
	}

	client.PrintOK("login OK · Cognito emitió tokens")
	claims := decodeJWTClaims(idToken)
	printClaim(claims, "sub")
	printClaim(claims, "email")
	printClaim(claims, "cognito:username")
	if exp, ok := claims["exp"].(float64); ok {
		t := time.Unix(int64(exp), 0)
		fmt.Printf("  %s%-18s%s %s (en %s)\n", client.CGray, "exp:", client.CReset, t.Format("2006-01-02 15:04:05"), time.Until(t).Round(time.Second))
	}
	if showToken {
		fmt.Printf("\n%sIdToken:%s %s\n", client.CGray, client.CReset, idToken)
	} else {
		fmt.Printf("%s(IdToken oculto — usá --show-token para imprimirlo)%s\n", client.CGray, client.CReset)
	}
	return 0
}

func envOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

// loadCognitoUserPass: env E2E_COGNITO_USER/PASS, si no, frontend-e2e/.cognito.json {user,pass}.
// Mismo orden que frontend-e2e/pkg/config.ts::loadCognitoCreds.
func loadCognitoUserPass() (string, string) {
	if u := os.Getenv("E2E_COGNITO_USER"); u != "" {
		return u, os.Getenv("E2E_COGNITO_PASS")
	}
	raw, err := os.ReadFile(filepath.Join(frontendE2EPath(), ".cognito.json"))
	if err != nil {
		return "", ""
	}
	var c struct {
		User string `json:"user"`
		Pass string `json:"pass"`
	}
	if json.Unmarshal(raw, &c) != nil {
		return "", ""
	}
	return c.User, c.Pass
}

// secretHash = Base64(HMAC-SHA256(username+clientId, clientSecret)) — requerido cuando el
// app client tiene secret configurado.
func secretHash(username, clientID, secret string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(username + clientID))
	return base64.StdEncoding.EncodeToString(mac.Sum(nil))
}

// cognitoCall: POST sin firma a la API de Cognito IDP (InitiateAuth es público — no necesita
// SigV4 ni creds AWS). Usa su propio http.Client para NO heredar el vhost Host del legacy local.
func cognitoCall(region, action string, body map[string]interface{}) (map[string]interface{}, error) {
	payload, _ := json.Marshal(body)
	req, err := http.NewRequest("POST", fmt.Sprintf("https://cognito-idp.%s.amazonaws.com/", region), bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-amz-json-1.1")
	req.Header.Set("X-Amz-Target", "AWSCognitoIdentityProviderService."+action)
	r, err := (&http.Client{Timeout: 20 * time.Second}).Do(req)
	if err != nil {
		return nil, err
	}
	defer r.Body.Close()
	b, _ := io.ReadAll(r.Body)
	var out map[string]interface{}
	if err := json.Unmarshal(b, &out); err != nil {
		return nil, fmt.Errorf("respuesta no-JSON de Cognito (HTTP %d): %s", r.StatusCode, string(b))
	}
	return out, nil
}

// decodeJWTClaims decodifica el payload del JWT (base64url) SIN verificar la firma — solo para
// mostrar las claims del login. Una verificación estricta contra el JWKS del pool sería el
// siguiente paso si se quiere validar emisor/firma.
func decodeJWTClaims(token string) map[string]interface{} {
	parts := strings.Split(token, ".")
	if len(parts) < 2 {
		return nil
	}
	b, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil
	}
	var m map[string]interface{}
	json.Unmarshal(b, &m)
	return m
}

func printClaim(claims map[string]interface{}, k string) {
	if v, ok := claims[k]; ok {
		fmt.Printf("  %s%-18s%s %v\n", client.CGray, k+":", client.CReset, v)
	}
}

// shortType recorta el __type de Cognito (viene como "com.amazon...#NotAuthorizedException").
func shortType(t string) string {
	if i := strings.LastIndex(t, "#"); i >= 0 {
		return t[i+1:]
	}
	return t
}

func maskUser(u string) string {
	if len(u) <= 3 {
		return "***"
	}
	return u[:2] + strings.Repeat("*", len(u)-3) + u[len(u)-1:]
}
