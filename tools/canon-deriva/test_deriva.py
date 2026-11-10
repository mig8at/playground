"""Las trampas de canon-deriva que ya dieron un resultado equivocado, probadas sin red."""
import os, sys, unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import deriva  # noqa: E402


class Ronda(unittest.TestCase):
    def test_un_archivo_movido_no_se_pierde(self):
        # la entrada sin hash nuevo era la que se descartaba en silencio
        text = ("  ronda: 2 de 10 archivos declarados cambiaron en main\n"
                "    credifamilia     legacy-backend:app/X.php  577bcef13c11 →\n"
                "    listado          legacy-backend:app/Y.php  227fcf0312ad → 36734268f49e\n")
        got = deriva.parse_ronda(text)
        self.assertEqual(len(got), 2)
        self.assertIsNone(got[0]["new"])
        self.assertEqual(got[1]["new"], "36734268f49e")

    def test_alias_completo(self):
        got = deriva.parse_ronda("    mobile    Creditop-SAS/creditop_mobile:app/a.dart  ed5a78b37018 → cab7f622a372\n")
        self.assertEqual(got[0]["alias"], "Creditop-SAS/creditop_mobile")
        self.assertEqual(got[0]["path"], "app/a.dart")


class Ancla(unittest.TestCase):
    def test_como_anchorof_de_canon(self):
        # el punto de root.hcl y los guiones bajos fueron los que inventaron secciones inexistentes
        self.assertEqual(deriva.anchor("Dev caía en la cuenta de producción, y el guardrail que lo cerró está en el root.hcl"),
                         "dev-caia-en-la-cuenta-de-produccion-y-el-guardrail-que-lo-cerro-esta-en-el-root-hcl")
        self.assertEqual(deriva.anchor("`category_rule_rejected`"), "category-rule-rejected")
        self.assertEqual(deriva.anchor("«Paz y salvo» con saldo"), "paz-y-salvo-con-saldo")


class NombreDeModulo(unittest.TestCase):
    def test_sólo_camelcase_real(self):
        self.assertTrue(deriva.MODULE_NAME.search("va al módulo MobileOnboardingV1 del monolito"))
        self.assertFalse(deriva.MODULE_NAME.search("los códigos SGV1 y CPV1 de los logs"))


if __name__ == "__main__":
    unittest.main()
