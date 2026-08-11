package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strings"
)

// etapa es la unidad que ve la PERSONA: un objetivo ("tu celular") que por debajo
// puede necesitar varios componentes. Retroceder trabaja en esta granularidad.
type etapa struct {
	Etapa  string             `json:"etapa"`
	Titulo string             `json:"titulo"`
	Pasos  []string           `json:"pasos"`
	Campos map[string][]campo `json:"campos,omitempty"` // por tipo de paso
}

// campo NO declara su tipo: lo hereda de la clave del diccionario. Acá va solo cómo se
// PIDE el dato (etiqueta, ayuda, obligatoriedad, formato); qué ES el dato ya lo dice el
// diccionario. Esa división es la que evita que dos formularios definan `docNumber` con
// tipos distintos.
type campo struct {
	Clave     string `json:"clave"`
	Label     string `json:"label"`
	Ayuda     string `json:"ayuda,omitempty"`
	Requerido bool   `json:"requerido"`
	Patron    string `json:"patron,omitempty"`

	// Se rellena al servir, desde el diccionario. No se escribe en la plantilla.
	Tipo string `json:"tipo,omitempty"`
}

type solicitud struct {
	ID         string            `json:"id"`
	Pais       string            `json:"pais"`
	Etapas     []etapa           `json:"etapas"`
	PasoActual int               `json:"paso_actual"`
	Estado     string            `json:"estado"`
	Valores    map[string]string `json:"valores"`

	// Derivados, para que el front no tenga que recalcularlos (ni equivocarse).
	Pasos       []string `json:"pasos"`
	PasoTipo    string   `json:"paso_tipo"`
	EtapaActual int      `json:"etapa_actual"`
	Campos      []campo  `json:"campos"` // los del paso actual, con su tipo resuelto
}

func aplanar(etapas []etapa) []string {
	var out []string
	for _, e := range etapas {
		out = append(out, e.Pasos...)
	}
	return out
}

// etapaDe traduce un índice PLANO de paso a su índice de etapa.
func etapaDe(etapas []etapa, plano int) int {
	acum := 0
	for i, e := range etapas {
		acum += len(e.Pasos)
		if plano < acum {
			return i
		}
	}
	return len(etapas) - 1
}

// primerPasoDe da el índice plano donde ARRANCA una etapa: es el destino de un
// retroceso, porque volver a una etapa es volver a hacerla desde el principio.
func primerPasoDe(etapas []etapa, idxEtapa int) int {
	plano := 0
	for i, e := range etapas {
		if i == idxEtapa {
			return plano
		}
		plano += len(e.Pasos)
	}
	return 0
}

