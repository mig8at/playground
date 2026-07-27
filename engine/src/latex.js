// AST → LaTeX. Sale del MISMO árbol que evalúa el motor, así que lo que ves renderizado es
// exactamente lo que se calcula: no hay una segunda transcripción que pueda quedar vieja.
//
// Esta parte NO la puede hacer una librería: KaTeX recibe un string LaTeX y lo dibuja, no lo
// produce — y ninguna librería conoce nuestro AST. El dibujo sí lo hace KaTeX (ver FormulaPanel).

const PR = {
  or: 1, and: 2, '==': 3, '!=': 3, '<': 3, '>': 3, '<=': 3, '>=': 3,
  '+': 4, '-': 4, '*': 5, '/': 5, '^': 7,
}
const TEX_OP = {
  '*': '\\cdot', '+': '+', '-': '-', '<': '<', '>': '>',
  '<=': '\\le', '>=': '\\ge', '==': '=', '!=': '\\ne', and: '\\land', or: '\\lor',
}
/** Formatea un número para mostrarlo dentro de la fórmula sustituida. */
function shortNum(v) {
  if (typeof v === 'boolean') return v ? 'sí' : 'no'
  if (typeof v !== 'number' || !isFinite(v)) return '?'
  if (Number.isInteger(v)) return v.toLocaleString('es-CO')
  const a = Math.abs(v)
  const d = a >= 1000 ? 0 : a >= 1 ? 2 : 6
  return v.toLocaleString('es-CO', { minimumFractionDigits: d, maximumFractionDigits: d })
}

/** En modo matemático la coma y el punto son PUNTUACIÓN: LaTeX les mete un espacio detrás
 *  y "10.790.920" saldría "10. 790. 920". Encerrarlos en llaves los vuelve símbolos comunes. */
function texNum(v) {
  return shortNum(v).replace(/\./g, '{.}').replace(/,/g, '{,}')
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
      if (subst && n.name in subst) return `\\htmlClass{tex-subst}{${texNum(subst[n.name])}}`
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
