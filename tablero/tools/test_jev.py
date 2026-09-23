import copy
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import jev


class TableroJevTests(unittest.TestCase):
    def setUp(self):
        self.state = {
            'title': 'Corregir la compilación',
            'stage': 'work',
            'days_without_touch': 1,
            'next_step': 'Corregir la dependencia local y correr la suite.',
            'overdue_questions': 0,
            'open_pending': 2,
            'missing_pieces': [],
        }
        self.body = jev.request_body(self.state)
        self.response = {
            'model': jev.MODEL,
            'answers': {
                'next_action': {
                    'type': 'choice',
                    'choice': 'desbloquear',
                    'confidence': .9,
                    'probabilities': {
                        'ejecutar': .02,
                        'desbloquear': .93,
                        'pedir-respuesta': .01,
                        'decidir': .02,
                        'archivar-o-replantear': .02,
                    },
                },
                'external_blocker': {'type': 'noul', 'noul': .05},
                'operational_urgency': {
                    'type': 'score',
                    'score': 1.8,
                    'confidence': .72,
                    'legend': {str(i): level for i, level in enumerate(jev.URGENCY)},
                    'probabilities': {'0': 0, '1': .2, '2': .8, '3': 0},
                },
            },
            'usage': {'input_tokens': 120, 'output_tokens': 30},
        }

    def test_mixed_response_contract_and_gate(self):
        answer = jev.validate(self.response, self.body)
        self.assertEqual(answer['operational_urgency'], 1.8)
        self.assertEqual(jev.decide(answer), {'action': 'suggest', 'suggestion': 'desbloquear'})
        answer['action_confidence'] = .2
        self.assertEqual(jev.decide(answer), {'action': 'review', 'suggestion': None})

    def test_invalid_mixed_answers_are_rejected(self):
        mutations = [
            lambda row: row.update(model='jev-latest'),
            lambda row: row['answers']['next_action'].update(choice='otro'),
            lambda row: row['answers']['external_blocker'].update(noul=2),
            lambda row: row['answers']['operational_urgency'].update(score=3.2),
            lambda row: row['answers']['operational_urgency']['probabilities'].update({'2': .1}),
            lambda row: row['answers']['operational_urgency'].update(legend={}),
            lambda row: row['usage'].update(input_tokens=-1),
        ]
        for mutate in mutations:
            response = copy.deepcopy(self.response)
            mutate(response)
            with self.subTest(response=response), self.assertRaises(jev.JevError):
                jev.validate(response, self.body)

    def test_preview_never_reads_token_or_network(self):
        with patch.object(jev, 'token_from', side_effect=AssertionError), patch.object(jev, 'ask', side_effect=AssertionError):
            row = jev.evaluate(self.state)
        self.assertEqual(row['mode'], 'preview')
        self.assertNotIn('jev', row)

    def test_real_task_live_requires_explicit_internal_flag(self):
        with patch.object(jev, 'load_task', return_value={'title': 'x'}), self.assertRaisesRegex(jev.JevError, 'allow-internal'):
            jev.main(['triage', '89', '--live'])

    def test_task_payload_is_minimized_and_secret_guarded(self):
        task = {
            'id': 89,
            'slug': 'private-slug',
            'title': 'Evaluar el router',
            'stage': 'evaluation',
            'daysUntouched': 2,
            'resume': 'CUERPO PRIVADO',
            'nextStep': 'Correr la batería sintética.',
            'overdueQuestions': [{'what': 'texto privado'}],
            'pending': [{'what': 'otro texto privado'}],
            'missing': ['próximo paso'],
            'branches': ['private-branch'],
        }
        state = jev.state_from_task(task)
        encoded = json.dumps(state)
        for hidden in ('private-slug', 'CUERPO PRIVADO', 'texto privado', 'private-branch'):
            self.assertNotIn(hidden, encoded)
        self.assertEqual((state['overdue_questions'], state['open_pending']), (1, 1))
        task['nextStep'] = 'token=secret-value'
        with self.assertRaisesRegex(jev.JevError, 'secreto'):
            jev.state_from_task(task)

    def test_metrics_keep_wrong_suggestions_visible(self):
        answer = jev.validate(self.response, self.body)
        row = {
            'expected': {'action': 'ejecutar', 'external_blocker': False, 'urgency': 2},
            'jev': answer,
            'decision': jev.decide(answer),
            'ms': 10,
        }
        result = jev.metrics([row])
        self.assertEqual(result['wrong_action_suggestions'], 1)
        self.assertEqual(result['external_blocker_correct'], 1)
        self.assertEqual(result['urgency_rounded_correct'], 1)

    def test_cli_preview_saves_private_report(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(jev, 'RUNS', Path(directory)), \
                patch.object(jev, 'load_task', return_value={
                    'title': 'Tarea', 'stage': 'work', 'daysUntouched': 0,
                    'nextStep': 'Ejecutar prueba', 'overdueQuestions': [],
                    'pending': [], 'missing': [],
                }), patch('sys.stdout', new_callable=io.StringIO):
            self.assertEqual(jev.main(['triage', '89']), 0)
            reports = list(Path(directory).glob('*.json'))
            self.assertEqual(len(reports), 1)
            self.assertEqual(reports[0].stat().st_mode & 0o777, 0o600)

    def test_label_and_stats_only_use_real_triage_reports(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(jev, 'RUNS', Path(directory)), \
                patch.object(jev, 'load_task', return_value={
                    'title': 'Tarea', 'stage': 'work', 'daysUntouched': 0,
                    'nextStep': 'Ejecutar prueba', 'overdueQuestions': [],
                    'pending': [], 'missing': [],
                }), patch('sys.stdout', new_callable=io.StringIO):
            self.assertEqual(jev.main(['triage', '89']), 0)
            report = next(Path(directory).glob('*.json'))
            self.assertEqual(jev.main(['label', str(report), '--action', 'ejecutar',
                                       '--external-blocker', 'false', '--urgency', '1']), 0)
            row = json.loads(report.read_text())['results'][0]
            self.assertEqual(row['expected'], {
                'action': 'ejecutar', 'external_blocker': False, 'urgency': 1,
            })
            self.assertEqual(jev.main(['stats']), 0)
            self.assertEqual(report.stat().st_mode & 0o777, 0o600)


if __name__ == '__main__':
    unittest.main()
