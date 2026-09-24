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
	"time"

	"creditop/playground/visor/render"
)

var (
	// Un nodo dentro de una instancia se nombra con la cadena de instancias: `I612:1190;1934:1663`.
	reAnyNodeID = regexp.MustCompile(`^I?[0-9]+:[0-9]+(;[0-9]+:[0-9]+)*$`)
	reImageRef  = regexp.MustCompile(`^[0-9a-f]{40}$`)
)

// screenNode baja (una vez por versión) el JSON crudo de una pantalla.
func (s *server) screenNode(ctx context.Context, key, id string) (render.Node, string, error) {
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
			return render.Node{}, version, err
		}
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err == nil {
			_ = os.WriteFile(path+".tmp", raw, 0o644)
			_ = os.Rename(path+".tmp", path)
		}
	}
	s.mu.Lock()
	s.nodes[key+"|"+version+"|"+id] = raw
	s.mu.Unlock()
	n, err := render.Parse(raw)
	return n, version, err
}

// assets arma las URLs que el HTML usa para lo que no es CSS. Van por este mismo server, así que el
// navegador nunca ve un enlace de Figma ni de S3.
func assets(key string, variants map[string]string) render.Assets {
	return render.Assets{
		SVG:      func(id string) string { return "/api/asset?key=" + key + "&svg=" + url.QueryEscape(id) },
		Image:    func(ref string) string { return "/api/asset?key=" + key + "&fill=" + url.QueryEscape(ref) },
		Variants: variants,
	}
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
	doc, rep := render.HTML(n, assets(key, s.fileVariants(key, version)))
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
