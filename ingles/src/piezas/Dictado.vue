<script setup>
/* El ejercicio de dictado: suena una palabra del cuento, la escribís, te dice dónde fallaste.
 *
 * Por qué ANTES de transcribir y no en vez de: transcribir con el cuento delante se puede hacer
 * copiando letra por letra sin haber aprendido a escribir nada. Acá no hay de dónde copiar — la
 * única entrada es el sonido, que es justo donde el inglés no se deja deducir.
 *
 * Tres decisiones de ritmo, que son la mitad del ejercicio:
 *
 *  · Acertar NO frena. Se ve el ✓ y sigue sola: parar a celebrar cada acierto convierte una vuelta
 *    de cuarenta palabras en un trámite. Fallar SÍ frena y espera un ⏎, porque la corrección es lo
 *    único que enseña y hay que darle tiempo a que se lea.
 *  · La que fallás VUELVE A SALIR, hasta tres veces. Sin eso el dictado es un examen —te dice lo que
 *    no sabés y se acabó—; con eso es práctica, que era el punto.
 *  · ⏎ con el campo vacío REPITE la palabra en vez de contarla como fallo. No entender lo que sonó
 *    no es el error que este ejercicio quiere medir.
 */
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { callar, decir, hayVoz } from '../voz.js'
import { anotarDictado, dictadoDe, estado } from '../memoria.js'
import { CONJUNTOS, armar, barajar, comparar } from '../dictado.js'

const props = defineProps({ lex: Object, usadas: Object, global: Object })
const emit = defineEmits(['leer'])

const ETIQUETA = {
  core: 'una de las 100',
  nueva: 'palabra nueva',
  frase: 'phrasal verb / expresión',
  sentido: 'acá significa otra cosa',
}

// Sólo para NOMBRARLA en pantalla: el gesto escucha `Alt`, que es la misma tecla en todas partes.
const ALT = /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent) ? '⌥' : 'alt'

const LLAVE = 'ingles.dictado.conjunto'
const conjunto = ref(localStorage.getItem(LLAVE) ?? 'nuevo')
function cambiarConjunto(v) {
  conjunto.value = v
  try { localStorage.setItem(LLAVE, v) } catch { /* sin memoria de la elección, nada más */ }
}

const fuentes = computed(() => ({
  lex: props.lex,
  usadas: props.usadas,
  global: props.global,
  memoria: { vistas: estado.vistas, sabidas: estado.sabidas, dictado: estado.dictado },
}))
const candidatas = computed(() => armar(conjunto.value, fuentes.value))
// Cuántas son ANTES de elegir: son cuarenta y seis o son ciento veinte, y eso decide si te sentás.
const cuantas = computed(() =>
  Object.fromEntries(CONJUNTOS.map(([v]) => [v, armar(v, fuentes.value).length])))

/* ── la vuelta ─────────────────────────────────────────────────────────────────────────────────
   `cola` arranca siendo la lista barajada y CRECE: la que fallás se vuelve a encolar al final. Por
   eso el progreso no puede ser `i / cola.length` —el denominador se movería debajo de los pies—,
   sino cuántas claves distintas quedaron resueltas sobre las que había al principio. */
const fase = ref('listo')     // listo · corriendo · fin
const cola = ref([])
const total = ref(0)
const i = ref(0)
const escrito = ref('')
const veredicto = ref(null)
const registro = ref({})      // clave → { intentos, fallos, ok }
const campo = ref(null)
let tSeguir = null
let tVoz = null

const actual = computed(() => cola.value[i.value] ?? null)
const resueltas = computed(() => Object.values(registro.value).filter((r) => r.ok).length)
const aLaPrimera = computed(() =>
  Object.values(registro.value).filter((r) => r.ok && r.intentos === 1).length)

const fallidas = computed(() => {
  const vistas = new Set()
  return cola.value.filter((f) => {
    if (vistas.has(f.clave)) return false
    vistas.add(f.clave)
    return (registro.value[f.clave]?.fallos ?? 0) > 0
  })
})

