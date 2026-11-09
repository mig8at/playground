package main

// EL HISTORIAL DEL CHAT, EN DISCO. El servidor es el dueño de lo que llegó: `playground listen` guarda en memoria sólo
// los últimos cien mensajes y los pierde si se reinicia, y el navegador sólo guardaba lo que veía con la ventana
// abierta. Acá quedan tres cosas, en ~/Library/Application Support/creditop-playground-chat/ (fuera de git, sólo para
// tu usuario):
//
//   - messages.jsonl: cada mensaje que pasó por el listen, una línea por mensaje y sin repetir. Lo junta un recolector
//     que pregunta cada pocos segundos, haya o no una ventana abierta.
//   - attachments.json: adjunto → dónde quedó. Las imágenes que llegan se bajan solas al caché del chat apenas llegan,
//     no cuando la pantalla las pinta.
//   - conversations.json: la copia de las conversaciones como las arma la interfaz (con canon, los agentes, lo que
//     contestó tu agente…). La interfaz la escribe y, si su almacenamiento está vacío, la lee al arrancar.
//
// ⚠ Lo que hay acá lo escribieron otras personas: se guarda tal cual y nunca se interpreta.

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"creditop/playground/chat/cli"
)

// imageAutoMax: la misma cota que usa la interfaz para bajar sola una imagen (IMAGE_AUTO_MAX).
const imageAutoMax = 15 << 20

// maxConversationsSnapshot: tope del JSON de conversaciones que guarda la interfaz.
const maxConversationsSnapshot = 64 << 20

var imageName = regexp.MustCompile(`(?i)\.(png|jpe?g|gif|webp)$`)

type history struct {
	mu    sync.Mutex
	dir   string
	seen  map[string]bool
	order []cli.Message
	files map[string]string // id del adjunto → archivo bajado
}

func historyDir() (string, error) {
	if d := os.Getenv("CHAT_HISTORY_DIR"); d != "" {
		return d, os.MkdirAll(d, 0o700)
	}
	base, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(base, "creditop-playground-chat")
	return dir, os.MkdirAll(dir, 0o700)
}

// messageKey: el id del home y, para lo viejo sin id, hora + quién + texto (como `legacyId` en la interfaz).
func messageKey(m cli.Message) string {
	if m.ID != "" {
		return m.Dir + "|" + m.ID
	}
	return m.Dir + "|" + m.Time + "|" + strings.ToLower(m.From.Email) + "|" + m.To + "|" + m.Text
}

func openHistory(dir string) (*history, error) {
	h := &history{dir: dir, seen: map[string]bool{}, files: map[string]string{}}
	if f, err := os.Open(filepath.Join(dir, "messages.jsonl")); err == nil {
		scanner := bufio.NewScanner(f)
		scanner.Buffer(make([]byte, 1<<20), 8<<20)
		for scanner.Scan() {
			var m cli.Message
			if json.Unmarshal(scanner.Bytes(), &m) != nil {
				continue // una línea cortada (se apagó a mitad de escribir): se salta
			}
			if k := messageKey(m); !h.seen[k] {
				h.seen[k] = true
				h.order = append(h.order, m)
			}
		}
		f.Close()
	}
	if b, err := os.ReadFile(filepath.Join(dir, "attachments.json")); err == nil {
		_ = json.Unmarshal(b, &h.files)
	}
	return h, nil
}

