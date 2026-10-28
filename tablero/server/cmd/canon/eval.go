package main

/* eval mide qué tan bien organizado está canon y qué parte del código no vigila, sin modelo y sin escribir
 * nada. Responde tres preguntas con datos:
 *
 *   1. ¿los temas están parejos? palabras, secciones y áreas por tema; los que rozan el tope (el lint
 *      rechaza un tema de más de 8000 palabras) y los que quedaron casi vacíos; las secciones que ningún
 *      área vigila (pueden envejecer sin que la ronda avise); un mismo repo nombrado de dos formas.
 *   2. ¿qué código se mueve sin que canon lo mire? por módulo de cada repo: archivos en main, cuántos
 *      declara algún área y cuántos cambios de los últimos N días cayeron en archivos que nadie declara.
 *      Es la lista de áreas que faltan, ordenada por lo que pesa.
 *   3. ¿qué no supo contestar? (opcional, con -target) de la base de canon: qué preguntas no tuvieron
 *      respaldo, los motivos de «no pude» y los archivos que el agente tuvo que abrir sin que ningún área
 *      los declare. Sólo conteos y motivos: las preguntas de la gente no se imprimen.
 *
 * Lee el corpus por la misma API que `export` y los repos por `tools/repos.json`, contra la ref de main que
 * dice `repos` (sin fetch). */

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"path"
	"regexp"
	"sort"
	"strings"
	"time"

	"creditop/playground/connectors/canon"
	"creditop/playground/connectors/repos"
)

// topicWordCap es el tope de palabras de un tema que impone el lint de canon.
const topicWordCap = 8000

// thinTopicWords: por debajo de esto un tema es una portada, no un tema.
const thinTopicWords = 400

type topicStat struct {
	Topic    string   `json:"topic"`
	Words    int      `json:"words"`
	Sections int      `json:"sections"`
	Areas    int      `json:"areas"`
	Orphans  []string `json:"orphan_sections,omitempty"`
}

type groupStat struct {
	Repo              string `json:"repo"`
	Group             string `json:"group"`
	Files             int    `json:"files"`
	Declared          int    `json:"declared"`
	Changes           int    `json:"changes"`
	UndeclaredChanges int    `json:"undeclared_changes"`
}

type evalReport struct {
	Days      int               `json:"days"`
	Topics    []topicStat       `json:"topics"`
	Aliases   map[string]string `json:"repo_aliases,omitempty"`
	Coverage  []groupStat       `json:"coverage"`
	RepoNotes []string          `json:"repo_notes,omitempty"`
	Questions *questionStats    `json:"questions,omitempty"`
}

type questionStats struct {
	Source     string     `json:"source"`
	Total      int        `json:"total"`
	Backed     int        `json:"backed"`
	CouldNot   int        `json:"could_not"`
	Reasons    []countRow `json:"reasons"`
	Undeclared []countRow `json:"undeclared_files"`
}

type countRow struct {
	Key   string `json:"key"`
	Count int    `json:"count"`
}

func evaluate(ctx context.Context, client *canon.Client, args []string) error {
	flags := flag.NewFlagSet("eval", flag.ExitOnError)
	days := flags.Int("days", 90, "ventana de cambios en main y de preguntas, en días")
	top := flags.Int("top", 15, "cuántos módulos mostrar por repo")
	repoList := flags.String("repos", "legacy-backend,application,frontend-monorepo", "alias de tools/repos.json a medir, separados por coma")
	target := flags.String("target", "", "base de canon de la que leer las preguntas (local · prod); vacío = no se leen")
	asJSON := flags.Bool("json", false, "el informe en JSON")
	_ = flags.Parse(args)

	export, _, _, err := client.Export(ctx, "")
	if err != nil {
		return err
	}
	topics, declared, aliases := corpusStats(export.Files)
	report := evalReport{Days: *days, Topics: topics, Aliases: aliases}

	rc := repos.Find()
	for _, alias := range strings.Split(*repoList, ",") {
		alias = strings.TrimSpace(alias)
		if alias == "" {
			continue
		}
		groups, note := repoCoverage(rc, alias, declared[alias], *days)
		if note != "" {
			report.RepoNotes = append(report.RepoNotes, note)
		}
		if len(groups) > *top {
			groups = groups[:*top]
		}
		report.Coverage = append(report.Coverage, groups...)
	}

	if *target != "" {
		qs, err := questionReport(ctx, *target, *days)
		if err != nil {
			report.RepoNotes = append(report.RepoNotes, "preguntas: "+err.Error())
		} else {
			report.Questions = qs
		}
	}

	if *asJSON {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		return enc.Encode(report)
	}
	printReport(report)
	return nil
}

