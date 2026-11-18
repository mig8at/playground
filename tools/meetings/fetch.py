"""Baja las notas de reuniones (Gemini en Drive, Read AI en Gmail) a knowledge/meetings/raw/, ordenadas por reunión y fecha.

Busca en Drive las «Notas de Gemini» y en Gmail los informes de Read AI con `bin/pg` (sesión de Drive y Gmail de Miguel),
baja lo que falta (lo ya bajado no se vuelve a pedir) y rehace el índice `raw/INDEX.md`. Lo crudo queda FUERA de git: trae
transcripciones, nombres y datos internos. Lo que se cura a mano va en knowledge/meetings/*.md.

Uso: make meetings-fetch   (o python3 tools/meetings/fetch.py <raíz de my-tools>)
"""
import json, os, re, subprocess, sys, unicodedata, collections

root = sys.argv[1] if len(sys.argv) > 1 else os.getcwd()
raw = os.path.join(root, 'knowledge', 'meetings', 'raw')
pg = os.path.join(root, 'bin', 'pg')
MONTHS = {m: i for i, m in enumerate(['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
                                      'september', 'october', 'november', 'december'], 1)}


def slug(s):
    s = unicodedata.normalize('NFKD', s.lower())
    s = ''.join(c for c in s if not unicodedata.combining(c))
    return re.sub(r'[^a-z0-9]+', '-', s).strip('-') or 'sin-nombre'


def run(*args):
    r = subprocess.run([pg, *args], capture_output=True, text=True, cwd=root)
    return r.returncode, r.stdout, r.stderr


index = collections.defaultdict(dict)  # meeting slug -> {date: {source: info}}
names = {}

def search(*args):
    code, so, se = run(*args, '--json')
    if code != 0:
        sys.exit(f'✗ {" ".join(args[:2])}: {se.strip()[:300]}')
    return json.loads(so)


# ── Gemini: un documento por reunión ─────────────────────────────────────────
items = search('drive', 'search', '--q', 'Notas de Gemini', '--n', '500')
items = items if isinstance(items, list) else items.get('files', [])
for it in items:
    name = it['name']
    m = re.match(r'(.+?) - (\d{4})/(\d{2})/(\d{2})', name)
    if not m:
        print('  · salto (no es una nota de reunión):', name)
        continue
    meeting, date = m.group(1).strip(), f'{m.group(2)}-{m.group(3)}-{m.group(4)}'
    key = slug(meeting)
    names.setdefault(key, meeting)
    out = os.path.join(raw, key, 'gemini', date + '.md')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    if not os.path.exists(out):
        code, so, se = run('drive', 'read', it['id'], '--out', out)
        if code != 0:
            print('  ✗ gemini', name, se.strip()[:200])
            continue
    text = open(out).read()
    has_transcript = 'Transcripción' in text and re.search(r'^### \*\*\d\d:\d\d:\d\d', text, re.M) is not None
    index[key].setdefault(date, {})['gemini'] = dict(words=len(text.split()), transcript=has_transcript)

# ── Read AI: el informe por correo (dos por reunión: se queda el de español si está) ─
msgs = search('gmail', 'search', '--q', 'from:executiveassistant@e.read.ai', '--n', '500')
msgs = msgs if isinstance(msgs, list) else msgs.get('messages', [])
chosen = {}
for msg in msgs:
    s = msg['subject']
    if 'Pre-Read' in s:
        continue
    m = re.search(r'🗓\s*(.+?)\s+(?:on|en)\s+(\w+) (\d{1,2}), (\d{4})', s)
    if not m:
        continue
    meeting, month, day, year = m.group(1).strip(), m.group(2).lower(), int(m.group(3)), m.group(4)
    if month not in MONTHS:
        continue
    date = f'{year}-{MONTHS[month]:02d}-{day:02d}'
    key = slug(meeting)
    names.setdefault(key, meeting)
    spanish = 'Informe' in s
    prev = chosen.get((key, date))
    if prev is None or (spanish and not prev[1]):
        chosen[(key, date)] = (msg['id'], spanish)


