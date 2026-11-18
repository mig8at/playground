package main

// Rust en la carpeta de pruebas: lo PRIMERO que Wally ejecuta de lo que escribe un modelo (2026-11-17). Compilar Rust
// ya es correr su código (un build.rs, una macro), así que nada de esto corre en la Mac: va dentro de un contenedor de
// la imagen `wally-rust` (wally/rust/Dockerfile) que
//   - no tiene red (`--network none`): por eso la imagen trae un conjunto FIJO de bibliotecas ya compiladas;
//   - ve SÓLO la carpeta del proyecto (/work) y un volumen propio para lo compilado (/target);
//   - tiene tope de memoria, de procesos y de tiempo, sin privilegios nuevos.
// Los comandos: `compilar`, `testear` y `check-api sandbox/<proyecto>`.

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

const (
	rustImage   = "wally-rust"
	rustTimeout = 12 * time.Minute // la primera compilación de un proyecto puede tardar; las siguientes, segundos
)

var (
	rustProject = regexp.MustCompile(`^sandbox/([a-z0-9][a-z0-9_-]{0,40})$`)
	cargoNoise  = regexp.MustCompile(`^\s*(Compiling|Downloaded|Downloading|Locking|Adding|Updating|Blocking|Fresh)\b`)
)

// dockerBin: Cockpit levanta a Wally con un PATH corto.
func dockerBin() (string, error) {
	if p, err := exec.LookPath("docker"); err == nil {
		return p, nil
	}
	home, _ := os.UserHomeDir()
	for _, p := range []string{"/usr/local/bin/docker", "/opt/homebrew/bin/docker", filepath.Join(home, ".docker", "bin", "docker"), "/Applications/Docker.app/Contents/Resources/bin/docker"} {
		if st, err := os.Stat(p); err == nil && !st.IsDir() {
			return p, nil
		}
	}
	return "", errors.New("no encuentro docker: hace falta Docker Desktop abierto para compilar o correr Rust")
}

// runRust corre un comando de cargo (o el probador de la API) para un proyecto, dentro del contenedor.
func (a *app) runRust(ctx context.Context, target, mode string) (string, int, error) {
	m := rustProject.FindStringSubmatch(target)
	if m == nil {
		return "va el proyecto, sin archivos: " + mode + " sandbox/<proyecto>", 1, nil
	}
	project := m[1]
	dir, err := a.sandboxAbs(project)
	if err != nil {
		return "", -1, err
	}
	if _, err := os.Stat(filepath.Join(dir, "Cargo.toml")); err != nil {
		return fmt.Sprintf("sandbox/%s no tiene Cargo.toml: no es un proyecto de Rust (escribí primero Cargo.toml y src/main.rs)", project), 1, nil
	}
	var inner []string
	switch mode {
	case "build":
		inner = []string{"cargo", "build", "--offline", "--color", "never"}
	case "test":
		inner = []string{"cargo", "test", "--offline", "--color", "never"}
	case "check-api":
		inner = []string{"check-api"}
	default:
		return "", -1, fmt.Errorf("modo desconocido: %s", mode)
	}
	raw, exit, err := a.runInContainer(ctx, project, dir, inner, rustTimeout, mode)
	if err != nil || exit == exitTimedOut {
		return raw, 1, err
	}
	text := ansi.ReplaceAllString(raw, "")
	if mode != "check-api" {
		var keep []string
		for _, l := range strings.Split(text, "\n") {
			if !cargoNoise.MatchString(l) {
				keep = append(keep, l)
			}
		}
		text = lastLines(strings.Join(keep, "\n"), 140)
		if exit == 0 {
			text = strings.TrimSpace(text) + "\n\nRESULTADO: " + map[string]string{"build": "compila.", "test": "los tests pasan."}[mode]
		} else {
			text = strings.TrimSpace(text) + "\n\nRESULTADO: " + map[string]string{"build": "NO compila: corregí los errores de arriba.", "test": "hay tests que fallan (o no compila): corregí lo de arriba."}[mode]
		}
	}
	return text, exit, nil
}

func lastLines(s string, n int) string {
	lines := strings.Split(strings.TrimRight(s, "\n"), "\n")
	if len(lines) > n {
		lines = append([]string{fmt.Sprintf("… (%d renglones antes)", len(lines)-n)}, lines[len(lines)-n:]...)
	}
	return strings.Join(lines, "\n")
}

// checkTextReport arma, de la salida de `check-api`, el resumen en datos para la tarjeta (los ✓ y ✗ de sus criterios).
func checkTextReport(text string) *checkReport {
	r := &checkReport{}
	for _, l := range strings.Split(text, "\n") {
		t := strings.TrimSpace(l)
		ok := strings.HasPrefix(t, "✓ ")
		if !ok && !strings.HasPrefix(t, "✗ ") {
			continue
		}
		name, detail, _ := strings.Cut(strings.TrimSpace(t[len("✓ "):]), " — ")
		r.Criteria = append(r.Criteria, struct {
			Name   string `json:"name"`
			OK     bool   `json:"ok"`
			Detail string `json:"detail,omitempty"`
		}{name, ok, detail})
		if !ok {
			r.Problems++
		}
	}
	if len(r.Criteria) == 0 && !strings.Contains(text, "RESULTADO: sin errores") {
		r.Problems = 1
		r.Note = strings.TrimSpace(strings.SplitN(strings.TrimSpace(text), "\n", 2)[0])
	}
	return r
}

