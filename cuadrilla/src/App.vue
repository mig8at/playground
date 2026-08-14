<script setup>
import { computed, onMounted } from 'vue'
import { EPICAS, laGente, pulso, cargarEpicas } from './datos.js'
import { sesion, cargarSesion, entrar, salir, personaDe } from './sesion.js'
import Pulso from './piezas/Pulso.vue'
import Avatar from './piezas/Avatar.vue'

const p = computed(() => pulso())
const gente = computed(() => laGente().length)

onMounted(() => { cargarSesion(); cargarEpicas() })

// A qué persona del tablero corresponde quien entró. Si su login no está mapeado todavía, se
// muestra igual pero avisando: es el caso que hay que resolver a mano una vez.
const quien = computed(() => (sesion.yo ? personaDe(sesion.yo.login) : null))

const ERRORES = {
  state:  'La vuelta de GitHub no coincidió. Probá de nuevo.',
  token:  'GitHub no devolvió el token. Revisá el client secret.',
  org:    'Tu cuenta no figura como miembro activo de la organización.',
  // Este NO es un problema de la persona: la org restringe OAuth Apps y a esta no le dieron acceso.
  orgapp: 'La organización todavía no le dio acceso a esta app. Aprobala en Settings → Third-party access.',
}

function tema(){
  const r = document.documentElement
  const oscuro = r.getAttribute('data-theme') === 'dark'
    || (!r.getAttribute('data-theme') && matchMedia('(prefers-color-scheme:dark)').matches)
  r.setAttribute('data-theme', oscuro ? 'light' : 'dark')
}
</script>

<template>
  <div class="app">
    <!-- ── el costado ───────────────────────────────────────────────────────────────────────── -->
    <aside class="lado">
      <RouterLink to="/" class="marca">cuadrilla<span class="dot">.</span></RouterLink>

      <nav>
        <RouterLink to="/" class="op">
          <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="1.5" width="5.5" height="5.5" rx="1.4"/><rect x="9" y="1.5" width="5.5" height="5.5" rx="1.4"/><rect x="1.5" y="9" width="5.5" height="5.5" rx="1.4"/><rect x="9" y="9" width="5.5" height="5.5" rx="1.4"/></svg>
          Épicas <i class="n">{{ EPICAS.length }}</i>
        </RouterLink>
        <RouterLink to="/gente" class="op">
          <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="6" cy="5" r="2.6"/><path d="M1.4 14c0-2.6 2-4.3 4.6-4.3s4.6 1.7 4.6 4.3"/><circle cx="12" cy="5.6" r="2"/><path d="M11 9.9c2.1.1 3.6 1.7 3.6 4.1"/></svg>
          Gente <i class="n">{{ gente }}</i>
        </RouterLink>
        <RouterLink to="/revision" class="op">
          <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.3"/><path d="M8 4.3V8l2.5 1.6"/></svg>
          Revisión <i class="n" :class="{ ojo: p.aprobacion }">{{ p.aprobacion }}</i>
        </RouterLink>
        <RouterLink to="/api" class="op">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 5.5 1 8l2 2.5"/><path d="M13 5.5 15 8l-2 2.5"/><path d="M9.6 3.6 6.4 12.4"/></svg>
          API <i class="n">5</i>
        </RouterLink>
        <!-- GAMES va abajo y separado: no es el tablero, es lo que hace que la gente entre. -->
        <span class="grupo">games</span>
        <RouterLink to="/games/impostor" class="op">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.6 14 5v6l-6 3.4L2 11V5Z"/><circle cx="8" cy="8" r="2"/></svg>
          Impostor
        </RouterLink>
      </nav>

      <div class="pie">
        <!-- Cuatro estados, no dos: «entrar» solo se ofrece cuando de verdad se puede entrar. -->
        <div v-if="sesion.estado === 'dentro'" class="yo">
          <Avatar v-if="quien" :quien="quien" :tam="24" />
          <span v-else class="av-anon">{{ sesion.yo.login.slice(0, 2).toUpperCase() }}</span>
          <div class="yo-txt">
            <b>{{ sesion.yo.nombre }}</b>
            <span class="login mono">{{ sesion.yo.login }}</span>
          </div>
          <button class="salir" title="salir" @click="salir">↩</button>
        </div>
        <p v-if="sesion.estado === 'dentro' && !quien" class="sin-mapa">
          Tu login todavía no está atado a nadie del tablero.
        </p>

        <button v-else-if="sesion.estado === 'sinEntrar'" class="ctl entrar" @click="entrar">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 .8a7.2 7.2 0 0 0-2.3 14c.4.1.5-.1.5-.4v-1.3c-2 .4-2.5-.5-2.7-1-.1-.2-.5-.9-.9-1.1-.3-.2-.7-.6 0-.6.6 0 1 .6 1.2.8.7 1.2 1.8.9 2.3.7 0-.5.3-.9.5-1.1-1.8-.2-3.6-.9-3.6-4 0-.9.3-1.6.8-2.2 0-.2-.3-1 .1-2.1 0 0 .7-.2 2.2.8a7.4 7.4 0 0 1 4 0c1.5-1 2.2-.8 2.2-.8.4 1.1.2 1.9.1 2.1.5.6.8 1.3.8 2.2 0 3.1-1.9 3.8-3.6 4 .3.3.6.8.6 1.5v2.2c0 .3.1.5.5.4A7.2 7.2 0 0 0 8 .8Z"/></svg>
          Entrar con GitHub
        </button>

        <p v-else-if="sesion.estado === 'sinConfigurar'" class="aviso-sesion">
          Login apagado: falta la OAuth App. Ver <span class="mono">.env.example</span>.
        </p>
        <p v-else-if="sesion.estado === 'sinServer'" class="aviso-sesion">
          Sin server de sesión. Levantalo con <span class="mono">npm run dev</span>.
        </p>

        <p v-if="sesion.error" class="error-sesion">{{ ERRORES[sesion.error] ?? sesion.error }}</p>

        <button class="ctl" @click="tema">tema</button>
        <p class="mock">Prototipo · datos de mentira</p>
      </div>
    </aside>

    <!-- ── el contenido ─────────────────────────────────────────────────────────────────────── -->
    <!-- La vista va envuelta: Home y Épica tienen VARIOS nodos raíz, y si `.centro` fuera flex con
         gap, cada uno de esos nodos se separaría 18px del siguiente. -->
    <main class="centro">
      <Pulso />
      <div class="vista"><RouterView /></div>
    </main>
  </div>
