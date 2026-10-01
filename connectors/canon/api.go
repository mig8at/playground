package canon

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"creditop/playground/connectors/env"
)

/* LEER Y DICTAR CANON DESDE LA CONSOLA. `References` y `Brief` son lo que el tablero necesita para una
 * tarea; esto es lo que necesita quien trabaja: buscar si canon ya tiene algo, leer la sección, ver el
 * código que la respalda, ensayar una pieza y dictarla. Lo usa `cmd/canon` (`make canon-*`).
 *
 * Las claves JSON en español son el contrato de la API de canon, no nuestras: se aceptan en
 * `tools/naming-allow.txt` sólo para este paquete. */

// El cierre de un borrador valida el corpus entero en Postgres y tarda más que una lectura.
const writeTimeout = 90 * time.Second

// sharedEnv es el `.env` de canon en el repo compartido, de donde sale la llave si no está en el entorno.
var sharedEnv = filepath.Join(os.Getenv("HOME"), "Desktop", "CREDITOP", "github", "playground", "tools", "canon", ".env")

// WriteKey devuelve la llave de escritura: `CANON_WRITE_KEY` del proceso, de `connectors/.env.prod` o, en
// último lugar, del `.env` de canon en el repo compartido.
// Nunca se imprime; se pasa sólo en el encabezado de la escritura.
func WriteKey() (string, error) {
	if key := strings.TrimSpace(os.Getenv("CANON_WRITE_KEY")); key != "" {
		return key, nil
	}
	if values, err := env.Load("prod"); err == nil {
		if key := values.Get("CANON_WRITE_KEY"); key != "" {
			return key, nil
		}
	}
	raw, err := os.ReadFile(sharedEnv)
	if err == nil {
		for _, line := range strings.Split(string(raw), "\n") {
			if value, ok := strings.CutPrefix(line, "CANON_WRITE_KEY="); ok {
				if key := strings.Trim(strings.TrimSpace(value), `"'`); key != "" {
					return key, nil
				}
			}
		}
	}
	return "", fmt.Errorf("falta la llave: exportá CANON_WRITE_KEY o ponela en connectors/.env.prod (o en %s)", sharedEnv)
}

// Hit es una sección que la búsqueda devolvió como prosa.
type Hit struct {
	Node    string `json:"node"`
	Anchor  string `json:"anchor"`
	Section string `json:"section_title"`
}

// MapHit es un área del mapa: dónde vive eso en el código.
type MapHit struct {
	Cite string `json:"citar"`
	Goal string `json:"objetivo"`
}

type SearchResult struct {
	Prose     []Hit    `json:"results"`
	Map       []MapHit `json:"in_the_map"`
	Uncovered any      `json:"sin_cubrir"`
}

// Search es la búsqueda léxica de canon: gratis, sin modelo.
func (c *Client) Search(ctx context.Context, query string) (SearchResult, error) {
	var out SearchResult
	err := c.call(ctx, http.MethodGet, "/api/search?q="+url.QueryEscape(query), nil, "", &out)
	return out, err
}

// Markdown devuelve las secciones completas, en el mismo formato en que se leen en la web.
func (c *Client) Markdown(ctx context.Context, ids string) (string, error) {
	var out rawText
	err := c.call(ctx, http.MethodGet, "/api/read?format=md&ids="+url.QueryEscape(ids), nil, "", &out)
	return string(out), err
}

// Piece es una pieza del borrador, con las claves que pide canon (`node`, `section`, `text`, `kind`,
// `source`, `verified`, `as_asked`, `objetivo`, `se_deduce_leyendo`, `archivos`, `tablas`…).
type Piece map[string]any

type Proposal struct {
	Ready   bool `json:"ready"`
	Lint    any  `json:"lint"`
	Missing any  `json:"needs_answers"`
	Where   []struct {
		Read string `json:"read"`
	} `json:"where_it_might_belong"`
}

// Propose ensaya una pieza: dónde iría y qué le rechazaría el lint. No escribe nada.
func (c *Client) Propose(ctx context.Context, piece Piece) (Proposal, error) {
	key, err := WriteKey()
	if err != nil {
		return Proposal{}, err
	}
	body := Piece{}
	for _, field := range []string{"text", "node", "kind", "source", "as_asked"} {
		if v, ok := piece[field]; ok {
			body[field] = v
		}
	}
	var out Proposal
	err = c.call(ctx, http.MethodPost, "/api/propose", body, key, &out)
	return out, err
}

