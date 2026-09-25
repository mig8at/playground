// visor/server — la API del visor de pantallas de Figma.
//
// Hace dos cosas, y las dos por el conector (connectors/figma): lee un diseño como MAPA —carriles,
// pantallas, zonas del prototipo— y exporta la imagen de cada pantalla, guardándola en disco. El
// token de Figma se queda acá: el navegador pide `/api/screen` y nunca ve ni el token ni el enlace de
// S3 que Figma devuelve (que además vence).
//
//	go run . -serve 127.0.0.1:5194
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sync"
	"time"

	"creditop/playground/connectors/figma"
)

func main() {
	serve := flag.String("serve", "127.0.0.1:5194", "dónde escucha la API")
	cache := flag.String("cache", "../.cache", "dónde se guardan las imágenes exportadas")
	links := flag.String("links", "", "en vez de servir: recorre esta carpeta y dice cómo están las pantallas que enlazan sus archivos")
	flag.Parse()
	tok, err := figma.LoadToken()
	if err != nil {
		log.Fatal(err)
	}
	srv := newServer(figma.New(tok), *cache)
	// Un verbo después de las banderas es la API por consola (cli.go): el modelo trabaja con comandos.
	if flag.NArg() > 0 {
		os.Exit(runCLI(srv, flag.Args()))
	}
	if *links != "" {
		out := bufio.NewWriter(os.Stdout)
		code := srv.checkLinks(context.Background(), *links, out)
		out.Flush()
		os.Exit(code)
	}
	srv.self = "http://" + *serve // la medición de fidelidad le pide el HTML a esta misma API
	log.Printf("visor: API en http://%s (caché en %s)", *serve, *cache)
	log.Fatal(http.ListenAndServe(*serve, srv.routes()))
}

type server struct {
	figma *figma.Client
	cache string
	// Lo que sale a la red, reemplazable en las pruebas: la imagen de una pantalla, el SVG de un dibujo,
	// una imagen de relleno y el JSON de un nodo.
	export    fetcher
	exportSVG fetcher
	fills     fetcher
	nodeJSON  func(ctx context.Context, key, id string) ([]byte, error)
	readFlow  func(ctx context.Context, key string) (figma.Structure, string, error) // la página de flujo de un archivo
	// measure mide una pantalla contra Figma (fidelity.go); self es dónde escucha la API de este proceso.
	measure func(ctx context.Context, key, id string, w, h float64) (measured, error)
	self    string

	mu       sync.Mutex
	maps     map[string]figma.Structure // clave+nodo → mapa, mientras corre el server
	versions map[string]string          // clave del archivo → última versión vista
	inflight map[string]chan struct{}   // una imagen que ya se está bajando
	nodes    map[string][]byte          // clave+versión+nodo → el JSON crudo de una pantalla
	variants map[string]variantSet      // clave+versión → las variantes de la casilla en el archivo
	library  *libraryStore
}

// fetcher baja varios recursos de un archivo de una vez: del id (o la referencia) a sus bytes.
type fetcher func(ctx context.Context, key string, ids []string) (map[string][]byte, error)

func newServer(cl *figma.Client, cache string) *server {
	s := &server{figma: cl, cache: cache, maps: map[string]figma.Structure{}, versions: map[string]string{},
		inflight: map[string]chan struct{}{}, nodes: map[string][]byte{}, variants: map[string]variantSet{},
		library: &libraryStore{path: filepath.Join(cache, "library.json")}}
	s.export = s.exportFromFigma
	s.exportSVG = s.svgFromFigma
	s.fills = s.fillsFromFigma
	s.nodeJSON = func(ctx context.Context, key, id string) ([]byte, error) { return cl.NodeJSON(ctx, key, id) }
	s.readFlow = s.loadFlow
	s.measure = s.measureWithChromium
	return s
}

func (s *server) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/map", s.handleMap)
	mux.HandleFunc("/api/screen", s.handleScreen)
	mux.HandleFunc("/api/health", s.handleHealth)
	mux.HandleFunc("/api/html", s.handleHTML)
	mux.HandleFunc("/api/asset", s.handleAsset)
	mux.HandleFunc("/api/library", s.handleLibrary)
	mux.HandleFunc("/api/pages", s.handlePages)
	mux.HandleFunc("/api/track", s.handleTrack)
	mux.HandleFunc("/api/tokens", s.handleTokens)
	mux.HandleFunc("/api/brief", s.handleBrief)
	mux.HandleFunc("/api/fidelity", s.handleFidelity)
	mux.HandleFunc("/api/layers", s.handleLayers)
	mux.HandleFunc("/api/layer", s.handleLayer)
	return mux
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func fail(w http.ResponseWriter, status int, format string, args ...any) {
	writeJSON(w, status, map[string]string{"error": fmt.Sprintf(format, args...)})
}

