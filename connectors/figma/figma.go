// Package figma es la conexión con la API REST de Figma, y sólo LEE: quién es la cuenta, la estructura
// de un archivo (páginas y frames), el árbol de un nodo con sus textos, los comentarios y los enlaces
// para exportar un nodo como imagen. No escribe nada: ni comentarios, ni variables, ni archivos.
//
// Nació el 2026-09-24, cuando el `FIGMA_TOKEN` suelto del `.env` de la raíz —que no leía ningún
// código— pasó a `connectors/.env`.
package figma

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"time"

	"creditop/playground/connectors/env"
)

// API es el host real. Un pedido sólo sale hacia ahí: el token viaja en cada uno.
const API = "https://api.figma.com"

// maxBody es el tope de una respuesta. Un archivo grande de Figma pesa decenas de MB con depth
// completo; por eso File pide dos niveles y Node recorta el árbol.
const maxBody = 50_000_000

// LoadToken lee `FIGMA_TOKEN` del proceso o de `connectors/.env` (el proceso gana).
func LoadToken() (string, error) {
	v, err := env.LoadShared()
	if err != nil {
		return "", err
	}
	if t := v.Get("FIGMA_TOKEN"); t != "" {
		return t, nil
	}
	return "", errors.New("falta FIGMA_TOKEN en el entorno o en connectors/.env (un personal access token de Figma)")
}

// Client hace GETs a la API de Figma. No sigue redirecciones: una redirección es una respuesta, no un
// lugar al que mandarle el token.
type Client struct {
	base  string
	token string
	http  *http.Client
}

// New arma el cliente contra la API real.
func New(token string) *Client {
	return &Client{base: API, token: token, http: &http.Client{
		Timeout:       60 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}}
}

// Error es un fallo de la API: el código y el mensaje que devolvió Figma. ⚠ Nunca lleva el token.
type Error struct {
	Status  int
	Message string
}

func (e *Error) Error() string {
	hint := ""
	switch e.Status {
	case 403:
		hint = " — el token no tiene acceso a este archivo o le falta el scope"
	case 404:
		hint = " — el archivo o el nodo no existen, o la cuenta no los ve"
	}
	return fmt.Sprintf("Figma HTTP %d: %s%s", e.Status, e.Message, hint)
}

// get pide `path` (con su query) y decodifica el JSON en `out`.
func (c *Client) get(ctx context.Context, path string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.base+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("X-Figma-Token", c.token)
	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("red: %v", err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, maxBody+1))
	if err != nil {
		return fmt.Errorf("leyendo la respuesta: %v", err)
	}
	if len(raw) > maxBody {
		return fmt.Errorf("la respuesta pasa de %d bytes: pedí menos profundidad o un nodo más chico", maxBody)
	}
	if resp.StatusCode != 200 {
		var e struct {
			Err     string `json:"err"`
			Message string `json:"message"`
		}
		_ = json.Unmarshal(raw, &e)
		msg := e.Err
		if msg == "" {
			msg = e.Message
		}
		if msg == "" {
			msg = strings.TrimSpace(string(raw))
			if len(msg) > 150 {
				msg = msg[:150]
			}
		}
		return &Error{Status: resp.StatusCode, Message: msg}
	}
	if err := json.Unmarshal(raw, out); err != nil {
		return fmt.Errorf("la respuesta de Figma no es el JSON esperado: %v", err)
	}
	return nil
}

// Ref es a qué apunta una referencia: un archivo y, si la URL lo trae, un nodo.
type Ref struct {
	FileKey string
	NodeID  string // con `:` (`1:2`), como lo pide la API
}

var (
	reFileURL = regexp.MustCompile(`figma\.com/(?:file|design|proto|board|slides|deck)/([A-Za-z0-9]+)`)
	reBranch  = regexp.MustCompile(`/branch/([A-Za-z0-9]+)`)
	reKey     = regexp.MustCompile(`^[A-Za-z0-9]{10,}$`)
)

