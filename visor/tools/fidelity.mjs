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
 *   node visor/tools/fidelity.mjs --key <clave> --id <nodo> --w 430 --h 903 --json
 *
 * El segundo es el de UNA pantalla, y lo usa el server del visor: imprime en JSON cuánto se parece, la
 * medida estricta y la REAL (sin el suavizado de las letras; ver RADIUS y FLOOR).
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
const single = Boolean(args.key && args.id)
if (!args.ref && !single) {
  console.error("  uso: node visor/tools/fidelity.mjs --ref '<url de la sección>' [--only <id>] [--limit N] [--all]")
  console.error("       node visor/tools/fidelity.mjs --key <clave> --id <nodo> --w <ancho> --h <alto> --json")
  process.exit(2)
}
// La celda, en píxeles de la IMAGEN (la exportación va al doble): 8 = 4×4 de pantalla. Es donde se aplica
// el piso de abajo.
const CELL = 8
// EL RADIO DE TOLERANCIA, en píxeles de la imagen (2 = 1 px de pantalla). Comparar píxel a píxel marca el
// borde de TODAS las letras: Chromium y Figma no suavizan igual, y medio píxel de corrimiento pinta un
// contorno entero. Para la medida real, un píxel sólo es distinto si en la otra imagen NO hay uno
// parecido a menos de este radio, en los dos sentidos: el suavizado y el corrimiento encuentran su pareja
// al lado; un chulo que no se dibujó, no.
const RADIUS = Number(args.radius || 2)
// EL PISO de una celda: lo que queda del suavizado después del radio son motas sueltas —una celda con uno
// o dos píxeles—; lo que falta de verdad ocupa la celda. Medido en Motai 1:6660 (la barra de pasos sin sus
// chulos): con un piso de 15 % quedan 15 celdas y 12 son los tres chulos; sin piso eran 132, casi todas
// motas de texto.
// ⚠ Hubo un mapa de calor y una lista de capas encima de esta diferencia, y se sacaron (2026-09-25): aun así
// daban demasiados falsos positivos en letras e íconos para servir de guía. Queda el número.
const FLOOR = Number(args.floor || 0.15)