const exitTimedOut = -99

// runInContainer corre un comando dentro del contenedor de un proyecto: SIN RED, viendo sólo su carpeta (/work) y su
// volumen de compilación (/target), con tope de memoria, procesos y tiempo. Es el único lugar donde se ejecuta algo
// que escribió o pidió un modelo. Devuelve la salida y el código (exitTimedOut si se cortó por tiempo).
func (a *app) runInContainer(ctx context.Context, project, dir string, inner []string, timeout time.Duration, what string) (string, int, error) {
	docker, err := dockerBin()
	if err != nil {
		return err.Error(), exitTimedOut, nil
	}
	if out, err := exec.CommandContext(ctx, docker, "image", "inspect", rustImage, "--format", "{{.Id}}").CombinedOutput(); err != nil {
		return fmt.Sprintf("falta la imagen `%s` (o Docker no está abierto): decile a Miguel que corra `make wally-rust`. %s", rustImage, strings.TrimSpace(string(out))), exitTimedOut, nil
	}
	name := fmt.Sprintf("wally-rust-%s-%d", project, time.Now().UnixNano())
	args := append([]string{"run", "--rm", "--name", name,
		"--network", "none", // sin red: ni para bajar bibliotecas ni para nada
		"--memory", "3g", "--cpus", "3", "--pids-limit", "512",
		"--security-opt", "no-new-privileges",
		"--tmpfs", "/tmp:exec,size=512m",
		"-v", dir + ":/work", // lo ÚNICO de la Mac que ve
		"-v", "wally-rust-target-" + project + ":/target",
		"-w", "/work", rustImage}, inner...)
	runCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	cmd := exec.CommandContext(runCtx, docker, args...)
	var out bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &out
	runErr := cmd.Run()
	if runCtx.Err() != nil {
		// Matar al cliente no mata el contenedor.
		_ = exec.Command(docker, "kill", name).Run()
		return fmt.Sprintf("%s tardó más de %s y se cortó. Lo último:\n%s", what, timeout, lastLines(out.String(), 20)), exitTimedOut, nil
	}
	exit := 0
	if runErr != nil {
		var ee *exec.ExitError
		if !errors.As(runErr, &ee) {
			return "", -1, fmt.Errorf("no pude correr docker: %v", runErr)
		}
		exit = ee.ExitCode()
	}
	return out.String(), exit, nil
}

const consoleTimeout = 5 * time.Minute

// runConsole: `consola sandbox/<proyecto> <comando>` — la terminal del agente (2026-11-17, Miguel: «que lo pruebe
// usando comandos de consola»). Corre CUALQUIER comando, pero dentro del contenedor del proyecto: lo peor que puede
// romper es su propio proyecto, que ya puede editar. El comando viaja como UN argumento a `bash -c` del contenedor:
// en la Mac no pasa por ningún shell.
func (a *app) runConsole(ctx context.Context, target, command string) (string, int, error) {
	m := rustProject.FindStringSubmatch(target)
	if m == nil {
		return "va el proyecto y después el comando: consola sandbox/<proyecto> <comando>", 1, nil
	}
	dir, err := a.sandboxAbs(m[1])
	if err != nil {
		return "", -1, err
	}
	if st, err := os.Stat(dir); err != nil || !st.IsDir() {
		return fmt.Sprintf("no existe el proyecto sandbox/%s (listar pruebas dice qué hay)", m[1]), 1, nil
	}
	raw, exit, err := a.runInContainer(ctx, m[1], dir, []string{"bash", "-c", command}, consoleTimeout, "el comando")
	if err != nil {
		return "", -1, err
	}
	if exit == exitTimedOut {
		return raw, 1, nil
	}
	text := lastLines(ansi.ReplaceAllString(raw, ""), 200)
	if r := []rune(text); len(r) > 20_000 {
		text = "… (salida cortada: se muestran los últimos 20 mil caracteres)\n" + string(r[len(r)-20_000:])
	}
	if strings.TrimSpace(text) == "" {
		text = "(sin salida)"
	}
	return text, exit, nil
}

// sandboxStamp: una huella de los archivos de un proyecto (ruta, tamaño y fecha), para saber si un comando de consola
// los tocó: si cambiaron, para el freno cuenta como una escritura y hay que volver a probar.
func (a *app) sandboxStamp(project string) string {
	var b strings.Builder
	root := filepath.Join(a.root, sandboxDir, project)
	_ = filepath.WalkDir(root, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() && (d.Name() == "target" || strings.HasPrefix(d.Name(), ".")) && p != root {
			return filepath.SkipDir
		}
		if info, err := d.Info(); err == nil && !d.IsDir() {
			fmt.Fprintf(&b, "%s|%d|%d\n", p, info.Size(), info.ModTime().UnixNano())
		}
		return nil
	})
	return hashText(b.String())
}
