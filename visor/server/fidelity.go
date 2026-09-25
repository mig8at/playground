package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"creditop/playground/visor/render"
)

// LA FIDELIDAD DE UNA PANTALLA: cuánto se parece el HTML traducido a la imagen de Figma, y DÓNDE no.
//
// La medida es la de `visor/tools/fidelity.mjs` —Chromium dibuja el HTML al doble, se compara píxel a
// píxel con la exportación—, en su modo de una pantalla. Lo que agrega el server es el DÓNDE: la grilla de
// diferencias se cruza con las capas de Figma, y cada celda distinta se le cuenta a la capa MÁS CHICA que
// la contiene. Así la respuesta no es «hay rojo abajo a la izquierda» sino «el texto “Iniciar solicitud”
// difiere en un 30 %», que es lo que dice qué arreglar.
//
// `/api/fidelity?key=&id=` devuelve el JSON; con `&heat=1`, el mapa de calor (PNG transparente, del
// tamaño de la exportación) para superponer a la imagen. Se guarda en disco por versión del archivo:
// medir cuesta unos segundos (un Chromium) y la pantalla no cambia hasta que el diseñador guarda.

// fidelity es lo que se devuelve, y lo que se guarda.
type fidelity struct {
	Same      float64   `json:"same"`      // fracción de píxeles iguales
	Threshold int       `json:"threshold"` // cuánto tiene que diferir un canal para contar
	Version   string    `json:"version"`
	Measured  time.Time `json:"measured_at"`
	Zones     []zone    `json:"zones"` // dónde difiere, de más a menos
	W         float64   `json:"w"`
	H         float64   `json:"h"`
	// Renderer es la huella del binario que tradujo el HTML: la medida es de ESA traducción, así que un
	// cambio en `visor/render` la deja vieja aunque el diseño sea el mismo (con `go run`, cada cambio de
	// código es otro binario).
	Renderer string `json:"renderer"`
}

// zone es una capa de Figma con su parte de la diferencia.
type zone struct {
	ID    string  `json:"id"`
	Name  string  `json:"name"`
	Type  string  `json:"type"`
	Text  string  `json:"text,omitempty"` // lo que dice, si es un texto
	X     float64 `json:"x"`              // la caja, en píxeles de la pantalla
	Y     float64 `json:"y"`
	W     float64 `json:"w"`
	H     float64 `json:"h"`
	Share float64 `json:"share"` // qué parte de toda la diferencia es de esta capa
	Cover float64 `json:"cover"` // qué parte de la capa es distinta
}

// measured es lo que imprime fidelity.mjs en su modo de una pantalla.
type measured struct {
	Same      float64 `json:"same"`
	Threshold int     `json:"threshold"`
	Scale     float64 `json:"scale"`
	Cell      int     `json:"cell"`
	GW        int     `json:"gw"`
	GH        int     `json:"gh"`
	Grid      string  `json:"grid"` // base64: un byte por celda, la fracción distinta ×255
	Error     string  `json:"error"`
}

// maxZones: más de unas pocas capas ya no dice por dónde empezar.
const maxZones = 8

// fidelityGate: un Chromium a la vez. Dos mediciones en paralelo se pelean la máquina, y la segunda
// igual espera a la primera si piden la misma pantalla.
var fidelityGate sync.Mutex

func (s *server) fidelityPaths(key, version, id string) (string, string) {
	dir := filepath.Join(s.cache, key, versionDir(version), "fidelity")
	base := reNotDigit.ReplaceAllString(id, "-")
	return filepath.Join(dir, base+".json"), filepath.Join(dir, base+".png")
}

// errNotMeasured: se pidió sólo la medida guardada y no hay una de esta versión.
var errNotMeasured = errors.New("esta pantalla no se midió todavía en esta versión")

