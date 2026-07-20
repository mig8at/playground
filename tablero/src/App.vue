<script setup>
// Tablero — mi sprint, con registro de tiempo y bitácora.
//
// PROTOTIPO: la mitad de abajo (bitácora, minutos) todavía NO persiste ni sube nada a Jira; está para
// decidir la forma antes de cablearla. Lo de arriba SÍ es real: sale de /api/sprint (Jira Agile 1.0).
//
// LA REGLA QUE ATRAVIESA TODO: lo que se escribe acá termina en Jira, donde lo lee el equipo. Nunca
// puede mencionar el playground, un hallazgo interno (F-xx), una ruta de archivo ni un nombre de repo.
// Por eso el campo de nota tiene un GUARD que BLOQUEA el botón, en vez de solo advertir.
import { ref, computed, onMounted } from 'vue';

const SERVER = 'http://localhost:8787';
const BOARD = 248;            // Tablero Loans Origination — el squad de Miguel

const cargando = ref(true);
const error = ref('');
const sprint = ref(null);
const issues = ref([]);
const activa = ref(null);      // tarea sobre la que se está registrando

// ── bitácora (prototipo, en memoria) ────────────────────────────────────────────────────────────
const TIPOS = [
  { id: 'avance', label: 'Avance', ico: '▸' },
  { id: 'hallazgo', label: 'Hallazgo', ico: '◆' },
  { id: 'prueba', label: 'Prueba', ico: '✓' },
  { id: 'bloqueo', label: 'Bloqueo', ico: '■' },
];
const tipo = ref('avance');
const nota = ref('');
const minutos = ref(30);
// Dos entradas de muestra, escritas como DEBEN escribirse: cuentan qué pasó en lenguaje de negocio,
// sin una sola referencia técnica. Son el ejemplo del tono, no datos reales.
const entradas = ref([
  { id: 1, key: 'LO-224', tipo: 'hallazgo', min: 90, cuando: '19 jul · 11:20',
    txt: 'La entrada desde la tienda genera la solicitud correctamente, pero el cliente aterriza en una pantalla que no corresponde a este comercio y la solicitud queda cancelada sin avisarle.' },
  { id: 2, key: 'LO-224', tipo: 'prueba', min: 45, cuando: '19 jul · 14:05',
    txt: 'Se reprodujo el caso punta a punta en el entorno de pruebas: el pedido viaja completo y con los datos correctos. El corte está en el paso siguiente, no en el envío.' },
]);

// ── guard: lo que se publica en Jira no puede filtrar el playground ─────────────────────────────
const PROHIBIDO = [
  { re: /\bF-\d+\b/gi, que: 'referencia a un hallazgo interno' },
  { re: /playground/gi, que: 'menciona el playground' },
  { re: /frontend-e2e|backend-e2e|legacy-backend|frontend-monorepo|creditop-woocommerce/gi, que: 'nombra un repo interno' },
  { re: /[\w/-]+\.(ts|tsx|php|go|vue|json|mjs)\b/gi, que: 'incluye una ruta de archivo' },
];
const problemas = computed(() =>
  PROHIBIDO.flatMap(p => (nota.value.match(p.re) || []).map(m => ({ que: p.que, hallado: m }))));

// ── derivados del sprint ────────────────────────────────────────────────────────────────────────
const hechas = computed(() => issues.value.filter(i => i.StatusCategory === 'done').length);
const puntos = computed(() => issues.value.reduce((n, i) => n + (i.Points || 0), 0));
const tiempoJira = computed(() => issues.value.reduce((n, i) => n + (i.SpentSecs || 0), 0));
const tiempoBitacora = computed(() => entradas.value.reduce((n, e) => n + e.min, 0));

const dias = computed(() => {
  if (!sprint.value?.endDate) return null;
  const fin = new Date(sprint.value.endDate), ini = new Date(sprint.value.startDate), hoy = new Date();
  const d = (a, b) => Math.round((a - b) / 86400000);
  return { total: d(fin, ini), restantes: d(fin, hoy), vencido: hoy > fin, vencidoHace: d(hoy, fin) };
});

const hhmm = (s) => { const m = Math.round(s / 60); return m ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : '—'; };
const minHhmm = (m) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
const claseEstado = (c) => c === 'done' ? 'e-ok' : c === 'indeterminate' ? 'e-curso' : 'e-todo';
const minsDe = (k) => entradas.value.filter(e => e.key === k).reduce((n, e) => n + e.min, 0);

function agregar() {
  if (!nota.value.trim() || !activa.value || problemas.value.length) return;
  entradas.value.unshift({
    id: Date.now(), key: activa.value.Key, tipo: tipo.value, min: Number(minutos.value) || 0,
    cuando: new Date().toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }),
    txt: nota.value.trim(),
  });
  nota.value = '';
}

const deLaActiva = computed(() => activa.value ? entradas.value.filter(e => e.key === activa.value.Key) : []);

