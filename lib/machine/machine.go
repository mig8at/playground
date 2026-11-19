// Package machine: en qué máquina corre my-tools. El repo es UNO y se usa en dos máquinas distintas —la Mac de Miguel
// (Apple Silicon: la GPU comparte la memoria con el resto) y su PC con Linux (una GPU NVIDIA con su propia memoria)—,
// así que lo que depende de la máquina («corre acá», «instalado acá», cuánta memoria hay) se pregunta en un solo lugar
// en vez de escribir «la Mac» en cada herramienta.
//
// Lo que NO hace: no decide nada por nombre de equipo ni guarda nada en disco. Mira el sistema cada vez que arranca un
// proceso (una vez por proceso: Detect guarda el resultado).
package machine

import (
	"bufio"
	"context"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Info: lo que se sabe de esta máquina. Los ids son estables porque van como clave en archivos que están en git
// (news/favorites.json: `mac`, `pc`).
type Info struct {
	ID    string `json:"id"`    // mac · pc
	Label string `json:"label"` // «la Mac» · «el PC»: como se la nombra en una frase
	Here  string `json:"here"`  // «esta Mac» · «este PC»
	OS    string `json:"os"`    // darwin · linux
	Arch  string `json:"arch"`
	CPU   string `json:"cpu,omitempty"`
	RAM   int64  `json:"ram"` // bytes
	GPU   string `json:"gpu,omitempty"`
	// VRAM: la memoria que puede usar la GPU. En Apple Silicon es la misma RAM (memoria unificada); en un PC, la de la
	// tarjeta. 0 = sin GPU utilizable para modelos.
	VRAM int64 `json:"vram"`
	// Accel: con qué se aceleran los modelos acá. mps (Metal, Apple Silicon) · cuda (NVIDIA) · cpu.
	Accel string `json:"accel"`
}

var (
	once sync.Once
	info Info
)

// Detect: esta máquina. Nunca falla: lo que no se puede leer queda en cero y Accel en «cpu».
func Detect() Info {
	once.Do(func() { info = detect() })
	return info
}

func detect() Info {
	m := Info{OS: runtime.GOOS, Arch: runtime.GOARCH, Accel: "cpu"}
	switch runtime.GOOS {
	case "darwin":
		m.ID, m.Label, m.Here = "mac", "la Mac", "esta Mac"
		m.RAM = atoi(run("sysctl", "-n", "hw.memsize"))
		m.CPU = run("sysctl", "-n", "machdep.cpu.brand_string")
		if runtime.GOARCH == "arm64" {
			// memoria unificada: la GPU usa la misma RAM
			m.GPU, m.VRAM, m.Accel = m.CPU, m.RAM, "mps"
		}
	default:
		m.ID, m.Label, m.Here = "pc", "el PC", "este PC"
		m.RAM = meminfoTotal(readFile("/proc/meminfo"))
		m.CPU = cpuinfoModel(readFile("/proc/cpuinfo"))
		if name, vram, ok := nvidia(run("nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader,nounits")); ok {
			m.GPU, m.VRAM, m.Accel = name, vram, "cuda"
		}
	}
	return m
}

// run: la salida de un comando corto, o "" si no está o tarda (nvidia-smi puede colgarse con el driver a medias).
func run(name string, args ...string) string {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, name, args...).Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

func readFile(path string) string { b, _ := os.ReadFile(path); return string(b) }

func atoi(s string) int64 { n, _ := strconv.ParseInt(strings.TrimSpace(s), 10, 64); return n }

// meminfoTotal: «MemTotal:       32621212 kB» → bytes.
func meminfoTotal(text string) int64 {
	sc := bufio.NewScanner(strings.NewReader(text))
	for sc.Scan() {
		if f := strings.Fields(sc.Text()); len(f) >= 2 && f[0] == "MemTotal:" {
			return atoi(f[1]) * 1024
		}
	}
	return 0
}

// cpuinfoModel: el primer «model name» de /proc/cpuinfo.
func cpuinfoModel(text string) string {
	sc := bufio.NewScanner(strings.NewReader(text))
	for sc.Scan() {
		if k, v, ok := strings.Cut(sc.Text(), ":"); ok && strings.TrimSpace(k) == "model name" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

// nvidia: la GPU con más memoria de lo que imprime nvidia-smi («NVIDIA GeForce RTX 3070, 8192», en MiB).
func nvidia(out string) (name string, vram int64, ok bool) {
	for _, line := range strings.Split(out, "\n") {
		n, mib, found := strings.Cut(line, ",")
		if !found {
			continue
		}
		if b := atoi(mib) * 1024 * 1024; b > vram {
			name, vram, ok = strings.TrimSpace(n), b, true
		}
	}
	return name, vram, ok
}

// InstallHint: cómo se instala una herramienta de sistema EN ESTA máquina, para el mensaje de «falta X». Antes los
// mensajes decían `brew install …` siempre, que en el PC no sirve.
func InstallHint(tool string) string {
	names := map[string][2]string{ // herramienta → paquete de brew, paquete de pacman
		"llama-server": {"llama.cpp", "llama-cpp"},
		"whisper-cli":  {"whisper-cpp", "whisper-cpp"},
		"ffmpeg":       {"ffmpeg", "ffmpeg"},
	}
	pkg, ok := names[tool]
	if !ok {
		pkg = [2]string{tool, tool}
	}
	if runtime.GOOS == "darwin" {
		return "brew install " + pkg[0]
	}
	if _, err := exec.LookPath("pacman"); err == nil {
		return "sudo pacman -S " + pkg[1]
	}
	return "instalá " + pkg[1] + " con el gestor de paquetes de esta máquina"
}
