// Package identity namespacea los datos de prueba en una BD de desarrollo COMPARTIDA.
// Cada dev trabaja en su propio "seed" (espacio): no choca con otros (UPSERT, teléfonos/
// docs únicos) y puede borrar SOLO lo suyo (cognito_id LIKE '%__{seed}_test').
//
// El seed es estable por máquina (persistido) y legible (derivado de usuario@host).
// Override: env CREDITOP_SEED. Portado 1:1 de creditop-cli/src/lib/identity.ts — lee el
// MISMO archivo ~/.creditop-cli/identity.json para mantener continuidad de cleanup con
// los datos que sembró la versión TS.
package identity

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
)

var (
	once   sync.Once
	cached string
)

// slug deja solo a-z0-9 (minúsculas), recortado a max: seguro para SQL LIKE y columnas únicas.
func slug(s string, max int) string {
	s = strings.ToLower(s)
	var b strings.Builder
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
		}
	}
	out := b.String()
	if len(out) > max {
		out = out[:max]
	}
	return out
}

func identityFile() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".creditop-cli", "identity.json")
}

// Seed devuelve el tag estable y corto que identifica a ESTE usuario/máquina.
// Prioridad: env CREDITOP_SEED → archivo persistido → derivado de usuario@host.
func Seed() string {
	once.Do(func() { cached = computeSeed() })
	return cached
}

func computeSeed() string {
	// Prioridad: env SEED (de .env.local/.env.dev) → CREDITOP_SEED → archivo → derivado.
	if env := slug(os.Getenv("SEED"), 10); env != "" {
		return env
	}
	if env := slug(os.Getenv("CREDITOP_SEED"), 10); env != "" {
		return env
	}

	file := identityFile()
	if data, err := os.ReadFile(file); err == nil {
		var saved struct {
			Seed string `json:"seed"`
		}
		if json.Unmarshal(data, &saved) == nil && saved.Seed != "" && slug(saved.Seed, 10) == saved.Seed {
			return saved.Seed
		}
	}

	// Derivar de usuario + host (legible + desambiguación corta del host).
	base := "dev"
	if u := os.Getenv("USER"); u != "" {
		base = u
	} else if u := os.Getenv("LOGNAME"); u != "" {
		base = u
	}
	seed := slug(base, 8)
	if seed == "" {
		seed = "dev"
	}
	host, _ := os.Hostname()
	if i := strings.IndexByte(host, '.'); i >= 0 {
		host = host[:i]
	}
	if host != "" {
		var h uint32
		for i := 0; i < len(host); i++ {
			h = h*31 + uint32(host[i])
		}
		seed += strconv.FormatUint(uint64(h%1296), 36) // 0..2 chars base36
	}

	if err := os.MkdirAll(filepath.Dir(file), 0o755); err == nil {
		if data, err := json.MarshalIndent(map[string]string{"seed": seed}, "", "  "); err == nil {
			_ = os.WriteFile(file, data, 0o644)
		}
	}
	return seed
}

// TestSuffix es el sufijo legacy (`__{seed}_test`). Conservado por compatibilidad; el
// formato vigente es TestName (más descriptivo, seed al frente).
func TestSuffix(seed string) string {
	if seed == "" {
		seed = Seed()
	}
	return "__" + seed + "_test"
}

// TestName construye el identificador DESCRIPTIVO de un recurso de prueba:
//   {seed}-{slug}-test   (ej. "mig-adviser-test")
// El seed va al frente para legibilidad; el slug describe el rol/recurso.
func TestName(seed, descriptiveSlug string) string {
	if seed == "" {
		seed = Seed()
	}
	return seed + "-" + descriptiveSlug + "-test"
}

// TestLike es el patrón SQL LIKE para encontrar TODOS los recursos de un seed (cleanup):
//   {seed}-%-test
func TestLike(seed string) string {
	if seed == "" {
		seed = Seed()
	}
	return seed + "-%-test"
}
