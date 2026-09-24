package atlassian

// La mitad Confluence del conector: la documentación de NEGOCIO (política de riesgo, contratos con
// lenders, PRDs), que no está en el código. SOLO LECTURA — no hay ningún método que escriba.
//
// ⚠ Lo que sale de acá NO es verdad todavía. Un documento desactualizado es indistinguible de uno
// equivocado, así que toda afirmación se contrasta contra el código antes de usarse.
//
// Hasta el 2026-09-24 esto vivía en Python (`tools/confluence.py`) con su propio cliente HTTP y su propio
// token, que había vencido sin que nada lo dijera; el de Jira, que es el mismo sitio y la misma cuenta,
// servía para los dos.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strings"

	"creditop/playground/lib/text"
)

// flexID acepta un id que Atlassian a veces manda como número y a veces como texto.
type flexID string

func (f *flexID) UnmarshalJSON(b []byte) error {
	var s string
	if err := json.Unmarshal(b, &s); err == nil {
		*f = flexID(s)
		return nil
	}
	var n json.Number
	if err := json.Unmarshal(b, &n); err != nil {
		return err
	}
	*f = flexID(n.String())
	return nil
}

// Space es un espacio de Confluence.
type Space struct {
	ID   flexID `json:"id"`
	Key  string `json:"key"`
	Name string `json:"name"`
}

// PageRef es una página en un listado.
type PageRef struct {
	ID    flexID `json:"id"`
	Title string `json:"title"`
}

// Page es una página con su cuerpo en el formato de almacenamiento (XHTML de Confluence).
type Page struct {
	Title   string `json:"title"`
	Version struct {
		Number    json.Number `json:"number"`
		CreatedAt string      `json:"createdAt"`
	} `json:"version"`
	Body struct {
		Storage struct {
			Value string `json:"value"`
		} `json:"storage"`
	} `json:"body"`
}

// SearchHit es un resultado de la búsqueda CQL.
type SearchHit struct {
	Title   string `json:"title"`
	Content struct {
		ID flexID `json:"id"`
	} `json:"content"`
	Container struct {
		Title string `json:"title"`
	} `json:"resultGlobalContainer"`
}

// CredentialError dice que la causa de un 403/404 de Confluence es la credencial, no la ruta.
type CredentialError struct {
	Status     int
	Path, Site string
	Email      string
}

func (e *CredentialError) Error() string {
	return fmt.Sprintf("HTTP %d en %s, pero la causa es la CREDENCIAL: %s/rest/api/3/myself devuelve 401.\n"+
		"El token de %s venció o fue revocado. Generá uno nuevo en\n"+
		"  https://id.atlassian.com/manage-profile/security/api-tokens\n"+
		"y actualizá ATLASSIAN_API_TOKEN en connectors/.env (gitignoreado).", e.Status, e.Path, e.Site, e.Email)
}

// wiki hace un GET de lectura y, si falla, dice por qué. ⚠ Atlassian NO contesta 401 cuando la
// credencial no sirve: en `/wiki` devuelve 403 y en la API v2 devuelve **404**. Leído tal cual, un 404
// en `/wiki/api/v2/spaces` se diagnostica como ruta mal armada o espacio inexistente — y son tres pasos
// hasta descubrir que el token venció. El que sí dice la verdad es el endpoint de Jira: 401.
func (c *Client) wiki(ctx context.Context, path string, params url.Values, out any) error {
	full := path
	if len(params) > 0 {
		full += "?" + params.Encode()
	}
	err := c.do(ctx, http.MethodGet, full, nil, out)
	var he *HTTPError
	if err == nil || !errors.As(err, &he) {
		return err
	}
	if he.Status == 401 || he.Status == 403 || he.Status == 404 {
		_, probe := c.GetMyself(ctx)
		var pe *HTTPError
		if errors.As(probe, &pe) && pe.Status == 401 {
			return &CredentialError{Status: he.Status, Path: path, Site: c.baseURL, Email: c.email}
		}
	}
	return fmt.Errorf("HTTP %d en %s: %s", he.Status, path, clip(he.Body, 300))
}

func clip(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}

// Spaces lista los espacios, sin los personales (`~…`), ordenados por clave.
func (c *Client) Spaces(ctx context.Context) ([]Space, error) {
	var out struct {
		Results []Space `json:"results"`
	}
	if err := c.wiki(ctx, "/wiki/api/v2/spaces", url.Values{"limit": {"250"}}, &out); err != nil {
		return nil, err
	}
	var spaces []Space
	for _, s := range out.Results {
		if !strings.HasPrefix(s.Key, "~") {
			spaces = append(spaces, s)
		}
	}
	sort.SliceStable(spaces, func(i, j int) bool { return spaces[i].Key < spaces[j].Key })
	return spaces, nil
}

// ErrNoSpace: la clave no corresponde a ningún espacio.
var ErrNoSpace = errors.New("no existe el espacio")

