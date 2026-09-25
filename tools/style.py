#!/usr/bin/env python3
"""¿las tres herramientas comparten de VERDAD un solo tema?

Existe porque la afirmación «`harness/panel`, `tablero` y `trazador` usan el mismo
`theme.css`» es exactamente el tipo de cosa que se escribe una vez en un comentario y deja de ser
cierta sin que nadie se entere. Acá se CABLEA: si los archivos se separan, esto lo dice.

Cuatro chequeos, y los cuatro salieron de un error real:

  1. el tema es IDÉNTICO en las tres (md5). Si no, ya no hay un tema: hay tres.
  2. nadie mezcla `in oklch`. Los neutros de un export de tweakcn son `oklch(L 0 0)` —hue 0 = ROJO—,
     y en un espacio polar el `color-mix` interpola ese hue: un tinte verde sale marrón rojizo y
     nada falla. `in oklab` no tiene canal de hue.  (medido: verde 20% sobre la card daba #4d3530)
  3. contraste: toda regla que fija color Y fondo, resueltos hasta el hex real —var() encadenados,
     oklch y color-mix incluidos—, contra 4,5:1.
     ⚠ ALCANCE DECLARADO, no omnisciencia: sólo ve la regla que fija LAS DOS cosas. Cuando el fondo
     lo pone un ancestro —que es el caso más común— esto no lo puede saber sin un navegador. Para eso
     está el barrido sobre el DOM vivo, que recorre el árbol hacia arriba buscando el fondo real; los
     dos se complementan y ninguno reemplaza al otro. Un chequeo que finge ver todo es peor que uno
     que dice qué mira.
  4. variables USADAS y nunca declaradas. El navegador tira la declaración entera sin avisar, así que
     se ve como una vista sin estilo, no como un error. (medido: `scorecards/` del tablero tenía diez
     nombres de otra paleta y 60 declaraciones muertas.)

Sale 1 si algo del 1, 2 o 4 falla. El contraste se REPORTA y no bloquea: hay casos legítimos abajo de
4,5 (el canalón de números de línea de un visor de logs) y un umbral que obliga a mentir deja de
mirarse.
"""
import hashlib, math, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
THEMES = ['harness/panel/theme.css', 'tablero/src/theme.css', 'trazador/src/theme.css', 'visor/src/theme.css']
WORKSHOPS = ['harness/panel/workbench.css', 'tablero/src/workbench.css', 'trazador/src/workbench.css', 'visor/src/workbench.css']
REGIONS = ['workbench', 'titlebar', 'banner', 'activitybar', 'sidebar', 'editor',
            'panel', 'auxiliarybar', 'statusbar', 'region-head', 'region-body']
SHEETS = {
    'harness':  ['harness/panel/index.html'],
    'tablero':  ['tablero/src/styles.css'],
    'trazador': ['trazador/src/style.css'],
    'visor':    ['visor/src/style.css'],
}
TREES = {'tablero': 'tablero/src', 'trazador': 'trazador/src', 'visor': 'visor/src'}

# ── color ────────────────────────────────────────────────────────────────────────────────────────
def _lin(c): return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
def _delimit(c): return 12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055

def _hex_to_oklab(h):
    h = h.lstrip('#')
    if len(h) == 3: h = ''.join(c * 2 for c in h)
    r, g, b = [_lin(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4)]
    l = (0.4122214708*r + 0.5363325363*g + 0.0514459929*b) ** (1/3)
    m = (0.2119034982*r + 0.6806995451*g + 0.1073969566*b) ** (1/3)
    s = (0.0883024619*r + 0.2817188376*g + 0.6299787005*b) ** (1/3)
    return (0.2104542553*l + 0.7936177850*m - 0.0040720468*s,
            1.9779984951*l - 2.4285922050*m + 0.4505937099*s,
            0.0259040371*l + 0.7827717662*m - 0.8086757660*s)