// El estado de cada punto de la barra. Los puntos NO llevan texto a propósito: la barra dice cómo
// vas, y decirlo con las palabras escritas sería soplarte las que todavía no salieron.
function estadoDe(f) {
  const r = registro.value[f.clave]
  if (!r) return 'pendiente'
  if (!r.ok) return 'fallo'
  return r.intentos === 1 ? 'limpio' : 'costo'
}

function enfocar() {
  if (fase.value === 'corriendo') nextTick(() => campo.value?.focus())
}

const LENTO = 0.5

function repetir(rate) {
  if (actual.value) decir(actual.value.respuesta, { rate })
}

/* ── tocar una tecla muerta ────────────────────────────────────────────────────────────────────
   Repetir la palabra es lo que más se usa acá, y tenerlo sólo en un botón obliga a soltar el
   teclado en mitad de escribir. Shift la repite; Alt la repite lenta.
   ⚠ Y van en el keyUP, no en el keydown, por una razón que rompe la idea obvia: al escribir una
   mayúscula el Shift BAJA antes que la letra, así que dispararlo al bajar haría sonar la palabra
   cada vez que escribís un nombre propio. Mirando el soltar —y anulando si hubo otra tecla en el
   medio— «tocar Shift» y «escribir en mayúscula» se distinguen sin ambigüedad.
   Se escucha en `window` y no en el campo para que siga andando si el foco se fue a un botón. */
const MUERTAS = { Shift: undefined, Alt: LENTO }   // tecla → a qué velocidad repite
let tocada = null

function alBajar(e) {
  // La misma tecla repitiendo por estar sostenida no cuenta como «otra tecla».
  if (e.key in MUERTAS) { if (!e.repeat) tocada = e.key }
  else tocada = null
}

function alSubir(e) {
  if (!(e.key in MUERTAS)) return
  const limpia = tocada === e.key
  tocada = null
  if (limpia) repetir(MUERTAS[e.key])
}

// Soltar el foco de la ventana con la tecla abajo nunca manda su keyup: sin esto queda armada.
const olvidar = () => { tocada = null }

onMounted(() => {
  window.addEventListener('keydown', alBajar)
  window.addEventListener('keyup', alSubir)
  window.addEventListener('blur', olvidar)
})

function empezar(lista) {
  const base = lista ?? candidatas.value
  if (!base.length) return
  cola.value = barajar(base)
  total.value = cola.value.length
  i.value = 0
  registro.value = {}
  escrito.value = ''
  veredicto.value = null
  fase.value = 'corriendo'
  presentar()
}

// Un respiro antes de hablar: encadenada con el ✓ anterior, la voz se pisa con la que venía sonando.
function presentar() {
  enfocar()
  clearTimeout(tVoz)
  tVoz = setTimeout(() => repetir(), 220)
}

function comprobar() {
  if (fase.value !== 'corriendo' || !actual.value) return
  if (veredicto.value) { seguir(); return }            // el ⏎ de después del fallo
  if (!escrito.value.trim()) { repetir(); return }     // ⏎ en blanco: repetir, no fallar
  juzgar(comparar(escrito.value, actual.value.respuesta))
}

// Rendirse cuenta como fallo y muestra la palabra. Sin esta salida, una palabra que no se reconoce
// deja la vuelta trabada y el único camino es escribir cualquier cosa, que ensucia el registro.
function noSe() {
  if (fase.value !== 'corriendo' || !actual.value || veredicto.value) return
  juzgar({ ...comparar(escrito.value, actual.value.respuesta), bien: false })
}

function juzgar(v) {
  veredicto.value = v
  const k = actual.value.clave
  const r = registro.value[k] ?? { intentos: 0, fallos: 0, ok: false }
  registro.value[k] = {
    intentos: r.intentos + 1,
    fallos: r.fallos + (v.bien ? 0 : 1),
    ok: r.ok || v.bien,
  }
  anotarDictado(k, v.bien)
  if (v.bien) tSeguir = setTimeout(seguir, 620)
}

function seguir() {
  clearTimeout(tSeguir)
  const f = actual.value
  const fallo = veredicto.value && !veredicto.value.bien
  // Vuelve a la cola hasta el tercer intento. Después se deja ir: insistir una cuarta vez con la
  // misma palabra no la enseña, y la vuelta se vuelve la historia de una sola palabra.
  if (fallo && f && (registro.value[f.clave]?.intentos ?? 1) < 3) cola.value.push(f)
  veredicto.value = null
  escrito.value = ''
  i.value++
  if (i.value >= cola.value.length) { fase.value = 'fin'; callar(); return }
  presentar()
}

