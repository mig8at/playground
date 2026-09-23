// ren.mjs -map mapa.tsv [-w] archivos… — renombra bindings de JS/Vue sin tocar claves ni propiedades.
//
// Un nombre se renombra en un archivo sólo si ese archivo lo DECLARA (así nunca se toca un prop,
// un global o algo importado de afuera) y no es la clave de un prop. Todas las apariciones del mismo
// nombre en el archivo van al mismo nombre newName, así que el sombreado existente queda igual. Se
// rechaza si el nombre newName ya aparece como identificador en el archivo. Las abreviadas
// `{ oldName }` se expanden a `{ oldName: newName }` para que la clave (contrato JSON o clase CSS) no cambie.
// También reescribe `ref="oldName"` del template cuando `oldName` se renombra.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileIds } from './lib.mjs';
const require = createRequire(new URL('../../../package.json', import.meta.url));
const sfc = require('@vue/compiler-sfc');

const args = process.argv.slice(2);
const write = args.includes('-w');
const mapPath = args[args.indexOf('-map') + 1];
const files = args.filter((a, i) => a !== '-w' && a !== '-map' && args[i - 1] !== '-map');
const map = new Map();
for (const line of readFileSync(mapPath, 'utf8').split('\n')) {
  const t = line.trim(); if (!t || t.startsWith('#')) continue;
  const [a, b] = t.split(/\s+/); map.set(a, b);
}

let bad = 0, total = 0;
for (const f of files) {
  let src = readFileSync(f, 'utf8');
  const ids = fileIds(src, f);
  const declared = new Set(ids.filter((x) => x.decl).map((x) => x.name));
  const present = new Set(ids.filter((x) => x.role !== 'prop').map((x) => x.name));
  const propKeys = new Set();
  if (f.endsWith('.vue')) {
    const m = /defineProps\(\s*\{([\s\S]*?)\}\s*\)/.exec(src);
    if (m) for (const k of m[1].matchAll(/(\w+)\s*:/g)) propKeys.add(k[1]);
  }
  const active = new Map();
  for (const [a, b] of map) {
    if (!declared.has(a)) continue;
    if (propKeys.has(a)) { console.log(`CONFLICTO ${f}: ${a} es un prop`); bad++; continue; }
    if (present.has(b) && !map.has(b)) { console.log(`CONFLICTO ${f}: ${a}→${b}, ${b} ya existe`); bad++; continue; }
    active.set(a, b);
  }
  // dos oldNames al mismo newName dentro del archivo: sombrearían entre sí
  const byNew = new Map();
  for (const [a, b] of active) { if (byNew.has(b)) { console.log(`CONFLICTO ${f}: ${byNew.get(b)} y ${a} → ${b}`); bad++; } byNew.set(b, a); }
  const edits = [];
  for (const x of ids) {
    if (!active.has(x.name) || x.role === 'prop') continue;
    const newName = active.get(x.name);
    if (src.slice(x.start, x.end) !== x.name) throw new Error(`desfase ${f}@${x.start}: ${src.slice(x.start, x.end)} ≠ ${x.name}`);
    edits.push({ start: x.start, end: x.end, text: x.role === 'shorthand' ? `${x.name}: ${newName}` : newName });
  }
  // ref="oldName" en el template
  if (f.endsWith('.vue')) {
    const { descriptor } = sfc.parse(src);
    const tpl = descriptor.template;
    if (tpl) {
      const visit = (n) => {
        for (const p of n.props || []) if (p.type === 6 && p.name === 'ref' && p.value && active.has(p.value.content)) {
          const s = p.value.loc.start.offset + 1;
          edits.push({ start: s, end: s + p.value.content.length, text: active.get(p.value.content) });
        }
        (n.children || []).forEach(visit);
      };
      tpl.ast.children.forEach(visit);
    }
  }
  // un binding shorthand puede salir DOS veces (como clave y como valor): dedup por posición
  const seen = new Set();
  const uniq = edits.filter((e) => (seen.has(e.start) ? false : seen.add(e.start))).sort((a, b) => b.start - a.start);
  for (const e of uniq) src = src.slice(0, e.start) + e.text + src.slice(e.end);
  total += uniq.length;
  console.log(`${f}: ${active.size} nombres, ${uniq.length} ediciones`);
  if (write && uniq.length) writeFileSync(f, src);
}
console.log(`ediciones ${total} · conflictos ${bad} · escrito=${write && bad === 0}`);
process.exit(bad ? 3 : 0);
