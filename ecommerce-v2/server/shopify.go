package main

/* LA TIENDA REAL DE SHOPIFY: creditop-dev-store paga con la app de Creditop (el repo shopify), que corre en Docker en
la máquina de quien la está probando (`app-qa`, :8121, contra qa) y que Shopify alcanza por un túnel público. Shopify
llama desde internet: el playground no sirve para esto, porque su balanceador sólo deja entrar la VPN.

Esto sólo mira, no cambia nada: si el servidor de la app contesta, a qué dirección pública está apuntado (el
SHOPIFY_APP_URL de su secreto de qa), si esa dirección contesta desde afuera y si la extensión de pagos apunta a la
misma. Apuntar la tienda a un túnel nuevo es `docker/usar-tunel.sh` del repo shopify.

Quien prueba con la app de OTRA persona (no tiene el repo shopify) ve si la tienda contesta y, con SHOPIFY_TUNNEL_URL
en su .env (la dirección del túnel que le pasaron), si ese túnel llega a la app. */

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

type shopifyCheck struct {
	Name   string `json:"name"`
	OK     bool   `json:"ok"`
	Detail string `json:"detail"`
	URL    string `json:"url,omitempty"`
}

// El repo shopify: SHOPIFY_REPO, o al lado de los demás repos de Creditop.
func shopifyRepo() string {
	if dir := os.Getenv("SHOPIFY_REPO"); dir != "" {
		return dir
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, "Desktop", "CREDITOP", "github", "shopify")
}

// SHOPIFY_APP_URL del secreto de qa. Del archivo no se lee ni se devuelve ninguna otra clave.
func shopifyTunnelURL(repo string) (string, error) {
	raw, err := os.ReadFile(filepath.Join(repo, "docker", "secrets", "qa.json"))
	if err != nil {
		return "", err
	}
	var secret struct {
		AppURL string `json:"SHOPIFY_APP_URL"`
	}
	if err := json.Unmarshal(raw, &secret); err != nil {
		return "", err
	}
	return strings.TrimRight(secret.AppURL, "/"), nil
}

var paymentSessionURL = regexp.MustCompile(`(?m)^payment_session_url = "([^"]+)"`)

func shopifyExtensionBase(repo string) string {
	raw, err := os.ReadFile(filepath.Join(repo, "extensions", "creditop-offsite", "shopify.extension.toml"))
	if err != nil {
		return ""
	}
	m := paymentSessionURL.FindSubmatch(raw)
	if m == nil {
		return ""
	}
	return strings.TrimSuffix(string(m[1]), "/payments/session")
}

func reach(client *http.Client, url string) (int, time.Duration, error) {
	start := time.Now()
	res, err := client.Get(url)
	if err != nil {
		return 0, 0, err
	}
	res.Body.Close()
	return res.StatusCode, time.Since(start).Round(time.Millisecond), nil
}

const shopifyStoreURL = "https://creditop-dev-store.myshopify.com"

// Sin el repo shopify: la app corre en la máquina de otra persona.
func remoteShopifyStatus(client *http.Client) []shopifyCheck {
	store := shopifyCheck{Name: "Tienda", URL: shopifyStoreURL}
	if code, took, err := reach(client, shopifyStoreURL+"/"); err != nil {
		store.Detail = "no contesta"
	} else {
		store.OK = code == http.StatusOK
		store.Detail = "contesta " + http.StatusText(code) + " (" + took.String() + "); se entra con la contraseña de la tienda"
	}

	tunnel := shopifyCheck{Name: "Túnel de la app"}
	url := strings.TrimRight(env("SHOPIFY_TUNNEL_URL"), "/")
	if url == "" {
		tunnel.Detail = "la app corre en la máquina de Miguel: con su túnel abierto, la tienda paga. Para verlo acá, " +
			"pedile la dirección del túnel y ponela en SHOPIFY_TUNNEL_URL del .env"
		return []shopifyCheck{store, tunnel}
	}
	tunnel.URL = url
	tunnel.OK, tunnel.Detail = tunnelState(client, url, "pedile a Miguel la nueva")
	return []shopifyCheck{store, tunnel}
}

// Si un túnel llega a la app. Uno cerrado no siempre falla la conexión: Cloudflare puede seguir contestando con su
// propio error (530) aunque del otro lado no haya nada. Sólo un 200 es la app.
func tunnelState(client *http.Client, url, fix string) (bool, string) {
	code, took, err := reach(client, url+"/")
	switch {
	case err != nil:
		return false, "apagado: la dirección no responde (el túnel se cerró o cambió); " + fix
	case code != http.StatusOK:
		return false, fmt.Sprintf("apagado: el túnel no llega a la app (respondió %d); %s", code, fix)
	default:
		return true, "prendido: llega a la app (" + took.String() + ")"
	}
}

func shopifyStatus() []shopifyCheck {
	client := &http.Client{Timeout: 8 * time.Second}
	repo := shopifyRepo()
	if _, err := os.Stat(filepath.Join(repo, "docker", "docker-compose.yml")); err != nil {
		return remoteShopifyStatus(client)
	}
	checks := []shopifyCheck{}

	host := shopifyCheck{Name: "Servidor de la app", URL: "http://localhost:8121"}
	if code, took, err := reach(client, host.URL+"/"); err != nil {
		host.Detail = "no contesta: en el repo shopify, `cd docker && docker compose up -d`"
	} else {
		host.OK = code == http.StatusOK
		host.Detail = "contesta " + http.StatusText(code) + " (" + took.String() + ")"
	}
	checks = append(checks, host)

	tunnel := shopifyCheck{Name: "Túnel"}
	url, err := shopifyTunnelURL(repo)
	switch {
	case err != nil:
		tunnel.Detail = "no se pudo leer docker/secrets/qa.json del repo shopify (" + repo + ")"
	case !strings.HasPrefix(url, "https://") || strings.Contains(url, "playground.creditop.com"):
		tunnel.URL = url
		tunnel.Detail = "el servidor no apunta a un túnel público (Shopify no llega al playground): `cloudflared tunnel --url http://localhost:8121` y `docker/usar-tunel.sh <dirección>`"
	default:
		tunnel.URL = url
		tunnel.OK, tunnel.Detail = tunnelState(client, url, "ábrelo de nuevo y apunta la tienda con `docker/usar-tunel.sh`")
	}
	checks = append(checks, tunnel)

	ext := shopifyCheck{Name: "Extensión de pagos"}
	base := shopifyExtensionBase(repo)
	ext.URL = base
	switch {
	case base == "":
		ext.Detail = "no se pudo leer la extensión del repo shopify"
	case url != "" && base == url:
		ext.OK = true
		ext.Detail = "apunta al mismo túnel"
	case tunnel.OK:
		ext.Detail = "apunta a otra dirección: `docker/usar-tunel.sh " + url + "` la alinea"
	default:
		ext.Detail = "apunta a otra dirección; con el túnel abierto, `docker/usar-tunel.sh <dirección del túnel>` alinea las dos"
	}
	checks = append(checks, ext)

	return checks
}

func registerShopify(mux *http.ServeMux) {
	mux.HandleFunc("/api/shopify/status", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"checks": shopifyStatus()})
	})
}
