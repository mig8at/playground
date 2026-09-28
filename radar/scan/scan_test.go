package scan

// No persiguen cobertura: cada prueba fija un error que radar ya cometió, o que se cometió a mano antes de
// que radar existiera (2026-09-27).

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

func day(s string) time.Time {
	t, err := time.Parse("2006-01-02", s)
	if err != nil {
		panic(err)
	}
	return t
}

// Partir como los hooks, y no contar como herramienta lo que no lo es: una redirección, un patrón de grep
// partido en `|`, ni el cuerpo de un `python3 -c` (el parser compartido parte en cada salto de línea).
func TestBashKeysCountsToolsNotText(t *testing.T) {
	cases := []struct {
		cmd  string
		want []string
	}{
		{"make -s tareas N=3 2>/dev/null && git -C ../x log --oneline", []string{"make tareas", "git log"}},
		{"make 2>/dev/null | grep -A3 deploys", []string{"make", "grep"}},
		{"grep -E 'foo|make [a-z-]+' Makefile", []string{"grep"}},
		{"python3 -c \"\nimport json\nprint(1)\n\"", []string{"python3"}},
		{"A=1 sudo make -C tablero cierre", []string{"make cierre"}},
		{"bin/pg sql --target local --query 'SELECT 1'", []string{"pg sql"}},
	}
	for _, c := range cases {
		if got := BashKeys(c.cmd); !reflect.DeepEqual(got, c.want) {
			t.Errorf("%q → %v, quería %v", c.cmd, got, c.want)
		}
	}
}

// Sólo un resultado con ERROR es fricción; y un pedido de aprobación se atribuye al tramo que lo pidió.
func TestFrictionIsAnErrorAndHasItsCulprit(t *testing.T) {
	if o, _ := outcomeOf("⛔ Bloqueado por el hook index-guard: …", false); o != OutcomeOK {
		t.Errorf("una salida que IMPRIME el aviso de un hook no es un bloqueo; dio %s", o)
	}
	o, hook := outcomeOf("⛔ Bloqueado por el hook index-guard (…): …", true)
	if o != OutcomeBlocked || hook != "index-guard" {
		t.Errorf("bloqueo real: %s/%s", o, hook)
	}
	c := Call{Keys: []string{"grep", "head", "make canon-search"}}
	c.Outcome, _ = outcomeOf("This Bash command contains multiple operations. The following part requires approval: make canon-search Q='x' 2>&1", true)
	if got := culprit(c, "The following part requires approval: make canon-search Q='x' 2>&1"); !reflect.DeepEqual(got, []string{"make canon-search"}) {
		t.Errorf("culpable: %v, quería sólo make canon-search", got)
	}
}

// El error que motivó radar: un target que HOY no existe no está «muerto» por aparecer en la historia —
// las 527 llamadas a `context-lint` eran todas de antes de sacarlo—. Y un nombre viejo sólo es viejo
// DESPUÉS de que existió su alias.
func TestDriftLooksAtWhenThingsExisted(t *testing.T) {
	mk := Makefile{Targets: map[string]bool{"harness-walk-wizard": true, "tareas": true, "nuevo": true},
		Aliases: map[string]string{"harness-caminar": "harness-walk-wizard"}}
	hist := History{
		Added:      map[string]time.Time{"context-lint": day("2026-08-01"), "tareas": day("2026-07-01"), "nuevo": day("2026-09-26")},
		Removed:    map[string]time.Time{"context-lint": day("2026-09-21")},
		AliasAdded: map[string]time.Time{"harness-caminar": day("2026-09-25")},
	}
	call := func(key, when string) Call {
		return Call{Session: "s", Time: day(when), Keys: []string{key}, Outcome: OutcomeOK}
	}
	calls := []Call{
		call("make context-lint", "2026-09-20"),    // antes de sacarlo: uso legítimo
		call("make harness-caminar", "2026-09-21"), // antes del alias: era el nombre
		call("make tareas", "2026-09-26"),
		call("make tipeo", "2026-09-26"), // nunca existió
	}
	d := DriftView(calls, mk, hist, nil)
	if len(d.UsedAfterRemoval) != 0 || len(d.OldNames) != 0 {
		t.Fatalf("contó como muerto o viejo lo que se usó cuando existía: %+v · %+v", d.UsedAfterRemoval, d.OldNames)
	}
	calls = append(calls, call("make context-lint", "2026-09-22"), call("make harness-caminar", "2026-09-26"))
	d = DriftView(calls, mk, hist, nil)
	if len(d.UsedAfterRemoval) != 1 || d.UsedAfterRemoval[0].Calls != 1 {
		t.Errorf("después de sacarlo, cuenta sólo lo posterior: %+v", d.UsedAfterRemoval)
	}
	if len(d.OldNames) != 1 || d.OldNames[0].Calls != 1 {
		t.Errorf("después del alias, cuenta sólo lo posterior: %+v", d.OldNames)
	}
	if len(d.NeverExisted) != 1 || d.NeverExisted[0].Key != "make tipeo" {
		t.Errorf("nunca existió: %+v", d.NeverExisted)
	}
	// y el alias cuenta para el nombre nuevo: harness-walk-wizard no figura como sin uso
	for _, u := range d.UnusedTargets {
		if u.Target == "harness-walk-wizard" || u.Target == "tareas" {
			t.Errorf("%s se usó (por alias o directo) y figura como sin uso", u.Target)
		}
		if u.Target == "nuevo" && !u.Since.Equal(day("2026-09-26")) {
			t.Errorf("un target sin uso lleva la fecha en que nació: %v", u.Since)
		}
	}
}

