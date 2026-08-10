package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
)

// etapa es la unidad que ve la PERSONA: un objetivo ("tu celular") que por debajo
// puede necesitar varios componentes. Retroceder trabaja en esta granularidad.
type etapa struct {
	Etapa    string   `json:"etapa"`
	Titulo   string   `json:"titulo"`
	AlVolver string   `json:"al_volver"`
	Pasos    []string `json:"pasos"`
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

	// Los valores capturados viajan de vuelta para que al retroceder el campo venga
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

func (s *srv) guardarValor(solicitudID, campo, valor string) {
	s.db.Exec(`INSERT INTO valores (solicitud_id, campo, valor) VALUES (?,?,?)
	           ON CONFLICT(solicitud_id, campo) DO UPDATE SET valor = excluded.valor`,
		solicitudID, campo, valor)
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

// retroceder trabaja por ETAPA, no por pantalla: volver desde el perfil manda al
// número de teléfono —el arranque de la etapa "celular"— y no al código, porque para
// la persona pedir el número y verificarlo son UNA sola cosa.
//
// Sin cuerpo retrocede a la etapa anterior. Y antes de mover nada deshace el efecto
// de cada paso que se pisa: sin eso, cambiar el teléfono dejaría vivo un OTP
// verificado contra el número viejo.
//
// ⚠ Las escrituras de acá (deshacer + mover el cursor + los eventos) NO están en una
// sola transacción. Es el lugar donde más se nota el hueco: si el proceso muere en el
// medio, el OTP quedó borrado y el cursor no volvió. Es lo próximo a arreglar.
func (s *srv) retroceder(w http.ResponseWriter, r *http.Request) {
	solicitudID := r.PathValue("id")
	sol, err := s.leer(solicitudID)
	if err != nil {
		errorJSON(w, 404, "solicitud no encontrada")
		return
	}

	var in struct {
		Etapa string `json:"etapa"`
	}
	json.NewDecoder(r.Body).Decode(&in)

	destinoEtapa := sol.EtapaActual - 1
	if in.Etapa != "" {
		destinoEtapa = -1
		for i, e := range sol.Etapas {
			if e.Etapa == in.Etapa {
				destinoEtapa = i
				break
			}
		}
		if destinoEtapa < 0 {
			errorJSON(w, 422, fmt.Sprintf("la etapa %q no está en esta plantilla", in.Etapa))
			return
		}
	}
	if destinoEtapa < 0 {
		errorJSON(w, 409, "ya estás en la primera etapa")
		return
	}
	if destinoEtapa > sol.EtapaActual {
		errorJSON(w, 409, "retroceder es ir hacia atrás")
		return
	}

	destino := primerPasoDe(sol.Etapas, destinoEtapa)
	if destino >= sol.PasoActual {
		errorJSON(w, 409, "no hay nada atrás que rehacer")
		return
	}

	// Se pisa el rango destino..pasoActual INCLUSIVE: el paso donde estamos parados
	// también puede tener efectos a medio hacer (un OTP ya emitido y sin verificar).
	hasta := sol.PasoActual
	if hasta >= len(sol.Pasos) {
		hasta = len(sol.Pasos) - 1
	}
	for i := destino; i <= hasta; i++ {
		if !s.esReversible(sol.Pasos[i]) {
			errorJSON(w, 409, fmt.Sprintf("el paso %q no se puede deshacer", sol.Pasos[i]))
			return
		}
	}
	for i := hasta; i >= destino; i-- {
		s.deshacer(solicitudID, sol.Pasos[i])
	}

	s.db.Exec(`UPDATE solicitudes SET paso_actual = ?, estado = 'abierta' WHERE id = ?`, destino, solicitudID)
	s.hub.emitir(solicitudID, "etapa.retrocedida", map[string]any{
		"paso_actual": destino, "etapa": sol.Etapas[destinoEtapa].Etapa,
		"tipo": sol.Pasos[destino], "desde": sol.Etapas[sol.EtapaActual].Etapa, "estado": "abierta",
	})

	actualizada, err := s.leer(solicitudID)
	if err != nil {
		errorJSON(w, 500, "se retrocedió pero no se pudo leer la solicitud")
		return
	}
	responder(w, 200, actualizada)
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
