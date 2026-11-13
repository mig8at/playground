#!/usr/bin/env node
// OFFICE · ARMA EL PAQUETE para compartir los personajes: un solo archivo, dist/office-personajes.js, con el dibujo
// (office/personajes.js), el estilo (office/personajes.css) y el logo adentro, más el componente <office-personaje> y
// unas pocas funciones. Copia también la página de ejemplo y el README.
//
//   node office/paquete/build.mjs                     (o make office-package)
//   node office/paquete/build.mjs --js <archivo>      además deja sólo el JS ahí (el chat lo usa así)
//   node office/paquete/build.mjs --destino <carpeta>  además lo publica ahí con el editor como index.html (así va
//                                                     al playground compartido: tools/home/public/personajes)
//
// La fuente de verdad sigue siendo office/: el paquete se regenera, no se edita a mano.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const office = join(here, '..')
const dist = join(here, 'dist')
const source = readFileSync(join(office, 'personajes.js'), 'utf8')
const css = readFileSync(join(office, 'personajes.css'), 'utf8')
  // en el paquete el personaje es un SVG suelto: sin el marco ni el salto del recuadro de la llamada
  + '\nsvg.tile { box-shadow: none !important; transform: none !important; border-radius: inherit; }\n'

const api = `
// ── EL PAQUETE ───────────────────────────────────────────────────────────────────────────────────
const CSS = ${JSON.stringify(css)}

// Los gestos, en castellano o con el nombre de la clase.
const GESTOS = { escucha: 'idle', teclea: 'typing', piensa: 'thinking', habla: 'talking', idle: 'idle', typing: 'typing', thinking: 'thinking', talking: 'talking' }
// lo que hace mientras tanto, en español o con la clave del dibujo (ACTIVITIES en personajes.js); 'audifonos' es como lo llama el chat
const ACTIVIDADES = { cafe: 'coffee', musica: 'music', audifonos: 'music', saluda: 'wave', pulgar: 'thumb', celebra: 'celebrate', rie: 'laugh', sorpresa: 'surprise', duda: 'confused', laugh: 'laugh', surprise: 'surprise', confused: 'confused', coffee: 'coffee', music: 'music', wave: 'wave', thumb: 'thumb', celebrate: 'celebrate' }
// Lo que lleva un personaje si su JSON no lo dice.
const BASE = { name: 'Personaje', owner: '', species: '', skin: '#e0ac7e', hair: 'side', hairColor: '#4a2f1c', face: 'round', nose: 'button', teeth: 'grin', eye: 25,
  extras: [], beardStyle: '', hat: '', hatColor: '#c5381f', lashes: false, lids: false, glassesRound: false, gear: '#13323a', shirt: '#2b6670', accent: '#f1e4c7', scene: 'sunset' }
let serial = 0

/** El personaje completo a partir de un JSON parcial (o un texto JSON). */
export function personaje(config = {}) {
  const c = typeof config === 'string' ? JSON.parse(config) : config
  const p = { ...BASE, ...c }
  if (p.species && !c.skin && P.OPCIONES.skinBy[p.species]) p.skin = P.OPCIONES.skinBy[p.species][0]
  // un id propio por dibujo: los recortes de la boca usan ids y no pueden repetirse en la página
  return { ...p, id: \`op\${++serial}\`, kind: p.owner ? 'agent' : 'human', agent: !!p.owner }
}

/** El SVG del personaje como texto. opciones: { gesto: 'escucha'|'teclea'|'piensa'|'habla', fondo: true|false } */
export function svg(config, { gesto = 'escucha', fondo = true } = {}) {
  const p = personaje(config), st = GESTOS[gesto] || 'idle'
  const scene = fondo ? (P.SCENES[p.scene] || P.SCENES.sunset)() : ''
  return \`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" class="tile \${st}" style="--d:\${-(Math.random() * 5).toFixed(2)}s">\${scene}<g transform="translate(46 54) scale(.77)"><g class="avatar">\${P.person(p)}</g></g></svg>\`
}

/** Un personaje al azar, armado sólo con el catálogo. base fija lo que no se quiere sortear (nombre, especie…). */
export function alAzar(base = {}) {
  const p = P.randomPerson({ ...BASE, ...base })
  if (p.species && P.OPCIONES.skinBy[p.species]) p.skin = P.OPCIONES.skinBy[p.species][Math.floor(Math.random() * P.OPCIONES.skinBy[p.species].length)]
  const { id, kind, agent, ...rest } = p
  return rest
}

/** Lo que se puede elegir: especies, caras, peinados, barbas, gorros, colores, fondos. */
export const OPCIONES = P.OPCIONES

// ── EL COMPONENTE ────────────────────────────────────────────────────────────────────────────────
// <office-personaje config='{"name":"Ana","hair":"curly"}' gesto="habla" fondo="false"></office-personaje>
// boca="0.7": la boca la mueve quien lo usa (de 0 cerrada a 1 abierta, p. ej. con el volumen de un audio); sin el
// atributo, la boca hace su vaivén propio.
// Su estilo vive en su propio shadow DOM: no toca ni lo toca el CSS de la página. Sólo existe en el navegador: en Node
// (un servidor que genere avatares) se usan svg() y alAzar().
export const OfficePersonaje = typeof HTMLElement === 'undefined' ? null : class extends HTMLElement {
  static observedAttributes = ['config', 'gesto', 'fondo', 'boca', 'actividad', 'portatil', 'mira']
  #config = {}
  constructor() { super(); this.attachShadow({ mode: 'open' }) }
  get config() { return this.#config }
  set config(v) { this.#config = typeof v === 'string' ? JSON.parse(v) : v; this.render() }
  get gesto() { return this.getAttribute('gesto') || 'escucha' }
  set gesto(v) { this.setAttribute('gesto', v) }
  attributeChangedCallback(name, _, value) {
    if (name === 'config') { try { this.#config = JSON.parse(value || '{}') } catch { this.#config = {} } }
    // svg.tile y no el primer svg: antes va el del logo (escondido), y cambiarle la clase a ése no mueve nada
    const svg = this.shadowRoot.querySelector('svg.tile')
    if (name === 'gesto' && svg) { svg.setAttribute('class', \`tile \${GESTOS[value] || 'idle'}\`); this.#mouth(svg); this.#activity(svg); return }
    if ((name === 'actividad' || name === 'portatil' || name === 'mira') && svg) { this.#activity(svg); return }
    if (name === 'boca' && svg) { this.#mouth(svg); return }
    this.render()
  }
  // la boca movida desde afuera: la clase lipsync y la apertura en --boca
  #mouth(svg) {
    const v = this.getAttribute('boca')
    svg.classList.toggle('lipsync', v !== null)
    if (v !== null) svg.style.setProperty('--boca', String(Math.max(0, Math.min(1, Number(v) || 0))))
  }
  // lo que hace mientras tanto: actividad="cafe|musica|saluda|pulgar|celebra" y portatil="abierto|cerrado" (sin el
  // atributo, no tiene portátil). Son clases del recuadro, como el gesto: no se redibuja nada.
  #activity(svg) {
    const act = ACTIVIDADES[this.getAttribute('actividad')] || '', lap = this.getAttribute('portatil')
    for (const k of Object.values(ACTIVIDADES)) svg.classList.toggle(\`act-\${k}\`, k === act)
    svg.classList.toggle('has-laptop', lap !== null && lap !== 'no')
    svg.classList.toggle('lid-closed', lap === 'cerrado' || act === 'coffee')
    // mira="dx,dy": adónde mira (la dirección hacia quien habla, de -1 a 1); sin el atributo, mira por su cuenta
    const [lx, ly] = (this.getAttribute('mira') || '').split(',').map(Number), look = Number.isFinite(lx) && Number.isFinite(ly)
    svg.classList.toggle('looking', look)
    if (look) { svg.style.setProperty('--lx', String(lx)); svg.style.setProperty('--ly', String(ly)) }
  }
  connectedCallback() { this.render() }
  render() {
    if (!this.isConnected) return
    this.shadowRoot.innerHTML = \`<style>:host{display:inline-block;width:240px;aspect-ratio:4/3;border-radius:18px;overflow:hidden}svg.tile{width:100%;height:100%;display:block}\${CSS}</style>\${P.LOGO_SVG}\${svg(this.#config, { gesto: this.gesto, fondo: this.getAttribute('fondo') !== 'false' })}\`
    this.#mouth(this.shadowRoot.querySelector('svg.tile'))
    this.#activity(this.shadowRoot.querySelector('svg.tile'))
  }
}
if (OfficePersonaje && typeof customElements !== 'undefined' && !customElements.get('office-personaje')) customElements.define('office-personaje', OfficePersonaje)

/** Atajo: dibuja un personaje dentro de un elemento y devuelve el componente (para cambiarle el gesto después). */
export function dibujar(el, config, { gesto = 'escucha', fondo = true } = {}) {
  const c = document.createElement('office-personaje')
  c.setAttribute('gesto', gesto)
  if (!fondo) c.setAttribute('fondo', 'false')
  c.config = config
  el.replaceChildren(c)
  return c
}
`

