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
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';

const SERVER = 'http://localhost:8787';
const BOARD = 384;            // CORE — el proyecto donde están MIS tareas (no LO / Loans Origination)

const loading = ref(true);
const error = ref('');
const sprint = ref(null);
const sprints = ref([]);      // los más recientes, del actual hacia atrás — los usan las bandas de la jornada
const SPRINT_TABS = 4;        // cuántos ofrece el selector del header (los demás sólo pintan banda)
const site = ref('');         // https://<site>.atlassian.net — lo manda el server, sale de su .env
const issues = ref([]);
const active = ref(null);     // tarea sobre la que se está registrando

// ── ajustes del tablero ─────────────────────────────────────────────────────────────────────────
// Flags de "campos de la empresa": tiempo y puntos. OFF por defecto — la empresa no los pide, así que
// el tablero no los muestra. NO tocan el registro personal (bitácora, mapa de foco), que es el núcleo.
// Ya no hay ajustes: puntos y tiempo son campos que la empresa PIDE, así que no se apagan desde acá.
// El engranaje se retiró entero. `settings.json` puede conservar sus claves — nadie las lee.
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
  date: new Date(r.startedAt), sprint: r.sprintId, text: r.note, uploaded: !!r.uploadedAt,
  // El ESFUERZO es lo que de verdad ata una entrada a una tarea: 10 de 18 entradas no tienen
  // `taskKey` (se escribieron sobre el esfuerzo, no sobre el issue de Jira) y sin esto quedaban
  // huérfanas para siempre.
  effortId: r.effortId || 0 });
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
  // UNA sola grilla, sin agrupaciones. Antes se agrupaba por esfuerzo con un encabezado por grupo, y eso
  // cortaba la grilla en bloques: con `auto-fill` cada bloque arranca en línea nueva, así que una fila de
  // 4 columnas quedaba con 1 tarjeta y el resto vacío. Decisión de Miguel (2026-08-19): tarjetas SUELTAS.
  //
  // El dato del grupo NO se pierde — viaja como chip en cada tarjeta (`_esfuerzo` / `_sprint`), que es
  // donde se lee sin partir la grilla. Es el mismo criterio que el chip del sprint en la vista ancha.
  if (vistaAncha.value) {
    const todas = [];
    for (const g of porSprint.value) {
      for (const i of g.issues) todas.push({ ...i, _sprint: g.sprint.name.replace(/^.*?(Sprint)/i, '$1') });
    }
    return [{ id: 0, title: '', tasks: todas }];
  }
  // `issues` ya viene ordenado nuevo → viejo desde el server y ese orden se preserva tal cual.
  const conEsfuerzo = issues.value.map((i) => {
    const eid = taskLocals.value[i.Key]?.effortId || 0;
    const t = eid ? efforts.value.find(e => e.id === eid)?.title : '';
    return t ? { ...i, _esfuerzo: t, _esfuerzoId: eid } : i;
  });
  return [{ id: 0, title: '', tasks: conEsfuerzo }];
});

// Ya no hay encabezados de grupo: la grilla es una sola y el grupo se lee en el chip de la tarjeta.
// El MÉTODO de trabajo, explícito: primero se evalúa, después se trabaja, y las tareas de Jira se
// escriben AL FINAL — recién ahí hay contexto completo para definirlas bien.
const STAGES = [
  { id: 'evaluation', label: 'Evaluando' },
  { id: 'work', label: 'Trabajando' },
  { id: 'tasks', label: 'Tareas creadas' },
];
const stageOf = (id) => STAGES.find(s => s.id === (efforts.value.find(e => e.id === id)?.stage || 'evaluation'));
// PROTOTIPOS del esfuerzo: los html autocontenidos de `data/artifacts/` que sirve el server. Son
// varios porque una tarea suele tener más de un actor o más de un camino, y verlos al lado es lo
// que permite decidir. Se abren en pestaña aparte — son para mirarlos, no para vivir embebidos acá.
const artifactsOf = (id) => efforts.value.find(e => e.id === id)?.artifacts || [];
const openArtifact = (file) => window.open(`${SERVER}/artifacts/${file}`, '_blank', 'noopener');
// los prototipos cuelgan del ESFUERZO, pero se piden desde la tarjeta de una TAREA: se resuelve el
// esfuerzo por su clave, igual que la bitácora
const protosDe = (key) => artifactsOf(taskLocals.value[key]?.effortId || 0);
const protosAbiertos = ref(false);
function verProtos(i) {
  if (protosAbiertos.value && active.value?.Key === i.Key) { protosAbiertos.value = false; return; }
  active.value = i; protosAbiertos.value = true; bitacoraAbierta.value = false; hallazgosAbiertos.value = false;
  ramasAbiertas.value = false; descAbierta.value = false;
}

