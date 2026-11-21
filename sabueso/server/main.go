// Sabueso: la API de la app (sabueso/, :5245). Encuentra comercios que todavía no venden a crédito con CreditOp (y
// entidades que no están integradas), dice por qué encajan y lleva la relación con cada uno hasta que entra, o hasta
// que Miguel se la pasa a alguien. Es sólo de Miguel: no tiene usuarios ni login. La interfaz (:5244) la muestra en
// Cockpit. El planteamiento y lo medido: tarea 136 del tablero (tablero/tasks/sabueso).
//
// Lo que Sabueso no hace: escribirle a nadie (redacta; envía una persona), escribir en una base de CreditOp (prod se
// lee) ni guardar datos personales en masa (el correo y el teléfono son los PÚBLICOS de la empresa).
package main

import (
	"encoding/json"
	"errors"
	"flag"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"creditop/my-tools/lib/launchagent"
)

var (
	root    string // la raíz de my-tools (donde está bin/pg)
	dataDir string // sabueso/.data
	mu      sync.Mutex
)

func main() {
	serve := flag.String("serve", "127.0.0.1:5245", "host:puerto de la API")
	flag.Parse()
	root = os.Getenv("MY_TOOLS_ROOT")
	if root == "" {
		root, _ = os.Getwd()
	}
	dataDir = filepath.Join(root, "sabueso", ".data")
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		log.Fatal(err)
	}
	ln, err := launchagent.Listen("sabueso", *serve)
	if err != nil {
		log.Fatal(err)
	}
	log.Printf("sabueso: API en http://%s · datos en %s", *serve, dataDir)
	log.Fatal(http.Serve(ln, guard(routes())))
}

// guard: el encabezado propio y un Host de esta máquina, como el Llavero: una página cualquiera no puede escribir acá.
func guard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host := r.Host
		if i := strings.LastIndexByte(host, ':'); i >= 0 {
			host = host[:i]
		}
		if host != "127.0.0.1" && host != "localhost" {
			writeErr(w, http.StatusForbidden, errors.New("sólo desde esta máquina"))
			return
		}
		if r.Header.Get("X-Sabueso") != "1" {
			writeErr(w, http.StatusForbidden, errors.New("falta el encabezado X-Sabueso"))
			return
		}
		next.ServeHTTP(w, r)
	})
}

// ── el archivo ───────────────────────────────────────────────────────────────────────────────────────────────

func statePath() string { return filepath.Join(dataDir, "state.json") }

func loadState() (*State, error) {
	st := &State{Companies: []*Company{}}
	b, err := os.ReadFile(statePath())
	if os.IsNotExist(err) {
		return st, nil
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(b, st); err != nil {
		return nil, err
	}
	return st, nil
}

func saveState(st *State) error {
	b, err := json.MarshalIndent(st, "", "  ")
	if err != nil {
		return err
	}
	tmp := statePath() + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, statePath())
}

// withState carga, corre fn y guarda si fn no falló. Todo con el candado: un solo proceso escribe.
func withState(fn func(st *State) error) (*State, error) {
	mu.Lock()
	defer mu.Unlock()
	st, err := loadState()
	if err != nil {
		return nil, err
	}
	if err := fn(st); err != nil {
		return nil, err
	}
	return st, saveState(st)
}

func find(st *State, id string) *Company {
	for _, c := range st.Companies {
		if c.ID == id {
			return c
		}
	}
	return nil
}

// enrich recalcula lo derivado de cada empresa antes de devolverla.
func enrich(st *State) {
	for _, c := range st.Companies {
		if c.Country == "" {
			c.Country = "CO"
		}
		c.Fit, c.FitWhy = computeFit(c)
		if c.FitWhy == nil {
			c.FitWhy = []string{}
		}
		if c.Activities == nil {
			c.Activities = []Activity{}
		}
	}
	sort.SliceStable(st.Companies, func(i, j int) bool { return st.Companies[i].Name < st.Companies[j].Name })
}

// ── la API ───────────────────────────────────────────────────────────────────────────────────────────────────

type patch struct {
	Stage     *string `json:"stage"`
	HandedTo  *string `json:"handedTo"`
	Next      *Step   `json:"next"`
	ClearNext bool    `json:"clearNext"`
	Name      *string `json:"name"`
	NIT       *string `json:"nit"`
	Sector    *string `json:"sector"`
	Region    *string `json:"region"`
	Points    *int    `json:"points"`
	Online    *bool   `json:"online"`
	Website   *string `json:"website"`
	Email     *string `json:"email"`
	Phone     *string `json:"phone"`
}

