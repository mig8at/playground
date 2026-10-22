/* LA OFICINA EN 3D — un diorama que se rota con el mouse, al estilo de un cuarto isométrico.
 *
 * Una planta de 26 × 18 sobre una base, con cuatro muros. El muro que queda entre la cámara y el interior se
 * esconde solo (con todo lo que cuelga de él), así que desde cualquier ángulo se ve adentro, como un corte.
 *
 * Las zonas son las del trabajo del día a día, y cada una tiene un cartel que, al tocarlo, lleva la cámara:
 *   Mi oficina          donde llegan los resultados (pantalla grande, escritorio de tres monitores)
 *   Tareas · Jira       el tablero kanban y dos puestos
 *   Arquitecto          la pizarra con el diagrama y su mesa
 *   Contexto · tablero  la biblioteca del conocimiento local y un rincón de lectura
 *   Lounge              el centro: sillones, mesa, café
 * Todavía sin personas: los agentes llegan después.
 *
 * La cámara es ortográfica (sin perspectiva), que es lo que da el aspecto de maqueta. OrbitControls rota,
 * acerca y desplaza; los límites impiden mirar desde abajo del piso o alejarse hasta perderla.
 */
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js'
import {
  PALETTE, box, canvasTexture, disposeMaterials,
  desk, chair, plant, sofa, armchair, coffeeTable, rug, bookshelf, kanban, whiteboard, artFrame, wallScreen,
  floorLamp, windowWithCurtains, coffeeBar, partition,
} from './furniture.js'

const WIDTH = 26
const DEPTH = 18
const WALL_H = 5.2
const WAINSCOT = 1.6

export const ZONES = [
  { id: 'overview', label: 'Vista general', center: [0, 0, 0], zoom: 1 },
  { id: 'office', label: 'Mi oficina', detail: 'donde llegan los resultados', center: [-9, 0, -5.5], zoom: 1.6 },
  { id: 'jira', label: 'Tareas · Jira', detail: 'el sprint y lo que sigue', center: [6.5, 0, -6], zoom: 1.6 },
  { id: 'architect', label: 'Arquitecto', detail: 'diseño y decisiones', center: [-8.5, 0, 5.5], zoom: 1.6 },
  { id: 'context', label: 'Contexto · tablero', detail: 'el conocimiento local', center: [8.5, 0, 5.5], zoom: 1.6 },
  { id: 'lounge', label: 'Lounge', detail: 'café y charla', center: [0, 0, 3.5], zoom: 1.8 },
]

function place(object, x, z, rotation = 0, y = 0) {
  object.position.set(x, y, z)
  object.rotation.y = rotation
  return object
}

// Un muro con su zócalo azul arriba del piso, mirando hacia adentro (+z local). `outward` es su normal hacia
// afuera: cuando la cámara queda de ese lado, el muro se esconde.
function wall(length, { x, z, rotation, outward }) {
  const g = new THREE.Group()
  const L = length + 0.8
  g.add(box(L, WAINSCOT, 0.4, PALETTE.blue, { z: -0.2, r: 0.04 }))
  g.add(box(L, 0.12, 0.46, PALETTE.blueDeep, { y: WAINSCOT - 0.06, z: -0.2, r: 0.03 }))
  g.add(box(L, WALL_H - WAINSCOT, 0.4, PALETTE.cream, { y: WAINSCOT, z: -0.2, r: 0.04 }))
  g.add(box(L, 0.1, 0.44, PALETTE.white, { y: WALL_H - 0.05, z: -0.2, r: 0.03 }))
  g.add(box(L, 0.14, 0.46, PALETTE.white, { y: 0, z: -0.2, r: 0.02 }))
  g.position.set(x, 0, z)
  g.rotation.y = rotation
  g.userData.outward = new THREE.Vector3(...outward)
  return g
}

