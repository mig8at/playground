package figma

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
)

// Fingerprint es la HUELLA del contenido de un nodo: el JSON que devuelve `NodeJSON`, con las claves en
// orden, resumido en 12 caracteres. Es lo mismo que hace canon con el hash del blob de cada fuente: un
// enlace a una pantalla guarda la huella del momento en que se copió, y comparar dice si el diseñador la
// cambió después.
//
// Cambia con cualquier cosa que cambie la pantalla —un texto, un color, una caja— y también cuando el
// diseñador edita un COMPONENTE que la pantalla usa, porque la instancia trae sus propiedades resueltas:
// eso también es «la pantalla se ve distinta». No cambia con lo que pasa en el resto del archivo. Medido el
// 2026-09-24: dos lecturas frescas de la misma pantalla y la copia guardada horas antes dieron la misma
// huella (381:1052 de Credifamilia y 591:842 de flujo-ecommerce).
func Fingerprint(raw []byte) (string, error) {
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		return "", fmt.Errorf("el nodo no es JSON: %v", err)
	}
	// Volver a escribirlo ordena las claves: la huella no depende de cómo Figma las listó esta vez.
	canon, err := json.Marshal(v)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(canon)
	return hex.EncodeToString(sum[:])[:12], nil
}
