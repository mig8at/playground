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

// allowedTargets: la lista blanca. El target llega por query string, y sin lista blanca sería una
// forma de hacer que el server lea un `.env` arbitrario del disco.
var allowedTargets = map[string]bool{"prod": true, "staging": true, "qa": true, "dev": true, "local": true}

func runServer(addr string) error {
	mux := http.NewServeMux()
	registerFlowImport(mux)

	mux.HandleFunc("/api/mapa", func(w http.ResponseWriter, r *http.Request) {
		m, err := Load()
		if err != nil {
			jsonErr(w, 500, "el mapa no carga: "+err.Error())
			return
		}
		sub, err := LoadSub()
		if err != nil {
			jsonErr(w, 500, "el árbol declarado no carga: "+err.Error())
			return
		}
		// Se manda el árbol declarado tal cual, más un índice plano de etapas para que la Vue no tenga que
		// reordenar nada (el orden del flujo es una decisión del mapa, no de la vista).
		type uiStage struct {
			ID        string      `json:"id"`
			Label     string      `json:"label"`
			Order     int         `json:"orden"`
			Because   string      `json:"porque,omitempty"`
			Skeleton  bool        `json:"esqueleto"` // ¿la BD puede probarla? si no, su ausencia no prueba nada
			Blocks    []*BlockDef `json:"bloques,omitempty"`
			Decisions int         `json:"decisiones"`
		}
		// EL CHEQUEO VIAJA CON EL MAPA. Un chequeo que sólo vive en un comando es un chequeo que nadie
		// corre —le pasó a `-validar`, que pide corpus— y un mapa que dejó de resolver produce un
		// diagnóstico PROLIJO Y EQUIVOCADO, que es el peor modo de falla de esta herramienta. Se manda
		// siempre y la vista decide si molestar; el de tablas queda afuera porque exige una fuente y
		// esto responde en cada carga de la página.
		out := struct {
			Version    string           `json:"version"`
			SubVersion string           `json:"subVersion"`
			Note       string           `json:"nota"`
			Stages     []uiStage        `json:"etapas"`
			Lanes      []*LaneDef       `json:"ramales"`
			Check      []map[string]any `json:"chequeo"`
		}{Version: m.Version, SubVersion: sub.Version, Note: m.Note, Lanes: m.Lanes,
			Check: ForUI(MapCheck(nil))}
		for _, e := range m.Stages {
			out.Stages = append(out.Stages, uiStage{
				ID: e.ID, Label: e.Label, Order: e.Order, Because: e.Because,
				Skeleton: m.HasSkeleton(e.ID), Blocks: sub.Blocks(e.ID),
				Decisions: len(e.Decisions),
			})
		}
		jsonOK(w, out)
	})

	mux.HandleFunc("/api/buscar", func(w http.ResponseWriter, r *http.Request) {
		target, err := targetOf(r)
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
		source, err := openSource(c)
		if err != nil {
			jsonErr(w, 502, "sin fuente para «"+target+"»: "+err.Error())
			return
		}
		defer source.Close()

		cs, as, err := Resolver(source, q)
		if err != nil {
			jsonErr(w, 502, err.Error())
			return
		}
		type item struct {
			UReq      int64  `json:"ureq"`
			PersonKey string `json:"personaKey,omitempty"`
			Date      string `json:"fecha"` // el día, para agrupar los chips
			Time      string `json:"hora"`
			Status    int    `json:"estado"`
			StatusN   string `json:"estadoN"`
			Lender    string `json:"lender"`
			Merchant  string `json:"comercio"`
			Outcome   string `json:"desenlace"`
			Direct    bool   `json:"directa"` // la trajo la búsqueda literal, no la expansión a la persona
		}
		type person struct {
			Key      string `json:"personaKey"`
			Document string `json:"documento,omitempty"`
			Phone    string `json:"telefono,omitempty"`
		}
		out := struct {
			Target  string   `json:"target"`
			Source  string   `json:"fuente"`
			As      []string `json:"como"`
			History History  `json:"historia"`
			People  []person `json:"personas"`
			Items   []item   `json:"items"`
		}{Target: target, Source: source.Name(), As: as, History: buildHistory(cs)}
		people := map[string]bool{}
		for _, x := range cs {
			l := x.Created.Local()
			personKey := personKeyOf(target, x.UserID)
			if personKey != "" && !people[personKey] {
				people[personKey] = true
				out.People = append(out.People, person{
					Key: personKey, Document: x.Document, Phone: x.Phone,
				})
			}
			out.Items = append(out.Items, item{
				UReq: x.UReq, PersonKey: personKey, Date: l.Format("2006-01-02"), Time: l.Format("15:04"),
				Status: x.Status, StatusN: x.StatusN, Lender: x.Lender,
				Merchant: x.Merchant, Outcome: outcomeOf(x.Status), Direct: x.Direct,
			})
		}
		jsonOK(w, out)
	})

	mux.HandleFunc("/api/traza", func(w http.ResponseWriter, r *http.Request) {
		target, err := targetOf(r)
		if err != nil {
			jsonErr(w, 400, err.Error())
			return
		}
		ureq, err := strconv.ParseInt(r.URL.Query().Get("ureq"), 10, 64)
		if err != nil || ureq <= 0 {
			jsonErr(w, 400, "falta ureq= (un número)")
			return
		}
		t, s, err := BuildTrace(target, ureq)
		if err != nil {
			jsonErr(w, 502, err.Error())
			return
		}
		// Se agregan los datos de cabecera que la vista necesita y que no viven en `Traza` porque son de la
		// solicitud, no del flujo. Esta herramienta es de operación interna y escucha sólo en localhost.
		jsonOK(w, struct {
			Trace
			Merchant      string           `json:"comercio"`
			Branch        string           `json:"sucursal"`
			Lender        string           `json:"lender"`
			RT            int              `json:"rt"`
			Status        int              `json:"estado"`
			StatusN       string           `json:"estadoN"`
			Amount        float64          `json:"monto"`
			Profiling     string           `json:"perfilamiento"`
			QuotaProfiles []quotaProfileUI `json:"perfilesCupo"`
			PersonKey     string           `json:"personaKey,omitempty"`
			Document      string           `json:"documento"`
			Phone         string           `json:"telefono"`
			Origin        string           `json:"origen"`
			DerivedOrigin bool             `json:"origenDerivado"`
		}{
			Trace: t, Merchant: s.Merchant, Branch: s.Branch, Lender: s.Lender, RT: s.LenderRT,
			Status: s.Status, StatusN: s.StatusN, Amount: s.Amount,
			Profiling:     profilingSummary(s.Profiling),
			QuotaProfiles: quotaProfiles(s),
			PersonKey:     personKeyOf(target, s.UserID), Document: s.Document,
			Phone: s.Phone, Origin: s.Origin, DerivedOrigin: s.DerivedOrigin,
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
		Addr: addr, Handler: loggedIn(mux),
		ReadHeaderTimeout: 10 * time.Second,
		// Generoso a propósito: una consulta a prod pasa por la cola de Redash.
		WriteTimeout: 120 * time.Second,
	}
	return srv.ListenAndServe()
}

// loggedIn imprime cada llamada con su duración. En una herramienta que consulta producción, saber qué se
// consultó y cuánto tardó es la mitad del diagnóstico cuando algo va lento.
func loggedIn(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t0 := time.Now()
		h.ServeHTTP(w, r)
		fmt.Printf("  %s %s %s %s\n", gray(time.Now().Format("15:04:05")), r.Method,
			r.URL.RequestURI(), gray(time.Since(t0).Round(time.Millisecond).String()))
	})
}

func targetOf(r *http.Request) (string, error) {
	t := r.URL.Query().Get("target")
	if t == "" {
		t = "prod" // por ahora todo se trabaja sobre prod
	}
	if !allowedTargets[t] {
		return "", fmt.Errorf("target %q no permitido (prod · staging · qa · dev · local)", t)
	}
	return t, nil
}

// personKeyOf es estable dentro del target y sólo sirve para reunir consultas de la misma persona en
// este navegador. La cédula queda disponible para el operador dentro de la herramienta; esta clave evita
// usarla como llave de agrupación o de IndexedDB.
func personKeyOf(target string, userID int64) string {
	if userID <= 0 {
		return ""
	}
	return fmt.Sprintf("p-%s-%x", target, userID)
}

// profilingSummary es el titular de la corrida que cabe en la ficha lateral. El detalle —reglas,
// puntajes y el motivo de cada entidad— sigue en la etapa "Listado de entidades"; acá sólo se expone
// qué perfilador ordenó el listado, cuántas entidades llegó a mostrar y cuál fue la recomendada o la
// desembolsada. Sale del snapshot de BD, nunca de una inferencia de la Vue.
func profilingSummary(p *Profiling) string {
	if p == nil {
		return "No llegó al perfilamiento"
	}

	var parts []string
	if p.Profiler != "" {
		parts = append(parts, p.Profiler)
	}
	if len(p.Shown) > 0 {
		parts = append(parts, fmt.Sprintf("%d entidades mostradas", len(p.Shown)))
	}
	if name := profilingLender(p, p.Recommended); name != "" {
		parts = append(parts, "recomendada: "+name)
	}
	if name := profilingLender(p, p.Disbursed); name != "" {
		parts = append(parts, "desembolsada: "+name)
	}
	if len(parts) == 0 {
		return "Sin resultado registrado"
	}
	return strings.Join(parts, " · ")
}

// quotaProfileUI es la parte de la evaluación de categorías que cabe en la ficha. No traduce ni inventa
// niveles: la categoría (por ejemplo Premium o Standard) es la que configuró cada entidad. El detalle
// de reglas, score e ingreso permanece en "Listado de entidades", donde se puede revisar sin comprimirlo.
type quotaProfileUI struct {
	Category string  `json:"categoria"`
	Entity   string  `json:"entidad"`
	Quota    float64 `json:"cupo"`
}

// quotaProfiles devuelve sólo categorías que podemos atribuir a ESTA corrida. `users_category_log` está
// ligado al usuario, no a la solicitud; por eso una fila de otro intento del mismo cliente no puede
// presentarse como su perfil actual. Una misma entidad puede registrarse más de una vez en la cascada,
// así que se deduplica y se muestra primero la entidad de la solicitud abierta.
func quotaProfiles(s *LoanRequest) []quotaProfileUI {
	if s == nil {
		return []quotaProfileUI{}
	}

	profiles := make([]quotaProfileUI, 0, len(s.Categories))
	seenOnes := make(map[string]bool)
	for _, category := range s.Categories {
		if category.Window != "misma" || category.CatID <= 0 || strings.TrimSpace(category.CatName) == "" {
			continue
		}
		entity := strings.TrimSpace(category.Lender)
		if entity == "" {
			entity = fmt.Sprintf("entidad %d", category.LenderID)
		}
		profile := quotaProfileUI{
			Category: strings.TrimSpace(category.CatName),
			Entity:   entity,
			Quota:    category.Quota,
		}
		key := fmt.Sprintf("%d|%d|%s|%.2f", category.LenderID, category.CatID, profile.Category, profile.Quota)
		if seenOnes[key] {
			continue
		}
		seenOnes[key] = true
		profiles = append(profiles, profile)
	}

	sort.SliceStable(profiles, func(i, j int) bool {
		isCurrentI := profiles[i].Entity == s.Lender && s.Lender != ""
		isCurrentJ := profiles[j].Entity == s.Lender && s.Lender != ""
		if isCurrentI != isCurrentJ {
			return isCurrentI
		}
		if profiles[i].Entity != profiles[j].Entity {
			return profiles[i].Entity < profiles[j].Entity
		}
		return profiles[i].Category < profiles[j].Category
	})
	return profiles
}

func profilingLender(p *Profiling, id int64) string {
	if p == nil || id <= 0 {
		return ""
	}
	for _, lender := range p.Shown {
		if lender.ID == id && lender.Name != "" {
			return lender.Name
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
