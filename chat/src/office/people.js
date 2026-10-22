/* LA GENTE DE LA OFICINA — los cuatro personajes del kit de cubos caminando, sentándose y esquivándose.
 *
 * Por dónde se camina: una grilla de 0,5 sobre el piso de la oficina. Una celda está bloqueada si cae dentro de
 * un mueble, un tabique o el borde de los muros (cada obstáculo, inflado por el radio de una persona). Los
 * caminos salen de A* sobre esa grilla, en ocho direcciones y sin cortar esquinas, y se acortan quitando los
 * puntos intermedios que se pueden saltar en línea recta.
 *
 * Qué hace cada uno: elige un asiento libre (lo reserva para que nadie más vaya) o un lugar cualquiera, camina
 * hasta ahí, se sienta un rato o se queda parado (a veces saluda o asiente), y vuelve a elegir.
 *
 * No chocar: quien camina mira si hay alguien adelante y cerca; si lo hay, espera (entre dos que caminan, cede
 * el de menor prioridad, para que nunca se esperen los dos). Si sigue trabado un momento,
 * busca otro camino tratando como bloqueado el lugar donde están los demás. Además, dos que quedan muy juntos se
 * separan un poco, para no encimarse nunca.
 *
 * Sentarse: el kit no trae esa animación. Se arma sobre `Idle`, doblando muslos y rodillas después de que el
 * mezclador aplica la animación, y bajando el cuerpo hasta la altura del asiento.
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

const CELL = 0.5
const RADIUS = 0.55          // la holgura contra muebles y muros (lo justo para pasar por las puertas)
const PERSONAL = 0.8         // la mitad de la distancia mínima entre dos personas: miden ~1,3 de ancho con los brazos
const WALK_SPEED = 1.7
const TURN_SPEED = 8
const MODELS = ['Character_Male_1', 'Character_Female_1', 'Character_Male_2', 'Character_Female_2']

// ── la grilla ──────────────────────────────────────────────────────────────────────────────────────────
function makeGrid(half, obstacles) {
  const n = Math.round((2 * half) / CELL)
  const blocked = new Uint8Array(n * n)
  const center = (i) => -half + (i + 0.5) * CELL
  const box = new THREE.Box3()
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = center(i), z = center(j)
    if (Math.abs(x) > half - RADIUS || Math.abs(z) > half - RADIUS) blocked[j * n + i] = 1
  }
  for (const { object, inflate = RADIUS } of obstacles) {
    box.setFromObject(object).expandByScalar(inflate)
    const i0 = Math.max(0, Math.floor((box.min.x + half) / CELL)), i1 = Math.min(n - 1, Math.floor((box.max.x + half) / CELL))
    const j0 = Math.max(0, Math.floor((box.min.z + half) / CELL)), j1 = Math.min(n - 1, Math.floor((box.max.z + half) / CELL))
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = center(i), z = center(j)
      if (x >= box.min.x && x <= box.max.x && z >= box.min.z && z <= box.max.z) blocked[j * n + i] = 1
    }
  }
  const cellOf = (x, z) => [Math.min(n - 1, Math.max(0, Math.floor((x + half) / CELL))), Math.min(n - 1, Math.max(0, Math.floor((z + half) / CELL)))]
  const free = (i, j, extra) => i >= 0 && j >= 0 && i < n && j < n && !blocked[j * n + i] && !extra?.has(j * n + i)
  return { n, half, blocked, center, cellOf, free }
}

// La celda libre más cercana a un punto (para un asiento o un destino que cae justo en un borde).
function nearestFree(grid, x, z, extra) {
  const [ci, cj] = grid.cellOf(x, z)
  for (let r = 0; r < 8; r++) {
    let best = null, bestD = Infinity
    for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) {
      if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r || !grid.free(i, j, extra)) continue
      const d = (grid.center(i) - x) ** 2 + (grid.center(j) - z) ** 2
      if (d < bestD) { bestD = d; best = [i, j] }
    }
    if (best) return best
  }
  return null
}

// A* en ocho direcciones, sin cortar esquinas. Devuelve los centros de celda, del origen al destino.
function findPath(grid, from, to, extra) {
  const { n } = grid
  // Los puntos son Vector2 del piso: x es x y `y` es z.
  const start = nearestFree(grid, from.x, from.y, extra)
  const goal = nearestFree(grid, to.x, to.y, extra)
  if (!start || !goal) return null
  const key = (i, j) => j * n + i
  const g = new Float32Array(n * n).fill(Infinity)
  const parent = new Int32Array(n * n).fill(-1)
  const closed = new Uint8Array(n * n)
  const heap = [] // [f, key]
  const push = (f, k) => { heap.push([f, k]); let c = heap.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (heap[p][0] <= heap[c][0]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p } }
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let c = 0; for (;;) { const l = 2 * c + 1, r = l + 1; let m = c; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === c) break; [heap[m], heap[c]] = [heap[c], heap[m]]; c = m } } return top }
  const h = (i, j) => { const dx = Math.abs(i - goal[0]), dz = Math.abs(j - goal[1]); return Math.max(dx, dz) + 0.414 * Math.min(dx, dz) }
  const sk = key(...start)
  g[sk] = 0
  push(h(...start), sk)
  const goalKey = key(...goal)
  while (heap.length) {
    const [, k] = pop()
    if (closed[k]) continue
    closed[k] = 1
    if (k === goalKey) break
    const i = k % n, j = (k / n) | 0
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue
      const ni = i + di, nj = j + dj
      if (!grid.free(ni, nj, extra)) continue
      if (di && dj && (!grid.free(i + di, j, extra) || !grid.free(i, j + dj, extra))) continue
      const nk = key(ni, nj)
      const cost = g[k] + (di && dj ? 1.414 : 1)
      if (cost < g[nk]) { g[nk] = cost; parent[nk] = k; push(cost + h(ni, nj), nk) }
    }
  }
  if (!closed[goalKey]) return null
  const cells = []
  for (let k = goalKey; k !== -1; k = parent[k]) cells.push(k)
  cells.reverse()
  const points = cells.map((k) => new THREE.Vector2(grid.center(k % n), grid.center((k / n) | 0)))
  return smooth(grid, points, extra)
}

// Se salta los puntos intermedios cuando la recta entre dos puntos no pasa por ninguna celda bloqueada.
function clearLine(grid, a, b, extra) {
  const steps = Math.ceil(a.distanceTo(b) / (CELL * 0.4))
  for (let s = 1; s < steps; s++) {
    const t = s / steps
    const [i, j] = grid.cellOf(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)
    if (!grid.free(i, j, extra)) return false
  }
  return true
}
function smooth(grid, points, extra) {
  if (points.length <= 2) return points
  const out = [points[0]]
  let anchor = 0
  for (let k = 2; k < points.length; k++) {
    if (!clearLine(grid, points[anchor], points[k], extra)) { out.push(points[k - 1]); anchor = k - 1 }
  }
  out.push(points.at(-1))
  return out
}

// ── el personaje ───────────────────────────────────────────────────────────────────────────────────────
const SIT_THIGH = -1.3       // cuánto se doblan los muslos hacia adelante (radianes, eje x del hueso)
const SIT_SHIN = 1.55        // y las rodillas

function setupSitPose(model) {
  const bones = {}
  model.traverse((o) => { if (o.isBone) bones[o.name] = o })
  model.updateMatrixWorld(true)
  const hips = bones.Hips ? new THREE.Vector3().setFromMatrixPosition(bones.Hips.matrixWorld).y : 1
  return {
    // El cargador de Three les saca los puntos a los nombres (`UpperLeg.L` queda `UpperLegL`): se busca de las dos formas.
    legs: ['L', 'R'].map((s) => ({ thigh: bones[`UpperLeg.${s}`] || bones[`UpperLeg${s}`], shin: bones[`LowerLeg.${s}`] || bones[`LowerLeg${s}`] })).filter((l) => l.thigh && l.shin),
    hips,
  }
}

const qThigh = new THREE.Quaternion(), qShin = new THREE.Quaternion(), axisX = new THREE.Vector3(1, 0, 0)
function applySitPose(rig, weight) {
  if (weight <= 0) return
  qThigh.setFromAxisAngle(axisX, SIT_THIGH * weight)
  qShin.setFromAxisAngle(axisX, SIT_SHIN * weight)
  for (const { thigh, shin } of rig.legs) { thigh.quaternion.multiply(qThigh); shin.quaternion.multiply(qShin) }
}

const lerpAngle = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t

export function createPeople(scene, { half, obstacles, seats: allSeats }) {
  const grid = makeGrid(half, obstacles)
  // El punto desde donde se llega a cada asiento va a la celda libre más cercana; si queda lejos del asiento
  // (el mueble está encerrado), ese asiento no se usa.
  const seats = allSeats.filter((s) => {
    const cell = nearestFree(grid, s.approach.x, s.approach.y)
    if (!cell) return false
    s.approach.set(grid.center(cell[0]), grid.center(cell[1]))
    return s.approach.distanceTo(s.at) < 2.6
  })
  const people = []
  const loader = new GLTFLoader()
  let disposed = false

  // Un lugar libre al azar, lejos de donde están o van los demás.
  function randomSpot(except) {
    for (let tries = 0; tries < 60; tries++) {
      const i = Math.floor(Math.random() * grid.n), j = Math.floor(Math.random() * grid.n)
      if (!grid.free(i, j)) continue
      const p = new THREE.Vector2(grid.center(i), grid.center(j))
      if (people.every((o) => o === except || (o.position.distanceTo(p) > 2.2 && (!o.goal || o.goal.distanceTo(p) > 2.2)))) return p
    }
    return null
  }

  function planTo(person, goal, avoidOthers = false) {
    let extra = null
    if (avoidOthers) {
      extra = new Set()
      for (const o of people) {
        if (o === person) continue
        const [ci, cj] = grid.cellOf(o.position.x, o.position.y)
        for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) extra.add((cj + dj) * grid.n + (ci + di))
      }
    }
    const path = findPath(grid, person.position, goal, extra)
    if (!path) return false
    person.path = path.slice(1)
    person.goal = goal.clone()
    return true
  }

  // Qué hacer ahora: casi siempre sentarse si hay un asiento libre; si no, pararse en algún lado.
  function decide(person) {
    const free = seats.filter((s) => !s.takenBy)
    if (free.length && Math.random() < 0.7) {
      const seat = free[Math.floor(Math.random() * free.length)]
      seat.takenBy = person
      person.seat = seat
      if (planTo(person, seat.approach)) { person.state = 'walking'; return }
      seat.takenBy = null
      person.seat = null
    }
    const spot = randomSpot(person)
    if (spot && planTo(person, spot)) { person.state = 'walking'; return }
    person.state = 'waiting'
    person.timer = 1
  }

  function play(person, name, fade = 0.25) {
    const next = person.actions[name] || person.actions.Idle
    if (person.current === next) return
    next.reset().fadeIn(fade).play()
    person.current?.fadeOut(fade)
    person.current = next
  }

  function spawn(name, index) {
    loader.load(`/characters/${name}.gltf`, (gltf) => {
      if (disposed) return
      const model = gltf.scene
      model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true } })
      const mixer = new THREE.AnimationMixer(model)
      const actions = Object.fromEntries(gltf.animations.map((clip) => [clip.name, mixer.clipAction(clip)]))
      const person = {
        name, model, mixer, actions, current: null, rig: setupSitPose(model), priority: index,
        position: new THREE.Vector2(), heading: Math.random() * Math.PI * 2, y: 0,
        state: 'waiting', timer: 0.5 + index * 0.7, path: [], goal: null, seat: null, sit: 0, blockedFor: 0,
      }
      const start = randomSpot(person) || new THREE.Vector2(index * 1.5 - 2, 0)
      person.position.copy(start)
      scene.add(model)
      people.push(person)
      play(person, 'Idle', 0)
    })
  }
  MODELS.forEach(spawn)

  const tmp = new THREE.Vector2()
  function update(dt) {
    for (const p of people) {
      switch (p.state) {
        case 'waiting':
          play(p, p.gesture || 'Idle')
          p.timer -= dt
          if (p.timer <= 0) { p.gesture = null; decide(p) }
          break

        case 'walking': {
          const target = p.path[0]
          if (!target) { arrive(p); break }
          tmp.subVectors(target, p.position)
          const dist = tmp.length()
          // ¿Hay alguien adelante y cerca? Espera; si sigue trabado, busca otro camino esquivándolo.
          // Ante alguien parado (o sentándose) cualquiera espera; entre dos que caminan cede sólo el de menor
          // prioridad: si cedieran los dos, se quedarían esperándose para siempre.
          const ahead = people.some((o) => {
            if (o === p) return false
            if (o.state === 'walking' && o.priority < p.priority) return false
            const d = o.position.distanceTo(p.position)
            if (d > PERSONAL * 2 + 0.7) return false
            const toO = new THREE.Vector2().subVectors(o.position, p.position)
            return toO.dot(tmp) / (dist || 1) > d * 0.35
          })
          if (ahead) {
            play(p, 'Idle')
            p.blockedFor += dt
            if (p.blockedFor > 1.2) {
              p.blockedFor = 0
              const goal = p.seat ? p.seat.approach : p.goal
              if (!goal || !planTo(p, goal, true)) { if (p.seat) { p.seat.takenBy = null; p.seat = null } p.state = 'waiting'; p.timer = 0.6 + Math.random() }
            }
            break
          }
          p.blockedFor = 0
          play(p, 'Walk')
          const step = Math.min(dist, WALK_SPEED * dt)
          if (dist > 1e-4) {
            p.position.addScaledVector(tmp, step / dist)
            p.heading = lerpAngle(p.heading, Math.atan2(tmp.x, tmp.y), Math.min(1, dt * TURN_SPEED))
          }
          if (dist - step < 0.05) p.path.shift()
          break
        }

        case 'sitting-down': {
          // Del punto de llegada al asiento, girando hacia donde mira el asiento, y bajando.
          p.timer = Math.min(1, p.timer + dt / 0.7)
          const s = p.seat
          p.position.lerpVectors(s.approach, s.at, p.timer)
          p.heading = lerpAngle(p.heading, s.facing, Math.min(1, dt * TURN_SPEED))
          p.sit = p.timer
          play(p, 'Idle')
          if (p.timer >= 1) { p.state = 'sitting'; p.timer = 8 + Math.random() * 10 }
          break
        }

        case 'sitting':
          p.heading = lerpAngle(p.heading, p.seat.facing, Math.min(1, dt * TURN_SPEED))
          p.timer -= dt
          if (p.timer <= 0) { p.state = 'standing-up'; p.timer = 1 }
          break

        case 'standing-up': {
          p.timer = Math.max(0, p.timer - dt / 0.7)
          const s = p.seat
          p.position.lerpVectors(s.approach, s.at, p.timer)
          p.sit = p.timer
          if (p.timer <= 0) { s.takenBy = null; p.seat = null; p.state = 'waiting'; p.timer = 0.3 }
          break
        }
      }

      // Nadie se encima: si dos quedan más cerca que la distancia mínima, se separan (salvo el que está sentado).
      for (const o of people) {
        if (o === p || p.state.startsWith('sit') || p.state === 'standing-up') continue
        const d = p.position.distanceTo(o.position)
        if (d > 0 && d < PERSONAL * 2) {
          tmp.subVectors(p.position, o.position).multiplyScalar(((PERSONAL * 2 - d) / d) * 0.5)
          const next = p.position.clone().add(tmp)
          const [i, j] = grid.cellOf(next.x, next.y)
          if (grid.free(i, j)) p.position.copy(next)
        }
      }

      p.mixer.update(dt)
      applySitPose(p.rig, p.sit)
      const seatY = p.seat ? p.seat.height + 0.12 - p.rig.hips : 0
      p.model.position.set(p.position.x, seatY * p.sit, p.position.y)
      p.model.rotation.y = p.heading
    }
  }

  function arrive(p) {
    if (p.seat) { p.state = 'sitting-down'; p.timer = 0; return }
    p.state = 'waiting'
    p.timer = 3 + Math.random() * 4
    p.gesture = Math.random() < 0.35 ? ['Wave', 'Yes', 'Idle_Hold'][Math.floor(Math.random() * 3)] : null
  }

  function dispose() {
    disposed = true
    for (const p of people) {
      p.mixer.stopAllAction()
      scene.remove(p.model)
      p.model.traverse((o) => { o.geometry?.dispose(); if (o.material) { o.material.map?.dispose(); o.material.dispose() } })
    }
  }

  return { update, dispose, grid }
}
