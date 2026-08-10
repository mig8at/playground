package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
)

type sesion struct {
	ID         string   `json:"id"`
	Pasos      []string `json:"pasos"`
	PasoActual int      `json:"paso_actual"`
	Estado     string   `json:"estado"`
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

// crearSesion es EL COMPOSITOR: recibe la llave del negocio —el par (comercio,
// entidad) más el país, que es la llave que ya decide todo en CreditOp— y resuelve
// qué pasos van. No hay `switch` por comercio: hay un SELECT.
func (s *srv) crearSesion(w http.ResponseWriter, r *http.Request) {
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
	var pasosJSON string
	err := s.db.QueryRow(
		`SELECT id, pasos FROM plantillas WHERE comercio = ? AND entidad = ? AND pais = ?`,
		in.Comercio, in.Entidad, in.Pais).Scan(&plantillaID, &pasosJSON)
	if err != nil {
		// Falla CERRADO a propósito: una plantilla faltante es un error de
		// configuración, y un default silencioso es cómo se cuelan flujos que
		// nadie configuró (y después nadie sabe por qué el comercio ve eso).
		errorJSON(w, 404, fmt.Sprintf("no hay plantilla para %s/%s/%s", in.Comercio, in.Entidad, in.Pais))
		return
	}

	var pasos []string
	json.Unmarshal([]byte(pasosJSON), &pasos)

	// La sesión guarda un SNAPSHOT de los pasos: editar la plantilla no reescribe
	// el flujo de alguien que ya está a mitad de camino.
	ses := sesion{ID: id(), Pasos: pasos, PasoActual: 0, Estado: "abierta"}
	if _, err := s.db.Exec(
		`INSERT INTO sesiones (id, plantilla_id, pasos, paso_actual, estado) VALUES (?,?,?,0,'abierta')`,
		ses.ID, plantillaID, pasosJSON); err != nil {
		errorJSON(w, 500, "no se pudo crear la sesión")
		return
	}

	s.hub.emitir(ses.ID, "sesion.creada", map[string]any{
		"comercio": in.Comercio, "entidad": in.Entidad, "pais": in.Pais, "pasos": pasos,
	})
	responder(w, 201, ses)
}

func (s *srv) leerSesion(sesionID string) (*sesion, error) {
	var ses sesion
	var pasosJSON string
	err := s.db.QueryRow(
		`SELECT id, pasos, paso_actual, estado FROM sesiones WHERE id = ?`, sesionID).
		Scan(&ses.ID, &pasosJSON, &ses.PasoActual, &ses.Estado)
	if err != nil {
		return nil, err
	}
	json.Unmarshal([]byte(pasosJSON), &ses.Pasos)
	return &ses, nil
}

func (s *srv) verSesion(w http.ResponseWriter, r *http.Request) {
	ses, err := s.leerSesion(r.PathValue("id"))
	if err != nil {
		errorJSON(w, 404, "sesión no encontrada")
		return
	}
	responder(w, 200, ses)
}

// pasoEsperado impide saltarse pasos: el cliente no elige en qué paso está.
func (s *srv) pasoEsperado(sesionID, tipo string) (*sesion, error) {
	ses, err := s.leerSesion(sesionID)
	if err != nil {
		return nil, fmt.Errorf("sesión no encontrada")
	}
	if ses.Estado != "abierta" {
		return nil, fmt.Errorf("la sesión está %s", ses.Estado)
	}
	if ses.PasoActual >= len(ses.Pasos) || ses.Pasos[ses.PasoActual] != tipo {
		return nil, fmt.Errorf("el paso actual no es %q", tipo)
	}
	return ses, nil
}

// avanzar mueve el cursor y emite. Si era el último paso, cierra la sesión: el
// final del flujo lo decide la plantilla, no el frontend.
func (s *srv) avanzar(ses *sesion) {
	siguiente := ses.PasoActual + 1
	estado := "abierta"
	if siguiente >= len(ses.Pasos) {
		estado = "completada"
	}
	s.db.Exec(`UPDATE sesiones SET paso_actual = ?, estado = ? WHERE id = ?`, siguiente, estado, ses.ID)

	payload := map[string]any{"paso_actual": siguiente, "estado": estado}
	if estado == "abierta" {
		payload["tipo"] = ses.Pasos[siguiente]
	}
	s.hub.emitir(ses.ID, "paso.avanzado", payload)
	if estado == "completada" {
		s.hub.emitir(ses.ID, "sesion.completada", map[string]any{})
	}
}

func (s *srv) guardarValor(sesionID, campo, valor string) {
	s.db.Exec(`INSERT INTO valores (sesion_id, campo, valor) VALUES (?,?,?)
	           ON CONFLICT(sesion_id, campo) DO UPDATE SET valor = excluded.valor`,
		sesionID, campo, valor)
}

// eventos es el SSE: HTTP plano, pasa WAF y funciona dentro de un iframe. Manda
// primero el historial (replay) y después sigue en vivo — así el segundo
// dispositivo puede entrar a mitad del flujo y ver todo lo que ya pasó.
func (s *srv) eventos(w http.ResponseWriter, r *http.Request) {
	sesionID := r.PathValue("id")
	if _, err := s.leerSesion(sesionID); err != nil {
		errorJSON(w, 404, "sesión no encontrada")
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

	ch := s.hub.suscribir(sesionID)
	defer s.hub.desuscribir(sesionID, ch)

	for _, e := range s.hub.historial(sesionID, desde) {
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
