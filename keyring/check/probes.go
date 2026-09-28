package check

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"creditop/playground/connectors/atlassian"
	"creditop/playground/connectors/canon"
	"creditop/playground/connectors/env"
	"creditop/playground/connectors/events"
	"creditop/playground/connectors/figma"
	"creditop/playground/connectors/gemini"
	"creditop/playground/connectors/jev"
	"creditop/playground/connectors/logs"
	"creditop/playground/connectors/slack"
	sqlc "creditop/playground/connectors/sql"
	"creditop/playground/connectors/twilio"
)

var targets = []string{"local", "dev", "qa", "staging", "prod"}

// ── red ─────────────────────────────────────────────────────────────────────────────────────────────

// vpnHosts son los nombres internos que sólo resuelven con la VPN. ⚠ Con la VPN de PROD,
// `*.inertia-develop` también resuelve, pero a otra red (172.32.x) donde todo parece caído: por eso la
// fila de dev mira la red, no sólo que resuelva.
var vpnHosts = []struct {
	name, host, port, wantPrefix string
}{
	{"VPN dev", "self-manager-api.inertia-develop", "8082", "10."},
	{"VPN prod", "legacy-backend.inertia-production", "80", ""},
}

func probeVPN(ctx context.Context) []Check {
	var out []Check
	for _, h := range vpnHosts {
		start := time.Now()
		c := Check{Name: h.name}
		addrs, err := net.DefaultResolver.LookupHost(ctx, h.host)
		switch {
		case err != nil:
			c.State, c.Detail = Off, h.host+" no resuelve: sin esa VPN"
		case h.wantPrefix != "" && !strings.HasPrefix(addrs[0], h.wantPrefix):
			c.State, c.Detail = Fail, fmt.Sprintf("%s resuelve a %s, fuera de %sx: ¿VPN de prod en vez de la de dev?", h.host, addrs[0], h.wantPrefix)
		default:
			d := net.Dialer{Timeout: 4 * time.Second}
			conn, derr := d.DialContext(ctx, "tcp", net.JoinHostPort(addrs[0], h.port))
			if derr != nil {
				c.State, c.Detail = Fail, fmt.Sprintf("%s → %s, pero no conecta al %s", h.host, addrs[0], h.port)
			} else {
				conn.Close()
				c.State, c.Detail = OK, fmt.Sprintf("%s → %s", h.host, addrs[0])
			}
		}
		c.Millis = time.Since(start).Milliseconds()
		out = append(out, c)
	}
	return out
}

// ── aws ─────────────────────────────────────────────────────────────────────────────────────────────

// probeAWS pregunta por cada perfil quién es (`sts get-caller-identity`) y cuándo vencen sus credenciales
// (`configure export-credentials`, que sirve igual para SSO, `aws login` o un rol asumido). De esta
// última sólo se lee `Expiration`: las llaves no salen de la función.
func probeAWS(ctx context.Context) []Check {
	if _, err := exec.LookPath("aws"); err != nil {
		return []Check{{Name: "aws", State: Fail, Detail: "no está instalado el CLI de AWS"}}
	}
	raw, err := exec.CommandContext(ctx, "aws", "configure", "list-profiles").Output()
	if err != nil {
		return []Check{{Name: "aws", State: Fail, Detail: "no se pudieron listar los perfiles: " + firstLine(err.Error())}}
	}
	profiles := strings.Fields(string(raw))
	if len(profiles) == 0 {
		return []Check{{Name: "aws", State: Fail, Detail: "no hay perfiles: `aws configure sso` o `aws login`"}}
	}
	out := make([]Check, len(profiles))
	done := make(chan struct{}, len(profiles))
	for i, p := range profiles {
		go func(i int, p string) {
			out[i] = awsProfile(ctx, p)
			done <- struct{}{}
		}(i, p)
	}
	for range profiles {
		<-done
	}
	return out
}