const out = `// office-personajes.js — los personajes de Office en papel cortado, para usar en cualquier página.
// GENERADO por office/paquete/build.mjs a partir de office/personajes.js y office/personajes.css: no se edita a mano.
// Uso: ver README.md (junto a este archivo).
const OFFICE_PAQUETE = true
// el dibujo, tal cual está en office/personajes.js, encerrado en su propio alcance
const P = (() => {
const module = { exports: {} }
${source}
return module.exports
})()
${api}`

mkdirSync(dist, { recursive: true })
writeFileSync(join(dist, 'office-personajes.js'), out)
copyFileSync(join(here, 'ejemplo.html'), join(dist, 'ejemplo.html'))
copyFileSync(join(here, 'README.md'), join(dist, 'README.md'))
// para que Node y los bundlers lo traten como módulo ES (y por si algún día se publica)
writeFileSync(join(dist, 'package.json'), JSON.stringify({ name: 'office-personajes', version: '1.0.0', private: true, type: 'module', main: 'office-personajes.js', exports: './office-personajes.js' }, null, 2) + '\n')
console.log(`✔ ${join('office/paquete/dist', 'office-personajes.js')} (${Math.round(out.length / 1024)} KB) · ejemplo.html · README.md · package.json`)

// Publicarlo en otra carpeta (el playground compartido): el JS, el editor como index.html y el README.
const i = process.argv.indexOf('--destino')
if (i > 0) {
  const destino = process.argv[i + 1]
  if (!destino) { console.error('✗ --destino necesita una carpeta'); process.exit(2) }
  mkdirSync(destino, { recursive: true })
  copyFileSync(join(dist, 'office-personajes.js'), join(destino, 'office-personajes.js'))
  copyFileSync(join(dist, 'ejemplo.html'), join(destino, 'index.html'))
  copyFileSync(join(dist, 'README.md'), join(destino, 'README.md'))
  console.log(`✔ publicado en ${destino}: office-personajes.js · index.html · README.md`)
}

// Sólo el JS, en un archivo dado (lo usa el chat: chat/src/characters/office-characters.js).
const j = process.argv.indexOf('--js')
if (j > 0) {
  const file = process.argv[j + 1]
  if (!file) { console.error('✗ --js necesita un archivo'); process.exit(2) }
  mkdirSync(dirname(file), { recursive: true })
  copyFileSync(join(dist, 'office-personajes.js'), file)
  console.log(`✔ ${file}`)
}
