#!/usr/bin/env python3
"""Genera `context/docs/ENTIDADES.md` — la ficha de negocio de cada entidad, MEDIDA contra producción.

POR QUÉ EXISTE. El árbol describe el MECANISMO (qué es un `response_type`, cómo se lista, quién decide)
pero no dice QUIÉN es cada entidad en términos de negocio: a cuántos comercios llega, qué ticket maneja,
a qué plazo presta, cuánto aprueba, dónde se le cae la gente. Eso no está escrito en ningún lado y sí se
puede medir, así que se mide.

POR QUÉ GENERADO Y NO ESCRITO A MANO. Es la misma razón que `ROUTE-MAP.md`: una ficha a mano queda vieja
y su hueco no avisa —se lee igual de convincente estando mal—. Acá la fuente es la base de PRODUCCIÓN y
el documento dice de cuándo es. Si el negocio cambia, se regenera; nadie tiene que acordarse de editarlo.

⚠ QUÉ ES ESTO Y QUÉ NO. Es lo que las entidades HACEN, no lo que ofrecen ni lo que son. No dice si una
empresa es un banco, una fintech o la financiera de un retailer —eso no está en nuestros datos y no se
inventa acá—. Y no reemplaza a los nodos: complementa. Ante conflicto con el código, manda el código.

⚠ EL CONTRASTE «DECLARA vs APLICA» ES EL DATO MÁS CARO. Una entidad puede tener una regla de ocupación
declarada y otorgar créditos que la violan —medido en F-162: 1.923 créditos a `Empleado` en sucursales
cuya regla exige sólo `Independiente`—. Por eso las dos columnas van juntas: leer sólo la declarada
lleva a explicaciones falsas.

Uso:  python3 tools/entidades.py            (desde context/)   ·   o `make context-entidades`
      DIAS=90 para cambiar la ventana · MIN=200 el piso de solicitudes para entrar
"""
import collections
import csv
import io
import os
import re
import subprocess
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent          # context/
PLAYGROUND = RAIZ.parent
SALIDA = RAIZ / 'docs' / 'ENTIDADES.md'
DIAS = int(os.environ.get('DIAS', '90'))
MIN = int(os.environ.get('MIN', '200'))
TOP_COMERCIOS = 4


FALLADAS: list[str] = []


def consultar(sql: str, que: str, reintentos: int = 2) -> list[dict]:
    """Una consulta de SOLO LECTURA a producción, por la puerta única del repo.

    Se pasa por `make trazador-sql` en vez de abrir una conexión propia: ahí viven las credenciales y
    la garantía de que no se escribe. El precio es tener que limpiar la salida, que trae ruido de make.

    ⚠ UNA CONSULTA QUE FALLA SE REGISTRA, NO SE TRAGA. La primera versión devolvía `[]` en silencio y el
    documento salía **sin esa sección y sin decirlo**: la ficha de ocupación apareció en 7 entidades de
    21 y el resto simplemente no la tenía, indistinguible de «esas entidades no declaran ocupación».
    Un generado con huecos invisibles es peor que uno que falla, porque se lee como completo.

    Redash corta a los 60 s, y la cola a veces está lenta sin que la consulta sea el problema — por eso
    se reintenta antes de darla por perdida.
    """
    for intento in range(1, reintentos + 1):
        r = subprocess.run(
            ['make', '-s', 'trazador-sql', 'TARGET=prod', 'CSV=1', f'SQL={sql}'],
            cwd=PLAYGROUND, capture_output=True, text=True, timeout=300,
        )
        lineas = [l for l in r.stdout.splitlines() if l.strip()]
        for i, l in enumerate(lineas):
            if ',' in l and not l.startswith(('make', ' ', '\t')):
                return list(csv.DictReader(io.StringIO('\n'.join(lineas[i:]))))
        motivo = (r.stdout + r.stderr).strip().splitlines()
        motivo = motivo[-1][:150] if motivo else 'sin salida'
        if intento < reintentos:
            print(f'  ↻ «{que}» falló, reintento {intento + 1}/{reintentos}…', file=sys.stderr)
    FALLADAS.append(f'{que} — {motivo}')
    print(f'  ✗ «{que}» no se pudo medir: {motivo}', file=sys.stderr)
    return []


def agrupar(filas: list[dict], clave: str) -> dict:
    out = collections.defaultdict(list)
    for f in filas:
        out[f[clave]].append(f)
    return out


VENTANA = f'ur.created_at > DATE_SUB(NOW(), INTERVAL {DIAS} DAY)'

print(f'  midiendo producción · ventana {DIAS} días · piso {MIN} solicitudes…', file=sys.stderr)