function plankTexture() {
  const texture = canvasTexture(512, 512, (g, W, H) => {
    g.fillStyle = PALETTE.floor; g.fillRect(0, 0, W, H)
    const rows = 8
    for (let r = 0; r < rows; r++) {
      const y = (r / rows) * H
      const offset = (r % 2) * 128
      g.fillStyle = r % 3 === 0 ? '#e2d4c2' : r % 3 === 1 ? '#ebe0d2' : '#e6d9c8'
      g.fillRect(0, y, W, H / rows)
      g.fillStyle = 'rgba(120, 90, 60, 0.18)'
      g.fillRect(0, y, W, 2)
      for (let x = offset; x < W + 256; x += 256) g.fillRect(x % W, y, 2, H / rows)
    }
  })
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(WIDTH / 6, DEPTH / 6)
  return texture
}

function buildRoom(scene) {
  // La base de la maqueta y el piso de tablas.
  scene.add(box(WIDTH + 1.6, 0.7, DEPTH + 1.6, PALETTE.white, { y: -1.1, r: 0.2 }))
  scene.add(box(WIDTH + 0.8, 0.4, DEPTH + 0.8, PALETTE.creamDark, { y: -0.4, r: 0.06 }))
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(WIDTH + 0.8, DEPTH + 0.8),
    new THREE.MeshStandardMaterial({ map: plankTexture(), roughness: 0.9 }))
  floor.rotation.x = -Math.PI / 2
  floor.position.y = 0.002
  floor.receiveShadow = true
  scene.add(floor)

  const north = wall(WIDTH, { x: 0, z: -DEPTH / 2, rotation: 0, outward: [0, 0, -1] })
  const south = wall(WIDTH, { x: 0, z: DEPTH / 2, rotation: Math.PI, outward: [0, 0, 1] })
  const west = wall(DEPTH, { x: -WIDTH / 2, z: 0, rotation: Math.PI / 2, outward: [-1, 0, 0] })
  const east = wall(DEPTH, { x: WIDTH / 2, z: 0, rotation: -Math.PI / 2, outward: [1, 0, 0] })
  // Lo que cuelga de cada muro va en su grupo, en coordenadas del muro (x a lo largo, y arriba, +z adentro):
  //   norte: x = x del mundo · oeste: x = -z del mundo · este: x = z del mundo · sur: x = -x del mundo
  north.add(place(wallScreen({ w: 3.4, h: 1.9 }), -9, 0.1, 0, 1.7))
  north.add(place(kanban({ w: 4.2, h: 2 }), 5.5, 0.1, 0, 1.6))
  north.add(place(windowWithCurtains({ w: 1.7, h: 1.8 }), 11, 0.05, 0, 1.9))
  north.add(place(artFrame({ kind: 1 }), -2.3, 0.05, 0, 2.6))
  west.add(place(artFrame({ kind: 0 }), 7.2, 0.05, 0, 2.3))
  west.add(place(artFrame({ kind: 2 }), 5.6, 0.05, 0, 2.3))
  west.add(place(windowWithCurtains({ w: 1.8, h: 1.8 }), -5.5, 0.05, 0, 1.9))
  east.add(place(windowWithCurtains({ w: 1.8, h: 1.8 }), -5.5, 0.05, 0, 1.9))
  east.add(place(artFrame({ kind: 2 }), 5, 0.05, 0, 2.4))
  south.add(place(artFrame({ kind: 1 }), 0, 0.05, 0, 2.4))
  south.add(place(windowWithCurtains({ w: 1.8, h: 1.8 }), 6, 0.05, 0, 1.9))
  const walls = [north, south, west, east]
  walls.forEach((w) => scene.add(w))
  return walls
}

