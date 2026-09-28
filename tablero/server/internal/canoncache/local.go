package canoncache

/* Leer canon desde la copia local: las secciones de un tema, las que una consulta encuentra, y las áreas
 * de su mapa. Reemplaza a `/api/context` y `/api/code`, que canon retiró el 2026-09-27: el único cliente
 * remoto que le queda es Credibot, y quien trabaja en su máquina lee el export como archivos.
 *
 * ⚠ La selección es LÉXICA y simple a propósito —cuenta las palabras de la consulta en el título y en el
 * texto—: sirve para ordenar lo que ya se sabe que hay que leer (los temas que declara una tarea), no para
 * descubrir. Para buscar en todo el corpus está grep sobre la copia. */

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"unicode"
)

// LocalSection es una sección de prosa tal como está en la copia.
type LocalSection struct {
	ID    string `json:"id"` // tema/context#ancla, como lo cita canon
	Title string `json:"title"`
	Text  string `json:"text"`
	Score int    `json:"score,omitempty"`
}

// LocalArea es un área del mapa: qué objetivo cumple y qué archivos lo sostienen.
type LocalArea struct {
	Goal     string                       `json:"goal"`
	Deduce   string                       `json:"deduce"`
	Sections []string                     `json:"sections"`
	Tables   []string                     `json:"tables"`
	Files    map[string]map[string]string `json:"files"` // repo → ruta → hash del blob
}

// TopicPath es el archivo de prosa de un tema en la copia (`kyc` o `kyc/context`).
func TopicPath(cacheDir, topic string) string {
	name, kind, ok := strings.Cut(topic, "/")
	if !ok {
		kind = "context"
	}
	return filepath.Join(MirrorDir(cacheDir), "content", name, kind+".md")
}

// HasTopic dice si el tema está en la copia.
func HasTopic(cacheDir, topic string) bool {
	_, err := os.Stat(TopicPath(cacheDir, topic))
	return err == nil
}

/* anchorOf reproduce `corpus.AnchorOf` de canon: minúsculas sin tildes, y todo lo que no es letra o
 * dígito se vuelve un guion, sin repetirlo. Así la cita que sale de acá es la misma que la de canon. */
func anchorOf(text string) string {
	var b strings.Builder
	for _, r := range fold(text) {
		if r >= 'a' && r <= 'z' || r >= '0' && r <= '9' {
			b.WriteRune(r)
		} else if !strings.HasSuffix(b.String(), "-") {
			b.WriteRune('-')
		}
	}
	return strings.Trim(b.String(), "-")
}

var accents = strings.NewReplacer("á", "a", "é", "e", "í", "i", "ó", "o", "ú", "u", "ü", "u", "ñ", "n")

func fold(s string) string { return accents.Replace(strings.ToLower(s)) }

// ReadTopic parte la prosa de un tema en sus secciones (`## título`).
func ReadTopic(cacheDir, topic string) ([]LocalSection, error) {
	raw, err := os.ReadFile(TopicPath(cacheDir, topic))
	if err != nil {
		return nil, err
	}
	name, kind, ok := strings.Cut(topic, "/")
	if !ok {
		kind = "context"
	}
	var out []LocalSection
	var cur *LocalSection
	var body []string
	flush := func() {
		if cur != nil {
			cur.Text = strings.TrimSpace(strings.Join(body, "\n"))
			out = append(out, *cur)
		}
	}
	for _, line := range strings.Split(string(raw), "\n") {
		if title, ok := strings.CutPrefix(line, "## "); ok {
			flush()
			title = strings.TrimSpace(title)
			cur, body = &LocalSection{ID: name + "/" + kind + "#" + anchorOf(title), Title: title}, nil
			continue
		}
		if cur != nil {
			body = append(body, line)
		}
	}
	flush()
	return out, nil
}

// terms: las palabras de una consulta que valen para puntuar (cuatro letras o más, sin tildes).
func terms(q string) []string {
	seen := map[string]bool{}
	var out []string
	for _, w := range strings.FieldsFunc(fold(q), func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsDigit(r) }) {
		if len([]rune(w)) >= 4 && !commonWords[w] && !seen[w] {
			seen[w] = true
			out = append(out, w)
		}
	}
	return out
}

// commonWords: las palabras vacías de una consulta en español, que no dicen de qué trata.
var commonWords = func() map[string]bool {
	out := map[string]bool{}
	for _, w := range strings.Fields("para como este esta esto cuando donde desde hasta sobre entre pero porque " +
		"cada solo tiene tienen hace ahora todo todos otra") {
		out[w] = true
	}
	return out
}()

/* SelectContext elige, dentro de `topics`, las secciones que más palabras de `query` nombran —el título
 * pesa triple— y las entrega ENTERAS hasta `maxBytes`. Lo que puntúa y no entra va en `pending`, por su
 * cita, para leerlo aparte. Un tema que no está en la copia va en `missing`. */
func SelectContext(cacheDir string, topics []string, query string, maxBytes int) (chosen []LocalSection, pending, missing []string) {
	ts := terms(query)
	var all []LocalSection
	for _, t := range topics {
		secs, err := ReadTopic(cacheDir, t)
		if err != nil {
			missing = append(missing, t)
			continue
		}
		for _, s := range secs {
			title, text := fold(s.Title), fold(s.Text)
			for _, term := range ts {
				s.Score += 3*strings.Count(title, term) + strings.Count(text, term)
			}
			if s.Score > 0 {
				all = append(all, s)
			}
		}
	}
	sort.SliceStable(all, func(i, j int) bool { return all[i].Score > all[j].Score })
	used := 0
	for _, s := range all {
		if size := len(s.Title) + len(s.Text); used+size <= maxBytes {
			chosen, used = append(chosen, s), used+size
			continue
		}
		pending = append(pending, s.ID)
	}
	return chosen, pending, missing
}

// Area lee el área `n` del mapa de un tema.
func Area(cacheDir, topic string, n int) (LocalArea, int, error) {
	name, _, _ := strings.Cut(topic, "/")
	raw, err := os.ReadFile(filepath.Join(MirrorDir(cacheDir), "content", name, "map.json"))
	if err != nil {
		return LocalArea{}, 0, fmt.Errorf("el tema %q no está en la copia local (%s)", name, MirrorDir(cacheDir))
	}
	var m struct {
		Areas []struct {
			Goal     string                       `json:"objetivo"`
			Deduce   string                       `json:"se_deduce_leyendo"`
			Sections []string                     `json:"secciones"`
			Tables   []string                     `json:"tablas"`
			Files    map[string]map[string]string `json:"fuentes"`
		} `json:"areas"`
	}
	if err := json.Unmarshal(raw, &m); err != nil {
		return LocalArea{}, 0, fmt.Errorf("el mapa de %s no se pudo leer: %w", name, err)
	}
	if n < 0 || n >= len(m.Areas) {
		return LocalArea{}, len(m.Areas), fmt.Errorf("%s no tiene un área %d (tiene %d)", name, n, len(m.Areas))
	}
	a := m.Areas[n]
	return LocalArea{Goal: a.Goal, Deduce: a.Deduce, Sections: a.Sections, Tables: a.Tables, Files: a.Files}, len(m.Areas), nil
}