func routes() *http.ServeMux {
	mux := http.NewServeMux()

	// Todo lo que la interfaz necesita para pintar.
	mux.HandleFunc("GET /api/state", func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		st, err := loadState()
		mu.Unlock()
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		enrich(st)
		m := loadMeasured(r.Context(), false)
		out := []Sector{}
		for _, s := range sectors {
			if ms, ok := m.Sectors[s.ID]; ok {
				s.Disbursed, s.AvgAmount, s.Merchants = ms.Disbursed, ms.AvgAmount, ms.Merchants
			}
			out = append(out, s)
		}
		writeJSON(w, 200, map[string]any{"companies": st.Companies, "stages": stages, "sectors": out,
			"measuredAt": m.At, "measureError": m.Error, "clients": len(m.Clients)})
	})

	// Volver a medir en prod (cuánto origina cada sector y quiénes ya son comercio).
	mux.HandleFunc("POST /api/measure", func(w http.ResponseWriter, r *http.Request) {
		m := loadMeasured(r.Context(), true)
		if m.Error != "" {
			writeErr(w, 502, errors.New(m.Error))
			return
		}
		writeJSON(w, 200, map[string]any{"measuredAt": m.At, "clients": len(m.Clients)})
	})

	// Buscar en el registro mercantil las empresas de un sector con más puntos.
	mux.HandleFunc("POST /api/discover", func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			Sector    string `json:"sector"`
			MinPoints int    `json:"minPoints"`
		}
		if !decode(w, r, &in) {
			return
		}
		s := sectorByID(in.Sector)
		if s == nil {
			writeErr(w, 400, errors.New("el sector no existe"))
			return
		}
		if in.MinPoints < 1 {
			in.MinPoints = 3
		}
		mu.Lock()
		st, err := loadState()
		mu.Unlock()
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		m := loadMeasured(r.Context(), false)
		list, err := discover(r.Context(), s, in.MinPoints, 60, st, m)
		if err != nil {
			writeErr(w, 502, err)
			return
		}
		writeJSON(w, 200, map[string]any{"candidates": list, "sector": s.ID, "source": "Registro mercantil · Confecámaras (datos.gov.co, CC BY-SA 4.0)"})
	})

	// Buscar con Claude por internet los comercios de un sector en un país sin registro abierto (Perú).
	mux.HandleFunc("POST /api/discover-web", func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			Country string `json:"country"`
			Sector  string `json:"sector"`
			Limit   int    `json:"limit"`
		}
		if !decode(w, r, &in) {
			return
		}
		s := sectorByID(in.Sector)
		if s == nil {
			writeErr(w, 400, errors.New("el sector no existe"))
			return
		}
		co := countryOf(in.Country)
		if co.ID != in.Country {
			writeErr(w, 400, errors.New("el país no está: CO o PE"))
			return
		}
		if in.Limit < 1 || in.Limit > 15 {
			in.Limit = 8
		}
		mu.Lock()
		st, err := loadState()
		mu.Unlock()
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		var skip []string
		for _, c := range st.Companies {
			if c.Country == co.ID {
				skip = append(skip, c.Name)
			}
		}
		for _, d := range st.NoChannel {
			skip = append(skip, d.Name)
		}
		list, cost, err := webFind(r.Context(), co, s, in.Limit, skip)
		if err != nil {
			writeErr(w, 502, err)
			return
		}
		markWeb(list, st, loadMeasured(r.Context(), false))
		writeJSON(w, 200, map[string]any{"candidates": list, "costUsd": cost})
	})

	// Una empresa nueva: a mano, o desde el registro.
	mux.HandleFunc("POST /api/companies", func(w http.ResponseWriter, r *http.Request) {
		var c Company
		if !decode(w, r, &c) {
			return
		}
		if c.Source == "" {
			c.Source = "manual"
		}
		if err := validateCompany(&c); err != nil {
			writeErr(w, 400, err)
			return
		}
		st, err := withState(func(st *State) error {
			for _, o := range st.Companies {
				if (c.NIT != "" && o.NIT == c.NIT) || normalizeName(o.Name) == normalizeName(c.Name) {
					return errors.New("ya está en Sabueso: " + o.Name)
				}
			}
			c.ID, c.Created, c.Updated, c.Activities = newID("co"), now(), now(), nil
			from := map[string]string{"manual": "a mano", "registry": "desde el registro mercantil", "web": "encontrada por Claude en internet"}[c.Source]
			c.log("created", "Entró como "+strings.ToLower(stageName(c.Kind, c.Stage))+" "+from)
			st.Companies = append(st.Companies, &c)
			return nil
		})
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		_ = st
		writeJSON(w, 200, map[string]string{"id": c.ID})
	})

	mux.HandleFunc("PATCH /api/companies/{id}", func(w http.ResponseWriter, r *http.Request) {
		var p patch
		if !decode(w, r, &p) {
			return
		}
		_, err := withState(func(st *State) error {
			c := find(st, r.PathValue("id"))
			if c == nil {
				return errNotFound
			}
			if p.Stage != nil && *p.Stage != c.Stage {
				if !validStage(c.Kind, *p.Stage) {
					return errors.New("esa etapa no existe")
				}
				c.log("stage", "Pasó de "+stageName(c.Kind, c.Stage)+" a "+stageName(c.Kind, *p.Stage))
				c.Stage = *p.Stage
			}
			if p.HandedTo != nil && strings.TrimSpace(*p.HandedTo) != c.HandedTo {
				to := strings.TrimSpace(*p.HandedTo)
				if to == "" {
					c.log("handoff", "Vuelve a Miguel")
				} else {
					c.log("handoff", "Lo retoma "+to+": sigue en persona")
				}
				c.HandedTo = to
			}
			if p.ClearNext {
				if c.Next != nil {
					c.log("note", "Hecho: "+c.Next.Text)
				}
				c.Next = nil
			} else if p.Next != nil {
				if strings.TrimSpace(p.Next.Text) == "" {
					return errors.New("el próximo paso necesita un texto")
				}
				if _, err := time.Parse("2006-01-02", p.Next.Due); err != nil {
					return errors.New("la fecha del próximo paso va como AAAA-MM-DD")
				}
				p.Next.Text = strings.TrimSpace(p.Next.Text)
				c.Next = p.Next
			}
			setStr := func(dst *string, v *string) {
				if v != nil {
					*dst = strings.TrimSpace(*v)
				}
			}
			setStr(&c.Name, p.Name)
			setStr(&c.Region, p.Region)
			setStr(&c.Website, p.Website)
			setStr(&c.Email, p.Email)
			setStr(&c.Phone, p.Phone)
			if p.NIT != nil {
				c.NIT = normalizeNIT(*p.NIT)
			}
			if p.Sector != nil {
				if *p.Sector != "" && sectorByID(*p.Sector) == nil {
					return errors.New("el sector no existe")
				}
				c.Sector = *p.Sector
			}
			if p.Points != nil && *p.Points >= 0 {
				c.Points = *p.Points
			}
			if p.Online != nil {
				c.Online = *p.Online
			}
			if c.Name == "" {
				return errors.New("falta el nombre")
			}
			c.Updated = now()
			return nil
		})
		reply(w, err)
	})

	// Sacarla porque no tiene canal: sale de la lista y queda anotada para que hunt no la vuelva a buscar.
	mux.HandleFunc("POST /api/companies/{id}/drop", func(w http.ResponseWriter, r *http.Request) {
		var in struct{ Summary string }
		_ = json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&in)
		_, err := withState(func(st *State) error {
			for i, c := range st.Companies {
				if c.ID == r.PathValue("id") {
					sum := in.Summary
					if sum == "" && c.Research != nil {
						sum = c.Research.Summary
					}
					st.NoChannel = append(st.NoChannel, Dropped{NIT: c.NIT, Name: c.Name, At: now(), Summary: sum})
					st.Companies = append(st.Companies[:i], st.Companies[i+1:]...)
					return nil
				}
			}
			return errNotFound
		})
		reply(w, err)
	})

	mux.HandleFunc("DELETE /api/companies/{id}", func(w http.ResponseWriter, r *http.Request) {
		_, err := withState(func(st *State) error {
			for i, c := range st.Companies {
				if c.ID == r.PathValue("id") {
					st.Companies = append(st.Companies[:i], st.Companies[i+1:]...)
					return nil
				}
			}
			return errNotFound
		})
		reply(w, err)
	})

	// Buscar en internet, con Claude, el contacto para la propuesta (un par de minutos; contact.go).
	mux.HandleFunc("POST /api/companies/{id}/contact", func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		st, err := loadState()
		mu.Unlock()
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		c := find(st, r.PathValue("id"))
		if c == nil {
			writeErr(w, 404, errNotFound)
			return
		}
		res, err := research(r.Context(), c)
		if err != nil {
			writeErr(w, 502, err)
			return
		}
		_, err = withState(func(st *State) error {
			c := find(st, r.PathValue("id"))
			if c == nil {
				return errNotFound
			}
			applyResearch(c, res)
			return nil
		})
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, res)
	})

	// Una línea de la bitácora: una llamada, un correo, una reunión o una nota.
	mux.HandleFunc("POST /api/companies/{id}/activities", func(w http.ResponseWriter, r *http.Request) {
		var in struct{ Kind, Text string }
		if !decode(w, r, &in) {
			return
		}
		in.Text = strings.TrimSpace(in.Text)
		if in.Text == "" {
			writeErr(w, 400, errors.New("falta el texto"))
			return
		}
		if !activityKinds[in.Kind] {
			in.Kind = "note"
		}
		_, err := withState(func(st *State) error {
			c := find(st, r.PathValue("id"))
			if c == nil {
				return errNotFound
			}
			c.log(in.Kind, in.Text)
			return nil
		})
		reply(w, err)
	})
	return mux
}

var errNotFound = errors.New("no está en Sabueso")

func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(v); err != nil {
		writeErr(w, 400, errors.New("el cuerpo va en JSON"))
		return false
	}
	return true
}

func reply(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, errNotFound):
		writeErr(w, 404, err)
	case err != nil:
		writeErr(w, 400, err)
	default:
		writeJSON(w, 200, map[string]bool{"ok": true})
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, err error) {
	writeJSON(w, status, map[string]string{"error": err.Error()})
}
