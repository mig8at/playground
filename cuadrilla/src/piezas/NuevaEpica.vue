<script setup>
import { ref, computed, watch, onUnmounted, nextTick } from 'vue'
import { PERSONAS, REPOS, persona, basesDeRepo } from '../datos.js'
import { miembros, cargarMiembros, personaDe, repos as reposOrg, cargarRepos,
         ramasDeRepo, cargarRamas } from '../sesion.js'
import { trabarFondo } from '../scroll.js'
import Avatar from './Avatar.vue'

const props = defineProps({ abierto: Boolean })
const emit = defineEmits(['crear', 'cerrar'])

const dlg = ref(null)
const inp = ref(null)
const inpRepo = ref(null)

const nombre = ref('')
const devs = ref([])            // ids elegidos, en orden de selección
const elegidos = ref([])        // [{ repo, base }]

const qGente = ref('')
const qRepo = ref('')
const focoGente = ref(false)
const focoRepo = ref(false)
const pendiente = ref(null)     // repo elegido esperando que se le asigne rama

/* ── de dónde salen las listas ─────────────────────────────────────────────────────────────────
   De la organización en GitHub cuando se puede, del roster local cuando no. En gente, cada opción
   lleva el ID con el que se va a guardar: si el login está mapeado en PERSONAS se usa ese id —así
   la persona real y la de mentira son la misma y no aparece duplicada—, y si no, el login crudo. */
const catalogoGente = computed(() => {
  if (miembros.estado === 'listo') {
    return miembros.lista.map(m => ({ id: personaDe(m.login) ?? m.login, nombre: m.nombre, login: m.login }))
  }
  return Object.entries(PERSONAS).map(([id, p]) => ({ id, nombre: p.nombre, login: p.github?.[0] ?? null }))
})
const genteDeGitHub = computed(() => miembros.estado === 'listo')

const catalogoRepos = computed(() =>
  reposOrg.estado === 'listo' ? reposOrg.lista.map(r => r.nombre) : REPOS)
const reposDeGitHub = computed(() => reposOrg.estado === 'listo')

// Las ramas que se ofrecen: las de GitHub si se pudieron traer, si no la lista local. Nunca vacío
// — un selector sin opciones deja a la persona sin salida.
const ramasDe = repo => ramasDeRepo(repo) ?? basesDeRepo(repo)
const ramasSonReales = repo => ramasDeRepo(repo) !== null

/* ── los buscadores ────────────────────────────────────────────────────────────────────────────
   Filtran sobre lo YA no elegido: ofrecer algo que ya está en un chip solo genera el clic que no
   hace nada. El límite de 8 es para que la lista no tape el resto del formulario. */
const sugGente = computed(() => {
  const t = qGente.value.trim().toLowerCase()
  return catalogoGente.value
    .filter(o => !devs.value.includes(o.id))
    .filter(o => !t || o.nombre.toLowerCase().includes(t) || (o.login ?? '').toLowerCase().includes(t))
    .slice(0, 8)
})

const sugRepos = computed(() => {
  const t = qRepo.value.trim().toLowerCase()
  return catalogoRepos.value
    .filter(r => !elegidos.value.some(x => x.repo === r))
    .filter(r => !t || r.toLowerCase().includes(t))
    .slice(0, 8)
})

const MOTIVOS = {
  sinSesion:         'Entrá con GitHub para ver los datos reales.',
  sinPermisoDeOrg:   'La organización todavía no le dio acceso a la app.',
  sinPermisoDeRepos: 'GitHub no devolvió repos: son privados y esta app no tiene permiso de lectura.',
  sinAcceso:         'Tu cuenta no ve esto en GitHub.',
  sinServer:         'Sin server de sesión.',
  error:             'GitHub no respondió.',
}

/* ── elegir ────────────────────────────────────────────────────────────────────────────────── */
function agregarDev(o){
  devs.value = [...devs.value, o.id]
  qGente.value = ''
  inp.value?.focus()
}
const quitarDev = id => { devs.value = devs.value.filter(x => x !== id) }

