// Package lender es el eje LENDER del modelo [channel] → [merchant] → [lender]: a quién y cómo se
// cierra. Resuelve un prestamista desde la BD y despacha la estrategia de cierre según su tipo
// (Creditop X in-platform, cupo rotativo, Motai IMEI, Bancolombia, Credifamilia).
package lender

import (
	"creditop-tests/pkg/client"
	"creditop-tests/pkg/config"
	"creditop-tests/pkg/database"
	"creditop-tests/pkg/flow"
	"creditop-tests/pkg/mocks"
	"database/sql"
	"fmt"
	"strings"
)

// Lender describe un prestamista candidato a cerrar un flujo.
type Lender struct {
	ID, FeeNumber, InitialFee, ResponseType int
	Name                                    string
	Rate                                    float64
}

func (l Lender) withDefaults() Lender {
	if l.Rate == 0 {
		l.Rate = 2.1
	}
	if l.FeeNumber == 0 {
		l.FeeNumber = 12
	}
	if l.Name == "" {
		l.Name = fmt.Sprintf("lender#%d", l.ID)
	}
	return l
}

// Resolve busca un lender por id, slug o name aproximado. Permite `credipullman`, `160`, etc.
func Resolve(db *sql.DB, q string) (Lender, error) {
	var l Lender
	like := "%" + q + "%"
	err := db.QueryRow(`SELECT id, COALESCE(name,''), COALESCE(response_type,0)
		FROM lenders WHERE CAST(id AS CHAR) = ? OR slug LIKE ? OR name LIKE ? ORDER BY id LIMIT 1`,
		q, like, like).Scan(&l.ID, &l.Name, &l.ResponseType)
	if err != nil {
		return l, fmt.Errorf("lender %q no encontrado en BD: %w", q, err)
	}
	return l, nil
}

// List devuelve lenders activos para el catálogo del CLI.
func List(db *sql.DB, limit int) []Lender {
	rows, err := db.Query(`SELECT id, COALESCE(name,''), COALESCE(response_type,0) FROM lenders WHERE status = 1 ORDER BY id LIMIT ?`, limit)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []Lender
	for rows.Next() {
		var l Lender
		if rows.Scan(&l.ID, &l.Name, &l.ResponseType) == nil {
			out = append(out, l)
		}
	}
	return out
}

// Close despacha la estrategia de cierre según el lender y la ejecuta. Devuelve nil si el flujo cierra
// OK (típicamente Estado 11). uReqID viene de la entrada del canal. Reúsa CloseSteps (la misma lógica
// que el triplete), corriéndola inline (sin cabecera) para callers que solo necesitan el resultado.
func Close(db *sql.DB, cfg config.TestConfig, uReqID int64, l Lender) error {
	c := flow.NewCtx()
	c.Set("uReqID", uReqID)
	return flow.New("", "").Add(CloseSteps(db, cfg, l)...).RunInline(c)
}

// strategy describe cómo CIERRA un tipo de lender. Antes este dispatch estaba duplicado en tres
// lugares (CloseSteps + main.flowSummary + el override de doc en main.runOne); ahora vive en una
// SOLA tabla (`strategies`) que se consulta por `Lender.Strategy()`. Espejo del enfoque declarativo
// que usamos en frontend-e2e/pkg/composer.ts::merchantSpecs.
//
// Cada estrategia es o "monolítica" (closeFn → se expone como un único paso de alto nivel cuya
// función detalla sus sub-pasos con ↳) o "granular" (stepsFn → devuelve []flow.Step pre-armados,
// como Creditop X que se descompone en seleccion/pagaré/firma/autorización).
//
// docOverride: documento de prueba específico para activar sandbox del proveedor (Bancolombia exige
// 1998228194 para tener cupo en no-prod). Cuando está vacío se respeta el `cfg.TestDoc` por defecto.
type strategy struct {
	name        string
	matches     func(Lender) bool
	summary     string // descripción de UNA línea del cierre (lo que mostraba flowSummary)
	docOverride string // override de cfg.TestDoc cuando aplica (vacío = sin cambio)
	title       string // título del paso de alto nivel (solo si usa closeFn)
	desc        string // descripción del paso de alto nivel (solo si usa closeFn)
	closeFn     func(*sql.DB, config.TestConfig, int64, Lender) error
	stepsFn     func(*sql.DB, config.TestConfig, Lender) []flow.Step
}

