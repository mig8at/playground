package pulso

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// El pulso vive en `data/pulse/YYYY-MM.jsonl`, al lado de la bitácora y con la misma regla: es DATO
// PERSONAL, así que va fuera de git.
//
// Se APENDEA, no se reescribe. Es la diferencia con `entries/`: una entrada de bitácora se puede
// corregir o borrar (borrado suave), pero un tick es un hecho pasado — nunca se edita. Y a 288 ticks por
// día, reescribir el mes entero en cada uno sería O(n²) para nada.
//
// IDEMPOTENCIA POR DEDUPE, no por candado. Dos fuentes pueden anotar la misma señal (la siembra y el
// agente, o dos ticks con ventanas que se pisan). En vez de coordinarlas, la LECTURA descarta duplicados
// por (repo, instante, tipo, qué): escribir de más es inofensivo, que es la propiedad que uno quiere en
// algo que corre desatendido.

const subdir = "pulse"

// Append anota un tick. Crea el archivo del mes si no existe.
func Append(dir string, t Tick) error {
	cuando, err := time.Parse(time.RFC3339, t.T)
	if err != nil {
		cuando = time.Now()
	}
	ruta := filepath.Join(dir, subdir, cuando.Format("2006-01")+".jsonl")
	if err := os.MkdirAll(filepath.Dir(ruta), 0o755); err != nil {
		return err
	}
	linea, err := json.Marshal(t)
	if err != nil {
		return err
	}
	f, err := os.OpenFile(ruta, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = f.Write(append(linea, '\n'))
	return err
}

// LastTick devuelve el instante del último tick anotado. Es lo que define la ventana del siguiente: así
// un hueco (Mac dormido, agente detenido) se barre entero en la próxima corrida en vez de perderse.
func LastTick(dir string) (time.Time, bool) {
	rutas, _ := filepath.Glob(filepath.Join(dir, subdir, "*.jsonl"))
	sort.Strings(rutas)
	for i := len(rutas) - 1; i >= 0; i-- {
		crudo, err := os.ReadFile(rutas[i])
		if err != nil {
			continue
		}
		lineas := strings.Split(strings.TrimRight(string(crudo), "\n"), "\n")
		for j := len(lineas) - 1; j >= 0; j-- {
			if strings.TrimSpace(lineas[j]) == "" {
				continue
			}
			var t Tick
			if json.Unmarshal([]byte(lineas[j]), &t) != nil {
				continue
			}
			if cuando, err := time.Parse(time.RFC3339, t.T); err == nil {
				return cuando, true
			}
		}
	}
	return time.Time{}, false
}

// Read trae los ticks de los últimos `days` días. Lee sólo los archivos de mes que tocan la ventana.
func Read(dir string, days int) ([]Tick, error) {
	desde := time.Now().AddDate(0, 0, -days+1)
	meses := map[string]bool{}
	for d := desde; !d.After(time.Now()); d = d.AddDate(0, 0, 1) {
		meses[d.Format("2006-01")] = true
	}
	var out []Tick
	claves := make([]string, 0, len(meses))
	for m := range meses {
		claves = append(claves, m)
	}
	sort.Strings(claves)
	for _, m := range claves {
		crudo, err := os.ReadFile(filepath.Join(dir, subdir, m+".jsonl"))
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return nil, err
		}
		for _, l := range strings.Split(string(crudo), "\n") {
			if strings.TrimSpace(l) == "" {
				continue
			}
			var t Tick
			if json.Unmarshal([]byte(l), &t) != nil {
				continue // una línea ilegible no puede tumbar el resto del mes
			}
			out = append(out, t)
		}
	}
	return out, nil
}

// ── agregación: de señales sueltas a la grilla de la jornada ────────────────────────────────────

// Hour es una celda de la jornada: un (día, hora) con lo que pasó adentro.
//
// `Slots` es EL número: cuántos tramos de 5' de esa hora tuvieron actividad, de 0 a 12. `Covered` es
// cuántos tramos llegó a mirar el agente — la diferencia entre "no trabajé" y "no hay registro" (equipo
// apagado, agente sin instalar). Confundir esas dos cosas es lo que hace que un mapa de actividad mienta.
type Hour struct {
	Day     string     `json:"day"`
	Hour    int        `json:"hour"`
	Slots   int        `json:"slots"`
	Covered int        `json:"covered"`
	Commits int        `json:"commits"`
	Ins     int        `json:"ins"`
	Del     int        `json:"del"`
	Repos   []RepoHour `json:"repos"`
}

// RepoHour es el desglose por repo de una celda: quién se llevó esa hora.
type RepoHour struct {
	Repo    string `json:"repo"`
	Branch  string `json:"branch,omitempty"`
	Slots   int    `json:"slots"`
	Commits int    `json:"commits"`
	Ins     int    `json:"ins"`
	Del     int    `json:"del"`
	Edits   int    `json:"edits,omitempty"` // tramos con edición sin commitear
}

