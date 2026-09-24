package canon

import (
	"context"
	"net/http"
	"net/url"
	"strings"
)

/* EL CORPUS ENTERO, para cruzarlo con lo que otra herramienta mide: qué tema declara qué archivo y qué
 * tabla, y su prosa para buscar una tabla que se explica sin figurar en el mapa. Lo consume la huella
 * del trazador —que es Python— a través de `canon corpus` y `tools/canon.py`: la lectura de
 * canon tiene UNA implementación, ésta, y el lado Python sólo reparte lo que devuelve. */

// readBatch es cuántos temas se piden por `/api/read`: el corpus entero en pocas vueltas.
const readBatch = 20

// Topic es un tema tal como lo necesita un cruce: su mapa y su prosa.
type Topic struct {
	Areas []Area `json:"areas"`
	Prose string `json:"prose"`
}

type fullNode struct {
	ID       string `json:"id"`
	Areas    []Area `json:"areas"`
	Sections []struct {
		Title  string `json:"title"`
		Blocks []struct {
			Text string `json:"text"`
		} `json:"blocks"`
	} `json:"sections"`
}

/* Corpus lee todos los temas. La clave es el tema sin su capa (`kyc/context` → `kyc`), que es como lo
 * nombran `canon:` en las tareas. */
func (c *Client) Corpus(ctx context.Context) (map[string]Topic, error) {
	var index struct {
		Nodes []struct {
			ID string `json:"id"`
		} `json:"nodes"`
	}
	if err := c.call(ctx, http.MethodGet, "/api/index", nil, "", &index); err != nil {
		return nil, err
	}
	var ids []string
	for _, n := range index.Nodes {
		if n.ID != "" {
			ids = append(ids, n.ID)
		}
	}
	out := make(map[string]Topic, len(ids))
	for start := 0; start < len(ids); start += readBatch {
		end := min(start+readBatch, len(ids))
		var batch struct {
			Nodes []fullNode `json:"nodes"`
		}
		if err := c.call(ctx, http.MethodGet, "/api/read?ids="+url.QueryEscape(strings.Join(ids[start:end], ",")), nil, "", &batch); err != nil {
			return nil, err
		}
		for _, n := range batch.Nodes {
			var prose []string
			for _, s := range n.Sections {
				prose = append(prose, s.Title)
				for _, b := range s.Blocks {
					prose = append(prose, b.Text)
				}
			}
			topic, _, _ := strings.Cut(n.ID, "/")
			out[topic] = Topic{Areas: n.Areas, Prose: strings.Join(prose, "\n")}
		}
	}
	return out, nil
}
