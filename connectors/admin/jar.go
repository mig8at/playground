package admin

import (
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"
)

// jar son las cookies de una conversación con el admin: las que manda el servidor se aplican, las que borra se quitan.
// Guarda la cookie ENTERA (dominio, ruta, vencimiento) porque la sesión se guarda en disco para reusarla.
type jar struct {
	m map[string]*http.Cookie
}

func newJar() *jar { return &jar{m: map[string]*http.Cookie{}} }

// apply aplica los `Set-Cookie` de una respuesta. Un valor vacío, `Max-Age` negativo o un `Expires` pasado borra la cookie.
func (j *jar) apply(cookies []*http.Cookie, host string) {
	for _, c := range cookies {
		if c.Value == "" || c.MaxAge < 0 || (!c.Expires.IsZero() && c.Expires.Before(time.Now())) {
			delete(j.m, c.Name)
			continue
		}
		cc := *c
		if cc.Domain == "" {
			cc.Domain = host
		}
		if cc.Path == "" {
			cc.Path = "/"
		}
		j.m[cc.Name] = &cc
	}
}

func (j *jar) set(c *http.Cookie) { j.m[c.Name] = c }

// header es el valor del header `Cookie`, en orden estable.
func (j *jar) header() string {
	names := make([]string, 0, len(j.m))
	for n := range j.m {
		names = append(names, n)
	}
	sort.Strings(names)
	parts := make([]string, 0, len(names))
	for _, n := range names {
		parts = append(parts, n+"="+j.m[n].Value)
	}
	return strings.Join(parts, "; ")
}

// xsrf es el token CSRF de Laravel: viaja en la cookie `XSRF-TOKEN` (codificada) y se devuelve DECODIFICADO en
// `X-XSRF-TOKEN`; mandarlo tal cual da un 419 que no explica nada.
func (j *jar) xsrf() string {
	c, ok := j.m["XSRF-TOKEN"]
	if !ok {
		return ""
	}
	v, err := url.QueryUnescape(c.Value)
	if err != nil {
		return c.Value
	}
	return v
}
