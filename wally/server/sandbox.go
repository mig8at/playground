package main

// La carpeta de pruebas (wally/pruebas): el único lugar donde un agente ESCRIBE. Páginas estáticas, sin dependencias.
// Todo lo demás de Wally es de sólo lectura; esto sigue siendo seguro en Auto porque la ruta se valida acá (adentro de
// la carpeta, tipos de archivo fijos, tamaño con tope), no se ejecuta nada y lo escrito se sirve aislado (sandboxHeaders).

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

const (
	sandboxDir      = "wally/pruebas"
	sandboxMaxBytes = 400_000 // por archivo
	sandboxMaxFiles = 60      // por proyecto
)

// sandboxFile: `pruebas/<proyecto>[/<carpeta>…]/<archivo>.<tipo>`. Sin `..`, sin puntos al comienzo, tipos de una página.
var (
	sandboxFile = regexp.MustCompile(`^pruebas/((?:[a-z0-9][a-z0-9_-]{0,40}/){1,4}[A-Za-z0-9][A-Za-z0-9_.-]{0,60}\.(?:html|css|js|mjs|json|svg|md|txt|rs|toml|lock))$`)
	sandboxPath = regexp.MustCompile(`^pruebas(?:/((?:[a-z0-9][a-z0-9_-]{0,40}/){0,4}[A-Za-z0-9][A-Za-z0-9_.-]{0,60}))?$`)
	// fileBlock: lo que entrega el modelo, en el orden en que lo escribió: un archivo entero
	// (```archivo pruebas/mi-pagina/index.html … ```) o un parche sobre uno que ya existe (```parche … ```).
	fileBlock = regexp.MustCompile("(?s)```(archivo|parche)[ \\t]+(\\S+)[ \\t]*\\n(.*?)\\n```")
	// patchHunk: un cambio de un parche: el texto que está, y el que lo reemplaza.
	patchHunk = regexp.MustCompile(`(?s)<<<<<<< BUSCAR\n(.*?)\n?=======\n(.*?)\n?>>>>>>> REEMPLAZAR`)
)

// sandboxAbs: la ruta en disco de algo de la carpeta de pruebas, comprobando que de verdad quede adentro (un enlace
// simbólico no la saca).
func (a *app) sandboxAbs(rel string) (string, error) {
	root := filepath.Join(a.root, sandboxDir)
	if err := os.MkdirAll(root, 0o755); err != nil {
		return "", err
	}
	abs := filepath.Join(root, filepath.FromSlash(rel))
	realRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		return "", err
	}
	// Se resuelve el ancestro que ya existe: el archivo puede ser nuevo.
	probe := abs
	for {
		if real, err := filepath.EvalSymlinks(probe); err == nil {
			if real != realRoot && !strings.HasPrefix(real, realRoot+string(filepath.Separator)) {
				return "", errors.New("esa ruta sale de la carpeta de pruebas")
			}
			break
		}
		if probe == root {
			break
		}
		probe = filepath.Dir(probe)
	}
	return abs, nil
}

// writeSandbox guarda un archivo que entregó el modelo. Si ya existía, la versión anterior queda en `.historial/`.
func (a *app) writeSandbox(path, content string) (string, error) {
	note, _, err := a.writeSandboxChange(path, content)
	return note, err
}

