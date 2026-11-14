package check

// LOS SERVICIOS DE FONDO DE MY-TOOLS: los LaunchAgents `com.creditop.*` (el chat, sentinel, correo, el pulso) y el
// listen del chat del equipo.
//
// POR QUÉ EXISTE. Un servicio de fondo que se cae no avisa: el 2026-11-14 el pulso llevaba ~21 h sin correr (salía
// 78 porque apuntaba a la carpeta de antes del renombre a my-tools), sentinel corría un binario que ya no existía en
// disco y el listen del chat estaba apagado desde el 2026-11-10. Las tres cosas se vieron por casualidad. Cada fila
// mira, sin tocar nada, lo que el propio LaunchAgent declara: que su programa y sus carpetas existan, que corra
// (si es permanente) o que su registro se mueva (si es periódico).

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"creditop/my-tools/chat/cli"
)

// launchAgent es lo que importa de un .plist de ~/Library/LaunchAgents.
type launchAgent struct {
	Label            string            `json:"Label"`
	ProgramArguments []string          `json:"ProgramArguments"`
	WorkingDirectory string            `json:"WorkingDirectory"`
	StandardOutPath  string            `json:"StandardOutPath"`
	KeepAlive        any               `json:"KeepAlive"`
	StartInterval    int               `json:"StartInterval"`
	Environment      map[string]string `json:"EnvironmentVariables"`
}

// absPath encuentra las rutas absolutas dentro de un valor de entorno (`nombre=/ruta, otro=/y`).
var absPath = regexp.MustCompile(`/(?:Users|Applications|private|opt)/[^,=\s]+`)

// agentName es el nombre corto de un LaunchAgent, el mismo de su `make <nombre>-install`.
func agentName(label string) string {
	name := strings.TrimPrefix(label, "com.creditop.")
	for _, p := range []string{"my-tools.", "tablero.", "playground."} {
		name = strings.TrimPrefix(name, p)
	}
	return name
}

func probeBackground(ctx context.Context) []Check {
	home, _ := os.UserHomeDir()
	files, _ := filepath.Glob(filepath.Join(home, "Library", "LaunchAgents", "com.creditop.*.plist"))
	sort.Strings(files)
	var out []Check
	for _, f := range files {
		out = append(out, checkAgent(ctx, f))
	}
	return append(out, checkListen(ctx))
}

func checkAgent(ctx context.Context, file string) Check {
	c := Check{Group: "background", Name: strings.TrimSuffix(filepath.Base(file), ".plist")}
	raw, err := exec.CommandContext(ctx, "plutil", "-convert", "json", "-o", "-", file).Output()
	var a launchAgent
	if err != nil || json.Unmarshal(raw, &a) != nil || a.Label == "" {
		c.State, c.Detail = Fail, "no pude leer "+file
		return c
	}
	name := agentName(a.Label)
	c.Name = name
	fix := " → `make " + name + "-install`"

	// Lo que declara tiene que existir: el programa, su carpeta y las rutas de su entorno.
	var paths []string
	if len(a.ProgramArguments) > 0 {
		paths = append(paths, a.ProgramArguments[0])
	}
	if a.WorkingDirectory != "" {
		paths = append(paths, a.WorkingDirectory)
	}
	keys := make([]string, 0, len(a.Environment))
	for k := range a.Environment {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		if k == "PATH" { // una lista de búsqueda, no algo que el servicio necesite: puede nombrar carpetas que no hay
			continue
		}
		paths = append(paths, absPath.FindAllString(a.Environment[k], -1)...)
	}
	for _, p := range paths {
		if _, err := os.Stat(p); err != nil {
			c.State, c.Detail = Fail, "apunta a "+p+", que no existe"+fix
			return c
		}
	}

	pid, last, loaded := launchctlState(ctx, a.Label)
	if !loaded {
		c.State, c.Detail = Fail, "instalado pero no cargado en launchd"+fix
		return c
	}

	// Periódico (el pulso): lo que dice que anda es que su registro se mueva.
	if a.StartInterval > 0 {
		every := time.Duration(a.StartInterval) * time.Second
		age, ok := logAge(a.StandardOutPath)
		switch {
		case !ok:
			c.State, c.Detail = Warn, "cada "+human(every)+", pero no encuentro su registro ("+a.StandardOutPath+")"
		case age > 3*every:
			c.State, c.Detail = Fail, fmt.Sprintf("no corre desde hace %s (cada %s; último código %d)%s", human(age), human(every), last, fix)
		default:
			c.State, c.Detail = OK, "cada "+human(every)+" · corrió hace "+human(age)
		}
		return c
	}

	// Permanente (KeepAlive): tiene que tener proceso.
	if pid == 0 {
		c.State, c.Detail = Fail, fmt.Sprintf("no corre (último código %d)%s", last, fix)
		return c
	}
	c.State, c.Detail = OK, "corre (pid "+strconv.Itoa(pid)+")"
	return c
}

var (
	pidLine  = regexp.MustCompile(`"PID" = (\d+);`)
	lastLine = regexp.MustCompile(`"LastExitStatus" = (-?\d+);`)
)

// launchctlState lee `launchctl list <label>`: su proceso (0 si no corre), el último código de salida y si está
// cargado. El código llega multiplicado por 256 cuando es una salida normal (78 → 19968), como lo guarda launchd.
func launchctlState(ctx context.Context, label string) (pid, last int, loaded bool) {
	out, err := exec.CommandContext(ctx, "launchctl", "list", label).Output()
	if err != nil {
		return 0, 0, false
	}
	if m := pidLine.FindSubmatch(out); m != nil {
		pid, _ = strconv.Atoi(string(m[1]))
	}
	if m := lastLine.FindSubmatch(out); m != nil {
		last, _ = strconv.Atoi(string(m[1]))
		if last > 255 && last%256 == 0 {
			last /= 256
		}
	}
	return pid, last, true
}

func logAge(path string) (time.Duration, bool) {
	if path == "" {
		return 0, false
	}
	st, err := os.Stat(path)
	if err != nil {
		return 0, false
	}
	return time.Since(st.ModTime()), true
}

// checkListen dice si el chat recibe en vivo: con el listen apagado, lo que te escriben espera en el buzón.
func checkListen(ctx context.Context) Check {
	c := Check{Group: "background", Name: "listen del chat"}
	if !cli.Installed() {
		c.State, c.Detail = Off, "no está el CLI `playground` en esta máquina"
		return c
	}
	s, err := cli.ListenStatus(ctx)
	switch {
	case err != nil:
		c.State, c.Detail = Warn, err.Error()
	case s == nil:
		c.State, c.Detail = Warn, "apagado: lo que te escriban espera en el buzón → prendelo en el chat (Conexión) o con `playground listen`"
	case !s.Connected:
		c.State, c.Detail = Warn, "prendido pero reconectando"
	default:
		c.State, c.Detail = OK, "escuchando"
		if t, err := time.Parse(time.RFC3339, s.Since); err == nil {
			c.Detail += " desde hace " + human(time.Since(t))
		}
	}
	return c
}
