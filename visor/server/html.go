package main

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"creditop/playground/connectors/figma"
	"creditop/playground/visor/render"
)

var (
	// Un nodo dentro de una instancia se nombra con la cadena de instancias: `I612:1190;1934:1663`.
	reAnyNodeID = regexp.MustCompile(`^I?[0-9]+:[0-9]+(;[0-9]+:[0-9]+)*$`)
	reImageRef  = regexp.MustCompile(`^[0-9a-f]{40}$`)
)

// screenNode baja (una vez por versión) el JSON crudo de una pantalla y lo lee.
func (s *server) screenNode(ctx context.Context, key, id string) (render.Node, string, error) {
	raw, version, err := s.screenRaw(ctx, key, id)
	if err != nil {
		return render.Node{}, version, err
	}
	n, err := render.Parse(raw)
	return n, version, err
}

// screenRaw es el JSON crudo de una pantalla, de la memoria, del disco o de Figma, por versión.
func (s *server) screenRaw(ctx context.Context, key, id string) ([]byte, string, error) {
	s.mu.Lock()
	version := s.versions[key]
	raw, ok := s.nodes[key+"|"+version+"|"+id]
	s.mu.Unlock()
	// En disco también, por versión: sin eso cada reinicio del server volvía a pedir todas las
	// pantallas, y una tanda de 49 topaba el límite de Figma (429).
	path := filepath.Join(s.cache, key, versionDir(version), "nodes", reNotDigit.ReplaceAllString(id, "-")+".json")
	if !ok {
		if b, err := os.ReadFile(path); err == nil {
			raw, ok = b, true
		}
	}
	if !ok {
		var err error
		raw, err = s.nodeJSON(ctx, key, id)
		if err != nil {
			return nil, version, err
		}
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err == nil {
			_ = os.WriteFile(path+".tmp", raw, 0o644)
			_ = os.Rename(path+".tmp", path)
		}
	}
	s.mu.Lock()
	s.nodes[key+"|"+version+"|"+id] = raw
	s.mu.Unlock()
	return raw, version, nil
}

// assets arma las URLs que el HTML usa para lo que no es CSS. Van por este mismo server, así que el
// navegador nunca ve un enlace de Figma ni de S3.
func assets(key string, variants map[string]string, styles map[string]render.StyleToken) render.Assets {
	return render.Assets{
		SVG:      func(id string) string { return "/api/asset?key=" + key + "&svg=" + url.QueryEscape(id) },
		Image:    func(ref string) string { return "/api/asset?key=" + key + "&fill=" + url.QueryEscape(ref) },
		Variants: variants,
		Styles:   styles,
	}
}

// fileTokens son los tokens del archivo que ya se leyó: los del mapa con más colores con nombre (la página
// de flujo, casi siempre; una sección suelta ve menos). Sin ningún mapa en memoria no hay tokens y el HTML
// sale con los valores, igual de fiel.
func (s *server) fileTokens(key string) *figma.Tokens {
	s.mu.Lock()
	defer s.mu.Unlock()
	var best *figma.Tokens
	for k, st := range s.maps {
		if strings.HasPrefix(k, key+"|") && st.Tokens != nil && (best == nil || len(st.Tokens.Colors) > len(best.Colors)) {
			best = st.Tokens
		}
	}
	return best
}

// styleTokens: los tokens del archivo como los usa el traductor, por id de estilo.
func (s *server) styleTokens(key string) map[string]render.StyleToken {
	t := s.fileTokens(key)
	if t == nil {
		return nil
	}
	out := map[string]render.StyleToken{}
	for _, c := range t.Colors {
		out[c.ID] = render.StyleToken{Name: c.Name, Var: c.Var, Value: c.Value}
	}
	for _, x := range t.Texts {
		out[x.ID] = render.StyleToken{Name: x.Name, Class: x.Class}
	}
	return out
}

