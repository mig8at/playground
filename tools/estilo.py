#!/usr/bin/env python3
"""¿las cuatro herramientas comparten de VERDAD un solo tema?

Existe porque la afirmación «`context`, `harness/panel`, `tablero` y `trazador` usan el mismo
`tema.css`» es exactamente el tipo de cosa que se escribe una vez en un comentario y deja de ser
cierta sin que nadie se entere. Acá se CABLEA: si los cuatro archivos se separan, esto lo dice.

Cuatro chequeos, y los cuatro salieron de un error real:

  1. el tema es IDÉNTICO en las cuatro (md5). Si no, ya no hay un tema: hay cuatro.
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

RAIZ = pathlib.Path(__file__).resolve().parent.parent
TEMAS = ['context/src/tema.css', 'harness/panel/tema.css', 'tablero/src/tema.css', 'trazador/src/tema.css']
HOJAS = {
    'context':  ['context/src/styles.css'],
    'harness':  ['harness/panel/index.html'],
    'tablero':  ['tablero/src/styles.css'],
    'trazador': ['trazador/src/estilo.css'],
}
ARBOLES = {'context': 'context/src', 'tablero': 'tablero/src', 'trazador': 'trazador/src'}

# ── color ────────────────────────────────────────────────────────────────────────────────────────
def _lin(c): return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
def _delin(c): return 12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055

def _hex_a_oklab(h):
    h = h.lstrip('#')
    if len(h) == 3: h = ''.join(c * 2 for c in h)
    r, g, b = [_lin(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4)]
    l = (0.4122214708*r + 0.5363325363*g + 0.0514459929*b) ** (1/3)
    m = (0.2119034982*r + 0.6806995451*g + 0.1073969566*b) ** (1/3)
    s = (0.0883024619*r + 0.2817188376*g + 0.6299787005*b) ** (1/3)
    return (0.2104542553*l + 0.7936177850*m - 0.0040720468*s,
            1.9779984951*l - 2.4285922050*m + 0.4505937099*s,
            0.0259040371*l + 0.7827717662*m - 0.8086757660*s)

def _oklab_a_hex(L, a, bb):
    l = (L + 0.3963377774*a + 0.2158037573*bb) ** 3
    m = (L - 0.1055613458*a - 0.0638541728*bb) ** 3
    s = (L - 0.0894841775*a - 1.2914855480*bb) ** 3
    r =  4.0767416621*l - 3.3077115913*m + 0.2309699292*s
    g = -1.2684380046*l + 2.6097574011*m - 0.3413193965*s
    b = -0.0041960863*l - 0.7034186147*m + 1.7076147010*s
    f = lambda x: max(0, min(255, round(_delin(max(0.0, min(1.0, x))) * 255)))
    return '#%02x%02x%02x' % (f(r), f(g), f(b))

def luminancia(h):
    h = h.lstrip('#')
    if len(h) == 3: h = ''.join(c * 2 for c in h)
    r, g, b = [_lin(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4)]
    return .2126*r + .7152*g + .0722*b

def contraste(a, b):
    la, lb = luminancia(a), luminancia(b)
    return round((max(la, lb) + .05) / (min(la, lb) + .05), 2)

def _partes(s):
    """parte por comas de primer nivel (las de adentro de un paréntesis no cuentan)"""
    out, nivel, act = [], 0, ''
    for ch in s:
        if ch == '(': nivel += 1
        elif ch == ')': nivel -= 1
        if ch == ',' and nivel == 0: out.append(act); act = ''
        else: act += ch
    if act.strip(): out.append(act)
    return [p.strip() for p in out]

def resolver(expr, tabla, prof=0):
    """un valor CSS hasta su hex, o None si no se puede evaluar sin navegador"""
    if prof > 12: return None
    e = expr.strip().rstrip(';').strip()
    if re.fullmatch(r'#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6}', e): return e.lower()
    m = re.fullmatch(r'var\(\s*(--[a-z0-9-]+)\s*(?:,(.+))?\)', e, re.S)
    if m:
        nom, fb = m.group(1), m.group(2)
        if nom in tabla: return resolver(tabla[nom], tabla, prof + 1)
        return resolver(fb, tabla, prof + 1) if fb else None
    m = re.fullmatch(r'oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)\s*\)', e)
    if m:
        L = float(m.group(1).rstrip('%')) / (100 if '%' in m.group(1) else 1)
        C, H = float(m.group(2)), math.radians(float(m.group(3)))
        return _oklab_a_hex(L, C * math.cos(H), C * math.sin(H))
    m = re.fullmatch(r'color-mix\(\s*in\s+(oklab|oklch|srgb)\s*,(.+)\)', e, re.S)
    if m:
        espacio, resto = m.group(1), _partes(m.group(2))
        if len(resto) != 2: return None
        col, pcts = [], []
        for p in resto:
            mm = re.fullmatch(r'(.+?)\s+([\d.]+)%', p)
            col.append(resolver(mm.group(1) if mm else p, tabla, prof + 1))
            pcts.append(float(mm.group(2)) / 100 if mm else None)
        if None in col: return None
        p0 = pcts[0] if pcts[0] is not None else (1 - pcts[1] if pcts[1] is not None else .5)
        if espacio == 'srgb':
            a, b = [x.lstrip('#') for x in col]
            a, b = [[int(x[i:i+2], 16) for i in (0, 2, 4)] for x in (a, b)]
            return '#%02x%02x%02x' % tuple(round(a[i]*p0 + b[i]*(1-p0)) for i in range(3))
        A, B = _hex_a_oklab(col[0]), _hex_a_oklab(col[1])   # oklch se evalúa como oklab: sólo se usa
        return _oklab_a_hex(*[A[i]*p0 + B[i]*(1-p0) for i in range(3)])  # para el chequeo 2, que lo prohíbe
    return None

# ── lectura ──────────────────────────────────────────────────────────────────────────────────────
def css_de(ruta: pathlib.Path) -> str:
    t = ruta.read_text()
    if ruta.suffix in ('.vue', '.html'):
        t = '\n'.join(re.findall(r'<style[^>]*>(.*?)</style>', t, re.S))
    return re.sub(r'/\*.*?\*/', '', t, flags=re.S)

def declaraciones(cuerpo):
    return dict(re.findall(r'([a-z-]+)\s*:\s*([^;]+)', cuerpo))

def tabla_de(tool):
    """los tokens del tema (bloque .dark) + el puente de esa herramienta"""
    tema = css_de(RAIZ / TEMAS[0])   # los cuatro son idénticos — el chequeo 1 es lo que lo garantiza
    tabla = {}
    for bloque in re.findall(r'\.dark\s*\{([^{}]*)\}', tema):
        tabla.update({k: v for k, v in declaraciones(bloque).items() if k.startswith('--')})
    for ruta in HOJAS[tool]:
        for sel, cuerpo in re.findall(r'([^{}]+)\{([^{}]*)\}', css_de(RAIZ / ruta)):
            if ':root' not in sel: continue
            tabla.update({k: v for k, v in declaraciones(cuerpo).items() if k.startswith('--')})
    return tabla

def archivos_de(tool):
    if tool in ARBOLES:
        return sorted(p for p in (RAIZ / ARBOLES[tool]).rglob('*') if p.suffix in ('.vue', '.css'))
    return [RAIZ / r for r in HOJAS[tool]]

# ── chequeos ─────────────────────────────────────────────────────────────────────────────────────
def main():
    fallo = False
    print('\n  1 · ¿el tema es el MISMO en las cuatro?')
    md5 = {}
    for r in TEMAS:
        p = RAIZ / r
        if not p.exists(): print(f'      ✗ falta {r}'); fallo = True; continue
        md5[r] = hashlib.md5(p.read_bytes()).hexdigest()
    if len(set(md5.values())) == 1 and len(md5) == len(TEMAS):
        print(f'      ✓ las {len(md5)}, md5 {list(md5.values())[0][:12]}')
        tema = css_de(RAIZ / TEMAS[0])
        bloques = re.findall(r'(?::root|\.dark)\s*\{([^{}]*)\}', tema)
        for fam in ('--font-sans', '--font-mono'):
            for b in bloques:
                for val in re.findall(re.escape(fam) + r':\s*([^;]+)', b):
                    if len(val.split(',')) < 3:
                        print(f'      ▲ {fam} sin cadena del sistema ({val.strip()[:40]}): en macOS cae en Helvetica')
    else:
        print('      ✗ NO coinciden — ya no hay un tema, hay varios:')
        for r, h in md5.items(): print(f'         {h[:12]}  {r}')
        fallo = True

    print('\n  2 · ¿alguien mezcla `in oklch`? (el hue 0 de los neutros tira el tinte al rojo)')
    malos = [(t, p.relative_to(RAIZ), css_de(p).count('color-mix(in oklch'))
             for t in HOJAS for p in archivos_de(t) if 'color-mix(in oklch' in css_de(p)]
    if malos:
        for t, p, n in malos: print(f'      ✗ {n}x  {p}')
        fallo = True
    else:
        print('      ✓ ninguno')

    print('\n  3 · contraste de las reglas que fijan color Y fondo')
    for tool in HOJAS:
        tabla, bajos, mirados = tabla_de(tool), [], 0
        for p in archivos_de(tool):
            for sel, cuerpo in re.findall(r'([^{}]+)\{([^{}]*)\}', css_de(p)):
                d = declaraciones(cuerpo)
                c, b = d.get('color'), d.get('background-color') or d.get('background')
                if not c or not b: continue
                b = b.split()[0]
                cr, br = resolver(c, tabla), resolver(b, tabla)
                if not cr or not br: continue
                mirados += 1
                r = contraste(cr, br)
                if r < 4.5: bajos.append((r, p.name, sel.strip()[:44], cr, br))
        marca = '✓' if not bajos else '▲'
        print(f'      {marca} {tool:9} {mirados:3} reglas evaluadas · {len(bajos)} abajo de 4,5:1')
        for r, f, s, cr, br in sorted(bajos):
            print(f'          {r:5}:1  {f:18} {s:44} {cr} sobre {br}')

    print('\n  4 · variables USADAS y nunca declaradas')
    for tool in HOJAS:
        usadas, declaradas, fb = {}, set(), set()
        for p in archivos_de(tool):
            t = p.read_text()
            for m in re.finditer(r'var\(\s*(--[a-z0-9-]+)\s*(,)?', t):
                usadas.setdefault(m.group(1), []).append(p.name)
                if m.group(2): fb.add(m.group(1))
            for m in re.finditer(r'(?:^|[;{]|\*/)\s*(--[a-z0-9-]+)\s*:', t): declaradas.add(m.group(1))
            for m in re.finditer(r"'(--[a-z0-9-]+)'\s*:", t): declaradas.add(m.group(1))  # las que ata el JS
        declaradas |= set(tabla_de(tool))
        huerf = {k: v for k, v in usadas.items() if k not in declaradas and k not in fb}
        if huerf:
            print(f'      ✗ {tool}: {len(huerf)}')
            for k, v in sorted(huerf.items(), key=lambda x: -len(x[1])):
                print(f'          {k:18} {len(v):3}x   ej. {v[0]}')
            fallo = True
        else:
            print(f'      ✓ {tool:9} {len(usadas)} usadas, todas declaradas')

    print()
    return 1 if fallo else 0

def repartir(origen=None):
    """el tema de las cuatro, de un solo archivo

    Existe porque «reemplazá `tema.css`» son en realidad CUATRO copias, y copiar cuatro veces a mano es
    exactamente como empiezan a derivar — que es el problema que todo esto vino a resolver. Sin `DE`
    no escribe nada: dice cuál está puesto."""
    if not origen:
        tema = (RAIZ / TEMAS[0]).read_text()
        pal = {}
        for b in re.findall(r'\.dark\s*\{([^{}]*)\}', tema):
            pal.update(declaraciones(b))
        tabla = {k: v for k, v in pal.items() if k.startswith('--')}
        print('\n  el tema puesto hoy (modo oscuro, resuelto a hex):\n')
        for n in ('--background', '--foreground', '--card', '--primary', '--secondary', '--muted',
                  '--muted-foreground', '--accent', '--destructive', '--border', '--input', '--ring'):
            v = tabla.get(n, '')
            print(f'      {n:20} {resolver(v, tabla) or v.strip()}')
        print(f"\n      --radius {tabla.get('--radius','').strip()}   ·   md5 "
              f"{hashlib.md5((RAIZ / TEMAS[0]).read_bytes()).hexdigest()[:12]}")
        print('\n  para cambiarlo:  make estilo-tema DE=<el .css que copiaste de tweakcn.com>\n')
        return 0
    src = pathlib.Path(origen)
    if not src.is_absolute(): src = RAIZ / src
    if not src.exists():
        print(f'  ✗ no existe {src}'); return 1
    txt = src.read_text()
    faltan = [b for b in (':root', '.dark', '@theme inline') if b not in txt]
    if faltan:
        print(f"  ✗ {src.name} no parece un export de tweakcn: le falta {', '.join(faltan)}")
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
    for r in TEMAS:
        (RAIZ / r).write_text(txt)
    print(f'  ✓ repartido a las {len(TEMAS)} · md5 {hashlib.md5(txt.encode()).hexdigest()[:12]}')
    print('     ⚠ el color SEMÁNTICO no viene en el export y no se toca: vive en la hoja de cada')
    print('       herramienta (estado de una etapa, carril de un ramal, semáforo). Revisalo si el')
    print('       tema nuevo cambia mucho de luminancia — `make estilo-check` mide el contraste.')
    return 0


if __name__ == '__main__':
    if '--tema' in sys.argv:
        i = sys.argv.index('--tema')
        sys.exit(repartir(sys.argv[i + 1] if len(sys.argv) > i + 1 else None))
    sys.exit(main())
