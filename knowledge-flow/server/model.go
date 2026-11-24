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
	"regexp"
	"strings"
	"time"

	"creditop/my-tools/lib/background"
)

const (
	diffCap = 40000 // por archivo: más que eso, se corta y se dice
	fileCap = 30000
	// expandBudget: lo más que suman los diffs y archivos de un paquete (~100 mil tokens), con lugar para la respuesta
	expandBudget = 360000
	// expandBudgetBig: con Gemini por AI Studio (~1 millón de tokens), unos 400 mil tokens de código por paquete
	expandBudgetBig = 1600000
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

// expand: un paquete con cada `git -C … diff …` reemplazado por el diff y el archivo en main. Un archivo que se cita
// varias veces se expande la primera, y todo el paquete cabe en expandBudget: la corrida #22 (2026-11-24) citó 20
// archivos en un paquete, que con los topes por archivo pasaban el millón de caracteres, y Bedrock cortó la invocación.
func (f *flow) expand(ctx context.Context, pkg string) string {
	refs := map[string]bool{}
	for _, p := range reGitDiff.FindAllStringSubmatch(pkg, -1) {
		refs[p[1]+":"+strings.TrimSpace(p[4])] = true
	}
	dCap, fCap, budget := diffCap, fileCap, expandBudget
	if background.Chosen() == "aistudio" {
		budget = expandBudgetBig // ventana de ~1 millón de tokens: el paquete puede llevar mucho más código
	}
	if n := len(refs); n > 0 && n*(diffCap+fileCap) > budget {
		share := budget / n
		dCap, fCap = share*4/7, share*3/7
	}
	seen := map[string]bool{}
	return reGitDiff.ReplaceAllStringFunc(pkg, func(m string) string {
		p := reGitDiff.FindStringSubmatch(m)
		dir, base, ref, path := p[1], p[2], p[3], strings.TrimSpace(p[4])
		if seen[dir+":"+path] {
			return m + " (el diff y el archivo van más arriba, en su primera mención)"
		}
		seen[dir+":"+path] = true
		diff, err := f.sh(ctx, "git", "-C", dir, "diff", "-M", base, ref, "--", path)
		if err != nil {
			diff = "(no se pudo sacar el diff: " + err.Error() + ")"
		}
		file, err := f.sh(ctx, "git", "-C", dir, "show", ref+":"+path)
		if err != nil {
			file = "(no está en main)"
		}
		return fmt.Sprintf("%s\n\nDIFF desde %s hasta %s:\n```diff\n%s\n```\nEL ARCHIVO EN %s:\n```\n%s\n```\n", m, short(base), ref,
			clip(diff, dCap), ref, clip(file, fCap))
	})
}

// reEvidence: el `repo:ruta` del principio de una evidencia («infrastructure:.github/x.yml:12 (…)»).
var reEvidence = regexp.MustCompile(`^([A-Za-z0-9_.-]+):([^\s:()]+)`)

// citedFiles: los archivos en main que reemplazaron a los borrados de la sección (reemplazos.json) y los que cita la
// evidencia de la decisión, con su contenido. Sólo de repos que la corrida ya conoce (su clon sólo-main).
func (f *flow) citedFiles(ctx context.Context, r *Run, files, evidence []string, filesList []struct {
	Repo, Path, Ref, Base, Dir string
	Exists                     bool
}, shown map[string]bool) string {
	clone := map[string][2]string{} // repo → dir, ref
	for _, fl := range filesList {
		clone[fl.Repo] = [2]string{fl.Dir, fl.Ref}
	}
	var want []string
	swaps := map[string]string{}
	if raw, err := os.ReadFile(filepath.Join(r.driftDir(), "reemplazos.json")); err == nil {
		_ = json.Unmarshal(raw, &swaps)
	}
	for _, key := range files {
		if repo, path, ok := strings.Cut(key, ":"); ok && swaps[path] != "" {
			want = append(want, repo+":"+swaps[path])
		}
	}
	for _, e := range evidence {
		if m := reEvidence.FindStringSubmatch(strings.TrimSpace(e)); m != nil {
			want = append(want, m[1]+":"+m[2])
		}
	}
	var b strings.Builder
	for _, key := range want {
		repo, path, _ := strings.Cut(key, ":")
		c, ok := clone[repo]
		if !ok || shown[key] {
			continue
		}
		shown[key] = true
		file, err := f.sh(ctx, "git", "-C", c[0], "show", c[1]+":"+path)
		if err != nil {
			fmt.Fprintf(&b, "- %s: (no está en main)\n", key)
			continue
		}
		fmt.Fprintf(&b, "- %s, EN %s:\n```\n%s\n```\n", key, c[1], clip(file, fileCap))
	}
	return b.String()
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

// askList: una pregunta al modelo y su lista JSON. Si la respuesta no trae una lista que parsee, pregunta otra vez
// (una sola) y, si tampoco, deja la respuesta cruda en rawPath para ver qué escribió.
func (f *flow) askList(ctx context.Context, r *Run, system, prompt, rawPath string) ([]map[string]any, error) {
	var last error
	for try, failures := 0, 0; try < 2; try++ {
		ans, err := background.Ask(ctx, f.root, background.Request{Prompt: prompt, System: system})
		if err != nil {
			/* Un 502 o un corte de Bedrock suele ser pasajero (la corrida #23, 2026-11-24, cayó en un grupo que la #22
			 * había pasado): hasta 3 intentos más, con espera, antes de tirar la corrida entera. */
			if failures++; failures > 3 || ctx.Err() != nil {
				return nil, err
			}
			last = err
			try--
			wait := time.Duration(failures) * 20 * time.Second
			if strings.Contains(err.Error(), "Google está cortando") {
				wait = time.Duration(failures) * 150 * time.Second // bin/aistudio se pone en pausa 2 min tras un corte
			}
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(wait):
			}
			continue
		}
		r.Model = ans.Model
		out, err := parseList(ans.Text)
		if err == nil {
			return out, nil
		}
		last = fmt.Errorf("%v (terminó por %q)", err, ans.StopReason)
		if rawPath != "" {
			_ = os.WriteFile(rawPath, []byte(ans.Text), 0o644)
		}
	}
	return nil, last
}

// parseList: la lista JSON de objetos con «id» que trae el texto. Si la respuesta se cortó por largo (la corrida #28,
// 2026-11-24: ~50 mil caracteres de secciones reescritas), se rescatan los objetos completos; los que faltan los pide
// answerPackages. Sólo cuentan objetos con «id»: un «[]» suelto dentro del texto (una evidencia vacía) se había tomado
// como la respuesta entera, y un paquete de 35 ítems quedó en cero.
func parseList(text string) ([]map[string]any, error) {
	text = strings.TrimSpace(text)
	if text == "[]" {
		return []map[string]any{}, nil
	}
	var best []map[string]any
	var first error
	for i := 0; i < len(text); i++ {
		if text[i] != '[' {
			continue
		}
		dec := json.NewDecoder(strings.NewReader(text[i:]))
		if tok, err := dec.Token(); err != nil || tok != json.Delim('[') {
			continue
		}
		var out []map[string]any
		for dec.More() {
			var m map[string]any
			if err := dec.Decode(&m); err != nil {
				if first == nil {
					first = err
				}
				break
			}
			if _, ok := m["id"]; !ok {
				out = nil
				break
			}
			out = append(out, m)
		}
		if len(out) > len(best) {
			best = out
		}
	}
	if len(best) > 0 {
		return best, nil
	}
	if first == nil {
		return nil, fmt.Errorf("el modelo no devolvió una lista JSON de ítems: %.200s", text)
	}
	return nil, fmt.Errorf("la lista del modelo no parsea: %v", first)
}

// reItem: los ítems de un paquete («## ÍTEM <id>»): lo que tiene que volver con veredicto.
var reItem = regexp.MustCompile(`(?m)^## ÍTEM (\S+)`)

// answerPackages: cada paquete de dir que empieza con prefix → su resultado-N.json al lado, con el prompt dado.
func (f *flow) answerPackages(ctx context.Context, r *Run, st *Step, dir, prefix, promptName string, expand bool) (int, error) {
	system, err := f.prompt(promptName)
	if err != nil {
		return 0, err
	}
	// lo que queda sin veredicto tras los reintentos: el triaje lo manda a leer código; los otros pasos lo dejan
	// «sin decidir», que FRENA la corrida (se decide a mano y se retoma) en vez de fallarla.
	undecided := "sin_decidir"
	if promptName == "triage.md" {
		undecided = "no_se_sabe"
	}
	pkgs := filesIn(dir, prefix)
	total := 0
	for i, p := range pkgs {
		st.Now = fmt.Sprintf("%d de %d · %s", i+1, len(pkgs), filepath.Base(p))
		f.runs.save(r)
		n := strings.TrimSuffix(strings.TrimPrefix(filepath.Base(p), prefix), ".md")
		result := filepath.Join(dir, "resultado-"+n+".json")
		raw, err := os.ReadFile(p)
		if err != nil {
			return total, err
		}
		want := []string{}
		for _, m := range reItem.FindAllStringSubmatch(string(raw), -1) {
			want = append(want, m[1])
		}
		/* Al retomar, lo ya contestado no se vuelve a preguntar (cada paquete es minutos de modelo): sólo lo que falte. */
		got := map[string]map[string]any{}
		if done, err := os.ReadFile(result); err == nil {
			var list []map[string]any
			if json.Unmarshal(done, &list) == nil {
				for _, x := range list {
					if id, _ := x["id"].(string); id != "" {
						got[id] = x
					}
				}
			}
		}
		missing := func() []string {
			out := []string{}
			for _, id := range want {
				if _, ok := got[id]; !ok {
					out = append(out, id)
				}
			}
			return out
		}
		body := ""
		for try := 0; try < 3 && len(missing()) > 0; try++ {
			if body == "" {
				body = string(raw)
				if expand {
					body = f.expand(ctx, body)
				}
			}
			ask := body
			if len(got) > 0 {
				ask += "\n\n# FALTAN\n\nYa se contestaron los demás. Devolvé la lista JSON SÓLO con estos ítems, completos y en el mismo formato:\n- " +
					strings.Join(missing(), "\n- ")
			}
			st.Now = fmt.Sprintf("%d de %d · %s · faltan %d", i+1, len(pkgs), filepath.Base(p), len(missing()))
			f.runs.save(r)
			list, err := f.askList(ctx, r, system, ask, filepath.Join(dir, "respuesta-"+n+".txt"))
			if err != nil {
				if len(got) == 0 && try == 2 {
					return total, fmt.Errorf("%s: %w", filepath.Base(p), err)
				}
				continue
			}
			for _, x := range list {
				if id, _ := x["id"].(string); id != "" {
					got[id] = x
				}
			}
		}
		for _, id := range missing() {
			got[id] = map[string]any{"id": id, "veredicto": undecided, "por_que": "el modelo no lo devolvió en tres intentos"}
		}
		list := make([]map[string]any, 0, len(want))
		for _, id := range want {
			list = append(list, got[id])
		}
		out, _ := json.MarshalIndent(list, "", " ")
		if err := os.WriteFile(result, out, 0o644); err != nil {
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
		shown := map[string]bool{}
		for _, key := range it.Files {
			for _, fl := range filesList {
				if fl.Repo+":"+fl.Path != key {
					continue
				}
				if fl.Exists {
					b.WriteString(f.expand(ctx, fmt.Sprintf("- %s: `git -C %s diff %s %s -- %s`", key, fl.Dir, fl.Base, fl.Ref, fl.Path)) + "\n")
				} else {
					fmt.Fprintf(&b, "- %s: ya no está en main (borrado)\n", key)
				}
				shown[key] = true
			}
		}
		// Lo que la decisión dice que lo reemplazó o cita como evidencia también va, como está en main: sin eso, un
		// archivo borrado y reemplazado por otro (la #15: pr-checks.yml → workflows por ambiente) no se puede verificar.
		if extra := f.citedFiles(ctx, r, it.Files, v.Evidence, filesList, shown); extra != "" {
			b.WriteString("\n## ARCHIVOS EN MAIN QUE CITA LA DECISIÓN (los que reemplazaron a los borrados y la evidencia)\n" + extra)
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
