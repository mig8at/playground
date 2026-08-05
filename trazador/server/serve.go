// serve.go — la API que consume la Vue.
//
// EL SERVER NO CALCULA NADA NUEVO. Devuelve el mismo `Traza` que ya arma `ensamblar()` y que imprime la
// consola. Si la Vue calculara estados (qué etapa falló, qué familia ganó) habría DOS definiciones de lo
// mismo y en el primer cambio empezarían a contradecirse — el problema que este repo ya tuvo con
// `veredicto()` y que por eso vive en un solo lugar.
//
// TRES ENDPOINTS, y el orden importa para que la UI se sienta rápida:
//
//	GET /api/mapa                      el árbol DECLARADO (etapas + hitos + ramales). Sin tocar ninguna
//	                                   fuente, así que responde en microsegundos: la Vue dibuja el árbol
//	                                   completo en gris antes de que exista una consulta.
//	GET /api/buscar?q=…&target=prod    cédula, teléfono o número de solicitud → lista de intentos
//	GET /api/traza?ureq=…&target=prod  la traza armada (BD + logs)
//
// ⚠ POR QUÉ `/api/mapa` VA PRIMERO: contra prod cada consulta pasa por Redash, que es asíncrono (POST job
// → polling → leer). Son segundos, no milisegundos. Si la UI esperara todo para dibujar algo, se vería
// como un spinner largo; con el mapa aparte, el árbol se pinta al instante y las etapas se van encendiendo.
//
// ⚠ ESTE SERVER ES LOCAL Y NO SE EXPONE. Habla con la BD de producción (vía Redash, auditado a nombre del
// dueño del token) y con Loki. No tiene auth a propósito: escucha en 127.0.0.1 y nada más. Ponerle auth
// daría la impresión de que se puede publicar, y no se puede.
package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// targetsPermitidos: la lista blanca. El target llega por query string, y sin lista blanca sería una
// forma de hacer que el server lea un `.env` arbitrario del disco.
var targetsPermitidos = map[string]bool{"prod": true, "staging": true, "dev": true, "local": true}