function buildZones(scene) {
  // ── Mi oficina: esquina noroeste, con tabiques de vidrio ──
  scene.add(place(partition(7, { glassTop: true }), -5, -5.5, Math.PI / 2))
  scene.add(place(partition(5, { glassTop: true }), -10.5, -2))
  scene.add(place(rug(5.2, 3.6, { base: PALETTE.blue, accent: PALETTE.orange, mid: PALETTE.blueSoft }), -9, -5.6))
  scene.add(place(desk({ w: 3.4, d: 1.3, screens: 3, screenKind: 'chart', color: PALETTE.wood, legs: PALETTE.woodDark }), -9, -6.4))
  scene.add(place(chair({ color: PALETTE.orange, executive: true }), -9, -5.2))
  scene.add(place(armchair({ color: PALETTE.blue, pillow: PALETTE.orange }), -12, -3.3, Math.PI * 0.75))
  scene.add(place(plant({ size: 1.3 }), -12.2, -8.2))
  scene.add(place(floorLamp(), -6, -8.3))
  scene.add(place(bookshelf({ w: 1.6, h: 2 }), -12.55, -6.2, Math.PI / 2))

  // ── Tareas · Jira: noreste, frente al kanban ──
  scene.add(place(rug(7, 3.4, { base: PALETTE.orange, accent: PALETTE.yellow, mid: PALETTE.cream }), 5.8, -5.6))
  ;[3.2, 8.2].forEach((x, i) => {
    scene.add(place(desk({ screens: 2, screenKind: i ? 'code' : 'board', accent: PALETTE.orange }), x, -5.4))
    scene.add(place(chair({ color: PALETTE.blue }), x, -4.3))
  })
  scene.add(place(plant({ size: 1.1 }), 12.2, -8.2))
  scene.add(place(plant({ size: 0.8, leaves: PALETTE.greenDark }), 0.8, -8.3))

  // ── El café, entre la oficina y Jira ──
  scene.add(place(coffeeBar(), -2.4, -8.35))

  // ── Arquitecto: suroeste ──
  scene.add(place(partition(7), -9.5, 1.4))
  scene.add(place(rug(5.4, 3.8, { base: PALETTE.teal, accent: PALETTE.yellow, mid: PALETTE.cream }), -8.6, 5.6))
  scene.add(place(whiteboard({ w: 3, h: 1.6 }), -8.6, 2.6))
  scene.add(place(desk({ w: 2.8, screens: 2, screenKind: 'code', accent: PALETTE.teal, color: PALETTE.white }), -8.6, 5.4))
  scene.add(place(chair({ color: PALETTE.teal }), -8.6, 6.5))
  scene.add(place(plant({ size: 1.2 }), -12.2, 8.2))
  scene.add(place(floorLamp({ shade: PALETTE.orangeSoft }), -5.4, 8.2))

  // ── Contexto · tablero: sureste, la biblioteca ──
  scene.add(place(partition(7), 9.5, 1.4))
  scene.add(place(rug(5.4, 3.8, { base: PALETTE.blue, accent: PALETTE.yellow, mid: PALETTE.blueSoft }), 8.6, 5.8))
  scene.add(place(bookshelf({ w: 2, h: 2.4 }), 7.1, 2.1))
  scene.add(place(bookshelf({ w: 2, h: 2.4 }), 9.3, 2.1))
  scene.add(place(desk({ w: 2.4, screens: 1, screenKind: 'board', accent: PALETTE.blueSoft, color: PALETTE.wood, legs: PALETTE.woodDark }), 7.6, 5.4))
  scene.add(place(chair({ color: PALETTE.orange }), 7.6, 6.5))
  scene.add(place(sofa({ w: 2.4, pillows: [PALETTE.blue, PALETTE.orange] }), 11.9, 6.2, -Math.PI / 2))
  scene.add(place(plant({ size: 1 }), 12.2, 8.3))

  // ── Lounge: el centro ──
  scene.add(place(rug(5, 3.6), 0, 4.4))
  scene.add(place(sofa({ w: 2.8 }), -1.7, 4.4, Math.PI / 2))
  scene.add(place(armchair(), 1.9, 4.4, -Math.PI / 2))
  scene.add(place(coffeeTable(), 0.1, 4.4))
  scene.add(place(floorLamp(), -2.6, 6.6))
  scene.add(place(plant({ size: 1.4 }), 2.6, 1.2))
  scene.add(place(plant({ size: 0.9 }), -2.8, 1.4))
}

