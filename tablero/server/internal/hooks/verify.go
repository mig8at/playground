package hooks

/* verify: al terminar de responder, corre los chequeos de las zonas del código que ESTA sesión escribió,
 * y si alguno falla devuelve `decision: block` con la salida — el modelo retoma el turno para arreglarlo.
 *
 * EL PROBLEMA: `closeout` mira las piezas de la tarea, no que el código compile. El 2026-09-27 apareció
 * un error de `tsc` en dos archivos del harness (`dev/codigo-qa.ts`, `bin/client-code.ts`) que venía del
 * commit `ca535a53`: nadie lo vio porque nadie corrió `make harness-check` hasta que hizo falta por otra
 * cosa. Los chequeos existían; lo que faltaba era que se corrieran solos.
 *
 * TRES DECISIONES, y cada una evita un modo de falla conocido de este tipo de hook:
 *   - SÓLO LO QUE LA SESIÓN ESCRIBIÓ, con la misma regla que `closeout` (leer no es tocar). Varias sesiones
 *     trabajan sobre el mismo worktree: una no tiene que pagar los chequeos de lo que tocó otra.
 *   - UNA VEZ POR ESTADO DEL ÁRBOL, no por turno. Cada chequeo guarda la huella de su zona (el árbol en
 *     HEAD + lo que no está commiteado) y el resultado. Con la misma huella no se vuelve a correr: un verde
 *     no se repite, y un rojo se avisa una sola vez — si el fallo no es de esta sesión, no la persigue en
 *     cada respuesta. Cambia el árbol, se vuelve a medir.
 *   - `stop_hook_active` corta el bucle que el propio block dispara.
 *
 * Y lo que NO hace, a propósito: `make tablero-naming`. Hoy falla por 22 nombres en español que ya estaban
 * en el harness antes de este hook; sumado acá, frenaría a cualquier sesión que toque el harness por una
 * deuda ajena. Entra cuando esa deuda se pague.
 *
 * Si algo falla por dentro —sin transcript, sin git, sin Go— sale 0 en silencio. */

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"
)

// zone es un chequeo y el código que lo dispara.
type zone struct {
	name     string   // el nombre en el aviso y en la marca de cache
	prefixes []string // carpetas, relativas a la raíz, con la barra final
	exts     []string // extensiones que cuentan; vacío = todas
	// commands arma lo que corre, a partir de los prefijos tocados (el de Go prueba sólo esos paquetes).
	commands func(touched []string) [][]string
}

var verifyZones = []zone{
	{
		name:     "harness-check",
		prefixes: []string{"harness/"},
		exts:     []string{".ts"},
		commands: func([]string) [][]string { return [][]string{{"make", "--no-print-directory", "harness-check"}} },
	},
	{
		name:     "go",
		prefixes: []string{"tablero/server/", "trazador/server/", "visor/", "cmd/", "connectors/", "lib/", "knowledge/"},
		exts:     []string{".go"},
		commands: func(touched []string) [][]string {
			pkgs := make([]string, 0, len(touched))
			for _, p := range touched {
				pkgs = append(pkgs, "./"+p+"...")
			}
			return [][]string{append([]string{"go", "vet"}, pkgs...), append([]string{"go", "test"}, pkgs...)}
		},
	},
	{
		name:     "estilo-check",
		prefixes: []string{"tools/ui/", "tablero/src/", "trazador/src/", "harness/panel/", "visor/"},
		exts:     []string{".css", ".vue"},
		commands: func([]string) [][]string { return [][]string{{"make", "--no-print-directory", "estilo-check"}} },
	},
}

// writtenFiles: las rutas, relativas a root, que la sesión escribió con Write/Edit, más las carpetas de
// zona que un comando de Bash escribió (con los mismos patrones que `closeout`: la ruta pegada al verbo).
func writtenFiles(pieces []piece, root string) []string {
	var files []string
	for _, p := range pieces {
		if p.tool != "Write" && p.tool != "Edit" && p.tool != "NotebookEdit" {
			continue
		}
		var in struct {
			FilePath     string `json:"file_path"`
			NotebookPath string `json:"notebook_path"`
		}
		if json.Unmarshal([]byte(p.input), &in) != nil {
			continue
		}
		path := in.FilePath
		if path == "" {
			path = in.NotebookPath
		}
		if rel, err := filepath.Rel(root, path); err == nil && !strings.HasPrefix(rel, "..") {
			files = append(files, filepath.ToSlash(rel))
		}
	}
	return files
}

// touchedPrefixes: los prefijos de la zona que la sesión escribió. Por Bash no se sabe la extensión, así
// que ahí alcanza con que el comando escriba adentro de la carpeta.
func (z zone) touchedPrefixes(files []string, pieces []piece) []string {
	var out []string
	for _, prefix := range z.prefixes {
		hit := false
		for _, f := range files {
			if strings.HasPrefix(f, prefix) && (len(z.exts) == 0 || slices.Contains(z.exts, filepath.Ext(f))) {
				hit = true
				break
			}
		}
		if !hit {
			var bash []piece
			for _, p := range pieces {
				if p.tool == "Bash" {
					bash = append(bash, p)
				}
			}
			hit = wrote(bash, prefix)
		}
		if hit {
			out = append(out, prefix)
		}
	}
	return out
}

