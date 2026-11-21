package main

// DE DÓNDE SALE LO QUE SABUESO NO GUARDA A MANO.
//
//   - CreditOp, en prod y SÓLO LEYENDO, por `bin/pg sql` (el conector): cuánto origina cada sector y quiénes ya son
//     comercio (para no proponerlos). Se guarda unas horas en `.data/` para no ir a Redash en cada pantalla.
//   - El registro mercantil abierto de Confecámaras en datos.gov.co (Socrata, sin llave, CC BY-SA 4.0): los
//     establecimientos activos por NIT del dueño (los puntos de venta) y la razón social de cada empresa.

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	establishmentsURL = "https://www.datos.gov.co/resource/nb3d-v3n7.json"
	companiesURL      = "https://www.datos.gov.co/resource/c82u-588k.json"
	cacheFor          = 6 * time.Hour
)

// ── CreditOp, por bin/pg ─────────────────────────────────────────────────────────────────────────────────────

// pgRows corre `bin/pg sql --target prod --json` y devuelve las filas.
func pgRows(ctx context.Context, query string) ([]map[string]any, error) {
	cmd := exec.CommandContext(ctx, filepath.Join(root, "bin", "pg"), "sql", "--target", "prod", "--json", "--query", query)
	cmd.Dir = root
	out, err := cmd.Output()
	if err != nil {
		msg := err.Error()
		if ee, ok := err.(*exec.ExitError); ok && len(ee.Stderr) > 0 {
			msg = strings.TrimSpace(string(ee.Stderr))
		}
		return nil, fmt.Errorf("bin/pg sql: %s", msg)
	}
	var res struct {
		Rows []map[string]any `json:"rows"`
	}
	if err := json.Unmarshal(out, &res); err != nil {
		return nil, fmt.Errorf("bin/pg sql: la salida no es JSON: %v", err)
	}
	return res.Rows, nil
}

func num(v any) float64 {
	switch x := v.(type) {
	case float64:
		return x
	case string:
		f, _ := strconv.ParseFloat(x, 64)
		return f
	case json.Number:
		f, _ := x.Float64()
		return f
	}
	return 0
}

func str(v any) string {
	if v == nil {
		return ""
	}
	if s, ok := v.(string); ok {
		return s
	}
	return fmt.Sprint(v)
}

// Client: un comercio que ya trabaja con CreditOp.
type Client struct {
	Name string `json:"name"`
	NIT  string `json:"nit"`
}

// Measured: lo que se trae de prod, con su hora.
type Measured struct {
	At      string            `json:"at"`
	Sectors map[string]Sector `json:"sectors"` // por id
	Clients []Client          `json:"clients"`
	Error   string            `json:"error,omitempty"`
	byNIT   map[string]string // nit → nombre
	byName  map[string]string // nombre normalizado → nombre
}

var (
	measuredMu sync.Mutex
	measured   *Measured
)

func measuredPath() string { return filepath.Join(dataDir, "measured.json") }

// loadMeasured devuelve lo medido; si no hay o tiene más de 6 horas (o force), lo vuelve a medir.
func loadMeasured(ctx context.Context, force bool) *Measured {
	measuredMu.Lock()
	defer measuredMu.Unlock()
	if measured == nil {
		if b, err := os.ReadFile(measuredPath()); err == nil {
			var m Measured
			if json.Unmarshal(b, &m) == nil {
				measured = &m
				measured.index()
			}
		}
	}
	if !force && measured != nil {
		if t, err := time.Parse(time.RFC3339, measured.At); err == nil && time.Since(t) < cacheFor && measured.Error == "" {
			return measured
		}
	}
	m := measure(ctx)
	if m.Error != "" && measured != nil && measured.Error == "" {
		measured.Error = m.Error // no tira lo que se midió antes por una falla de red
		return measured
	}
	measured = m
	measured.index()
	if b, err := json.MarshalIndent(m, "", "  "); err == nil {
		_ = os.MkdirAll(dataDir, 0o755)
		_ = os.WriteFile(measuredPath(), b, 0o644)
	}
	return measured
}

func (m *Measured) index() {
	m.byNIT, m.byName = map[string]string{}, map[string]string{}
	for _, c := range m.Clients {
		if c.NIT != "" {
			m.byNIT[c.NIT] = c.Name
		}
		if n := normalizeName(c.Name); n != "" {
			m.byName[n] = c.Name
		}
	}
}

