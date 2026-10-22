/* LOS MUEBLES DE LA OFICINA — piezas armadas con cajas redondeadas, cilindros y esferas, sin modelos externos.
 *
 * Cada función devuelve un `THREE.Group` con el mueble apoyado en y = 0 y centrado en x/z, para que la escena
 * sólo lo ubique y lo rote. Los colores salen de la paleta (`PALETTE`) y los dibujos de pantallas, cuadros y
 * alfombras son texturas pintadas en un canvas: livianas y sin archivos.
 *
 * El estilo copia la referencia de un diorama: formas blandas (radio en todas las cajas), colores planos y
 * mate, y sombras suaves que pone la escena.
 */
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'

// Los colores de CreditOp, tal como los define el front (`packages/ui/src/styles/globals.css` en
// frontend-monorepo): el morado primario y sus tonos, el verde CreditOp como acento, el azul noche del texto,
// y el azul y el verde lima de apoyo. Los neutros llevan un tinte morado para no verse grises sueltos.
export const PALETTE = {
  primary: '#4c39ff',      // purple-500, --primary
  primaryDeep: '#3628b5',  // purple-700, --brand
  primarySoft: '#877aff',  // purple-300
  primaryPale: '#edebff',  // purple-50, --brand-subtle
  accent: '#05d587',       // creditop-500
  accentSoft: '#8cecc8',   // creditop-200
  accentDeep: '#049760',   // creditop-700
  navy: '#252256',         // violet-500, --foreground
  teal: '#22baff',         // blue-500
  yellow: '#c9f684',       // light-green-300
  pink: '#ada4ff',         // purple-200
  cream: '#edebff',
  creamDark: '#d9d6f0',
  white: '#fbfbff',
  wood: '#d7b48c',
  woodDark: '#9a7351',
  charcoal: '#252256',
  green: '#37b86b',
  greenDark: '#1f8a4c',
  glass: '#c8c2ff',
  pot: '#e3e1ef',
  // la sala
  wallHigh: '#f7f6ff',
  wallLow: '#4c39ff',
  wallTrim: '#3628b5',
  floor: '#eeecf6',
  floorAlt: '#e6e3f1',
  base: '#fbfbff',
  baseTop: '#dedbef',
}

const materials = new Map()
// Un material por color y acabado: cientos de piezas comparten unos pocos.
export function mat(color, { rough = 0.85, metal = 0, emissive = null, opacity = 1 } = {}) {
  const key = `${color}|${rough}|${metal}|${emissive}|${opacity}`
  if (!materials.has(key)) {
    const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal })
    if (emissive) { m.emissive = new THREE.Color(emissive); m.emissiveIntensity = 0.55 }
    if (opacity < 1) { m.transparent = true; m.opacity = opacity; m.depthWrite = false }
    materials.set(key, m)
  }
  return materials.get(key)
}

export function disposeMaterials() {
  for (const m of materials.values()) { m.map?.dispose(); m.dispose() }
  materials.clear()
}

// Una caja redondeada, apoyada en su base: (x, y, z) es el centro de la cara de abajo.
export function box(w, h, d, color, { r = 0.06, x = 0, y = 0, z = 0, material } = {}) {
  const radius = Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001)
  const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, Math.max(radius, 0.001)), material || mat(color))
  mesh.position.set(x, y + h / 2, z)
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

export function cylinder(rTop, rBottom, h, color, { x = 0, y = 0, z = 0, segments = 24, material } = {}) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, h, segments), material || mat(color))
  mesh.position.set(x, y + h / 2, z)
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

// ── texturas pintadas ──────────────────────────────────────────────────────────────────────────────────

export function canvasTexture(width, height, draw) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  draw(canvas.getContext('2d'), width, height)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

function texturedPlane(w, h, texture, { emissive = false } = {}) {
  const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.7 })
  if (emissive) { material.emissive = new THREE.Color('#ffffff'); material.emissiveMap = texture; material.emissiveIntensity = 0.45 }
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material)
  mesh.receiveShadow = true
  return mesh
}

