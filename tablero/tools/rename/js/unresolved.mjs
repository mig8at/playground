// unresolved: nombres que el template usa y el script no declara (el compilador los manda a _ctx)
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../package.json', import.meta.url));
const sfc = require('@vue/compiler-sfc');
for (const f of process.argv.slice(2)) {
  const { descriptor } = sfc.parse(readFileSync(f, 'utf8'), { filename: f });
  const out = sfc.compileScript(descriptor, { id: 'x', inlineTemplate: true });
  const names = [...new Set([...out.content.matchAll(/_ctx\.(\w+)/g)].map((m) => m[1]))].sort();
  console.log(f.split('/').pop() + ': ' + (names.join(' ') || '—'));
}
