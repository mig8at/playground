package main

import (
	"bytes"
	"context"
	"crypto/sha256"
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
	"strings"
	"sync"
	"time"
)

// LA FIDELIDAD DE UNA PANTALLA: cuánto se parece el HTML traducido a la imagen de Figma, en un número.
//
// La medida es la de `visor/tools/fidelity.mjs` —Chromium dibuja el HTML al doble y se compara con la
// exportación—, en su modo de una pantalla. La que se muestra es la REAL: comparar píxel a píxel cuenta el
// borde de todas las letras (Chromium y Figma no suavizan igual), así que un píxel sólo cuenta si no hay
// uno parecido a menos de 1 px en la otra imagen, y sólo donde la diferencia ocupa algo.
//
// ⚠ Hubo un mapa de calor y una lista de «capas que difieren» encima de esta misma diferencia, y se
// sacaron (Miguel, 2026-09-25): aun con la tolerancia daban demasiados falsos positivos en letras e
// íconos para servir de guía. El número se queda porque, en conjunto, sí separa una traducción fiel de
// una corrida.
//
// `/api/fidelity?key=&id=` devuelve el JSON. Se guarda en disco por versión del archivo: medir cuesta unos
// segundos (un Chromium) y la pantalla no cambia hasta que el diseñador guarda.

// fidelity es lo que se devuelve, y lo que se guarda.
type fidelity struct {
	// SameReal es LA medida: la fracción de píxeles sin una diferencia REAL —la que no se explica con el
	// suavizado de las letras ni con medio píxel de corrimiento (ver RADIUS y FLOOR en fidelity.mjs)—. Same
	// es la estricta, píxel a píxel, la de `make visor-fidelidad REF=` y la de las medidas viejas.
	SameReal  float64   `json:"same_real"`
	Same      float64   `json:"same"`
	Threshold int       `json:"threshold"` // cuánto tiene que diferir un canal para contar
	Version   string    `json:"version"`
	Measured  time.Time `json:"measured_at"`
	// Renderer es la huella del binario que tradujo el HTML: la medida es de ESA traducción, así que un
	// cambio en `visor/render` la deja vieja aunque el diseño sea el mismo (con `go run`, cada cambio de
	// código es otro binario).
	Renderer string `json:"renderer"`
	Method   string `json:"method"`
}

// fidelityMethod nombra cómo se mide: cambiarlo invalida las medidas guardadas con otro método.
const fidelityMethod = "radio-2-piso-15"

// measured es lo que imprime fidelity.mjs en su modo de una pantalla.
type measured struct {
	Same      float64 `json:"same"`
	SameReal  float64 `json:"same_real"`
	Threshold int     `json:"threshold"`
	Error     string  `json:"error"`
}

// fidelityGate: un Chromium a la vez. Dos mediciones en paralelo se pelean la máquina, y la segunda
// igual espera a la primera si piden la misma pantalla.
var fidelityGate sync.Mutex

func (s *server) fidelityPath(key, version, id string) string {
	return filepath.Join(s.cache, key, versionDir(version), "fidelity", reNotDigit.ReplaceAllString(id, "-")+".json")
}

// errNotMeasured: se pidió sólo la medida guardada y no hay una de esta versión.
var errNotMeasured = errors.New("esta pantalla no se midió todavía en esta versión")

// fidelityOf mide la pantalla, o devuelve la medida guardada para esta versión del archivo. Con onlyCached
// no mide: la interfaz lo usa al abrir una pantalla, para mostrar la medida si ya existe sin lanzar un
// Chromium por cada pantalla que se recorre.
func (s *server) fidelityOf(ctx context.Context, key, id string, fresh, onlyCached bool) (fidelity, error) {
	// Sin la versión del archivo la medida quedaría guardada «sin versión» y no vencería nunca: si todavía
	// no se leyó el mapa (la consola, un pedido directo), se lee — cuesta un pedido chico a Figma.
	s.mu.Lock()
	known := s.versions[key] != ""
	s.mu.Unlock()
	if !known && onlyCached {
		return fidelity{}, errNotMeasured // sólo lo guardado no sale a la red
	}
	if !known {
		if _, _, err := s.readFlow(ctx, key); err != nil {
			return fidelity{}, err
		}
	}
	n, version, err := s.screenNode(ctx, key, id)
	if err != nil {
		return fidelity{}, err
	}
	path := s.fidelityPath(key, version, id)
	fidelityGate.Lock()
	defer fidelityGate.Unlock()
	if !fresh {
		if b, err := os.ReadFile(path); err == nil {
			var f fidelity
			if json.Unmarshal(b, &f) == nil && f.Renderer == rendererPrint() && f.Method == fidelityMethod {
				return f, nil
			}
		}
	}
	if onlyCached {
		return fidelity{}, errNotMeasured
	}
	m, err := s.measure(ctx, key, id, n.Box.Width, n.Box.Height)
	if err != nil {
		return fidelity{}, err
	}
	f := fidelity{SameReal: m.SameReal, Same: m.Same, Threshold: m.Threshold, Version: version, Measured: time.Now(),
		Renderer: rendererPrint(), Method: fidelityMethod}
	if b, err := json.Marshal(f); err == nil && os.MkdirAll(filepath.Dir(path), 0o755) == nil {
		_ = os.WriteFile(path+".tmp", b, 0o644)
		_ = os.Rename(path+".tmp", path)
	}
	return f, nil
}

// measureWithChromium corre fidelity.mjs contra la API de ESTE server, que es la que sirve el HTML y la
// imagen que se comparan.
func (s *server) measureWithChromium(ctx context.Context, key, id string, w, h float64) (measured, error) {
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
		"--w", fmt.Sprint(w), "--h", fmt.Sprint(h), "--json")
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

func (s *server) handleFidelity(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	key, id := q.Get("key"), q.Get("id")
	if !reFileKey.MatchString(key) || !reNodeID.MatchString(id) {
		fail(w, 400, "clave o id inválidos")
		return
	}
	f, err := s.fidelityOf(r.Context(), key, id, q.Get("fresh") == "1", q.Get("cached") == "1")
	if errors.Is(err, errNotMeasured) {
		fail(w, 404, "%v", err)
		return
	}
	if err != nil {
		fail(w, statusOf(err), "%v", err)
		return
	}
	writeJSON(w, 200, f)
}