</template>

<style scoped>
.app{display:grid;grid-template-columns:198px minmax(0,1fr);gap:0;min-height:100vh;
  max-width:1240px;margin:0 auto}

.lado{border-right:1px solid var(--line);padding:22px 14px 22px 16px;
  display:flex;flex-direction:column;gap:20px;position:sticky;top:0;align-self:start;
  height:100vh}
.marca{font-size:17px;font-weight:600;letter-spacing:-.03em;text-decoration:none;
  color:var(--page-ink)}
.marca .dot{color:var(--page-tenue)}

nav{display:flex;flex-direction:column;gap:1px}
.grupo{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--page-tenue);
  padding:14px 9px 5px;border-top:1px solid var(--line);margin-top:12px}
.op{display:flex;align-items:center;gap:9px;padding:7px 9px;border-radius:6px;
  font-size:13.5px;color:var(--page-soft);text-decoration:none;
  transition:background .15s,color .15s}
.op svg{width:15px;height:15px;flex:0 0 auto;fill:none;stroke:currentColor;stroke-width:1.4;
  stroke-linecap:round;stroke-linejoin:round;opacity:.8}
.op:hover{background:var(--soft-bg);color:var(--page-ink)}
/* router-link-exact-active y no -active: sin `exact`, «Épicas» (ruta /) queda encendida siempre. */
.op.router-link-exact-active{background:var(--soft-bg2);color:var(--page-ink);font-weight:500}
.op.router-link-exact-active svg{opacity:1}
.n{margin-left:auto;font-style:normal;font-size:11.5px;color:var(--page-tenue);
  min-width:16px;text-align:right}
.n.ojo{color:var(--warn)}

.pie{margin-top:auto;display:flex;flex-direction:column;gap:10px;align-items:flex-start}
.mock{font-size:11px;color:var(--page-tenue);margin:0;line-height:1.4}

.yo{display:flex;align-items:center;gap:8px;width:100%;min-width:0}
.yo-txt{min-width:0;flex:1}
.yo-txt b{display:block;font-size:12.5px;font-weight:500;line-height:1.3;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.login{display:block;font-size:11px;color:var(--page-tenue);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.av-anon{width:24px;height:24px;border-radius:50%;flex:0 0 auto;display:grid;place-items:center;
  font-size:9.5px;font-weight:700;color:var(--page-soft);border:1px solid var(--line)}
.salir{background:none;border:none;color:var(--page-tenue);cursor:pointer;font-size:13px;
  padding:2px 4px;flex:0 0 auto}
.salir:hover{color:var(--page-ink)}
.sin-mapa{font-size:11px;color:var(--warn);margin:0;line-height:1.45}

.entrar svg{width:14px;height:14px;fill:currentColor;stroke:none;flex:0 0 auto}
.aviso-sesion{font-size:11px;color:var(--page-tenue);margin:0;line-height:1.5}
.error-sesion{font-size:11px;color:var(--bad);margin:0;line-height:1.5}

.centro{padding:22px 18px 70px 22px;min-width:0}
.vista{margin-top:18px}

/* En angosto el costado pasa a ser una barra arriba: una columna de 198px se come la pantalla. */
@media (max-width:820px){
  .app{grid-template-columns:1fr}
  .lado{height:auto;position:static;border-right:none;border-bottom:1px solid var(--line);
    flex-direction:row;align-items:center;gap:10px 14px;flex-wrap:wrap;padding:13px 16px}
  /* Con `order` la marca y el tema comparten la primera fila y la nav baja entera a la segunda.
     Sin esto el botón de tema se lleva una fila para él solo. */
  .marca{order:1}
  .pie{order:2;margin-top:0;margin-left:auto;flex-direction:row;align-items:center;gap:10px}
  nav{order:3;flex:1 0 100%;flex-direction:row;gap:4px;flex-wrap:wrap}
  .op{padding:6px 10px}
  .n{margin-left:4px}
  .mock{display:none}
  .centro{padding:18px 16px 60px}
}
</style>
