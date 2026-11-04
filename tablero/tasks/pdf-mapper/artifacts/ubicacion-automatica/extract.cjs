// Corre la extracción del HTML de PDF cartesiano (index.html) en Node, con el mismo pdf.js (3.4.120), y guarda el
// JSON reducido de una página (el que se le manda a Claude). Toma las funciones directamente del HTML, sin copiarlas.
// Uso: node extract.cjs <pdf> <página> <salida.json>
const fs = require('fs')
// pdf.js pide `canvas` sólo para tener DOMMatrix/Path2D/ImageData, que la extracción no usa.
for (const k of ['DOMMatrix', 'Path2D', 'ImageData']) globalThis[k] ||= class {}
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js')

const [pdfPath, pageArg, outPath] = process.argv.slice(2)
const html = fs.readFileSync('/Users/miguelochoa/Desktop/CREDITOP/temp/pdf-cartesiano/index.html', 'utf8')
const cut = (from, to) => html.slice(html.indexOf(from), html.indexOf(to))
const code = [
  cut('// Más corto que esto (pt) no es un trazo útil', '// Escala de dibujo de los canvas'),
  'const round = v => Math.round(v * 100) / 100',
  cut('// Multiplica dos matrices afines de PDF', '// ---- dibujo'),
  cut('// Más largo que esto, un texto es un párrafo corrido', 'let locating = false'),
].join('\n')

// El HTML mide texto con un canvas para estimar dónde empieza una raya «__» dentro de una pieza; acá, por cantidad de letras.
const document = { createElement: () => ({ getContext: () => ({ font: '', measureText: s => ({ width: s.length }) }) }) }
const OPS = pdfjsLib.OPS
const api = new Function('pdfjsLib', 'OPS', 'document', code + '\nreturn { extractPage, compactPage }')(pdfjsLib, OPS, document)

;(async () => {
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(fs.readFileSync(pdfPath)) }).promise
  const page = await doc.getPage(Number(pageArg || 1))
  const full = await api.extractPage(page)
  const compact = api.compactPage(full)
  fs.writeFileSync(outPath, JSON.stringify(compact))
  console.log(`${outPath}: ${compact.textos.length} textos · ${compact.lineas.length} líneas · ${compact.casillas.length} casillas · ${JSON.stringify(compact).length} caracteres`)
})().catch(e => { console.error(e); process.exit(1) })
