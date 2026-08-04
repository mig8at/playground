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

// ── traer de Jira: registrar lo que está a mi nombre y no tengo local ───────────────────────────────
// Todo el resto del tablero mira el SPRINT del board 384. Esto mira la ASIGNACIÓN, que es más ancha:
// también trae otros boards (LO, QC) y sprints viejos. Sin esta vista, una tarea asignada fuera de esa
// ventana no aparecía en ningún lado — ni para registrarla ni para saber que faltaba.
//
// NO se carga al abrir la página: son 70+ issues y se usa de vez en cuando (sprint nuevo, alguien te
// asignó algo). Va con botón para no pagar una llamada a Jira en cada recarga.
const inbox = ref(null);
const inboxAll = ref(false);       // incluir las terminadas (nacen archivadas)
const inboxBusy = ref(false);
const inboxError = ref('');
const importBusy = ref(false);
const importResults = ref([]);
// clave → qué hacer con ella: '' no traer · 'new' archivo nuevo · '<id>' enlazar a esa tarea local
const picks = ref({});

// El server ya manda SOLO lo que falta: las que están registradas vienen como número (`registered`).
const inboxPending = computed(() => inbox.value?.issues || []);
const picked = computed(() => Object.entries(picks.value).filter(([, v]) => v));
const ACTION_LABEL = {
  created: 'quedó en', linked: 'enlazada a', already: 'ya estaba en', error: 'falló:',
};

async function loadInbox() {
  inboxBusy.value = true; inboxError.value = ''; importResults.value = [];
  try {
    const j = await (await fetch(`${SERVER}/api/jira-inbox${inboxAll.value ? '?all=1' : ''}`)).json();
    if (j.error) { inboxError.value = j.error; return; }
    inbox.value = j;
    // El candidato parecido viene PRESELECCIONADO como enlace, no como archivo nuevo: cuando el
    // parecido es alto suele ser la misma tarea con otro nombre (el título viajó tal cual a Jira), y
    // crear un archivo la duplicaría. Se puede cambiar en el select — la decisión sigue siendo tuya.
    picks.value = Object.fromEntries(
      j.issues.map(f => [f.issue.key, f.suggestion ? String(f.suggestion.id) : '']),
    );
  } catch { inboxError.value = 'no se pudo hablar con el server'; }
  finally { inboxBusy.value = false; }
}

// pickAll respeta lo ya sugerido: "todas como tarea nueva" no pisa un enlace propuesto, porque
// justamente ese es el caso en que crear un archivo estaría mal.
function pickAll(v) {
  const p = { ...picks.value };
  for (const f of inboxPending.value) {
    p[f.issue.key] = v === 'new' && f.suggestion ? String(f.suggestion.id) : v;
  }
  picks.value = p;
}

