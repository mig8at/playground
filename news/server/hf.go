package main

// TRAER LA SEMANA de la API pública de Hugging Face, sin cuenta: los modelos en tendencia (con la ficha de los que se
// crearon en la semana y de los primeros), los papers de cada día con sus votos, y un pedazo del README de cada modelo
// nuevo, que es lo que lee el modelo de fondo para escribir.

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"time"
)

const hfBase = "https://huggingface.co"

var client = &http.Client{Timeout: 30 * time.Second}

func getJSON(ctx context.Context, url string, v any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "news (my-tools)")
	res, err := client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("%s: HTTP %d", url, res.StatusCode)
	}
	return json.NewDecoder(io.LimitReader(res.Body, 32<<20)).Decode(v)
}

func getText(ctx context.Context, url string, limit int64) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "news (my-tools)")
	res, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return "", fmt.Errorf("HTTP %d", res.StatusCode)
	}
	b, err := io.ReadAll(io.LimitReader(res.Body, limit))
	return string(b), err
}

type hfModel struct {
	ID          string   `json:"id"`
	Pipeline    string   `json:"pipeline_tag"`
	CreatedAt   string   `json:"createdAt"`
	Likes       int      `json:"likes"`
	Downloads   int      `json:"downloads"`
	Trending    float64  `json:"trendingScore"`
	Tags        []string `json:"tags"`
	Library     string   `json:"library_name"`
	Safetensors *struct {
		Total int64 `json:"total"`
	} `json:"safetensors"`
	CardData map[string]any `json:"cardData"`
	Siblings []struct {
		Name string `json:"rfilename"`
	} `json:"siblings"`
}

type hfPaper struct {
	NumComments int `json:"numComments"`
	Paper       struct {
		ID      string `json:"id"`
		Title   string `json:"title"`
		Summary string `json:"summary"`
		Upvotes int    `json:"upvotes"`
		GitHub  string `json:"githubRepo"`
	} `json:"paper"`
}

var formats = map[string]bool{"safetensors": true, "gguf": true, "onnx": true, "bin": true, "mlx": true}

// fetchWeek junta la semana [from, to]. Lo que no se puede leer de un modelo o de un día no corta: queda sin ficha.
func fetchWeek(ctx context.Context, from, to time.Time) ([]Model, []Paper, int, []string, error) {
	var trending []hfModel
	if err := getJSON(ctx, hfBase+"/api/models?sort=trendingScore&limit=100", &trending); err != nil {
		return nil, nil, 0, nil, fmt.Errorf("los modelos en tendencia: %w", err)
	}
	fromS, toS := from.Format("2006-01-02"), to.Format("2006-01-02")
	var models []Model
	var warnings []string
	noCard := 0
	for i, m := range trending {
		created := m.CreatedAt
		if len(created) >= 10 {
			created = created[:10]
		}
		item := Model{
			ID: m.ID, Task: m.Pipeline, Created: created, Likes: m.Likes, Downloads: m.Downloads, Trending: m.Trending,
			Rank: i + 1, New: created >= fromS && created <= toS,
		}
		item.Org, item.Name, _ = strings.Cut(m.ID, "/")
		if item.Name == "" {
			item.Name, item.Org = item.Org, ""
		}
		if item.Task == "" {
			item.Task = "otro"
		}
		if item.New || i < 8 {
			var d hfModel
			if err := getJSON(ctx, hfBase+"/api/models/"+m.ID, &d); err == nil {
				item.card(d)
			} else {
				noCard++
			}
		}
		models = append(models, item)
	}
	var papers []Paper
	for day := from; !day.After(to); day = day.AddDate(0, 0, 1) {
		var list []hfPaper
		if err := getJSON(ctx, hfBase+"/api/daily_papers?limit=100&date="+day.Format("2006-01-02"), &list); err != nil {
			warnings = append(warnings, "sin los papers del "+day.Format("2/1"))
			continue
		}
		for _, p := range list {
			papers = append(papers, Paper{ID: p.Paper.ID, Title: p.Paper.Title, Upvotes: p.Paper.Upvotes, Day: day.Format("2006-01-02"),
				GitHub: p.Paper.GitHub, Summary: clip(strings.Join(strings.Fields(p.Paper.Summary), " "), 900), Comments: p.NumComments})
		}
	}
	total := len(papers)
	sort.SliceStable(papers, func(a, b int) bool { return papers[a].Upvotes > papers[b].Upvotes })
	if len(papers) > 25 {
		papers = papers[:25]
	}
	if noCard > 0 {
		warnings = append(warnings, fmt.Sprintf("%d modelos sin ficha", noCard))
	}
	return models, papers, total, warnings, nil
}

// card llena la ficha con lo que el modelo declara: licencia, tamaño, librería, idiomas, base y formatos.
func (m *Model) card(d hfModel) {
	for _, t := range d.Tags {
		if license, ok := strings.CutPrefix(t, "license:"); ok {
			m.License = license
		}
	}
	if d.Safetensors != nil {
		m.Params = d.Safetensors.Total
	}
	m.Library = d.Library
	switch v := d.CardData["language"].(type) {
	case string:
		m.Languages = []string{v}
	case []any:
		for _, x := range v {
			if s, ok := x.(string); ok {
				m.Languages = append(m.Languages, s)
			}
		}
	}
	switch v := d.CardData["base_model"].(type) {
	case string:
		m.Base = v
	case []any:
		if len(v) > 0 {
			m.Base, _ = v[0].(string)
		}
	}
	seen := map[string]bool{}
	for _, s := range d.Siblings {
		if i := strings.LastIndexByte(s.Name, '.'); i >= 0 && formats[s.Name[i+1:]] && !seen[s.Name[i+1:]] {
			seen[s.Name[i+1:]] = true
			m.Formats = append(m.Formats, s.Name[i+1:])
		}
	}
	sort.Strings(m.Formats)
}

var (
	frontMatter = regexp.MustCompile(`(?s)\A---\n.*?\n---\n`)
	htmlTag     = regexp.MustCompile(`<[^>]+>`)
)

// readme: el comienzo del README de un modelo, sin el encabezado YAML ni HTML, para que el modelo de fondo lo lea.
func readme(ctx context.Context, id string) string {
	raw, err := getText(ctx, hfBase+"/"+id+"/raw/main/README.md", 60<<10)
	if err != nil {
		return ""
	}
	raw = frontMatter.ReplaceAllString(raw, "")
	raw = htmlTag.ReplaceAllString(raw, "")
	return clip(strings.TrimSpace(raw), 5000)
}

func clip(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n]) + "…"
}
