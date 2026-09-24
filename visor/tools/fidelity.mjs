#!/usr/bin/env node
/*
 * fidelity.mjs — ¿cuánto se parece el HTML traducido a la pantalla de Figma?
 *
 * La imagen que exporta Figma es la VARA del HTML: una herramienta no puede contradecir el documento
 * del que nació, así que la medida no puede salir del propio traductor. Por cada pantalla, dibuja el
 * HTML en Chromium al doble de resolución (como la exportación), lo compara píxel a píxel con la imagen
 * y guarda un mapa de diferencias: en gris la pantalla de Figma, en rojo lo que el HTML dibuja distinto.
 *
 *   node visor/tools/fidelity.mjs --ref '<url de la sección>' [--only 334:2735] [--limit 10] [--all]
 *
 * Necesita el server del visor corriendo (make visor o `go run ./visor/server`); no lo levanta.
 * ⚠ Un píxel cuenta como distinto si algún canal difiere en más de 48 sobre 255: por debajo es el
 * suavizado del texto, que Chromium y Figma dibujan distinto aunque la letra esté en su lugar.
 */
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const require = createRequire(join(ROOT, 'harness', 'package.json'))
let chromium
try { ({ chromium } = require('playwright')) } catch {
  console.error('  ✗ no encontré Playwright en harness/node_modules (cd harness && npm i)')
  process.exit(2)
}

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : '1'])
  return acc
}, []))
const API = args.api || 'http://127.0.0.1:5194'
const OUT = args.out || join(ROOT, 'visor', '.cache', 'fidelity')
const THRESHOLD = Number(args.threshold || 48)
if (!args.ref) {
  console.error("  uso: node visor/tools/fidelity.mjs --ref '<url de la sección>' [--only <id>] [--limit N] [--all]")
  process.exit(2)
}