async function runImport() {
  const create = [], link = {};
  for (const [key, v] of picked.value) {
    if (v === 'new') create.push(key); else link[key] = Number(v);
  }
  importBusy.value = true; importResults.value = [];
  try {
    const res = await fetch(`${SERVER}/api/jira-import`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ create, link }),
    });
    const j = await res.json();
    if (j.error) { inboxError.value = j.error; return; }
    // Los tres estados que cambiaron: las tareas locales (hay archivos nuevos), los vínculos (el
    // listado del sprint se agrupa con ellos) y el cruce (lo traído ya no está pendiente).
    await loadEfforts(); await loadTaskLocals(); await loadInbox();
    // El resultado se pone DESPUÉS del refresco: loadInbox() lo limpia al arrancar —para que una
    // búsqueda nueva no muestre el resultado de la anterior— y ponerlo antes lo borraba justo acá,
    // dejando la importación sin decir qué archivo tocó.
    importResults.value = j.results || [];
  } catch { inboxError.value = 'no se pudo hablar con el server'; }
  finally { importBusy.value = false; }
}
// listado agrupado por esfuerzo; las sin asignar van al final. El encabezado del grupo solo aparece si
// hay al menos un esfuerzo en juego (si no, el listado va plano como antes).
const groupedIssues = computed(() => {
  // `issues` ya viene ordenado nuevo → viejo desde el server; acá se PRESERVA ese orden en los dos
  // niveles: dentro de cada grupo, y entre grupos (manda el grupo cuya tarea más nueva aparece antes).
  // Las sin esfuerzo van al final, para que lo agrupado se lea primero.
  const byEffort = new Map();
  const orden = [];
  for (const i of issues.value) {
    const eid = taskLocals.value[i.Key]?.effortId || 0;
    if (!byEffort.has(eid)) { byEffort.set(eid, []); if (eid) orden.push(eid); }
    byEffort.get(eid).push(i);
  }
  const groups = orden.map(eid => ({
    id: eid,
    title: efforts.value.find(e => e.id === eid)?.title || 'Esfuerzo',
    tasks: byEffort.get(eid),
  }));
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
  // manda la FECHA, no la etiqueta de Jira: un sprint sin "start" sigue en `future` aunque su ventana ya
  // haya arrancado, y decir "arranca en 0 días" sobre el sprint en el que estás trabajando es absurdo.
  if (now < start) return { state: 'upcoming', startsIn: d(start, now) };
  if (now > end) return { state: 'closed', endedAgo: d(now, end) };
  // `pct` es lo CONSUMIDO, para poder pintarlo: "2 días restantes" no dice si son 2 de 3 o 2 de 14.
  const total = Math.max(1, d(end, start));
  return { state: 'ongoing', remaining: d(end, now), pct: Math.min(100, Math.round(100 * d(now, start) / total)) };
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
// Qué entradas están desplegadas. Las notas de la bitácora son párrafos largos a propósito (las escribe
// el asistente con el porqué completo); mostrarlas enteras convierte la lista en un muro y se deja de
// escanear. Colapsadas a 3 líneas la bitácora vuelve a ser un índice, y el detalle está a un clic.
const abiertas = ref(new Set());
const alternar = (id) => { const s = new Set(abiertas.value); s.has(id) ? s.delete(id) : s.add(id); abiertas.value = s; };
const descAbierta = ref(false);
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

// ── handoff a QA: pasar a pruebas y avisarle a quien valida, en un solo click ────────────────────
// Es la única acción del tablero que ESCRIBE en Jira. Dos pasos que en la vida real son uno: mover la
// tarjeta y que el que prueba se entere. Separados, el aviso se olvida.
//
// El mensaje se PREVISUALIZA y se puede editar antes de salir: nunca se manda algo que no se vio. El
// server lo re-valida contra el guard (el mismo de la bitácora) antes de publicarlo en Slack.
const qa = ref(null); // null = panel cerrado; si no: { key, text, transition, name, email, blocked }
const qaBusy = ref(false);
const qaDone = ref('');   // resultado del último envío, para mostrarlo en la tarjeta
const qaError = ref('');
const qaProblems = ref([]);

// En pruebas ya no hay nada que avisar; el botón solo aparece antes de eso.
const inTesting = computed(() => /pruebas/i.test(active.value?.Status || ''));

async function openQA() {
  qaError.value = ''; qaProblems.value = []; qaDone.value = '';
  qaBusy.value = true;
  try {
    const j = await (await fetch(`${SERVER}/api/qa-notice?key=${active.value.Key}`)).json();
    if (j.error) qaError.value = j.error; else qa.value = j;
  } catch { qaError.value = 'no se pudo hablar con el server (¿está corriendo en :8787?)'; }
  qaBusy.value = false;
}

async function sendQA() {
  qaError.value = ''; qaProblems.value = [];
  qaBusy.value = true;
  try {
    const res = await fetch(`${SERVER}/api/qa-notice`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: qa.value.key, text: qa.value.text }),
    });
    const j = await res.json();
    if (j.problems) qaProblems.value = j.problems;
    if (j.error && !j.moved) { qaError.value = j.error; }
    else if (j.moved && !j.sent) {
      // Movida pero sin avisar: se dice tal cual. Dar por hecho el aviso es peor que el error.
      qaDone.value = `Movida a ${j.moved}, pero el DM NO salió: ${j.error}`;
      qa.value = null;
      await loadSprint(sprint.value?.id);
    } else {
      qaDone.value = `Movida a ${j.moved} y avisado por DM a ${j.name}.`;
      qa.value = null;
      await loadSprint(sprint.value?.id); // el estado de Jira cambió: recargar en vez de simularlo acá
    }
  } catch { qaError.value = 'no se pudo hablar con el server'; }
  qaBusy.value = false;
}

