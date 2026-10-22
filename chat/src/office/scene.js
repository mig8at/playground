/* LA OFICINA EN 3D — un diorama cuadrado que se rota con el mouse, al estilo de un cuarto isométrico.
 *
 * Una planta de 22 × 22 sobre una base, con cuatro muros. El muro que queda entre la cámara y el interior se
 * esconde solo (con todo lo que cuelga de él), así que desde cualquier ángulo se ve adentro, como un corte.
 *
 * Cuatro salas en las esquinas y el lounge en el centro, con pasillos de 6 entre ellas:
 *   noroeste  Mi oficina          donde llegan los resultados (pantalla grande, escritorio de tres monitores)
 *   noreste   Tareas · Jira       el kanban y dos puestos
 *   suroeste  Arquitecto          la pizarra con el diagrama y su mesa
 *   sureste   Contexto · tablero  la biblioteca del conocimiento local y un rincón de lectura
 *   centro    Lounge              sillones y mesa; el café, contra el muro norte
 * Afuera, la calle (street.js): dos calles que se cruzan con semáforos, carros, árboles y la entrada.
 * Adentro caminan los cuatro personajes del kit (people.js): van a un asiento o a un lugar libre, se sientan y
 * no chocan entre ellos; también un gato. Afuera, un perro da la vuelta por la acera (dog.js).
 *
 * La información de cada zona aparece al pasar el mouse por encima de su piso, que se ilumina; un clic (sin
 * arrastrar) lleva la cámara ahí. La cámara es de perspectiva con lente larga: aire de maqueta sin la ilusión
 * de la ortográfica.
 */
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js'
import {
  PALETTE, box, canvasTexture, disposeMaterials,
  desk, chair, plant, sofa, armchair, coffeeTable, rug, bookshelf, kanban, whiteboard, artFrame, wallScreen,
  floorLamp, windowWithCurtains, coffeeBar, partition,
} from './furniture.js'
import { buildStreet } from './street.js'
import { createPeople } from './people.js'
import { createDog } from './dog.js'

// La planta: salas de 11 × 11 en las esquinas y pasillos de 8 alrededor del lounge. Con muebles y personajes a
// su escala, en una planta de 22 las salas quedaban para seis personas en fila y todo se veía apretado.
const SIZE = 30
const HALF = SIZE / 2
// LA ESCALA la dan los personajes del kit de cubos (chat/assets/Characters): miden ~2,7 de alto (de 2,64 a
// 2,81 en sus archivos). Todo lo alto se mide contra ellos: los muros, dos veces su altura; la puerta, 1,25.
// Escritorios (1,05) y asientos (0,45) ya les quedaban bien: son muñecos de piernas cortas.
export const PERSON = 2.7
const WALL_H = 5.6           // ~2 personas
const WAINSCOT = 1.2
const CUT_H = 2.2            // el muro del frente cortado, por debajo de la cabeza
const T = 0.5                // grosor del muro

// `area` es el rectángulo del piso de cada zona [x0, z0, x1, z1]: ahí se detecta el mouse.
export const ZONES = [
  { id: 'overview', label: 'Vista general', center: [5, 0, 5], distance: 118 },
  { id: 'office', label: 'Mi oficina', detail: 'Donde llegan los resultados del día.', center: [-9.5, 0, -9.5], area: [-15, -15, -4, -4], distance: 36 },
  { id: 'jira', label: 'Tareas · Jira', detail: 'El sprint: lo que está en curso y lo que sigue.', center: [9.5, 0, -9.5], area: [4, -15, 15, -4], distance: 36 },
  { id: 'architect', label: 'Arquitecto', detail: 'Diseño y decisiones antes de tocar código.', center: [-9.5, 0, 9.5], area: [-15, 4, -4, 15], distance: 36 },
  { id: 'context', label: 'Contexto · tablero', detail: 'El conocimiento local y la historia de cada tarea.', center: [9.5, 0, 9.5], area: [4, 4, 15, 15], distance: 36 },
  { id: 'lounge', label: 'Lounge', detail: 'Café y charla entre una cosa y otra.', center: [0, 0, 0], area: [-4, -4, 4, 4], distance: 32 },
]

