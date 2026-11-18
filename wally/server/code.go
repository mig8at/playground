package main

// LEER CÓDIGO, para poner al día la biblioteca: qué fuentes de un tema cambiaron, qué cambió en una, y cómo está un
// archivo hoy en main. Lo mismo que mira `make knowledge-check`: los clones locales de tools/repos.json y su
// `origin/main` (o la rama que fije `branches`), sin fetch. Todo pasa por `git` con los argumentos separados (sin
// shell), el repo sale de la lista y la ruta se valida (sin `..`). ⚠ Lo que se lee viaja a Google: es código de la
// empresa, no datos de clientes (WALLY.md lo dice).

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

var (
	repoPath  = regexp.MustCompile(`^([a-z][a-z0-9-]{1,40}):([A-Za-z0-9_][A-Za-z0-9_./@+-]{0,300})$`)
	topicID   = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,80}$`)
	safeChars = regexp.MustCompile(`^[A-Za-z0-9_./@+-]+$`)
)

// repoDir: la carpeta y la ref de main de un alias de tools/repos.json.
func (a *app) repoDir(alias string) (string, string, error) {
	raw, err := os.ReadFile(filepath.Join(a.root, "tools", "repos.json"))
	if err != nil {
		return "", "", err
	}
	var cfg struct {
		Indexed  map[string]string `json:"indexed"`
		Citable  map[string]string `json:"citable_only"`
		Branches map[string]string `json:"branches"`
		Main     string            `json:"main_clones"`
	}
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return "", "", err
	}
	dir := cfg.Indexed[alias]
	if dir == "" {
		dir = cfg.Citable[alias]
	}
	if dir == "" {
		return "", "", fmt.Errorf("no hay un repo «%s» en tools/repos.json", alias)
	}
	if strings.HasPrefix(dir, "~/") {
		home, _ := os.UserHomeDir()
		dir = filepath.Join(home, dir[2:])
	} else if !filepath.IsAbs(dir) {
		dir = filepath.Join(a.root, dir)
	}
	// El main se lee de los clones sólo-main (`main_clones`) cuando el repo está ahí: se les hace fetch sin tocar
	// las ramas de los clones de trabajo. Lo mismo que MainRoot en connectors/repos.
	if cfg.Main != "" {
		clones := cfg.Main
		if strings.HasPrefix(clones, "~/") {
			home, _ := os.UserHomeDir()
			clones = filepath.Join(home, clones[2:])
		}
		for _, name := range []string{alias, filepath.Base(dir)} {
			if _, err := os.Stat(filepath.Join(clones, name, ".git")); err == nil {
				dir = filepath.Join(clones, name)
				break
			}
		}
	}
	branch := cfg.Branches[alias]
	if branch == "" {
		branch = "main"
	}
	return dir, "origin/" + branch, nil
}

// git corre `git -C dir <args>` sin shell.
func git(ctx context.Context, dir string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "git", append([]string{"-C", dir}, args...)...)
	var out, errb bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &errb
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("%v: %s", err, strings.TrimSpace(errb.String()))
	}
	return out.String(), nil
}

func cleanPath(p string) error {
	if strings.Contains(p, "..") || strings.HasPrefix(p, "/") || !safeChars.MatchString(p) {
		return errors.New("ruta inválida")
	}
	return nil
}

// source es una fuente de un tema, como la guarda sources.json.
type source struct {
	Repo     string   `json:"repo"`
	Path     string   `json:"path"`
	Commit   string   `json:"commit"`
	Blob     string   `json:"blob"`
	Sections []string `json:"sections"`
}

func (a *app) topicSources(id string) ([]source, error) {
	if !topicID.MatchString(id) {
		return nil, errors.New("id de tema inválido")
	}
	raw, err := os.ReadFile(filepath.Join(a.root, "knowledge", id, "sources.json"))
	if err != nil {
		return nil, fmt.Errorf("no hay un tema «%s»", id)
	}
	var doc struct {
		ReviewedAt string   `json:"reviewedAt"`
		Sources    []source `json:"sources"`
	}
	return doc.Sources, json.Unmarshal(raw, &doc)
}

// sourcesReport: `fuentes tema`, cada fuente con sus secciones y si cambió en main desde que se revisó.
func (a *app) sourcesReport(ctx context.Context, id string) (string, error) {
	sources, err := a.topicSources(id)
	if err != nil {
		return "", err
	}
	var b strings.Builder
	changed := 0
	for _, s := range sources {
		state := "?"
		if dir, ref, err := a.repoDir(s.Repo); err == nil {
			if blob, err := git(ctx, dir, "rev-parse", ref+":"+s.Path); err != nil {
				state = "NO ESTÁ en main"
				changed++
			} else if strings.TrimSpace(blob) == s.Blob {
				state = "al día"
			} else {
				state = "CAMBIÓ"
				changed++
			}
		}
		fmt.Fprintf(&b, "- [%s] %s:%s (revisado en %.10s) → secciones: %s\n", state, s.Repo, s.Path, s.Commit, strings.Join(s.Sections, ", "))
	}
	return fmt.Sprintf("Tema %s: %d fuentes, %d cambiaron o no están en main.\n\n%s", id, len(sources), changed, b.String()), nil
}

// sourceDiff: `diff tema repo:ruta`, lo que cambió en esa fuente desde el commit con que se revisó hasta main.
func (a *app) sourceDiff(ctx context.Context, id, target string) (string, error) {
	m := repoPath.FindStringSubmatch(target)
	if m == nil || cleanPath(m[2]) != nil {
		return "", errors.New("se pide como repo:ruta (legacy-backend:Modules/…)")
	}
	sources, err := a.topicSources(id)
	if err != nil {
		return "", err
	}
	for _, s := range sources {
		if s.Repo == m[1] && s.Path == m[2] {
			dir, ref, err := a.repoDir(s.Repo)
			if err != nil {
				return "", err
			}
			log, _ := git(ctx, dir, "log", "--format=%h %ad %s", "--date=short", s.Commit+".."+ref, "--", s.Path)
			diff, err := git(ctx, dir, "diff", s.Commit, ref, "--", s.Path)
			if err != nil {
				return "", err
			}
			if strings.TrimSpace(diff) == "" {
				return "sin cambios desde la revisión", nil
			}
			return fmt.Sprintf("Commits que tocaron %s desde la revisión (%.10s → %s):\n%s\n%s", s.Path, s.Commit, ref, log, diff), nil
		}
	}
	return "", fmt.Errorf("«%s» no es una fuente del tema %s (mirá `fuentes %s`)", target, id, id)
}

// codeAtMain: `codigo repo:ruta[:desde-hasta]`, el archivo como está hoy en main, con números de línea; con un rango,
// sólo esas líneas (un archivo de 1.500 líneas entero son ~80 mil caracteres que viajan en cada vuelta).
func (a *app) codeAtMain(ctx context.Context, target string, from, to int) (string, error) {
	m := repoPath.FindStringSubmatch(target)
	if m == nil || cleanPath(m[2]) != nil {
		return "", errors.New("se pide como repo:ruta (legacy-backend:Modules/…)")
	}
	dir, ref, err := a.repoDir(m[1])
	if err != nil {
		return "", err
	}
	text, err := git(ctx, dir, "show", ref+":"+m[2])
	if err != nil {
		return "", fmt.Errorf("%s no está en %s de %s", m[2], ref, m[1])
	}
	lines := strings.Split(strings.TrimRight(text, "\n"), "\n")
	if from <= 0 {
		from, to = 1, len(lines)
	}
	if to > len(lines) {
		to = len(lines)
	}
	if from > to {
		return "", fmt.Errorf("el rango %d-%d no está en el archivo (%d líneas)", from, to, len(lines))
	}
	var b strings.Builder
	fmt.Fprintf(&b, "%s:%s en %s (%d líneas; se muestran %d-%d)\n", m[1], m[2], ref, len(lines), from, to)
	for i := from - 1; i < to; i++ {
		fmt.Fprintf(&b, "%5d  %s\n", i+1, lines[i])
	}
	return b.String(), nil
}

// grepAtMain: `buscar repo:ruta 'texto'`, las líneas de ese archivo en main que contienen el texto (literal), con su
// número: para saber qué rango pedir con `codigo` sin traer el archivo entero.
func (a *app) grepAtMain(ctx context.Context, target, text string) (string, error) {
	m := repoPath.FindStringSubmatch(target)
	if m == nil || cleanPath(m[2]) != nil {
		return "", errors.New("se pide como repo:ruta (legacy-backend:Modules/…)")
	}
	dir, ref, err := a.repoDir(m[1])
	if err != nil {
		return "", err
	}
	out, err := git(ctx, dir, "grep", "-n", "-F", "-e", text, ref, "--", m[2])
	if err != nil {
		// git grep sale con 1 cuando no encuentra nada.
		if strings.Contains(err.Error(), "exit status 1") {
			return fmt.Sprintf("«%s» no aparece en %s:%s (%s)", text, m[1], m[2], ref), nil
		}
		return "", err
	}
	out = strings.ReplaceAll(out, ref+":"+m[2]+":", "")
	lines := strings.Split(strings.TrimRight(out, "\n"), "\n")
	if len(lines) > 80 {
		lines = append(lines[:80], fmt.Sprintf("… y %d líneas más: buscá algo más preciso", len(lines)-80))
	}
	return fmt.Sprintf("%s:%s en %s, líneas con «%s»:\n%s", m[1], m[2], ref, text, strings.Join(lines, "\n")), nil
}
