/* LA CALLE — lo que rodea la oficina: la base de la maqueta, dos calles que se cruzan, aceras, semáforos,
 * carros que circulan, árboles y la entrada con su toldo.
 *
 * La oficina ocupa [-15, 15] en x y z, con su acera hasta 18. La calle del sur corre a lo largo de x
 * (z de 18 a 24) y la del este a lo largo de z (x de 18 a 24); se cruzan en la esquina sureste. Más allá,
 * otra acera y pasto con los árboles del kit. Todo el suelo va de -22 a 32 en los dos ejes.
 *
 * Los semáforos alternan las dos calles (verde, amarillo, todo rojo, y le toca a la otra). Cada carro anda por
 * su carril, frena antes de la línea de pare si el suyo no está en verde y guarda distancia con el de adelante;
 * al llegar al borde de la maqueta vuelve a entrar por el otro lado.
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { PALETTE, box, cylinder, mat, canvasTexture } from './furniture.js'

// Todo sale de la mitad de la oficina: su acera llega 3 más allá, ahí empieza la calzada (6 de ancho) y después
// otra acera y pasto.
const HALF_OFFICE = 15
const RING = HALF_OFFICE + 3
const ROAD_A = RING        // donde empieza la calzada (desde la oficina)
const ROAD_B = RING + 6    // donde termina
const MIN = -(RING + 4)
const MAX = ROAD_B + 8
const MID = (ROAD_A + ROAD_B) / 2

const COLORS = {
  grass: '#8fd17a',
  asphalt: '#3a3954',
  line: '#f7f6ff',
  sidewalk: '#dcdae8',
  curb: '#c6c3d9',
  leaves: ['#4fbf5a', '#3aa64c', '#6fd16a'],
}

function flat(w, d, color, { x = 0, y = 0, z = 0 } = {}) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat(color, { rough: 0.95 }))
  m.rotation.x = -Math.PI / 2
  m.position.set(x, y, z)
  m.receiveShadow = true
  return m
}

// Un rectángulo del suelo dado por sus bordes [x0, z0, x1, z1].
const rect = ([x0, z0, x1, z1], color, y, height = 0) => (height
  ? box(x1 - x0, height, z1 - z0, color, { x: (x0 + x1) / 2, y: y - height, z: (z0 + z1) / 2, r: 0.03 })
  : flat(x1 - x0, z1 - z0, color, { x: (x0 + x1) / 2, y, z: (z0 + z1) / 2 }))

function buildGround(scene) {
  const span = MAX - MIN
  const c = (MIN + MAX) / 2
  // Las capas del suelo, de abajo hacia arriba, con al menos 3 centésimas entre una y otra: dos caras casi en el
  // mismo plano se pelean y parpadean al mover la cámara.
  //   base -0,20 · pasto -0,15 · calzada -0,10 · marcas -0,07 · acera 0 · bordillo 0,04
  scene.add(box(span + 1.2, 0.8, span + 1.2, PALETTE.base, { x: c, y: -1.0, z: c, r: 0.25 }))
  // El pasto es de un color liso: unos puntitos de textura, vistos de lejos, titilan al girar.
  scene.add(flat(span, span, COLORS.grass, { x: c, y: -0.15, z: c }))

  // Las calzadas, sin encimarse: la del sur entera y la del este en dos tramos, sin el cruce.
  scene.add(rect([MIN, ROAD_A, MAX, ROAD_B], COLORS.asphalt, -0.1))
  scene.add(rect([ROAD_A, MIN, ROAD_B, ROAD_A], COLORS.asphalt, -0.1))
  scene.add(rect([ROAD_A, ROAD_B, ROAD_B, MAX], COLORS.asphalt, -0.1))

  // Las aceras, un escalón arriba de la calzada: la de la oficina y las de enfrente.
  const sidewalks = [
    [MIN, MIN, ROAD_A, ROAD_A],                                 // la manzana de la oficina
    [MIN, ROAD_B, ROAD_A, ROAD_B + 2], [ROAD_B, ROAD_B, MAX, ROAD_B + 2], // enfrente, al sur
    [ROAD_B, MIN, ROAD_B + 2, ROAD_A], [ROAD_B, ROAD_B + 2, ROAD_B + 2, MAX], // enfrente, al este
  ]
  // La manzana de la oficina no es toda acera: un anillo de 3 alrededor del edificio y el resto pasto.
  scene.add(rect([-RING, -RING, ROAD_A, ROAD_A], COLORS.sidewalk, 0, 0.2))
  for (const r of sidewalks.slice(1)) scene.add(rect(r, COLORS.sidewalk, 0, 0.2))
  // Bordillos de la manzana de la oficina contra las calles.
  scene.add(rect([-RING, ROAD_A - 0.25, ROAD_A, ROAD_A], COLORS.curb, 0.04, 0.25))
  scene.add(rect([ROAD_A - 0.25, -RING, ROAD_A, ROAD_A - 0.25], COLORS.curb, 0.04, 0.25))

  // Las marcas: la línea del medio (punteada, sin pisar el cruce), los pasos de cebra y las líneas de pare.
  for (let x = MIN + 1; x < MAX; x += 2.4) if (x + 1.4 < ROAD_A - 1.6 || x > ROAD_B + 1.6) scene.add(flat(1.4, 0.16, COLORS.line, { x: x + 0.7, y: -0.07, z: MID }))
  for (let z = MIN + 1; z < MAX; z += 2.4) if (z + 1.4 < ROAD_A - 1.6 || z > ROAD_B + 1.6) scene.add(flat(0.16, 1.4, COLORS.line, { x: MID, y: -0.07, z: z + 0.7 }))
  for (let i = 0; i < 7; i++) {
    const t = ROAD_A + 0.5 + i * 0.84
    scene.add(flat(1.1, 0.42, COLORS.line, { x: ROAD_A - 0.9, y: -0.07, z: t }))
    scene.add(flat(1.1, 0.42, COLORS.line, { x: ROAD_B + 0.9, y: -0.07, z: t }))
    scene.add(flat(0.42, 1.1, COLORS.line, { x: t, y: -0.07, z: ROAD_A - 0.9 }))
    scene.add(flat(0.42, 1.1, COLORS.line, { x: t, y: -0.07, z: ROAD_B + 0.9 }))
  }
}

// ── la entrada: el camino desde la puerta, el toldo con el nombre y dos macetas ──
function buildEntrance(scene) {
  // Dos escalones: la oficina está sobre una losa, un escalón (0,45) arriba de la acera.
  scene.add(box(3, 0.3, 0.6, PALETTE.base, { y: 0, z: HALF_OFFICE + 1.4, r: 0.04 }))
  scene.add(box(3, 0.15, 0.6, PALETTE.base, { y: 0, z: HALF_OFFICE + 2, r: 0.04 }))
  scene.add(rect([-1.4, HALF_OFFICE + 2.3, 1.4, ROAD_A - 0.25], PALETTE.oat, 0.02, 0.04))
  const sign = canvasTexture(512, 96, (g, W, H) => {
    g.fillStyle = PALETTE.ink; g.fillRect(0, 0, W, H)
    g.fillStyle = '#ffffff'; g.font = 'bold 54px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'
    g.fillText('creditop', W / 2 - 40, H / 2 + 2)
    g.fillStyle = PALETTE.primary; g.beginPath(); g.arc(W / 2 + 125, H / 2 + 14, 9, 0, Math.PI * 2); g.fill()
  })
  const awning = new THREE.Group()
  awning.add(box(3.6, 0.12, 1.5, PALETTE.ink, { y: 0, r: 0.04 }))
  awning.add(box(3.6, 0.5, 0.1, PALETTE.ink, { y: -0.38, z: 0.72, r: 0.03 }))
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.45), new THREE.MeshStandardMaterial({ map: sign, roughness: 0.6 }))
  plate.position.set(0, -0.13, 0.78)
  awning.add(plate)
  for (const sx of [-1, 1]) awning.add(cylinder(0.05, 0.05, 4.15, PALETTE.ink, { x: sx * 1.7, y: -4.15, z: 0.65 }))
  awning.position.set(0, 4.15, HALF_OFFICE + 1.4)
  scene.add(awning)
  for (const sx of [-1, 1]) {
    scene.add(cylinder(0.35, 0.28, 0.6, PALETTE.white, { x: sx * 2.1, y: 0, z: HALF_OFFICE + 1.35 }))
    const shrub = new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 10), mat(COLORS.leaves[1]))
    shrub.position.set(sx * 2.1, 0.85, HALF_OFFICE + 1.35)
    shrub.castShadow = true
    scene.add(shrub)
  }
}

// ── los árboles: los del kit de cubos (chat/public/environment, CC0) ──
// Miden de 6 a 7,7 de alto a la escala de los personajes (~2,5 veces una persona) y son anchos (5 a 9): van
// algo achicados y espaciados de a 6, para que las copas no se encimen. Se carga cada modelo una vez y se clona.
const TREE_MODELS = ['Tree_1', 'Tree_2', 'Tree_3']
const TREE_SCALE = 0.72

function buildTrees(scene) {
  const spots = []
  const back = MIN + 1.8, front = ROAD_B + 4.6
  for (let x = MIN + 2.5; x <= ROAD_A - 2; x += 6) spots.push([x, back])     // detrás, al norte
  for (let z = MIN + 8.5; z <= ROAD_A - 2; z += 6) spots.push([back, z])     // al oeste
  for (let z = MIN + 2.5; z <= ROAD_A - 2; z += 6) spots.push([front, z])    // enfrente, al este
  for (let x = MIN + 2.5; x <= ROAD_A - 2; x += 6) spots.push([x, front])    // enfrente, al sur
  spots.push([front + 0.2, front + 0.2])                                     // la esquina de enfrente
  const loader = new GLTFLoader()
  Promise.all(TREE_MODELS.map((name) => loader.loadAsync(`/environment/${name}.gltf`).then((g) => g.scene))).then((models) => {
    for (const model of models) model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true } })
    spots.forEach(([x, z], i) => {
      const t = models[(i * 7) % models.length].clone()
      t.scale.setScalar(TREE_SCALE * (0.9 + ((i * 5) % 4) * 0.06))
      t.position.set(x, 0, z)
      t.rotation.y = i * 1.3
      scene.add(t)
    })
  }).catch(() => { /* sin árboles: el resto de la maqueta sigue igual */ })
}