onMounted(async () => {
  try {
    const j = await (await fetch(`${SERVER}/api/sprint?board=${BOARD}`)).json();
    if (j.error) error.value = j.error;
    else {
      sprint.value = j.sprint;
      issues.value = j.issues || [];
      activa.value = issues.value.find(i => i.StatusCategory === 'indeterminate') || issues.value[0] || null;
    }
  } catch { error.value = 'no se pudo hablar con el server (¿está corriendo en :8787?)'; }
  cargando.value = false;
});
</script>

<template>
  <div class="wrap">
    <header>
      <div class="logo">T</div>
      <div>
        <h1>Tablero</h1>
        <p class="sub">Mi sprint · registro de tiempo y hallazgos</p>
      </div>
      <div class="sp" v-if="sprint">
        <b>{{ sprint.name }}</b>
        <span v-if="dias?.vencido" class="chip warn">venció hace {{ dias.vencidoHace }} días</span>
        <span v-else-if="dias" class="chip">{{ dias.restantes }} días restantes</span>
      </div>
    </header>

    <p v-if="cargando" class="msg">Cargando el sprint…</p>
    <p v-else-if="error" class="msg bad">{{ error }}</p>

    <template v-else>
      <div class="stats">
        <div class="stat">
          <div class="k">Tareas</div>
          <div class="v">{{ hechas }}/{{ issues.length }}</div>
          <div class="s">terminadas en el sprint</div>
        </div>
        <div class="stat">
          <div class="k">Puntos</div>
          <div class="v">{{ puntos }}</div>
          <div class="s">estimados</div>
        </div>
        <div class="stat" :class="{ alerta: tiempoJira === 0 }">
          <div class="k">Tiempo en Jira</div>
          <div class="v">{{ hhmm(tiempoJira) }}</div>
          <div class="s">{{ tiempoJira === 0 ? 'sin registrar: nadie ve el trabajo' : 'registrado' }}</div>
        </div>
        <div class="stat ok">
          <div class="k">Registrado acá</div>
          <div class="v">{{ minHhmm(tiempoBitacora) }}</div>
          <div class="s">listo para subir</div>
        </div>
      </div>

      <div class="cols">
        <section class="card">
          <h2>Mis tareas</h2>
          <div v-for="i in issues" :key="i.Key" class="task" :class="{ sel: activa?.Key === i.Key }" @click="activa = i">
            <div class="tl">
              <span class="key">{{ i.Key }}</span>
              <span class="est" :class="claseEstado(i.StatusCategory)">{{ i.Status }}</span>
            </div>
            <div class="tt">{{ i.Summary }}</div>
            <div class="tm">
              <span v-if="i.HasPoints && i.Points">{{ i.Points }} pts</span>
              <span>{{ hhmm(i.SpentSecs) }} en Jira</span>
              <span class="mine" v-if="minsDe(i.Key)">{{ minHhmm(minsDe(i.Key)) }} sin subir</span>
            </div>
          </div>
        </section>

        <section class="card">
          <h2>Registrar <span v-if="activa" class="on">{{ activa.Key }}</span></h2>

          <div class="seg">
            <button v-for="t in TIPOS" :key="t.id" :class="{ on: tipo === t.id }" @click="tipo = t.id">
              {{ t.ico }} {{ t.label }}
            </button>
          </div>

          <textarea v-model="nota" rows="4"
            placeholder="Qué pasó, en lenguaje de negocio. Esto se publica en Jira: sin rutas de archivo, sin nombres de repo, sin referencias internas."></textarea>

          <div v-if="problemas.length" class="guard">
            <b>No se puede publicar así</b>
            <div v-for="(p, n) in problemas" :key="n">· {{ p.que }}: <code>{{ p.hallado }}</code></div>
          </div>

          <div class="fila">
            <label>Minutos</label>
            <input type="number" v-model="minutos" min="0" step="5" />
            <button class="go" :disabled="!nota.trim() || !!problemas.length || !activa" @click="agregar">Agregar</button>
          </div>
        </section>
      </div>

      <section class="card">
        <h2>Bitácora <span class="mut" v-if="activa">de {{ activa.Key }}</span></h2>
        <p v-if="!deLaActiva.length" class="msg">Sin entradas para esta tarea todavía.</p>
        <div v-for="e in deLaActiva" :key="e.id" class="ent">
          <span class="ico" :class="'t-' + e.tipo">{{ TIPOS.find(t => t.id === e.tipo)?.ico }}</span>
          <div class="cuerpo">
            <div class="meta">
              <b>{{ TIPOS.find(t => t.id === e.tipo)?.label }}</b>
              <span>{{ e.cuando }}</span>
              <span class="min">{{ e.min }} min</span>
            </div>
            <p>{{ e.txt }}</p>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.wrap { max-width: 1180px; margin: 0 auto; padding: 26px 22px 60px }
