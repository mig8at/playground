/* EL PERRO — el del kit de cubos, paseando afuera por la acera que rodea la oficina.
 *
 * Da la vuelta al edificio por un rectángulo a media acera, entre la losa de la oficina y el bordillo, con las
 * esquinas redondeadas para no rozar los semáforos. De vez en cuando se detiene a olfatear (`Idle_Eating`) o a
 * mirar (`Idle`), y a veces trota (`Run`) un tramo. A veces da media vuelta y sigue para el otro lado.
 *
 * Va en el grupo de la calle (un escalón abajo de la oficina), así que sus coordenadas son las de la calle.
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

// El perro del kit mide 1,9 de alto: al 58 % queda en ~1,1, a la rodilla de un personaje de 2,7.
const SCALE = 0.58
const WALK = 1.5
const RUN = 3.6

// El recorrido: un cuadrado de lado 2·r con las esquinas redondeadas (radio `corner`), muestreado en puntos.
function loop(r, corner, steps = 10) {
  const pts = []
  const c = r - corner
  const arcs = [[c, c, 0], [-c, c, Math.PI / 2], [-c, -c, Math.PI], [c, -c, Math.PI * 1.5]]
  for (const [cx, cz, start] of arcs) {
    for (let i = 0; i <= steps; i++) {
      const a = start + (i / steps) * (Math.PI / 2)
      pts.push(new THREE.Vector2(cx + Math.cos(a) * corner, cz + Math.sin(a) * corner))
    }
  }
  return pts
}

export function createDog(scene, { radius, corner = 1.6 }) {
  const path = loop(radius, corner)
  const dog = { model: null, mixer: null, actions: {}, current: null, index: 0, dir: 1, pos: path[0].clone(),
    heading: 0, state: 'walking', timer: 4, speed: WALK }
  let disposed = false

  new GLTFLoader().load('/animals/Dog.gltf', (gltf) => {
    if (disposed) return
    dog.model = gltf.scene
    dog.model.scale.setScalar(SCALE)
    dog.model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true } })
    dog.mixer = new THREE.AnimationMixer(dog.model)
    dog.actions = Object.fromEntries(gltf.animations.map((clip) => [clip.name, dog.mixer.clipAction(clip)]))
    scene.add(dog.model)
    play('Walk', 0)
  })

  function play(name, fade = 0.25) {
    const next = dog.actions[name] || dog.actions.Idle
    if (!next || dog.current === next) return
    next.reset().fadeIn(fade).play()
    dog.current?.fadeOut(fade)
    dog.current = next
  }

  const tmp = new THREE.Vector2()
  function update(dt) {
    if (!dog.model) return
    dog.timer -= dt
    if (dog.state === 'resting') {
      if (dog.timer <= 0) {
        // Sigue: casi siempre caminando, a veces trotando, y a veces para el otro lado.
        if (Math.random() < 0.25) dog.dir *= -1
        const run = Math.random() < 0.3
        dog.state = 'walking'; dog.speed = run ? RUN : WALK; dog.timer = run ? 3 + Math.random() * 3 : 6 + Math.random() * 8
        play(run ? 'Run' : 'Walk')
      }
    } else {
      if (dog.timer <= 0) {
        dog.state = 'resting'; dog.timer = 2 + Math.random() * 3
        play(Math.random() < 0.55 ? 'Idle_Eating' : 'Idle')
      } else {
        // Avanza hacia el siguiente punto del recorrido.
        let left = dog.speed * dt
        while (left > 0) {
          const next = path[(dog.index + (dog.dir > 0 ? 1 : path.length - 1)) % path.length]
          tmp.subVectors(next, dog.pos)
          const d = tmp.length()
          if (d <= left) { dog.pos.copy(next); dog.index = (dog.index + (dog.dir > 0 ? 1 : path.length - 1)) % path.length; left -= d }
          else { dog.pos.addScaledVector(tmp, left / d); left = 0 }
        }
        if (tmp.lengthSq() > 1e-6) {
          const target = Math.atan2(tmp.x, tmp.y)
          dog.heading += Math.atan2(Math.sin(target - dog.heading), Math.cos(target - dog.heading)) * Math.min(1, dt * 8)
        }
      }
    }
    dog.mixer.update(dt)
    dog.model.position.set(dog.pos.x, 0, dog.pos.y)
    dog.model.rotation.y = dog.heading
  }

  function dispose() {
    disposed = true
    dog.mixer?.stopAllAction()
  }

  return { update, dispose }
}