// ── los semáforos ──
// Un poste con una cabeza por calle que cruza; cada luz tiene su propio material para poder prenderse sola.
const LIGHT_COLORS = { red: '#ff4d4d', yellow: '#ffc93c', green: '#2fe08a' }
function trafficLight(scene, x, z) {
  const g = new THREE.Group()
  g.add(cylinder(0.09, 0.11, 4.4, PALETTE.ink))
  const heads = []
  // axis 'x': mira a los carros que van por la calle del sur (a lo largo de x); 'z': los de la calle del este.
  for (const [axis, rotation] of [['x', Math.PI / 2], ['z', 0]]) {
    const head = new THREE.Group()
    head.add(box(0.42, 1.15, 0.36, PALETTE.ink, { r: 0.06 }))
    const lamps = {}
    ;['red', 'yellow', 'green'].forEach((name, i) => {
      const material = new THREE.MeshStandardMaterial({ color: '#2b2a40', emissive: LIGHT_COLORS[name], emissiveIntensity: 0, roughness: 0.4 })
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.12, 14, 10), material)
      lamp.position.set(0, 0.92 - i * 0.34, 0.19)
      head.add(lamp)
      lamps[name] = material
    })
    head.position.set(0, 3.5, 0)
    head.rotation.y = rotation
    g.add(head)
    heads.push({ axis, lamps })
  }
  g.position.set(x, 0, z)
  scene.add(g)
  return heads
}