// statusOf traduce un error de Figma a un código HTTP que la UI sepa leer.
func statusOf(err error) int {
	var fe *figma.Error
	if errors.As(err, &fe) {
		return fe.Status
	}
	return http.StatusBadGateway
}

func (s *server) handleHealth(w http.ResponseWriter, r *http.Request) {
	u, err := s.figma.Me(r.Context())
	if err != nil {
		fail(w, statusOf(err), "%v", err)
		return
	}
	writeJSON(w, 200, map[string]string{"handle": u.Handle, "email": u.Email})
}

// mapResponse es lo que recibe la UI: el mapa y lo que hace falta para pedir sus imágenes.
type mapResponse struct {
	Key       string          `json:"key"`
	Node      string          `json:"node"`
	Structure figma.Structure `json:"structure"`
	Cached    bool            `json:"cached"`
}

// handleMap lee una sección o página. `ref` es la URL de Figma (o la clave) y `id` el nodo si la URL
// no lo trae; `fresh=1` vuelve a pedirlo aunque esté en memoria.
func (s *server) handleMap(w http.ResponseWriter, r *http.Request) {
	ref, err := figma.ParseRef(r.URL.Query().Get("ref"))
	if err != nil {
		fail(w, 400, "%v", err)
		return
	}
	node := ref.NodeID
	if id := r.URL.Query().Get("id"); id != "" {
		node = id
	}
	if !reNodeID.MatchString(node) {
		fail(w, 400, "falta qué leer: una URL con node-id de una sección o página")
		return
	}
	k := ref.FileKey + "|" + node
	s.mu.Lock()
	st, ok := s.maps[k]
	s.mu.Unlock()
	if ok && r.URL.Query().Get("fresh") == "" {
		writeJSON(w, 200, mapResponse{Key: ref.FileKey, Node: node, Structure: st, Cached: true})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Minute)
	defer cancel()
	st, err = s.figma.Structure(ctx, ref.FileKey, node, true)
	if err != nil {
		fail(w, statusOf(err), "%v", err)
		return
	}
	s.mu.Lock()
	s.maps[k] = st
	s.versions[ref.FileKey] = st.Version
	s.mu.Unlock()
	s.library.opened(ref.FileKey, st.FileName, "")
	// La carpeta sale de los metadatos, un pedido aparte: se pide una vez y en segundo plano.
	if s.library.folderOf(ref.FileKey) == "" {
		go func(key, name string) {
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			if meta, err := s.figma.Meta(ctx, key); err == nil && meta.Folder != "" {
				s.library.setFolder(key, meta.Folder)
			}
		}(ref.FileKey, st.FileName)
	}
	// Las imágenes se bajan en segundo plano, de a tandas: la primera pantalla que se abra casi
	// siempre ya está, y la UI no espera a las 60 para dibujar el mapa.
	go s.prefetch(ref.FileKey, screenIDs(st))
	writeJSON(w, 200, mapResponse{Key: ref.FileKey, Node: node, Structure: st})
}

func screenIDs(st figma.Structure) []string {
	var ids []string
	for _, l := range st.Lanes {
		for _, sc := range l.Screens {
			ids = append(ids, sc.ID)
		}
	}
	for _, sub := range st.Sections {
		ids = append(ids, screenIDs(sub)...)
	}
	return ids
}

var (
	reNodeID = regexp.MustCompile(`^[0-9]+:[0-9]+$`)
	// reLayerID es el id de cualquier capa: una suelta (`1:6711`) o una adentro de una instancia, que Figma
	// nombra por la instancia y la pieza del componente (`I1:6711;1265:1238`).
	reLayerID = regexp.MustCompile(`^I?[0-9]+:[0-9]+(;[0-9]+:[0-9]+)*$`)
	reFileKey = regexp.MustCompile(`^[A-Za-z0-9]{10,}$`)
)