// Los muebles se arman a una escala chica y se agrandan al ubicarlos: los personajes son anchos (1,3 de torso)
// y a 1:1 no cabían en un sillón. Alfombras, tabiques y muros no se agrandan: son la arquitectura.
const FURNITURE = 1.4
// Lo que se usa con el cuerpo va a la medida del muñeco, no a la escala general: tiene piernas muy cortas (la
// cadera a 0,61) y el torso ancho (~1,3 con los brazos). Asientos a ~0,55 para que apoye los pies, sillas de
// ~1,1 de ancho para que entre, mesa ratona más baja que el asiento. [ancho, alto, fondo] sobre el mueble base.
// El escritorio y las bibliotecas van con la escala general y su altura se elige al armarlos (`h`), para que
// los monitores y los libros no se deformen.
const FIT = {
  chair: [1.75, 0.9, 1.6],      // asiento 0,54 · ancho 1,08
  sofa: [1.45, 0.92, 1.45],     // asiento 0,53 · 1,6 por persona
  armchair: [1.5, 0.75, 1.5],   // asiento 0,55
  table: [1.4, 1.05, 1.4],      // la mesa ratona a 0,6
}
const DESK_H = 0.75             // × 1,4 = 1,05: a la altura de las manos, sentado
// Lo que se arma en las zonas queda anotado como obstáculo para la gente (people.js): un mueble se infla por el
// radio de una persona; una silla casi nada, porque a una silla se llega hasta pegado.
let obstacles = []
function put(object, x, z, rotation = 0, fit = null) {
  if (fit) object.scale.set(...fit)
  else object.scale.setScalar(FURNITURE)
  obstacles.push({ object, inflate: object.userData.seats && object.userData.seats.length === 1 && object.userData.seats[0].facing === Math.PI ? 0.15 : undefined })
  return place(object, x, z, rotation)
}
// Un tabique: obstáculo, pero no un mueble (no se agranda).
function wallPart(object, x, z, rotation = 0) {
  obstacles.push({ object })
  return place(object, x, z, rotation)
}

// Los asientos del mundo, a partir de los que declara cada mueble en sus coordenadas.
function collectSeats() {
  const seats = []
  const v = new THREE.Vector3()
  for (const { object } of obstacles) {
    if (!object.userData.seats) continue
    object.updateMatrixWorld(true)
    for (const seat of object.userData.seats) {
      v.set(seat.x, seat.height, seat.z); object.localToWorld(v)
      const at = new THREE.Vector2(v.x, v.z), height = v.y
      v.set(seat.approach[0], 0, seat.approach[1]); object.localToWorld(v)
      seats.push({ at, height, approach: new THREE.Vector2(v.x, v.z), facing: object.rotation.y + seat.facing, takenBy: null })
    }
  }
  return seats
}

function place(object, x, z, rotation = 0, y = 0) {
  object.position.set(x, y, z)
  object.rotation.y = rotation
  return object
}