// El repo NO entra como chip al elegirlo: primero pide la rama. Un chip sin base sería un repo
// declarado sin decir de dónde sale, que es justo lo que este campo tiene que evitar.
function elegirRepo(r){
  cargarRamas(r)
  pendiente.value = r
  qRepo.value = ''
  focoRepo.value = false
}

function confirmarRama(rama){
  elegidos.value = [...elegidos.value, { repo: pendiente.value, base: rama }]
  pendiente.value = null
  nextTick(() => inpRepo.value?.focus())
}
const cancelarRepo = () => { pendiente.value = null }
const quitarRepo = repo => { elegidos.value = elegidos.value.filter(x => x.repo !== repo) }

const listo = computed(() =>
  nombre.value.trim().length > 0 && devs.value.length > 0 && elegidos.value.length > 0)

const falta = computed(() => {
  if (!nombre.value.trim()) return 'Falta el nombre'
  if (!devs.value.length) return 'Falta elegir a alguien'
  if (pendiente.value) return `Elegí la rama de ${pendiente.value}`
  if (!elegidos.value.length) return 'Falta elegir al menos un repo'
  return ''
})

watch(() => props.abierto, async (v) => {
  trabarFondo(v)
  if (v) {
    cargarMiembros()          // sin await: el modal abre ya y las listas se reemplazan al llegar
    cargarRepos()
    nombre.value = ''
    devs.value = []
    elegidos.value = []
    qGente.value = ''
    qRepo.value = ''
    pendiente.value = null
    dlg.value?.showModal()
    await new Promise(r => requestAnimationFrame(r))
    inp.value?.focus()
  } else {
    dlg.value?.close()
  }
})

onUnmounted(() => { if (props.abierto) trabarFondo(false) })

function crear(){
  if (!listo.value || pendiente.value) return
  emit('crear', nombre.value.trim(), [...devs.value], elegidos.value.map(x => ({ ...x })))
}
</script>

