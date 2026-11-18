package main

// LA SESIÓN DEL PLAYGROUND, cuidada mientras Cockpit está abierto (Miguel, 2026-11-18: un aviso que, al tocarlo, lleve
// directo al login; con Cockpit cerrado no se está trabajando y lo agendado queda en pausa).
//
// El token del CLI `playground` dura 12 h y no trae con qué renovarse: se renueva entrando de nuevo, y la página del
// home pide tocar «Continuar con Google» cada vez (la web usa el mismo token de 12 h, así que Chrome no guarda nada que
// lo salte). Se midió el 2026-11-18 abriendo el login en una pestaña minimizada de Jarvis: a los 90 s seguía en esa
// página. Renovarla sin un clic sería que una herramienta tocara el botón de Google por Miguel, y eso no se hace.
//
//   - `session check` (lo corre Cockpit cada 10 min): si faltan menos de 60 min, o ya venció, un aviso de macOS —a lo
//     sumo uno por hora— que al tocarlo abre `cockpit://session/login`.
//   - `session login` (lo que abre ese enlace): `playground login`, el de siempre, en el navegador. Un clic en Google.
//
// Con Cockpit cerrado nadie avisa: lo agendado que necesita la sesión falla con «sin sesión».

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"creditop/my-tools/lib/notice"
)

const (
	warnBefore   = 60 * time.Minute
	noticeEvery  = time.Hour
	sessionLogin = "cockpit://session/login"
)

func session(args []string) int {
	if len(args) == 0 {
		args = []string{"status"}
	}
	switch args[0] {
	case "status":
		exp, email, err := sessionExpiry()
		if err != nil {
			fmt.Println("playground:", err)
			return 1
		}
		if left := time.Until(exp); left > 0 {
			fmt.Printf("playground: sesión de %s, vence a las %s (en %s)\n", email, exp.Format("15:04"), left.Round(time.Minute))
			return 0
		}
		fmt.Printf("playground: la sesión de %s venció a las %s\n", email, exp.Format("15:04"))
		return 1
	case "check":
		return sessionCheck(len(args) > 1 && args[1] == "--force")
	case "login":
		cmd := exec.Command("playground", "login")
		cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
		if err := cmd.Run(); err != nil {
			fmt.Fprintln(os.Stderr, "playground login:", err)
			return 1
		}
		return 0
	}
	fmt.Fprintln(os.Stderr, "uso: bin/cockpit session [status | check [--force] | login]")
	return 2
}

// sessionExpiry lee el vencimiento del token guardado (el `exp` del JWT, sin verificar la firma: sólo para saber cuándo).
func sessionExpiry() (time.Time, string, error) {
	home, _ := os.UserHomeDir()
	raw, err := os.ReadFile(filepath.Join(home, ".config", "creditop-playground", "token.json"))
	if err != nil {
		return time.Time{}, "", errors.New("sin sesión (`playground login`)")
	}
	var saved struct {
		Token string `json:"token"`
	}
	if json.Unmarshal(raw, &saved) != nil {
		return time.Time{}, "", errors.New("el archivo de la sesión no se puede leer")
	}
	parts := strings.Split(saved.Token, ".")
	if len(parts) != 3 {
		return time.Time{}, "", errors.New("la sesión guardada no es un token")
	}
	body, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return time.Time{}, "", err
	}
	var claims struct {
		Exp   int64  `json:"exp"`
		Email string `json:"email"`
	}
	if json.Unmarshal(body, &claims) != nil || claims.Exp == 0 {
		return time.Time{}, "", errors.New("la sesión no dice cuándo vence")
	}
	return time.Unix(claims.Exp, 0), claims.Email, nil
}

// sessionCheck: avisa si la sesión vence en menos de una hora o ya venció. Con force avisa igual (para probarlo).
func sessionCheck(force bool) int {
	stamp := time.Now().Format("15:04:05")
	exp, _, err := sessionExpiry()
	left := time.Until(exp)
	if err == nil && left > warnBefore && !force {
		fmt.Printf("%s vigente hasta las %s\n", stamp, exp.Format("15:04"))
		return 0
	}
	title, body := "Tu sesión del playground venció", "Tocá para entrar de nuevo. Sin ella, lo agendado (la daily, Sentinel, Knowledge) queda en pausa."
	if err == nil && left > 0 {
		title, body = "Tu sesión del playground vence a las "+exp.Format("15:04"), "Tocá para entrar de nuevo y que lo agendado siga andando."
	}
	home, _ := os.UserHomeDir()
	mark := filepath.Join(home, ".config", "creditop-cockpit", "session-notice")
	if fi, statErr := os.Stat(mark); statErr == nil && time.Since(fi.ModTime()) < noticeEvery && !force {
		fmt.Printf("%s %s (ya se avisó hace menos de una hora)\n", stamp, strings.ToLower(title[:1])+title[1:])
		return 1
	}
	via, sendErr := notice.Send(notice.Notice{Title: title, Body: body, URL: sessionLogin, Group: "playground-session"})
	if sendErr != nil {
		fmt.Printf("%s no se pudo avisar: %v\n", stamp, sendErr)
		return 1
	}
	_ = os.MkdirAll(filepath.Dir(mark), 0o700)
	_ = os.WriteFile(mark, nil, 0o600)
	fmt.Printf("%s avisado (%s): %s\n", stamp, via, title)
	return 1
}