// ParseRef acepta la URL que se copia de Figma (`…/design/<key>/<nombre>?node-id=1-2`) o la clave
// sola. En la URL el nodo va con guion (`1-2`) y la API lo quiere con dos puntos (`1:2`); de una rama
// vale la clave de la rama, no la del archivo principal.
func ParseRef(s string) (Ref, error) {
	s = strings.TrimSpace(s)
	if reKey.MatchString(s) {
		return Ref{FileKey: s}, nil
	}
	m := reFileURL.FindStringSubmatch(s)
	if m == nil {
		return Ref{}, fmt.Errorf("no reconozco %q: pasá la URL de Figma o la clave del archivo", s)
	}
	ref := Ref{FileKey: m[1]}
	if b := reBranch.FindStringSubmatch(s); b != nil {
		ref.FileKey = b[1]
	}
	if u, err := url.Parse(s); err == nil {
		if id := u.Query().Get("node-id"); id != "" {
			ref.NodeID = strings.ReplaceAll(id, "-", ":")
		}
	}
	return ref, nil
}

// User es la cuenta del token.
type User struct {
	ID     string `json:"id"`
	Handle string `json:"handle"`
	Email  string `json:"email"`
}

// Me dice de quién es el token: la forma barata de saber si sirve.
func (c *Client) Me(ctx context.Context) (User, error) {
	var u User
	err := c.get(ctx, "/v1/me", &u)
	return u, err
}

// Node es un nodo del documento, con lo que sirve para LEER un diseño: su tipo, su tamaño y, si es
// texto, lo que dice. Los estilos y la geometría completa no están: para eso está el JSON crudo.
type Node struct {
	ID         string  `json:"id"`
	Name       string  `json:"name"`
	Type       string  `json:"type"`
	Characters string  `json:"characters,omitempty"`
	Width      float64 `json:"width,omitempty"`
	Height     float64 `json:"height,omitempty"`
	Children   []Node  `json:"children,omitempty"`
	// Cut: cuántos hijos quedaron afuera por el tope de profundidad.
	Cut int `json:"cut,omitempty"`
}

type rawNode struct {
	ID                  string                           `json:"id"`
	Name                string                           `json:"name"`
	Type                string                           `json:"type"`
	Characters          string                           `json:"characters"`
	AbsoluteBoundingBox *struct{ Width, Height float64 } `json:"absoluteBoundingBox"`
	Children            []rawNode                        `json:"children"`
}

func (r rawNode) trim(depth int) Node {
	n := Node{ID: r.ID, Name: r.Name, Type: r.Type, Characters: r.Characters}
	if b := r.AbsoluteBoundingBox; b != nil {
		n.Width, n.Height = b.Width, b.Height
	}
	if depth <= 0 {
		n.Cut = len(r.Children)
		return n
	}
	for _, ch := range r.Children {
		n.Children = append(n.Children, ch.trim(depth-1))
	}
	return n
}

// File es un archivo: su nombre, cuándo cambió y sus páginas con los nodos de primer nivel.
type File struct {
	Key          string `json:"key"`
	Name         string `json:"name"`
	LastModified string `json:"last_modified"`
	Version      string `json:"version"`
	Pages        []Node `json:"pages"`
}

// File trae la estructura del archivo: páginas y sus nodos de primer nivel (casi siempre, los frames).
// Pide `depth=2` a propósito: el documento entero de un archivo real no se lee y pesa decenas de MB.
func (c *Client) File(ctx context.Context, key string) (File, error) {
	var raw struct {
		Name         string  `json:"name"`
		LastModified string  `json:"lastModified"`
		Version      string  `json:"version"`
		Document     rawNode `json:"document"`
	}
	if err := c.get(ctx, "/v1/files/"+url.PathEscape(key)+"?depth=2", &raw); err != nil {
		return File{}, err
	}
	f := File{Key: key, Name: raw.Name, LastModified: raw.LastModified, Version: raw.Version}
	for _, page := range raw.Document.Children {
		f.Pages = append(f.Pages, page.trim(1))
	}
	return f, nil
}

