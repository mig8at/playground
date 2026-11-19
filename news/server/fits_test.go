package main

import (
	"context"
	"errors"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"creditop/my-tools/lib/machine"
	"creditop/my-tools/lib/models"
)

func params(n int64) *int64 { return &n }

var (
	pc  = machine.Info{ID: "pc", Here: "este PC", OS: "linux", RAM: 32 * gib, VRAM: 8 * gib, Accel: "cuda"}
	mac = machine.Info{ID: "mac", Here: "esta Mac", OS: "darwin", RAM: 36 * gib, VRAM: 36 * gib, Accel: "mps"}
)

func TestFitUsesWhatTheFileDeclaresForThatMachine(t *testing.T) {
	f := Favorite{ID: "a/b", Mac: "yes", Params: params(70e9)}
	if got := fitFor(mac, f); got.Status != "yes" || got.Basis != "declared" {
		t.Fatalf("en la Mac manda `mac`: %+v", got)
	}
	// para el PC no hay nada escrito: se estima, y 70 B no entra
	if got := fitFor(pc, f); got.Basis != "estimated" || got.Status != "no" {
		t.Fatalf("en el PC se estima: %+v", got)
	}
	f.PC = "yes"
	if got := fitFor(pc, f); got.Status != "yes" || got.Basis != "declared" {
		t.Fatalf("`pc` escrito manda sobre la cuenta: %+v", got)
	}
}

func TestEstimateBySize(t *testing.T) {
	for _, c := range []struct {
		name   string
		f      Favorite
		status string
	}{
		{"chico: entra entero en la GPU", Favorite{ID: "a/tiny", Params: params(600e6)}, "yes"},
		{"7 B: entra cuantizado", Favorite{ID: "a/seven", Params: params(7e9)}, "yes"},
		{"27 B: sólo en la RAM", Favorite{ID: "a/big", Params: params(27e9)}, "slow"},
		{"120 B: no entra", Favorite{ID: "a/huge", Params: params(120e9)}, "no"},
		{"sin tamaño: no se sabe", Favorite{ID: "a/x"}, "unknown"},
		{"formato de Apple", Favorite{ID: "mlx-community/parakeet", Params: params(600e6)}, "no"},
		{"pide NVIDIA y no dice tamaño", Favorite{ID: "nvidia/x", Group: "gpu"}, "unknown"},
	} {
		if got := estimate(pc, c.f); got.Status != c.status || got.Basis != "estimated" || got.Why == "" {
			t.Errorf("%s: %+v, quería %s", c.name, got, c.status)
		}
	}
	// en la Mac el formato de Apple no es un no
	if got := estimate(mac, Favorite{ID: "mlx-community/parakeet", Params: params(600e6)}); got.Status != "yes" {
		t.Errorf("MLX en la Mac: %+v", got)
	}
}

func TestTriedInDefaultsToTheMac(t *testing.T) {
	if triedIn(Favorite{TriedOn: "2026-11-19"}) != "mac" || triedIn(Favorite{TriedIn: "pc"}) != "pc" {
		t.Fatal("lo probado sin máquina escrita es de la Mac")
	}
}

func TestFactsFromTheModelCard(t *testing.T) {
	var d hfFacts
	d.UsedStorage = 3_673_559_296
	d.GGUF = &struct {
		Total int64 `json:"total"`
	}{Total: 600e6}
	d.Tags = []string{"gguf"}
	for _, f := range []struct {
		name string
		size int64
	}{{"Q-f16.gguf", 1_197_629_632}, {"Q-Q8_0.gguf", 639_150_592}, {"mmproj-Q.gguf", 900}, {"README.md", 10}} {
		d.Siblings = append(d.Siblings, struct {
			Name string `json:"rfilename"`
			Size int64  `json:"size"`
		}{f.name, f.size})
	}
	got := factsOf(d, time.Now())
	if got.Params != 600e6 || got.Engine != "llama" || len(got.GGUF) != 2 || got.GGUF[0] != 639_150_592 {
		t.Fatalf("facts: %+v", got)
	}
}