// La historia se lee de una pasada; el marcador de commit no puede confundirse con un tramo del diff (`@@`).
func TestParseHistory(t *testing.T) {
	log := strings.Join([]string{
		commitMark + "2026-08-01T10:00:00-05:00",
		"@@ -1,3 +1,4 @@",
		"+context-lint: ## @dia lint",
		commitMark + "2026-09-21T16:25:03-05:00",
		"@@ -9,4 +9,3 @@",
		"-context-lint: ## @dia lint",
		commitMark + "2026-09-25T09:00:00-05:00",
		"+  harness-caminar:harness-walk-wizard \\",
	}, "\n")
	h := ParseHistory(log)
	if h.Added["context-lint"].Format("2006-01-02") != "2026-08-01" || h.Removed["context-lint"].Format("2006-01-02") != "2026-09-21" {
		t.Errorf("fechas del target: %v / %v", h.Added["context-lint"], h.Removed["context-lint"])
	}
	if h.AliasAdded["harness-caminar"].Format("2006-01-02") != "2026-09-25" {
		t.Errorf("fecha del alias: %v", h.AliasAdded["harness-caminar"])
	}
}

// El Makefile real: los targets documentados y los alias salen de él, no de una lista copiada.
func TestTheRealMakefileParses(t *testing.T) {
	src, err := os.ReadFile(filepath.Join("..", "..", "Makefile"))
	if err != nil {
		t.Fatal(err)
	}
	mk := ParseMakefile(string(src))
	if len(mk.Targets) < 50 || !mk.Targets["tareas"] {
		t.Errorf("leí %d targets: el patrón dejó de reconocerlos", len(mk.Targets))
	}
	if mk.Aliases["harness-caminar"] != "harness-walk-wizard" {
		t.Errorf("alias harness-caminar: %q", mk.Aliases["harness-caminar"])
	}
}

// Lo que se muestra va sin credenciales.
func TestRedactHidesSecrets(t *testing.T) {
	cmd := "LOKI_TOKEN=glc_abcdef123456789 curl -H 'Authorization: Bearer eyJhbGciOi.xyz' x?password=hunter22"
	got := Redact(cmd, 500)
	for _, leak := range []string{"glc_abcdef", "eyJhbGciOi", "hunter22"} {
		if strings.Contains(got, leak) {
			t.Errorf("se filtró %q en %q", leak, got)
		}
	}
}

// Las corridas automáticas (`claude -p` lanzado desde la app) heredan su `entrypoint`: lo que las separa es
// que nadie escribió. El 2026-09-27 eran 93 de 147 sesiones, y las skills «cargadas» eran casi todas suyas.
func TestAutomatedRunsAreLeftOutByDefault(t *testing.T) {
	sessions := []Session{{ID: "persona", Human: true}, {ID: "banco"}, {ID: "banco2"}}
	if got, skipped := HumanOnly(sessions, false); len(got) != 1 || got[0].ID != "persona" || skipped != 2 {
		t.Errorf("por defecto quedan sólo las humanas: %v (sacó %d)", got, skipped)
	}
	if got, _ := HumanOnly(sessions, true); len(got) != 3 {
		t.Errorf("con -all van todas: %d", len(got))
	}
}

