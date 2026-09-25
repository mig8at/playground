# Mide, por herramienta, los valores LITERALES de estilo que escribe cada una en sus propias hojas y
# templates (sin theme.css ni workbench.css): tamaños de fuente, pesos, radios y espacios distintos, y los
# iconos que pinta con ui-icon. Lo que va por var() no se cuenta: por eso el visor sale casi en cero.
# Correr desde la raíz del repo:  python3 tablero/tasks/playground-local/artifacts/medir-estilo.py
import re,os,collections,sys
TOOLS={'harness':['harness/panel'],'tablero':['tablero/src'],'trazador':['trazador/src'],'visor':['visor/src']}
SKIP=('theme.css','workbench.css','workbench.js','node_modules','dist')
def files(d):
    for root,ds,fs in os.walk(d):
        if any(s in root for s in ('node_modules','dist')): continue
        for f in fs:
            if f.endswith(('.vue','.css','.html','.ts','.js')) and f not in SKIP: yield os.path.join(root,f)
def styles(txt,path):
    if path.endswith('.css'): return txt
    out=' '.join(re.findall(r'<style[^>]*>(.*?)</style>',txt,re.S))
    out+=' '+' '.join(re.findall(r'style="([^"]*)"',txt))
    return out
props={'font-size':collections.Counter(),'font-weight':collections.Counter(),'space':collections.Counter(),'radius':collections.Counter(),'family':collections.Counter()}
glyph=collections.Counter(); uiicon=collections.Counter(); emoji=collections.Counter()
per={}
GLY=set('⧉✕✓✗×▾▸▴◂◀▶⟳↻↺⋯…●○◉⚠⛔★☆⌨⌥⤓⤒⇣⇡↓↑→←⊕⊖⎘')
for t,ds in TOOLS.items():
    c={k:collections.Counter() for k in props}; g=collections.Counter(); ui=collections.Counter()
    for d in ds:
        for p in files(d):
            try: txt=open(p,encoding='utf-8').read()
            except: continue
            s=styles(txt,p)
            for v in re.findall(r'font-size\s*:\s*([^;}"]+)',s): c['font-size'][v.strip()]+=1
            for v in re.findall(r'font-weight\s*:\s*([^;}"]+)',s): c['font-weight'][v.strip()]+=1
            for v in re.findall(r'font-family\s*:\s*([^;}"]+)',s): c['family'][v.strip()[:40]]+=1
            for v in re.findall(r'(?:padding|margin|gap)(?:-[a-z]+)?\s*:\s*([^;}"]+)',s):
                for tok in v.split():
                    if re.match(r'-?\d',tok) and tok not in('0',): c['space'][tok]+=1
            for v in re.findall(r'border-radius\s*:\s*([^;}"]+)',s): c['radius'][v.strip()]+=1
            if not p.endswith('.css'):
                tmpl=re.sub(r'<style.*?</style>','',txt,flags=re.S)
                for ch in tmpl:
                    if ch in GLY: g[ch]+=1
                for v in re.findall(r'data-icon="([a-z-]+)"',tmpl): ui[v]+=1
    per[t]=(c,g,ui)
for t,(c,g,ui) in per.items():
    print('=====',t)
    for k in ['font-size','font-weight','family','radius']:
        print(f'  {k} ({len(c[k])} distintos):',', '.join(f'{v}×{n}' for v,n in c[k].most_common(22)))
    print(f'  space ({len(c["space"])} distintos):',', '.join(f'{v}×{n}' for v,n in c['space'].most_common(30)))
    print('  glifos sueltos:',sum(g.values()),dict(g.most_common(20)))
    print('  ui-icon:',sum(ui.values()),dict(ui.most_common(25)))
