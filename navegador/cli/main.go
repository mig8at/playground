// Command navegador maneja por consola la sesión EN VIVO del navegador (la misma que se ve en el editor de
// `make navegador`): abrir un sitio, mirar qué hay para tocar, actuar sobre un elemento por su número y
// verificar el resultado. Habla con la API (:5203), así que la interfaz tiene que estar levantada.
//
//	bin/navegador sites                          los sitios dados de alta
//	bin/navegador open <sitio|url> [url]         abre la sesión en vivo (una URL nueva se da de alta sola)
//	bin/navegador look                           la página actual: sus elementos numerados, con su localizador
//	bin/navegador click <n> | fill <n> <valor> | check <n> | uncheck <n> | select <n> <valor> | press <n> <tecla>
//	bin/navegador goto <url> | back | reload
//	bin/navegador text [buscar]                  el texto visible (o si aparece `buscar`)
//	bin/navegador wait <texto> [segundos]        espera a que el texto se vea (queda como aserción en el script)
//	bin/navegador shot <archivo.png>             guarda lo que se ve ahora
//	bin/navegador steps | script | reset         los pasos hechos, como script de Playwright, o de cero
//	bin/navegador close                          cierra la sesión en vivo
//
// Después de cada acción muestra la página como quedó. Los números valen para el ÚLTIMO `look`: si la página
// cambió entre medio, la acción se niega en vez de tocar otro elemento.
//
// CONVENCIÓN: identificadores en inglés, comentarios y texto visible en español.
package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

var api = envOr("NAVEGADOR_API", "http://127.0.0.1:5203")

func envOr(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}

func main() {
	if len(os.Args) < 2 {
		usage()
	}
	cmd, args := os.Args[1], os.Args[2:]
	var err error
	switch cmd {
	case "sites":
		err = sites()
	case "open":
		err = open(args)
	case "look":
		err = look(true)
	case "click", "check", "uncheck":
		err = act(cmd, args, false)
	case "fill", "select", "press":
		err = act(cmd, args, true)
	case "goto":
		if len(args) < 1 {
			usage()
		}
		err = nav("goto", args[0])
	case "back", "forward", "reload":
		err = nav(cmd, "")
	case "text":
		err = text(args)
	case "wait":
		err = wait(args)
	case "shot":
		err = shot(args)
	case "steps":
		err = steps()
	case "script":
		err = script()
	case "reset":
		err = call(http.MethodDelete, "/api/live/steps", nil, nil)
	case "close":
		err = call(http.MethodPost, "/api/live/stop", nil, nil)
	default:
		usage()
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "navegador:", err)
		os.Exit(1)
	}
}

func usage() {
	fmt.Fprintln(os.Stderr, `uso: bin/navegador <comando>
  sites · open <sitio|url> [url] · look · close
  click <n> · fill <n> <valor> · check <n> · uncheck <n> · select <n> <valor> · press <n> <tecla>
  goto <url> · back · reload · text [buscar] · wait <texto> [s] · shot <archivo.png>
  steps · script · reset`)
	os.Exit(2)
}

// ── la API ──

