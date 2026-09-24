package canon

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
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

// WriteKey devuelve la llave de escritura: `CANON_WRITE_KEY` del entorno o la del `.env` de canon.
// Nunca se imprime; se pasa sólo en el encabezado de la escritura.
func WriteKey() (string, error) {
	if key := strings.TrimSpace(os.Getenv("CANON_WRITE_KEY")); key != "" {
		return key, nil
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
	return "", fmt.Errorf("falta la llave: exportá CANON_WRITE_KEY o ponela en %s", sharedEnv)
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

type CodeFile struct {
	Repo string `json:"repo"`
	Path string `json:"path"`
	Hash string `json:"declared_hash"`
}

type CodeArea struct {
	Area struct {
		Goal string `json:"objetivo"`
	} `json:"area"`
	Files []CodeFile `json:"files"`
}

// Code devuelve los archivos que declara el área `n` de un tema.
func (c *Client) Code(ctx context.Context, area string, n int) (CodeArea, error) {
	var out CodeArea
	err := c.call(ctx, http.MethodGet, "/api/code?area="+url.QueryEscape(area)+"&n="+strconv.Itoa(n), nil, "", &out)
	return out, err
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
type PieceResult struct {
	OK        bool   `json:"ok"`
	Operation string `json:"operacion"`
	Error     string `json:"error"`
	Notes     map[string]string
}

type Written struct {
	Revision int64 `json:"revision"`
	Unlinked any   `json:"sin_enlazar"`
	Pieces   []PieceResult
}

// notes son los avisos de una pieza que conviene mostrar aunque haya entrado.
var notes = []string{"objetivo_de_plantilla", "archivos_nota", "tablas_nota", "ya_vigilados_nota"}

/* Write dicta: abre un borrador, manda cada pieza y lo cierra en UNA revisión. Si una pieza no entra o
 * el cierre falla, abandona el borrador: no queda nada a medias, ni en el corpus ni vivo en memoria. */
func (c *Client) Write(ctx context.Context, author, title string, pieces []Piece) (Written, error) {
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

	var out Written
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
		out.Pieces = append(out.Pieces, result)
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

// rawText recibe el cuerpo tal cual, para las respuestas que no son JSON.
type rawText string

/* call hace un pedido a canon. Con `key` escribe, y ahí el tiempo es el de un cierre. Una respuesta de
 * error con cuerpo JSON se decodifica igual: canon explica ahí qué corregir, y es lo que hay que ver. */
func (c *Client) call(ctx context.Context, method, path string, body any, key string, into any) error {
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
	client := c.http
	if key != "" {
		req.Header.Set("Authorization", "Bearer "+key)
		client = &http.Client{Timeout: writeTimeout}
	}
	res, err := client.Do(req)
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