def _oklab_to_hex(L, a, bb):
    l = (L + 0.3963377774*a + 0.2158037573*bb) ** 3
    m = (L - 0.1055613458*a - 0.0638541728*bb) ** 3
    s = (L - 0.0894841775*a - 1.2914855480*bb) ** 3
    r =  4.0767416621*l - 3.3077115913*m + 0.2309699292*s
    g = -1.2684380046*l + 2.6097574011*m - 0.3413193965*s
    b = -0.0041960863*l - 0.7034186147*m + 1.7076147010*s
    f = lambda x: max(0, min(255, round(_delimit(max(0.0, min(1.0, x))) * 255)))
    return '#%02x%02x%02x' % (f(r), f(g), f(b))

def luminance(h):
    h = h.lstrip('#')
    if len(h) == 3: h = ''.join(c * 2 for c in h)
    r, g, b = [_lin(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4)]
    return .2126*r + .7152*g + .0722*b

def contrast(a, b):
    la, lb = luminance(a), luminance(b)
    return round((max(la, lb) + .05) / (min(la, lb) + .05), 2)

def _parts(s):
    """parte por comas de primer nivel (las de adentro de un paréntesis no cuentan)"""
    out, level, act = [], 0, ''
    for ch in s:
        if ch == '(': level += 1
        elif ch == ')': level -= 1
        if ch == ',' and level == 0: out.append(act); act = ''
        else: act += ch
    if act.strip(): out.append(act)
    return [p.strip() for p in out]

def resolver(expr, table, prof=0):
    """un valor CSS hasta su hex, o None si no se puede evaluar sin navegador"""
    if prof > 12: return None
    e = expr.strip().rstrip(';').strip()
    if re.fullmatch(r'#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6}', e): return e.lower()
    m = re.fullmatch(r'var\(\s*(--[a-z0-9-]+)\s*(?:,(.+))?\)', e, re.S)
    if m:
        nom, fb = m.group(1), m.group(2)
        if nom in table: return resolver(table[nom], table, prof + 1)
        return resolver(fb, table, prof + 1) if fb else None
    m = re.fullmatch(r'oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)\s*\)', e)
    if m:
        L = float(m.group(1).rstrip('%')) / (100 if '%' in m.group(1) else 1)
        C, H = float(m.group(2)), math.radians(float(m.group(3)))
        return _oklab_to_hex(L, C * math.cos(H), C * math.sin(H))
    m = re.fullmatch(r'color-mix\(\s*in\s+(oklab|oklch|srgb)\s*,(.+)\)', e, re.S)
    if m:
        space, rest = m.group(1), _parts(m.group(2))
        if len(rest) != 2: return None
        col, pcts = [], []
        for p in rest:
            mm = re.fullmatch(r'(.+?)\s+([\d.]+)%', p)
            col.append(resolver(mm.group(1) if mm else p, table, prof + 1))
            pcts.append(float(mm.group(2)) / 100 if mm else None)
        if None in col: return None
        p0 = pcts[0] if pcts[0] is not None else (1 - pcts[1] if pcts[1] is not None else .5)
        if space == 'srgb':
            a, b = [x.lstrip('#') for x in col]
            a, b = [[int(x[i:i+2], 16) for i in (0, 2, 4)] for x in (a, b)]
            return '#%02x%02x%02x' % tuple(round(a[i]*p0 + b[i]*(1-p0)) for i in range(3))
        A, B = _hex_to_oklab(col[0]), _hex_to_oklab(col[1])   # oklch se evalúa como oklab: sólo se usa
        return _oklab_to_hex(*[A[i]*p0 + B[i]*(1-p0) for i in range(3)])  # para el chequeo 2, que lo prohíbe
    return None

# ── lectura ──────────────────────────────────────────────────────────────────────────────────────
def css_of(rel_path: pathlib.Path) -> str:
    t = rel_path.read_text()
    if rel_path.suffix in ('.vue', '.html'):
        t = '\n'.join(re.findall(r'<style[^>]*>(.*?)</style>', t, re.S))
    return re.sub(r'/\*.*?\*/', '', t, flags=re.S)

