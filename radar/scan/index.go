package scan

/* El índice en disco y los filtros sobre las sesiones. Vivían en el comando (`radar/server`) y se mudaron
 * acá el 2026-09-27 para que el cierre del tablero (`make cierre`) lea la fricción del día con el MISMO
 * código, sin llamar a radar como subproceso. */

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

func gitOutput(dir string, args ...string) (string, error) {
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	out, err := cmd.Output()
	return string(out), err
}

// indexVersion cambia cada vez que cambia CÓMO se clasifica una llamada: el índice guarda las llamadas ya
// clasificadas, y sin esto un arreglo del parser no se aplicaría a lo que ya estaba leído.
const indexVersion = 8

// CachePath es el índice de radar dentro del playground.
func CachePath(root string) string { return filepath.Join(root, "radar", ".cache", "sessions.json") }

// cacheFile es el índice en disco.
type cacheFile struct {
	Version int                   `json:"version"`
	Entries map[string]cacheEntry `json:"entries"`
}

// cacheEntry: una transcripción ya leída, con la huella del archivo con que se leyó.
type cacheEntry struct {
	Size    int64     `json:"size"`
	ModTime time.Time `json:"modTime"`
	Session Session   `json:"session"`
}

// LoadSessions lee las transcripciones, reusando las que no cambiaron desde la última vez.
func LoadSessions(dirs []string, cachePath string) ([]Session, int, error) {
	var stored cacheFile
	if raw, err := os.ReadFile(cachePath); err == nil {
		_ = json.Unmarshal(raw, &stored)
	}
	cache := stored.Entries
	if stored.Version != indexVersion || cache == nil {
		cache = map[string]cacheEntry{}
	}
	fresh := map[string]cacheEntry{}
	read := 0
	var sessions []Session
	for _, dir := range dirs {
		files, _ := filepath.Glob(filepath.Join(dir, "*.jsonl"))
		for _, f := range files {
			info, err := os.Stat(f)
			if err != nil {
				continue
			}
			e, ok := cache[f]
			if !ok || e.Size != info.Size() || !e.ModTime.Equal(info.ModTime()) {
				s, err := ReadSession(f)
				if err != nil {
					continue
				}
				e = cacheEntry{Size: info.Size(), ModTime: info.ModTime(), Session: s}
				read++
			}
			fresh[f] = e
			sessions = append(sessions, e.Session)
		}
	}
	if raw, err := json.Marshal(cacheFile{Version: indexVersion, Entries: fresh}); err == nil {
		if os.MkdirAll(filepath.Dir(cachePath), 0o755) == nil {
			_ = os.WriteFile(cachePath, raw, 0o644)
		}
	}
	sort.Slice(sessions, func(i, j int) bool { return sessions[i].Start.Before(sessions[j].Start) })
	return dedupeResumed(sessions), read, nil
}

/* dedupeResumed saca las llamadas repetidas entre transcripciones. Al reanudar una sesión, Claude Code
 * abre un archivo nuevo que COPIA la historia anterior, con los mismos ids de herramienta: sin esto, cada
 * reanudación contaba dos veces todo lo que había pasado antes. Medido el 2026-09-27: los dos «huecos de
 * canon» que se repetían «en 2 sesiones» eran cada uno UNA llamada vista en dos archivos. Se queda la
 * primera aparición (las sesiones vienen ordenadas por comienzo). */
func dedupeResumed(sessions []Session) []Session {
	seen := map[string]bool{}
	for i := range sessions {
		kept := sessions[i].Calls[:0:0]
		for _, c := range sessions[i].Calls {
			if c.ID != "" {
				if seen[c.ID] {
					continue
				}
				seen[c.ID] = true
			}
			kept = append(kept, c)
		}
		sessions[i].Calls = kept
	}
	return sessions
}

// SkillNames: las skills del proyecto, por su carpeta.
func SkillNames(root string) []string {
	entries, _ := os.ReadDir(filepath.Join(root, ".claude", "skills"))
	var out []string
	for _, e := range entries {
		if e.IsDir() {
			out = append(out, e.Name())
		}
	}
	return out
}

// HumanOnly deja las sesiones donde escribió una persona, salvo que se pidan todas; devuelve cuántas sacó.
func HumanOnly(sessions []Session, all bool) ([]Session, int) {
	if all {
		return sessions, 0
	}
	var out []Session
	for _, s := range sessions {
		if s.Human {
			out = append(out, s)
		}
	}
	return out, len(sessions) - len(out)
}

// InRange: las llamadas en [since, until).
func InRange(sessions []Session, since, until time.Time) []Call {
	var out []Call
	for _, s := range sessions {
		for _, c := range s.Calls {
			if !c.Time.Before(since) && c.Time.Before(until) {
				out = append(out, c)
			}
		}
	}
	return out
}

// InPeriod: las llamadas desde `since` hasta ahora.
func InPeriod(sessions []Session, since time.Time) []Call {
	return InRange(sessions, since, time.Now().Add(time.Hour))
}

// CountSince: cuántas sesiones tienen alguna llamada desde `since`.
func CountSince(sessions []Session, since time.Time) int {
	n := 0
	for _, s := range sessions {
		for _, c := range s.Calls {
			if !c.Time.Before(since) {
				n++
				break
			}
		}
	}
	return n
}

// FindSession: la sesión cuyo id empieza con el prefijo; sin prefijo, la más reciente.
func FindSession(sessions []Session, prefix string) (Session, bool) {
	for i := len(sessions) - 1; i >= 0; i-- {
		if prefix == "" || strings.HasPrefix(sessions[i].ID, prefix) {
			return sessions[i], true
		}
	}
	return Session{}, false
}

/* NewFriction: lo que se trabó en el día `day` (medianoche local a medianoche) y NO se había trabado igual
 * en los `lookback` días anteriores. Es lo que el cierre avisa: repetir todos los días lo ya conocido
 * enseña a no leerlo, la misma razón por la que el hook `verify` avisa una vez por estado del árbol.
 *
 * Sólo lo que la tarea #96 pidió mirar: lo que pidió aprobación y no la tuvo, y lo que frenó un hook. */
func NewFriction(sessions []Session, day time.Time, lookback int) Friction {
	start := time.Date(day.Year(), day.Month(), day.Day(), 0, 0, 0, 0, day.Location())
	today := FrictionView(InRange(sessions, start, start.AddDate(0, 0, 1)))
	before := FrictionView(InRange(sessions, start.AddDate(0, 0, -lookback), start))
	fresh := func(now, old []Count) []Count {
		seen := map[string]bool{}
		for _, r := range old {
			seen[r.Key] = true
		}
		var out []Count
		for _, r := range now {
			if !seen[r.Key] {
				out = append(out, r)
			}
		}
		return out
	}
	return Friction{Denied: fresh(today.Denied, before.Denied), Blocked: fresh(today.Blocked, before.Blocked)}
}