// Un muro mirando hacia adentro (+z local), en dos partes: la de abajo (hasta `CUT_H`), siempre a la vista, y
// la de arriba (`userData.upper`), que se esconde cuando el muro queda entre la cámara y el interior; lo que
// cuelga de un muro va en su parte alta. Es el corte de Los Sims, a media altura: desde la calle se ve adentro
// y la puerta, y la caja conserva sus cuatro lados. La tapa blanca de cada parte marca el canto.
// `gaps` son huecos de puerta: [{ at, width }] a lo largo del muro (x local).
const DOOR_H = 3.4            // ~1,25 personas: pasan holgados
function wall(length, { x, z, rotation, outward, gaps = [] }) {
  const g = new THREE.Group()
  const upper = new THREE.Group()
  const L = length + 2 * T
  const cuts = gaps.map(({ at, width }) => [at - width / 2, at + width / 2]).sort((a, b) => a[0] - b[0])
  const solids = []
  let cursor = -L / 2
  for (const [a, b] of cuts) { if (a > cursor) solids.push([cursor, a]); cursor = b }
  if (cursor < L / 2) solids.push([cursor, L / 2])
  for (const [a, b] of solids) {
    const w = b - a, cx = (a + b) / 2
    g.add(box(w, WAINSCOT, T, PALETTE.wallLow, { x: cx, z: -T / 2, r: 0.04 }))
    g.add(box(w, 0.06, T + 0.04, PALETTE.wallTrim, { x: cx, y: WAINSCOT - 0.03, z: -T / 2, r: 0.02 }))
    g.add(box(w, CUT_H - WAINSCOT, T, PALETTE.wallHigh, { x: cx, y: WAINSCOT, z: -T / 2, r: 0.04 }))
    g.add(box(w, 0.14, T + 0.06, PALETTE.white, { x: cx, z: -T / 2, r: 0.02 }))
  }
  // La puerta es más alta que el corte: su marco va con la parte de abajo (se ve siempre) y el dintel con la
  // de arriba.
  for (const [a, b] of cuts) {
    const w = b - a, cx = (a + b) / 2
    upper.add(box(w, WALL_H - DOOR_H, T, PALETTE.wallHigh, { x: cx, y: DOOR_H, z: -T / 2, r: 0.04 }))
    g.add(doorFrame(w, cx))
  }
  // El canto del corte: se ve sólo cuando la parte de arriba está escondida.
  const cutCap = new THREE.Group()
  for (const [a, b] of solids) {
    const w = b - a, cx = (a + b) / 2
    cutCap.add(box(w, 0.1, T + 0.04, PALETTE.white, { x: cx, y: CUT_H - 0.05, z: -T / 2, r: 0.03 }))
    upper.add(box(w, WALL_H - CUT_H, T, PALETTE.wallHigh, { x: cx, y: CUT_H, z: -T / 2, r: 0.04 }))
  }
  g.add(cutCap)
  upper.add(box(L + 0.06, 0.16, T + 0.1, PALETTE.white, { y: WALL_H - 0.08, z: -T / 2, r: 0.04 }))
  g.add(upper)
  g.position.set(x, 0, z)
  g.rotation.y = rotation
  g.userData.outward = new THREE.Vector3(...outward)
  g.userData.upper = upper
  g.userData.cutCap = cutCap
  return g
}

// La puerta de vidrio: marco negro y dos hojas entreabiertas. Va con el zócalo: se ve aunque el muro esté cortado.
function doorFrame(width, cx) {
  const g = new THREE.Group()
  for (const sx of [-1, 1]) g.add(box(0.16, DOOR_H, T + 0.16, PALETTE.ink, { x: cx + sx * (width / 2 - 0.08), z: -T / 2, r: 0.03 }))
  g.add(box(width, 0.18, T + 0.16, PALETTE.ink, { x: cx, y: DOOR_H - 0.18, z: -T / 2, r: 0.03 }))
  const leaf = (width - 0.32) / 2
  for (const sx of [-1, 1]) {
    const hinge = new THREE.Group()
    hinge.position.set(cx + sx * (width / 2 - 0.16), 0, -T / 2)
    const glass = new THREE.Mesh(new THREE.BoxGeometry(leaf, DOOR_H - 0.3, 0.05), new THREE.MeshStandardMaterial({
      color: PALETTE.glass, roughness: 0.1, transparent: true, opacity: 0.35, depthWrite: false,
    }))
    glass.position.set(-sx * leaf / 2, (DOOR_H - 0.3) / 2 + 0.06, 0)
    hinge.add(glass)
    hinge.add(box(0.06, DOOR_H - 0.3, 0.07, PALETTE.white, { x: -sx * (leaf - 0.03), y: 0.06, r: 0.02 }))
    hinge.add(box(0.05, 0.5, 0.12, PALETTE.ink, { x: -sx * (leaf - 0.15), y: 1.0, r: 0.02 }))
    hinge.rotation.y = sx * 0.55
    g.add(hinge)
  }
  return g
}

const hang = (w, object) => w.userData.upper.add(object)

