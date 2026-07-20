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
const BOARD = 384;            // CORE — el proyecto donde están MIS tareas (no LO / Loans Origination)

const cargando = ref(true);
const error = ref('');
const sprint = ref(null);
const sprints = ref([]);      // los 3 más recientes, del actual hacia atrás
const sitio = ref('');        // https://<site>.atlassian.net — lo manda el server, sale de su .env
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
// Entradas de muestra, escritas como DEBEN escribirse: cuentan qué pasó en lenguaje de negocio, sin una
// sola referencia técnica. Son el ejemplo del tono, no datos reales.
// - FECHA real (no solo el texto para mostrar): es lo que permite agrupar por día en el mapa de calor.
// - `sprint`: la bitácora es local y arrancó ahora, así que un sprint viejo NO tiene registros. Mostrar
//   los mismos datos al cambiar de sprint sería inventar historia que no existe.
// - `tarea` es un ÍNDICE, no una clave fija: `anclarMuestra` la resuelve contra las tareas reales del
//   sprint. Así el demo cae siempre sobre tareas que existen, aunque cambien de un sprint a otro.
const hoy = new Date();
// enDia(atras, h, m): un instante a `atras` días de hoy, a las h:m. La HORA importa: el mapa de jornada
// reparte cada registro por las horas que cubre, así que un registro sin hora real no diría nada.
const enDia = (atras, h, m = 0) => { const d = new Date(hoy); d.setDate(d.getDate() - atras); d.setHours(h, m, 0, 0); return d; };
const entradas = ref([
  { id: 1, tarea: 0, key: '', tipo: 'avance', min: 120, fecha: enDia(1, 9, 0), sprint: 0,
    txt: 'Se dejó lista la unificación para que este comercio siga el mismo camino que el resto, sin un flujo aparte que haya que mantener por separado.' },
  { id: 2, tarea: 0, key: '', tipo: 'prueba', min: 90, fecha: enDia(1, 14, 0), sprint: 0,
    txt: 'Se recorrió el flujo unificado de punta a punta con los tres productos del comercio y se comparó contra el comportamiento anterior: coincide.' },
  { id: 3, tarea: 1, key: '', tipo: 'avance', min: 150, fecha: enDia(2, 8, 30), sprint: 0,
    txt: 'La calculadora de precios de renting quedó tomando los valores desde configuración, así un cambio de tarifa ya no depende de una nueva entrega.' },
  { id: 4, tarea: 3, key: '', tipo: 'prueba', min: 75, fecha: enDia(2, 15, 0), sprint: 0,
    txt: 'Se verificó que el monto en la pantalla de opciones se actualiza al cambiar la selección, sin quedar con el valor anterior.' },
  { id: 5, tarea: 2, key: '', tipo: 'avance', min: 60, fecha: enDia(3, 10, 0), sprint: 0,
    txt: 'Cada comercio puede mostrar sus propios términos y condiciones; se dejó de usar un texto único para todos.' },
  { id: 6, tarea: 1, key: '', tipo: 'hallazgo', min: 180, fecha: enDia(4, 8, 0), sprint: 0,
    txt: 'Al configurar un plazo largo aparecía un precio distinto al esperado. Se ajustó el redondeo y se validó con varios plazos.' },
  { id: 7, tarea: 1, key: '', tipo: 'avance', min: 120, fecha: enDia(4, 14, 0), sprint: 0,
    txt: 'Quedó configurable el precio del renting por plazo; se cargaron los valores de las tarifas vigentes y se revisaron uno por uno.' },
  { id: 8, tarea: 2, key: '', tipo: 'avance', min: 90, fecha: enDia(8, 9, 30), sprint: 0,
    txt: 'Se dejó preparado que cada comercio suba su propio documento de términos, en lugar de compartir uno solo.' },
  { id: 9, tarea: 3, key: '', tipo: 'prueba', min: 45, fecha: enDia(9, 16, 0), sprint: 0,
    txt: 'Se revisó que el monto mostrado al cliente coincida con el de la oferta en distintos escenarios.' },
  { id: 10, tarea: 0, key: '', tipo: 'avance', min: 90, fecha: enDia(3, 12, 30), sprint: 0,
    txt: 'Se aprovechó un rato del mediodía para dejar cerrada la unificación antes de la demo de la tarde.' },
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
const delSprint = computed(() => entradas.value.filter(e => e.sprint === sprint.value?.id));
const tiempoBitacora = computed(() => delSprint.value.reduce((n, e) => n + e.min, 0));

// El chip del header, según el ESTADO del sprint. CORE vive entre sprints (uno cerró, el próximo no
// arrancó), así que un sprint puede no haber empezado: "5 días restantes" sobre algo que aún no empieza
// sería mentira. Tres casos: por arrancar · en curso · cerrado.
const dias = computed(() => {
  const s = sprint.value;
  if (!s?.endDate) return null;
  const fin = new Date(s.endDate), ini = new Date(s.startDate), hoy = new Date();
  const d = (a, b) => Math.round((a - b) / 86400000);
  if (s.state === 'future' || hoy < ini) return { estado: 'porArrancar', arrancaEn: d(ini, hoy) };
  if (hoy > fin) return { estado: 'cerrado', vencidoHace: d(hoy, fin) };
  return { estado: 'enCurso', restantes: d(fin, hoy) };
});

const hhmm = (s) => { const m = Math.round(s / 60); return m ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : '—'; };
const minHhmm = (m) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
// Link real a la tarea en Jira. Va como <a href> y no como window.open() a propósito: así funcionan
// cmd-clic, clic del medio y "copiar dirección del enlace", que es como uno pega una tarea en Slack.
const linkJira = (key) => sitio.value ? `${sitio.value}/browse/${key}` : '';
const fechaCorta = (d) => d ? new Date(d).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' }) : '';
const claseEstado = (c) => c === 'done' ? 'e-ok' : c === 'indeterminate' ? 'e-curso' : 'e-todo';
const minsDe = (k) => delSprint.value.filter(e => e.key === k).reduce((n, e) => n + e.min, 0);

function agregar() {
  if (!nota.value.trim() || !activa.value || problemas.value.length) return;
  entradas.value.unshift({
    id: Date.now(), key: activa.value.Key, tipo: tipo.value, min: Number(minutos.value) || 0,
    fecha: new Date(), sprint: sprint.value?.id,
    txt: nota.value.trim(),
  });
  nota.value = '';
}

const deLaActiva = computed(() => activa.value ? delSprint.value.filter(e => e.key === activa.value.Key) : []);
const cuando = (d) => new Date(d).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

// ── mi jornada: últimos 20 días × horas laborales ───────────────────────────────────────────────
// Este mapa NO va por sprint: muestra cómo se llenó mi horario laboral (8→18, con almuerzo 12→14) en
// los últimos 20 días corridos. La pregunta que contesta es distinta a "en qué trabajé": es "cómo
// trabajé" — mañanas cargadas y tardes flojas, días partidos, jornadas que se estiran. Por eso lee la
// HORA de cada registro, no solo el día, y es independiente del sprint que estés mirando arriba.
const dia0 = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const clave = (d) => { const x = dia0(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };

const DIAS = 20;
const H_INI = 8, H_FIN = 18;                 // jornada: 8am a 6pm
const ALMUERZO = new Set([12, 13]);          // 12→14: se MARCA como almuerzo, pero se registra igual
const HORAS = Array.from({ length: H_FIN - H_INI }, (_, i) => H_INI + i); // 8..17 (cada uno = una hora)
const NOMBRE_DIA = ['do', 'lu', 'ma', 'mi', 'ju', 'vi', 'sá'];

const diasRango = computed(() => Array.from({ length: DIAS }, (_, i) => {
  const d = dia0(hoy); d.setDate(d.getDate() - (DIAS - 1 - i));
  return { iso: clave(d), num: d.getDate(), dow: NOMBRE_DIA[d.getDay()], finde: [0, 6].includes(d.getDay()) };
}));

// minutos trabajados en cada bloque (día, hora): repartimos la duración de cada registro por las horas
// que realmente cubre. Un registro de 90' a las 9:30 pone 30' en el bloque 9 y 60' en el 10.
const porDiaYHora = computed(() => {
  const m = {};
  for (const e of entradas.value) {
    const ini = new Date(e.fecha);
    const finMs = ini.getTime() + (e.min || 0) * 60000;
    const k = clave(ini);
    for (const h of HORAS) {
      const b0 = new Date(ini); b0.setHours(h, 0, 0, 0);
      const b1 = b0.getTime() + 3600000;
      const solape = Math.min(finMs, b1) - Math.max(ini.getTime(), b0.getTime());
      if (solape > 0) ((m[k] ??= {})[h] = (m[k][h] || 0) + solape / 60000);
    }
  }
  return m;
});

// nivel por FRACCIÓN de la hora trabajada (0..60'), no por tramos absolutos: acá cada celda es una hora,
// así que "lleno" = 60'. Una hora entera trabajada es el tono más fuerte.
const nivel = (min) => !min ? 0 : min < 15 ? 1 : min < 35 ? 2 : min < 55 ? 3 : 4;
const minEn = (iso, h) => porDiaYHora.value[iso]?.[h] || 0;
const totalDe = (iso) => HORAS.reduce((n, h) => n + minEn(iso, h), 0);
const totalRango = computed(() => diasRango.value.reduce((n, d) => n + totalDe(d.iso), 0));
const hMarca = (h) => h === 12 ? '12p' : h === 18 ? '6p' : h < 12 ? `${h}a` : `${h - 12}p`;
const jHoras = (min) => { if (!min) return ''; const h = min / 60; return (Number.isInteger(h) ? h : h.toFixed(1)) + 'h'; };

// ── carga ───────────────────────────────────────────────────────────────────────────────────────
async function cargarSprint(id) {
  cargando.value = true;
  error.value = '';
  try {
    const j = await (await fetch(`${SERVER}/api/sprint?board=${BOARD}${id ? `&id=${id}` : ''}`)).json();
    if (j.error) { error.value = j.error; }
    else {
      sprint.value = j.sprint;
      sitio.value = j.site || sitio.value;
      issues.value = j.issues || [];
      // por defecto queda seleccionada la que está en curso; si no hay (sprint cerrado), la primera
      activa.value = issues.value.find(i => i.StatusCategory === 'indeterminate') || issues.value[0] || null;
    }
  } catch { error.value = 'no se pudo hablar con el server (¿está corriendo en :8787?)'; }
  cargando.value = false;
}

onMounted(async () => {
  try {
    const j = await (await fetch(`${SERVER}/api/sprints?board=${BOARD}&n=3`)).json();
    if (!j.error) { sprints.value = j.sprints || []; sitio.value = j.site || ''; }
  } catch { /* si falla, el selector no aparece y se carga el activo igual */ }

  // Sin id: el server elige (activo, o el último cerrado, o el próximo). No lo re-derivamos acá para
  // no tener dos definiciones de "cuál es el sprint por defecto".
  await cargarSprint();

  // PROTOTIPO: las entradas de muestra se atan al sprint más reciente que YA ARRANCÓ, no al que abrió.
  // Si el board está entre sprints y por defecto abre el último cerrado, ahí van; pero nunca a un sprint
  // future, porque sería ubicar horas trabajadas en el futuro. Cuando la bitácora persista, esto se va.
  const conHistoria = sprints.value.find(s => s.state !== 'future') || sprint.value;
  if (conHistoria?.startDate) anclarMuestra(conHistoria);
});

// El mapa de jornada NO se toca acá: sus fechas ya son reales (últimos días, con hora). Esto solo etiqueta
// cada registro con un sprint y su tarea real, que es lo que necesitan las OTRAS tarjetas (registrado acá,
// bitácora). Deliberadamente no reescribe la fecha: hacerlo sacaría los registros de la ventana de 20 días.
function anclarMuestra(sp) {
  if (!issues.value.length) return;
  for (const e of entradas.value) {
    e.sprint = sp.id;
    e.key = (issues.value[e.tarea] || issues.value[0]).Key;
  }
}
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
        <div class="tabs" v-if="sprints.length > 1">
          <button v-for="s in sprints" :key="s.id" :class="{ act: s.id === sprint.id }"
            :title="`${fechaCorta(s.startDate)} → ${fechaCorta(s.endDate)}`" @click="cargarSprint(s.id)">
            {{ s.name.replace(/^Tablero /, '') }}
            <i v-if="s.state === 'active'" class="vivo" title="sprint activo"></i>
          </button>
        </div>
        <span v-if="dias?.estado === 'porArrancar'" class="chip">arranca en {{ dias.arrancaEn }} día{{ dias.arrancaEn === 1 ? '' : 's' }}</span>
        <span v-else-if="dias?.estado === 'cerrado'" class="chip warn">cerrado hace {{ dias.vencidoHace }} días</span>
        <span v-else-if="dias?.estado === 'enCurso'" class="chip">{{ dias.restantes }} días restantes</span>
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

      <section class="card">
        <h2>Mi jornada
          <span class="mut">· últimos 20 días{{ totalRango ? ` · ${minHhmm(totalRango)}` : '' }}</span>
        </h2>
        <p class="vacio" v-if="!totalRango">Todavía no hay registros en los últimos 20 días. Cada hora que
          registres pinta el bloque de la jornada (8–18) en el que la trabajaste.</p>
        <div class="jm">
          <div v-for="h in HORAS" :key="h" class="jrow" :class="{ almuerzo: ALMUERZO.has(h) }">
            <span class="jhl">{{ hMarca(h) }}</span>
            <span v-for="d in diasRango" :key="d.iso" class="cel"
              :class="['n' + nivel(minEn(d.iso, h)), { finde: d.finde, lunch: ALMUERZO.has(h) }]"
              :title="`${d.dow} ${d.num} · ${hMarca(h)}–${hMarca(h + 1)} — ${minEn(d.iso, h) ? Math.round(minEn(d.iso, h)) + ' min' : (ALMUERZO.has(h) ? 'almuerzo' : 'sin registro')}`"></span>
          </div>
          <div class="jrow jtot">
            <span class="jhl"></span>
            <span v-for="d in diasRango" :key="d.iso" class="cel num" :title="minHhmm(totalDe(d.iso))">{{ jHoras(totalDe(d.iso)) }}</span>
          </div>
          <div class="jrow jejes">
            <span class="jhl"></span>
            <span v-for="d in diasRango" :key="d.iso" class="cel num" :class="{ finde: d.finde }">{{ d.num }}</span>
          </div>
        </div>
        <div class="leyenda">
          <span>menos</span>
          <i v-for="n in [0, 1, 2, 3, 4]" :key="n" :class="'n' + n"></i>
          <span>más</span>
          <span class="nota">cada celda es una hora · incluye el almuerzo (12–2), por si se trabajó ahí</span>
        </div>
      </section>

      <div class="cols">
        <section class="card">
          <h2>Mis tareas</h2>
          <div v-for="i in issues" :key="i.Key" class="task" :class="{ sel: activa?.Key === i.Key }" @click="activa = i">
            <div class="tl">
              <a v-if="sitio" class="key link" :href="linkJira(i.Key)" target="_blank" rel="noopener"
                @click.stop :title="`Abrir ${i.Key} en Jira`">{{ i.Key }} <span class="ext">↗</span></a>
              <span v-else class="key">{{ i.Key }}</span>
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
          <h2>Registrar
            <a v-if="activa && sitio" class="on link" :href="linkJira(activa.Key)" target="_blank"
              rel="noopener" :title="`Abrir ${activa.Key} en Jira`">{{ activa.Key }} <span class="ext">↗</span></a>
            <span v-else-if="activa" class="on">{{ activa.Key }}</span>
          </h2>

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
              <span>{{ cuando(e.fecha) }}</span>
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

/* la clave de la tarea abre Jira; la flecha aparece al pasar por encima para no ensuciar el listado */
.link { text-decoration: none; color: inherit; cursor: pointer }
.link:hover { color: var(--acc); text-decoration: underline }
.ext { opacity: 0; font-size: .82em; transition: .12s }
.link:hover .ext { opacity: .75 }

/* pestañas de sprint: el activo lleva un punto, para no depender solo de la posición */
.tabs { display: flex; gap: 4px; background: var(--panel2); padding: 3px; border-radius: 10px }
.tabs button { border: 0; background: none; color: var(--mut); font: inherit; font-size: 12.5px;
  font-weight: 600; padding: 5px 11px; border-radius: 8px; cursor: pointer; display: flex;
  align-items: center; gap: 6px }
.tabs button:hover { color: var(--txt) }
.tabs button.act { background: var(--panel); color: var(--txt); box-shadow: 0 1px 3px #0006 }
.vivo { width: 6px; height: 6px; border-radius: 50%; background: #4ade80; display: inline-block }
.vacio { color: var(--mut); font-size: 12.5px; margin: 0 0 14px; max-width: 62ch }

/* ── mapa de jornada ──────────────────────────────────────────────────────────────────────────
   Filas = horas laborales (8→18), columnas = últimos 20 días, intensidad = fracción de la hora
   trabajada. Las celdas SIN registro van rayadas en vez de vacías: un hueco liso se lee como "cero"
   y un rayado como "no hubo registro". El almuerzo (12–2) se marca solo con la etiqueta en violeta,
   no se apaga: a veces se trabaja ahí y tiene que verse igual que cualquier hora. */
.jm { display: flex; flex-direction: column; gap: 4px; overflow-x: auto }
.jrow { display: flex; align-items: center; gap: 4px }
.jhl { width: 30px; flex: none; font-size: 10.5px; font-weight: 700; color: var(--mut); text-align: right;
  font-variant-numeric: tabular-nums }
.cel { width: 24px; height: 21px; border-radius: 5px; flex: none; transition: .12s }
/* el finde solo atenúa el FONDO: si una celda tiene registro, el color no se toca — sería mentirle al
   ojo sobre cuánto tiempo hubo ahí */
.cel.finde.n0 { opacity: .45 }
.cel:hover { outline: 2px solid var(--acc); outline-offset: 1px }
.n0 { background: repeating-linear-gradient(-45deg, #ffffff09 0 3px, transparent 3px 6px), var(--panel2) }
.n1 { background: #a78bfa38 } .n2 { background: #a78bfa70 } .n3 { background: #a78bfaad } .n4 { background: #a78bfa }
/* almuerzo: NO se apaga. Se trabaja ahí a veces y hay que verlo igual que cualquier hora. Solo queda
   marcado con la etiqueta en violeta, para que se lea "esto es el almuerzo" sin restarle a la data. */
.jrow.almuerzo .jhl { color: var(--acc); opacity: .8 }
.jtot .cel { height: 16px; background: none; font-size: 9.5px; color: var(--mut); text-align: center;
  font-variant-numeric: tabular-nums }
.jejes .cel { height: auto; background: none; font-size: 10px; color: var(--mut); text-align: center }
.jtot .cel:hover, .jejes .cel:hover { outline: none }
.leyenda { display: flex; align-items: center; gap: 5px; margin-top: 12px; font-size: 11px; color: var(--mut) }
.leyenda i { width: 13px; height: 13px; border-radius: 4px; display: inline-block }
.leyenda .nota { margin-left: 12px }

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
