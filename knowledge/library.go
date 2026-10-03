// Package knowledge lee el conocimiento local del taller. No consulta Canon ni la red.
package knowledge

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode"
)

var topicID = regexp.MustCompile(`^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$`)
var gitID = regexp.MustCompile(`^[a-f0-9]{40,64}$`)

// Source conserva la evidencia revisada. El hash no certifica por sí solo la prosa.
type Source struct {
	Repo     string   `json:"repo"`
	Path     string   `json:"path"`
	Commit   string   `json:"commit"`
	Blob     string   `json:"blob"`
	Sections []string `json:"sections"`
}

type Metadata struct {
	Version    int      `json:"version"`
	Title      string   `json:"title"`
	Summary    string   `json:"summary"`
	ReviewedAt string   `json:"reviewedAt"`
	Sources    []Source `json:"sources"`
}

type Section struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Text  string `json:"text"`
}

type Topic struct {
	ID   string `json:"id"`
	File string `json:"file"`
	Metadata
	Intro    string    `json:"intro"`
	Sections []Section `json:"sections"`
}

type Library struct {
	Topics []Topic `json:"topics"`
}

// Open exige ambas piezas de cada tema: una prosa sin fuentes no entra silenciosamente.
func Open(dir string) (Library, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return Library{}, fmt.Errorf("no pude leer knowledge: %w", err)
	}
	l := Library{Topics: []Topic{}}
	for _, entry := range entries {
		if entry.Type()&os.ModeSymlink != 0 {
			return l, fmt.Errorf("knowledge no admite enlaces simbólicos: %s", entry.Name())
		}
		if !entry.IsDir() {
			continue
		}
		id := entry.Name()
		if !topicID.MatchString(id) {
			return l, fmt.Errorf("carpeta de conocimiento inválida: %q", id)
		}
		base := filepath.Join(dir, id)
		for _, name := range []string{"sources.json", "rules.md"} {
			info, err := os.Lstat(filepath.Join(base, name))
			if err != nil || !info.Mode().IsRegular() {
				return l, fmt.Errorf("%s/%s debe ser un archivo local regular", id, name)
			}
		}
		meta, err := os.ReadFile(filepath.Join(base, "sources.json"))
		if err != nil {
			return l, fmt.Errorf("%s/sources.json: %w", id, err)
		}
		var m Metadata
		decoder := json.NewDecoder(bytes.NewReader(meta))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&m); err != nil {
			return l, fmt.Errorf("%s/sources.json: %w", id, err)
		}
		if err := decoder.Decode(new(any)); err != io.EOF {
			return l, fmt.Errorf("%s/sources.json contiene más de un documento", id)
		}
		if m.Version != 1 || strings.TrimSpace(m.Title) == "" || strings.TrimSpace(m.Summary) == "" || len(m.Sources) == 0 {
			return l, fmt.Errorf("%s: faltan versión, título, resumen o fuentes", id)
		}
		if _, err := time.Parse(time.RFC3339, m.ReviewedAt); err != nil {
			return l, fmt.Errorf("%s: reviewedAt debe ser una fecha RFC3339", id)
		}
		raw, err := os.ReadFile(filepath.Join(base, "rules.md"))
		if err != nil {
			return l, fmt.Errorf("%s/rules.md: %w", id, err)
		}
		t := parse(id, string(raw))
		if t.Title != m.Title || len(t.Sections) == 0 {
			return l, fmt.Errorf("%s: el título no coincide o faltan secciones en rules.md", id)
		}
		t.Metadata, t.File = m, filepath.Join("knowledge", id, "rules.md")
		sections, covered := map[string]bool{}, map[string]bool{}
		for _, s := range t.Sections {
			anchor := strings.SplitN(s.ID, "#", 2)[1]
			if sections[anchor] || anchor == "" {
				return l, fmt.Errorf("%s: ancla vacía o repetida: %s", id, anchor)
			}
			sections[anchor] = true
		}
		for _, s := range m.Sources {
			if s.Repo == "" || !safePath(s.Path) || !gitID.MatchString(s.Commit) || !gitID.MatchString(s.Blob) || len(s.Sections) == 0 {
				return l, fmt.Errorf("%s: fuente incompleta o inválida: %s/%s", id, s.Repo, s.Path)
			}
			for _, anchor := range s.Sections {
				if !sections[anchor] {
					return l, fmt.Errorf("%s: la fuente declara una sección que no existe: %s", id, anchor)
				}
				covered[anchor] = true
			}
		}
		for anchor := range sections {
			if !covered[anchor] {
				return l, fmt.Errorf("%s: sección sin fuente: %s", id, anchor)
			}
		}
		l.Topics = append(l.Topics, t)
	}
	return l, nil
}

