package check

/* La escritura por servicio que se MIDIÓ A MANO. keyring no la sondea solo: mandar llamadas de escritura
 * lo frena el control de permisos de la sesión, así que las corre Miguel desde su terminal y el resultado
 * queda acá, con cuenta, fecha, quién y sonda. La interfaz lo muestra como lo que es —una medición con
 * fecha—, nunca como algo medido ahora. */

import (
	_ "embed"
	"encoding/json"
)

//go:embed data/writes.json
var writesJSON []byte

// WriteMeasurement es una corrida de escritura sobre una cuenta.
type WriteMeasurement struct {
	Account string            `json:"account"`
	Date    string            `json:"date"`
	By      string            `json:"by"`
	Probe   string            `json:"probe"`
	Results map[string]string `json:"results"` // servicio → yes · no · unreliable · unmeasured
}

// RecordedWrites son las mediciones de escritura registradas, por cuenta.
func RecordedWrites() ([]WriteMeasurement, error) {
	var doc struct {
		Measurements []WriteMeasurement `json:"measurements"`
	}
	if err := json.Unmarshal(writesJSON, &doc); err != nil {
		return nil, err
	}
	return doc.Measurements, nil
}