// Una pantalla: líneas de código, un tablero o un gráfico, según `kind`.
function screenTexture(kind, accent) {
  return canvasTexture(256, 160, (g, w, h) => {
    g.fillStyle = '#1d2433'; g.fillRect(0, 0, w, h)
    if (kind === 'code') {
      const colors = [accent, '#9ad1ff', '#f6b26b', '#c3e88d', '#ffffff']
      for (let i = 0; i < 11; i++) {
        g.fillStyle = colors[i % colors.length]
        g.globalAlpha = 0.85
        g.fillRect(16 + (i % 3) * 14, 14 + i * 12, 40 + ((i * 37) % 140), 6)
      }
    } else if (kind === 'chart') {
      g.fillStyle = '#ffffff'; g.globalAlpha = 0.9; g.font = 'bold 18px sans-serif'; g.fillText('Resultados', 14, 26)
      g.globalAlpha = 1
      const bars = [0.35, 0.55, 0.45, 0.7, 0.62, 0.85, 0.78]
      bars.forEach((v, i) => { g.fillStyle = i === bars.length - 1 ? accent : '#7f9be0'; g.fillRect(18 + i * 32, h - 16 - v * 100, 20, v * 100) })
    } else if (kind === 'board') {
      ['#ffffff', accent, '#9ad1ff'].forEach((c, col) => {
        g.fillStyle = '#2a3346'; g.fillRect(10 + col * 82, 12, 74, h - 24)
        for (let i = 0; i < 4 - col; i++) { g.fillStyle = c; g.globalAlpha = 0.9; g.fillRect(16 + col * 82, 22 + i * 30, 62, 22) }
        g.globalAlpha = 1
      })
    }
  })
}

// ── muebles ────────────────────────────────────────────────────────────────────────────────────────────

export function desk({ w = 2.4, d = 1.1, color = PALETTE.white, legs = PALETTE.charcoal, screens = 1, screenKind = 'code', accent = PALETTE.accent } = {}) {
  const g = new THREE.Group()
  const h = 1.05
  g.add(box(w, 0.1, d, color, { y: h - 0.1, r: 0.04 }))
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    g.add(box(0.08, h - 0.1, 0.08, legs, { x: sx * (w / 2 - 0.14), z: sz * (d / 2 - 0.12), r: 0.02 }))
  }
  // Monitores, mirando hacia +z (hacia quien se sienta).
  const spread = screens === 1 ? [0] : screens === 2 ? [-0.55, 0.55] : [-1, 0, 1]
  spread.forEach((sx, i) => {
    const monitor = new THREE.Group()
    monitor.add(box(0.08, 0.32, 0.08, PALETTE.charcoal, { y: 0, r: 0.02 }))
    monitor.add(box(0.36, 0.03, 0.22, PALETTE.charcoal, { y: 0, r: 0.01 }))
    monitor.add(box(0.95, 0.58, 0.06, PALETTE.charcoal, { y: 0.3, r: 0.03 }))
    const screen = texturedPlane(0.86, 0.5, screenTexture(screenKind, accent), { emissive: true })
    screen.position.set(0, 0.59, 0.035)
    monitor.add(screen)
    monitor.position.set(sx * 0.95, h, -d / 2 + 0.3)
    monitor.rotation.y = screens === 3 ? -sx * 0.25 : 0
    g.add(monitor)
    if (i === 0) g.add(box(0.7, 0.03, 0.22, PALETTE.creamDark, { x: 0, y: h, z: 0.12, r: 0.01 }))
  })
  // Una taza, porque toda oficina tiene una.
  g.add(cylinder(0.07, 0.06, 0.16, accent, { x: w / 2 - 0.35, y: h, z: 0.18 }))
  return g
}

export function chair({ color = PALETTE.primary, executive = false } = {}) {
  const g = new THREE.Group()
  g.add(cylinder(0.05, 0.05, 0.42, PALETTE.charcoal, { y: 0.06 }))
  for (let i = 0; i < 5; i++) {
    const leg = box(0.42, 0.05, 0.07, PALETTE.charcoal, { r: 0.02 })
    leg.position.y = 0.04
    leg.rotation.y = (i / 5) * Math.PI * 2
    leg.position.x = Math.cos(leg.rotation.y) * 0.18
    leg.position.z = -Math.sin(leg.rotation.y) * 0.18
    g.add(leg)
  }
  g.add(box(0.62, 0.12, 0.6, color, { y: 0.48, r: 0.06 }))
  g.add(box(0.62, executive ? 0.95 : 0.6, 0.12, color, { y: 0.58, z: 0.26, r: 0.06 }))
  if (executive) for (const sx of [-1, 1]) g.add(box(0.08, 0.06, 0.42, PALETTE.charcoal, { x: sx * 0.34, y: 0.72, r: 0.02 }))
  return g
}

