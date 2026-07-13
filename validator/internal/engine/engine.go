// Package engine es el motor genérico de generación de tráfico, compartido por
// todos los proyectos. La parte específica de cada servicio (URL y endpoints)
// vive en su propio main.go, que solo define escenarios y llama a engine.Run.
package engine

import (
	"bytes"
	"context"
	"flag"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"os"
	"os/signal"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// Scenario describe una petición a generar y su peso relativo en el mix.
type Scenario struct {
	Name        string
	Method      string
	Path        string
	Body        string
	ContentType string
	Weight      int
	External    bool // requiere egress a internet (solo si --external)
}

// Options es lo que cada servicio define para su validación.
type Options struct {
	DefaultURL string     // URL base por defecto (override con --url)
	Scenarios  []Scenario // mix de endpoints de ESTE servicio
}

type config struct {
	baseURL     string
	rate        int
	duration    time.Duration
	concurrency int
	external    bool
}

// Run parsea flags, genera el tráfico según opts y reporta en consola.
func Run(opts Options) {
	cfg := parseFlags(opts.DefaultURL)

	enabled := make([]Scenario, 0, len(opts.Scenarios))
	for _, sc := range opts.Scenarios {
		if sc.External && !cfg.external {
			continue
		}
		enabled = append(enabled, sc)
	}
	if len(enabled) == 0 {
		fmt.Println("no hay escenarios habilitados")
		return
	}
	totalWeight := 0
	for _, sc := range enabled {
		totalWeight += sc.Weight
	}

	fmt.Printf("▶ validator -> %s\n", cfg.baseURL)
	fmt.Printf("  rate=%d req/s  duration=%s  concurrency=%d  external=%t\n\n",
		cfg.rate, cfg.duration, cfg.concurrency, cfg.external)

	client := &http.Client{Timeout: 40 * time.Second}
	st := newStats()

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
	defer cancel()
	ctx, cancelTimeout := context.WithTimeout(ctx, cfg.duration)
	defer cancelTimeout()

	jobs := make(chan Scenario, cfg.concurrency*2)

	// Dispatcher: emite trabajos al ritmo configurado.
	go func() {
		interval := time.Second / time.Duration(max(cfg.rate, 1))
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		defer close(jobs)
		rng := rand.New(rand.NewSource(time.Now().UnixNano()))
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				select {
				case jobs <- pick(enabled, totalWeight, rng):
				default: // workers saturados; se descarta este tick
				}
			}
		}
	}()

	// Workers.
	var wg sync.WaitGroup
	for i := 0; i < cfg.concurrency; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for sc := range jobs {
				do(client, cfg.baseURL, sc, st)
			}
		}()
	}

	// Impresor de stats en vivo.
	printerDone := make(chan struct{})
	go func() {
		defer close(printerDone)
		start := time.Now()
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				printLive(st, time.Since(start))
			}
		}
	}()

	wg.Wait()
	<-printerDone
	fmt.Print("\r\033[K") // limpia la línea en vivo
	printSummary(st)
}

func parseFlags(defaultURL string) config {
	var cfg config
	flag.StringVar(&cfg.baseURL, "url", envOr("VALIDATOR_URL", defaultURL), "URL base del servicio")
	flag.IntVar(&cfg.rate, "rate", 8, "peticiones por segundo (global)")
	flag.DurationVar(&cfg.duration, "duration", 2*time.Minute, "duración total (ej: 90s, 5m)")
	flag.IntVar(&cfg.concurrency, "concurrency", 12, "número de workers concurrentes")
	flag.BoolVar(&cfg.external, "external", false, "incluir escenarios que descargan URLs externas")
	flag.Parse()
	cfg.baseURL = strings.TrimRight(cfg.baseURL, "/")
	return cfg
}

func pick(scs []Scenario, total int, rng *rand.Rand) Scenario {
	r := rng.Intn(total)
	acc := 0
	for _, sc := range scs {
		acc += sc.Weight
		if r < acc {
			return sc
		}
	}
	return scs[len(scs)-1]
}

