package notice

// LA BANDEJA: cada aviso, salga o se calle, es una línea de `inbox.jsonl`. La escriben varios procesos (los servicios
// de fondo, `bin/cockpit notify`) y la lee Cockpit. Agregar una línea con O_APPEND no necesita candado; recortar lo
// viejo sí (se reescribe el archivo), así que las dos cosas toman el mismo `flock`.

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"syscall"
	"time"
)

// Keep: cuánto se guarda un aviso.
const Keep = 30 * 24 * time.Hour

// Record: un aviso en la bandeja. Las claves JSON son el contrato con Cockpit (src-tauri/src/notices.rs).
type Record struct {
	ID        string `json:"id"`
	At        string `json:"at"` // RFC3339 en UTC: así se ordena y se compara como texto
	App       string `json:"app"`
	Title     string `json:"title"`
	Body      string `json:"body,omitempty"`
	URL       string `json:"url,omitempty"`
	Group     string `json:"group,omitempty"`
	Important bool   `json:"important,omitempty"`
	Sound     bool   `json:"sound,omitempty"`
	Delivered bool   `json:"delivered"`
	Via       string `json:"via,omitempty"`
	Silenced  string `json:"silenced,omitempty"` // por qué no salió: «no molestar», «pausa», «Sentinel en ninguno»…
	Error     string `json:"error,omitempty"`
}

// Dir: la carpeta de los avisos. MY_TOOLS_NOTICES_DIR la cambia (las pruebas).
func Dir() string {
	if d := os.Getenv("MY_TOOLS_NOTICES_DIR"); d != "" {
		return d
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, "Library", "Application Support", "creditop-my-tools", "notices")
}

func inboxPath() string { return filepath.Join(Dir(), "inbox.jsonl") }

var seq int

func newID(t time.Time) string {
	seq++
	return fmt.Sprintf("%d-%d-%d", t.UnixNano(), os.Getpid(), seq)
}

// lock toma el candado de la bandeja entre procesos.
func lock() (func(), error) {
	if err := os.MkdirAll(Dir(), 0o755); err != nil {
		return nil, err
	}
	f, err := os.OpenFile(filepath.Join(Dir(), "inbox.lock"), os.O_CREATE|os.O_RDWR, 0o644)
	if err != nil {
		return nil, err
	}
	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX); err != nil {
		f.Close()
		return nil, err
	}
	return func() { _ = syscall.Flock(int(f.Fd()), syscall.LOCK_UN); f.Close() }, nil
}

func appendRecord(r Record) error {
	unlock, err := lock()
	if err != nil {
		return err
	}
	defer unlock()
	line, err := json.Marshal(r)
	if err != nil {
		return err
	}
	f, err := os.OpenFile(inboxPath(), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return err
	}
	_, err = f.Write(append(line, '\n'))
	f.Close()
	// Recortar lo viejo de vez en cuando: cuando el archivo pasa de 512 KB.
	if st, e := os.Stat(inboxPath()); e == nil && st.Size() > 512<<10 {
		_ = pruneLocked(time.Now())
	}
	return err
}

// readAll lee la bandeja entera; una línea rota se saltea.
func readAll() ([]Record, error) {
	f, err := os.Open(inboxPath())
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	defer f.Close()
	var out []Record
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 64<<10), 4<<20)
	for sc.Scan() {
		var r Record
		if json.Unmarshal(sc.Bytes(), &r) == nil && r.ID != "" {
			out = append(out, r)
		}
	}
	return out, sc.Err()
}

// pruneLocked deja sólo lo de los últimos `Keep`. Se llama con el candado tomado.
func pruneLocked(now time.Time) error {
	all, err := readAll()
	if err != nil {
		return err
	}
	var keep []byte
	for _, r := range all {
		if t, e := time.Parse(time.RFC3339, r.At); e == nil && now.Sub(t) > Keep {
			continue
		}
		line, _ := json.Marshal(r)
		keep = append(append(keep, line...), '\n')
	}
	tmp := inboxPath() + ".tmp"
	if err := os.WriteFile(tmp, keep, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, inboxPath())
}

// List: los avisos, del más nuevo al más viejo. app vacío es todos; limit 0 es sin tope.
func List(app string, limit int) ([]Record, error) {
	all, err := readAll()
	if err != nil {
		return nil, err
	}
	var out []Record
	for _, r := range all {
		if app == "" || r.App == app {
			out = append(out, r)
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].At > out[j].At })
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

// LO LEÍDO: un solo instante, `readUntil`. Lo que salió después y no se calló es «sin leer»; abrir la bandeja en
// Cockpit (o `bin/cockpit notices --read`) lo corre a ahora.
type State struct {
	ReadUntil string `json:"readUntil"`
}

func statePath() string { return filepath.Join(Dir(), "state.json") }

func ReadState() State {
	var s State
	if b, err := os.ReadFile(statePath()); err == nil {
		_ = json.Unmarshal(b, &s)
	}
	return s
}

// MarkRead corre lo leído hasta `t`.
func MarkRead(t time.Time) error {
	if err := os.MkdirAll(Dir(), 0o755); err != nil {
		return err
	}
	b, _ := json.MarshalIndent(State{ReadUntil: t.UTC().Format(time.RFC3339)}, "", "  ")
	tmp := statePath() + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, statePath())
}

// Unread: cuántos avisos salieron (no los callados) después de lo leído.
func Unread(list []Record, s State) int {
	n := 0
	for _, r := range list {
		if r.Silenced == "" && r.At > s.ReadUntil {
			n++
		}
	}
	return n
}
