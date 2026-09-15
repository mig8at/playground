/* Pronunciación. El navegador ya trae un sintetizador — cero dependencias, cero red, y para
   aprender un idioma leer sin oír es media herramienta.
 *
 * Elige una voz en inglés de verdad (`en-*`): sin eso, macOS lee «key» con la voz del sistema en
 * español y suena «kei» a la colombiana, que es peor que no tener audio. */
let cache = null

// Las que suenan bien, en orden. Cubren macOS, Chrome y Windows.
const BUENAS = /^(Samantha|Alex|Daniel|Karen|Moira|Tessa|Rishi|Google US English|Google UK|Microsoft (Zira|David|Aria|Guy))/i

/* ⚠ Y ésta es la razón de ser de este archivo, no una precaución teórica: macOS registra como
   `en-US` un montón de voces de BROMA y de efectos de sonido —Bells, Boing, Zarvox, Bubbles, Bad
   News, Trinoids…— junto a las de verdad. Medido en esta máquina: 41 voces inglesas, y el PRIMER
   `en-US` de la lista es «Albert», una voz caricaturesca. O sea que un `find` por idioma, que es lo
   obvio, tiene toda la pinta de andar y elige un cencerro. Acá anda porque existe Samantha; en otra
   Mac sin ella, sin esta lista, la herramienta leería la historia con campanas. */
const NOVEDAD = /^(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Buenas noticias|Cellos|Good News|Jester|Junior|Kathy|Organ|Pipe Organ|Princess|Superstar|Trinoids|Whisper|Wobble|Zarvox|Deranged|Hysterical|Bruce|Fred|Ralph)/i

function vozInglesa() {
  if (cache) return cache
  const voces = (window.speechSynthesis?.getVoices?.() ?? []).filter((v) => /^en/i.test(v.lang))
  const sanas = voces.filter((v) => !NOVEDAD.test(v.name))
  const us = (lista) => lista.filter((v) => /^en[-_]US/i.test(v.lang))
  cache =
    us(sanas).find((v) => BUENAS.test(v.name)) ??
    sanas.find((v) => BUENAS.test(v.name)) ??
    us(sanas)[0] ??
    sanas[0] ??
    voces[0] ??      // sólo hay de broma: mejor una rara que ninguna en inglés
    null
  return cache
}

// Para poder comprobar desde la consola con qué voz va a leer, sin tener que escucharlo.
export const vozElegida = () => vozInglesa()?.name ?? '(la del sistema)'

// Las voces cargan en diferido en varios navegadores: sin esto la primera pronunciación sale muda.
if (typeof window !== 'undefined' && window.speechSynthesis) {
  window.speechSynthesis.onvoiceschanged = () => { cache = null; vozInglesa() }
}

export const hayVoz = () => typeof window !== 'undefined' && !!window.speechSynthesis

function armar(texto, rate = 0.85) {
  const u = new SpeechSynthesisUtterance(String(texto).replace(/…|~/g, ' '))
  const v = vozInglesa()
  if (v) u.voice = v
  u.lang = v?.lang ?? 'en-US'
  u.rate = rate   // 0.85 por defecto: un poco lento, es para aprender y no para sonar natural
  return u
}

export function callar() {
  turno++            // invalida el callback de lo que estuviera sonando
  if (hayVoz()) window.speechSynthesis.cancel()
}

/* Una palabra o una frase corta: lo del globo y el glosario. El `rate` está abierto por el dictado,
   donde una palabra que no se entiende hay que poder oírla más despacio — es el único lugar donde la
   pronunciación no es un extra sino el enunciado del ejercicio. */
export function decir(texto, { rate } = {}) {
  if (!hayVoz()) return
  callar()
  window.speechSynthesis.speak(armar(texto, rate))
}

/* Chrome CORTA en seco cualquier utterance que pase de unos ~15 segundos. Un párrafo de treinta
   palabras a rate 0.85 ronda los trece, o sea que el problema no es teórico: el párrafo se cortaría
   a la mitad, sin error y sin forma de darse cuenta salvo escuchándolo. Por eso se parte en
   oraciones y se encolan — `speak()` las reproduce en fila y ninguna se acerca al límite.
   Además suena mejor: el sintetizador respira donde hay punto. */
const partirEnOraciones = (t) =>
  String(t).match(/[^.!?]+[.!?]*[”"'’]*\s*/g)?.filter((x) => /\w/.test(x)) ?? [String(t)]

/* `turno` es lo que hace que parar sea parar de verdad. Chrome dispara `onend` también cuando
   cancelás, así que sin este contador el «terminó» de la reproducción vieja llegaría tarde y
   apagaría el botón de la NUEVA — el clásico callback zombi. */
let turno = 0

export function decirParrafo(texto, { alTerminar } = {}) {
  if (!hayVoz()) return
  callar()
  const mio = turno
  const partes = partirEnOraciones(texto)

  partes.forEach((parte, i) => {
    const u = armar(parte)
    if (i === partes.length - 1) {
      u.onend = () => { if (mio === turno) alTerminar?.() }
    }
    u.onerror = () => { if (mio === turno) alTerminar?.() }
    window.speechSynthesis.speak(u)
  })
}