func servir(addr string) error {
	mux := http.NewServeMux()

	mux.HandleFunc("/api/mapa", func(w http.ResponseWriter, r *http.Request) {
		m, err := Cargar()
		if err != nil {
			jsonErr(w, 500, "el mapa no carga: "+err.Error())
			return
		}
		sub, err := CargarSub()
		if err != nil {
			jsonErr(w, 500, "el árbol declarado no carga: "+err.Error())
			return
		}
		// Se manda el árbol declarado tal cual, más un índice plano de etapas para que la Vue no tenga que
		// reordenar nada (el orden del flujo es una decisión del mapa, no de la vista).
		type etapaUI struct {
			ID         string       `json:"id"`
			Label      string       `json:"label"`
			Orden      int          `json:"orden"`
			Porque     string       `json:"porque,omitempty"`
			Esqueleto  bool         `json:"esqueleto"` // ¿la BD puede probarla? si no, su ausencia no prueba nada
			Bloques    []*BloqueDef `json:"bloques,omitempty"`
			Decisiones int          `json:"decisiones"`
		}
		out := struct {
			Version    string      `json:"version"`
			SubVersion string      `json:"subVersion"`
			Nota       string      `json:"nota"`
			Etapas     []etapaUI   `json:"etapas"`
			Ramales    []*RamalDef `json:"ramales"`
		}{Version: m.Version, SubVersion: sub.Version, Nota: m.Nota, Ramales: m.Ramales}
		for _, e := range m.Etapas {
			out.Etapas = append(out.Etapas, etapaUI{
				ID: e.ID, Label: e.Label, Orden: e.Orden, Porque: e.Porque,
				Esqueleto: m.TieneEsqueleto(e.ID), Bloques: sub.Bloques(e.ID),
				Decisiones: len(e.Decisiones),
			})
		}
		jsonOK(w, out)
	})

	mux.HandleFunc("/api/buscar", func(w http.ResponseWriter, r *http.Request) {
		target, err := targetDe(r)
		if err != nil {
			jsonErr(w, 400, err.Error())
			return
		}
		q := strings.TrimSpace(r.URL.Query().Get("q"))
		if q == "" {
			jsonErr(w, 400, "falta q= (cédula, teléfono o número de solicitud)")
			return
		}
		c, _ := loadConfig(target)
		fuente, err := abrirFuente(c)
		if err != nil {
			jsonErr(w, 502, "sin fuente para «"+target+"»: "+err.Error())
			return
		}
		defer fuente.Close()

		cs, como, err := Resolver(fuente, q)
		if err != nil {
			jsonErr(w, 502, err.Error())
			return
		}
		type item struct {
			UReq      int64  `json:"ureq"`
			Fecha     string `json:"fecha"`
			Estado    int    `json:"estado"`
			EstadoN   string `json:"estadoN"`
			Lender    string `json:"lender"`
			Comercio  string `json:"comercio"`
			Desenlace string `json:"desenlace"`
		}
		out := struct {
			Target string   `json:"target"`
			Fuente string   `json:"fuente"`
			Como   []string `json:"como"`
			Items  []item   `json:"items"`
		}{Target: target, Fuente: fuente.Nombre(), Como: como}
		for _, x := range cs {
			d := "en-curso"
			if sellados[x.Estado] {
				d = "aprobado"
			} else if malos[x.Estado] != "" {
				d = "roto"
			}
			out.Items = append(out.Items, item{
				UReq: x.UReq, Fecha: x.Creada.Local().Format("2006-01-02 15:04"),
				Estado: x.Estado, EstadoN: x.EstadoN, Lender: x.Lender,
				Comercio: x.Comercio, Desenlace: d,
			})
		}
		jsonOK(w, out)
	})

	mux.HandleFunc("/api/traza", func(w http.ResponseWriter, r *http.Request) {
		target, err := targetDe(r)
		if err != nil {
			jsonErr(w, 400, err.Error())
			return
		}
		ureq, err := strconv.ParseInt(r.URL.Query().Get("ureq"), 10, 64)
		if err != nil || ureq <= 0 {
			jsonErr(w, 400, "falta ureq= (un número)")
			return
		}
		t, s, err := ArmarTraza(target, ureq)
		if err != nil {
			jsonErr(w, 502, err.Error())
			return
		}
		// Se agregan los datos de cabecera que la vista necesita y que no viven en `Traza` porque son de la
		// solicitud, no del flujo. El PII va ENMASCARADO: esta API sirve datos de producción a un navegador.
		jsonOK(w, struct {
			Traza
			Comercio       string  `json:"comercio"`
			Sucursal       string  `json:"sucursal"`
			Lender         string  `json:"lender"`
			RT             int     `json:"rt"`
			Estado         int     `json:"estado"`
			EstadoN        string  `json:"estadoN"`
			Monto          float64 `json:"monto"`
			Documento      string  `json:"documento"`
			Origen         string  `json:"origen"`
			OrigenDerivado bool    `json:"origenDerivado"`
		}{
			Traza: t, Comercio: s.Comercio, Sucursal: s.Sucursal, Lender: s.Lender, RT: s.LenderRT,
			Estado: s.Estado, EstadoN: s.EstadoN, Monto: s.Monto,
			Documento: enmascararPII(s.Documento), Origen: s.Origen, OrigenDerivado: s.OrigenDerivado,
		})
	})

	mux.HandleFunc("/api/salud", func(w http.ResponseWriter, r *http.Request) {
		jsonOK(w, map[string]any{"ok": true, "ahora": time.Now().Format(time.RFC3339)})
	})

	fmt.Printf("\n  %s\n", bold("── trazador · server ──"))
	fmt.Printf("     escuchando en http://%s\n", addr)
	fmt.Printf("     %s\n", gray("GET /api/mapa · /api/buscar?q=…&target=prod · /api/traza?ureq=…&target=prod"))
	fmt.Printf("     %s\n\n", gray("solo 127.0.0.1: habla con la BD de producción vía Redash y no debe exponerse"))

	srv := &http.Server{
		Addr: addr, Handler: logueado(mux),
		ReadHeaderTimeout: 10 * time.Second,
		// Generoso a propósito: una consulta a prod pasa por la cola de Redash.
		WriteTimeout: 120 * time.Second,
	}
	return srv.ListenAndServe()
}

// logueado imprime cada llamada con su duración. En una herramienta que consulta producción, saber qué se
// consultó y cuánto tardó es la mitad del diagnóstico cuando algo va lento.
func logueado(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t0 := time.Now()
		h.ServeHTTP(w, r)
		fmt.Printf("  %s %s %s %s\n", gray(time.Now().Format("15:04:05")), r.Method,
			r.URL.RequestURI(), gray(time.Since(t0).Round(time.Millisecond).String()))
	})
}

func targetDe(r *http.Request) (string, error) {
	t := r.URL.Query().Get("target")
	if t == "" {
		t = "prod" // por ahora todo se trabaja sobre prod
	}
	if !targetsPermitidos[t] {
		return "", fmt.Errorf("target %q no permitido (prod · staging · dev · local)", t)
	}
	return t, nil
}

// enmascararPII: la API sirve datos de PRODUCCIÓN a un navegador. La cédula completa no viaja — igual que
// en la consola y en el HTML. Quien necesite el valor entero lo saca de la fuente, no de acá.
func enmascararPII(v string) string {
	if len(v) <= 6 {
		return strings.Repeat("•", len(v))
	}
	return v[:3] + strings.Repeat("*", len(v)-6) + v[len(v)-3:]
}

func jsonOK(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(v)
}

func jsonErr(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