// Aggregate convierte los ticks en celdas (día, hora).
//
// Los +/- que reporta salen SÓLO de commits. Los de una señal `edit` son el estado acumulado del working
// tree, no un delta: sumarlos entre ticks daría miles de líneas por un archivo que se guardó doce veces.
// El trabajo sin commitear se cuenta donde no engaña — en los slots (o sea, en el color).
func Aggregate(ticks []Tick) []Hour {
	type llave struct {
		day  string
		hour int
	}
	celdas := map[llave]*Hour{}
	slots := map[llave]map[int]bool{}                // slots con actividad
	cobertura := map[llave]map[int]bool{}            // slots que el agente miró
	porRepo := map[llave]map[string]*RepoHour{}      // desglose
	slotsRepo := map[llave]map[string]map[int]bool{} // slots por repo, para no contar dos veces
	vistas := map[string]bool{}                      // dedupe de señales repetidas entre ticks

	celda := func(k llave) *Hour {
		if c, ok := celdas[k]; ok {
			return c
		}
		c := &Hour{Day: k.day, Hour: k.hour}
		celdas[k] = c
		slots[k] = map[int]bool{}
		cobertura[k] = map[int]bool{}
		porRepo[k] = map[string]*RepoHour{}
		slotsRepo[k] = map[string]map[int]bool{}
		return c
	}
	// slotDe devuelve en qué tramo de 5' de su hora cae un instante: 0..11.
	slotDe := func(t time.Time) int { return t.Minute() / int(Slot/time.Minute) }

	for _, tk := range ticks {
		// COBERTURA. Un tick prueba que el equipo estaba prendido en su ventana, pero sólo se le cree si
		// la ventana es de cadencia normal (≤ 2 tramos): una siembra mira 20 días hacia atrás y no puede
		// reclamar que el agente estuvo vivo todo ese tiempo.
		if cuando, err := time.Parse(time.RFC3339, tk.T); err == nil {
			k := llave{cuando.Format("2006-01-02"), cuando.Hour()}
			celda(k)
			cobertura[k][slotDe(cuando)] = true
			if desde, err := time.Parse(time.RFC3339, tk.Since); err == nil && cuando.Sub(desde) <= 2*Slot {
				anterior := cuando.Add(-Slot)
				ka := llave{anterior.Format("2006-01-02"), anterior.Hour()}
				celda(ka)
				cobertura[ka][slotDe(anterior)] = true
			}
		}

		for _, s := range tk.Signals {
			id := s.Repo + "\x1f" + s.At + "\x1f" + s.Why + "\x1f" + s.What
			if vistas[id] {
				continue
			}
			vistas[id] = true

			cuando, err := time.Parse(time.RFC3339, s.At)
			if err != nil {
				continue
			}
			k := llave{cuando.Format("2006-01-02"), cuando.Hour()}
			c := celda(k)
			sl := slotDe(cuando)
			slots[k][sl] = true

			r, ok := porRepo[k][s.Repo]
			if !ok {
				r = &RepoHour{Repo: s.Repo, Branch: s.Branch}
				porRepo[k][s.Repo] = r
				slotsRepo[k][s.Repo] = map[int]bool{}
			}
			slotsRepo[k][s.Repo][sl] = true
			if s.Why == "commit" {
				c.Commits++
				c.Ins += s.Ins
				c.Del += s.Del
				r.Commits++
				r.Ins += s.Ins
				r.Del += s.Del
			}
			if s.Why == "edit" {
				r.Edits++
			}
		}
	}

	out := make([]Hour, 0, len(celdas))
	for k, c := range celdas {
		c.Slots = len(slots[k])
		c.Covered = len(cobertura[k])
		// Lista vacía, no nil: una celda que sólo tiene cobertura (el agente miró y no había nada)
		// serializaría `null` y obligaría a que cada consumidor se acuerde de esa variante.
		c.Repos = []RepoHour{}
		for nombre, r := range porRepo[k] {
			r.Slots = len(slotsRepo[k][nombre])
			c.Repos = append(c.Repos, *r)
		}
		sort.Slice(c.Repos, func(i, j int) bool {
			if c.Repos[i].Slots != c.Repos[j].Slots {
				return c.Repos[i].Slots > c.Repos[j].Slots
			}
			return c.Repos[i].Repo < c.Repos[j].Repo
		})
		out = append(out, *c)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Day != out[j].Day {
			return out[i].Day < out[j].Day
		}
		return out[i].Hour < out[j].Hour
	})
	return out
}

// ── dónde vive data/ ────────────────────────────────────────────────────────────────────────────

// DataDir resuelve la carpeta de datos del tablero. Importa que sea ROBUSTO: launchd corre el agente con
// cwd `/`, así que un default relativo lo dejaría escribiendo en cualquier lado (o en ninguno). Orden:
// TABLERO_DATA · junto al binario (`server/bin/pulso` → `../../data`) · relativo al cwd.
func DataDir() string {
	if v := os.Getenv("TABLERO_DATA"); v != "" {
		return v
	}
	if exe, err := os.Executable(); err == nil {
		if p, err := filepath.EvalSymlinks(exe); err == nil {
			exe = p
		}
		cand := filepath.Join(filepath.Dir(exe), "..", "..", "data")
		if st, err := os.Stat(cand); err == nil && st.IsDir() {
			return filepath.Clean(cand)
		}
	}
	for _, cand := range []string{filepath.Join("..", "data"), "data"} {
		if st, err := os.Stat(cand); err == nil && st.IsDir() {
			return cand
		}
	}
	return filepath.Join("..", "data")
}
