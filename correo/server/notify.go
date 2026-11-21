package main

import (
	sysnotice "creditop/my-tools/lib/notice"
	"net/mail"
	"net/url"
	"strings"

	"creditop/my-tools/connectors/gmail"
)

// notice: el aviso de un correo nuevo. «te contestó» si en esa conversación ya habías escrito vos (`t`, el estado del
// hilo), «te escribió» si es nueva. Tocarlo abre Cockpit en Correo, en ESA conversación (el hilo, con su desglose), y
// los avisos de un mismo hilo se agrupan: uno nuevo reemplaza al anterior.
func notice(w Watch, m gmail.Message, t Thread) error {
	return macNotice(noticeTitle(w, m, t), m.Subject, threadRoute(w.ID, m.ThreadID), true)
}

func noticeTitle(w Watch, m gmail.Message, t Thread) string {
	verb := "te escribió"
	if !t.LastMine.IsZero() && t.LastMine.Before(m.Date) {
		verb = "te contestó"
	}
	return w.Name + " · " + sender(m.From) + " " + verb
}

func threadRoute(watch, thread string) string {
	return "#/w/" + url.PathEscape(watch) + "/" + url.PathEscape(thread)
}

// sender: el nombre del remitente tal como viene (lo de antes de «<…>»; el parser de direcciones tira lo que va entre
// paréntesis, y «Patrick Elder (Shopify)» quedaba sin «Shopify»), o su dirección si no trae nombre.
func sender(from string) string {
	if i := strings.Index(from, "<"); i > 0 {
		if name := strings.Trim(strings.TrimSpace(from[:i]), `"`); name != "" {
			return name
		}
	}
	if a, err := mail.ParseAddress(from); err == nil {
		if a.Name != "" {
			return a.Name
		}
		return a.Address
	}
	return from
}

// macNotice: el aviso, por lib/notice (Cockpit decide el silencio y lo guarda en su bandeja). Tocarlo abre el hilo
// en Correo; uno nuevo del mismo hilo reemplaza al anterior. Un correo de quien seguís es importante: para eso existe.
func macNotice(title, body, route string, sound bool) error {
	group := "creditop-correo"
	if i := strings.LastIndex(route, "/"); i >= 0 && i < len(route)-1 {
		group += "-" + route[i+1:] // uno por conversación
	}
	_, err := sysnotice.Send(sysnotice.Notice{App: "correo", Title: title, Body: body, URL: "cockpit://correo/" + route,
		Group: group, Replace: true, Important: true, Sound: sound})
	return err
}