// handleTokens: la hoja de tokens de un mapa ya leído. `format=css` o `format=tailwind` la dan lista para
// pegar; sin formato, en JSON.
func (s *server) handleTokens(w http.ResponseWriter, r *http.Request) {
	key := r.URL.Query().Get("key")
	if !reFileKey.MatchString(key) {
		fail(w, 400, "clave inválida")
		return
	}
	t := s.fileTokens(key)
	if t == nil {
		// Un enlace directo a la hoja, con el server recién arrancado: se lee la página de flujo del archivo
		// —la misma que abre la barra— en vez de pedir que antes se abra en el visor.
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Minute)
		defer cancel()
		st, node, err := s.readFlow(ctx, key)
		if err != nil {
			fail(w, statusOf(err), "%v", err)
			return
		}
		s.mu.Lock()
		s.maps[key+"|"+node] = st
		s.versions[key] = st.Version
		s.mu.Unlock()
		if t = st.Tokens; t == nil {
			fail(w, 404, "Figma no devolvió estilos para la página de flujo de este archivo")
			return
		}
	}
	title := key
	if name := s.fileName(key); name != "" {
		title = name
	}
	switch r.URL.Query().Get("format") {
	case "css":
		w.Header().Set("Content-Type", "text/css; charset=utf-8")
		_, _ = io.WriteString(w, t.CSS(title))
	case "tailwind":
		w.Header().Set("Content-Type", "text/css; charset=utf-8")
		_, _ = io.WriteString(w, t.Tailwind(title))
	default:
		writeJSON(w, 200, t)
	}
}

var (
	reFlowPage = regexp.MustCompile(`(?i)flujo|flow`)
	reSkipPage = regexp.MustCompile(`(?i)cover|portada|bench|bechmarck|prototipo|prototype|archivo|archive`)
)

// flowPage elige la página de flujo de un archivo con la misma regla que la barra (App.vue): la que se
// llama «Flujo» o «Flow»; si no hay, la primera que no sea portada, benchmark ni prototipo.
func flowPage(pages []figma.Project) (figma.Project, bool) {
	for _, p := range pages {
		if reFlowPage.MatchString(p.Name) {
			return p, true
		}
	}
	for _, p := range pages {
		if !reSkipPage.MatchString(p.Name) {
			return p, true
		}
	}
	if len(pages) > 0 {
		return pages[0], true
	}
	return figma.Project{}, false
}

func (s *server) readFlowFromFigma(ctx context.Context, key string) (figma.Structure, string, error) {
	_, pages, err := s.figma.Pages(ctx, key)
	if err != nil {
		return figma.Structure{}, "", err
	}
	page, ok := flowPage(pages)
	if !ok {
		return figma.Structure{}, "", &figma.Error{Status: 404, Message: "el archivo no tiene páginas"}
	}
	st, err := s.figma.Structure(ctx, key, page.ID, false)
	return st, page.ID, err
}

func (s *server) fileName(key string) string {
	s.mu.Lock()
	defer s.mu.Unlock()
	for k, st := range s.maps {
		if strings.HasPrefix(k, key+"|") && st.FileName != "" {
			return st.FileName
		}
	}
	return ""
}

type variantSet struct {
	files    int
	variants map[string]string
}

// fileVariants dice qué instancia dibuja cada variante de la casilla en TODO el archivo, de las
// pantallas que el server ya guardó: la otra variante de una casilla puede no estar en su pantalla (en
// Credifamilia, una de once). Se recalcula cuando se guardó una pantalla más.
func (s *server) fileVariants(key, version string) map[string]string {
	dir := filepath.Join(s.cache, key, versionDir(version), "nodes")
	entries, _ := os.ReadDir(dir)
	s.mu.Lock()
	cached, ok := s.variants[key+"|"+version]
	s.mu.Unlock()
	if ok && cached.files == len(entries) {
		return cached.variants
	}
	out := map[string]string{}
	for _, e := range entries {
		raw, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			continue
		}
		if n, err := render.Parse(raw); err == nil {
			render.CheckboxVariants(n, out)
		}
	}
	s.mu.Lock()
	s.variants[key+"|"+version] = variantSet{files: len(entries), variants: out}
	s.mu.Unlock()
	return out
}