def css_of_text(t: str) -> str:
    blocks = re.findall(r'<style[^>]*>(.*?)</style>', t, re.S)
    return re.sub(r'/\*.*?\*/', '', '\n'.join(blocks) if blocks else t, flags=re.S)

def declarations(body):
    # ⚠ `[a-z0-9-]` y no `[a-z-]`: sin el dígito, cualquier token con número en el nombre es INVISIBLE
    # para el chequeo. Lo encontró `--fg-2` de la rampa, que salía como «usada y nunca declarada»
    # estando declarada tres líneas más arriba. Un chequeo que no ve un nombre no lo reporta mal: lo
    # reporta al revés.
    return dict(re.findall(r'([a-z0-9-]+)\s*:\s*([^;]+)', body))

def table_of(tool):
    """los tokens del tema (bloque .dark) + el puente de esa herramienta"""
    theme = css_of(ROOT / THEMES[0])   # los tres son idénticos — el chequeo 1 es lo que lo garantiza
    table = {}
    for block in re.findall(r'\.dark\s*\{([^{}]*)\}', theme):
        table.update({k: v for k, v in declarations(block).items() if k.startswith('--')})
    # ⚠ Y el `@theme inline` del tema, que es donde tweakcn pone los derivados (`--radius-sm/md/lg`,
    #    los `--color-*`). Leyendo sólo `.dark` quedaban afuera y salían como no declarados.
    for block in re.findall(r'@theme[^{]*\{([^{}]*)\}', theme):
        table.update({k: v for k, v in declarations(block).items() if k.startswith('--')})
    # y las MEDIDAS y la rampa de texto, que viven en el otro compartido
    for block in re.findall(r':root\s*\{([^{}]*)\}', css_of(ROOT / WORKSHOPS[0])):
        table.update({k: v for k, v in declarations(block).items() if k.startswith('--')})
    for rel_path in SHEETS[tool]:
        for sel, body in re.findall(r'([^{}]+)\{([^{}]*)\}', css_of(ROOT / rel_path)):
            if ':root' not in sel: continue
            table.update({k: v for k, v in declarations(body).items() if k.startswith('--')})
    return table

def files_of(tool):
    if tool in TREES:
        return sorted(p for p in (ROOT / TREES[tool]).rglob('*') if p.suffix in ('.vue', '.css'))
    return [ROOT / r for r in SHEETS[tool]]

SHARED = {'theme.css', 'workbench.css'}

def own_of(tool):
    """lo que escribió ESTA herramienta, sin los dos archivos compartidos.

    ⚠ Preguntarle a una herramienta «¿usás .workbench?» leyendo el archivo que DEFINE `.workbench`
    contesta que sí siempre. Un chequeo que se lee a sí mismo no mide nada — pasó en la primera
    corrida: context y tablero aparecían usando las nueve regiones sin usar ninguna."""
    return [p for p in files_of(tool) if p.name not in SHARED]