export function plant({ size = 1, leaves = PALETTE.green } = {}) {
  const g = new THREE.Group()
  g.add(cylinder(0.32 * size, 0.25 * size, 0.55 * size, PALETTE.pot))
  g.add(cylinder(0.3 * size, 0.3 * size, 0.04, PALETTE.woodDark, { y: 0.52 * size }))
  const leaf = new THREE.SphereGeometry(0.32 * size, 16, 12)
  const spots = [[0, 1.25, 0, 0], [0.32, 1.0, 0.1, -0.6], [-0.3, 1.05, -0.05, 0.6], [0.1, 0.95, -0.32, 0.3], [-0.12, 0.9, 0.3, -0.3]]
  spots.forEach(([x, y, z, tilt], i) => {
    const m = new THREE.Mesh(leaf, mat(i % 2 ? PALETTE.greenDark : leaves))
    m.scale.set(1, 0.35, 0.65)
    m.position.set(x * size, y * size, z * size)
    m.rotation.set(tilt, i, tilt * 0.6)
    m.castShadow = true
    g.add(m)
  })
  g.add(cylinder(0.025, 0.03, 0.8 * size, PALETTE.greenDark, { y: 0.5 * size }))
  return g
}

export function sofa({ w = 2.6, color = PALETTE.white, frame = PALETTE.accent, pillows = [PALETTE.accent, PALETTE.primary, PALETTE.accent] } = {}) {
  const g = new THREE.Group()
  g.add(box(w, 0.12, 1.05, frame, { y: 0.18, r: 0.04 }))
  for (const sx of [-1, 1]) g.add(box(0.07, 0.2, 0.07, PALETTE.woodDark, { x: sx * (w / 2 - 0.15), z: 0.38, r: 0.02 }))
  const seats = Math.max(2, Math.round(w / 1.2))
  const seatW = (w - 0.4) / seats
  for (let i = 0; i < seats; i++) g.add(box(seatW - 0.04, 0.28, 0.85, color, { x: -w / 2 + 0.2 + seatW * (i + 0.5), y: 0.3, z: 0.06, r: 0.1 }))
  g.add(box(w, 0.7, 0.28, color, { y: 0.3, z: -0.4, r: 0.12 }))
  for (const sx of [-1, 1]) g.add(box(0.24, 0.55, 1.0, color, { x: sx * (w / 2 - 0.1), y: 0.3, r: 0.1 }))
  pillows.forEach((c, i) => {
    const p = box(0.55, 0.5, 0.16, c, { x: -w / 2 + 0.55 + i * ((w - 1.1) / Math.max(1, pillows.length - 1)), y: 0.55, z: -0.18, r: 0.08 })
    p.rotation.z = (i - 1) * 0.12
    p.rotation.x = -0.2
    g.add(p)
  })
  return g
}

export function armchair({ color = PALETTE.accent, pillow = PALETTE.white } = {}) {
  const g = new THREE.Group()
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const leg = cylinder(0.04, 0.03, 0.3, PALETTE.charcoal, { x: sx * 0.38, z: sz * 0.32 })
    leg.rotation.z = sx * 0.15
    g.add(leg)
  }
  g.add(box(1.05, 0.45, 0.95, color, { y: 0.28, r: 0.22 }))
  g.add(box(1.1, 0.75, 0.3, color, { y: 0.45, z: -0.38, r: 0.15 }))
  for (const sx of [-1, 1]) g.add(box(0.25, 0.45, 0.9, color, { x: sx * 0.48, y: 0.5, r: 0.12 }))
  const p = box(0.5, 0.42, 0.14, pillow, { y: 0.75, z: -0.15, r: 0.08 })
  p.rotation.x = -0.25
  g.add(p)
  return g
}

