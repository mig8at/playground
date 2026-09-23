#!/usr/bin/env python3
"""La conexión con la API de Jev (TypeSafe), sin ningún uso encima — a propósito.

El 2026-09-23 se retiró todo lo que la usaba en el tablero: el botón «Orientar», la revisión de
pendientes y el laboratorio `tools/jev.py` con su banco de casos. Metían ruido sin haber encontrado
todavía un uso que lo justificara. Esto queda para cuando aterrice uno mejor: el endpoint y el modelo,
cómo se lee el token (sólo `JEV_TOKEN` o `TYPESAFE_API_KEY`; un `.env` nunca se ejecuta como shell) y
un pedido acotado que no sigue redirecciones ni filtra el cuerpo, el token o la respuesta en un error.

    from jev_transport import token_from, request_json
    answer = request_json(body, token_from('server/.env'), validator)

Las pruebas son offline (`make tablero-jev-test`): nunca salen a la red.
"""
import json
import os
from pathlib import Path
import socket
import urllib.error
import urllib.request

ENDPOINT = 'https://api.typesafe.ai/v1/systemone'
MODEL = 'jev-1.13.0'


class JevError(Exception):
    pass


def token_from(env_file):
    """Lee solo las dos claves admitidas; un .env nunca se ejecuta como shell."""
    values = {}
    if env_file and Path(env_file).exists():
        for line in Path(env_file).read_text().splitlines():
            key, sep, value = line.strip().removeprefix('export ').partition('=')
            if sep and key.strip() in ('JEV_TOKEN', 'TYPESAFE_API_KEY'):
                values[key.strip()] = value.strip().strip('\"\'')
    values.update(os.environ)
    token = values.get('JEV_TOKEN') or values.get('TYPESAFE_API_KEY')
    if not token or not token.strip():
        raise JevError('falta JEV_TOKEN o TYPESAFE_API_KEY en el entorno o --env-file')
    return token.strip()


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def request_json(body, token, validator, opener=None):
    """Hace un solo intento acotado; los errores nunca incluyen cuerpo, token ni respuesta."""
    opener = opener or urllib.request.build_opener(NoRedirect()).open
    req = urllib.request.Request(
        ENDPOINT,
        data=json.dumps(body, ensure_ascii=False).encode(),
        headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'},
    )
    try:
        with opener(req, timeout=15) as response:
            raw = response.read(1_000_001)
        if len(raw) > 1_000_000:
            raise JevError('respuesta demasiado grande')
        return validator(json.loads(raw), body)
    except urllib.error.HTTPError as error:
        code = error.code
        error.close()
        raise JevError(f'Jev HTTP {code}') from None
    except (urllib.error.URLError, socket.timeout, TimeoutError):
        raise JevError('Jev no disponible o timeout') from None
    except (ValueError, UnicodeError):
        raise JevError('respuesta JSON inválida') from None