func safePath(path string) bool {
	return path != "" && !filepath.IsAbs(path) && filepath.ToSlash(filepath.Clean(path)) == path && path != ".." && !strings.HasPrefix(path, "../") && !strings.ContainsAny(path, "\\\n\r")
}

var accents = strings.NewReplacer("á", "a", "é", "e", "í", "i", "ó", "o", "ú", "u", "ü", "u", "ñ", "n")

func fold(s string) string { return accents.Replace(strings.ToLower(s)) }

func Anchor(s string) string {
	var out []string
	for _, word := range strings.FieldsFunc(fold(s), func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsDigit(r) }) {
		out = append(out, word)
	}
	return strings.Join(out, "-")
}

func parse(id, raw string) Topic {
	t := Topic{ID: id}
	var current *Section
	var body, intro []string
	flush := func() {
		if current != nil {
			current.Text = strings.TrimSpace(strings.Join(body, "\n"))
			t.Sections = append(t.Sections, *current)
		}
	}
	for _, line := range strings.Split(raw, "\n") {
		if title, ok := strings.CutPrefix(line, "## "); ok {
			flush()
			title = strings.TrimSpace(title)
			current, body = &Section{ID: id + "#" + Anchor(title), Title: title}, nil
		} else if current != nil {
			body = append(body, line)
		} else if title, ok := strings.CutPrefix(line, "# "); ok && t.Title == "" {
			t.Title = strings.TrimSpace(title)
		} else {
			intro = append(intro, line)
		}
	}
	flush()
	t.Intro = strings.TrimSpace(strings.Join(intro, "\n"))
	return t
}

// Read acepta un tema o una sección. Una referencia desconocida falla, sin buscar otra parecida.
func (l Library) Read(ref string) (Topic, error) {
	id, anchor, partial := strings.Cut(ref, "#")
	if !topicID.MatchString(id) {
		return Topic{}, fmt.Errorf("referencia inválida: %q", ref)
	}
	for _, t := range l.Topics {
		if t.ID != id {
			continue
		}
		if !partial {
			return t, nil
		}
		for _, s := range t.Sections {
			if s.ID == id+"#"+anchor {
				t.Intro, t.Sections = "", []Section{s}
				return t, nil
			}
		}
		return Topic{}, fmt.Errorf("no existe la sección %q", ref)
	}
	return Topic{}, fmt.Errorf("no existe el tema local %q", id)
}

type Hit struct {
	Section
	Topic string `json:"topic"`
	Score int    `json:"score"`
}

func (l Library) Search(query string) []Hit {
	terms := strings.Fields(fold(query))
	hits := []Hit{}
	for _, t := range l.Topics {
		for _, s := range t.Sections {
			score := 0
			for _, term := range terms {
				if len([]rune(term)) < 3 {
					continue
				}
				score += 3*strings.Count(fold(s.Title), term) + strings.Count(fold(s.Text), term)
			}
			if score > 0 {
				hits = append(hits, Hit{Section: s, Topic: t.ID, Score: score})
			}
		}
	}
	sort.SliceStable(hits, func(i, j int) bool { return hits[i].Score > hits[j].Score })
	return hits
}

type Context struct {
	Topics  []Topic  `json:"topics"`
	Missing []string `json:"missing"`
	Pending []string `json:"pending"`
	Error   string   `json:"error,omitempty"`
}

// Select conserva los temas enteros: el presupuesto nunca recorta una condición a mitad.
func (l Library) Select(refs []string, maxBytes int) Context {
	out := Context{Topics: []Topic{}, Missing: []string{}, Pending: []string{}}
	used, seen := 0, map[string]bool{}
	for _, ref := range refs {
		if seen[ref] {
			continue
		}
		seen[ref] = true
		t, err := l.Read(ref)
		if err != nil {
			out.Missing = append(out.Missing, ref)
			continue
		}
		size := len(t.Intro) + len(t.Title)
		for _, s := range t.Sections {
			size += len(s.Title) + len(s.Text)
		}
		if used+size > maxBytes {
			out.Pending = append(out.Pending, ref)
			continue
		}
		out.Topics = append(out.Topics, t)
		used += size
	}
	return out
}