// handleHTML traduce una pantalla a HTML. Con `report=1` devuelve, en vez del documento, qué se tradujo
// y qué no. Al servir el documento, baja en segundo plano los dibujos y las imágenes que usa.
func (s *server) handleHTML(w http.ResponseWriter, r *http.Request) {
	key, id := r.URL.Query().Get("key"), r.URL.Query().Get("id")
	if !reFileKey.MatchString(key) || !reNodeID.MatchString(id) {
		fail(w, 400, "clave o id inválidos")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
	defer cancel()
	n, version, err := s.screenNode(ctx, key, id)
	if err != nil {
		fail(w, statusOf(err), "%v", err)
		return
	}
	doc, rep := render.HTML(n, assets(key, s.fileVariants(key, version), s.styleTokens(key)))
	if r.URL.Query().Get("report") != "" {
		writeJSON(w, 200, rep)
		return
	}
	go s.prefetchAssets(key, version, rep)
	// El documento no corre scripts: es una pantalla, no una app. Las fuentes vienen de Fontshare y de
	// Google; lo demás, de este server.
	w.Header().Set("Content-Security-Policy", "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline' https://api.fontshare.com https://fonts.googleapis.com; font-src https://cdn.fontshare.com https://fonts.gstatic.com")
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = io.WriteString(w, doc)
}

func (s *server) prefetchAssets(key, version string, rep render.Report) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	for i := 0; i < len(rep.Drawings); i += 40 {
		end := min(i+40, len(rep.Drawings))
		if err := s.ensure(ctx, key, version, "svg", rep.Drawings[i:end]); err != nil {
			fmt.Fprintf(os.Stderr, "visor: dibujos de %s: %v\n", key, err)
		}
	}
	if len(rep.Images) > 0 {
		if err := s.ensure(ctx, key, version, "fill", unique(rep.Images)); err != nil {
			fmt.Fprintf(os.Stderr, "visor: imágenes de %s: %v\n", key, err)
		}
	}
}

func unique(list []string) []string {
	seen := map[string]bool{}
	var out []string
	for _, x := range list {
		if x != "" && !seen[x] {
			seen[x] = true
			out = append(out, x)
		}
	}
	return out
}

// handleAsset sirve un dibujo (`svg=<id>`) o una imagen de relleno (`fill=<ref>`), bajándolo si falta.
func (s *server) handleAsset(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	key := q.Get("key")
	if !reFileKey.MatchString(key) {
		fail(w, 400, "clave inválida")
		return
	}
	kind, id := "", ""
	switch {
	case reAnyNodeID.MatchString(q.Get("svg")):
		kind, id = "svg", q.Get("svg")
	case reImageRef.MatchString(q.Get("fill")):
		kind, id = "fill", q.Get("fill")
	default:
		fail(w, 400, "falta svg=<id de nodo> o fill=<referencia de imagen>")
		return
	}
	s.mu.Lock()
	version := s.versions[key]
	s.mu.Unlock()
	path := s.assetPath(key, version, kind, id)
	if _, err := os.Stat(path); err != nil {
		ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
		defer cancel()
		if err := s.ensure(ctx, key, version, kind, []string{id}); err != nil {
			fail(w, statusOf(err), "%v", err)
			return
		}
	}
	if kind == "svg" {
		// Un SVG abierto directo puede traer script; así no corre nada aunque alguien lo abra suelto.
		w.Header().Set("Content-Type", "image/svg+xml")
		w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'")
	} else {
		head := make([]byte, 512)
		if f, err := os.Open(path); err == nil {
			n, _ := f.Read(head)
			f.Close()
			w.Header().Set("Content-Type", http.DetectContentType(head[:n]))
		}
	}
	w.Header().Set("Cache-Control", "private, max-age=86400")
	http.ServeFile(w, r, path)
}
