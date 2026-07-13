package main

import (
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"sync"
)

// El webhook ecommerce real lo emite el backend de dev, que NO alcanza tu localhost. Pero en el atajo
// sintético el POST lo hace el propio MCP → un receiver local es 100% alcanzable y autocontenido.

type capturedReq struct {
	Method, Path, Body string
}

// loopback es un mini-receiver HTTP efímero (127.0.0.1:puerto-libre) que captura UN POST entrante.
type loopback struct {
	url string
	srv *http.Server
	mu  sync.Mutex
	cap *capturedReq
}

func startLoopback() (*loopback, error) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	lb := &loopback{}
	lb.srv = &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		lb.mu.Lock()
		lb.cap = &capturedReq{r.Method, r.URL.Path, string(b)}
		lb.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"ok":true,"source":"creditop-mcp loopback"}`))
	})}
	lb.url = "http://" + ln.Addr().String() + "/webhook"
	go lb.srv.Serve(ln)
	return lb, nil
}

func (l *loopback) captured() *capturedReq {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.cap
}
func (l *loopback) close() { _ = l.srv.Close() }

// serveWebhook corre un mini-server de larga vida que imprime cada POST que reciba — para testear a mano
// (curl o apuntar el process_url de un ecommerce_request acá). Bloquea hasta Ctrl-C.
func serveWebhook(addr string) error {
	if addr == "" {
		addr = "127.0.0.1:8787"
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		fmt.Fprintf(os.Stderr, "← %s %s\n%s\n\n", r.Method, r.URL.Path, string(b))
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"ok":true,"source":"creditop-mcp webhook-server"}`))
	})
	fmt.Fprintf(os.Stderr, "creditop-mcp webhook server en http://%s  (POST acá; Ctrl-C para parar)\n", addr)
	return http.ListenAndServe(addr, mux)
}
