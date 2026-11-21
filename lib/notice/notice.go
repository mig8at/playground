// Package notice es el ÚNICO camino de un aviso de my-tools (2026-11-21, decisión de Miguel: «que las notificaciones
// sean manejadas por cockpit»). Cada herramienta decide QUÉ merece un aviso; este paquete decide CÓMO llega:
//
//  1. El silencio, en un solo lugar (settings.go): «no molestar» general, una pausa y un nivel por herramienta
//     (todos · sólo importantes · ninguno). Lo edita Cockpit (engranaje → Avisos) o `bin/cockpit mute`.
//  2. La bandeja (store.go): cada aviso, salga o se calle, queda en disco. Cockpit la muestra en su campana; un aviso
//     que no viste no se pierde.
//  3. La salida (deliver.go): el avisador de Cockpit («Cockpit», ~/Applications/Cockpit Avisos.app, que abre el
//     enlace `cockpit://` al tocarlo); mientras macOS no le dio permiso, el viejo del chat; y si no, osascript.
//
// Todo vive en archivos, no en la ventana de Cockpit: Sentinel, Correo, Knowledge, Wally y la daily corren de fondo
// con Cockpit cerrado, y sus avisos tienen que salir igual. Un test (guard_test.go) falla si otro paquete llama a un
// avisador por su cuenta.
package notice

import (
	"net/url"
	"strings"
	"time"
)

// Notice: el aviso.
type Notice struct {
	// App: la herramienta que avisa, con el id de Cockpit (sentinel, correo, chat…). Si falta, sale de la URL.
	App         string
	Title, Body string
	URL         string // `cockpit://<app>/#/<ruta>`: lo que abre tocarlo
	Group       string // junta los avisos de una misma cosa en el Centro de Notificaciones
	// Replace: el aviso nuevo de un grupo REEMPLAZA al anterior en vez de apilarse (una alerta que se repite, el
	// estado de una corrida). El chat no lo usa: dos mensajes son dos avisos.
	Replace bool
	// Important: pasa el nivel «sólo importantes» y, si así está puesto, el «no molestar» (una alerta, una mención).
	Important bool
	Sound     bool
}

// Send aplica el silencio, lo manda y lo deja en la bandeja. Devuelve por dónde salió («avisador de Cockpit»,
// «osascript»…) o, si se calló, «callado: <motivo>» sin error.
func Send(n Notice) (string, error) {
	n.App = appOf(n)
	now := time.Now()
	rec := Record{ID: newID(now), At: now.UTC().Format(time.RFC3339), App: n.App, Title: n.Title, Body: n.Body, URL: n.URL,
		Group: n.Group, Important: n.Important, Sound: n.Sound}
	if why := ReadSettings().Silences(n, now); why != "" {
		rec.Silenced = why
		_ = appendRecord(rec)
		return "callado: " + why, nil
	}
	via, err := deliver(n)
	rec.Via = via
	if err != nil {
		rec.Error = err.Error()
	} else {
		rec.Delivered = true
	}
	_ = appendRecord(rec)
	return via, err
}

// appOf: la herramienta, dicha o leída del enlace (`cockpit://sentinel/#/…` → sentinel).
func appOf(n Notice) string {
	if n.App != "" {
		return strings.ToLower(n.App)
	}
	if u, err := url.Parse(n.URL); err == nil && u.Scheme == "cockpit" && u.Host != "" {
		return strings.ToLower(u.Host)
	}
	return "my-tools"
}
