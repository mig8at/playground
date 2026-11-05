package main

/* El paso a paso de una corrida, como evidencia: qué se hizo, con qué localizador, qué falló y cómo quedó la
 * página en cada paso (las fotos que deja recordStep). Queda en la carpeta de la corrida, al lado de las fotos:
 *
 *	reporte.md        para leer en la terminal o pegar en una tarea
 *	reporte.html      con las fotos, para abrir en el navegador
 *	script.spec.ts    el recorrido como prueba de Playwright
 */

import (
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// ReportInfo es lo que acompaña al reporte cuando lo pide ask: la meta, cómo terminó y lo que costó.
type ReportInfo struct {
	Goal    string         `json:"meta"`
	Result  string         `json:"resultado"`
	Keyword string         `json:"palabra,omitempty"` // LISTO · NO PUDE · NECESITO · CONFIRMAR
	Rounds  []string       `json:"vueltas,omitempty"`
	Cost    float64        `json:"usd,omitempty"`
	Turns   int            `json:"turnos,omitempty"`
	Seconds float64        `json:"seg,omitempty"`
	Model   string         `json:"modelo,omitempty"`
	Tokens  map[string]int `json:"tokens,omitempty"`
	Source  string         `json:"origen,omitempty"` // ask · evals · a mano
}

// RunMeta es el run.json de una corrida: lo que necesita la lista de corridas de la interfaz.
type RunMeta struct {
	ID      string    `json:"id"`
	Site    string    `json:"sitio"`
	Start   string    `json:"inicio"`
	At      time.Time `json:"fecha"`
	Steps   int       `json:"pasos"`
	Failed  int       `json:"fallidos"`
	Sources int       `json:"fuentes"`
	ReportInfo
}

// LiveReport escribe el paso a paso de la corrida actual y devuelve la carpeta.
func (r *Runner) LiveReport(info ReportInfo) (string, error) {
	l := r.liveSession()
	if l == nil {
		return "", errors.New("no hay sesión en vivo")
	}
	l.mu.Lock()
	steps := append([]Step{}, l.steps...)
	sources := append([]Source{}, l.sources...)
	dir := l.runDir
	site, start := l.site, l.start
	l.mu.Unlock()
	if len(steps) == 0 && len(sources) == 0 {
		return "", errors.New("la corrida no tiene pasos ni páginas consultadas todavía")
	}
	if dir == "" { // una investigación que sólo leyó: igual tiene su carpeta
		dir = filepath.Join(r.store.dir, "corridas", time.Now().Format("2006-01-02_15-04-05"))
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return "", err
		}
		l.mu.Lock()
		l.runDir = dir
		l.mu.Unlock()
	}
	script := r.LiveScript()
	failed := 0
	for _, s := range steps {
		if !s.OK {
			failed++
		}
	}
	began := time.Now()
	if len(steps) > 0 {
		began = steps[0].At
	} else if len(sources) > 0 {
		began = sources[0].At
	}

	// ── Markdown ──
	var md strings.Builder
	fmt.Fprintf(&md, "# Corrida en %s\n\n", site.Name)
	if info.Goal != "" {
		fmt.Fprintf(&md, "**Meta:** %s\n\n", info.Goal)
	}
	if info.Result != "" {
		fmt.Fprintf(&md, "**Resultado:** %s\n\n", info.Result)
	}
	fmt.Fprintf(&md, "%s · desde %s · %d pasos, %d fallidos\n\n", began.Format("2006-01-02 15:04"), start, len(steps), failed)
	md.WriteString("| # | | paso | foto |\n|---|---|---|---|\n")
	for i, s := range steps {
		mark := "✓"
		if !s.OK {
			mark = "✗"
		}
		what := "`" + strings.ReplaceAll(s.Code, "|", "\\|") + "`"
		if s.Error != "" {
			what += "<br>" + strings.ReplaceAll(s.Error, "|", "\\|")
		}
		for _, d := range s.Dialogs {
			what += "<br>diálogo: " + strings.ReplaceAll(d, "|", "\\|")
		}
		if s.Note != "" {
			what += "<br>" + strings.ReplaceAll(s.Note, "|", "\\|")
		}
		shot := ""
		if s.Shot != "" {
			shot = fmt.Sprintf("[%s](%s)", s.Shot, s.Shot)
		}
		fmt.Fprintf(&md, "| %d | %s | %s | %s |\n", i+1, mark, what, shot)
	}
	if len(sources) > 0 {
		md.WriteString("\n## Fuentes consultadas\n\n")
		for _, src := range sources {
			fmt.Fprintf(&md, "- [%s](%s)", strings.ReplaceAll(src.Title, "]", ")"), src.URL)
			if src.Updated != "" {
				fmt.Fprintf(&md, " · %s", src.Updated)
			}
			fmt.Fprintf(&md, " · consultada %s\n", src.At.Format("2006-01-02 15:04"))
		}
	}
	md.WriteString("\n## Script\n\n```ts\n" + script + "```\n")

	// ── HTML ──
	var h strings.Builder
	h.WriteString(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Corrida · ` + html.EscapeString(site.Name) + `</title><style>
:root{color-scheme:light dark;--bg:#fafafa;--fg:#1f2328;--mut:#656d76;--line:#d0d7de;--ok:#1a7f37;--bad:#cf222e;--card:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#0d1117;--fg:#e6edf3;--mut:#8d96a0;--line:#30363d;--ok:#3fb950;--bad:#f85149;--card:#161b22}}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,sans-serif}
main{max-width:1100px;margin:24px auto;padding:0 16px}h1{font-size:20px;margin:0 0 8px}.mut{color:var(--mut)}
.paso{display:grid;grid-template-columns:36px 1fr 320px;gap:12px;padding:12px 0;border-top:1px solid var(--line);align-items:start}
.n{font-variant-numeric:tabular-nums;color:var(--mut)}.ok .n::after{content:" ✓";color:var(--ok)}.mal .n::after{content:" ✗";color:var(--bad)}
code{font:12px/1.4 ui-monospace,monospace;overflow-wrap:anywhere}.err{color:var(--bad);font-size:13px;margin-top:4px}
img{width:100%;border:1px solid var(--line);border-radius:6px;background:var(--card)}.mal img{border-color:var(--bad)}
pre{background:var(--card);border:1px solid var(--line);border-radius:6px;padding:12px;overflow:auto}
@media (max-width:720px){.paso{grid-template-columns:28px 1fr}.paso a{grid-column:2}}
</style></head><body><main>`)
	fmt.Fprintf(&h, "<h1>Corrida en %s</h1>", html.EscapeString(site.Name))
	if info.Goal != "" {
		fmt.Fprintf(&h, "<p><strong>Meta:</strong> %s</p>", html.EscapeString(info.Goal))
	}
	if info.Result != "" {
		fmt.Fprintf(&h, "<p><strong>Resultado:</strong> %s</p>", html.EscapeString(info.Result))
	}
	fmt.Fprintf(&h, `<p class="mut">%s · desde %s · %d pasos, %d fallidos</p>`, began.Format("2006-01-02 15:04"), html.EscapeString(start), len(steps), failed)
	for i, s := range steps {
		cls := "ok"
		if !s.OK {
			cls = "mal"
		}
		fmt.Fprintf(&h, `<div class="paso %s"><div class="n">%d</div><div><code>%s</code>`, cls, i+1, html.EscapeString(s.Code))
		if s.Error != "" {
			fmt.Fprintf(&h, `<div class="err">%s</div>`, html.EscapeString(s.Error))
		}
		for _, d := range s.Dialogs {
			fmt.Fprintf(&h, `<div class="mut">diálogo: %s</div>`, html.EscapeString(d))
		}
		if s.Note != "" {
			fmt.Fprintf(&h, `<div class="mut">%s</div>`, html.EscapeString(s.Note))
		}
		fmt.Fprintf(&h, `<div class="mut">%s · %s</div></div>`, s.At.Format("15:04:05"), html.EscapeString(s.URL))
		if s.Shot != "" {
			fmt.Fprintf(&h, `<a href="%s" target="_blank"><img src="%s" alt="Cómo quedó la página en el paso %d" loading="lazy"></a>`, s.Shot, s.Shot, i+1)
		}
		h.WriteString(`</div>`)
	}
	if len(sources) > 0 {
		h.WriteString("<h2>Fuentes consultadas</h2><ul>")
		for _, src := range sources {
			fmt.Fprintf(&h, `<li><a href="%s" target="_blank" rel="noopener">%s</a>`, html.EscapeString(src.URL), html.EscapeString(src.Title))
			if src.Updated != "" {
				fmt.Fprintf(&h, ` <span class="mut">· %s</span>`, html.EscapeString(src.Updated))
			}
			fmt.Fprintf(&h, ` <span class="mut">· consultada %s</span></li>`, src.At.Format("2006-01-02 15:04"))
		}
		h.WriteString("</ul>")
	}
	fmt.Fprintf(&h, "<h2>Script</h2><pre><code>%s</code></pre></main></body></html>", html.EscapeString(script))

	for name, body := range map[string]string{"reporte.md": md.String(), "reporte.html": h.String(), "script.spec.ts": script} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644); err != nil {
			return "", err
		}
	}
	// Para la interfaz: la corrida en JSON (la lista de corridas y su visor leen esto, no el html).
	if info.Source == "" {
		info.Source = "a mano"
	}
	meta := RunMeta{ID: filepath.Base(dir), Site: site.Name, Start: start, At: began, Steps: len(steps), Failed: failed, Sources: len(sources), ReportInfo: info}
	if err := writeJSONFile(filepath.Join(dir, "run.json"), meta); err != nil {
		return "", err
	}
	if err := writeJSONFile(filepath.Join(dir, "pasos.json"), map[string]any{"pasos": steps, "fuentes": sources}); err != nil {
		return "", err
	}
	return dir, nil
}

// Runs lista las corridas que tienen reporte, de la más nueva a la más vieja.
func (s *Store) Runs() []RunMeta {
	dirs, _ := filepath.Glob(filepath.Join(s.dir, "corridas", "*", "run.json"))
	out := []RunMeta{}
	for _, p := range dirs {
		b, err := os.ReadFile(p)
		if err != nil {
			continue
		}
		var m RunMeta
		if json.Unmarshal(b, &m) == nil {
			out = append(out, m)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID > out[j].ID })
	return out
}

// Run devuelve una corrida completa: su run.json, sus pasos y fuentes, y el script.
func (s *Store) Run(id string) (map[string]any, error) {
	if strings.ContainsAny(id, "/\\") || strings.HasPrefix(id, ".") {
		return nil, errors.New("corrida inválida")
	}
	dir := filepath.Join(s.dir, "corridas", id)
	var meta RunMeta
	b, err := os.ReadFile(filepath.Join(dir, "run.json"))
	if err != nil {
		return nil, fmt.Errorf("no hay una corrida %s con reporte", id)
	}
	_ = json.Unmarshal(b, &meta)
	var detail struct {
		Steps   []Step   `json:"pasos"`
		Sources []Source `json:"fuentes"`
	}
	if b, err := os.ReadFile(filepath.Join(dir, "pasos.json")); err == nil {
		_ = json.Unmarshal(b, &detail)
	}
	script, _ := os.ReadFile(filepath.Join(dir, "script.spec.ts"))
	return map[string]any{"corrida": meta, "pasos": detail.Steps, "fuentes": detail.Sources, "script": string(script)}, nil
}
