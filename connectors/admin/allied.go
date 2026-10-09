package admin

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// AutoPrefix es el nombre con que empieza todo comercio que crea la automatización. El borrado (en el harness, con permisos
// angostos) reconoce sólo eso: por eso el alta lo exige.
const AutoPrefix = "PRUEBA AUTO"

// onePixelPNG es un PNG válido de 1×1: el admin exige una imagen y no importa cuál.
var onePixelPNG, _ = base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")

// AutoName es `PRUEBA AUTO 1002-130512`: único por segundo, legible y con el prefijo.
func AutoName(now time.Time) string {
	return fmt.Sprintf("%s %02d%02d-%02d%02d%02d", AutoPrefix, int(now.Month()), now.Day(), now.Hour(), now.Minute(), now.Second())
}

// AlliedPlan es lo que se mandaría al formulario de alta.
type AlliedPlan struct {
	Name       string `json:"name"`
	TypeID     int    `json:"allied_type_id"`
	IndustryID int    `json:"allied_industry_id"`
	CountryID  int    `json:"country_id"`
	Price      int    `json:"price"`
	ActingAs   string `json:"acting_as"`
}

// AlliedOptions es lo que el usuario pidió; cero es «el que haya» (o Colombia, para el país).
type AlliedOptions struct {
	Name                          string
	TypeID, IndustryID, CountryID int
	Price                         int
}

// PickOption elige el id de un selector. Las opciones llegan de dos formas, `{id, name}` y `{value, title}` (los selectores
// de Vuetify, como el país): se leen las dos. Pide `wanted` si hay; si no, `preferred` si existe; si no, la primera.
func PickOption(options any, wanted, preferred int) (int, error) {
	list, _ := options.([]any)
	var ids []int
	for _, o := range list {
		m, ok := o.(map[string]any)
		if !ok {
			continue
		}
		for _, k := range []string{"id", "value"} {
			if f, ok := m[k].(float64); ok {
				ids = append(ids, int(f))
				break
			}
		}
	}
	if len(ids) == 0 {
		return 0, errors.New("el formulario del admin no trajo opciones para un campo obligatorio")
	}
	has := func(n int) bool {
		for _, id := range ids {
			if id == n {
				return true
			}
		}
		return false
	}
	if wanted != 0 {
		if !has(wanted) {
			return 0, fmt.Errorf("la opción %d no existe en el formulario (hay: %v)", wanted, ids)
		}
		return wanted, nil
	}
	if preferred != 0 && has(preferred) {
		return preferred, nil
	}
	return ids[0], nil
}

// PlanAllied lee el formulario de alta (sólo lee) y arma lo que se mandaría.
func (c *Client) PlanAllied(ctx context.Context, o AlliedOptions) (*AlliedPlan, error) {
	name := o.Name
	if name == "" {
		name = AutoName(time.Now())
	}
	if !strings.HasPrefix(name, AutoPrefix) {
		return nil, fmt.Errorf("el nombre del comercio de prueba tiene que empezar por %q: es lo que permite borrarlo después sin riesgo", AutoPrefix)
	}
	form, err := c.Get(ctx, "/aliados/crear")
	if err != nil {
		return nil, err
	}
	var settings map[string]any
	if form.Page != nil {
		settings, _ = form.Page.Props["settings"].(map[string]any)
	}
	if settings == nil {
		return nil, fmt.Errorf("el formulario de alta no trajo sus opciones (HTTP %d, ¿cambió la pantalla?)", form.Status)
	}
	p := &AlliedPlan{Name: name, Price: o.Price, ActingAs: c.ActingAs()}
	if p.Price == 0 {
		p.Price = 1_000_000
	}
	if p.TypeID, err = PickOption(settings["alliedTypes"], o.TypeID, 0); err != nil {
		return nil, err
	}
	if p.IndustryID, err = PickOption(settings["alliedIndustries"], o.IndustryID, 0); err != nil {
		return nil, err
	}
	if p.CountryID, err = PickOption(settings["countries"], o.CountryID, 47); err != nil {
		return nil, err
	}
	return p, nil
}

