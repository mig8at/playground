package main

// LOS PASOS CON MODELO. Las instrucciones son las de `tools/knowledge-drift/prompts/` (triaje, código, segunda mirada),
// leídas en cada pregunta. Esos prompts los escribieron para agentes que corren `git` por su cuenta; el modelo de
// segundo plano (lib/background: Claude por defecto, el elegido en Cockpit) no corre nada, así que cada paquete le
// llega con lo que pediría ya adentro: el diff de cada archivo y el archivo como está en main. Una pregunta por
// paquete: es lo que Wally anotó como lo que más rinde (2026-11-17).
//
// La VERIFICACIÓN (paso 8) no existía como prompt: era la revisión independiente que el método exige a mano («en la
// corrida del 2026-11-10 encontró 6 contradicciones»). Acá es una pregunta aparte por sección reescrita, sin los
// veredictos de nadie: el texto de antes, el nuevo, el diff y el archivo. Si algo no cierra, la corrida frena.

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"creditop/my-tools/lib/background"
)

const (
	diffCap = 40000 // por archivo: más que eso, se corta y se dice
	fileCap = 30000
)

// noTools: lo que cambia de los prompts de drift para quien no puede correr comandos.
const noTools = `

ESTA VEZ NO PODÉS LEER ARCHIVOS NI CORRER COMANDOS: el paquete va entero en el mensaje, y debajo de cada archivo que
cambió ya están su diff y el archivo como está en main (recortados si son enormes; si lo recortado no alcanza para
decidir, el veredicto es el de «no se sabe»). Donde el prompt dice «escribí <archivo>», contestá SÓLO con la lista JSON,
sin texto antes ni después y sin bloque de código.
Un texto_nuevo respeta la forma del vigente: renglones cortados a unos 120 caracteres, como el resto del rules.md (en
la corrida #1 salieron párrafos de un solo renglón).`

// prompt: el de drift, sin las rutas de su paquete y salida.
func (f *flow) prompt(name string) (string, error) {
	raw, err := os.ReadFile(filepath.Join(f.root, "tools", "knowledge-drift", "prompts", name))
	if err != nil {
		return "", err
	}
	text := strings.NewReplacer("`{paquete}`", "el paquete de abajo", "{paquete}", "el paquete de abajo",
		"`{salida}`", "tu respuesta", "{salida}", "tu respuesta").Replace(string(raw))
	return text + noTools, nil
}

// expand: un paquete con cada `git -C … diff …` reemplazado por el diff y el archivo en main.
func (f *flow) expand(ctx context.Context, pkg string) string {
	return reGitDiff.ReplaceAllStringFunc(pkg, func(m string) string {
		p := reGitDiff.FindStringSubmatch(m)
		dir, base, ref, path := p[1], p[2], p[3], strings.TrimSpace(p[4])
		diff, err := f.sh(ctx, "git", "-C", dir, "diff", "-M", base, ref, "--", path)
		if err != nil {
			diff = "(no se pudo sacar el diff: " + err.Error() + ")"
		}
		file, err := f.sh(ctx, "git", "-C", dir, "show", ref+":"+path)
		if err != nil {
			file = "(no está en main)"
		}
		return fmt.Sprintf("%s\n\nDIFF desde %s hasta %s:\n```diff\n%s\n```\nEL ARCHIVO EN %s:\n```\n%s\n```\n", m, short(base), ref,
			clip(diff, diffCap), ref, clip(file, fileCap))
	})
}

func short(sha string) string {
	if len(sha) > 10 {
		return sha[:10]
	}
	return sha
}

func clip(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + fmt.Sprintf("\n… (recortado: %d caracteres más)", len(s)-n)
}

// askList: una pregunta al modelo y su lista JSON.
func (f *flow) askList(ctx context.Context, r *Run, system, prompt string) ([]map[string]any, error) {
	ans, err := background.Ask(ctx, f.root, background.Request{Prompt: prompt, System: system})
	if err != nil {
		return nil, err
	}
	r.Model = ans.Model
	text := strings.TrimSpace(ans.Text)
	i, j := strings.Index(text, "["), strings.LastIndex(text, "]")
	if i < 0 || j < i {
		return nil, fmt.Errorf("el modelo no devolvió una lista JSON: %.200s", text)
	}
	var out []map[string]any
	if err := json.Unmarshal([]byte(text[i:j+1]), &out); err != nil {
		return nil, fmt.Errorf("la lista del modelo no parsea: %v", err)
	}
	return out, nil
}

