package main

// Rust en la carpeta de pruebas: lo PRIMERO que Wally ejecuta de lo que escribe un modelo (2026-11-17). Compilar Rust
// ya es correr su código (un build.rs, una macro), así que nada de esto corre en la Mac: va dentro de un contenedor de
// la imagen `wally-rust` (wally/rust/Dockerfile) que
//   - no tiene red (`--network none`): por eso la imagen trae un conjunto FIJO de bibliotecas ya compiladas;
//   - ve SÓLO la carpeta del proyecto (/work) y un volumen propio para lo compilado (/target);
//   - tiene tope de memoria, de procesos y de tiempo, sin privilegios nuevos.
// Los comandos: `compilar`, `testear` y `probar-api pruebas/<proyecto>`.

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
	rustProject = regexp.MustCompile(`^pruebas/([a-z0-9][a-z0-9_-]{0,40})$`)
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
		return "va el proyecto, sin archivos: " + mode + " pruebas/<proyecto>", 1, nil
	}
	project := m[1]
	dir, err := a.sandboxAbs(project)
	if err != nil {
		return "", -1, err
	}
	if _, err := os.Stat(filepath.Join(dir, "Cargo.toml")); err != nil {
		return fmt.Sprintf("pruebas/%s no tiene Cargo.toml: no es un proyecto de Rust (escribí primero Cargo.toml y src/main.rs)", project), 1, nil
	}
	docker, err := dockerBin()
	if err != nil {
		return err.Error(), 1, nil
	}
	if out, err := exec.CommandContext(ctx, docker, "image", "inspect", rustImage, "--format", "{{.Id}}").CombinedOutput(); err != nil {
		return fmt.Sprintf("falta la imagen `%s` (o Docker no está abierto): decile a Miguel que corra `make wally-rust`. %s", rustImage, strings.TrimSpace(string(out))), 1, nil
	}
	var inner []string
	switch mode {
	case "compilar":
		inner = []string{"cargo", "build", "--offline", "--color", "never"}
	case "testear":
		inner = []string{"cargo", "test", "--offline", "--color", "never"}
	case "probar-api":
		inner = []string{"probar-api"}
	default:
		return "", -1, fmt.Errorf("modo desconocido: %s", mode)
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
	runCtx, cancel := context.WithTimeout(ctx, rustTimeout)
	defer cancel()
	cmd := exec.CommandContext(runCtx, docker, args...)
	var out bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &out
	runErr := cmd.Run()
	if runCtx.Err() != nil {
		// Matar al cliente no mata el contenedor.
		_ = exec.Command(docker, "kill", name).Run()
		return fmt.Sprintf("%s tardó más de %s y se cortó. Lo último:\n%s", mode, rustTimeout, lastLines(out.String(), 20)), 1, nil
	}
	exit := 0
	if runErr != nil {
		var ee *exec.ExitError
		if !errors.As(runErr, &ee) {
			return "", -1, fmt.Errorf("no pude correr docker: %v", runErr)
		}
		exit = ee.ExitCode()
	}
	text := ansi.ReplaceAllString(out.String(), "")
	if mode != "probar-api" {
		var keep []string
		for _, l := range strings.Split(text, "\n") {
			if !cargoNoise.MatchString(l) {
				keep = append(keep, l)
			}
		}
		text = lastLines(strings.Join(keep, "\n"), 140)
		if exit == 0 {
			text = strings.TrimSpace(text) + "\n\nRESULTADO: " + map[string]string{"compilar": "compila.", "testear": "los tests pasan."}[mode]
		} else {
			text = strings.TrimSpace(text) + "\n\nRESULTADO: " + map[string]string{"compilar": "NO compila: corregí los errores de arriba.", "testear": "hay tests que fallan (o no compila): corregí lo de arriba."}[mode]
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

// checkTextReport arma, de la salida de `probar-api`, el resumen en datos para la tarjeta (los ✓ y ✗ de sus criterios).
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