func do(client *http.Client, base string, sc Scenario, st *stats) {
	var body *bytes.Reader
	if sc.Body != "" {
		body = bytes.NewReader([]byte(sc.Body))
	} else {
		body = bytes.NewReader(nil)
	}
	req, err := http.NewRequest(sc.Method, base+sc.Path, body)
	if err != nil {
		st.record(sc.Name, 0, 0, true)
		return
	}
	if sc.ContentType != "" {
		req.Header.Set("Content-Type", sc.ContentType)
	}
	start := time.Now()
	resp, err := client.Do(req)
	lat := time.Since(start)
	if err != nil {
		st.record(sc.Name, 0, lat, true)
		return
	}
	_, _ = io.Copy(io.Discard, resp.Body)
	_ = resp.Body.Close()
	st.record(sc.Name, resp.StatusCode, lat, false)
}

// stats acumula resultados de forma concurrente.
type stats struct {
	total    atomic.Int64
	class2   atomic.Int64
	class3   atomic.Int64
	class4   atomic.Int64
	class5   atomic.Int64
	errs     atomic.Int64
	latNsTot atomic.Int64

	mu     sync.Mutex
	byName map[string]int64
	byCode map[int]int64
}

func newStats() *stats {
	return &stats{byName: map[string]int64{}, byCode: map[int]int64{}}
}

func (s *stats) record(name string, code int, lat time.Duration, transportErr bool) {
	s.total.Add(1)
	s.latNsTot.Add(lat.Nanoseconds())
	if transportErr {
		s.errs.Add(1)
	} else {
		switch code / 100 {
		case 2:
			s.class2.Add(1)
		case 3:
			s.class3.Add(1)
		case 4:
			s.class4.Add(1)
		case 5:
			s.class5.Add(1)
		}
	}
	s.mu.Lock()
	s.byName[name]++
	if !transportErr {
		s.byCode[code]++
	}
	s.mu.Unlock()
}

func printLive(st *stats, elapsed time.Duration) {
	total := st.total.Load()
	rps := 0.0
	if elapsed.Seconds() > 0 {
		rps = float64(total) / elapsed.Seconds()
	}
	avgMs := 0.0
	if total > 0 {
		avgMs = float64(st.latNsTot.Load()) / float64(total) / 1e6
	}
	fmt.Printf("\r\033[K[%6.0fs] total=%-6d %.1f req/s | 2xx=%d 4xx=%d 5xx=%d err=%d | avg=%.0fms",
		elapsed.Seconds(), total, rps,
		st.class2.Load(), st.class4.Load(), st.class5.Load(), st.errs.Load(), avgMs)
}

func printSummary(st *stats) {
	total := st.total.Load()
	fmt.Println("──────────────────────────────────────────────")
	fmt.Println("Resumen")
	fmt.Println("──────────────────────────────────────────────")
	fmt.Printf("  Total peticiones : %d\n", total)
	fmt.Printf("  2xx=%d  3xx=%d  4xx=%d  5xx=%d  transport-err=%d\n",
		st.class2.Load(), st.class3.Load(), st.class4.Load(), st.class5.Load(), st.errs.Load())
	if total > 0 {
		fmt.Printf("  Latencia media   : %.0f ms\n", float64(st.latNsTot.Load())/float64(total)/1e6)
	}

	st.mu.Lock()
	defer st.mu.Unlock()

	fmt.Println("\n  Por status_code:")
	codes := make([]int, 0, len(st.byCode))
	for c := range st.byCode {
		codes = append(codes, c)
	}
	sort.Ints(codes)
	for _, c := range codes {
		fmt.Printf("    %d : %d\n", c, st.byCode[c])
	}

	fmt.Println("\n  Por escenario:")
	names := make([]string, 0, len(st.byName))
	for n := range st.byName {
		names = append(names, n)
	}
	sort.Strings(names)
	for _, n := range names {
		fmt.Printf("    %-30s %d\n", n, st.byName[n])
	}
	fmt.Println("──────────────────────────────────────────────")
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// LoadDotenv parsea contenido tipo .env (KEY=VALUE por línea) y exporta cada
// variable que no esté ya definida en el entorno. Ignora comentarios (#) y
// líneas vacías. Lo usa cada servicio para fijar su URL por defecto.
func LoadDotenv(content string) {
	for _, line := range strings.Split(content, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		k = strings.TrimSpace(k)
		v = strings.Trim(strings.TrimSpace(v), `"'`)
		if k == "" {
			continue
		}
		if _, exists := os.LookupEnv(k); !exists {
			_ = os.Setenv(k, v)
		}
	}
}