// imagePath es dónde se guarda una pantalla: por archivo, por VERSIÓN y por nodo. La versión va en la
// ruta para que un cambio del diseñador no sirva la imagen vieja; el id va sin `:` para el disco.
func (s *server) imagePath(key, version, id string) string {
	return s.assetPath(key, version, "screen", id)
}

var reNotDigit = regexp.MustCompile(`[^0-9]`)

// assetPath es la ruta de cualquier recurso: pantallas (`screen`), dibujos (`svg`) e imágenes de
// relleno (`fill`), cada uno en su carpeta dentro de la versión.
func versionDir(version string) string {
	if version == "" {
		return "sin-version"
	}
	return version
}

func (s *server) assetPath(key, version, kind, id string) string {
	version = versionDir(version)
	switch kind {
	case "svg":
		return filepath.Join(s.cache, key, version, "svg", reNotDigit.ReplaceAllString(id, "-")+".svg")
	case "fill":
		// Una imagen de relleno no cambia de contenido con la versión: su referencia es su hash.
		return filepath.Join(s.cache, key, "fills", id)
	}
	return filepath.Join(s.cache, key, version, reNotDigit.ReplaceAllString(id, "-")+".png")
}

// handleScreen sirve la imagen de una pantalla, bajándola si no está.
func (s *server) handleScreen(w http.ResponseWriter, r *http.Request) {
	key, id := r.URL.Query().Get("key"), r.URL.Query().Get("id")
	// Los dos terminan en una ruta de disco: se validan contra su forma, no se limpian.
	if !reFileKey.MatchString(key) || !reNodeID.MatchString(id) {
		fail(w, 400, "clave o id inválidos")
		return
	}
	s.mu.Lock()
	version := s.versions[key]
	s.mu.Unlock()
	path := s.imagePath(key, version, id)
	if _, err := os.Stat(path); err != nil {
		ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
		defer cancel()
		if err := s.ensure(ctx, key, version, "screen", []string{id}); err != nil {
			fail(w, statusOf(err), "%v", err)
			return
		}
	}
	w.Header().Set("Cache-Control", "private, max-age=86400")
	http.ServeFile(w, r, path)
}

func (s *server) prefetch(key string, ids []string) {
	s.mu.Lock()
	version := s.versions[key]
	s.mu.Unlock()
	const batch = 12
	for i := 0; i < len(ids); i += batch {
		end := min(i+batch, len(ids))
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
		if err := s.ensure(ctx, key, version, "screen", ids[i:end]); err != nil {
			log.Printf("visor: no se pudieron bajar %d pantallas de %s: %v", end-i, key, err)
		}
		cancel()
	}
}

// ensure deja en disco las imágenes que falten. Una imagen que ya se está bajando no se pide dos
// veces: se espera a la otra.
func (s *server) ensure(ctx context.Context, key, version, kind string, ids []string) error {
	var todo []string
	var waits []chan struct{}
	s.mu.Lock()
	for _, id := range ids {
		path := s.assetPath(key, version, kind, id)
		if _, err := os.Stat(path); err == nil {
			continue
		}
		if ch, ok := s.inflight[path]; ok {
			waits = append(waits, ch)
			continue
		}
		s.inflight[path] = make(chan struct{})
		todo = append(todo, id)
	}
	s.mu.Unlock()
	var err error
	if len(todo) > 0 {
		err = s.download(ctx, key, version, kind, todo)
		s.mu.Lock()
		for _, id := range todo {
			path := s.assetPath(key, version, kind, id)
			close(s.inflight[path])
			delete(s.inflight, path)
		}
		s.mu.Unlock()
	}
	for _, ch := range waits {
		select {
		case <-ch:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	return err
}

func (s *server) download(ctx context.Context, key, version, kind string, ids []string) error {
	fetch := s.export
	switch kind {
	case "svg":
		fetch = s.exportSVG
	case "fill":
		fetch = s.fills
	}
	images, err := fetch(ctx, key, ids)
	if err != nil {
		return err
	}
	for _, id := range ids {
		img, ok := images[id]
		if !ok || len(img) == 0 {
			return fmt.Errorf("Figma no pudo exportar %s (invisible o vacío)", id)
		}
		path := s.assetPath(key, version, kind, id)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			return err
		}
		// Escritura atómica: una imagen a medias en disco se serviría para siempre.
		tmp := path + ".tmp"
		if err := os.WriteFile(tmp, img, 0o644); err != nil {
			return err
		}
		if err := os.Rename(tmp, path); err != nil {
			return err
		}
	}
	return nil
}