func id() string {
	b := make([]byte, 6)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func responder(w http.ResponseWriter, codigo int, cuerpo any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(codigo)
	json.NewEncoder(w).Encode(cuerpo)
}

func errorJSON(w http.ResponseWriter, codigo int, msg string) {
	responder(w, codigo, map[string]string{"error": msg})
}

// crearSolicitud es EL COMPOSITOR: recibe la llave del negocio —el par (comercio,
// entidad) más el país, que es la llave que ya decide todo en CreditOp— y resuelve
// qué etapas van. No hay `switch` por comercio: hay un SELECT.
func (s *srv) crearSolicitud(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Comercio string `json:"comercio"`
		Entidad  string `json:"entidad"`
		Pais     string `json:"pais"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		errorJSON(w, 400, "cuerpo inválido")
		return
	}

	var plantillaID int64
	var etapasJSON string
	err := s.db.QueryRow(
		`SELECT id, etapas FROM plantillas WHERE comercio = ? AND entidad = ? AND pais = ?`,
		in.Comercio, in.Entidad, in.Pais).Scan(&plantillaID, &etapasJSON)
	if err != nil {
		// Falla CERRADO a propósito: una plantilla faltante es un error de
		// configuración, y un default silencioso es cómo se cuelan flujos que
		// nadie configuró (y después nadie sabe por qué el comercio ve eso).
		errorJSON(w, 404, fmt.Sprintf("no hay plantilla para %s/%s/%s", in.Comercio, in.Entidad, in.Pais))
		return
	}

	// La solicitud guarda un SNAPSHOT de las etapas: editar la plantilla no reescribe
	// el flujo de alguien que ya está a mitad de camino.
	nueva := id()
	if _, err := s.db.Exec(
		`INSERT INTO solicitudes (id, plantilla_id, etapas, paso_actual, estado) VALUES (?,?,?,0,'abierta')`,
		nueva, plantillaID, etapasJSON); err != nil {
		errorJSON(w, 500, "no se pudo crear la solicitud")
		return
	}

	s.hub.emitir(nueva, "solicitud.creada", map[string]any{
		"comercio": in.Comercio, "entidad": in.Entidad, "pais": in.Pais,
	})

	sol, err := s.leer(nueva)
	if err != nil {
		errorJSON(w, 500, "la solicitud se creó pero no se pudo leer")
		return
	}
	responder(w, 201, sol)
}

// leer es la ÚNICA fuente de verdad del estado. El front la consulta al arrancar y
// después de cada refresco: por eso en el URL viaja solo el ID de la solicitud —
// no hay ningún paso en la barra de direcciones que alguien pueda cambiar a mano.
func (s *srv) leer(solicitudID string) (*solicitud, error) {
	var sol solicitud
	var etapasJSON string
	err := s.db.QueryRow(
		`SELECT s.id, p.pais, s.etapas, s.paso_actual, s.estado
		   FROM solicitudes s JOIN plantillas p ON p.id = s.plantilla_id
		  WHERE s.id = ?`, solicitudID).
		Scan(&sol.ID, &sol.Pais, &etapasJSON, &sol.PasoActual, &sol.Estado)
	if err != nil {
		return nil, err
	}
	json.Unmarshal([]byte(etapasJSON), &sol.Etapas)
	sol.Pasos = aplanar(sol.Etapas)
	sol.EtapaActual = etapaDe(sol.Etapas, sol.PasoActual)
	if sol.Estado == "abierta" && sol.PasoActual < len(sol.Pasos) {
		sol.PasoTipo = sol.Pasos[sol.PasoActual]
	}

	// Los campos del paso actual viajan resueltos: el front no tiene que buscar en el
	// snapshot ni saber de qué tipo es cada clave.
	sol.Campos = []campo{}
	if sol.PasoTipo != "" {
		for _, c := range sol.Etapas[sol.EtapaActual].Campos[sol.PasoTipo] {
			s.db.QueryRow(`SELECT tipo FROM claves WHERE clave = ?`, c.Clave).Scan(&c.Tipo)
			sol.Campos = append(sol.Campos, c)
		}
	}

	// Los valores capturados viajan de vuelta para que al reiniciar el campo venga
	// LLENO. Es del server y no de memoria del browser porque tiene que sobrevivir a
	// un refresco y a que el segundo dispositivo también lo vea.
	sol.Valores = map[string]string{}
	filas, err := s.db.Query(`SELECT campo, valor FROM valores WHERE solicitud_id = ?`, solicitudID)
	if err == nil {
		defer filas.Close()
		for filas.Next() {
			var campo, valor string
			if filas.Scan(&campo, &valor) == nil {
				sol.Valores[campo] = valor
			}
		}
	}
	return &sol, nil
}

func (s *srv) verSolicitud(w http.ResponseWriter, r *http.Request) {
	sol, err := s.leer(r.PathValue("id"))
	if err != nil {
		errorJSON(w, 404, "solicitud no encontrada")
		return
	}
	responder(w, 200, sol)
}

// pasoEsperado impide saltarse pasos: el cliente no elige en qué paso está.
func (s *srv) pasoEsperado(solicitudID, tipo string) (*solicitud, error) {
	sol, err := s.leer(solicitudID)
	if err != nil {
		return nil, fmt.Errorf("solicitud no encontrada")
	}
	if sol.Estado != "abierta" {
		return nil, fmt.Errorf("la solicitud está %s", sol.Estado)
	}
	if sol.PasoTipo != tipo {
		return nil, fmt.Errorf("el paso actual no es %q", tipo)
	}
	return sol, nil
}

// guardarValor exige que el campo sea una clave DEL DICCIONARIO. Sin esto, "un solo
// vocabulario" es una frase del README: el flujo guardaba `phone` mientras el diccionario
// no lo conocía, y nada avisaba. Falla en vez de loguear, porque un aviso en un log es
// exactamente cómo se acumulan los sinónimos.
func (s *srv) guardarValor(solicitudID, campo, valor string) error {
	var existe int
	s.db.QueryRow(`SELECT COUNT(*) FROM claves WHERE clave = ?`, campo).Scan(&existe)
	if existe == 0 {
		return fmt.Errorf("el campo %q no es una clave del diccionario", campo)
	}
	_, err := s.db.Exec(`INSERT INTO valores (solicitud_id, campo, valor) VALUES (?,?,?)
	           ON CONFLICT(solicitud_id, campo) DO UPDATE SET valor = excluded.valor`,
		solicitudID, campo, valor)
	return err
}

// avanzar mueve el cursor un PASO (no una etapa: adentro de una etapa hay pantallas)
// y emite. Si era el último, cierra: el final del flujo lo decide la plantilla.
func (s *srv) avanzar(sol *solicitud) {
	siguiente := sol.PasoActual + 1
	estado := "abierta"
	if siguiente >= len(sol.Pasos) {
		estado = "completada"
	}
	s.db.Exec(`UPDATE solicitudes SET paso_actual = ?, estado = ? WHERE id = ?`, siguiente, estado, sol.ID)

	payload := map[string]any{"paso_actual": siguiente, "estado": estado}
	if estado == "abierta" {
		payload["tipo"] = sol.Pasos[siguiente]
		payload["etapa"] = sol.Etapas[etapaDe(sol.Etapas, siguiente)].Etapa
	}
	s.hub.emitir(sol.ID, "paso.avanzado", payload)
	if estado == "completada" {
		s.hub.emitir(sol.ID, "solicitud.completada", map[string]any{})
	}
}

// reiniciar es el "atrás", y es UNA sola regla para todos los componentes: se conserva
// lo que la persona TIPEÓ y se borra todo lo VERIFICADO o DERIVADO.
//
// El criterio es de negocio, no técnico: el motivo real de volver es corregir un dato,
// así que si el campo vuelve vacío el reinicio no sirve para lo único que la gente hace
// con él. Y lo que se validó contra el dato viejo —el OTP— no puede sobrevivir al cambio.
//
// La solicitud NO se reemplaza por una nueva: mismo id, misma línea de tiempo. Una
// solicitud nueva por cada corrección dejaría filas huérfanas, partiría la historia en
// dos (justo lo que hace falta para dar soporte) y, el día que una etapa consulte un
// buró, podría significar pagar la consulta de nuevo.
//
// Se eligió esto en vez de un contrato de undo por componente: para dos componentes,
// aquello era maquinaria de más. ⚠ Cuando aparezca el primer paso IRREVERSIBLE (una
// consulta que se cobra, un handoff que ya salió de tu control), reiniciar deja de ser
// gratis y hace falta una marca en el catálogo — es una columna, no un rediseño.
//
// ⚠ Las escrituras de acá (borrar el OTP + mover el cursor + emitir) NO están en una
// sola transacción. Es el hueco conocido: si el proceso muere en el medio, el OTP quedó
// borrado y el cursor no volvió.
func (s *srv) reiniciar(w http.ResponseWriter, r *http.Request) {
	solicitudID := r.PathValue("id")
	sol, err := s.leer(solicitudID)
	if err != nil {
		errorJSON(w, 404, "solicitud no encontrada")
		return
	}
	if sol.PasoActual == 0 {
		errorJSON(w, 409, "la solicitud ya está en el primer paso")
		return
	}

	// Muere lo verificado. `valores` queda: es el borrador que la persona vuelve a editar.
	s.db.Exec(`DELETE FROM otp WHERE solicitud_id = ?`, solicitudID)
	s.db.Exec(`UPDATE solicitudes SET paso_actual = 0, estado = 'abierta' WHERE id = ?`, solicitudID)

	s.hub.emitir(solicitudID, "solicitud.reiniciada", map[string]any{
		"paso_actual": 0, "tipo": sol.Pasos[0], "estado": "abierta",
		"desde_etapa": sol.Etapas[sol.EtapaActual].Etapa,
	})

	actualizada, err := s.leer(solicitudID)
	if err != nil {
		errorJSON(w, 500, "se reinició pero no se pudo leer la solicitud")
		return
	}
	responder(w, 200, actualizada)
}

// enviarFormulario es UN handler para cualquier paso que sea un formulario: valida contra
// los `campos` que declara la plantilla para el paso ACTUAL y guarda. Agregar un
// formulario nuevo no toca Go — es una fila.
//
// No recibe qué paso es: lo decide el server. Si el cliente pudiera decirlo, podría
// mandar los campos de otro paso.
func (s *srv) enviarFormulario(w http.ResponseWriter, r *http.Request) {
	solicitudID := r.PathValue("id")
	sol, err := s.leer(solicitudID)
	if err != nil {
		errorJSON(w, 404, "solicitud no encontrada")
		return
	}
	if sol.Estado != "abierta" {
		errorJSON(w, 409, fmt.Sprintf("la solicitud está %s", sol.Estado))
		return
	}
	if len(sol.Campos) == 0 {
		errorJSON(w, 409, fmt.Sprintf("el paso %q no es un formulario", sol.PasoTipo))
		return
	}

	var in map[string]string
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		errorJSON(w, 400, "cuerpo inválido")
		return
	}

	// Se valida TODO antes de guardar nada: un formulario a medio guardar es peor que uno
	// rechazado.
	for _, c := range sol.Campos {
		v := strings.TrimSpace(in[c.Clave])
		if v == "" {
			if c.Requerido {
				errorJSON(w, 422, fmt.Sprintf("falta %s", c.Label))
				return
			}
			continue
		}
		if c.Patron != "" {
			ok, err := regexp.MatchString(c.Patron, v)
			if err != nil || !ok {
				errorJSON(w, 422, fmt.Sprintf("%s no tiene el formato esperado", c.Label))
				return
			}
		}
	}

	guardadas := []string{}
	for _, c := range sol.Campos {
		v := strings.TrimSpace(in[c.Clave])
		if v == "" {
			continue
		}
		if err := s.guardarValor(solicitudID, c.Clave, v); err != nil {
			errorJSON(w, 500, err.Error())
			return
		}
		guardadas = append(guardadas, c.Clave)
	}

	s.hub.emitir(solicitudID, "formulario.enviado", map[string]any{
		"paso": sol.PasoTipo, "claves": guardadas,
	})
	s.avanzar(sol)
	responder(w, 200, map[string]any{"ok": true})
}

// eventos es el SSE: HTTP plano, pasa WAF y funciona dentro de un iframe. Manda
// primero el historial (replay) y después sigue en vivo — así el segundo
// dispositivo puede entrar a mitad del flujo y ver todo lo que ya pasó.
func (s *srv) eventos(w http.ResponseWriter, r *http.Request) {
	solicitudID := r.PathValue("id")
	if _, err := s.leer(solicitudID); err != nil {
		errorJSON(w, 404, "solicitud no encontrada")
		return
	}

	fl, ok := w.(http.Flusher)
	if !ok {
		errorJSON(w, 500, "streaming no soportado")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(200)

	// Sin `event:` a propósito: si el evento va nombrado, el `onmessage` del browser
	// NO dispara y hay que registrar un addEventListener por cada tipo. El tipo va
	// adentro del JSON, así un panel genérico recibe todo con un solo handler.
	escribir := func(e evento) {
		fmt.Fprintf(w, "id: %d\ndata: {\"id\":%d,\"tipo\":%q,\"payload\":%s,\"ts\":%q}\n\n",
			e.ID, e.ID, e.Tipo, e.Payload, e.TS)
		fl.Flush()
	}

	// Last-Event-ID lo manda el browser solo al reconectar: retomamos donde quedó.
	var desde int64
	fmt.Sscanf(r.Header.Get("Last-Event-ID"), "%d", &desde)

	ch := s.hub.suscribir(solicitudID)
	defer s.hub.desuscribir(solicitudID, ch)

	for _, e := range s.hub.historial(solicitudID, desde) {
		escribir(e)
	}

	for {
		select {
		case <-r.Context().Done():
			return
		case e, abierto := <-ch:
			if !abierto {
				return
			}
			escribir(e)
		}
	}
}