// Cambiar de tarea cierra el panel: un mensaje armado para una tarea no puede quedar abierto sobre otra.
watch(active, () => { qa.value = null; qaDone.value = ''; qaError.value = ''; qaProblems.value = []; });

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
        <span v-else-if="sprintDays?.state === 'closed'" class="chip warn">cerrado hace {{ sprintDays.endedAgo }} día{{ sprintDays.endedAgo === 1 ? '' : 's' }}</span>
        <span v-else-if="sprintDays?.state === 'ongoing'" class="chip chip-bar">{{ sprintDays.remaining }} días restantes<i class="mini"><b :style="{ width: sprintDays.pct + '%' }"></b></i></span>
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
          <!-- La barra dice de un vistazo lo que el número obliga a dividir mentalmente. -->
          <div class="bar" v-if="issues.length"><i :style="{ width: (100 * done / issues.length) + '%' }"></i></div>
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
             asistente por la API), no de esta vista. LA ÚNICA EXCEPCIÓN es el handoff a QA de abajo:
             pasar a pruebas y avisar es un mismo acto, y partirlo en dos es lo que hace que el aviso
             se olvide. -->
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

        <!-- Handoff a QA. El botón desaparece cuando ya está en pruebas: ahí no hay nada que avisar. -->
        <div class="qa">
          <button v-if="!inTesting && !qa" class="qa-go" :disabled="qaBusy" @click="openQA()">
            🧪 Enviar a pruebas y avisar
          </button>
          <p v-if="qaDone" class="qa-done">{{ qaDone }}</p>
          <p v-if="qaError" class="qa-err">{{ qaError }}</p>

          <div v-if="qa" class="qa-box">
            <p class="qa-head">
              <span v-if="qa.transition">Va a moverla: <b>{{ qa.transition.name }}</b> → <b>{{ qa.transition.to }}</b></span>
              <span v-else class="qa-err">{{ qa.blocked }}</span>
            </p>
            <label class="fld">El mensaje <em>DM a {{ qa.name || qa.email }} — editalo si querés</em></label>
            <textarea v-model="qa.text" rows="7" spellcheck="false"></textarea>
            <ul v-if="qaProblems.length" class="qa-bad">
              <li v-for="(p, i) in qaProblems" :key="i">{{ p.what }}: «{{ p.found }}»</li>
            </ul>
            <div class="qa-acts">
              <button class="qa-go" :disabled="qaBusy || !qa.transition || !qa.text.trim()" @click="sendQA()">
                {{ qaBusy ? 'Enviando…' : 'Mover y avisar' }}
              </button>
              <button class="qa-no" :disabled="qaBusy" @click="qa = null">Cancelar</button>
            </div>
          </div>
        </div>

        <label class="fld">Descripción <em>lo que hoy dice Jira</em>
          <!-- Colapsada por defecto: es material de REFERENCIA (contexto, criterios, dependencias), no
               lectura diaria. Entera empuja la bitácora —que sí se consulta seguido— fuera de pantalla. -->
          <button class="mas" @click="descAbierta = !descAbierta">{{ descAbierta ? 'contraer' : 'ver completa' }}</button>
        </label>
        <!-- HTML renderizado por Jira (renderedFields). Solo lectura: el tablero es visual, el que
             actualiza en Jira es el asistente por la API. Los checkboxes se ven pero no se togglean. -->
        <div v-if="active.DescriptionHTML" class="desc jira-html" :class="{ recortada: !descAbierta }" v-html="active.DescriptionHTML"></div>
        <p v-else-if="active.Description" class="desc" :class="{ recortada: !descAbierta }">{{ active.Description }}</p>
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
                <!-- de qué sprint viene: verde = nació en su sprint · rojo = la arrastraron sin terminar -->
                <span v-if="i.OriginSprint" class="orig" :class="{ carried: i.CarriedOver }"
                  :title="i.CarriedOver ? `Nació en ${i.OriginSprint} y se arrastró sin terminar` : `Nació en ${i.OriginSprint}`">
                  <i></i>{{ i.OriginSprint }}
                </span>
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
          <!-- Timeline: el riel vertical hace que se lea como lo que es, un registro en el tiempo, y no
               como una lista de párrafos sueltos. El marcador lleva el color del tipo. -->
          <div v-for="e in ofActive" :key="e.id" class="entry" :class="{ abierta: abiertas.has(e.id) }">
            <span class="icon" :class="'t-' + e.kind">{{ KINDS.find(t => t.id === e.kind)?.icon }}</span>
            <div class="body">
              <div class="meta">
                <b :class="'t-' + e.kind">{{ KINDS.find(t => t.id === e.kind)?.label }}</b>
                <span>{{ when(e.date) }}</span>
                <span class="min" v-if="e.min">{{ e.min }} min</span>
                <button class="x" title="Borrar (queda marcado en la base, no se pierde)" @click="deleteEntry(e.id)">✕</button>
              </div>
              <p @click="alternar(e.id)">{{ e.text }}</p>
              <button v-if="e.text && e.text.length > 180" class="mas" @click="alternar(e.id)">
                {{ abiertas.has(e.id) ? 'ver menos' : 'ver más' }}
              </button>
            </div>
          </div>
        </section>
      </div>

      <!-- TRAER DE JIRA. La única vista que mira por ASIGNACIÓN y no por sprint, y la única que CREA
           una tarea local. Va al final y colapsada porque es mantenimiento del registro, no la
           operación del día: se abre cuando arranca un sprint o cuando alguien te asigna algo. -->
      <section class="card">
        <h2>Traer de Jira <span class="mut">· lo que está a mi nombre en CORE y no en el registro local</span></h2>
        <div class="sync-h">
          <button class="qa-go" :disabled="inboxBusy" @click="loadInbox()">
            {{ inboxBusy ? 'Preguntando a Jira…' : inbox ? 'Volver a mirar' : 'Buscar lo que falta' }}
          </button>
          <label class="sync-all">
            <input type="checkbox" v-model="inboxAll" @change="inbox && loadInbox()" />
            <span>incluir terminadas <em>nacen archivadas</em></span>
          </label>
          <span v-if="inbox" class="chip">
            {{ inbox.pending }} sin registro
            <template v-if="inbox.registered"> · {{ inbox.registered }} ya registradas</template>
          </span>
        </div>
        <p v-if="inboxError" class="msg bad">{{ inboxError }}</p>

        <template v-if="inbox">
          <p v-if="!inboxPending.length" class="msg">
            Todo lo que está a tu nombre ya tiene tarea local{{ inboxAll ? '' : ' (sin contar las terminadas)' }}.
          </p>
          <template v-else>
            <div class="sync-acts">
              <span class="mut">{{ picked.length }} de {{ inboxPending.length }} elegidas</span>
              <button class="lnk" @click="pickAll('new')">todas como tarea nueva</button>
              <button class="lnk" @click="pickAll('')">ninguna</button>
            </div>

            <div v-for="f in inboxPending" :key="f.issue.key" class="sync-row" :class="{ off: !picks[f.issue.key] }">
              <select v-model="picks[f.issue.key]">
                <option value="">— no traer —</option>
                <option value="new">crear tarea local</option>
                <option v-for="e in inbox.efforts" :key="e.id" :value="String(e.id)">
                  enlazar a {{ e.file }}{{ e.archived ? ' (archivada)' : '' }}
                </option>
              </select>
              <div class="sync-i">
                <p class="sync-t">
                  <a v-if="site" class="key link" :href="jiraLink(f.issue.key)" target="_blank" rel="noopener"
                    @click.stop>{{ f.issue.key }} <span class="ext">↗</span></a>
                  <span v-else class="key">{{ f.issue.key }}</span>
                  <b :class="statusClass(f.issue.category)">{{ f.issue.status }}</b>
                  {{ f.issue.summary }}
                </p>
                <p class="sync-m">
                  creada {{ f.issue.created }} · movida {{ f.issue.updated }}
                  <template v-if="f.issue.sprints?.length"> · {{ f.issue.sprints.at(-1) }}</template>
                  <template v-if="f.issue.reporter"> · la reporta {{ f.issue.reporter }}</template>
                  <span v-if="f.suggestion" class="sync-sug">
                    se parece {{ Math.round(f.suggestion.score * 100) }}% a {{ f.suggestion.file }}
                  </span>
                </p>
              </div>
            </div>

            <button class="qa-go" :disabled="!picked.length || importBusy" @click="runImport()">
              {{ importBusy ? 'Registrando…' : `Traer ${picked.length}` }}
            </button>
          </template>

          <ul v-if="importResults.length" class="sync-res">
            <li v-for="r in importResults" :key="r.key" :class="{ bad: r.action === 'error' }">
              <b>{{ r.key }}</b> {{ ACTION_LABEL[r.action] || r.action }}
              <span class="mut">{{ r.file || r.error }}</span>
              <span v-if="r.archived" class="chip">archivada</span>
            </li>
          </ul>
        </template>
      </section>
    </template>
  </div>
