# Inyecta en el artifact la especificación y el CSS reales de la base (tools/ui/spec.json, theme.css y
# workbench.css), así la sección de componentes dibuja con lo mismo que usan las herramientas y no puede
# quedar desactualizada. Idempotente: reemplaza lo que haya entre los dos <script> de datos.
# Correr desde la raíz del repo:  python3 tablero/tasks/playground-local/artifacts/build.py
import json, pathlib, re
root = pathlib.Path(__file__).resolve().parents[4]
page = pathlib.Path(__file__).with_name('anatomia-del-workbench.html')
spec = json.loads((root / 'tools/ui/spec.json').read_text(encoding='utf-8'))
css = (root / 'tools/ui/theme.css').read_text(encoding='utf-8') + '\n' + (root / 'tools/ui/workbench.css').read_text(encoding='utf-8')
html = page.read_text(encoding='utf-8')
spec_txt = json.dumps(spec, ensure_ascii=False).replace('</', '<\\/')
css_txt = css.replace('</', '<\\/')
html = re.sub(r'(<script type="application/json" id="ui-spec">).*?(</script>)', lambda m: m.group(1) + spec_txt + m.group(2), html, flags=re.S)
html = re.sub(r'(<script type="text/plain" id="ui-css">).*?(</script>)', lambda m: m.group(1) + css_txt + m.group(2), html, flags=re.S)
# Los iconos: el interior de cada SVG de Lucide, por el nombre de la base (tools/ui/icons.json).
icons_cfg = json.loads((root / 'tools/ui/icons.json').read_text(encoding='utf-8'))
lucide = root / 'harness/node_modules/lucide-static/icons'
def inner(name):
    svg = re.sub(r'<!--.*?-->', '', (lucide / f'{name}.svg').read_text(encoding='utf-8'), flags=re.S)
    return re.sub(r'\s+', ' ', re.search(r'<svg[^>]*>(.*)</svg>', svg, re.S).group(1)).replace('> <', '><').strip()
icons = {n: inner(l) for n, l in icons_cfg['icons'].items()}
html = re.sub(r'(<script type="application/json" id="ui-icons">).*?(</script>)', lambda m: m.group(1) + json.dumps(icons).replace('</', '<\\/') + m.group(2), html, flags=re.S)
page.write_text(html, encoding='utf-8')
print(f'{page.name}: {len(spec["components"])} componentes · {len(icons)} iconos de Lucide · {len(css) // 1024} KB de CSS')
