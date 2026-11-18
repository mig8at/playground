package main

// La carpeta de pruebas (wally/pruebas): el único lugar donde un agente ESCRIBE. Páginas estáticas, sin dependencias.
// Todo lo demás de Wally es de sólo lectura; esto sigue siendo seguro en Auto porque la ruta se valida acá (adentro de
// la carpeta, tipos de archivo fijos, tamaño con tope), no se ejecuta nada y lo escrito se sirve aislado (sandboxHeaders).

import (
	"context"
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
	sandboxFile = regexp.MustCompile(`^pruebas/((?:[a-z0-9][a-z0-9_-]{0,40}/){1,4}[A-Za-z0-9][A-Za-z0-9_.-]{0,60}\.(?:html|css|js|mjs|json|svg|md|txt))$`)
	sandboxPath = regexp.MustCompile(`^pruebas(?:/((?:[a-z0-9][a-z0-9_-]{0,40}/){0,4}[A-Za-z0-9][A-Za-z0-9_.-]{0,60}))?$`)
	// fileBlock: un archivo que entrega el modelo: ```archivo pruebas/mi-pagina/index.html … ```
	fileBlock = regexp.MustCompile("(?s)```archivo[ \\t]+(\\S+)[ \\t]*\\n(.*?)\\n```")
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
	m := sandboxFile.FindStringSubmatch(path)
	if m == nil {
		return "", errors.New("sólo se escribe en pruebas/<proyecto>/…, con nombre simple y tipo html, css, js, mjs, json, svg, md o txt")
	}
	if len(content) > sandboxMaxBytes {
		return "", fmt.Errorf("el archivo pesa %d bytes y el tope es %d: partilo", len(content), sandboxMaxBytes)
	}
	abs, err := a.sandboxAbs(m[1])
	if err != nil {
		return "", err
	}
	project := strings.SplitN(m[1], "/", 2)[0]
	if n := a.sandboxCount(project); n >= sandboxMaxFiles {
		if _, err := os.Stat(abs); err != nil {
			return "", fmt.Errorf("el proyecto «%s» ya tiene %d archivos, el tope", project, n)
		}
	}
	note := "nuevo"
	if old, err := os.ReadFile(abs); err == nil {
		if string(old) == content {
			return fmt.Sprintf("%s: sin cambios (%d bytes)", path, len(content)), nil
		}
		keep := filepath.Join(a.root, sandboxDir, ".historial", filepath.FromSlash(m[1])+"."+time.Now().Format("20060102-150405"))
		if err := os.MkdirAll(filepath.Dir(keep), 0o755); err == nil {
			_ = os.WriteFile(keep, old, 0o644)
		}
		note = fmt.Sprintf("reemplaza al anterior de %d bytes, que quedó en .historial", len(old))
	}
	if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
		return "", err
	}
	if err := os.WriteFile(abs, []byte(content), 0o644); err != nil {
		return "", err
	}
	return fmt.Sprintf("guardado %s · %d bytes · %d renglones (%s). Se ve en /pruebas/%s", path, len(content), strings.Count(content, "\n")+1, note, m[1]), nil
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
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	shots := filepath.Join(a.root, sandboxDir, ".capturas")
	_ = os.MkdirAll(shots, 0o755)
	cmd := exec.CommandContext(ctx, "node", filepath.Join(a.root, "wally", "sandbox-check.mjs"),
		"http://127.0.0.1:5229/pruebas/"+target, filepath.Join(shots, strings.ReplaceAll(strings.TrimSuffix(target, ".html"), "/", "--")))
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
