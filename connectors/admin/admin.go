// Package admin es la conexión con el ADMIN de legacy-application: la sesión (Laravel, Fortify), el token CSRF y las
// páginas de Inertia, hablados por HTTP como lo haría un navegador. Sin navegador, ni siquiera para entrar: el login es
// un formulario común.
//
// POR QUÉ ES UN CONECTOR. Crear un comercio en el admin dispara lo de la tarea del asesor de prueba (sucursal, asesor,
// cuenta de Cognito), y probarlo en cada ambiente costaba un par de minutos a mano. Hecho como un cliente más, con las
// credenciales donde viven las demás (`connectors/.env.<ambiente>`), lo usan igual la consola (`pg admin …`), el modelo
// (MCP) y el harness, y se expande a otros endpoints del admin sin copiar nada.
//
// REGLAS QUE SE CUMPLEN ACÁ:
//   - Las credenciales salen SÓLO de `connectors/.env.<ambiente>` (ADMIN_USER y ADMIN_PASS): una cuenta por PERSONA. Nunca
//     de un archivo viejo, y la sesión guardada dice quién es.
//   - Entrar con usuario y contraseña es cosa de una persona (`pg admin login`, que no se ofrece como herramienta del
//     modelo). Lo guardado después lo usan los demás comandos.
//   - Lo que escribe no escribe sin `--apply`: sin él, muestra lo que mandaría.
//   - Producción no está: es sólo lectura. Y qa no tiene admin propio: comparte la base con dev.
package admin

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"net/url"
	"strings"
	"time"
)

// URLs son los admin de cada ambiente.
var URLs = map[string]string{
	"local":   "http://admin.localhost:8000",
	"dev":     "https://admin.dev.creditop.com",
	"staging": "https://admin.staging.creditop.com",
}

// Targets son los ambientes que tienen admin, en el orden en que se muestran.
var Targets = []string{"local", "dev", "staging"}

// BaseFor devuelve el admin del ambiente, o por qué no hay.
func BaseFor(target string) (string, error) {
	t := strings.ToLower(strings.TrimSpace(target))
	switch {
	case t == "prod" || t == "production":
		return "", errors.New("producción es sólo lectura: no se guardan sesiones ni se crea nada ahí")
	case t == "qa":
		return "", errors.New("qa no tiene admin propio: comparte la base con dev (usá --target dev)")
	}
	base, ok := URLs[t]
	if !ok {
		return "", fmt.Errorf("no conozco el admin de %q (los que hay: %s)", target, strings.Join(Targets, ", "))
	}
	return base, nil
}

// ErrNoSession es «no hay una sesión que sirva»: el mensaje dice cómo conseguirla.
var ErrNoSession = errors.New("no hay sesión de admin que sirva")

// Client habla con UN admin con UNA sesión.
type Client struct {
	Base string
	// User y Who son con quién actúa: el correo con que se entró y el nombre que mostró el admin. Se dicen SIEMPRE
	// antes de escribir (ActingAs).
	User, Who string

	http *http.Client
	jar  *jar
}

// New arma un cliente sin sesión sobre `base` (los tests le apuntan a un servidor propio).
func New(base string) *Client {
	return &Client{
		Base: strings.TrimRight(base, "/"),
		jar:  newJar(),
		http: &http.Client{
			Timeout: 60 * time.Second,
			// Las redirecciones se leen, no se siguen: el alta responde con un 302 cuyo destino lleva el id.
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		},
	}
}

// ActingAs dice con quién actúa este cliente, listo para imprimir.
func (c *Client) ActingAs() string {
	switch {
	case c.Who != "" && c.User != "":
		return fmt.Sprintf("%s (%s)", c.Who, c.User)
	case c.User != "":
		return c.User
	}
	return "alguien sin identificar"
}

// Reply es la respuesta de una petición.
type Reply struct {
	Status   int
	Location string
	HTML     string
	// Page es la página de Inertia que viajaba en el HTML, o nil.
	Page *Page
}

