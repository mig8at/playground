"""Pruebas del chequeo de nombres. No persiguen cobertura: cada una fija una lógica que ya dio, o
podía dar, un diagnóstico equivocado.

  * la vara del diccionario dejó pasar `aviso`, `leer` y `tema` como inglés (fase 1);
  * quitar un `-es` a ciegas convierte un plural español en inglés (`partes` → `part`);
  * un extractor que no devuelve nada da «todo en inglés» sin haber mirado;
  * la condición de cierre de la fase 4: un nombre español inventado a propósito, en cada lenguaje y
    en un nombre de archivo, tiene que hacer fallar el chequeo;
  * y la de la 4b: una clave JSON en español aceptada en UN lugar (la API de cuadrilla) no queda aceptada
    en otro, ni se vuelve una palabra permitida para los identificadores.
"""
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import naming  # noqa: E402

# Una vara chica y fija, para que las pruebas de la lógica no dependan de la versión de Go o Python.
BASE = {w: 100 for w in 'read task old file root error log class part plane load parse run dry'.split()}
BASE.update({'de': 1000, 'es': 1000, 'del': 1000})


class SplitTest(unittest.TestCase):
    def test_camel_snake_and_acronyms(self):
        self.assertEqual(naming.split_words('leerTareaVieja'), ['leer', 'tarea', 'vieja'])
        self.assertEqual(naming.split_words('HTTPServer'), ['http', 'server'])
        self.assertEqual(naming.split_words('dry_run'), ['dry', 'run'])
        self.assertEqual(naming.split_words('JIRA-TASK-TEMPLATE'), ['jira', 'task', 'template'])
        self.assertEqual(naming.split_words('phase1b'), ['phase', '1', 'b'])


class BaseFormsTest(unittest.TestCase):
    def test_spanish_plural_does_not_become_english(self):
        self.assertNotIn('part', set(naming.base_forms('partes')))

    def test_regular_english_forms(self):
        self.assertIn('class', set(naming.base_forms('classes')))
        self.assertIn('file', set(naming.base_forms('files')))
        self.assertIn('parse', set(naming.base_forms('parsed')))
        self.assertIn('run', set(naming.base_forms('running')))


class ForeignWordsTest(unittest.TestCase):
    def test_spanish_is_flagged_even_when_a_dictionary_would_accept_it(self):
        self.assertEqual(naming.foreign_words('leerTareaVieja', BASE, set()), ['leer', 'tarea', 'vieja'])
        self.assertEqual(naming.foreign_words('aviso', BASE, set()), ['aviso'])
        self.assertEqual(naming.foreign_words('tema', BASE, set()), ['tema'])

    def test_frequent_spanish_words_are_rejected_by_the_list(self):
        # `del` abunda en Python (es una palabra reservada) y aun así en un nombre es español
        self.assertEqual(naming.foreign_words('errorDelLog', BASE, set()), ['del'])

    def test_english_passes_with_its_regular_forms(self):
        self.assertEqual(naming.foreign_words('readOldFiles', BASE, set()), [])
        self.assertEqual(naming.foreign_words('partes', BASE, set()), ['partes'])

    def test_allowed_words_and_short_tokens(self):
        self.assertEqual(naming.foreign_words('tableroRoot', BASE, {'tablero'}), [])
        self.assertEqual(naming.foreign_words('id', BASE, set()), [])


