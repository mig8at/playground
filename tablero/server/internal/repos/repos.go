// Package repos es la fuente ÚNICA de los repos del playground: dónde está clonado cada uno, qué ref
// mirar, qué existe en `main` y cómo se cita un archivo.
//
// La LISTA vive en `tools/repos.json`, que leen este paquete y `tools/repos.py` (el lado Python, que
// para todo lo que toca git le pregunta a `cmd/repos`). La lógica vive acá.
//
// ⚠ POR QUÉ UNA SOLA COPIA. No es prolijidad: está medido. El 2026-09-18 el código se resolvía contra
// el `main` LOCAL de cada clon —que nadie actualiza— y de esa ÚNICA causa salieron cinco mentiras en
// cinco herramientas distintas: rutas buenas marcadas para borrar, deriva real dada por sana, 400
// mensajes de log de menos, 391 hardcodes en vez de 409. Ninguna falló: todas devolvieron menos, y
// «menos» se lee igual que «no existe». Dos copias de esta lista producirían exactamente eso.
//
// ⚠ EL CRITERIO PARA AGREGAR UN REPO es que el servicio esté VIVO EN PRODUCCIÓN, no que exista en el
// disco: se comprueba preguntándole a Loki qué `service_name` emitió en los últimos 7 días. Hasta el
// 2026-08-07 se conocían 5 repos mientras producción corría 14 servicios, y cualquier cita a los 9
// que faltaban dropeaba en silencio (F-123). `harness` y `trazador` no son repos: son subdirectorios
// de playground, y `git ls-tree` desde ahí devuelve rutas relativas a ese directorio, que es justo el
// `relpath` con que se nombra un archivo.
package repos

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// StaleDays: a partir de acá se avisa que la ref que se miró puede estar detrás de origin.
const StaleDays = 14

type list struct {
	Indexed     map[string]string `json:"indexed"`
	CitableOnly map[string]string `json:"citable_only"`
	Extensions  []string          `json:"extensions"`
}

// Client resuelve repos contra la lista de `tools/repos.json`.
type Client struct {
	Playground string
	indexed    map[string]string // lo que workers indexa: repos de la compañía y herramientas propias
	citable    map[string]string // indexed + playground y playground-equipo, que una tarea cita
	exts       map[string]bool
	loadErr    error

	refs sync.Map // root → refChoice, cacheado por proceso: resolverla son cuatro llamadas a git
	once sync.Once
	web  map[string]Web
}

type refChoice struct{ ref, reason string }

// New recibe la carpeta `tools/` del playground; `layout.Find().Tools()` dice dónde está.
func New(tools string) *Client {
	c := &Client{Playground: filepath.Dir(tools), indexed: map[string]string{}, citable: map[string]string{}, exts: map[string]bool{}}
	raw, err := os.ReadFile(filepath.Join(tools, "repos.json"))
	if err != nil {
		c.loadErr = fmt.Errorf("no pude leer la lista de repos: %w", err)
		return c
	}
	var l list
	if err := json.Unmarshal(raw, &l); err != nil {
		c.loadErr = fmt.Errorf("tools/repos.json no es JSON válido: %w", err)
		return c
	}
	for alias, path := range l.Indexed {
		c.indexed[alias] = c.expand(path)
		c.citable[alias] = c.indexed[alias]
	}
	for alias, path := range l.CitableOnly {
		c.citable[alias] = c.expand(path)
	}
	for _, e := range l.Extensions {
		c.exts[e] = true
	}
	return c
}

func (c *Client) expand(path string) string {
	if rest, ok := strings.CutPrefix(path, "~/"); ok {
		return filepath.Join(os.Getenv("HOME"), rest)
	}
	if filepath.IsAbs(path) {
		return path
	}
	return filepath.Clean(filepath.Join(c.Playground, path))
}

// Indexed: alias → carpeta, de lo que workers indexa.
func (c *Client) Indexed() map[string]string { return c.indexed }

// Citable: alias → carpeta, de todo lo que un bloque del tablero puede citar.
func (c *Client) Citable() map[string]string { return c.citable }