// Flash es lo que el admin muestra tras el alta del asesor de prueba y qué pasó con su cuenta de Cognito.
type Flash struct {
	Created       bool     `json:"created"`
	Existed       bool     `json:"existed"`
	Cognito       string   `json:"cognito"` // created · already_exists · skipped · failed
	Email         string   `json:"email,omitempty"`
	PasswordFixed bool     `json:"password_fixed"`
	BranchName    string   `json:"branch_name,omitempty"`
	Notes         []string `json:"notes,omitempty"`
}

// FlashOf lee el flash de las props de la página; nil si no hay.
func FlashOf(props map[string]any) *Flash {
	m, ok := props["testAdvisor"].(map[string]any)
	if !ok {
		return nil
	}
	f := &Flash{}
	f.Created, _ = m["created"].(bool)
	f.Existed, _ = m["existed"].(bool)
	f.Cognito, _ = m["cognito"].(string)
	f.Email, _ = m["email"].(string)
	f.PasswordFixed, _ = m["passwordFixed"].(bool)
	f.BranchName, _ = m["branchName"].(string)
	if notes, ok := m["notes"].([]any); ok {
		for _, n := range notes {
			f.Notes = append(f.Notes, fmt.Sprint(n))
		}
	}
	return f
}

// Created es el resultado del alta.
type Created struct {
	ID        int           `json:"id"`
	Name      string        `json:"name"`
	Flash     *Flash        `json:"flash,omitempty"`
	ElapsedMs int64         `json:"elapsed_ms"`
	Elapsed   time.Duration `json:"-"`
}

var alliedQuery = regexp.MustCompile(`/aliados/(\d+)(?:/|$)`)

// AlliedIDFromLocation saca el id del comercio de la redirección del alta: `…/aliados?allied=349` o `…/aliados/349/…`.
func AlliedIDFromLocation(location string) (int, bool) {
	u, err := url.Parse(location)
	if err != nil {
		return 0, false
	}
	if q := u.Query().Get("allied"); q != "" {
		if n, err := strconv.Atoi(q); err == nil {
			return n, true
		}
		return 0, false
	}
	if m := alliedQuery.FindStringSubmatch(u.Path); m != nil {
		n, _ := strconv.Atoi(m[1])
		return n, true
	}
	return 0, false
}

func errorsOf(p *Page) string {
	if p == nil {
		return ""
	}
	e, _ := p.Props["errors"].(map[string]any)
	var parts []string
	for k, v := range e {
		parts = append(parts, fmt.Sprintf("%s: %v", k, v))
	}
	return strings.Join(parts, " · ")
}

// CreateAllied manda el alta por el formulario real del admin y devuelve lo que el admin mostró. ESCRIBE: en dev, en la base
// compartida con qa y staging, y sube una imagen al bucket del admin. Lo llama quien ya mostró el plan y recibió `--apply`.
func (c *Client) CreateAllied(ctx context.Context, p *AlliedPlan) (*Created, error) {
	started := time.Now()
	fields := [][2]string{
		{"name", p.Name},
		{"description", "Comercio de prueba creado por la automatización del harness"},
		{"allied_type_id", strconv.Itoa(p.TypeID)},
		{"allied_industry_id", strconv.Itoa(p.IndustryID)},
		{"country_id", strconv.Itoa(p.CountryID)},
		{"price", strconv.Itoa(p.Price)},
	}
	r, err := c.PostMultipart(ctx, "/aliados", "/aliados/crear", fields, []File{{Field: "image", Name: "prueba.png", ContentType: "image/png", Data: onePixelPNG}})
	if err != nil {
		return nil, err
	}
	if r.Status == 419 {
		return nil, errors.New("el admin rechazó el token CSRF (HTTP 419): la sesión caducó o la cookie XSRF no viajó")
	}
	if r.Location == "" {
		return nil, fmt.Errorf("el alta no redirigió (HTTP %d): el admin no la aceptó", r.Status)
	}
	// Si volvió al formulario, hubo errores de validación: están en la página a la que redirige.
	if strings.Contains(r.Location, "/aliados/crear") {
		back, err := c.Follow(ctx, r.Location)
		if err != nil {
			return nil, err
		}
		detail := errorsOf(back.Page)
		if detail == "" {
			detail = "sin detalle"
		}
		return nil, fmt.Errorf("el admin rechazó el formulario: %s", detail)
	}
	id, ok := AlliedIDFromLocation(r.Location)
	if !ok {
		return nil, fmt.Errorf("el alta redirigió a %s y no pude sacar el id del comercio", r.Location)
	}
	// El flash vive en la sesión y sale en la página a la que redirige el alta, una sola vez.
	landing, err := c.Follow(ctx, r.Location)
	if err != nil {
		return nil, err
	}
	out := &Created{ID: id, Name: p.Name, Elapsed: time.Since(started)}
	out.ElapsedMs = out.Elapsed.Milliseconds()
	if landing.Page != nil {
		out.Flash = FlashOf(landing.Page.Props)
	}
	return out, nil
}

