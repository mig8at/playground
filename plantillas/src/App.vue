<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { pedir, post } from './api.js'
import Telefono from './pasos/Telefono.vue'
import Otp from './pasos/Otp.vue'
import Datos from './pasos/Datos.vue'

// EL REGISTRO: tipo del catálogo → componente. Es la única tabla de este frontend
// y es lo que hace que agregar un paso a una plantilla no toque código de flujo.
// No hay ningún `if comercio === …` en toda la app.
const registro = { telefono: Telefono, otp: Otp, datos: Datos }

const plantillas = ref([])
const catalogo = ref([])
const sesion = ref(null)
const pais = ref('')
const eventos = ref([])
const conectado = ref(false)
const error = ref('')
let stream = null

const pasoActual = computed(() => {
  if (!sesion.value || sesion.value.estado !== 'abierta') return null
  return sesion.value.pasos[sesion.value.paso_actual] ?? null
})
const componenteActual = computed(() => registro[pasoActual.value] ?? null)

onMounted(async () => {
  try {
    ;[plantillas.value, catalogo.value] = await Promise.all([
      pedir('/api/plantillas'),
      pedir('/api/catalogo'),
    ])
  } catch (e) {
    error.value = e.message
  }
  // Con `?sesion=<id>` se entra a una sesión que ya existe: es el segundo
  // dispositivo. El replay del SSE le manda todo lo que ya pasó.
  const params = new URLSearchParams(location.search)
  const id = params.get('sesion')
  if (id) unirse(id)
})

onUnmounted(() => stream?.close())

async function crear(p) {
  error.value = ''
  try {
    const s = await post('/api/sesiones', {
      comercio: p.comercio,
      entidad: p.entidad,
      pais: p.pais,
    })
    pais.value = p.pais
    escuchar(s.id)
    sesion.value = s
  } catch (e) {
    error.value = e.message
  }
}

async function unirse(id) {
  error.value = ''
  try {
    const s = await pedir(`/api/sesiones/${id}`)
    escuchar(id)
    sesion.value = s
  } catch (e) {
    error.value = e.message
  }
}

// El frontend NO decide el paso siguiente: lo escucha. `paso.avanzado` llega por
// SSE y es la única cosa que mueve el cursor — así los dos dispositivos ven lo
// mismo sin coordinarse entre ellos.
function escuchar(id) {
  stream?.close()
  eventos.value = []
  stream = new EventSource(`/api/sesiones/${id}/eventos`)
  stream.onopen = () => (conectado.value = true)
  stream.onerror = () => (conectado.value = false)
  stream.onmessage = (msg) => {
    const ev = JSON.parse(msg.data)
    eventos.value.unshift(ev)
    if (ev.tipo === 'paso.avanzado' || ev.tipo === 'sesion.completada') {
      if (sesion.value) {
        sesion.value = {
          ...sesion.value,
          paso_actual: ev.payload.paso_actual ?? sesion.value.paso_actual,
          estado: ev.payload.estado ?? 'completada',
        }
      }
    }
    if (ev.tipo === 'sesion.creada' && !pais.value) pais.value = ev.payload.pais
  }
}

const enlaceSegundo = computed(() =>
  sesion.value ? `${location.origin}${location.pathname}?sesion=${sesion.value.id}` : '',
)

function reiniciar() {
  stream?.close()
  stream = null
  sesion.value = null
  eventos.value = []
  conectado.value = false
  history.replaceState({}, '', location.pathname)
}
</script>

