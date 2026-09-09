<script setup>
import { computed, ref, onMounted, onUnmounted } from 'vue'
import core from '../data/core-100.json'
import { construirLexico, analizar, cobertura } from './lex.js'
import { ver } from './memoria.js'
import Texto from './piezas/Texto.vue'
import Sidebar from './piezas/Sidebar.vue'
import Globo from './piezas/Globo.vue'

/* Las historias se descubren solas. Agregar una es dejar caer un .json en data/historias/ — no hay
   índice que actualizar, y por lo tanto no hay índice que quede viejo. */
const modulos = import.meta.glob('../data/historias/*.json', { eager: true })
const historias = Object.entries(modulos)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, m]) => m.default ?? m)

const RECUERDA = 'ingles.historia'
const elegida = ref(
  historias.find((h) => h.id === localStorage.getItem(RECUERDA))?.id ?? historias[0]?.id
)
const historia = computed(() => historias.find((h) => h.id === elegida.value) ?? historias[0])

const lex = computed(() => construirLexico(core, historia.value))

/* El glosario de TODAS las historias, para la pestaña Repasar. Sin esto el repaso se limita a la
   historia abierta, y al cambiar de historia desaparecen de la lista las palabras que costaron en la
   anterior —medido: 16 consultas contadas, 8 visibles—. Es justo al revés de lo que uno quiere:
   «cuáles me cuestan» no depende de qué esté leyendo ahora, y el sentido del contador es acumular. */
const glosarioGlobal = (() => {
  const todas = new Map()
  for (const h of historias) {
    const l = construirLexico(core, h)
    for (const e of [...l.palabras.values(), ...l.frases.values(), ...l.huecos]) {
      const k = e.en.toLowerCase()
      if (!todas.has(k)) todas.set(k, e)
    }
  }
  return todas
})()
const parrafos = computed(() => analizar(historia.value?.texto, lex.value))
const cob = computed(() => cobertura(parrafos.value, lex.value))

/* Tres niveles y no un interruptor. El del medio es el default y salió de mirar la pantalla: con
   las 100 subrayadas el párrafo es un campo de rayas. El último es la contraparte del hover —
   releer sin ninguna muleta es donde se comprueba si algo se aprendió. */
const MARCAS = [
  ['todas',   'marcar todo'],
  ['nuevo',   'marcar sólo lo nuevo'],
  ['ninguna', 'modo ciego'],
]
const marcas = ref(localStorage.getItem('ingles.marcas') ?? 'nuevo')

// Sólo para NOMBRAR la tecla en la leyenda. El gesto acepta ⌘ y Ctrl en cualquier plataforma, así
// que si esta detección se equivoca lo único que pasa es que el cartel dice la otra.
const TECLA = /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl'
function cambiarMarcas(v) {
  marcas.value = v
  try { localStorage.setItem('ingles.marcas', v) } catch { /* da igual */ }
  cerrar()
}

function elegir(id) {
  elegida.value = id
  try { localStorage.setItem(RECUERDA, id) } catch { /* sin memoria de la elección, nada más */ }
  cerrar()
  window.scrollTo({ top: 0 })
}

/* ── el globo ───────────────────────────────────────────────────────────────────────────────────
   250 ms de espera antes de aparecer, y ES AHÍ donde se cuenta la consulta. Si contara al pasar el
   mouse, cruzar el párrafo con el cursor sumaría treinta y el número dejaría de significar «esta me
   costó». Y al salir, 120 ms de gracia: sin eso el globo se cierra en el camino y nunca se le puede
   dar al botón de audio. */
const globo = ref(null)
let elActual = null   // el <span> del que salió el globo: no hace falta que sea reactivo
let tAbrir = null
let tCerrar = null

const MEDIO_GLOBO = 175   // la mitad del ancho máximo del globo, para no dejarlo salir del borde

function ubicar(el) {
  // getClientRects()[0] y no getBoundingClientRect(): una frase partida en dos líneas devuelve un
  // rectángulo que abarca el ancho del párrafo, y el globo aparecería centrado en la nada — entre
  // el final de una línea y el principio de la otra.
  const r = el.getClientRects()[0] ?? el.getBoundingClientRect()
  const arriba = r.top > 200   // 200 y no 170: con el umbral justo, el globo mordía el header
  // Sin este clamp, una palabra al final del renglón manda medio globo fuera de la ventana.
  const x = Math.min(Math.max(r.left + r.width / 2, MEDIO_GLOBO), window.innerWidth - MEDIO_GLOBO)
  return { x, y: arriba ? r.top : r.bottom, arriba }
}

