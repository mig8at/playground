<script setup>
import { ref, computed, onMounted } from 'vue'
import * as api from '../api.js'
import { sesion } from '../sesion.js'

/* Panel de tokens personales. Mismo patrón que el «Token MCP» de credibrain: se genera, se muestra
   UNA vez, se lista y se revoca. El texto plano no se guarda en ninguna parte del front —ni en
   localStorage— porque en la base solo queda el hash: si se pierde, se revoca y se hace otro. */
const estado = ref('cargando')   // cargando | listo | sinSesion | error
const tokens = ref([])
const quien = ref(null)
const nota = ref('')
const fresco = ref(null)         // el token recién creado, en texto plano
const copiado = ref(false)
const error = ref(null)

const puede = computed(() => estado.value === 'listo')

async function cargar(){
  try {
    const r = await api.listarTokens()
    tokens.value = r.tokens
    quien.value = r.quien
    estado.value = 'listo'
  } catch (e) {
    estado.value = /401/.test(e.message) || /entrá/.test(e.message) ? 'sinSesion' : 'error'
    error.value = e.message
  }
}
onMounted(cargar)

async function crear(){
  error.value = null
  try {
    const r = await api.crearToken(nota.value)
    fresco.value = r.token
    tokens.value = r.tokens
    nota.value = ''
    copiado.value = false
  } catch (e) { error.value = e.message }
}

async function revocar(id){
  if (!confirm('¿Revocar este token? El agente que lo use deja de poder escribir.')) return
  try { tokens.value = (await api.revocarToken(id)).tokens }
  catch (e) { error.value = e.message }
}

async function copiar(){
  try {
    await navigator.clipboard.writeText(fresco.value)
    copiado.value = true
  } catch { copiado.value = false }   // sin permiso de portapapeles queda el texto a la vista
}
</script>

<template>
  <section class="panel">
    <h3>Tu token</h3>

    <p v-if="estado === 'cargando'" class="nota">Cargando…</p>

    <p v-else-if="estado === 'sinSesion'" class="nota">
      Entrá con GitHub para generar un token. Es personal: el server saca de él quién sos, así que
      lo que escriba tu agente queda a tu nombre y no puede ir a nombre de otro.
    </p>

    <template v-else-if="puede">
      <p class="nota">
        Personal e intransferible. Con él, un agente escribe <b>como vos</b>
        <template v-if="quien"> (<span class="mono">{{ quien }}</span>)</template>.
        Se muestra una sola vez.
      </p>

      <!-- El token recién creado. Va en un bloque aparte y ruidoso porque es la única vez que se
           puede leer: si se cierra la página sin copiarlo, hay que revocarlo y hacer otro. -->
      <div v-if="fresco" class="fresco">
        <p class="f-tit">Copialo ahora — no se vuelve a mostrar</p>
        <div class="f-caja">
          <code class="mono">{{ fresco }}</code>
          <button class="ctl" @click="copiar">{{ copiado ? 'copiado' : 'copiar' }}</button>
        </div>
        <button class="link" @click="fresco = null">ya lo guardé</button>
      </div>

      <div class="crear">
        <input v-model="nota" type="text" placeholder="para qué es (ej: mi laptop)"
               @keydown.enter="crear">
        <button class="primary" @click="crear">Generar token</button>
      </div>

      <ul v-if="tokens.length" class="lista">
        <li v-for="t in tokens" :key="t.id">
          <span class="t-nota">{{ t.nota || 'sin nota' }}</span>
          <span class="t-fecha">creado {{ t.creado }}</span>
          <span class="t-uso" :class="{ nunca: !t.usado }">
            {{ t.usado ? `usado ${t.usado}` : 'nunca usado' }}
          </span>
          <button class="link" @click="revocar(t.id)">revocar</button>
        </li>
      </ul>
      <p v-else class="nota tenue">Todavía no generaste ninguno.</p>
    </template>

    <p v-else class="err">{{ error }}</p>
    <p v-if="error && puede" class="err">{{ error }}</p>
  </section>
</template>

<style scoped>
.panel{border:1px solid var(--line);border-radius:10px;background:var(--panel);padding:15px 16px;
  margin-top:14px}
h3{font-size:13px;font-weight:600;margin:0 0 8px}
.nota{font-size:12.5px;color:var(--page-soft);margin:0;line-height:1.6}
.nota b{color:var(--page-ink);font-weight:500}
.nota.tenue{color:var(--page-tenue);margin-top:11px}
.err{font-size:12px;color:var(--bad);margin:9px 0 0}

.fresco{margin:12px 0 0;border:1px solid var(--warn);border-radius:8px;background:var(--panel-2);
  padding:11px 12px}
.f-tit{margin:0 0 8px;font-size:11.5px;color:var(--warn);font-weight:500}
.f-caja{display:flex;align-items:center;gap:8px}
.f-caja code{flex:1;min-width:0;font-size:11.5px;background:var(--soft-bg2);border-radius:6px;
  padding:7px 9px;overflow-x:auto;white-space:nowrap;color:var(--page-ink)}

.crear{display:flex;gap:7px;margin-top:12px;flex-wrap:wrap}
.crear input{flex:1;min-width:160px;font:inherit;font-size:13px;padding:0 11px;height:32px;
  border-radius:6px;border:1px solid var(--line);background:var(--page);color:var(--page-ink)}
.crear input:focus{outline:none;border-color:var(--line-fuerte)}
.crear input::placeholder{color:var(--page-tenue)}

.lista{list-style:none;margin:13px 0 0;padding:0;display:flex;flex-direction:column;gap:1px;
  border:1px solid var(--line);border-radius:8px;overflow:hidden;background:var(--line)}
.lista li{display:flex;align-items:center;gap:11px;background:var(--panel);padding:8px 12px;
  font-size:12px;flex-wrap:wrap}
.t-nota{color:var(--page-ink);font-weight:500}
.t-fecha,.t-uso{color:var(--page-tenue);font-size:11.5px}
.t-uso.nunca{color:var(--page-tenue);font-style:italic}
.lista .link{margin-left:auto}
.link{background:none;border:none;font:inherit;font-size:11.5px;color:var(--page-soft);
  cursor:pointer;text-decoration:underline;padding:0}
.link:hover{color:var(--page-ink)}
.fresco .link{margin-top:9px;display:inline-block}
</style>