// IsClient: si una empresa ya es comercio de CreditOp, por NIT o por nombre (139 de 213 comercios activos no tienen
// NIT en CreditOp: el NIT solo no alcanza). Devuelve el nombre con que está en CreditOp.
func (m *Measured) IsClient(nit, name string) string {
	if m == nil {
		return ""
	}
	if n := normalizeNIT(nit); n != "" {
		if c, ok := m.byNIT[n]; ok {
			return c
		}
	}
	if n := normalizeName(name); len(n) >= 4 {
		if c, ok := m.byName[n]; ok {
			return c
		}
		for k, c := range m.byName { // «Motocentro Andino» contra «Motocentro Andino Medellín»
			if len(k) >= 5 && (strings.HasPrefix(n, k+" ") || strings.HasPrefix(k, n+" ")) {
				return c
			}
		}
	}
	return ""
}

func measure(ctx context.Context) *Measured {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Minute)
	defer cancel()
	m := &Measured{At: now(), Sectors: map[string]Sector{}}
	rows, err := pgRows(ctx, "SELECT ai.name AS industry, SUM(ur.disbursed_at IS NOT NULL) AS disbursed, "+
		"AVG(CASE WHEN ur.disbursed_at IS NOT NULL THEN ur.amount END) AS avg_amount, COUNT(DISTINCT ur.allied_id) AS merchants "+
		"FROM user_requests ur JOIN allieds a ON a.id=ur.allied_id LEFT JOIN allied_industries ai ON ai.id=a.allied_industry_id "+
		"WHERE ur.created_at >= NOW() - INTERVAL 180 DAY GROUP BY ai.name")
	if err != nil {
		m.Error = err.Error()
		return m
	}
	byIndustry := map[string]map[string]any{}
	for _, r := range rows {
		byIndustry[str(r["industry"])] = r
	}
	for _, s := range sectors {
		if r, ok := byIndustry[s.Industry]; ok {
			s.Disbursed, s.AvgAmount, s.Merchants = int(num(r["disbursed"])), num(r["avg_amount"]), int(num(r["merchants"]))
		}
		m.Sectors[s.ID] = s
	}
	rows, err = pgRows(ctx, "SELECT name, nit FROM allieds WHERE status=1")
	if err != nil {
		m.Error = err.Error()
		return m
	}
	for _, r := range rows {
		m.Clients = append(m.Clients, Client{Name: str(r["name"]), NIT: normalizeNIT(str(r["nit"]))})
	}
	return m
}

// ── el registro mercantil abierto ────────────────────────────────────────────────────────────────────────────

var httpClient = &http.Client{Timeout: 90 * time.Second}

func socrata(ctx context.Context, base string, params url.Values, out any) error {
	req, err := http.NewRequestWithContext(ctx, "GET", base+"?"+params.Encode(), nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	res, err := httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("datos.gov.co: %v", err)
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 8<<20))
	if res.StatusCode != 200 {
		return fmt.Errorf("datos.gov.co: HTTP %d %s", res.StatusCode, strings.TrimSpace(string(body[:min(len(body), 200)])))
	}
	return json.Unmarshal(body, out)
}

// Candidate: una empresa del registro que podría ser comercio.
type Candidate struct {
	NIT      string `json:"nit"`
	Name     string `json:"name"`
	Points   int    `json:"points"`
	Region   string `json:"region"`
	CIIU     string `json:"ciiu"`
	Renewed  string `json:"renewed"`
	Client   string `json:"client,omitempty"`  // ya es comercio de CreditOp (con ese nombre)
	Tracked  string `json:"tracked,omitempty"` // ya está en Sabueso (su id)
	Fit      int    `json:"fit"`
	Sector   string `json:"sector"`
	Inactive bool   `json:"inactive,omitempty"` // la empresa no está activa en el registro
}

