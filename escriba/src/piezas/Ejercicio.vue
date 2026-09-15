<script setup>
/* El ejercicio: una frase con un hueco, leída en voz alta, y vos escribís lo que va en el hueco.
 *
 * Por qué un hueco y no la frase entera al dictado: porque lo que se está practicando es la
 * ortografía de UNA palabra, y pedir la frase completa mete en la nota todo lo demás —una coma que
 * falta, un dedo que resbaló— hasta que el resultado deja de decir si sabés o no sabés la regla. El
 * hueco recorta el examen justo al tamaño de la pregunta.
 *
 * Y el campo va INLINE, dentro de la frase, con un ancho mínimo fijo: si creciera con la respuesta
 * te estaría soplando cuántas letras tiene, que en «porque / por qué» es media respuesta.
 *
 * El ritmo es el mismo que el del dictado de `ingles`, y por las mismas razones medidas ahí:
 * acertar no frena, fallar sí y espera un ⏎, y la que fallás vuelve a salir hasta tres veces.
 */
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { callar, decir, distingueCeceo, hayVoz, vozElegida } from '../voz.js'
import { anotar, estado, itemDe } from '../memoria.js'
import { armar, barajar, comparar } from '../ejercicio.js'
import Correccion from './Correccion.vue'

const props = defineProps({ reglas: Array })

const OIDO = {
  decide: ['el oído decide acá', 'va'],
  ayuda: ['el oído ayuda a medias', 'regla'],
  no: ['el oído no ayuda: es regla o memoria', 'falla'],
}

// Sólo para NOMBRARLA en pantalla: el gesto escucha `Alt`, que es la misma tecla en todas partes.
const ALT = /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent) ? '⌥' : 'alt'

const LLAVE = 'escriba.conjunto'
const conjunto = ref(localStorage.getItem(LLAVE) ?? 'todo')
function cambiarConjunto(v) {
  conjunto.value = v
  try { localStorage.setItem(LLAVE, v) } catch { /* sin memoria de la elección, nada más */ }
}

const fuentes = computed(() => ({
  reglas: props.reglas,
  memoria: { items: estado.items, sabidos: estado.sabidos },
}))
const candidatas = computed(() => armar(conjunto.value, fuentes.value))
// Las opciones con su cantidad al lado: son once o son ciento siete, y eso decide si te sentás.
const opciones = computed(() => [
  ['todo', 'todas las reglas', armar('todo', fuentes.value).length],
  ...props.reglas.map((r) => [r.id, r.titulo, armar(r.id, fuentes.value).length]),
  ['flojas', 'lo que vas fallando', armar('flojas', fuentes.value).length],
])

/* `cola` arranca siendo la lista barajada y CRECE: la que fallás se vuelve a encolar. Por eso el
   progreso no puede ser `i / cola.length` —el denominador se movería debajo de los pies—, sino
   cuántas claves distintas quedaron resueltas sobre las que había al principio. */
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

const unicas = computed(() => {
  const vistas = new Set()
  return cola.value.slice(0, total.value).filter((f) => !vistas.has(f.clave) && vistas.add(f.clave))
})
const fallidas = computed(() => unicas.value.filter((f) => (registro.value[f.clave]?.fallos ?? 0) > 0))

/* El desglose POR REGLA, que es lo que esta herramienta puede decir y un dictado de palabras no:
   saber que fallaste «tuvo» es saber una palabra; saber que fallás 3 de cada 4 de la tilde
   diacrítica es saber qué estudiar el sábado. Ordenado de peor a mejor, que es el orden accionable. */
const porRegla = computed(() => {
  const m = new Map()
  for (const f of unicas.value) {
    const r = registro.value[f.clave]
    if (!r) continue
    const e = m.get(f.regla) ?? { titulo: f.tituloRegla, bien: 0, total: 0 }
    e.total++
    if (r.ok && r.intentos === 1) e.bien++
    m.set(f.regla, e)
  }
  return [...m.values()].sort((a, b) => a.bien / a.total - b.bien / b.total)
})

function estadoDe(f) {
  const r = registro.value[f.clave]
  if (!r) return 'pendiente'
  if (!r.ok) return 'fallo'
  return r.intentos === 1 ? 'limpio' : 'costo'
}