func awsProfile(ctx context.Context, profile string) Check {
	start := time.Now()
	c := Check{Name: "perfil " + profile}
	cmd := exec.CommandContext(ctx, "aws", "sts", "get-caller-identity", "--profile", profile, "--output", "json")
	var stderr strings.Builder
	cmd.Stderr = &stderr
	raw, err := cmd.Output()
	if err != nil {
		c.State, c.Detail = Fail, awsReason(stderr.String(), err)
		c.Millis = time.Since(start).Milliseconds()
		return c
	}
	var id struct{ Account, Arn string }
	_ = json.Unmarshal(raw, &id)
	c.State, c.Detail = OK, fmt.Sprintf("cuenta %s · %s", id.Account, shortArn(id.Arn))
	if exp, ok := awsExpiration(ctx, profile); ok {
		c.Expires = &exp
	} else if at, ok := pastedAt(profile); ok {
		// Las credenciales copiadas del portal de SSO no dicen cuándo vencen: lo fija el permission set.
		c.Detail += " · pegadas a mano el " + at.Format("02/01 15:04") + ", sin vencimiento declarado"
	}
	c.Millis = time.Since(start).Milliseconds()
	return c
}

func awsExpiration(ctx context.Context, profile string) (time.Time, bool) {
	raw, err := exec.CommandContext(ctx, "aws", "configure", "export-credentials", "--profile", profile, "--format", "process").Output()
	if err != nil {
		return time.Time{}, false
	}
	var creds struct{ Expiration string }
	if json.Unmarshal(raw, &creds) != nil || creds.Expiration == "" {
		return time.Time{}, false
	}
	t, err := time.Parse(time.RFC3339, creds.Expiration)
	return t, err == nil
}

// pastedAt dice si el perfil tiene credenciales TEMPORALES escritas en ~/.aws/credentials (las que da
// el portal de SSO) y desde cuándo. Sólo mira que la clave exista: el valor no se lee.
func pastedAt(profile string) (time.Time, bool) {
	home, err := os.UserHomeDir()
	if err != nil {
		return time.Time{}, false
	}
	path := filepath.Join(home, ".aws", "credentials")
	raw, err := os.ReadFile(path)
	if err != nil {
		return time.Time{}, false
	}
	section := ""
	for _, line := range strings.Split(string(raw), "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "[") && strings.HasSuffix(line, "]") {
			section = strings.Trim(line, "[] ")
			continue
		}
		if section == profile && strings.HasPrefix(line, "aws_session_token") {
			info, err := os.Stat(path)
			if err != nil {
				return time.Time{}, false
			}
			return info.ModTime(), true
		}
	}
	return time.Time{}, false
}

func awsReason(stderr string, err error) string {
	s := strings.TrimSpace(stderr)
	switch {
	case strings.Contains(s, "Token has expired"), strings.Contains(s, "expired"):
		return "la sesión venció: `aws sso login` (o `aws login`)"
	case strings.Contains(s, "Unable to locate credentials"), strings.Contains(s, "could not be found"):
		return "sin credenciales: `aws sso login` (o `aws login`)"
	case s != "":
		return firstLine(s)
	}
	return firstLine(err.Error())
}

// shortArn deja el rol y la persona: `arn:aws:sts::1234:assumed-role/Rol/persona` → `Rol/persona`.
func shortArn(arn string) string {
	if i := strings.Index(arn, "assumed-role/"); i >= 0 {
		return arn[i+len("assumed-role/"):]
	}
	if i := strings.LastIndex(arn, ":"); i >= 0 {
		return arn[i+1:]
	}
	return arn
}

// ── bases ───────────────────────────────────────────────────────────────────────────────────────────

func probeSQL(ctx context.Context, target string) Check {
	c := Check{Name: target}
	cfg, _, err := sqlc.LoadConfig(target)
	if err != nil {
		c.State, c.Detail = Fail, firstLine(err.Error())
		return c
	}
	if cfg.Host == "" && (cfg.RedashURL == "" || cfg.RedashToken == "") {
		c.State, c.Detail = Fail, "sin credenciales en connectors/.env."+target+" (E2E_DB_* o REDASH_*)"
		return c
	}
	src, err := sqlc.Open(cfg)
	if err != nil {
		c.State, c.Detail = Fail, firstLine(err.Error())
		if strings.Contains(err.Error(), "tcp 10.") && strings.Contains(err.Error(), "timeout") {
			c.Detail += " · la base está en la red de dev: ¿VPN de dev?"
		}
		return c
	}
	defer src.Close()
	if _, err := src.Rows("SELECT 1"); err != nil {
		c.State, c.Detail = Fail, src.Name()+": "+firstLine(err.Error())
		return c
	}
	c.State, c.Detail = OK, src.Name()
	return c
}

// ── logs ────────────────────────────────────────────────────────────────────────────────────────────

