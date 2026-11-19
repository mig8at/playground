package knowledge

// La búsqueda por significado (2026-11-19, Miguel: «dale, integralo»). Cada sección se convierte en un vector con un
// modelo de embeddings (Qwen3-Embedding-0.6B en local, por cmd/knowledge) y se guarda en un índice en la caché; una
// pregunta se compara contra todas. La biblioteca no sabe de servidores: recibe la función que convierte textos en
// vectores. El resultado se mezcla con la búsqueda por palabras (Search) por rango recíproco, así la palabra exacta
// sigue pesando: medido el 2026-11-18, por palabras 4 de 20 preguntas y por significado 19 de 20.

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"sort"
)

// Embedder convierte textos en vectores (uno por texto, en el mismo orden).
type Embedder func(texts []string) ([][]float32, error)

// QueryInstruction: lo que se le antepone a una pregunta (los modelos Qwen3-Embedding piden la instrucción en la
// pregunta y no en los documentos).
const QueryInstruction = "Instruct: Given a question about a credit platform, retrieve the documentation section that answers it\nQuery: "

type indexEntry struct {
	Hash string `json:"hash"`
	Vec  string `json:"vec"` // float32 little-endian, en base64
}

type index struct {
	Model    string                `json:"model"`
	Sections map[string]indexEntry `json:"sections"`
}

func sectionText(t Topic, s Section) string {
	text := t.Title + "\n" + s.Title + "\n" + s.Text
	if r := []rune(text); len(r) > 2400 {
		text = string(r[:2400])
	}
	return text
}

func hashOf(model, text string) string {
	h := sha256.Sum256([]byte(model + "\x00" + text))
	return hex.EncodeToString(h[:8])
}

func encodeVec(v []float32) string {
	b := make([]byte, 4*len(v))
	for i, x := range v {
		binary.LittleEndian.PutUint32(b[4*i:], math.Float32bits(x))
	}
	return base64.StdEncoding.EncodeToString(b)
}

func decodeVec(s string) []float32 {
	b, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		return nil
	}
	v := make([]float32, len(b)/4)
	for i := range v {
		v[i] = math.Float32frombits(binary.LittleEndian.Uint32(b[4*i:]))
	}
	return v
}

func normalize(v []float32) []float32 {
	var n float64
	for _, x := range v {
		n += float64(x) * float64(x)
	}
	n = math.Sqrt(n)
	if n == 0 {
		return v
	}
	out := make([]float32, len(v))
	for i, x := range v {
		out[i] = float32(float64(x) / n)
	}
	return out
}

// IndexStats: cuántas secciones se calcularon de nuevo (las que cambiaron) y cuántas había.
type IndexStats struct {
	Embedded, Total int
}

// vectors devuelve el vector de cada sección, recalculando sólo las que cambiaron desde el índice guardado en path.
func (l Library) vectors(path, model string, embed Embedder) (map[string][]float32, IndexStats, error) {
	idx := index{Model: model, Sections: map[string]indexEntry{}}
	if raw, err := os.ReadFile(path); err == nil {
		var old index
		if json.Unmarshal(raw, &old) == nil && old.Model == model {
			idx = old
		}
	}
	keep := map[string]indexEntry{}
	var missingIDs, missingTexts []string
	total := 0
	for _, t := range l.Topics {
		for _, s := range t.Sections {
			total++
			text := sectionText(t, s)
			h := hashOf(model, text)
			if e, ok := idx.Sections[s.ID]; ok && e.Hash == h {
				keep[s.ID] = e
				continue
			}
			missingIDs = append(missingIDs, s.ID)
			missingTexts = append(missingTexts, text)
			keep[s.ID] = indexEntry{Hash: h}
		}
	}
	for i := 0; i < len(missingTexts); i += 16 {
		end := min(i+16, len(missingTexts))
		vecs, err := embed(missingTexts[i:end])
		if err != nil {
			return nil, IndexStats{}, err
		}
		for j, v := range vecs {
			e := keep[missingIDs[i+j]]
			e.Vec = encodeVec(normalize(v))
			keep[missingIDs[i+j]] = e
		}
	}
	idx.Sections = keep
	if len(missingIDs) > 0 {
		os.MkdirAll(filepath.Dir(path), 0o755)
		if raw, err := json.Marshal(idx); err == nil {
			os.WriteFile(path, raw, 0o644)
		}
	}
	out := make(map[string][]float32, len(keep))
	for id, e := range keep {
		out[id] = decodeVec(e.Vec)
	}
	return out, IndexStats{Embedded: len(missingIDs), Total: total}, nil
}

// SemanticHit: una sección con su parecido (coseno) a la pregunta.
type SemanticHit struct {
	Hit
	Similarity float64 `json:"similarity"`
}

// SemanticSearch: las secciones de la más parecida a la menos, por significado. El índice vive en indexPath.
func (l Library) SemanticSearch(query, indexPath, model string, embed Embedder) ([]SemanticHit, IndexStats, error) {
	vecs, stats, err := l.vectors(indexPath, model, embed)
	if err != nil {
		return nil, stats, err
	}
	qv, err := embed([]string{QueryInstruction + query})
	if err != nil || len(qv) == 0 {
		return nil, stats, err
	}
	q := normalize(qv[0])
	var out []SemanticHit
	for _, t := range l.Topics {
		for _, s := range t.Sections {
			v := vecs[s.ID]
			if len(v) != len(q) {
				continue
			}
			var dot float64
			for i := range v {
				dot += float64(v[i]) * float64(q[i])
			}
			out = append(out, SemanticHit{Hit: Hit{Section: s, Topic: t.ID}, Similarity: dot})
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Similarity > out[j].Similarity })
	return out, stats, nil
}

// Blend mezcla la búsqueda por palabras con la de significado por rango recíproco (RRF, k=60), con las palabras
// pesando wordWeight (1 = igual que el significado). El Score es el RRF × 10.000; Similarity, el parecido.
func Blend(words []Hit, meaning []SemanticHit, limit int, wordWeight float64) []SemanticHit {
	const k = 60.0
	score := map[string]float64{}
	byID := map[string]SemanticHit{}
	for i, h := range words {
		score[h.ID] += wordWeight / (k + float64(i+1))
		byID[h.ID] = SemanticHit{Hit: h}
	}
	for i, h := range meaning {
		if i >= 50 {
			break
		}
		score[h.ID] += 1 / (k + float64(i+1))
		e := byID[h.ID]
		e.Hit.Section, e.Hit.Topic, e.Similarity = h.Section, h.Topic, h.Similarity
		byID[h.ID] = e
	}
	out := make([]SemanticHit, 0, len(byID))
	for id, e := range byID {
		e.Score = int(score[id] * 10000)
		out = append(out, e)
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Score != out[j].Score {
			return out[i].Score > out[j].Score
		}
		return out[i].ID < out[j].ID
	})
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out
}
