"""naming.py — ¿el código del tablero nombra algo en español?

Recorre lo que se ESCRIBE al invocar el tablero —los identificadores declarados en su Go, su Vue/JS y
su Python, y los nombres de archivo y carpeta— y sale 1 si alguno lleva una palabra que no es inglés.
Es la fase 4 del frente «el código en inglés» (tablero/data/tablero.md): una regla escrita envejece y
un chequeo no. Los comentarios, las tareas de `data/` y las claves JSON quedan afuera a propósito: los
primeros se leen para entender, y las claves son un contrato que tiene su propia tanda.

⚠ LA VARA DEL INGLÉS NO ES EL DICCIONARIO DEL SISTEMA. Se probó en la fase 1 y deja pasar `aviso`,
`leer`, `tema` o `antes`, porque trae inglés arcaico. La vara es el código de las bibliotecas estándar
de Go y de Python: una palabra que casi no aparece ahí es sospechosa. Dos listas la corrigen:
  * SPANISH, acá abajo: palabras españolas que SÍ abundan en esas bibliotecas (`de`, `es`, `fin`) y que
    igual se rechazan;
  * naming-allow.txt, al lado: palabras inglesas o nombres propios que casi no aparecen ahí y son
    legítimos, y las rutas que se aceptan en español con su motivo.

La tabla de frecuencias se arma la primera vez (unos segundos) y queda en `data/cache/`, que git ignora.

Uso:
  python3 tablero/tools/naming.py              # sale 1 si hay algún nombre que no es inglés
  python3 tablero/tools/naming.py --words      # sólo las palabras desconocidas, para curar la lista
  python3 tablero/tools/naming.py --json
"""
import argparse
import ast
import json
import os
import re
import subprocess
import sys
import sysconfig
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BOARD = ROOT / 'tablero'
ALLOW_FILE = Path(__file__).with_name('naming-allow.txt')
CACHE = BOARD / 'data' / 'cache' / 'naming-baseline.json'

# Una palabra que aparece menos que esto en las dos bibliotecas estándar juntas no cuenta como inglés.
THRESHOLD = 5

# Españolas que abundan en las bibliotecas estándar (locales, abreviaturas, otro idioma que coincide) y
# por eso la frecuencia no las frena. Sólo va acá lo que se MIDIÓ por encima del umbral: el resto ya lo
# rechaza la frecuencia. Ambiguas que se dejaron afuera a propósito: `el` (element en JS), `lo` (low),
# `si` (abreviatura), `todo`/`todos` (inglés), `real`, `total`, `final`, `base`, `actual`.
SPANISH = frozenset('''
    de del al con sin por para que una uno unos unas los las es en ya fin mal hay pero como cuando donde
    esta este esto solo sola nada cada desde hasta antes luego sobre entre tiene dia dias mes hora ver
'''.split())

# Lo que se recorre, relativo a tablero/.
GO_ROOTS = ['server', 'tools/rename/go']
JS_GLOBS = ['src/*.vue', 'src/*.js', 'tests/*.js', 'tools/rename/js/*.mjs']
PY_GLOBS = ['tools/*.py', 'tools/rename/py/*.py']
DECLS_GO = BOARD / 'tools' / 'rename' / 'go'
DECLS_JS = BOARD / 'tools' / 'rename' / 'js' / 'decls.mjs'

_WORD = re.compile(r'[A-Z]+(?=[A-Z][a-z])|[A-Z]?[a-z]+|[A-Z]+|[0-9]+')


def split_words(name):
    """`leerTareaVieja` → leer, tarea, vieja · `HTTPServer` → http, server · `dry_run` → dry, run."""
    return [w.lower() for part in re.split(r'[^A-Za-z0-9]+', name) for w in _WORD.findall(part)]


def base_forms(word):
    """La palabra y sus formas de base inglesas. Se cuida de NO convertir un plural español en inglés:
    `-es` sólo se quita tras s/x/z/ch/sh (`classes`, `matches`), así `partes` no pasa a ser `part`."""
    yield word
    if word.endswith('ies') and len(word) > 4:
        yield word[:-3] + 'y'
    if re.search(r'(s|x|z|ch|sh)es$', word):
        yield word[:-2]
    if word.endswith('s') and not word.endswith('ss') and len(word) > 3:
        yield word[:-1]
    for suffix in ('ed', 'ing', 'er', 'ers'):
        if word.endswith(suffix) and len(word) > len(suffix) + 2:
            stem = word[:-len(suffix)]
            yield stem
            yield stem + 'e'
            if stem[-1] == stem[-2]:
                yield stem[:-1]