base = consultar(
    'SELECT l.id lid, l.name entidad, l.response_type rt, COUNT(DISTINCT ur.allied_id) comercios, '
    'COUNT(*) solicitudes, SUM(ur.user_request_status_id=11) aprobadas, '
    'ROUND(AVG(NULLIF(ur.amount,0))) monto, ROUND(AVG(NULLIF(ur.fee_number,0))) cuotas '
    f'FROM user_requests ur JOIN lenders l ON l.id=ur.lender_id WHERE {VENTANA} '
    f'GROUP BY l.id, l.name, l.response_type HAVING solicitudes >= {MIN} ORDER BY solicitudes DESC', 'métricas base')
if not base:
    print('  ✗ sin datos: ¿hay acceso a prod? (probá `make trazador-sql TARGET=prod SQL="SELECT 1"`)', file=sys.stderr)
    sys.exit(1)

ids = ','.join(f['lid'] for f in base)

estados = agrupar(consultar(
    'SELECT ur.lender_id lid, s.name estado, COUNT(*) n FROM user_requests ur '
    'LEFT JOIN user_request_statuses s ON s.id=ur.user_request_status_id '
    f'WHERE ur.lender_id IN ({ids}) AND {VENTANA} GROUP BY ur.lender_id, s.name ORDER BY n DESC', 'embudo de estados'), 'lid')

comercios = agrupar(consultar(
    'SELECT ur.lender_id lid, a.name comercio, COUNT(*) n FROM user_requests ur '
    f'JOIN allieds a ON a.id=ur.allied_id WHERE ur.lender_id IN ({ids}) AND {VENTANA} '
    'GROUP BY ur.lender_id, a.name ORDER BY n DESC', 'comercios por entidad'), 'lid')

ocup_real = agrupar(consultar(
    'SELECT v.lender_id lid, v.OCCUPATION ocupacion, COUNT(*) n FROM VW_User_Request_Track v '
    f'WHERE v.lender_id IN ({ids}) AND v.user_request_status = "Autorizada" '
    f'AND v.created_at > DATE_SUB(NOW(), INTERVAL {DIAS} DAY) AND v.OCCUPATION IS NOT NULL '
    'GROUP BY v.lender_id, v.OCCUPATION ORDER BY n DESC', 'ocupación real (aprobados)'), 'lid')

ocup_regla = agrupar(consultar(
    'SELECT c.lender_id lid, r.occupation ocupacion, COUNT(*) n FROM lender_users_category_rules r '
    f'JOIN lender_users_categories c ON c.id=r.lender_users_category_id WHERE c.lender_id IN ({ids}) '
    'AND r.occupation IS NOT NULL AND r.occupation <> "" GROUP BY c.lender_id, r.occupation', 'ocupación declarada'), 'lid')

FAMILIA = {'0': 'redirección (decide afuera)', '1': 'integración (API de la entidad)',
           '2': 'CreditopX (decide CreditOp)', '3': 'rotativo', '4': 'Credifamilia'}


def pesos(n) -> str:
    v = float(n or 0)
    return f'${v/1_000_000:.1f} M' if v >= 1_000_000 else f'${v:,.0f}'.replace(',', '.')


def normalizar(valor: str) -> set[str]:
    """Las dos puntas guardan la ocupación en formatos DISTINTOS, y compararlas crudas miente.

    La real viene de la vista como un JSON (`["Empleado"]`) y la declarada de las reglas como una lista
    separada por barras (`Independiente|Empleado|Pensionado`). Sin normalizar, NINGUNA real coincide con
    NINGUNA declarada —por el formato, no por el negocio— y el contraste marcaba divergencia en las 7
    entidades que declaran algo. Una alerta fabricada es peor que ninguna: manda a investigar un
    problema que no existe, y desacredita las divergencias reales.
    """
    limpio = (valor or '').strip().strip('[]').replace('"', '').replace("'", '')
    # Se parte por barra Y por coma: la vista devuelve arreglos JSON multivaluados
    # (`["Pensionado","Empleado"]` → `Pensionado,Empleado`) y las reglas usan barras
    # (`Empleado|Pensionado`). Partiendo sólo por una, un valor múltiple queda como UN token que no
    # coincide con nada y se reporta como ocupación no declarada — con el nombre de dos pegados.
    return {p.strip() for p in re.split(r'[|,]', limpio) if p.strip()}


def mezcla(filas, k='ocupacion', tope=4) -> str:
    if not filas:
        return '—'
    total = sum(int(f['n']) for f in filas) or 1
    partes = [f"{' + '.join(sorted(normalizar(f[k]))) or '(vacío)'} {round(100*int(f['n'])/total)}%"
              for f in filas[:tope]]
    return ' · '.join(partes)


