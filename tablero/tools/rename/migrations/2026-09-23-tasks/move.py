"""move.py [--apply] — YA SE CORRIÓ (commit de la mudanza del 2026-09-23); queda como registro de
cómo se repartió cada archivo y por qué. Correrlo de nuevo falla: `data/` ya no tiene tareas.

move.py [--apply] — la mudanza de tablero/data a tablero/tasks/<slug>/ (2026-09-23).

Cada tarea `data/<slug>.md` pasa a `tasks/<slug>/task.md`, su pila `data/task-context/<slug>.jsonl` a
`tasks/<slug>/context.jsonl`, y cada artifact `data/artifacts/<archivo>` a `tasks/<dueño>/artifacts/`.
El dueño de un artifact es la tarea más larga cuyo slug es prefijo de su nombre seguido de `.`; los que
no siguen la convención se asignan a mano, por evidencia (ver ORPHANS).
"""
import subprocess, sys
from pathlib import Path

BOARD = Path(__file__).resolve().parents[4]  # tablero/
DATA, TASKS = BOARD / 'data', BOARD / 'tasks'
ORPHANS = {  # artifact → (dueño, nombre nuevo o None)
    'agente-soporte-endpoints-n8n.md': ('agente-soporte-modificacion-datos', None),   # lo cita esa tarea
    'bcp-que-revisar-2026-09-07.md': ('bcp-peru-estructurar-entidad', None),         # entró en b4be9093 junto con ella
    'cuadrilla-donde-viven-las-herramientas.entrada.html':                          # la tarea 48 se llamaba así hasta el 14/8
        ('playground-donde-viven-las-herramientas', 'playground-donde-viven-las-herramientas.entrada.html'),
    'motai-v2-que-se-hizo.md': ('motai-v2', None),                                   # confirmado por Miguel
}

def plan():
    moves = []
    slugs = sorted(p.stem for p in DATA.glob('*.md'))
    for s in slugs:
        moves.append((DATA / f'{s}.md', TASKS / s / 'task.md'))
    for p in sorted((DATA / 'task-context').glob('*.jsonl')):
        if p.stem not in slugs:
            raise SystemExit(f'pila sin tarea: {p.name}')
        moves.append((p, TASKS / p.stem / 'context.jsonl'))
    for p in sorted((DATA / 'artifacts').iterdir()):
        name = p.name
        if name in ORPHANS:
            owner, rename = ORPHANS[name]
        else:
            owners = [s for s in slugs if name.startswith(s + '.')]
            if not owners:
                raise SystemExit(f'artifact sin dueño: {name}')
            owner, rename = max(owners, key=len), None
        moves.append((p, TASKS / owner / 'artifacts' / (rename or name)))
    return moves

def main():
    apply = '--apply' in sys.argv
    moves = plan()
    for src, dst in moves:
        if dst.exists():
            raise SystemExit(f'ya existe {dst}')
    for src, dst in moves:
        rel_s, rel_d = src.relative_to(BOARD), dst.relative_to(BOARD)
        if apply:
            dst.parent.mkdir(parents=True, exist_ok=True)
            subprocess.run(['git', 'mv', str(rel_s), str(rel_d)], cwd=BOARD, check=True)
        else:
            print(f'  {rel_s}  →  {rel_d}')
    kinds = {'task.md': 0, 'context.jsonl': 0, 'artifacts': 0}
    for _, dst in moves:
        kinds['artifacts' if dst.parent.name == 'artifacts' else dst.name] += 1
    print(f"\n  {len(moves)} movimientos: {kinds['task.md']} tareas · {kinds['context.jsonl']} pilas · {kinds['artifacts']} artifacts"
          + ('' if apply else '  (en seco: --apply para moverlos)'))

main()
