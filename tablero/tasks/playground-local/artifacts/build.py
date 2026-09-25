# Inyecta en el artifact la especificación y el CSS reales de la base (tools/ui/spec.json, tema.css y
# taller.css), así la sección de componentes dibuja con lo mismo que usan las herramientas y no puede
# quedar desactualizada. Idempotente: reemplaza lo que haya entre los dos <script> de datos.
# Correr desde la raíz del repo:  python3 tablero/tasks/playground-local/artifacts/build.py
import json, pathlib, re
root = pathlib.Path(__file__).resolve().parents[4]
page = pathlib.Path(__file__).with_name('anatomia-del-workbench.html')
spec = json.loads((root / 'tools/ui/spec.json').read_text(encoding='utf-8'))
css = (root / 'tools/ui/tema.css').read_text(encoding='utf-8') + '\n' + (root / 'tools/ui/taller.css').read_text(encoding='utf-8')
html = page.read_text(encoding='utf-8')
spec_txt = json.dumps(spec, ensure_ascii=False).replace('</', '<\\/')
css_txt = css.replace('</', '<\\/')
html = re.sub(r'(<script type="application/json" id="ui-spec">).*?(</script>)', lambda m: m.group(1) + spec_txt + m.group(2), html, flags=re.S)
html = re.sub(r'(<script type="text/plain" id="ui-css">).*?(</script>)', lambda m: m.group(1) + css_txt + m.group(2), html, flags=re.S)
page.write_text(html, encoding='utf-8')
print(f'{page.name}: {len(spec["components"])} componentes · {len(css) // 1024} KB de CSS')
