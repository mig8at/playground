// globals: identificadores que un archivo REFERENCIA sin declararlos (window, fetch… o un error)
import { readFileSync } from 'node:fs';
import { fileIds } from './lib.mjs';
import { fileDecls } from './decls.mjs';
for (const f of process.argv.slice(2)) {
  const ids = fileIds(readFileSync(f, 'utf8'), f);
  const src = readFileSync(f, 'utf8');
  const declared = new Set([...ids.filter((x) => x.decl).map((x) => x.name), ...fileDecls(src, f).map((d) => d.name)]);
  // parámetros de arrows/funciones anidadas, catch, etc. quedan como decl; lo que sobra son globales
  const free = [...new Set(ids.filter((x) => x.role === 'ref' && !x.decl && !declared.has(x.name)).map((x) => x.name))].sort();
  console.log(f.split('/').pop() + ': ' + free.join(' '));
}