// writeSandboxChange es writeSandbox que además dice qué cambió (para la tarjeta del comando).
func (a *app) writeSandboxChange(path, content string) (string, fileChange, error) {
	m := sandboxFile.FindStringSubmatch(path)
	if m == nil {
		return "", fileChange{}, errors.New("sólo se escribe en pruebas/<proyecto>/…, con nombre simple y tipo html, css, js, mjs, json, svg, md, txt, rs, toml o lock")
	}
	if len(content) > sandboxMaxBytes {
		return "", fileChange{}, fmt.Errorf("el archivo pesa %d bytes y el tope es %d: partilo", len(content), sandboxMaxBytes)
	}
	abs, err := a.sandboxAbs(m[1])
	if err != nil {
		return "", fileChange{}, err
	}
	project := strings.SplitN(m[1], "/", 2)[0]
	if n := a.sandboxCount(project); n >= sandboxMaxFiles {
		if _, err := os.Stat(abs); err != nil {
			return "", fileChange{}, fmt.Errorf("el proyecto «%s» ya tiene %d archivos, el tope", project, n)
		}
	}
	note := "nuevo"
	before := ""
	if old, err := os.ReadFile(abs); err == nil {
		if string(old) == content {
			return fmt.Sprintf("%s: sin cambios (%d bytes)", path, len(content)), fileChange{}, nil
		}
		before = string(old)
		keep := filepath.Join(a.root, sandboxDir, ".historial", filepath.FromSlash(m[1])+"."+time.Now().Format("20060102-150405"))
		if err := os.MkdirAll(filepath.Dir(keep), 0o755); err == nil {
			_ = os.WriteFile(keep, old, 0o644)
		}
		note = fmt.Sprintf("reemplaza al anterior de %d bytes, que quedó en .historial", len(old))
	}
	if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
		return "", fileChange{}, err
	}
	if err := os.WriteFile(abs, []byte(content), 0o644); err != nil {
		return "", fileChange{}, err
	}
	return fmt.Sprintf("guardado %s · %d bytes · %d renglones (%s). Se ve en /pruebas/%s", path, len(content), strings.Count(content, "\n")+1, note, m[1]), lineDiff(before, content), nil
}

func (a *app) sandboxCount(project string) int {
	n := 0
	_ = filepath.WalkDir(filepath.Join(a.root, sandboxDir, project), func(_ string, d fs.DirEntry, err error) error {
		if err == nil && !d.IsDir() {
			n++
		}
		return nil
	})
	return n
}

// listSandbox: los archivos de la carpeta (o de un proyecto), con su tamaño. Sin el historial ni las capturas.
func (a *app) listSandbox(rel string) (string, error) {
	base, err := a.sandboxAbs(rel)
	if err != nil {
		return "", err
	}
	root := filepath.Join(a.root, sandboxDir)
	var lines []string
	_ = filepath.WalkDir(base, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() && strings.HasPrefix(d.Name(), ".") && p != base {
			return filepath.SkipDir
		}
		if !d.IsDir() {
			info, _ := d.Info()
			r, _ := filepath.Rel(root, p)
			lines = append(lines, fmt.Sprintf("pruebas/%s · %d bytes", filepath.ToSlash(r), info.Size()))
		}
		return nil
	})
	if len(lines) == 0 {
		return "(todavía no hay archivos ahí)", nil
	}
	sort.Strings(lines)
	return strings.Join(lines, "\n"), nil
}

func (a *app) readSandbox(path string) (string, error) {
	m := sandboxFile.FindStringSubmatch(path)
	if m == nil {
		return "", errors.New("se lee como pruebas/<proyecto>/<archivo>")
	}
	abs, err := a.sandboxAbs(m[1])
	if err != nil {
		return "", err
	}
	raw, err := os.ReadFile(abs)
	if err != nil {
		return fmt.Sprintf("no existe %s (listar pruebas dice qué hay)", path), nil
	}
	return string(raw), nil
}