async function getJSON(path) {
  const res = await fetch(API + path)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status} en ${path}`)
  return body
}

let map
try { map = await getJSON('/api/map?ref=' + encodeURIComponent(args.ref)) } catch (e) {
  console.error(`  ✗ ${e.message}\n    ¿está corriendo el server del visor en ${API}?`)
  process.exit(2)
}
const screens = []
const walk = (st) => {
  for (const lane of st.lanes || []) for (const sc of lane.screens) screens.push({ ...sc, lane: lane.label || '(sin rótulo)' })
  for (const sub of st.sections || []) walk(sub)
}
walk(map.structure)
let todo = screens.filter((sc) => (args.all ? true : sc.kind === 'mobile'))
if (args.only) todo = todo.filter((sc) => args.only.split(',').includes(sc.id))
if (args.limit) todo = todo.slice(0, Number(args.limit))
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
const results = []
try {
  const compare = await (await browser.newContext()).newPage()
  for (const sc of todo) {
    const w = Math.round(sc.w), h = Math.round(sc.h)
    const figmaRes = await fetch(`${API}/api/screen?key=${map.key}&id=${encodeURIComponent(sc.id)}`)
    if (!figmaRes.ok) { results.push({ sc, error: 'sin imagen de Figma' }); continue }
    const figma = Buffer.from(await figmaRes.arrayBuffer()).toString('base64')

    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 })
    const page = await ctx.newPage()
    const res = await page.goto(`${API}/api/html?key=${map.key}&id=${encodeURIComponent(sc.id)}`, { waitUntil: 'load', timeout: 90000 })
    // Una respuesta que no es el HTML es un ERROR, no una pantalla distinta: medido, un 429 de Figma
    // salía como «0,8 % igual» y se leía como una traducción rota.
    if (!res || res.status() !== 200) {
      const body = res ? (await res.text()).slice(0, 160) : 'sin respuesta'
      results.push({ sc, error: `el HTML respondió ${res ? res.status() : '—'}: ${body}` })
      await ctx.close()
      continue
    }
    // Las fuentes y los SVG llegan después del HTML: sin esperarlos, se mide una pantalla sin letras.
    await page.evaluate(async () => {
      await document.fonts.ready
      await Promise.all([...document.images].map((img) => img.complete ? null : new Promise((r) => { img.onload = img.onerror = r })))
    })
    const shot = (await page.screenshot({ clip: { x: 0, y: 0, width: w, height: h } })).toString('base64')
    await ctx.close()

    const r = await compare.evaluate(async ({ figma, shot, threshold }) => {
      const load = (b64) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = 'data:image/png;base64,' + b64 })
      const [a, b] = await Promise.all([load(figma), load(shot)])
      const W = a.naturalWidth, H = a.naturalHeight
      // Las dos sobre el MISMO fondo: la exportación de Figma deja transparente lo que no tiene relleno, y
      // un píxel transparente leído a secas es negro contra el blanco de la captura — medido: el rombo de
      // decisión daba 48 % por sus cuatro esquinas vacías.
      const pixels = (img) => { const c = new OffscreenCanvas(W, H); const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, W, H); x.drawImage(img, 0, 0, W, H); return x.getImageData(0, 0, W, H) }
      const pa = pixels(a), pb = pixels(b)
      const out = new ImageData(W, H)
      let diff = 0
      for (let i = 0; i < pa.data.length; i += 4) {
        const d = Math.max(Math.abs(pa.data[i] - pb.data[i]), Math.abs(pa.data[i + 1] - pb.data[i + 1]), Math.abs(pa.data[i + 2] - pb.data[i + 2]))
        const g = (pa.data[i] * 0.3 + pa.data[i + 1] * 0.59 + pa.data[i + 2] * 0.11) * 0.35 + 160
        if (d > threshold) { diff++; out.data.set([230, 40, 40, 255], i) } else out.data.set([g, g, g, 255], i)
      }
      const c = new OffscreenCanvas(W, H); c.getContext('2d').putImageData(out, 0, 0)
      const blob = await c.convertToBlob({ type: 'image/png' })
      const buf = new Uint8Array(await blob.arrayBuffer())
      let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000))
      return { same: 1 - diff / (W * H), sizes: [W, H, b.naturalWidth, b.naturalHeight], png: btoa(s) }
    }, { figma, shot, threshold: THRESHOLD })
    const file = join(OUT, `${map.key}-${sc.id.replace(/[^0-9]/g, '-')}.png`)
    writeFileSync(file, Buffer.from(r.png, 'base64'))
    results.push({ sc, same: r.same, file, sizes: r.sizes })
  }
} finally {
  await browser.close()
}

writeFileSync(join(OUT, 'results.json'), JSON.stringify(results.map((x) => ({ id: x.sc.id, title: x.sc.title, lane: x.sc.lane, same: x.same, error: x.error, file: x.file })), null, 1))
console.log(`\n  fidelidad del HTML contra la imagen de Figma · ${map.structure.file_name} · «${map.structure.name}»`)
console.log(`  un píxel es distinto si algún canal difiere en más de ${THRESHOLD}/255\n`)
const ok = results.filter((x) => x.same !== undefined).sort((a, b) => a.same - b.same)
for (const x of results.filter((x) => x.error)) console.log(`  ✗ ${x.sc.id.padEnd(11)} ${x.error}`)
for (const x of ok) {
  const pct = (x.same * 100).toFixed(1).padStart(5)
  console.log(`  ${pct}%  ${x.sc.id.padEnd(11)} ${(x.sc.title || x.sc.name).slice(0, 44).padEnd(44)} ${x.sc.lane.slice(0, 22)}`)
}
if (ok.length) {
  const vals = ok.map((x) => x.same).sort((a, b) => a - b)
  const median = vals[Math.floor(vals.length / 2)]
  console.log(`\n  ${ok.length} pantalla(s) · mediana ${(median * 100).toFixed(1)}% · peor ${(vals[0] * 100).toFixed(1)}%`)
  console.log(`  mapas de diferencias (rojo = distinto): ${OUT}`)
}