header { display: flex; align-items: center; gap: 14px; margin-bottom: 20px }
.logo { width: 38px; height: 38px; border-radius: 11px; display: grid; place-items: center; font-weight: 800;
  color: #0b0713; font-size: 19px; background: linear-gradient(135deg, #a78bfa, #60a5fa) }
h1 { font-size: 20px; margin: 0; letter-spacing: .2px }
.sub { color: var(--mut); font-size: 13px; margin: 2px 0 0 }
.sp { margin-left: auto; display: flex; align-items: center; gap: 10px; font-size: 13px }
.chip { padding: 4px 11px; border-radius: 999px; border: 1px solid var(--line); color: var(--mut); font-size: 12px }
.chip.warn { color: var(--warn); border-color: #4a3a16; background: #241a08 }

.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 16px }
.stat { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 15px 16px }
.stat .k { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; color: var(--mut) }
.stat .v { font-size: 27px; font-weight: 800; margin: 6px 0 2px; letter-spacing: -.5px; font-variant-numeric: tabular-nums }
.stat .s { font-size: 11.5px; color: var(--mut) }
.stat.alerta .v { color: var(--warn) }
.stat.ok .v { color: var(--acc) }

.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: start }
@media (max-width: 940px) { .cols { grid-template-columns: 1fr } }
.card { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 18px; margin-bottom: 16px }
.card h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .8px; color: var(--mut); margin: 0 0 14px; font-weight: 700 }
.card h2 .on { color: var(--acc); margin-left: 6px }
.card h2 .mut { color: var(--mut); font-weight: 400; text-transform: none; letter-spacing: 0 }

.task { border: 1px solid var(--line); border-radius: 11px; padding: 12px 13px; margin-bottom: 9px; cursor: pointer; transition: .12s }
.task:hover { border-color: #a78bfa66 }
.task.sel { border-color: var(--acc); background: #a78bfa0f }
.tl { display: flex; align-items: center; gap: 9px; margin-bottom: 5px }
.key { font-weight: 800; font-size: 12.5px; font-variant-numeric: tabular-nums }
.est { font-size: 10.5px; padding: 2px 8px; border-radius: 999px; border: 1px solid }
.e-ok { color: #4ade80; border-color: #256b41; background: #0e2718 }
.e-curso { color: #60a5fa; border-color: #29456e; background: #11203a }
.e-todo { color: #94a3b8; border-color: #3a4453; background: #1b212b }
.tt { font-size: 13.5px; line-height: 1.35; margin-bottom: 6px }
.tm { display: flex; gap: 12px; font-size: 11.5px; color: var(--mut) }
.tm .mine { color: var(--acc) }

.seg { display: inline-flex; border: 1px solid var(--line); border-radius: 10px; overflow: hidden; margin-bottom: 11px }
.seg button { background: var(--panel2); color: var(--mut); border: none; border-right: 1px solid var(--line);
  padding: 8px 13px; font-size: 12.5px; font-weight: 700; cursor: pointer; font-family: inherit }
.seg button:last-child { border-right: none }
.seg button.on { background: var(--acc); color: #0b0713 }
textarea, input { background: var(--panel2); border: 1px solid var(--line); color: var(--txt); border-radius: 10px;
  padding: 10px 12px; font: inherit; font-size: 13px; width: 100%; resize: vertical }
textarea:focus, input:focus { outline: none; border-color: var(--acc) }
.fila { display: flex; align-items: center; gap: 10px; margin-top: 11px }
.fila label { font-size: 12px; color: var(--mut) }
.fila input { width: 90px }
.go { margin-left: auto; background: var(--acc); color: #0b0713; border: none; border-radius: 10px;
  padding: 10px 18px; font-weight: 800; font-size: 13.5px; cursor: pointer; font-family: inherit; white-space: nowrap }
.go:disabled { opacity: .4; cursor: not-allowed }
.guard { margin-top: 11px; padding: 10px 12px; border-radius: 10px; border: 1px solid #5b2020; background: #2a1010;
  color: var(--bad); font-size: 12px; line-height: 1.55 }
.guard b { display: block; margin-bottom: 4px }
.guard code { color: #fecaca }

.ent { display: flex; gap: 11px; padding: 11px 0; border-top: 1px solid var(--line) }
.ent:first-of-type { border-top: none }
.ico { width: 24px; height: 24px; border-radius: 8px; display: grid; place-items: center; font-size: 11px; flex: none; background: #ffffff0d }
.t-hallazgo { color: var(--warn) } .t-prueba { color: #4ade80 } .t-bloqueo { color: var(--bad) } .t-avance { color: var(--acc) }
.cuerpo { min-width: 0 }
.meta { display: flex; gap: 10px; font-size: 11px; color: var(--mut); margin-bottom: 3px }
.meta b { color: var(--txt) }
.meta .min { color: var(--acc) }
.ent p { margin: 0; font-size: 13px; line-height: 1.5 }
.msg { color: var(--mut); font-size: 13px }
.msg.bad { color: var(--bad) }
</style>