function enfocar() {
  if (fase.value === 'corriendo') nextTick(() => campo.value?.focus())
}

const LENTO = 0.55
function repetir(rate) {
  if (actual.value) decir(actual.value.dictado, { rate })
}

/* Tocar Shift repite la frase; Alt la repite lenta. Van en el keyUP y no en el keydown: al escribir
   una mayúscula el Shift baja ANTES que la letra, así que dispararlo al bajar haría sonar la frase
   cada vez que empezás una respuesta con mayúscula — que acá pasa seguido, porque varios huecos
   están al principio de la oración. */
const MUERTAS = { Shift: undefined, Alt: LENTO }
let tocada = null

function alBajar(e) {
  if (e.key in MUERTAS) { if (!e.repeat) tocada = e.key }
  else tocada = null
}

function alSubir(e) {
  if (!(e.key in MUERTAS)) return
  const limpia = tocada === e.key
  tocada = null
  if (limpia) repetir(MUERTAS[e.key])
}

const olvidar = () => { tocada = null }

onMounted(() => {
  window.addEventListener('keydown', alBajar)
  window.addEventListener('keyup', alSubir)
  window.addEventListener('blur', olvidar)
})

function empezar(lista) {
  /* El `filter` no es paranoia: un solo hueco vacío en la cola tumba la pantalla ENTERA —el render
     lee `actual.seOye` y revienta—, y lo que se ve no es un error sino la vista anterior congelada,
     que es la peor forma de fallar. Pasó probando. Vale un filtro. */
  const base = (lista ?? candidatas.value).filter(Boolean)
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
  juzgar(comparar(escrito.value, actual.value.va))
}

// Rendirse cuenta como fallo y muestra la respuesta con su regla. Sin esta salida, un ítem que no se
// sabe deja la vuelta trabada y el único camino es escribir cualquier cosa, que ensucia el registro.
function noSe() {
  if (fase.value !== 'corriendo' || !actual.value || veredicto.value) return
  juzgar({ ...comparar(escrito.value, actual.value.va), bien: false })
}

function juzgar(v) {
  veredicto.value = v
  const f = actual.value
  const r = registro.value[f.clave] ?? { intentos: 0, fallos: 0, ok: false }
  registro.value[f.clave] = {
    intentos: r.intentos + 1,
    fallos: r.fallos + (v.bien ? 0 : 1),
    ok: r.ok || v.bien,
  }
  anotar(f.clave, f.regla, v.bien)
  if (v.bien) tSeguir = setTimeout(seguir, 700)
}