def load_allow(path=ALLOW_FILE):
    """naming-allow.txt: una palabra por línea, o `path: <ruta relativa a tablero/>  # motivo`."""
    words, paths = set(), {}
    for raw in path.read_text().splitlines():
        line = raw.split('#', 1)[0].strip()
        reason = raw.split('#', 1)[1].strip() if '#' in raw else ''
        if not line:
            continue
        if line.startswith('path:'):
            paths[line[5:].strip()] = reason
        else:
            words.update(line.lower().split())
    return words, paths


def foreign_words(name, baseline, allowed):
    """Las palabras de `name` que no pasan como inglés."""
    out = []
    for word in split_words(name):
        if word.isdigit() or word in allowed:
            continue
        if word in SPANISH:
            out.append(word)
            continue
        if len(word) < 3:
            continue
        if not any(baseline.get(form, 0) >= THRESHOLD or form in allowed for form in base_forms(word)):
            out.append(word)
    return out


# ── la vara: frecuencias de las bibliotecas estándar ──────────────────────────────────────────────

def _versions():
    go = subprocess.run(['go', 'env', 'GOVERSION'], capture_output=True, text=True).stdout.strip()
    return f'{go} · python {sys.version.split()[0]}'


def _count_tree(root, suffix, counts):
    token = re.compile(r'[A-Za-z][A-Za-z0-9_]*')
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in ('site-packages', '__pycache__')]
        for filename in filenames:
            if not filename.endswith(suffix):
                continue
            try:
                text = Path(dirpath, filename).read_text(errors='ignore')
            except OSError:
                continue
            for tok in token.findall(text):
                for word in split_words(tok):
                    counts[word] = counts.get(word, 0) + 1


def baseline():
    versions = _versions()
    try:
        cached = json.loads(CACHE.read_text())
        if cached.get('versions') == versions:
            return cached['counts']
    except (OSError, ValueError, KeyError):
        pass
    counts = {}
    goroot = subprocess.run(['go', 'env', 'GOROOT'], capture_output=True, text=True, check=True).stdout.strip()
    _count_tree(Path(goroot) / 'src', '.go', counts)
    _count_tree(Path(sysconfig.get_paths()['stdlib']), '.py', counts)
    counts = {w: n for w, n in counts.items() if n >= THRESHOLD}
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    CACHE.write_text(json.dumps({'versions': versions, 'threshold': THRESHOLD, 'counts': counts}))
    return counts


# ── lo que se declara ─────────────────────────────────────────────────────────────────────────────

def go_decls():
    """(ruta, línea, nombre, clase) de cada identificador declarado en el Go del tablero."""
    out = []
    for root in GO_ROOTS:
        run = subprocess.run(['go', 'run', './cmd/decls', str(BOARD / root)], cwd=DECLS_GO,
                             capture_output=True, text=True)
        if run.returncode != 0:
            raise SystemExit(f'no pude listar las declaraciones de Go en {root}:\n{run.stderr}')
        for line in run.stdout.splitlines():
            where, name, kind = line.split('\t')
            path, lineno, _col = where.rsplit(':', 2)
            out.append((path, int(lineno), name, kind))
    return out


def js_decls(files):
    if not files:
        return []
    run = subprocess.run(['node', str(DECLS_JS), *map(str, files)], capture_output=True, text=True)
    if run.returncode != 0:
        raise SystemExit(f'no pude listar las declaraciones de Vue/JS:\n{run.stderr}')
    out = []
    for line in run.stdout.splitlines():
        path, lineno, name, kind = line.split('\t')
        out.append((path, int(lineno), name, kind))
    return out


def py_decls(files):
    out = []
    for f in files:
        tree = ast.parse(Path(f).read_text(), filename=str(f))
        for n in ast.walk(tree):
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                out.append((str(f), n.lineno, n.name, 'class' if isinstance(n, ast.ClassDef) else 'func'))
            elif isinstance(n, ast.arg):
                out.append((str(f), n.lineno, n.arg, 'param'))
            elif isinstance(n, ast.Name) and isinstance(n.ctx, ast.Store):
                out.append((str(f), n.lineno, n.id, 'var'))
            elif isinstance(n, ast.Attribute) and isinstance(n.ctx, ast.Store):
                out.append((str(f), n.lineno, n.attr, 'attr'))
            elif isinstance(n, ast.ExceptHandler) and n.name:
                out.append((str(f), n.lineno, n.name, 'var'))
            elif isinstance(n, (ast.Import, ast.ImportFrom)):
                for alias in n.names:
                    if alias.asname:
                        out.append((str(f), n.lineno, alias.asname, 'import'))
    return out