// Extensions: sólo código. Un `.md`, `.sql` o `.yaml` no se indexa y una cita a él cae en «no existe».
func (c *Client) Extensions() []string {
	out := make([]string, 0, len(c.exts))
	for e := range c.exts {
		out = append(out, e)
	}
	sort.Strings(out)
	return out
}

/* IsLocal: ¿el alias apunta a una HERRAMIENTA DE ESTE REPO y no a un repo de la compañía? Se DERIVA de
 * la ruta; no hay lista. Una lista a mano se desactualiza el día que se agregue una herramienta.
 * ⚠ Un alias DESCONOCIDO no es local: si lo fuera, un alias mal escrito desaparecería en silencio. */
func (c *Client) IsLocal(alias string) bool {
	root, ok := c.indexed[alias]
	if !ok {
		return false
	}
	return root == c.Playground || strings.HasPrefix(root, c.Playground+string(os.PathSeparator))
}

func git(root string, timeout time.Duration, args ...string) (int, string) {
	cmd := exec.Command("git", append([]string{"-C", root}, args...)...)
	done := make(chan struct{})
	var out []byte
	var err error
	go func() { out, err = cmd.Output(); close(done) }()
	select {
	case <-done:
	case <-time.After(timeout):
		_ = cmd.Process.Kill()
		<-done
		return 1, ""
	}
	if err != nil {
		if exit, ok := err.(*exec.ExitError); ok {
			return exit.ExitCode(), strings.TrimSpace(string(out))
		}
		return 1, ""
	}
	return 0, strings.TrimSpace(string(out))
}

func isRepo(root string) bool {
	_, err := os.Stat(filepath.Join(root, ".git"))
	return err == nil
}

/* RefreshRemotes hace `git fetch` de cada repo, EN PARALELO, y devuelve los alias que fallaron. Es de
 * solo lectura: actualiza refs remotas y no toca ni el working tree ni ninguna rama local. En serie
 * son ~2 s por repo; en paralelo, el más lento. Un fetch que falla no rompe nada: se sigue con lo que
 * haya en disco y se devuelve el alias para que quien llame lo diga. */
func (c *Client) RefreshRemotes(timeout time.Duration) []string {
	var mu sync.Mutex
	var failed []string
	var wg sync.WaitGroup
	sem := make(chan struct{}, 8)
	for alias, root := range c.indexed {
		if !isRepo(root) {
			continue
		}
		wg.Add(1)
		go func(alias, root string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			if code, _ := git(root, timeout, "fetch", "--quiet", "origin"); code != 0 {
				mu.Lock()
				failed = append(failed, alias)
				mu.Unlock()
			}
		}(alias, root)
	}
	wg.Wait()
	sort.Strings(failed)
	return failed
}

/* RefToIndex es la ref que hay que mirar, con su motivo para poder imprimirlo.
 *
 * «main» local no alcanza: medido el 2026-09-18, `legacy-backend` estaba 14 commits detrás de
 * `origin/main`. Pero «siempre origin/main» es igual de falso: playground va ADELANTE de su origin a
 * propósito, porque el push lo decide Miguel. La regla que sirve para los dos es la relación: se mira
 * la ref que CONTIENE a la otra. ⚠ NO HACE FETCH: resuelve con lo que hay en disco. */
func (c *Client) RefToIndex(root string) (string, string) {
	if cached, ok := c.refs.Load(root); ok {
		choice := cached.(refChoice)
		return choice.ref, choice.reason
	}
	ref, reason := refToIndex(root, "main")
	c.refs.Store(root, refChoice{ref, reason})
	return ref, reason
}

func refToIndex(root, branch string) (string, string) {
	const t = 30 * time.Second
	remote := "origin/" + branch
	local, _ := git(root, t, "rev-parse", "--verify", "--quiet", branch)
	hasRemote, _ := git(root, t, "rev-parse", "--verify", "--quiet", remote)
	switch {
	case local != 0 && hasRemote != 0:
		return "", fmt.Sprintf("no existe ni %s ni %s", branch, remote)
	case hasRemote != 0:
		return branch, "sin remoto"
	case local != 0:
		return remote, "sin rama local"
	}
	count := func(spec string) string {
		_, n := git(root, t, "rev-list", "--count", spec)
		if n == "" {
			return "0"
		}
		return n
	}
	if code, _ := git(root, t, "merge-base", "--is-ancestor", branch, remote); code == 0 {
		if behind := count(branch + ".." + remote); behind != "0" {
			return remote, "el local va " + behind + " detrás"
		}
		return remote, "al día"
	}
	ahead, behind := count(remote+".."+branch), count(branch+".."+remote)
	if behind != "0" {
		return branch, fmt.Sprintf("DIVERGEN (local +%s / remoto +%s) — se mira el local", ahead, behind)
	}
	return branch, "el local va " + ahead + " adelante"
}

