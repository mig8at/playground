// Package scan recorre un repo y produce "node-lite": por cada archivo de
// código, sus metadatos (imports, definiciones, rutas) SIN el contenido.
//
// Es la versión Go, acotada, del extractor de Carto. El objetivo no es un AST
// perfecto sino un mapa barato y estable: suficiente para que un LLM (o la UI)
// entienda qué hay y cómo se conecta, y luego pida el código real solo de los
// IDs que le interesan.
package scan

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// Node es la ficha "lite" de un archivo. El ID es estable entre escaneos
// (depende solo de repo+path), así que los flujos guardados sobreviven un
// re-scan.
type Node struct {
	ID          string   `json:"id"`
	Repo        string   `json:"repo"`  // alias del repo (nombre de la carpeta)
	Path        string   `json:"path"`  // relativo a la raíz del repo
	Lang        string   `json:"lang"`  // ts, go, php, py, vue…
	Lines       int      `json:"lines"`
	Imports     []string `json:"imports,omitempty"`
	Definitions []string `json:"definitions,omitempty"`
	Routes      []Route  `json:"routes,omitempty"`
	// Tables = tablas SQL que el archivo referencia (DB::table, ->from, $table, Schema…).
	// TableAnchors = tablas que el archivo DEFINE (migración Schema::create o modelo $table);
	// se usan como extremos preferidos del edge cross-repo por tabla compartida.
	Tables       []string `json:"tables,omitempty"`
	TableAnchors []string `json:"table_anchors,omitempty"`
}

// Route es una ruta HTTP detectada. "ingress" = definición en el servidor;
// "candidate" = llamada desde el cliente (fetch/axios). El match ingress↔candidate
// entre repos es lo que dibuja el edge frontend↔backend.
type Route struct {
	Kind   string `json:"kind"`   // ingress | candidate
	Method string `json:"method"` // GET/POST/… o ANY
	Path   string `json:"path"`
}

// NodeID calcula el ID estable de un archivo: <repoAlias>:<hash8>.
func NodeID(repo, relPath string) string {
	sum := sha256.Sum256([]byte(repo + "\x00" + relPath))
	return repo + ":" + hex.EncodeToString(sum[:])[:8]
}

var codeExt = map[string]string{
	".ts": "ts", ".tsx": "ts", ".js": "js", ".jsx": "js", ".mjs": "js", ".cjs": "js",
	".vue": "vue", ".go": "go", ".php": "php", ".py": "py", ".rb": "rb",
	".java": "java", ".kt": "kotlin", ".rs": "rust", ".sql": "sql",
}

var ignoreDir = map[string]bool{
	"node_modules": true, ".git": true, "dist": true, "build": true, "out": true,
	"vendor": true, ".next": true, ".turbo": true, "bin": true, "coverage": true,
	".idea": true, ".vscode": true, "__pycache__": true, ".cache": true,
	"storage": true, "public": true, "assets": true,
}

const maxFileBytes = 512 * 1024

// Repo escanea la raíz de un repo y devuelve sus nodos. alias es el nombre
// corto (por defecto, el basename de root).
func Repo(root, alias string) ([]Node, error) {
	root = filepath.Clean(root)
	if alias == "" {
		alias = filepath.Base(root)
	}
	var nodes []Node

	err := filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return nil // saltamos lo que no podamos leer
		}
		if d.IsDir() {
			// nunca saltamos la raíz; sí las carpetas ignoradas y las ocultas (.git, .vscode…)
			if path != root && (ignoreDir[d.Name()] || (strings.HasPrefix(d.Name(), ".") && len(d.Name()) > 1)) {
				return filepath.SkipDir
			}
			return nil
		}
		lang, ok := codeExt[strings.ToLower(filepath.Ext(path))]
		if !ok {
			return nil
		}
		info, ierr := d.Info()
		if ierr != nil || info.Size() > maxFileBytes {
			return nil
		}
		rel, _ := filepath.Rel(root, path)
		rel = filepath.ToSlash(rel)
		n := extractFile(alias, rel, lang, path)
		nodes = append(nodes, n)
		return nil
	})
	return nodes, err
}