doc = [
    '# CreditOp — Ficha de negocio de cada entidad',
    '',
    '> **GENERADO — no editar a mano.** Se regenera con `make context-entidades`.',
    f'> Medido contra **producción**, ventana de **{DIAS} días**, entidades con **{MIN}+ solicitudes**.',
    '',
    'Lo que el árbol NO dice: **quién es cada entidad en términos de negocio** — a cuántos comercios',
    'llega, qué ticket maneja, a qué plazo presta, cuánto aprueba y dónde se le cae la gente.',
    '',
    '⚠ **Es lo que las entidades HACEN, no lo que son.** Acá no hay descripciones de empresa: nada de',
    'esto sale de una fuente externa, todo sale de la base. Ante conflicto con el código, manda el código.',
    '',
    '⚠ **Leé las dos columnas de ocupación juntas.** *Declarada* es la regla configurada; *real* es la de',
    'los créditos que se otorgaron. Cuando difieren, la regla **no está excluyendo** — es el hallazgo',
    'F-162, y leer sólo la declarada lleva a explicaciones falsas.',
    '',
    '| entidad | familia | comercios | solicitudes | aprueba | ticket | plazo |',
    '|---|---|---:|---:|---:|---:|---:|',
]
for f in base:
    pct = round(100 * int(f['aprobadas']) / max(1, int(f['solicitudes'])))
    doc.append(f"| **{f['entidad']}** | rt={f['rt']} | {f['comercios']} | {f['solicitudes']} "
               f"| {pct}% | {pesos(f['monto'])} | {f['cuotas'] or '—'} |")

doc += ['', '## Ficha por entidad', '']
for f in base:
    lid, tot = f['lid'], max(1, int(f['solicitudes']))
    pct = round(100 * int(f['aprobadas']) / tot)
    doc += [f"### {f['entidad']}", '',
            f"- **Familia:** rt={f['rt']} — {FAMILIA.get(f['rt'], '?')}",
            f"- **Alcance:** {f['comercios']} comercio(s) · {f['solicitudes']} solicitudes en {DIAS} días",
            f"- **Aprueba el {pct}%** ({f['aprobadas']} de {f['solicitudes']})",
            f"- **Ticket medio:** {pesos(f['monto'])} · **plazo medio:** {f['cuotas'] or '—'} cuotas"]

    tops = comercios.get(lid, [])[:TOP_COMERCIOS]
    if tops:
        doc.append('- **Principales comercios:** ' + ' · '.join(
            f"{c['comercio']} ({c['n']})" for c in tops))

    est = estados.get(lid, [])[:5]
    if est:
        doc.append('- **Dónde terminan:** ' + ' · '.join(
            f"{e['estado'] or '(sin estado)'} {round(100*int(e['n'])/tot)}%" for e in est))

    decl, real = ocup_regla.get(lid, []), ocup_real.get(lid, [])
    if decl or real:
        doc.append(f"- **Ocupación — declarada:** {mezcla(decl)} · **real (aprobados):** {mezcla(real)}")
        # La comparación va por CONJUNTOS de ocupaciones normalizadas, no por cadenas.
        declaradas: set[str] = set().union(*(normalizar(d['ocupacion']) for d in decl)) if decl else set()
        fuera = sorted(set().union(*(normalizar(r['ocupacion']) for r in real)) - declaradas) if real and declaradas else []
        if fuera:
            otorgados = sum(int(r['n']) for r in real if normalizar(r['ocupacion']) & set(fuera))
            doc.append(f"  - ⚠ **Otorgó {otorgados} crédito(s) a ocupaciones que su regla NO declara:** "
                       f"{', '.join(fuera[:5])} — la regla clasifica, no excluye (F-162)")
    doc.append('')

# Lo que NO se pudo medir va EN EL DOCUMENTO, arriba de todo. Un lector que no ve una sección no
# puede distinguir «esa entidad no tiene ese dato» de «la consulta se cayó», y las dos se leen igual.
if FALLADAS:
    aviso = ['', '> ⚠ **ESTE DOCUMENTO ESTÁ INCOMPLETO.** No se pudieron medir:', '']
    aviso += [f'> - **{f}**' for f in FALLADAS]
    aviso += ['>', '> Las secciones que dependen de eso **faltan, no están vacías**. Volvé a correrlo.', '']
    doc[4:4] = aviso

SALIDA.parent.mkdir(parents=True, exist_ok=True)
SALIDA.write_text('\n'.join(doc) + '\n', encoding='utf-8')
print(f'  {"⚠" if FALLADAS else "✓"} {SALIDA.relative_to(PLAYGROUND)} — {len(base)} entidades'
      + (f' · {len(FALLADAS)} consulta(s) sin medir' if FALLADAS else ''), file=sys.stderr)
sys.exit(1 if FALLADAS else 0)