// El cartel de cada zona: HTML encima de la escena, que sigue a su zona al rotar.
function buildLabels(scene, onPick) {
  const labels = []
  for (const zone of ZONES) {
    if (zone.id === 'overview') continue
    const el = document.createElement('button')
    el.type = 'button'
    el.className = 'office-label'
    el.innerHTML = '<b></b><span></span>'
    el.querySelector('b').textContent = zone.label
    el.querySelector('span').textContent = zone.detail
    el.addEventListener('click', () => onPick(zone.id))
    const label = new CSS2DObject(el)
    label.position.set(zone.center[0], 4.6, zone.center[2])
    scene.add(label)
    labels.push(label)
  }
  return labels
}

export function createOffice(container, { onFocus } = {}) {
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

  // Ortográfica: el aspecto de maqueta. `FRUSTUM` es cuánto del mundo entra a lo alto con zoom 1.
  const FRUSTUM = 21
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -200, 400)
  const VIEW_DIR = new THREE.Vector3(1, 0.95, 1.1).normalize()
  camera.position.copy(VIEW_DIR).multiplyScalar(60)

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.minZoom = 0.7
  controls.maxZoom = 4
  controls.minPolarAngle = 0.25
  controls.maxPolarAngle = 1.2
  controls.screenSpacePanning = true
  controls.target.set(0, 0, 0)

  // Luz: el cielo y el rebote del piso, más un sol tibio que proyecta sombras suaves.
  scene.add(new THREE.HemisphereLight('#ffffff', '#c8b59c', 1.6))
  const sun = new THREE.DirectionalLight('#fff1dd', 2.4)
  sun.position.set(14, 26, 12)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.camera.left = -20; sun.shadow.camera.right = 20
  sun.shadow.camera.top = 16; sun.shadow.camera.bottom = -16
  sun.shadow.bias = -0.0004
  sun.shadow.normalBias = 0.03
  sun.shadow.radius = 4
  scene.add(sun)
  const fill = new THREE.DirectionalLight('#cfe0ff', 0.6)
  fill.position.set(-16, 12, -6)
  scene.add(fill)

  const walls = buildRoom(scene)
  buildZones(scene)
  const labels = buildLabels(scene, (id) => focus(id))

  // ── el tamaño sigue al contenedor ──
  function resize() {
    const { clientWidth: w, clientHeight: h } = container
    if (!w || !h) return
    const aspect = w / h
    camera.left = (-FRUSTUM * aspect) / 2
    camera.right = (FRUSTUM * aspect) / 2
    camera.top = FRUSTUM / 2
    camera.bottom = -FRUSTUM / 2
    camera.updateProjectionMatrix()
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
    const distance = camera.position.distanceTo(controls.target)
    flight = {
      t: 0,
      fromTarget: controls.target.clone(), toTarget: target,
      fromPos: camera.position.clone(), toPos: target.clone().add(direction.multiplyScalar(distance)),
      fromZoom: camera.zoom, toZoom: zone.zoom,
    }
    onFocus?.(zone.id)
  }

  // ── el muro que tapa la vista se esconde ──
  const toCamera = new THREE.Vector3()
  function updateWalls() {
    toCamera.copy(camera.position).sub(controls.target).setY(0).normalize()
    for (const w of walls) w.visible = w.userData.outward.dot(toCamera) < 0.25
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
      camera.zoom = flight.fromZoom + (flight.toZoom - flight.fromZoom) * k
      camera.updateProjectionMatrix()
      if (flight.t >= 1) flight = null
    }
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
    observer.disconnect()
    controls.dispose()
    scene.traverse((o) => {
      o.geometry?.dispose()
      const list = Array.isArray(o.material) ? o.material : o.material ? [o.material] : []
      for (const m of list) { m.map?.dispose(); m.dispose() }
    })
    disposeMaterials()
    labels.forEach((l) => l.element.remove())
    renderer.dispose()
    renderer.domElement.remove()
    labelRenderer.domElement.remove()
  }

  return { focus, setAutoRotate, dispose, zones: ZONES }
}
