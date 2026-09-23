"""ren.py -map <mapa.tsv> [-w] <archivos.py…> — renombra identificadores de Python sin tocar el contrato.

Se renombra, en cada archivo:
  * los nombres (Name), parámetros (arg), def/class, `global`/`nonlocal`;
  * `modulo.nombre` cuando `modulo` es uno de los archivos que se pasan (los tests llaman así);
  * `from modulo import nombre` de esos mismos módulos;
  * el keyword de una llamada `f(nombre=…)` sólo si `f` es una función definida en los archivos que se
    pasan y ese keyword es uno de sus parámetros — el de `subprocess.run(text=…)` es de otro.
NO se tocan: atributos de otros objetos, claves de dict, strings (el JSON y las banderas de la CLI
viven ahí) ni nada importado de un módulo que no está en la lista.

Se rechaza, sin escribir nada, si el nombre nuevo ya aparece en el archivo, es un builtin, o si dos
nombres viejos distintos van al mismo nuevo en el mismo archivo. Todas las apariciones del mismo nombre
viejo van al mismo nuevo, así que el sombreado que ya existía queda igual.
"""
import ast
import builtins
import sys
from pathlib import Path


def load_map(path):
    renames = {}
    for line in Path(path).read_text().splitlines():
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        old, new = line.split()
        renames[old] = new
    return renames


def def_name_offset(src_lines, node):
    """Columna del nombre en `def x(` / `class X` (ast sólo da la del `def`)."""
    line = src_lines[node.lineno - 1]
    kw = 'class ' if isinstance(node, ast.ClassDef) else 'def '
    i = line.index(kw, node.col_offset) + len(kw)
    while line[i] == ' ':
        i += 1
    return node.lineno, i


def main(argv):
    write = '-w' in argv
    renames = load_map(argv[argv.index('-map') + 1])
    files = [a for i, a in enumerate(argv) if a not in ('-w', '-map') and argv[i - 1] != '-map']
    modules = {Path(f).stem for f in files}
    trees = {f: ast.parse(Path(f).read_text()) for f in files}

    # funciones propias → sus parámetros (para los keywords de las llamadas)
    params_of = {}
    for tree in trees.values():
        for n in ast.walk(tree):
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)):
                a = n.args
                params_of.setdefault(n.name, set()).update(x.arg for x in a.args + a.kwonlyargs + a.posonlyargs)

    bad = 0
    total = 0
    pending = {}  # archivo → bytes nuevos; se escribe al final y sólo si no hubo ningún conflicto
    for f in files:
        src = Path(f).read_text()
        lines = src.splitlines(keepends=True)
        tree = trees[f]
        hits = []  # (línea, col, viejo)
        present = set()

        def mark(lineno, col, name):
            hits.append((lineno, col, name))

        for n in ast.walk(tree):
            if isinstance(n, ast.Name):
                present.add(n.id)
                mark(n.lineno, n.col_offset, n.id)
            elif isinstance(n, ast.arg):
                present.add(n.arg)
                mark(n.lineno, n.col_offset, n.arg)
            elif isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                present.add(n.name)
                mark(*def_name_offset([l.rstrip('\n') for l in lines], n), n.name)
            elif isinstance(n, ast.Attribute) and isinstance(n.value, ast.Name) and n.value.id in modules:
                present.add(n.attr)
                mark(n.end_lineno, n.end_col_offset - len(n.attr), n.attr)
            elif isinstance(n, ast.ImportFrom) and n.module in modules:
                for alias in n.names:
                    present.add(alias.name)
                    mark(alias.lineno, alias.col_offset, alias.name)
                    if alias.asname:
                        present.add(alias.asname)
            elif isinstance(n, ast.Import):
                for alias in n.names:
                    present.add(alias.asname or alias.name.split('.')[0])
            elif isinstance(n, ast.ImportFrom):
                for alias in n.names:
                    present.add(alias.asname or alias.name)
            elif isinstance(n, ast.Call):
                fname = n.func.id if isinstance(n.func, ast.Name) else n.func.attr if isinstance(n.func, ast.Attribute) else None
                for kw in n.keywords:
                    if kw.arg and fname in params_of and kw.arg in params_of[fname]:
                        mark(kw.lineno, kw.col_offset, kw.arg)
            elif isinstance(n, (ast.Global, ast.Nonlocal)):
                line = lines[n.lineno - 1]
                for name in n.names:
                    col = line.index(name, n.col_offset)
                    mark(n.lineno, col, name)

        # un nombre que en ESTE archivo es un módulo importado (`import ramas`) no se toca acá, aunque
        # el mismo nombre sea una variable que se renombra en otro archivo
        imported_modules = {a.asname or a.name.split('.')[0] for n in ast.walk(tree) if isinstance(n, ast.Import) for a in n.names}
        active = {}
        seen_new = {}
        for old, new in renames.items():
            if old not in {h[2] for h in hits} or old in imported_modules:
                continue
            if new in present and new not in renames:
                print(f'CONFLICTO {f}: {old}→{new}, {new} ya existe en el archivo'); bad += 1; continue
            if hasattr(builtins, new):
                print(f'CONFLICTO {f}: {old}→{new} es un builtin'); bad += 1; continue
            if new in seen_new:
                print(f'CONFLICTO {f}: {seen_new[new]} y {old} → {new}'); bad += 1; continue
            seen_new[new] = old
            active[old] = new

        # offsets absolutos por línea (col_offset de ast es en BYTES utf-8)
        starts = [0]
        for l in lines:
            starts.append(starts[-1] + len(l.encode()))
        data = src.encode()
        edits = {}
        for lineno, col, name in hits:
            if name not in active:
                continue
            off = starts[lineno - 1] + col
            if data[off:off + len(name.encode())] != name.encode():
                raise SystemExit(f'desfase {f}:{lineno}:{col}: esperaba {name!r}, hay {data[off:off+20]!r}')
            edits[off] = (name, active[name])
        for off in sorted(edits, reverse=True):
            old, new = edits[off]
            data = data[:off] + new.encode() + data[off + len(old.encode()):]
        total += len(edits)
        print(f'{f}: {len(active)} nombres, {len(edits)} ediciones')
        if edits:
            ast.parse(data.decode())  # tiene que seguir parseando
            pending[f] = data
    if write and not bad:
        for f, data in pending.items():
            Path(f).write_bytes(data)
    print(f'ediciones {total} · conflictos {bad} · escrito={write and not bad}')
    return 3 if bad else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
