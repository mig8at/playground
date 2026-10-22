/* CÓMO SE VE UN PERSONAJE — una forma del kit y cinco colores.
 *
 * Los cuatro personajes del kit de cubos usan un solo material con una textura de 32 × 32 que es una paleta:
 * cada parte del cuerpo toma su color de un recuadro de 4 px. Los cuatro ordenan la paleta igual — pelo, piel,
 * ojos, camisa y pantalón, de izquierda a derecha — y sólo cambia la fila que usa cada uno (medido sobre sus UV
 * y sus huesos). Cambiar un color es repintar ese recuadro en una copia de la textura: el modelo, el esqueleto y
 * las animaciones no se tocan.
 *
 * Cada forma se baja una vez y se clona con su esqueleto (SkeletonUtils), así dos personajes de la misma forma
 * pueden tener colores distintos.
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'

// La fila de la paleta de cada forma (y en px) y cómo se la nombra.
export const BASES = {
  Character_Male_1: { label: 'Copete', row: 8 },
  Character_Male_2: { label: 'Corto', row: 12 },
  Character_Female_1: { label: 'Melena', row: 20 },
  Character_Female_2: { label: 'Coletas', row: 16 },
}

// Las partes, en el orden de la paleta (x en px).
export const PARTS = [
  { id: 'hair', label: 'Pelo', x: 0 },
  { id: 'skin', label: 'Piel', x: 4 },
  { id: 'eyes', label: 'Ojos', x: 8 },
  { id: 'shirt', label: 'Camisa', x: 12 },
  { id: 'pants', label: 'Pantalón', x: 16 },
]

// Los colores con que viene cada forma en el kit.
export const ORIGINAL_COLORS = {
  Character_Male_1: { hair: '#cf9f41', skin: '#cfa78b', eyes: '#297e7b', shirt: '#7e260e', pants: '#375a71' },
  Character_Male_2: { hair: '#583e2a', skin: '#876e5b', eyes: '#343434', shirt: '#297e7b', pants: '#3d647e' },
  Character_Female_1: { hair: '#45433b', skin: '#695140', eyes: '#343434', shirt: '#b9822a', pants: '#375a71' },
  Character_Female_2: { hair: '#7e260e', skin: '#cfa78b', eyes: '#3a3e34', shirt: '#6d8020', pants: '#375a71' },
}

// Sugerencias por parte: tonos naturales para pelo, piel y ojos; para la ropa, también los de CreditOp.
export const SUGGESTIONS = {
  hair: ['#1f1b18', '#45433b', '#583e2a', '#8a5a2b', '#cf9f41', '#e8d38a', '#7e260e', '#b7472a', '#d9d4cc', '#6a4fb3'],
  skin: ['#f3d2b8', '#e6b99a', '#cfa78b', '#b98a6a', '#876e5b', '#695140', '#4a3426'],
  eyes: ['#343434', '#3a3e34', '#297e7b', '#3d647e', '#4a7a3a', '#6b4a2b', '#4c39ff'],
  shirt: ['#7e260e', '#b9822a', '#6d8020', '#297e7b', '#3d647e', '#4c39ff', '#1e1e22', '#f3f0ea', '#c07b60', '#8ea489'],
  pants: ['#375a71', '#3d647e', '#1e1e22', '#5f6c79', '#8e8a84', '#6b4a33', '#2b2b30', '#d6ccbe'],
}

const loader = new GLTFLoader()
const cache = new Map()
function loadBase(base) {
  if (!cache.has(base)) cache.set(base, loader.loadAsync(`/characters/${base}.gltf`))
  return cache.get(base)
}

// Repinta los recuadros de la paleta del modelo con `colors`. Cada modelo tiene su copia de la textura.
export function recolor(model, base, colors) {
  const row = BASES[base]?.row
  if (row === undefined) return
  model.traverse((o) => {
    if (!o.isMesh || !o.material?.map) return
    const source = o.userData.originalMap || o.material.map
    o.userData.originalMap = source
    const canvas = o.userData.paletteCanvas || document.createElement('canvas')
    canvas.width = source.image.width
    canvas.height = source.image.height
    const g = canvas.getContext('2d')
    g.imageSmoothingEnabled = false
    g.clearRect(0, 0, canvas.width, canvas.height)
    g.drawImage(source.image, 0, 0)
    const k = canvas.width / 32
    for (const part of PARTS) {
      if (!colors?.[part.id]) continue
      g.fillStyle = colors[part.id]
      g.fillRect(part.x * k, row * k, 4 * k, 4 * k)
    }
    if (!o.userData.paletteCanvas) {
      o.userData.paletteCanvas = canvas
      const texture = new THREE.CanvasTexture(canvas)
      texture.flipY = source.flipY
      texture.colorSpace = THREE.SRGBColorSpace
      texture.magFilter = THREE.NearestFilter
      texture.minFilter = THREE.NearestFilter
      texture.generateMipmaps = false
      o.material = o.material.clone()
      o.material.map = texture
    } else {
      o.material.map.needsUpdate = true
    }
  })
}

// Un personaje listo para la escena: el modelo clonado (con su esqueleto), sus animaciones y sus colores.
export async function makeCharacter(base, colors) {
  const gltf = await loadBase(base)
  const model = cloneSkinned(gltf.scene)
  model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true } })
  recolor(model, base, colors)
  return { model, animations: gltf.animations }
}