// fidelityOf mide la pantalla, o devuelve la medida guardada para esta versión del archivo. Con onlyCached
// no mide: la interfaz lo usa al abrir una pantalla, para mostrar la medida si ya existe sin lanzar un
// Chromium por cada pantalla que se recorre.
func (s *server) fidelityOf(ctx context.Context, key, id string, fresh, onlyCached bool) (fidelity, string, error) {
	// Sin la versión del archivo la medida quedaría guardada «sin versión» y no vencería nunca: si todavía
	// no se leyó el mapa (la consola, un pedido directo), se lee — cuesta un pedido chico a Figma.
	s.mu.Lock()
	known := s.versions[key] != ""
	s.mu.Unlock()
	if !known && onlyCached {
		return fidelity{}, "", errNotMeasured // sólo lo guardado no sale a la red
	}
	if !known {
		if _, _, err := s.readFlow(ctx, key); err != nil {
			return fidelity{}, "", err
		}
	}
	n, version, err := s.screenNode(ctx, key, id)
	if err != nil {
		return fidelity{}, "", err
	}
	jsonPath, heatPath := s.fidelityPaths(key, version, id)
	fidelityGate.Lock()
	defer fidelityGate.Unlock()
	if !fresh {
		if b, err := os.ReadFile(jsonPath); err == nil {
			var f fidelity
			if json.Unmarshal(b, &f) == nil && f.Renderer == rendererPrint() {
				return f, heatPath, nil
			}
		}
	}
	if onlyCached {
		return fidelity{}, "", errNotMeasured
	}
	if err := os.MkdirAll(filepath.Dir(jsonPath), 0o755); err != nil {
		return fidelity{}, "", err
	}
	m, err := s.measure(ctx, key, id, n.Box.Width, n.Box.Height, heatPath)
	if err != nil {
		return fidelity{}, "", err
	}
	grid, err := base64.StdEncoding.DecodeString(m.Grid)
	if err != nil || len(grid) != m.GW*m.GH {
		return fidelity{}, "", fmt.Errorf("la grilla de la medición no tiene %d×%d celdas", m.GW, m.GH)
	}
	f := fidelity{Same: m.Same, Threshold: m.Threshold, Version: version, Measured: time.Now(),
		Zones: attribute(n, grid, m.GW, m.GH, float64(m.Cell)/m.Scale), W: n.Box.Width, H: n.Box.Height, Renderer: rendererPrint()}
	if b, err := json.Marshal(f); err == nil {
		_ = os.WriteFile(jsonPath+".tmp", b, 0o644)
		_ = os.Rename(jsonPath+".tmp", jsonPath)
	}
	return f, heatPath, nil
}

// measureWithChromium corre fidelity.mjs contra la API de ESTE server, que es la que sirve el HTML y la
// imagen que se comparan.
func (s *server) measureWithChromium(ctx context.Context, key, id string, w, h float64, heatPath string) (measured, error) {
	api, err := s.selfURL()
	if err != nil {
		return measured{}, err
	}
	tool, err := findTool("visor/tools/fidelity.mjs")
	if err != nil {
		return measured{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, 3*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, "node", tool, "--api", api, "--key", key, "--id", id,
		"--w", fmt.Sprint(w), "--h", fmt.Sprint(h), "--heat", heatPath, "--json")
	var out, errOut bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &errOut
	runErr := cmd.Run()
	var m measured
	if err := json.Unmarshal(bytes.TrimSpace(lastLine(out.Bytes())), &m); err != nil {
		msg := strings.TrimSpace(errOut.String() + " " + out.String())
		if runErr != nil && msg == "" {
			msg = runErr.Error()
		}
		return measured{}, fmt.Errorf("la medición no terminó: %s", msg)
	}
	if m.Error != "" {
		return measured{}, errors.New(m.Error)
	}
	return m, nil
}

// rendererPrint es la huella del ejecutable, una vez por proceso.
var rendererPrint = sync.OnceValue(func() string {
	exe, err := os.Executable()
	if err != nil {
		return ""
	}
	f, err := os.Open(exe)
	if err != nil {
		return ""
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return ""
	}
	return hex.EncodeToString(h.Sum(nil))[:12]
})

func lastLine(b []byte) []byte {
	b = bytes.TrimRight(b, "\n")
	if i := bytes.LastIndexByte(b, '\n'); i >= 0 {
		return b[i+1:]
	}
	return b
}

// selfURL es dónde está la API de este proceso. En la consola no hay ninguna escuchando, así que se abre
// una en un puerto libre, sólo para que Chromium lea el HTML y la imagen: la consola no necesita el visor
// corriendo, tampoco para medir.
func (s *server) selfURL() (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.self != "" {
		return s.self, nil
	}
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return "", err
	}
	go func() { _ = http.Serve(l, s.routes()) }()
	s.self = "http://" + l.Addr().String()
	return s.self, nil
}

