package main

/* El driver de Playwright. playwright-go lo baja como un zip (node + playwright-core) de un CDN que dejó de
 * publicarlos: las tres URLs que trae dan 404 (medido el 2026-11-05 con v0.5200.1 y v0.6000.0). El zip no
 * tiene nada propio, así que se arma igual: `npm pack playwright-core@<versión>` desplegado en package/ y el
 * node del sistema al lado. Queda en el mismo lugar donde playwright-go lo buscaría, y se arma una sola vez.
 */

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/playwright-community/playwright-go"
)

func ensureDriver(say func(kind, format string, args ...any)) (*playwright.RunOptions, error) {
	probe, err := playwright.NewDriver()
	if err != nil {
		return nil, err
	}
	cache, err := os.UserCacheDir()
	if err != nil {
		return nil, err
	}
	dir := filepath.Join(cache, "ms-playwright-go", probe.Version)
	opts := &playwright.RunOptions{DriverDirectory: dir, Browsers: []string{"chromium"}}

	node, err := exec.LookPath("node")
	if err != nil {
		return nil, fmt.Errorf("hace falta node en el PATH para el driver de Playwright: %w", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "package", "cli.js")); err != nil {
		say("info", "armando el driver de Playwright %s desde npm (una sola vez)…", probe.Version)
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return nil, err
		}
		tmp, err := os.MkdirTemp("", "navegador-driver-")
		if err != nil {
			return nil, err
		}
		defer os.RemoveAll(tmp)
		pack := exec.Command("npm", "pack", "playwright-core@"+probe.Version, "--silent", "--pack-destination", tmp)
		out, err := pack.CombinedOutput()
		if err != nil {
			return nil, fmt.Errorf("npm pack playwright-core@%s: %v\n%s", probe.Version, err, out)
		}
		tgz := filepath.Join(tmp, "playwright-core-"+probe.Version+".tgz")
		if out, err := exec.Command("tar", "-xzf", tgz, "-C", dir).CombinedOutput(); err != nil {
			return nil, fmt.Errorf("desplegar %s: %v\n%s", tgz, err, out)
		}
	}
	link := filepath.Join(dir, "node")
	if target, err := os.Readlink(link); err != nil || target != node {
		_ = os.Remove(link)
		if err := os.Symlink(node, link); err != nil {
			return nil, err
		}
	}
	return opts, nil
}