func (c *Client) do(ctx context.Context, req *http.Request) (*Reply, error) {
	req = req.WithContext(ctx)
	req.Header.Set("User-Agent", "pg-admin")
	if h := c.jar.header(); h != "" {
		req.Header.Set("Cookie", h)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	c.jar.apply(resp.Cookies(), req.URL.Hostname())
	r := &Reply{Status: resp.StatusCode, Location: resp.Header.Get("Location")}
	if resp.StatusCode < 300 || resp.StatusCode >= 400 {
		raw, err := io.ReadAll(io.LimitReader(resp.Body, 20_000_000))
		if err != nil {
			return nil, err
		}
		r.HTML = string(raw)
		r.Page = ParsePage(r.HTML)
	}
	return r, nil
}

// Get pide una página. Si el admin manda al login, la sesión no sirve.
func (c *Client) Get(ctx context.Context, path string) (*Reply, error) {
	req, err := http.NewRequest(http.MethodGet, c.abs(path), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "text/html")
	r, err := c.do(ctx, req)
	if err != nil {
		return nil, err
	}
	if isLoginRedirect(r.Location) {
		return r, ErrNoSession
	}
	return r, nil
}

func (c *Client) abs(path string) string {
	if strings.HasPrefix(path, "http://") || strings.HasPrefix(path, "https://") {
		return path
	}
	return c.Base + "/" + strings.TrimLeft(path, "/")
}

func isLoginRedirect(location string) bool {
	if location == "" {
		return false
	}
	u, err := url.Parse(location)
	if err != nil {
		return false
	}
	return strings.HasSuffix(strings.TrimRight(u.Path, "/"), "/login")
}

// post manda un formulario con el token CSRF y el origen, como el navegador.
func (c *Client) post(ctx context.Context, path, contentType string, body []byte, referer string) (*Reply, error) {
	req, err := http.NewRequest(http.MethodPost, c.abs(path), bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("Accept", "text/html")
	req.Header.Set("Origin", c.Base)
	req.Header.Set("Referer", c.abs(referer))
	if tok := c.jar.xsrf(); tok != "" {
		req.Header.Set("X-XSRF-TOKEN", tok)
	}
	return c.do(ctx, req)
}

// PostForm manda campos de texto (application/x-www-form-urlencoded).
func (c *Client) PostForm(ctx context.Context, path, referer string, fields url.Values) (*Reply, error) {
	return c.post(ctx, path, "application/x-www-form-urlencoded", []byte(fields.Encode()), referer)
}

// File es un archivo para un formulario multipart.
type File struct {
	Field, Name, ContentType string
	Data                     []byte
}

// PostMultipart manda campos de texto y archivos (multipart/form-data).
func (c *Client) PostMultipart(ctx context.Context, path, referer string, fields [][2]string, files []File) (*Reply, error) {
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	for _, f := range fields {
		if err := w.WriteField(f[0], f[1]); err != nil {
			return nil, err
		}
	}
	for _, f := range files {
		h := make(textproto.MIMEHeader)
		h.Set("Content-Disposition", fmt.Sprintf(`form-data; name=%q; filename=%q`, f.Field, f.Name))
		h.Set("Content-Type", f.ContentType)
		part, err := w.CreatePart(h)
		if err != nil {
			return nil, err
		}
		if _, err := part.Write(f.Data); err != nil {
			return nil, err
		}
	}
	if err := w.Close(); err != nil {
		return nil, err
	}
	return c.post(ctx, path, w.FormDataContentType(), buf.Bytes(), referer)
}

// Follow sigue una redirección que dejó el servidor (ruta absoluta o relativa).
func (c *Client) Follow(ctx context.Context, location string) (*Reply, error) {
	base, _ := url.Parse(c.Base + "/")
	ref, err := url.Parse(location)
	if err != nil {
		return nil, err
	}
	return c.Get(ctx, base.ResolveReference(ref).String())
}

// Probe le pregunta al servidor si la sesión sigue viva y de quién es.
func (c *Client) Probe(ctx context.Context) (who string, err error) {
	r, err := c.Get(ctx, "/aliados")
	if err != nil {
		return "", err
	}
	if r.Status >= 400 {
		return "", fmt.Errorf("el admin contestó HTTP %d", r.Status)
	}
	if r.Page != nil {
		if auth, ok := r.Page.Props["auth"].(map[string]any); ok {
			if n, ok := auth["full_name"].(string); ok {
				return n, nil
			}
		}
	}
	return "", nil
}
