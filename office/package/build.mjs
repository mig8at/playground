#!/usr/bin/env node
// OFFICE · ARMA EL PAQUETE para compartir los personajes: un solo archivo, dist/office-characters.js, con el dibujo
// (office/characters.js), el estilo (office/characters.css) y el logo adentro, más el componente <office-personaje> y
// unas pocas funciones. Copia también la página de ejemplo y el README.
//
//   node office/package/build.mjs                     (o make office-package)
//   node office/package/build.mjs --js <archivo>      además deja sólo el JS ahí (el chat lo usa así)
//   node office/package/build.mjs --dest <carpeta>     además lo publica ahí con el editor como index.html (así va
//                                                     al playground compartido: tools/home/public/personajes)
//
// La fuente de verdad sigue siendo office/: el paquete se regenera, no se edita a mano.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const office = join(here, '..')
const dist = join(here, 'dist')
const source = readFileSync(join(office, 'characters.js'), 'utf8')
const css = readFileSync(join(office, 'characters.css'), 'utf8')
  // en el paquete el personaje es un SVG suelto: sin el marco ni el salto del recuadro de la llamada
  + '\nsvg.tile { box-shadow: none !important; transform: none !important; border-radius: inherit; }\n'

const api = `
// ── EL PAQUETE ───────────────────────────────────────────────────────────────────────────────────
// Los nombres están en inglés desde el 2026-11-18 (regla de my-tools: el código en inglés). Los de antes —personaje,
// alAzar, dibujar, OPCIONES, <office-personaje> y sus atributos gesto, fondo, boca, actividad, portatil, mira— siguen
// funcionando: los usan páginas del playground compartido.
const CSS = ${JSON.stringify(css)}

// Los gestos: la clase del dibujo, o su nombre en español.
const GESTURES = { idle: 'idle', typing: 'typing', thinking: 'thinking', talking: 'talking', escucha: 'idle', teclea: 'typing', piensa: 'thinking', habla: 'talking' }
// lo que hace mientras tanto: la clave del dibujo (ACTIVITIES en characters.js), o su nombre en español
const ACTIVITY_KEYS = { coffee: 'coffee', music: 'music', headphones: 'music', wave: 'wave', thumb: 'thumb', celebrate: 'celebrate', laugh: 'laugh', surprise: 'surprise', confused: 'confused',
  cafe: 'coffee', musica: 'music', audifonos: 'music', saluda: 'wave', pulgar: 'thumb', celebra: 'celebrate', rie: 'laugh', sorpresa: 'surprise', duda: 'confused' }
// los atributos de antes → los de ahora
const LEGACY_ATTRS = { gesto: 'gesture', fondo: 'background', boca: 'mouth', actividad: 'activity', portatil: 'laptop', mira: 'look' }
// Lo que lleva un personaje si su JSON no lo dice.
const BASE = { name: 'Personaje', owner: '', species: '', skin: '#e0ac7e', hair: 'side', hairColor: '#4a2f1c', face: 'round', nose: 'button', teeth: 'grin', eye: 25,
  extras: [], beardStyle: '', hat: '', hatColor: '#c5381f', lashes: false, lids: false, glassesRound: false, gear: '#13323a', shirt: '#2b6670', accent: '#f1e4c7', scene: 'sunset' }
let serial = 0

/** El personaje completo a partir de un JSON parcial (o un texto JSON). */
export function character(config = {}) {
  const c = typeof config === 'string' ? JSON.parse(config) : config
  const p = { ...BASE, ...c }
  if (p.species && !c.skin && P.OPTIONS.skinBy[p.species]) p.skin = P.OPTIONS.skinBy[p.species][0]
  // un id propio por dibujo: los recortes de la boca usan ids y no pueden repetirse en la página
  return { ...p, id: \`op\${++serial}\`, kind: p.owner ? 'agent' : 'human', agent: !!p.owner }
}

/** El SVG del personaje como texto. options: { gesture: 'idle'|'typing'|'thinking'|'talking', background: true|false } */
export function svg(config, options = {}) {
  const gesture = options.gesture ?? options.gesto ?? 'idle', background = options.background ?? options.fondo ?? true
  const p = character(config), st = GESTURES[gesture] || 'idle'
  const scene = background ? P.sceneOf(p) : ''
  return \`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" class="tile \${st}" style="--d:\${-(Math.random() * 5).toFixed(2)}s">\${scene}<g transform="translate(46 54) scale(.77)"><g class="avatar">\${P.person(p)}</g></g></svg>\`
}

/** Un personaje al azar, armado sólo con el catálogo. base fija lo que no se quiere sortear (nombre, especie…). */
export function randomCharacter(base = {}) {
  const p = P.randomPerson({ ...BASE, ...base })
  if (p.species && P.OPTIONS.skinBy[p.species]) p.skin = P.OPTIONS.skinBy[p.species][Math.floor(Math.random() * P.OPTIONS.skinBy[p.species].length)]
  const { id, kind, agent, ...rest } = p
  return rest
}

/** Lo que se puede elegir: especies, caras, peinados, barbas, gorros, colores, fondos. */
export const OPTIONS = P.OPTIONS

// ── EL COMPONENTE ────────────────────────────────────────────────────────────────────────────────
// <office-character config='{"name":"Ana","hair":"curly"}' gesture="talking" background="false"></office-character>
// mouth="0.7": la boca la mueve quien lo usa (de 0 cerrada a 1 abierta, p. ej. con el volumen de un audio); sin el
// atributo, la boca hace su vaivén propio.
// Su estilo vive en su propio shadow DOM: no toca ni lo toca el CSS de la página. Sólo existe en el navegador: en Node
// (un servidor que genere avatares) se usan svg() y randomCharacter().
export const OfficeCharacter = typeof HTMLElement === 'undefined' ? null : class extends HTMLElement {
  static observedAttributes = ['config', 'gesture', 'background', 'mouth', 'activity', 'laptop', 'look', ...Object.keys(LEGACY_ATTRS)]
  #config = {}
  constructor() { super(); this.attachShadow({ mode: 'open' }) }
  get config() { return this.#config }
  set config(v) { this.#config = typeof v === 'string' ? JSON.parse(v) : v; this.render() }
  // un atributo por su nombre de ahora o el de antes
  #attr(name) {
    if (this.hasAttribute(name)) return this.getAttribute(name)
    const old = Object.keys(LEGACY_ATTRS).find((k) => LEGACY_ATTRS[k] === name)
    return old && this.hasAttribute(old) ? this.getAttribute(old) : null
  }
  get gesture() { return this.#attr('gesture') || 'idle' }
  set gesture(v) { this.removeAttribute('gesto'); this.setAttribute('gesture', v) }
  get gesto() { return this.gesture } // el nombre de antes
  set gesto(v) { this.gesture = v }
  attributeChangedCallback(raw) {
    const name = LEGACY_ATTRS[raw] || raw
    if (name === 'config') { try { this.#config = JSON.parse(this.getAttribute('config') || '{}') } catch { this.#config = {} } }
    // svg.tile y no el primer svg: antes va el del logo (escondido), y cambiarle la clase a ése no mueve nada
    const svg = this.shadowRoot.querySelector('svg.tile')
    if (name === 'gesture' && svg) { svg.setAttribute('class', \`tile \${GESTURES[this.gesture] || 'idle'}\`); this.#mouth(svg); this.#activity(svg); return }
    if ((name === 'activity' || name === 'laptop' || name === 'look') && svg) { this.#activity(svg); return }
    if (name === 'mouth' && svg) { this.#mouth(svg); return }
    this.render()
  }
  // la boca movida desde afuera: la clase lipsync y la apertura en --mouth
  #mouth(svg) {
    const v = this.#attr('mouth')
    svg.classList.toggle('lipsync', v !== null)
    if (v !== null) svg.style.setProperty('--mouth', String(Math.max(0, Math.min(1, Number(v) || 0))))
  }
  // lo que hace mientras tanto: activity="coffee|music|wave|thumb|celebrate|laugh|surprise|confused" y
  // laptop="open|closed" (sin el atributo, no tiene portátil). Son clases del recuadro, como el gesto: no se redibuja.
  #activity(svg) {
    const act = ACTIVITY_KEYS[this.#attr('activity')] || '', lap = this.#attr('laptop')
    for (const k of new Set(Object.values(ACTIVITY_KEYS))) svg.classList.toggle(\`act-\${k}\`, k === act)
    svg.classList.toggle('has-laptop', lap !== null && lap !== 'no')
    svg.classList.toggle('lid-closed', lap === 'closed' || lap === 'cerrado' || act === 'coffee')
    // look="dx,dy": adónde mira (la dirección hacia quien habla, de -1 a 1); sin el atributo, mira por su cuenta
    const [lx, ly] = (this.#attr('look') || '').split(',').map(Number), look = Number.isFinite(lx) && Number.isFinite(ly)
    svg.classList.toggle('looking', look)
    if (look) { svg.style.setProperty('--lx', String(lx)); svg.style.setProperty('--ly', String(ly)) }
  }
  connectedCallback() { this.render() }
  render() {
    if (!this.isConnected) return
    this.shadowRoot.innerHTML = \`<style>:host{display:inline-block;width:240px;aspect-ratio:4/3;border-radius:18px;overflow:hidden}svg.tile{width:100%;height:100%;display:block}\${CSS}</style>\${P.LOGO_SVG}\${svg(this.#config, { gesture: this.gesture, background: this.#attr('background') !== 'false' })}\`
    this.#mouth(this.shadowRoot.querySelector('svg.tile'))
    this.#activity(this.shadowRoot.querySelector('svg.tile'))
  }
}
if (OfficeCharacter && typeof customElements !== 'undefined') {
  if (!customElements.get('office-character')) customElements.define('office-character', OfficeCharacter)
  // el nombre de antes, para las páginas que ya lo usan (un elemento sólo se registra una vez por clase)
  if (!customElements.get('office-personaje')) customElements.define('office-personaje', class extends OfficeCharacter {})
}

/** Atajo: dibuja un personaje dentro de un elemento y devuelve el componente (para cambiarle el gesto después). */
export function draw(el, config, options = {}) {
  const gesture = options.gesture ?? options.gesto ?? 'idle', background = options.background ?? options.fondo ?? true
  const c = document.createElement('office-character')
  c.setAttribute('gesture', gesture)
  if (!background) c.setAttribute('background', 'false')
  c.config = config
  el.replaceChildren(c)
  return c
}

// Los nombres de antes (en español), para quien ya los usa.
export const personaje = character, alAzar = randomCharacter, dibujar = draw, OPCIONES = OPTIONS, OfficePersonaje = OfficeCharacter
`

