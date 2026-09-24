// orphans.mjs <mapa.tsv> <archivo> [w] — referencias a nombres del mapa que el archivo YA NO declara (quedaron del otro lado de un <script>).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileIds } from './lib.mjs';
import { fileDecls } from './decls.mjs';
const [, , mapPath, file, write] = process.argv;
const map = new Map(readFileSync(mapPath, 'utf8').split('\n').filter((l) => l.trim()).map((l) => l.split(/\s+/)));
let src = readFileSync(file, 'utf8');
const declared = new Set(fileDecls(src, file).map((d) => d.name));
const edits = fileIds(src, file).filter((x) => map.has(x.name) && !declared.has(x.name) && x.role !== 'prop');
for (const e of edits) console.log(`  ${file}@${e.start} ${e.name} → ${map.get(e.name)} (${e.role})`);
if (write) {
  for (const e of [...edits].sort((a, b) => b.start - a.start)) {
    const text = e.role === 'shorthand' ? `${e.name}: ${map.get(e.name)}` : map.get(e.name);
    src = src.slice(0, e.start) + text + src.slice(e.end);
  }
  writeFileSync(file, src);
}
console.log(edits.length, 'referencias huérfanas');
