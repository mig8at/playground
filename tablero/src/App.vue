<script setup>
// Tablero — mi sprint, con registro de tiempo y bitácora.
//
// El registro persiste en SQLite del lado del server (internal/store). Lo de arriba (sprint, tareas)
// sale de /api/sprint (Jira Agile 1.0); la bitácora, de /api/entries.
//
// LA REGLA QUE ATRAVIESA TODO: lo que se escribe acá termina en Jira, donde lo lee el equipo. Nunca
// puede mencionar el playground, un hallazgo interno (F-xx), una ruta de archivo ni un nombre de repo.
// Por eso el campo de nota tiene un GUARD que BLOQUEA el botón, en vez de solo advertir.
//
// CONVENCIÓN: identificadores y clases CSS en inglés; solo el texto visible y los comentarios en español.
import { ref, computed, onMounted, watch } from 'vue';

const SERVER = 'http://localhost:8787';
const BOARD = 384;            // CORE — el proyecto donde están MIS tareas (no LO / Loans Origination)

const loading = ref(true);
const error = ref('');
const sprint = ref(null);
const sprints = ref([]);      // los 4 más recientes, del actual hacia atrás
const site = ref('');         // https://<site>.atlassian.net — lo manda el server, sale de su .env
const issues = ref([]);
const active = ref(null);     // tarea sobre la que se está registrando

