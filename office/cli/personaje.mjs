#!/usr/bin/env node
// OFFICE · GENERAR UN PERSONAJE por consola. Usa el mismo dibujo que la llamada y el editor (office/personajes.js) y
// escribe, en una carpeta:
//   personaje.json   la configuración, los gestos y sus animaciones (qué pieza se mueve, cómo y en qué gesto)
//   escucha.svg · teclea.svg · piensa.svg · habla.svg   el personaje animado en cada gesto (SVG suelto, con su CSS)
//   ver.html         los cuatro gestos juntos, para abrirlo y mirarlo
//
//   node office/cli/personaje.mjs --especie gato --nombre Miso
//   node office/cli/personaje.mjs --azar --semilla 7 --nombre Prueba
//   node office/cli/personaje.mjs --especie oso --set hat=lana --set hatColor=#c5381f --dueno Miguel
//   node office/cli/personaje.mjs --opciones          (qué se puede elegir)
//
// Sin --salida queda en office/generados/<nombre>/. --json imprime el JSON en vez de un resumen.
import { createRequire } from 'node:module'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const office = join(here, '..')
const P = createRequire(import.meta.url)(join(office, 'personajes.js'))

// ── LOS ARGUMENTOS ───────────────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const flag = (k) => args.includes(`--${k}`)
const value = (k) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined }
const sets = args.flatMap((a, i) => (a === '--set' ? [args[i + 1]] : []))
const die = (msg) => { console.error(`✗ ${msg}`); process.exit(2) }

if (flag('opciones') || flag('help') || flag('ayuda')) {
  const o = P.OPCIONES
  const keys = (x) => Object.keys(x).filter(Boolean).join(', ')
  console.log(`especies:  ${keys(o.species)}
peinados:   ${keys(o.hair)}
gorros:     ${keys(o.hat)}
caras:      ${keys(o.face)}
narices:    ${keys(o.nose)}
dientes:    ${keys(o.teeth)}
extras:     ${keys(o.extras)} (con --set extras=lentes,... usar las claves: glasses, headphones, earrings, beard, freckles)
fondos:     ${keys(o.scene)}
Cualquier campo se fija con --set clave=valor (skin, hairColor, shirt, accent, hatColor, gear, eye, lashes, lids...).`)
  process.exit(0)
}