function volverAEmpezar() {
  callar()
  clearTimeout(tSeguir); clearTimeout(tVoz)
  fase.value = 'listo'
}

// La celda de la corrección: la misma columna se pinta distinto arriba que abajo — lo que en tu
// línea sobra, en la de abajo es un hueco, y al revés.
const clase = (p, fila) =>
  p.estado === 'ok' ? 'ok'
  : fila === 'tuyo' ? (p.t ? 'malo' : 'hueco')
  : (p.c ? 'bueno' : 'hueco')

const insistente = computed(() => (actual.value ? dictadoDe(actual.value.clave).mal : 0))

onUnmounted(() => {
  callar()
  clearTimeout(tSeguir); clearTimeout(tVoz)
  window.removeEventListener('keydown', alBajar)
  window.removeEventListener('keyup', alSubir)
  window.removeEventListener('blur', olvidar)
})
</script>

<template>
  <section class="dictado" @click="enfocar">
    <!-- ── antes de empezar ─────────────────────────────────────────────────────────────────── -->
    <template v-if="fase === 'listo'">
      <h1 class="tit">Dictado</h1>
      <p class="intro">
        Suena una palabra del cuento y la escribís. Si fallás, te muestra <b>dónde</b> —letra por
        letra— y esa palabra vuelve a salir más adelante. Es el paso previo a transcribir: con el
        texto delante se puede copiar sin aprender a escribir nada, y acá no hay de dónde copiar.
      </p>

      <div class="ctls">
        <select class="ctl" :value="conjunto" @click.stop @change="cambiarConjunto($event.target.value)">
          <option v-for="[v, t] in CONJUNTOS" :key="v" :value="v" :disabled="!cuantas[v]">
            {{ t }} — {{ cuantas[v] }}
          </option>
        </select>
        <button class="ctl fuerte" :disabled="!candidatas.length || !hayVoz()" @click="empezar()">
          empezar
        </button>
      </div>

      <p v-if="!hayVoz()" class="aviso mal">
        Este navegador no trae sintetizador de voz. Sin voz no hay dictado.
      </p>
      <p v-else-if="!candidatas.length" class="aviso">
        No hay palabras en ese conjunto todavía.
        <template v-if="conjunto === 'flojas'">
          «Las que te vienen costando» sale de lo que consultaste leyendo y de lo que fallaste acá:
          se llena sola con el uso.
        </template>
      </p>
      <p v-else class="aviso">
        Se perdonan las mayúsculas y los espacios de más; el apóstrofo no, que en «don't» es la
        lección. Los separables se escriben pegados —<b>pick up</b>, no «pick ~ up»—.
      </p>
    </template>

    <!-- ── la vuelta ────────────────────────────────────────────────────────────────────────── -->
    <template v-else-if="fase === 'corriendo'">
      <div class="barra">
        <i v-for="(f, n) in cola.slice(0, total)" :key="n" class="punto" :class="estadoDe(f)"></i>
        <span class="cuenta tenue">{{ resueltas }} / {{ total }}</span>
      </div>

      <div class="oir">
        <button class="son" title="repetirla" @click.stop="repetir()">♪</button>
        <button class="ctl" @click.stop="repetir(LENTO)">más lento</button>
        <span class="teclas tenue">
          <kbd>shift</kbd> la repite · <kbd>{{ ALT }}</kbd> más lento
        </span>
        <button class="ctl der" title="dejar la vuelta" @click.stop="volverAEmpezar">salir</button>
      </div>

      <!-- Sin corrector y sin autocompletado, o el navegador contesta el ejercicio por vos: el
           subrayado rojo de Chrome es exactamente la respuesta que estamos preguntando. -->
      <input
        ref="campo" v-model="escrito" class="campo" type="text" lang="en"
        spellcheck="false" autocomplete="off" autocapitalize="off" autocorrect="off"
        :placeholder="veredicto ? '' : 'escribí lo que oíste'"
        :class="{ juzgado: !!veredicto }"
        @click.stop @keydown.enter.prevent="comprobar"
      >

      <div class="ctls">
        <button class="ctl fuerte" @click.stop="comprobar">
          {{ veredicto ? 'seguir' : 'comprobar' }} ⏎
        </button>
        <!-- Las dos sólo mientras la palabra está en juego: con el veredicto en pantalla el ⏎ ya no
             repite nada, sigue — y un cartel que dice lo contrario es peor que no tener cartel. -->
        <button v-if="!veredicto" class="ctl" @click.stop="noSe">no sé</button>
        <span v-if="!veredicto" class="tenue pista">⏎ con el campo vacío la repite</span>
      </div>

      <div v-if="veredicto" class="veredicto" :class="veredicto.bien ? 'bien' : 'mal'">
        <div v-if="!veredicto.bien" class="diff">
          <div class="linea">
            <span class="rot tenue">escribiste</span>
            <span class="celdas">
              <b v-for="(p, n) in veredicto.pasos" :key="n" :class="['c', clase(p, 'tuyo')]">{{ p.t ?? '·' }}</b>
            </span>
          </div>
          <div class="linea">
            <span class="rot tenue">va</span>
            <span class="celdas">
              <b v-for="(p, n) in veredicto.pasos" :key="n" :class="['c', clase(p, 'va')]">{{ p.c ?? '·' }}</b>
            </span>
          </div>
        </div>

        <!-- Una sola línea de cabecera para los dos casos: acertando decía la palabra dos veces,
             una en el ✓ y otra en la ficha. -->
        <div class="ficha">
          <span v-if="veredicto.bien" class="marca">✓</span>
          <span class="en">{{ actual.en }}</span>
          <button class="son" title="Escucharla" @click.stop="repetir()">♪</button>
          <span class="tipo" :data-tipo="actual.tipo">{{ ETIQUETA[actual.tipo] }}</span>
        </div>
        <div class="es">{{ actual.es }}</div>
        <div v-if="actual.nota" class="nota">{{ actual.nota }}</div>
        <div v-if="!veredicto.bien && insistente > 1" class="nota tenue">
          Van {{ insistente }} veces que se te escapa ésta.
        </div>
      </div>
    </template>

    <!-- ── el final ─────────────────────────────────────────────────────────────────────────── -->
    <template v-else>
      <h1 class="tit">Terminaste</h1>
      <p class="intro">
        <b>{{ aLaPrimera }}</b> de {{ total }} a la primera.
        <template v-if="fallidas.length">
          Estas se te escaparon — son las que conviene mirar mientras transcribís.
        </template>
        <template v-else>Ninguna se te escapó. A escribir el cuento.</template>
      </p>

      <div v-if="fallidas.length" class="lista">
        <div v-for="f in fallidas" :key="f.clave" class="fila">
          <span class="en">{{ f.en }}</span>
          <button class="son" title="Escucharla" @click.stop="decir(f.respuesta)">♪</button>
          <span class="es">{{ f.es }}</span>
          <span class="vz">{{ registro[f.clave].fallos }}</span>
        </div>
      </div>

      <div class="ctls">
        <button v-if="fallidas.length" class="ctl fuerte" @click.stop="empezar(fallidas)">
          repetir las {{ fallidas.length }} que fallaste
        </button>
        <button class="ctl" @click.stop="empezar()">otra vuelta</button>
        <button class="ctl" @click.stop="emit('leer')">ir al cuento →</button>
      </div>
    </template>
  </section>
