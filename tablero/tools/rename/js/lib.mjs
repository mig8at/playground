// lib: parsea JS y SFC de Vue y enumera los identificadores con su ROL, para renombrar sin romper
// claves de objeto ni propiedades (que son el contrato JSON y siguen en español hasta la fase 4b).
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../package.json', import.meta.url));
const babel = require('@babel/parser');
const sfc = require('@vue/compiler-sfc');

const PARSE = { sourceType: 'module', plugins: [], errorRecovery: false };

// visita genérica: llama cb(node, parent, key) sobre todo el árbol
function walk(node, cb, parent = null, key = null) {
  if (!node || typeof node.type !== 'string') return;
  cb(node, parent, key);
  for (const k of Object.keys(node)) {
    if (k === 'loc' || k === 'start' || k === 'end' || k === 'extra' || k === 'leadingComments' || k === 'trailingComments' || k === 'innerComments') continue;
    const v = node[k];
    if (Array.isArray(v)) v.forEach((c) => c && typeof c.type === 'string' && walk(c, cb, node, k));
    else if (v && typeof v.type === 'string') walk(v, cb, node, k);
  }
}

// rol de un Identifier: 'prop' (no se toca), 'shorthand' (clave+valor), 'binding'/'ref' (se toca)
function role(node, parent, key) {
  if (!parent) return 'ref';
  if ((parent.type === 'MemberExpression' || parent.type === 'OptionalMemberExpression') && key === 'property' && !parent.computed) return 'prop';
  if ((parent.type === 'ObjectProperty' || parent.type === 'ObjectMethod' || parent.type === 'ClassMethod' || parent.type === 'ClassProperty') && key === 'key' && !parent.computed) {
    return parent.shorthand ? 'shorthand' : 'prop';
  }
  if (parent.type === 'ObjectProperty' && key === 'value' && parent.shorthand) return 'skip'; // lo cubre la clave
  if (parent.type === 'LabeledStatement' || parent.type === 'BreakStatement' || parent.type === 'ContinueStatement') return 'prop';
  if (parent.type === 'ImportSpecifier' && key === 'imported' && parent.imported !== parent.local) return 'prop';
  if (parent.type === 'ExportSpecifier' && key === 'exported' && parent.exported !== parent.local) return 'prop';
  return 'ref';
}

// ids(code, offset) → [{name, start, end, role}] del código JS
export function jsIds(code, offset = 0, asExpression = false) {
  let ast;
  if (asExpression) ast = babel.parseExpression(code, PARSE);
  else ast = babel.parse(code, PARSE);
  const out = [];
  walk(asExpression ? ast : ast.program, (n, p, k) => {
    if (n.type === 'Identifier') {
      const r = role(n, p, k);
      if (r === 'skip') return;
      // un ImportSpecifier sin alias tiene imported === local: se toca una sola vez
      if (p && p.type === 'ImportSpecifier' && k === 'imported' && p.imported.start === p.local.start) return;
      if (p && p.type === 'ExportSpecifier' && k === 'exported' && p.exported.start === p.local.start) return;
      const decl = p && ((p.type === 'VariableDeclarator' && k === 'id') || (/Function/.test(p.type) && (k === 'id' || k === 'params')) || p.type === 'ImportSpecifier' || p.type === 'ImportDefaultSpecifier' || (p.type === 'CatchClause' && k === 'param'));
      out.push({ name: n.name, start: n.start + offset, end: n.end + offset, role: r, decl: !!decl });
    }
  });
  return out;
}

// piezas de un SFC: bloques <script> y expresiones del <template>, cada una con su offset absoluto
export function sfcIds(src, file) {
  const { descriptor, errors } = sfc.parse(src, { filename: file });
  if (errors.length) throw new Error(file + ': ' + errors[0]);
  let out = [];
  for (const b of [descriptor.script, descriptor.scriptSetup]) {
    if (b) out = out.concat(jsIds(b.content, b.loc.start.offset));
  }
  if (descriptor.template) {
    const tpl = descriptor.template.ast;
    const visit = (node) => {
      if (node.type === 5 /* INTERPOLATION */) out = out.concat(expr(node.content));
      if (node.props) for (const p of node.props) {
        if (p.type === 7 /* DIRECTIVE */) {
          if (p.name === 'for' && p.exp) out = out.concat(forIds(p.exp));
          else if (p.name === 'slot' && p.exp) out = out.concat(paramIds(p.exp));
          else if (p.exp) out = out.concat(p.name === 'on' ? handler(p.exp) : expr(p.exp));
          if (p.arg && !p.arg.isStatic) out = out.concat(expr(p.arg));
        }
      }
      if (node.children) node.children.forEach(visit);
      if (node.branches) node.branches.forEach(visit);
    };
    const expr = (e) => { const c = e.loc.source; return c.trim() ? jsIds(c, e.loc.start.offset, true) : []; };
    const handler = (e) => { const c = e.loc.source; try { return jsIds(c, e.loc.start.offset, true); } catch { return jsIds(c, e.loc.start.offset, false); } };
    const paramIds = (e) => { const c = e.loc.source; const w = '(' + c + ')=>0'; return jsIds(w, e.loc.start.offset - 1, true).filter((x) => x.start >= e.loc.start.offset && x.end <= e.loc.end.offset); };
    const forIds = (e) => {
      const c = e.loc.source; const m = /^\s*([\s\S]*?)\s+(?:in|of)\s+([\s\S]*)$/.exec(c);
      if (!m) throw new Error('v-for raro: ' + c);
      const aliasOff = e.loc.start.offset + c.indexOf(m[1]);
      const srcOff = e.loc.start.offset + c.lastIndexOf(m[2]);
      const alias = m[1].trim().startsWith('(') ? m[1] : '(' + m[1] + ')';
      const shift = m[1].trim().startsWith('(') ? 0 : 1;
      const a = jsIds(alias + '=>0', aliasOff - shift, true).filter((x) => x.start >= aliasOff && x.end <= aliasOff + m[1].length);
      a.forEach((x) => (x.decl = true));
      return a.concat(jsIds(m[2], srcOff, true));
    };
    tpl.children.forEach(visit);
  }
  return out;
}

export function fileIds(src, file) {
  return file.endsWith('.vue') ? sfcIds(src, file) : jsIds(src, 0);
}
