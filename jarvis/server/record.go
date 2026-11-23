package main

/* Grabar la pestaña en video (bin/jarvis record start|stop|status).
 *
 * La pantalla de cada sesión ya llega por CDP (Page.startScreencast, live.go) para el editor. Mientras se graba, cada
 * cuadro también se guarda como JPEG con su hora en .data/recordings/<id>/frames/; al parar, ffmpeg los une en un
 * mp4 que respeta los tiempos reales (el screencast sólo manda un cuadro cuando la pantalla cambia: un cuadro dura
 * hasta que llega el siguiente). Sirve para un screencast que pide alguien (la revisión de Shopify, 2026-11-23) sin
 * grabar la pantalla de la Mac: sólo sale la página, sin otras ventanas ni notificaciones.
 *
 * Si la sesión se cierra grabando, el video se arma igual al cerrarse. */

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	_ "image/jpeg"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// recording es una grabación en curso de una sesión en vivo.
type recording struct {
	mu      sync.Mutex
	id      string
	dir     string
	started time.Time
	frames  []recFrame
	w, h    int // el tamaño del primer cuadro: el video sale a ese tamaño
	err     error
	dropped int // cuadros que no entraron en la fila (el disco no daba abasto)

	// Los cuadros llegan desde el hilo del driver (live.broadcast): se encolan y un solo trabajador los escribe, en
	// orden y sin frenar al driver.
	queue chan queuedFrame
	done  chan struct{}
}

type queuedFrame struct {
	msg []byte
	at  time.Time
}

func newRecording(id, dir string, now time.Time) *recording {
	rec := &recording{id: id, dir: dir, started: now, queue: make(chan queuedFrame, 512), done: make(chan struct{})}
	go func() {
		defer close(rec.done)
		for f := range rec.queue {
			rec.addFrame(f.msg, f.at)
		}
	}()
	return rec
}

// push encola un cuadro sin esperar; si la fila está llena, se pierde (y se cuenta).
func (rec *recording) push(msg []byte) {
	select {
	case rec.queue <- queuedFrame{msg: msg, at: time.Now()}:
	default:
		rec.mu.Lock()
		rec.dropped++
		rec.mu.Unlock()
	}
}

// close termina la fila y espera a que se escriba lo encolado.
func (rec *recording) close() {
	close(rec.queue)
	<-rec.done
}

type recFrame struct {
	file string
	at   time.Time
}

// RecordingInfo es lo que devuelve la API: cómo va o cómo quedó una grabación.
type RecordingInfo struct {
	ID       string  `json:"id"`
	Active   bool    `json:"active"`
	Frames   int     `json:"frames"`
	Seconds  float64 `json:"seconds"`
	Video    string  `json:"video,omitempty"`
	Started  string  `json:"started"`
	Warnings string  `json:"warnings,omitempty"`
}

// addFrame guarda un cuadro del screencast (el mensaje que va al editor: {"data": base64, "meta": …}).
func (rec *recording) addFrame(msg []byte, at time.Time) {
	var m struct {
		Data string `json:"data"`
	}
	if json.Unmarshal(msg, &m) != nil || m.Data == "" {
		return
	}
	raw, err := base64.StdEncoding.DecodeString(m.Data)
	if err != nil {
		return
	}
	rec.mu.Lock()
	defer rec.mu.Unlock()
	if rec.w == 0 {
		if cfg, _, err := image.DecodeConfig(bytes.NewReader(raw)); err == nil {
			rec.w, rec.h = cfg.Width, cfg.Height
		}
	}
	name := filepath.Join(rec.dir, "frames", fmt.Sprintf("%06d.jpg", len(rec.frames)))
	if err := os.WriteFile(name, raw, 0o644); err != nil {
		rec.err = err
		return
	}
	rec.frames = append(rec.frames, recFrame{file: name, at: at})
}

func (rec *recording) info(active bool, video string) RecordingInfo {
	rec.mu.Lock()
	defer rec.mu.Unlock()
	secs := 0.0
	if n := len(rec.frames); n > 0 {
		secs = time.Since(rec.started).Seconds()
		if !active {
			secs = rec.frames[n-1].at.Sub(rec.started).Seconds() + 1
		}
	}
	warn := ""
	if rec.dropped > 0 {
		warn = fmt.Sprintf("se perdieron %d cuadros (la fila se llenó)", rec.dropped)
	}
	return RecordingInfo{ID: rec.id, Active: active, Frames: len(rec.frames), Seconds: secs, Video: video, Started: rec.started.Format(time.RFC3339), Warnings: warn}
}

