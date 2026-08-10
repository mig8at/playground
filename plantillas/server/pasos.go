package main

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"regexp"
	"time"
)

// Cada componente del catálogo tiene DOS contratos: lo que pinta (su .vue) y lo que
// hace en backend (acá). Definir nada más la mitad de UI es cómo se llega a un
// renderer que nadie puede servir.

// ── componente `telefono` ──────────────────────────────────────────────────────

// Solo Colombia por ahora. Agregar un país es una línea acá — que es justo la deuda:
// esto debería ser una tabla, igual que las plantillas. Queda anotado en el README.
var reglasTelefono = map[string]struct {
	prefijo string
	patron  *regexp.Regexp
}{
	"CO": {"57", regexp.MustCompile(`^3\d{9}$`)},
}

func (s *srv) pasoTelefono(w http.ResponseWriter, r *http.Request) {
	solicitudID := r.PathValue("id")
	sol, err := s.pasoEsperado(solicitudID, "telefono")
	if err != nil {
		errorJSON(w, 409, err.Error())
		return
	}

	var in struct {
		Telefono string `json:"telefono"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		errorJSON(w, 400, "cuerpo inválido")
		return
	}

	// El país sale de la SOLICITUD, no del cuerpo del request: si lo mandara el cliente,
	// podría elegir con qué regla se lo validan.
	regla, ok := reglasTelefono[sol.Pais]
	if !ok {
		errorJSON(w, 422, fmt.Sprintf("país %q sin regla de teléfono", sol.Pais))
		return
	}
	if !regla.patron.MatchString(in.Telefono) {
		errorJSON(w, 422, "el número no cumple el formato del país")
		return
	}

	// Se guardan los dos: el local para poder RE-LLENAR el campo si retrocede, y el
	// E.164 que es el que se usaría para mandar el SMS.
	s.guardarValor(solicitudID, "telefono", in.Telefono)
	s.guardarValor(solicitudID, "telefono_e164", "+"+regla.prefijo+in.Telefono)

	s.hub.emitir(solicitudID, "telefono.capturado", map[string]any{
		"pais": sol.Pais, "telefono": "+" + regla.prefijo + enmascarar(in.Telefono),
	})
	s.avanzar(sol)
	responder(w, 200, map[string]any{"ok": true})
}

func enmascarar(t string) string {
	if len(t) < 4 {
		return "***"
	}
	return "***" + t[len(t)-4:]
}

// ── componente `otp` ──────────────────────────────────────────────────────────

const (
	otpVigencia = 5 * time.Minute
	otpIntentos = 3
)

func hashOTP(codigo string) string {
	h := sha256.Sum256([]byte(codigo))
	return hex.EncodeToString(h[:])
}

// otpEnviar es IDEMPOTENTE salvo que se pida explícitamente reenviar. Sin eso, cada
// refresco de la pantalla generaba un código nuevo y mataba el anterior: en local se
// ve como ruido en el log, en producción es un SMS pagado por refresco y un usuario
// con tres mensajes de los que solo sirve el último. Lo destapó poner el paso en el
// URL — antes a esta pantalla solo se llegaba avanzando.
func (s *srv) otpEnviar(w http.ResponseWriter, r *http.Request) {
	solicitudID := r.PathValue("id")
	if _, err := s.pasoEsperado(solicitudID, "otp"); err != nil {
		errorJSON(w, 409, err.Error())
		return
	}

	var in struct {
		Reenviar bool `json:"reenviar"`
	}
	json.NewDecoder(r.Body).Decode(&in)

	if !in.Reenviar {
		var expira string
		if err := s.db.QueryRow(
			`SELECT expira FROM otp WHERE solicitud_id = ? AND verificado = 0`, solicitudID).Scan(&expira); err == nil {
			if venc, err := time.Parse(time.RFC3339, expira); err == nil && time.Now().UTC().Before(venc) {
				// Ya hay uno vivo: no se emite nada y no se toca la BD.
				responder(w, 200, map[string]any{"enviado": false, "ya_vigente": true})
				return
			}
		}
	}

	n, _ := rand.Int(rand.Reader, big.NewInt(1000000))
	codigo := fmt.Sprintf("%06d", n.Int64())

	if _, err := s.db.Exec(
		`INSERT INTO otp (solicitud_id, hash, expira, intentos, verificado) VALUES (?,?,?,0,0)
		 ON CONFLICT(solicitud_id) DO UPDATE SET hash = excluded.hash, expira = excluded.expira,
		   intentos = 0, verificado = 0`,
		solicitudID, hashOTP(codigo), time.Now().Add(otpVigencia).UTC().Format(time.RFC3339)); err != nil {
		errorJSON(w, 500, "no se pudo generar el código")
		return
	}

	// ⚠ PROTOTIPO LOCAL: no hay SMS, así que el código viaja en el evento para que
	// se pueda ver en el panel del operador. En algo real esto NO se emite: se manda
	// por el canal y el evento dice solo "enviado".
	s.hub.emitir(solicitudID, "otp.enviado", map[string]any{
		"codigo_demo": codigo, "vigencia_seg": int(otpVigencia.Seconds()), "intentos": otpIntentos,
	})
	responder(w, 200, map[string]any{"enviado": true})
}

func (s *srv) otpVerificar(w http.ResponseWriter, r *http.Request) {
	solicitudID := r.PathValue("id")
	sol, err := s.pasoEsperado(solicitudID, "otp")
	if err != nil {
		errorJSON(w, 409, err.Error())
		return
	}

	var in struct {
		Codigo string `json:"codigo"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		errorJSON(w, 400, "cuerpo inválido")
		return
	}

	var hash, expira string
	var intentos int
	if err := s.db.QueryRow(
		`SELECT hash, expira, intentos FROM otp WHERE solicitud_id = ? AND verificado = 0`, solicitudID).
		Scan(&hash, &expira, &intentos); err != nil {
		errorJSON(w, 409, "no hay un código pendiente: pedí uno nuevo")
		return
	}

	venc, _ := time.Parse(time.RFC3339, expira)
	if time.Now().UTC().After(venc) {
		s.hub.emitir(solicitudID, "otp.vencido", map[string]any{})
		errorJSON(w, 410, "el código venció: pedí uno nuevo")
		return
	}
	if intentos >= otpIntentos {
		s.hub.emitir(solicitudID, "otp.bloqueado", map[string]any{"intentos": intentos})
		errorJSON(w, 429, "se agotaron los intentos: pedí un código nuevo")
		return
	}

	if hashOTP(in.Codigo) != hash {
		s.db.Exec(`UPDATE otp SET intentos = intentos + 1 WHERE solicitud_id = ?`, solicitudID)
		s.hub.emitir(solicitudID, "otp.fallido", map[string]any{"restantes": otpIntentos - intentos - 1})
		errorJSON(w, 422, fmt.Sprintf("código incorrecto (%d intentos restantes)", otpIntentos-intentos-1))
		return
	}

	s.db.Exec(`UPDATE otp SET verificado = 1 WHERE solicitud_id = ?`, solicitudID)
	s.hub.emitir(solicitudID, "otp.verificado", map[string]any{})
	s.avanzar(sol)
	responder(w, 200, map[string]any{"verificado": true})
}