function seguir() {
  clearTimeout(tSeguir)
  const f = actual.value
  const fallo = veredicto.value && !veredicto.value.bien
  // Vuelve a la cola hasta el tercer intento. Después se deja ir: insistir una cuarta vez con el
  // mismo ítem no lo enseña, y la vuelta se convierte en la historia de una sola palabra.
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

onUnmounted(() => {
  callar()
  clearTimeout(tSeguir); clearTimeout(tVoz)
  window.removeEventListener('keydown', alBajar)
  window.removeEventListener('keyup', alSubir)
  window.removeEventListener('blur', olvidar)
})
</script>

<template>
  <section class="ejercicio" @click="enfocar">
    <!-- ── antes de empezar ─────────────────────────────────────────────────────────────────── -->
    <template v-if="fase === 'listo'">
      <h1 class="tit">escriba</h1>
      <p class="intro">
        Oís una frase, y en el hueco escribís la palabra que va. Si fallás te muestra dónde —letra
        por letra—, cómo se llama ese error y <b>qué regla lo decide</b>, que es lo único que sirve
        para las próximas doscientas palabras.
      </p>

      <div class="ctls">
        <select class="ctl" :value="conjunto" @click.stop @change="cambiarConjunto($event.target.value)">
          <option v-for="[v, t, n] in opciones" :key="v" :value="v" :disabled="!n">
            {{ t }} — {{ n }}
          </option>
        </select>
        <button class="ctl fuerte" :disabled="!candidatas.length || !hayVoz()" @click="empezar()">
          empezar
        </button>
      </div>

      <p v-if="!hayVoz()" class="aviso mal">
        Este navegador no trae sintetizador de voz, y sin voz no hay dictado.
      </p>
      <p v-else-if="!candidatas.length" class="aviso">
        Ahí no hay nada todavía.
        <template v-if="conjunto === 'flojas'">
          «Lo que vas fallando» se llena solo: aparecen los ítems que fallaste alguna vez y que
          todavía no marcaste como sabidos.
        </template>
      </p>
      <template v-else>
        <p class="aviso">
          Se perdonan las mayúsculas y los espacios de más. La tilde <b>no</b>: acá es la lección.
          Y lo que se escribe es sólo el hueco, no la frase entera.
        </p>
        <!-- Un ejercicio que se resuelve solo y no lo dice es peor que uno que falta. -->
        <p v-if="distingueCeceo()" class="aviso mal">
          Ojo: la única voz en español de esta máquina es de España ({{ vozElegida() }}), y esa
          <b>sí distingue</b> la s de la c y la z. O sea que el bloque «Ese, ce o zeta» te lo va a
          cantar al leerlo. Los otros ocho no se ven afectados.
        </p>
      </template>
    </template>

    <!-- ── la vuelta ────────────────────────────────────────────────────────────────────────── -->
    <!-- `&& actual` para que un estado imposible degrade en vez de dejar la pantalla congelada. -->
    <template v-else-if="fase === 'corriendo' && actual">
      <div class="barra">
        <i v-for="(f, n) in cola.slice(0, total)" :key="n" class="punto" :class="estadoDe(f)"></i>
        <span class="cuenta tenue">{{ resueltas }} / {{ total }}</span>
      </div>

      <div class="oir">
        <button class="son" title="repetir la frase" @click.stop="repetir()">♪</button>
        <button class="ctl" @click.stop="repetir(LENTO)">más lento</button>
        <span class="teclas tenue">
          <kbd>shift</kbd> la repite · <kbd>{{ ALT }}</kbd> más lento
        </span>
        <button class="ctl der" title="dejar la vuelta" @click.stop="volverAEmpezar">salir</button>
      </div>

      <!-- Antes de contestar se dice si escuchar sirve, y nada más. No revela la respuesta —«el
           oído no ayuda» vale para seis de las nueve reglas— pero sí te dice si tiene sentido
           repetir el audio diez veces o si hay que pensar la regla. -->
      <p class="oido" :data-tono="OIDO[actual.seOye]?.[1]">{{ OIDO[actual.seOye]?.[0] }}</p>

      <p class="frase">
        <span>{{ actual.antes }}</span>
        <!-- Sin corrector ni autocompletado: el subrayado rojo del navegador es exactamente la
             respuesta que estamos preguntando. -->
        <input
          ref="campo" v-model="escrito" class="hueco" type="text" lang="es"
          spellcheck="false" autocomplete="off" autocapitalize="off" autocorrect="off"
          :size="Math.max(8, escrito.length + 1)" :class="{ juzgado: !!veredicto }"
          @click.stop @keydown.enter.prevent="comprobar"
        >
        <span>{{ actual.despues }}</span>
      </p>

      <div class="ctls">
        <button class="ctl fuerte" @click.stop="comprobar">
          {{ veredicto ? 'seguir' : 'comprobar' }} ⏎
        </button>
        <button v-if="!veredicto" class="ctl" @click.stop="noSe">no sé</button>
        <span v-if="!veredicto" class="tenue pista">⏎ con el hueco vacío repite la frase</span>
      </div>

      <Correccion v-if="veredicto" :veredicto="veredicto" :ficha="actual" />
      <p v-if="veredicto" class="deQueRegla tenue">
        de <b>{{ actual.tituloRegla }}</b>
        <span v-if="itemDe(actual.clave).mal > 1"> · van {{ itemDe(actual.clave).mal }} veces que se te escapa</span>
      </p>
    </template>

    <!-- ── el final ─────────────────────────────────────────────────────────────────────────── -->
    <template v-else>
      <h1 class="tit">Terminaste</h1>
      <p class="intro">
        <b>{{ aLaPrimera }}</b> de {{ total }} a la primera.
        <template v-if="porRegla.length > 1"> Por regla, de peor a mejor:</template>
      </p>

      <div v-if="porRegla.length > 1" class="reglas">
        <div v-for="r in porRegla" :key="r.titulo" class="rg">
          <span class="nom">{{ r.titulo }}</span>
          <span class="bar"><i :style="{ width: (100 * r.bien / r.total) + '%' }"></i></span>
          <span class="num tenue">{{ r.bien }}/{{ r.total }}</span>
        </div>
      </div>

      <div v-if="fallidas.length" class="lista">
        <div v-for="f in fallidas" :key="f.clave + f.antes" class="fila">
          <span class="va">{{ f.va }}</span>
          <button class="son chico" title="oír la frase" @click.stop="decir(f.dictado)">♪</button>
          <span class="pq">{{ f.porque }}</span>
        </div>
      </div>

      <div class="ctls">
        <button v-if="fallidas.length" class="ctl fuerte" @click.stop="empezar(fallidas)">
          repetir las {{ fallidas.length }} que fallaste
        </button>
        <button class="ctl" @click.stop="empezar()">otra vuelta</button>
        <button class="ctl" @click.stop="volverAEmpezar">cambiar de regla</button>
      </div>
    </template>
  </section>
</template>

<style scoped>
.ejercicio{max-width:64ch;margin:0 auto;padding:34px 28px 120px}
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
.aviso.mal{border-color:var(--falla);color:var(--falla)}

.barra{display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin-bottom:24px}
.punto{width:7px;height:7px;border-radius:50%;background:var(--line-fuerte);flex:none}
.punto.limpio{background:var(--va)}
.punto.costo{background:var(--core,var(--page-tenue))}
.punto.fallo{background:var(--falla)}
.cuenta{margin-left:auto;font-size:11.5px}

.oir{display:flex;align-items:center;gap:10px;margin-bottom:10px}
.son{border:0;background:none;color:var(--page-ink);cursor:pointer;padding:0;line-height:1;
  font-size:30px;transition:color .15s}
.son:hover{color:var(--accent)}
.son.chico{font-size:14px;color:var(--page-tenue)}
.teclas{font-size:11.5px;display:flex;align-items:center;gap:5px}
kbd{font:inherit;font-size:10.5px;padding:1px 5px;border:1px solid var(--line-fuerte);
  border-radius:4px;color:var(--page-soft);background:var(--panel)}

.oido{margin:0 0 18px;font-size:11.5px;color:var(--page-tenue)}
.oido[data-tono="va"]{color:var(--va)}
.oido[data-tono="falla"]{color:var(--page-tenue)}
.oido[data-tono="regla"]{color:var(--regla)}

/* La frase con la tipografía de lectura y grande: es texto para leer, no una etiqueta de formulario. */
.frase{font-family:Georgia,"Iowan Old Style","Times New Roman",serif;font-size:21px;line-height:2;
  margin:0 0 4px}
/* El ancho mínimo es fijo a propósito: si arrancara del tamaño de la respuesta te diría cuántas
   letras tiene, y en «porque / por qué» eso es media respuesta. Crece con lo TUYO, no con lo suyo. */
.hueco{font:inherit;font-size:21px;padding:1px 8px;margin:0 2px;
  border:0;border-bottom:2px solid var(--accent);border-radius:3px 3px 0 0;
  background:var(--soft-bg2);color:var(--page-ink)}
.hueco:focus{outline:none;background:var(--soft-bg)}
.hueco.juzgado{opacity:.55}

.deQueRegla{font-size:11.5px;margin:10px 0 0;text-align:right}

.reglas{display:flex;flex-direction:column;gap:6px;margin:4px 0 22px}
.rg{display:flex;align-items:center;gap:10px;font-size:12.5px}
.rg .nom{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rg .bar{width:110px;height:6px;border-radius:3px;background:var(--soft-bg2);flex:none;overflow:hidden}
.rg .bar i{display:block;height:100%;background:var(--va)}
.rg .num{width:3.2em;text-align:right;flex:none}

.lista{margin-top:6px}
.fila{display:flex;align-items:baseline;gap:9px;padding:8px 0;border-bottom:1px solid var(--line)}
.fila .va{font-weight:600;font-size:13.5px;min-width:7em;flex:none}
.fila .pq{font-size:12.5px;color:var(--page-soft);line-height:1.5}
</style>