// PieceResult es lo que canon contesta por cada pieza, con los avisos que no frenan pero importan.
// Una pieza `verificado` además dice cuántos archivos releyó (`Reread`) y cuáles retiró por haber
// desaparecido de main (`Retired`).
type PieceResult struct {
	OK        bool   `json:"ok"`
	Operation string `json:"operacion"`
	Error     string `json:"error"`
	Notes     map[string]string
	Reread    int
	Retired   any
}

// Written es el resultado de dictar. En un ensayo (`Dry`) no hay revisión: el borrador se abandonó.
type Written struct {
	Revision int64 `json:"revision"`
	Unlinked any   `json:"sin_enlazar"`
	Pieces   []PieceResult
	Dry      bool
}

// notes son los avisos de una pieza que conviene mostrar aunque haya entrado.
var notes = []string{"objetivo_de_plantilla", "archivos_nota", "tablas_nota", "ya_vigilados_nota"}

/* Write dicta: abre un borrador, manda cada pieza y lo cierra en UNA revisión. Si una pieza no entra o
 * el cierre falla, abandona el borrador: no queda nada a medias, ni en el corpus ni vivo en memoria. */
func (c *Client) Write(ctx context.Context, author, title string, pieces []Piece) (Written, error) {
	return c.write(ctx, author, title, pieces, false)
}

/* DryWrite es Write sin el cierre: manda cada pieza al borrador, recoge lo que canon contesta de cada una
 * —la operación, los avisos, los archivos que un `verificado` releería— y abandona el borrador. No deja
 * ninguna revisión. Es el ensayo completo; `Propose` sólo mira una pieza suelta. */
func (c *Client) DryWrite(ctx context.Context, author string, pieces []Piece) (Written, error) {
	return c.write(ctx, author, "", pieces, true)
}

func (c *Client) write(ctx context.Context, author, title string, pieces []Piece, dry bool) (Written, error) {
	key, err := WriteKey()
	if err != nil {
		return Written{}, err
	}
	var draft struct {
		ID string `json:"draft_id"`
	}
	if err := c.call(ctx, http.MethodPost, "/api/draft", map[string]string{"quien": author}, key, &draft); err != nil || draft.ID == "" {
		return Written{}, fmt.Errorf("no se pudo abrir el borrador: %v", err)
	}
	abandon := func() { _ = c.call(ctx, http.MethodDelete, "/api/draft/"+draft.ID, nil, key, nil) }

	out := Written{Dry: dry}
	for _, piece := range pieces {
		var raw map[string]any
		if err := c.call(ctx, http.MethodPost, "/api/draft/"+draft.ID, piece, key, &raw); err != nil {
			abandon()
			return out, err
		}
		result := PieceResult{Notes: map[string]string{}}
		result.OK, _ = raw["ok"].(bool)
		result.Operation, _ = raw["operacion"].(string)
		if !result.OK {
			abandon()
			detail, _ := json.Marshal(raw)
			return out, fmt.Errorf("la pieza «%v» no entró y el borrador se abandonó: %s", piece["section"], detail)
		}
		for _, note := range notes {
			if text, ok := raw[note].(string); ok && text != "" {
				result.Notes[note] = text
			}
		}
		if reread, ok := raw["releidos"].([]any); ok {
			result.Reread = len(reread)
		}
		result.Retired = raw["retirados"]
		out.Pieces = append(out.Pieces, result)
	}
	if dry {
		abandon()
		return out, nil
	}

	var closed struct {
		OK       bool   `json:"ok"`
		Revision int64  `json:"revision"`
		Unlinked any    `json:"sin_enlazar"`
		Error    string `json:"error"`
		Detail   string `json:"detalle"`
	}
	if err := c.call(ctx, http.MethodPost, "/api/draft/"+draft.ID+"/close", map[string]string{"titulo": title}, key, &closed); err != nil || !closed.OK {
		abandon()
		return out, fmt.Errorf("el cierre no guardó nada y el borrador se abandonó: %v %s %s", err, closed.Error, closed.Detail)
	}
	out.Revision, out.Unlinked = closed.Revision, closed.Unlinked
	return out, nil
}

// PatchBase es el export del que se partió para editar. Canon rechaza el parche (412) si el corpus ya no
// es ése: por eso el contenido que se manda tiene que salir de ESA base, no de una copia vieja.
type PatchBase struct {
	ETag   string // el `etag` del cuerpo del export: el If-Match
	SHA256 string // el `sha256` del export: el `base_sha256`
}

