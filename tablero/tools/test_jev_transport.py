"""Pruebas de la conexión con Jev. No salen a la red: el pedido pasa por un `opener` falso.

No persiguen cobertura: cada una fija una promesa del transporte que, rota, filtraría algo o
aceptaría una respuesta que no se pidió.
"""
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
import urllib.error
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))
import jev_transport as jt  # noqa: E402


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()
        return False


class TokenTest(unittest.TestCase):
    def test_reads_only_the_two_accepted_keys_and_the_environment_wins(self):
        with tempfile.TemporaryDirectory() as d:
            env = Path(d, '.env')
            env.write_text('OTRA=nada\nexport JEV_TOKEN="del-archivo"\nrm -rf /tmp/x\n')
            with patch.dict(os.environ, {}, clear=True):
                self.assertEqual(jt.token_from(env), 'del-archivo')
            with patch.dict(os.environ, {'JEV_TOKEN': 'del-entorno'}, clear=True):
                self.assertEqual(jt.token_from(env), 'del-entorno')

    def test_missing_token_is_an_error_not_an_empty_header(self):
        with patch.dict(os.environ, {}, clear=True), self.assertRaises(jt.JevError):
            jt.token_from(None)


class RequestTest(unittest.TestCase):
    def test_sends_bearer_to_the_endpoint_and_returns_what_the_validator_accepts(self):
        seen = {}

        def opener(req, timeout):
            seen['url'], seen['auth'], seen['timeout'] = req.full_url, req.get_header('Authorization'), timeout
            seen['body'] = json.loads(req.data)
            return FakeResponse(b'{"ok": true}')

        got = jt.request_json({'q': 1}, 'secreto', lambda answer, body: (answer, body), opener=opener)
        self.assertEqual(got, ({'ok': True}, {'q': 1}))
        self.assertEqual((seen['url'], seen['auth'], seen['body']), (jt.ENDPOINT, 'Bearer secreto', {'q': 1}))
        self.assertLessEqual(seen['timeout'], 15)

    def test_an_http_error_does_not_leak_the_body_or_the_token(self):
        def opener(req, timeout):
            raise urllib.error.HTTPError(jt.ENDPOINT, 401, 'no', {}, io.BytesIO(b'token secreto invalido'))

        with self.assertRaises(jt.JevError) as caught:
            jt.request_json({}, 'secreto', lambda a, b: a, opener=opener)
        self.assertEqual(str(caught.exception), 'Jev HTTP 401')

    def test_an_oversized_or_invalid_answer_is_rejected(self):
        big = FakeResponse(b'"' + b'x' * 1_000_001 + b'"')
        with self.assertRaises(jt.JevError):
            jt.request_json({}, 't', lambda a, b: a, opener=lambda req, timeout: big)
        with self.assertRaises(jt.JevError):
            jt.request_json({}, 't', lambda a, b: a, opener=lambda req, timeout: FakeResponse(b'no es json'))


if __name__ == '__main__':
    unittest.main()