export function coffeeTable({ r = 0.55, color = PALETTE.white } = {}) {
  const g = new THREE.Group()
  g.add(cylinder(r, r, 0.12, color, { y: 0.45, segments: 32 }))
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2
    const leg = cylinder(0.04, 0.035, 0.48, PALETTE.charcoal, { x: Math.cos(a) * r * 0.55, z: Math.sin(a) * r * 0.55 })
    leg.rotation.set(Math.sin(a) * 0.18, 0, -Math.cos(a) * 0.18)
    g.add(leg)
  }
  g.add(cylinder(0.11, 0.11, 0.2, PALETTE.primary, { y: 0.57 }))
  return g
}

// Una alfombra con dibujo de rombos y triángulos, como la de la referencia.
export function rug(w, d, { base = PALETTE.accent, accent = PALETTE.yellow, mid = PALETTE.primarySoft } = {}) {
  const texture = canvasTexture(512, Math.round(512 * d / w), (g, W, H) => {
    g.fillStyle = base; g.fillRect(0, 0, W, H)
    g.fillStyle = mid; g.fillRect(28, 28, W - 56, H - 56)
    g.fillStyle = PALETTE.white
    for (let x = 0; x < W; x += 24) { g.beginPath(); g.moveTo(x, 6); g.lineTo(x + 12, 22); g.lineTo(x + 24, 6); g.fill() }
    for (let x = 0; x < W; x += 24) { g.beginPath(); g.moveTo(x, H - 6); g.lineTo(x + 12, H - 22); g.lineTo(x + 24, H - 6); g.fill() }
    const step = 56
    for (let y = 56; y < H - 40; y += step) for (let x = 56; x < W - 40; x += step) {
      g.fillStyle = (x / step + y / step) % 2 ? accent : base
      g.beginPath(); g.moveTo(x, y - 18); g.lineTo(x + 18, y); g.lineTo(x, y + 18); g.lineTo(x - 18, y); g.fill()
      g.fillStyle = PALETTE.white; g.fillRect(x - 4, y - 4, 8, 8)
    }
  })
  const g = new THREE.Group()
  const edge = box(w, 0.04, d, base, { r: 0.015 })
  edge.castShadow = false
  g.add(edge)
  const top = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.02, d - 0.02), new THREE.MeshStandardMaterial({ map: texture, roughness: 0.95 }))
  top.rotation.x = -Math.PI / 2
  top.position.y = 0.042
  top.receiveShadow = true
  g.add(top)
  return g
}

export function bookshelf({ w = 1.8, h = 2.4, color = PALETTE.white } = {}) {
  const g = new THREE.Group()
  const d = 0.45
  g.add(box(w, h, 0.06, color, { z: -d / 2 + 0.03, r: 0.02 }))
  for (const sx of [-1, 1]) g.add(box(0.07, h, d, color, { x: sx * (w / 2 - 0.035), r: 0.02 }))
  const shelves = 4
  const colors = [PALETTE.accent, PALETTE.primary, PALETTE.yellow, PALETTE.teal, PALETTE.white, PALETTE.primarySoft, PALETTE.pink]
  for (let s = 0; s <= shelves; s++) {
    const y = (s / shelves) * (h - 0.06)
    g.add(box(w - 0.08, 0.06, d, color, { y, r: 0.01 }))
    if (s === shelves) continue
    let x = -w / 2 + 0.12
    let i = s * 3
    while (x < w / 2 - 0.25) {
      const bw = 0.08 + ((i * 7) % 5) * 0.02
      const bh = 0.32 + ((i * 11) % 4) * 0.04
      if ((i * 13) % 9 === 0) { x += 0.12; i++; continue }
      const book = box(bw, bh, 0.3, colors[i % colors.length], { x: x + bw / 2, y: y + 0.06, r: 0.01 })
      if ((i * 5) % 11 === 0) book.rotation.z = 0.18
      g.add(book)
      x += bw + 0.015
      i++
    }
  }
  return g
}

