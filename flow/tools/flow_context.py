#!/usr/bin/env python3
"""Contrato compacto de Flow para una sesión o un LLM.

No consulta producción, no abre la persistencia del navegador y no responde casos.
Reduce el modelo a mapa -> ficha: primero orienta; después expone sólo la regla
que hace falta leer. El resultado describe el simulador y distingue lo verificado
del código real de lo que Flow representa como diseño.
"""
import argparse
import json
from pathlib import Path
import re
import sys
import unicodedata


ROOT = Path(__file__).resolve().parents[1]
VERSION = 'flow-context-v1'


def normalize(value):
    value = unicodedata.normalize('NFD', str(value or '').lower())
    return ''.join(char for char in value if unicodedata.category(char) != 'Mn')


# Cada ficha cabe en una lectura rápida. No copia los documentos: apunta al documento
# que corresponde si el modelo necesita validar, matizar o abrir código real.
TOPICS = {
    'overview': {
        'name': 'Mapa de decisión',
        'when': 'Para entender la cascada sin entrar aún en una regla.',
        'rules': [
            'catálogo → solicitud → burós → gate de sucursal → perfil/tramo → oferta → ciclo posterior',
            'response_type define quién decide: rt2 CreditOp, rt1 API de la entidad, rt0 sitio externo',
            'una selección no es aprobación ni desembolso',
        ],
        'limits': ['Flow es un modelo explicable de originación, no una fuente de estado vivo ni un motor de producción.'],
        'next': ['country', 'branch-gate', 'profiling', 'post-selection'],
        'sources': ['docs/MAP.md#1-·-el-flujo-de-una-mirada', 'README.md#conceptos-que-hay-que-entender-sí-o-sí'],
    },
    'country': {
        'name': 'País e identidad de la solicitud',
        'when': 'País, documento, celular, moneda o compatibilidad de una entidad.',
        'rules': [
            'el comercio fija el perfil de país del escenario',
            'la solicitud hereda documentos permitidos, prefijo/longitud de celular y formato monetario',
            'al cambiar de país se reinicia al primer documento compatible; una entidad de otro país no se ofrece',
        ],
        'limits': ['La política multi-país es una representación de Flow: verificá el filtro real antes de afirmar comportamiento de producción.'],
        'next': ['offers', 'fidelity'],
        'sources': ['docs/DOCUMENTATION.md#10-país-un-perfil-heredado-que-sí-gobierna-el-escenario', 'src/store.js'],
    },
    'offers': {
        'name': 'Catálogo y response_type',
        'when': 'Por qué una entidad aparece, quién decide o qué significa rt0/rt1/rt2.',
        'rules': [
            'rt2 CreditopX: CreditOp calcula categoría, cupo, tramo y oferta',
            'rt1 agregador: la API externa preaprueba; su rechazo/timeout puede sacar la oferta',
            'rt0 redirect: el usuario sale al sitio de la entidad y CreditOp no decide el desenlace',
        ],
        'limits': ['El catálogo de Flow es local; no indica las entidades activas para un comercio real.'],
        'next': ['branch-gate', 'profiling', 'post-selection'],
        'sources': ['docs/MAP.md#0-·-leyenda-y-convenciones', 'docs/MAP.md#s6-·-consolidación-rt1-agregador'],
    },
    'branch-gate': {
        'name': 'Gate de sucursal',
        'when': 'group_rules, datacrédito, score, negativas, consultas o por qué una oferta cae/reordena.',
        'rules': [
            'datacrédito y group_rules se evalúan antes del perfilamiento',
            'dentro de un grupo: AND; entre grupos: OR; sin dato: falla cerrada',
            'un fallo rt2 excluye; en rt distinto de 2 se conserva pero baja de prioridad',
        ],
        'limits': ['Estado en sucursal es informativo en el modelo actual: no debe confundirse con el filtro vivo de getLenders.'],
        'next': ['profiling', 'amount', 'fidelity'],
        'sources': ['docs/MAP.md#s5-·-consolidación-rt2-creditopx', 'src/store.js'],
    },
    'profiling': {
        'name': 'Perfilamiento y cupo',
        'when': 'Categoría, ingreso, score, ocupación, enganche, cupo o capacidad de pago.',
        'rules': [
            'sólo rt2 entra a categorías de perfilamiento',
            'la categoría ganadora fija enganche, cupo y techo de cuotas',
            'sin categoría o con cupo menor al monto, rt2 no ofrece',
        ],
        'limits': ['Flow resume el cascade de datos; la disponibilidad real del perfilamiento depende del ambiente y de servicios externos.'],
        'next': ['amount', 'branch-gate', 'fidelity'],
        'sources': ['docs/MAP.md#orden-real-del-cascade-verificado', 'docs/DOCUMENTATION.md#9-modelo-del-flow-fiel-no-inventar-reglas--nodo-perfilamiento--fantasmas-eliminados'],
    },
    'amount': {
        'name': 'Monto, tramo y cuota',
        'when': 'Monto máximo, tramo, cuotas, enganche, cuota mensual o economía.',
        'rules': [
            'en rt2 el cupo de la categoría es el corte principal; el monto no se valida como una regla independiente',
            'el tramo por monto recorta cupo y cuotas; no reemplaza el enganche de la categoría',
            'la cuota usa capital financiado, costos administrativos, fondo de garantías y seguros',
        ],
        'limits': ['No confundas cuota de la oferta, cuota inicial y variables de servicing: comparten nombre y no tienen el mismo efecto.'],
        'next': ['profiling', 'fidelity'],
        'sources': ['docs/MAP.md#precedencia-tramo-vs-categoría-verificado-holdstrue', 'docs/DOCUMENTATION.md#1-las-tres-cuotas-la-trampa-de-terminología'],
    },
    'post-selection': {
        'name': 'Después de elegir una oferta',
        'when': 'Reevaluación, formalización, firma, retorno, webhook, autorización o desembolso.',
        'rules': [
            'la oferta guarda una foto; rt2 se reevalúa antes de continuar si cambió el cupo',
            'radicar, autorizar y desembolsar son etapas diferentes',
            'en integraciones externas el retorno puede ser asíncrono o no volver a CreditOp',
        ],
        'limits': ['El ciclo posterior está simplificado; los estados y contratos reales se verifican con Harness o Trazador.'],
        'next': ['offers', 'fidelity'],
        'sources': ['docs/LO-QUE-LAS-CORRIDAS-ENSENARON.md', 'docs/BALANCE-Y-PROXIMOS-NODOS.md#grupo-a--cerrar-el-círculo-del-listado-al-crédito-vivo'],
    },
    'fidelity': {
        'name': 'Fidelidad y frontera del simulador',
        'when': 'Si una regla es real, qué no está modelado o si hace falta evidencia de un caso.',
        'rules': [
            'el corazón del listado está modelado como una cascada explícita y documentada',
            'la configuración admin, canales, estado vivo y servicing no quedan completamente representados',
            'un caso real se responde corriendo Harness o consultando Trazador; nunca desde este resumen',
        ],
        'limits': ['No conviertas un resultado de Flow en evidencia de producción.'],
        'next': ['overview', 'branch-gate', 'post-selection'],
        'sources': ['docs/BALANCE-Y-PROXIMOS-NODOS.md#3-la-foto-honesta-cuánto-cubrimos', 'README.md#deber-ser-vs-lo-que-hoy-existe-leer-antes-de-citar-el-simulador-como-verdad'],
    },
}

