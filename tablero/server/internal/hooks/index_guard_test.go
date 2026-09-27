package hooks

import "testing"

// Lo que frena es lo que ya se llevó trabajo de otra sesión; lo que deja pasar incluye los commits
// reales de la sesión que lo escribió (2026-09-27), que nombran sus rutas: si alguno se frenara, el
// hook enseñaría a esquivarlo en vez de a nombrar rutas.
func TestTheIndexGuard(t *testing.T) {
	cases := []struct {
		cmd    string
		blocks bool
	}{
		// el árbol entero
		{"git add -A", true},
		{"git add --all", true},
		{"git add .", true},
		{"git add -u", true},
		{"cd tools && git add -A", true},
		// con rutas, -A queda acotado a ellas
		{"git add -A -- tools/canon Taskfile.yml", false},
		{"git add tablero/.claude/skills", false},
		// commit de todo lo modificado
		{`git commit -am "x"`, true},
		{`git commit -qam "x" -- a.go`, true},
		{`git commit --all -m x`, true},
		// commit sin rutas: se lleva el índice entero
		{`git commit -m "x"`, true},
		{`git -C ../legacy-backend commit -m "x"`, true},
		{"git commit --amend --no-edit", true},
		// …salvo que el mismo comando haya stageado rutas antes
		{`git add a.go b.go && git commit -m "x"`, false},
		{`git rm viejo.go && git commit -m "x"`, false},
		// rutas en el propio commit
		{`git commit -q tablero/CLAUDE.md tablero/.claude/skills -m "a" -m "b"`, false},
		{`git commit -m "quita el flag -a" -- x.go`, false},
		{"git commit -mmsg x.go", false},
		{"git commit -F - -- a.go b.go", false},
		{"git commit --pathspec-from-file=lista.txt -m x", false},
		// los de esta sesión
		{`git add .claude/agents/main-verifier.md && git commit -q .claude/agents/main-verifier.md CLAUDE.md tablero/CLAUDE.md .claude/skills/canon/SKILL.md -m "agents: main-verifier" -m "Co-Authored-By: x"`, false},
		{`git add tablero/server/internal/hooks/verify.go && git commit -q .claude/settings.json tablero/server/internal/hooks/hooks.go -m "hooks: verify" -m "cuerpo"`, false},
		// la salida: mirar el índice y decirlo
		{`I_CHECKED_THE_INDEX=1 git commit -m "x"`, false},
		// nombrar no es correr
		{`grep -rn "git commit -a" .`, false},
		{`echo "no uses git add -A"`, false},
		{"git status --short", false},
		{"git log --oneline -3", false},
	}
	for _, c := range cases {
		got := len(IndexGuard(c.cmd)) > 0
		if got != c.blocks {
			t.Errorf("%q: frena=%v, quería %v (%v)", c.cmd, got, c.blocks, IndexGuard(c.cmd))
		}
	}
}