// TodayRef: la ref contra la que se compara el «hoy» de un repo. No es una constante: se decide por repo.
func (c *Client) TodayRef(alias string) string {
	root, ok := c.indexed[alias]
	if !ok {
		return "main"
	}
	if ref, _ := c.RefToIndex(root); ref != "" {
		return ref
	}
	return "main"
}

// Unverified es un repo que no se pudo consultar: no se cuenta como si estuviera bien.
type Unverified struct {
	Alias  string `json:"alias"`
	Reason string `json:"reason"`
}

// Stale es un repo cuya ref mirada tiene más de StaleDays días: el aviso de que puede faltar un fetch.
type Stale struct {
	Alias string `json:"alias"`
	Days  int    `json:"days"`
	Ref   string `json:"ref"`
}

/* InRef: los archivos de código que existen en `ref`, como `alias/relpath`, más lo que no se pudo
 * consultar y las refs viejas. Con `ref` vacío la ref se resuelve POR REPO (RefToIndex); una ref
 * explícita no se toca: si alguien pide `qa`, quiere `qa`. `git ls-tree` es de solo lectura. */
func (c *Client) InRef(ref string) (have []string, unverified []Unverified, stale []Stale) {
	aliases := make([]string, 0, len(c.indexed))
	for alias := range c.indexed {
		aliases = append(aliases, alias)
	}
	sort.Strings(aliases)
	for _, alias := range aliases {
		root := c.indexed[alias]
		if _, err := os.Stat(root); err != nil {
			unverified = append(unverified, Unverified{alias, "el directorio no existe"})
			continue
		}
		use := ref
		if use == "" {
			if use, _ = c.RefToIndex(root); use == "" {
				unverified = append(unverified, Unverified{alias, "no existe ni `main` ni `origin/main`"})
				continue
			}
		}
		// sin --full-name A PROPÓSITO: rutas relativas al directorio consultado (así anda `harness`).
		code, out := git(root, 60*time.Second, "ls-tree", "-r", use, "--name-only")
		if code != 0 {
			unverified = append(unverified, Unverified{alias, "no se pudo leer `" + use + "`"})
			continue
		}
		for _, path := range strings.Split(out, "\n") {
			if path != "" && c.exts[filepath.Ext(path)] {
				have = append(have, alias+"/"+path)
			}
		}
		if code, ts := git(root, 30*time.Second, "log", "-1", "--format=%ct", use); code == 0 {
			if secs, err := strconv.ParseInt(ts, 10, 64); err == nil {
				if days := int(time.Since(time.Unix(secs, 0)).Hours() / 24); days >= StaleDays {
					stale = append(stale, Stale{alias, days, use})
				}
			}
		}
	}
	return have, unverified, stale
}

// File es lo que se sabe de una ruta citada: en qué commit se miró y si existe ahí.
type File struct {
	Alias  string `json:"alias"`
	Path   string `json:"path"`
	Ref    string `json:"ref"`
	Reason string `json:"reason"`
	SHA    string `json:"sha"`
	Exists bool   `json:"exists"`
	Web    string `json:"web"`
	Prefix string `json:"prefix"`
	Error  string `json:"error,omitempty"`
}

// Web es dónde se ve un repo: su URL en GitHub y la carpeta que ocupa adentro (`harness/` en playground).
type Web struct {
	Web    string `json:"web"`
	Prefix string `json:"prefix"`
}

var remoteURL = regexp.MustCompile(`^(?:git@([^:]+):|https?://([^/]+)/)([^/]+)/(.+?)(?:\.git)?/?$`)