// AdvisorPlan es lo que se sabe del asesor de prueba de un comercio YA existente antes de tocar nada: la tarjeta «Usuario de
// prueba» del admin (`alliedTestAdvisor`), que sólo se le muestra a un perfil Administrador.
type AdvisorPlan struct {
	AlliedID int            `json:"allied_id"`
	ActingAs string         `json:"acting_as"`
	Summary  map[string]any `json:"summary"`
}

// PlanTestAdvisor lee (sólo lee) el estado del asesor de prueba de un comercio, desde una página del admin que lleva el comercio
// en la ruta. Un `alliedTestAdvisor` nulo quiere decir que la sesión no es de un Administrador: el alta se rechazaría igual.
func (c *Client) PlanTestAdvisor(ctx context.Context, alliedID int) (*AdvisorPlan, error) {
	// Primero la sesión: con una vencida el admin no contesta la página del comercio y el error culparía al comercio.
	if who, err := c.Probe(ctx); err != nil || who == "" {
		return nil, fmt.Errorf("la sesión guardada del admin no sirve (%v): entrá con `pg admin login --target <ambiente>`", errOr(err, "el admin manda al login"))
	}
	r, err := c.Get(ctx, fmt.Sprintf("/aliados/%d/usuarios", alliedID))
	if err != nil {
		return nil, err
	}
	if r.Page == nil {
		return nil, fmt.Errorf("el admin no devolvió la página del comercio %d (HTTP %d): ¿existe en este ambiente?", alliedID, r.Status)
	}
	summary, _ := r.Page.Props["alliedTestAdvisor"].(map[string]any)
	if summary == nil {
		return nil, fmt.Errorf("el admin no muestra el usuario de prueba a %s: hace falta una sesión con perfil Administrador", c.ActingAs())
	}
	return &AdvisorPlan{AlliedID: alliedID, ActingAs: c.ActingAs(), Summary: summary}, nil
}

// CreateTestAdvisor aprieta «crear usuario de prueba» en la ficha del comercio: el admin crea la sucursal de prueba
// (`b<hash>-fake`) y el asesor (`c<hash>-fake@`) si faltan, y su cuenta de Cognito. Es idempotente. ESCRIBE: en dev, en la base
// compartida con qa y staging, y en el pool de comercios. Lo llama quien ya mostró el plan y recibió `--apply`.
func (c *Client) CreateTestAdvisor(ctx context.Context, alliedID int) (*Flash, error) {
	page := fmt.Sprintf("/aliados/%d/usuarios", alliedID)
	r, err := c.PostForm(ctx, fmt.Sprintf("/aliados/%d/usuario-de-prueba", alliedID), page, url.Values{})
	if err != nil {
		return nil, err
	}
	if r.Status == 419 {
		return nil, errors.New("el admin rechazó el token CSRF (HTTP 419): la sesión caducó o la cookie XSRF no viajó")
	}
	if r.Status == 403 {
		return nil, errors.New("el admin no lo permite (HTTP 403): hace falta una sesión con perfil Administrador")
	}
	if r.Location == "" {
		return nil, fmt.Errorf("el admin no redirigió (HTTP %d): no aceptó el pedido", r.Status)
	}
	// El resultado (con la clave, una sola vez) viaja en el flash de la página a la que vuelve.
	back, err := c.Follow(ctx, r.Location)
	if err != nil {
		return nil, err
	}
	if back.Page == nil {
		return nil, fmt.Errorf("después de crear, el admin no devolvió una página (HTTP %d)", back.Status)
	}
	f := FlashOf(back.Page.Props)
	if f == nil {
		return nil, errors.New("el admin no mostró el resultado del usuario de prueba (¿versión sin la función?)")
	}
	return f, nil
}

func errOr(err error, fallback string) string {
	if err != nil {
		return err.Error()
	}
	return fallback
}
