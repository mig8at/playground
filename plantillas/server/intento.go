package main

import (
	"encoding/json"
	"fmt"
	"net/http"
)

// Un INTENTO es la solicitud yendo por un lender. La regla que lo organiza todo:
//
//	los DATOS son de la solicitud · el CURSOR es del intento
//
// Por eso cambiar de lender no vuelve a pedir el teléfono ni el documento —que es lo que
// hoy pasa en CreditOp, donde cada user_request es una isla— y por eso abandonar un
// intento no pierde nada: se queda con su estado, su cursor y su historia, y se retoma
// por su propio id.
type intento struct {
	ID        string  `json:"id"`
	Solicitud string  `json:"solicitud_id"`
	Lender    string  `json:"lender"`
	Etapas    []etapa `json:"etapas"`
	Paso      int     `json:"paso_actual"`
	Estado    string  `json:"estado"`
	Creado    string  `json:"creado"`
}

// activo devuelve el intento abierto de una solicitud, si hay. Solo puede haber uno: en
// un punto de venta la persona hace uno a la vez, y empezar otro pausa el anterior.
func (s *srv) intentoActivo(solicitudID string) (*intento, error) {
	return s.leerIntentoPor(`SELECT id, solicitud_id, lender, etapas, paso_actual, estado, creado
	                           FROM intentos WHERE solicitud_id = ? AND estado = 'abierto' LIMIT 1`, solicitudID)
}

func (s *srv) leerIntento(id string) (*intento, error) {
	return s.leerIntentoPor(`SELECT id, solicitud_id, lender, etapas, paso_actual, estado, creado
	                           FROM intentos WHERE id = ?`, id)
}

// Variádico a propósito: la consulta de "¿ya hubo uno con este lender?" lleva DOS
// parámetros, y con la firma de uno solo fallaba en silencio — el error se leía como
// "no hay previo" y abría un intento nuevo cada vez que se retomaba, que es justo lo
// contrario de lo que hace falta para poder contar la historia.
func (s *srv) leerIntentoPor(q string, args ...any) (*intento, error) {
	var i intento
	var etapas string
	if err := s.db.QueryRow(q, args...).Scan(&i.ID, &i.Solicitud, &i.Lender, &etapas, &i.Paso, &i.Estado, &i.Creado); err != nil {
		return nil, err
	}
	json.Unmarshal([]byte(etapas), &i.Etapas)
	return &i, nil
}

func (s *srv) intentosDe(solicitudID string) []intento {
	filas, err := s.db.Query(`SELECT id, solicitud_id, lender, etapas, paso_actual, estado, creado
	                            FROM intentos WHERE solicitud_id = ? ORDER BY creado`, solicitudID)
	if err != nil {
		return []intento{}
	}
	defer filas.Close()
	out := []intento{}
	for filas.Next() {
		var i intento
		var etapas string
		if filas.Scan(&i.ID, &i.Solicitud, &i.Lender, &etapas, &i.Paso, &i.Estado, &i.Creado) == nil {
			json.Unmarshal([]byte(etapas), &i.Etapas)
			out = append(out, i)
		}
	}
	return out
}

// abrirIntento arranca (o RETOMA) el intento con un lender. Si ya hubo uno con ese lender,
// se retoma por su id y con su cursor donde quedó: el id es lo que permite contar la
// historia, y uno nuevo por cada regreso la partiría en pedazos.
func (s *srv) abrirIntento(w http.ResponseWriter, r *http.Request) {
	solicitudID := r.PathValue("id")
	sol, err := s.leer(solicitudID)
	if err != nil {
		errorJSON(w, 404, "solicitud no encontrada")
		return
	}
	var in struct {
		Lender string `json:"lender"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil || in.Lender == "" {
		errorJSON(w, 400, "falta el lender")
		return
	}
	// No se puede elegir lender antes de terminar lo que va antes. Se mira el estado de
	// la SOLICITUD, no el del cursor activo: con un intento abierto, el cursor dice
	// "abierta" y esto respondería que todavía no llegó.
	if sol.EstadoSolicitud != "completada" {
		errorJSON(w, 409, "la solicitud todavía no llegó a la elección de lender")
		return
	}

	// El que estuviera abierto se ABANDONA, no se borra.
	if act, err := s.intentoActivo(solicitudID); err == nil {
		if act.Lender == in.Lender {
			responder(w, 200, act)
			return
		}
		s.db.Exec(`UPDATE intentos SET estado = 'abandonado' WHERE id = ?`, act.ID)
		s.hub.emitirEn(solicitudID, act.ID, "intento.abandonado", map[string]any{
			"lender": act.Lender, "paso_actual": act.Paso, "motivo": "se eligió otro lender",
		})
	}

	// ¿Ya hubo uno con este lender? Se retoma, con su id y su cursor.
	if previo, err := s.leerIntentoPor(`SELECT id, solicitud_id, lender, etapas, paso_actual, estado, creado
	                                      FROM intentos WHERE solicitud_id = ? AND lender = ? ORDER BY creado DESC LIMIT 1`,
		solicitudID, in.Lender); err == nil {
		s.db.Exec(`UPDATE intentos SET estado = 'abierto' WHERE id = ?`, previo.ID)
		s.hub.emitirEn(solicitudID, previo.ID, "intento.retomado", map[string]any{
			"lender": previo.Lender, "paso_actual": previo.Paso,
		})
		reabierto, _ := s.leerIntento(previo.ID)
		responder(w, 200, reabierto)
		return
	}

	var etapasLender string
	s.db.QueryRow(`SELECT p.etapas_lender FROM solicitudes s JOIN plantillas p ON p.id = s.plantilla_id
	                WHERE s.id = ?`, solicitudID).Scan(&etapasLender)

	nuevo := id()
	if _, err := s.db.Exec(`INSERT INTO intentos (id, solicitud_id, lender, etapas, paso_actual, estado)
	                          VALUES (?,?,?,?,0,'abierto')`, nuevo, solicitudID, in.Lender, etapasLender); err != nil {
		errorJSON(w, 500, "no se pudo abrir el intento")
		return
	}
	s.hub.emitirEn(solicitudID, nuevo, "intento.abierto", map[string]any{"lender": in.Lender})

	creado, _ := s.leerIntento(nuevo)
	responder(w, 201, creado)
}

// abandonar deja el intento donde está. No borra: por eso se puede retomar y por eso la
// historia dice hasta dónde llegó antes de irse a otro lender.
func (s *srv) abandonarIntento(w http.ResponseWriter, r *http.Request) {
	i, err := s.leerIntento(r.PathValue("id"))
	if err != nil {
		errorJSON(w, 404, "intento no encontrado")
		return
	}
	if i.Estado != "abierto" {
		errorJSON(w, 409, fmt.Sprintf("el intento está %s", i.Estado))
		return
	}
	s.db.Exec(`UPDATE intentos SET estado = 'abandonado' WHERE id = ?`, i.ID)
	s.hub.emitirEn(i.Solicitud, i.ID, "intento.abandonado", map[string]any{
		"lender": i.Lender, "paso_actual": i.Paso, "motivo": "lo dejó la persona",
	})
	actualizado, _ := s.leerIntento(i.ID)
	responder(w, 200, actualizado)
}

func (s *srv) verIntento(w http.ResponseWriter, r *http.Request) {
	i, err := s.leerIntento(r.PathValue("id"))
	if err != nil {
		errorJSON(w, 404, "intento no encontrado")
		return
	}
	responder(w, 200, i)
}