/* webOf sale del remoto de cada clon, no de una tabla: `git@github.com-mig:Creditop-SAS/x.git` es
 * `https://github.com/Creditop-SAS/x`. El alias de SSH es de esta máquina y no cambia el repo. */
func webOf(root string) Web {
	var w Web
	if code, url := git(root, 30*time.Second, "remote", "get-url", "origin"); code == 0 {
		if m := remoteURL.FindStringSubmatch(url); m != nil && strings.HasPrefix(m[1]+m[2], "github.com") {
			w.Web = "https://github.com/" + m[3] + "/" + m[4]
		}
	}
	_, w.Prefix = git(root, 30*time.Second, "rev-parse", "--show-prefix")
	return w
}

/* File: ¿existe `path` en `alias`, y en qué commit? Sin `sha` mira la ref de RefToIndex y devuelve su
 * commit, que es el que un bloque deja fijado; con `sha`, comprueba que la ruta exista ahí. NO HACE
 * FETCH: una ruta nueva que todavía no bajó dice «no existe», con la ref que se miró. */
func (c *Client) File(alias, path, sha string) (File, error) {
	if c.loadErr != nil {
		return File{}, c.loadErr
	}
	fail := func(format string, args ...any) (File, error) {
		msg := fmt.Sprintf(format, args...)
		return File{Error: msg}, fmt.Errorf("%s", msg)
	}
	root, ok := c.citable[alias]
	if !ok {
		names := make([]string, 0, len(c.citable))
		for name := range c.citable {
			names = append(names, name)
		}
		sort.Strings(names)
		return fail("repo desconocido «%s»: se pueden citar %s", alias, strings.Join(names, ", "))
	}
	if _, err := os.Stat(root); err != nil {
		return fail("«%s» no está clonado en %s", alias, root)
	}
	path = strings.TrimPrefix(strings.TrimLeft(strings.TrimSpace(path), "/"), "./")
	if path == "" || contains(strings.Split(path, "/"), "..") {
		return fail("ruta inválida «%s»", path)
	}
	ref, reason := sha, "fijado"
	if sha == "" {
		if ref, reason = c.RefToIndex(root); ref == "" {
			return fail("«%s»: %s", alias, reason)
		}
	}
	code, commit := git(root, 30*time.Second, "rev-parse", "--verify", "--quiet", ref+"^{commit}")
	if code != 0 {
		return fail("«%s» no tiene el commit «%s»", alias, ref)
	}
	// `./` hace la ruta relativa a la carpeta consultada: en `harness`, `./pkg/db.ts` es `harness/pkg/db.ts`.
	exists, _ := git(root, 30*time.Second, "cat-file", "-e", commit+":./"+path)
	w := webOf(root)
	return File{Alias: alias, Path: path, Ref: ref, Reason: reason, SHA: commit[:12], Exists: exists == 0, Web: w.Web, Prefix: w.Prefix}, nil
}

func contains(xs []string, x string) bool {
	for _, v := range xs {
		if v == x {
			return true
		}
	}
	return false
}

// Pin devuelve el commit en que existe la ruta: el que un bloque deja fijado en su enlace.
func (c *Client) Pin(alias, path, sha string) (string, error) {
	f, err := c.File(alias, path, sha)
	if err != nil {
		return "", err
	}
	if !f.Exists {
		return "", fmt.Errorf("%s/%s no existe en %s de %s (%s)", alias, f.Path, f.Ref, alias, f.Reason)
	}
	return f.SHA, nil
}

// Web: alias → dónde se ve, de cada repo citable que está clonado. Se pregunta una vez por proceso.
func (c *Client) Web() (map[string]Web, error) {
	if c.loadErr != nil {
		return nil, c.loadErr
	}
	c.once.Do(func() {
		c.web = map[string]Web{}
		for alias, root := range c.citable {
			if _, err := os.Stat(root); err == nil {
				c.web[alias] = webOf(root)
			}
		}
	})
	return c.web, nil
}

// Knows dice si un alias se puede citar.
func (c *Client) Knows(alias string) bool {
	web, err := c.Web()
	if err != nil {
		return false
	}
	_, ok := web[alias]
	return ok
}
