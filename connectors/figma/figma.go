// Package figma es la conexión con la API REST de Figma, y sólo LEE: quién es la cuenta, la estructura
// de un archivo (páginas y frames), el árbol de un nodo con sus textos, los comentarios y los enlaces
// para exportar un nodo como imagen. No escribe nada: ni comentarios, ni variables, ni archivos.
//
// Y lee cómo está ARMADO un diseño (`Structure`, en structure.go): los carriles, el orden de cada
// recorrido, el título y los botones de cada pantalla, las decisiones, las flechas, el prototipo y las
// variantes. Eso es lo que hace falta para entender un flujo; el árbol de nodos solo no lo dice.
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
	"strconv"
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
		hint = " — la cuenta del token no tiene acceso (al archivo o al equipo) o le falta el scope"
	case 404:
		hint = " — el archivo o el nodo no existen, o la cuenta no los ve"
	}
	return fmt.Sprintf("Figma HTTP %d: %s%s", e.Status, e.Message, hint)
}

// maxRetryWait es lo más que se espera por un 429 antes de reintentar. Figma pide esperar en
// `Retry-After`; más de esto y es mejor que el error suba y lo vea quien llamó.
var maxRetryWait = 30 * time.Second

// get pide `path` (con su query) y decodifica el JSON en `out`. Ante un 429 espera lo que Figma pide y
// reintenta, dos veces como mucho: medido el 2026-09-24, traducir 49 pantallas seguidas (un pedido por
// pantalla más las exportaciones) topaba el límite, y sin esto cada pantalla de la tanda fallaba.
func (c *Client) get(ctx context.Context, path string, out any) error {
	var resp *http.Response
	for attempt := 0; ; attempt++ {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.base+path, nil)
		if err != nil {
			return err
		}
		req.Header.Set("X-Figma-Token", c.token)
		resp, err = c.http.Do(req)
		if err != nil {
			return fmt.Errorf("red: %v", err)
		}
		if resp.StatusCode != http.StatusTooManyRequests || attempt == 2 {
			break
		}
		wait := 5 * time.Second
		if s, err := strconv.Atoi(resp.Header.Get("Retry-After")); err == nil && s >= 0 {
			wait = time.Duration(s) * time.Second
		}
		resp.Body.Close()
		if wait > maxRetryWait {
			return &Error{Status: 429, Message: fmt.Sprintf("Figma pide esperar %s antes de otro pedido", wait)}
		}
		select {
		case <-time.After(wait):
		case <-ctx.Done():
			return ctx.Err()
		}
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

// shapes son los tipos que dibujan y no dicen nada: un ícono, la barra de estado, un texto convertido
// a trazos (Figma lo guarda como un VECTOR por letra).
var shapes = map[string]bool{"VECTOR": true, "BOOLEAN_OPERATION": true, "ELLIPSE": true, "LINE": true,
	"STAR": true, "REGULAR_POLYGON": true, "RECTANGLE": true}

// Drawing dice si todo el subárbol de `n` es dibujo —sin un solo texto— y cuántos trazos tiene. Sirve
// para colapsarlo en una línea al LEER una pantalla: medido en `flujo-ecommerce`, 31 de 77 líneas de
// una pantalla eran trazos. Un nodo recortado (`Cut`) no se puede afirmar como dibujo: no se vio entero.
func Drawing(n Node) (strokes int, ok bool) {
	if n.Characters != "" || n.Type == "TEXT" || n.Cut > 0 {
		return 0, false
	}
	if len(n.Children) == 0 {
		return 1, shapes[n.Type]
	}
	for _, ch := range n.Children {
		s, ok := Drawing(ch)
		if !ok {
			return 0, false
		}
		strokes += s
	}
	return strokes, true
}

// Texts son los nodos de texto del subárbol, en el orden del documento: el copy de una pantalla.
func Texts(n Node) []Node {
	var out []Node
	if n.Characters != "" {
		out = append(out, n)
	}
	for _, ch := range n.Children {
		out = append(out, Texts(ch)...)
	}
	return out
}

// NodeJSON devuelve el documento crudo de un nodo, con TODAS sus propiedades (auto-layout, rellenos,
// estilos de texto, efectos): lo que necesita quien lo traduce a otra cosa, que no es asunto de este
// paquete. Sale tal cual lo manda Figma, dentro de `document`.
func (c *Client) NodeJSON(ctx context.Context, key, id string) (json.RawMessage, error) {
	var raw struct {
		Nodes map[string]*struct {
			Document json.RawMessage `json:"document"`
		} `json:"nodes"`
	}
	q := url.Values{"ids": {id}}
	if err := c.get(ctx, "/v1/files/"+url.PathEscape(key)+"/nodes?"+q.Encode(), &raw); err != nil {
		return nil, err
	}
	n, ok := raw.Nodes[id]
	if !ok || n == nil || len(n.Document) == 0 {
		return nil, &Error{Status: 404, Message: "el nodo " + id + " no está en el archivo"}
	}
	return n.Document, nil
}

// ImageFills son los enlaces de las imágenes usadas como RELLENO en el archivo (fotos, logos): de la
// referencia que trae cada relleno (`imageRef`) al enlace de S3. Distinto de Images, que exporta un
// nodo renderizado. ⚠ Los enlaces vencen: se bajan, no se guardan.
func (c *Client) ImageFills(ctx context.Context, key string) (map[string]string, error) {
	var raw struct {
		Meta struct {
			Images map[string]string `json:"images"`
		} `json:"meta"`
	}
	if err := c.get(ctx, "/v1/files/"+url.PathEscape(key)+"/images", &raw); err != nil {
		return nil, err
	}
	return raw.Meta.Images, nil
}

// Project es un proyecto (una carpeta) de un equipo de Figma.
type Project struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// FileEntry es un archivo dentro de un proyecto.
type FileEntry struct {
	Key          string `json:"key"`
	Name         string `json:"name"`
	LastModified string `json:"last_modified"`
	Thumbnail    string `json:"thumbnail_url"`
}

// TeamProjects son los proyectos de un equipo. El id del equipo es el número que va en la URL de su
// página (`figma.com/files/team/<id>/…`): la API no lista los equipos de una cuenta ni lo «visto
// recientemente», así que se entra por ahí.
func (c *Client) TeamProjects(ctx context.Context, team string) (string, []Project, error) {
	var raw struct {
		Name     string `json:"name"`
		Projects []struct {
			ID   any    `json:"id"`
			Name string `json:"name"`
		} `json:"projects"`
	}
	if err := c.get(ctx, "/v1/teams/"+url.PathEscape(team)+"/projects", &raw); err != nil {
		return "", nil, err
	}
	out := make([]Project, 0, len(raw.Projects))
	for _, p := range raw.Projects {
		out = append(out, Project{ID: fmt.Sprint(p.ID), Name: p.Name})
	}
	return raw.Name, out, nil
}

// ProjectFiles son los archivos de un proyecto, del más reciente al más viejo.
func (c *Client) ProjectFiles(ctx context.Context, project string) ([]FileEntry, error) {
	_, files, err := c.ProjectFilesNamed(ctx, project)
	return files, err
}

// ProjectFilesNamed es ProjectFiles con el nombre del proyecto, que la misma respuesta trae.
func (c *Client) ProjectFilesNamed(ctx context.Context, project string) (string, []FileEntry, error) {
	var raw struct {
		Name  string      `json:"name"`
		Files []FileEntry `json:"files"`
	}
	if err := c.get(ctx, "/v1/projects/"+url.PathEscape(project)+"/files", &raw); err != nil {
		return "", nil, err
	}
	sort.SliceStable(raw.Files, func(i, j int) bool { return raw.Files[i].LastModified > raw.Files[j].LastModified })
	return raw.Name, raw.Files, nil
}

// FileMeta es lo que Figma dice de un archivo sin bajarlo: su carpeta, quién lo creó y quién lo tocó
// último. ⚠ No trae el id del proyecto ni del equipo: con esto no se llega a los archivos vecinos.
type FileMeta struct {
	Name        string `json:"name"`
	Folder      string `json:"folder_name"`
	Creator     string `json:"creator"`
	LastTouched string `json:"last_touched_at"`
	TouchedBy   string `json:"last_touched_by"`
	Role        string `json:"role"`
}

func (c *Client) Meta(ctx context.Context, key string) (FileMeta, error) {
	var raw struct {
		File struct {
			Name        string `json:"name"`
			Folder      string `json:"folder_name"`
			LastTouched string `json:"last_touched_at"`
			Role        string `json:"role"`
			Creator     struct {
				Handle string `json:"handle"`
			} `json:"creator"`
			TouchedBy struct {
				Handle string `json:"handle"`
			} `json:"last_touched_by"`
		} `json:"file"`
	}
	if err := c.get(ctx, "/v1/files/"+url.PathEscape(key)+"/meta", &raw); err != nil {
		return FileMeta{}, err
	}
	f := raw.File
	return FileMeta{Name: f.Name, Folder: f.Folder, Creator: f.Creator.Handle, LastTouched: f.LastTouched, TouchedBy: f.TouchedBy.Handle, Role: f.Role}, nil
}

// Pages son las páginas de un archivo (los CANVAS): id y nombre. Pide sólo un nivel, que es barato
// aunque el archivo sea enorme.
func (c *Client) Pages(ctx context.Context, key string) (string, []Project, error) {
	var raw struct {
		Name     string `json:"name"`
		Document struct {
			Children []struct {
				ID   string `json:"id"`
				Name string `json:"name"`
				Type string `json:"type"`
			} `json:"children"`
		} `json:"document"`
	}
	if err := c.get(ctx, "/v1/files/"+url.PathEscape(key)+"?depth=1", &raw); err != nil {
		return "", nil, err
	}
	var out []Project
	for _, ch := range raw.Document.Children {
		if ch.Type == "CANVAS" {
			out = append(out, Project{ID: ch.ID, Name: ch.Name})
		}
	}
	return raw.Name, out, nil
}
