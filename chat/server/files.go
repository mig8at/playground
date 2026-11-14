package main

// LOS ADJUNTOS DEL CHAT, desde la interfaz: subir, bajar y mirar lo bajado. Todo pasa por el CLI (`playground curl
// … --data-binary` para subir, `playground get` para bajar): el chat no habla con el home por su cuenta.
//
// ⚠ Lo bajado lo mandó otra persona. Se guarda donde lo guarda el CLI (~/Downloads, sin permiso de ejecución) y la
//   interfaz sólo MUESTRA imágenes y PDF; todo lo demás se sirve como descarga y con `sandbox`, para que un HTML o un
//   SVG con código no corra en el origen del chat. Nada se abre ni se ejecuta solo.

import (
	"context"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"creditop/my-tools/chat/cli"
)

// maxUpload es el tope del home por adjunto (CHAT_FILE_MAX_MB): más grande lo rechazaría igual.
const maxUpload = 25 << 20

// saved recuerda dónde quedó cada adjunto bajado desde este chat, para mostrarlo y para «Mostrar en Finder».
var saved = struct {
	sync.Mutex
	byID map[string]cli.Saved
}{byID: map[string]cli.Saved{}}

// inline: lo único que la interfaz muestra adentro. Lo demás, como descarga.
var inline = map[string]string{".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
	".webp": "image/webp", ".pdf": "application/pdf"}

/*
cacheDir: donde quedan las imágenes que el chat baja solo para mostrarlas (como WhatsApp), aparte de Descargas para

	no llenarla. «Guardar en Descargas» copia una de acá.
*/
func cacheDir() (string, error) {
	base, err := os.UserCacheDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(base, "creditop-my-tools-chat", "adjuntos")
	return dir, os.MkdirAll(dir, 0o700)
}

// allowedDirs: las únicas carpetas de donde el chat sirve un archivo que no bajó en esta vuelta del server.
func allowedDirs() []string {
	home, _ := os.UserHomeDir()
	dirs := []string{filepath.Join(home, "Downloads")}
	if c, err := cacheDir(); err == nil {
		dirs = append(dirs, c)
	}
	return dirs
}

func insideAny(p string, dirs []string) bool {
	for _, d := range dirs {
		if strings.HasPrefix(p, d+string(filepath.Separator)) {
			return true
		}
	}
	return false
}

// savedPath devuelve el archivo de un adjunto bajado: el que se bajó en esta vuelta del server, o, después de
// reiniciarlo, uno que la interfaz recuerda y que sigue dentro de Descargas o del caché de imágenes del chat.
func savedPath(id, remembered string) (string, error) {
	if chatHistory != nil {
		if p, ok := chatHistory.savedFile(id); ok {
			return p, nil
		}
	}
	saved.Lock()
	s, ok := saved.byID[id]
	saved.Unlock()
	if ok {
		return s.Path, nil
	}
	p, err := filepath.Abs(remembered)
	if remembered == "" || err != nil || !insideAny(p, allowedDirs()) {
		return "", errors.New("ese adjunto no se bajó desde acá")
	}
	if info, err := os.Lstat(p); err != nil || !info.Mode().IsRegular() {
		return "", errors.New("el archivo ya no está en Descargas")
	}
	return p, nil
}

