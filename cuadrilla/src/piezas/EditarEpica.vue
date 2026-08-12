<script setup>
import { ref, computed, watch, onUnmounted, nextTick } from 'vue'
import { PERSONAS, REPOS, persona, basesDeRepo, nombresDeRepos,
         renombrarEpica, sumarDev, sacarDev, sumarRepo, sacarRepo } from '../datos.js'
import { miembros, cargarMiembros, personaDe, repos as reposOrg, cargarRepos,
         ramasDeRepo, cargarRamas } from '../sesion.js'
import { trabarFondo } from '../scroll.js'
import Avatar from './Avatar.vue'

/* Editar el contrato de una épica. Cada cambio se aplica AL TOQUE contra el server, no al cerrar:
   el API ya tiene un endpoint por operación, así que juntar todo y hacer un diff al final sería
   escribir código para deshacer lo que el API ya sabe hacer. Además desaparece la duda de qué pasa
   si cerrás con la ✕ — no hay borrador que perder. */
const props = defineProps({
  abierto: Boolean,
  epica:   { type: Object, required: true },
})
const emit = defineEmits(['cerrar'])

const dlg = ref(null)
const inpNombre = ref(null)
const inpRepo = ref(null)

const nombre = ref('')
const qGente = ref('')
const qRepo = ref('')
const focoGente = ref(false)
const focoRepo = ref(false)
const pendiente = ref(null)
const error = ref(null)

const catalogoGente = computed(() => {
  if (miembros.estado === 'listo') {
    return miembros.lista.map(m => ({ id: personaDe(m.login) ?? m.login, nombre: m.nombre, login: m.login }))
  }
  return Object.entries(PERSONAS).map(([id, p]) => ({ id, nombre: p.nombre, login: p.github?.[0] ?? null }))
})
const catalogoRepos = computed(() =>
  reposOrg.estado === 'listo' ? reposOrg.lista.map(r => r.nombre) : REPOS)

const sugGente = computed(() => {
  const t = qGente.value.trim().toLowerCase()
  return catalogoGente.value
    .filter(o => !props.epica.devs.includes(o.id))
    .filter(o => !t || o.nombre.toLowerCase().includes(t) || (o.login ?? '').toLowerCase().includes(t))
    .slice(0, 8)
})
const sugRepos = computed(() => {
  const t = qRepo.value.trim().toLowerCase()
  const ya = nombresDeRepos(props.epica)
  return catalogoRepos.value.filter(r => !ya.includes(r))
    .filter(r => !t || r.toLowerCase().includes(t)).slice(0, 8)
})

const ramasDe = repo => ramasDeRepo(repo) ?? basesDeRepo(repo)

// Cuántas ramas se llevaría puestas sacar un repo. Se avisa ANTES, no después.
const ramasDelRepo = repo => props.epica.ramas.filter(r => r.repo === repo).length

async function conError(fn){
  error.value = null
  try { await fn() } catch (e) { error.value = e.message }
}

const guardarNombre = () => {
  const n = nombre.value.trim()
  if (!n || n === props.epica.nombre) { nombre.value = props.epica.nombre; return }
  conError(() => renombrarEpica(props.epica, n))
}

const agregarDev = o => conError(async () => {
  await sumarDev(props.epica, o.id)
  qGente.value = ''
})

const quitarDev = quien => conError(() => sacarDev(props.epica, quien))

function elegirRepo(r){
  cargarRamas(r)
  pendiente.value = r
  qRepo.value = ''
  focoRepo.value = false
}

const confirmarRama = rama => conError(async () => {
  await sumarRepo(props.epica, pendiente.value, rama)
  pendiente.value = null
  nextTick(() => inpRepo.value?.focus())
})

const quitarRepo = repo => conError(async () => {
  const n = ramasDelRepo(repo)
  if (n && !confirm(`Sacar ${repo} también borra ${n === 1 ? 'su rama' : `sus ${n} ramas`} de la épica. ¿Seguro?`)) return
  await sacarRepo(props.epica, repo)
})

watch(() => props.abierto, async (v) => {
  trabarFondo(v)
  if (v) {
    cargarMiembros()
    cargarRepos()
    nombre.value = props.epica.nombre
    qGente.value = ''
    qRepo.value = ''
    pendiente.value = null
    error.value = null
    dlg.value?.showModal()
    await new Promise(r => requestAnimationFrame(r))
    inpNombre.value?.focus()
  } else {
    dlg.value?.close()
  }
})