function plankTexture() {
  const texture = canvasTexture(512, 512, (g, W, H) => {
    const rows = 8
    for (let r = 0; r < rows; r++) {
      const y = (r / rows) * H
      const offset = (r % 2) * 128
      g.fillStyle = [PALETTE.floor, PALETTE.floorAlt, PALETTE.floor][r % 3]
      g.fillRect(0, y, W, H / rows)
      g.fillStyle = 'rgba(70, 60, 90, 0.12)'
      g.fillRect(0, y, W, 2)
      for (let x = offset; x < W + 256; x += 256) g.fillRect(x % W, y, 2, H / rows)
    }
  })
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(SIZE / 5.5, SIZE / 5.5)
  return texture
}

function buildRoom(scene) {
  // La losa blanca: la oficina queda un escalón arriba de la acera, como el zócalo de una maqueta.
  scene.add(box(SIZE + 2.2, 0.6, SIZE + 2.2, PALETTE.base, { y: -0.6, r: 0.12 }))
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(SIZE + 0.8, SIZE + 0.8),
    new THREE.MeshStandardMaterial({ map: plankTexture(), roughness: 0.9 }))
  floor.rotation.x = -Math.PI / 2
  floor.position.y = 0.02
  floor.receiveShadow = true
  scene.add(floor)

  const north = wall(SIZE, { x: 0, z: -HALF, rotation: 0, outward: [0, 0, -1] })
  // La puerta da a la calle del sur, en el eje del lounge.
  const south = wall(SIZE, { x: 0, z: HALF, rotation: Math.PI, outward: [0, 0, 1], gaps: [{ at: 0, width: 2.6 }] })
  const west = wall(SIZE, { x: -HALF, z: 0, rotation: Math.PI / 2, outward: [-1, 0, 0] })
  const east = wall(SIZE, { x: HALF, z: 0, rotation: -Math.PI / 2, outward: [1, 0, 0] })
  // Lo que cuelga de cada muro va en su parte alta, en coordenadas del muro (x a lo largo, y arriba, +z adentro):
  //   norte: x = x del mundo · oeste: x = -z del mundo · este: x = z del mundo · sur: x = -x del mundo
  hang(north, place(wallScreen({ w: 3.4, h: 1.9 }), -9.5, 0.1, 0, 2.1))
  hang(north, place(kanban({ w: 5.2, h: 2 }), 9.5, 0.1, 0, 1.9))
  hang(north, place(artFrame({ kind: 1, w: 1, h: 1.25 }), 0, 0.05, 0, 2.6))
  hang(west, place(artFrame({ kind: 0, w: 0.9, h: 1.1 }), 12, 0.05, 0, 2.6))
  hang(west, place(artFrame({ kind: 2, w: 0.9, h: 1.1 }), 10.4, 0.05, 0, 2.6))
  hang(west, place(windowWithCurtains({ w: 2, h: 2.2 }), -9.5, 0.05, 0, 1.5))
  hang(west, place(artFrame({ kind: 1, w: 0.9, h: 1.1 }), 0, 0.05, 0, 2.6))
  hang(east, place(windowWithCurtains({ w: 2, h: 2.2 }), -9.5, 0.05, 0, 1.5))
  hang(east, place(artFrame({ kind: 2, w: 0.9, h: 1.1 }), 9.5, 0.05, 0, 2.6))
  hang(east, place(artFrame({ kind: 0, w: 0.9, h: 1.1 }), 0, 0.05, 0, 2.6))
  hang(south, place(artFrame({ kind: 1, w: 0.9, h: 1.1 }), 9.5, 0.05, 0, 2.6))
  hang(south, place(windowWithCurtains({ w: 2, h: 2.2 }), -9.5, 0.05, 0, 1.5))
  hang(south, place(windowWithCurtains({ w: 2, h: 2.2 }), 5.5, 0.05, 0, 1.5))
  const walls = [north, south, west, east]
  walls.forEach((w) => scene.add(w))
  return walls
}

