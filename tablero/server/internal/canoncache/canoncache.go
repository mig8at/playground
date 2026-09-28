// Package canoncache es la copia local de canon que el tablero usa para trabajar el día a día: la lista de
// temas, en qué etapa del recorrido del crédito vive cada uno, y el mapa global entero.
//
// Canon es el contexto de CreditOp que el equipo ya escribió y verificó contra los repos; trabajar sin él
// es reconstruirlo de memoria. Esta copia existe para que el agente lo tenga desde el primer mensaje
// (el hook de inicio la lee) y para que no dependa de tener la VPN de prod en ese momento: sin conexión se
// usa la última copia, y se dice de cuándo es.
//
// Sólo usa lecturas gratis (`/api/topics` y `/api/globalmap`, por el conector). ⛔ Nunca `/api/ask`: ése
// es para credibot y las herramientas externas; acá se lee el contexto, no se le pregunta a un modelo.
package canoncache

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"creditop/playground/connectors/canon"
)

// Cache es lo que se guarda en disco (sin el mapa global, que va en su propio archivo).
type Cache struct {
	ETag      string               `json:"etag"`
	FetchedAt time.Time            `json:"fetchedAt"` // cuándo cambió por última vez lo que hay acá
	CheckedAt time.Time            `json:"checkedAt"` // cuándo se confirmó por última vez contra canon
	Source    string               `json:"source"`
	Topics    []canon.TopicSummary `json:"topics"`
	Stages    []canon.Stage        `json:"stages"`
}

// Paths: la copia chica (la lee el hook de inicio) y el mapa global entero.
func Paths(cacheDir string) (small, globalMap string) {
	return filepath.Join(cacheDir, "canon.json"), filepath.Join(cacheDir, "canon-globalmap.json")
}

// Load lee la copia; ok=false si no hay ninguna.
func Load(cacheDir string) (Cache, bool) {
	small, _ := Paths(cacheDir)
	raw, err := os.ReadFile(small)
	if err != nil {
		return Cache{}, false
	}
	var c Cache
	if json.Unmarshal(raw, &c) != nil || len(c.Topics) == 0 {
		return Cache{}, false
	}
	return c, true
}

func save(cacheDir string, c Cache, globalMap json.RawMessage) error {
	if err := os.MkdirAll(cacheDir, 0o755); err != nil {
		return err
	}
	small, gm := Paths(cacheDir)
	raw, err := json.Marshal(c)
	if err != nil {
		return err
	}
	if err := writeAtomic(small, raw); err != nil {
		return err
	}
	if globalMap != nil {
		return writeAtomic(gm, globalMap)
	}
	return nil
}

// writeAtomic escribe a un temporal y lo renombra: dos sesiones que arrancan a la vez no dejan un archivo
// a medias.
func writeAtomic(path string, data []byte) error {
	tmp := fmt.Sprintf("%s.%d.tmp", path, os.Getpid())
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

/* Refresh confirma la copia contra canon. Si el corpus no cambió (304) sólo anota que se revisó; si
 * cambió, baja la lista y el mapa global y recalcula las etapas. Si canon no contesta devuelve la copia que
 * había —puede estar vacía— y el error, para que quien la muestre diga de cuándo es. */
func Refresh(ctx context.Context, client *canon.Client, source, cacheDir string, now time.Time) (Cache, error) {
	old, _ := Load(cacheDir)
	topics, etag, notModified, err := client.Topics(ctx, old.ETag)
	if err != nil {
		return old, err
	}
	if notModified {
		old.CheckedAt = now
		return old, save(cacheDir, old, nil)
	}
	gm, err := client.GlobalMap(ctx)
	if err != nil {
		return old, err
	}
	stages, err := canon.Stages(gm)
	if err != nil {
		return old, err
	}
	fresh := Cache{ETag: etag, FetchedAt: now, CheckedAt: now, Source: source, Topics: topics, Stages: stages}
	return fresh, save(cacheDir, fresh, gm)
}

// CrossCutting: los temas que no tienen estaciones en el recorrido (actores, ambientes, arquitectura…).
func (c Cache) CrossCutting() []string {
	inStage := map[string]bool{}
	for _, s := range c.Stages {
		for _, t := range s.Topics {
			inStage[t] = true
		}
	}
	var out []string
	for _, t := range c.Topics {
		if !inStage[t.Topic] {
			out = append(out, t.Topic)
		}
	}
	return out
}

// compactWidth es el ancho de la lista del inicio; lo que no entra sigue abajo, con sangría.
const compactWidth = 100

// Compact es la lista del inicio: los temas por etapa, sólo nombres. Cabe en el presupuesto del hook
// (~1,3 KB con 54 temas); los títulos y resúmenes los da `make canon-mapa`.
func (c Cache) Compact() string {
	var b strings.Builder
	line := func(label string, topics []string) {
		prefix := fmt.Sprintf("    %-20s ", label)
		indent := strings.Repeat(" ", len([]rune(prefix))) // en caracteres: «evaluación» tiene una ó de dos bytes
		row := prefix
		for i, t := range topics {
			piece := t
			if i > 0 {
				piece = " · " + t
			}
			if i > 0 && len([]rune(row+piece)) > compactWidth {
				b.WriteString(row + " ·\n")
				row = indent + t
				continue
			}
			row += piece
		}
		b.WriteString(row + "\n")
	}
	for _, s := range c.Stages {
		if len(s.Topics) > 0 {
			line(strings.ToLower(s.Title), s.Topics)
		}
	}
	if t := c.CrossCutting(); len(t) > 0 {
		line("transversales", t)
	}
	return strings.TrimRight(b.String(), "\n")
}