ROUTE_WORDS = {
    'country': ('pais', 'documento', 'cedula', 'dni', 'celular', 'telefono', 'prefijo', 'moneda'),
    'offers': ('entidad', 'lender', 'oferta', 'catalogo', 'response type', 'rt0', 'rt1', 'rt2', 'agregador', 'redirect'),
    'branch-gate': ('group rules', 'group_rules', 'sucursal', 'datacredito', 'score', 'negativa', 'consulta', 'mora', 'regla'),
    'profiling': ('perfil', 'perfilamiento', 'categoria', 'ingreso', 'ocupacion', 'capacidad de pago', 'cupo'),
    'amount': ('monto', 'tramo', 'cuota', 'cuotas', 'enganche', 'plazo', 'fondo', 'seguro'),
    'post-selection': ('formalizacion', 'firma', 'radicacion', 'radicar', 'webhook', 'retorno', 'desembolso', 'reevaluacion'),
    'fidelity': ('produccion', 'real', 'fiel', 'fidelidad', 'cobertura', 'diferencia', 'simulador', 'caso'),
}


def unsafe_reason(query):
    plain = normalize(query)
    if re.search(r'\b[\w.+-]+@[\w-]+\.[\w.-]+\b', query):
        return 'correo detectado'
    if re.search(r'\b(select|insert|update|delete)\b[\s\S]{0,80}\b(from|into|set)\b', plain):
        return 'SQL detectado'
    if re.search(r'\b(cedula|documento|telefono|celular|ureq|solicitud)\b[^\n]{0,32}\b\d{5,}\b', plain):
        return 'identificador de caso detectado'
    return None


def compact_topic(topic):
    data = TOPICS[topic]
    return {'id': topic, 'name': data['name'], 'when': data['when']}


