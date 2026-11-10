package main

/* LA TIENDA REAL DE SHOPIFY: creditop-dev-store paga con la app de Creditop (el repo shopify), desplegada en dev
(`shopify-app.dev.creditop.com`, contra qa). La versión publicada de la app apunta ahí desde el 2026-11-09: ya no hace
falta el contenedor local ni un túnel público, y cualquiera con la contraseña de la tienda compra.

Esto sólo mira, no cambia nada: si la tienda contesta y si la app de dev contesta desde acá. Si la tienda manda a un
`trycloudflare.com`, le quedó una vista previa de `shopify app dev` (se quita con `shopify app dev clean` en el repo
shopify); eso no se ve desde acá. */

import (
	"net/http"
	"time"
)

type shopifyCheck struct {
	Name   string `json:"name"`
	OK     bool   `json:"ok"`
	Detail string `json:"detail"`
	URL    string `json:"url,omitempty"`
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

const (
	shopifyStoreURL = "https://creditop-dev-store.myshopify.com"
	shopifyAppURL   = "https://shopify-app.dev.creditop.com"
)

func shopifyStatus() []shopifyCheck {
	client := &http.Client{Timeout: 8 * time.Second}

	store := shopifyCheck{Name: "Tienda", URL: shopifyStoreURL}
	if code, took, err := reach(client, shopifyStoreURL+"/"); err != nil {
		store.Detail = "no contesta"
	} else {
		store.OK = code == http.StatusOK
		store.Detail = "contesta " + http.StatusText(code) + " (" + took.String() + "); se entra con la contraseña de la tienda"
	}

	app := shopifyCheck{Name: "App de pagos (dev)", URL: shopifyAppURL}
	if code, took, err := reach(client, shopifyAppURL+"/"); err != nil {
		app.Detail = "no contesta: la despliega la CI del repo shopify al mergear a develop"
	} else {
		app.OK = code == http.StatusOK
		app.Detail = "contesta " + http.StatusText(code) + " (" + took.String() + "), contra qa"
	}
	return []shopifyCheck{store, app}
}

func registerShopify(mux *http.ServeMux) {
	mux.HandleFunc("/api/shopify/status", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"checks": shopifyStatus()})
	})
}