onUnmounted(() => { if (props.abierto) trabarFondo(false) })
</script>

<template>
  <dialog ref="dlg" @close="emit('cerrar')" @cancel.prevent="emit('cerrar')">
    <div class="d-head">
      <h2>Editar épica</h2>
      <p>Cada cambio se guarda al momento. No hay que confirmar nada al final.</p>
    </div>

    <div class="d-body">
      <div class="campo">
        <label for="enom">Nombre</label>
        <input id="enom" ref="inpNombre" v-model="nombre" type="text" autocomplete="off"
               @blur="guardarNombre" @keydown.enter="guardarNombre">
        <p class="pista-txt">
          La URL <span class="mono">/epica/{{ epica.id }}</span> no cambia: los links que ya se
          compartieron siguen funcionando.
        </p>
      </div>

      <div class="campo">
        <label for="egente">Desarrolladores</label>
        <div class="buscador">
          <input id="egente" v-model="qGente" type="text" autocomplete="off"
                 placeholder="agregar a alguien…"
                 @focus="focoGente = true" @blur="focoGente = false"
                 @keydown.enter.prevent="sugGente.length && agregarDev(sugGente[0])">
          <ul v-if="(focoGente || qGente) && sugGente.length" class="sug" @mousedown.prevent>
            <li v-for="o in sugGente" :key="o.id">
              <button type="button" @click="agregarDev(o)">
                <Avatar :quien="o.id" :tam="20" />
                <span class="s-nom">{{ o.nombre }}</span>
                <span v-if="o.login" class="s-sub mono">{{ o.login }}</span>
              </button>
            </li>
          </ul>
        </div>
        <div class="chips">
          <span v-for="id in epica.devs" :key="id" class="chip-sel" :title="persona(id).nombre">
            <Avatar :quien="id" :tam="18" />
            <span class="c-txt">{{ persona(id).nombre }}</span>
            <button type="button" class="x" title="sacar de la épica" @click="quitarDev(id)">×</button>
          </span>
          <span v-if="!epica.devs.length" class="pista-txt">Sin nadie asignado.</span>
        </div>
        <p class="pista-txt">
          Sacar a alguien no borra sus ramas ni su documentación: lo que ya hizo sigue siendo parte
          de la épica.
        </p>
      </div>

      <div class="campo">
        <label for="erepo">Repos y su rama base</label>
        <div class="buscador">
          <input id="erepo" ref="inpRepo" v-model="qRepo" type="text" autocomplete="off"
                 :disabled="!!pendiente" placeholder="agregar un repo…"
                 @focus="focoRepo = true" @blur="focoRepo = false"
                 @keydown.enter.prevent="sugRepos.length && elegirRepo(sugRepos[0])">
          <ul v-if="!pendiente && (focoRepo || qRepo) && sugRepos.length" class="sug" @mousedown.prevent>
            <li v-for="r in sugRepos" :key="r">
              <button type="button" @click="elegirRepo(r)"><span class="mono">{{ r }}</span></button>
            </li>
          </ul>
        </div>

        <div v-if="pendiente" class="pedir-rama">
          <p class="pr-tit">
            <span class="mono">{{ pendiente }}</span> — ¿desde qué rama?
            <button type="button" class="link" @click="pendiente = null">cancelar</button>
          </p>
          <div class="pr-ramas">
            <button v-for="b in ramasDe(pendiente)" :key="b" type="button" class="rama mono"
                    @click="confirmarRama(b)">{{ b }}</button>
          </div>
        </div>

        <div class="chips">
          <span v-for="r in epica.repos" :key="r.repo" class="chip-sel repo">
            <span class="c-txt mono" :title="r.repo">{{ r.repo }}</span>
            <span class="c-base mono" :title="`sale de ${r.base}`">{{ r.base }}</span>
            <button type="button" class="x" title="sacar de la épica" @click="quitarRepo(r.repo)">×</button>
          </span>
          <span v-if="!epica.repos.length" class="pista-txt">Sin repos declarados.</span>
        </div>
      </div>
    </div>

    <div class="d-foot">
      <span class="aviso error">{{ error }}</span>
      <button class="primary" @click="emit('cerrar')">Listo</button>
    </div>
  </dialog>
</template>