# ── chequeos ─────────────────────────────────────────────────────────────────────────────────────
def main():
    failure = False
    print('\n  1 · ¿los archivos COMPARTIDOS son los mismos en las tres?')
    for label, listing in (('theme.css  (el color)', THEMES), ('workbench.css (la estructura)', WORKSHOPS)):
        m = {}
        for r in listing:
            q = ROOT / r
            if not q.exists(): print(f'      ✗ falta {r}'); failure = True; continue
            m[r] = hashlib.md5(q.read_bytes()).hexdigest()
        if len(set(m.values())) == 1 and len(m) == len(listing):
            print(f'      ✓ {label:26} las {len(m)}, md5 {list(m.values())[0][:12]}')
        else:
            print(f'      ✗ {label} NO coinciden — ya no hay uno, hay varios:')
            for r, h in m.items(): print(f'         {h[:12]}  {r}')
            failure = True
    md5 = {r: hashlib.md5((ROOT / r).read_bytes()).hexdigest() for r in THEMES if (ROOT / r).exists()}
    if len(set(md5.values())) == 1 and len(md5) == len(THEMES):
        theme = css_of(ROOT / THEMES[0])
        blocks = re.findall(r'(?::root|\.dark)\s*\{([^{}]*)\}', theme)
        for fam in ('--font-sans', '--font-mono'):
            for b in blocks:
                for val in re.findall(re.escape(fam) + r':\s*([^;]+)', b):
                    if len(val.split(',')) < 3:
                        print(f'      ▲ {fam} sin cadena del sistema ({val.strip()[:40]}): en macOS cae en Helvetica')
    else:
        print('      ✗ NO coinciden — ya no hay un tema, hay varios:')
        for r, h in md5.items(): print(f'         {h[:12]}  {r}')
        failure = True

    print('\n  2 · ¿alguien mezcla `in oklch`? (el hue 0 de los neutros tira el tinte al rojo)')
    bad = [(t, p.relative_to(ROOT), css_of(p).count('color-mix(in oklch'))
             for t in SHEETS for p in files_of(t) if 'color-mix(in oklch' in css_of(p)]
    if bad:
        for t, p, n in bad: print(f'      ✗ {n}x  {p}')
        failure = True
    else:
        print('      ✓ ninguno')

    print('\n  3 · contraste de las reglas que fijan color Y fondo')
    for tool in SHEETS:
        table, below, checked = table_of(tool), [], 0
        for p in files_of(tool):
            for sel, body in re.findall(r'([^{}]+)\{([^{}]*)\}', css_of(p)):
                d = declarations(body)
                c, b = d.get('color'), d.get('background-color') or d.get('background')
                if not c or not b: continue
                b = b.split()[0]
                cr, br = resolver(c, table), resolver(b, table)
                if not cr or not br: continue
                checked += 1
                r = contrast(cr, br)
                if r < 4.5: below.append((r, p.name, sel.strip()[:44], cr, br))
        mark = '✓' if not below else '▲'
        print(f'      {mark} {tool:9} {checked:3} reglas evaluadas · {len(below)} abajo de 4,5:1')
        for r, f, s, cr, br in sorted(below):
            print(f'          {r:5}:1  {f:18} {s:44} {cr} sobre {br}')

    print('\n  4 · variables USADAS y nunca declaradas')
    for tool in SHEETS:
        usadas, declared, fb = {}, set(), set()
        for p in files_of(tool):
            t = p.read_text()
            for m in re.finditer(r'var\(\s*(--[a-z0-9-]+)\s*(,)?', t):
                usadas.setdefault(m.group(1), []).append(p.name)
                if m.group(2): fb.add(m.group(1))
            for m in re.finditer(r'(?:^|[;{]|\*/)\s*(--[a-z0-9-]+)\s*:', t): declared.add(m.group(1))
            for m in re.finditer(r"'(--[a-z0-9-]+)'\s*:", t): declared.add(m.group(1))  # las que ata el JS
        declared |= set(table_of(tool))
        orphan = {k: v for k, v in usadas.items() if k not in declared and k not in fb}
        if orphan:
            print(f'      ✗ {tool}: {len(orphan)}')
            for k, v in sorted(orphan.items(), key=lambda x: -len(x[1])):
                print(f'          {k:18} {len(v):3}x   ej. {v[0]}')
            failure = True
        else:
            print(f'      ✓ {tool:9} {len(usadas)} usadas, todas declaradas')

    print('\n  5 · el contrato de scroll: la app ocupa la ventana y scrollea cada región')
    for tool in SHEETS:
        css = '\n'.join(css_of(p) for p in own_of(tool))
        uses_wb = 'class="workbench"' in ''.join(p.read_text() for p in own_of(tool))
        height = bool(re.search(r'html[^{]*body[^{]*\{[^}]*height:\s*100%', css))
        hidden = any(re.search(r'overflow:\s*hidden', b) for sel, b in
                     re.findall(r'([^{}]+)\{([^{}]*)\}', css) if re.search(r'(^|,)\s*body\s*(,|$)', sel))
        passes = height and hidden
        # ⚠ el atajo que el taller prohíbe: fingir el contrato con una altura en vh. El día que el
        #    header crezca una línea, ese número miente y la columna se corta sin que nadie lo note.
        faked = [] if passes else [(q.name, m) for q in own_of(tool)
                                     for m in re.findall(r'max-height:\s*\d+vh', css_of(q))]
        if passes:
            print(f'      ✓ {tool:9} lo cumple{" (con la grilla `.workbench`)" if uses_wb else " (con su propio layout)"}')
        elif uses_wb:
            # declarar la grilla y no sostener el contrato SÍ es un error: el statusbar se va abajo
            # del borde de la ventana y nadie lo ve.
            print(f'      ✗ {tool:9} declara `.workbench` pero NO lo cumple · html+body 100%: {"sí" if height else "NO"} · body overflow:hidden: {"sí" if hidden else "NO"}')
            failure = True
        else:
            print(f'      · {tool:9} página que scrollea — legítimo, es una vista de lectura')
        for n, m in faked:
            print(f'          ▲ {n}: `{m}` finge el contrato de scroll')

    # ── 6 · COLOR LITERAL ────────────────────────────────────────────────────────────────────────
    #    Un `#d8a657` o un `rgba(23,26,33,.93)` escrito adentro de una regla NO lo alcanza un tema
    #    nuevo: pegar un export de tweakcn encima lo deja intacto, y así se destiñe una UI de a un
    #    detalle por vez. Declararlo como token es lo que pone la palanca en un solo lugar.
    #    ⚠ Dos excepciones, y son reales: la DECLARACIÓN de un token (`--ok: #22c55e`) es
    #    precisamente dónde va el literal, y la sombra de un popover es negra en cualquier tema.
    print('\n  6 · color literal adentro de una regla (un tema nuevo no lo alcanza)')
    LITERAL = re.compile(r'#[0-9a-fA-F]{3,8}\b|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%]+\)')
    for tool in SHEETS:
        loose = []
        for q in own_of(tool):
            css = re.sub(r'/\*.*?\*/', '', css_of(q), flags=re.S)
            for n, line in enumerate(css.split('\n'), 1):
                if not LITERAL.search(line): continue
                if re.match(r'\s*--[\w-]+\s*:', line): continue        # declara un token
                if 'box-shadow' in line or 'drop-shadow' in line: continue
                loose.append((q.name, ' '.join(line.split())[:66]))
        if loose:
            print(f'      ✗ {tool}: {len(loose)}')
            for n, l in loose[:6]: print(f'          {n:18} {l}')
            if len(loose) > 6: print(f'          … y {len(loose)-6} más')
            failure = True
        else:
            print(f'      ✓ {tool:9} sin literales sueltos')

    # ── 7 · REGLAS VACÍAS ────────────────────────────────────────────────────────────────────────
    #    Una regla sin declaraciones es cromo que alguien anuló en vez de borrar, o un bloque que se
    #    quedó sin contenido al mudar sus valores. Se lee como intención y no hace nada.
    print('\n  7 · reglas y media queries que quedaron vacías')
    for tool in SHEETS:
        empty = []
        for q in own_of(tool):
            css = re.sub(r'/\*.*?\*/', ' ', css_of(q), flags=re.S)
            for m in re.finditer(r'(?m)^[ \t]*([^{}\n][^{}]*?)\{\s*\}', css):
                empty.append((q.name, ' '.join(m.group(1).split())[:56]))
            for m in re.finditer(r'@media([^{]*)\{\s*\}', css):
                empty.append((q.name, '@media' + ' '.join(m.group(1).split())[:50]))
        if empty:
            print(f'      ✗ {tool}: {len(empty)}')
            for n, sel in empty[:6]: print(f'          {n:18} {sel} {{ }}')
            failure = True
        else:
            print(f'      ✓ {tool:9} ninguna')

    print('\n  8 · dos componentes en el MISMO elemento (el choque de nombres)')
    # ⚠ Este chequeo existe porque el mismo error se cometió DOS VECES, y las dos veces en silencio:
    #   `.empty`  el tablero llamaba así a una nota de una línea; el componente se la comió y 16 notas
    #             salieron centradas a media columna.
    #   `.alert`  el tablero lo usaba como modificador de `.stat`; el componente es `display: grid`
    #             con una primera columna de 16px, así que el rótulo y la leyenda de dos indicadores
    #             midieron **0 px de ancho** y se leían una letra por renglón.
    # Ninguno de los dos falla: se ven como un diseño feo. Lo que los delata es el MARKUP, y el markup
    # está en el selector — `.stat.alert` dice que un elemento lleva las dos clases.
    #
    # La condición, y cada parte saca un falso positivo que hubo de verdad:
    #   · las dos son RAÍZ (se declaran solas, o sea cada una trae su propia forma);
    #   · la del bloque compartido impone LAYOUT (`display`, `position`, `grid-template-*`,
    #     `flex-direction`). Es lo que convierte al elemento en otra cosa y lo que hizo el daño las dos
    #     veces; un componente que sólo pone un borde —`.accordion-item`— no se lleva a nadie puesto,
    #     y sin esta parte el chequeo acusaba a `.bdq.accordion-item`, que es el patrón CORRECTO;
    #   · y la de la herramienta NO se nombra en el compartido ni una vez, que es lo que deja pasar
    #     `.region-head.group`: ahí el nombre es vocabulario prestado, no una coincidencia.
    taller = css_of(ROOT / WORKSHOPS[0])
    LAYOUT = ('display', 'position', 'grid-template-columns', 'grid-template-rows', 'flex-direction')
    def roots(css, require_layout=False):
        out = set()
        for sel, body in re.findall(r'([^{}]+)\{([^{}]*)\}', css):
            if require_layout and not any(re.search(r'(?:^|;)\s*' + k + r'\s*:', body) for k in LAYOUT):
                continue
            for part in sel.split(','):
                part = part.strip()
                if re.fullmatch(r'\.[a-z][a-z0-9-]*', part): out.add(part[1:])
        return out
    shared_root = roots(taller, require_layout=True)
    names_workshop = set(re.findall(r'\.([a-z][a-z0-9-]*)', taller))
    for tool in SHEETS:
        css_tool = '\n'.join(css_of(q) for q in own_of(tool))
        own = {c for c in roots(css_tool) if c not in names_workshop}
        clashes = []
        for sel, _ in re.findall(r'([^{}]+)\{([^{}]*)\}', css_tool):
            for composite in re.findall(r'\.[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+', sel):
                cls = composite.split('.')[1:]
                owner = [c for c in cls if c in own]
                guest = [c for c in cls if c in shared_root]
                if owner and guest:
                    clashes.append((' '.join(sel.split())[:44], owner[0], guest[0]))
        if clashes:
            print(f'      ✗ {tool}: {len(clashes)}')
            for sel, d, i in clashes[:6]:
                print(f'          {sel:46} — `.{d}` ya era un componente de la herramienta y `.{i}` le cae encima')
            print('          Renombrá el de la herramienta: el compartido lo usan las tres.')
            failure = True
        else:
            print(f'      ✓ {tool:9} ninguno')

    print('\n  9 · qué región usa cada herramienta')
    for tool in SHEETS:
        text_value = '\n'.join(p.read_text() for p in own_of(tool))
        text_value = re.sub(r'<!--.*?-->', '', text_value, flags=re.S)   # lo comentado no cuenta como usado
        uses = [r for r in REGIONS
               if re.search(r'class="[^"]*(?<![-\w])' + re.escape(r) + r'(?![-\w])', text_value)
               or re.search(r'(?<![-\w])\.' + re.escape(r) + r'(?![-\w])', css_of_text(text_value))]
        print(f'      {tool:9} {" · ".join(uses) if uses else "(ninguna todavía)"}')

    print()
    return 1 if failure else 0