func extractFile(repo, rel, lang, abs string) Node {
	n := Node{ID: NodeID(repo, rel), Repo: repo, Path: rel, Lang: lang}
	f, err := os.Open(abs)
	if err != nil {
		return n
	}
	defer f.Close()

	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	defsSeen := map[string]bool{}
	impSeen := map[string]bool{}
	tblSeen := map[string]bool{}
	anchSeen := map[string]bool{}
	for sc.Scan() {
		line := sc.Text()
		n.Lines++
		for _, imp := range matchImports(lang, line) {
			if !impSeen[imp] {
				impSeen[imp] = true
				n.Imports = append(n.Imports, imp)
			}
		}
		for _, def := range matchDefs(lang, line) {
			if def != "" && !defsSeen[def] {
				defsSeen[def] = true
				n.Definitions = append(n.Definitions, def)
			}
		}
		n.Routes = append(n.Routes, matchRoutes(lang, line)...)
		refs, anchors := matchTables(lang, line)
		for _, t := range refs {
			if !tblSeen[t] {
				tblSeen[t] = true
				n.Tables = append(n.Tables, t)
			}
		}
		for _, t := range anchors {
			if !anchSeen[t] {
				anchSeen[t] = true
				n.TableAnchors = append(n.TableAnchors, t)
			}
		}
	}
	return n
}

// ── imports ────────────────────────────────────────────────────────────────

var (
	reJSImport  = regexp.MustCompile(`(?:import|export)[^'"]*from\s+['"]([^'"]+)['"]`)
	reJSRequire = regexp.MustCompile(`require\(\s*['"]([^'"]+)['"]\s*\)`)
	reGoImport  = regexp.MustCompile(`^\s*(?:_\s+|[\w.]+\s+)?"([^"]+)"`)
	rePHPUse    = regexp.MustCompile(`^\s*use\s+([\w\\]+)`)
	rePyImport  = regexp.MustCompile(`^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))`)
)

func matchImports(lang, line string) []string {
	var out []string
	switch lang {
	case "ts", "js", "vue":
		for _, m := range reJSImport.FindAllStringSubmatch(line, -1) {
			out = append(out, m[1])
		}
		for _, m := range reJSRequire.FindAllStringSubmatch(line, -1) {
			out = append(out, m[1])
		}
	case "go":
		if m := reGoImport.FindStringSubmatch(line); m != nil && strings.Contains(line, `"`) {
			out = append(out, m[1])
		}
	case "php":
		if m := rePHPUse.FindStringSubmatch(line); m != nil {
			out = append(out, m[1])
		}
	case "py":
		if m := rePyImport.FindStringSubmatch(line); m != nil {
			if m[1] != "" {
				out = append(out, m[1])
			} else {
				out = append(out, m[2])
			}
		}
	}
	return out
}

// ── definiciones ───────────────────────────────────────────────────────────

var (
	reJSFunc  = regexp.MustCompile(`(?:export\s+)?(?:async\s+)?function\s+(\w+)`)
	reJSConst = regexp.MustCompile(`(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*=>`)
	reClass   = regexp.MustCompile(`(?:export\s+)?(?:abstract\s+)?class\s+(\w+)`)
	reGoFunc  = regexp.MustCompile(`^\s*func\s+(?:\([^)]*\)\s*)?(\w+)`)
	reGoType  = regexp.MustCompile(`^\s*type\s+(\w+)\s+`)
	rePHPFunc = regexp.MustCompile(`function\s+(\w+)\s*\(`)
	rePyDef   = regexp.MustCompile(`^\s*(?:async\s+)?def\s+(\w+)`)
)

func matchDefs(lang, line string) []string {
	var out []string
	add := func(re *regexp.Regexp) {
		if m := re.FindStringSubmatch(line); m != nil {
			out = append(out, m[1])
		}
	}
	switch lang {
	case "ts", "js", "vue":
		add(reJSFunc)
		add(reJSConst)
		add(reClass)
	case "go":
		add(reGoFunc)
		add(reGoType)
	case "php":
		add(rePHPFunc)
		add(reClass)
	case "py":
		add(rePyDef)
		add(reClass)
	}
	return out
}

// ── rutas ──────────────────────────────────────────────────────────────────

var (
	// ingress (servidor)
	reLaravel = regexp.MustCompile(`Route::(get|post|put|patch|delete|any)\(\s*['"]([^'"]+)['"]`)
	reExpress = regexp.MustCompile(`(?:app|router)\.(get|post|put|patch|delete|use)\(\s*['"]([^'"]+)['"]`)
	reGoMux   = regexp.MustCompile(`(?:HandleFunc|Handle|GET|POST|PUT|PATCH|DELETE)\(\s*"([/][^"]*)"`)
	rePyRoute = regexp.MustCompile(`@\w+\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]`)
	// candidate (cliente)
	reFetch = regexp.MustCompile(`(?:fetch|axios(?:\.\w+)?|url|path)\s*[\(=:]\s*['"` + "`" + `]([/][a-zA-Z0-9_\-/{}:.\$]*)['"` + "`" + `]`)
)