// Una transcripción: el tool_use y su tool_result se unen por id, y la sesión dice cómo se lanzó.
func TestReadSessionPairsCallsWithResults(t *testing.T) {
	lines := []map[string]any{
		{"type": "user", "entrypoint": "claude-desktop", "turnOrigin": "human", "timestamp": "2026-09-27T10:00:00Z", "message": map[string]any{"content": "hola"}},
		{"type": "assistant", "timestamp": "2026-09-27T10:00:01Z", "message": map[string]any{"content": []any{
			map[string]any{"type": "tool_use", "id": "t1", "name": "Bash", "input": map[string]any{"command": "make canon-search Q=x"}},
			map[string]any{"type": "tool_use", "id": "t2", "name": "Skill", "input": map[string]any{"skill": "harness:harness-local"}},
		}}},
		{"type": "user", "timestamp": "2026-09-27T10:00:02Z", "message": map[string]any{"content": []any{
			map[string]any{"type": "tool_result", "tool_use_id": "t1", "is_error": true, "content": "This command requires approval"},
			map[string]any{"type": "tool_result", "tool_use_id": "t2", "content": []any{map[string]any{"type": "text", "text": "ok"}}},
		}}},
	}
	path := filepath.Join(t.TempDir(), "s1.jsonl")
	var b strings.Builder
	for _, l := range lines {
		raw, _ := json.Marshal(l)
		b.Write(raw)
		b.WriteByte('\n')
	}
	os.WriteFile(path, []byte(b.String()), 0o644)
	s, err := ReadSession(path)
	if err != nil {
		t.Fatal(err)
	}
	if s.Entrypoint != "claude-desktop" || !s.Human || len(s.Calls) != 2 {
		t.Fatalf("sesión: %+v", s)
	}
	if s.Calls[0].Outcome != OutcomeDenied || s.Calls[1].Outcome != OutcomeOK {
		t.Errorf("desenlaces: %s, %s", s.Calls[0].Outcome, s.Calls[1].Outcome)
	}
	if !reflect.DeepEqual(s.Calls[1].Keys, []string{"skill harness-local"}) {
		t.Errorf("skill con prefijo de plugin: %v", s.Calls[1].Keys)
	}
}

// Consultar canon para trabajar cuenta; desarrollarlo (bucles, localhost, tools/canon, -pregunta) no.
func TestCanonLookupSeparatesWorkFromDev(t *testing.T) {
	cases := []struct {
		cmd, kind, query string
		dev              bool
	}{
		{`make canon-search Q='cuota inicial'`, LookupSearch, "cuota inicial", false},
		{`make canon-read IDS='kyc/context#a'`, LookupRead, "kyc/context#a", false},
		{`make retomar N=84 CANON=1`, LookupContext, "", false},
		{`make canon-write PIECE=a.json`, LookupWrite, "", false},
		{`cd tablero/server && go run ./cmd/canon search codigo de compra`, LookupSearch, "codigo de compra", false},
		{`curl -s --get "https://canon.playground.creditop.com/api/search" --data-urlencode "q=firmo en prami"`, LookupSearch, "firmo en prami", false},
		{`curl -s "https://canon.playground.creditop.com/api/read?ids=kyc/context%23x"`, LookupRead, "kyc/context#x", false},
		{"curl -s -X POST https://canon.playground.creditop.com/api/context -d '{\"q\":\"Ábaco\"}' | python3 -c \"\nimport json\nfor s in d: print(s)\"", LookupContext, "Ábaco", false},
		{`for q in a b; do curl -s "https://canon.playground.creditop.com/api/search?q=$q"; done`, LookupSearch, "$q", true},
		{`curl -s 'localhost:8220/api/read?ids=listado/context' -H 'x: y' && curl https://canon.playground.creditop.com/api/read?ids=a`, LookupRead, "a", true},
		{`cd ~/Desktop/CREDITOP/github/playground/tools/canon && curl https://canon.playground.creditop.com/api/search?q=x`, LookupSearch, "x", true},
	}
	for _, c := range cases {
		got := canonLookupOf(c.cmd)
		if got == nil || got.Kind != c.kind || got.Query != c.query || got.Dev != c.dev {
			t.Errorf("%q: %+v, quería %s «%s» dev=%v", c.cmd, got, c.kind, c.query, c.dev)
		}
	}
	if canonLookupOf("grep -rn /api/search tools") != nil || canonLookupOf("make tareas") != nil {
		t.Error("nombrar la API o correr otro target no es consultar canon")
	}
}