// El ciclo: verde 7 s, amarillo 1,6 s y 1 s todo en rojo; después le toca a la otra calle.
const GREEN = 7, YELLOW = 1.6, ALL_RED = 1
const CYCLE = 2 * (GREEN + YELLOW + ALL_RED)
function signalFor(axis, t) {
  const local = (t + (axis === 'z' ? CYCLE / 2 : 0)) % CYCLE
  if (local < GREEN) return 'green'
  if (local < GREEN + YELLOW) return 'yellow'
  return 'red'
}

// ── los carros ──
// Carros en tonos de calle (blanco, negro, gris, arena, pizarra, rojo apagado) y uno morado, de vez en cuando.
const CAR_COLORS = ['#f4f2ee', PALETTE.ink, '#9a9690', PALETTE.sand, PALETTE.slate, '#b0533f', PALETTE.primary, '#e6e2da', PALETTE.sageDark]
function car(color) {
  const g = new THREE.Group()
  g.add(box(2.3, 0.55, 1.1, color, { y: 0.28, r: 0.18 }))
  g.add(box(1.25, 0.5, 0.98, color, { x: -0.15, y: 0.78, r: 0.16 }))
  const glass = mat('#c8c2ff', { rough: 0.15 })
  g.add(box(1.28, 0.34, 1.0, null, { x: -0.15, y: 0.86, r: 0.1, material: glass }))
  for (const sx of [-0.75, 0.75]) for (const sz of [-0.52, 0.52]) {
    const wheel = cylinder(0.26, 0.26, 0.2, '#22213a', { segments: 16 })
    wheel.rotation.x = Math.PI / 2
    wheel.position.set(sx, 0.26, sz)
    g.add(wheel)
  }
  for (const sz of [-0.35, 0.35]) {
    g.add(box(0.06, 0.12, 0.2, '#fff8d6', { x: 1.15, y: 0.4, z: sz, r: 0.02, material: mat('#fff8d6', { emissive: '#fff3b0' }) }))
    g.add(box(0.06, 0.12, 0.2, '#ff5a5a', { x: -1.15, y: 0.4, z: sz, r: 0.02 }))
  }
  return g
}

