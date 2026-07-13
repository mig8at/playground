package channel

import (
	"io"
	"net"
	"net/http"
	"os"
	"sync"
)

// StoreWebhook is a local mock of the merchant store endpoint. It captures the
// close-time webhook — the backend POSTs to ecommerce_requests.process_url when a
// Creditop X credit reaches Estado 11 (processEcommerceTransaction) — so the E2E
// can assert the store was actually notified. Before this, the harness pointed
// process_url at a dead host and never verified the POST (the webhook was a blind
// spot). It binds 0.0.0.0 so the Dockerized backend reaches it via
// host.docker.internal.
type StoreWebhook struct {
	mu   sync.Mutex
	hits []StoreHit
	srv  *http.Server
	port string
}

// StoreHit is one captured request to the mock store.
type StoreHit struct {
	Path string
	Body string
}

const storeWebhookPort = "9099"

// StoreWebhookURL, when non-empty, overrides the ecommerce process_url in the
// handshake (see web.go) so the close-time webhook hits this mock instead of the
// dead default. runOne sets it only when the listener actually came up.
var StoreWebhookURL string

// StartStoreWebhook starts the mock store listener on storeWebhookPort.
func StartStoreWebhook() (*StoreWebhook, error) {
	ln, err := net.Listen("tcp", ":"+storeWebhookPort)
	if err != nil {
		return nil, err
	}
	w := &StoreWebhook{port: storeWebhookPort}
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(rw http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		w.mu.Lock()
		w.hits = append(w.hits, StoreHit{Path: r.URL.Path, Body: string(b)})
		w.mu.Unlock()
		rw.Header().Set("Content-Type", "application/json")
		_, _ = rw.Write([]byte(`{"ok":true,"received":true}`)) // 200 so Http::post()->throw() succeeds
	})
	w.srv = &http.Server{Handler: mux}
	go func() { _ = w.srv.Serve(ln) }()
	return w, nil
}

// URL is the process_url handed to the backend (reachable from the container).
func (w *StoreWebhook) URL() string {
	return "http://host.docker.internal:" + w.port + "/webhook"
}

// Count returns how many requests the mock store received.
func (w *StoreWebhook) Count() int {
	w.mu.Lock()
	defer w.mu.Unlock()
	return len(w.hits)
}

// Last returns the most recent captured request, if any.
func (w *StoreWebhook) Last() (StoreHit, bool) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if len(w.hits) == 0 {
		return StoreHit{}, false
	}
	return w.hits[len(w.hits)-1], true
}

// Close stops the listener.
func (w *StoreWebhook) Close() {
	if w.srv != nil {
		_ = w.srv.Close()
	}
}

// storeProcessURL is the process_url put in the ecommerce contract. Priority:
//  1. E2E_STORE_WEBHOOK_URL — a PUBLIC receiver (e.g. webhook.site). Needed for --target=dev: the
//     dev cluster can't reach the local mock, so we point process_url at a public URL and verify the
//     POST there (the harness checks ecommerce_requests.processed=1 as the DB side-effect).
//  2. The local mock when its listener is up.
//  3. The dead default (webhook left unobserved).
func storeProcessURL() string {
	if u := os.Getenv("E2E_STORE_WEBHOOK_URL"); u != "" {
		return u
	}
	if StoreWebhookURL != "" {
		return StoreWebhookURL
	}
	return "https://tienda-e2e.test/webhook"
}
