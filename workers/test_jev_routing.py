import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch


WORKERS = Path(__file__).resolve().parent
sys.path.insert(0, str(WORKERS))

import plan
import seleccion


class JevWorkerTests(unittest.TestCase):
    def test_jev_is_off_by_default(self):
        with patch.dict(os.environ, {}, clear=True), \
                patch.object(plan.context_jev, "route", side_effect=AssertionError):
            self.assertIsNone(plan._ruteo_jev("pregunta general"))

    def test_abstention_restores_the_complete_map(self):
        row = {"jev": {}, "decision": {"action": "fallback", "node": None}}
        with patch.dict(os.environ, {"CONTEXT_JEV": "1"}, clear=True), \
                patch.object(plan.context_jev, "catalog", return_value={"n": {}}), \
                patch.object(plan.context_jev, "route", return_value=row):
            self.assertIsNone(plan._ruteo_jev("pregunta ambigua"))

    def test_strong_route_builds_a_small_surface(self):
        nodes = {
            "onboarding": {"name": "Registro", "when": "OTP inicial", "symptoms": ["no llega"],
                           "parent": "creditop"},
            "formalization": {"name": "Firma", "when": "OTP final", "symptoms": ["no firma"],
                              "parent": "creditop"},
        }
        row = {
            "jev": {"probabilities": {"onboarding": .92, "formalization": .08, "ninguno": 0},
                    "needs_case_data": .1, "usage": {"input_tokens": 321}},
            "decision": {"action": "suggest", "node": "onboarding"},
            "baseline": [{"node": "onboarding", "score": 2}],
            "candidate_mode": "shortlist", "ms": 500,
        }
        with patch.dict(os.environ, {"CONTEXT_JEV": "1"}, clear=True), \
                patch.object(plan.context_jev, "catalog", return_value=nodes), \
                patch.object(plan.context_jev, "route", return_value=row):
            routing = plan._ruteo_jev("no llega el OTP")
        self.assertEqual([n["id"] for n in routing["nodes"]], ["onboarding", "formalization"])
        self.assertEqual(routing["jev_input_tokens"], 321)

        with patch.object(plan, "_ruteo_jev", return_value=routing):
            compact, used = plan._superficie("no llega el OTP")
        with patch.object(plan, "_ruteo_jev", return_value=None):
            complete, unused = plan._superficie("no llega el OTP")
        self.assertIs(used, routing)
        self.assertIsNone(unused)
        self.assertIn("onboarding", compact)
        self.assertLess(len(compact), len(complete))

    def test_selection_reuses_only_a_matching_plan(self):
        data = {
            "pregunta": "¿no llega el OTP?",
            "terminos": [{"dice": "código", "en_el_codigo": "otp"}],
            "jev_routing": {"nodes": [{"id": "onboarding"}]},
        }
        tools, instructions, nodes = seleccion._aplicar_plan(data["pregunta"], data, "base")
        self.assertIn("mapa_de_rutas", tools)
        self.assertIn("onboarding", instructions)
        self.assertIn("NO llames `mapa_de_rutas` de entrada", instructions)
        self.assertEqual(nodes, ["onboarding"])

        tools, instructions, nodes = seleccion._aplicar_plan("otra pregunta", data, "base")
        self.assertIn("mapa_de_rutas", tools)
        self.assertEqual((instructions, nodes), ("base", []))


if __name__ == "__main__":
    unittest.main()
