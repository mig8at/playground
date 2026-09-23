// decls.mjs <archivos…> — cada nombre que un archivo JS o Vue DECLARA, uno por línea:
//   ruta<TAB>línea<TAB>nombre<TAB>clase
// Declarar es crear el nombre: variables (incluida la desestructuración `const { a, b: c } = x`, que
// declara `a` y `c`, nunca `b`), funciones y sus parámetros, clases, imports, el `catch (e)` y, en el
// template, los alias de `v-for` y los parámetros de `v-slot`. Las claves de objeto y las propiedades
// NO se listan: son el contrato con el JSON del servidor y tienen su propia tanda.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { sfcIds } from './lib.mjs';

const require = createRequire(new URL('../../../package.json', import.meta.url));
const babel = require('@babel/parser');
const sfc = require('@vue/compiler-sfc');

const SKIP = new Set(['loc', 'start', 'end', 'extra', 'leadingComments', 'trailingComments', 'innerComments']);

function walk(node, visit) {
  if (!node || typeof node.type !== 'string') return;
  visit(node);
  for (const key of Object.keys(node)) {
    if (SKIP.has(key)) continue;
    const value = node[key];
    if (Array.isArray(value)) value.forEach((child) => walk(child, visit));
    else if (value && typeof value.type === 'string') walk(value, visit);
  }
}

// los identificadores que un patrón de asignación crea
function patternNames(pattern, out) {
  if (!pattern) return out;
  switch (pattern.type) {
    case 'Identifier': out.push(pattern); break;
    case 'ObjectPattern':
      for (const prop of pattern.properties) patternNames(prop.type === 'RestElement' ? prop.argument : prop.value, out);
      break;
    case 'ArrayPattern': pattern.elements.forEach((el) => patternNames(el, out)); break;
    case 'AssignmentPattern': patternNames(pattern.left, out); break;
    case 'RestElement': patternNames(pattern.argument, out); break;
    case 'TSParameterProperty': patternNames(pattern.parameter, out); break;
  }
  return out;
}

function scriptDecls(code, offset) {
  const ast = babel.parse(code, { sourceType: 'module', errorRecovery: false });
  const out = [];
  const add = (id, kind) => id && out.push({ name: id.name, start: id.start + offset, kind });
  walk(ast.program, (n) => {
    switch (n.type) {
      case 'VariableDeclarator': patternNames(n.id, []).forEach((id) => add(id, 'var')); break;
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
      case 'ObjectMethod':
      case 'ClassMethod':
        if (n.id) add(n.id, 'func');
        n.params.forEach((p) => patternNames(p, []).forEach((id) => add(id, 'param')));
        break;
      case 'ClassDeclaration':
      case 'ClassExpression': if (n.id) add(n.id, 'class'); break;
      case 'CatchClause': patternNames(n.param, []).forEach((id) => add(id, 'var')); break;
      case 'ImportSpecifier':
      case 'ImportDefaultSpecifier':
      case 'ImportNamespaceSpecifier': add(n.local, 'import'); break;
    }
  });
  return out;
}

export function fileDecls(src, file) {
  if (!file.endsWith('.vue')) return scriptDecls(src, 0);
  const { descriptor, errors } = sfc.parse(src, { filename: file });
  if (errors.length) throw new Error(`${file}: ${errors[0]}`);
  let out = [];
  for (const block of [descriptor.script, descriptor.scriptSetup]) {
    if (block) out = out.concat(scriptDecls(block.content, block.loc.start.offset));
  }
  const tpl = descriptor.template;
  if (tpl) {
    const from = tpl.loc.start.offset, to = tpl.loc.end.offset;
    for (const id of sfcIds(src, file)) {
      if (id.decl && id.start >= from && id.end <= to) out.push({ name: id.name, start: id.start, kind: 'template' });
    }
  }
  return out;
}

// Se usa como biblioteca desde ren.mjs; como comando sólo cuando se lo invoca directo.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const file of process.argv.slice(2)) {
    const src = readFileSync(file, 'utf8');
    const lineStarts = [0];
    for (let i = 0; i < src.length; i++) if (src[i] === '\n') lineStarts.push(i + 1);
    const lineOf = (offset) => {
      let lo = 0, hi = lineStarts.length - 1;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= offset) lo = mid; else hi = mid - 1; }
      return lo + 1;
    };
    for (const d of fileDecls(src, file)) console.log(`${file}\t${lineOf(d.start)}\t${d.name}\t${d.kind}`);
  }
}