async function getJSON(path) {
  const res = await fetch(API + path)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status} en ${path}`)
  return body
}

// measure dibuja el HTML de UNA pantalla y lo compara con su imagen de Figma. Devuelve cuánto se parece
// —estricta y real— y el mapa de diferencias de siempre (gris y rojo).
async function measure(browser, compare, key, id, w, h) {
  const figmaRes = await fetch(`${API}/api/screen?key=${key}&id=${encodeURIComponent(id)}`)
  if (!figmaRes.ok) return { error: 'sin imagen de Figma' }
  const figma = Buffer.from(await figmaRes.arrayBuffer()).toString('base64')

  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  const res = await page.goto(`${API}/api/html?key=${key}&id=${encodeURIComponent(id)}`, { waitUntil: 'load', timeout: 90000 })
  // Una respuesta que no es el HTML es un ERROR, no una pantalla distinta: medido, un 429 de Figma
  // salía como «0,8 % igual» y se leía como una traducción rota.
  if (!res || res.status() !== 200) {
    const body = res ? (await res.text()).slice(0, 160) : 'sin respuesta'
    await ctx.close()
    return { error: `el HTML respondió ${res ? res.status() : '—'}: ${body}` }
  }
  // Las fuentes, los SVG y las imágenes llegan después del HTML: sin esperarlos, se mide una pantalla sin
  // letras o sin fotos. ⚠ Las imágenes de RELLENO van como fondo CSS (`background: url(...)`), que no está
  // en `document.images`: sin esperarlas, la primera medición de una pantalla con una foto de fondo salía
  // sin la foto —medido en Alta 192:4108, 96,2 % en una tanda y 99,4 % al repetirla—.
  await page.evaluate(async () => {
    await document.fonts.ready
    const backgrounds = new Set()
    for (const el of document.querySelectorAll('*')) {
      for (const m of getComputedStyle(el).backgroundImage.matchAll(/url\("?([^")]+)"?\)/g)) backgrounds.add(m[1])
    }
    await Promise.all([
      ...[...document.images].map((img) => img.complete ? null : new Promise((r) => { img.onload = img.onerror = r })),
      ...[...backgrounds].map((u) => new Promise((r) => { const i = new Image(); i.onload = i.onerror = r; i.src = u })),
    ])
    // Cargada no es pintada: dos cuadros para que el fondo llegue a la pantalla.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  })
  const shot = (await page.screenshot({ clip: { x: 0, y: 0, width: w, height: h } })).toString('base64')
  await ctx.close()

  return compare.evaluate(async ({ figma, shot, threshold, cell, radius, floor }) => {
    const load = (b64) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = 'data:image/png;base64,' + b64 })
    const [a, b] = await Promise.all([load(figma), load(shot)])
    const W = a.naturalWidth, H = a.naturalHeight
    // Las dos sobre el MISMO fondo: la exportación de Figma deja transparente lo que no tiene relleno, y
    // un píxel transparente leído a secas es negro contra el blanco de la captura — medido: el rombo de
    // decisión daba 48 % por sus cuatro esquinas vacías.
    const pixels = (img) => { const c = new OffscreenCanvas(W, H); const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, W, H); x.drawImage(img, 0, 0, W, H); return x.getImageData(0, 0, W, H) }
    const pa = pixels(a), pb = pixels(b)
    const out = new ImageData(W, H)
    const gw = Math.ceil(W / cell), gh = Math.ceil(H / cell)
    const counts = new Uint32Array(gw * gh)
    const A = pa.data, B = pb.data
    const near = (x, y, src, dst) => {
      // ¿hay en `dst`, a menos de `radius`, un píxel parecido al de `src` en (x, y)?
      const i = (y * W + x) * 4
      for (let dy = -radius; dy <= radius; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= H) continue
        for (let dx = -radius; dx <= radius; dx++) {
          const xx = x + dx
          if (xx < 0 || xx >= W) continue
          const j = (yy * W + xx) * 4
          if (Math.abs(src[i] - dst[j]) <= threshold && Math.abs(src[i + 1] - dst[j + 1]) <= threshold && Math.abs(src[i + 2] - dst[j + 2]) <= threshold) return true
        }
      }
      return false
    }
    let diff = 0
    for (let i = 0; i < A.length; i += 4) {
      const d = Math.max(Math.abs(A[i] - B[i]), Math.abs(A[i + 1] - B[i + 1]), Math.abs(A[i + 2] - B[i + 2]))
      const g = (A[i] * 0.3 + A[i + 1] * 0.59 + A[i + 2] * 0.11) * 0.35 + 160
      if (d > threshold) {
        diff++
        out.data.set([230, 40, 40, 255], i)
        const p = i / 4, x = p % W, y = Math.floor(p / W)
        if (!near(x, y, A, B) || !near(x, y, B, A)) {
          counts[Math.floor(y / cell) * gw + Math.floor(x / cell)]++
        }
      } else out.data.set([g, g, g, 255], i)
    }
    const toB64 = async (canvas) => {
      const buf = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer())
      let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000))
      return btoa(s)
    }
    const c = new OffscreenCanvas(W, H); c.getContext('2d').putImageData(out, 0, 0)

    let kept = 0
    for (let k = 0; k < counts.length; k++) {
      const cw = Math.min(cell, W - (k % gw) * cell), ch = Math.min(cell, H - Math.floor(k / gw) * cell)
      if (counts[k] / (cw * ch) >= floor) kept += counts[k]
    }

    return { same: 1 - diff / (W * H), sameReal: 1 - kept / (W * H), sizes: [W, H, b.naturalWidth, b.naturalHeight], png: await toB64(c) }
  }, { figma, shot, threshold: THRESHOLD, cell: CELL, radius: RADIUS, floor: FLOOR })
}

if (single) {
  const browser = await chromium.launch()
  try {
    const compare = await (await browser.newContext()).newPage()
    const r = await measure(browser, compare, args.key, args.id, Math.round(Number(args.w)), Math.round(Number(args.h)))
    if (r.error) { console.log(JSON.stringify({ error: r.error })); process.exit(1) }
    if (args.diff) writeFileSync(args.diff, Buffer.from(r.png, 'base64'))
    console.log(JSON.stringify({ same: r.same, same_real: r.sameReal, radius: RADIUS, floor: FLOOR, threshold: THRESHOLD }))
  } finally {
    await browser.close()
  }
  process.exit(0)
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
    const r = await measure(browser, compare, map.key, sc.id, Math.round(sc.w), Math.round(sc.h))
    if (r.error) { results.push({ sc, error: r.error }); continue }
    const file = join(OUT, `${map.key}-${sc.id.replace(/[^0-9]/g, '-')}.png`)
    writeFileSync(file, Buffer.from(r.png, 'base64'))
    results.push({ sc, same: r.same, real: r.sameReal, file, sizes: r.sizes })
  }
} finally {
  await browser.close()
}

writeFileSync(join(OUT, 'results.json'), JSON.stringify(results.map((x) => ({ id: x.sc.id, title: x.sc.title, lane: x.sc.lane, same: x.same, same_real: x.real, error: x.error, file: x.file })), null, 1))
console.log(`\n  fidelidad del HTML contra la imagen de Figma · ${map.structure.file_name} · «${map.structure.name}»`)
console.log(`  un píxel es distinto si algún canal difiere en más de ${THRESHOLD}/255 · «real»: sin el suavizado ni medio píxel de corrimiento\n`)
console.log('  estricta   real')
const ok = results.filter((x) => x.same !== undefined).sort((a, b) => a.same - b.same)
for (const x of results.filter((x) => x.error)) console.log(`  ✗ ${x.sc.id.padEnd(11)} ${x.error}`)
for (const x of ok) {
  const pct = (x.same * 100).toFixed(1).padStart(5), real = (x.real * 100).toFixed(2).padStart(6)
  console.log(`  ${pct}%  ${real}%  ${x.sc.id.padEnd(11)} ${(x.sc.title || x.sc.name).slice(0, 44).padEnd(44)} ${x.sc.lane.slice(0, 22)}`)
}
if (ok.length) {
  const vals = ok.map((x) => x.same).sort((a, b) => a - b)
  const reals = ok.map((x) => x.real).sort((a, b) => a - b)
  const median = vals[Math.floor(vals.length / 2)]
  console.log(`\n  ${ok.length} pantalla(s) · mediana ${(median * 100).toFixed(1)}% · peor ${(vals[0] * 100).toFixed(1)}%`
    + ` · real: mediana ${(reals[Math.floor(reals.length / 2)] * 100).toFixed(2)}%, peor ${(reals[0] * 100).toFixed(2)}%`)
  console.log(`  mapas de diferencias (rojo = distinto): ${OUT}`)
}