def map_contract():
    return {
        'kind': 'map', 'version': VERSION,
        'purpose': 'Orientar una investigación del modelo de originación sin abrir documentación extensa.',
        'flow': [
            {'stage': '1', 'topic': 'country', 'label': 'comercio define el país y la solicitud compatible'},
            {'stage': '2', 'topic': 'offers', 'label': 'catálogo y response_type deciden quién procesa'},
            {'stage': '3', 'topic': 'branch-gate', 'label': 'reglas de sucursal filtran o reclasifican'},
            {'stage': '4', 'topic': 'profiling', 'label': 'rt2 perfila, calcula cupo y aplica tramo'},
            {'stage': '5', 'topic': 'post-selection', 'label': 'selección, reevaluación y retorno externo'},
        ],
        'boundary': 'Flow explica un modelo local. Para un caso o estado real: Harness/Trazador.',
        'next': 'brief <topic>',
    }


def brief(topic):
    data = TOPICS[topic]
    return {
        'kind': 'brief', 'version': VERSION, 'topic': topic, 'name': data['name'], 'when': data['when'],
        'rules': data['rules'], 'limits': data['limits'], 'next': data['next'], 'sources': data['sources'],
    }


def route(query):
    reason = unsafe_reason(query)
    if reason:
        raise ValueError(f'{reason}: Flow sólo orienta mecanismos generales. Para casos use Harness o Trazador.')
    plain = normalize(query)
    scores = {}
    for topic, words in ROUTE_WORDS.items():
        score = sum(2 if ' ' in word else 1 for word in words if word in plain)
        if score:
            scores[topic] = score
    ranked = sorted(scores, key=lambda topic: (-scores[topic], topic))[:3]
    if not ranked:
        ranked = ['overview', 'fidelity']
    elif 'fidelity' not in ranked:
        ranked.append('fidelity')
    return {
        'kind': 'route', 'version': VERSION, 'mode': 'local',
        'recommended': [compact_topic(topic) for topic in ranked[:3]],
        'instruction': 'Lea una ficha primero. Si no alcanza, abra sólo la fuente declarada de esa ficha.',
        'case_data': False,
    }


def validate_catalog():
    errors = []
    for topic, data in TOPICS.items():
        for key in ('name', 'when', 'rules', 'limits', 'next', 'sources'):
            if not data.get(key):
                errors.append(f'{topic}: falta {key}')
        errors.extend(f'{topic}: próximo tema inexistente {item}' for item in data.get('next', []) if item not in TOPICS)
        for source in data.get('sources', []):
            filename = source.split('#', 1)[0]
            if not (ROOT / filename).is_file():
                errors.append(f'{topic}: fuente no encontrada {filename}')
    return {'kind': 'validate', 'version': VERSION, 'valid': not errors, 'topics': len(TOPICS), 'errors': errors}


def text(value):
    if value['kind'] == 'map':
        lines = ['flow · mapa compacto']
        lines.extend(f"{row['stage']}. {row['label']}  [{row['topic']}]" for row in value['flow'])
        return '\n'.join(lines + [f"límite: {value['boundary']}", 'siguiente: brief <topic>'])
    if value['kind'] == 'brief':
        lines = [f"{value['topic']} · {value['name']}", f"cuándo: {value['when']}", 'reglas:']
        lines.extend(f'  · {rule}' for rule in value['rules'])
        lines.append('límite: ' + ' '.join(value['limits']))
        lines.append('siguiente: ' + ' · '.join(f'brief {topic}' for topic in value['next']))
        return '\n'.join(lines)
    if value['kind'] == 'route':
        lines = ['ruta local:']
        lines.extend(f"  {index}. {item['id']} · {item['name']}" for index, item in enumerate(value['recommended'], 1))
        return '\n'.join(lines + [value['instruction']])
    if value['kind'] == 'validate':
        return f"{'ok' if value['valid'] else 'error'} · {value['topics']} fichas" + (f" · {'; '.join(value['errors'])}" if value['errors'] else '')
    return json.dumps(value, ensure_ascii=False)


def emit(value, as_text):
    print(text(value) if as_text else json.dumps(value, ensure_ascii=False, indent=2))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    map_cmd = sub.add_parser('map', help='Mapa general, máximo cinco etapas')
    route_cmd = sub.add_parser('route', help='Elige una a tres fichas desde una pregunta general')
    route_cmd.add_argument('question')
    brief_cmd = sub.add_parser('brief', help='Una ficha acotada de reglas y frontera')
    brief_cmd.add_argument('topic', choices=sorted(TOPICS))
    check_cmd = sub.add_parser('validate', help='Comprueba que las fichas y sus fuentes existan')
    for command in (map_cmd, route_cmd, brief_cmd, check_cmd):
        command.add_argument('--text', action='store_true', help='Salida breve para leer o pegar en una sesión')
    args = parser.parse_args(argv)
    try:
        if args.command == 'map': result = map_contract()
        elif args.command == 'route': result = route(args.question)
        elif args.command == 'brief': result = brief(args.topic)
        else:
            result = validate_catalog()
            if not result['valid']:
                emit(result, args.text)
                return 1
        emit(result, args.text)
        return 0
    except ValueError as error:
        print(f'flow-context: {error}', file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