<template>
  <div class="app">
    <header>
      <h1>plantillas</h1>
      <p>
        el backend <b>compone</b> el flujo desde un catálogo cerrado · el front lo renderiza sin
        código por caso · realtime por SSE
      </p>
    </header>

    <p v-if="error" class="error banner">{{ error }}</p>

    <!-- Sin sesión: elegir plantilla. Las dos filas vienen de la BD, no del código. -->
    <section v-if="!sesion" class="elegir">
      <h2>Elegí una plantilla</h2>
      <p class="ayuda">
        Mismo código, secuencias distintas. La diferencia entre estas dos es
        <b>una fila en SQLite</b>.
      </p>
      <div class="tarjetas">
        <button v-for="p in plantillas" :key="p.id" class="tarjeta" @click="crear(p)">
          <b>{{ p.comercio }} / {{ p.entidad }}</b>
          <span class="pais">{{ p.pais }}</span>
          <ol>
            <li v-for="paso in p.pasos" :key="paso">{{ paso }}</li>
          </ol>
        </button>
      </div>

      <details class="catalogo">
        <summary>el catálogo ({{ catalogo.length }} componentes)</summary>
        <ul>
          <li v-for="c in catalogo" :key="c.tipo">
            <code>{{ c.tipo }}</code> — {{ c.efecto }}
          </li>
        </ul>
      </details>
    </section>

    <!-- Con sesión: dos paneles. Izquierda el dispositivo, derecha el operador. -->
    <section v-else class="corriendo">
      <div class="panel">
        <div class="cabecera">
          <h2>dispositivo del cliente</h2>
          <button class="secundario chico" @click="reiniciar">reiniciar</button>
        </div>

        <ol class="tira">
          <li
            v-for="(paso, i) in sesion.pasos"
            :key="paso"
            :class="{
              hecho: i < sesion.paso_actual,
              activo: i === sesion.paso_actual && sesion.estado === 'abierta',
            }"
          >
            {{ paso }}
          </li>
        </ol>

        <component
          :is="componenteActual"
          v-if="componenteActual"
          :key="pasoActual"
          :sesion="sesion.id"
          :pais="pais"
        />
        <div v-else-if="sesion.estado === 'completada'" class="listo">
          <h3>✓ onboarding completo</h3>
          <p class="ayuda">La plantilla se terminó. El server cerró la sesión, no el front.</p>
        </div>
        <p v-else class="error">
          La plantilla pide el paso <code>{{ pasoActual }}</code> y no está en el registro del front.
        </p>
      </div>

      <div class="panel">
        <div class="cabecera">
          <h2>panel del operador</h2>
          <span class="estado" :class="{ on: conectado }">
            {{ conectado ? 'SSE conectado' : 'SSE caído' }}
          </span>
        </div>
        <p class="ayuda">
          Abrí esto en otra ventana para ver el segundo dispositivo — entra a mitad de camino y el
          replay le manda todo lo anterior:<br />
          <a :href="enlaceSegundo" target="_blank"><code>?sesion={{ sesion.id }}</code></a>
        </p>
        <ul class="eventos">
          <li v-for="ev in eventos" :key="ev.id">
            <code class="tipo">{{ ev.tipo }}</code>
            <span v-if="ev.payload?.codigo_demo" class="codigo">{{ ev.payload.codigo_demo }}</span>
            <span v-else class="payload">{{ JSON.stringify(ev.payload) }}</span>
          </li>
        </ul>
      </div>
    </section>
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
  font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, sans-serif;
}
code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.92em;
}
.app {
  max-width: 1100px;
  margin: 0 auto;
  padding: 32px 20px 60px;
}
header h1 {
  margin: 0;
  font-size: 22px;
  letter-spacing: -0.01em;
}
header p {
  margin: 6px 0 26px;
  color: var(--suave);
}
h2 {
  font-size: 15px;
  margin: 0;
}
h3 {
  font-size: 16px;
  margin: 0 0 4px;
}
.ayuda {
  color: var(--suave);
  font-size: 13px;
  margin: 4px 0 14px;
}
.error {
  color: var(--mal);
  font-size: 13px;
  margin: 8px 0;
}
.banner {
  border: 1px solid var(--mal);
  border-radius: 8px;
  padding: 10px 12px;
}

.tarjetas {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
  gap: 12px;
}
.tarjeta {
  text-align: left;
  background: var(--panel);
  border: 1px solid var(--borde);
  border-radius: 10px;
  padding: 14px;
  color: var(--texto);
  cursor: pointer;
  font: inherit;
}
.tarjeta:hover {
  border-color: var(--acento);
}
.tarjeta .pais {
  color: var(--suave);
  margin-left: 6px;
  font-size: 12px;
}
.tarjeta ol {
  margin: 10px 0 0;
  padding-left: 18px;
  color: var(--suave);
}
.catalogo {
  margin-top: 22px;
  color: var(--suave);
}
.catalogo ul {
  padding-left: 18px;
}
.catalogo code {
  color: var(--acento);
}

.corriendo {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
@media (max-width: 820px) {
  .corriendo {
    grid-template-columns: 1fr;
  }
}
.panel {
  background: var(--panel);
  border: 1px solid var(--borde);
  border-radius: 12px;
  padding: 16px;
}
.cabecera {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.estado {
  font-size: 12px;
  color: var(--mal);
}
.estado.on {
  color: var(--ok);
}

.tira {
  display: flex;
  gap: 6px;
  list-style: none;
  padding: 0;
  margin: 0 0 18px;
}
.tira li {
  flex: 1;
  text-align: center;
  font-size: 12px;
  padding: 6px 4px;
  border-radius: 6px;
  background: #12151b;
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
  gap: 10px;
}
.campo {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.campo span {
  font-size: 12px;
  color: var(--suave);
}
input {
  background: #0d1015;
  border: 1px solid var(--borde);
  border-radius: 8px;
  padding: 10px 12px;
  color: var(--texto);
  font: inherit;
}
input:focus {
  outline: none;
  border-color: var(--acento);
}
input.otp {
  letter-spacing: 0.4em;
  text-align: center;
  font-size: 18px;
}
button {
  background: var(--acento);
  border: 0;
  border-radius: 8px;
  padding: 10px 14px;
  color: #071019;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
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
button.chico {
  padding: 5px 10px;
  font-size: 12px;
}
.listo h3 {
  color: var(--ok);
}

.eventos {
  list-style: none;
  padding: 0;
  margin: 0;
  max-height: 340px;
  overflow: auto;
}
.eventos li {
  display: flex;
  gap: 8px;
  align-items: baseline;
  padding: 6px 0;
  border-bottom: 1px solid var(--borde);
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
  font-size: 17px;
  letter-spacing: 0.2em;
  color: var(--ok);
}
a {
  color: var(--acento);
}
</style>
