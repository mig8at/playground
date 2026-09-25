// El HTML de una capa, para LEERLO. El render lo escribe en un solo renglón, con todo el estilo en línea:
// correcto, pero ilegible en la barra. Esto lo reparte: una etiqueta por renglón con la sangría de su
// anidado, un atributo por renglón cuando son varios y una declaración del `style` por renglón. Sigue
// siendo HTML válido —un `style` puede tener saltos de línea—, así que lo que se copia de acá también
// anda. Las entidades de los atributos (`&#39;` en las familias de letra) se muestran como su carácter.

const VOID = new Set(['img', 'input', 'br', 'hr', 'meta', 'link'])
const INDENT = '  '

const decode = (s) => s.replace(/&#39;/g, "'").replace(/&#34;|&quot;/g, '"').replace(/&amp;/g, '&')

function attributes(tag) {
  const out = []
  const re = /([^\s=/>]+)(?:="([^"]*)")?/g
  let m
  while ((m = re.exec(tag))) out.push({ name: m[1], value: m[2] === undefined ? null : decode(m[2]) })
  return out
}

function openTag(name, attrs, pad) {
  const end = '>'
  if (!attrs.length) return [`${pad}<${name}${end}`]
  const style = attrs.find((a) => a.name === 'style')
  const rest = attrs.filter((a) => a.name !== 'style')
  const plain = rest.map((a) => (a.value === null ? a.name : `${a.name}="${a.value}"`))
  // Corto y sin estilo: en un renglón.
  if (!style && plain.join(' ').length <= 60) return [`${pad}<${name} ${plain.join(' ')}${end}`]
  const lines = [`${pad}<${name}`]
  for (const a of plain) lines.push(`${pad}${INDENT}${a}`)
  if (style) {
    const decls = style.value.split(';').map((d) => d.trim()).filter(Boolean)
    lines.push(`${pad}${INDENT}style="`)
    for (const d of decls) lines.push(`${pad}${INDENT}${INDENT}${d.replace(/\s*:\s*/, ': ')};`)
    lines.push(`${pad}${INDENT}"${end}`)
  } else {
    lines[lines.length - 1] += end
  }
  return lines
}

export function formatHTML(src) {
  if (!src) return ''
  const lines = []
  let depth = 0
  for (const m of src.matchAll(/<\/?[^>]+>|[^<]+/g)) {
    const tok = m[0]
    if (tok.startsWith('</')) {
      depth = Math.max(0, depth - 1)
      lines.push(INDENT.repeat(depth) + tok)
      continue
    }
    if (tok.startsWith('<')) {
      const name = (tok.match(/^<([^\s>/]+)/) || [])[1] || ''
      const body = tok.slice(1 + name.length, tok.endsWith('/>') ? -2 : -1)
      lines.push(...openTag(name, attributes(body), INDENT.repeat(depth)))
      if (!VOID.has(name.toLowerCase()) && !tok.endsWith('/>')) depth++
      continue
    }
    const text = tok.trim()
    if (text) lines.push(INDENT.repeat(depth) + text)
  }
  return lines.join('\n')
}