// answerPackages: cada paquete de dir que empieza con prefix → su resultado-N.json al lado, con el prompt dado.
func (f *flow) answerPackages(ctx context.Context, r *Run, st *Step, dir, prefix, promptName string, expand bool) (int, error) {
	system, err := f.prompt(promptName)
	if err != nil {
		return 0, err
	}
	pkgs := filesIn(dir, prefix)
	total := 0
	for i, p := range pkgs {
		st.Now = fmt.Sprintf("%d de %d · %s", i+1, len(pkgs), filepath.Base(p))
		f.runs.save(r)
		raw, err := os.ReadFile(p)
		if err != nil {
			return total, err
		}
		body := string(raw)
		if expand {
			body = f.expand(ctx, body)
		}
		list, err := f.askList(ctx, r, system, body)
		if err != nil {
			return total, fmt.Errorf("%s: %w", filepath.Base(p), err)
		}
		n := strings.TrimSuffix(strings.TrimPrefix(filepath.Base(p), prefix), ".md")
		out, _ := json.MarshalIndent(list, "", " ")
		if err := os.WriteFile(filepath.Join(dir, "resultado-"+n+".json"), out, 0o644); err != nil {
			return total, err
		}
		total += len(list)
	}
	return total, nil
}

func countBy(dir, key string) map[string]int {
	out := map[string]int{}
	for _, p := range filesIn(dir, "resultado-") {
		raw, _ := os.ReadFile(p)
		var list []map[string]any
		_ = json.Unmarshal(raw, &list)
		for _, x := range list {
			out[fmt.Sprint(x[key])]++
		}
	}
	return out
}

// ── 4 · triaje ───────────────────────────────────────────────────────────────────────────────────────────────────

func (f *flow) stepTriage(ctx context.Context, r *Run, st *Step) error {
	dir := filepath.Join(r.driftDir(), "triaje")
	if _, err := f.answerPackages(ctx, r, st, dir, "grupo-", "triage.md", false); err != nil {
		return err
	}
	c := countBy(dir, "veredicto")
	st.Summary = fmt.Sprintf("%d descartados (no tocan lo que dice el tema) · %d pasan a leer código", c["no_toca"], c["contradice"]+c["no_se_sabe"])
	return nil
}

// ── 5 · leer código ──────────────────────────────────────────────────────────────────────────────────────────────

func (f *flow) stepCode(ctx context.Context, r *Run, st *Step) error {
	// drift arma los paquetes de código y los de la segunda mirada a la vez.
	if _, err := f.drift(ctx, r, "codigo"); err != nil {
		return err
	}
	dir := filepath.Join(r.driftDir(), "codigo")
	if len(filesIn(dir, "paquete-")) == 0 {
		st.State, st.Summary = stSkipped, "el triaje descartó todo: no hay código que leer"
		return nil
	}
	if _, err := f.answerPackages(ctx, r, st, dir, "paquete-", "code.md", true); err != nil {
		return err
	}
	c := countBy(dir, "veredicto")
	st.Summary = fmt.Sprintf("%d siguen ciertas · %d cambian · %d sin decidir", c["sigue"], c["cambia"], c["sin_decidir"])
	return nil
}

// ── 6 · segunda mirada ───────────────────────────────────────────────────────────────────────────────────────────

func (f *flow) stepSecond(ctx context.Context, r *Run, st *Step) error {
	dir := filepath.Join(r.driftDir(), "segunda")
	if len(filesIn(dir, "grupo-")) == 0 {
		st.State, st.Summary = stSkipped, "el triaje no descartó nada: no hay qué mirar de nuevo"
		return nil
	}
	if _, err := f.answerPackages(ctx, r, st, dir, "grupo-", "second-look.md", true); err != nil {
		return err
	}
	c := countBy(dir, "veredicto")
	st.Summary = fmt.Sprintf("%d confirmadas · %d que el triaje había descartado y sí cambian · %d sin decidir", c["sigue"], c["cambia"], c["sin_decidir"])
	return nil
}

// ── 8 · verificar ────────────────────────────────────────────────────────────────────────────────────────────────

