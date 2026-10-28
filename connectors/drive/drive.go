// Package drive es la conexión con Google Drive, y sólo LEE: quién es la cuenta, qué hay en una carpeta,
// buscar por nombre o contenido, y el contenido de un archivo (los Docs, Sheets y Slides exportados a
// texto; el resto, descargado tal cual). No escribe, no comparte ni borra nada: el alcance que pide es
// `drive.readonly`, así que aunque el código quisiera, Google no lo dejaría.
//
// Entra con la cuenta de Google de quien corre `pg drive login` (OAuth de escritorio con PKCE) y ve lo
// mismo que esa persona ve en drive.google.com. El cliente OAuth (`DRIVE_CLIENT_ID`, `DRIVE_CLIENT_SECRET`)
// vive en `connectors/.env`; el refresh token, en `connectors/.auth/drive.json` (600, fuera de git).
//
// Nació el 2026-10-28 para leer la carpeta «Finandina» que compartió Manuela.
package drive

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"

	"creditop/playground/connectors/env"
)

// API es el host real de Drive v3. Un pedido sólo sale hacia ahí, o hacia TokenURL.
const API = "https://www.googleapis.com/drive/v3"

// Scope es el único permiso que se pide.
const Scope = "https://www.googleapis.com/auth/drive.readonly"

// MaxDownload es el tope de un archivo descargado o exportado.
const MaxDownload = 100_000_000

// Mime de los tipos propios de Google.
const (
	Folder   = "application/vnd.google-apps.folder"
	Doc      = "application/vnd.google-apps.document"
	Sheet    = "application/vnd.google-apps.spreadsheet"
	Slides   = "application/vnd.google-apps.presentation"
	Shortcut = "application/vnd.google-apps.shortcut"
)

// OAuthClient es el cliente OAuth de escritorio creado en Google Cloud.
type OAuthClient struct {
	ID     string
	Secret string
}

// LoadOAuthClient lee `DRIVE_CLIENT_ID` y `DRIVE_CLIENT_SECRET` del proceso o de `connectors/.env`.
func LoadOAuthClient() (OAuthClient, error) {
	v, err := env.LoadShared()
	if err != nil {
		return OAuthClient{}, err
	}
	c := OAuthClient{ID: v.Get("DRIVE_CLIENT_ID"), Secret: v.Get("DRIVE_CLIENT_SECRET")}
	if c.ID == "" || c.Secret == "" {
		return c, errors.New("faltan DRIVE_CLIENT_ID y DRIVE_CLIENT_SECRET en el entorno o en connectors/.env " +
			"(un cliente OAuth de tipo «App de escritorio» en Google Cloud, con la Drive API habilitada)")
	}
	return c, nil
}

// Client hace GETs a Drive con un access token que renueva solo a partir del refresh token.
type Client struct {
	oauth OAuthClient
	sess  Session
	http  *http.Client
	base  string

	mu      sync.Mutex
	access  string
	expires time.Time
}

// New arma el cliente con la sesión guardada.
func New(oauth OAuthClient, sess Session) *Client {
	return &Client{oauth: oauth, sess: sess, base: API, http: &http.Client{
		Timeout:       2 * time.Minute,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}}
}

// Open junta las dos mitades: el cliente OAuth y la sesión de `pg drive login`.
func Open() (*Client, error) {
	oc, err := LoadOAuthClient()
	if err != nil {
		return nil, err
	}
	s, err := LoadSession()
	if err != nil {
		return nil, err
	}
	return New(oc, s), nil
}

func (c *Client) token(ctx context.Context) (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.access != "" && time.Until(c.expires) > time.Minute {
		return c.access, nil
	}
	t, err := refresh(ctx, c.http, c.oauth, c.sess.RefreshToken)
	if err != nil {
		return "", err
	}
	c.access, c.expires = t.AccessToken, time.Now().Add(time.Duration(t.ExpiresIn)*time.Second)
	return c.access, nil
}

