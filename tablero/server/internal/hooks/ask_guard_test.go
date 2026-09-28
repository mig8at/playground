package hooks

import "testing"

// Frena lo que llega al modelo; deja pasar lo que lee canon, lo que sólo NOMBRA `/api/ask`, la sonda GET
// que contesta 405, y la calibración declarada. Los casos «reales» son formas que aparecieron en las
// sesiones del último mes (2026-09-27).
func TestTheAskGuard(t *testing.T) {
	cases := []struct {
		name, cmd string
		blocks    bool
	}{
		{"POST con cuerpo", `curl -s https://canon.playground.creditop.com/api/ask -d '{"pregunta":"x"}'`, true},
		{"POST al stream", `curl -sN -X POST https://canon.playground.creditop.com/api/ask/stream --json '{"q":"x"}'`, true},
		{"wget con cuerpo", `wget -qO- --post-data='{"pregunta":"x"}' https://canon/api/ask`, true},
		{"python en línea", `python3 -c "import urllib.request as u; u.urlopen('https://canon/api/ask', b'{}')"`, true},
		{"python en heredoc", "python3 - <<'EOF'\nimport requests\nrequests.post('https://canon/api/ask', json={})\nEOF", true},
		{"calibrar con go run", `cd ~/Desktop/CREDITOP/github/playground/tools/canon && go run . -pregunta 2 "¿qué pasa?"`, true},
		{"calibrar con un binario", `cd tools/canon && CANON_MODELO=x /tmp/canon-c -pregunta 3 "mi pregunta"`, true},

		{"la sonda GET (405)", `curl -s -o /dev/null -w '%{http_code}' https://canon.playground.creditop.com/api/ask/stream`, false},
		{"leer canon", `make canon-search Q='cuota inicial' && make canon-read IDS='cuota/context'`, false},
		{"buscar en el código", `grep -rn "/api/ask" tools/canon/internal`, false},
		{"un mensaje que lo nombra", `git commit -m "canon: /api/ask queda para credibot" -- CLAUDE.md`, false},
		{"otro modo del CLI", `cd tools/canon && go run . -ronda`, false},
		{"un script que EDITA un archivo que lo nombra", "python3 - <<'EOF'\np='CLAUDE.md'; s=open(p).read()\ns=s.replace('`/api/ask` es para credibot', 'x')\nopen(p,'w').write(s)\nEOF", false},
		{"python que lo llama en localhost", "python3 - <<'EOF'\nimport urllib.request, json\nreq = urllib.request.Request(\"http://localhost:8383/api/ask/stream\", data=b'{}')\nEOF", true},
		{"la calibración declarada", `I_AM_CALIBRATING_CANON=1 go run . -pregunta "x"`, false},
	}
	for _, c := range cases {
		if got := len(AskGuard(c.cmd)) > 0; got != c.blocks {
			t.Errorf("%s: frena=%v, quería %v (%v)", c.name, got, c.blocks, AskGuard(c.cmd))
		}
	}
}