// fingerprint: el estado de la zona entera —el árbol en HEAD, el diff sin commitear y los archivos nuevos—.
// No sólo lo que tocó la sesión: un chequeo mira la zona entera, así que su resultado depende de toda.
func fingerprint(root string, prefixes []string) (string, bool) {
	h := sha256.New()
	for _, p := range prefixes {
		_, tree, _, _ := run(root, 10*time.Second, "git", "rev-parse", "HEAD:"+strings.TrimSuffix(p, "/"))
		h.Write([]byte(p + "\x00" + tree))
	}
	args := append([]string{"diff", "HEAD", "--binary", "--"}, prefixes...)
	_, diff, _, err := run(root, 20*time.Second, "git", args...)
	if err != nil {
		return "", false
	}
	h.Write([]byte(diff))
	args = append([]string{"ls-files", "-o", "--exclude-standard", "--"}, prefixes...)
	_, untracked, _, err := run(root, 10*time.Second, "git", args...)
	if err != nil {
		return "", false
	}
	for _, f := range strings.Fields(untracked) {
		if body, err := os.ReadFile(filepath.Join(root, f)); err == nil {
			h.Write([]byte(f + "\x00"))
			h.Write(body)
		}
	}
	return hex.EncodeToString(h.Sum(nil)), true
}

type verdict struct {
	Fingerprint string `json:"fingerprint"`
	OK          bool   `json:"ok"`
}

// tail: las últimas n líneas no vacías, que es donde un compilador o un test dicen qué falló.
func tail(s string, n int) string {
	lines := strings.Split(strings.TrimRight(s, "\n"), "\n")
	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}
	return strings.Join(lines, "\n")
}

// Verify es el hook de Stop que corre los chequeos.
func Verify(env Env) int {
	payload, ok := readPayload(env.Stdin)
	if !ok {
		return 0
	}
	if active, _ := payload["stop_hook_active"].(bool); active {
		return 0
	}
	pieces := readTranscript(str(payload, "transcript_path"))
	if len(pieces) == 0 {
		return 0
	}
	files := writtenFiles(pieces, env.Root)
	cache := filepath.Join(env.Root, "tablero", "data", "cache")

	var failures []string
	for _, z := range verifyZones {
		touched := z.touchedPrefixes(files, pieces)
		if len(touched) == 0 {
			continue
		}
		fp, ok := fingerprint(env.Root, z.prefixes)
		if !ok {
			continue
		}
		mark := filepath.Join(cache, "verify-"+z.name+".json")
		var last verdict
		if raw, err := os.ReadFile(mark); err == nil && json.Unmarshal(raw, &last) == nil && last.Fingerprint == fp {
			continue // ya se midió este mismo estado: el verde no se repite y el rojo ya se avisó
		}
		passed := true
		var report strings.Builder
		for _, cmd := range z.commands(touched) {
			code, out, errOut, err := run(env.Root, 5*time.Minute, cmd[0], cmd[1:]...)
			if err != nil && code == 0 {
				passed = false // no arrancó o se pasó del tope: se dice, no se da por bueno
				fmt.Fprintf(&report, "$ %s\n(no se pudo correr: %s)\n", strings.Join(cmd, " "), err)
				break
			}
			if code != 0 {
				passed = false
				fmt.Fprintf(&report, "$ %s   → salió %d\n%s\n", strings.Join(cmd, " "), code, tail(out+errOut, 25))
				break
			}
		}
		if os.MkdirAll(cache, 0o755) == nil {
			if raw, err := json.Marshal(verdict{fp, passed}); err == nil {
				_ = os.WriteFile(mark, raw, 0o644)
			}
		}
		if !passed {
			failures = append(failures, "✗ "+z.name+" (tocaste "+strings.Join(touched, ", ")+")\n"+strings.TrimRight(report.String(), "\n"))
		}
	}
	if len(failures) == 0 {
		return 0
	}
	reason := "VERIFICACIÓN · falló un chequeo de código que esta sesión tocó " +
		"(hook verify, tablero/server/internal/hooks/verify.go):\n\n" + strings.Join(failures, "\n\n") +
		"\n\nArreglalo antes de dar esto por terminado. Si el fallo no es de esta sesión, decilo en una línea y " +
		"seguí: no se vuelve a avisar hasta que cambie el código de esa zona."
	var sb strings.Builder
	sb.WriteString(`{"decision": "block", "reason": `)
	writeString(&sb, reason)
	sb.WriteString("}")
	fmt.Fprintln(env.Stdout, sb.String())
	return 0
}