def clean(text):
    text = re.sub(r'[\u034f\u200c\u00ad\u200b\u2007]+', ' ', text)
    text = re.sub(r'https?://\S+', '', text)
    text = re.sub(r'(email_access_invite_token|email_verification_token):\S+', r'\1:[quitado]', text)
    text = re.sub(r'eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+', '[quitado]', text)
    return text


def structured(text):
    """Read AI manda su contenido como un volcado `map[...]`: se pasan a Markdown los resúmenes, capítulos y tareas."""
    out = []
    head = text.split('map[', 1)[0]
    summary = [l.strip() for l in head.split('\n') if l.strip() and not l.startswith(('De:', 'Para:', 'Asunto:', 'Fecha:'))
               and 'invitado a ver este informe' not in l and l.strip() not in ('( )',)]
    out.append('## Resumen\n\n' + '\n\n'.join(summary))
    m = re.search(r'action_items:\[(.*?)\] ask_read_prompts', text, re.S)
    if m:
        items = re.split(r'(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÑ][\wáéíóúñ ]{1,40}: )', m.group(1).strip())
        out.append('## Tareas\n\n' + '\n'.join('- ' + i.strip() for i in items if i.strip()))
    chapters = re.findall(r'map\[chapter:(.*?) topics:\[(.*?)\]\]', text, re.S)
    if chapters:
        lines = ['## Capítulos']
        for title, topics in chapters:
            lines.append(f'\n### {title.strip()}')
            for t in re.split(r'(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÑ])', topics.strip()):
                if t.strip():
                    lines.append('- ' + t.strip())
        out.append('\n'.join(lines))
    m = re.search(r'ask_read_prompts:\[(.*?)\] billing_plan', text, re.S)
    if m:
        qs = re.split(r'(?<=\?)\s+', m.group(1).strip())
        out.append('## Preguntas que sugiere Read AI\n\n' + '\n'.join('- ' + q for q in qs if q.strip()))
    return '\n\n'.join(out) + '\n'


for (key, date), (mid, spanish) in sorted(chosen.items()):
    out = os.path.join(raw, key, 'readai', date + '.md')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    if not os.path.exists(out):
        code, so, se = run('gmail', 'read', mid)
        if code != 0:
            print('  ✗ readai', key, date, se.strip()[:200])
            continue
        text = clean(so)
        body = structured(text) if 'map[' in text else text
        open(out, 'w').write(f'# {names[key]} · {date} · Read AI\n\n> Informe automático de Read AI (correo {mid}). Puede contener errores.\n\n{body}')
    text = open(out).read()
    index[key].setdefault(date, {})['readai'] = dict(words=len(text.split()))

# ── el índice ─────────────────────────────────────────────────────────────────
lines = ['# Notas de reuniones · índice', '',
         '> Bajadas de Drive (notas de Gemini) y de Gmail (informes de Read AI). Material crudo, sin revisar: tiene errores',
         '> de transcripción, nombres y datos internos. **Fuera de git** (`knowledge/meetings/raw/`).', '']
for key in sorted(index, key=lambda k: -len(index[k])):
    dates = index[key]
    lines.append(f'## {names[key]} (`{key}/`) · {len(dates)} reuniones')
    lines.append('')
    lines.append('| fecha | Gemini | Read AI |')
    lines.append('|---|---|---|')
    for d in sorted(dates, reverse=True):
        g, r = dates[d].get('gemini'), dates[d].get('readai')
        gs = f"{g['words']} palabras" + (' · con transcripción' if g.get('transcript') else '') if g else '—'
        rs = f"{r['words']} palabras" if r else '—'
        lines.append(f'| {d} | {gs} | {rs} |')
    lines.append('')
open(os.path.join(raw, 'INDEX.md'), 'w').write('\n'.join(lines))
print('\n' + '\n'.join(lines[:3]))
print('reuniones:', {names[k]: len(v) for k, v in index.items()})
