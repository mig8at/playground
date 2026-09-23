// props.mjs [-map mapa.tsv …] [-w] [-list] archivos… — renombra PROPIEDADES de JS/Vue (fase 4b).
//
// La fase 1 renombró los bindings y dejó a propósito las propiedades, porque eran el contrato JSON. Esto
// es la otra mitad: `x.que` → `x.what`, `{ que: … }` → `{ what: … }`, `x['que']` → `x['what']`. Distingue
// tres roles que `lib.mjs` junta en uno:
//   · member — la propiedad de un acceso (`x.que`, `x?.que`): siempre se renombra;
//   · key    — la clave de un objeto literal o de una desestructuración: se renombra, SALVO adentro de un
//              `:class` del template, donde la clave es una CLASE CSS (`{ abierta: … }`) y no un dato;
//   · str    — una cadena usada como clave (`x['que']`, `{ 'que': 1 }`): se renombra igual que `key`.
// Una abreviada `{ que }` se expande a `{ what: que }`: la clave cambia, la variable no.
// Sin `-w` lista lo que haría. `-list` imprime todas las propiedades con su rol, para inventariar.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../package.json', import.meta.url));
const babel = require('@babel/parser');
const sfc = require('@vue/compiler-sfc');

const PARSE = { sourceType: 'module', plugins: [], errorRecovery: false };
const SKIP = new Set(['loc', 'start', 'end', 'extra', 'leadingComments', 'trailingComments', 'innerComments']);

function walk(node, cb, parent = null, key = null) {
  if (!node || typeof node.type !== 'string') return;
  cb(node, parent, key);
  for (const k of Object.keys(node)) {
    if (SKIP.has(k)) continue;
    const v = node[k];
    if (Array.isArray(v)) v.forEach((c) => c && typeof c.type === 'string' && walk(c, cb, node, k));
    else if (v && typeof v.type === 'string') walk(v, cb, node, k);
  }
}

// propiedades de un trozo de JS, con su posición absoluta
function props(code, offset, asExpression, cssKeys = false) {
  const ast = asExpression ? babel.parseExpression(code, PARSE) : babel.parse(code, PARSE);
  const out = [];
  walk(asExpression ? ast : ast.program, (n, p, k) => {
    const member = p && (p.type === 'MemberExpression' || p.type === 'OptionalMemberExpression') && k === 'property';
    const objKey = p && (p.type === 'ObjectProperty' || p.type === 'ObjectMethod') && k === 'key' && !p.computed;
    if (n.type === 'Identifier' && member && !p.computed) {
      out.push({ name: n.name, start: n.start + offset, end: n.end + offset, role: 'member' });
    } else if (n.type === 'Identifier' && objKey) {
      out.push({ name: n.name, start: n.start + offset, end: n.end + offset, role: p.shorthand ? 'shorthand' : 'key', css: cssKeys });
    } else if (n.type === 'StringLiteral' && ((member && p.computed) || objKey)) {
      out.push({ name: n.value, start: n.start + offset + 1, end: n.end + offset - 1, role: 'str', css: cssKeys && objKey });
    }
  });
  return out;
}

function sfcProps(src, file) {
  const { descriptor, errors } = sfc.parse(src, { filename: file });
  if (errors.length) throw new Error(file + ': ' + errors[0]);
  let out = [];
  for (const b of [descriptor.script, descriptor.scriptSetup]) if (b) out = out.concat(props(b.content, b.loc.start.offset, false));
  if (!descriptor.template) return out;
  const expr = (e, css = false) => {
    const c = e.loc.source;
    if (!c.trim()) return [];
    try { return props(c, e.loc.start.offset, true, css); } catch { return props(c, e.loc.start.offset, false, css); }
  };
  const visit = (node) => {
    if (node.type === 5 /* INTERPOLATION */) out = out.concat(expr(node.content));
    for (const p of node.props || []) {
      if (p.type !== 7 /* DIRECTIVE */ || !p.exp) continue;
      const isClass = p.name === 'bind' && p.arg && p.arg.content === 'class';
      if (p.name === 'for') {
        const c = p.exp.loc.source; const m = /^\s*([\s\S]*?)\s+(?:in|of)\s+([\s\S]*)$/.exec(c);
        const alias = m[1].trim().startsWith('(') ? m[1] : '(' + m[1] + ')';
        const aliasOff = p.exp.loc.start.offset + c.indexOf(m[1]) - (m[1].trim().startsWith('(') ? 0 : 1);
        out = out.concat(props(alias + '=>0', aliasOff, true).filter((x) => x.start < aliasOff + alias.length));
        out = out.concat(props(m[2], p.exp.loc.start.offset + c.lastIndexOf(m[2]), true));
      } else {
        out = out.concat(expr(p.exp, isClass));
      }
    }
    (node.children || []).forEach(visit);
    (node.branches || []).forEach(visit);
  };
  descriptor.template.ast.children.forEach(visit);
  return out;
}

const fileProps = (src, file) => (file.endsWith('.vue') ? sfcProps(src, file) : props(src, 0, false));

const args = process.argv.slice(2);
const write = args.includes('-w');
const list = args.includes('-list');
const maps = args.flatMap((a, i) => (args[i - 1] === '-map' ? [a] : []));
const files = args.filter((a, i) => !a.startsWith('-') && args[i - 1] !== '-map');
const map = new Map();
for (const m of maps) for (const line of readFileSync(m, 'utf8').split('\n')) {
  const t = line.trim(); if (!t || t.startsWith('#')) continue;
  const [a, b] = t.split(/\s+/); map.set(a, b);
}

let total = 0;
for (const f of files) {
  let src = readFileSync(f, 'utf8');
  const found = fileProps(src, f);
  if (list) {
    for (const x of found) console.log(JSON.stringify({ file: f, name: x.name, role: x.role, css: !!x.css, line: src.slice(0, x.start).split('\n').length }));
    continue;
  }
  const edits = found.filter((x) => map.has(x.name) && !x.css);
  for (const x of edits.sort((a, b) => b.start - a.start)) {
    const repl = x.role === 'shorthand' ? `${map.get(x.name)}: ${x.name}` : map.get(x.name);
    if (!write) console.log(`  ${f}:${src.slice(0, x.start).split('\n').length}  ${x.role.padEnd(9)} ${x.name} → ${map.get(x.name)}`);
    src = src.slice(0, x.start) + repl + src.slice(x.end);
  }
  total += edits.length;
  if (write && edits.length) writeFileSync(f, src);
}
if (!list) console.log(`${write ? 'aplicadas' : 'se aplicarían'}: ${total}`);
