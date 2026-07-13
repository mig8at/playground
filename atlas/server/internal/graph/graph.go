// Package graph deriva las conexiones entre nodos a partir del node-lite.
//
// Dos tipos de edge, que son justo los que hacen falta para CreditOp:
//   - import : dentro de un repo, un archivo importa a otro (resuelve rutas
//     relativas ./ ../).
//   - route  : ENTRE repos, una llamada del cliente (candidate) matchea la
//     definición de ruta del servidor (ingress) por método + path normalizado.
//     Este es el edge frontend↔backend que ningún import expresa.
package graph

import (
	"path"
	"regexp"
	"strings"

	"creditop/atlas/server/internal/scan"
)

// Edge conecta dos nodos. From/To son IDs de nodo.
type Edge struct {
	From   string `json:"from"`
	To     string `json:"to"`
	Kind   string `json:"kind"`   // import | route
	Detail string `json:"detail"` // el módulo importado o "GET /api/…"
}

// Connections devuelve todos los edges salientes+entrantes de un nodo.
func Connections(nodes []scan.Node, id string) []Edge {
	all := Build(nodes)
	var out []Edge
	for _, e := range all {
		if e.From == id || e.To == id {
			out = append(out, e)
		}
	}
	return out
}

// Build calcula todos los edges del grafo.
func Build(nodes []scan.Node) []Edge {
	var edges []Edge
	edges = append(edges, importEdges(nodes)...)
	edges = append(edges, routeEdges(nodes)...)
	return edges
}

// ── import edges (intra-repo) ────────────────────────────────────────────────

func importEdges(nodes []scan.Node) []Edge {
	// índice path→id por repo (con y sin extensión) para resolver imports
	byPath := map[string]string{} // repo\x00path(sin ext) -> id
	for _, n := range nodes {
		byPath[n.Repo+"\x00"+stripExt(n.Path)] = n.ID
	}
	var out []Edge
	for _, n := range nodes {
		dir := path.Dir(n.Path)
		for _, imp := range n.Imports {
			if !strings.HasPrefix(imp, ".") {
				continue // paquete externo o alias: fuera de alcance por ahora
			}
			target := stripExt(path.Clean(path.Join(dir, imp)))
			cand := []string{target, target + "/index"}
			for _, c := range cand {
				if to, ok := byPath[n.Repo+"\x00"+c]; ok && to != n.ID {
					out = append(out, Edge{From: n.ID, To: to, Kind: "import", Detail: imp})
					break
				}
			}
		}
	}
	return out
}

// ── route edges (cross-repo) ─────────────────────────────────────────────────

var reParam = regexp.MustCompile(`\{[^/]+\}|:[A-Za-z_][\w]*|\$\{[^/]+\}`)

// normPath deja el path comparable: minúsculas, sin barra final, params → *.
func normPath(p string) string {
	p = strings.ToLower(strings.TrimSpace(p))
	if i := strings.IndexAny(p, "?#"); i >= 0 {
		p = p[:i]
	}
	p = reParam.ReplaceAllString(p, "*")
	p = strings.TrimRight(p, "/")
	return p
}

type ingressRoute struct {
	id     string
	method string
	norm   string // path normalizado (params → *)
	strong bool   // tiene al menos un segmento literal "fuerte" (≥4 chars)
}

func routeEdges(nodes []scan.Node) []Edge {
	var ingress []ingressRoute
	var candidates []struct {
		id     string
		method string
		norm   string
		raw    string
	}
	for _, n := range nodes {
		for _, r := range n.Routes {
			np := normPath(r.Path)
			if r.Kind == "ingress" {
				ingress = append(ingress, ingressRoute{n.ID, r.Method, np, hasStrongSegment(np)})
			} else {
				candidates = append(candidates, struct {
					id, method, norm, raw string
				}{n.ID, r.Method, np, r.Path})
			}
		}
	}
	var out []Edge
	seen := map[string]bool{}
	for _, c := range candidates {
		for _, ig := range ingress {
			if !routeMatch(c.norm, ig) {
				continue
			}
			if !(ig.method == c.method || ig.method == "ANY" || c.method == "ANY") {
				continue
			}
			if ig.id == c.id {
				continue
			}
			key := c.id + ">" + ig.id + ">" + ig.norm
			if seen[key] {
				continue
			}
			seen[key] = true
			out = append(out, Edge{From: c.id, To: ig.id, Kind: "route", Detail: ig.method + " " + c.raw})
		}
	}
	return out
}

// routeMatch decide si una llamada del cliente (cand) apunta a una ruta del
// servidor (ig). Los routers modulares (Laravel) definen paths RELATIVOS al
// prefijo del grupo, así que el ingress suele ser un SUFIJO del path completo
// que arma el front. Exigimos alineación por segmento (ambos empiezan con "/")
// y un segmento literal fuerte para no matchear "/" ni "/*".
func routeMatch(cand string, ig ingressRoute) bool {
	if !ig.strong || cand == "" {
		return false
	}
	if cand == ig.norm {
		return true
	}
	// sufijo alineado por segmento: cand = ".../<ig>"
	return strings.HasSuffix(cand, ig.norm)
}

func hasStrongSegment(norm string) bool {
	for _, seg := range strings.Split(norm, "/") {
		if seg != "" && seg != "*" && len(seg) >= 4 {
			return true
		}
	}
	return false
}

func stripExt(p string) string {
	ext := path.Ext(p)
	if ext == "" {
		return p
	}
	return strings.TrimSuffix(p, ext)
}