// Nodes trae el árbol de cada nodo pedido, recortado a `depth` niveles.
func (c *Client) Nodes(ctx context.Context, key string, ids []string, depth int) (map[string]Node, error) {
	if len(ids) == 0 {
		return nil, errors.New("faltan los ids de los nodos")
	}
	var raw struct {
		Nodes map[string]*struct {
			Document rawNode `json:"document"`
		} `json:"nodes"`
	}
	// Un nivel más del que se muestra, para poder decir cuántos hijos quedaron afuera (`Cut`).
	q := url.Values{"ids": {strings.Join(ids, ",")}, "depth": {fmt.Sprint(depth + 1)}}
	if err := c.get(ctx, "/v1/files/"+url.PathEscape(key)+"/nodes?"+q.Encode(), &raw); err != nil {
		return nil, err
	}
	out := map[string]Node{}
	for _, id := range ids {
		n, ok := raw.Nodes[id]
		if !ok || n == nil {
			return nil, &Error{Status: 404, Message: "el nodo " + id + " no está en el archivo"}
		}
		out[id] = n.Document.trim(depth)
	}
	return out, nil
}

// Images pide a Figma que exporte los nodos y devuelve un enlace por nodo. ⚠ Los enlaces son de S3 y
// vencen (Figma dice: hasta 30 días); se descargan, no se guardan.
func (c *Client) Images(ctx context.Context, key string, ids []string, format string, scale float64) (map[string]string, error) {
	if len(ids) == 0 {
		return nil, errors.New("faltan los ids de los nodos a exportar")
	}
	switch format {
	case "":
		format = "png"
	case "png", "jpg", "svg", "pdf":
	default:
		return nil, fmt.Errorf("el formato es png, jpg, svg o pdf (no %q)", format)
	}
	q := url.Values{"ids": {strings.Join(ids, ",")}, "format": {format}}
	if scale > 0 {
		q.Set("scale", fmt.Sprint(scale))
	}
	var raw struct {
		Err    string             `json:"err"`
		Images map[string]*string `json:"images"`
	}
	if err := c.get(ctx, "/v1/images/"+url.PathEscape(key)+"?"+q.Encode(), &raw); err != nil {
		return nil, err
	}
	if raw.Err != "" {
		return nil, &Error{Status: 400, Message: raw.Err}
	}
	out := map[string]string{}
	for id, u := range raw.Images {
		if u == nil {
			// Figma devuelve null cuando el nodo no se pudo renderizar (invisible, vacío o inexistente).
			out[id] = ""
			continue
		}
		out[id] = *u
	}
	return out, nil
}

// Comment es un comentario del archivo.
type Comment struct {
	ID         string `json:"id"`
	Author     string `json:"author"`
	Message    string `json:"message"`
	CreatedAt  string `json:"created_at"`
	ResolvedAt string `json:"resolved_at,omitempty"`
	NodeID     string `json:"node_id,omitempty"`
	ParentID   string `json:"parent_id,omitempty"`
}

// Comments son los comentarios del archivo, del más viejo al más nuevo.
func (c *Client) Comments(ctx context.Context, key string) ([]Comment, error) {
	var raw struct {
		Comments []struct {
			ID         string `json:"id"`
			Message    string `json:"message"`
			CreatedAt  string `json:"created_at"`
			ResolvedAt string `json:"resolved_at"`
			ParentID   string `json:"parent_id"`
			User       struct {
				Handle string `json:"handle"`
			} `json:"user"`
			ClientMeta struct {
				NodeID string `json:"node_id"`
			} `json:"client_meta"`
		} `json:"comments"`
	}
	if err := c.get(ctx, "/v1/files/"+url.PathEscape(key)+"/comments", &raw); err != nil {
		return nil, err
	}
	out := make([]Comment, 0, len(raw.Comments))
	for _, r := range raw.Comments {
		out = append(out, Comment{ID: r.ID, Author: r.User.Handle, Message: r.Message, CreatedAt: r.CreatedAt,
			ResolvedAt: r.ResolvedAt, NodeID: r.ClientMeta.NodeID, ParentID: r.ParentID})
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].CreatedAt < out[j].CreatedAt })
	return out, nil
}