function buildZones(scene) {
  // ── Mi oficina: noroeste, con tabiques de vidrio y una puerta hacia el pasillo ──
  scene.add(wallPart(partition(11, { glassTop: true, glassH: 2.3 }), -4, -9.5, Math.PI / 2))
  scene.add(wallPart(partition(8.8, { glassTop: true, glassH: 2.3 }), -10.6, -4))
  scene.add(place(rug(6.2, 4.4, { base: PALETTE.ink, accent: PALETTE.sand, mid: PALETTE.graphite }), -9.5, -10.4))
  scene.add(put(desk({ w: 3.4, d: 1.3, h: DESK_H, screens: 3, screenKind: 'chart', color: PALETTE.wood, legs: PALETTE.woodDark }), -9.5, -11.2))
  scene.add(put(chair({ color: PALETTE.cognac, executive: true }), -9.5, -9.5, 0, FIT.chair))
  scene.add(put(sofa({ w: 2.4, color: PALETTE.oat, pillows: [PALETTE.primary, PALETTE.sand] }), -13.9, -6.6, Math.PI / 2, FIT.sofa))
  scene.add(put(coffeeTable({ r: 0.45 }), -11.6, -6.6, 0, FIT.table))
  scene.add(put(plant({ size: 1.3 }), -14.2, -14.2))
  scene.add(put(floorLamp(), -5.2, -14.2))
  scene.add(put(bookshelf({ w: 1.6, h: 1.7 }), -14.4, -10.8, Math.PI / 2))

  // ── Tareas · Jira: noreste, frente al kanban ──
  scene.add(wallPart(partition(11), 4, -9.5, Math.PI / 2))
  scene.add(place(rug(9.6, 4.4, { base: PALETTE.oat, accent: PALETTE.stone, mid: PALETTE.linen }), 9.5, -10.2))
  ;[6.4, 9.6, 12.8].forEach((x, i) => {
    scene.add(put(desk({ w: 2.2, h: DESK_H, screens: 2, screenKind: i === 1 ? 'board' : 'code', accent: PALETTE.sand }), x, -10.4))
    scene.add(put(chair({ color: PALETTE.ink }), x, -8.8, 0, FIT.chair))
  })
  scene.add(put(plant({ size: 1.1 }), 14.2, -14.2))
  scene.add(put(plant({ size: 0.9, leaves: PALETTE.greenDark }), 14.2, -5))
  scene.add(put(armchair({ color: PALETTE.cognac }), 7, -5.6, Math.PI, FIT.armchair))

  // ── El café, contra el muro norte, entre la oficina y Jira ──
  scene.add(put(coffeeBar(), 0, -14.35))
  scene.add(put(plant({ size: 0.8 }), -2.4, -14.3))
  scene.add(put(plant({ size: 0.8 }), 2.4, -14.3))

  // ── Arquitecto: suroeste ──
  scene.add(wallPart(partition(8.8), -10.6, 4))
  scene.add(wallPart(partition(11), -4, 9.5, Math.PI / 2))
  scene.add(place(rug(6.4, 4.6, { base: PALETTE.sage, accent: PALETTE.linen, mid: PALETTE.oat }), -9.5, 10.3))
  scene.add(put(whiteboard({ w: 3, h: 1.6 }), -9.5, 6.6))
  scene.add(put(desk({ w: 2.8, h: DESK_H, screens: 2, screenKind: 'code', accent: PALETTE.sage, color: PALETTE.white }), -9.5, 10))
  scene.add(put(chair({ color: PALETTE.graphite }), -9.5, 11.5, 0, FIT.chair))
  scene.add(put(armchair({ color: PALETTE.graphite, pillow: PALETTE.sage }), -13.6, 6.4, Math.PI * 0.6, FIT.armchair))
  scene.add(put(plant({ size: 1.2 }), -14.2, 14.2))
  scene.add(put(floorLamp({ shade: PALETTE.sand }), -5.2, 14.2))

  // ── Contexto · tablero: sureste, la biblioteca ──
  scene.add(wallPart(partition(8.8), 10.6, 4))
  scene.add(wallPart(partition(11), 4, 9.5, Math.PI / 2))
  scene.add(place(rug(6.4, 4.6, { base: PALETTE.slate, accent: PALETTE.sand, mid: PALETTE.oat }), 9, 10.3))
  scene.add(put(bookshelf({ w: 2, h: 1.9 }), 8.2, 4.65))
  scene.add(put(bookshelf({ w: 2, h: 1.9 }), 11.2, 4.65))
  scene.add(put(bookshelf({ w: 2, h: 1.9 }), 14.35, 7.6, -Math.PI / 2))
  scene.add(put(desk({ w: 2.4, h: DESK_H, screens: 1, screenKind: 'board', accent: PALETTE.slate, color: PALETTE.wood, legs: PALETTE.woodDark }), 8.4, 10))
  scene.add(put(chair({ color: PALETTE.cognac }), 8.4, 11.5, 0, FIT.chair))
  scene.add(put(sofa({ w: 2.4, color: PALETTE.linen, pillows: [PALETTE.slate, PALETTE.mustard] }), 13.9, 11.6, -Math.PI / 2, FIT.sofa))
  scene.add(put(plant({ size: 1 }), 14.2, 14.3))

  // ── Lounge: el centro ──
  scene.add(place(rug(6.4, 6.4), 0, 0))
  scene.add(put(sofa({ w: 2.6 }), -2.4, 0, Math.PI / 2, FIT.sofa))
  scene.add(put(sofa({ w: 2.6, color: PALETTE.linen, pillows: [PALETTE.clay, PALETTE.sage] }), 0.3, 2.6, Math.PI, FIT.sofa))
  scene.add(put(armchair(), 2.5, 0, -Math.PI / 2, FIT.armchair))
  scene.add(put(coffeeTable(), 0, 0, 0, FIT.table))
  scene.add(put(floorLamp(), -3.2, 3.2))
  scene.add(put(plant({ size: 1.2 }), 3.2, -3.2))
  scene.add(put(plant({ size: 1 }), -3.2, -3.2))
}