const out = `// office-characters.js — los personajes de Office en papel cortado, para usar en cualquier página.
// GENERADO por office/package/build.mjs a partir de office/characters.js y office/characters.css: no se edita a mano.
// Uso: ver README.md (junto a este archivo).
const OFFICE_PACKAGE = true
// el dibujo, tal cual está en office/characters.js, encerrado en su propio alcance
const P = (() => {
const module = { exports: {} }
${source}
return module.exports
})()
${api}`

mkdirSync(dist, { recursive: true })
writeFileSync(join(dist, 'office-characters.js'), out)
copyFileSync(join(here, 'example.html'), join(dist, 'example.html'))
copyFileSync(join(here, 'README.md'), join(dist, 'README.md'))
// para que Node y los bundlers lo traten como módulo ES (y por si algún día se publica)
writeFileSync(join(dist, 'package.json'), JSON.stringify({ name: 'office-characters', version: '1.0.0', private: true, type: 'module', main: 'office-characters.js', exports: './office-characters.js' }, null, 2) + '\n')
console.log(`✔ ${join('office/package/dist', 'office-characters.js')} (${Math.round(out.length / 1024)} KB) · example.html · README.md · package.json`)

// Publicarlo en otra carpeta (el playground compartido): el JS, el editor como index.html y el README. El JS va
// también con su nombre de antes (office-personajes.js), que es el que cargan las páginas que ya lo usan.
const i = Math.max(process.argv.indexOf('--dest'), process.argv.indexOf('--destino'))
if (i > 0) {
  const destination = process.argv[i + 1]
  if (!destination) { console.error('✗ --dest necesita una carpeta'); process.exit(2) }
  mkdirSync(destination, { recursive: true })
  copyFileSync(join(dist, 'office-characters.js'), join(destination, 'office-characters.js'))
  copyFileSync(join(dist, 'office-characters.js'), join(destination, 'office-personajes.js'))
  copyFileSync(join(dist, 'example.html'), join(destination, 'index.html'))
  copyFileSync(join(dist, 'README.md'), join(destination, 'README.md'))
  console.log(`✔ publicado en ${destination}: office-characters.js (y office-personajes.js, el nombre de antes) · index.html · README.md`)
}

// Sólo el JS, en un archivo dado (lo usa el chat: chat/src/characters/office-characters.js).
const j = process.argv.indexOf('--js')
if (j > 0) {
  const file = process.argv[j + 1]
  if (!file) { console.error('✗ --js necesita un archivo'); process.exit(2) }
  mkdirSync(dirname(file), { recursive: true })
  copyFileSync(join(dist, 'office-characters.js'), file)
  console.log(`✔ ${file}`)
}
