<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { sesion } from '../sesion.js'

/* El juego de la palabra impostora. Todos reciben la misma palabra menos uno.
   Se dan pistas en el chat y después se vota quién es el raro.

   El estado llega por SSE y NUNCA se calcula acá: el server manda `sala` (público) y `tuPalabra`
   (privado, solo a esa conexión). Si la palabra de cada uno viniera en el estado público, el juego
   se termina abriendo las herramientas del navegador. */
const yo = ref(sessionStorage.getItem('impostor.jugador') ?? null)
const nombre = ref(sesion.yo?.nombre ?? '')
const sala = ref(null)
const palabra = ref(null)
const conectado = ref(false)
const error = ref(null)
const texto = ref('')
const inp = ref(null)
const fondoChat = ref(null)

let es = null

const soyDe = computed(() => sala.value?.jugadores.find(j => j.id === yo.value) ?? null)
const estoy = computed(() => Boolean(soyDe.value))
const fase = computed(() => sala.value?.fase ?? 'lobby')
const res = computed(() => sala.value?.resultado ?? null)
const puedeArrancar = computed(() => (sala.value?.jugadores.length ?? 0) >= 3)

async function pedir(accion, cuerpo = {}){
  error.value = null
  const r = await fetch(`/api/impostor/${accion}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...cuerpo, jugador: yo.value }),
  })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) { error.value = d.error ?? 'algo falló'; return null }
  return d
}

function escuchar(){
  es?.close()
  es = new EventSource(`/api/impostor/eventos?jugador=${encodeURIComponent(yo.value ?? '')}`)
  es.addEventListener('sala', e => {
    sala.value = JSON.parse(e.data)
    conectado.value = true
    // El chat se sigue solo: si hay que bajar a mano para leer la última pista, no es un chat.
    nextTick(() => { if (fondoChat.value) fondoChat.value.scrollTop = fondoChat.value.scrollHeight })
  })
  es.addEventListener('tuPalabra', e => { palabra.value = JSON.parse(e.data).palabra })
  es.onerror = () => { conectado.value = false }   // EventSource reintenta solo
}

async function entrar(){
  if (!nombre.value.trim()) return
  const d = await pedir('entrar', { nombre: nombre.value })
  if (!d) return
  yo.value = d.id
  sessionStorage.setItem('impostor.jugador', d.id)
  escuchar()
}

async function salir(){
  await pedir('salir')
  sessionStorage.removeItem('impostor.jugador')
  yo.value = null
  palabra.value = null
  es?.close()
  es = null
  sala.value = null
}

async function mandar(){
  if (!texto.value.trim()) return
  const d = await pedir('pista', { texto: texto.value })
  if (d) { texto.value = ''; inp.value?.focus() }
}

onMounted(() => { if (yo.value) escuchar(); else fetch('/api/impostor/estado').then(r => r.json()).then(d => { sala.value = d }) })
onUnmounted(() => es?.close())
</script>

<template>
  <div class="juego">
    <div class="tope">
      <div>
        <h1>Impostor</h1>
        <p class="sub">
          Todos reciben la misma palabra menos uno. Den pistas por turnos y después voten quién es
          el raro. <b>El impostor no sabe que lo es</b> — se entera porque las pistas no le cierran.
        </p>
      </div>
      <span class="estado" :class="{ vivo: conectado }">{{ conectado ? 'en vivo' : 'sin conexión' }}</span>
    </div>

    <!-- ── entrar ───────────────────────────────────────────────────────────────────────────── -->
    <div v-if="!estoy" class="entrar">
      <input v-model="nombre" type="text" placeholder="tu nombre" maxlength="24"
             @keydown.enter="entrar">
      <button class="primary" :disabled="!nombre.trim()" @click="entrar">Entrar a la sala</button>
      <p v-if="sala?.jugadores.length" class="hay">
        Ya hay {{ sala.jugadores.length }} esperando: {{ sala.jugadores.map(j => j.nombre).join(', ') }}
      </p>
    </div>

    <template v-else>
      <!-- ── tu palabra ─────────────────────────────────────────────────────────────────────── -->
      <div v-if="palabra" class="tuya">
        <span class="rot">Tu palabra</span>
        <b>{{ palabra }}</b>
        <span class="ojo">no la digas</span>
      </div>

      <div class="tablero">
        <!-- ── jugadores ────────────────────────────────────────────────────────────────────── -->
        <aside class="gente">
          <header>
            <h2>En la sala</h2>
            <span class="n">{{ sala.jugadores.length }}</span>
          </header>
          <ul>
            <li v-for="j in sala.jugadores" :key="j.id"
                :class="{ soyYo: j.id === yo, fuera: !j.conectado }">
              <span class="punto" :class="{ on: j.conectado }"></span>
              <span class="nom">{{ j.nombre }}</span>
              <span v-if="j.id === yo" class="tag">vos</span>
              <span v-if="fase === 'votando' && j.yaVoto" class="tag">votó</span>
              <button v-if="fase === 'votando' && !soyDe.yaVoto" class="votar"
                      @click="pedir('votar', { aQuien: j.id })">votar</button>
              <b v-if="fase === 'revelado' && res" class="votos">
                {{ res.votos.find(v => v.id === j.id)?.n ?? 0 }}
              </b>
            </li>
          </ul>

          <div class="acciones">
            <button v-if="fase === 'lobby'" class="primary" :disabled="!puedeArrancar"
                    @click="pedir('arrancar')">Arrancar</button>
            <button v-if="fase === 'pistas'" class="ctl" @click="pedir('avotar')">A votar</button>
            <button v-if="fase === 'revelado'" class="primary" @click="pedir('reiniciar')">Otra ronda</button>
            <button class="ctl" @click="salir">Salir</button>
          </div>
          <p v-if="fase === 'lobby' && !puedeArrancar" class="pista-txt">
            Con menos de 3 no tiene gracia: el impostor sería obvio.
          </p>
        </aside>

        <!-- ── chat ─────────────────────────────────────────────────────────────────────────── -->
        <section class="chat">
          <header>
            <h2>Pistas</h2>
            <span class="fase">{{
              fase === 'lobby' ? 'esperando que arranque'
              : fase === 'pistas' ? 'dando pistas'
              : fase === 'votando' ? 'votando' : 'revelado' }}</span>
          </header>

          <div ref="fondoChat" class="hilo">
            <p v-if="!sala.pistas.length" class="vacio">
              {{ fase === 'lobby' ? 'Cuando arranque, cada uno escribe una pista de su palabra.'
                                  : 'Todavía nadie dio una pista.' }}
            </p>
            <div v-for="(p, i) in sala.pistas" :key="i" class="pista"
                 :class="{ mia: p.deId === yo }">
              <span class="de">{{ p.de }}</span>
              <span class="txt">{{ p.texto }}</span>
            </div>
          </div>

          <!-- ── revelación ─────────────────────────────────────────────────────────────────── -->
          <div v-if="fase === 'revelado' && res" class="revelado">
            <p class="r-tit" :class="{ acerto: res.acerto }">
              {{ res.acerto ? '✓ Lo cazaron' : '✗ Se salvó' }}
            </p>
            <p class="r-txt">
              El impostor era <b>{{ res.impostor?.nombre }}</b>.
              El grupo tenía <b class="mono">{{ res.palabras?.grupo }}</b> y
              {{ res.impostor?.nombre }} tenía <b class="mono">{{ res.palabras?.impostor }}</b>.
            </p>
          </div>

          <div v-else-if="fase === 'pistas'" class="escribir">
            <input ref="inp" v-model="texto" type="text" maxlength="120"
                   placeholder="una pista, sin decir la palabra…" @keydown.enter="mandar">
            <button class="primary" :disabled="!texto.trim()" @click="mandar">Enviar</button>
          </div>
          <p v-else-if="fase === 'votando'" class="esperando">
            Votando: elegí a alguien en la lista.
            {{ sala.jugadores.filter(j => j.yaVoto).length }} de {{ sala.jugadores.length }} ya votaron.
          </p>
        </section>
      </div>
    </template>

    <p v-if="error" class="err">{{ error }}</p>
    <p class="pie">
      La partida vive en memoria del server: si se reinicia, se corta. Dura minutos y no le sirve a
      nadie mañana, así que no va a SQLite.
    </p>
  </div>
</template>

<style scoped>
.juego{max-width:1000px}
.tope{display:flex;align-items:flex-start;gap:14px;flex-wrap:wrap}
.tope > div{flex:1;min-width:0}
h1{font-size:22px;font-weight:600;margin:0;letter-spacing:-.02em}
.sub{color:var(--page-soft);font-size:13px;margin:7px 0 0;line-height:1.6;max-width:74ch}
.sub b{color:var(--page-ink);font-weight:500}
.estado{font-size:11px;color:var(--page-tenue);display:inline-flex;align-items:center;gap:6px;
  white-space:nowrap}
.estado::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--page-tenue)}
.estado.vivo{color:var(--ok)}
.estado.vivo::before{background:var(--ok)}

.entrar{margin-top:18px;display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.entrar input,.escribir input{font:inherit;font-size:14px;height:34px;padding:0 12px;border-radius:7px;
  border:1px solid var(--line);background:var(--page);color:var(--page-ink);min-width:200px}
.entrar input:focus,.escribir input:focus{outline:none;border-color:var(--line-fuerte)}
.hay{flex:1 0 100%;margin:2px 0 0;font-size:12px;color:var(--page-tenue)}

/* La palabra, grande y sola: es lo único que hay que memorizar antes de empezar a hablar. */
.tuya{margin-top:18px;border:1px solid var(--line-fuerte);border-radius:10px;background:var(--panel-2);
  padding:13px 16px;display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.tuya .rot{font-size:11px;color:var(--page-tenue);text-transform:uppercase;letter-spacing:.06em}
.tuya b{font-size:22px;font-weight:600;letter-spacing:-.02em}
.tuya .ojo{font-size:11px;color:var(--warn);margin-left:auto}

.tablero{margin-top:14px;display:grid;gap:12px;grid-template-columns:230px minmax(0,1fr)}
@media (max-width:760px){ .tablero{grid-template-columns:1fr} }

.gente,.chat{border:1px solid var(--line);border-radius:10px;background:var(--panel);padding:13px 14px}
.gente header,.chat header{display:flex;align-items:baseline;gap:8px;margin-bottom:10px}
h2{font-size:12.5px;font-weight:500;margin:0}
.gente .n,.fase{margin-left:auto;font-size:11px;color:var(--page-tenue)}

.gente ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:1px}
.gente li{display:flex;align-items:center;gap:7px;padding:6px 2px;font-size:12.5px;
  border-bottom:1px solid var(--line)}
.gente li:last-child{border-bottom:none}
.gente li.fuera .nom{color:var(--page-tenue)}
.gente li.soyYo .nom{font-weight:600}
.punto{width:6px;height:6px;border-radius:50%;background:var(--line-fuerte);flex:0 0 auto}
.punto.on{background:var(--ok)}
.nom{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tag{font-size:10px;color:var(--page-tenue);border:1px solid var(--line);border-radius:4px;padding:0 4px}
.votar{font:inherit;font-size:11px;background:none;border:1px solid var(--line);border-radius:5px;
  color:var(--page-soft);cursor:pointer;padding:1px 7px}
.votar:hover{border-color:var(--warn);color:var(--warn)}
.votos{font-size:12px;color:var(--page-ink)}

.acciones{display:flex;gap:7px;margin-top:12px;flex-wrap:wrap}
.pista-txt{font-size:11px;color:var(--page-tenue);margin:8px 0 0;line-height:1.5}

.chat{display:flex;flex-direction:column;min-height:340px}
.hilo{flex:1;overflow-y:auto;max-height:380px;display:flex;flex-direction:column;gap:6px;
  padding-right:2px}
.vacio{margin:0;font-size:12px;color:var(--page-tenue)}
.pista{display:flex;gap:9px;align-items:baseline;font-size:12.5px;padding:6px 9px;border-radius:7px;
  background:var(--soft-bg)}
.pista.mia{background:var(--panel-2);border:1px solid var(--line)}
.pista .de{font-weight:600;color:var(--page-ink);flex:0 0 auto}
.pista .txt{color:var(--page-soft);word-break:break-word}

.escribir{display:flex;gap:7px;margin-top:11px;padding-top:11px;border-top:1px solid var(--line)}
.escribir input{flex:1;min-width:0}
.esperando{margin:11px 0 0;padding-top:11px;border-top:1px solid var(--line);font-size:12px;
  color:var(--page-soft)}

.revelado{margin-top:11px;padding-top:12px;border-top:1px solid var(--line)}
.r-tit{margin:0;font-size:13px;font-weight:600;color:var(--bad)}
.r-tit.acerto{color:var(--ok)}
.r-txt{margin:7px 0 0;font-size:12.5px;color:var(--page-soft);line-height:1.6}
.r-txt b{color:var(--page-ink);font-weight:500}

.err{margin:12px 0 0;font-size:12px;color:var(--bad)}
.pie{margin:20px 0 0;font-size:11px;color:var(--page-tenue);line-height:1.6;max-width:74ch}
</style>