var (
	headingRE   = regexp.MustCompile(`(?m)^## (.+)$`)
	nonAnchorRE = regexp.MustCompile(`[^a-z0-9]+`)
	accents     = strings.NewReplacer("á", "a", "é", "e", "í", "i", "ó", "o", "ú", "u", "ü", "u", "ñ", "n")
)

// anchorOf es el ancla que canon le da a un título de sección.
func anchorOf(title string) string {
	return strings.Trim(nonAnchorRE.ReplaceAllString(accents.Replace(strings.ToLower(title)), "-"), "-")
}

// canonRepoAlias traduce el nombre de repo de un mapa de canon al alias de tools/repos.json: canon mezcla el
// alias corto con el nombre completo («Creditop-SAS/legacy-backend») y llama legacy-application a lo que acá
// es application.
func canonRepoAlias(name string) string {
	name = strings.TrimPrefix(name, "Creditop-SAS/")
	if name == "legacy-application" {
		return "application"
	}
	return name
}

/* corpusStats recorre los archivos del export: por tema, palabras y secciones de su prosa, áreas de su mapa y
 * secciones que ningún área nombra. Devuelve también qué archivos declara el corpus por repo (con el alias de
 * repos.json) y los repos que aparecen con dos nombres. */
func corpusStats(files map[string]string) ([]topicStat, map[string]map[string]bool, map[string]string) {
	type acc struct {
		words   int
		titles  []string
		areas   int
		covered map[string]bool
	}
	byTopic := map[string]*acc{}
	get := func(t string) *acc {
		if byTopic[t] == nil {
			byTopic[t] = &acc{covered: map[string]bool{}}
		}
		return byTopic[t]
	}
	declared := map[string]map[string]bool{}
	spellings := map[string]map[string]bool{}
	for p, text := range files {
		parts := strings.Split(p, "/")
		if len(parts) != 3 || parts[0] != "content" {
			continue
		}
		a := get(parts[1])
		switch {
		case strings.HasSuffix(p, ".md"):
			a.words += len(strings.Fields(text))
			for _, m := range headingRE.FindAllStringSubmatch(text, -1) {
				a.titles = append(a.titles, strings.TrimSpace(m[1]))
			}
		case strings.HasSuffix(p, "map.json"):
			var m struct {
				Areas []canon.Area `json:"areas"`
			}
			if json.Unmarshal([]byte(text), &m) != nil {
				continue
			}
			a.areas += len(m.Areas)
			for _, area := range m.Areas {
				for _, s := range area.Sections {
					a.covered[s] = true
				}
				for repo, paths := range area.Sources {
					alias := canonRepoAlias(repo)
					if spellings[alias] == nil {
						spellings[alias] = map[string]bool{}
					}
					spellings[alias][repo] = true
					if declared[alias] == nil {
						declared[alias] = map[string]bool{}
					}
					for file := range paths {
						declared[alias][file] = true
					}
				}
			}
		}
	}
	var topics []topicStat
	for name, a := range byTopic {
		st := topicStat{Topic: name, Words: a.words, Sections: len(a.titles), Areas: a.areas}
		for _, t := range a.titles {
			if !a.covered[anchorOf(t)] {
				st.Orphans = append(st.Orphans, t)
			}
		}
		topics = append(topics, st)
	}
	sort.Slice(topics, func(i, j int) bool { return topics[i].Words > topics[j].Words })
	aliases := map[string]string{}
	for alias, names := range spellings {
		if len(names) > 1 {
			var list []string
			for n := range names {
				list = append(list, n)
			}
			sort.Strings(list)
			aliases[alias] = strings.Join(list, " · ")
		}
	}
	return topics, declared, aliases
}

// skipFile deja afuera lo que no es comportamiento: pruebas, migraciones, traducciones y configuración.
func skipFile(p string) bool {
	lower := strings.ToLower(p)
	for _, s := range []string{"/test/", "/tests/", "/__tests__/", "/database/", "/migrations/", "/lang/", "/config/", "/stories/", "/mocks/"} {
		if strings.Contains("/"+lower, s) {
			return true
		}
	}
	return strings.Contains(lower, ".test.") || strings.Contains(lower, ".spec.") || strings.HasSuffix(p, "Test.php") || strings.HasSuffix(p, "_test.go")
}