<template>
  <!-- @close cubre el Esc del navegador, que cierra el <dialog> sin pasar por nuestro botón. -->
  <dialog ref="dlg" @close="emit('cerrar')" @cancel.prevent="emit('cerrar')">
    <div class="d-head">
      <h2>Nueva épica</h2>
      <p>Qué es, quiénes se le montan, y en qué repos se toca — cada uno desde su rama.</p>
    </div>

    <div class="d-body">
      <div class="campo">
        <label for="nom">Nombre de la épica</label>
        <input id="nom" v-model="nombre" type="text" autocomplete="off"
               placeholder="Ej: Onboarding con país como dato" @keydown.enter="crear">
      </div>

      <!-- ── gente ─────────────────────────────────────────────────────────────────────────── -->
      <div class="campo">
        <label for="bgente">
          Desarrolladores involucrados
          <i v-if="genteDeGitHub" class="fuente ok">de la organización</i>
          <i v-else-if="miembros.estado === 'cargando'" class="fuente">buscando…</i>
          <i v-else class="fuente">roster local</i>
        </label>

        <div class="buscador">
          <input id="bgente" ref="inp" v-model="qGente" type="text" autocomplete="off"
                 placeholder="buscá por nombre o usuario de GitHub…"
                 @focus="focoGente = true" @blur="focoGente = false"
                 @keydown.enter.prevent="sugGente.length && agregarDev(sugGente[0])"
                 @keydown.esc.stop="qGente = ''">
          <!-- mousedown.prevent: sin esto el blur del input cierra la lista antes del click. -->
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

        <div v-if="devs.length" class="chips">
          <span v-for="id in devs" :key="id" class="chip-sel" :title="persona(id).nombre">
            <Avatar :quien="id" :tam="18" />
            <span class="c-txt">{{ persona(id).nombre }}</span>
            <button type="button" class="x" title="quitar" @click="quitarDev(id)">×</button>
          </span>
        </div>
        <p v-else class="pista-txt">
          {{ !genteDeGitHub && miembros.estado === 'noDisponible'
              ? (MOTIVOS[miembros.motivo] ?? MOTIVOS.error) + ' Va el roster local.'
              : 'Nadie elegido todavía.' }}
        </p>
      </div>

      <!-- ── repos ─────────────────────────────────────────────────────────────────────────── -->
      <div class="campo">
        <label for="brepo">
          Repos y desde qué rama sale cada uno
          <i v-if="reposDeGitHub" class="fuente ok">de la organización</i>
          <i v-else-if="reposOrg.estado === 'cargando'" class="fuente">buscando…</i>
          <i v-else class="fuente">lista local</i>
        </label>

        <div class="buscador">
          <input id="brepo" ref="inpRepo" v-model="qRepo" type="text" autocomplete="off"
                 :disabled="!!pendiente" placeholder="buscá un repo…"
                 @focus="focoRepo = true" @blur="focoRepo = false"
                 @keydown.enter.prevent="sugRepos.length && elegirRepo(sugRepos[0])"
                 @keydown.esc.stop="qRepo = ''">
          <ul v-if="!pendiente && (focoRepo || qRepo) && sugRepos.length" class="sug" @mousedown.prevent>
            <li v-for="r in sugRepos" :key="r">
              <button type="button" @click="elegirRepo(r)"><span class="mono">{{ r }}</span></button>
            </li>
          </ul>
        </div>

        <!-- El paso intermedio: el repo ya se eligió pero todavía no es un chip. -->
        <div v-if="pendiente" class="pedir-rama">
          <p class="pr-tit">
            <span class="mono">{{ pendiente }}</span> — ¿desde qué rama?
            <button type="button" class="link" @click="cancelarRepo">cancelar</button>
          </p>
          <div class="pr-ramas">
            <button v-for="b in ramasDe(pendiente)" :key="b" type="button" class="opc rama mono"
                    @click="confirmarRama(b)">{{ b }}</button>
          </div>
          <p v-if="!ramasSonReales(pendiente)" class="pista-txt">
            Ramas de la lista local: no se pudieron traer las de GitHub.
          </p>
        </div>

        <div v-if="elegidos.length" class="chips">
          <!-- Repo y rama en el MISMO chip: son un solo dato. El título completo va en `title`
               porque los dos se recortan cuando no entran. -->
          <span v-for="r in elegidos" :key="r.repo" class="chip-sel repo">
            <span class="c-txt mono" :title="r.repo">{{ r.repo }}</span>
            <span class="c-base mono" :title="`sale de ${r.base}`">{{ r.base }}</span>
            <button type="button" class="x" title="quitar" @click="quitarRepo(r.repo)">×</button>
          </span>
        </div>
        <p v-else-if="!pendiente" class="pista-txt">
          {{ !reposDeGitHub && reposOrg.estado === 'noDisponible'
              ? (MOTIVOS[reposOrg.motivo] ?? MOTIVOS.error) + ' Va la lista local.'
              : 'Ningún repo elegido todavía.' }}
        </p>
      </div>
    </div>

    <div class="d-foot">
      <span class="aviso">{{ falta }}</span>
      <button class="ctl" @click="emit('cerrar')">Cancelar</button>
      <button class="primary" :disabled="!listo || !!pendiente" @click="crear">Crear épica</button>
    </div>
  </dialog>
</template>

<style scoped>
/* Anclado arriba y no centrado, igual que el de rama: si la ventana del navegador es más alta que
   la pantalla visible, el centro de la ventana cae fuera de vista. */
dialog{border:1px solid var(--line);border-radius:12px;background:var(--panel);color:var(--page-ink);
  padding:0;width:min(560px,calc(100vw - 32px));max-height:min(80vh,700px);
  margin:max(7vh,20px) auto auto;box-shadow:0 12px 40px rgba(0,0,0,.2)}
