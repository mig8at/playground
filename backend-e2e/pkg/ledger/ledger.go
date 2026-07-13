// Package ledger — registro JSON persistente de los recursos CREADOS en la BD (local o dev),
// para poder borrarlos UNO A UNO después (incluso tras cerrar la consola).
//
// Filosofía (regla dura del proyecto): NO existe borrado masivo en NINGÚN target. Cada recurso
// creado se anota acá como {target, table, key_col, key_val} y se borra con
//   DELETE FROM <table> WHERE <key_col> = <key_val>   (uno a uno, idempotente).
//
// Archivo: backend-e2e/.created-resources.json (gitignored). Override: env E2E_LEDGER_FILE.
package ledger

import (
	"encoding/json"
	"os"
	"time"
)

// Entry = un recurso creado, borrable por clave.
type Entry struct {
	Target string `json:"target"` // "local" | "dev"
	Table  string `json:"table"`
	KeyCol string `json:"key_col"`
	KeyVal string `json:"key_val"`
	Note   string `json:"note,omitempty"`
	At     string `json:"at,omitempty"` // ISO-8601, informativo
}

// Path del ledger. Default: .created-resources.json en el cwd (el harness corre desde backend-e2e).
func Path() string {
	if p := os.Getenv("E2E_LEDGER_FILE"); p != "" {
		return p
	}
	return ".created-resources.json"
}

// Load lee el ledger. Si no existe, devuelve vacío (no error) — arranque limpio.
func Load() ([]Entry, error) {
	b, err := os.ReadFile(Path())
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	if len(b) == 0 {
		return nil, nil
	}
	var es []Entry
	if err := json.Unmarshal(b, &es); err != nil {
		return nil, err
	}
	return es, nil
}

// Save reescribe el ledger completo.
func Save(es []Entry) error {
	if es == nil {
		es = []Entry{}
	}
	b, err := json.MarshalIndent(es, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(Path(), append(b, '\n'), 0o644)
}

// Record agrega una entrada (idempotente: no duplica misma target+table+key_col+key_val).
func Record(e Entry) error {
	es, _ := Load()
	for _, x := range es {
		if x.Target == e.Target && x.Table == e.Table && x.KeyCol == e.KeyCol && x.KeyVal == e.KeyVal {
			return nil
		}
	}
	if e.At == "" {
		e.At = time.Now().UTC().Format(time.RFC3339)
	}
	return Save(append(es, e))
}
