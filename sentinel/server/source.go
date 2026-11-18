package main

// DE QUÉ ARCHIVO SALE UN ERROR NUEVO: el texto fijo del mensaje, buscado con `git grep -F` en el `main` (los clones
// sólo-main de tools/repos.json) del repo del servicio y de los dos monolitos. Es la receta del CLAUDE.md raíz («leí un
// error, ¿de qué archivo salió?»), hecha sola para cada error nuevo. tracer trae un índice de mensajes armado del
// código, pero viaja embebido con su fecha (el que hay es de septiembre y nombra el repo viejo): un índice viejo no
// falla, deja de encontrar. Buscar en `main` cada vez no envejece.
//
// Se guarda lo encontrado (y lo no encontrado) por mensaje: cada uno se busca una vez por proceso.

import (
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"

	"creditop/my-tools/connectors/repos"
)

var (
	sourceMu    sync.Mutex
	sourceCache = map[string]string{}
	// lo variable de un mensaje: números, comillas, llaves y separadores
	reVariable = regexp.MustCompile(`[0-9"'{}\[\]()<>,;|=]+|\s{2,}|: `)
	reLetters  = regexp.MustCompile(`[A-Za-z]{4,}`)
)

const sourceMinLen = 14

// reFirstVariable: dónde empieza lo que el código no escribió tal cual (un número, unas comillas, un JSON).
var reFirstVariable = regexp.MustCompile(`[0-9"'{\[(<]`)

// fixedParts: lo que se busca, en orden. Primero el comienzo del mensaje hasta lo primero variable, y ese mismo
// acortado palabra por palabra (lo que sigue a «failed,» suele ser contexto que el código no escribió). Después, los
// tramos fijos sueltos, del más largo al más corto. El nombre de un método solo aparece también en comentarios y spans:
// por eso va al final.
func fixedParts(msg string) []string {
	var out []string
	seen := map[string]bool{}
	add := func(p string) {
		p = strings.TrimSpace(strings.Trim(strings.TrimSpace(p), ".…-,:"))
		if len(p) >= sourceMinLen && reLetters.MatchString(p) && !seen[p] {
			seen[p] = true
			out = append(out, p)
		}
	}
	head := msg
	if loc := reFirstVariable.FindStringIndex(head); loc != nil {
		head = head[:loc[0]]
	}
	words := strings.Fields(head)
	for n := len(words); n >= 2 && len(out) < 6; n-- {
		add(strings.Join(words[:n], " "))
	}
	var parts []string
	for _, p := range reVariable.Split(msg, -1) {
		p = strings.TrimSpace(strings.Trim(p, ".…-"))
		if len(p) >= sourceMinLen && reLetters.MatchString(p) {
			parts = append(parts, p)
		}
	}
	sort.SliceStable(parts, func(i, j int) bool { return len(parts[i]) > len(parts[j]) })
	for i, p := range parts {
		if i == 3 {
			break
		}
		add(p)
	}
	return out
}

// sourceOf: «legacy-backend/Modules/Onboarding/…/OnboardingController.php:812», o "" si no se encontró.
func (s *sentinel) sourceOf(service, msg string) string {
	key := service + "|" + msg
	sourceMu.Lock()
	if v, ok := sourceCache[key]; ok {
		sourceMu.Unlock()
		return v
	}
	sourceMu.Unlock()
	found := ""
	client := repos.New(filepath.Join(s.root, "tools"))
	var roots []string
	seen := map[string]bool{}
	for _, alias := range []string{repoOf(service), "legacy-backend", "legacy-application"} {
		if alias == "" {
			continue
		}
		if dir := client.MainRoot(alias); dir != "" && !seen[dir] {
			seen[dir] = true
			roots = append(roots, dir)
		}
	}
search:
	for _, part := range fixedParts(msg) {
		for _, dir := range roots {
			if hit := grepFixed(dir, part); hit != "" {
				found = filepath.Base(dir) + "/" + hit
				break search
			}
		}
	}
	sourceMu.Lock()
	sourceCache[key] = found
	sourceMu.Unlock()
	return found
}

// grepFixed: el primer archivo:línea de `main` que contiene el texto, sin pruebas. "" si ninguno.
func grepFixed(dir, text string) string {
	ref := "refs/remotes/origin/main"
	if exec.Command("git", "-C", dir, "rev-parse", "--verify", "-q", ref).Run() != nil {
		ref = "HEAD"
	}
	out, err := exec.Command("git", "-C", dir, "grep", "-n", "-F", "-e", text, ref, "--",
		"*.php", "*.go", "*.ts", "*.tsx", "*.js", "*.py").Output()
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimPrefix(line, ref+":")
		parts := strings.SplitN(line, ":", 3)
		if len(parts) < 3 || strings.Contains(strings.ToLower(parts[0]), "test") {
			continue
		}
		// un comentario o un docblock que lo nombra no es lo que lo escribe
		if code := strings.TrimSpace(parts[2]); strings.HasPrefix(code, "*") || strings.HasPrefix(code, "/*") || strings.HasPrefix(code, "//") || strings.HasPrefix(code, "#") {
			continue
		}
		return parts[0] + ":" + parts[1]
	}
	return ""
}