</template>

<style scoped>
/* Mismo ancho y misma caja que la columna de lectura: es la misma página, en otro modo. */
.dictado{max-width:66ch;margin:0 auto;padding:34px 28px 120px}
.tit{font-family:Georgia,"Iowan Old Style",serif;font-size:26px;font-weight:600;
  letter-spacing:-.02em;margin:0 0 14px}
.intro{font-size:13.5px;line-height:1.7;color:var(--page-soft);margin:0 0 20px;max-width:58ch}
.ctls{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:16px 0 0}
.ctl.fuerte{background:var(--invertido-fondo);border-color:var(--invertido-fondo);
  color:var(--invertido-texto)}
.ctl.fuerte:disabled{opacity:.4;cursor:default}
.ctl.der{margin-left:auto}
.pista{font-size:11.5px}
.aviso{max-width:58ch;margin:18px 0 0;padding:9px 12px;border-radius:6px;
  background:var(--soft-bg);border:1px solid var(--line);
  font-size:12.5px;line-height:1.55;color:var(--page-soft)}
.aviso.mal{border-color:var(--nueva);color:var(--nueva)}

/* La barra de puntos: cómo vas, sin decir con qué palabras. */
.barra{display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin-bottom:28px}
.punto{width:7px;height:7px;border-radius:50%;background:var(--line-fuerte);flex:none}
.punto.limpio{background:var(--sentido)}
.punto.costo{background:var(--core)}
.punto.fallo{background:var(--nueva)}
.cuenta{margin-left:auto;font-size:11.5px}