// findTool busca un archivo del repo subiendo desde donde corre el proceso: el server corre en
// `visor/server`, la consola desde la raíz.
func findTool(rel string) (string, error) {
	dir, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for {
		p := filepath.Join(dir, rel)
		if _, err := os.Stat(p); err == nil {
			return p, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", fmt.Errorf("no encontré %s subiendo desde el directorio actual", rel)
		}
		dir = parent
	}
}

// attribute le cuenta cada celda distinta a la capa visible MÁS CHICA que contiene su centro: un texto
// adentro de un botón se lleva lo suyo, y el botón sólo lo que queda afuera del texto. Lo que no cae en
// ninguna capa es del fondo de la pantalla. `cell` es el lado de una celda en píxeles de pantalla.
func attribute(screen render.Node, grid []byte, gw, gh int, cell float64) []zone {
	type layer struct {
		n    render.Node
		x, y float64
		w, h float64
	}
	var layers []layer
	var walk func(n render.Node, root bool)
	walk = func(n render.Node, root bool) {
		if n.Visible != nil && !*n.Visible {
			return
		}
		if !root && n.Box != nil && n.Box.Width > 0 && n.Box.Height > 0 {
			layers = append(layers, layer{n: n, x: n.Box.X - screen.Box.X, y: n.Box.Y - screen.Box.Y, w: n.Box.Width, h: n.Box.Height})
		}
		for _, c := range n.Children {
			walk(c, false)
		}
	}
	walk(screen, true)
	// De la más chica a la más grande: la primera que contiene la celda es la dueña.
	sort.SliceStable(layers, func(i, j int) bool { return layers[i].w*layers[i].h < layers[j].w*layers[j].h })

	diff := make([]float64, len(layers)+1) // el último es el fondo
	total := 0.0
	for k, v := range grid {
		if v == 0 {
			continue
		}
		px := float64(v) / 255 * cell * cell
		cx, cy := (float64(k%gw)+0.5)*cell, (float64(k/gw)+0.5)*cell
		owner := len(layers)
		for i, l := range layers {
			if cx >= l.x && cx < l.x+l.w && cy >= l.y && cy < l.y+l.h {
				owner = i
				break
			}
		}
		diff[owner] += px
		total += px
	}
	if total == 0 {
		return nil
	}
	var zones []zone
	for i, d := range diff {
		if d == 0 {
			continue
		}
		if i == len(layers) {
			zones = append(zones, zone{ID: screen.ID, Name: "fondo de la pantalla", Type: screen.Type, W: screen.Box.Width, H: screen.Box.Height,
				Share: d / total, Cover: d / (screen.Box.Width * screen.Box.Height)})
			continue
		}
		l := layers[i]
		z := zone{ID: l.n.ID, Name: l.n.Name, Type: l.n.Type, X: l.x, Y: l.y, W: l.w, H: l.h, Share: d / total, Cover: min(1, d/(l.w*l.h))}
		if l.n.Type == "TEXT" {
			z.Text = strings.Join(strings.Fields(l.n.Characters), " ")
			if r := []rune(z.Text); len(r) > 60 {
				z.Text = string(r[:59]) + "…"
			}
		}
		zones = append(zones, z)
	}
	sort.SliceStable(zones, func(i, j int) bool { return zones[i].Share > zones[j].Share })
	if len(zones) > maxZones {
		zones = zones[:maxZones]
	}
	return zones
}

func (s *server) handleFidelity(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	key, id := q.Get("key"), q.Get("id")
	if !reFileKey.MatchString(key) || !reNodeID.MatchString(id) {
		fail(w, 400, "clave o id inválidos")
		return
	}
	f, heatPath, err := s.fidelityOf(r.Context(), key, id, q.Get("fresh") == "1", q.Get("cached") == "1")
	if errors.Is(err, errNotMeasured) {
		fail(w, 404, "%v", err)
		return
	}
	if err != nil {
		fail(w, statusOf(err), "%v", err)
		return
	}
	if q.Get("heat") == "1" {
		w.Header().Set("Content-Type", "image/png")
		w.Header().Set("Cache-Control", "private, max-age=3600")
		http.ServeFile(w, r, heatPath)
		return
	}
	writeJSON(w, 200, f)
}