// PatchRequest reemplaza archivos enteros del corpus (map.json, flow.json, los .md de un tema). Es una revisión
// PARCIAL: lo que no se nombra se conserva, y un valor nil borra el archivo.
type PatchRequest struct {
	Author string
	Reason string
	Base   PatchBase
	Files  map[string]*string
	DryRun bool
}

// Patched es lo que canon contesta a un parche: qué archivos tocaría (o tocó) y, en un ensayo, el diff.
type Patched struct {
	DryRun   bool
	Revision int64
	SHA256   string
	Files    []PatchedFile
	Diff     map[string]string
}

type PatchedFile struct {
	Action string
	Path   string
}

/* Patch publica archivos enteros con /api/patch. Es lo que hace falta cuando una pieza no alcanza: un
 * archivo que desapareció o cambió de nombre en main no lo reapunta un `verificado`, hay que reescribir
 * el map.json. Valida el corpus resultante entero y no guarda nada si algo no cierra. */
func (c *Client) Patch(ctx context.Context, request PatchRequest) (Patched, error) {
	key, err := WriteKey()
	if err != nil {
		return Patched{}, err
	}
	if request.Base.ETag == "" || request.Base.SHA256 == "" {
		return Patched{}, errors.New("falta la base del parche: el etag y el sha256 del export del que se editó")
	}
	body := map[string]any{
		"author":      request.Author,
		"reason":      request.Reason,
		"base_sha256": request.Base.SHA256,
		"dry_run":     request.DryRun,
		"files":       request.Files,
	}
	var raw map[string]any
	headers := map[string]string{"If-Match": request.Base.ETag}
	if err := c.callWith(ctx, http.MethodPost, "/api/patch", body, key, headers, &raw); err != nil {
		return Patched{}, err
	}
	if ok, _ := raw["ok"].(bool); !ok {
		detail, _ := json.Marshal(raw)
		return Patched{}, fmt.Errorf("canon no aceptó el parche (no se guardó nada): %s", detail)
	}
	out := Patched{DryRun: request.DryRun, Diff: map[string]string{}}
	out.SHA256, _ = raw["sha256"].(string)
	if revision, ok := raw["revision"].(float64); ok {
		out.Revision = int64(revision)
	}
	if files, ok := raw["files"].([]any); ok {
		for _, entry := range files {
			if file, ok := entry.(map[string]any); ok {
				action, _ := file["accion"].(string)
				path, _ := file["path"].(string)
				out.Files = append(out.Files, PatchedFile{Action: action, Path: path})
			}
		}
	}
	if diffs, ok := raw["diff"].(map[string]any); ok {
		for path, text := range diffs {
			out.Diff[path], _ = text.(string)
		}
	}
	return out, nil
}

// CloneState es el estado del clon de main que el servidor de canon tiene de un repo: el commit hasta el que
// llega lo que canon puede comparar contra lo que el corpus declara.
type CloneState struct {
	Repo   string
	Commit string
	State  string
}

// Clones dice, por repo, a qué commit de main está el clon del servidor. Si main avanzó después, la ronda del
// servidor no ve el cambio hasta que el clon se refresque (`SyncClones`).
func (c *Client) Clones(ctx context.Context) ([]CloneState, error) {
	var raw map[string]any
	if err := c.call(ctx, http.MethodGet, "/api/clones", nil, "", &raw); err != nil {
		return nil, err
	}
	list, _ := raw["repos"].([]any)
	out := make([]CloneState, 0, len(list))
	for _, entry := range list {
		item, ok := entry.(map[string]any)
		if !ok {
			continue
		}
		repo, _ := item["repo"].(string)
		commit, _ := item["commit"].(string)
		state, _ := item["estado"].(string)
		out = append(out, CloneState{Repo: repo, Commit: commit, State: state})
	}
	return out, nil
}

// SyncClones le pide al servidor que refresque sus clones (todos, o sólo `repo`, que es `Creditop-SAS/<nombre>`).
// Contesta enseguida: la sincronización corre en el servidor y se ve con `Clones`.
func (c *Client) SyncClones(ctx context.Context, repo string) error {
	key, err := WriteKey()
	if err != nil {
		return err
	}
	var raw map[string]any
	if err := c.call(ctx, http.MethodPost, "/api/clones/sync", map[string]string{"repo": repo}, key, &raw); err != nil {
		return err
	}
	if ok, _ := raw["ok"].(bool); !ok {
		detail, _ := json.Marshal(raw)
		return fmt.Errorf("canon no sincronizó los clones: %s", detail)
	}
	return nil
}

