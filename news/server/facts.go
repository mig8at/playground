package main

// LO QUE HUGGING FACE SABE DE CADA FAVORITO, medido y no escrito a mano: cuántos parámetros tiene, qué archivos trae
// y cuánto pesa cada uno, y con qué se corre. favorites.json lo escribe Claude a mano y a 43 de 119 les faltaba el
// tamaño; y un repo ya cuantizado (un GGUF de 1 bit) pesa mucho menos de lo que dicen sus parámetros, así que la cuenta
// de «¿entra acá?» fallaba justo con ésos. Esto lo saca de la API pública (sin cuenta) y lo guarda en
// news/.data/facts.json, fuera de git: cada máquina tiene el suyo y se renueva una vez por semana.

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"creditop/my-tools/lib/machine"
)

// Facts: lo medido de un modelo.
type Facts struct {
	Params  int64   `json:"params,omitempty"`  // safetensors.total o gguf.total
	GGUF    []int64 `json:"gguf,omitempty"`    // el tamaño de cada archivo .gguf con pesos (sin los proyectores), de menor a mayor
	Storage int64   `json:"storage,omitempty"` // todo el repo
	Engine  string  `json:"engine,omitempty"`  // llama · torch · mlx · onnx (con qué se corre)
	Fetched string  `json:"fetched"`
	Missing bool    `json:"missing,omitempty"` // Hugging Face no lo tiene (lo borraron o es privado): no se vuelve a pedir enseguida
}

type hfFacts struct {
	Library     string   `json:"library_name"`
	Tags        []string `json:"tags"`
	UsedStorage int64    `json:"usedStorage"`
	Safetensors *struct {
		Total int64 `json:"total"`
	} `json:"safetensors"`
	GGUF *struct {
		Total int64 `json:"total"`
	} `json:"gguf"`
	Siblings []struct {
		Name string `json:"rfilename"`
		Size int64  `json:"size"`
	} `json:"siblings"`
}

// factsOf arma lo medido a partir de la ficha de la API.
func factsOf(d hfFacts, now time.Time) Facts {
	f := Facts{Storage: d.UsedStorage, Fetched: now.Format(time.RFC3339)}
	if d.Safetensors != nil {
		f.Params = d.Safetensors.Total
	}
	if f.Params == 0 && d.GGUF != nil {
		f.Params = d.GGUF.Total
	}
	onnx, mlx := false, d.Library == "mlx"
	for _, s := range d.Siblings {
		low := strings.ToLower(s.Name)
		switch {
		case strings.HasSuffix(low, ".gguf") && !strings.Contains(low, "mmproj") && s.Size > 0:
			f.GGUF = append(f.GGUF, s.Size)
		case strings.HasSuffix(low, ".onnx"):
			onnx = true
		}
	}
	for _, t := range d.Tags {
		if t == "mlx" {
			mlx = true
		}
	}
	sort.Slice(f.GGUF, func(a, b int) bool { return f.GGUF[a] < f.GGUF[b] })
	switch {
	case len(f.GGUF) > 0:
		f.Engine = "llama"
	case mlx:
		f.Engine = "mlx"
	case d.Library != "" || d.Safetensors != nil:
		f.Engine = "torch" // transformers, diffusers, sentence-transformers…: todos corren sobre PyTorch
	case onnx:
		f.Engine = "onnx"
	}
	return f
}

// factStore: la caché en disco, con su candado. Se lee en cada pedido de favoritos y la escribe un solo trabajo de fondo.
type factStore struct {
	path string
	mu   sync.Mutex
	data map[string]Facts
	busy bool
}

func newFactStore(root string) *factStore {
	s := &factStore{path: filepath.Join(root, "news", ".data", "facts.json"), data: map[string]Facts{}}
	if raw, err := os.ReadFile(s.path); err == nil {
		_ = json.Unmarshal(raw, &s.data)
	}
	return s
}