<style scoped>
dialog{border:1px solid var(--line);border-radius:12px;background:var(--panel);color:var(--page-ink);
  padding:0;width:min(560px,calc(100vw - 32px));max-height:min(80vh,700px);
  margin:max(7vh,20px) auto auto;box-shadow:0 12px 40px rgba(0,0,0,.2)}
dialog::backdrop{background:rgba(0,0,0,.45)}
/* `display` SOLO en [open]: en `dialog` a secas pisa el display:none del navegador. */
dialog[open]{display:flex;flex-direction:column;animation:sube .2s cubic-bezier(.2,.9,.3,1.1)}
@keyframes sube{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}

.d-head{padding:17px 19px 0;flex:0 0 auto}
.d-head h2{font-size:16px;font-weight:600;margin:0}
.d-head p{font-size:12.5px;color:var(--page-soft);margin:6px 0 0;line-height:1.5}
.d-body{padding:16px 19px 6px;display:flex;flex-direction:column;gap:18px;overflow-y:auto;flex:1 1 auto}

.campo > label{display:block;font-size:12px;color:var(--page-soft);font-weight:500;margin-bottom:7px}
input[type=text]{width:100%;font:inherit;font-size:14px;padding:9px 12px;border-radius:8px;
  border:1px solid var(--line);background:var(--page);color:var(--page-ink)}
input[type=text]:focus{outline:none;border-color:var(--line-fuerte)}
input[type=text]:disabled{opacity:.5;cursor:not-allowed}
input::placeholder{color:var(--page-tenue)}
.pista-txt{font-size:11.5px;color:var(--page-tenue);margin:9px 0 0;line-height:1.55}

.buscador{position:relative}
.sug{position:absolute;z-index:5;top:calc(100% + 4px);left:0;right:0;list-style:none;margin:0;
  padding:4px;background:var(--panel);border:1px solid var(--line-fuerte);border-radius:8px;
  box-shadow:0 8px 24px rgba(0,0,0,.18);max-height:230px;overflow-y:auto}
.sug li button{width:100%;display:flex;align-items:center;gap:8px;text-align:left;padding:6px 8px;
  border:none;border-radius:6px;background:none;cursor:pointer;font:inherit;font-size:13px;
  color:var(--page-ink)}
.sug li button:hover{background:var(--soft-bg2)}
.s-nom{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.s-sub{font-size:11px;color:var(--page-tenue)}

.chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:9px;align-items:center}
.chip-sel{display:inline-flex;align-items:center;gap:6px;padding:3px 3px 3px 4px;border-radius:7px;
  border:1px solid var(--line);background:var(--panel-2);font-size:12.5px;max-width:100%}
.chip-sel.repo{padding-left:9px}
.c-txt{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:20ch;padding-left:2px;
  color:var(--page-ink)}
.c-base{font-size:11px;color:var(--page-soft);background:var(--panel);border:1px solid var(--line);
  border-radius:5px;padding:1px 7px;max-width:14ch;overflow:hidden;text-overflow:ellipsis;
  white-space:nowrap}
.x{background:none;border:none;color:var(--page-tenue);cursor:pointer;font-size:15px;line-height:1;
  padding:0 5px;border-radius:5px}
.x:hover{color:var(--bad);background:var(--soft-bg2)}
.chips .pista-txt{margin:0}

.pedir-rama{margin-top:9px;border:1px solid var(--line-fuerte);border-radius:8px;
  background:var(--panel-2);padding:11px 12px}
.pr-tit{margin:0 0 9px;font-size:12.5px;color:var(--page-soft)}
.pr-tit .mono{color:var(--page-ink);font-weight:500}
.link{background:none;border:none;font:inherit;font-size:11.5px;color:var(--page-soft);cursor:pointer;
  text-decoration:underline;float:right;padding:0}
.pr-ramas{display:flex;flex-wrap:wrap;gap:6px}
.rama{padding:4px 11px;border-radius:6px;border:1px solid var(--line);background:var(--panel);
  cursor:pointer;font:inherit;font-size:12px;color:var(--page-soft)}
.rama:hover{border-color:var(--page-ink);color:var(--page-ink)}

.d-foot{padding:15px 19px 17px;display:flex;align-items:center;gap:9px;flex:0 0 auto;
  border-top:1px solid var(--line);margin-top:8px}
.aviso{font-size:11.5px;color:var(--page-tenue);margin-right:auto}
.aviso.error{color:var(--bad)}
</style>