// RoundChange es un archivo que el corpus declara y cambió en main desde el hash que declara.
type RoundChange struct {
	Topic  string
	Repo   string
	Path   string
	Before string
	Now    string
}

// Round es la ronda del servidor: cuántos archivos declarados cambiaron en main (contra los clones del servidor)
// y cuáles. «Cambió» no es «dejó de ser cierto»: cada uno se relee antes de mover su hash.
type Round struct {
	Declared int
	UpToDate bool
	Changes  []RoundChange
}

// Round pide la ronda. El servidor la cachea diez minutos: con `force` la vuelve a medir, que es lo que hace falta
// justo después de refrescar los clones o de mover un hash.
func (c *Client) Round(ctx context.Context, force bool) (Round, error) {
	path := "/api/round"
	if force {
		path += "?force=1"
	}
	var raw map[string]any
	var client *http.Client
	if force {
		client = patientClient()
	}
	if err := c.callOn(ctx, client, http.MethodGet, path, nil, "", nil, &raw); err != nil {
		return Round{}, err
	}
	out := Round{}
	if declared, ok := raw["declared"].(float64); ok {
		out.Declared = int(declared)
	}
	out.UpToDate, _ = raw["up_to_date"].(bool)
	round, _ := raw["round"].(map[string]any)
	topics, _ := round["topics"].([]any)
	for _, entry := range topics {
		topic, _ := entry.(map[string]any)
		name, _ := topic["topic"].(string)
		areas, _ := topic["areas"].([]any)
		for _, areaEntry := range areas {
			area, _ := areaEntry.(map[string]any)
			changes, _ := area["changes"].([]any)
			for _, changeEntry := range changes {
				change, _ := changeEntry.(map[string]any)
				item := RoundChange{Topic: name}
				item.Repo, _ = change["repo"].(string)
				item.Path, _ = change["path"].(string)
				item.Before, _ = change["before"].(string)
				item.Now, _ = change["now"].(string)
				out.Changes = append(out.Changes, item)
			}
		}
	}
	return out, nil
}

// rawText recibe el cuerpo tal cual, para las respuestas que no son JSON.
type rawText string

/* call hace un pedido a canon. Con `key` escribe, y ahí el tiempo es el de un cierre. Una respuesta de
 * error con cuerpo JSON se decodifica igual: canon explica ahí qué corregir, y es lo que hay que ver. */
func (c *Client) call(ctx context.Context, method, path string, body any, key string, into any) error {
	return c.callWith(ctx, method, path, body, key, nil, into)
}

// patientClient es el cliente de lo que tarda más que una lectura: un cierre, o medir la ronda entera de nuevo.
func patientClient() *http.Client {
	return &http.Client{Timeout: writeTimeout, Transport: newSessionTransport(nil)}
}

// callWith es call con encabezados extra (el If-Match de un parche).
func (c *Client) callWith(ctx context.Context, method, path string, body any, key string, headers map[string]string, into any) error {
	return c.callOn(ctx, nil, method, path, body, key, headers, into)
}

// callOn hace el pedido con `client` (nil: el de lectura, o el paciente si hay `key`).
func (c *Client) callOn(ctx context.Context, client *http.Client, method, path string, body any, key string, headers map[string]string, into any) error {
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(encoded)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, reader)
	if err != nil {
		return fmt.Errorf("CANON_URL inválida: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	for name, value := range headers {
		req.Header.Set(name, value)
	}
	if client == nil {
		client = c.http
	}
	if key != "" {
		req.Header.Set("Authorization", "Bearer "+key)
		client = patientClient()
	}
	res, err := client.Do(req)
	if errors.Is(err, ErrSession) {
		return err
	}
	if err != nil {
		return fmt.Errorf("canon no respondió en %s (¿VPN de prod? CANON_URL apunta a otro): %w", c.baseURL, err)
	}
	defer res.Body.Close()
	payload, err := io.ReadAll(res.Body)
	if err != nil {
		return err
	}
	switch target := into.(type) {
	case nil:
		return nil
	case *rawText:
		if res.StatusCode >= http.StatusBadRequest {
			return fmt.Errorf("canon respondió HTTP %d: %s", res.StatusCode, payload)
		}
		*target = rawText(payload)
		return nil
	default:
		if err := json.Unmarshal(payload, target); err != nil {
			return fmt.Errorf("canon respondió HTTP %d sin JSON válido: %.300s", res.StatusCode, payload)
		}
		return nil
	}
}