func registerFiles(mux *http.ServeMux) {
	// Subir un adjunto para alguien: el cuerpo es el archivo. Devuelve su ficha; el mensaje lo nombra después.
	mux.HandleFunc("POST /api/upload", func(w http.ResponseWriter, r *http.Request) {
		to, name := strings.TrimSpace(r.URL.Query().Get("to")), strings.TrimSpace(r.URL.Query().Get("name"))
		if to == "" || name == "" {
			fail(w, http.StatusBadRequest, errors.New("falta a quién (?to=) o el nombre del archivo (?name=)"))
			return
		}
		tmp, err := os.CreateTemp("", "chat-adjunto-*")
		if err != nil {
			fail(w, http.StatusInternalServerError, err)
			return
		}
		defer os.Remove(tmp.Name())
		n, err := io.Copy(tmp, http.MaxBytesReader(w, r.Body, maxUpload+1))
		tmp.Close()
		if err != nil {
			fail(w, http.StatusRequestEntityTooLarge, fmt.Errorf("el archivo pasa de %d MB", maxUpload>>20))
			return
		}
		if n == 0 {
			fail(w, http.StatusBadRequest, errors.New("el archivo está vacío"))
			return
		}
		contentType := r.Header.Get("Content-Type")
		if contentType == "" {
			contentType = "application/octet-stream"
		}
		ctx, cancel := context.WithTimeout(r.Context(), 3*time.Minute)
		defer cancel()
		file, err := cli.Upload(ctx, to, name, tmp.Name(), contentType)
		if err != nil {
			fail(w, http.StatusBadGateway, err)
			return
		}
		keepSent(file, tmp.Name())
		writeJSON(w, http.StatusOK, file)
	})

	// Bajar un adjunto que te mandaron: queda en ~/Downloads (y el home lo borra). Con ?cache=1 queda en el caché de
	// imágenes del chat: así se baja solo una imagen para mostrarla, sin llenar Descargas.
	mux.HandleFunc("POST /api/files/{id}/get", func(w http.ResponseWriter, r *http.Request) {
		// Ya bajado (lo bajó el recolector al llegar): se devuelve sin pedirlo otra vez.
		if r.URL.Query().Get("cache") == "1" && chatHistory != nil {
			if p, ok := chatHistory.savedFile(r.PathValue("id")); ok {
				writeJSON(w, http.StatusOK, cli.Saved{ID: r.PathValue("id"), Name: filepath.Base(p), Path: p})
				return
			}
		}
		ctx, cancel := context.WithTimeout(r.Context(), 3*time.Minute)
		defer cancel()
		dir := ""
		if r.URL.Query().Get("cache") == "1" {
			c, err := cacheDir()
			if err != nil {
				fail(w, http.StatusInternalServerError, err)
				return
			}
			dir = c
		}
		s, err := cli.Get(ctx, r.PathValue("id"), dir)
		if err != nil {
			fail(w, http.StatusBadGateway, err)
			return
		}
		saved.Lock()
		saved.byID[r.PathValue("id")] = s
		saved.Unlock()
		if dir != "" && chatHistory != nil {
			chatHistory.rememberFile(r.PathValue("id"), s.Path)
		}
		writeJSON(w, http.StatusOK, s)
	})

	// Lo bajado, para mirarlo: imágenes y PDF adentro; lo demás, como descarga y aislado.
	mux.HandleFunc("GET /api/files/{id}", func(w http.ResponseWriter, r *http.Request) {
		p, err := savedPath(r.PathValue("id"), r.URL.Query().Get("path"))
		if err != nil {
			fail(w, http.StatusNotFound, err)
			return
		}
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Content-Security-Policy", "sandbox")
		w.Header().Set("Cache-Control", "no-store")
		name := filepath.Base(p)
		if t, ok := inline[strings.ToLower(filepath.Ext(p))]; ok {
			w.Header().Set("Content-Type", t)
			w.Header().Set("Content-Disposition", mime.FormatMediaType("inline", map[string]string{"filename": name}))
		} else {
			w.Header().Set("Content-Type", "application/octet-stream")
			w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": name}))
		}
		http.ServeFile(w, r, p)
	})

	// Guardar en Descargas una imagen que el chat bajó a su caché: una copia, sin pisar nada.
	mux.HandleFunc("POST /api/files/{id}/save", func(w http.ResponseWriter, r *http.Request) {
		p, err := savedPath(r.PathValue("id"), r.URL.Query().Get("path"))
		if err != nil {
			fail(w, http.StatusNotFound, err)
			return
		}
		home, _ := os.UserHomeDir()
		target, err := copyUnique(p, filepath.Join(home, "Downloads"))
		if err != nil {
			fail(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"path": target})
	})

	// Mostrar en el Finder lo que se bajó (no lo abre: sólo lo señala).
	mux.HandleFunc("POST /api/files/{id}/reveal", func(w http.ResponseWriter, r *http.Request) {
		p, err := savedPath(r.PathValue("id"), r.URL.Query().Get("path"))
		if err != nil {
			fail(w, http.StatusNotFound, err)
			return
		}
		if runtime.GOOS != "darwin" {
			writeJSON(w, http.StatusOK, map[string]string{"path": p})
			return
		}
		if err := exec.Command("open", "-R", p).Run(); err != nil {
			fail(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"path": p})
	})
}

// copyUnique copia `src` a la carpeta `dir` con su nombre, agregando « (1)», « (2)»… si ya hay uno: nunca pisa nada.
// LO QUE MANDÁS TAMBIÉN SE VE. El home no devuelve tus propios adjuntos (y `playground get` los borraría antes de que
// los baje quien los recibe), así que lo que se sube desde acá se copia al caché del chat en el momento, con su nombre,
// y queda anotado como los que llegan. `/api/send` le pone la ficha al mensaje enviado: así la conversación lo pinta
// aunque el navegador no lo recuerde.
var sentFiles = struct {
	sync.Mutex
	byID map[string]cli.File
}{byID: map[string]cli.File{}}

func keepSent(file cli.File, src string) {
	if file.ID == "" {
		return
	}
	sentFiles.Lock()
	sentFiles.byID[file.ID] = file
	sentFiles.Unlock()
	dir, err := cacheDir()
	if err != nil || chatHistory == nil {
		return
	}
	if p, err := copyNamed(src, dir, file.Name); err == nil {
		chatHistory.rememberFile(file.ID, p)
	}
}

// sentFilesOf: las fichas de los adjuntos subidos desde acá, en el orden pedido; los que no se conocen se saltean.
func sentFilesOf(ids []string) []cli.File {
	sentFiles.Lock()
	defer sentFiles.Unlock()
	var out []cli.File
	for _, id := range ids {
		if f, ok := sentFiles.byID[id]; ok {
			out = append(out, f)
		}
	}
	return out
}

// copyNamed copia src a dir con el nombre `name` (sólo su base: nada de rutas), sin pisar uno que ya esté.
func copyNamed(src, dir, name string) (string, error) {
	name = filepath.Base(strings.TrimSpace(name))
	if name == "" || name == "." || name == string(filepath.Separator) {
		name = "adjunto"
	}
	staged := filepath.Join(filepath.Dir(src), name)
	if err := os.Link(src, staged); err != nil {
		return copyUnique(src, dir)
	}
	defer os.Remove(staged)
	return copyUnique(staged, dir)
}

func copyUnique(src, dir string) (string, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	name := filepath.Base(src)
	ext := filepath.Ext(name)
	stem := strings.TrimSuffix(name, ext)
	target := filepath.Join(dir, name)
	for n := 1; ; n++ {
		if _, err := os.Lstat(target); errors.Is(err, os.ErrNotExist) {
			break
		}
		target = filepath.Join(dir, fmt.Sprintf("%s (%d)%s", stem, n, ext))
	}
	in, err := os.Open(src)
	if err != nil {
		return "", err
	}
	defer in.Close()
	out, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return "", err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return "", err
	}
	return target, out.Close()
}