// checkSandbox abre la página en un Chromium sin ventana (wally/sandbox-check.mjs) y devuelve, en texto, lo que el
// modelo no puede ver: errores de consola, recursos que no cargaron, el esquema de lo que quedó y si se desborda.
func (a *app) checkSandbox(ctx context.Context, rel string) (string, int, error) {
	if rel == "" {
		return "", 1, errors.New("decí qué probar: probar pruebas/<proyecto> o pruebas/<proyecto>/<pagina>.html")
	}
	abs, err := a.sandboxAbs(rel)
	if err != nil {
		return "", 1, err
	}
	target := rel
	if info, err := os.Stat(abs); err != nil {
		return fmt.Sprintf("no existe pruebas/%s", rel), 1, nil
	} else if info.IsDir() {
		target = strings.TrimSuffix(rel, "/") + "/index.html"
	}
	ctx, cancel := context.WithTimeout(ctx, 150*time.Second)
	defer cancel()
	base := a.sandboxShotBase(target)
	_ = os.MkdirAll(filepath.Dir(base), 0o755)
	_ = os.Remove(base + ".json") // el resumen de una corrida anterior no se confunde con el de ésta
	// Los criterios del proyecto (criterios.json en su raíz): lo que la página tiene que HACER. Se pasan siempre: si
	// faltan, `probar` lo dice como un problema, con la forma que tienen que tener.
	project := strings.SplitN(rel, "/", 2)[0]
	cmd := exec.CommandContext(ctx, "node", filepath.Join(a.root, "wally", "sandbox-check.mjs"),
		"http://127.0.0.1:5229/pruebas/"+target, base,
		filepath.Join(a.root, sandboxDir, project, "criterios.json"))
	cmd.Dir = a.root
	out, err := cmd.CombinedOutput()
	if err != nil {
		var ee *exec.ExitError
		if !errors.As(err, &ee) {
			return "", -1, fmt.Errorf("no pude abrir la página: %v", err)
		}
		return string(out), ee.ExitCode(), nil
	}
	return string(out), 0, nil
}

// serveSandbox sirve la carpeta de pruebas AISLADA: lo que escribió un modelo no es de confianza. `sandbox` le da a
// cada documento un origen propio (no ve las cookies ni el almacenamiento de Wally), `connect-src 'none'` y
// `form-action 'none'` le impiden hacer pedidos (ni a la API de Wally ni afuera) —`allow-forms` deja que el evento
// `submit` llegue al JavaScript de la página, que es como valida un formulario; el envío en sí lo corta `form-action`—,
// y sólo carga recursos de la misma
// carpeta (nada de CDNs: la página tiene que ser autocontenida).
func (a *app) serveSandbox(w http.ResponseWriter, r *http.Request) {
	rel := strings.TrimPrefix(r.URL.Path, "/pruebas/")
	if strings.HasSuffix(rel, "/") || rel == "" {
		rel += "index.html"
	}
	for _, part := range strings.Split(rel, "/") {
		if part == "" || strings.HasPrefix(part, ".") {
			http.NotFound(w, r)
			return
		}
	}
	abs, err := a.sandboxAbs(rel)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Security-Policy", "sandbox allow-scripts allow-modals allow-forms; default-src 'self' 'unsafe-inline' data: blob:; connect-src 'none'; form-action 'none'; frame-ancestors *")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "no-store")
	http.ServeFile(w, r, abs)
}

// patchSandbox aplica un parche a un archivo de la carpeta: uno o más cambios «BUSCAR / REEMPLAZAR». Cada texto
// buscado tiene que estar UNA sola vez (si no, no se sabe dónde va); se aplican todos o ninguno. Si un texto no
// aparece tal cual, se prueba sin los espacios del final de cada renglón, que es donde más se equivoca un modelo.
// Lo que falla vuelve como salida para que el modelo lo corrija, no como error del servidor.
func (a *app) patchSandbox(path, patch string) (string, int, error) {
	note, exit, _, err := a.patchSandboxChange(path, patch)
	return note, exit, err
}