class AllowFileTest(unittest.TestCase):
    def test_words_and_paths_with_reason(self):
        with tempfile.TemporaryDirectory() as d:
            f = Path(d, 'allow.txt')
            f.write_text('# comentario\njira jql\npath: src/tema.css   # compartido\n'
                         'json: server/cmd/cuadrilla/ rama autor   # la API de cuadrilla\n')
            words, paths = naming.load_allow(f)
            rules = naming.load_json_allow(f)
        self.assertEqual(words, {'jira', 'jql'}, 'una clave aceptada no puede volverse una palabra aceptada')
        self.assertEqual(paths, {'src/tema.css': 'compartido'})
        self.assertEqual(rules, [('server/cmd/cuadrilla/', '', {'rama', 'autor'})])

    def test_a_json_key_is_accepted_only_where_the_rule_says(self):
        rules = [('server/cmd/cuadrilla/', '', {'rama'}), ('server/cmd/today/main.go', 'areaCanon', {'objetivo'}),
                 ('server/cmd/branches/main.go', 'map', {'*'})]

        def allowed(rel, kind, ctx, key):
            return naming.json_allowed(rel, kind, ctx, key, rules)

        self.assertTrue(allowed('server/cmd/cuadrilla/main.go', 'tag', 'branch.Branch', 'rama'))
        self.assertFalse(allowed('server/cmd/today/main.go', 'tag', 'branchSnap.Branch', 'rama'))
        self.assertTrue(allowed('server/cmd/today/main.go', 'tag', 'areaCanon.Goal', 'objetivo'))
        self.assertFalse(allowed('server/cmd/today/main.go', 'tag', 'row.Goal', 'objetivo'))
        self.assertTrue(allowed('server/cmd/branches/main.go', 'map', '-', 'desde'))
        self.assertFalse(allowed('server/cmd/branches/main.go', 'tag', 'x.Y', 'desde'))


class EndToEndTest(unittest.TestCase):
    """Los extractores de verdad (Go, Vue/JS, Python, git) sobre un árbol inventado."""

    def board(self, files):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        root = Path(tmp.name)
        for rel, text in files.items():
            (root / rel).parent.mkdir(parents=True, exist_ok=True)
            (root / rel).write_text(text)
        subprocess.run(['git', 'init', '-q'], cwd=root, check=True)
        saved = (naming.BOARD, naming.GO_ROOTS, naming.JS_GLOBS, naming.PY_GLOBS)
        self.addCleanup(lambda: setattr_all(saved))
        naming.BOARD, naming.GO_ROOTS = root, ['server']
        naming.JS_GLOBS, naming.PY_GLOBS = ['src/*.js', 'src/*.vue'], ['tools/*.py']
        return root

    ENGLISH = {
        'server/x.go': 'package x\n\ntype task struct {\n\tTitle string `json:"title"`\n}\n\nfunc loadTask() {}\n',
        'src/a.js': 'const taskList = [];\nexport function readFile(path) { return path; }\n',
        'src/b.vue': '<script setup>\nconst title = 1;\n</script>\n<template><p v-for="item in [1]">{{ item }}</p></template>\n',
        'tools/c.py': 'def load(path):\n    return path\n',
    }

    def test_invented_spanish_names_fail_in_every_language(self):
        self.board({
            **self.ENGLISH,
            'server/y.go': 'package x\n\nfunc leerTarea() {}\n\ntype plan struct {\n\tNext string `json:"proximoPaso"`\n}\n',
            'src/c.js': 'const { fecha } = {};\n',
            'src/d.vue': '<template><p v-for="fila in [1]">{{ fila }}</p></template>\n',
            'tools/d.py': 'def cargar():\n    pass\n',
            'docs/notas.md': 'x\n',
        })
        findings, _ = naming.check(base=naming.baseline(), allow=(set(), {}), json_allow=[])
        found = {f['name'] for f in findings}
        self.assertTrue({'leerTarea', 'proximoPaso', 'fecha', 'fila', 'cargar', 'notas.md'} <= found, found)

    def test_an_english_tree_passes(self):
        self.board(self.ENGLISH)
        findings, counts = naming.check(base=naming.baseline(), allow=(set(), {}), json_allow=[])
        self.assertEqual(findings, [])
        self.assertTrue(all(n > 0 for n in counts.values()), counts)

    def test_an_empty_extractor_is_an_error_not_a_pass(self):
        files = dict(self.ENGLISH)
        del files['server/x.go']
        self.board(files)
        with self.assertRaises(SystemExit):
            naming.check(base=naming.baseline(), allow=(set(), {}), json_allow=[])


def setattr_all(saved):
    naming.BOARD, naming.GO_ROOTS, naming.JS_GLOBS, naming.PY_GLOBS = saved


if __name__ == '__main__':
    unittest.main()