// Con los archivos a la vista manda el peso real: un 27 B de 1 bit que la cuenta por parámetros daba por «lento»
// entra en la GPU porque su GGUF pesa 6 GB.
func TestRealGGUFSizeBeatsTheParameterCount(t *testing.T) {
	f := Favorite{ID: "a/ternary-27B-gguf", Params: params(27e9)}
	if got := fitFor(pc, f); got.Status != "slow" {
		t.Fatalf("sin lo medido, por parámetros es lento: %+v", got)
	}
	got := fitWith(pc, f, Facts{GGUF: []int64{6 * gib, 20 * gib}, Engine: "llama"}, true)
	if got.Status != "yes" || got.Engine == nil || got.Engine.Name != "llama.cpp" {
		t.Fatalf("con un GGUF de 6 GB entra: %+v", got)
	}
	// lo declarado sigue mandando: en la Mac no se recalcula nada
	f.Mac = "no"
	if got := fitWith(mac, f, Facts{GGUF: []int64{6 * gib}}, true); got.Status != "no" || got.Basis != "declared" {
		t.Fatalf("lo declarado manda: %+v", got)
	}
	// y completa el tamaño que la ficha escrita a mano no trae
	if got := fitWith(pc, Favorite{ID: "a/x"}, Facts{Params: 600e6, Engine: "torch"}, true); got.Status != "yes" {
		t.Fatalf("con los parámetros medidos deja de ser «unknown»: %+v", got)
	}
}

func TestFactStoreAsksOnlyForWhatIsMissingOrOld(t *testing.T) {
	s := &factStore{path: filepath.Join(t.TempDir(), "facts.json"), data: map[string]Facts{
		"a/fresh": {Fetched: time.Now().Format(time.RFC3339)},
		"a/old":   {Fetched: time.Now().Add(-30 * 24 * time.Hour).Format(time.RFC3339)},
	}}
	var mu sync.Mutex
	asked := map[string]bool{}
	fetch := func(_ context.Context, id string) (hfFacts, error) {
		mu.Lock()
		asked[id] = true
		mu.Unlock()
		if id == "a/gone" {
			return hfFacts{}, errors.New("x: HTTP 404")
		}
		if id == "a/offline" {
			return hfFacts{}, errors.New("sin red")
		}
		return hfFacts{UsedStorage: 5}, nil
	}
	n := s.refresh(context.Background(), []string{"a/fresh", "a/old", "a/new", "a/gone", "a/offline"}, fetch)
	if n != 4 || asked["a/fresh"] || !asked["a/old"] || !asked["a/new"] {
		t.Fatalf("pidió %d: %v", n, asked)
	}
	if f, ok := s.get("a/gone"); !ok || !f.Missing {
		t.Fatal("lo que Hugging Face no tiene queda anotado, para no pedirlo en cada pedido")
	}
	if _, ok := s.get("a/offline"); ok {
		t.Fatal("un error pasajero no se guarda: se vuelve a intentar")
	}
	if _, err := os.Stat(s.path); err != nil {
		t.Fatal("la caché se guarda en disco")
	}
}

// El borrado respeta el registro en el SERVIDOR: lo que usa una herramienta pide force=1 (antes el aviso vivía sólo en
// el texto de la pantalla), y una máquina sin modelos manda una lista vacía, no null.
func TestDeleteAsksBeforeRemovingWhatAToolUses(t *testing.T) {
	root := t.TempDir()
	roots := models.Roots{Hub: filepath.Join(root, "hub"), Mine: filepath.Join(root, "mine"), Whisper: filepath.Join(root, "whisper")}
	s := &server{root: root, roots: roots}
	get := func(method, url string) (int, string) {
		req := httptest.NewRequest(method, url, nil)
		req.Header.Set("X-News", "1")
		rec := httptest.NewRecorder()
		s.routes().ServeHTTP(rec, req)
		return rec.Code, rec.Body.String()
	}
	if code, body := get("GET", "/api/installed"); code != 200 || !strings.Contains(body, `"installed":[]`) {
		t.Fatalf("sin modelos va una lista vacía: %d %s", code, body)
	}
	os.MkdirAll(roots.Whisper, 0o755)
	os.WriteFile(filepath.Join(roots.Whisper, "ggml-base.bin"), make([]byte, 30), 0o644)
	os.MkdirAll(filepath.Join(root, "models"), 0o755)
	os.WriteFile(models.RegistryPath(root), []byte(`{"uses":[{"tool":"chat","model":"openai/whisper","files":["whisper:ggml-base"],"what":"el dictado"}]}`), 0o644)
	s.forgetScan()
	if code, body := get("DELETE", "/api/installed?key=whisper:ggml-base"); code != 409 {
		t.Fatalf("en uso y sin force debe negarse: %d %s", code, body)
	}
	if _, err := os.Stat(filepath.Join(roots.Whisper, "ggml-base.bin")); err != nil {
		t.Fatal("no debía borrarse")
	}
	if code, body := get("DELETE", "/api/installed?key=whisper:ggml-base&force=1"); code != 200 {
		t.Fatalf("con force borra: %d %s", code, body)
	}
	if _, err := os.Stat(filepath.Join(roots.Whisper, "ggml-base.bin")); !os.IsNotExist(err) {
		t.Fatal("debía borrarse")
	}
}
