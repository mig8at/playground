package main

// La búsqueda de `knowledge search`: por palabras y por significado, mezcladas (knowledge.Blend). El modelo de
// significado lo dice el registro de modelos (models/registry.json, el uso de «knowledge»: Qwen3-Embedding-0.6B) y
// corre en un llama-server propio, que se levanta con la primera búsqueda y se apaga solo a los 15 minutos sin uso
// (lib/llamaserve). Si no se puede (el modelo no está, llama-server no contesta), busca sólo por palabras y lo dice.

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"creditop/my-tools/knowledge"
	"creditop/my-tools/lib/llamaserve"
	"creditop/my-tools/lib/models"
)

const embedPort = 5250

func search(l knowledge.Library, root, q string, wordsOnly, meaningOnly bool) ([]knowledge.SemanticHit, string) {
	words := l.Search(q)
	asHits := func(hs []knowledge.Hit) []knowledge.SemanticHit {
		out := make([]knowledge.SemanticHit, len(hs))
		for i, h := range hs {
			out[i] = knowledge.SemanticHit{Hit: h}
		}
		return out
	}
	if wordsOnly {
		return asHits(words), "sólo por palabras (--words)"
	}
	began := time.Now()
	meaning, stats, err := semanticSearch(l, root, q)
	if err != nil {
		fmt.Fprintf(os.Stderr, "knowledge: sin búsqueda por significado (%v); busco sólo por palabras\n", err)
		return asHits(words), "sólo por palabras"
	}
	how := fmt.Sprintf("por palabras y por significado · %s", time.Since(began).Round(time.Millisecond))
	if stats.Embedded > 0 {
		how += fmt.Sprintf(" · índice: %d de %d secciones calculadas de nuevo", stats.Embedded, stats.Total)
	}
	if meaningOnly {
		return meaning[:min(20, len(meaning))], "sólo por significado (--meaning) · " + how
	}
	// Una pregunta en lenguaje natural se contesta por significado; una con algo que parece código (un nombre con guion
	// bajo, camelCase, una ruta, un número de trampa) por palabras y significado a la par. Medido el 2026-11-19: en 37
	// títulos de tareas reales y 20 preguntas, el significado solo acertó 24 y 19 (las palabras, 16 y 4, y mezclarlas a
	// la par bajaba a 21 y 14); en 30 identificadores exactos, las palabras 30 y el significado 12.
	w := 0.0
	how += " · pregunta en lenguaje natural: manda el significado"
	if looksLikeCode(q) {
		w = 1.0
		how = strings.Replace(how, "pregunta en lenguaje natural: manda el significado", "tiene algo que parece código: palabras y significado a la par", 1)
	}
	if v, err := strconv.ParseFloat(os.Getenv("KNOWLEDGE_WORD_WEIGHT"), 64); err == nil {
		w = v // para medir otro peso sin tocar el código
	}
	return knowledge.Blend(words, meaning, 20, w), how
}

var codeRe = regexp.MustCompile("[A-Za-z0-9]_[A-Za-z0-9]|[a-z][A-Z]|[A-Za-z]+\\.[A-Za-z]+|/|^F-\\d+$|\\bF-\\d+\\b|`")

// looksLikeCode: la consulta trae un identificador, una ruta o un número de trampa, que se buscan por la palabra exacta.
func looksLikeCode(q string) bool { return codeRe.MatchString(q) }

func semanticSearch(l knowledge.Library, root, q string) ([]knowledge.SemanticHit, knowledge.IndexStats, error) {
	abs, _ := filepath.Abs(root)
	paths, err := models.For(abs, "knowledge", "")
	if err != nil {
		return nil, knowledge.IndexStats{}, err
	}
	spec := llamaserve.Spec{Name: "knowledge-embed", Port: embedPort, Idle: 15 * time.Minute,
		// una sección cabe entera en un lote (2.400 caracteres, ~700 tokens): -b/-ub por encima de eso
		Args: []string{"-m", paths[0], "--embedding", "--pooling", "last", "-c", "8192", "-b", "2048", "-ub", "2048", "-ngl", "99"}}
	if err := spec.Ensure(60 * time.Second); err != nil {
		return nil, knowledge.IndexStats{}, err
	}
	embed := func(texts []string) ([][]float32, error) {
		body, _ := json.Marshal(map[string]any{"input": texts})
		resp, err := (&http.Client{Timeout: 2 * time.Minute}).Post(spec.URL()+"/v1/embeddings", "application/json", bytes.NewReader(body))
		if err != nil {
			return nil, err
		}
		defer resp.Body.Close()
		var r struct {
			Data []struct {
				Index     int       `json:"index"`
				Embedding []float32 `json:"embedding"`
			} `json:"data"`
		}
		if resp.StatusCode != http.StatusOK || json.NewDecoder(resp.Body).Decode(&r) != nil || len(r.Data) != len(texts) {
			return nil, fmt.Errorf("el servidor de embeddings contestó %d", resp.StatusCode)
		}
		out := make([][]float32, len(texts))
		for _, d := range r.Data {
			out[d.Index] = d.Embedding
		}
		return out, nil
	}
	cache, _ := os.UserCacheDir()
	if home, err := os.UserHomeDir(); err == nil {
		cache = filepath.Join(home, ".cache")
	}
	index := filepath.Join(cache, "my-tools", "knowledge-embed", "index.json")
	return l.SemanticSearch(q, index, filepath.Base(paths[0]), embed)
}