const verifyPrompt = `Sos un VERIFICADOR independiente de knowledge, la biblioteca técnica local de CreditOp. No sabés qué opinó nadie antes.
Te llega UNA sección de un rules.md: su texto vigente, el TEXTO NUEVO que alguien propuso y, de cada archivo que la
respalda y cambió en main, el diff y el archivo como está en main.

Decidí si el texto nuevo se puede aplicar:
- ¿Afirma algo que el código de main no sostiene? (una clase, un método, una condición, un valor)
- ¿Perdió algo cierto que el texto vigente decía y sigue siendo así en main?
- ¿Contradice el texto vigente en algo que el diff NO cambió?
Matices de redacción no cuentan; sí cuenta una afirmación falsa o un detalle cierto que se perdió.

Contestá SÓLO con un objeto JSON, sin texto antes ni después y sin bloque de código:
{"ok": true|false, "problemas": ["<qué está mal, con repo:ruta:línea si aplica>"]}`

func (f *flow) stepVerify(ctx context.Context, r *Run, st *Step) error {
	fin, err := r.finals()
	if err != nil {
		return err
	}
	var ids []string
	for id, v := range fin {
		if v.Verdict == "cambia" || v.Verdict == "nueva" {
			ids = append(ids, id)
		}
	}
	if len(ids) == 0 {
		st.State, st.Summary = stSkipped, "nada que reescribir: sólo se sellan las fuentes"
		return nil
	}
	var items map[string]struct {
		Topic string   `json:"topic"`
		Prose string   `json:"prose"`
		Files []string `json:"files"`
	}
	raw, err := os.ReadFile(filepath.Join(r.driftDir(), "secciones.json"))
	if err != nil {
		return err
	}
	if err := json.Unmarshal(raw, &items); err != nil {
		return err
	}
	var filesList []struct {
		Repo, Path, Ref, Base, Dir string
		Exists                     bool
	}
	if raw, err := os.ReadFile(filepath.Join(r.driftDir(), "files.json")); err == nil {
		_ = json.Unmarshal(raw, &filesList)
	}
	var problems []string
	for i, id := range ids {
		st.Now = fmt.Sprintf("%d de %d · %s", i+1, len(ids), id)
		f.runs.save(r)
		it, v := items[id], fin[id]
		var b strings.Builder
		fmt.Fprintf(&b, "# SECCIÓN %s\n\n## TEXTO VIGENTE\n%s\n\n## TEXTO NUEVO PROPUESTO\n", id, it.Prose)
		if v.NewTitle != "" {
			fmt.Fprintf(&b, "(título nuevo: %s)\n", v.NewTitle)
		}
		b.WriteString(v.NewText + "\n\n## ARCHIVOS QUE CAMBIARON\n")
		for _, key := range it.Files {
			for _, fl := range filesList {
				if fl.Repo+":"+fl.Path == key && fl.Exists {
					b.WriteString(f.expand(ctx, fmt.Sprintf("- %s: `git -C %s diff %s %s -- %s`", key, fl.Dir, fl.Base, fl.Ref, fl.Path)) + "\n")
				}
			}
		}
		ans, err := background.Ask(ctx, f.root, background.Request{Prompt: b.String(), System: verifyPrompt})
		if err != nil {
			return err
		}
		text := strings.TrimSpace(ans.Text)
		a, z := strings.Index(text, "{"), strings.LastIndex(text, "}")
		var res struct {
			OK       bool     `json:"ok"`
			Problems []string `json:"problemas"`
		}
		if a < 0 || z < a || json.Unmarshal([]byte(text[a:z+1]), &res) != nil {
			return fmt.Errorf("%s: el verificador no devolvió el JSON pedido: %.200s", id, text)
		}
		if !res.OK {
			for _, p := range res.Problems {
				problems = append(problems, id+": "+p)
			}
			if len(res.Problems) == 0 {
				problems = append(problems, id+": el verificador no lo aprobó")
			}
		}
	}
	if len(problems) > 0 {
		st.Detail = problems
		return stop("%d problema(s) en los textos nuevos: no se aplica nada", len(problems))
	}
	st.Summary = fmt.Sprintf("%d sección(es) reescritas, verificadas contra main", len(ids))
	return nil
}
