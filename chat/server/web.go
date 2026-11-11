package main

// LA INTERFAZ DESDE ESTE SERVIDOR, y la guarda de quién le habla.
//
// Además de la API, el servidor sirve la interfaz ya compilada (`chat/dist`, `npm run build`): así Cockpit (cockpit/,
// la app de escritorio) abre http://127.0.0.1:5185 sin Vite. `make chat` sigue con Vite en :5184 y su proxy.
//
// ⚠ Esta API manda mensajes a tu nombre y escucha en 127.0.0.1, adonde también llega cualquier página que abras en el
// navegador. Por eso:
//   - el Host tiene que ser 127.0.0.1 o localhost (una página con su dominio apuntado a 127.0.0.1 —«DNS rebinding»— no
//     pasa);
//   - lo que escribe (todo menos GET y HEAD) con un Origin de navegador sólo pasa si viene de la interfaz del chat. Sin
//     Origin es un programa de esta máquina (bin/chat, curl), no una página.

import (
	"encoding/json"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// Los orígenes de la interfaz: Vite (`make chat`) y este servidor (Cockpit la abre desde acá).
var uiOrigins = map[string]bool{
	"http://localhost:5184": true, "http://127.0.0.1:5184": true,
	"http://localhost:5185": true, "http://127.0.0.1:5185": true,
}

func localHost(hostport string) bool {
	host, _, err := net.SplitHostPort(hostport)
	if err != nil {
		host = hostport
	}
	return host == "127.0.0.1" || host == "localhost"
}

func guard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !localHost(r.Host) {
			http.Error(w, "host no permitido", http.StatusForbidden)
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			if origin := r.Header.Get("Origin"); origin != "" && !uiOrigins[origin] {
				http.Error(w, "origen no permitido", http.StatusForbidden)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

// La carpeta de la interfaz compilada: CHAT_UI, o chat/dist del playground. Si no está, sólo la API.
func uiDir() string {
	if dir := os.Getenv("CHAT_UI"); dir != "" {
		return dir
	}
	root, err := playgroundRoot()
	if err != nil {
		return ""
	}
	dir := filepath.Join(root, "chat", "dist")
	if !fileExists(filepath.Join(dir, "index.html")) {
		return ""
	}
	return dir
}

// withUI deja /api/ a la API y sirve lo demás desde la interfaz compilada. index.html no se guarda en caché: después de
// un `npm run build` la app carga lo nuevo (los demás archivos llevan su huella en el nombre).
func withUI(api http.Handler, dir string) http.Handler {
	if dir == "" {
		return api
	}
	files := http.FileServer(http.Dir(dir))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			api.ServeHTTP(w, r)
			return
		}
		if r.URL.Path == "/" || r.URL.Path == "/index.html" {
			w.Header().Set("Cache-Control", "no-cache")
		}
		files.ServeHTTP(w, r)
	})
}

// Lo que cuenta la app de escritorio (src/desktop.js): qué trae y qué falló, al registro del servidor. Sin esto, un
// error adentro de su ventana no se ve en ningún lado.
func desktopLogHandlers(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/desktop/log", func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			Text string `json:"text"`
		}
		_ = json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&in)
		text := strings.ReplaceAll(in.Text, "\n", " ")
		if len(text) > 500 {
			text = text[:500]
		}
		log.Printf("app: %s", text)
		w.WriteHeader(http.StatusNoContent)
	})
}