func probeLogs(ctx context.Context, target string) Check {
	c := Check{Name: target}
	cfg, _, err := logs.LoadConfig(target)
	if err != nil {
		c.State, c.Detail = Fail, firstLine(err.Error())
		return c
	}
	if why := cfg.Missing(); why != "" {
		c.State, c.Detail = Fail, firstLine(why)
		if target == "local" {
			c.State = Off
		}
		return c
	}
	status, body, err := logs.New(cfg, 10*time.Second).API("labels", url.Values{})
	switch {
	case err != nil:
		c.State, c.Detail = Fail, firstLine(err.Error())
	case status != 200:
		c.State, c.Detail = Fail, fmt.Sprintf("HTTP %d: %s", status, clip(string(body), 90))
	default:
		c.State, c.Detail = OK, host(cfg.URL)
	}
	return c
}

// ── eventos ─────────────────────────────────────────────────────────────────────────────────────────

func probeEvents(ctx context.Context, target string) Check {
	c := Check{Name: target}
	cfg, _, err := events.LoadConfig(target)
	if err != nil {
		c.State, c.Detail = Fail, firstLine(err.Error())
		return c
	}
	if why := cfg.Missing(); why != "" {
		c.State, c.Detail = Fail, clip(why, 110)
		if target == "local" || target == "dev" {
			c.State = Off
		}
		return c
	}
	if _, _, err := events.New(cfg, 10*time.Second).HogQL("SELECT 1"); err != nil {
		c.State, c.Detail = Fail, firstLine(err.Error())
		return c
	}
	c.State, c.Detail = OK, "PostHog · "+cfg.Env
	return c
}

// ── servicios ───────────────────────────────────────────────────────────────────────────────────────

func probeAtlassian(ctx context.Context) Check {
	c := Check{Name: "jira · confluence"}
	cfg, err := atlassian.LoadConfig()
	if err != nil {
		c.State, c.Detail = Fail, firstLine(err.Error())
		return c
	}
	me, err := atlassian.NewFromConfig(cfg).GetMyself(ctx)
	if err != nil {
		c.State, c.Detail = Fail, firstLine(err.Error())
		return c
	}
	c.State, c.Detail = OK, me.DisplayName
	return c
}

func probeSlack(ctx context.Context) []Check {
	cfg, err := slack.LoadConfig()
	if err != nil {
		return []Check{{Name: "slack", State: Fail, Detail: firstLine(err.Error())}}
	}
	var out []Check
	for _, t := range []struct{ name, token string }{{"slack · bot", cfg.BotToken}, {"slack · usuario", cfg.UserToken}} {
		c := Check{Name: t.name}
		if t.token == "" {
			c.State, c.Detail = Off, "sin token"
			out = append(out, c)
			continue
		}
		info, err := slack.New(t.token).AuthTest(ctx)
		if err != nil {
			c.State, c.Detail = Fail, firstLine(err.Error())
		} else {
			c.State, c.Detail = OK, info.User+" en "+info.Team
		}
		out = append(out, c)
	}
	return out
}

func probeFigma(ctx context.Context) Check {
	c := Check{Name: "figma"}
	token, err := figma.LoadToken()
	if err != nil {
		c.State, c.Detail = Fail, firstLine(err.Error())
		return c
	}
	me, err := figma.New(token).Me(ctx)
	if err != nil {
		c.State, c.Detail = Fail, firstLine(err.Error())
		return c
	}
	c.State, c.Detail = OK, me.Handle
	return c
}

func probeTwilio(ctx context.Context) Check {
	c := Check{Name: "twilio"}
	cfg, err := twilio.LoadConfig()
	if err != nil {
		c.State, c.Detail = Fail, firstLine(err.Error())
		return c
	}
	cl, err := cfg.Account()
	if err != nil {
		c.State, c.Detail = Fail, firstLine(err.Error())
		return c
	}
	accounts, err := cl.Accounts(ctx)
	if err != nil {
		c.State, c.Detail = Fail, firstLine(err.Error())
		return c
	}
	if len(accounts) == 0 {
		c.State, c.Detail = Warn, "autentica, pero no ve ninguna cuenta"
		return c
	}
	c.State, c.Detail = OK, "cuenta «"+accounts[0].FriendlyName+"»"
	return c
}

func probeGemini(ctx context.Context) Check {
	c := Check{Name: "gemini"}
	cfg, err := gemini.LoadConfig()
	if err != nil {
		c.State, c.Detail = Fail, firstLine(err.Error())
		return c
	}
	models, err := gemini.New(cfg).Models()
	if err != nil {
		c.State, c.Detail = Fail, firstLine(err.Error())
		return c
	}
	c.State, c.Detail = OK, fmt.Sprintf("%d modelos disponibles", len(models))
	return c
}

