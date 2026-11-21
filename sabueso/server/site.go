package main

// EL SITIO DE LA EMPRESA, LEÍDO SIN MODELO: la página de inicio y las de contacto, proveedores o aliados que enlaza,
// de donde salen los enlaces `mailto:`, `wa.me` / `api.whatsapp.com` y `tel:`. Es exacto (lo que está en el HTML) y
// gratis, y completa lo que encuentra Claude: el 2026-11-21 la misma búsqueda de Dismerca trajo una vez el WhatsApp
// comercial (que sí está en dismerca.com/post-venta) y la otra no.

import (
	"context"
	"html"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

var (
	reHref     = regexp.MustCompile(`(?i)href\s*=\s*["']([^"'#]+)["']`)
	reMailto   = regexp.MustCompile(`(?i)mailto:([a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,})`)
	reWhatsApp = regexp.MustCompile(`(?i)(?:wa\.me/|api\.whatsapp\.com/send/?\?phone=|whatsapp\.com/send/?\?phone=)\+?(\d{8,15})`)
	// El número de un botón de WhatsApp guardado en la configuración de un plugin («whatsapp_phone_number":"+57…»).
	reWAConfig = regexp.MustCompile(`(?i)whatsapp[a-z_]*(?:phone|number|numero)[a-z_]*"\s*:\s*"\+?(\d{8,15})"`)
	reTel      = regexp.MustCompile(`(?i)tel:\+?([\d\s().\-]{7,20})`)
	reContact  = regexp.MustCompile(`(?i)contact|visit|nosotros|aliad|proveed|trabaja|servicio|atencion|sedes|tiendas|post-?venta`)
	reStores   = regexp.MustCompile(`(?i)tienda|sede|taller|local|sucursal|concesionari|red-de|puntos`)
	reEmail    = regexp.MustCompile(`^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$`)
)

var siteClient = &http.Client{Timeout: 20 * time.Second}

func fetchPage(ctx context.Context, u string) (string, string) {
	req, err := http.NewRequestWithContext(ctx, "GET", u, nil)
	if err != nil {
		return "", ""
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15")
	res, err := siteClient.Do(req)
	if err != nil {
		return "", ""
	}
	defer res.Body.Close()
	if res.StatusCode != 200 || !strings.Contains(res.Header.Get("Content-Type"), "html") {
		return "", ""
	}
	b, _ := io.ReadAll(io.LimitReader(res.Body, 3<<20))
	// Los enlaces que van dentro de un JSON (la configuración de un plugin) traen las barras escapadas: «https:\/\/».
	return strings.ReplaceAll(html.UnescapeString(string(b)), `\/`, "/"), res.Request.URL.String()
}

// emailFit: a qué área llega un correo, por la parte antes de la @.
func emailFit(addr string) (string, string) {
	local := strings.ToLower(addr[:strings.IndexByte(addr, '@')])
	switch {
	case regexp.MustCompile(`alianz|proveed|compras|convenio|partner|negocios|corporativ`).MatchString(local):
		return "proposals", "alianzas o proveedores (por el nombre del correo)"
	case regexp.MustCompile(`comercial|ventas|venta|mercadeo|marketing|gerencia`).MatchString(local):
		return "commercial", "comercial (por el nombre del correo)"
	}
	return "general", "general"
}

// readSite: los canales que el sitio publica como enlaces. Lee la página de inicio y hasta 6 de contacto del mismo
// dominio.
func readSite(ctx context.Context, site string) []Contact {
	if site == "" {
		return nil
	}
	if !strings.HasPrefix(site, "http") {
		site = "https://" + site
	}
	base, err := url.Parse(site)
	if err != nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	home, final := fetchPage(ctx, base.String())
	if home == "" {
		return nil
	}
	if u, err := url.Parse(final); err == nil {
		base = u
	}
	pages := []struct{ body, url string }{{home, base.String()}}
	seen := map[string]bool{base.String(): true}
	for _, m := range reHref.FindAllStringSubmatch(home, -1) {
		if len(pages) >= 7 {
			break
		}
		u, err := base.Parse(strings.TrimSpace(m[1]))
		if err != nil || strings.TrimPrefix(u.Hostname(), "www.") != strings.TrimPrefix(base.Hostname(), "www.") || seen[u.String()] || !reContact.MatchString(u.Path) {
			continue
		}
		seen[u.String()] = true
		if body, got := fetchPage(ctx, u.String()); body != "" {
			pages = append(pages, struct{ body, url string }{body, got})
		}
	}
	var out []Contact
	phones := 0
	have := map[string]bool{}
	add := func(c Contact) {
		key := c.Channel + ":" + strings.ToLower(strings.Map(func(r rune) rune {
			if r == ' ' || r == '-' || r == '(' || r == ')' || r == '.' {
				return -1
			}
			return r
		}, c.Value))
		if !have[key] {
			have[key] = true
			out = append(out, c)
		}
	}
	for _, p := range pages {
		for _, m := range reMailto.FindAllStringSubmatch(p.body, -1) {
			fit, area := emailFit(m[1])
			add(Contact{Channel: "email", Value: strings.ToLower(m[1]), Area: area + " · enlazado en el sitio", Fit: fit, Source: p.url})
		}
		for _, m := range append(reWhatsApp.FindAllStringSubmatch(p.body, -1), reWAConfig.FindAllStringSubmatch(p.body, -1)...) {
			add(Contact{Channel: "whatsapp", Value: "+" + m[1], Area: "WhatsApp enlazado en el sitio", Fit: "commercial", Source: p.url})
		}
		// Los teléfonos, sólo de la página de inicio y las de contacto: una página de tiendas o talleres trae el de cada
		// local (Derco, el 2026-11-21: doce números) y no son el canal para una propuesta. Hasta tres.
		if reStores.MatchString(p.url) {
			continue
		}
		for _, m := range reTel.FindAllStringSubmatch(p.body, -1) {
			v := strings.TrimRight(strings.TrimSpace(m[1]), " ()-.")
			if digits(v) >= 7 && phones < 3 {
				before := len(out)
				add(Contact{Channel: "phone", Value: v, Area: "teléfono enlazado en el sitio", Fit: "general", Source: p.url})
				if len(out) > before {
					phones++
				}
			}
		}
	}
	return out
}

func digits(s string) int {
	n := 0
	for _, r := range s {
		if r >= '0' && r <= '9' {
			n++
		}
	}
	return n
}

// validContact: lo que se queda de lo que trae Claude. Un correo tiene que ser un correo; un teléfono o WhatsApp, tener
// dígitos (no un @usuario de Instagram); todo, una fuente con URL.
func validContact(c Contact) bool {
	if !strings.HasPrefix(c.Source, "http") {
		return false
	}
	switch c.Channel {
	case "email":
		return reEmail.MatchString(strings.ToLower(strings.TrimSpace(c.Value)))
	case "phone", "whatsapp":
		return digits(c.Value) >= 7 && !strings.Contains(c.Value, "@")
	case "form":
		return strings.TrimSpace(c.Value) != ""
	}
	return false
}

// mergeContacts: lo del sitio primero (exacto), después lo de Claude que no repite un valor.
func mergeContacts(site, model []Contact) []Contact {
	out := append([]Contact{}, site...)
	norm := func(c Contact) string {
		if c.Channel == "email" {
			return strings.ToLower(strings.TrimSpace(c.Value))
		}
		d := strings.Map(func(r rune) rune {
			if r >= '0' && r <= '9' {
				return r
			}
			return -1
		}, c.Value)
		if len(d) > 10 {
			d = d[len(d)-10:] // +57 333… y 333… son el mismo
		}
		return d
	}
	have := map[string]bool{}
	for _, c := range out {
		have[norm(c)] = true
	}
	for _, c := range model {
		if c.Channel != "form" && have[norm(c)] {
			continue
		}
		have[norm(c)] = true
		out = append(out, c)
	}
	return out
}
