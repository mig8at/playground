// AST → LaTeX y AST → MathML. Dos salidas del MISMO árbol que evalúa el motor, así que lo
// que ves renderizado es exactamente lo que se calcula: no hay una segunda transcripción
// que pueda quedar desactualizada.
//
// MathML y no KaTeX a propósito: lo pinta el navegador solo, sin CDN ni dependencia.
// El string LaTeX va aparte por si lo querés pegar en un documento.

const PR = {
  or: 1, and: 2, '==': 3, '!=': 3, '<': 3, '>': 3, '<=': 3, '>=': 3,
  '+': 4, '-': 4, '*': 5, '/': 5, '^': 7,
}
const TEX_OP = {
  '*': '\\cdot', '+': '+', '-': '-', '<': '<', '>': '>',
  '<=': '\\le', '>=': '\\ge', '==': '=', '!=': '\\ne', and: '\\land', or: '\\lor',
}
const MML_OP = {
  '*': '·', '+': '+', '-': '−', '<': '&lt;', '>': '&gt;',
  '<=': '≤', '>=': '≥', '==': '=', '!=': '≠', and: '∧', or: '∨',
}
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Formatea un número para mostrarlo dentro de la fórmula sustituida. */
function shortNum(v) {
  if (typeof v === 'boolean') return v ? 'sí' : 'no'
  if (typeof v !== 'number' || !isFinite(v)) return '?'
  if (Number.isInteger(v)) return v.toLocaleString('es-CO')
  const a = Math.abs(v)
  const d = a >= 1000 ? 0 : a >= 1 ? 2 : 6
  return v.toLocaleString('es-CO', { minimumFractionDigits: d, maximumFractionDigits: d })
}

/* ───────── LaTeX ───────── */
// `subst` (opcional): nombre → valor. Si viene, las referencias salen como número.
export function toLatex(n, subst, ctx = 0) {
  const wrap = (s, p) => (p < ctx ? `\\left(${s}\\right)` : s)
  switch (n.k) {
    case 'num': return String(n.v)
    case 'bool': return n.v ? '\\text{sí}' : '\\text{no}'
    case 'str': return `\\text{«${n.v}»}`
    case 'ref': {
      if (subst && n.name in subst) return `\\mathbf{${shortNum(subst[n.name]).replace(/\./g, '{.}')}}`
      return `\\mathit{${n.name.replace(/_/g, '\\_')}}`
    }
    case 'neg': return wrap('-' + toLatex(n.x, subst, 6), 6)
    case 'not': return wrap('\\lnot ' + toLatex(n.x, subst, 6), 6)
    case 'bin': {
      const p = PR[n.o]
      if (n.o === '/') return `\\dfrac{${toLatex(n.l, subst, 0)}}{${toLatex(n.r, subst, 0)}}`
      if (n.o === '^') return wrap(`${toLatex(n.l, subst, 8)}^{${toLatex(n.r, subst, 0)}}`, p)
      return wrap(`${toLatex(n.l, subst, p)} ${TEX_OP[n.o]} ${toLatex(n.r, subst, p + 1)}`, p)
    }
    case 'call': {
      if (n.f === 'if') {
        return '\\begin{cases}' + toLatex(n.args[1], subst, 0) +
          ' & \\text{si } ' + toLatex(n.args[0], subst, 0) + '\\\\' +
          toLatex(n.args[2], subst, 0) + ' & \\text{si no}\\end{cases}'
      }
      if (n.f === 'lookup') {
        return `\\mathrm{${n.args[0].name}}\\bigl[${toLatex(n.args[1], subst, 0)}\\bigr]` +
          `.\\mathrm{${n.args[2].v}}`
      }
      return `\\operatorname{${n.f}}\\left(${n.args.map(a => toLatex(a, subst, 0)).join(',\\; ')}\\right)`
    }
  }
  return ''
}

/* ───────── MathML ───────── */
export function toMathML(n, subst, ctx = 0) {
  const wrap = (s, p) => (p < ctx ? `<mo>(</mo>${s}<mo>)</mo>` : s)
  switch (n.k) {
    case 'num': return `<mn>${n.v}</mn>`
    case 'bool': return `<mtext>${n.v ? 'sí' : 'no'}</mtext>`
    case 'str': return `<mtext>«${esc(n.v)}»</mtext>`
    case 'ref': {
      if (subst && n.name in subst) return `<mn class="subst">${esc(shortNum(subst[n.name]))}</mn>`
      return `<mi>${esc(n.name)}</mi>`
    }
    case 'neg': return wrap(`<mo>−</mo>${toMathML(n.x, subst, 6)}`, 6)
    case 'not': return wrap(`<mo>¬</mo>${toMathML(n.x, subst, 6)}`, 6)
    case 'bin': {
      const p = PR[n.o]
      if (n.o === '/') {
        return `<mfrac><mrow>${toMathML(n.l, subst, 0)}</mrow>` +
          `<mrow>${toMathML(n.r, subst, 0)}</mrow></mfrac>`
      }
      if (n.o === '^') {
        return wrap(`<msup><mrow>${toMathML(n.l, subst, 8)}</mrow>` +
          `<mrow>${toMathML(n.r, subst, 0)}</mrow></msup>`, p)
      }
      return wrap(`${toMathML(n.l, subst, p)}<mo>${MML_OP[n.o]}</mo>` +
        `${toMathML(n.r, subst, p + 1)}`, p)
    }
    case 'call': {
      if (n.f === 'if') {
        return '<mo>{</mo><mtable columnalign="left left">' +
          `<mtr><mtd>${toMathML(n.args[1], subst, 0)}</mtd>` +
          `<mtd><mtext>si&#160;</mtext>${toMathML(n.args[0], subst, 0)}</mtd></mtr>` +
          `<mtr><mtd>${toMathML(n.args[2], subst, 0)}</mtd>` +
          '<mtd><mtext>si no</mtext></mtd></mtr></mtable>'
      }
      if (n.f === 'lookup') {
        return `<mi mathvariant="normal">${esc(n.args[0].name)}</mi><mo>[</mo>` +
          `${toMathML(n.args[1], subst, 0)}<mo>]</mo><mo>.</mo>` +
          `<mi mathvariant="normal">${esc(n.args[2].v)}</mi>`
      }
      return `<mi mathvariant="normal">${esc(n.f)}</mi><mo>(</mo>` +
        n.args.map(a => toMathML(a, subst, 0)).join('<mo>,</mo>') + '<mo>)</mo>'
    }
  }
  return ''
}
