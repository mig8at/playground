<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { pedir, post } from './api.js'
import Telefono from './pasos/Telefono.vue'
import Otp from './pasos/Otp.vue'
import Perfil from './pasos/Perfil.vue'

// EL REGISTRO: tipo del catálogo → componente. Es la única tabla de este frontend y es
// lo que hace que agregar un paso a una plantilla no toque código de flujo. No hay
// ningún `if comercio === …` en toda la app.
const registro = { telefono: Telefono, otp: Otp, perfil: Perfil }

const plantillas = ref([])
const catalogo = ref([])
const proveedores = ref([])
const claves = ref([])
const sol = ref(null)
const eventos = ref([])
const conectado = ref(false)
const error = ref('')
const confirmando = ref(null)
const cajonAbierto = ref(true)
let stream = null

const componenteActual = computed(() => registro[sol.value?.paso_tipo] ?? null)
const puedeReiniciar = computed(() => sol.value && sol.value.paso_actual > 0)

// ── el URL: solo el ID DE LA SOLICITUD ────────────────────────────────────────────
// No lleva el paso. El paso lo contesta el server, así no hay nada en la barra de
// direcciones que se pueda cambiar a mano para saltear una validación. Y sobrevive el
// refresco porque lo que hace falta para reconstruir todo es ese id.

function idDeURL() {
  const m = location.pathname.match(/^\/solicitud\/([0-9a-f]+)/)
  return m ? m[1] : ''
}

onMounted(async () => {
  try {
    ;[plantillas.value, catalogo.value, proveedores.value, claves.value] = await Promise.all([
      pedir('/api/plantillas'),
      pedir('/api/catalogo'),
      pedir('/api/proveedores'),
      pedir('/api/claves'),
    ])
  } catch (e) {
    error.value = e.message
  }
  window.addEventListener('popstate', alCambiarElURL)
  const id = idDeURL()
  if (id) abrir(id)
})

onUnmounted(() => {
  stream?.close()
  window.removeEventListener('popstate', alCambiarElURL)
})

async function crear(p) {
  error.value = ''
  try {
    const s = await post('/api/solicitudes', {
      comercio: p.comercio,
      entidad: p.entidad,
      pais: p.pais,
    })
    escuchar(s.id)
    sol.value = s
    history.pushState({}, '', `/solicitud/${s.id}`)
  } catch (e) {
    error.value = e.message
  }
}

// abrir es también el camino del REFRESCO y el del segundo dispositivo: con el id se
// le pregunta al server en qué paso está y se renderiza eso.
async function abrir(id) {
  error.value = ''
  try {
    const s = await pedir(`/api/solicitudes/${id}`)
    escuchar(id)
    sol.value = s
  } catch (e) {
    error.value = e.message
    history.replaceState({}, '', '/')
  }
}

function soltar() {
  stream?.close()
  stream = null
  sol.value = null
  eventos.value = []
  conectado.value = false
  confirmando.value = null
}

function salir() {
  soltar()
  history.pushState({}, '', '/')
}

// El frontend NO decide el paso siguiente: lo escucha. `paso.avanzado` y
// `solicitud.reiniciada` son lo único que mueve el cursor — así los dos dispositivos
// ven lo mismo sin coordinarse entre ellos.
function escuchar(id) {
  stream?.close()
  eventos.value = []
  stream = new EventSource(`/api/solicitudes/${id}/eventos`)
  stream.onopen = () => (conectado.value = true)
  stream.onerror = () => (conectado.value = false)
  stream.onmessage = (msg) => {
    const ev = JSON.parse(msg.data)
    if (eventos.value.some((e) => e.id === ev.id)) return
    eventos.value.unshift(ev)
    if (!sol.value) return
    if (ev.tipo === 'paso.avanzado' || ev.tipo === 'solicitud.reiniciada') releer()
  }
}