def tracked_paths():
    """Archivos del tablero que git sigue o sigue-si-los-agregás (los nuevos cuentan antes del commit)."""
    run = subprocess.run(['git', 'ls-files', '--cached', '--others', '--exclude-standard', '--', '.'],
                         cwd=BOARD, capture_output=True, text=True, check=True)
    return [p for p in run.stdout.splitlines() if p and os.path.exists(BOARD / p)]


def path_names(paths):
    """(ruta, nombre) de cada carpeta y archivo a revisar. Dentro de `data/` sólo las carpetas: los
    archivos de ahí son contenido (el slug de una tarea es su título, y está en español)."""
    seen = set()
    for rel in paths:
        parts = rel.split('/')
        names = parts[:-1] if parts[0] == 'data' else parts
        for i, part in enumerate(names):
            key = '/'.join(parts[:i + 1])
            if key in seen:
                continue
            seen.add(key)
            # un archivo pierde sólo su última extensión: `tarea.v1.schema.json` → tarea, v1, schema
            stem = part.rsplit('.', 1)[0] if i == len(parts) - 1 and '.' in part[1:] else part
            yield key, stem


# ── el chequeo ────────────────────────────────────────────────────────────────────────────────────

def check(base=None, allow=None):
    base = baseline() if base is None else base
    words, allowed_paths = load_allow() if allow is None else allow
    js_files = sorted({p for g in JS_GLOBS for p in BOARD.glob(g)})
    py_files = sorted({p for g in PY_GLOBS for p in BOARD.glob(g)})
    sources = {'go': go_decls(), 'vue/js': js_decls(js_files), 'python': py_decls(py_files)}
    paths = list(path_names(tracked_paths()))
    counts = {**{k: len(v) for k, v in sources.items()}, 'rutas': len(paths)}
    # Un extractor que no devuelve nada daría «todo en inglés» sin haber mirado: se trata como error.
    empty = [k for k, n in counts.items() if n == 0]
    if empty:
        raise SystemExit(f'✗ no se leyó ningún nombre de: {", ".join(empty)} — el chequeo no miró nada ahí')
    findings = []
    for path, lineno, name, kind in [d for decls in sources.values() for d in decls]:
        bad = foreign_words(name, base, words)
        if bad:
            findings.append({'where': f'{os.path.relpath(path, BOARD)}:{lineno}', 'name': name, 'kind': kind,
                             'words': bad})
    for rel, stem in paths:
        if rel in allowed_paths:
            continue
        bad = foreign_words(stem, base, words)
        if bad:
            findings.append({'where': rel, 'name': os.path.basename(rel), 'kind': 'path', 'words': bad})
    return findings, counts


def main(argv=None):
    parser = argparse.ArgumentParser(description='¿el código del tablero nombra algo en español?')
    parser.add_argument('--words', action='store_true', help='sólo las palabras desconocidas y cuántos nombres las usan')
    parser.add_argument('--json', action='store_true')
    args = parser.parse_args(argv)
    findings, counts = check()
    seen = ' · '.join(f'{n} {k}' for k, n in counts.items())
    if args.json:
        print(json.dumps(findings, ensure_ascii=False, indent=2))
    elif args.words:
        by_word = {}
        for f in findings:
            for w in f['words']:
                by_word.setdefault(w, []).append(f['name'])
        for w, names in sorted(by_word.items(), key=lambda kv: (-len(kv[1]), kv[0])):
            print(f'{w:22} {len(names):3}  {", ".join(sorted(set(names))[:6])}')
    else:
        if not findings:
            print(f'  ✓ nombres del tablero: todos en inglés ({seen})')
        else:
            print(f'  ✗ {len(findings)} nombre(s) con palabras que no son inglés, de {seen}:\n')
            for f in findings:
                print(f"    {f['where']:52} {f['name']:34} {', '.join(f['words'])}")
            print('\n  Si la palabra es inglés o un nombre propio, va a tablero/tools/naming-allow.txt.'
                  '\n  Si es español, se renombra (tablero/tools/rename/ tiene los renombradores).')
    return 1 if findings else 0


if __name__ == '__main__':
    sys.exit(main())