// Un tablero kanban de pared: tres columnas con notas de colores.
export function kanban({ w = 3.2, h = 1.8 } = {}) {
  const g = new THREE.Group()
  g.add(box(w + 0.12, h + 0.12, 0.06, PALETTE.charcoal, { r: 0.03 }))
  g.add(box(w, h, 0.08, PALETTE.white, { y: 0.06, r: 0.02 }))
  const columns = [['Por hacer', PALETTE.yellow], ['En curso', PALETTE.accentSoft], ['Hecho', '#9fd99b']]
  const colW = w / 3
  columns.forEach(([, color], c) => {
    const header = box(colW - 0.2, 0.1, 0.02, PALETTE.primary, { x: -w / 2 + colW * (c + 0.5), y: h - 0.12, z: 0.06, r: 0.01 })
    g.add(header)
    for (let i = 0; i < 4 - c; i++) {
      const note = box(0.42, 0.34, 0.03, color, { x: -w / 2 + colW * (c + 0.5) + (i % 2 ? 0.24 : -0.24), y: h - 0.62 - Math.floor(i / 2) * 0.45, z: 0.07, r: 0.01 })
      note.rotation.z = ((i * 7) % 5 - 2) * 0.03
      g.add(note)
    }
  })
  return g
}

// Una pizarra con un diagrama de cajas y flechas: la del arquitecto.
export function whiteboard({ w = 2.6, h = 1.5, standing = true } = {}) {
  const g = new THREE.Group()
  const texture = canvasTexture(512, Math.round(512 * h / w), (c, W, H) => {
    c.fillStyle = '#fdfdfb'; c.fillRect(0, 0, W, H)
    const boxes = [[40, 40, PALETTE.primary], [210, 40, PALETTE.accent], [380, 40, PALETTE.teal], [125, 170, PALETTE.primary], [300, 170, PALETTE.accent]]
    c.lineWidth = 5
    const link = (a, b) => { c.strokeStyle = '#555c6e'; c.beginPath(); c.moveTo(a[0] + 45, a[1] + 55); c.lineTo(b[0] + 45, b[1]); c.stroke() }
    link(boxes[0], boxes[3]); link(boxes[1], boxes[3]); link(boxes[1], boxes[4]); link(boxes[2], boxes[4])
    boxes.forEach(([x, y, color]) => { c.strokeStyle = color; c.strokeRect(x, y, 90, 55); c.fillStyle = color; c.globalAlpha = 0.15; c.fillRect(x, y, 90, 55); c.globalAlpha = 1 })
  })
  const frameY = standing ? 0.9 : 0
  g.add(box(w + 0.1, h + 0.1, 0.06, PALETTE.creamDark, { y: frameY, r: 0.03 }))
  const board = texturedPlane(w, h, texture)
  board.position.set(0, frameY + h / 2 + 0.05, 0.035)
  g.add(board)
  g.add(box(w * 0.6, 0.05, 0.12, PALETTE.creamDark, { y: frameY - 0.02, z: 0.07, r: 0.02 }))
  if (standing) {
    for (const sx of [-1, 1]) {
      g.add(box(0.07, frameY + h, 0.07, PALETTE.charcoal, { x: sx * (w / 2 + 0.06), r: 0.02 }))
      g.add(box(0.07, 0.05, 0.7, PALETTE.charcoal, { x: sx * (w / 2 + 0.06), r: 0.02 }))
    }
  }
  return g
}

// Un cuadro como los de la referencia: círculos de colores sobre blanco, con marco azul.
export function artFrame({ w = 0.9, h = 1.1, kind = 0 } = {}) {
  const g = new THREE.Group()
  const texture = canvasTexture(180, 220, (c, W, H) => {
    c.fillStyle = PALETTE.white; c.fillRect(0, 0, W, H)
    if (kind === 0) { c.strokeStyle = PALETTE.accent; c.lineWidth = 14; c.beginPath(); c.arc(W / 2, H / 2, 46, 0, Math.PI * 2); c.stroke(); c.fillStyle = PALETTE.primary; c.beginPath(); c.arc(W / 2, H / 2, 24, 0, Math.PI * 2); c.fill() }
    if (kind === 1) { c.fillStyle = PALETTE.accent; c.beginPath(); c.arc(W / 2, H / 2, 55, 0, Math.PI * 2); c.fill() }
    if (kind === 2) { c.fillStyle = PALETTE.accent; c.beginPath(); c.arc(W / 2 - 18, H / 2 - 12, 44, 0, Math.PI * 2); c.fill(); c.fillStyle = PALETTE.primary; c.globalAlpha = 0.9; c.beginPath(); c.arc(W / 2 + 18, H / 2 + 14, 44, 0, Math.PI * 2); c.fill() }
  })
  g.add(box(w, h, 0.06, PALETTE.primary, { r: 0.02 }))
  const art = texturedPlane(w - 0.16, h - 0.16, texture)
  art.position.set(0, h / 2, 0.032)
  g.add(art)
  return g
}