// Pages lista todas las páginas de un espacio, siguiendo el cursor.
func (c *Client) Pages(ctx context.Context, key string) ([]PageRef, error) {
	var found struct {
		Results []Space `json:"results"`
	}
	if err := c.wiki(ctx, "/wiki/api/v2/spaces", url.Values{"keys": {key}}, &found); err != nil {
		return nil, err
	}
	if len(found.Results) == 0 {
		return nil, fmt.Errorf("%w %s", ErrNoSpace, key)
	}
	sid := string(found.Results[0].ID)
	var all []PageRef
	cursor := ""
	for {
		params := url.Values{"limit": {"250"}}
		if cursor != "" {
			params.Set("cursor", cursor)
		}
		var page struct {
			Results []PageRef `json:"results"`
			Links   struct {
				Next string `json:"next"`
			} `json:"_links"`
		}
		if err := c.wiki(ctx, "/wiki/api/v2/spaces/"+sid+"/pages", params, &page); err != nil {
			return nil, err
		}
		all = append(all, page.Results...)
		if page.Links.Next == "" {
			break
		}
		next, err := url.Parse(page.Links.Next)
		if err != nil {
			break
		}
		if cursor = next.Query().Get("cursor"); cursor == "" {
			break
		}
	}
	return all, nil
}

// ReadPage trae una página con su cuerpo.
func (c *Client) ReadPage(ctx context.Context, id string) (*Page, error) {
	var p Page
	if err := c.wiki(ctx, "/wiki/api/v2/pages/"+url.PathEscape(id), url.Values{"body-format": {"storage"}}, &p); err != nil {
		return nil, err
	}
	return &p, nil
}

// Search busca páginas por texto (CQL `text ~ "…" and type = page`), hasta 40.
func (c *Client) Search(ctx context.Context, query string) ([]SearchHit, error) {
	cql := fmt.Sprintf(`text ~ "%s" and type = page`, query)
	var out struct {
		Results []SearchHit `json:"results"`
	}
	if err := c.wiki(ctx, "/wiki/rest/api/search", url.Values{"cql": {cql}, "limit": {"40"}}, &out); err != nil {
		return nil, err
	}
	return out.Results, nil
}

// ── formato de almacenamiento (XHTML de Confluence) → texto plano legible ─────────────────────────

type rule struct {
	re   *regexp.Regexp
	with string
}

var storageRules = []rule{
	// macros que traen código o texto suelto
	{regexp.MustCompile(`(?s)<ac:structured-macro[^>]*ac:name="code".*?<!\[CDATA\[(.*?)\]\]>.*?</ac:structured-macro>`), "\n```\n${1}\n```\n"},
	{regexp.MustCompile(`(?s)<ac:parameter[^>]*>.*?</ac:parameter>`), ""},
	{regexp.MustCompile(`<ri:page[^>]*ri:content-title="([^"]*)"[^>]*/?>`), "[[${1}]]"},
	{regexp.MustCompile(`<ri:(user|attachment|url)[^>]*/?>`), ""},
	{regexp.MustCompile(`</?ac:(link|inline-comment-marker|placeholder|adf-[a-z-]+)[^>]*>`), ""},
	{regexp.MustCompile(`<ac:structured-macro[^>]*ac:name="([a-z-]+)"[^>]*/>`), "«macro ${1}»"},
	{regexp.MustCompile(`</?ac:[a-z-]+[^>]*>`), ""},
	{regexp.MustCompile(`<h1[^>]*>`), "\n\n# "},
	{regexp.MustCompile(`<h2[^>]*>`), "\n\n## "},
	{regexp.MustCompile(`<h3[^>]*>`), "\n\n### "},
	{regexp.MustCompile(`<h[4-6][^>]*>`), "\n\n#### "},
	{regexp.MustCompile(`</h[1-6]>`), "\n"},
	{regexp.MustCompile(`<li[^>]*>`), "\n- "},
	{regexp.MustCompile(`</(p|div|tr|li|ul|ol|table)>`), "\n"},
	{regexp.MustCompile(`<br\s*/?>`), "\n"},
	{regexp.MustCompile(`</t[hd]>`), " | "},
	{regexp.MustCompile(`<[^>]+>`), ""},
}

var (
	trailingBlanks = regexp.MustCompile(`[ \t]+\n`)
	manyNewlines   = regexp.MustCompile(`\n{3,}`)
)

// StorageToText pasa el cuerpo de una página a texto: encabezados como Markdown, listas con guion,
// celdas separadas por `|`, macros de código como bloque y enlaces a páginas como [[título]].
func StorageToText(xhtml string) string {
	t := xhtml
	for _, r := range storageRules {
		t = r.re.ReplaceAllString(t, r.with)
	}
	t = html.UnescapeString(t)
	t = trailingBlanks.ReplaceAllString(t, "\n")
	t = manyNewlines.ReplaceAllString(t, "\n\n")
	return strings.TrimFunc(t, text.IsSpace)
}