// Un azar con semilla: el mismo número da el mismo personaje.
function seeded(seed) {
  let a = seed >>> 0
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

// ── EL PERSONAJE ─────────────────────────────────────────────────────────────────────────────────
const BASE = { kind: 'human', species: '', skin: '#e0ac7e', hair: 'side', hairColor: '#4a2f1c', face: 'round', nose: 'button', teeth: 'grin', eye: 25,
  extras: [], hat: '', hatColor: '#c5381f', lashes: false, lids: false, glassesRound: false, gear: '#13323a', shirt: '#2b6670', accent: '#f1e4c7', scene: 'sunset' }
const species = value('especie') ?? ''
if (species && !P.SPECIES[species]) die(`no conozco la especie «${species}». Hay: ${Object.keys(P.SPECIES).join(', ')}`)

let p = { ...BASE, species }
if (flag('azar')) {
  const real = Math.random
  if (value('semilla') !== undefined) Math.random = seeded(Number(value('semilla')))
  p = P.randomPerson(p)
  if (species) p.skin = P.OPCIONES.skinBy[species][Math.floor(Math.random() * P.OPCIONES.skinBy[species].length)]
  Math.random = real
} else if (species) {
  p.skin = P.OPCIONES.skinBy[species][0]
}
for (const kv of sets) {
  const i = kv.indexOf('=')
  if (i < 0) die(`--set va como clave=valor: «${kv}»`)
  const k = kv.slice(0, i), v = kv.slice(i + 1)
  p[k] = k === 'extras' ? v.split(',').filter(Boolean) : k === 'eye' ? Number(v) : v === 'true' ? true : v === 'false' ? false : v
}
const name = value('nombre') ?? (species ? P.OPCIONES.species[species] : 'Personaje')
const owner = value('dueno') ?? value('dueño') ?? ''
const slug = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'personaje'
p = { ...p, id: slug, name, owner, kind: owner ? 'agent' : 'human', agent: !!owner }
if (p.scene && !P.SCENES[p.scene]) die(`no conozco el fondo «${p.scene}». Hay: ${Object.keys(P.SCENES).join(', ')}`)
if (!species && p.hair && !P.HAIR[p.hair]) die(`no conozco el peinado «${p.hair}». Hay: ${Object.keys(P.HAIR).join(', ')}`)
if (p.hat && !P.HATS[p.hat]) die(`no conozco el gorro «${p.hat}». Hay: ${Object.keys(P.HATS).join(', ')}`)

// ── LAS ANIMACIONES, LEÍDAS DEL CSS ──────────────────────────────────────────────────────────────
// La fuente de verdad es personajes.css (lo que usa la llamada): de ahí salen los @keyframes y qué pieza los usa en
// qué gesto. Así el JSON nunca dice algo distinto de lo que se ve.
const css = readFileSync(join(office, 'personajes.css'), 'utf8')
const STATES = { idle: 'escucha', typing: 'teclea', thinking: 'piensa', talking: 'habla' }
const keyframes = {}
for (const m of css.matchAll(/@keyframes\s+([\w-]+)\s*\{((?:[^{}]*\{[^{}]*\})*)\s*\}/g)) keyframes[m[1]] = m[2].replace(/\s+/g, ' ').trim()
const PART = { body: 'cuerpo', head: 'cabeza', eyes: 'ojos (parpadeo)', pupils: 'pupilas', mouth: 'boca', 'beak-jaw': 'pico, parte de abajo', 'beak-top': 'pico, parte de arriba',
  'beak-inside': 'boca dentro del pico', glow: 'luces', 'brow-l': 'ceja izquierda', 'brow-r': 'ceja derecha', 'hand-l': 'mano izquierda (teclea)', 'hand-r': 'mano derecha (teclea)', 'hand-chin': 'mano en la barbilla (piensa)' }
const animations = []
const poses = []
for (const m of css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
  const selector = m[1].trim(), body = m[2]
  if (selector.startsWith('from') || selector.startsWith('to') || /^\d/.test(selector)) continue
  const states = Object.keys(STATES).filter((st) => selector.includes(`.tile.${st}`))
  const part = Object.keys(PART).find((k) => new RegExp(`\\.${k}(\\b|$|\\.)`).test(selector.split(',').pop()))
  if (!part) continue
  const anim = body.match(/animation:\s*([^;]+)/)
  const transform = body.match(/(?:^|;)\s*transform:\s*([^;]+)/)
  if (anim) {
    const [nm, dur, ...rest] = anim[1].trim().split(/\s+/)
    if (!keyframes[nm]) continue
    // la boca que se anima vive dentro de la boca de hablar: sólo se ve (y se mueve) en ese gesto
    const when = states.length ? states : part === 'mouth' ? ['talking'] : 'siempre'
    animations.push({ part, what: PART[part], states: when, keyframes: nm, duration: dur, timing: rest.filter((x) => !/infinite|alternate/.test(x)).join(' ') || 'ease',
      repeat: rest.includes('infinite') ? 'infinite' : 1, alternate: rest.includes('alternate'), frames: keyframes[nm] })
  } else if (transform && states.length) {
    poses.push({ part, what: PART[part], states, transform: transform[1].trim() })
  }
}
// las bocas: cuál se ve en cada gesto
const mouths = { idle: 'm-smile', typing: 'm-flat', thinking: 'm-think', talking: 'm-talk' }

// ── LOS ARCHIVOS ─────────────────────────────────────────────────────────────────────────────────
const out = value('salida') ? join(process.cwd(), value('salida')) : join(office, 'generados', slug)
const symbols = P.LOGO_SVG.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')
const svgFor = (st) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" class="tile ${st}" width="400" height="300">
<style><![CDATA[${css}
/* fuera de la llamada: el recuadro es este SVG */ svg.tile { box-shadow: none; transform: none; }]]></style>
<defs>${symbols}</defs>
${(P.SCENES[p.scene] || P.SCENES.sunset)()}
<g transform="translate(46 54) scale(.77)"><g class="avatar">${P.person(p)}</g></g>
</svg>
`
mkdirSync(out, { recursive: true })
const files = {}
for (const [st, label] of Object.entries(STATES)) {
  const f = `${label}.svg`
  writeFileSync(join(out, f), svgFor(st))
  files[st] = f
}
const json = {
  schema: 'office.personaje.v1',
  generated: new Date().toISOString(),
  id: p.id, name: p.name, owner: p.owner || null, kind: p.kind, species: p.species || 'persona',
  // la configuración completa: pegada en el CAST de office/index.html, el personaje entra a la llamada
  config: Object.fromEntries(Object.entries(p).filter(([k]) => k !== 'agent')),
  states: Object.fromEntries(Object.entries(STATES).map(([st, label]) => [st, { label, svg: files[st], mouth: mouths[st], tileClass: `tile ${st}` }])),
  animations,
  poses,
  howTo: 'Cada SVG trae su CSS: cambiar el gesto es cambiar la clase del <svg> raíz (tile idle | tile typing | tile thinking | tile talking).',
}
writeFileSync(join(out, 'personaje.json'), JSON.stringify(json, null, 2) + '\n')
writeFileSync(join(out, 'ver.html'), `<!doctype html><meta charset="utf-8"><title>${p.name}</title>
<style>body{margin:0;background:#0b0c0e;color:#f6ecd6;font:14px system-ui;display:grid;grid-template-columns:repeat(2,1fr);gap:12px;padding:12px}figure{margin:0}img{width:100%;border-radius:18px;display:block}figcaption{padding:6px 2px}</style>
${Object.values(STATES).map((l) => `<figure><img src="${l}.svg" alt="${p.name}: ${l}"><figcaption>${l}</figcaption></figure>`).join('')}
`)

if (flag('json')) console.log(JSON.stringify(json, null, 2))
else {
  console.log(`✔ ${p.name}${p.owner ? ` (agente de ${p.owner})` : ''} · ${json.species}`)
  console.log(`  ${relative(process.cwd(), out)}/`)
  console.log(`  personaje.json · ${Object.values(files).join(' · ')} · ver.html`)
  console.log(`  ${animations.length} animaciones y ${poses.length} poses, leídas de personajes.css`)
}