// patchSandboxChange es patchSandbox que además dice qué cambió.
func (a *app) patchSandboxChange(path, patch string) (string, int, fileChange, error) {
	m := sandboxFile.FindStringSubmatch(path)
	if m == nil {
		return "sólo se parcha un archivo de pruebas/<proyecto>/…", 1, fileChange{}, nil
	}
	abs, err := a.sandboxAbs(m[1])
	if err != nil {
		return "", -1, fileChange{}, err
	}
	raw, err := os.ReadFile(abs)
	if err != nil {
		return fmt.Sprintf("no existe %s: un parche cambia un archivo que ya está (para uno nuevo, entregalo entero en un bloque archivo)", path), 1, fileChange{}, nil
	}
	hunks := patchHunk.FindAllStringSubmatch(patch, -1)
	if len(hunks) == 0 {
		return "el parche no trae ningún cambio con la forma:\n<<<<<<< BUSCAR\n(texto que está)\n=======\n(texto nuevo)\n>>>>>>> REEMPLAZAR", 1, fileChange{}, nil
	}
	trimEnds := func(s string) string {
		lines := strings.Split(s, "\n")
		for i := range lines {
			lines[i] = strings.TrimRight(lines[i], " \t\r")
		}
		return strings.Join(lines, "\n")
	}
	text := string(raw)
	for i, h := range hunks {
		find, repl := h[1], h[2]
		if find == "" {
			return fmt.Sprintf("el cambio %d no dice qué BUSCAR", i+1), 1, fileChange{}, nil
		}
		n := strings.Count(text, find)
		if n == 0 {
			// Sin los espacios del final de cada renglón, en el archivo y en lo buscado.
			if loose, f := trimEnds(text), trimEnds(find); strings.Count(loose, f) == 1 {
				text, find, n = loose, f, 1
			}
		}
		switch {
		case n == 0:
			first := strings.TrimSpace(strings.SplitN(find, "\n", 2)[0])
			hint := ""
			if first != "" && strings.Contains(text, first) {
				hint = fmt.Sprintf(" Su primer renglón («%s») sí está: lo demás no coincide. Pedí `leer %s` y copiá el texto tal como está.", first, path)
			}
			return fmt.Sprintf("el cambio %d de %d no se aplicó: el texto de BUSCAR no está en %s.%s No se cambió nada.", i+1, len(hunks), path, hint), 1, fileChange{}, nil
		case n > 1:
			return fmt.Sprintf("el cambio %d de %d no se aplicó: el texto de BUSCAR aparece %d veces en %s. Sumale renglones de alrededor para que sea único. No se cambió nada.", i+1, len(hunks), n, path), 1, fileChange{}, nil
		}
		text = strings.Replace(text, find, repl, 1)
	}
	note, change, err := a.writeSandboxChange(path, text)
	if err != nil {
		return err.Error(), 1, fileChange{}, nil
	}
	return fmt.Sprintf("parche aplicado: %d cambio(s). %s", len(hunks), note), 0, change, nil
}

// sandboxPending: por qué una conversación que escribió en la carpeta de pruebas todavía NO puede darse por terminada
// ("" si puede). Es el freno del modo automático (Miguel, 2026-11-17; la idea es la lista de «hecho» de los harness de
// agentes largos): el modelo no decide solo que terminó. Queda pendiente si escribió después de la última
// comprobación (o nunca comprobó), o si la última dejó problemas (errores, o un criterio de criterios.json que no pasa).
//
// La comprobación depende de qué es el proyecto (`kind`): una página se comprueba con `probar`; una API en Rust, con
// `probar-api`. Uno que no es ninguna de las dos (una nota, un JSON suelto) no tiene qué comprobar y no frena: exigirlo
// hacía que el agente inventara una página y un criterio sólo para poder cerrar.
func sandboxPending(c Conversation, kind func(project string) string) string {
	type event struct {
		verb    string
		project string
		exit    int
	}
	var events []event
	for _, m := range c.Messages {
		for _, k := range m.Commands {
			fields := strings.Fields(k.Cmd)
			if k.Status != "corrido" || len(fields) < 2 || !strings.HasPrefix(fields[1], "pruebas/") {
				continue
			}
			project := strings.SplitN(strings.TrimPrefix(fields[1], "pruebas/"), "/", 2)[0]
			// Un comando de consola que cambió archivos del proyecto es una escritura más.
			if fields[0] == "consola" {
				if k.Touched {
					events = append(events, event{"escribir", project, 0})
				}
				continue
			}
			if len(fields) != 2 {
				continue
			}
			events = append(events, event{fields[0], project, k.Exit})
		}
	}
	project := ""
	lastWrite := -1
	for i, e := range events {
		if (e.verb == "escribir" || e.verb == "parchar") && e.exit == 0 {
			lastWrite, project = i, e.project
		}
	}
	if lastWrite < 0 {
		return ""
	}
	check := map[string]string{"pagina": "probar", "rust": "probar-api"}[kind(project)]
	if check == "" {
		return ""
	}
	lastCheck, lastExit := -1, 0
	for i, e := range events {
		if e.verb == check && e.project == project {
			lastCheck, lastExit = i, e.exit
		}
	}
	switch {
	case lastCheck < lastWrite:
		return fmt.Sprintf("Todavía no terminaste: escribiste en pruebas/%s después del último `%s` (o nunca lo corriste). Pedí `%s pruebas/%s` y no cierres hasta que diga «RESULTADO: sin errores».", project, check, check, project)
	case lastExit != 0:
		return fmt.Sprintf("Todavía no terminaste: el último `%s` dejó problemas (están en su salida, arriba). Corregí lo que falla —el código, o el criterio si estaba mal escrito— y volvé a correr `%s`. No cierres hasta que diga «RESULTADO: sin errores».", check, check)
	}
	return ""
}