// groupOf es el módulo de un archivo: dos niveles de carpeta (`Modules/Loans`, `apps/backoffice`, `app/Http`).
func groupOf(p string) string {
	parts := strings.Split(p, "/")
	if len(parts) <= 2 {
		return parts[0]
	}
	return parts[0] + "/" + parts[1]
}

/* repoCoverage cruza un repo con lo que el corpus declara de él: por módulo, archivos de código en main,
 * cuántos declara algún área y los cambios de los últimos `days` días, separando los que cayeron en
 * archivos sin declarar. La nota dice contra qué ref se midió, o por qué no se pudo. */
func repoCoverage(rc *repos.Client, alias string, declared map[string]bool, days int) ([]groupStat, string) {
	root, ok := rc.Citable()[alias]
	if !ok {
		return nil, alias + ": no está en tools/repos.json"
	}
	ref, reason := rc.RefToIndex(root)
	if ref == "" {
		return nil, alias + ": " + reason
	}
	exts := map[string]bool{}
	for _, e := range rc.Extensions() {
		exts[e] = true
	}
	tree, err := exec.Command("git", "-C", root, "ls-tree", "-r", "--name-only", ref).Output()
	if err != nil {
		return nil, alias + ": no pude listar " + ref
	}
	log, err := exec.Command("git", "-C", root, "log", ref, fmt.Sprintf("--since=%d.days", days), "--name-only", "--format=").Output()
	if err != nil {
		return nil, alias + ": no pude leer el historial de " + ref
	}
	changes := map[string]int{}
	for _, f := range strings.Split(string(log), "\n") {
		if f != "" {
			changes[f]++
		}
	}
	byGroup := map[string]*groupStat{}
	for _, f := range strings.Split(string(tree), "\n") {
		if f == "" || !exts[path.Ext(f)] || skipFile(f) {
			continue
		}
		g := groupOf(f)
		st := byGroup[g]
		if st == nil {
			st = &groupStat{Repo: alias, Group: g}
			byGroup[g] = st
		}
		st.Files++
		st.Changes += changes[f]
		if declared[f] {
			st.Declared++
		} else {
			st.UndeclaredChanges += changes[f]
		}
	}
	var out []groupStat
	for _, st := range byGroup {
		out = append(out, *st)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].UndeclaredChanges != out[j].UndeclaredChanges {
			return out[i].UndeclaredChanges > out[j].UndeclaredChanges
		}
		return out[i].Group < out[j].Group
	})
	return out, fmt.Sprintf("%s: %s (%s)", alias, ref, reason)
}

/* questionReport lee de la base de canon lo que no se pudo contestar. Las consultas son las que el propio
 * canon documenta junto a su tabla (`canon_turnos`); sólo devuelven conteos, motivos y archivos. */
func questionReport(ctx context.Context, target string, days int) (*questionStats, error) {
	cfg, _, err := canon.LoadDBConfig(target)
	if err != nil {
		return nil, err
	}
	if missing := cfg.Missing(); len(missing) > 0 {
		return nil, fmt.Errorf("falta %s para la base de canon en %s", strings.Join(missing, ", "), target)
	}
	dbctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	db, err := canon.OpenDB(dbctx, cfg)
	if err != nil {
		return nil, err
	}
	defer db.Close()
	window := fmt.Sprintf("cuando > now() - interval '%d days'", days)
	totals, err := db.Query(ctx, `SELECT count(*) AS total, count(*) FILTER (WHERE respaldada) AS backed, count(*) FILTER (WHERE coalesce(no_pude,'') <> '') AS could_not FROM canon_turnos WHERE `+window)
	if err != nil {
		return nil, err
	}
	qs := &questionStats{Source: db.Source()}
	if len(totals.Rows) == 1 {
		qs.Total, qs.Backed, qs.CouldNot = asInt(totals.Rows[0]["total"]), asInt(totals.Rows[0]["backed"]), asInt(totals.Rows[0]["could_not"])
	}
	reasons, err := db.Query(ctx, `SELECT left(no_pude, 90) AS key, count(*) AS n FROM canon_turnos WHERE coalesce(no_pude,'') <> '' AND `+window+` GROUP BY 1 ORDER BY 2 DESC LIMIT 15`)
	if err != nil {
		return nil, err
	}
	qs.Reasons = countRows(reasons)
	files, err := db.Query(ctx, `SELECT (f->>'repo') || ':' || (f->>'ruta') AS key, count(*) AS n FROM canon_turnos, jsonb_array_elements(coalesce(no_declarados, '[]'::jsonb)) f WHERE `+window+` GROUP BY 1 ORDER BY 2 DESC LIMIT 20`)
	if err != nil {
		return nil, err
	}
	qs.Undeclared = countRows(files)
	return qs, nil
}