// El piso de cada zona se ilumina al pasar el mouse: una lámina apenas sobre el piso, invisible en reposo.
function buildHighlights(scene) {
  const highlights = new Map()
  for (const zone of ZONES) {
    if (!zone.area) continue
    const [x0, z0, x1, z1] = zone.area
    const material = new THREE.MeshBasicMaterial({ color: PALETTE.primary, transparent: true, opacity: 0, depthWrite: false })
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0 - 0.3, z1 - z0 - 0.3), material)
    mesh.rotation.x = -Math.PI / 2
    mesh.position.set((x0 + x1) / 2, 0.06, (z0 + z1) / 2)
    mesh.renderOrder = 1
    scene.add(mesh)
    highlights.set(zone.id, mesh)
  }
  return highlights
}

// La tarjeta de cada zona: HTML encima de la escena que sigue a su zona. Sólo se ve la de la zona bajo el mouse.
function buildLabels(scene) {
  const labels = new Map()
  for (const zone of ZONES) {
    if (!zone.area) continue
    // El ancla la mueve Three (le pone su propio transform); la tarjeta adentro se corre hacia arriba para
    // flotar sobre la zona sin taparla.
    const anchor = document.createElement('div')
    const el = document.createElement('div')
    el.className = 'office-label'
    el.innerHTML = '<b></b><span></span><small>Clic para acercarte</small>'
    el.querySelector('b').textContent = zone.label
    el.querySelector('span').textContent = zone.detail
    anchor.appendChild(el)
    const label = new CSS2DObject(anchor)
    label.position.set(zone.center[0], 4.2, zone.center[2])
    label.visible = false
    scene.add(label)
    labels.set(zone.id, label)
  }
  return labels
}

const zoneAt = (x, z) => ZONES.find((zone) => zone.area && x >= zone.area[0] && x <= zone.area[2] && z >= zone.area[1] && z <= zone.area[3])