// Al moverse se relee todo del server en vez de parchear el estado local: el server ya
// calcula el paso, la etapa y los valores capturados, y recalcularlos acá sería una
// segunda implementación de la misma regla.
//
// Va con un coalesce de 40ms porque el REPLAY entrega el historial de golpe: sin esto,
// una solicitud con ocho eventos disparaba una relectura por cada `paso.avanzado`
// histórico. El estado final es el mismo; lo que sobraba eran los viajes.
let pendiente = null
function releer() {
  clearTimeout(pendiente)
  pendiente = setTimeout(async () => {
    if (!sol.value) return
    try {
      sol.value = await pedir(`/api/solicitudes/${sol.value.id}`)
    } catch {}
  }, 40)
}

// ── el atrás: reiniciar la solicitud ──────────────────────────────────────────────
// Una sola regla en vez de un undo por componente: vuelve al primer paso, se conserva
// lo tipeado y muere lo verificado. La copia está acá y no en la plantilla a propósito:
// es UN texto: el día que una segunda plantilla necesite otro, pasa a ser dato.

const PREGUNTA = '¿Empezar de nuevo? Vas a poder corregir el número, y el código que ya verificamos deja de valer.'

async function confirmarReinicio() {
  confirmando.value = null
  error.value = ''
  try {
    sol.value = await post(`/api/solicitudes/${sol.value.id}/reiniciar`)
  } catch (e) {
    error.value = e.message
  }
}

// Sin pasos en el URL, el botón del browser sale del flujo en vez de retroceder un
// paso: es la consecuencia directa de no tener historial por pantalla, y evita el
// problema de intentar interceptar una navegación que ya ocurrió.
function alCambiarElURL() {
  const id = idDeURL()
  if (!id) {
    soltar()
    return
  }
  if (!sol.value || sol.value.id !== id) abrir(id)
}

const enlace = computed(() => (sol.value ? `${location.origin}/solicitud/${sol.value.id}` : ''))
</script>