// Los carriles: por cuál eje van, hacia dónde y a qué altura del otro eje. Se maneja por la derecha.
const LANES = [
  { axis: 'x', dir: 1, at: ROAD_A + 4.5 },
  { axis: 'x', dir: -1, at: ROAD_A + 1.5 },
  { axis: 'z', dir: 1, at: ROAD_A + 1.5 },
  { axis: 'z', dir: -1, at: ROAD_A + 4.5 },
]
const SPEED = 4.2
// Los carros, a la escala de los personajes (~2,7 de alto): 1,5 veces el modelo.
const CAR_SCALE = 1.5
const CAR_HALF = 1.15 * CAR_SCALE
const GAP = 1.4

export function buildStreet(scene) {
  buildGround(scene)
  buildEntrance(scene)
  buildTrees(scene)
  const heads = [
    [ROAD_A - 0.8, ROAD_A - 0.8], [ROAD_B + 0.8, ROAD_A - 0.8], [ROAD_A - 0.8, ROAD_B + 0.8], [ROAD_B + 0.8, ROAD_B + 0.8],
  ].flatMap(([x, z]) => trafficLight(scene, x, z))

  // Tres carros por carril, repartidos a lo largo.
  const cars = []
  LANES.forEach((lane, l) => {
    for (let i = 0; i < 3; i++) {
      const mesh = car(CAR_COLORS[(l * 3 + i) % CAR_COLORS.length])
      mesh.scale.setScalar(CAR_SCALE)
      const s = MIN + 2 + ((i * 15 + l * 6) % (MAX - MIN - 4))
      mesh.rotation.y = lane.axis === 'x' ? (lane.dir > 0 ? 0 : Math.PI) : (lane.dir > 0 ? -Math.PI / 2 : Math.PI / 2)
      scene.add(mesh)
      cars.push({ mesh, lane, s, speed: SPEED })
    }
  })

  let clock = 0
  function update(dt) {
    clock += dt
    for (const { axis, lamps } of heads) {
      const on = signalFor(axis, clock)
      for (const name of ['red', 'yellow', 'green']) lamps[name].emissiveIntensity = name === on ? 2.2 : 0
    }
    for (const lane of LANES) {
      const signal = signalFor(lane.axis, clock)
      // La línea de pare: el frente del carro no la pasa si su luz no está en verde.
      const stopFront = lane.dir > 0 ? ROAD_A - 1.6 : ROAD_B + 1.6
      // Del que va adelante al que va atrás, para que cada uno mire al de adelante.
      const inLane = cars.filter((c) => c.lane === lane).sort((a, b) => (b.s - a.s) * lane.dir)
      inLane.forEach((c, i) => {
        const front = c.s + lane.dir * CAR_HALF
        let limit = Infinity
        const toStop = (stopFront - front) * lane.dir
        const mustStop = signal === 'red' || (signal === 'yellow' && toStop > 2.2)
        if (mustStop && toStop > -0.2 && toStop < 9) limit = Math.min(limit, toStop)
        const ahead = inLane[i - 1]
        if (ahead) limit = Math.min(limit, (ahead.s - c.s) * lane.dir - 2 * CAR_HALF - GAP)
        // Frena suave: cuanto menos lugar queda, más despacio.
        const target = limit === Infinity ? SPEED : Math.max(0, Math.min(SPEED, limit * 1.6))
        c.speed += (target - c.speed) * Math.min(1, dt * 4)
        c.s += lane.dir * c.speed * dt
        // Al salir de la maqueta vuelve a entrar por el otro lado.
        if (lane.dir > 0 && c.s > MAX + 1) c.s = MIN - 1
        if (lane.dir < 0 && c.s < MIN - 1) c.s = MAX + 1
        const inside = c.s > MIN + 0.4 && c.s < MAX - 0.4
        c.mesh.visible = inside
        if (lane.axis === 'x') c.mesh.position.set(c.s, -0.1, lane.at)
        else c.mesh.position.set(lane.at, -0.1, c.s)
      })
    }
  }

  return { update, bounds: { min: MIN, max: MAX } }
}
