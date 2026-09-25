// El bloque de iconos de workbench.css sale de Lucide, no se dibuja. Lee tools/ui/icons.json (nombre de la
// base → icono de Lucide), toma cada SVG de lucide-static tal cual y escribe el bloque entre los marcadores
// `<icons>` y `</icons>`. Con --check no escribe: sale ≠0 si el bloque no es el que saldría, si queda un
// icono definido fuera del bloque, o si una herramienta pide un `data-icon` que no está en la lista.
//
//   make estilo-iconos          genera el bloque
//   make estilo-check           lo comprueba (junto con lo demás)
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'harness/package.json'));
const cfg = JSON.parse(readFileSync(join(root, 'tools/ui/icons.json'), 'utf8'));
const lucideDir = dirname(require.resolve('lucide-static/package.json'));
const installed = JSON.parse(readFileSync(join(lucideDir, 'package.json'), 'utf8')).version;
const check = process.argv.includes('--check');
const fail = (msg) => { console.error(`  ✗ iconos: ${msg}`); process.exitCode = 1; };

if (installed !== cfg.version) fail(`icons.json fija ${cfg.library}@${cfg.version} y está instalado ${installed} (harness/node_modules)`);

// El SVG de la biblioteca, sin licencia, clase ni tamaño, con el trazo en negro: la máscara sólo lee el alfa.
function uri(name) {
  const svg = readFileSync(join(lucideDir, 'icons', `${name}.svg`), 'utf8')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s(class|width|height)="[^"]*"/g, '')
    .replace('stroke="currentColor"', 'stroke="black"')
    .replace(/\s+/g, ' ').replace(/> </g, '><').replace(/ \/>/g, '/>').replace('<svg ', '<svg ').trim();
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

const lines = [`/* <icons> — generado por tools/ui-icons.mjs desde ${cfg.library}@${cfg.version} según tools/ui/icons.json.`,
  `   No se edita a mano: un icono nuevo se ELIGE en Lucide y se suma a icons.json. */`];
for (const [name, lucide] of Object.entries(cfg.icons)) lines.push(`.ui-icon[data-icon="${name}"] { --ui-icon: ${uri(lucide)} } /* ${lucide} */`);
lines.push(`:root { --ui-icon-select: ${uri(cfg.select)} } /* ${cfg.select}: la flecha del .select */`);
lines.push('/* </icons> */');
const block = lines.join('\n');

const cssPath = join(root, 'tools/ui/workbench.css');
const css = readFileSync(cssPath, 'utf8');
const re = /\/\* <icons>[\s\S]*?\/\* <\/icons> \*\//;
if (!re.test(css)) { fail('workbench.css no tiene los marcadores <icons> … </icons>'); process.exit(1); }
if (check) {
  if (css.match(re)[0] !== block) fail('el bloque de workbench.css no es el que sale de icons.json (corré make estilo-iconos)');
} else if (css.match(re)[0] !== block) {
  writeFileSync(cssPath, css.replace(re, block));
  console.log(`  iconos: ${Object.keys(cfg.icons).length} desde ${cfg.library}@${cfg.version} → tools/ui/workbench.css`);
}

// Nada define un icono fuera del bloque, y nadie pide uno que no existe.
const tracked = execFileSync('git', ['ls-files', 'tools/ui', 'tablero/src', 'trazador/src', 'visor/src', 'harness/panel'], { cwd: root, encoding: 'utf8' })
  .split('\n').filter((f) => /\.(css|vue|js|html)$/.test(f) && !f.endsWith('workbench.css'));
const known = new Set(Object.keys(cfg.icons));
const unknown = new Map();
for (const f of tracked) {
  const src = readFileSync(join(root, f), 'utf8');
  if (/--ui-icon:\s*url\(/.test(src)) fail(`${f} define un icono propio: se elige en Lucide y va a icons.json`);
  for (const m of src.matchAll(/(?<![:\w-])data-icon="([a-z0-9-]+)"|\bicon:\s*'([a-z0-9-]+)'/g)) {
    const n = m[1] || m[2];
    if (!known.has(n)) unknown.set(n, [...(unknown.get(n) || []), f]);
  }
}
for (const [n, files] of unknown) fail(`«${n}» no está en icons.json (${[...new Set(files)].join(', ')})`);
if (!process.exitCode) console.log(`  ✓ iconos: ${known.size} de ${cfg.library}@${cfg.version}, ninguno dibujado a mano ni pedido sin existir`);