<template>
  <div class="app">
    <header>
      <a href="/" class="marca" @click.prevent="salir">plantillas</a>
      <span v-if="sol" class="estado" :class="{ on: conectado }">
        {{ conectado ? 'en vivo' : 'sin conexión' }}
      </span>
    </header>

    <p v-if="error" class="error banner">{{ error }}</p>

    <main v-if="!sol" class="centro">
      <div class="tarjeta">
        <h2>Solicitud de crédito</h2>
        <p class="ayuda">
          Las etapas las arma el backend. Salen de una fila en SQLite, no del código.
        </p>
        <div v-for="p in plantillas" :key="p.id" class="plantilla">
          <div class="quien">
            <b>{{ p.comercio }} / {{ p.entidad }}</b>
            <span class="pais">{{ p.pais }}</span>
          </div>
          <ol class="listaEtapas">
            <li v-for="e in p.etapas" :key="e.etapa">
              {{ e.titulo }} <span class="pais">{{ e.pasos.join(' + ') }}</span>
            </li>
          </ol>
          <button @click="crear(p)">Empezar</button>
        </div>
      </div>

      <details class="catalogo">
        <summary>el catálogo ({{ catalogo.length }} componentes)</summary>
        <ul>
          <li v-for="c in catalogo" :key="c.tipo">
            <code>{{ c.tipo }}</code> — {{ c.efecto }}
          </li>
        </ul>
      </details>

      <details class="catalogo">
        <summary>los burós: contrato entrada → salida ({{ proveedores.length }})</summary>
        <ul>
          <li v-for="p in proveedores" :key="p.proveedor">
            <b>{{ p.proveedor }}</b> <span class="pais">{{ p.rol }}</span><br />
            <span class="ayuda">
              pide <code>{{ p.entrada.join(', ') }}</code><br />
              devuelve {{ p.salida.length }} claves, entre ellas
              <code>{{ p.salida.slice(0, 4).join(', ') }}</code>
            </span>
          </li>
        </ul>
      </details>

      <details class="catalogo">
        <summary>el diccionario ({{ claves.length }} claves, sin duplicados)</summary>
        <ul>
          <li v-for="c in claves" :key="c.clave">
            <code>{{ c.clave }}</code> · {{ c.tipo }} · {{ c.grupo }} — {{ c.label }}
          </li>
        </ul>
      </details>
    </main>

    <main v-else class="centro">
      <ol class="tira">
        <li
          v-for="(e, i) in sol.etapas"
          :key="e.etapa"
          :class="{
            hecho: i < sol.etapa_actual,
            activo: i === sol.etapa_actual && sol.estado === 'abierta',
          }"
        >
          {{ e.titulo }}
        </li>
      </ol>

      <div class="tarjeta">
        <component
          :is="componenteActual"
          v-if="componenteActual"
          :key="sol.paso_tipo"
          :solicitud="sol.id"
          :pais="sol.pais"
          :valores="sol.valores"
          :inicial="sol.valores?.phone"
        />
        <div v-else-if="sol.estado === 'completada'" class="paso">
          <h3>Solicitud completa</h3>
          <p class="ayuda">Las etapas se terminaron. El server la cerró, no el front.</p>
        </div>
        <p v-else class="error">
          La plantilla pide el paso <code>{{ sol.paso_tipo }}</code> y no está en el registro del
          front.
        </p>

        <button v-if="puedeReiniciar" class="secundario atras" @click="confirmando = true">
          Empezar de nuevo
        </button>
      </div>

      <p class="ayuda pie">
        Segundo dispositivo: abrí <a :href="enlace" target="_blank">este mismo link</a> en otra
        ventana. Refrescá cuando quieras — en el URL va solo el id de la solicitud.
      </p>
    </main>

    <div v-if="confirmando" class="velo">
      <div class="dialogo">
        <h3>{{ PREGUNTA }}</h3>
        <div class="acciones">
          <button class="secundario" @click="confirmando = null">No, seguir</button>
          <button @click="confirmarReinicio">Sí, de nuevo</button>
        </div>
      </div>
    </div>

    <aside v-if="sol" class="cajon" :class="{ abierto: cajonAbierto }">
      <button class="tirador" @click="cajonAbierto = !cajonAbierto">
        eventos de la solicitud · {{ eventos.length }}
        <span>{{ cajonAbierto ? '▾' : '▴' }}</span>
      </button>
      <ul v-if="cajonAbierto" class="eventos">
        <li v-for="ev in eventos" :key="ev.id">
          <code class="tipo">{{ ev.tipo }}</code>
          <span v-if="ev.payload?.codigo_demo" class="codigo">{{ ev.payload.codigo_demo }}</span>
          <span v-else class="payload">{{ JSON.stringify(ev.payload) }}</span>
        </li>
      </ul>
    </aside>
  </div>
</template>

<style>
:root {
  --fondo: #0f1115;
  --panel: #171a21;
  --borde: #262b36;
  --texto: #e6e8ec;
  --suave: #8b93a3;
  --acento: #5b9dff;
  --ok: #43c98b;
  --mal: #ff6b6b;
}
* {
  box-sizing: border-box;
}
body {
  margin: 0;
  background: var(--fondo);
  color: var(--texto);
  font: 15px/1.55 ui-sans-serif, system-ui, -apple-system, sans-serif;
}
code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.9em;
}
a {
  color: var(--acento);
}
.app {
  min-height: 100vh;
  padding-bottom: 180px;
}
header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid var(--borde);
}
.marca {
  font-weight: 500;
  text-decoration: none;
  color: var(--texto);
}
.estado {
  font-size: 12px;
  color: var(--mal);
}
.estado.on {
  color: var(--ok);
}