// LiveRecordStart empieza a grabar la pestaña de la sesión.
func (r *Runner) LiveRecordStart() (RecordingInfo, error) {
	l := r.liveSession()
	if l == nil {
		return RecordingInfo{}, errors.New("no hay sesión en vivo")
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.rec != nil {
		return RecordingInfo{}, fmt.Errorf("ya se está grabando (%s): bin/jarvis record stop", l.rec.id)
	}
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		return RecordingInfo{}, errors.New("falta ffmpeg para armar el video: brew install ffmpeg")
	}
	now := time.Now()
	id := now.Format("2006-01-02_15-04-05")
	dir := filepath.Join(dataDir(), "recordings", id)
	if err := os.MkdirAll(filepath.Join(dir, "frames"), 0o755); err != nil {
		return RecordingInfo{}, err
	}
	rec := newRecording(id, dir, now)
	// El último cuadro que se vio es el primero del video: si la página está quieta, el screencast no manda nada
	// hasta que algo cambie, y el video arrancaría tarde.
	if l.lastFrame != nil {
		rec.push(l.lastFrame)
	}
	l.rec = rec
	return rec.info(true, ""), nil
}

// LiveRecordStatus dice si se está grabando y cuánto lleva.
func (r *Runner) LiveRecordStatus() (RecordingInfo, error) {
	l := r.liveSession()
	if l == nil {
		return RecordingInfo{}, errors.New("no hay sesión en vivo")
	}
	l.mu.Lock()
	rec := l.rec
	l.mu.Unlock()
	if rec == nil {
		return RecordingInfo{}, errors.New("no se está grabando: bin/jarvis record start")
	}
	return rec.info(true, ""), nil
}

// LiveRecordStop para la grabación y arma el mp4.
func (r *Runner) LiveRecordStop() (RecordingInfo, error) {
	l := r.liveSession()
	if l == nil {
		return RecordingInfo{}, errors.New("no hay sesión en vivo")
	}
	return l.stopRecording()
}

// stopRecording saca la grabación de la sesión y arma el video (también al cerrarse la sesión).
func (l *live) stopRecording() (RecordingInfo, error) {
	l.mu.Lock()
	rec := l.rec
	l.rec = nil
	l.mu.Unlock()
	if rec == nil {
		return RecordingInfo{}, errors.New("no se está grabando: bin/jarvis record start")
	}
	rec.close()
	video, err := rec.encode()
	return rec.info(false, video), err
}

// encode une los cuadros en recording.mp4 con el demuxer concat de ffmpeg: cada cuadro dura hasta el siguiente, y
// el último, un segundo. Sale a 30 cuadros por segundo, en H.264, al tamaño del primer cuadro (los demás se
// encajan con bandas si cambió el tamaño, p. ej. una ventana emergente).
func (rec *recording) encode() (string, error) {
	rec.mu.Lock()
	frames := append([]recFrame(nil), rec.frames...)
	w, h, werr := rec.w, rec.h, rec.err
	rec.mu.Unlock()
	if werr != nil {
		return "", fmt.Errorf("no se guardaron todos los cuadros: %w", werr)
	}
	if len(frames) == 0 {
		return "", errors.New("no llegó ningún cuadro: la pestaña no cambió mientras se grababa")
	}
	var list strings.Builder
	// El demuxer concat ignora la duración del PRIMER archivo (medido el 2026-11-23: 9 s de página quieta al
	// empezar se perdían y el video duraba 13 s en vez de 21): se repite el primero con una duración mínima.
	fmt.Fprintf(&list, "file '%s'\nduration 0.034\n", frames[0].file)
	for i, f := range frames {
		d := time.Second
		if i+1 < len(frames) {
			d = frames[i+1].at.Sub(f.at)
		}
		fmt.Fprintf(&list, "file '%s'\nduration %.3f\n", f.file, d.Seconds())
	}
	// El demuxer concat ignora la duración del último si no se repite el archivo.
	fmt.Fprintf(&list, "file '%s'\n", frames[len(frames)-1].file)
	listFile := filepath.Join(rec.dir, "frames.txt")
	if err := os.WriteFile(listFile, []byte(list.String()), 0o644); err != nil {
		return "", err
	}
	if w <= 0 || h <= 0 {
		w, h = 1280, 720
	}
	// En una pantalla retina los cuadros vienen al doble (3024 px de ancho): hasta 1920 alcanza y pesa mucho menos.
	if w > 1920 {
		h = h * 1920 / w
		w = 1920
	}
	w, h = w-w%2, h-h%2 // H.264 pide dimensiones pares
	vf := fmt.Sprintf("scale=%d:%d:force_original_aspect_ratio=decrease,pad=%d:%d:(ow-iw)/2:(oh-ih)/2:color=white,fps=30,format=yuv420p", w, h, w, h)
	out := filepath.Join(rec.dir, "recording.mp4")
	cmd := exec.Command("ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", listFile,
		"-vf", vf, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-movflags", "+faststart", out)
	if b, err := cmd.CombinedOutput(); err != nil {
		return "", fmt.Errorf("ffmpeg: %v: %s", err, strings.TrimSpace(string(b)))
	}
	return out, nil
}
