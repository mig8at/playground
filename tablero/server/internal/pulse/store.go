package pulse

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
	when, err := time.Parse(time.RFC3339, t.T)
	if err != nil {
		when = time.Now()
	}
	path := filepath.Join(dir, subdir, when.Format("2006-01")+".jsonl")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	line, err := json.Marshal(t)
	if err != nil {
		return err
	}
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = f.Write(append(line, '\n'))
	return err
}

// LastTick devuelve el instante del último tick anotado. Es lo que define la ventana del siguiente: así
// un hueco (Mac dormido, agente detenido) se barre entero en la próxima corrida en vez de perderse.
func LastTick(dir string) (time.Time, bool) {
	paths, _ := filepath.Glob(filepath.Join(dir, subdir, "*.jsonl"))
	sort.Strings(paths)
	for i := len(paths) - 1; i >= 0; i-- {
		raw, err := os.ReadFile(paths[i])
		if err != nil {
			continue
		}
		lines := strings.Split(strings.TrimRight(string(raw), "\n"), "\n")
		for j := len(lines) - 1; j >= 0; j-- {
			if strings.TrimSpace(lines[j]) == "" {
				continue
			}
			var t Tick
			if json.Unmarshal([]byte(lines[j]), &t) != nil {
				continue
			}
			if when, err := time.Parse(time.RFC3339, t.T); err == nil {
				return when, true
			}
		}
	}
	return time.Time{}, false
}

// Read trae los ticks de los últimos `days` días. Lee sólo los archivos de mes que tocan la ventana.
func Read(dir string, days int) ([]Tick, error) {
	since := time.Now().AddDate(0, 0, -days+1)
	months := map[string]bool{}
	for d := since; !d.After(time.Now()); d = d.AddDate(0, 0, 1) {
		months[d.Format("2006-01")] = true
	}
	var out []Tick
	keys := make([]string, 0, len(months))
	for m := range months {
		keys = append(keys, m)
	}
	sort.Strings(keys)
	for _, m := range keys {
		raw, err := os.ReadFile(filepath.Join(dir, subdir, m+".jsonl"))
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return nil, err
		}
		for _, l := range strings.Split(string(raw), "\n") {
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

// Aggregate convierte los ticks en celdas (día, hora), recortadas a los últimos `days` días (0 = todas).
//
// EL RECORTE VA ACÁ y no en quien llama porque `Read` filtra por la fecha del TICK, no de la señal: como
// cada señal lleva su propio instante, una siembra escrita hoy contiene semanas de historia y se colaba
// entera en cualquier ventana. La grilla lo disimulaba —dibuja sólo sus columnas— pero el desglose "en
// qué" sumaba días que el encabezado decía no estar mostrando.
//
// Los +/- que reporta salen SÓLO de commits. Los de una señal `edit` son el estado acumulado del working
// tree, no un delta: sumarlos entre ticks daría miles de líneas por un archivo que se guardó doce veces.
// El trabajo sin commitear se cuenta donde no engaña — en los slots (o sea, en el color).
func Aggregate(ticks []Tick, days int) []Hour {
	cut := ""
	if days > 0 {
		cut = time.Now().AddDate(0, 0, -days+1).Format("2006-01-02")
	}
	type key struct {
		day  string
		hour int
	}
	cells := map[key]*Hour{}
	slots := map[key]map[int]bool{}                // slots con actividad
	coverage := map[key]map[int]bool{}             // slots que el agente miró
	byRepo := map[key]map[string]*RepoHour{}       // desglose
	slotsRepo := map[key]map[string]map[int]bool{} // slots por repo, para no contar dos veces
	seen := map[string]bool{}                      // dedupe de señales repetidas entre ticks

	cell := func(k key) *Hour {
		if c, ok := cells[k]; ok {
			return c
		}
		c := &Hour{Day: k.day, Hour: k.hour}
		cells[k] = c
		slots[k] = map[int]bool{}
		coverage[k] = map[int]bool{}
		byRepo[k] = map[string]*RepoHour{}
		slotsRepo[k] = map[string]map[int]bool{}
		return c
	}
	// slotOf devuelve en qué tramo de 5' de su hora cae un instante: 0..11.
	slotOf := func(t time.Time) int { return t.Minute() / int(Slot/time.Minute) }

	for _, tk := range ticks {
		// COBERTURA. Un tick prueba que el equipo estaba prendido en su ventana, pero sólo se le cree si
		// la ventana es de cadencia normal (≤ 2 tramos): una siembra mira 20 días hacia atrás y no puede
		// reclamar que el agente estuvo vivo todo ese tiempo.
		if when, err := time.Parse(time.RFC3339, tk.T); err == nil {
			k := key{when.Format("2006-01-02"), when.Hour()}
			cell(k)
			coverage[k][slotOf(when)] = true
			if since, err := time.Parse(time.RFC3339, tk.Since); err == nil && when.Sub(since) <= 2*Slot {
				previous := when.Add(-Slot)
				ka := key{previous.Format("2006-01-02"), previous.Hour()}
				cell(ka)
				coverage[ka][slotOf(previous)] = true
			}
		}

		for _, s := range tk.Signals {
			id := s.Repo + "\x1f" + s.At + "\x1f" + s.Why + "\x1f" + s.What
			if seen[id] {
				continue
			}
			seen[id] = true

			when, err := time.Parse(time.RFC3339, s.At)
			if err != nil {
				continue
			}
			k := key{when.Format("2006-01-02"), when.Hour()}
			c := cell(k)
			sl := slotOf(when)
			slots[k][sl] = true

			r, ok := byRepo[k][s.Repo]
			if !ok {
				r = &RepoHour{Repo: s.Repo, Branch: s.Branch}
				byRepo[k][s.Repo] = r
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

	out := make([]Hour, 0, len(cells))
	for k, c := range cells {
		if cut != "" && c.Day < cut { // iso lexicográfico: YYYY-MM-DD ordena bien como texto
			continue
		}
		c.Slots = len(slots[k])
		c.Covered = len(coverage[k])
		// Lista vacía, no nil: una celda que sólo tiene cobertura (el agente miró y no había nada)
		// serializaría `null` y obligaría a que cada consumidor se acuerde de esa variante.
		c.Repos = []RepoHour{}
		for name, r := range byRepo[k] {
			r.Slots = len(slotsRepo[k][name])
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
// TABLERO_DATA · junto al binario (`server/bin/pulse` → `../../data`) · relativo al cwd.
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