func countRows(r canon.Result) []countRow {
	var out []countRow
	for _, row := range r.Rows {
		out = append(out, countRow{Key: fmt.Sprint(row["key"]), Count: asInt(row["n"])})
	}
	return out
}

func asInt(v any) int {
	switch n := v.(type) {
	case int64:
		return int(n)
	case int:
		return n
	case float64:
		return int(n)
	}
	var i int
	fmt.Sscan(fmt.Sprint(v), &i)
	return i
}

func printReport(r evalReport) {
	fmt.Println("  canon · evaluación de organización y cobertura (sin modelo, sólo lectura)")
	var words, sections, orphans int
	var full, thin []string
	for _, t := range r.Topics {
		words += t.Words
		sections += t.Sections
		orphans += len(t.Orphans)
		if t.Words >= topicWordCap*85/100 {
			full = append(full, fmt.Sprintf("%s (%d)", t.Topic, t.Words))
		}
		if t.Words < thinTopicWords {
			thin = append(thin, t.Topic)
		}
	}
	fmt.Printf("\n── temas: %d · %d palabras · %d secciones · %d sin área\n", len(r.Topics), words, sections, orphans)
	for i, t := range r.Topics {
		if i == 10 {
			break
		}
		fmt.Printf("    %-22s %5d palabras  %3d secciones  %3d áreas  %3d sin área\n", t.Topic, t.Words, t.Sections, t.Areas, len(t.Orphans))
	}
	if len(full) > 0 {
		fmt.Printf("  ⚠ cerca del tope de %d palabras (partir): %s\n", topicWordCap, strings.Join(full, ", "))
	}
	if len(thin) > 0 {
		fmt.Printf("  ⚠ casi vacíos, menos de %d palabras (llenar o fundir): %s\n", thinTopicWords, strings.Join(thin, ", "))
	}
	for _, t := range r.Topics {
		if len(t.Orphans) > 0 && len(t.Orphans) < t.Sections {
			fmt.Printf("  · %s: %d secciones sin área (nada avisa si envejecen): %s\n", t.Topic, len(t.Orphans), strings.Join(t.Orphans, " · "))
		}
	}
	for alias, names := range r.Aliases {
		fmt.Printf("  ⚠ el repo %s aparece con dos nombres en los mapas: %s\n", alias, names)
	}

	fmt.Printf("\n── código que se mueve sin que canon lo mire (cambios de los últimos %d días)\n", r.Days)
	for _, n := range r.RepoNotes {
		fmt.Println("    nota ·", n)
	}
	repo := ""
	for _, g := range r.Coverage {
		if g.Repo != repo {
			repo = g.Repo
			fmt.Printf("  %s\n    %-34s %8s %10s %6s %9s %14s\n", repo, "módulo", "archivos", "vigilados", "cob.", "cambios", "sin vigilar")
		}
		cov := 0
		if g.Files > 0 {
			cov = 100 * g.Declared / g.Files
		}
		fmt.Printf("    %-34s %8d %10d %5d%% %9d %14d\n", g.Group, g.Files, g.Declared, cov, g.Changes, g.UndeclaredChanges)
	}

	if q := r.Questions; q != nil {
		fmt.Printf("\n── preguntas del equipo (%s, últimos %d días): %d · con respaldo %d · «no pude» %d\n", q.Source, r.Days, q.Total, q.Backed, q.CouldNot)
		fmt.Println("  (para diagnosticar: no se copia a tareas ni a PRs)")
		for _, c := range q.Reasons {
			fmt.Printf("    %3d× %s\n", c.Count, c.Key)
		}
		if len(q.Undeclared) > 0 {
			fmt.Println("  archivos que el agente abrió y ningún área declara:")
			for _, c := range q.Undeclared {
				fmt.Printf("    %3d× %s\n", c.Count, c.Key)
			}
		}
	}
	fmt.Println("\n  un módulo con muchos cambios sin vigilar es un área que falta: se verifica en main y se dicta (skill canon)")
}