// get pide una ruta de la API y devuelve el cuerpo abierto; quien llama lo cierra.
func (c *Client) get(ctx context.Context, path string, q url.Values) (io.ReadCloser, http.Header, error) {
	tok, err := c.token(ctx)
	if err != nil {
		return nil, nil, err
	}
	u := c.base + path
	if len(q) > 0 {
		u += "?" + q.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, nil, err
	}
	req.Header.Set("Authorization", "Bearer "+tok)
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, nil, err
	}
	if resp.StatusCode/100 != 2 {
		defer resp.Body.Close()
		return nil, nil, apiError(resp)
	}
	return resp.Body, resp.Header, nil
}

func (c *Client) getJSON(ctx context.Context, path string, q url.Values, out any) error {
	body, _, err := c.get(ctx, path, q)
	if err != nil {
		return err
	}
	defer body.Close()
	return json.NewDecoder(io.LimitReader(body, 20_000_000)).Decode(out)
}

func apiError(resp *http.Response) error {
	b, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	var e struct {
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	msg := strings.TrimSpace(string(b))
	if json.Unmarshal(b, &e) == nil && e.Error.Message != "" {
		msg = e.Error.Message
	}
	switch resp.StatusCode {
	case http.StatusNotFound:
		return fmt.Errorf("drive 404: no existe o tu cuenta no tiene acceso (%s)", msg)
	case http.StatusForbidden:
		return fmt.Errorf("drive 403: %s", msg)
	}
	return fmt.Errorf("drive %d: %s", resp.StatusCode, msg)
}

// User es la cuenta con la que se entró.
type User struct {
	Name  string `json:"displayName"`
	Email string `json:"emailAddress"`
}

// Me dice de quién es la sesión.
func (c *Client) Me(ctx context.Context) (User, error) {
	var a struct {
		User User `json:"user"`
	}
	err := c.getJSON(ctx, "/about", url.Values{"fields": {"user(displayName,emailAddress)"}}, &a)
	return a.User, err
}

// File es la metadata que sirve para decidir qué hacer con un archivo.
type File struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	MimeType     string   `json:"mimeType"`
	Size         string   `json:"size,omitempty"`
	ModifiedTime string   `json:"modifiedTime,omitempty"`
	Owners       []User   `json:"owners,omitempty"`
	Parents      []string `json:"parents,omitempty"`
	WebViewLink  string   `json:"webViewLink,omitempty"`
	Shortcut     *struct {
		TargetID   string `json:"targetId"`
		TargetMime string `json:"targetMimeType"`
	} `json:"shortcutDetails,omitempty"`
}

const fileFields = "id,name,mimeType,size,modifiedTime,owners(displayName,emailAddress),parents,webViewLink,shortcutDetails"

// IsFolder dice si es carpeta (o un atajo a una).
func (f File) IsFolder() bool {
	return f.MimeType == Folder || (f.Shortcut != nil && f.Shortcut.TargetMime == Folder)
}

// Target es el id al que hay que ir: el del archivo, o el destino si es un atajo.
func (f File) Target() string {
	if f.Shortcut != nil && f.Shortcut.TargetID != "" {
		return f.Shortcut.TargetID
	}
	return f.ID
}

// Get trae la metadata de un archivo o carpeta. Si es un atajo, trae la del destino.
func (c *Client) Get(ctx context.Context, id string) (File, error) {
	var f File
	q := url.Values{"fields": {fileFields}, "supportsAllDrives": {"true"}}
	if err := c.getJSON(ctx, "/files/"+url.PathEscape(id), q, &f); err != nil {
		return f, err
	}
	if f.MimeType == Shortcut && f.Shortcut != nil {
		return c.Get(ctx, f.Shortcut.TargetID)
	}
	return f, nil
}

// List trae los hijos de una carpeta, carpetas primero y después por nombre.
func (c *Client) List(ctx context.Context, folder string) ([]File, error) {
	return c.query(ctx, fmt.Sprintf("'%s' in parents and trashed = false", quote(folder)), 0)
}

// Search busca por nombre o contenido (el `fullText` de Drive), en todo lo que la cuenta ve o sólo dentro
// de una carpeta (sus hijos directos: Drive no busca recursivo por carpeta).
func (c *Client) Search(ctx context.Context, text, folder string, limit int) ([]File, error) {
	q := fmt.Sprintf("fullText contains '%s' and trashed = false", quote(text))
	if folder != "" {
		q += fmt.Sprintf(" and '%s' in parents", quote(folder))
	}
	return c.query(ctx, q, limit)
}