def distribute(origin=None):
    """el tema de las tres, de un solo archivo

    Existe porque «reemplazá `theme.css`» son en realidad TRES copias, y copiar tres veces a mano es
    exactamente como empiezan a derivar — que es el problema que todo esto vino a resolver. Sin `DE`
    no escribe nada: dice cuál está puesto."""
    if not origin:
        theme = (ROOT / THEMES[0]).read_text()
        pal = {}
        for b in re.findall(r'\.dark\s*\{([^{}]*)\}', theme):
            pal.update(declarations(b))
        table = {k: v for k, v in pal.items() if k.startswith('--')}
        print('\n  el tema puesto hoy (modo oscuro, resuelto a hex):\n')
        for n in ('--background', '--foreground', '--card', '--primary', '--secondary', '--muted',
                  '--muted-foreground', '--accent', '--destructive', '--border', '--input', '--ring'):
            v = table.get(n, '')
            print(f'      {n:20} {resolver(v, table) or v.strip()}')
        print(f"\n      --radius {table.get('--radius','').strip()}   ·   md5 "
              f"{hashlib.md5((ROOT / THEMES[0]).read_bytes()).hexdigest()[:12]}")
        print('\n  para cambiarlo:  make estilo-tema DE=<el .css que copiaste de tweakcn.com>\n')
        return 0
    src = pathlib.Path(origin)
    if not src.is_absolute(): src = ROOT / src
    if not src.exists():
        print(f'  ✗ no existe {src}'); return 1
    txt = src.read_text()
    missing = [b for b in (':root', '.dark', '@theme inline') if b not in txt]
    if missing:
        print(f"  ✗ {src.name} no parece un export de tweakcn: le falta {', '.join(missing)}")
        print('     (pegá el bloque COMPLETO, con :root, .dark y @theme inline)')
        return 1
    if '@import "tailwindcss"' in txt:
        print('  ▲ le saco el `@import "tailwindcss"`: en el panel del harness no hay bundler y ese')
        print('     import daría 404. Cada app de Vite ya lo importa en su propia hoja.')
        txt = re.sub(r'@import\s+"tailwindcss"[^;]*;\s*', '', txt)
    for fam in ('--font-sans', '--font-mono'):
        for b in re.findall(r'(?::root|\.dark)\s*\{([^{}]*)\}', txt):
            for val in re.findall(re.escape(fam) + r':\s*([^;]+)', b):
                if len(val.split(',')) < 3:
                    print(f'  ▲ {fam} = {val.strip()} — sin cadena del sistema. En macOS cae en Helvetica:')
                    print('     agregale `-apple-system, BlinkMacSystemFont, "Segoe UI", …` antes de la genérica.')
    (ROOT / 'tools/ui/theme.css').write_text(txt)
    for r in THEMES:
        (ROOT / r).write_text(txt)
    print(f'  ✓ repartido a las {len(THEMES)} · md5 {hashlib.md5(txt.encode()).hexdigest()[:12]}')
    print('     ⚠ el color SEMÁNTICO no viene en el export y no se toca: vive en la hoja de cada')
    print('       herramienta (estado de una etapa, carril de un ramal, semáforo). Revisalo si el')
    print('       tema nuevo cambia mucho de luminancia — `make estilo-check` mide el contraste.')
    return 0


if __name__ == '__main__':
    if '--tema' in sys.argv:
        i = sys.argv.index('--tema')
        sys.exit(distribute(sys.argv[i + 1] if len(sys.argv) > i + 1 else None))
    sys.exit(main())