// strategies — tabla declarativa. Se consulta en orden; gana el primer match. Agregar un lender
// nuevo: una entrada aquí, nada más. Si quieres detallar sub-pasos en lugar de un single step,
// usa stepsFn (como creditopXDefault).
var strategies = []strategy{
	{
		name:    "motai",
		matches: func(l Lender) bool { return l.ID == 158 || strings.Contains(strings.ToLower(l.Name), "motai") },
		summary: "Motai rt=2: IMEI + Abaco → device/disburse → Estado 11 (Autorizada)",
		title:   "Cierre Motai (IMEI + Abaco)",
		desc:    "rt=2 con colateral de dispositivo: check Abaco → select #158 → firma renting (OTP) → device/register(IMEI) → device/disburse → Estado 11.",
		closeFn: motaiClose,
	},
	{
		name:    "credifamilia",
		matches: func(l Lender) bool { return l.ID == 24 || strings.Contains(strings.ToLower(l.Name), "credifamilia") },
		summary: "Credifamilia rt=4: estudio asíncrono (radica → polling → APROBADO)",
		title:   "Cierre Credifamilia (rt=4 · async)",
		desc:    "Estudio asíncrono: radica (status 40 'En validación') → polling pre-approval-status → APROBADO (status 41). No sale a portal.",
		closeFn: credifamiliaClose,
	},
	{
		name: "bancolombia",
		matches: func(l Lender) bool {
			return l.ID == 68 || l.ID == 100 || strings.Contains(strings.ToLower(l.Name), "bancolombia")
		},
		summary:     "Bancolombia: motor de decisión PLS (BNPL #68 vs Consumo #100)",
		docOverride: "1998228194", // sandbox de Bancolombia activa cupo solo con este doc en no-prod
		title:       "Cierre Bancolombia (motor PLS)",
		desc:        "Motor de decisión multiproducto: evalúa BNPL(#68) vs Consumo(#100) y asigna el producto. El cierre real (OAuth) ocurre en el portal del banco.",
		closeFn:     bancolombiaClose,
	},
	{
		name:    "revolving",
		matches: func(l Lender) bool { return l.ResponseType == 3 },
		summary: "Cupo Rotativo rt=3: in-platform con Pagaré Maestro (reusa cupo)",
		title:   "Cierre Cupo Rotativo (rt=3)",
		desc:    "Ciclo 1: originación + Pagaré Maestro → Estado 11. Ciclo 2: nueva compra sobre el cupo (sin pagaré nuevo).",
		closeFn: revolvingClose,
	},
	{
		name:    "external",
		matches: func(l Lender) bool { return l.ResponseType == 1 },
		summary: "Externo rt=1: pre-aprobación vía integración; cierre en portal del proveedor",
		title:   "Cierre externo (rt=1 · pre-aprobación)",
		desc:    "Integración: el marketplace consulta la pre-aprobación/cupo al host del proveedor (mockeado). El cierre real es el portal externo (redirect).",
		closeFn: externalClose,
	},
}

// creditopXDefault — estrategia por defecto (rt=2 in-platform). No vive en `strategies` porque siempre
// matchea: queda separada para que el resto de la tabla represente las EXCEPCIONES al cierre estándar.
var creditopXDefault = strategy{
	name:    "creditopX",
	matches: func(Lender) bool { return true },
	summary: "Creditop X rt=2: originación in-platform hasta Estado 11 (Autorizada)",
	stepsFn: creditopXSteps,
}

// Strategy resuelve la estrategia de cierre para este lender. Es la ÚNICA función que matchea
// `l.ID == 158 || strings.Contains(name, "motai")` y similares. Todo el resto consulta esto.
func (l Lender) Strategy() strategy {
	for _, s := range strategies {
		if s.matches(l) {
			return s
		}
	}
	return creditopXDefault
}

// Summary devuelve la descripción de una línea del cierre (lo que antes hacía main.flowSummary).
func (l Lender) Summary() string { return l.Strategy().summary }

// ApplyOverrides aplica los overrides de cfg que la estrategia exige (p.ej. Bancolombia exige
// TestDoc=1998228194 para activar su sandbox). Devuelve la cfg ajustada — no muta la original.
func (l Lender) ApplyOverrides(cfg config.TestConfig) config.TestConfig {
	if d := l.Strategy().docOverride; d != "" {
		cfg.TestDoc = d
	}
	return cfg
}