// ── ajustes del tablero ─────────────────────────────────────────────────────────────────────────
// Flags de "campos de la empresa": tiempo y puntos. OFF por defecto — la empresa no los pide, así que
// el tablero no los muestra. NO tocan el registro personal (bitácora, mapa de foco), que es el núcleo.
const settings = ref({ trackTime: false, trackPoints: false });
const showSettings = ref(false);
async function loadSettings() {
  try { const s = await (await fetch(`${SERVER}/api/settings`)).json(); if (!s.error) settings.value = s; }
  catch { /* si falla, quedan los defaults (todo off) */ }
}
async function setSetting(key, val) {
  settings.value = { ...settings.value, [key]: val };
  try { await fetch(`${SERVER}/api/settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ [key]: val }) }); }
  catch { /* offline: el cambio queda local hasta que vuelva el server */ }
}

// ── bitácora ──────────────────────────────────────────────────────────────────────────────────
// LA ESCRIBE EL ASISTENTE, no vos: al analizar una tarea hace POST /api/entries con la redacción ya
// correcta (y el guard del server la valida). Acá solo se LEE — por eso no hay formulario de alta.
// `id` es el valor que se guarda (kind); `label` es lo que se muestra: id en inglés, label en español.
const KINDS = [
  { id: 'progress', label: 'Avance', icon: '▸' },
  { id: 'finding', label: 'Hallazgo', icon: '◆' },
  { id: 'test', label: 'Prueba', icon: '✓' },
  { id: 'blocker', label: 'Bloqueo', icon: '■' },
];
// La bitácora vive en SQLite del lado del server. Acá se mapea al shape que usa la UI: `date` es el
// INICIO del bloque trabajado (Date real; el mapa de jornada reparte por horas), `sprint` ata la
// entrada al sprint donde se registró.
const fromApi = (r) => ({ id: r.id, key: r.taskKey, kind: r.kind, min: r.minutes,
  date: new Date(r.startedAt), sprint: r.sprintId, text: r.note, uploaded: !!r.uploadedAt });
const today = new Date();
const entries = ref([]);

async function loadEntries() {
  try {
    const j = await (await fetch(`${SERVER}/api/entries?days=30${sprint.value ? `&sprint=${sprint.value.id}` : ''}`)).json();
    if (!j.error) entries.value = (j.entries || []).map(fromApi);
  } catch { /* server caído: el error general de carga ya lo dice */ }
}


// La capa local de la tarea activa se LEE del mapa que ya trae el agrupado: la UI no la edita
// (el asistente la escribe por la API), así que no hace falta un fetch aparte ni estado editable.

// ── esfuerzos: el trabajo real privado que agrupa varias tareas de Jira ────────────────────────────
const efforts = ref([]);
const taskLocals = ref({});       // mapa clave → capa local, para agrupar el listado

async function loadEfforts() {
  try { const j = await (await fetch(`${SERVER}/api/efforts`)).json(); if (!j.error) efforts.value = j.efforts || []; }
  catch { /* sin esfuerzos: el listado va plano */ }
}
async function loadTaskLocals() {
  try { const j = await (await fetch(`${SERVER}/api/task-locals`)).json(); if (!j.error) taskLocals.value = j.taskLocals || {}; }
  catch { /* sin capas: todo cae en "sin esfuerzo" */ }
}
// listado agrupado por esfuerzo; las sin asignar van al final. El encabezado del grupo solo aparece si
// hay al menos un esfuerzo en juego (si no, el listado va plano como antes).
const groupedIssues = computed(() => {
  const byEffort = new Map();
  for (const i of issues.value) {
    const eid = taskLocals.value[i.Key]?.effortId || 0;
    if (!byEffort.has(eid)) byEffort.set(eid, []);
    byEffort.get(eid).push(i);
  }
  const groups = [];
  for (const e of efforts.value) if (byEffort.has(e.id)) groups.push({ id: e.id, title: e.title, tasks: byEffort.get(e.id) });
  if (byEffort.has(0)) groups.push({ id: 0, title: 'Sin esfuerzo', tasks: byEffort.get(0) });
  return groups;
});
const showGroups = computed(() => groupedIssues.value.some(g => g.id !== 0));
// El MÉTODO de trabajo, explícito: primero se evalúa, después se trabaja, y las tareas de Jira se
// escriben AL FINAL — recién ahí hay contexto completo para definirlas bien.
const STAGES = [
  { id: 'evaluation', label: 'Evaluando' },
  { id: 'work', label: 'Trabajando' },
  { id: 'tasks', label: 'Tareas creadas' },
];
const stageOf = (id) => STAGES.find(s => s.id === (efforts.value.find(e => e.id === id)?.stage || 'evaluation'));
const activeLocal = computed(() => taskLocals.value[active.value?.Key] || {});

// ── derivados del sprint ────────────────────────────────────────────────────────────────────────
const done = computed(() => issues.value.filter(i => i.StatusCategory === 'done').length);
const points = computed(() => issues.value.reduce((n, i) => n + (i.Points || 0), 0));
const jiraTime = computed(() => issues.value.reduce((n, i) => n + (i.SpentSecs || 0), 0));
const ofSprint = computed(() => entries.value.filter(e => e.sprint === sprint.value?.id));
const logTime = computed(() => ofSprint.value.reduce((n, e) => n + e.min, 0));

// El chip del header, según el ESTADO del sprint. CORE vive entre sprints (uno cerró, el próximo no
// arrancó), así que un sprint puede no haber empezado: "5 días restantes" sobre algo que aún no empieza
// sería mentira. Tres casos: por arrancar · en curso · cerrado.
const sprintDays = computed(() => {
  const s = sprint.value;
  if (!s?.endDate) return null;
  const end = new Date(s.endDate), start = new Date(s.startDate), now = new Date();
  const d = (a, b) => Math.round((a - b) / 86400000);
  if (s.state === 'future' || now < start) return { state: 'upcoming', startsIn: d(start, now) };
  if (now > end) return { state: 'closed', endedAgo: d(now, end) };
  return { state: 'ongoing', remaining: d(end, now) };
});

const hhmm = (s) => { const m = Math.round(s / 60); return m ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : '—'; };
const minHhmm = (m) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
// Link real a la tarea en Jira. Va como <a href> y no como window.open() a propósito: así funcionan
// cmd-clic, clic del medio y "copiar dirección del enlace", que es como uno pega una tarea en Slack.
const jiraLink = (key) => site.value ? `${site.value}/browse/${key}` : '';
const shortDate = (d) => d ? new Date(d).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' }) : '';
const statusClass = (c) => c === 'done' ? 'e-ok' : c === 'indeterminate' ? 'e-doing' : 'e-todo';
const minutesOf = (k) => ofSprint.value.filter(e => e.key === k).reduce((n, e) => n + e.min, 0);

async function deleteEntry(id) {
  try {
    await fetch(`${SERVER}/api/entries/${id}`, { method: 'DELETE' });
    entries.value = entries.value.filter(e => e.id !== id); // borrado suave en la base
  } catch { /* si falló, la entrada sigue visible: coherente con la base */ }
}

const ofActive = computed(() => active.value ? ofSprint.value.filter(e => e.key === active.value.Key) : []);
const when = (d) => new Date(d).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

// ── mi jornada: últimos 20 días × horas laborales ───────────────────────────────────────────────
// Este mapa NO va por sprint: muestra cómo se llenó mi horario laboral (8→18, con almuerzo 12→14) en
// los últimos 20 días corridos. La pregunta que contesta es distinta a "en qué trabajé": es "cómo
// trabajé" — mañanas cargadas y tardes flojas, días partidos, jornadas que se estiran. Por eso lee la
// HORA de cada registro, no solo el día, y es independiente del sprint que estés mirando arriba.
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const dayKey = (d) => { const x = startOfDay(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };

const DAYS = 20;
const H_START = 8, H_END = 18;               // jornada: 8am a 6pm
const LUNCH = new Set([12, 13]);             // 12→14: se MARCA como almuerzo, pero se registra igual
const HOURS = Array.from({ length: H_END - H_START }, (_, i) => H_START + i); // 8..17 (cada uno = una hora)
const DOW_NAME = ['do', 'lu', 'ma', 'mi', 'ju', 'vi', 'sá'];

const dayCols = computed(() => Array.from({ length: DAYS }, (_, i) => {
  const d = startOfDay(today); d.setDate(d.getDate() - (DAYS - 1 - i));
  return { iso: dayKey(d), num: d.getDate(), dow: DOW_NAME[d.getDay()], weekend: [0, 6].includes(d.getDay()) };
}));

// minutos por (día, hora) SEPARADOS POR TAREA. Repartimos la duración de cada registro por las horas que
// cubre (90' a las 9:30 → 30' en el bloque 9 y 60' en el 10). Guardamos el total y el desglose por tarea:
// el total alimenta los totales del día; el desglose, el FOCO.
const byDayAndHour = computed(() => {
  const m = {};
  for (const e of entries.value) {
    const start = new Date(e.date);
    const endMs = start.getTime() + (e.min || 0) * 60000;
    const k = dayKey(start);
    for (const h of HOURS) {
      const b0 = new Date(start); b0.setHours(h, 0, 0, 0);
      const overlap = Math.min(endMs, b0.getTime() + 3600000) - Math.max(start.getTime(), b0.getTime());
      if (overlap <= 0) continue;
      const mins = overlap / 60000;
      const cell = ((m[k] ??= {})[h] ??= { total: 0, byTask: {} });
      cell.total += mins;
      if (e.key) cell.byTask[e.key] = (cell.byTask[e.key] || 0) + mins; // sin tarea (free-title) NO es foco
    }
  }
  return m;
});
const cellAt = (iso, h) => byDayAndHour.value[iso]?.[h];

// EL COLOR ES FOCO, no cantidad de trabajo: minutos de la TAREA DOMINANTE en esa hora, sobre 60. Una
// hora entera en UNA sola tarea llena el cuadro (60/60); si la repartiste entre tareas, o solo trabajaste
// un rato y el resto en otras cosas (playground, que no es tarea), el dominante es menor → menos color.
const focusMin = (iso, h) => { const c = cellAt(iso, h); return c ? Math.max(0, ...Object.values(c.byTask)) : 0; };
const workedMin = (iso, h) => cellAt(iso, h)?.total || 0;

// los 5 tramos siguen siendo fracción de la hora (0..60'): "lleno" = 60' de foco en una sola tarea
const level = (min) => !min ? 0 : min < 15 ? 1 : min < 35 ? 2 : min < 55 ? 3 : 4;
const totalOf = (iso) => HOURS.reduce((n, h) => n + workedMin(iso, h), 0); // footer: total TRABAJADO del día
const rangeTotal = computed(() => dayCols.value.reduce((n, d) => n + totalOf(d.iso), 0));
const hourLabel = (h) => h === 12 ? '12p' : h === 18 ? '6p' : h < 12 ? `${h}a` : `${h - 12}p`;
const hoursShort = (min) => { if (!min) return ''; const h = min / 60; return (Number.isInteger(h) ? h : h.toFixed(1)) + 'h'; };

// tooltip: el desglose que explica el número de foco (tarea dominante + lo que lo diluyó)
const cellTitle = (d, h) => {
  const head = `${d.dow} ${d.num} · ${hourLabel(h)}–${hourLabel(h + 1)}`;
  const c = cellAt(d.iso, h);
  if (!c || !c.total) return `${head} — ${LUNCH.has(h) ? 'almuerzo' : 'sin registro'}`;
  const parts = Object.entries(c.byTask).sort((a, b) => b[1] - a[1]).map(([k, m]) => `${k} ${Math.round(m)}m`);
  const other = c.total - Object.values(c.byTask).reduce((a, b) => a + b, 0);
  if (other > 0.5) parts.push(`otros ${Math.round(other)}m`);
  return `${head} · foco ${Math.round(focusMin(d.iso, h))}/60 — ${parts.join(' · ')}`;
};

// ── tramos de sprint sobre las 20 columnas ───────────────────────────────────────────────────────
// La ventana de 20 días cruza sprints (y los huecos entre ellos). Para cada sprint que asoma en el
// rango, calculamos QUÉ columnas ocupa: así se dibuja una banda con su nombre arriba y una marca en la
// primera/última celda. Comparamos por `dayKey` (YYYY-MM-DD): iso lexicográfico ordena bien con ese
// formato. Un sprint que arranca antes o termina después del rango se recorta a lo que se ve.
const spans = computed(() => {
  const cols = dayCols.value;
  return (sprints.value || []).map(sp => {
    if (!sp.startDate || !sp.endDate) return null;
    const start = dayKey(sp.startDate), end = dayKey(sp.endDate);
    let a = -1, b = -1;
    cols.forEach((c, i) => { if (c.iso >= start && c.iso <= end) { if (a < 0) a = i; b = i; } });
    if (a < 0) return null; // no asoma en la ventana
    return { id: sp.id, name: sp.name.replace(/^CORE /, ''), a, b, len: b - a + 1 };
  }).filter(Boolean);
});
// primera/última columna de cada tramo. La separación entre sprints es un MARGEN (aire real entre las
// columnas), no una línea: se ve el corte sin agregarle tinta a la grilla.
const startCols = computed(() => new Set(spans.value.map(t => t.a)));
const endCols = computed(() => new Set(spans.value.map(t => t.b)));

// Las medidas viven ACÁ y la grilla las lee por variables CSS (`gridVars`). Tienen que estar en un solo
// lado porque el margen entre sprints desplaza las columnas: la banda de arriba no puede posicionarse
// con una fórmula fija, tiene que sumar los márgenes que la preceden. Con las medidas repartidas entre
// CSS y JS, ese cálculo se desincroniza al primer cambio de tamaño.
const CEL = 24, GAP = 4, JHL = 30, SEP = 9; // px: celda · separación normal · etiqueta de hora · margen de sprint
const gridVars = { '--cel': `${CEL}px`, '--gap': `${GAP}px`, '--jhl': `${JHL}px`, '--sep': `${SEP}px` };

// borde izquierdo de la columna i, contando los márgenes de sprint que quedaron atrás
const leftOf = (i) => {
  let x = JHL + GAP;
  for (let j = 0; j < i; j++) {
    x += CEL + GAP + (startCols.value.has(j) ? SEP : 0) + (endCols.value.has(j) ? SEP : 0);
  }
  return x + (startCols.value.has(i) ? SEP : 0);
};
const spanStyle = (t) => {
  const l = leftOf(t.a);
  return { left: `${l}px`, width: `${leftOf(t.b) + CEL - l}px` };
};

// ── carga ───────────────────────────────────────────────────────────────────────────────────────
async function loadSprint(id) {
  loading.value = true;
  error.value = '';
  try {
    const j = await (await fetch(`${SERVER}/api/sprint?board=${BOARD}${id ? `&id=${id}` : ''}`)).json();
    if (j.error) { error.value = j.error; }
    else {
      sprint.value = j.sprint;
      site.value = j.site || site.value;
      issues.value = j.issues || [];
      // por defecto queda seleccionada la que está en curso; si no hay (sprint cerrado), la primera
      active.value = issues.value.find(i => i.StatusCategory === 'indeterminate') || issues.value[0] || null;
    }
  } catch { error.value = 'no se pudo hablar con el server (¿está corriendo en :8787?)'; }
  await loadEntries();
  await loadTaskLocals(); // el grupo depende de las tareas visibles del sprint
  loading.value = false;
}

onMounted(async () => {
  try {
    const j = await (await fetch(`${SERVER}/api/sprints?board=${BOARD}&n=4`)).json();
    if (!j.error) { sprints.value = j.sprints || []; site.value = j.site || ''; }
  } catch { /* si falla, el selector no aparece y se carga el activo igual */ }

  await loadSettings();
  await loadEfforts();

  // Sin id: el server elige (activo, o el último cerrado, o el próximo). No lo re-derivamos acá para
  // no tener dos definiciones de "cuál es el sprint por defecto".
  await loadSprint();
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
        <div class="tabs" v-if="sprints.length > 1">
          <button v-for="s in sprints" :key="s.id" :class="{ act: s.id === sprint.id }"
            :title="`${shortDate(s.startDate)} → ${shortDate(s.endDate)}`" @click="loadSprint(s.id)">
            {{ s.name.replace(/^.*?(Sprint)/i, '$1') }}
            <i v-if="s.state === 'active'" class="live" title="sprint activo"></i>
          </button>
        </div>
        <span v-if="sprintDays?.state === 'upcoming'" class="chip">arranca en {{ sprintDays.startsIn }} día{{ sprintDays.startsIn === 1 ? '' : 's' }}</span>
        <span v-else-if="sprintDays?.state === 'closed'" class="chip warn">cerrado hace {{ sprintDays.endedAgo }} días</span>
        <span v-else-if="sprintDays?.state === 'ongoing'" class="chip">{{ sprintDays.remaining }} días restantes</span>
      </div>
      <div class="settings" :class="{ pushed: !sprint }">
        <button class="gear" :class="{ on: showSettings }" @click="showSettings = !showSettings" title="Ajustes">⚙</button>
        <template v-if="showSettings">
          <div class="backdrop" @click="showSettings = false"></div>
          <div class="pop">
            <div class="pop-h">Campos de la empresa</div>
            <label>
              <input type="checkbox" :checked="settings.trackTime" @change="setSetting('trackTime', $event.target.checked)" />
              <span>Registrar tiempo <em>tiempo estipulado + tiempo en Jira</em></span>
            </label>
            <label>
              <input type="checkbox" :checked="settings.trackPoints" @change="setSetting('trackPoints', $event.target.checked)" />
              <span>Registrar puntos <em>story points de las tareas</em></span>
            </label>
            <p class="hint">Apagados, la empresa no los pide y el tablero no los muestra. Tu registro
              personal de tiempo (bitácora y mapa de foco) no depende de esto.</p>
          </div>
        </template>
      </div>
    </header>

    <p v-if="loading" class="msg">Cargando el sprint…</p>
    <p v-else-if="error" class="msg bad">{{ error }}</p>

    <template v-else>
      <div class="stats">
        <div class="stat">
          <div class="k">Tareas</div>
          <div class="v">{{ done }}/{{ issues.length }}</div>
          <div class="s">terminadas en el sprint</div>
        </div>
        <div class="stat" v-if="settings.trackPoints">
          <div class="k">Puntos</div>
          <div class="v">{{ points }}</div>
          <div class="s">estimados</div>
        </div>
        <div class="stat" :class="{ alert: jiraTime === 0 }" v-if="settings.trackTime">
          <div class="k">Tiempo en Jira</div>
          <div class="v">{{ hhmm(jiraTime) }}</div>
          <div class="s">{{ jiraTime === 0 ? 'sin registrar: nadie ve el trabajo' : 'registrado' }}</div>
        </div>
        <div class="stat ok">
          <div class="k">Registrado acá</div>
          <div class="v">{{ minHhmm(logTime) }}</div>
          <div class="s">listo para subir</div>
        </div>
      </div>

      <section class="card">
        <h2>Mi jornada
          <span class="mut">· últimos 20 días{{ rangeTotal ? ` · ${minHhmm(rangeTotal)}` : '' }}</span>
        </h2>
        <p class="empty" v-if="!rangeTotal">Todavía no hay registros en los últimos 20 días. El color de
          cada hora mide el FOCO: se llena cuando la trabajaste entera en una sola tarea.</p>
        <div class="jm" :style="gridVars">
          <div class="jband">
            <div v-for="t in spans" :key="t.name" class="jspan" :class="{ sel: t.id === sprint?.id }"
              :style="spanStyle(t)" :title="t.id === sprint?.id ? `${t.name} · el que estás viendo` : t.name">{{ t.name }}</div>
          </div>
          <!-- `gapTop` en 12p y 2p: parte la jornada en mañana | almuerzo | tarde -->
          <div v-for="h in HOURS" :key="h" class="jrow"
            :class="{ lunch: LUNCH.has(h), gapTop: h === 12 || h === 14 }">
            <span class="jhl">{{ hourLabel(h) }}</span>
            <span v-for="(d, i) in dayCols" :key="d.iso" class="cel"
              :class="['n' + level(focusMin(d.iso, h)), { weekend: d.weekend, spStart: startCols.has(i), spEnd: endCols.has(i) }]"
              :title="cellTitle(d, h)"></span>
          </div>
          <!-- las filas de totales y de fechas repiten los mismos márgenes: si no, se desalinean -->
          <div class="jrow jtot">
            <span class="jhl"></span>
            <span v-for="(d, i) in dayCols" :key="d.iso" class="cel num"
              :class="{ spStart: startCols.has(i), spEnd: endCols.has(i) }" :title="minHhmm(totalOf(d.iso))">{{ hoursShort(totalOf(d.iso)) }}</span>
          </div>
          <div class="jrow jaxis">
            <span class="jhl"></span>
            <span v-for="(d, i) in dayCols" :key="d.iso" class="cel num"
              :class="{ weekend: d.weekend, spStart: startCols.has(i), spEnd: endCols.has(i) }">{{ d.num }}</span>
          </div>
        </div>
        <div class="legend">
          <span>disperso</span>
          <i v-for="n in [0, 1, 2, 3, 4]" :key="n" :class="'n' + n"></i>
          <span>enfocado</span>
          <span class="note">el color es FOCO: una hora entera en una sola tarea llena el cuadro; repartida entre tareas u otras cosas, menos</span>
        </div>
      </section>

      <section class="card" v-if="active">
        <h2>La tarea
          <a v-if="site" class="on link" :href="jiraLink(active.Key)" target="_blank" rel="noopener">{{ active.Key }} <span class="ext">↗</span></a>
          <span v-else class="on">{{ active.Key }}</span>
        </h2>

        <!-- SOLO LECTURA: el estado y la descripción son los de Jira. Cambiarlos es cosa de Jira (o del
             asistente por la API), no de esta vista. -->
        <div class="dual">
          <div class="lane">
            <span class="lane-k">Estado <em>en Jira</em></span>
            <span class="status" :class="statusClass(active.StatusCategory)">{{ active.Status }}</span>
          </div>
          <div class="lane" v-if="settings.trackTime && activeLocal.estimateMinutes">
            <span class="lane-k">Estimado <em>lo estipulado</em></span>
            <span class="val">{{ minHhmm(activeLocal.estimateMinutes) }}</span>
          </div>
          <div class="lane" v-if="settings.trackPoints && activeLocal.estimatePoints">
            <span class="lane-k">Puntos</span>
            <span class="val">{{ activeLocal.estimatePoints }}</span>
          </div>
        </div>

        <label class="fld">Descripción <em>lo que hoy dice Jira</em></label>
        <p v-if="active.Description" class="desc">{{ active.Description }}</p>
        <p v-else class="desc none">Esta tarea todavía no tiene descripción en Jira.</p>
      </section>

      <div class="cols">
        <section class="card">
          <h2>Mis tareas</h2>
          <template v-for="g in groupedIssues" :key="g.id">
            <div v-if="showGroups" class="grp" :class="{ none: !g.id }">
              {{ g.title }}
              <span v-if="g.id" class="stg" :class="'s-' + stageOf(g.id)?.id">{{ stageOf(g.id)?.label }}</span>
            </div>
            <div v-for="i in g.tasks" :key="i.Key" class="task" :class="{ sel: active?.Key === i.Key }" @click="active = i">
              <div class="tl">
                <a v-if="site" class="key link" :href="jiraLink(i.Key)" target="_blank" rel="noopener"
                  @click.stop :title="`Abrir ${i.Key} en Jira`">{{ i.Key }} <span class="ext">↗</span></a>
                <span v-else class="key">{{ i.Key }}</span>
                <span class="status" :class="statusClass(i.StatusCategory)">{{ i.Status }}</span>
              </div>
              <div class="tt">{{ i.Summary }}</div>
              <!-- lo que HOY dice Jira: lo que el equipo lee. Si está vacía, se avisa (falta definirla) -->
              <p v-if="i.Description" class="jd" :title="i.Description">{{ i.Description }}</p>
              <p v-else class="jd none">sin descripción en Jira</p>
              <div class="tm">
                <span v-if="settings.trackPoints && i.HasPoints && i.Points">{{ i.Points }} pts</span>
                <span v-if="settings.trackTime">{{ hhmm(i.SpentSecs) }} en Jira</span>
                <span class="mine" v-if="minutesOf(i.Key)">{{ minHhmm(minutesOf(i.Key)) }} sin subir</span>
              </div>
            </div>
          </template>
        </section>

        <section class="card">
          <h2>Bitácora <span class="mut" v-if="active">de {{ active.Key }}</span></h2>
          <p class="empty">La escribe el asistente al analizar la tarea; acá se lee.</p>
          <p v-if="!ofActive.length" class="msg">Sin entradas para esta tarea todavía.</p>
          <div v-for="e in ofActive" :key="e.id" class="entry">
            <span class="icon" :class="'t-' + e.kind">{{ KINDS.find(t => t.id === e.kind)?.icon }}</span>
            <div class="body">
              <div class="meta">
                <b>{{ KINDS.find(t => t.id === e.kind)?.label }}</b>
                <span>{{ when(e.date) }}</span>
                <span class="min">{{ e.min }} min</span>
                <button class="x" title="Borrar (queda marcado en la base, no se pierde)" @click="deleteEntry(e.id)">✕</button>
              </div>
              <p>{{ e.text }}</p>
            </div>
          </div>
        </section>
      </div>
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

/* engranaje de ajustes: los checks de campos de la empresa. `pushed` lo empuja a la derecha cuando no
   hay barra de sprint que ya ocupe el margen automático */
.settings { position: relative }
.settings.pushed { margin-left: auto }
.gear { border: 1px solid var(--line); background: var(--panel2); color: var(--mut); width: 32px; height: 32px;
  border-radius: 9px; cursor: pointer; font-size: 15px; line-height: 1; transition: .12s }
.gear:hover, .gear.on { color: var(--txt); border-color: var(--acc) }
.backdrop { position: fixed; inset: 0; z-index: 9 }
.pop { position: absolute; right: 0; top: 40px; z-index: 10; width: 258px; background: var(--panel);
  border: 1px solid var(--line); border-radius: 12px; padding: 13px; box-shadow: 0 10px 30px #000a }
.pop-h { font-size: 11px; text-transform: uppercase; letter-spacing: .6px; color: var(--mut); font-weight: 700; margin-bottom: 8px }
.pop label { display: flex; gap: 9px; padding: 7px 0; cursor: pointer; align-items: flex-start }
.pop label input { width: auto; margin-top: 1px; accent-color: var(--acc); cursor: pointer }
.pop label span { font-size: 13px; color: var(--txt); line-height: 1.3 }
.pop label em { display: block; font-style: normal; font-size: 11px; color: var(--mut); margin-top: 1px }
.pop .hint { margin: 9px 0 0; padding-top: 9px; border-top: 1px solid var(--line); font-size: 11px; color: var(--mut); line-height: 1.45 }

.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 16px }
.stat { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 15px 16px }
.stat .k { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; color: var(--mut) }
.stat .v { font-size: 27px; font-weight: 800; margin: 6px 0 2px; letter-spacing: -.5px; font-variant-numeric: tabular-nums }
.stat .s { font-size: 11.5px; color: var(--mut) }
.stat.alert .v { color: var(--warn) }
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
.status { font-size: 10.5px; padding: 2px 8px; border-radius: 999px; border: 1px solid }
.e-ok { color: #4ade80; border-color: #256b41; background: #0e2718 }
.e-doing { color: #60a5fa; border-color: #29456e; background: #11203a }
.e-todo { color: #94a3b8; border-color: #3a4453; background: #1b212b }
.tt { font-size: 13.5px; line-height: 1.35; margin-bottom: 6px }
/* descripción real de Jira: recortada a 3 líneas para que el listado siga siendo escaneable
   (el texto completo va en el title). Vacía = aviso, porque falta definirla. */
.jd { font-size: 12px; line-height: 1.45; color: var(--mut); margin: 0 0 7px;
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden }
.jd.none { font-style: italic; opacity: .6 }
.tm { display: flex; gap: 12px; font-size: 11.5px; color: var(--mut) }
.tm .mine { color: var(--acc) }

/* la tarjeta "La tarea": las dos verdades (real privada / reportada Jira) + definición + estimado */
.dual { display: flex; gap: 26px; flex-wrap: wrap; margin-bottom: 15px }
.lane { display: flex; flex-direction: column; gap: 7px }
.lane-k { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; color: var(--mut) }
.lane-k em { font-style: normal; text-transform: none; letter-spacing: 0; color: var(--mut); opacity: .7; font-weight: 400; margin-left: 5px }
.fld { display: block; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; color: var(--mut); margin-bottom: 7px }
.fld em { font-style: normal; text-transform: none; letter-spacing: 0; opacity: .7; font-weight: 400; margin-left: 5px }
/* descripción completa de Jira (acá NO se recorta: es la vista de detalle de la tarea elegida) */
.desc { font-size: 13px; line-height: 1.55; color: var(--txt); margin: 0; white-space: pre-wrap }
.desc.none { color: var(--mut); font-style: italic }
.lane .val { font-size: 13.5px; font-weight: 700; font-variant-numeric: tabular-nums }

/* encabezado de grupo de esfuerzo en el listado */
.grp { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .6px; color: var(--acc);
  margin: 14px 0 8px; display: flex; align-items: center; gap: 7px }
.grp::before { content: '◆'; font-size: 9px }
.grp:first-child { margin-top: 0 }
.grp.none { color: var(--mut) } .grp.none::before { content: '○' }
/* etapa del esfuerzo: evaluar → trabajar → crear las tareas */
.stg { font-size: 9.5px; font-weight: 700; letter-spacing: .3px; padding: 2px 7px; border-radius: 999px;
  border: 1px solid var(--line); color: var(--mut); text-transform: none; white-space: nowrap }
.s-work { color: #f6c667; border-color: #4a3a16; background: #241a08 }
.s-tasks { color: #4ade80; border-color: #256b41; background: #0e2718 }


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
.live { width: 6px; height: 6px; border-radius: 50%; background: #4ade80; display: inline-block }
.empty { color: var(--mut); font-size: 12.5px; margin: 0 0 14px; max-width: 62ch }

/* ── mapa de jornada ──────────────────────────────────────────────────────────────────────────
   Filas = horas laborales (8→18), columnas = últimos 20 días, intensidad = FOCO (minutos de la tarea
   dominante de esa hora, sobre 60). Las celdas SIN registro van rayadas en vez de vacías: un hueco
   liso se lee como "cero" y un rayado como "no hubo registro". El almuerzo (12–2) se marca solo con la
   etiqueta en violeta, no se apaga: a veces se trabaja ahí y tiene que verse igual que cualquier hora. */
/* --cel/--gap/--jhl/--sep los inyecta el script (`gridVars`), que es donde viven las medidas: la banda
   de sprints tiene que sumar los márgenes en JS para posicionarse, así que no pueden estar en dos lados. */
.jm { display: flex; flex-direction: column; gap: var(--gap); overflow-x: auto }
.jrow { display: flex; align-items: center; gap: var(--gap) }
.jhl { width: var(--jhl); flex: none; font-size: 10.5px; font-weight: 700; color: var(--mut); text-align: right;
  font-variant-numeric: tabular-nums }
.cel { width: var(--cel); height: 21px; border-radius: 5px; flex: none; transition: .12s }
/* el finde solo atenúa el FONDO: si una celda tiene registro, el color no se toca — sería mentirle al
   ojo sobre cuánto tiempo hubo ahí */
.cel.weekend.n0 { opacity: .45 }
.cel:hover { outline: 2px solid var(--acc); outline-offset: 1px }
.n0 { background: repeating-linear-gradient(-45deg, #ffffff09 0 3px, transparent 3px 6px), var(--panel2) }
.n1 { background: #a78bfa38 } .n2 { background: #a78bfa70 } .n3 { background: #a78bfaad } .n4 { background: #a78bfa }
/* frontera de sprint: un MARGEN, no una línea. El aire extra antes de la primera columna del sprint y
   después de la última separa los bloques sin sumarle tinta a la grilla. Va en las tres clases de fila
   (horas, totales, fechas) para que las columnas no se desalineen. */
.cel.spStart { margin-left: var(--sep) }
.cel.spEnd { margin-right: var(--sep) }
/* almuerzo: NO se apaga. Se trabaja ahí a veces y hay que verlo igual que cualquier hora. Solo queda
   marcado con la etiqueta en violeta, para que se lea "esto es el almuerzo" sin restarle a la data. */
.jrow.lunch .jhl { color: var(--acc); opacity: .8 }
/* aire entre 11a|12p y 1p|2p: la jornada se lee en tres bloques (mañana · almuerzo · tarde) */
.jrow.gapTop { margin-top: 7px }
/* banda de sprints: una tira arriba de la grilla; cada tramo se posiciona (left/width por spanStyle)
   sobre las columnas de su sprint. Los huecos entre tramos son los días sin sprint. */
.jband { position: relative; height: 17px; margin-bottom: 3px }
.jspan { position: absolute; top: 0; height: 100%; display: flex; align-items: center; padding: 0 7px;
  font-size: 10px; font-weight: 700; color: var(--mut); white-space: nowrap; overflow: hidden;
  border-radius: 5px 5px 0 0; background: var(--panel2);
  box-shadow: inset 0 -2px 0 var(--line), inset 2px 0 0 var(--line), inset -2px 0 0 var(--line) }
/* el sprint que estás viendo arriba se resalta acá, para atar el mapa al selector */
.jspan.sel { color: var(--acc); background: #a78bfa1f;
  box-shadow: inset 0 -2px 0 var(--acc), inset 2px 0 0 var(--acc), inset -2px 0 0 var(--acc) }
.jtot .cel { height: 16px; background: none; font-size: 9.5px; color: var(--mut); text-align: center;
  font-variant-numeric: tabular-nums }
.jaxis .cel { height: auto; background: none; font-size: 10px; color: var(--mut); text-align: center }
.jtot .cel:hover, .jaxis .cel:hover { outline: none }
.legend { display: flex; align-items: center; gap: 5px; margin-top: 12px; font-size: 11px; color: var(--mut) }
.legend i { width: 13px; height: 13px; border-radius: 4px; display: inline-block }
.legend .note { margin-left: 12px }

.entry { display: flex; gap: 11px; padding: 11px 0; border-top: 1px solid var(--line) }
.entry .x { margin-left: auto; border: 0; background: none; color: var(--mut); cursor: pointer; font-size: 12px;
  opacity: 0; transition: .12s; padding: 0 2px }
.entry:hover .x { opacity: .7 } .entry .x:hover { color: var(--bad); opacity: 1 }
.entry:first-of-type { border-top: none }
.icon { width: 24px; height: 24px; border-radius: 8px; display: grid; place-items: center; font-size: 11px; flex: none; background: #ffffff0d }
.t-finding { color: var(--warn) } .t-test { color: #4ade80 } .t-blocker { color: var(--bad) } .t-progress { color: var(--acc) }
.body { min-width: 0 }
.meta { display: flex; gap: 10px; font-size: 11px; color: var(--mut); margin-bottom: 3px }
.meta b { color: var(--txt) }
.meta .min { color: var(--acc) }
.entry p { margin: 0; font-size: 13px; line-height: 1.5 }
.msg { color: var(--mut); font-size: 13px }
.msg.bad { color: var(--bad) }
</style>
