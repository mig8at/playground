/* La voz que dicta. El navegador ya trae sintetizador: cero dependencias, cero red.
 *
 * ⚠ Y acá elegir la voz NO es una preferencia estética como en una app en inglés — decide si el
 * ejercicio funciona. Dos ejemplos que rompen todo:
 *
 *   · una voz de ESPAÑA distingue /s/ de /θ/, así que lee «caza» distinto de «casa» y te CANTA la
 *     respuesta de todo el bloque de seseo. En Colombia esas dos palabras suenan igual, y que
 *     suenen igual es justamente lo que hace falta practicar;
 *   · una voz ARGENTINA haría lo mismo con «cayó» y «calló» (/ʃ/ contra /ʝ/).
 *
 * Por eso la preferencia es por LOCALE primero y por nombre después: primero México, 419, Estados
 * Unidos y Colombia —todas seseantes y yeístas, como el español de acá—, y España al final, sólo si
 * no hay nada más.
 *
 * Medido en esta máquina el 2026-09-14: 180 voces, 18 en español, repartidas en `es-ES` (Mónica +
 * 8 voces de personaje) y `es-MX` (Paulina + las mismas 8). O sea que acá gana **Paulina**, que es
 * la que corresponde. En una máquina que sólo tenga a Mónica el dictado igual anda, pero los
 * ejercicios de s/c/z se vuelven regalados — la app lo avisa en pantalla en vez de mentir.
 */
import { ref } from 'vue'

/* La elegida vive en un `ref` y no en una variable suelta, y no es preciosismo: el navegador entrega
   las voces EN DIFERIDO —`getVoices()` devuelve una lista vacía en el primer render—, así que una
   función normal contestaría «(la del sistema)» y se quedaría mintiendo para siempre. Acá el nombre
   se muestra en pantalla porque decide si un bloque del ejercicio se puede resolver escuchando, o
   sea que tiene que estar al día. Medido: sin esto el header decía «(la del sistema)» con 18 voces
   en español instaladas. */
export const voz = ref(null)

// Las de verdad, en orden. Son las que macOS instala como voces de lectura, no de personaje.
const BUENAS = /^(Paulina|Mónica|Monica|Jorge|Juan|Diego|Google español|Microsoft (Sabina|Raul|Helena|Dalia|Jorge))/i

/* Las de PERSONAJE que macOS registra con locale español igual que las otras —Grandma, Grandpa,
   Rocko, Flo, Eddy, Reed, Sandy, Shelley—. No son de broma como las inglesas (Zarvox, Bells), pero
   son voces actuadas: para dictar ortografía queremos la más plana que haya. */
const PERSONAJE = /^(Eddy|Flo|Grandma|Grandpa|Reed|Rocko|Sandy|Shelley|Superstar|Bahh|Bells|Boing|Bubbles|Jester|Trinoids|Whisper|Wobble|Zarvox|Buenas noticias|Malas noticias|Burbujas|Campana|Cellos|Organ)/i

// Seseantes y yeístas, como el español de Colombia. España al final a propósito (ver arriba).
const PREFERIDOS = [/^es[-_]MX/i, /^es[-_]419/i, /^es[-_]US/i, /^es[-_]CO/i, /^es[-_]AR/i, /^es/i]

function elegir() {
  const voces = (window.speechSynthesis?.getVoices?.() ?? []).filter((v) => /^es/i.test(v.lang))
  const sanas = voces.filter((v) => !PERSONAJE.test(v.name))
  for (const locale of PREFERIDOS) {
    const grupo = sanas.filter((v) => locale.test(v.lang))
    const elegida = grupo.find((v) => BUENAS.test(v.name)) ?? grupo[0]
    if (elegida) return elegida
  }
  return sanas[0] ?? voces[0] ?? null   // sólo hay de personaje: mejor una actuada que ninguna
}

const vozEspanola = () => voz.value

/* Para comprobarlo desde la consola sin tener que escucharlo. Leen el `ref`, así que en una
   plantilla se actualizan solos cuando el navegador termina de cargar las voces. */
export const vozElegida = () => voz.value?.name ?? '(la del sistema)'

/* ⚠ Si la voz terminó siendo de España, los ejercicios de s/c/z quedan REGALADOS: los lee
   distinguiendo, que es lo que el ejercicio pide que NO pase. La app lo dice en pantalla — un
   ejercicio que se resuelve solo y no avisa es peor que uno que falta. */
export const distingueCeceo = () => /^es[-_]ES/i.test(voz.value?.lang ?? '')

/* Se resuelve al cargar Y cada vez que el navegador avisa. Las dos formas de escuchar el evento
   porque no todos los navegadores soportan las dos, y volver a elegir es idempotente. */
if (typeof window !== 'undefined' && window.speechSynthesis) {
  const refrescar = () => { voz.value = elegir() }
  refrescar()
  window.speechSynthesis.addEventListener?.('voiceschanged', refrescar)
  window.speechSynthesis.onvoiceschanged = refrescar
}

export const hayVoz = () => typeof window !== 'undefined' && !!window.speechSynthesis

function armar(texto, rate = 0.9) {
  const u = new SpeechSynthesisUtterance(String(texto))
  const v = vozEspanola()
  if (v) u.voice = v
  u.lang = v?.lang ?? 'es-MX'
  u.rate = rate   // 0.9: apenas por debajo de lo natural. Es un dictado, no una locución
  return u
}

let turno = 0

export function callar() {
  turno++            // invalida el callback de lo que estuviera sonando
  if (hayVoz()) window.speechSynthesis.cancel()
}

/* Una frase se dicta ENTERA y de un saque, no palabra por palabra, y no es un detalle de comodidad:
   la frase es lo que desambigua. «Tuvo» y «tubo» suenan idénticas sueltas — sólo «ayer ___ suerte»
   dice cuál de las dos es. Un dictado de palabras sueltas en español sería, en media docena de
   casos, imposible de acertar sin adivinar. */
export function decir(texto, { rate, alTerminar } = {}) {
  if (!hayVoz()) return
  callar()
  const mio = turno
  const u = armar(texto, rate)
  u.onend = () => { if (mio === turno) alTerminar?.() }
  u.onerror = () => { if (mio === turno) alTerminar?.() }
  window.speechSynthesis.speak(u)
}