// probeJev sólo mira que el token exista: cualquier pedido a Jev gasta.
func probeJev(ctx context.Context) Check {
	c := Check{Name: "jev"}
	if _, err := jev.Token(); err != nil {
		c.State, c.Detail = Fail, firstLine(err.Error())
		return c
	}
	c.State, c.Detail = OK, "hay token (no se prueba: cada pedido gasta)"
	return c
}

func probeCanon(ctx context.Context) []Check {
	read := Check{Name: "canon · lectura"}
	if _, err := canon.FromEnv().Search(ctx, "solicitud"); err != nil {
		read.State, read.Detail = Fail, host(canon.URL())+": "+firstLine(err.Error())
	} else {
		read.State, read.Detail = OK, host(canon.URL())
	}
	write := Check{Name: "canon · escritura"}
	if _, err := canon.WriteKey(); err != nil {
		write.State, write.Detail = Off, "sin llave de escritura"
	} else {
		write.State, write.Detail = OK, "hay llave (no se prueba: escribir es una revisión)"
	}
	return []Check{read, write}
}

// ── sesiones ────────────────────────────────────────────────────────────────────────────────────────

// probeSessions lee las sesiones de asesor que guarda el harness (storageState de Playwright) y dice
// cuándo vence cada una. `_at` es el acceso, que dura poco; `_rt` es el refresco, y es el que decide si
// la sesión todavía sirve sin volver a loguearse.
func probeSessions(ctx context.Context) []Check {
	dir, err := env.Dir()
	if err != nil {
		return []Check{{Name: "harness", State: Fail, Detail: firstLine(err.Error())}}
	}
	files, _ := filepath.Glob(filepath.Join(filepath.Dir(dir), "harness", ".auth", "cognito-state*.json"))
	if len(files) == 0 {
		return []Check{{Name: "harness", State: Off, Detail: "no hay sesiones guardadas: make harness-session"}}
	}
	var out []Check
	for _, f := range files {
		name := strings.TrimSuffix(strings.TrimPrefix(filepath.Base(f), "cognito-state"), ".json")
		name = "asesor " + strings.TrimPrefix(name, ".")
		if name == "asesor " {
			name = "asesor (sin ambiente)"
		}
		out = append(out, sessionCheck(name, f))
	}
	return out
}

func sessionCheck(name, path string) Check {
	c := Check{Name: name}
	raw, err := os.ReadFile(path)
	if err != nil {
		c.State, c.Detail = Fail, firstLine(err.Error())
		return c
	}
	var state struct {
		Cookies []struct {
			Name    string  `json:"name"`
			Domain  string  `json:"domain"`
			Expires float64 `json:"expires"`
		} `json:"cookies"`
	}
	if err := json.Unmarshal(raw, &state); err != nil {
		c.State, c.Detail = Fail, "no es un storageState: "+firstLine(err.Error())
		return c
	}
	var access, refresh *time.Time
	domain := ""
	for _, ck := range state.Cookies {
		if ck.Expires <= 0 {
			continue
		}
		t := time.Unix(int64(ck.Expires), 0)
		switch ck.Name {
		case "_at":
			access, domain = &t, ck.Domain
		case "_rt":
			refresh = &t
		}
	}
	if refresh == nil {
		c.State, c.Detail = Fail, "no tiene refresco (_rt): make harness-session"
		if info, err := os.Stat(path); err == nil && time.Since(info.ModTime()) > 30*24*time.Hour {
			c.State, c.Detail = Off, "archivo sin usar desde el "+info.ModTime().Format("02/01/2006")+", sin refresco"
		}
		return c
	}
	c.State, c.Expires = OK, refresh
	c.Detail = domain
	if access != nil && time.Until(*access) <= 0 {
		c.Detail += " · el acceso venció, se renueva con el refresco"
	}
	return c
}

// ── utilidades ──────────────────────────────────────────────────────────────────────────────────────

func firstLine(s string) string {
	s = strings.TrimSpace(s)
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		s = s[:i]
	}
	return clip(s, 140)
}

func clip(s string, n int) string {
	s = strings.TrimSpace(s)
	if len([]rune(s)) <= n {
		return s
	}
	return string([]rune(s)[:n]) + "…"
}

func host(raw string) string {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return raw
	}
	return u.Host
}
