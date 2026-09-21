import copy
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import urllib.error

import jev


class JevTests(unittest.TestCase):
    def setUp(self):
        self.nodes = {'onboarding': {'name': 'Registro', 'when': 'OTP de registro antes del listado', 'symptoms': ['no llega el código']},
                      'formalization': {'name': 'Firma', 'when': 'OTP de firma después del listado', 'symptoms': []}}
        self.body = jev.request_body('no llega el OTP de registro', self.nodes)
        self.response = {'model': jev.MODEL, 'answers': {
            'node': {'type': 'choice', 'choice': 'onboarding', 'probabilities': {'onboarding': .9, 'formalization': .07, 'ninguno': .03}, 'confidence': .8},
            'needs_case_data': {'type': 'noul', 'noul': .1}}, 'usage': {'input_tokens': 30, 'output_tokens': 20}}

    def test_catalog_uses_registered_metadata_only(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / 'tree.json').write_text(json.dumps({'combinations': [{'id': 'onboarding'}]}))
            folder = root / 'server/data/flows/onboarding'
            folder.mkdir(parents=True)
            (folder / 'map.json').write_text(json.dumps({'name': 'Registro', 'when': 'OTP', 'sintomas': [], 'files': ['SECRET-FILE']}))
            (folder / 'doc.md').write_text('SECRET-DOCUMENT')
            result = jev.catalog(root)
            self.assertNotIn('SECRET', json.dumps(jev.request_body('otp', result)))
            (root / 'tree.json').write_text(json.dumps({'combinations': [{'id': '../escape'}]}))
            with self.assertRaises(jev.JevError):
                jev.catalog(root)

    def test_valid_answer_and_gate(self):
        result = jev.validate(self.response, self.body)
        self.assertEqual(jev.decide(result), {'action': 'suggest', 'node': 'onboarding'})
        result['confidence'] = .1
        self.assertEqual(jev.decide(result)['action'], 'fallback')

    def test_none_and_close_options_abstain(self):
        result = jev.validate(self.response, self.body)
        result['choice'] = 'ninguno'
        result['probabilities'] = {'onboarding': .01, 'formalization': .01, 'ninguno': .98}
        self.assertEqual(jev.decide(result)['action'], 'fallback')
        result.update(choice='onboarding', probabilities={'onboarding': .5, 'formalization': .49, 'ninguno': .01})
        self.assertEqual(jev.decide(result)['action'], 'fallback')

    def test_invalid_contracts(self):
        mutations = [lambda r: r.update(model='different'),
                     lambda r: r['answers']['node'].update(choice='../../outside'),
                     lambda r: r['answers']['node'].update(confidence=float('nan')),
                     lambda r: r['answers']['node'].update(confidence=True),
                     lambda r: r['answers']['node']['probabilities'].update(onboarding=.2),
                     lambda r: r['answers']['node'].update(choice='formalization'),
                     lambda r: r['answers']['needs_case_data'].update(noul=1.1),
                     lambda r: r['answers'].update(unexpected={}),
                     lambda r: r['usage'].update(input_tokens=-1)]
        for mutate in mutations:
            r = copy.deepcopy(self.response)
            mutate(r)
            with self.subTest(response=r), self.assertRaises(jev.JevError):
                jev.validate(r, self.body)

    def test_offline_never_reads_credentials_or_network(self):
        with patch.object(jev, 'token_from', side_effect=AssertionError), patch.object(jev, 'ask', side_effect=AssertionError):
            row = jev.route('OTP de registro', self.nodes)
        self.assertEqual(row['baseline'][0]['node'], 'onboarding')
        self.assertEqual(row['mode'], 'offline')

    def test_shortlist_keeps_nearby_nodes_and_bounds_the_payload(self):
        nodes = {
            'creditop': {'name': 'CreditOp', 'when': 'visión general', 'symptoms': [], 'parent': None},
            'onboarding': {'name': 'Registro', 'when': 'OTP de registro', 'symptoms': ['celular'], 'parent': 'creditop'},
            'profile': {'name': 'Perfil', 'when': 'datos personales', 'symptoms': [], 'parent': 'onboarding'},
            'formalization': {'name': 'Firma', 'when': 'OTP de firma', 'symptoms': [], 'parent': 'creditop'},
        }
        candidates = jev.shortlist('falló el OTP de registro del celular', nodes)
        self.assertIn('onboarding', candidates)
        self.assertIn('creditop', candidates)
        self.assertIn('profile', candidates)
        self.assertLessEqual(len(candidates), jev.MAX_CANDIDATES)

    def test_live_route_sends_only_the_shortlist(self):
        captured = {}

        def answer(body, token):
            captured['criteria'] = set(body['questions']['node']['criteria'])
            probabilities = {node: 0 for node in captured['criteria']}
            probabilities['onboarding'] = .96
            probabilities[jev.NONE] = .04
            return {'model': jev.MODEL, 'choice': 'onboarding', 'probabilities': probabilities,
                    'confidence': .9, 'needs_case_data': .1,
                    'usage': {'input_tokens': 100, 'output_tokens': 10}}

        nodes = dict(self.nodes)
        for i in range(15):
            nodes[f'irrelevant-{i}'] = {'name': f'Otro {i}', 'when': 'tema distante',
                                        'symptoms': [], 'parent': None}
        with patch.object(jev, 'token_from', return_value='secret'), patch.object(jev, 'ask', side_effect=answer):
            row = jev.route('OTP de registro', nodes, live=True)
        self.assertEqual(row['candidate_mode'], 'shortlist')
        self.assertEqual(captured['criteria'], set(row['candidates']) | {jev.NONE})
        self.assertLess(len(row['candidates']), len(nodes))
        self.assertEqual(row['decision'], {'action': 'suggest', 'node': 'onboarding'})

    def test_failure_preserves_local_candidates(self):
        with patch.object(jev, 'token_from', return_value='secret'), patch.object(jev, 'ask', side_effect=jev.JevError('Jev HTTP 401')):
            row = jev.route('OTP de registro', self.nodes, live=True)
        self.assertEqual(row['decision']['action'], 'fallback')
        self.assertEqual(row['baseline'][0]['node'], 'onboarding')
        self.assertIn('401', row['error'])

    def test_transport_no_retry_and_redacts_body(self):
        def reject(req, timeout):
            self.assertEqual(timeout, 15)
            raise urllib.error.HTTPError(jev.ENDPOINT, 401, 'secret', {}, io.BytesIO(b'secret-body'))
        with self.assertRaisesRegex(jev.JevError, '^Jev HTTP 401$'):
            jev.ask(self.body, 'secret', opener=reject)
        self.assertIsNone(jev.NoRedirect().redirect_request(None, None, 302, '', {}, 'https://elsewhere.invalid'))

    def test_timeout_malformed_and_large_response(self):
        def timeout(req, timeout):
            raise TimeoutError('secret')
        with self.assertRaisesRegex(jev.JevError, 'timeout'):
            jev.ask(self.body, 'secret', opener=timeout)
        for body in (b'not json', b'a' * 1_000_001):
            with self.assertRaises(jev.JevError):
                jev.ask(self.body, 'secret', opener=lambda *a, **k: io.BytesIO(body))

    def test_token_precedence_and_env_is_data(self):
        with tempfile.TemporaryDirectory() as d, patch.dict(os.environ, {'JEV_TOKEN': 'process-value'}, clear=True):
            path = Path(d) / '.env'
            path.write_text('IGNORED=$(not-a-command)\nJEV_TOKEN=file-value\n')
            self.assertEqual(jev.token_from(path), 'process-value')
        with patch.dict(os.environ, {}, clear=True), self.assertRaises(jev.JevError):
            jev.token_from(None)

    def test_limits_and_fingerprint(self):
        for query in ('', 'x' * 2001):
            with self.assertRaises(jev.JevError):
                jev.request_body(query, self.nodes)
        changed = copy.deepcopy(self.nodes)
        changed['onboarding']['when'] = 'x' * 65000
        with self.assertRaises(jev.JevError):
            jev.request_body('otp', changed)
        self.assertNotEqual(jev.digest(changed), jev.digest(self.nodes))

    def test_metrics_distinguish_wrong_suggestions_from_abstentions(self):
        wrong = {'expected': ['formalization'], 'baseline': [{'node': 'formalization'}],
                 'jev': jev.validate(self.response, self.body), 'decision': {'action': 'suggest', 'node': 'onboarding'}, 'ms': 10}
        fallback = copy.deepcopy(wrong)
        fallback['decision'] = {'action': 'fallback', 'node': None}
        r = jev.metrics([wrong, fallback])
        self.assertEqual((r['wrong_suggestions'], r['fallbacks'], r['jev_top1'], r['baseline_top1']), (1, 1, 0, 2))

    def test_unlabelled_route_still_reports_usage(self):
        row = {'baseline': [], 'jev': jev.validate(self.response, self.body),
               'decision': {'action': 'suggest', 'node': 'onboarding'}, 'ms': 10}
        result = jev.metrics([row])
        self.assertEqual((result['labelled'], result['responses'], result['suggestions']), (0, 1, 1))
        self.assertEqual(result['tokens'], {'input_tokens': 30, 'output_tokens': 20})

    def test_label_and_stats(self):
        with tempfile.TemporaryDirectory() as d, patch.object(jev, 'RUNS', Path(d)), patch.object(jev, 'catalog', return_value=self.nodes), patch('sys.stdout', new_callable=io.StringIO):
            row = jev.route('OTP de registro', self.nodes)
            p = jev.save({'kind': 'route', 'version': jev.VERSION, 'model': jev.MODEL, 'catalog_sha256': jev.digest(self.nodes),
                          'catalog_nodes': list(self.nodes), 'results': [row]}, runs=Path(d))
            self.assertEqual(jev.main(['label', str(p), '--expected', 'onboarding']), 0)
            self.assertEqual(json.loads(p.read_text())['results'][0]['expected'], ['onboarding'])
            self.assertEqual(jev.main(['stats']), 0)
            with self.assertRaises(jev.JevError):
                jev.main(['label', str(p), '--expected', 'no-existe'])
            self.assertEqual(p.stat().st_mode & 0o777, 0o600)

    def test_empty_local_results_count_as_none(self):
        row = {'expected': ['ninguno'], 'baseline': [], 'decision': {'action': 'fallback', 'node': None}}
        self.assertEqual(jev.metrics([row])['baseline_top1'], 1)

    def test_scope_only_reads_declared_sources_and_redacts_before_returning(self):
        metadata = {'name': 'Registro', 'when': 'OTP', 'sintomas': [], 'files': ['application/src/otp.ts']}
        brief = {'node': 'onboarding', 'name': 'Registro', 'when': 'OTP', 'summary': 'Resumen',
                 'sections': [], 'files': {'total': 1, 'by_repo': {'application': 1}, 'recommended': ['application/src/otp.ts']}}
        with patch.object(jev, 'node_data', return_value=(metadata, 'doc', metadata['files'])), \
             patch.object(jev, 'briefing', return_value=brief), \
             patch.object(jev, 'source_at_main', return_value=('const token = super-secret-value;\nexport const otp = 1', 'main')):
            pack = jev.scope('onboarding', ['application/src/otp.ts'], self.nodes)
        self.assertEqual((pack['files'][0]['ref'], pack['redactions']), ('main', 1))
        self.assertIn('[REDACTED]', pack['files'][0]['content'])
        self.assertNotIn('super-secret-value', pack['files'][0]['content'])
        with patch.object(jev, 'node_data', return_value=(metadata, 'doc', metadata['files'])):
            with self.assertRaises(jev.JevError):
                jev.scope('onboarding', ['application/../../.env'], self.nodes)

    def test_review_contract_uses_only_bounded_scope_and_returns_next_evidence(self):
        pack = {'node': 'onboarding', 'brief': {'name': 'Registro', 'when': 'OTP', 'summary': 'Registro por OTP', 'sections': ['Qué es']},
                'files': [{'path': 'application/src/otp.ts', 'ref': 'main', 'line_start': 1, 'line_end': 2,
                           'content': '   1 | export const otp = true', 'truncated': False, 'redactions': 0}],
                'source_chars': 34, 'redactions': 0}
        body = jev.review_request_body('¿Qué reviso primero?', pack)
        self.assertIn('untrusted data', body['questions']['next_evidence']['instructions'])
        self.assertEqual(set(body['questions']['next_evidence']['criteria']),
                         {'application/src/otp.ts', 'document', 'case-data', 'manual-review'})
        response = {'model': jev.MODEL, 'answers': {
            'next_evidence': {'type': 'choice', 'choice': 'application/src/otp.ts',
                              'probabilities': {'application/src/otp.ts': .91, 'document': .03, 'case-data': .03, 'manual-review': .03},
                              'confidence': .88},
            'needs_case_data': {'type': 'noul', 'noul': .1}}, 'usage': {'input_tokens': 30, 'output_tokens': 12}}
        answer = jev.validate_review(response, body)
        self.assertEqual(jev.decide_review(answer), {'action': 'suggest', 'next': 'application/src/otp.ts'})
        answer['choice'] = 'case-data'
        self.assertEqual(jev.decide_review(answer), {'action': 'fallback', 'next': None})

    def test_cli_stops_after_first_error_and_saves_fallback(self):
        with tempfile.TemporaryDirectory() as d, patch.object(jev, 'catalog', return_value=self.nodes):
            cases = Path(d) / 'cases.json'
            cases.write_text(json.dumps([{'id': str(i), 'query': 'registro', 'expected': ['onboarding']} for i in range(3)]))
            captured = []
            def save(report):
                captured.append(report)
                return Path(d) / 'report.json'
            with patch.object(jev, 'CASES', cases), patch.object(jev, 'save', side_effect=save), patch.object(jev, 'token_from', return_value='secret'), patch.object(jev, 'ask', side_effect=jev.JevError('Jev HTTP 401')) as ask, patch('sys.stdout', new_callable=io.StringIO):
                self.assertEqual(jev.main(['bench', '--live', '--repeat', '2']), 1)
                self.assertEqual(ask.call_count, 1)
                self.assertEqual((captured[0]['planned'], len(captured[0]['results'])), (6, 1))
                self.assertEqual(captured[0]['results'][0]['decision']['action'], 'fallback')


if __name__ == '__main__':
    unittest.main()
