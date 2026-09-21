"""Las tres piezas del mapa de citas ∩ diff: parseo de hunks, cruce de rutas y clasificación.

Se prueban porque las tres YA dieron un diagnóstico equivocado mientras se escribían, y las tres
fallan hacia el lado caro —decir «no hay nada que leer» sobre un nodo que sí quedó mintiendo.
"""
import unittest

import diff


class MapaDeCitas(unittest.TestCase):
    DIFF = """diff --git a/app/Http/X.php b/app/Http/X.php
--- a/app/Http/X.php
+++ b/app/Http/X.php
@@ -354,2 +354,3 @@
@@ -600 +601 @@
diff --git a/app/Nuevo.php b/app/Nuevo.php
--- /dev/null
+++ b/app/Nuevo.php
@@ -0,0 +1,20 @@
diff --git a/app/Solo.php b/app/Solo.php
--- a/app/Solo.php
+++ b/app/Solo.php
@@ -40,0 +41,7 @@
"""

    def test_hunks_el_lado_viejo_y_las_inserciones_puras(self):
        h = diff.parsear_hunks(self.DIFF)
        # `-354,2` son las líneas 354-355 del SELLO; `-600` sin coma es una sola.
        self.assertEqual(h["app/Http/X.php"], [(354, 355), (600, 600)])
        # Una inserción pura (`-40,0`) NO reescribió nada: el archivo está, con la lista vacía. Si
        # entrara como rango, agregar una función arriba marcaría «el nodo miente» sobre citas intactas.
        self.assertEqual(h["app/Solo.php"], [])
        # Un archivo nuevo no tiene lado viejo, así que ninguna cita puede caer adentro.
        self.assertNotIn("app/Nuevo.php", h)

    def test_cruce_por_sufijo_entre_el_alias_y_la_raiz_del_repo(self):
        declarados = ["application/app/Http/X.php", "application/app/Solo.php", "harness/pkg/db.ts"]
        cruce = diff.rangos_por_declarado(diff.parsear_hunks(self.DIFF), declarados)
        # El declarado lleva el alias y el diff no: sin el sufijo, esto daba vacío y el mapa decía
        # «ninguna cita cayó dentro» para todo repo cuyo alias no sea su directorio.
        self.assertEqual(cruce["application/app/Http/X.php"], [(354, 355), (600, 600)])
        self.assertEqual(cruce["application/app/Solo.php"], [])
        self.assertNotIn("harness/pkg/db.ts", cruce)   # no cambió: no aparece

    def test_clasificacion_incluida_la_cita_posterior_al_sello(self):
        cambiados = {"a/x.php": [(354, 355)], "a/y.php": []}
        citas = [("a/x.php", 354, 10, "2026-08-01"),    # dentro
                 ("a/x.php", 900, 11, "2026-08-01"),    # el archivo cambió, pero en otra parte
                 ("a/y.php", 12, 12, "2026-08-01"),     # sólo inserciones: nada reescrito
                 ("a/z.php", 5, 13, "2026-08-01"),      # el archivo ni cambió
                 ("a/x.php", 354, 14, "2026-09-30")]    # escrita DESPUÉS del sello
        dentro, fuera, posteriores = diff.clasificar_citas(citas, cambiados, "2026-09-01")
        self.assertEqual(dentro, [("a/x.php", 354, 10)])
        self.assertEqual(fuera, 2)          # la de otra parte y la del archivo con sólo inserciones
        self.assertEqual(len(posteriores), 1)
        # Sin sello no hay contra qué comparar una fecha, y la cita se clasifica igual que las demás.
        self.assertEqual(len(diff.clasificar_citas(citas, cambiados, None)[0]), 2)


if __name__ == "__main__":
    unittest.main()