function entrar({ pz, el, ya }) {
  clearTimeout(tCerrar)
  clearTimeout(tAbrir)
  if (globo.value?.fijo) return
  const abrir = () => {
    elActual = el
    globo.value = { ...ubicar(el), entrada: pz.entrada, clave: pz.clave }
    ver(pz.clave)
  }
  if (ya) abrir()
  else tAbrir = setTimeout(abrir, 250)
}

function salir() {
  clearTimeout(tAbrir)
  if (globo.value?.fijo) return
  tCerrar = setTimeout(() => { globo.value = null }, 120)
}

// Click: lo deja clavado. Es lo que hace que esto funcione con dedo y con teclado, no sólo con mouse.
function fijar({ pz, el }) {
  clearTimeout(tAbrir); clearTimeout(tCerrar)
  const yaEstaba = globo.value?.fijo && globo.value?.clave === pz.clave
  if (yaEstaba) { globo.value = null; return }
  if (!globo.value || globo.value.clave !== pz.clave) ver(pz.clave)
  elActual = el
  globo.value = { ...ubicar(el), entrada: pz.entrada, clave: pz.clave, fijo: true }
}

const cerrar = () => { clearTimeout(tAbrir); clearTimeout(tCerrar); globo.value = null; elActual = null }
const porEscape = (e) => { if (e.key === 'Escape') cerrar() }

/* Al scrollear, el globo SIGUE a su palabra en vez de cerrarse. Cerrarlo era lo primero que hice y
   se sentía mal por una razón concreta: si el mouse ya está quieto encima de la palabra, moverse un
   renglón la mataba y no volvía —sin movimiento no hay `mouseenter`—, así que había que sacar el
   cursor y traerlo de nuevo. Se cierra sólo cuando la palabra de verdad se fue de la pantalla. */
let rafScroll = null
function alScrollear() {
  if (!elActual || !globo.value || rafScroll) return
  rafScroll = requestAnimationFrame(() => {
    rafScroll = null
    if (!elActual || !globo.value) return
    const r = elActual.getClientRects()[0]
    if (!r || r.bottom < 56 || r.top > window.innerHeight - 16) { cerrar(); return }
    globo.value = { ...globo.value, ...ubicar(elActual) }
  })
}

/* El scroll se escucha EN la columna de lectura (`@scroll` en el template) y no en `window` con
   captura: el layout tiene altura fija y la ventana no scrollea nunca, así que hay que escuchar al
   elemento que de verdad se mueve.
   ⚠ Esto último NO está verificado corriendo — se intentó y el navegador de prueba estaba oculto, y
   sin render no emite eventos de scroll ni corre `requestAnimationFrame`. Si fallara, el globo NO
   queda flotando desalineado: al scrollear la palabra sale de debajo del cursor, salta `mouseleave`
   y se cierra igual. A quien sí le importa es al globo CLAVADO con clic, que no tiene ese respaldo. */
onMounted(() => {
  window.addEventListener('keydown', porEscape)
  window.addEventListener('resize', alScrollear)
})
onUnmounted(() => {
  window.removeEventListener('keydown', porEscape)
  window.removeEventListener('resize', alScrollear)
})
</script>