// Una pantalla grande de pared: donde se muestran los resultados.
export function wallScreen({ w = 3, h = 1.7, kind = 'chart', accent = PALETTE.accent } = {}) {
  const g = new THREE.Group()
  g.add(box(w, h, 0.08, PALETTE.charcoal, { r: 0.04 }))
  const screen = texturedPlane(w - 0.14, h - 0.14, screenTexture(kind, accent), { emissive: true })
  screen.position.set(0, h / 2, 0.042)
  g.add(screen)
  return g
}

export function floorLamp({ shade = PALETTE.white } = {}) {
  const g = new THREE.Group()
  g.add(cylinder(0.22, 0.25, 0.05, PALETTE.primaryDeep))
  g.add(cylinder(0.025, 0.025, 1.3, PALETTE.primaryDeep, { y: 0.05 }))
  g.add(cylinder(0.25, 0.3, 0.6, shade, { y: 1.25, material: mat(shade, { emissive: '#fff4dc' }) }))
  return g
}

// Una ventana de pared con cortinas: el marco va en la pared, que la esconde con ella.
export function windowWithCurtains({ w = 1.6, h = 1.7, curtain = PALETTE.primary } = {}) {
  const g = new THREE.Group()
  g.add(box(w, h, 0.08, PALETTE.white, { r: 0.03 }))
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.2, h - 0.2), mat(PALETTE.glass, { rough: 0.2, emissive: '#cfe3ff' }))
  glass.position.set(0, h / 2, 0.045)
  g.add(glass)
  g.add(box(0.06, h - 0.2, 0.04, PALETTE.white, { y: 0.1, z: 0.05, r: 0.01 }))
  g.add(box(w - 0.2, 0.06, 0.04, PALETTE.white, { y: h / 2, z: 0.05, r: 0.01 }))
  g.add(box(w + 0.8, 0.05, 0.05, PALETTE.creamDark, { y: h + 0.15, z: 0.15, r: 0.02 }))
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 3; i++) g.add(box(0.18, h + 0.3, 0.18, curtain, { x: sx * (w / 2 + 0.1 + i * 0.12), y: -0.15, z: 0.18, r: 0.08 }))
  }
  g.add(box(w + 0.1, 0.08, 0.25, PALETTE.white, { y: -0.04, z: 0.1, r: 0.02 }))
  return g
}

export function coffeeBar() {
  const g = new THREE.Group()
  g.add(box(2.2, 1.0, 0.7, PALETTE.wood, { r: 0.05 }))
  g.add(box(2.3, 0.08, 0.78, PALETTE.white, { y: 1.0, r: 0.03 }))
  g.add(box(0.45, 0.6, 0.4, PALETTE.charcoal, { x: -0.6, y: 1.08, r: 0.06 }))
  g.add(box(0.3, 0.12, 0.12, PALETTE.accent, { x: -0.6, y: 1.45, z: 0.15, r: 0.03 }))
  for (let i = 0; i < 3; i++) g.add(cylinder(0.07, 0.06, 0.16, [PALETTE.white, PALETTE.primary, PALETTE.accent][i], { x: 0.2 + i * 0.22, y: 1.08 }))
  return g
}

// Un tabique bajo: separa zonas sin tapar la vista desde arriba.
export function partition(length, { h = 1.2, color = PALETTE.cream, glassTop = false } = {}) {
  const g = new THREE.Group()
  g.add(box(length, h, 0.18, color, { r: 0.05 }))
  g.add(box(length + 0.04, 0.08, 0.22, PALETTE.primary, { y: h - 0.02, r: 0.03 }))
  if (glassTop) {
    const glass = new THREE.Mesh(new THREE.BoxGeometry(length, 1.6, 0.05), mat(PALETTE.glass, { rough: 0.1, opacity: 0.28 }))
    glass.position.y = h + 0.8
    g.add(glass)
    g.add(box(length, 0.06, 0.1, PALETTE.white, { y: h + 1.6, r: 0.02 }))
  }
  return g
}