</template>

<style scoped>
.wrap { max-width: 1180px; margin: 0 auto; padding: 26px 22px 60px }
header { display: flex; align-items: center; gap: 14px; margin-bottom: 22px; flex-wrap: wrap; row-gap: 10px }
.logo { width: 38px; height: 38px; border-radius: 11px; display: grid; place-items: center; font-weight: 800;
  color: #0b0713; font-size: 19px; background: linear-gradient(135deg, #a78bfa, #60a5fa) }
h1 { font-size: 20px; margin: 0; letter-spacing: .2px }
.sub { color: var(--mut); font-size: 13px; margin: 2px 0 0 }
.sp { margin-left: auto; display: flex; align-items: center; gap: 10px; font-size: 13px }
.chip { padding: 4px 11px; border-radius: 999px; border: 1px solid var(--line); color: var(--mut); font-size: 12px; white-space: nowrap }
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
.stat { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 15px 16px;
  box-shadow: 0 1px 2px #00000040, 0 6px 16px #0000001f }
.stat .k { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; color: var(--mut) }
.stat .v { font-size: 27px; font-weight: 800; margin: 6px 0 2px; letter-spacing: -.5px; font-variant-numeric: tabular-nums }
.stat .s { font-size: 11.5px; color: var(--mut) }
.stat.alert .v { color: var(--warn) }
.stat.ok .v { color: var(--acc) }

.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: start }
@media (max-width: 940px) { .cols { grid-template-columns: 1fr } }
.card { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 18px; margin-bottom: 16px;
  box-shadow: 0 1px 2px #00000040, 0 6px 16px #0000001f }
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
/* origen de la tarea: el punto dice si cerró en su sprint (verde) o la arrastraron (rojo) */
.orig { display: inline-flex; align-items: center; gap: 5px }
.orig i { width: 7px; height: 7px; border-radius: 50%; background: #4ade80; flex: none }
.orig.carried { color: var(--bad) }
.orig.carried i { background: var(--bad) }

/* la tarjeta "La tarea": las dos verdades (real privada / reportada Jira) + definición + estimado */
.dual { display: flex; gap: 26px; flex-wrap: wrap; margin-bottom: 15px }
.lane { display: flex; flex-direction: column; gap: 7px }
.lane-k { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; color: var(--mut) }
.lane-k em { font-style: normal; text-transform: none; letter-spacing: 0; color: var(--mut); opacity: .7; font-weight: 400; margin-left: 5px }
.fld { display: flex; align-items: baseline; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; color: var(--mut); margin-bottom: 7px }
.fld em { font-style: normal; text-transform: none; letter-spacing: 0; opacity: .7; font-weight: 400; margin-left: 5px }
/* descripción completa de Jira (acá NO se recorta: es la vista de detalle de la tarea elegida) */
.desc { font-size: 13px; line-height: 1.55; color: var(--txt); margin: 0; white-space: pre-wrap }
.desc.none { color: var(--mut); font-style: italic }
/* descripción renderizada por Jira (HTML). El scoped no llega al v-html → :deep(). SOLO LECTURA:
   el tablero es visual; el asistente actualiza en Jira. Los checkboxes se ven pero no se togglean. */
.desc.jira-html { white-space: normal }
.jira-html :deep(h1), .jira-html :deep(h2), .jira-html :deep(h3), .jira-html :deep(h4) {
  font-size: 13px; font-weight: 700; color: var(--txt); text-transform: none; letter-spacing: 0; margin: 15px 0 5px }
.jira-html :deep(h1:first-child), .jira-html :deep(h2:first-child), .jira-html :deep(h3:first-child) { margin-top: 0 }
.jira-html :deep(p) { margin: 6px 0 }
.jira-html :deep(ul), .jira-html :deep(ol) { margin: 6px 0; padding-left: 20px }
.jira-html :deep(li) { margin: 3px 0 }
.jira-html :deep(a) { color: var(--acc); text-decoration: none }
.jira-html :deep(a:hover) { text-decoration: underline }
.jira-html :deep(code) { background: var(--panel2); padding: 1px 5px; border-radius: 5px; font-size: 12px }
.jira-html :deep(input) { pointer-events: none; accent-color: var(--acc); margin-right: 5px }
.lane .val { font-size: 13.5px; font-weight: 700; font-variant-numeric: tabular-nums }

/* handoff a QA: la ÚNICA acción de la tarjeta que escribe en Jira y manda un mensaje, así que se ve
   como un botón de acción y no como un link, y el envío pasa por una previsualización editable. */
.qa { margin-bottom: 15px }
.qa-go { border: 1px solid #2a5f43; background: #0e2718; color: #4ade80; font: inherit; font-size: 12.5px;
  font-weight: 600; padding: 7px 13px; border-radius: 9px; cursor: pointer }
.qa-go:hover:not(:disabled) { background: #123420 }
.qa-go:disabled { opacity: .45; cursor: default }
.qa-no { border: 1px solid var(--line); background: none; color: var(--mut); font: inherit;
  font-size: 12.5px; padding: 7px 13px; border-radius: 9px; cursor: pointer }
.qa-no:hover:not(:disabled) { color: var(--txt) }
.qa-box { border: 1px solid var(--line); border-radius: 11px; padding: 13px; margin-top: 10px;
  background: var(--panel2) }
.qa-head { font-size: 12.5px; color: var(--mut); margin: 0 0 11px }
.qa-head b { color: var(--txt); font-weight: 600 }
.qa-box textarea { width: 100%; box-sizing: border-box; background: var(--panel); color: var(--txt);
  border: 1px solid var(--line); border-radius: 9px; padding: 9px 11px; font: inherit; font-size: 12.5px;
  line-height: 1.5; resize: vertical }
.qa-acts { display: flex; gap: 8px; margin-top: 11px }
.qa-done { font-size: 12.5px; color: #4ade80; margin: 9px 0 0 }
.qa-err { font-size: 12.5px; color: var(--bad); margin: 9px 0 0 }
/* el guard: si el aviso menciona algo interno, se listan los motivos y el envío queda rechazado */
.qa-bad { margin: 9px 0 0; padding-left: 18px; font-size: 12px; color: var(--bad) }

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

/* ── Bitácora como TIMELINE ────────────────────────────────────────────────────────────────────
   El riel es un pseudo-elemento sobre la columna del icono, no un borde superior por fila: así la
   línea es CONTINUA entre entradas y se lee como una secuencia en el tiempo. Se corta en la última
   (`:last-of-type`) para que no quede colgando en el vacío. */
.entry { display: flex; gap: 11px; padding: 13px 0; position: relative }
.entry::before { content: ''; position: absolute; left: 11px; top: 0; bottom: 0; width: 1px;
                 background: var(--line) }
.entry:first-of-type::before { top: 18px }
.entry:last-of-type::before { bottom: auto; height: 18px }
.entry .icon { position: relative; z-index: 1; box-shadow: 0 0 0 4px var(--panel) }
/* El párrafo nace CORTADO a 3 líneas: las notas son largas a propósito (traen el porqué completo) y
   enteras convierten la bitácora en un muro que se deja de escanear. El detalle está a un clic. */
.entry p { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
           cursor: pointer }
.entry.abierta p { display: block; overflow: visible }
.entry .mas { border: 0; background: none; color: var(--acc); cursor: pointer; font-size: 11.5px;
              padding: 3px 0 0; font-weight: 600 }
.entry .meta b.t-finding { color: var(--warn) } .entry .meta b.t-test { color: #4ade80 }
.entry .meta b.t-blocker { color: var(--bad) } .entry .meta b.t-progress { color: var(--acc) }

/* ── Barras de progreso ───────────────────────────────────────────────────────────────────────── */
.desc.recortada { max-height: 108px; overflow: hidden;
                  -webkit-mask-image: linear-gradient(#000 60%, transparent) }
.fld .mas { margin-left: auto; text-transform: none; letter-spacing: 0 }

.bar { height: 3px; border-radius: 999px; background: #ffffff14; margin: 2px 0 7px; overflow: hidden }
.bar i { display: block; height: 100%; background: var(--acc); border-radius: 999px;
         transition: width .3s ease }
.chip-bar { display: inline-flex; align-items: center; gap: 8px }
.chip-bar .mini { display: block; width: 34px; height: 3px; border-radius: 999px; background: #ffffff1f }
.chip-bar .mini b { display: block; height: 100%; border-radius: 999px; background: var(--mut) }
.entry .x { margin-left: auto; border: 0; background: none; color: var(--mut); cursor: pointer; font-size: 12px;
  opacity: 0; transition: .12s; padding: 0 2px }
.entry:hover .x { opacity: .7 } .entry .x:hover { color: var(--bad); opacity: 1 }
.icon { width: 24px; height: 24px; border-radius: 8px; display: grid; place-items: center; font-size: 11px; flex: none; background: #ffffff0d }
.t-finding { color: var(--warn) } .t-test { color: #4ade80 } .t-blocker { color: var(--bad) } .t-progress { color: var(--acc) }
.body { min-width: 0 }
.meta { display: flex; gap: 10px; font-size: 11px; color: var(--mut); margin-bottom: 3px }
.meta b { color: var(--txt) }
.meta .min { color: var(--acc) }
.entry p { margin: 0; font-size: 13px; line-height: 1.5 }
.msg { color: var(--mut); font-size: 13px }
.msg.bad { color: var(--bad) }

/* traer de Jira: el cruce contra el registro local. Cada fila es una decisión (no traer / archivo
   nuevo / enlazar), así que el CONTROL va primero y el texto del issue después — se recorre la columna
   de selects de arriba a abajo sin leer todo. Las filas en "no traer" se apagan para que las elegidas
   salten a la vista. */
.sync-h { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 12px }
.sync-all { display: flex; gap: 7px; align-items: flex-start; cursor: pointer; font-size: 12.5px }
.sync-all input { width: auto; accent-color: var(--acc); cursor: pointer; margin-top: 2px }
.sync-all em { display: block; font-style: normal; font-size: 11px; color: var(--mut) }
.sync-acts { display: flex; align-items: center; gap: 14px; padding: 9px 0; border-top: 1px solid var(--line);
  font-size: 12px }
.lnk { border: 0; background: none; color: var(--acc); font: inherit; font-size: 12px; cursor: pointer; padding: 0 }
.lnk:hover { text-decoration: underline }
.sync-row { display: flex; gap: 12px; align-items: flex-start; padding: 9px 0; border-top: 1px solid var(--line) }
.sync-row.off { opacity: .45 }
.sync-row select { flex: none; width: 240px; font-size: 12px; padding: 5px 7px; border-radius: 8px;
  border: 1px solid var(--line); background: var(--panel2); color: var(--txt) }
.sync-i { min-width: 0 }
.sync-t { margin: 0; font-size: 13px; line-height: 1.45; display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap }
.sync-t b { font-size: 10.5px; font-weight: 700; padding: 2px 7px; border-radius: 999px; border: 1px solid;
  white-space: nowrap }
.sync-m { margin: 3px 0 0; font-size: 11px; color: var(--mut) }
.sync-sug { margin-left: 8px; color: var(--acc) }
.sync-res { list-style: none; margin: 14px 0 0; padding: 12px 0 0; border-top: 1px solid var(--line);
  font-size: 12.5px; display: grid; gap: 5px }
.sync-res .bad { color: var(--bad) }
.sync-res .chip { margin-left: 6px; padding: 1px 8px; font-size: 10.5px }
</style>