<template>
  <div class="app" @click="cerrar">
    <Sidebar :core="core" :lex="lex" :usadas="cob.usadas" :global="glosarioGlobal" />

    <div class="col">
      <header class="head">
        <select class="ctl" :value="elegida" @change="elegir($event.target.value)">
          <option v-for="h in historias" :key="h.id" :value="h.id">{{ h.titulo }}</option>
        </select>
        <span class="resumen tenue">{{ historia?.resumen }}</span>
        <select class="ctl" :value="marcas" @click.stop @change="cambiarMarcas($event.target.value)">
          <option v-for="[v, t] in MARCAS" :key="v" :value="v">{{ t }}</option>
        </select>
      </header>

      <div class="cuerpo" @scroll.passive="alScrollear" @click.stop>
        <!-- `:key` fuerza a rehacerlo al cambiar de historia: sin eso quedarían abiertas las
             traducciones de los párrafos que estaban abiertos en la historia anterior, por índice. -->
        <Texto
          :key="historia?.id"
          :parrafos="parrafos" :titulo="historia?.titulo" :marcas="marcas"
          :traduccion="historia?.traduccion" :historia-id="historia?.id"
          @entrar="entrar" @salir="salir" @fijar="fijar"
        />

        <p v-if="marcas === 'ninguna'" class="aviso">
          Sin marcas, sin hover y sin español. El <b>▶</b> del margen sí se queda: escuchar el inglés
          no lo traduce, y leer oyendo es ejercicio, no muleta.
        </p>
        <p v-else-if="marcas === 'nuevo'" class="aviso">
          Marcado sólo lo nuevo. Las 100 no se subrayan para no rayar el párrafo entero, pero
          <b>siguen respondiendo al mouse</b>: pasá por encima de cualquier palabra.
          Y en el margen de cada párrafo: <b>es</b> lo muestra en español (o <b>{{ TECLA }}+clic</b>
          sobre el párrafo) y <b>▶</b> lo lee en inglés.
        </p>

        <!-- Sale de comparar el glosario contra el texto: si aparece, es un typo en el JSON, no una
             palabra de más. Vale gritarlo en pantalla porque el fallo sería silencioso. -->
        <p v-if="cob.huerfanas.length" class="aviso mal">
          En el glosario y no en el texto: <b>{{ cob.huerfanas.join(', ') }}</b>.
          Casi siempre es una palabra mal escrita en el .json.
        </p>
      </div>

      <footer class="leyenda">
        <span><i class="m core"></i>una de las 100</span>
        <span><i class="m nueva"></i>palabra nueva</span>
        <span><i class="m frase"></i>phrasal verb / expresión</span>
        <span><i class="m sentido"></i>otro sentido</span>
        <span class="tenue der">clic clava el globo · <b>{{ TECLA }}+clic</b> traduce el párrafo ·
          <b>▶</b> lo lee · Esc cierra</span>
      </footer>
    </div>

    <Globo :globo="globo" />
  </div>
</template>

<style scoped>
/* `minmax(0,1fr)` en las FILAS, no sólo en las columnas. Una fila de grid es `auto` por defecto:
   crece con su contenido aunque el contenedor tenga `height:100%` y `overflow:hidden`, y entonces
   las dos columnas miden 7142px de alto dentro de una ventana de 820 y ningún `overflow-y:auto`
   de adentro tiene qué recortar. Es el mismo mecanismo que el `min-height:0` de más abajo, un
   nivel más arriba — y hay que arreglar los dos: con uno solo, sigue sin scrollear. */
.app{display:grid;grid-template-columns:min(320px,32vw) 1fr;grid-template-rows:minmax(0,1fr);
  height:100%;overflow:hidden}
.col{display:flex;flex-direction:column;min-width:0;min-height:0;height:100%}

.head{display:flex;align-items:center;gap:12px;padding:10px 16px;
  border-bottom:1px solid var(--line);background:var(--panel)}
.resumen{font-size:12px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* `min-height:0` NO es adorno: sin él este bloque no scrollea. Un item flex arranca con
   `min-height:auto`, así que en vez de encogerse al alto disponible y desbordar, crece con su
   contenido —medido acá: 7058px de alto en un panel de 820— y `overflow-y:auto` no tiene nada que
   recortar. El síntoma es que la rueda del mouse no hace nada y el texto de la mitad para abajo
   queda inalcanzable, sin ningún error en consola. */
.cuerpo{flex:1;min-height:0;overflow-y:auto}
.aviso{max-width:62ch;margin:0 auto 28px;padding:9px 12px;border-radius:6px;
  background:var(--soft-bg);border:1px solid var(--line);
  font-size:12.5px;line-height:1.55;color:var(--page-soft)}
.aviso.mal{border-color:var(--nueva);color:var(--nueva)}

.leyenda{display:flex;align-items:center;gap:16px;flex-wrap:wrap;
  padding:8px 16px;border-top:1px solid var(--line);background:var(--panel);
  font-size:11.5px;color:var(--page-soft)}
.leyenda span{display:inline-flex;align-items:center;gap:6px}
.leyenda .der{margin-left:auto}
.m{width:14px;height:0;border-bottom-width:1.5px;display:inline-block}
.m.core{border-bottom:1px dotted var(--core)}
.m.nueva{border-bottom:1.5px dotted var(--nueva)}
.m.frase{border-bottom:1.5px solid var(--frase)}
.m.sentido{border-bottom:1.5px dashed var(--sentido)}

@media (max-width:900px){
  .app{grid-template-columns:1fr;grid-template-rows:auto minmax(0,1fr)}
  .side{max-height:38vh}
}
</style>
