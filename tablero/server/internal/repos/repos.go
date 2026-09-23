// Package repos le pregunta a `tools/repos.py` —la lista ÚNICA de repos del playground— qué repos se
// pueden citar, dónde se ven en la web y si una ruta existe en un commit.
//
// No copia la lista, y a propósito: ese archivo documenta que una segunda copia fue la causa de cinco
// mentiras en cinco herramientas el 2026-09-18. Preguntarle cuesta un proceso de Python por consulta,
// que al agregar un bloque son dos o tres; se paga con gusto.
package repos

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
)

// File es lo que `repos.py archivo` contesta de una ruta: en qué commit se miró y si existe ahí.
type File struct {
	Alias  string `json:"alias"`
	Path   string `json:"path"`
	Ref    string `json:"ref"`
	Reason string `json:"reason"`
	SHA    string `json:"sha"`
	Exists bool   `json:"exists"`
	Web    string `json:"web"`
	Prefix string `json:"prefix"`
	Error  string `json:"error"`
}

// Web es dónde se ve un repo: su URL en GitHub y la carpeta que ocupa adentro (`harness/` es una
// carpeta de playground, no un repo propio).
type Web struct {
	Web    string `json:"web"`
	Prefix string `json:"prefix"`
}

type Client struct {
	script string
	once   sync.Once
	web    map[string]Web
	webErr error
}

// New recibe la ruta de `repos.py`; `layout.Find().Tools()` dice dónde está.
func New(tools string) *Client { return &Client{script: filepath.Join(tools, "repos.py")} }

func (c *Client) run(args ...string) ([]byte, error) {
	cmd := exec.Command("python3", append([]string{c.script}, args...)...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("repos.py %s: %v %s", strings.Join(args, " "), err, strings.TrimSpace(stderr.String()))
	}
	return out, nil
}

// File consulta una ruta. Sin `sha`, en la ref que el playground considera al día para ese repo.
func (c *Client) File(alias, path, sha string) (File, error) {
	args := []string{"archivo", alias, path}
	if sha != "" {
		args = append(args, sha)
	}
	out, err := c.run(args...)
	if err != nil {
		return File{}, err
	}
	var f File
	if err := json.Unmarshal(out, &f); err != nil {
		return File{}, fmt.Errorf("repos.py devolvió algo que no es JSON: %w", err)
	}
	if f.Error != "" {
		return f, errors.New(f.Error)
	}
	return f, nil
}

// Pin devuelve el commit en que existe la ruta: el que un bloque deja fijado en su enlace.
func (c *Client) Pin(alias, path, sha string) (string, error) {
	f, err := c.File(alias, path, sha)
	if err != nil {
		return "", err
	}
	if !f.Exists {
		return "", fmt.Errorf("%s/%s no existe en %s de %s (%s)", alias, f.Path, f.Ref, alias, f.Reason)
	}
	return f.SHA, nil
}

// Web: alias → dónde se ve. Se pregunta una vez por proceso: son los remotos de cada clon.
func (c *Client) Web() (map[string]Web, error) {
	c.once.Do(func() {
		out, err := c.run("web")
		if err != nil {
			c.webErr = err
			return
		}
		c.webErr = json.Unmarshal(out, &c.web)
	})
	return c.web, c.webErr
}

// Knows dice si un alias se puede citar.
func (c *Client) Knows(alias string) bool {
	web, err := c.Web()
	if err != nil {
		return false
	}
	_, ok := web[alias]
	return ok
}
