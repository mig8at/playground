"""free.py <archivos.py…> — por archivo, los nombres que se LEEN y no se definen en ningún lado del
archivo (ni son builtins ni vienen de un import). Tiene que dar lo mismo antes y después de renombrar:
una referencia que el rename se saltó aparece acá como un nombre libre nuevo."""
import ast, builtins, sys
from pathlib import Path
for f in sys.argv[1:]:
    t = ast.parse(Path(f).read_text())
    bound, loaded = set(), set()
    for n in ast.walk(t):
        if isinstance(n, ast.Name):
            (bound if isinstance(n.ctx, (ast.Store, ast.Del)) else loaded).add(n.id)
        elif isinstance(n, ast.arg): bound.add(n.arg)
        elif isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)): bound.add(n.name)
        elif isinstance(n, (ast.Import, ast.ImportFrom)):
            for a in n.names: bound.add(a.asname or a.name.split('.')[0])
        elif isinstance(n, ast.ExceptHandler) and n.name: bound.add(n.name)
        elif isinstance(n, (ast.Global, ast.Nonlocal)): bound.update(n.names)
    free = sorted(loaded - bound - set(dir(builtins)))
    print(f"{Path(f).name}: {' '.join(free) or '—'}")