func (c *Client) query(ctx context.Context, q string, limit int) ([]File, error) {
	var all []File
	page := ""
	for {
		v := url.Values{
			"q":                         {q},
			"fields":                    {"nextPageToken,files(" + fileFields + ")"},
			"pageSize":                  {"200"},
			"orderBy":                   {"folder,name"},
			"supportsAllDrives":         {"true"},
			"includeItemsFromAllDrives": {"true"},
			"corpora":                   {"allDrives"},
		}
		if strings.Contains(q, "fullText") {
			v.Del("orderBy") // Drive no ordena una búsqueda de texto
		}
		if page != "" {
			v.Set("pageToken", page)
		}
		var r struct {
			Next  string `json:"nextPageToken"`
			Files []File `json:"files"`
		}
		if err := c.getJSON(ctx, "/files", v, &r); err != nil {
			return nil, err
		}
		all = append(all, r.Files...)
		if limit > 0 && len(all) >= limit {
			return all[:limit], nil
		}
		if r.Next == "" {
			return all, nil
		}
		page = r.Next
	}
}

// Export convierte un archivo de Google (Doc, Sheet, Slides) al formato pedido. Drive lo limita a 10 MB.
func (c *Client) Export(ctx context.Context, id, mime string) (io.ReadCloser, error) {
	body, _, err := c.get(ctx, "/files/"+url.PathEscape(id)+"/export", url.Values{"mimeType": {mime}})
	return limited(body), err
}

// Download baja un archivo que no es de Google (PDF, xlsx, docx, imágenes…) tal cual.
func (c *Client) Download(ctx context.Context, id string) (io.ReadCloser, error) {
	body, _, err := c.get(ctx, "/files/"+url.PathEscape(id), url.Values{"alt": {"media"}, "supportsAllDrives": {"true"}})
	return limited(body), err
}

type limitedBody struct {
	io.Reader
	io.Closer
}

func limited(body io.ReadCloser) io.ReadCloser {
	if body == nil {
		return nil
	}
	return limitedBody{io.LimitReader(body, MaxDownload), body}
}

// DefaultExport es a qué se exporta cada tipo de Google para LEERLO como texto, y la extensión que le
// corresponde. Un Sheet a CSV trae SÓLO la primera hoja: para todas, xlsx.
func DefaultExport(mime string) (string, string, bool) {
	switch mime {
	case Doc:
		return "text/markdown", ".md", true
	case Sheet:
		return "text/csv", ".csv", true
	case Slides:
		return "text/plain", ".txt", true
	}
	return "", "", false
}

// IsGoogle dice si el archivo sólo se puede exportar (no tiene bytes propios).
func IsGoogle(mime string) bool {
	return strings.HasPrefix(mime, "application/vnd.google-apps.")
}

// IsText dice si un archivo descargado se puede imprimir tal cual.
func IsText(mime string) bool {
	return strings.HasPrefix(mime, "text/") || mime == "application/json" || mime == "application/xml"
}

// quote escapa una cadena para ponerla entre comillas simples en una consulta de Drive.
func quote(s string) string {
	return strings.NewReplacer(`\`, `\\`, `'`, `\'`).Replace(s)
}

var (
	idInPath  = regexp.MustCompile(`/(?:folders|d)/([A-Za-z0-9_-]{10,})`)
	idInQuery = regexp.MustCompile(`[?&]id=([A-Za-z0-9_-]{10,})`)
	bareID    = regexp.MustCompile(`^[A-Za-z0-9_-]{10,}$`)
)

// ParseID saca el id de lo que se copia del navegador: una carpeta (`/drive/folders/<id>`), un archivo
// (`/file/d/<id>/view`), un Doc, Sheet o Slides (`docs.google.com/…/d/<id>/edit`), un `open?id=<id>`, o
// el id solo.
func ParseID(ref string) (string, error) {
	ref = strings.TrimSpace(ref)
	if bareID.MatchString(ref) {
		return ref, nil
	}
	if m := idInPath.FindStringSubmatch(ref); m != nil {
		return m[1], nil
	}
	if m := idInQuery.FindStringSubmatch(ref); m != nil {
		return m[1], nil
	}
	return "", fmt.Errorf("no reconozco %q como URL o id de Drive", ref)
}
