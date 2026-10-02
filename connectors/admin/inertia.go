package admin

import (
	"encoding/json"
	"html"
	"regexp"
)

// Page es la página de Inertia que viaja en el HTML.
type Page struct {
	Component string         `json:"component"`
	Props     map[string]any `json:"props"`
	URL       string         `json:"url"`
	Version   string         `json:"version"`
}

var (
	dataPageAttr = regexp.MustCompile(`\sdata-page="([^"]*)"`)
	inertiaPage  = regexp.MustCompile(`window\.inertiaPage\s*=\s*(\{[\s\S]*?\})\s*;?\s*</script>`)
)

// ParsePage lee la página de Inertia del HTML. Hay DOS formas y este admin usa la segunda:
//   - `<div id="app" data-page="{…}">` (el atributo escapado, lo estándar);
//   - `<script inertia> window.inertiaPage = {…}; </script>` (lo que sirve legacy-application).
//
// nil si no hay ninguna o el JSON está roto.
func ParsePage(htmlText string) *Page {
	var raw string
	if m := dataPageAttr.FindStringSubmatch(htmlText); m != nil {
		raw = html.UnescapeString(m[1])
	} else if m := inertiaPage.FindStringSubmatch(htmlText); m != nil {
		raw = m[1]
	} else {
		return nil
	}
	var p Page
	if err := json.Unmarshal([]byte(raw), &p); err != nil {
		return nil
	}
	if p.Props == nil {
		p.Props = map[string]any{}
	}
	return &p
}