dialog::backdrop{background:rgba(0,0,0,.45)}
/* `display` SOLO en [open]: en `dialog` a secas pisa el display:none del navegador y el modal
   queda dibujado al final de la página. */
dialog[open]{display:flex;flex-direction:column;animation:sube .2s cubic-bezier(.2,.9,.3,1.1)}
@keyframes sube{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}

.d-head{padding:17px 19px 0;flex:0 0 auto}
.d-head h2{font-size:16px;font-weight:600;margin:0}
.d-head p{font-size:12.5px;color:var(--page-soft);margin:6px 0 0;line-height:1.5}
.d-body{padding:16px 19px 6px;display:flex;flex-direction:column;gap:18px;overflow-y:auto;flex:1 1 auto}

.campo > label{display:block;font-size:12px;color:var(--page-soft);font-weight:500;margin-bottom:7px}
/* De dónde salió la lista. Va en la etiqueta y no en un aviso aparte: es una propiedad del campo. */
.fuente{float:right;font-weight:400;font-style:normal;color:var(--page-tenue);font-size:11.5px}
.fuente.ok{color:var(--ok)}
input[type=text]{width:100%;font:inherit;font-size:14px;padding:9px 12px;border-radius:8px;
  border:1px solid var(--line);background:var(--page);color:var(--page-ink)}
input[type=text]:focus{outline:none;border-color:var(--line-fuerte)}
input[type=text]:disabled{opacity:.5;cursor:not-allowed}
input::placeholder{color:var(--page-tenue)}
.pista-txt{font-size:11.5px;color:var(--page-tenue);margin:9px 0 0;line-height:1.55}

/* ── buscador con lista ─────────────────────────────────────────────────────────────────────── */
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

/* ── chips elegidos ─────────────────────────────────────────────────────────────────────────── */
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:9px}
.chip-sel{display:inline-flex;align-items:center;gap:6px;padding:3px 3px 3px 4px;border-radius:7px;
  border:1px solid var(--line);background:var(--panel-2);font-size:12.5px;max-width:100%}
.c-txt{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:20ch;
  padding-left:2px;color:var(--page-ink)}
.chip-sel.repo{padding-left:9px}
/* La rama, dentro del mismo chip y a la derecha: es un atributo del repo, no otra etiqueta. */
.c-base{font-size:11px;color:var(--page-soft);background:var(--panel);border:1px solid var(--line);
  border-radius:5px;padding:1px 7px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  max-width:14ch}
.x{background:none;border:none;color:var(--page-tenue);cursor:pointer;font-size:15px;line-height:1;
  padding:0 5px;border-radius:5px}
.x:hover{color:var(--bad);background:var(--soft-bg2)}

/* ── el paso de la rama ─────────────────────────────────────────────────────────────────────── */
.pedir-rama{margin-top:9px;border:1px solid var(--line-fuerte);border-radius:8px;
  background:var(--panel-2);padding:11px 12px;animation:aparece .18s ease-out}
@keyframes aparece{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
.pr-tit{margin:0 0 9px;font-size:12.5px;color:var(--page-soft)}
.pr-tit .mono{color:var(--page-ink);font-weight:500}
.link{background:none;border:none;font:inherit;font-size:11.5px;color:var(--page-soft);
  cursor:pointer;text-decoration:underline;float:right;padding:0}
.link:hover{color:var(--page-ink)}
.pr-ramas{display:flex;flex-wrap:wrap;gap:6px}
.opc.rama{padding:4px 11px;border-radius:6px;border:1px solid var(--line);background:var(--panel);
  cursor:pointer;font:inherit;font-size:12px;color:var(--page-soft);
  transition:border-color .15s,color .15s}
.opc.rama:hover{border-color:var(--page-ink);color:var(--page-ink)}

.d-foot{padding:15px 19px 17px;display:flex;align-items:center;gap:9px;flex:0 0 auto;
  border-top:1px solid var(--line);margin-top:8px}
.aviso{font-size:11.5px;color:var(--page-tenue);margin-right:auto}
</style>