.centro {
  max-width: 460px;
  margin: 0 auto;
  padding: 36px 20px 0;
}
h2 {
  font-size: 18px;
  margin: 0 0 6px;
}
h3 {
  font-size: 17px;
  margin: 0 0 6px;
}
.ayuda {
  color: var(--suave);
  font-size: 13px;
  margin: 4px 0 16px;
}
.pie {
  text-align: center;
  margin-top: 20px;
}
.error {
  color: var(--mal);
  font-size: 13px;
  margin: 8px 0;
}
.banner {
  max-width: 460px;
  margin: 16px auto 0;
  border: 1px solid var(--mal);
  border-radius: 8px;
  padding: 10px 12px;
}

.tarjeta {
  background: var(--panel);
  border: 1px solid var(--borde);
  border-radius: 12px;
  padding: 24px;
}
.plantilla .quien {
  margin-top: 14px;
}
.pais {
  color: var(--suave);
  font-size: 12px;
  margin-left: 6px;
}
.listaEtapas {
  color: var(--suave);
  font-size: 13px;
  margin: 8px 0 18px;
  padding-left: 20px;
}
.catalogo {
  margin-top: 24px;
  color: var(--suave);
  font-size: 13px;
}
.catalogo ul {
  padding-left: 18px;
}
.catalogo li {
  margin-bottom: 10px;
}
.catalogo code {
  color: var(--acento);
}

.tira {
  display: flex;
  gap: 6px;
  list-style: none;
  padding: 0;
  margin: 0 0 16px;
}
.tira li {
  flex: 1;
  text-align: center;
  font-size: 12px;
  padding: 6px 4px;
  border-radius: 6px;
  background: var(--panel);
  border: 1px solid var(--borde);
  color: var(--suave);
}
.tira li.hecho {
  color: var(--ok);
  border-color: #24503c;
}
.tira li.activo {
  color: var(--texto);
  border-color: var(--acento);
}

.paso {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
input {
  background: #0d1015;
  border: 1px solid var(--borde);
  border-radius: 8px;
  padding: 12px 14px;
  color: var(--texto);
  font: inherit;
  width: 100%;
}
input:focus {
  outline: none;
  border-color: var(--acento);
}
input.otp {
  letter-spacing: 0.4em;
  text-align: center;
  font-size: 20px;
}
button {
  background: var(--acento);
  border: 0;
  border-radius: 8px;
  padding: 12px 16px;
  color: #071019;
  font: inherit;
  font-weight: 500;
  cursor: pointer;
  width: 100%;
}
button:disabled {
  opacity: 0.45;
  cursor: default;
}
button.secundario {
  background: transparent;
  border: 1px solid var(--borde);
  color: var(--suave);
  font-weight: 400;
}
button.atras {
  margin-top: 16px;
}

.velo {
  position: fixed;
  inset: 0;
  background: rgba(9, 11, 15, 0.72);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.dialogo {
  background: var(--panel);
  border: 1px solid var(--borde);
  border-radius: 12px;
  padding: 22px;
  max-width: 380px;
}
.acciones {
  display: flex;
  gap: 10px;
  margin-top: 18px;
}

.cajon {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--panel);
  border-top: 1px solid var(--borde);
  max-height: 46vh;
  display: flex;
  flex-direction: column;
}
.tirador {
  background: transparent;
  border: 0;
  color: var(--suave);
  font-size: 12px;
  text-align: left;
  padding: 10px 20px;
  display: flex;
  justify-content: space-between;
  border-radius: 0;
}
.eventos {
  list-style: none;
  padding: 0 20px 14px;
  margin: 0;
  overflow: auto;
}
.eventos li {
  display: flex;
  gap: 10px;
  align-items: baseline;
  padding: 5px 0;
  border-top: 1px solid var(--borde);
  font-size: 13px;
}
.tipo {
  color: var(--acento);
  white-space: nowrap;
}
.payload {
  color: var(--suave);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.codigo {
  font-family: ui-monospace, Menlo, monospace;
  font-size: 18px;
  letter-spacing: 0.2em;
  color: var(--ok);
}
</style>
