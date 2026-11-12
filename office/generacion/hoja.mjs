// Genera con Gemini una hoja 3×3 de un personaje de Office, en papel cortado plano, pensada para pasarla a SVG y
// animarla: colores sólidos, sin degradados ni texturas, piezas separadas y las mismas proporciones en las nueve.
// La llave se lee de connectors/.env y no se imprime.
//
//   node office/generacion/hoja.mjs <personaje> <salida.jpg> [modelo]   (Gemini devuelve JPEG)
//
// Personajes: los de PERSONAJES, abajo. Son los agentes y personas originales de Office.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const [, , who = 'wario', out = 'hoja.png', model = 'gemini-3-pro-image'] = process.argv
const env = readFileSync(join(root, 'connectors', '.env'), 'utf8')
const key = env.split('\n').find((l) => l.startsWith('GEMINI_API_KEY='))?.slice('GEMINI_API_KEY='.length).trim().replace(/^["']|["']$/g, '')
if (!key) throw new Error('falta GEMINI_API_KEY en connectors/.env')

// La paleta es la de Office (index.html): la hoja tiene que caer en esos mismos colores.
const PALETTE = 'deep teal #13323a, teal #2b6670, soft teal #4f8b8a, sage #8db3a9, cream #f1e4c7, red #c5381f, dark red #962b19, orange #e5592a, amber #f08c3d'
// Cada personaje: cómo es, de qué piezas está hecho y los nueve cuadros. Todos son ORIGINALES: nada de personajes
// con derechos (ni sus gorras, letras, bigotes u overoles característicos).
const PERSONAJES = {
  wario: {
    desc: `a friendly original robot assistant: a rounded-square cream (#f1e4c7) head with a dark teal (#13323a) rounded visor, two round sage (#8db3a9) eyes on the visor and a short sage pill-shaped mouth, a thin dark antenna topped by a sage ball, two small orange ear pieces on the sides of the head, a chunky amber-orange (#f08c3d) body with rounded shoulders and a cream circle on the chest with a sage dot, short orange arms with cream round hands`,
    parts: 'head, visor, each eye, mouth, antenna, body, each arm, each hand; eyes and mouth are simple separate shapes on top of the visor',
    framing: 'upper body visible (from the waist up)',
    panels: '1 neutral, looking at the viewer; 2 waving hello with the right hand; 3 thinking, one hand on the chin, eyes looking up; 4 talking, mouth open; 5 happy, eyes as upward arcs, big smile; 6 surprised, round eyes bigger, small round open mouth; 7 typing, both hands down in front as if on a keyboard; 8 celebrating with both arms up; 9 sleepy, eyes as flat lines, head slightly tilted',
  },
  // Chibi: cabeza enorme y cuerpo chiquito, como un títere de recortes de papel. Los cuadros cambian poco a
  // propósito (ojos, boca, un brazo): la animación es de recortes, suave, sin cambiar de cámara.
  pita: {
    desc: `an adorable original chibi character, super-deformed proportions: a huge perfectly round head about as tall as the rest of the body, a tiny rounded body and short stubby arms and legs. Warm tan skin (#e8b48a), a short rounded dark brown bob haircut cut as one simple shape with blunt bangs and a small sage (#8db3a9) leaf-shaped hair clip, two big simple oval black eyes each with one small round cream (#f1e4c7) catchlight, two small round coral (#e5592a) blush circles, a tiny simple mouth, a teal (#2b6670) hoodie with an amber (#f08c3d) round pocket, cream mitten hands, dark teal (#13323a) round shoes`,
    parts: 'head, hair, hair clip, each eye with its catchlight, each blush circle, mouth, body, pocket, each arm, each hand, each leg; the face is a flat circle and the eyes and mouth are simple separate shapes placed on it, like a paper cutout puppet',
    framing: 'full body visible, standing, facing the viewer',
    panels: '1 neutral, small smile; 2 blinking, both eyes as short curved lines; 3 talking, mouth a small open oval; 4 big happy smile, eyes as upward arcs; 5 looking to the left, only the eyes move; 6 waving hello with one hand raised, the rest unchanged; 7 both hands together in front of the chest, as if typing; 8 thinking, one mitten on the chin, eyes looking up; 9 surprised, eyes as bigger round dots and a small round open mouth',
  },
}
const c = PERSONAJES[who]
if (!c) throw new Error(`no conozco a «${who}»: ${Object.keys(PERSONAJES).join(', ')}`)

const prompt = `A character sheet: a 3x3 grid of nine square panels of equal size on a pure flat white background, separated by generous white space, no borders, no text, no letters, no numbers.
The SAME single character in every panel: ${c.desc}.
STYLE: flat cut-paper illustration made only of simple flat shapes, like layered construction paper cut with scissors, as for a simple 2D cutout animation puppet. Every shape is ONE SOLID FLAT COLOR: absolutely no gradients, no shading inside shapes, no texture, no noise, no highlights, no glow, no outlines. Depth only from a small uniform soft drop shadow under each paper layer. Limited palette: ${PALETTE}.
CONSTRUCTION, so it can be rebuilt as SVG and animated: the character is made of clearly separate pieces (${c.parts}); same proportions, same size, same flat front-facing camera and same position centered in every panel, ${c.framing}, nothing overlapping the face.
Panels, left to right, top to bottom: ${c.panels}.`

const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
  body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '1:1' } } }),
})
const data = await r.json()
if (!r.ok) throw new Error(`${r.status}: ${data.error?.message ?? JSON.stringify(data).slice(0, 300)}`)
const part = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)
if (!part) throw new Error(`sin imagen: ${JSON.stringify(data).slice(0, 400)}`)
const buf = Buffer.from(part.inlineData.data, 'base64')
writeFileSync(out, buf)
console.log(`${who}: ${out} (${model}, ${part.inlineData.mimeType}, ${Math.round(buf.length / 1024)} KB)`)