// pending: GET /api/conversations/{id}/pending → {"reason": "…"} si el modo automático no la puede dar por cerrada.
func (a *app) pending(w http.ResponseWriter, r *http.Request) {
	a.store.mu.Lock()
	c, ok := a.store.convs[r.PathValue("id")]
	reason := ""
	if ok {
		reason = sandboxPending(*c, a.sandboxKind)
	}
	a.store.mu.Unlock()
	if !ok {
		writeErr(w, 404, errors.New("no existe esa conversación"))
		return
	}
	writeJSON(w, 200, map[string]string{"reason": reason})
}

// checkReport: el resultado de `probar` en datos, para la tarjeta (lo escribe sandbox-check.mjs junto a las capturas).
type checkReport struct {
	Problems int      `json:"problems"`
	Errors   []string `json:"errors,omitempty"`
	Overflow []string `json:"overflow,omitempty"`
	Note     string   `json:"note,omitempty"` // «falta criterios.json», etc.
	Criteria []struct {
		Name   string `json:"name"`
		OK     bool   `json:"ok"`
		Detail string `json:"detail,omitempty"`
	} `json:"criteria,omitempty"`
}

// sandboxShotBase: dónde quedan las capturas y el resumen de `probar` de una página (sin la extensión).
func (a *app) sandboxShotBase(target string) string {
	return filepath.Join(a.root, sandboxDir, ".capturas", strings.ReplaceAll(strings.TrimSuffix(target, ".html"), "/", "--"))
}

// sandboxReport lee el resumen que dejó el último `probar <cmd>` (nil si no hay).
func (a *app) sandboxReport(cmd string) *checkReport {
	m := sandboxPath.FindStringSubmatch(strings.TrimPrefix(cmd, "probar "))
	if m == nil || m[1] == "" {
		return nil
	}
	target := m[1]
	if !strings.HasSuffix(target, ".html") {
		target = strings.TrimSuffix(target, "/") + "/index.html"
	}
	raw, err := os.ReadFile(a.sandboxShotBase(target) + ".json")
	if err != nil {
		return nil
	}
	var r checkReport
	if json.Unmarshal(raw, &r) != nil {
		return nil
	}
	return &r
}

// sandboxKind: qué es un proyecto de la carpeta, que decide cómo se comprueba: "rust" (tiene Cargo.toml), "pagina"
// (tiene algún .html) o "" (nada que comprobar).
func (a *app) sandboxKind(project string) string {
	dir := filepath.Join(a.root, sandboxDir, project)
	if _, err := os.Stat(filepath.Join(dir, "Cargo.toml")); err == nil {
		return "rust"
	}
	found := false
	_ = filepath.WalkDir(dir, func(p string, d fs.DirEntry, err error) error {
		if err == nil && !d.IsDir() && strings.HasSuffix(p, ".html") {
			found = true
			return filepath.SkipAll
		}
		return nil
	})
	if found {
		return "pagina"
	}
	return ""
}