func call(method, path string, body, out any) error {
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, api+path, rd)
	req.Header.Set("Content-Type", "application/json")
	res, err := (&http.Client{Timeout: 120 * time.Second}).Do(req)
	if err != nil {
		return fmt.Errorf("la API no contesta en %s: ¿está levantado `make navegador`? (%v)", api, err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	if res.StatusCode >= 300 {
		var e struct{ Error string }
		if json.Unmarshal(raw, &e) == nil && e.Error != "" {
			return errors.New(e.Error)
		}
		return fmt.Errorf("HTTP %d: %s", res.StatusCode, strings.TrimSpace(string(raw)))
	}
	if out != nil {
		if s, ok := out.(*string); ok {
			*s = string(raw)
			return nil
		}
		return json.Unmarshal(raw, out)
	}
	return nil
}

type site struct {
	Slug, Name, URL, Host string
	Pages                 int
	Queued                int
}

type control struct {
	ID       int
	Kind     string
	Name     string
	Action   string
	Form     int
	Best     int
	Checked  *bool
	Options  []struct{ Value, Label string }
	Locators []struct {
		Kind, Code string
		Count      int
		Works      bool
	}
}

type liveState struct {
	Active  bool
	Site    string
	URL     string
	Title   string
	Version int
	Page    *struct {
		Status   int
		Controls []control
		Console  []string
	}
	Steps []struct {
		Code, Error string
		OK          bool
	}
}

// La versión del último `look`, para que un número viejo no toque otro elemento.
func versionFile() string {
	dir, _ := os.UserCacheDir()
	return filepath.Join(dir, "navegador", "look-version")
}

func saveVersion(v int) {
	_ = os.MkdirAll(filepath.Dir(versionFile()), 0o755)
	_ = os.WriteFile(versionFile(), []byte(strconv.Itoa(v)), 0o644)
}

func lastVersion() int {
	b, _ := os.ReadFile(versionFile())
	v, _ := strconv.Atoi(strings.TrimSpace(string(b)))
	return v
}

// ── los comandos ──

func sites() error {
	var list []site
	if err := call(http.MethodGet, "/api/sites", nil, &list); err != nil {
		return err
	}
	for _, s := range list {
		fmt.Printf("%-32s %4d páginas  %s\n", s.Slug, s.Pages, s.URL)
	}
	return nil
}

func open(args []string) error {
	if len(args) < 1 {
		usage()
	}
	slug, start := args[0], ""
	if len(args) > 1 {
		start = args[1]
	}
	// Una URL en vez de un sitio: se busca el sitio de ese host y, si no hay, se da de alta.
	if strings.Contains(slug, "://") || strings.Contains(slug, ".") {
		raw := slug
		if !strings.Contains(raw, "://") {
			raw = "https://" + raw
		}
		u, err := url.Parse(raw)
		if err != nil {
			return err
		}
		var list []site
		if err := call(http.MethodGet, "/api/sites", nil, &list); err != nil {
			return err
		}
		slug = ""
		for _, s := range list {
			if s.Host == u.Host {
				slug = s.Slug
			}
		}
		if slug == "" {
			var s site
			if err := call(http.MethodPost, "/api/sites", map[string]string{"url": raw}, &s); err != nil {
				return err
			}
			slug = s.Slug
			fmt.Printf("sitio nuevo: %s\n", slug)
		}
		if start == "" {
			start = raw
		}
	}
	q := "site=" + url.QueryEscape(slug)
	if start != "" {
		q += "&start=" + url.QueryEscape(start)
	}
	if err := call(http.MethodPost, "/api/live/start?"+q, nil, nil); err != nil {
		return err
	}
	return look(true)
}

func look(fresh bool) error {
	var st liveState
	path := "/api/live/state"
	if fresh {
		path += "?fresh=1"
	}
	if err := call(http.MethodGet, path, nil, &st); err != nil {
		return err
	}
	if !st.Active {
		return errors.New("no hay sesión en vivo: abrí una con `bin/navegador open <sitio|url>`")
	}
	saveVersion(st.Version)
	fmt.Printf("%s\n%s\n", st.Title, st.URL)
	if st.Page == nil {
		fmt.Println("(todavía sin analizar)")
		return nil
	}
	if len(st.Page.Console) > 0 {
		fmt.Printf("⚠ %d errores de consola\n", len(st.Page.Console))
	}
	kinds := map[string]string{"field": "campo", "select": "desplegable", "check": "casilla", "button": "botón", "link": "enlace"}
	for _, c := range st.Page.Controls {
		loc := "SIN LOCALIZADOR ÚNICO"
		if c.Best >= 0 {
			loc = c.Locators[c.Best].Code
		}
		extra := ""
		if c.Checked != nil {
			extra = map[bool]string{true: " [marcada]", false: " [sin marcar]"}[*c.Checked]
		}
		fmt.Printf("%3d  %-11s «%s»%s\n       %s\n", c.ID+1, kinds[c.Kind], trim(c.Name, 60), extra, loc)
		if len(c.Options) > 0 {
			opts := []string{}
			for _, o := range c.Options {
				opts = append(opts, fmt.Sprintf("%s=%q", o.Value, o.Label))
			}
			fmt.Printf("       opciones: %s\n", strings.Join(opts, " · "))
		}
	}
	return nil
}

func act(action string, args []string, needsValue bool) error {
	if len(args) < 1 || (needsValue && len(args) < 2) {
		usage()
	}
	n, err := strconv.Atoi(args[0])
	if err != nil || n < 1 {
		return fmt.Errorf("el elemento va por su número del último `look`, no %q", args[0])
	}
	value := ""
	if needsValue {
		value = strings.Join(args[1:], " ")
	}
	var step struct{ Code string }
	err = call(http.MethodPost, "/api/live/act", map[string]any{"control": n - 1, "action": action, "value": value, "version": lastVersion()}, &step)
	if err != nil {
		return err
	}
	fmt.Printf("✓ %s\n\n", step.Code)
	return look(true)
}

func nav(action, target string) error {
	if err := call(http.MethodPost, "/api/live/nav", map[string]string{"action": action, "url": target}, nil); err != nil {
		return err
	}
	return look(true)
}

func text(args []string) error {
	var out struct{ Text string }
	if err := call(http.MethodGet, "/api/live/text", nil, &out); err != nil {
		return err
	}
	if len(args) == 0 {
		fmt.Println(out.Text)
		return nil
	}
	needle := strings.Join(args, " ")
	if strings.Contains(out.Text, needle) {
		fmt.Printf("✓ aparece «%s»\n", needle)
		return nil
	}
	return fmt.Errorf("no aparece «%s»", needle)
}

// wait espera (en el servidor, con la espera de Playwright) a que el texto se vea, y queda como aserción del script.
func wait(args []string) error {
	if len(args) < 1 {
		usage()
	}
	needle, secs := args[0], 15
	if len(args) > 1 {
		if s, err := strconv.Atoi(args[1]); err == nil {
			secs = s
		}
	}
	var step struct{ Code string }
	if err := call(http.MethodPost, "/api/live/expect", map[string]any{"text": needle, "seconds": secs}, &step); err != nil {
		return err
	}
	fmt.Printf("✓ %s\n", step.Code)
	return nil
}

func shot(args []string) error {
	if len(args) < 1 {
		usage()
	}
	res, err := http.Get(api + "/api/live/shot")
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(res.Body)
		return fmt.Errorf("HTTP %d: %s", res.StatusCode, strings.TrimSpace(string(b)))
	}
	f, err := os.Create(args[0])
	if err != nil {
		return err
	}
	defer f.Close()
	if _, err := io.Copy(f, res.Body); err != nil {
		return err
	}
	fmt.Println(args[0])
	return nil
}

func steps() error {
	var st liveState
	if err := call(http.MethodGet, "/api/live/state", nil, &st); err != nil {
		return err
	}
	for i, s := range st.Steps {
		mark := "✓"
		if !s.OK {
			mark = "✗"
		}
		fmt.Printf("%2d %s %s", i+1, mark, s.Code)
		if s.Error != "" {
			fmt.Printf("  (%s)", s.Error)
		}
		fmt.Println()
	}
	return nil
}

func script() error {
	var s string
	if err := call(http.MethodGet, "/api/live/script", nil, &s); err != nil {
		return err
	}
	fmt.Print(s)
	return nil
}

func trim(s string, n int) string {
	if r := []rune(s); len(r) > n {
		return string(r[:n-1]) + "…"
	}
	return s
}