.oir{display:flex;align-items:center;gap:10px;margin-bottom:14px}
.teclas{font-size:11.5px;display:flex;align-items:center;gap:5px}
kbd{font:inherit;font-size:10.5px;padding:1px 5px;border:1px solid var(--line-fuerte);
  border-radius:4px;color:var(--page-soft);background:var(--panel)}
.son{border:0;background:none;color:var(--page-tenue);cursor:pointer;padding:0;line-height:1;
  transition:color .15s}
.son:hover{color:var(--accent)}
.oir .son{font-size:30px;color:var(--page-ink)}

/* El campo con la tipografía de la lectura y grande: lo que se escribe acá es lo mismo que después
   se va a escribir a mano, y en 14px sans no se ve la letra que falta. */
.campo{width:100%;font-family:Georgia,"Iowan Old Style","Times New Roman",serif;font-size:24px;
  padding:10px 14px;border:1px solid var(--line-fuerte);border-radius:8px;
  background:var(--panel);color:var(--page-ink)}
.campo:focus{outline:none;border-color:var(--accent)}
.campo.juzgado{opacity:.55}
.campo::placeholder{font-size:16px;color:var(--page-tenue)}

.veredicto{margin-top:22px;padding:14px 16px;border:1px solid var(--line);border-radius:8px;
  background:var(--soft-bg)}
.veredicto.bien{border-color:var(--sentido)}
.veredicto.mal{border-color:var(--nueva)}
.marca{font-size:16px;color:var(--sentido);line-height:1}

/* Monoespaciada y con celdas del mismo ancho: es lo único que hace que el hueco caiga JUSTO debajo
   de la letra que falta. Con tipografía proporcional las dos líneas se desalinean y la corrección
   deja de señalar nada. */
.diff{display:flex;flex-direction:column;gap:3px;margin-bottom:12px;overflow-x:auto}
.linea{display:flex;align-items:center;gap:10px}
.rot{font-size:11px;width:68px;flex:none;text-align:right}
.celdas{display:flex}
.c{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:19px;font-weight:500;
  width:1.05em;text-align:center;white-space:pre}
.c.ok{color:var(--page-soft)}
.c.malo{color:var(--nueva);background:color-mix(in srgb,var(--nueva) 14%,transparent);border-radius:3px}
.c.bueno{color:var(--sentido);background:color-mix(in srgb,var(--sentido) 14%,transparent);
  border-radius:3px}
.c.hueco{color:var(--line-fuerte)}

.ficha{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.ficha .en{font-weight:600;font-size:15px}
.tipo{font-size:10.5px;color:var(--page-tenue);margin-left:auto}
.tipo[data-tipo="nueva"]{color:var(--nueva)}
.tipo[data-tipo="frase"]{color:var(--frase)}
.tipo[data-tipo="sentido"]{color:var(--sentido)}
.es{font-size:13.5px;line-height:1.5;margin-top:3px}
.nota{font-size:12px;line-height:1.5;color:var(--page-soft);margin-top:5px}

.lista{margin-top:6px}
.fila{display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--line)}
.fila .en{font-weight:600;font-size:13.5px;min-width:9em}
.fila .es{font-size:12.5px;color:var(--page-soft);flex:1;min-width:0}
.vz{font-size:11px;color:var(--nueva);background:var(--soft-bg2);border-radius:9px;padding:1px 7px}
</style>
