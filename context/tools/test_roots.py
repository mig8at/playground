"""`es_local`: qué alias es una herramienta de este repo y cuál es un repo de la compañía.

Se prueba porque decide si un cambio cuenta como deriva, y los dos errores posibles son mudos: tratar
un repo de la compañía como local lo saca del ranking (un nodo queda viejo y nadie lo ve), y tratar un
alias desconocido como local hace lo mismo con cualquier ruta mal escrita.
"""
import os
import unittest
from unittest.mock import patch

import roots


class EsLocal(unittest.TestCase):
    def test_distingue_por_la_ruta_y_no_por_una_lista(self):
        self.assertTrue(roots.es_local("harness"))
        self.assertTrue(roots.es_local("trazador"))
        self.assertFalse(roots.es_local("legacy-backend"))
        self.assertFalse(roots.es_local("frontend-monorepo"))

    def test_un_alias_desconocido_no_es_local(self):
        # `os.path.abspath("")` devuelve el directorio ACTUAL, que corriendo desde acá está dentro del
        # playground: la primera versión daba True para cualquier alias inexistente, así que un alias
        # mal escrito desaparecía del ranking sin que nada lo dijera.
        for alias in ("zzz", "", "harnes", None):
            self.assertFalse(roots.es_local(alias), alias)

    def test_una_herramienta_nueva_no_necesita_tocar_nada(self):
        # La condición es la ruta, así que agregar un root dentro del playground alcanza. Si esto
        # fuera una lista a mano, la herramienta nueva ensuciaría el ranking hasta que alguien la
        # agregara — y nadie se entera de que hay que hacerlo.
        with patch.dict(roots.ROOTS, {"nueva": os.path.join(roots.PLAYGROUND, "nueva")}):
            self.assertTrue(roots.es_local("nueva"))
        with patch.dict(roots.ROOTS, {"ajena": "/tmp/otro-repo"}):
            self.assertFalse(roots.es_local("ajena"))

    def test_un_prefijo_parecido_no_cuenta_como_dentro(self):
        # `/…/playground-viejo` empieza con la misma cadena que `/…/playground` pero no está adentro.
        with patch.dict(roots.ROOTS, {"vecino": roots.PLAYGROUND + "-viejo"}):
            self.assertFalse(roots.es_local("vecino"))


if __name__ == "__main__":
    unittest.main()