export function createOffice(container, { onFocus, onHover } = {}) {
  const scene = new THREE.Scene()

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05
  renderer.outputColorSpace = THREE.SRGBColorSpace
  container.appendChild(renderer.domElement)

  const labelRenderer = new CSS2DRenderer()
  labelRenderer.domElement.className = 'office-labels'
  container.appendChild(labelRenderer.domElement)

  // Perspectiva de lente larga (28°): conserva el aire de maqueta, y el fondo se achica apenas, como debe. Con
  // una cámara ortográfica lo lejano mide igual que lo cercano y el ojo lo lee MÁS grande (la «perspectiva
  // invertida» de las vistas isométricas): la planta parecía angosta adelante y ancha atrás.
  // La vista arranca en diagonal exacta (45°), que es la que hace ver cuadrada la planta.
  const camera = new THREE.PerspectiveCamera(28, 1, 1, 500)
  const START = new THREE.Vector3(5, 0, 5)
  const START_DIR = new THREE.Vector3(1, 1.05, 1).normalize()
  // En una ventana angosta la cámara se aleja para que entre lo mismo a lo ancho.
  let fit = 1
  camera.position.copy(START).addScaledVector(START_DIR, 118)

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.minDistance = 14
  controls.maxDistance = 170
  // Entre ~35° y ~60° de la vertical: más arriba la caja se ve plana; más abajo se pierde el interior.
  controls.minPolarAngle = 0.62
  controls.maxPolarAngle = 1.05
  controls.screenSpacePanning = true
  controls.target.copy(START)

  // Luz: el cielo y el rebote del piso, más un sol tibio que proyecta sombras suaves.
  scene.add(new THREE.HemisphereLight('#ffffff', '#c9bfd6', 1.6))
  const sun = new THREE.DirectionalLight('#fff4e6', 2.4)
  // La sombra cubre toda la maqueta (la oficina y la calle), centrada en ella.
  sun.position.set(24, 38, 21)
  sun.target.position.set(5, 0, 5)
  scene.add(sun.target)
  sun.castShadow = true
  sun.shadow.mapSize.set(4096, 4096)
  sun.shadow.camera.left = -38; sun.shadow.camera.right = 38
  sun.shadow.camera.top = 38; sun.shadow.camera.bottom = -38
  sun.shadow.bias = -0.0004
  sun.shadow.normalBias = 0.03
  sun.shadow.radius = 4
  scene.add(sun)
  const fill = new THREE.DirectionalLight('#dcd6ff', 0.6)
  fill.position.set(-16, 12, -6)
  scene.add(fill)

  const walls = buildRoom(scene)
  // La calle va un escalón abajo de la oficina (la losa mide 0,6; la acera queda a la altura del escalón).
  const streetLevel = new THREE.Group()
  streetLevel.position.y = -0.45
  scene.add(streetLevel)
  const street = buildStreet(streetLevel)
  // El perro pasea por la acera que rodea el edificio, a media acera entre la losa y el bordillo.
  const dog = createDog(streetLevel, { radius: HALF + 2 })
  obstacles = []
  buildZones(scene)
  // La gente camina por la oficina esquivando lo de arriba (y a los demás), y se sienta donde puede.
  const people = createPeople(scene, { half: HALF, obstacles, seats: collectSeats() })
  const highlights = buildHighlights(scene)
  const labels = buildLabels(scene)

  // ── el tamaño sigue al contenedor ──
  function resize() {
    const { clientWidth: w, clientHeight: h } = container
    if (!w || !h) return
    const aspect = w / h
    const before = fit
    fit = Math.max(1, 1.45 / aspect)
    camera.aspect = aspect
    camera.updateProjectionMatrix()
    // Si cambió el ajuste, la cámara se aleja o se acerca en la misma proporción, sin cambiar el ángulo.
    if (before !== fit) camera.position.sub(controls.target).multiplyScalar(fit / before).add(controls.target)
    renderer.setSize(w, h)
    labelRenderer.setSize(w, h)
  }
  const observer = new ResizeObserver(resize)
  observer.observe(container)
  resize()

  // ── volar a una zona: la cámara conserva el ángulo y se acerca al centro de la zona ──
  let flight = null
  function focus(id) {
    const zone = ZONES.find((z) => z.id === id) || ZONES[0]
    const target = new THREE.Vector3(...zone.center)
    const direction = camera.position.clone().sub(controls.target).normalize()
    flight = {
      t: 0,
      fromTarget: controls.target.clone(), toTarget: target,
      fromPos: camera.position.clone(), toPos: target.clone().addScaledVector(direction, zone.distance * fit),
    }
    onFocus?.(zone.id)
  }

  // ── el mouse: qué zona hay debajo (el piso, y = 0), su tarjeta y su piso iluminado ──
  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()
  const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  const hit = new THREE.Vector3()
  let hovered = null
  function setHovered(id) {
    if (hovered === id) return
    hovered = id
    for (const [zoneId, label] of labels) label.visible = zoneId === id
    renderer.domElement.style.cursor = id ? 'pointer' : ''
    onHover?.(id)
  }
  function onPointerMove(event) {
    if (event.buttons) return // arrastrando: no cambia la tarjeta mientras rota
    const rect = renderer.domElement.getBoundingClientRect()
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
    raycaster.setFromCamera(pointer, camera)
    const zone = raycaster.ray.intersectPlane(ground, hit) ? zoneAt(hit.x, hit.z) : null
    setHovered(zone?.id || null)
  }
  // Un clic es apretar y soltar casi en el mismo lugar: si se movió, fue un arrastre para rotar.
  let downAt = null
  const onPointerDown = (event) => { downAt = [event.clientX, event.clientY] }
  function onPointerUp(event) {
    if (downAt && Math.hypot(event.clientX - downAt[0], event.clientY - downAt[1]) < 5 && hovered) focus(hovered)
    downAt = null
  }
  const onPointerLeave = () => setHovered(null)
  renderer.domElement.addEventListener('pointermove', onPointerMove)
  renderer.domElement.addEventListener('pointerdown', onPointerDown)
  renderer.domElement.addEventListener('pointerup', onPointerUp)
  renderer.domElement.addEventListener('pointerleave', onPointerLeave)

  // ── el muro que tapa la vista se esconde ──
  const toCamera = new THREE.Vector3()
  function updateWalls() {
    toCamera.copy(camera.position).sub(controls.target).setY(0).normalize()
    for (const w of walls) {
      const shown = w.userData.outward.dot(toCamera) < 0.25
      w.userData.upper.visible = shown
      w.userData.cutCap.visible = !shown
    }
  }

  let frame = 0
  let last = performance.now()
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
  function animate(now) {
    frame = requestAnimationFrame(animate)
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    if (flight) {
      flight.t = Math.min(1, flight.t + dt / 0.9)
      const k = ease(flight.t)
      controls.target.lerpVectors(flight.fromTarget, flight.toTarget, k)
      camera.position.lerpVectors(flight.fromPos, flight.toPos, k)
      if (flight.t >= 1) flight = null
    }
    // El piso de la zona bajo el mouse sube a un tinte suave; los demás vuelven a cero.
    for (const [id, mesh] of highlights) {
      const goal = id === hovered ? 0.12 : 0
      mesh.material.opacity += (goal - mesh.material.opacity) * Math.min(1, dt * 10)
    }
    street.update(dt)
    people.update(dt)
    dog.update(dt)
    controls.update()
    updateWalls()
    renderer.render(scene, camera)
    labelRenderer.render(scene, camera)
  }
  frame = requestAnimationFrame(animate)

  // Girar despacio sola, hasta que la toques.
  function setAutoRotate(on) { controls.autoRotate = on; controls.autoRotateSpeed = 0.6 }
  controls.addEventListener('start', () => { flight = null; setAutoRotate(false) })

  function dispose() {
    cancelAnimationFrame(frame)
    people.dispose()
    dog.dispose()
    observer.disconnect()
    controls.dispose()
    renderer.domElement.removeEventListener('pointermove', onPointerMove)
    renderer.domElement.removeEventListener('pointerdown', onPointerDown)
    renderer.domElement.removeEventListener('pointerup', onPointerUp)
    renderer.domElement.removeEventListener('pointerleave', onPointerLeave)
    scene.traverse((o) => {
      o.geometry?.dispose()
      const list = Array.isArray(o.material) ? o.material : o.material ? [o.material] : []
      for (const m of list) { m.map?.dispose(); m.dispose() }
    })
    disposeMaterials()
    for (const label of labels.values()) label.element.remove()
    renderer.dispose()
    renderer.domElement.remove()
    labelRenderer.domElement.remove()
  }

  return { focus, setAutoRotate, dispose, zones: ZONES }
}