// add guarda los mensajes nuevos y devuelve cuáles eran nuevos.
func (h *history) add(messages []cli.Message) ([]cli.Message, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	var fresh []cli.Message
	for _, m := range messages {
		if k := messageKey(m); !h.seen[k] {
			h.seen[k] = true
			fresh = append(fresh, m)
		}
	}
	if len(fresh) == 0 {
		return nil, nil
	}
	f, err := os.OpenFile(filepath.Join(h.dir, "messages.jsonl"), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	enc := json.NewEncoder(f)
	for _, m := range fresh {
		if err := enc.Encode(m); err != nil {
			return nil, err
		}
		h.order = append(h.order, m)
	}
	return fresh, nil
}

func (h *history) all() []cli.Message {
	h.mu.Lock()
	defer h.mu.Unlock()
	return append([]cli.Message{}, h.order...)
}

// savedFile: dónde quedó un adjunto ya bajado, si el archivo sigue ahí.
func (h *history) savedFile(id string) (string, bool) {
	h.mu.Lock()
	p, ok := h.files[id]
	h.mu.Unlock()
	if !ok {
		return "", false
	}
	if info, err := os.Lstat(p); err != nil || !info.Mode().IsRegular() {
		return "", false
	}
	return p, true
}

func (h *history) rememberFile(id, path string) {
	h.mu.Lock()
	h.files[id] = path
	snapshot, _ := json.Marshal(h.files)
	h.mu.Unlock()
	_ = writeAtomic(filepath.Join(h.dir, "attachments.json"), snapshot)
}

func (h *history) savedFiles() map[string]string {
	h.mu.Lock()
	defer h.mu.Unlock()
	out := make(map[string]string, len(h.files))
	for id, p := range h.files {
		out[id] = p
	}
	return out
}

func writeAtomic(path string, data []byte) error {
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// collect trae lo que tiene el listen, guarda lo nuevo y baja las imágenes que llegaron. Devuelve lo nuevo.
func (h *history) collect(ctx context.Context) ([]cli.Message, error) {
	if !cli.Installed() {
		return nil, nil
	}
	live, err := cli.All(ctx)
	if err != nil {
		return nil, err
	}
	fresh, err := h.add(live)
	if err != nil {
		return nil, err
	}
	for _, m := range fresh {
		if m.Dir == "out" {
			continue
		}
		for _, f := range m.Files {
			h.fetchImage(ctx, f)
		}
	}
	return fresh, nil
}

// fetchImage baja una imagen recibida al caché del chat (como WhatsApp), una vez. Lo demás se baja con «Bajar».
func (h *history) fetchImage(ctx context.Context, f cli.File) {
	if f.ID == "" || f.Size > imageAutoMax || !imageName.MatchString(f.Name) || (f.Type != "" && !strings.HasPrefix(f.Type, "image/")) {
		return
	}
	if _, ok := h.savedFile(f.ID); ok {
		return
	}
	dir, err := cacheDir()
	if err != nil {
		return
	}
	getCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	s, err := cli.Get(getCtx, f.ID, dir)
	if err != nil {
		return // la interfaz lo muestra y deja reintentar
	}
	h.rememberFile(f.ID, s.Path)
}

// fetchImagesOf baja las imágenes de los mensajes recibidos (lo que acaba de llegar por /api/state).
func fetchImagesOf(messages []cli.Message) {
	if chatHistory == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	for _, m := range messages {
		if m.Dir == "out" {
			continue
		}
		for _, f := range m.Files {
			chatHistory.fetchImage(ctx, f)
		}
	}
}

// adoptCached reconoce los adjuntos que ya están en el caché del chat (bajados antes de que existiera este
// historial, o por otra vía), para no pedirlos otra vez: el home ya pudo haberlos borrado. Por su nombre y su sha256;
// el mensaje no siempre trae la huella, y entonces por nombre y tamaño exacto.
func (h *history) adoptCached() {
	dir, err := cacheDir()
	if err != nil {
		return
	}
	for _, m := range h.all() {
		for _, f := range m.Files {
			if f.ID == "" {
				continue
			}
			if _, ok := h.savedFile(f.ID); ok {
				continue
			}
			p := filepath.Join(dir, filepath.Base(f.Name))
			b, err := os.ReadFile(p)
			if err != nil {
				continue
			}
			sum := sha256.Sum256(b)
			same := f.SHA256 != "" && hex.EncodeToString(sum[:]) == f.SHA256
			if f.SHA256 == "" {
				same = f.Size > 0 && int64(len(b)) == f.Size
			}
			if same {
				h.rememberFile(f.ID, p)
			}
		}
	}
}

// run recolecta cada `every` mientras viva el servidor.
func (h *history) run(every time.Duration) {
	h.adoptCached()
	for {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		_, _ = h.collect(ctx)
		cancel()
		time.Sleep(every)
	}
}

var chatHistory *history

func historyHandlers(mux *http.ServeMux) {
	// La copia de las conversaciones de la interfaz: GET la devuelve ({} si no hay), PUT la reemplaza.
	mux.HandleFunc("GET /api/conversations", func(w http.ResponseWriter, r *http.Request) {
		if chatHistory == nil {
			fail(w, http.StatusServiceUnavailable, errors.New("el chat no tiene dónde guardar el historial"))
			return
		}
		b, err := os.ReadFile(filepath.Join(chatHistory.dir, "conversations.json"))
		if errors.Is(err, os.ErrNotExist) {
			b = []byte("{}")
		} else if err != nil {
			fail(w, http.StatusInternalServerError, err)
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		_, _ = w.Write(b)
	})
	mux.HandleFunc("PUT /api/conversations", func(w http.ResponseWriter, r *http.Request) {
		if chatHistory == nil {
			fail(w, http.StatusServiceUnavailable, errors.New("el chat no tiene dónde guardar el historial"))
			return
		}
		b, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxConversationsSnapshot))
		if err != nil {
			fail(w, http.StatusRequestEntityTooLarge, errors.New("las conversaciones pasan del tope"))
			return
		}
		var probe map[string]json.RawMessage
		if json.Unmarshal(b, &probe) != nil {
			fail(w, http.StatusBadRequest, errors.New("las conversaciones van como un objeto JSON"))
			return
		}
		if err := writeAtomic(filepath.Join(chatHistory.dir, "conversations.json"), b); err != nil {
			fail(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]int{"conversations": len(probe)})
	})
}
