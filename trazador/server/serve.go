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
	"sort"
	"strconv"
	"strings"
	"time"
)

// targetsPermitidos: la lista blanca. El target llega por query string, y sin lista blanca sería una
// forma de hacer que el server lea un `.env` arbitrario del disco.
var targetsPermitidos = map[string]bool{"prod": true, "staging": true, "qa": true, "dev": true, "local": true}

func servir(addr string) error {
	mux := http.NewServeMux()
	registrarFlowImport(mux)

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
		// EL CHEQUEO VIAJA CON EL MAPA. Un chequeo que sólo vive en un comando es un chequeo que nadie
		// corre —le pasó a `-validar`, que pide corpus— y un mapa que dejó de resolver produce un
		// diagnóstico PROLIJO Y EQUIVOCADO, que es el peor modo de falla de esta herramienta. Se manda
		// siempre y la vista decide si molestar; el de tablas queda afuera porque exige una fuente y
		// esto responde en cada carga de la página.
		out := struct {
			Version    string           `json:"version"`
			SubVersion string           `json:"subVersion"`
			Nota       string           `json:"nota"`
			Etapas     []etapaUI        `json:"etapas"`
			Ramales    []*RamalDef      `json:"ramales"`
			Chequeo    []map[string]any `json:"chequeo"`
		}{Version: m.Version, SubVersion: sub.Version, Nota: m.Nota, Ramales: m.Ramales,
			Chequeo: ParaLaUI(ChequeoDelMapa(nil))}
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
			UReq       int64  `json:"ureq"`
			PersonaKey string `json:"personaKey,omitempty"`
			Fecha      string `json:"fecha"` // el día, para agrupar los chips
			Hora       string `json:"hora"`
			Estado     int    `json:"estado"`
			EstadoN    string `json:"estadoN"`
			Lender     string `json:"lender"`
			Comercio   string `json:"comercio"`
			Desenlace  string `json:"desenlace"`
			Directa    bool   `json:"directa"` // la trajo la búsqueda literal, no la expansión a la persona
		}
		type persona struct {
			Key       string `json:"personaKey"`
			Documento string `json:"documento,omitempty"`
			Telefono  string `json:"telefono,omitempty"`
		}
		out := struct {
			Target   string    `json:"target"`
			Fuente   string    `json:"fuente"`
			Como     []string  `json:"como"`
			Historia Historia  `json:"historia"`
			Personas []persona `json:"personas"`
			Items    []item    `json:"items"`
		}{Target: target, Fuente: fuente.Name(), Como: como, Historia: armarHistoria(cs)}
		personas := map[string]bool{}
		for _, x := range cs {
			l := x.Creada.Local()
			personaKey := clavePersona(target, x.UserID)
			if personaKey != "" && !personas[personaKey] {
				personas[personaKey] = true
				out.Personas = append(out.Personas, persona{
					Key: personaKey, Documento: x.Documento, Telefono: x.Telefono,
				})
			}
			out.Items = append(out.Items, item{
				UReq: x.UReq, PersonaKey: personaKey, Fecha: l.Format("2006-01-02"), Hora: l.Format("15:04"),
				Estado: x.Estado, EstadoN: x.EstadoN, Lender: x.Lender,
				Comercio: x.Comercio, Desenlace: desenlaceDe(x.Estado), Directa: x.Directa,
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
		// solicitud, no del flujo. Esta herramienta es de operación interna y escucha sólo en localhost.
		jsonOK(w, struct {
			Traza
			Comercio       string         `json:"comercio"`
			Sucursal       string         `json:"sucursal"`
			Lender         string         `json:"lender"`
			RT             int            `json:"rt"`
			Estado         int            `json:"estado"`
			EstadoN        string         `json:"estadoN"`
			Monto          float64        `json:"monto"`
			Perfilamiento  string         `json:"perfilamiento"`
			PerfilesCupo   []perfilCupoUI `json:"perfilesCupo"`
			PersonaKey     string         `json:"personaKey,omitempty"`
			Documento      string         `json:"documento"`
			Telefono       string         `json:"telefono"`
			Origen         string         `json:"origen"`
			OrigenDerivado bool           `json:"origenDerivado"`
		}{
			Traza: t, Comercio: s.Comercio, Sucursal: s.Sucursal, Lender: s.Lender, RT: s.LenderRT,
			Estado: s.Estado, EstadoN: s.EstadoN, Monto: s.Monto,
			Perfilamiento: resumenPerfilamiento(s.Perfilamiento),
			PerfilesCupo:  perfilesCupo(s),
			PersonaKey:    clavePersona(target, s.UserID), Documento: s.Documento,
			Telefono: s.Telefono, Origen: s.Origen, OrigenDerivado: s.OrigenDerivado,
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
		return "", fmt.Errorf("target %q no permitido (prod · staging · qa · dev · local)", t)
	}
	return t, nil
}

// clavePersona es estable dentro del target y sólo sirve para reunir consultas de la misma persona en
// este navegador. La cédula queda disponible para el operador dentro de la herramienta; esta clave evita
// usarla como llave de agrupación o de IndexedDB.
func clavePersona(target string, userID int64) string {
	if userID <= 0 {
		return ""
	}
	return fmt.Sprintf("p-%s-%x", target, userID)
}

// resumenPerfilamiento es el titular de la corrida que cabe en la ficha lateral. El detalle —reglas,
// puntajes y el motivo de cada entidad— sigue en la etapa "Listado de entidades"; acá sólo se expone
// qué perfilador ordenó el listado, cuántas entidades llegó a mostrar y cuál fue la recomendada o la
// desembolsada. Sale del snapshot de BD, nunca de una inferencia de la Vue.
func resumenPerfilamiento(p *Perfilamiento) string {
	if p == nil {
		return "No llegó al perfilamiento"
	}

	var partes []string
	if p.Perfilador != "" {
		partes = append(partes, p.Perfilador)
	}
	if len(p.Mostrados) > 0 {
		partes = append(partes, fmt.Sprintf("%d entidades mostradas", len(p.Mostrados)))
	}
	if nombre := lenderDePerfilamiento(p, p.Recomendado); nombre != "" {
		partes = append(partes, "recomendada: "+nombre)
	}
	if nombre := lenderDePerfilamiento(p, p.Desembolsado); nombre != "" {
		partes = append(partes, "desembolsada: "+nombre)
	}
	if len(partes) == 0 {
		return "Sin resultado registrado"
	}
	return strings.Join(partes, " · ")
}

// perfilCupoUI es la parte de la evaluación de categorías que cabe en la ficha. No traduce ni inventa
// niveles: la categoría (por ejemplo Premium o Standard) es la que configuró cada entidad. El detalle
// de reglas, score e ingreso permanece en "Listado de entidades", donde se puede revisar sin comprimirlo.
type perfilCupoUI struct {
	Categoria string  `json:"categoria"`
	Entidad   string  `json:"entidad"`
	Cupo      float64 `json:"cupo"`
}

// perfilesCupo devuelve sólo categorías que podemos atribuir a ESTA corrida. `users_category_log` está
// ligado al usuario, no a la solicitud; por eso una fila de otro intento del mismo cliente no puede
// presentarse como su perfil actual. Una misma entidad puede registrarse más de una vez en la cascada,
// así que se deduplica y se muestra primero la entidad de la solicitud abierta.
func perfilesCupo(s *Solicitud) []perfilCupoUI {
	if s == nil {
		return []perfilCupoUI{}
	}

	perfiles := make([]perfilCupoUI, 0, len(s.Categorias))
	vistos := make(map[string]bool)
	for _, categoria := range s.Categorias {
		if categoria.Ventana != "misma" || categoria.CatID <= 0 || strings.TrimSpace(categoria.CatNombre) == "" {
			continue
		}
		entidad := strings.TrimSpace(categoria.Lender)
		if entidad == "" {
			entidad = fmt.Sprintf("entidad %d", categoria.LenderID)
		}
		perfil := perfilCupoUI{
			Categoria: strings.TrimSpace(categoria.CatNombre),
			Entidad:   entidad,
			Cupo:      categoria.Cupo,
		}
		clave := fmt.Sprintf("%d|%d|%s|%.2f", categoria.LenderID, categoria.CatID, perfil.Categoria, perfil.Cupo)
		if vistos[clave] {
			continue
		}
		vistos[clave] = true
		perfiles = append(perfiles, perfil)
	}

	sort.SliceStable(perfiles, func(i, j int) bool {
		esActualI := perfiles[i].Entidad == s.Lender && s.Lender != ""
		esActualJ := perfiles[j].Entidad == s.Lender && s.Lender != ""
		if esActualI != esActualJ {
			return esActualI
		}
		if perfiles[i].Entidad != perfiles[j].Entidad {
			return perfiles[i].Entidad < perfiles[j].Entidad
		}
		return perfiles[i].Categoria < perfiles[j].Categoria
	})
	return perfiles
}

func lenderDePerfilamiento(p *Perfilamiento, id int64) string {
	if p == nil || id <= 0 {
		return ""
	}
	for _, lender := range p.Mostrados {
		if lender.ID == id && lender.Nombre != "" {
			return lender.Nombre
		}
	}
	return ""
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