// discover: las empresas del sector con más establecimientos activos en el registro mercantil.
func discover(ctx context.Context, s *Sector, minPoints, limit int, st *State, m *Measured) ([]Candidate, error) {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	var likes []string
	for _, c := range s.CIIU {
		likes = append(likes, fmt.Sprintf("cod_ciiu_act_econ_pri = '%s'", c))
	}
	params := url.Values{}
	params.Set("$select", "nit_propietario, count(*) as points, max(ultimo_ano_renovado) as renewed, max(cod_ciiu_act_econ_pri) as ciiu")
	params.Set("$where", fmt.Sprintf("estado_matricula = 'ACTIVA' AND nit_propietario IS NOT NULL AND (%s)", strings.Join(likes, " OR ")))
	params.Set("$group", "nit_propietario")
	params.Set("$having", fmt.Sprintf("count(*) >= %d", minPoints))
	params.Set("$order", "points DESC")
	params.Set("$limit", strconv.Itoa(limit))
	var rows []struct {
		NIT     string `json:"nit_propietario"`
		Points  string `json:"points"`
		Renewed string `json:"renewed"`
		CIIU    string `json:"ciiu"`
	}
	if err := socrata(ctx, establishmentsURL, params, &rows); err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return []Candidate{}, nil
	}
	// Los nombres, de a 50 NIT por consulta.
	// La razón social y la cámara de su domicilio (la de sus establecimientos puede ser cualquiera).
	names := map[string]struct{ name, state, region string }{}
	for i := 0; i < len(rows); i += 50 {
		var quoted []string
		for _, r := range rows[i:min(i+50, len(rows))] {
			quoted = append(quoted, "'"+strings.ReplaceAll(r.NIT, "'", "")+"'")
		}
		p := url.Values{}
		p.Set("$select", "nit, razon_social, estado_matricula, camara_comercio")
		p.Set("$where", fmt.Sprintf("nit in(%s)", strings.Join(quoted, ",")))
		p.Set("$limit", "1000")
		var named []struct {
			NIT    string `json:"nit"`
			Name   string `json:"razon_social"`
			State  string `json:"estado_matricula"`
			Region string `json:"camara_comercio"`
		}
		if err := socrata(ctx, companiesURL, p, &named); err != nil {
			return nil, err
		}
		for _, n := range named {
			if prev, ok := names[n.NIT]; ok && activeState(prev.state) {
				continue // un NIT puede tener matrículas viejas canceladas (un traslado de domicilio): gana la activa
			}
			names[n.NIT] = struct{ name, state, region string }{n.Name, n.State, n.Region}
		}
	}
	tracked := map[string]string{}
	for _, c := range st.Companies {
		if c.NIT != "" {
			tracked[c.NIT] = c.ID
		}
		tracked["name:"+normalizeName(c.Name)] = c.ID
	}
	out := []Candidate{}
	for _, r := range rows {
		n := names[r.NIT]
		pts, _ := strconv.Atoi(r.Points)
		c := Candidate{NIT: normalizeNIT(r.NIT), Name: strings.TrimSpace(n.name), Points: pts, Region: chamberCity(n.region),
			CIIU: r.CIIU, Renewed: r.Renewed, Sector: s.ID, Inactive: n.state != "" && !activeState(n.state)}
		if c.Name == "" {
			c.Name = "NIT " + c.NIT // está en establecimientos pero no en el conjunto de empresas (persona natural, a veces)
		}
		c.Client = m.IsClient(c.NIT, c.Name)
		if id, ok := tracked[c.NIT]; ok {
			c.Tracked = id
		} else if id, ok := tracked["name:"+normalizeName(c.Name)]; ok {
			c.Tracked = id
		}
		c.Fit, _ = computeFit(&Company{Kind: KindMerchant, Points: pts, Sector: s.ID})
		out = append(out, c)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Points > out[j].Points })
	return out, nil
}

// titleCase: «MEDELLIN PARA ANTIOQUIA» → «Medellin para Antioquia».
func titleCase(s string) string {
	words := strings.Fields(strings.ToLower(s))
	small := map[string]bool{"para": true, "de": true, "del": true, "y": true, "la": true, "el": true}
	for i, w := range words {
		if i > 0 && small[w] {
			continue
		}
		r := []rune(w)
		words[i] = strings.ToUpper(string(r[:1])) + string(r[1:])
	}
	return strings.Join(words, " ")
}

// chamberCity: la ciudad de una cámara, sin la cola del departamento («MEDELLIN PARA ANTIOQUIA» → «Medellin»).
func chamberCity(s string) string {
	if i := strings.Index(strings.ToUpper(s), " PARA "); i > 0 {
		s = s[:i]
	}
	return titleCase(s)
}

// activeState: si una matrícula está viva. Además de «ACTIVA», la de una empresa que cambió de domicilio queda como
// «MATRÍCULA NUEVA, CONSTITUCIÓN POR TRASLADO» en la cámara nueva (y la vieja, cancelada por traslado).
func activeState(s string) bool {
	u := strings.ToUpper(s)
	return u == "ACTIVA" || strings.HasPrefix(u, "MATRÍCULA NUEVA") || strings.HasPrefix(u, "MATRICULA NUEVA")
}