// Una consulta seguida de leer un repo real, dentro de la ventana, es un hueco; lo que pasa después de
// otra consulta o fuera de la ventana, no. Una búsqueda vacía es un hueco por sí sola.
func TestGapsPairLookupsWithCode(t *testing.T) {
	at := func(min int) time.Time { return day("2026-09-20").Add(time.Duration(min) * time.Minute) }
	s := Session{ID: "s1", Calls: []Call{
		{Time: at(0), Canon: &CanonLookup{Kind: LookupSearch, Query: "Código de compra"}},
		{Time: at(1), Code: "legacy-backend"},
		{Time: at(2), Code: "legacy-application"},
		{Time: at(3), Canon: &CanonLookup{Kind: LookupRead, Query: "kyc/context"}},
		{Time: at(40), Code: "legacy-backend"}, // fuera de la ventana
		{Time: at(41), Canon: &CanonLookup{Kind: LookupSearch, Query: "zz", Empty: true}},
		{Time: at(42), Canon: &CanonLookup{Kind: LookupSearch, Dev: true}},
		{Time: at(43), Canon: &CanonLookup{Kind: LookupWrite}},
	}}
	s2 := Session{ID: "s2", Calls: []Call{
		{Time: at(0), Canon: &CanonLookup{Kind: LookupSearch, Query: "codigo  de compra"}},
		{Time: at(5), Code: "main-verifier"},
	}}
	g := GapsView([]Session{s, s2}, day("2026-09-01"))
	if g.Lookups != 4 || g.Dev != 1 || g.Writes != 1 || len(g.Gaps) != 2 {
		t.Fatalf("%+v", g)
	}
	top := g.Gaps[0]
	if top.Signal != SignalSearchedCode || top.Sessions != 2 || top.Times != 2 || len(top.Repos) != 3 {
		t.Fatalf("el hueco repetido: %+v", top)
	}
	if g.Gaps[1].Signal != SignalEmpty {
		t.Fatalf("la vacía: %+v", g.Gaps[1])
	}
}

func TestCodeRepoIgnoresThePlayground(t *testing.T) {
	if r := codeRepoOf("Read", map[string]any{"file_path": "/Users/x/Desktop/CREDITOP/github/legacy-backend/app/A.php"}); r != "legacy-backend" {
		t.Errorf("Read: %q", r)
	}
	if r := codeRepoOf("Bash", map[string]any{"command": "git -C ~/Desktop/CREDITOP/github/playground log"}); r != "" {
		t.Errorf("el playground compartido no es código del producto: %q", r)
	}
	if r := codeRepoOf("Agent", map[string]any{"subagent_type": "main-verifier"}); r != "main-verifier" {
		t.Errorf("agent: %q", r)
	}
}

// Una sesión reanudada copia la historia: la misma llamada (mismo id) no se cuenta dos veces.
func TestResumedSessionsDoNotCountTwice(t *testing.T) {
	a := Session{ID: "a", Start: day("2026-09-01"), Calls: []Call{{ID: "t1"}, {ID: "t2"}}}
	b := Session{ID: "b", Start: day("2026-09-02"), Calls: []Call{{ID: "t1"}, {ID: "t2"}, {ID: "t3"}, {}}}
	out := dedupeResumed([]Session{a, b})
	if len(out[0].Calls) != 2 || len(out[1].Calls) != 2 || out[1].Calls[0].ID != "t3" {
		t.Fatalf("%+v", out)
	}
}

// En una sesión de desarrollo de canon, un curl suelto a prod es una sonda, no una pregunta.
func TestCanonDevSessionLookupsDoNotCount(t *testing.T) {
	var calls []Call
	for i := 0; i < canonDevSession; i++ {
		calls = append(calls, Call{Time: day("2026-09-20"), Command: "cd ~/Desktop/CREDITOP/github/playground/tools/canon && go test ./..."})
	}
	calls = append(calls, Call{Time: day("2026-09-20"), Canon: &CanonLookup{Kind: LookupSearch, Query: "q", Empty: true}})
	g := GapsView([]Session{{ID: "dev", Calls: calls}}, day("2026-09-01"))
	if g.Lookups != 0 || g.Dev != 1 || len(g.Gaps) != 0 {
		t.Fatalf("%+v", g)
	}
}
