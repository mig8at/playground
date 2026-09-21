"""El triaje: la guarda aritmética, que no pise el sello y que no finja trabajo nuevo.

Lo que se prueba es lo que haría daño en silencio. Un triaje escrito sobre un cambio que SÍ toca lo
citado deja un nodo mintiendo y marcado como mirado; y un `triado` que pisara `verified` movería el
punto de partida del próximo diff, que es lo único irreversible de todo esto.
"""
import io
import json
import os
import tempfile
import unittest
from unittest.mock import patch

import diff as D
import triar


class Triaje(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.nodo = os.path.join(self.tmp.name, "n")
        os.makedirs(self.nodo)
        self.mp = os.path.join(self.nodo, "map.json")
        # El orden de claves importa: el map.json lo lee una persona, y `triado` va al lado de
        # `verified` porque sólo se entiende en contraste con él.
        json.dump({"name": "N", "when": "cuando sea",
                   "verified": {"ref": "main", "date": "2026-09-01", "source": "manual"},
                   "sintomas": ["algo"], "files": ["alias/x.php"]}, open(self.mp, "w"), indent=2)
        self.datos = {"sello": "2026-09-01", "ref": "main", "archivos": ["alias/x.php"],
                      "tocados": {"x.php": [(10, 12)]}, "shas": {"alias": "abc123456"},
                      "procedencia": ["  alias  main  al día"]}
        self.addCleanup(self.tmp.cleanup)

    def correr(self, dentro, argv):
        with patch.object(D, "FLOWS", self.tmp.name), \
             patch.object(D, "recolectar", return_value=self.datos), \
             patch.object(D, "mapa_de_citas", return_value=dentro), \
             patch("sys.stdout", new_callable=io.StringIO):
            return triar.main(argv)

    def test_no_tria_si_el_cambio_toco_una_cita(self):
        self.assertEqual(self.correr(2, ["n", "--veredicto", "refactor"]), 1)
        self.assertNotIn("triado", json.load(open(self.mp)))

    def test_tria_y_deja_el_sello_intacto_y_en_su_lugar(self):
        antes = json.load(open(self.mp))
        self.assertEqual(self.correr(0, ["n", "--veredicto", "refactor de la UI"]), 0)
        d = json.load(open(self.mp))
        self.assertEqual(d["verified"], antes["verified"])          # el sello NO se mueve: es el punto
        self.assertEqual(list(d)[:3], ["name", "when", "verified"])  # de partida del próximo diff
        self.assertEqual(list(d)[3], "triado")
        self.assertEqual(d["triado"]["shas"], {"alias": "abc123456"})
        self.assertEqual(d["triado"]["veredicto"], "refactor de la UI")
        self.assertEqual(d["triado"]["source"], "manual")
        self.assertEqual(d["sintomas"], antes["sintomas"])           # nada más se toca

    def test_source_dice_quien_lo_dijo(self):
        self.correr(0, ["n", "--veredicto", "x", "--source", "jev-1.13"])
        self.assertEqual(json.load(open(self.mp))["triado"]["source"], "jev-1.13")

    def test_retriar_el_mismo_commit_no_finge_trabajo_nuevo(self):
        self.correr(0, ["n", "--veredicto", "primera"])
        primero = json.load(open(self.mp))["triado"]
        self.assertEqual(self.correr(0, ["n", "--veredicto", "segunda"]), 0)
        self.assertEqual(json.load(open(self.mp))["triado"]["veredicto"], "primera")

    def test_un_veredicto_vacio_no_pasa(self):
        # Sin veredicto el campo no dice nada, y alguien lo va a leer para decidir si confiar.
        self.assertEqual(self.correr(0, ["n", "--veredicto", "   "]), 2)
        self.assertEqual(self.correr(0, ["n", "--veredicto", "--source"]), 2)


if __name__ == "__main__":
    unittest.main()