func matchRoutes(lang, line string) []Route {
	var out []Route
	push := func(kind, method, path string) {
		path = strings.TrimSpace(path)
		if path == "" {
			return
		}
		// los routers modulares (Laravel) definen paths sin barra inicial
		// (relativos al prefijo del grupo): normalizamos a "/…".
		if !strings.HasPrefix(path, "/") {
			path = "/" + path
		}
		out = append(out, Route{Kind: kind, Method: strings.ToUpper(method), Path: path})
	}
	switch lang {
	case "php":
		if m := reLaravel.FindStringSubmatch(line); m != nil {
			push("ingress", m[1], m[2])
		}
	case "js", "ts":
		if m := reExpress.FindStringSubmatch(line); m != nil {
			method := m[1]
			if method == "use" {
				method = "ANY"
			}
			push("ingress", method, m[2])
		}
	case "go":
		if m := reGoMux.FindStringSubmatch(line); m != nil {
			method := "ANY"
			low := strings.ToLower(line)
			for _, v := range []string{"get", "post", "put", "patch", "delete"} {
				if strings.Contains(low, "."+v+"(") {
					method = v
				}
			}
			push("ingress", method, m[1])
		}
	case "py":
		if m := rePyRoute.FindStringSubmatch(line); m != nil {
			push("ingress", m[1], m[2])
		}
	}
	// candidatos: en cualquier archivo de front (ts/js/vue)
	if lang == "ts" || lang == "js" || lang == "vue" {
		for _, m := range reFetch.FindAllStringSubmatch(line, -1) {
			p := m[1]
			if strings.HasPrefix(p, "/api") || strings.HasPrefix(p, "/v1") || strings.HasPrefix(p, "/v2") {
				push("candidate", "ANY", p)
			}
		}
	}
	return out
}

// ── tablas SQL ───────────────────────────────────────────────────────────────

var (
	// anclas: el archivo DEFINE la tabla
	reModelTable = regexp.MustCompile(`\$table\s*=\s*['"]([a-zA-Z_][a-zA-Z0-9_]*)['"]`)
	reSchema     = regexp.MustCompile(`Schema::(?:create|table|dropIfExists|rename)\(\s*['"]([a-zA-Z_][a-zA-Z0-9_]*)['"]`)
	// referencias: el archivo CONSULTA la tabla por nombre
	reDBTable = regexp.MustCompile(`(?:DB::table|->table|->from|->join|->leftJoin|->rightJoin|->crossJoin)\(\s*['"]([a-zA-Z_][a-zA-Z0-9_]*)['"]`)
	reSQLFrom = regexp.MustCompile(`(?i)\b(?:from|join|into|update)\s+["'` + "`" + `]?([a-zA-Z_][a-zA-Z0-9_]*)`)
)

// palabras que reSQLFrom captura pero no son tablas.
var notTable = map[string]bool{
	"select": true, "where": true, "set": true, "values": true, "duplicate": true,
	"dual": true, "table": true, "only": true, "as": true,
}

func matchTables(lang, line string) (refs, anchors []string) {
	norm := func(s string) string { return strings.ToLower(s) }
	switch lang {
	case "php":
		if m := reModelTable.FindStringSubmatch(line); m != nil {
			anchors = append(anchors, norm(m[1]))
			refs = append(refs, norm(m[1]))
		}
		if m := reSchema.FindStringSubmatch(line); m != nil {
			anchors = append(anchors, norm(m[1]))
			refs = append(refs, norm(m[1]))
		}
		for _, m := range reDBTable.FindAllStringSubmatch(line, -1) {
			refs = append(refs, norm(m[1]))
		}
	case "sql":
		for _, m := range reSQLFrom.FindAllStringSubmatch(line, -1) {
			t := norm(m[1])
			if !notTable[t] && len(t) >= 3 {
				refs = append(refs, t)
			}
		}
	}
	// descarta ruido: nombres muy cortos
	refs = filterTables(refs)
	anchors = filterTables(anchors)
	return
}

func filterTables(in []string) []string {
	out := in[:0]
	for _, t := range in {
		if len(t) >= 3 && !notTable[t] {
			out = append(out, t)
		}
	}
	return out
}