// CloseSteps devuelve los pasos de cierre según el tipo de lender. Lee el user_request_id del Ctx
// ("uReqID", publicado por la entrada del canal). Creditop X (rt=2) se descompone en pasos granulares;
// las estrategias con narrativa propia (Motai/revolving/Bancolombia/externos/Credifamilia) se exponen
// como un paso de alto nivel que delega a su función (que detalla sus sub-pasos con ↳).
func CloseSteps(db *sql.DB, cfg config.TestConfig, l Lender) []flow.Step {
	l = l.withDefaults()
	s := l.Strategy()
	if s.stepsFn != nil {
		return s.stepsFn(db, cfg, l)
	}
	return []flow.Step{{
		Title: s.title, Desc: s.desc,
		Run: func(c *flow.Ctx) (string, error) {
			if err := s.closeFn(db, cfg, c.Int64("uReqID"), l); err != nil {
				return "", err
			}
			return "cierre OK", nil
		},
	}}
}

// msgOf extrae un mensaje legible de la respuesta del backend (para diagnosticar 500s).
func msgOf(r map[string]interface{}) string {
	for _, k := range []string{"message", "error", "error_code"} {
		if s, ok := r[k].(string); ok && s != "" {
			return s
		}
	}
	return ""
}

// creditopXSteps descompone el cierre in-platform Creditop X (rt=2) en pasos granulares:
// selección + perfil aprobado → pagaré → firma OTP → autorización (Estado 11).
func creditopXSteps(db *sql.DB, cfg config.TestConfig, l Lender) []flow.Step {
	return []flow.Step{
		{
			Title: "Selección de lender + perfil aprobado",
			Desc:  fmt.Sprintf("Siembra el perfil aprobado (datacrédito score 750) y fija el lender #%d (rate/cuotas/cuota inicial) en el user_request.", l.ID),
			Run: func(c *flow.Ctx) (string, error) {
				uReqID := c.Int64("uReqID")
				mocks.SeedApprovedProfile(db, cfg.TestPhone, uReqID, 750)
				if _, err := db.Exec("UPDATE user_requests SET lender_id=?, rate=?, fee_number=?, initial_fee=? WHERE id=?",
					l.ID, l.Rate, l.FeeNumber, l.InitialFee, uReqID); err != nil {
					return "", fmt.Errorf("set lender: %w", err)
				}
				return fmt.Sprintf("lender #%d seleccionado · perfil aprobado", l.ID), nil
			},
		},
		{
			Title: "Generación del pagaré (documentos)",
			Desc:  "GET promissory-note: el backend arma el pagaré/PDF del crédito (PdfMapper en modo fake en local).",
			Run: func(c *flow.Ctx) (string, error) {
				if r, err := client.Get(fmt.Sprintf("%s/loans/requests/promissory-note/%d", cfg.ApiBaseURL, c.Int64("uReqID"))); err != nil {
					return "", fmt.Errorf("promissory-note: %w · %v", err, msgOf(r))
				}
				return "pagaré generado", nil
			},
		},
		{
			Title: "Firma del pagaré (OTP)",
			Desc:  "send-otp + validación: el cliente firma el pagaré con OTP (en local, bypass).",
			Run: func(c *flow.Ctx) (string, error) {
				uReqID := c.Int64("uReqID")
				if _, err := client.Post(cfg.ApiBaseURL+"/loans/requests/promissory-note/validate/send-otp",
					map[string]interface{}{"user_request_id": uReqID}); err != nil {
					return "", fmt.Errorf("send-otp: %w", err)
				}
				c.Set("otpID", mocks.ForceOtpValidation(db, cfg.TestPhone))
				return "OTP de firma validado", nil
			},
		},
		{
			Title: "Autorización → Estado 11",
			Desc:  "authorize: autoriza el crédito; el user_request queda en Estado 11 (Autorizada) in-platform.",
			Run: func(c *flow.Ctx) (string, error) {
				uReqID := c.Int64("uReqID")
				if r, err := client.Post(cfg.ApiBaseURL+"/loans/requests/promissory-note/validate/authorize",
					map[string]interface{}{"user_request_id": uReqID, "otp_id": c.Get("otpID")}); err != nil {
					return "", fmt.Errorf("authorize: %w · %v", err, msgOf(r))
				}
				if !database.AssertRowExists(db, "user_requests", "id = ? AND user_request_status_id = 11", uReqID) {
					return "", fmt.Errorf("estado final != 11")
				}
				return fmt.Sprintf("user_request #%d → Estado 11 (Autorizada)", uReqID), nil
			},
		},
	}
}
