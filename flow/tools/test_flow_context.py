import sys
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import flow_context


class FlowContextTest(unittest.TestCase):
    def test_catalog_sources_exist(self):
        self.assertTrue(flow_context.validate_catalog()['valid'])

    def test_route_prefers_branch_gate(self):
        result = flow_context.route('¿Por qué una regla de score dejó la entidad abajo?')
        self.assertEqual(result['recommended'][0]['id'], 'branch-gate')

    def test_route_rejects_case_identifier(self):
        with self.assertRaises(ValueError):
            flow_context.route('revisa la cédula 1032456789')

    def test_brief_is_bounded(self):
        result = flow_context.brief('amount')
        self.assertEqual(result['topic'], 'amount')
        self.assertLessEqual(len(result['rules']), 3)


if __name__ == '__main__':
    unittest.main()