func (s *factStore) get(id string) (Facts, bool) {
	if s == nil {
		return Facts{}, false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	f, ok := s.data[id]
	return f, ok
}

func (s *factStore) save() error {
	s.mu.Lock()
	raw, err := json.MarshalIndent(s.data, "", " ")
	s.mu.Unlock()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

const factsFresh = 7 * 24 * time.Hour

// refresh pide a Hugging Face lo que falta o quedó viejo, de a cuatro, y guarda. Corre de fondo: si no hay red, los
// favoritos salen igual, sin lo medido. Devuelve cuántos pidió.
func (s *factStore) refresh(ctx context.Context, ids []string, fetch func(context.Context, string) (hfFacts, error)) int {
	if s == nil {
		return 0
	}
	s.mu.Lock()
	if s.busy {
		s.mu.Unlock()
		return 0
	}
	s.busy = true
	now := time.Now()
	var todo []string
	for _, id := range ids {
		if f, ok := s.data[id]; ok {
			if t, err := time.Parse(time.RFC3339, f.Fetched); err == nil && now.Sub(t) < factsFresh {
				continue
			}
		}
		todo = append(todo, id)
	}
	s.mu.Unlock()
	defer func() { s.mu.Lock(); s.busy = false; s.mu.Unlock() }()
	if len(todo) == 0 {
		return 0
	}
	jobs := make(chan string)
	var wg sync.WaitGroup
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for id := range jobs {
				d, err := fetch(ctx, id)
				var f Facts
				switch {
				case err == nil:
					f = factsOf(d, time.Now())
				case strings.Contains(err.Error(), "HTTP 404") || strings.Contains(err.Error(), "HTTP 401"):
					f = Facts{Missing: true, Fetched: time.Now().Format(time.RFC3339)}
				default:
					continue // sin red o un error pasajero: se vuelve a intentar en la próxima
				}
				s.mu.Lock()
				s.data[id] = f
				s.mu.Unlock()
			}
		}()
	}
	for _, id := range todo {
		jobs <- id
	}
	close(jobs)
	wg.Wait()
	_ = s.save()
	return len(todo)
}

func fetchFacts(ctx context.Context, id string) (hfFacts, error) {
	var d hfFacts
	err := getJSON(ctx, hfBase+"/api/models/"+id+"?blobs=true", &d)
	return d, err
}

// CON QUÉ SE CORRE y si esta máquina lo tiene. Se mira una vez por proceso: preguntarle a Python si tiene torch tarda.
type engineState struct {
	Name  string `json:"name"`            // cómo se le dice: llama.cpp · PyTorch · MLX · ONNX Runtime
	Ready *bool  `json:"ready,omitempty"` // si está instalado acá; nil = no se puede saber desde acá
	Hint  string `json:"hint,omitempty"`  // cómo instalarlo en ESTA máquina, si falta
}

var (
	enginesOnce sync.Once
	enginesHere map[string]engineState
)

func engines() map[string]engineState {
	enginesOnce.Do(func() {
		yes, no := true, false
		has := func(bin string) *bool {
			if _, err := exec.LookPath(bin); err == nil {
				return &yes
			}
			return &no
		}
		m := machine.Detect()
		enginesHere = map[string]engineState{
			"llama": {Name: "llama.cpp", Ready: has("llama-server"), Hint: machine.InstallHint("llama-server")},
			"onnx":  {Name: "ONNX Runtime"},
		}
		// PyTorch: se le pregunta al python del sistema, con plazo. Un modelo puede traer su propio entorno (los de
		// ~/.cache/my-tools tienen su venv), así que «no» acá es «no en el python del sistema».
		torch := engineState{Name: "PyTorch", Ready: &no, Hint: "un entorno de Python con torch (cada modelo probado trae el suyo en ~/.cache/my-tools)"}
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		if exec.CommandContext(ctx, "python3", "-c", "import torch").Run() == nil {
			torch.Ready, torch.Hint = &yes, ""
		} else if venvs := torchVenvs(); len(venvs) > 0 {
			// Sin torch en el sistema, pero con el de los modelos probados: eso es tenerlo (es como se corren acá).
			// Antes decía «Falta PyTorch» con 92 favoritos, en una Mac que lo tiene en cada entorno (2026-11-19).
			torch.Ready, torch.Hint = &yes, ""
			torch.Name = fmt.Sprintf("PyTorch (en %d entorno%s de ~/.cache/my-tools)", len(venvs), map[bool]string{true: "", false: "s"}[len(venvs) == 1])
		}
		cancel()
		enginesHere["torch"] = torch
		mlx := engineState{Name: "MLX (sólo Apple Silicon)"}
		if m.Accel != "mps" {
			mlx.Ready, mlx.Hint = &no, "no hay MLX fuera de Apple Silicon: bajá la versión original del modelo"
		}
		enginesHere["mlx"] = mlx
		for k, e := range enginesHere {
			if e.Ready != nil && *e.Ready {
				e.Hint = ""
				enginesHere[k] = e
			}
		}
	})
	return enginesHere
}

// torchVenvs: los entornos de Python de los modelos probados que traen torch (`~/.cache/my-tools/<modelo>/.venv`), el
// mismo lugar en la Mac y en el PC.
func torchVenvs() []string {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil
	}
	found, _ := filepath.Glob(filepath.Join(home, ".cache", "my-tools", "*", ".venv", "lib", "python*", "site-packages", "torch"))
	return found
}