// ── RAMAS: en qué ramas vive la tarea y hasta dónde llegó cada una ──────────────────────────────
// No se miden acá: el snapshot lo deja `make tareas-ramas` (varias invocaciones de git por repo, hacerlo
// en cada render haría lenta la card). Por eso viene con `medidoEn` y la card muestra la antigüedad: un
// estado de git sin fecha se lee como actual y no lo es.
const ramasSnap = ref({ medidoEn: '', tareas: {} });
async function cargarRamas() {
  try { ramasSnap.value = await (await fetch(`${SERVER}/api/ramas`)).json() || { tareas: {} }; }
  catch { /* sin snapshot todavía: la card lo dice, no es un error */ }
}
// Las ramas cuelgan del ESFUERZO (por id), pero se piden desde la tarjeta de una TAREA — mismo camino
// que la bitácora y los prototipos.
const ramasDe = (key) => {
  const eid = taskLocals.value[key]?.effortId || 0;
  return (ramasSnap.value.tareas || {})[String(eid)] || null;
};
const ramasCuenta = (key) => (ramasDe(key)?.ramas || []).length;
// Los ambientes que aparecen en la medición, en orden de menor a mayor riesgo. Se derivan del dato y no
// se fijan acá: un repo puede no tener `staging`, y listarlo vacío diría "no está mergeado" cuando la
// verdad es "esa rama no existe en ese repo".
const AMB_ORDEN = ['develop', 'staging', 'qa', 'main'];
const ambientesDe = (key) => {
  const vistos = new Set();
  for (const r of ramasDe(key)?.ramas || []) for (const a of Object.keys(r.propios || {})) vistos.add(a);
  return AMB_ORDEN.filter(a => vistos.has(a)).concat([...vistos].filter(a => !AMB_ORDEN.includes(a)).sort());
};
// Del PR interesa el DESENLACE, no el enum: "esperando revisión" y "aprobado" son dos situaciones que
// el estado OPEN solo no distingue — y es justo la diferencia entre "falta trabajo" y "falta que alguien
// lo mire".
const etiquetaPR = (pr) => {
  if (pr.draft) return 'borrador';
  if (pr.estado === 'MERGED') return pr.mergeado ? `mergeado ${pr.mergeado.slice(0, 10)}` : 'mergeado';
  if (pr.estado === 'CLOSED') return 'cerrado sin mergear';
  if (pr.revision === 'APPROVED') return 'aprobado';
  if (pr.revision === 'CHANGES_REQUESTED') return 'piden cambios';
  if (pr.revision === 'REVIEW_REQUIRED') return 'esperando revisión';
  return 'sin revisor pedido';
};
const ramasAbiertas = ref(false);
function verRamas(i) {
  if (ramasAbiertas.value && active.value?.Key === i.Key) { ramasAbiertas.value = false; return; }
  active.value = i; ramasAbiertas.value = true;
  protosAbiertos.value = false; bitacoraAbierta.value = false; hallazgosAbiertos.value = false; descAbierta.value = false;
}
// "hace cuánto se midió", que es la mitad del dato. Sin esto, una medición de la semana pasada se lee
// como el estado de ahora.
const haceCuanto = (iso) => {
  if (!iso) return '';
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 2) return 'recién';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} d`;
};

// ── derivados del sprint ────────────────────────────────────────────────────────────────────────
const done = computed(() => issues.value.filter(i => i.StatusCategory === 'done').length);
const points = computed(() => issues.value.reduce((n, i) => n + (i.Points || 0), 0));

// ── PUNTOS: cuánto de lo comprometido ya CUENTA ────────────────────────────────────────────────
// La regla la fijó Oscar el 2026-08-18: los viernes se miden los puntos, y sólo cuentan las tareas
// en «Terminado» o «En revisión». Todo lo demás vale cero para la métrica, por avanzado que esté.
//
// ⚠ «En pruebas» NO cuenta, y es donde más puntos se quedan varados —a un estado de contar—. Por eso
// existe el desglose: el número solo dice que vas atrás; el desglose dice QUÉ MOVER.
const cuentaParaMetrica = (i) => i.StatusCategory === 'done' || /revisi[oó]n/i.test(i.Status || '');
const ptsComprometidos = computed(() => points.value);
const ptsCuentan = computed(() => issues.value.filter(cuentaParaMetrica).reduce((n, i) => n + (i.Points || 0), 0));
const ptsVarados = computed(() => {
  const m = {};
  for (const i of issues.value) {
    if (cuentaParaMetrica(i) || !(i.Points > 0)) continue;
    m[i.Status] = (m[i.Status] || 0) + i.Points;
  }
  return Object.entries(m).sort((a, b) => b[1] - a[1]);
});
// Tareas sin estimar: la regla dice que TODAS deben tener puntos, incluidas las no planificadas. Una
// sin puntos no baja la métrica — la deja incompleta, que es peor, porque no se nota.
const sinPuntos = computed(() => issues.value.filter(i => !(i.Points > 0)).map(i => i.Key));

// CAPACIDAD: cuántos puntos entran en un sprint, deducido de la tabla de referencia del equipo
// (Oscar, 2026-08-18) y no inventado — ahí un **5 es «cerca de medio sprint»**, así que dos tareas de
// 5 ya lo llenan. De ahí sale el 10.
//
// No es un límite que el tablero imponga: es la vara contra la que mirar lo que uno se comprometió.
// Comprometer el doble no se nota mirando la lista de tareas —son cinco tarjetas, se ven pocas— y sí
// se nota el viernes, cuando la mitad no alcanzó a contar.
const CAPACIDAD = 10;
const sobreCapacidad = computed(() => {
  const c = ptsComprometidos.value;
  if (c <= CAPACIDAD) return null;
  return { pts: c, veces: +(c / CAPACIDAD).toFixed(1), exceso: c - CAPACIDAD };
});
// El desfase contra el CALENDARIO: qué fracción del sprint se consumió contra qué fracción ya cuenta.
// Sólo con el sprint en curso: antes de arrancar o cerrado, comparar contra el calendario es ruido.
const ritmo = computed(() => {
  const d = sprintDays.value;
  if (d?.state !== 'ongoing' || !ptsComprometidos.value) return null;
  const hecho = Math.round(100 * ptsCuentan.value / ptsComprometidos.value);
  return { consumido: d.pct, hecho, atras: Math.max(0, d.pct - hecho), dias: d.remaining };
});
const jiraTime = computed(() => issues.value.reduce((n, i) => n + (i.SpentSecs || 0), 0));
const ofSprint = computed(() => entries.value.filter(e => e.sprint === sprint.value?.id));
const logTime = computed(() => ofSprint.value.reduce((n, e) => n + e.min, 0));

// El chip del header, según el ESTADO del sprint. CORE vive entre sprints (uno cerró, el próximo no
// arrancó), así que un sprint puede no haber empezado: "5 días restantes" sobre algo que aún no empieza
// sería mentira. Tres casos: por arrancar · en curso · cerrado.
const sprintTabs = computed(() => (sprints.value || []).slice(0, SPRINT_TABS));

// ── VISTA «últimos 4 sprints»: todas MIS tareas de la ventana, a lo ancho ────────────────────────
// El tablero mira UN sprint porque su trabajo diario es ese. Pero para ver de dónde viene algo —o qué
// quedó a medias hace tres sprints— hace falta la ventana entera. Es otra VISTA, no otro filtro: cambia
// el ancho de la página (el `.wrap` de 1180px es para leer una columna de tarjetas, no cuatro).
//
// Los issues salen del MISMO endpoint del sprint, que ya filtra `assignee = currentUser()` en Jira: no
// hay un segundo criterio de "mío" que pueda derivar del primero.
const vistaAncha = ref(false);
const cargandoAncha = ref(false);
const porSprint = ref([]);   // [{ sprint, issues }] en el orden de las pestañas

async function cargarUltimos4() {
  cargandoAncha.value = true;
  try {
    // En PARALELO: son 4 llamadas a Jira y en serie se notaba la espera.
    const res = await Promise.all(sprintTabs.value.map(async (s) => {
      try {
        const j = await (await fetch(`${SERVER}/api/sprint?board=${BOARD}&id=${s.id}`)).json();
        return { sprint: s, issues: j.error ? [] : (j.issues || []) };
      } catch { return { sprint: s, issues: [] }; }
    }));
    porSprint.value = res;
  } finally { cargandoAncha.value = false; }
}

// Total de tarjetas visibles: va en el encabezado porque "4 sprints" no dice cuánto trabajo es.
const totalAncha = computed(() => porSprint.value.reduce((n, g) => n + g.issues.length, 0));

async function alternarVista() {
  vistaAncha.value = !vistaAncha.value;
  if (vistaAncha.value && !porSprint.value.length) await cargarUltimos4();
}

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

// ⚠ Sobre TODAS las entradas, no sobre `ofSprint`. La bitácora de una tarea es su HISTORIA: si abrís
// CORE-19 querés leer lo que se escribió sobre CORE-19, sea de qué sprint sea. Filtrarla por el sprint
// activo la vaciaba entera el día que el sprint rotaba —pasó con Sprint 11→12, y las notas parecían
// perdidas cuando estaban ahí—. El filtro por sprint SÍ se queda en los contadores de tiempo
// (`logTime`, `minutesOf`), que es donde significa algo: minutos trabajados EN este sprint.
//
// Se resuelve por esfuerzo además de por clave, igual que `protosDe`: es lo que rescata las entradas
// que no tienen `taskKey`.
const esfuerzoDe = (key) => taskLocals.value[key]?.effortId || 0;
const ofActive = computed(() => {
  if (!active.value) return [];
  const k = active.value.Key, ef = esfuerzoDe(k);
  return entries.value.filter(e => e.key === k || (ef && e.effortId === ef));
});
// Qué entradas están desplegadas. Las notas de la bitácora son párrafos largos a propósito (las escribe
// el asistente con el porqué completo); mostrarlas enteras convierte la lista en un muro y se deja de
// escanear. Colapsadas a 3 líneas la bitácora vuelve a ser un índice, y el detalle está a un clic.
const abiertas = ref(new Set());
const alternar = (id) => { const s = new Set(abiertas.value); s.has(id) ? s.delete(id) : s.add(id); abiertas.value = s; };
// Qué descripciones están desplegadas, POR TAREA (antes era un solo booleano, porque había una única
// tarjeta de detalle). Colapsada por defecto: la descripción de Jira es material de referencia
// —contexto, criterios, dependencias— y entera convierte la grilla de tarjetas en un muro.
// La descripción completa vive en un CAJÓN, igual que Bitácora / Ramas / Prototipos / Hallazgos: es un
// bloque de párrafos y leerlo en una columna de 300px era peor que no tenerlo. Antes se expandía la
// tarjeta a la fila entera, lo que rompía la grilla — el mismo problema de los encabezados de grupo.
const descAbierta = ref(false);
function verDesc(i) {
  if (descAbierta.value && active.value?.Key === i.Key) { descAbierta.value = false; return; }
  active.value = i; descAbierta.value = true;
  ramasAbiertas.value = false; protosAbiertos.value = false; bitacoraAbierta.value = false; hallazgosAbiertos.value = false;
}

// cuántas entradas de bitácora tiene cada tarea — el contador del botón, sin abrir el cajón
const entriesPorTarea = computed(() => {
  const m = {};
  // Cuenta lo MISMO que abre el cajón (todas las entradas, por clave o por esfuerzo). Contaba sobre
  // `ofSprint` y por clave: el botón decía 0 en tareas que sí tenían notas, así que nadie lo abría.
  for (const i of issues.value) {
    const ef = esfuerzoDe(i.Key);
    const n = entries.value.filter(e => e.key === i.Key || (ef && e.effortId === ef)).length;
    if (n) m[i.Key] = n;
  }
  return m;
});

// Abrir la bitácora DE una tarjeta: el cajón lee la tarea activa, así que primero se activa. Sin esto,
// tocar "Bitácora" en una tarjeta abriría la bitácora de otra.
// los dos cajones son excluyentes: abrir uno cierra el otro, o quedan montados los dos encima
const verBitacora = (i) => { active.value = i; bitacoraAbierta.value = true; protosAbiertos.value = false; hallazgosAbiertos.value = false; ramasAbiertas.value = false; descAbierta.value = false; };

// ── hallazgos: los hechos con fecha que la tarea declara en su cuerpo ──────────────────────────
// Vienen del ESFUERZO, igual que los prototipos, y salen del texto: el server los recoge de los
// marcadores `> **MEDICIÓN · fecha** — …`. Ver `server/internal/store/anotaciones.go`.
//
// Lo que aportan sobre la prosa es la EDAD. Una medición de hace dos meses se lee igual de segura
// que la de ayer, y una pregunta abierta hace una semana no le grita a nadie. Acá la edad se ve, y
// eso es lo único que la prosa no puede hacer.
const hallazgosDe = (key) => efforts.value.find(e => e.id === (taskLocals.value[key]?.effortId || 0))?.anotaciones || [];
const hallazgosAbiertos = ref(false);
const verHallazgos = (i) => {
  if (hallazgosAbiertos.value && active.value?.Key === i.Key) { hallazgosAbiertos.value = false; return; }
  active.value = i; hallazgosAbiertos.value = true; bitacoraAbierta.value = false; protosAbiertos.value = false; ramasAbiertas.value = false; descAbierta.value = false;
};
const diasDe = (fecha) => Math.floor((Date.now() - new Date(fecha + 'T12:00:00')) / 86400000);
// Cuándo un hallazgo pide atención. Los umbrales son distintos a propósito: una medición aguanta un
// mes antes de sospechar, pero una pregunta sin responder a los 7 días ya está frenando algo.
const vencido = (a) => a.tipo === 'medicion' ? diasDe(a.fecha) > 30
                     : a.tipo === 'pregunta' ? diasDe(a.fecha) > 7 : false;
const EDAD = { medicion: 'medido hace', pregunta: 'sin responder hace', decision: 'decidido hace', riesgo: 'asumido hace' };
const edadTxt = (a) => { const d = diasDe(a.fecha); return `${EDAD[a.tipo] || 'hace'} ${d === 0 ? 'hoy' : d === 1 ? '1 día' : d + ' días'}`.replace(' hoy', ' hoy').replace(/hace hoy/, 'hoy'); };
const TIPOS = [
  { id: 'medicion', tit: 'Mediciones',  pie: 'Un número sin fecha ni forma de recomprobarlo envejece hasta volverse mentira.' },
  { id: 'decision', tit: 'Decisiones',  pie: 'Con fecha y motivo, para no volver a discutirlas desde cero.' },
  { id: 'pregunta', tit: 'Preguntas',   pie: 'Abiertas, con de quién se espera la respuesta.' },
  { id: 'riesgo',   tit: 'Riesgos',     pie: 'Lo que se aceptó a sabiendas. Cuando muerda, acá está el momento en que se aceptó.' },
];
const hallazgosPorTipo = (key) => TIPOS
  .map(t => ({ ...t, items: hallazgosDe(key).filter(a => a.tipo === t.id) }))
  .filter(g => g.items.length);
// La bitácora vive en un CAJÓN, no en una card del tablero: son notas largas que escribe el asistente y
// que el humano consulta de vez en cuando (quien la lee seguido es un modelo, para retomar contexto).
// Ocupando una columna fija era ruido permanente por algo que no se mira en cada carga. Se abre desde el
// botón de "La tarea" y sigue a la tarea activa: cambiar de tarea con el cajón abierto muestra la suya.
const bitacoraAbierta = ref(false);
// Esc cierra. Va en `window` y no en el elemento: el cajón nace sin foco, así que un @keydown local sólo
// respondería después de hacerle clic — que es justo cuando ya no hace falta el atajo.
const cerrarConEsc = (e) => { if (e.key === 'Escape') { bitacoraAbierta.value = false; protosAbiertos.value = false; hallazgosAbiertos.value = false; ramasAbiertas.value = false; descAbierta.value = false; } };
onMounted(() => window.addEventListener('keydown', cerrarConEsc));
onUnmounted(() => window.removeEventListener('keydown', cerrarConEsc));
const when = (d) => new Date(d).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

// ── mi jornada: los últimos días × horas laborales ──────────────────────────────────────────────
// Este mapa NO va por sprint: muestra cómo se llenó mi horario laboral (8→18, con almuerzo 12→14) en los
// últimos días corridos. La pregunta que contesta es distinta a "en qué trabajé": es "cómo trabajé" —
// mañanas cargadas y tardes flojas, días partidos, jornadas que se estiran. Por eso lee la HORA de cada
// registro, no sólo el día, y es independiente del sprint que estés mirando arriba.
//
// LA FUENTE ES EL PULSO, y sólo el pulso: cuándo toqué los repos de la compañía. La bitácora contesta
// otra pregunta ("en qué trabajé") y vive en su cajón; tenerla acá como segunda fuente obligaba a elegir
// entre dos cosas que no se comparan, en un mapa cuya gracia es que se lee de un vistazo.
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const dayKey = (d) => { const x = startOfDay(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };

const H_START = 8, H_END = 18;               // jornada: 8am a 6pm
const LUNCH = new Set([12, 13]);             // 12→14: se MARCA como almuerzo, pero se registra igual
const HOURS = Array.from({ length: H_END - H_START }, (_, i) => H_START + i); // 8..17 (cada uno = una hora)
const DOW_NAME = ['do', 'lu', 'ma', 'mi', 'ju', 'vi', 'sá'];

// Las medidas de la grilla viven ACÁ y el CSS las lee por variables (`gridVars`). Tienen que estar en un
// solo lado porque el margen entre sprints desplaza las columnas: la banda de arriba no puede
// posicionarse con una fórmula fija, tiene que sumar los márgenes que la preceden. Con las medidas
// repartidas entre CSS y JS, ese cálculo se desincroniza al primer cambio de tamaño.
const CEL = 24, GAP = 4, JHL = 30, SEP = 9; // px: celda · separación normal · etiqueta de hora · margen de sprint
const gridVars = { '--cel': `${CEL}px`, '--gap': `${GAP}px`, '--jhl': `${JHL}px`, '--sep': `${SEP}px` };

// CUÁNTOS DÍAS ENTRAN. La celda mide fijo (no se estira) porque la banda de sprints se posiciona en px
// sumando márgenes: con celdas elásticas ese cálculo se desincroniza. Así que en vez de estirar la
// grilla, se muestran MÁS DÍAS — el ancho disponible decide cuántos. Los días viejos sin actividad
// quedan rayados ("sin registro"), que es la verdad: el pulso no estaba corriendo.
const DAYS_MIN = 14, DAYS_MAX = 60;
const gridW = ref(0);
const gridEl = ref(null);

// las columnas (sólo las fechas) de una ventana de n días terminada hoy
const isoCols = (n) => Array.from({ length: n }, (_, i) => {
  const d = startOfDay(today); d.setDate(d.getDate() - (n - 1 - i));
  return dayKey(d);
});

// Cuánto MIDE la grilla con n columnas. No alcanza con `n × (celda + gap)`: entre sprints hay un margen
// extra (SEP) y con 6 sprints a la vista son ~108 px que desbordaban la card. Y no se puede leer de
// `spans`, porque `spans` depende de `dayCols` y `dayCols` de esto: sería un ciclo. Así que los bordes
// se cuentan acá, directo de las fechas de los sprints, que no dependen de nada de la grilla.
const anchoCon = (n) => {
  const base = JHL + GAP + n * (CEL + GAP);
  const cols = isoCols(n);
  const ini = new Set(), fin = new Set();
  for (const sp of sprints.value || []) {
    if (!sp.startDate || !sp.endDate) continue;
    const s = dayKey(sp.startDate), e = dayKey(sp.endDate);
    let a = -1, b = -1;
    cols.forEach((c, i) => { if (c >= s && c <= e) { if (a < 0) a = i; b = i; } });
    if (a >= 0) { ini.add(a); fin.add(b); }
  }
  return base + SEP * (ini.size + fin.size);
};

// El más grande que entra. Se busca de mayor a menor en vez de despejar la fórmula porque el costo de
// los márgenes no es lineal: sumar un día puede meter un sprint nuevo y con él dos márgenes de golpe.
const days = computed(() => {
  if (!gridW.value) return DAYS_MIN;         // antes de medir: lo mínimo, para no dibujar y re-dibujar
  for (let n = DAYS_MAX; n > DAYS_MIN; n--) if (anchoCon(n) <= gridW.value) return n;
  return DAYS_MIN;
});
// ResizeObserver y no un listener de `resize`: la card cambia de ancho también cuando aparece el
// scrollbar o cuando otra sección crece, sin que la ventana se toque.
//
// Se engancha con un `watch` y NO en `onMounted`: la grilla vive dentro del `v-else` de la carga, así
// que al montar todavía no existe y observarla ahí no observaba nada — la ventana se quedaba en 0 y la
// jornada en el mínimo de días para siempre, sin fallar en ningún lado.
// La medición INICIAL se hace a mano (`offsetWidth`) y el observer queda para los cambios posteriores.
// No es redundante: el callback del observer se entrega con el renderizado, que el navegador suspende
// mientras la pestaña está en segundo plano — si el tablero se abre ahí, la primera medida no llega y la
// jornada se queda en el mínimo hasta que algo la mueva. Medir directo no depende de que se dibuje.
const ro = new ResizeObserver(([e]) => { gridW.value = e.contentRect.width; });
watch(gridEl, (el, viejo) => {
  if (viejo) ro.unobserve(viejo);
  if (!el) return;
  gridW.value = el.offsetWidth;
  ro.observe(el);
}, { immediate: true });
onUnmounted(() => ro.disconnect());

const dayCols = computed(() => Array.from({ length: days.value }, (_, i) => {
  const d = startOfDay(today); d.setDate(d.getDate() - (days.value - 1 - i));
  return { iso: dayKey(d), num: d.getDate(), dow: DOW_NAME[d.getDay()], weekend: [0, 6].includes(d.getDay()) };
}));

const hourLabel = (h) => h === 12 ? '12p' : h === 18 ? '6p' : h < 12 ? `${h}a` : `${h - 12}p`;
const hoursShort = (min) => { if (!min) return ''; const h = min / 60; return (Number.isInteger(h) ? h : h.toFixed(1)) + 'h'; };

// ── el pulso: cuándo toqué los repos de la compañía ─────────────────────────────────────────────
// Lo anota un agente (`server/cmd/pulso`) cada 5 minutos, corra o no el tablero. La unidad es el TRAMO
// DE 5', no los minutos: un commit a las 18:00 no dice cuándo empezaste, así que estimar minutos desde
// git sería inventar. Una hora tiene 12 tramos y la celda se llena con los que tuvieron cambios — el
// total del día es tramos × 5', que sí es una medición.
const pulse = ref({ hours: [], installed: false, lastTick: null, slotsPerHour: 12, slotMinutes: 5 });

// Se pide DAYS_MAX y no `days`, aunque hoy se vean menos: así agrandar la ventana no dispara una llamada
// por cada píxel de arrastre. Son celdas por (día, hora) — 60 días es una respuesta chica.
async function loadPulse() {
  try {
    const j = await (await fetch(`${SERVER}/api/pulse?days=${DAYS_MAX}`)).json();
    if (!j.error) pulse.value = j;
  } catch { /* server caído: `pulseOff` ya avisa que no hay pulso */ }
}

const pulseCells = computed(() => {
  const m = {};
  for (const c of pulse.value.hours || []) (m[c.day] ??= {})[c.hour] = c;
  return m;
});
const codeAt = (iso, h) => pulseCells.value[iso]?.[h];

// TRES estados, no dos, y esa es la diferencia con la bitácora: además de "hubo cambios" y "no hubo",
// el pulso sabe si el agente estaba MIRANDO. Un hueco porque el Mac estaba apagado no es un hueco de
// trabajo, y pintarlos igual convertiría el mapa en una acusación falsa.
const codeClass = (iso, h) => {
  const c = codeAt(iso, h);
  if (!c || (!c.slots && !c.covered)) return 'n0';     // sin registro → rayado (como la bitácora sin datos)
  if (!c.slots) return 'c0';                           // miró y no había nada → liso
  return 'c' + (c.slots <= 2 ? 1 : c.slots <= 5 ? 2 : c.slots <= 9 ? 3 : 4);
};
const slotMin = computed(() => pulse.value.slotMinutes || 5);

const cellTitle = (d, h) => {
  const head = `${d.dow} ${d.num} · ${hourLabel(h)}–${hourLabel(h + 1)}`;
  const c = codeAt(d.iso, h);
  if (!c || (!c.slots && !c.covered)) return `${head} — sin registro: el equipo estaba apagado o el agente detenido`;
  if (!c.slots) return `${head} — sin cambios`;
  const extra = [];
  if (c.commits) extra.push(`${c.commits} commit${c.commits === 1 ? '' : 's'}`);
  if (c.ins || c.del) extra.push(`+${c.ins}/−${c.del}`);
  // Los repos van SIN minutos a propósito: dos repos pueden caer en el mismo tramo, así que sus minutos
  // no suman al total de la celda (que es la UNIÓN). Mostrarlos invitaría a una resta que no cierra.
  const repos = (c.repos || []).map(r => {
    const suyo = [];
    if (r.commits) suyo.push(`${r.commits} commit${r.commits === 1 ? '' : 's'}`);
    if (r.ins || r.del) suyo.push(`+${r.ins}/−${r.del}`);
    return `  ${r.repo}${r.branch ? ` · ${r.branch}` : ''}${suyo.length ? ` — ${suyo.join(' ')}` : ''}`;
  });
  return [`${head} · ${c.slots}/${pulse.value.slotsPerHour} tramos con cambios${extra.length ? ` · ${extra.join(' · ')}` : ''}`, ...repos].join('\n');
};

// El total del día suma TODAS las horas, no sólo las visibles: un commit a las 7am o a las 8pm es
// trabajo igual, y recortarlo al horario de oficina daría un número más bonito y más falso. Lo que quedó
// fuera de la ventana se dice en el tooltip.
const dayMin = (iso) => Object.values(pulseCells.value[iso] || {}).reduce((n, c) => n + c.slots * slotMin.value, 0);
const outsideMin = (iso) => Object.values(pulseCells.value[iso] || {})
  .filter(c => c.hour < H_START || c.hour >= H_END)
  .reduce((n, c) => n + c.slots * slotMin.value, 0);
const dayTitle = (iso) => {
  const fuera = outsideMin(iso);
  return minHhmm(dayMin(iso)) + (fuera ? ` · ${minHhmm(fuera)} fuera de ${hourLabel(H_START)}–${hourLabel(H_END)}` : '');
};
const rangeMin = computed(() => dayCols.value.reduce((n, d) => n + dayMin(d.iso), 0));

// El aviso que evita la conclusión equivocada: una grilla vacía sin agente instalado no dice "no
// trabajé", dice "nadie estaba anotando".
const pulseOff = computed(() => !pulse.value.installed);

// ── tramos de sprint sobre las columnas ─────────────────────────────────────────────────────────
// La ventana cruza sprints (y los huecos entre ellos). Para cada sprint que asoma en el
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

// En pruebas ya no hay nada que avisar; el botón solo aparece antes de eso. Es por TAREA y no sobre la
// activa: ahora cada tarjeta trae su propio botón.
const enPruebas = (i) => /pruebas/i.test(i?.Status || '');

async function openQA(i) {
  active.value = i;   // el panel y el envío leen la activa: se fija antes de pedir nada
  qaError.value = ''; qaProblems.value = []; qaDone.value = '';
  qaBusy.value = true;
  try {
    const j = await (await fetch(`${SERVER}/api/qa-notice?key=${i.Key}`)).json();
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
    // Se piden más de los que el selector muestra: las bandas de «Mi jornada» cubren toda la ventana, y
    // esa ventana crece con el ancho de la pantalla. Con sólo 4, las columnas más viejas quedaban sin
    // banda y parecían días fuera de todo sprint, que es otra cosa.
    const j = await (await fetch(`${SERVER}/api/sprints?board=${BOARD}&n=12`)).json();
    if (!j.error) { sprints.value = j.sprints || []; site.value = j.site || ''; }
  } catch { /* si falla, el selector no aparece y se carga el activo igual */ }

  await loadEfforts();
  cargarRamas();   // el snapshot de ramas (sin await: si no está medido, el botón «Ramas» no aparece y listo)
  await loadPulse();

  // Sin id: el server elige (activo, o el último cerrado, o el próximo). No lo re-derivamos acá para
  // no tener dos definiciones de "cuál es el sprint por defecto".
  await loadSprint();
});
</script>

<template>
  <div class="wrap" :class="{ ancha: vistaAncha }">
    <header>
      <div class="logo">T</div>
      <div>
        <h1>Tablero</h1>
        <p class="sub">Mi sprint · registro de tiempo y hallazgos</p>
      </div>
      <div class="sp" v-if="sprint">
        <!-- `sprintTabs`, no `sprints`: se traen más para las bandas de la jornada, pero el selector
             sigue mostrando los 4 recientes — 12 pestañas ahí serían un menú, no un selector. -->
        <div class="tabs" v-if="sprintTabs.length > 1">
          <button v-for="s in sprintTabs" :key="s.id" :class="{ act: s.id === sprint.id }"
            :title="`${shortDate(s.startDate)} → ${shortDate(s.endDate)}`" @click="loadSprint(s.id)">
            {{ s.name.replace(/^.*?(Sprint)/i, '$1') }}
            <i v-if="s.state === 'active'" class="live" title="sprint activo"></i>
          </button>
        </div>
        <button class="tact vista" :class="{ act: vistaAncha }" @click="alternarVista"
          :title="vistaAncha ? 'volver al sprint' : 'ver mis tareas de los últimos 4 sprints, a lo ancho'">
          {{ vistaAncha ? '← el sprint' : `últimos ${sprintTabs.length} sprints` }}
        </button>
        <span v-if="sprintDays?.state === 'upcoming'" class="chip">arranca en {{ sprintDays.startsIn }} día{{ sprintDays.startsIn === 1 ? '' : 's' }}</span>
        <span v-else-if="sprintDays?.state === 'closed'" class="chip warn">cerrado hace {{ sprintDays.endedAgo }} día{{ sprintDays.endedAgo === 1 ? '' : 's' }}</span>
        <span v-else-if="sprintDays?.state === 'ongoing'" class="chip chip-bar">{{ sprintDays.remaining }} días restantes<i class="mini"><b :style="{ width: sprintDays.pct + '%' }"></b></i></span>
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
        <!-- PUNTOS: ya no es opcional. La empresa los pide desde el 2026-08-18, así que el check que
             los escondía se retiró. -->
        <div class="stat" :class="{ alert: sinPuntos.length }">
          <div class="k">Puntos que cuentan</div>
          <div class="v">{{ ptsCuentan }}<span class="de">/{{ ptsComprometidos }}</span></div>
          <!-- la barra es lo que ya cuenta; la marca, por dónde va el sprint. Relleno a la izquierda
               de la marca = vas atrás, y cuánto se lee sin hacer la cuenta. -->
          <div class="bar" v-if="ptsComprometidos">
            <i :style="{ width: (100 * ptsCuentan / ptsComprometidos) + '%' }"></i>
            <u v-if="ritmo" :style="{ left: ritmo.consumido + '%' }" :title="`el sprint va por el ${ritmo.consumido}%`"></u>
          </div>
          <div class="s" v-if="ritmo && ritmo.atras > 0">{{ ritmo.atras }}% atrás del calendario ·
            quedan {{ ritmo.dias }} {{ ritmo.dias === 1 ? 'día' : 'días' }}</div>
          <div class="s" v-else-if="ritmo">al día con el calendario</div>
          <div class="s" v-else>sólo cuentan Terminado y En revisión</div>
        </div>
        <div class="stat" :class="{ alert: jiraTime === 0 }">
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

      <!-- Lo accionable: el número de arriba dice que vas atrás, esto dice QUÉ MOVER. Casi siempre son
           tareas a un solo estado de contar, y sin verlas se leen como trabajo que no existe. -->
      <p v-if="sobreCapacidad || ptsVarados.length || sinPuntos.length" class="pts-detalle">
        <!-- Lo primero, porque cambia cómo se lee todo lo demás: si te comprometiste al doble de lo
             que entra, ir «atrás del calendario» no es un problema de ritmo. -->
        <span v-if="sobreCapacidad" class="pd-i pd-mal"><b>{{ sobreCapacidad.pts }} pt comprometidos</b>
          · {{ sobreCapacidad.veces }}× tu capacidad (≈{{ CAPACIDAD }}: un 5 es medio sprint)</span>
        <template v-if="ptsVarados.length">
          <span class="pd-k">no cuentan todavía:</span>
          <span v-for="([est, n]) in ptsVarados" :key="est" class="pd-i"><b>{{ n }} pt</b> en {{ est }}</span>
        </template>
        <span v-if="sinPuntos.length" class="pd-i pd-mal"><b>sin estimar:</b> {{ sinPuntos.join(' · ') }}</span>
      </p>

      <section class="card">
        <h2>Mi jornada
          <span class="mut">· últimos {{ days }} días{{ rangeMin ? ` · ${minHhmm(rangeMin)}` : '' }}</span>
        </h2>
        <p class="empty" v-if="pulseOff">El pulso todavía no está corriendo, así que esta grilla no dice
          «no trabajé» — dice que nadie estaba anotando. Se instala una vez y arranca solo con la sesión:
          <code>make pulso-install</code>.</p>
        <p class="empty" v-else-if="!rangeMin">Sin cambios registrados en los últimos {{ days }} días.</p>
        <!-- `gridEl` es lo que mide el ResizeObserver: de su ancho sale cuántos días entran. -->
        <div class="jm" ref="gridEl" :style="gridVars">
          <div class="jband">
            <div v-for="t in spans" :key="t.name" class="jspan" :class="{ sel: t.id === sprint?.id }"
              :style="spanStyle(t)" :title="t.id === sprint?.id ? `${t.name} · el que estás viendo` : t.name">{{ t.name }}</div>
          </div>
          <!-- `gapTop` en 12p y 2p: parte la jornada en mañana | almuerzo | tarde -->
          <div v-for="h in HOURS" :key="h" class="jrow"
            :class="{ lunch: LUNCH.has(h), gapTop: h === 12 || h === 14 }">
            <span class="jhl">{{ hourLabel(h) }}</span>
            <span v-for="(d, i) in dayCols" :key="d.iso" class="cel"
              :class="[codeClass(d.iso, h), { weekend: d.weekend, spStart: startCols.has(i), spEnd: endCols.has(i) }]"
              :title="cellTitle(d, h)"></span>
          </div>
          <!-- las filas de totales y de fechas repiten los mismos márgenes: si no, se desalinean -->
          <div class="jrow jtot">
            <span class="jhl"></span>
            <span v-for="(d, i) in dayCols" :key="d.iso" class="cel num"
              :class="{ spStart: startCols.has(i), spEnd: endCols.has(i) }" :title="dayTitle(d.iso)">{{ hoursShort(dayMin(d.iso)) }}</span>
          </div>
          <div class="jrow jaxis">
            <span class="jhl"></span>
            <span v-for="(d, i) in dayCols" :key="d.iso" class="cel num"
              :class="{ weekend: d.weekend, spStart: startCols.has(i), spEnd: endCols.has(i) }">{{ d.num }}</span>
          </div>
        </div>
        <div class="legend">
          <span>0</span>
          <i v-for="n in [0, 1, 2, 3, 4]" :key="n" :class="'c' + n"></i>
          <span>{{ pulse.slotsPerHour }} tramos de {{ slotMin }}′</span>
          <i class="n0"></i><span>sin registro</span>
          <span class="note">se llena con los tramos en que hubo cambios en los repos de la compañía — no con lo que uno cree que trabajó</span>
        </div>
      </section>

      <!-- MIS TAREAS. Antes había ADEMÁS una tarjeta "La tarea" con el detalle de la seleccionada, y
           repetía lo mismo: clave, estado, título y descripción ya estaban acá. Lo único que aportaba
           eran las ACCIONES, así que las acciones bajaron a la tarjeta y el resumen se fue.

           SOLO LECTURA sobre Jira: estado y descripción son los de allá, y cambiarlos es cosa de Jira o
           del asistente por la API. La única excepción es el handoff a QA — mover la tarjeta y avisarle
           a quien prueba es un mismo acto, y partirlo en dos es lo que hace que el aviso se olvide. -->
      <section class="card">
        <h2>
          {{ vistaAncha ? `Mis tareas · últimos ${porSprint.length} sprints` : 'Mis tareas' }}
          <span v-if="vistaAncha && !cargandoAncha" class="cnt">{{ totalAncha }}</span>
        </h2>
        <p v-if="vistaAncha && cargandoAncha" class="empty">trayendo los sprints…</p>
        <template v-for="g in groupedIssues" :key="g.id">
          <!-- varias columnas según el ancho: `auto-fill` con un mínimo, así el número de columnas lo
               decide la pantalla y no un breakpoint escrito a mano -->
          <div class="tgrid">
            <div v-for="i in g.tasks" :key="i.Key" class="task" :class="{ sel: active?.Key === i.Key, wide: qa?.key === i.Key }"
              @click="active = i">
              <div class="tl">
                <a v-if="site" class="key link" :href="jiraLink(i.Key)" target="_blank" rel="noopener"
                  @click.stop :title="`Abrir ${i.Key} en Jira`">{{ i.Key }} <span class="ext">↗</span></a>
                <span v-else class="key">{{ i.Key }}</span>
                <span class="status" :class="statusClass(i.StatusCategory)">{{ i.Status }}</span>
                <!-- El grupo al que pertenece la tarjeta, como chip: reemplaza al encabezado que antes
                     partía la grilla. `_esfuerzo` en la vista del sprint, `_sprint` en la ancha. -->
                <span v-if="i._esfuerzo" class="spchip esf" :title="`esfuerzo: ${i._esfuerzo}`">
                  {{ i._esfuerzo }}
                  <i v-if="stageOf(i._esfuerzoId)" class="stg" :class="'s-' + stageOf(i._esfuerzoId)?.id">{{ stageOf(i._esfuerzoId)?.label }}</i>
                </span>
                <span v-if="i._sprint" class="spchip" :title="`del ${i._sprint}`">{{ i._sprint }}</span>
              </div>
              <div class="tt">{{ i.Summary }}</div>

              <!-- lo que HOY dice Jira, recortado. La completa va al CAJÓN (botón «ver completa»): en la
                   tarjeta ocupaba la fila entera y rompía la grilla, que es lo mismo que hacían los
                   encabezados de grupo. Un cajón no le quita el ancho a nadie. -->
              <p v-if="i.Description" class="jd" :title="i.Description">{{ i.Description }}</p>
              <p v-else class="jd none">sin descripción en Jira</p>

              <div class="tm">
                <!-- de qué sprint viene: verde = nació en su sprint · rojo = la arrastraron sin terminar -->
                <span v-if="i.OriginSprint" class="orig" :class="{ carried: i.CarriedOver }"
                  :title="i.CarriedOver ? `Nació en ${i.OriginSprint} y se arrastró sin terminar` : `Nació en ${i.OriginSprint}`">
                  <i></i>{{ i.OriginSprint }}
                </span>
                <span v-if="i.HasPoints && i.Points">{{ i.Points }} pts</span>
                <span v-if="taskLocals[i.Key]?.estimateMinutes">{{ minHhmm(taskLocals[i.Key].estimateMinutes) }} estimado</span>
                <span>{{ hhmm(i.SpentSecs) }} en Jira</span>
                <span class="mine" v-if="minutesOf(i.Key)">{{ minHhmm(minutesOf(i.Key)) }} sin subir</span>
              </div>

              <!-- Las acciones de la tarea, donde está la tarea. `@click.stop` en todas: la tarjeta
                   entera selecciona, y un botón no puede además hacer eso por accidente. -->
              <div class="tacts" @click.stop>
                <button class="tact" :class="{ act: descAbierta && active?.Key === i.Key }" @click="verDesc(i)">
                  ver completa
                </button>
                <button class="tact" :class="{ act: bitacoraAbierta && active?.Key === i.Key }" @click="verBitacora(i)">
                  Bitácora<span v-if="entriesPorTarea[i.Key]" class="cnt">{{ entriesPorTarea[i.Key] }}</span>
                </button>
                <!-- los prototipos de la tarea: sólo si los hay, y se abren en un panel aparte porque
                     suelen ser varios y con nombres largos -->
                <button v-if="protosDe(i.Key).length" class="tact" :class="{ act: protosAbiertos && active?.Key === i.Key }"
                  @click="verProtos(i)">
                  Prototipos<span class="cnt">{{ protosDe(i.Key).length }}</span>
                </button>
                <!-- en qué ramas vive la tarea. Sólo si hay medición para ella: sin snapshot el botón no
                     aparece, en vez de abrir un cajón vacío que parece un error. -->
                <button v-if="ramasCuenta(i.Key)" class="tact" :class="{ act: ramasAbiertas && active?.Key === i.Key }"
                  @click="verRamas(i)">
                  Ramas<span class="cnt">{{ ramasCuenta(i.Key) }}</span>
                </button>
                <!-- los hechos con fecha que declara el cuerpo. El punto rojo avisa que alguno venció
                     sin abrir el cajón: es lo que hace que una pregunta de hace 10 días se note. -->
                <button v-if="hallazgosDe(i.Key).length" class="tact" :class="{ act: hallazgosAbiertos && active?.Key === i.Key }"
                  @click="verHallazgos(i)">
                  Hallazgos<span class="cnt">{{ hallazgosDe(i.Key).length }}</span><span
                    v-if="hallazgosDe(i.Key).some(vencido)" class="alerta" title="Hay algo que pide revisión">●</span>
                </button>
                <button v-if="!enPruebas(i) && qa?.key !== i.Key" class="tact go" :disabled="qaBusy" @click="openQA(i)">
                  🧪 A pruebas
                </button>
              </div>

              <!-- Handoff a QA, dentro de SU tarjeta. El mensaje se previsualiza y se puede editar: nunca
                   sale algo que no se vio, y el server lo re-valida contra el guard antes de publicarlo. -->
              <template v-if="qa?.key === i.Key">
                <p v-if="qaError" class="qa-err">{{ qaError }}</p>
                <div class="qa-box" @click.stop>
                  <p class="qa-head">
                    <span v-if="qa.transition">Va a moverla: <b>{{ qa.transition.name }}</b> → <b>{{ qa.transition.to }}</b></span>
                    <span v-else class="qa-err">{{ qa.blocked }}</span>
                  </p>
                  <label class="fld">El mensaje <em>DM a {{ qa.name || qa.email }} — editalo si querés</em></label>
                  <textarea v-model="qa.text" rows="7" spellcheck="false"></textarea>
                  <ul v-if="qaProblems.length" class="qa-bad">
                    <li v-for="(p, n) in qaProblems" :key="n">{{ p.what }}: «{{ p.found }}»</li>
                  </ul>
                  <div class="qa-acts">
                    <button class="qa-go" :disabled="qaBusy || !qa.transition || !qa.text.trim()" @click="sendQA()">
                      {{ qaBusy ? 'Enviando…' : 'Mover y avisar' }}
                    </button>
                    <button class="qa-no" :disabled="qaBusy" @click="qa = null">Cancelar</button>
                  </div>
                </div>
              </template>
              <p v-if="qaDone && active?.Key === i.Key" class="qa-done">{{ qaDone }}</p>
              <p v-else-if="qaError && !qa && active?.Key === i.Key" class="qa-err">{{ qaError }}</p>
            </div>
          </div>
        </template>
      </section>

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

    <!-- BITÁCORA: cajón lateral, no una card del flujo. Es material de CONSULTA —lo escribe el asistente
         y quien lo lee seguido es un modelo para retomar contexto—, así que ocupar una columna fija del
         tablero era ruido permanente. Como cajón: se abre cuando se necesita, tapa el tablero mientras
         se lee, y al cerrarlo el tablero queda como estaba.

         Va FUERA de las cards a propósito: `position: fixed` dentro de una card con `overflow` o
         `transform` se ancla a la card en vez de a la ventana, y el cajón aparecería recortado. -->
    <!-- PROTOTIPOS de la tarea. Panel aparte y no botones sueltos: una tarea puede tener varias
         propuestas, y verlas listadas con su descripción es lo que permite elegir cuál abrir. -->
    <!-- HALLAZGOS: lo mismo que el cuerpo ya dice, pero ordenado por tipo y con la EDAD a la vista.
         No duplica el texto — lo lee de los marcadores del propio cuerpo, así que no se desincroniza. -->
    <div v-if="hallazgosAbiertos" class="drawer">
      <div class="drawer-bg" @click="hallazgosAbiertos = false"></div>
      <aside class="drawer-p">
        <header class="drawer-h">
          <div>
            <h3>Hallazgos</h3>
            <p v-if="active">de {{ active.Key }} · {{ hallazgosDe(active.Key).length }}
              {{ hallazgosDe(active.Key).length === 1 ? 'anotación' : 'anotaciones' }}</p>
          </div>
          <button class="drawer-x" title="Cerrar (Esc)" @click="hallazgosAbiertos = false">✕</button>
        </header>
        <div class="drawer-b">
          <p class="empty">Salen del cuerpo de la tarea. Se escriben ahí, donde se argumentan.</p>
          <section v-for="g in hallazgosPorTipo(active?.Key)" :key="g.id" class="hgrupo">
            <h4>{{ g.tit }}<span class="hcnt">{{ g.items.length }}</span></h4>
            <p class="hpie">{{ g.pie }}</p>
            <article v-for="(a, n) in g.items" :key="n" class="hitem" :class="{ vencido: vencido(a) }">
              <div class="hmeta">
                <span class="hfecha">{{ a.fecha }}</span>
                <span class="hedad">{{ edadTxt(a) }}</span>
                <span v-if="a.quien" class="hquien">espera a {{ a.quien }}</span>
              </div>
              <p class="hque">{{ a.que }}</p>
              <!-- el `como` es lo que separa una medición de una afirmación: sin esto nadie sabe
                   cómo volver a comprobarla, y el número envejece sin que nadie se entere -->
              <pre v-if="a.como" class="hcomo">{{ a.como }}</pre>
            </article>
          </section>
        </div>
      </aside>
    </div>

    <!-- DESCRIPCIÓN completa de Jira. Cajón y no expansión de la tarjeta: son párrafos, y ensanchar la
         tarjeta a la fila entera rompía la grilla. Es SOLO LECTURA — lo que dice Jira hoy. -->
    <div v-if="descAbierta" class="drawer">
      <div class="drawer-bg" @click="descAbierta = false"></div>
      <aside class="drawer-p">
        <header class="drawer-h">
          <div>
            <h3>{{ active?.Key }}</h3>
            <p v-if="active">{{ active.Summary }}</p>
          </div>
          <button class="drawer-x" title="Cerrar (Esc)" @click="descAbierta = false">✕</button>
        </header>
        <div class="drawer-b">
          <p class="empty">Es lo que dice <b>Jira</b> hoy — lo que lee el equipo. Editarla es cosa de Jira.
            <a v-if="site && active" class="link" :href="jiraLink(active.Key)" target="_blank" rel="noopener">abrir en Jira ↗</a>
          </p>
          <div v-if="active?.DescriptionHTML" class="desc jira-html" v-html="active.DescriptionHTML"></div>
          <p v-else-if="active?.Description" class="desc">{{ active.Description }}</p>
          <p v-else class="desc none">Esta tarea todavía no tiene descripción en Jira.</p>
        </div>
      </aside>
    </div>

    <!-- RAMAS: cajón propio. Comparte el estilo del de prototipos (misma familia) pero con su propio
         wrapper: meterlo adentro del de prototipos lo dejaba invisible, porque manda el `v-if` del padre. -->
    <div v-if="ramasAbiertas" class="drawer">
      <div class="drawer-bg" @click="ramasAbiertas = false"></div>
      <aside class="drawer-p">
        <header class="drawer-h">
          <div>
            <h3>Ramas</h3>
            <p v-if="active">de {{ active.Key }} · patrón <code>{{ ramasDe(active.Key)?.patron }}</code>
              · medido {{ haceCuanto(ramasSnap.medidoEn) }}</p>
          </div>
          <button class="drawer-x" title="Cerrar (Esc)" @click="ramasAbiertas = false">✕</button>
        </header>
        <div class="drawer-b">
          <p class="empty">Medido por <b>patch-id</b>: un cambio que llegó por squash cuenta como
            mergeado aunque la rama ya no exista. Se lee lo que el último <code>git fetch</code> dejó —
            para refrescar: <code>make tareas-ramas</code>.</p>
          <div class="tabla-wrap">
            <table class="ramas">
              <thead>
                <tr>
                  <th>repo</th><th>rama</th><th>PR</th>
                  <th v-for="a in ambientesDe(active?.Key)" :key="a">{{ a }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="r in ramasDe(active?.Key)?.ramas || []" :key="r.repo + r.rama">
                  <td>{{ r.repo }}</td>
                  <td><code :title="r.asunto">{{ r.rama }}</code> <span class="sha">{{ r.commit }}</span></td>
                  <!-- El PR es lo que git no sabe: contesta «¿por qué esto no avanza?». Un OPEN sin
                       revisión dice "nadie lo miró", que no es lo mismo que "falta trabajo". -->
                  <td class="prcol">
                    <a v-if="r.pr" class="link" :href="r.pr.url" target="_blank" rel="noopener"
                      :title="`${r.pr.estado} → ${r.pr.base}${r.pr.revision ? ' · ' + r.pr.revision : ''}`">#{{ r.pr.numero }}</a>
                    <span v-if="r.pr" class="prst" :class="'pr-' + r.pr.estado.toLowerCase()">{{ etiquetaPR(r.pr) }}</span>
                    <span v-else class="na">sin PR</span>
                  </td>
                  <!-- tres estados, no dos: `—` es "ese ambiente no existe en este repo", que no es lo
                       mismo que "no está mergeado". Confundirlos fue lo que hizo creer que faltaba
                       desplegar algo en un repo que no tiene ese ambiente. -->
                  <td v-for="a in ambientesDe(active?.Key)" :key="a" class="amb">
                    <span v-if="!(a in (r.propios || {}))" class="na" title="ese ambiente no existe en este repo">—</span>
                    <span v-else-if="r.en?.[a]" class="si" title="el cambio ya está acá">✓</span>
                    <span v-else class="no" title="el cambio todavía no está acá">·</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </aside>
    </div>

    <div v-if="protosAbiertos" class="drawer">
      <div class="drawer-bg" @click="protosAbiertos = false"></div>
      <aside class="drawer-p">
        <header class="drawer-h">
          <div>
            <h3>Prototipos</h3>
            <p v-if="active">de {{ active.Key }} · {{ protosDe(active.Key).length }}
              {{ protosDe(active.Key).length === 1 ? 'propuesta' : 'propuestas' }}</p>
          </div>
          <button class="drawer-x" title="Cerrar (Esc)" @click="protosAbiertos = false">✕</button>
        </header>
        <div class="drawer-b">
          <p class="empty">Cada uno es un HTML autocontenido. Se abren en una pestaña nueva.</p>
          <button v-for="a in protosDe(active?.Key)" :key="a.file" class="proto-row" @click="openArtifact(a.file)">
            <span class="proto-play">▶</span>
            <span class="proto-txt">
              <b>{{ a.label }}</b>
              <span class="proto-file">{{ a.file }}</span>
            </span>
            <span class="proto-ext">↗</span>
          </button>
        </div>
      </aside>
    </div>

    <div v-if="bitacoraAbierta" class="drawer">
      <div class="drawer-bg" @click="bitacoraAbierta = false"></div>
      <aside class="drawer-p">
        <header class="drawer-h">
          <div>
            <h3>Bitácora</h3>
            <p v-if="active">de {{ active.Key }} · {{ ofActive.length }} {{ ofActive.length === 1 ? 'entrada' : 'entradas' }}</p>
          </div>
          <button class="drawer-x" title="Cerrar (Esc)" @click="bitacoraAbierta = false">✕</button>
        </header>
        <div class="drawer-b">
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
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.wrap { max-width: 1180px; margin: 0 auto; padding: 26px 22px 60px }
/* Vista ancha: la página se suelta. Los 1180px son para leer UNA columna de tarjetas; con cuatro sprints
   a la vez lo que se quiere es abarcar, y la grilla ya es `auto-fill` — sólo hay que dejarla crecer. */
.wrap.ancha { max-width: none }
/* De qué sprint es la tarjeta. Va en la línea de la clave, chiquito: es contexto, no el dato principal. */
.spchip { margin-left: auto; font-size: 10.5px; color: var(--mut); border: 1px solid var(--line);
  border-radius: 5px; padding: 1px 5px; white-space: nowrap }
/* El chip del esfuerzo puede ser largo (es un título): se recorta en vez de empujar la línea. */
.spchip.esf { max-width: 46%; overflow: hidden; text-overflow: ellipsis; color: var(--acc);
  border-color: color-mix(in srgb, var(--acc) 35%, transparent); display: inline-flex; gap: 5px; align-items: center }
.spchip.esf .stg { font-style: normal; font-size: 9.5px; opacity: .8 }
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

.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 16px }
.stat { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 15px 16px;
  box-shadow: 0 1px 2px #00000040, 0 6px 16px #0000001f }
.stat .k { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; color: var(--mut) }
.stat .v { font-size: 27px; font-weight: 800; margin: 6px 0 2px; letter-spacing: -.5px; font-variant-numeric: tabular-nums }
.stat .s { font-size: 11.5px; color: var(--mut) }
.stat.alert .v { color: var(--warn) }
.stat.ok .v { color: var(--acc) }

.card { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 18px; margin-bottom: 16px;
  box-shadow: 0 1px 2px #00000040, 0 6px 16px #0000001f }
.card h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .8px; color: var(--mut); margin: 0 0 14px; font-weight: 700;
  display: flex; align-items: center; gap: 6px }
/* selector de fuente de la jornada: a la derecha del título, mismo control que el selector de sprints
   (`.tabs`) pero más chico — es un cambio de lente, no una navegación. */
.card h2 .on { color: var(--acc); margin-left: 6px }
.card h2 .mut { color: var(--mut); font-weight: 400; text-transform: none; letter-spacing: 0 }

/* MASONRY con `columns`, no con grid. El grid alineaba por FILA, así que una tarjeta corta al lado de una
   larga dejaba un hueco vertical hasta la fila siguiente — bien visible con las que no tienen descripción.
   `columns` las apila por columna y no queda aire.
   Se usa `column-width` y no un número de columnas: el navegador decide cuántas caben, igual que hacía
   `auto-fill` — el layout sigue siendo del ancho y no de un breakpoint escrito a mano.
   ⚠ El costo: el orden de lectura pasa a ser por COLUMNA (arriba→abajo) en vez de por fila. Se acepta
   porque acá se BUSCA una tarjeta, no se lee una secuencia. */
.tgrid { columns: 320px; column-gap: 10px; margin-bottom: 10px }
.tgrid > .task { break-inside: avoid; margin: 0 0 10px }
/* El panel de QA no cabe en una columna: se saca del flujo y toma el ancho completo. */
.tgrid > .task.wide { column-span: all }
/* El panel de QA toma el ancho completo (ver `column-span: all` arriba): es un textarea y un par de
   controles, y leerlos en una columna de 320px es peor que no tenerlos. */
.task { border: 1px solid var(--line); border-radius: 11px; padding: 12px 13px; cursor: pointer; transition: .12s }
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
.tm { display: flex; gap: 12px; font-size: 11.5px; color: var(--mut); flex-wrap: wrap }
.tm .mine { color: var(--acc) }

/* acciones de la tarjeta: la fila que reemplazó a la card "La tarea". Van al pie y en tono bajo — la
   tarjeta se lee primero y se actúa después; botones fuertes acá competirían con el contenido. */
.tacts { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 10px;
  padding-top: 9px; border-top: 1px solid var(--line) }
.tact { border: 1px solid var(--line); background: var(--panel2); color: var(--mut); font: inherit;
  font-size: 11.5px; font-weight: 600; padding: 4px 9px; border-radius: 999px; cursor: pointer;
  display: inline-flex; align-items: center; gap: 6px }
.tact:hover:not(:disabled) { color: var(--txt) }
.tact:disabled { opacity: .45; cursor: default }
.tact.act { color: var(--acc); border-color: #4c3d8f; background: #a78bfa1f }
/* el de QA es el único que ESCRIBE (mueve en Jira y manda un DM): se distingue del resto */
.tact.go { color: #4ade80; border-color: #2a5f43; background: #0e2718 }
.tact.go:hover:not(:disabled) { background: #123420; color: #4ade80 }
.tact .cnt { background: var(--line); color: var(--txt); font-size: 10px; font-weight: 700;
  padding: 1px 6px; border-radius: 999px }
.tact.act .cnt { background: var(--acc); color: #1a1330 }
/* la descripción desplegada dentro de la tarjeta: separada del resto, no pegada al título */
.task .desc { margin: 2px 0 8px }
/* origen de la tarea: el punto dice si cerró en su sprint (verde) o la arrastraron (rojo) */
.orig { display: inline-flex; align-items: center; gap: 5px }
.orig i { width: 7px; height: 7px; border-radius: 50%; background: #4ade80; flex: none }
.orig.carried { color: var(--bad) }
.orig.carried i { background: var(--bad) }

.fld { display: flex; align-items: baseline; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; color: var(--mut); margin-bottom: 7px }
.fld em { font-style: normal; text-transform: none; letter-spacing: 0; opacity: .7; font-weight: 400; margin-left: 5px }
/* descripción completa de Jira (acá NO se recorta: es lo que se pidió ver entero) */
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
/* ── el cajón de la bitácora ──────────────────────────────────────────────────────────────────────
   Cubre la ventana entera (`inset: 0`) y el panel se ancla a la derecha. El fondo oscurece el tablero
   en vez de solo captar el clic: mientras se lee la bitácora, el tablero es contexto, no competencia.
   `min(520px, 92vw)` — ancho fijo cómodo para párrafos largos, pero sin desbordar en pantalla chica. */
.drawer { position: fixed; inset: 0; z-index: 60 }
.drawer-bg { position: absolute; inset: 0; background: #000000a6 }
.drawer-p { position: absolute; top: 0; right: 0; bottom: 0; width: min(520px, 92vw);
  background: var(--panel); border-left: 1px solid var(--line); box-shadow: -12px 0 32px #00000059;
  display: flex; flex-direction: column }
.drawer-h { display: flex; align-items: flex-start; gap: 12px; padding: 18px 18px 14px;
  border-bottom: 1px solid var(--line) }
.drawer-h h3 { margin: 0; font-size: 12px; text-transform: uppercase; letter-spacing: .8px; color: var(--mut);
  font-weight: 700 }
.drawer-h p { margin: 4px 0 0; font-size: 12.5px; color: var(--acc) }
.drawer-x { margin-left: auto; border: 0; background: none; color: var(--mut); font: inherit; font-size: 15px;
  cursor: pointer; padding: 0 2px; line-height: 1 }
.drawer-x:hover { color: var(--txt) }
/* una propuesta en el panel: el nombre del archivo abajo, que es lo que la identifica en disco */
.proto-row { display: flex; align-items: center; gap: 12px; width: 100%; text-align: left; cursor: pointer;
  background: none; border: 1px solid var(--line); border-radius: 9px; padding: 12px 14px; margin-bottom: 9px;
  font: inherit; color: var(--txt) }
.proto-row:hover { border-color: var(--acc); background: #ffffff08 }
.proto-play { color: var(--acc); font-size: 12px }
.proto-txt { flex: 1; min-width: 0 }
.proto-txt b { display: block; font-size: 13.5px; font-weight: 600; text-transform: capitalize }
.proto-file { display: block; font-size: 11px; color: var(--mut); font-family: ui-monospace, Menlo, monospace;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 2px }
.proto-ext { color: var(--mut); font-size: 12px }
.proto-row:hover .proto-ext { color: var(--acc) }
/* el cuerpo scrollea solo: el encabezado queda fijo y no se pierde de qué tarea es lo que se está leyendo */
.drawer-b { flex: 1; overflow-y: auto; padding: 0 18px 18px }
.drawer-b .empty { margin-top: 14px }

/* Animación con @keyframes en vez del <transition> de Vue: acá sólo hace falta la entrada, y con
   keyframes el estado de REPOSO del panel es el correcto (pegado a la derecha) en vez de depender de que
   Vue quite una clase en el frame siguiente. El precio es que no hay animación de salida — cerrar es
   instantáneo, que además se siente mejor.

   Va SIN `fill-mode` a propósito: `both`/`backwards` harían que el elemento sostenga el fotograma
   inicial (fuera de pantalla) mientras la animación no arranque. Sin fill-mode, apenas termina —o si
   nunca corre— manda el estilo normal.

   ⚠ Con la pestaña en segundo plano el reloj de animaciones se congela y el panel se queda en el primer
   fotograma hasta volver a ella. Es cosa del navegador, no del cajón: pasa igual con <transition>. */
.drawer-p { animation: drawer-in .22s ease }
.drawer-bg { animation: drawer-fade .22s ease }
@keyframes drawer-in { from { transform: translateX(100%) } to { transform: none } }
@keyframes drawer-fade { from { opacity: 0 } to { opacity: 1 } }
@media (prefers-reduced-motion: reduce) { .drawer-p, .drawer-bg { animation: none } }

/* handoff a QA: la ÚNICA acción del tablero que escribe en Jira y manda un mensaje, así que el envío
   pasa por una previsualización editable. `.qa-go` es el botón de confirmar dentro del panel; el que lo
   abre desde la tarjeta es `.tact.go`, más discreto porque convive con las otras acciones. */
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
/* El encabezado de grupo (.grp) se eliminó el 2026-08-19: la grilla es una sola y el grupo se lee
   en el chip de cada tarjeta. Un encabezado por grupo cortaba `auto-fill` en bloques y dejaba filas a
   medias, desperdiciando el ancho. */
/* etapa del esfuerzo: evaluar → trabajar → crear las tareas */
.stg { font-size: 9.5px; font-weight: 700; letter-spacing: .3px; padding: 2px 7px; border-radius: 999px;
  border: 1px solid var(--line); color: var(--mut); text-transform: none; white-space: nowrap }
.s-work { color: #f6c667; border-color: #4a3a16; background: #241a08 }
.s-tasks { color: #4ade80; border-color: #256b41; background: #0e2718 }
/* el prototipo de la tarea: sólo aparece si el html existe, así que no hay estado vacío que diseñar */
.proto { font: inherit; font-size: 9.5px; font-weight: 700; letter-spacing: .3px; text-transform: none;
  padding: 2px 8px; border-radius: 999px; cursor: pointer; white-space: nowrap;
  border: 1px solid var(--line); background: transparent; color: var(--mut) }
.proto:hover { color: var(--acc); border-color: var(--acc) }


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
/* PULSO (fuente «código»): verde, y a propósito distinto del violeta de la bitácora. No miden lo mismo
   —una es "cuándo toqué código", la otra "en qué trabajé"— y compartir escala invitaría a compararlas.
   `c0` es LISO, no rayado: es "el agente miró y no había nada", que es un dato; el rayado (`n0`) queda
   reservado para "no hubo registro". Esa distinción es la única que el pulso puede hacer y la bitácora no. */
.c0 { background: var(--panel2) }
.c1 { background: #4ade8033 } .c2 { background: #4ade8066 } .c3 { background: #4ade80a6 } .c4 { background: #4ade80 }
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

/* HALLAZGOS ------------------------------------------------------------------------------------ */
.alerta { color: #e5534b; margin-left: 4px; font-size: 10px; line-height: 1; }
.hgrupo { margin-bottom: 22px; }
.hgrupo h4 { font-size: 13px; margin: 0 0 2px; display: flex; align-items: center; gap: 7px; }
.hcnt { font: 11px/1 var(--mono, ui-monospace, monospace); opacity: .55; border: 1px solid currentColor;
        border-radius: 99px; padding: 2px 6px; }
.hpie { font-size: 11.5px; opacity: .5; margin: 0 0 10px; }
.hitem { border-left: 2px solid currentColor; padding: 2px 0 2px 11px; margin-bottom: 12px; opacity: .85; }
.hitem.vencido { border-left-color: #e5534b; opacity: 1; }
.hmeta { display: flex; gap: 9px; flex-wrap: wrap; align-items: baseline;
         font: 11px/1.4 var(--mono, ui-monospace, monospace); opacity: .6; margin-bottom: 3px; }
.hitem.vencido .hedad { color: #e5534b; opacity: 1; font-weight: 600; }
.hquien { opacity: .8; }
.hque { margin: 0; font-size: 13.5px; line-height: 1.5; }
.hcomo { margin: 7px 0 0; padding: 8px 10px; border-radius: 6px; background: rgba(127,127,127,.1);
         font: 11.5px/1.6 var(--mono, ui-monospace, monospace); white-space: pre-wrap;
         word-break: break-word; opacity: .8; }

/* PUNTOS ---------------------------------------------------------------------------------------- */
.stat .v .de { opacity: .4; font-size: .62em; font-weight: 500; margin-left: 1px; }
/* la marca de por dónde va el sprint, sobre la barra de lo entregado */
.stat .bar { position: relative; }
.stat .bar u { position: absolute; top: -2px; bottom: -2px; width: 2px; background: currentColor;
               opacity: .55; border-radius: 1px; }
.pts-detalle { display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: baseline;
               margin: -6px 0 18px; font-size: 12.5px; opacity: .75; }
.pd-k { opacity: .6; }
.pd-i b { font-weight: 600; }
.pd-mal { color: #e5534b; opacity: 1; }
</style>
