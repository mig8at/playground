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

// Cada componente del catálogo tiene DOS contratos: lo que pinta (Vue) y lo que
// hace en backend (esto). Definir solo la mitad de UI es cómo se llega a un
// renderer que nadie puede servir.

// ── componente `telefono` ──────────────────────────────────────────────────────

// Las reglas por país son lo que hoy está hardcodeado en TS en el monorepo. Acá
// están en un solo lugar y son la próxima candidata obvia a mudarse a tabla.
var reglasTelefono = map[string]struct {
	prefijo string
	patron  *regexp.Regexp
}{
	"CO": {"57", regexp.MustCompile(`^3\d{9}$`)},
	"PE": {"51", regexp.MustCompile(`^9\d{8}$`)},
	"MX": {"52", regexp.MustCompile(`^\d{10}$`)},
	"DO": {"1", regexp.MustCompile(`^8[024]9\d{7}$`)},
}

func (s *srv) pasoTelefono(w http.ResponseWriter, r *http.Request) {
	sesionID := r.PathValue("id")
	ses, err := s.pasoEsperado(sesionID, "telefono")
	if err != nil {
		errorJSON(w, 409, err.Error())
		return
	}

	var in struct {
		Pais     string `json:"pais"`
		Telefono string `json:"telefono"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		errorJSON(w, 400, "cuerpo inválido")
		return
	}

	regla, ok := reglasTelefono[in.Pais]
	if !ok {
		errorJSON(w, 422, fmt.Sprintf("país %q sin regla de teléfono", in.Pais))
		return
	}
	if !regla.patron.MatchString(in.Telefono) {
		errorJSON(w, 422, "el número no cumple el formato del país")
		return
	}

	s.guardarValor(sesionID, "telefono", "+"+regla.prefijo+in.Telefono)
	s.hub.emitir(sesionID, "telefono.capturado", map[string]any{
		"pais": in.Pais, "telefono": "+" + regla.prefijo + enmascarar(in.Telefono),
	})
	s.avanzar(ses)
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

func (s *srv) otpEnviar(w http.ResponseWriter, r *http.Request) {
	sesionID := r.PathValue("id")
	if _, err := s.pasoEsperado(sesionID, "otp"); err != nil {
		errorJSON(w, 409, err.Error())
		return
	}

	n, _ := rand.Int(rand.Reader, big.NewInt(1000000))
	codigo := fmt.Sprintf("%06d", n.Int64())

	if _, err := s.db.Exec(
		`INSERT INTO otp (sesion_id, hash, expira, intentos, verificado) VALUES (?,?,?,0,0)
		 ON CONFLICT(sesion_id) DO UPDATE SET hash = excluded.hash, expira = excluded.expira,
		   intentos = 0, verificado = 0`,
		sesionID, hashOTP(codigo), time.Now().Add(otpVigencia).UTC().Format(time.RFC3339)); err != nil {
		errorJSON(w, 500, "no se pudo generar el código")
		return
	}

	// ⚠ PROTOTIPO LOCAL: no hay SMS, así que el código viaja en el evento para que
	// se pueda ver en el panel del operador. En algo real esto NO se emite: se manda
	// por el canal y el evento dice solo "enviado".
	s.hub.emitir(sesionID, "otp.enviado", map[string]any{
		"codigo_demo": codigo, "vigencia_seg": int(otpVigencia.Seconds()), "intentos": otpIntentos,
	})
	responder(w, 200, map[string]any{"enviado": true})
}

func (s *srv) otpVerificar(w http.ResponseWriter, r *http.Request) {
	sesionID := r.PathValue("id")
	ses, err := s.pasoEsperado(sesionID, "otp")
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
		`SELECT hash, expira, intentos FROM otp WHERE sesion_id = ? AND verificado = 0`, sesionID).
		Scan(&hash, &expira, &intentos); err != nil {
		errorJSON(w, 409, "no hay un código pendiente: pedí uno nuevo")
		return
	}

	venc, _ := time.Parse(time.RFC3339, expira)
	if time.Now().UTC().After(venc) {
		s.hub.emitir(sesionID, "otp.vencido", map[string]any{})
		errorJSON(w, 410, "el código venció: pedí uno nuevo")
		return
	}
	if intentos >= otpIntentos {
		s.hub.emitir(sesionID, "otp.bloqueado", map[string]any{"intentos": intentos})
		errorJSON(w, 429, "se agotaron los intentos: pedí un código nuevo")
		return
	}

	if hashOTP(in.Codigo) != hash {
		s.db.Exec(`UPDATE otp SET intentos = intentos + 1 WHERE sesion_id = ?`, sesionID)
		s.hub.emitir(sesionID, "otp.fallido", map[string]any{"restantes": otpIntentos - intentos - 1})
		errorJSON(w, 422, fmt.Sprintf("código incorrecto (%d intentos restantes)", otpIntentos-intentos-1))
		return
	}

	s.db.Exec(`UPDATE otp SET verificado = 1 WHERE sesion_id = ?`, sesionID)
	s.hub.emitir(sesionID, "otp.verificado", map[string]any{})
	s.avanzar(ses)
	responder(w, 200, map[string]any{"verificado": true})
}

// ── componente `datos` ────────────────────────────────────────────────────────

// Guarda pares campo/valor (EAV), que es la forma que ya usa el form dinámico real
// en `user_field_values`. El componente no sabe qué campos son: los define quien
// arma la plantilla.
func (s *srv) pasoDatos(w http.ResponseWriter, r *http.Request) {
	sesionID := r.PathValue("id")
	ses, err := s.pasoEsperado(sesionID, "datos")
	if err != nil {
		errorJSON(w, 409, err.Error())
		return
	}

	var in map[string]string
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		errorJSON(w, 400, "cuerpo inválido")
		return
	}
	if len(in) == 0 {
		errorJSON(w, 422, "no llegó ningún campo")
		return
	}

	campos := make([]string, 0, len(in))
	for campo, valor := range in {
		s.guardarValor(sesionID, campo, valor)
		campos = append(campos, campo)
	}

	s.hub.emitir(sesionID, "datos.capturados", map[string]any{"campos": campos})
	s.avanzar(ses)
	responder(w, 200, map[string]any{"ok": true})
}
