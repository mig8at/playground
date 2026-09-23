<script setup>
import { vResize, refreshResizers } from './workbench.js';
// Tablero — mi sprint, con registro de tiempo y avances.
//
// El registro persiste como JSONL del lado del server (internal/store). Lo de arriba (sprint, tareas)
// sale de /api/sprint (Jira Agile 1.0); los avances fechados, de /api/entries.
//
// LA REGLA QUE ATRAVIESA TODO: lo que se escribe acá termina en Jira, donde lo lee el equipo. Nunca
// puede mencionar el playground, un hallazgo interno (F-xx), una ruta de archivo ni un nombre de repo.
// Por eso el campo de nota tiene un GUARD que BLOQUEA el botón, en vez de solo advertir.
//
// CONVENCIÓN: identificadores y clases CSS en inglés; solo el texto visible y los comentarios en español.
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue';
import TaskEditor from './TaskEditor.vue';
import TaskGuidance from './TaskGuidance.vue';
import TaskEvidence from './TaskEvidence.vue';
import RegionMenu from './RegionMenu.vue';
import RepoBranches from './RepoBranches.vue';
import { readPreference, savePreference, groupTasks, TASK_GROUPS } from './ui-state.js';
import { organizeDocument } from './task-document.js';
import { highlightSQL, isSQLQuery } from './sql-highlight.js';
import { jiraPreview } from './jira-preview.js';
import { readBootstrapCache, writeBootstrapCache } from './bootstrap-cache.js';

// La URL del server, parametrizable para poder levantar una SEGUNDA instancia sin tocar el código:
// `npm run dev` usa `concurrently -k`, así que reiniciar el server para probar un cambio tumba también
// el front de quien esté trabajando. Con esto se levanta un par aparte:
//   cd server && WEB_PORT=8790 go run ./cmd/web
//   VITE_TABLERO_API=http://localhost:8790 npx vite --port 5296
const SERVER = import.meta.env.VITE_TABLERO_API || 'http://localhost:8787';
const BOARD = 384;            // CORE — el proyecto donde están MIS tareas (no LO / Loans Origination)
const CANON_DEFAULT_URL = 'https://canon.playground.creditop.com';
const TRACER_DEFAULT_URL = 'http://localhost:5192';
const HARNESS_DEFAULT_URL = 'http://localhost:5195';
const canonUrl = ref(CANON_DEFAULT_URL);
const tracerUrl = ref(TRACER_DEFAULT_URL);
const harnessUrl = ref(HARNESS_DEFAULT_URL);

// Pintar primero, revalidar después: una recarga usa el último estado correcto y no espera a Jira para
// restaurar la tarea y sus regiones. El cache se reemplaza en cada sincronización exitosa.
const bootstrapCache = readBootstrapCache();
const loading = ref(!bootstrapCache);
const error = ref('');
const jiraSyncing = ref(false);
const syncError = ref('');
const sprint = ref(bootstrapCache?.sprint || null);
const sprints = ref(bootstrapCache?.sprints || []); // los más recientes, del actual hacia atrás — los usan las bandas de la jornada
const SPRINT_TABS = 4;        // cuántos ofrece el selector del header (los demás sólo pintan banda)
const site = ref(bootstrapCache?.site || ''); // https://<site>.atlassian.net — lo manda el server, sale de su .env
const issues = ref(bootstrapCache?.issues || []);
// ── EL ACORDEÓN DEL SIDEBAR: qué vistas están abiertas ──────────────────────────────────────────
// Dos vistas apiladas, no dos modos: un modo tapa al otro, y acá las dos tienen que poder verse de un
// vistazo. `jira` arranca cerrada —es mantenimiento del registro, no la operación del día— y cerrada
// ocupa UNA FILA, que es lo que la deja descubrible.
// ⚠ `alternarSeccion` y no `alternarVista`: ese nombre ya lo tiene el botón del titlebar que cambia
// el ANCHO del sprint (sólo este sprint / últimos N). Dos cosas distintas con el mismo verbo es como
// se llega a llamar a la equivocada.
// `iniciada` es «En curso»: lo que estás haciendo hoy. Las demás arrancan cerradas — cerradas cuestan
// una fila, así que los cinco estados con su conteo quedan a la vista igual.
const sections = ref(new Set(['iniciada']));
const isOpen = (id) => sections.value.has(id);
function toggleSection(id) {
  const n = new Set(sections.value);
  n.has(id) ? n.delete(id) : n.add(id);
  sections.value = n;
  // ⚠ Abrir «traer de Jira» SUELTA la tarea. Sus filas viven en el editor —no entran en 300px—, así
  // que sin esto abrís la vista y el editor sigue mostrando la tarea: las filas no se ven nunca.
  if (id === 'jira' && n.has('jira')) active.value = null;
}
const journeyOpen = ref(readPreference('journey-open', true) === true);
watch(journeyOpen, value => savePreference('journey-open', value));
/* ⚠ Acá vivían `collapsedGroups` y `toggleGroup`. Se fueron: cada grupo es ahora una VISTA del
   acordeón, así que «qué grupo está abierto» y «qué vista está abierta» eran el mismo estado escrito
   dos veces — y dos estados para una cosa es como se llega a que el chevron diga una y el contenido
   otra. Lo lleva `sections`. */
const active = ref(null);     // tarea sobre la que se está registrando

// El registro de avances vive en JSONL del lado del server. Acá se mapea al shape que usa la UI: `date` es el
// INICIO del bloque trabajado (Date real; el mapa de jornada reparte por horas), `sprint` ata la
// entrada al sprint donde se registró.
const fromApi = (r) => ({ id: r.id, key: r.taskKey, kind: r.kind, min: r.minutes,
  date: new Date(r.startedAt), day: r.day, sprint: r.sprintId, text: r.note, uploaded: !!r.uploadedAt,
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
async function loadConfig() {
  try {
    const j = await (await fetch(`${SERVER}/api/config`)).json();
    if (j.canonUrl) canonUrl.value = j.canonUrl;
    if (j.tracerUrl) tracerUrl.value = j.tracerUrl;
    if (j.harnessUrl) harnessUrl.value = j.harnessUrl;
  } catch { /* sin server: los enlaces conservan el origen público por defecto */ }
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
// ── filtro local por estado ──────────────────────────────────────────────────────────────────────
// Los buckets se derivan de `StatusCategory` (`new` / `indeterminate` / `done`), que es lo ÚNICO que Jira
// garantiza en todos los workflows — no de los nombres en español, que cambian con el board. Las dos
// excepciones están justificadas abajo, en `bucketDe`.
//
// PARTICIONAN: toda tarea cae en exactamente uno. Un filtro cuyos buckets no cubren todo esconde tareas
// en silencio, que es peor que no tener filtro. Medido el 2026-08-19 con 16 tarjetas: 1+3+1+2+9 = 16.
// ⚠ Los cinco estados se nombran en UN solo lugar: `TASK_GROUPS` (en `ui-state.js`). Acá va sólo el
// ORDEN, que es distinto a propósito — el filtro se lee como un FLUJO (sin empezar → terminada) y el
// acordeón por ATENCIÓN (lo que está en vuelo primero).
//
// Tenían dos juegos de etiquetas para los mismos cinco ids («iniciada» acá, «En curso» allá) y no
// molestaba mientras vivían lejos: las pastillas arriba de la grilla y los encabezados adentro. Desde
// que el acordeón puso las vistas y el menú ⋯ en la misma columna de 300px, el menú decía «iniciada 2»
// pegado a una vista que decía «En curso 2».
const FILTER_ORDER = ['sin-iniciar', 'iniciada', 'bloqueada', 'pruebas', 'terminada'];
const FILTERS = FILTER_ORDER.map((id) => ({ id, label: TASK_GROUPS.find((g) => g.id === id).title }));
// ⚠ Los dos tests por NOMBRE están acá a propósito, y no por comodidad:
//
//   · «bloqueada» — el board de CORE la declara en la categoría `new`, así que sin este test una tarea
//     bloqueada (CORE-19: 3 pt y trabajo encima) se lee como que nadie la tocó. Y es justo el estado que
//     uno quiere ver: no se destraba trabajando, se destraba hablando con alguien.
//   · «en pruebas» — es `indeterminate` como «en progreso», pero es donde más puntos se quedan varados,
//     a un estado de contar. Mezclarla con «iniciada» esconde el atasco.
//
// El resto sale de `StatusCategory`, que es lo único que Jira garantiza en cualquier workflow.
const blocked = (i) => /bloquead/i.test(i?.Status || '');
const bucketOf = (i) => {
  if (i.StatusCategory === 'done') return 'terminada';
  if (inTesting(i)) return 'pruebas';
  if (blocked(i)) return 'bloqueada';
  if (i.StatusCategory === 'new') return 'sin-iniciar';
  return 'iniciada';   // `indeterminate` que no está en pruebas ni bloqueada: en progreso, en revisión
};
// Se guarda lo que está OCULTO, no lo visible: el conjunto vacío es "se ve todo", así que el estado
// inicial no depende de conocer la lista de buckets y agregar uno nuevo no lo esconde por omisión.
// Eso reemplaza a la pastilla «todas», que era el mismo default escrito como una opción más.
//
// NO se persiste a propósito: abrir el tablero y ver 2 tarjetas porque quedó un filtro de ayer se lee
// como "perdí trabajo", no como "hay un filtro puesto". Arranca siempre con todo visible.
const hidden = ref(new Set());
const toggleFilter = (id) => { hidden.value.has(id) ? hidden.value.delete(id) : hidden.value.add(id) };

// ── EL MENÚ ⋯ DEL SIDEBAR ───────────────────────────────────────────────────────────────────────
// Los filtros dejaron de ser tres renglones de pastillas arriba de la lista y pasaron al menú del
// encabezado (el patrón del Explorer de VS Code). Los datos son los MISMOS —`FILTROS`, `conteoFiltro`,
// `ocultos`, `verLocales`—: sólo cambió dónde se dibujan.
const filtersMenu = computed(() => {
  const its = FILTERS.map(f => ({
    id: f.id, label: f.label, count: filterCount.value[f.id],
    checked: !hidden.value.has(f.id), disabled: !filterCount.value[f.id],
    title: hidden.value.has(f.id) ? `mostrar ${f.label}` : `ocultar ${f.label}`,
  }));
  // Las LOCALES son otro eje —las de arriba filtran por ESTADO, esto por ORIGEN—, así que van
  // separadas. Y arranca apagada: el tablero es el sprint primero.
  its.push({ separador: true });
  its.push({ id: '_locales', label: 'locales', count: localCount.value, checked: showLocals.value,
             disabled: !localCount.value,
             title: showLocals.value ? 'ocultar las tareas locales' : 'mostrar también las locales (no están en Jira)' });
  // El ancho del sprint es otro eje más: se alterna y se toca poco, que es justo lo que va al menú.
  // Vivía en el titlebar, que ya no existe.
  its.push({ separador: true });
  its.push({ id: '_ancha', label: `últimos ${sprintTabs.value.length} sprints`,
             checked: wideView.value,
             title: wideView.value ? `ver sólo ${sprint.value?.name || 'el sprint activo'}`
                                     : 'ver mis tareas de los últimos sprints' });
  if (hidden.value.size || searchQuery.value) {
    its.push({ separador: true });
    its.push({ id: '_todas', label: 'ver todas', icon: 'filter', title: 'quitar todos los filtros' });
  }
  return its;
});
function fromMenu(id) {
  if (id === '_locales') { showLocals.value = !showLocals.value; return; }
  if (id === '_ancha') { toggleView(); return; }
  if (id === '_todas') { searchQuery.value = ''; hidden.value = new Set(); return; }
  toggleFilter(id);
}
// Colapsar TODO o desplegar todo, según cómo esté: un botón que sólo colapsa deja de servir apenas
// lo usaste una vez. ⚠ No toca la vista de Jira: es de otro eje y se pliega sola.
function collapseAll() {
  const ids = groupedIssues.value.map(g => g.id);
  const jira = sections.value.has('jira') ? ['jira'] : [];
  sections.value = new Set(ids.every(id => sections.value.has(id)) ? jira : [...ids, ...jira]);
}

// ── buscador por título ──────────────────────────────────────────────────────────────────────────
// Se le quitan los ACENTOS a los dos lados: los títulos vienen de Jira con tildes y nadie las escribe
// al buscar, así que sin esto «validacion» no encuentra «Validación» y el buscador parece roto justo
// con las tareas en español, que son casi todas.
// Busca también por CLAVE porque pegar «CORE-431» es la otra forma natural de buscar una tarea, y no
// puede colisionar con un título: ningún título tiene esa forma.
const searchQuery = ref('');
const withoutAccents = (s) => (s || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const normalizedSearch = computed(() => withoutAccents(searchQuery.value).trim());

// ── las tareas LOCALES, las que todavía no tienen Jira ────────────────────────────────────────────
//
// El tablero mostraba sólo issues de Jira, así que una tarea que vive únicamente en `tasks/<slug>/task.md`
// era INVISIBLE: sin tarjeta, sin avances, sin cajón de ramas. Se veía nada más con `make tareas`, y
// por eso el avance escrito ahí no lo miraba nadie (medido el 2026-08-27: ocho días).
//
// ⚠ Que aparezcan NO las publica. Publicar a Jira sigue siendo una decisión que se PIDE —hoy
// `make jira-create JSON=…`— y a propósito no hay botón acá: una tarea local es material de trabajo, y
// el día que valga la pena compartirla se decide, no se filtra por estar en pantalla.
// APAGADO por defecto: el tablero es, antes que nada, el sprint — lo que el equipo ve. Las locales son
// material propio y son MUCHAS (16 contra 7 del sprint el 2026-08-27): encendidas por defecto ahogaban
// justo lo que uno viene a mirar. Se prenden cuando se las está trabajando.
const showLocals = ref(false);

const allLocals = computed(() => {
  const linked = new Set(Object.values(taskLocals.value).map(v => v?.effortId).filter(Boolean));
  return efforts.value
    .filter(e => e.id && !linked.has(e.id) && !e.archived)
    .map(e => ({
      // La clave imita la forma de Jira para que todo lo que indexa por `Key` —selección, cajones,
      // contador de avances— siga funcionando sin ramas especiales.
      Key: `LOCAL-${e.id}`,
      Summary: e.title,
      Status: 'local',
      StatusCategory: e.stage === 'work' ? 'indeterminate' : 'new',
      Points: 0,
      _local: true,
      _effortId: e.id,
    }));
});
const looseLocals = computed(() => showLocals.value ? allLocals.value : []);

// Cuántas locales hay, se estén viendo o no: una píldora sin número obliga a prenderla para descubrir
// si tiene algo, que es exactamente lo que las otras casillas ya evitan.
const localCount = computed(() => {
  const linked = new Set(Object.values(taskLocals.value).map(v => v?.effortId).filter(Boolean));
  return efforts.value.filter(e => e.id && !linked.has(e.id) && !e.archived).length;
});

const visibleTasks = computed(() => {
  // Conserva la deduplicación y el origen antes de agrupar por estado.
  if (wideView.value) {
    // Una tarea ARRASTRADA entre sprints viene en el listado de cada sprint que la incluyó. Agrupada eso
    // era correcto (una fila por grupo); suelta son tarjetas DUPLICADAS — CORE-365 salía tres veces, una
    // por Sprint 12, 11 y 10. Se deduplica por `Key` quedándose con el sprint MÁS NUEVO (el listado viene
    // nuevo→viejo) y el arrastre NO se pierde: se cuenta, porque una tarea en su 3.er sprint es una señal.
    const byKey = new Map();
    for (const g of bySprint.value) {
      for (const i of g.issues) {
        const existing = byKey.get(i.Key);
        if (existing) { existing._carryOvers++; continue; }
        byKey.set(i.Key, { ...i, _sprint: shortName(g.sprint.name), _carryOvers: 1 });
      }
    }
    return withFilter([...byKey.values(), ...looseLocals.value]);
  }
  // `issues` ya viene ordenado nuevo → viejo desde el server y ese orden se preserva tal cual.
  const withEffort = issues.value.map((i) => {
    const eid = taskLocals.value[i.Key]?.effortId || 0;
    const t = eid ? efforts.value.find(e => e.id === eid)?.title : '';
    return t ? { ...i, _effort: t, _effortId: eid } : i;
  });
  return withFilter([...withEffort, ...looseLocals.value]);
});
const groupedIssues = computed(() => groupTasks(visibleTasks.value, bucketOf));
// El filtro se aplica al FINAL de las dos ramas: es una vista sobre la lista, no otra lista.
// Las casillas y el buscador se combinan con Y, que es lo que uno espera: buscar dentro de lo que
// quedó visible, no que escribir en la caja reviva lo que se destildó.
function withFilter(ts) {
  const q = normalizedSearch.value;
  const byState = hidden.value.size ? ts.filter(i => !hidden.value.has(bucketOf(i))) : ts;
  return q ? byState.filter(i => withoutAccents(i.Summary).includes(q) || withoutAccents(i.Key).includes(q)) : byState;
}
// Los conteos salen de la lista SIN filtrar: si salieran de la filtrada, un bucket destildado diría 0 y
// dejaría de poder volver a tildarse con conocimiento de qué esconde.
const unfiltered = computed(() => {
  if (wideView.value) {
    const seen = new Set(), out = [];
    for (const g of bySprint.value) for (const i of g.issues) {
      if (!seen.has(i.Key)) { seen.add(i.Key); out.push(i); }
    }
    return out;
  }
  return issues.value;
});
const filterCount = computed(() => {
  const n = {};
  for (const f of FILTERS) n[f.id] = 0;
  for (const i of [...unfiltered.value, ...looseLocals.value]) n[bucketOf(i)]++;
  return n;
});

// El MÉTODO de trabajo, explícito: primero se evalúa, después se trabaja, y las tareas de Jira se
// escriben AL FINAL — recién ahí hay contexto completo para definirlas bien.
const STAGES = [
  { id: 'evaluation', label: 'Evaluando' },
  { id: 'work', label: 'Trabajando' },
  { id: 'tasks', label: 'Tareas creadas' },
];
const stageOf = (id) => STAGES.find(s => s.id === (efforts.value.find(e => e.id === id)?.stage || 'evaluation'));
// DÍAS SIN TOCAR el archivo de la tarea, según git (el server lo calcula; ver store/touches.go). La etapa
// dice si algo se está evaluando o trabajando, no si sigue vivo: medido el 2026-09-14, 22 de las 39
// abiertas llevaban 14 días o más sin tocarse y todas se veían igual. DORMIDA a los 14; a los 30 la
// pregunta es si se archiva o se anota por qué espera.
const DORMANT_DAYS = 14;
const daysUntouched = (id) => {
  const t = efforts.value.find(e => e.id === id)?.touchedAt;
  if (!t) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(t + 'T12:00:00')) / 86400000));
};
// ARTIFACTS del esfuerzo: todo lo que hay en `tasks/<slug>/artifacts/`, que sirve el server en
// `/artifacts/<slug>/<archivo>` —prototipos, SQL, notas—. Son varios porque una tarea suele tener más
// de un actor o más de un camino, y verlos al lado es lo que permite decidir. Se abren en pestaña
// aparte: son para mirarlos, no para vivir embebidos acá.
const artifactsOf = (id) => efforts.value.find(e => e.id === id)?.artifacts || [];
const openArtifact = (file) => window.open(`${SERVER}/artifacts/${file}`, '_blank', 'noopener');
// los artifacts cuelgan del ESFUERZO, pero se piden desde la tarjeta de una TAREA: se resuelve el
// esfuerzo por su clave, igual que los avances
const taskArtifacts = (key) => artifactsOf(effortFor(key));
// El tipo va aparte de la etiqueta (el server ya le quita la extensión): 13 de los 21 no son HTML, y un
// ▶ para todos prometía «ejecutar» una nota o una consulta.
const artifactType = (file) => (/\.([a-z0-9]+)$/i.exec(file)?.[1] || 'archivo').toUpperCase();

// ── RAMAS DE LA TAREA: qué repos tocó y hasta dónde llegó cada rama ──────────────────────────────
// No se miden al renderizar: el snapshot lo deja `make tareas-ramas`. La consola inferior deriva su
// tabla y su selector de repos EXCLUSIVAMENTE de la tarea enfocada; nunca muestra el inventario global.
const branchesSnap = ref({ measuredAt: '', tasks: {} });
const refreshingBranches = ref(false);
const branchesError = ref('');
async function loadBranches() {
  try { branchesSnap.value = await (await fetch(`${SERVER}/api/ramas`)).json() || { tasks: {} }; }
  catch { /* sin snapshot todavía: la card lo dice, no es un error */ }
}
const branchesOf = (key) => {
  const eid = effortFor(key);
  return (branchesSnap.value.tasks || {})[String(eid)] || null;
};
const activeTaskBranches = computed(() => active.value ? (branchesOf(active.value.Key) || {
  pattern: '', branches: [], measuredAt: branchesSnap.value.measuredAt || '',
}) : { pattern: '', branches: [], measuredAt: branchesSnap.value.measuredAt || '' });
async function refreshBranches() {
  const effortId = active.value ? effortFor(active.value.Key) : 0;
  if (!effortId || refreshingBranches.value) return;
  refreshingBranches.value = true;
  branchesError.value = '';
  try {
    const httpResponse = await fetch(`${SERVER}/api/ramas/refresh?id=${encodeURIComponent(effortId)}`, { method: 'POST' });
    const snapshot = await httpResponse.json();
    if (!httpResponse.ok || snapshot.error) throw new Error(snapshot.error || 'no se pudo actualizar las ramas');
    branchesSnap.value = snapshot || { tasks: {} };
  } catch (err) {
    branchesError.value = err instanceof Error ? err.message : 'no se pudo actualizar las ramas';
  } finally {
    refreshingBranches.value = false;
  }
}

// ── derivados del sprint ────────────────────────────────────────────────────────────────────────
const done = computed(() => issues.value.filter(i => i.StatusCategory === 'done').length);
const points = computed(() => issues.value.reduce((n, i) => n + (i.Points || 0), 0));

// ── PUNTOS: cuánto de lo comprometido ya CUENTA ────────────────────────────────────────────────
// La regla la fijó Oscar el 2026-08-18: los viernes se miden los puntos, y sólo cuentan las tareas
// en «Terminado» o «En revisión». Todo lo demás vale cero para la métrica, por avanzado que esté.
//
// ⚠ «En pruebas» NO cuenta, y es donde más puntos se quedan varados —a un estado de contar—. Por eso
// existe el desglose: el número solo dice que vas atrás; el desglose dice QUÉ MOVER.
const countsForMetric = (i) => i.StatusCategory === 'done' || /revisi[oó]n/i.test(i.Status || '');
const committedPts = computed(() => points.value);
const countedPts = computed(() => issues.value.filter(countsForMetric).reduce((n, i) => n + (i.Points || 0), 0));
const strandedPts = computed(() => {
  const m = {};
  for (const i of issues.value) {
    if (countsForMetric(i) || !(i.Points > 0)) continue;
    m[i.Status] = (m[i.Status] || 0) + i.Points;
  }
  return Object.entries(m).sort((a, b) => b[1] - a[1]);
});
// Tareas sin estimar: la regla dice que TODAS deben tener puntos, incluidas las no planificadas. Una
// sin puntos no baja la métrica — la deja incompleta, que es peor, porque no se nota.
const withoutPoints = computed(() => issues.value.filter(i => !(i.Points > 0)).map(i => i.Key));

// CAPACIDAD: cuántos puntos entran en un sprint, deducido de la tabla de referencia del equipo
// (Oscar, 2026-08-18) y no inventado — ahí un **5 es «cerca de medio sprint»**, así que dos tareas de
// 5 ya lo llenan. De ahí sale el 10.
//
// No es un límite que el tablero imponga: es la vara contra la que mirar lo que uno se comprometió.
// Comprometer el doble no se nota mirando la lista de tareas —son cinco tarjetas, se ven pocas— y sí
// se nota el viernes, cuando la mitad no alcanzó a contar.
const CAPACITY = 10;
const overCapacity = computed(() => {
  const c = committedPts.value;
  if (c <= CAPACITY) return null;
  return { points: c, times: +(c / CAPACITY).toFixed(1), excess: c - CAPACITY };
});
// El desfase contra el CALENDARIO: qué fracción del sprint se consumió contra qué fracción ya cuenta.
// Sólo con el sprint en curso: antes de arrancar o cerrado, comparar contra el calendario es ruido.
const pace = computed(() => {
  const d = sprintDays.value;
  if (d?.state !== 'ongoing' || !committedPts.value) return null;
  const donePct = Math.round(100 * countedPts.value / committedPts.value);
  return { consumed: d.pct, done: donePct, behind: Math.max(0, d.pct - donePct), days: d.remaining };
});
const jiraTime = computed(() => issues.value.reduce((n, i) => n + (i.SpentSecs || 0), 0));
const ofSprint = computed(() => entries.value.filter(e => e.sprint === sprint.value?.id));
const logTime = computed(() => ofSprint.value.reduce((n, e) => n + e.min, 0));

// El chip del header, según el ESTADO del sprint. CORE vive entre sprints (uno cerró, el próximo no
// arrancó), así que un sprint puede no haber empezado: "5 días restantes" sobre algo que aún no empieza
// sería mentira. Tres casos: por arrancar · en curso · cerrado.
const shortName = (n) => (n || '').replace(/^.*?(Sprint)/i, '$1');
const sprintTabs = computed(() => (sprints.value || []).slice(0, SPRINT_TABS));

// ── VISTA «últimos 4 sprints»: todas MIS tareas de la ventana, a lo ancho ────────────────────────
// El tablero mira UN sprint porque su trabajo diario es ese. Pero para ver de dónde viene algo —o qué
// quedó a medias hace tres sprints— hace falta la ventana entera. Es otra VISTA, no otro filtro: cambia
// el ancho de la página (el `.wrap` de 1180px es para leer una columna de tarjetas, no cuatro).
//
// Los issues salen del MISMO endpoint del sprint, que ya filtra `assignee = currentUser()` en Jira: no
// hay un segundo criterio de "mío" que pueda derivar del primero.
// Arranca en TRUE: el tablero muestra por defecto las tareas de los últimos sprints, no sólo el activo.
// Las pestañas por sprint se quitaron (2026-08-19, decisión de Miguel): 4 botones en el header para ver
// un sprint a la vez, cuando lo que se quiere es ver TODO lo propio de la ventana. El sprint ACTIVO sigue
// siendo el de los indicadores (puntos, tiempo, días restantes) — eso no cambia con la vista.
const wideView = ref(true);
const loadingWide = ref(false);
const bySprint = ref(bootstrapCache?.bySprint || []); // [{ sprint, issues }] en el orden de las pestañas

function saveBootstrap() {
  if (!sprint.value) return;
  writeBootstrapCache({
    sprint: sprint.value, sprints: sprints.value, issues: issues.value,
    bySprint: bySprint.value, site: site.value,
  });
}

async function loadLast4() {
  // Con cache las filas permanecen visibles mientras se revalidan; el indicador de carga sólo ocupa
  // el sitio de los datos cuando de verdad no existe todavía nada que mostrar.
  loadingWide.value = !bySprint.value.length;
  try {
    // En PARALELO: son 4 llamadas a Jira y en serie se notaba la espera.
    const res = await Promise.all(sprintTabs.value.map(async (s) => {
      // El sprint principal acaba de llegar por `/api/sprint`: volver a pedirlo acá duplicaba la
      // llamada más costosa de cada recarga.
      if (s.id === sprint.value?.id) return { sprint: s, issues: issues.value };
      const previous = bySprint.value.find((sprintGroup) => sprintGroup.sprint?.id === s.id);
      try {
        const j = await (await fetch(`${SERVER}/api/sprint?board=${BOARD}&id=${s.id}`)).json();
        return j.error ? (previous || { sprint: s, issues: [] }) : { sprint: s, issues: j.issues || [] };
      } catch { return previous || { sprint: s, issues: [] }; }
    }));
    bySprint.value = res;
    saveBootstrap();
  } finally { loadingWide.value = false; }
}

// Total de tarjetas visibles: va en el encabezado porque "4 sprints" no dice cuánto trabajo es.
// Cuenta TARJETAS, no filas de sprint: sumar `g.issues.length` daba 24 cuando en pantalla había 16,
// porque las arrastradas venían repetidas. El contador y la grilla salen ahora de la misma lista.
const visible = computed(() => visibleTasks.value.length);
const totalTasks = computed(() => unfiltered.value.length + looseLocals.value.length);

async function toggleView() {
  wideView.value = !wideView.value;
  if (wideView.value && !bySprint.value.length) await loadLast4();
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
/* ⚠ Devuelve SÓLO el estado, sin las clases del componente: los mismos tres nombres pintan una
   píldora en el encabezado de la tarea y un PUNTO de 7px en el árbol. Metiéndole `badge` acá, los
   puntos se volvían píldoras. La clase del componente la pone cada sitio, que es el que sabe qué es. */
const statusClass = (c) => c === 'done' ? 'e-ok' : c === 'indeterminate' ? 'e-doing' : 'e-todo';
const minutesOf = (k) => ofSprint.value.filter(e => e.key === k).reduce((n, e) => n + e.min, 0);

// El mapa y los contadores usan una ventana de tiempo; el avance de una tarea necesita TODO su
// recorrido. Se pide aparte por tarea/esfuerzo al abrirla y el server lo devuelve ya ordenado, sin
// tocar el JSONL. Por esfuerzo también rescata hitos que se anotaron antes de tener clave de Jira.
// De la clave de una tarjeta al esfuerzo local. Es la ÚNICA forma de resolverlo, y todo lo que abre un
// cajón —cuerpo, hallazgos, pendientes, artifacts, ramas, avances— pasa por acá.
//
// ⚠ Contempla las tarjetas LOCALES (`LOCAL-<id>`), que no están en el mapa de Jira porque no están en
// Jira. Cuando cada cajón resolvía el esfuerzo por su cuenta contra `taskLocals`, las locales salían
// todas vacías —«sin cuerpo técnico»— con el cuerpo ahí al lado.
const effortFor = (key) => {
  if (typeof key === 'string' && key.startsWith('LOCAL-')) return Number(key.slice(6)) || 0;
  return taskLocals.value[key]?.effortId || 0;
};
// El JSONL es la única cronología de una tarea: cada renglón debe explicar algo que permite
// continuarla. Los registros de minutos siguen existiendo para medir trabajo, pero no entran acá.
const contexts = ref([]);
let contextsRequest = 0;
const contextFromApi = (event) => ({ ...event, references: Array.isArray(event.references) ? event.references : [] });
const dbReferencesOf = (event) => event.references.filter(reference => reference.kind === 'db');
const harnessReferencesOf = (event) => event.references.filter(reference => reference.kind === 'harness');
// El contexto admite únicamente enlaces Markdown a Canon: [texto](canon:nodo). Nunca se inyecta
// HTML ni se interpreta Markdown general; se parte el texto y Vue escapa cada fragmento normal.
const inlineCanonLink = /\[([^\[\]\r\n]+)\]\(canon:([A-Za-z0-9][A-Za-z0-9._/#-]*)\)/g;
const partsWithCanon = (text) => {
  const value = typeof text === 'string' ? text : '';
  const parts = [];
  let cursor = 0;
  for (const match of value.matchAll(inlineCanonLink)) {
    if (match.index > cursor) parts.push({ type: 'text', value: value.slice(cursor, match.index) });
    parts.push({ type: 'canon', label: match[1], target: match[2] });
    cursor = match.index + match[0].length;
  }
  if (cursor < value.length || !parts.length) parts.push({ type: 'text', value: value.slice(cursor) });
  return parts;
};
const contextParagraphs = (event) => [
  event.goal && { label: 'Objetivo.', text: event.goal },
  { text: event.summary },
  event.state && { label: 'Estado.', text: event.state },
  event.next && { label: 'Siguiente paso.', text: event.next },
  event.reason && { label: 'Motivo.', text: event.reason },
  event.waitingOn && { label: 'En espera de.', text: event.waitingOn },
].filter(Boolean);
const contextDay = (event) => event.at.slice(0, 10);
const contextAge = (day) => {
  const now = new Date(); now.setHours(0, 0, 0, 0);
  return Math.round((now - new Date(`${day}T00:00:00`)) / 86400000);
};
const contextDayLabel = (day) => {
  const age = contextAge(day);
  if (age === 0) return 'Hoy';
  if (age === 1) return 'Ayer';
  return new Date(`${day}T12:00:00`).toLocaleDateString('es-CO', { day: 'numeric', month: 'long' });
};
const contextGroups = computed(() => {
  const grouped = new Map();
  for (const event of contexts.value) {
    const day = contextDay(event);
    if (!grouped.has(day)) grouped.set(day, []);
    grouped.get(day).push(event);
  }
  return [...grouped.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([day, items]) => ({
    day, label: contextDayLabel(day), items,
  }));
});
async function loadContext() {
  const task = active.value;
  const request = ++contextsRequest;
  const effort = task && effortFor(task.Key);
  if (!effort) { contexts.value = []; return; }
  try {
    const response = await fetch(`${SERVER}/api/task-context?effort=${encodeURIComponent(effort)}`);
    const json = await response.json();
    if (request === contextsRequest && !json.error) contexts.value = (json.events || []).map(contextFromApi);
  } catch {
    if (request === contextsRequest) contexts.value = [];
  }
}

watch(() => [active.value?.Key, effortFor(active.value?.Key)], () => {
  loadContext();
}, { immediate: true });
// La descripción completa de Jira se conserva en su riel de referencia. El centro sólo conserva lo
// necesario para continuar: checkpoint, documento vigente y evidencia reproducible.

// ── el CUERPO TÉCNICO de la tarea, que es lo que de verdad se quiere leer ──────────────────────────
//
// Antes acá se mostraba la descripción de JIRA. Es la información equivocada para este tablero: Jira
// dice qué hay que hacer, en el lenguaje del equipo, y ya se lee en Jira. Lo que no está en ningún otro
// lado es el CUERPO del archivo de la tarea — qué se hizo, cómo se llegó a cada conclusión, con qué se
// midió, en qué ramas vive y cómo se integra en cada repo. El server ya lo expone como `techNotes`
// (el cuerpo privado, sin la sección publicable); sólo faltaba mirarlo.
//
// La de Jira sigue a un clic, en el enlace del encabezado: no se pierde, se despriorizó.
const bodyOf = (key) => efforts.value.find(e => e.id === effortFor(key))?.techNotes || '';

const effortOf = (key) => efforts.value.find(e => e.id === effortFor(key));
const documentSections = computed(() => organizeDocument(active.value ? bodyOf(active.value.Key) : ''));
const summarySections = computed(() => documentSections.value.filter(section => section.summaryHtml && !section.history));
// El contador de la pestaña son los DÍAS registrados, no las secciones: es lo que dice de un vistazo
// si esto se trabajó una tarde o dos meses.
const pendingSections = computed(() => documentSections.value.filter(section => section.pendingHtml));
const jiraDocument = computed(() => jiraPreview(active.value));
// Canon abre una referencia estable por URL. No ocupa una vista propia: una cita sólo aparece dentro
// del trabajo que realmente la usó. Una tarea puede declarar un tema (`listado`) o, preferiblemente,
// una sección exacta (`listado/context#por-donde-pasa-todo`).
//
// ⚠ Acá decía que canon «no lee la URL» y era FALSO: lo escribí después de grepear el front y no ver
// un router, cuando el router está en `src/rutas.js` y además `Sala.vue` observa `route.query.nodo`
// desde hace semanas. Comprobado en el navegador contra producción el 2026-09-21: la URL abre la
// sección, muestra su texto y la dirección queda en la barra, o sea que se puede copiar. El costo de
// aquel error no fue el comentario: fue el chip mandando a la home un día entero.
const canonID = (canonRef) => {
  const id = typeof canonRef === 'string' ? canonRef : (canonRef?.id || canonRef?.requested || '');
  const [node, anchor] = id.split('#', 2);
  const complete = node.includes('/') ? node : `${node}/context`;
  return anchor ? `${complete}#${anchor}` : complete;
};
const canonLink = (canonRef) => `${canonUrl.value}/?nodo=${encodeURIComponent(canonID(canonRef))}`;
// La evidencia que se registra en el cuerpo privado es el historial de cómo se trabajó la tarea. No
// se reduce a un texto de «retomar»: Trazador y Harness la consumen en la vista central.
const workEvidence = computed(() => active.value ? findingsOf(active.value.Key) : []);

// ── ORIENTACIÓN JEV ─────────────────────────────────────────────────────────────────────────────
// Es un acto EXPLÍCITO: abrir la franja no llama a nadie; «Analizar con Jev» es el consentimiento
// para enviar la proyección mínima de `make retomar`. La sugerencia no escribe Markdown, Jira, estado
// ni pendientes. Así conserva su lugar: decidir dónde mirar, no decidir ni ejecutar por la persona.
const jevOpen = ref(false);
const jevBusy = ref(false);
const jevError = ref('');
const jevGuidance = ref(null);
let jevRequest = 0;
const jevTarget = computed(() => {
  const effort = active.value ? effortOf(active.value.Key) : null;
  return effort?.id ? String(effort.id) : '';
});
function openGuidance() {
  jevOpen.value = !jevOpen.value;
  if (!jevOpen.value) { jevError.value = ''; jevGuidance.value = null; }
}
function closeGuidance() {
  jevOpen.value = false;
  jevBusy.value = false;
  jevError.value = '';
  jevGuidance.value = null;
  jevRequest++;
}
async function guideWithJev() {
  const target = jevTarget.value;
  if (!target || jevBusy.value) return;
  const request = ++jevRequest;
  jevBusy.value = true; jevError.value = ''; jevGuidance.value = null;
  try {
    const res = await fetch(`${SERVER}/api/jev/triage`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ task: target }),
    });
    const row = await res.json();
    if (request !== jevRequest) return;
    if (!res.ok || row.error) { jevError.value = row.error || 'No se pudo obtener una orientación.'; return; }
    jevGuidance.value = row.guidance || { review: true };
  } catch {
    if (request === jevRequest) jevError.value = 'No se pudo hablar con el servidor local.';
  } finally {
    if (request === jevRequest) jevBusy.value = false;
  }
}
function jevGuidanceText() {
  const row = jevGuidance.value;
  if (!row?.action) return '';
  const action = {
    ejecutar: 'Ejecutar el próximo paso', desbloquear: 'Desbloquear antes de avanzar',
    'pedir-respuesta': 'Pedir una respuesta', decidir: 'Tomar una decisión',
    'archivar-o-replantear': 'Replantear o archivar',
  }[row.action] || row.action;
  const urgency = ['puede esperar', 'normal', 'conviene priorizar', 'crítica'][Math.round(row.urgency || 0)] || 'a revisar';
  return `Orientación de siguiente paso\n\n${action} · urgencia ${urgency} · ${row.externalBlocker ? 'depende de terceros' : 'puede avanzar localmente'}\n\nPropuesta de Jev; revisar la tarea y la evidencia antes de cambiarla.`;
}
async function copyJevGuidance() {
  const text = jevGuidanceText();
  if (text) await toClipboard(text);
}

// COPIAR EL CUERPO ENTERO, para pegarlo en otro lado (Slack, un hilo, otra sesión).
//
// Se copia el MARKDOWN, no el HTML renderizado: es lo que se pegó bien en todos lados y lo que otra
// herramienta puede volver a parsear. Copiar el `innerText` del panel pierde las tablas y los bloques
// de código, que es justo lo que uno quiere compartir de estos cuerpos.
//
// Y va con encabezado: pegado suelto, este texto empieza en «## Si retomás esto sin contexto» y quien
// lo recibe no sabe de qué tarea es. Se le antepone la clave, el título y los temas de canon para
// que sea autosuficiente — más la advertencia de que es PRIVADO, porque lo es: nombra repos, rutas y
// F-xx, y no pasa el guard de Jira. La decisión de compartirlo es de quien copia; que salga sin el
// aviso, no.
const copied = ref('');       // '' | 'ok' | 'error'
const copiedWhich = ref('');   // qué botón lo dejó así, para pintar sólo ese
let copiedTimer = null;

// El marcador de anotación, COPIADO del server (`store/annotations.go`) y no reinventado: si los dos
// no cortan por la misma línea, lo que el panel muestra como «Cómo» y lo que el copiado saca dejan de
// ser lo mismo, y eso no falla — miente.
const RE_ANNOTATION = /^ {0,3}>\s*\*\*(MEDICI[ÓO]N|DECISI[ÓO]N|PREGUNTA|RIESGO)\s*·\s*\d{4}-\d{2}-\d{2}\s*(?:·\s*[^*]+?)?\s*\*\*/i;

// EL CORTE PARA COMPARTIR: se saca lo que es MÍO, no lo que «parece interno».
//
// La tentación era filtrar por palabras —borrar lo que diga `harness`, `playground`, `make …`— y es
// justo lo que NO hay que hacer: un filtro por regex se come 88 de 89 menciones y uno confía en él,
// que es peor que no tenerlo. Es la misma lección que el guard de Jira ya dejó escrita.
//
// Se corta por ESTRUCTURA, que el formato ya tiene. Medido sobre la tarea de Alta (89 líneas con
// herramientas, en 12 secciones): el grueso vive en dos lugares que no hay que adivinar —
//   · `## Registro`, que es el relato de qué se hizo cada día (48 de las 89);
//   · el `Cómo` de las anotaciones, o sea las citas que siguen al marcador, donde va el comando que
//     la vuelve a comprobar. El QUÉ se queda: el hallazgo es lo que se comparte.
//
// ⚠ Esto quita el RUIDO de mis herramientas. No es una garantía de privacidad: el cuerpo sigue
// nombrando repos, rutas y hallazgos, y por eso el encabezado lo sigue avisando.
// Las secciones que se van enteras. Son NOMBRES de la plantilla de tareas, no una heurística:
//   · el REGISTRO de qué hice cada día;
//   · CÓMO SE COMPRUEBA, que la plantilla define como «con qué lo probé» — el harness, las suites,
//     los curl contra localhost. Es justo lo que no le sirve a quien lo recibe.
//
// Cada una tiene DOS nombres, porque las tareas viejas usan los de antes y `tablero/CLAUDE.md` dice
// que no se migran: «Registro»/«Bitácora» y «Cómo se comprueba»/«Cómo probar / validar». Medido sobre
// las 41 tareas: 15 + 10 y 11 + 4. Cubrir sólo los nombres nuevos dejaba la mitad de las tareas sin
// cortar — y el corte que no corta es peor que no tenerlo, porque uno cree que sí.
//
// ⚠ «Cómo validar» (20 apariciones) NO entra y no es un olvido: vive del lado PUBLICABLE, que es la
// mitad escrita para QA y ni siquiera llega a `techNotes`. Verificado partiendo cada archivo por el
// marcador: las cuatro de arriba salen todas del cuerpo privado, «Cómo validar» todas de la publicable.
const OWN_SECTIONS = /^(registro|bit[áa]cora|c[óo]mo se comprueba|c[óo]mo probar)\b/i;

// ⚠ Los prefijos van con `^ {0,3}` y NO con `trimStart()`, y esa es la diferencia entre cortar bien
// y dejar contenido huérfano. En markdown un encabezado admite hasta TRES espacios de sangría; con
// CUATRO ya es un bloque de código indentado. Con `trimStart()` la línea `    # 1 · montar el
// comercio` —que es un comentario de shell dentro de un bloque— pasaba por encabezado de nivel 1,
// APAGABA el corte y dejaba escapar el resto de la sección. Se vio corriéndolo, no leyéndolo.
const RE_FENCE  = /^ {0,3}(```|~~~)/;
const RE_TITLE = /^ {0,3}(#{1,6})\s+(.+?)\s*$/;
const RE_CITATION   = /^ {0,3}>/;

function trimForSharing(md) {
  const out = [];
  let inBlock = false, inClip = false, afterAnnotation = false;
  const save = (l) => { if (!inClip) out.push(l); };
  for (const l of md.split('\n')) {
    // Dentro de un bloque de código un `>` o un `##` son contenido, no estructura — y acá se BORRA
    // texto, así que confundirlos cuesta caro.
    if (RE_FENCE.test(l)) { inBlock = !inBlock; afterAnnotation = false; save(l); continue; }
    if (inBlock) { save(l); continue; }
    const h = RE_TITLE.exec(l);
    if (h) {
      // Un encabezado de nivel 1 o 2 abre o cierra el recorte; los `###` de adentro son de su sección.
      if (h[1].length <= 2) inClip = OWN_SECTIONS.test(h[2]);
      afterAnnotation = false;
      if (inClip) continue;
    }
    if (inClip) continue;
    if (RE_ANNOTATION.test(l)) { out.push(l); afterAnnotation = true; continue; }
    if (afterAnnotation && RE_CITATION.test(l)) continue;   // el `Cómo`: fuera
    afterAnnotation = false;
    out.push(l);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function shareText(mode) {
  const i = active.value;
  if (!i) return '';
  const e = efforts.value.find(x => x.id === effortFor(i.Key));
  let body = bodyOf(i.Key);
  if (!body) return '';
  if (mode === 'compartir') body = trimForSharing(body);
  const topics = (e?.canon || '').split(',').map(s => s.trim()).filter(Boolean);
  // ⚠ Las líneas en blanco son SIGNIFICATIVAS acá, no decoración: sin la que separa la cita del
  // cuerpo, el primer párrafo se pega al `>` y markdown se lo traga DENTRO del blockquote. Por eso
  // la línea opcional de temas se decide al armar el arreglo y no con un `.filter` de vacíos
  // después — ese filtro se comía también los separadores, que es justo el bug que tenía esto.
  const citation = [`> Cuerpo técnico del tablero, copiado el ${new Date().toLocaleDateString('es-CO')}.`];
  if (topics.length) citation.push(`> Temas de canon: ${topics.join(', ')}.`);
  // Decir QUÉ se recortó, y no sólo que se recortó: quien lo recibe tiene que poder pedir lo que falta.
  if (mode === 'compartir') citation.push('> Recortado para compartir: sin el registro de trabajo, sin «cómo se comprueba» y sin los comandos de reproducción.');
  citation.push('> ⚠ PRIVADO — nombra repos, rutas y hallazgos internos. Esto NO es lo que sale a Jira.');
  const title = `# ${i.Key} · ${e?.title || i.Summary || ''}`.trim();
  return [title, '', ...citation, '', body.trim(), ''].join('\n');
}

async function copyBody(mode) {
  const txt = shareText(mode);
  if (!txt) return;
  clearTimeout(copiedTimer);
  copiedWhich.value = mode;
  copied.value = (await toClipboard(txt)) ? 'ok' : 'error';
  copiedTimer = setTimeout(() => { copied.value = ''; copiedWhich.value = ''; }, 2000);
}

// Dos caminos, y el respaldo cuelga de que el primero FALLE, no de que falte.
//
// ⚠ Esa distinción es el bug que tenía esto y que sólo apareció probándolo: `navigator.clipboard`
// puede EXISTIR y aun así rechazar. Pide contexto seguro **y** documento enfocado, así que tira
// `NotAllowedError` si la pestaña perdió el foco — y como yo miraba sólo si la función existía, el
// respaldo quedaba muerto y el botón se ponía en rojo con la API ahí, disponible.
async function toClipboard(txt) {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(txt); return true; }
  } catch { /* sigue al respaldo */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = txt;
    ta.style.cssText = 'position:fixed;top:-9999px;opacity:0';
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

// Cambiar de tarea limpia el estado: si no, la siguiente se abre mostrando un ✓ de la anterior.
watch(() => active.value?.Key, () => {
  clearTimeout(copiedTimer); copied.value = ''; copiedWhich.value = '';
  closeGuidance();
});
/* ── PESTAÑAS DEL EDITOR ─────────────────────────────────────────────────────────────────────────
 * Varias tareas abiertas a la vez, como los archivos en VS Code.
 *
 * ⚠ LA PIEZA QUE HACE QUE ESTO SIRVA ES LA PESTAÑA EN PREVISTA, y es la que se suele saltear. Un clic
 * en el árbol abre la tarea en PREVISTA (en itálica) y el siguiente clic la REEMPLAZA en vez de sumar
 * otra: recorrer 35 tareas deja UNA pestaña, no 35. Se FIJA con doble clic en la fila, con un clic en
 * su propia pestaña, o sola en cuanto hacés algo sobre esa tarea. Sin esto, «abrir varias» se
 * convierte en «tener veinte y no encontrar ninguna» a los diez minutos.
 *
 * Se guardan los OBJETOS y no las claves: una tarea abierta tiene que sobrevivir a que un filtro la
 * saque del árbol. El computed la re-resuelve contra los datos vivos cuando sigue estando. */
const tabItems = ref([]);     // tareas abiertas, en orden
const preview = ref('');       // la clave de la que está en previsualización, si hay alguna
// Las vistas auxiliares se pueden ocultar y siempre se recuperan desde el pie. En una ventana mediana
// arrancan plegadas para que el documento conserve ancho; abrirlas ahí es una decisión temporal y no pisa la
// preferencia que rige las ventanas grandes.
const auxVisible = ref(readPreference('aux-visible', true) !== false);
const COMPACT_DETAIL_THRESHOLD = 1050;
const compactWindow = ref(typeof window !== 'undefined' && window.innerWidth <= COMPACT_DETAIL_THRESHOLD);
const compactDetailOpen = ref(false);
const showAux = computed(() => !!active.value && auxVisible.value && (!compactWindow.value || compactDetailOpen.value));
function toggleDetail() {
  if (compactWindow.value) {
    if (showAux.value) compactDetailOpen.value = false;
    else { auxVisible.value = true; compactDetailOpen.value = true; }
    return;
  }
  auxVisible.value = !auxVisible.value;
}
const sidebarVisible = ref(readPreference('sidebar-visible', true) !== false);
// La consola muestra sólo las ramas de la tarea enfocada. Su visibilidad y alto sobreviven al cambio
// de tarea, y el botón textual del pie evita que el punto de entrada desaparezca cuando está cerrada.
const branchConsoleVisible = ref(readPreference('repos-console-visible', true) !== false);
const branchConsoleHeight = ref(readPreference('ramas-panel-height', 260) || 260);
const branchPanelToggle = ref(null);
const showBranchConsole = computed(() => branchConsoleVisible.value && !!active.value);
const branchPanelResize = computed(() => ({
  label: 'Alto de la consola de ramas', axis: 'y', sign: -1, min: 150,
  max: () => Math.max(150, Math.min(560, window.innerHeight - 300)),
  defaultValue: 260, collapsible: true,
  get: () => branchConsoleHeight.value,
  set: (v) => {
    if (!v) branchConsoleVisible.value = false;
    else { branchConsoleHeight.value = v; branchConsoleVisible.value = true; }
  },
  commit: (v) => {
    if (v) savePreference('ramas-panel-height', v);
    savePreference('repos-console-visible', !!v);
  },
}));
function hideBranchConsole() {
  branchConsoleVisible.value = false;
  savePreference('repos-console-visible', false);
  nextTick(() => branchPanelToggle.value?.focus());
}
function showBranchPanel() {
  branchConsoleVisible.value = true;
  savePreference('repos-console-visible', true);
}
function toggleBranchConsole() {
  if (branchConsoleVisible.value) hideBranchConsole();
  else showBranchPanel();
}
/* ── RECORRIDO CENTRAL Y PESTAÑAS DEL SIDEBAR DERECHO ─────────────────────────────────────────────
 * El centro es una línea de tiempo de días. A la derecha quedan Jira, Pendientes y los Artifacts
 * de la tarea como consultas en paralelo. */

/* Las vistas de consulta de UNA tarea comparten todo el alto de la región. Con acordeón, seis
 * encabezados le quitaban espacio a Jira y la descripción terminaba dentro de una tarjeta pequeña;
 * las pestañas dejan un solo riel compacto y un cuerpo continuo. La evidencia para continuar vive
 * en el centro; Jira abre primero porque es la consulta secundaria más frecuente. */
const activeAuxView = ref('jira');
const auxOpen = (id) => activeAuxView.value === id;
// Elige la vista Y muestra la región. Desde el riel da lo mismo —si lo ves, la región está abierta—,
// pero el avance de pendientes del encabezado vive afuera: con la región plegada (o una ventana de
// ≤1050px, donde arranca plegada) cambiaba la pestaña de algo oculto y el clic no hacía nada visible.
function openAux(id) {
  activeAuxView.value = id;
  if (showAux.value) return;
  auxVisible.value = true;
  if (compactWindow.value) compactDetailOpen.value = true;
}
const auxViews = computed(() => taskTabs.value);
function auxTabsKeyboard(event, id) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const ids = auxViews.value.map((view) => view.id);
  const currentValue = ids.indexOf(id);
  const upcoming = event.key === 'Home' ? 0 : event.key === 'End' ? ids.length - 1
    : (currentValue + (event.key === 'ArrowRight' ? 1 : -1) + ids.length) % ids.length;
  activeAuxView.value = ids[upcoming];
  nextTick(() => event.currentTarget.parentElement?.querySelector(`[data-vista="${ids[upcoming]}"]`)?.focus());
}

/* ── LAS MANIJAS DE LOS DOS SIDEBARS ──────────────────────────────────────────────────────────────
 * ⚠ El ancho se escribe en el `.workbench`, no en `:root`: así es de ESTA herramienta y no pisa el
 * default que declara `taller.css` para las demás. Y se persiste — un ancho que se pierde al refrescar
 * es peor que no poder cambiarlo, porque lo volvés a ajustar cada vez. */
// ⚠ El tope NO puede ser un número fijo: tiene que dejarle al EDITOR un ancho usable. Medido
// arrastrando en una ventana de 927px — con la ficha en 463 el editor quedaba en 164px, o sea el
// documento en una columna de veinte caracteres. El máximo se calcula contra la ventana y el ancho
// de la OTRA columna, así que el editor nunca baja de `MIN_EDITOR`.
/* ── EL ANCHO DE LOS DOS SIDEBARS ────────────────────────────────────────────────────────────────
 * ⚠ El ancho PREFERIDO y el APLICADO son dos cosas distintas, y confundirlos era el bug: si para que
 * entre achico la variable CSS, la próxima vez que la ventana crezca la columna se queda chica — tu
 * elección se perdió sin que la cambiaras. `preferido` es lo que vos elegiste (y lo que se guarda);
 * lo que se pinta es `min(preferido, lo que hay)`.
 *
 * Y el reparto tiene orden: cuando no entra, se achica primero el AUXILIARYBAR —es el accesorio— y
 * sólo si aún no alcanza se toca el de las tareas, que es por donde se navega. */
const MIN_EDITOR = 320;
const WIDTHS = {
  '--sidebar-w': ['sidebar-w', 200, 520],
  '--auxiliarybar-w': ['aux-w', 260, 760],
};
const preferred = {
  '--sidebar-w': readPreference('sidebar-w', 0) || 300,
  '--auxiliarybar-w': readPreference('aux-w', 0) || 340,
};

function applyWidths() {
  const wb = document.querySelector('.workbench');
  // ⚠ Sin layout no hay nada que repartir, y repartir cero colapsa las dos columnas a su mínimo y las
  // deja ahí. Pasa de verdad: una pestaña oculta, una página restaurada de la caché de atrás/adelante
  // o una vista de impresión informan `innerWidth: 0`. El `resize` vuelve a llamar cuando haya.
  if (!wb || !window.innerWidth) return;
  const hasAux = !!document.querySelector('.auxiliarybar');
  let sb = sidebarVisible.value ? Math.min(WIDTHS['--sidebar-w'][2], preferred['--sidebar-w']) : 0;
  let aux = hasAux ? Math.min(WIDTHS['--auxiliarybar-w'][2], preferred['--auxiliarybar-w']) : 0;
  let missing = sb + aux + MIN_EDITOR - window.innerWidth;
  if (missing > 0 && hasAux) {
    const clip = Math.min(missing, aux - WIDTHS['--auxiliarybar-w'][1]);
    if (clip > 0) { aux -= clip; missing -= clip; }
  }
  if (missing > 0 && sidebarVisible.value) sb = Math.max(160, sb - missing);
  wb.style.setProperty('--sidebar-w', sb + 'px');
  wb.style.setProperty('--auxiliarybar-w', aux + 'px');
  refreshResizers(wb);
}

function resizeOptions(cssVar, sign) {
  const [key, min, limit] = WIDTHS[cssVar];
  const root = () => document.querySelector('.workbench');
  return {
    label: cssVar === '--sidebar-w' ? 'Ancho de la lista de tareas' : 'Ancho de las vistas de la tarea',
    min, sign, defaultValue: cssVar === '--sidebar-w' ? 300 : 340,
    max: () => {
      const other = document.querySelector(cssVar === '--sidebar-w' ? '.auxiliarybar' : '.sidebar');
      return Math.max(160, Math.min(limit, window.innerWidth - (other?.getBoundingClientRect().width || 0) - MIN_EDITOR));
    },
    get: () => parseFloat(getComputedStyle(root()).getPropertyValue(cssVar)),
    set: (v) => { preferred[cssVar] = v; root().style.setProperty(cssVar, v + 'px'); },
    commit: (v) => savePreference(key, v),
  };
}

// Se re-acomoda al abrir, al cambiar el tamaño de la ventana y cuando la ficha aparece o se va —
// que es cuando cambia cuánto hay para repartir.
function updateLayout() {
  if (taskMenu.value) closeTaskMenu();
  const compact = window.innerWidth <= COMPACT_DETAIL_THRESHOLD;
  if (compact && !compactWindow.value) compactDetailOpen.value = false;
  compactWindow.value = compact;
  applyWidths();
}
onMounted(() => { updateLayout(); window.addEventListener('resize', updateLayout); });
onUnmounted(() => window.removeEventListener('resize', updateLayout));
watch([() => !!active.value, showAux, sidebarVisible], () => nextTick(applyWidths));
watch(auxVisible, (v) => savePreference('aux-visible', v));
watch(sidebarVisible, (v) => savePreference('sidebar-visible', v));
const openTabs = computed(() =>
  tabItems.value.map((t) => unfiltered.value.find((x) => x.Key === t.Key) || t));

function openTask(task, pin = false) {
  const taskChange = active.value?.Key !== task.Key;
  const existing = tabItems.value.some((t) => t.Key === task.Key);
  if (!existing) {
    tabItems.value = preview.value && !pin
      ? tabItems.value.map((t) => (t.Key === preview.value ? task : t))
      : [...tabItems.value, task];
    preview.value = pin ? '' : task.Key;
  } else if (pin && preview.value === task.Key) {
    preview.value = '';
  }
  active.value = task;
  if (taskChange) {
    resetPendingReview();
    activeAuxView.value = 'jira';
  }
}
function closeTab(k) {
  const i = tabItems.value.findIndex((t) => t.Key === k);
  if (i < 0) return;
  tabItems.value = tabItems.value.filter((t) => t.Key !== k);
  if (preview.value === k) preview.value = '';
  // Al cerrar la activa se enfoca la VECINA —la de la derecha, y si no hay, la de la izquierda—, no se
  // cae al sprint: cerrar una de cinco y perder el contexto de las otras cuatro sería un castigo.
  if (active.value?.Key === k) {
    const sig = tabItems.value[i] || tabItems.value[i - 1] || null;
    active.value = sig || null;
    resetPendingReview();
    if (sig) {
      activeAuxView.value = 'jira';
    }
  }
}

/* ── RUTAS DE TAREA ──────────────────────────────────────────────────────────────────────────────
 * El estado visible vive también en la URL: `#/tareas/context` o `#/tareas/core-543`. Se usa hash
 * routing porque Tablero se sirve como archivos estáticos y una recarga de `/tareas/context`
 * dependería de que cada servidor conociera el fallback a index.html. El hash sobrevive igual a una
 * recarga, se puede copiar y funciona con atrás/adelante sin tocar el server.
 *
 * Los contenedores locales se nombran por su título canónico; las tareas de Jira por su clave. No se
 * usa el id local porque puede renumerarse al consolidar archivos. */
const routeSlug = (value) => withoutAccents(value).trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const taskRoute = (task) => task ? `#/tareas/${task._local ? routeSlug(task.Summary) : task.Key.toLowerCase()}` : '';
const slugFromRoute = () => {
  const m = window.location.hash.match(/^#\/tareas\/([^/?#]+)\/?$/);
  try { return m ? decodeURIComponent(m[1]).toLowerCase() : ''; }
  catch { return ''; }
};
const tasksForRoute = () => {
  const unique = new Map();
  for (const task of [...issues.value, ...bySprint.value.flatMap(g => g.issues || []), ...allLocals.value]) {
    if (!unique.has(task.Key)) unique.set(task.Key, task);
  }
  return [...unique.values()];
};
let routesReady = false;
let restoringRoute = false;
function writeRoute(task) {
  const hash = taskRoute(task);
  if (window.location.hash === hash) return;
  window.history.pushState({}, '', `${window.location.pathname}${window.location.search}${hash}`);
}
function restoreRoute() {
  if (!routesReady) return;
  const slug = slugFromRoute();
  restoringRoute = true;
  if (!slug) {
    active.value = null;
  } else {
    const task = tasksForRoute().find(item => (item._local ? routeSlug(item.Summary) : item.Key.toLowerCase()) === slug);
    if (task) {
      if (task._local) showLocals.value = true;
      openTask(task, true);
    }
  }
  restoringRoute = false;
}
const onHistoryNavigate = () => restoreRoute();
onMounted(() => window.addEventListener('popstate', onHistoryNavigate));
onUnmounted(() => window.removeEventListener('popstate', onHistoryNavigate));

// ⚠ Cualquier camino que enfoque una tarea tiene que dejarle su pestaña y su ruta: el handoff a QA
// setea `active` directo, y sin este punto único el editor y la URL podrían contradecirse.
watch(active, (t) => {
  if (t && !tabItems.value.some((x) => x.Key === t.Key)) tabItems.value = [...tabItems.value, t];
  if (routesReady && !restoringRoute) writeRoute(t);
});

// ── hallazgos: los hechos con fecha que la tarea declara en su cuerpo ──────────────────────────
// Vienen del ESFUERZO, igual que los artifacts, y salen del texto: el server los recoge de los
// marcadores `> **MEDICIÓN · fecha** — …`. Ver `server/internal/store/annotations.go`.
//
// Lo que aportan sobre la prosa es la EDAD. Una medición de hace dos meses se lee igual de segura
// que la de ayer, y una pregunta abierta hace una semana no le grita a nadie. Acá la edad se ve, y
// eso es lo único que la prosa no puede hacer.
const findingsOf = (key) => efforts.value.find(e => e.id === effortFor(key))?.annotations || [];
const daysOf = (date) => Math.floor((Date.now() - new Date(date + 'T12:00:00')) / 86400000);
// Cuándo un hallazgo pide atención. Los umbrales son distintos a propósito: una medición aguanta un
// mes antes de sospechar, pero una pregunta sin responder a los 7 días ya está frenando algo.
const overdue = (a) => a.kind === 'medicion' ? daysOf(a.date) > 30
                     : a.kind === 'pregunta' ? daysOf(a.date) > 7 : false;
const AGE = { medicion: 'medido hace', pregunta: 'sin responder hace', decision: 'decidido hace', riesgo: 'asumido hace' };
const ageText = (a) => { const d = daysOf(a.date); return `${AGE[a.kind] || 'hace'} ${d === 0 ? 'hoy' : d === 1 ? '1 día' : d + ' días'}`.replace(' hoy', ' hoy').replace(/hace hoy/, 'hoy'); };
const KINDS = [
  { id: 'medicion', tit: 'Mediciones',  pie: 'Un número sin fecha ni forma de recomprobarlo envejece hasta volverse mentira.' },
  { id: 'decision', tit: 'Decisiones',  pie: 'Con fecha y motivo, para no volver a discutirlas desde cero.' },
  { id: 'pregunta', tit: 'Preguntas',   pie: 'Abiertas, con de quién se espera la respuesta.' },
  { id: 'riesgo',   tit: 'Riesgos',     pie: 'Lo que se aceptó a sabiendas. Cuando muerda, acá está el momento en que se aceptó.' },
];
const findingsByKind = (key) => KINDS
  .map(t => ({ ...t, items: findingsOf(key).filter(a => a.kind === t.id) }))
  .filter(g => g.items.length);
// CON QUÉ SE COMPROBÓ CADA HALLAZGO. Las etiquetas las deriva el SERVER (`store/sources.go`) del
// `Cómo` de cada anotación; acá sólo se pintan y se cuentan. No se re-deriva en el front a propósito:
// dos definiciones de «esto se midió con el arnés» no fallan, se contradicen.
// Los ambientes son los valores canónicos de `canonEnvironment`, en el mismo archivo del server.
const isEnvironment = (f) => ['prod', 'qa', 'staging', 'dev', 'local'].includes(f);
const isSqlFinding = (finding) => finding.sources?.includes('DB') && isSQLQuery(finding.how);

// El resumen de arriba contesta de un vistazo «¿cómo se concluyó lo que dice esta tarea?». Lo que más
// importa no son las herramientas: es cuántas anotaciones NO traen con qué volver a comprobarlas.
const provenanceOf = (key) => {
  const as = findingsOf(key);
  const count = {};
  let withoutHow = 0;
  for (const a of as) {
    const fs = a.sources || [];
    if (!fs.length) { withoutHow++; continue; }
    for (const f of fs) count[f] = (count[f] || 0) + 1;
  }
  return {
    total: as.length,
    withoutHow: withoutHow,
    withHow: as.length - withoutHow,
    // el ambiente primero: pesa más que la herramienta a la hora de creerle a una medición
    sources: Object.entries(count).sort((a, b) => (isEnvironment(b[0]) - isEnvironment(a[0])) || b[1] - a[1]),
  };
};

// ── PENDIENTES ───────────────────────────────────────────────────────────────────────────────────
// Lo que queda por hacer, sacado de las casillas del CUERPO (ver `pending.go` para el parser y el
// porqué del corte antes de la publicable). No se escriben ni se tildan desde acá a propósito: el
// cuerpo es el archivo, y editarlo por dos caminos es cómo se desincronizan las cosas.
const pendingOf = (key) => efforts.value.find(e => e.id === effortFor(key))?.pending || [];
// Lo que se cuenta son los ABIERTOS. Medido sobre las 41 tareas: 37 casillas escritas y 1 tildada —
// nadie vuelve a marcarlas—, así que el total diría "hay deuda" incluso cuando ya no queda nada.
const remaining = (key) => pendingOf(key).filter(p => !p.done).length;
// La barra de la cabecera no intenta adivinar el avance real: sólo expresa lo que sí está registrado
// en las casillas. Por eso muestra tanto el numerador como el total y lleva al detalle para corregir
// una tarea que se trabajó pero quedó sin tildar.
const pendingProgressOf = (key) => {
  const total = pendingOf(key).length;
  const doneItems = total - remaining(key);
  return total ? { total, done: doneItems, percent: Math.round(doneItems * 100 / total) } : null;
};
const openPendingOf = (key) => pendingOf(key).filter(p => !p.done);

// REVISIÓN JEV DE PENDIENTES. Es una lectura explícita, nunca una mutación: el servidor recibe una
// proyección acotada de la tarea sólo después del clic y devuelve tres estados fijos. Así el modelo
// puede señalar una casilla posiblemente vieja sin que su respuesta se convierta en una edición.
const pendingReview = ref(null);
const pendingReviewBusy = ref(false);
const pendingReviewError = ref('');
let pendingReviewRequest = 0;
function resetPendingReview() {
  pendingReviewRequest++;
  pendingReview.value = null;
  pendingReviewBusy.value = false;
  pendingReviewError.value = '';
}
async function reviewPendingWithJev() {
  const target = jevTarget.value;
  const key = active.value?.Key;
  if (!target || !key || !remaining(key) || pendingReviewBusy.value) return;
  const request = ++pendingReviewRequest;
  pendingReviewBusy.value = true;
  pendingReviewError.value = '';
  pendingReview.value = null;
  try {
    const res = await fetch(`${SERVER}/api/jev/pending-review`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ task: target }),
    });
    const row = await res.json();
    if (request !== pendingReviewRequest || active.value?.Key !== key) return;
    if (!res.ok || row.error) {
      pendingReviewError.value = row.error || 'No se pudieron revisar los pendientes.';
      return;
    }
    pendingReview.value = row.review || { items: [] };
  } catch {
    if (request === pendingReviewRequest) pendingReviewError.value = 'No se pudo hablar con el servidor local.';
  } finally {
    if (request === pendingReviewRequest) pendingReviewBusy.value = false;
  }
}
const pendingReviewLabel = (status) => ({
  resolved: 'Parece resuelto', open: 'Sigue abierto', unclear: 'Requiere revisión',
}[status] || 'Requiere revisión');
const pendingReviewClass = (status) => ({ resolved: 'resolved', open: 'open', unclear: 'unclear' }[status] || 'unclear');
const reviewPending = (item) => openPendingOf(active.value?.Key)[item.id];
const pendingReviewSummary = computed(() => {
  const items = pendingReview.value?.items || [];
  const resolved = items.filter(item => item.status === 'resolved').length;
  const openItems = items.filter(item => item.status === 'open').length;
  const doubtful = items.length - resolved - openItems;
  return [resolved && `${resolved} parece${resolved === 1 ? '' : 'n'} resuelto${resolved === 1 ? '' : 's'}`,
    openItems && `${openItems} sigue${openItems === 1 ? '' : 'n'} abierto${openItems === 1 ? '' : 's'}`,
    doubtful && `${doubtful} requiere${doubtful === 1 ? '' : 'n'} revisión`].filter(Boolean).join(' · ');
});
// Agrupados por el encabezado bajo el que se escribieron: en una tarea larga los pendientes vienen de
// frentes distintos («Pendientes», «Cerrar con negocio», «Al retomar»), y en una lista plana se leen
// todos como si fueran lo mismo.
const pendingBySection = (key) => {
  const groups = [];
  for (const p of pendingOf(key)) {
    const tit = p.section || 'Sin sección';
    const g = groups.find(x => x.tit === tit);
    (g || groups[groups.push({ tit, items: [] }) - 1]).items.push(p);
  }
  return groups;
};

// El sidebar conserva las consultas que se necesitan en paralelo: el contrato publicado (Jira), el
// checklist detallado (Pendientes) y lo que produjo la tarea (Artifacts). El razonamiento y la historia
// quedan en el centro; un artifact es una salida externa, no parte de esa lectura.
const taskTabs = computed(() => {
  const key = active.value?.Key;
  const tabs = [
    { id: 'jira', label: 'Jira' },
    { id: 'pendientes', label: 'Pendientes', count: remaining(key), alert: active.value?.StatusCategory === 'done' && remaining(key) > 0 },
    // Siempre se ve: si la tarea aún no dejó nada, la pestaña explica esa ausencia en vez de
    // desaparecer y hacer parecer que Tablero no tiene lugar para sus artifacts.
    { id: 'artifacts', label: 'Artifacts', count: key ? taskArtifacts(key).length : 0 },
  ];
  return tabs;
});
watch(auxViews, (views) => {
  if (!views.some((view) => view.id === activeAuxView.value)) activeAuxView.value = 'jira';
});
const closeOnEsc = (e) => { if (e.key === 'Escape' && taskMenu.value) closeTaskMenu(true); };
const closeTaskMenuOutside = (e) => {
  if (taskMenu.value && !taskMenuEl.value?.contains(e.target) && !taskMenuOrigin?.contains(e.target)) closeTaskMenu();
};
const closeTaskMenuOnScroll = (e) => {
  if (taskMenu.value && !taskMenuEl.value?.contains(e.target)) closeTaskMenu();
};
onMounted(() => {
  window.addEventListener('keydown', closeOnEsc);
  document.addEventListener('pointerdown', closeTaskMenuOutside, true);
  document.addEventListener('scroll', closeTaskMenuOnScroll, true);
});
onUnmounted(() => {
  window.removeEventListener('keydown', closeOnEsc);
  document.removeEventListener('pointerdown', closeTaskMenuOutside, true);
  document.removeEventListener('scroll', closeTaskMenuOnScroll, true);
  clearTimeout(copiedTimer);
});
// ── mi jornada: los últimos días × horas laborales ──────────────────────────────────────────────
// Este mapa NO va por sprint: muestra cómo se llenó mi horario laboral (8→18, con almuerzo 12→14) en los
// últimos días corridos. La pregunta que contesta es distinta a "en qué trabajé": es "cómo trabajé" —
// mañanas cargadas y tardes flojas, días partidos, jornadas que se estiran. Por eso lee la HORA de cada
// registro, no sólo el día, y es independiente del sprint que estés mirando arriba.
//
// LA FUENTE ES EL PULSO, y sólo el pulso: cuándo toqué los repos de la compañía. Los avances contestan
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
const CELL = 24, GAP = 4, HOUR_LABEL = 30, SEP = 9; // px: celda · separación normal · etiqueta de hora · margen de sprint
const gridVars = { '--cel': `${CELL}px`, '--gap': `${GAP}px`, '--jhl': `${HOUR_LABEL}px`, '--sep': `${SEP}px` };

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
const widthWith = (n) => {
  const base = HOUR_LABEL + GAP + n * (CELL + GAP);
  const cols = isoCols(n);
  const starts = new Set(), ends = new Set();
  for (const sp of sprints.value || []) {
    if (!sp.startDate || !sp.endDate) continue;
    const s = dayKey(sp.startDate), e = dayKey(sp.endDate);
    let a = -1, b = -1;
    cols.forEach((c, i) => { if (c >= s && c <= e) { if (a < 0) a = i; b = i; } });
    if (a >= 0) { starts.add(a); ends.add(b); }
  }
  return base + SEP * (starts.size + ends.size);
};

// El más grande que entra. Se busca de mayor a menor en vez de despejar la fórmula porque el costo de
// los márgenes no es lineal: sumar un día puede meter un sprint nuevo y con él dos márgenes de golpe.
const days = computed(() => {
  if (!gridW.value) return DAYS_MIN;         // antes de medir: lo mínimo, para no dibujar y re-dibujar
  for (let n = DAYS_MAX; n > DAYS_MIN; n--) if (widthWith(n) <= gridW.value) return n;
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
watch(gridEl, (el, old) => {
  if (old) ro.unobserve(old);
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
// Lo anota un agente (`server/cmd/pulse`) cada 5 minutos, corra o no el tablero. La unidad es el TRAMO
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

// TRES estados, no dos, y esa es la diferencia con los avances: además de "hubo cambios" y "no hubo",
// el pulso sabe si el agente estaba MIRANDO. Un hueco porque el Mac estaba apagado no es un hueco de
// trabajo, y pintarlos igual convertiría el mapa en una acusación falsa.
const codeClass = (iso, h) => {
  const c = codeAt(iso, h);
  if (!c || (!c.slots && !c.covered)) return 'n0';     // sin registro → rayado (como un avance sin datos)
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
    const own = [];
    if (r.commits) own.push(`${r.commits} commit${r.commits === 1 ? '' : 's'}`);
    if (r.ins || r.del) own.push(`+${r.ins}/−${r.del}`);
    return `  ${r.repo}${r.branch ? ` · ${r.branch}` : ''}${own.length ? ` — ${own.join(' ')}` : ''}`;
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
  const outside = outsideMin(iso);
  return minHhmm(dayMin(iso)) + (outside ? ` · ${minHhmm(outside)} fuera de ${hourLabel(H_START)}–${hourLabel(H_END)}` : '');
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
  let x = HOUR_LABEL + GAP;
  for (let j = 0; j < i; j++) {
    x += CELL + GAP + (startCols.value.has(j) ? SEP : 0) + (endCols.value.has(j) ? SEP : 0);
  }
  return x + (startCols.value.has(i) ? SEP : 0);
};
const spanStyle = (t) => {
  const l = leftOf(t.a);
  return { left: `${l}px`, width: `${leftOf(t.b) + CELL - l}px` };
};

// ── handoff a QA: pasar a pruebas y avisarle a quien valida, en un solo click ────────────────────
// Es la única acción del tablero que ESCRIBE en Jira. Dos pasos que en la vida real son uno: mover la
// tarjeta y que el que prueba se entere. Separados, el aviso se olvida.
//
// El mensaje se PREVISUALIZA y se puede editar antes de salir: nunca se manda algo que no se vio. El
// server lo re-valida contra el guard (el mismo de los avances) antes de publicarlo en Slack.
const qa = ref(null); // null = panel cerrado; si no: { key, text, transition, name, email, blocked }
const qaBusy = ref(false);
const qaDone = ref('');   // resultado del último envío, para mostrarlo en la tarjeta
const qaError = ref('');
const qaProblems = ref([]);

// En pruebas ya no hay nada que avisar; el botón solo aparece antes de eso. Es por TAREA y no sobre la
// activa: ahora cada tarjeta trae su propio botón.
const inTesting = (i) => /pruebas/i.test(i?.Status || '');
// (Acá vivía `yaPasoPorQA`, que decidía cuándo esconder el viejo botón «A pruebas». Se fue con el
// botón específico: el acceso de la fila consulta Jira y después conserva sólo el avance normal.)

// ── mover de estado desde el árbol: los destinos los DEFINE JIRA ───────────────────────────────
// El cambio de estado pertenece a la tarea de la lista, así que aparece en el borde de esa fila (y
// también con su menú contextual). El menú consulta Jira al abrirse y no obliga a abrir la tarea para
// saber adónde puede ir desde su estado actual.
const taskMenu = ref(null); // { task, x, y, transitions, testing, loading, error }
const taskMenuEl = ref(null);
let taskMenuOrigin = null;
let taskMenuQuery = 0;
const stateName = (rawText) => (rawText || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// Jira devuelve todas las SALIDAS, pero el acceso rápido representa sólo AVANZAR. El orden es el
// flujo vigente de CORE; se matchea por fragmentos y no por ids, emojis ni nombres de transición.
// Bloqueada y En pruebas vuelven al cauce normal; Terminada no tiene un paso siguiente.
function nextTransition(task, transitions) {
  const currentValue = stateName(task.Status);
  const destination = currentValue.includes('bloquead') ? 'progreso'
    : currentValue.includes('pruebas') ? 'terminad'
    : currentValue.includes('por hacer') ? 'progreso'
    : currentValue.includes('progreso') ? 'revision'
    : currentValue.includes('revision') ? 'terminad'
    : '';
  return destination ? transitions.find((t) => stateName(t.to).includes(destination)) : null;
}

function closeTaskMenu(restoreFocus = false) {
  taskMenuQuery += 1;
  taskMenu.value = null;
  if (restoreFocus && taskMenuOrigin?.isConnected) taskMenuOrigin.focus({ preventScroll: true });
  taskMenuOrigin = null;
}

async function focusAndFitTaskMenu() {
  await nextTick();
  const menu = taskMenuEl.value;
  if (!menu || !taskMenu.value) return;
  const box = menu.getBoundingClientRect();
  taskMenu.value.x = Math.max(8, Math.min(taskMenu.value.x, window.innerWidth - box.width - 8));
  taskMenu.value.y = Math.max(8, Math.min(taskMenu.value.y, window.innerHeight - box.height - 8));
  await nextTick();
  (menu.querySelector('[role="menuitem"]:not(:disabled)') || menu).focus({ preventScroll: true });
}

async function openTaskMenu(event, task) {
  event.preventDefault();
  event.stopPropagation();
  const rect = event.currentTarget.getBoundingClientRect();
  const keyboard = event.type === 'keydown' || (!event.clientX && !event.clientY);
  closeTaskMenu();
  taskMenuOrigin = event.currentTarget;
  const query = ++taskMenuQuery;
  taskMenu.value = {
    task,
    x: keyboard ? (event.currentTarget.classList.contains('tree-state') ? rect.right : rect.left + 18) : event.clientX,
    y: keyboard ? rect.bottom + 2 : event.clientY,
    transitions: [], testing: 'pruebas', loading: !task._local,
    error: task._local ? 'La tarea local no usa estados de Jira' : '',
  };
  await focusAndFitTaskMenu();
  if (task._local) return;
  try {
    const j = await (await fetch(`${SERVER}/api/transitions?key=${task.Key}`)).json();
    if (query !== taskMenuQuery || taskMenu.value?.task.Key !== task.Key) return;
    taskMenu.value.loading = false;
    if (j.error) taskMenu.value.error = j.error;
    else {
      const upcoming = nextTransition(task, j.transitions || []);
      if (!upcoming) taskMenu.value.error = `Jira no ofrece un paso siguiente desde «${task.Status}»`;
      else taskMenu.value.transitions = [upcoming];
      taskMenu.value.testing = j.testing || 'pruebas';
    }
  } catch {
    if (query === taskMenuQuery && taskMenu.value?.task.Key === task.Key) {
      taskMenu.value.loading = false;
      taskMenu.value.error = 'No se pudo hablar con el server';
    }
  }
  await focusAndFitTaskMenu();
}

function openTaskMenuWithKeyboard(event, task) {
  if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) openTaskMenu(event, task);
}

function taskMenuKeys(event) {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeTaskMenu(true); return; }
  if (event.key === 'Tab') { closeTaskMenu(); return; }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const items = [...taskMenuEl.value.querySelectorAll('[role="menuitem"]:not(:disabled)')];
  if (!items.length) return;
  const current = items.indexOf(document.activeElement);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
    : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
  items[next]?.focus({ preventScroll: true });
}

// El destino que coincide con el estado de pruebas no se mueve directo: cae en el flujo de QA, donde
// mover y avisarle a quien valida son un mismo acto y el mensaje se previsualiza.
const isTowardTesting = (t, testing = taskMenu.value?.testing || 'pruebas') =>
  (t.to || '').toLowerCase().includes(testing.toLowerCase());

async function applyTransition(t) {
  const state = taskMenu.value;
  if (!state || state.loading) return;
  const task = state.task;
  if (isTowardTesting(t, state.testing)) { closeTaskMenu(); await openQA(task); return; }
  state.loading = true; state.error = '';
  try {
    const j = await (await fetch(`${SERVER}/api/transitions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: task.Key, id: t.id }),
    })).json();
    if (j.error) { state.error = j.error; return; }
    closeTaskMenu();
    // Se recarga desde Jira en vez de simular el cambio acá: el estado nuevo puede traer otras cosas
    // y una copia local sería una segunda verdad.
    await loadSprint(sprint.value?.id);
    if (wideView.value) await loadLast4();
  } catch { state.error = 'No se pudo hablar con el server'; }
  finally { if (taskMenu.value === state) state.loading = false; }
}

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
  const hadData = !!sprint.value;
  if (!hadData) { loading.value = true; error.value = ''; }
  try {
    const j = await (await fetch(`${SERVER}/api/sprint?board=${BOARD}${id ? `&id=${id}` : ''}`)).json();
    if (j.error) {
      if (hadData) syncError.value = j.error;
      else error.value = j.error;
      return false;
    }
    else {
      sprint.value = j.sprint;
      site.value = j.site || site.value;
      issues.value = j.issues || [];
      // ⚠ NO se autoselecciona ninguna. Antes sí —quedaba la que estaba en curso— porque `active`
      // sólo decía «sobre cuál se registra tiempo» y el detalle vivía en un cajón que se abría aparte.
      // Ahora `active` es LO QUE MUESTRA EL EDITOR, así que autoseleccionar significaba entrar
      // directo a una tarea y no ver nunca el sprint. Todos los usos de `active` están guardados
      // (`if (!active.value)`, `active.value?.`), así que arrancar en null es seguro.
    }
    // Los avances son locales y completan la vista después; no retrasan la primera pintura del sprint.
    void loadEntries();
    saveBootstrap();
    return true;
  } catch {
    const message = 'no se pudo hablar con el server (¿está corriendo en :8787?)';
    if (hadData) syncError.value = message;
    else error.value = message;
    return false;
  } finally { loading.value = false; }
}

async function loadSprints() {
  try {
    // Se piden más de los que el selector muestra: las bandas de «Mi jornada» cubren toda la ventana, y
    // esa ventana crece con el ancho de la pantalla. Con sólo 4, las columnas más viejas quedaban sin
    // banda y parecían días fuera de todo sprint, que es otra cosa.
    const j = await (await fetch(`${SERVER}/api/sprints?board=${BOARD}&n=12`)).json();
    if (j.error) { syncError.value ||= j.error; return false; }
    sprints.value = j.sprints || [];
    site.value = j.site || site.value;
    return true;
  } catch {
    syncError.value ||= 'no se pudo actualizar la lista de sprints';
    return false;
  }
}

async function updateStart() {
  jiraSyncing.value = true;
  syncError.value = '';
  try {
    // Todo lo local corre junto y todo lo remoto corre junto. Antes se esperaba sprints → esfuerzos →
    // pulso → sprint → avances → cuatro sprints: `fetch` era AJAX, pero la secuencia seguía bloqueando
    // la restauración de la ruta como si fuera una navegación completa.
    const locales = Promise.allSettled([loadEfforts(), loadTaskLocals(), loadConfig(), loadPulse(), loadBranches()]);
    const [, sprintResult] = await Promise.allSettled([loadSprints(), loadSprint()]);

    // El sprint principal basta para restaurar la mayoría de rutas; los otros tres llegan después.
    routesReady = true;
    restoreRoute();
    if (sprintResult.status === 'fulfilled' && sprintResult.value) await loadLast4();

    await locales;
    // Una ruta local depende de efforts/task-locals, y una Jira antigua puede depender de bySprint.
    restoreRoute();
    saveBootstrap();
  } finally { jiraSyncing.value = false; }
}

onMounted(() => {
  // Con cache, la ruta y el editor aparecen en el primer frame. La revalidación no los desmonta.
  if (bootstrapCache) { routesReady = true; restoreRoute(); }
  void updateStart();
});

const documentMenu = computed(() => [
  { id: 'copiar-todo', label: 'Copiar completo para retomar', icon: 'copy', disabled: !documentSections.value.length,
    title: 'Incluye el registro de trabajo y los comandos de reproducción' },
])
function documentAction(id) {
  if (id === 'copiar-todo') copyBody('todo')
}

</script>

<template>
  <!-- EL TABLERO ES UN WORKBENCH (`taller.css`). Antes era una página que scrolleaba con las tareas
       como grilla de tarjetas y un CAJÓN encima al elegir una. Ahora: el árbol de tareas en el
       `sidebar`, lo elegido en el `editor`, y sin nada elegido el editor muestra el sprint — que es
       la pestaña de bienvenida. El cajón se fue: su contenido ES el editor. -->
  <div class="workbench" :class="{ ancha: wideView, 'con-consola-ramas': showBranchConsole }">
    <!-- ⚠ SIN TITLEBAR, a propósito. Decía «Tablero · Sprint N · registro de tiempo y
         hallazgos» y se comía 77px de alto para repetir lo que ya dicen la pestaña del
         navegador y el statusbar. Su única acción —«sólo este sprint»— se fue al menú ⋯ del
         sidebar, que es donde viven las cosas que se alternan y se tocan poco. -->

    <!-- SIDEBAR · el título arriba y debajo el ACORDEÓN, como el Explorer de VS Code: «EXPLORER»
         y bajo él las vistas apiladas. Acá el título lleva lo que vale para TODAS —el conteo, el
         plegado y el menú ⋯— y cada GRUPO de estado es una vista propia. Arranca abierta sólo
         «En curso»: es lo que estás haciendo hoy.

         ⚠ Cinco vistas cerradas cuestan 5 filas (~160px), y eso se paga a gusto: los cinco estados
         con su conteo quedan a la vista SIEMPRE, sin desplegar nada. Antes había que abrir un
         grupo para saber cuántas tenía. -->
    <aside id="tasks-sidebar" class="sidebar" v-show="sidebarVisible" aria-label="Lista de tareas">
      <div class="rsz rsz-sb" v-resize="resizeOptions('--sidebar-w', 1)"></div>
      <div class="region-head">
        <span>{{ wideView ? `Mis tareas · ${bySprint.length} sprints` : "Mis tareas" }}</span>
        <!-- ⚠ ESTE CONTADOR ES LO QUE HABILITA MANDAR LOS FILTROS AL MENÚ. Un filtro escondido que
             nadie ve se olvida encendido, y después la tarea que falta se lee como «no existe». -->
        <span v-if="!loadingWide" class="cnt" :class="{ filtrando: hidden.size || normalizedSearch }"
              :title="hidden.size || normalizedSearch ? 'hay un filtro puesto — está en el menú ⋯' : ''">{{ hidden.size || normalizedSearch ? `${visible} / ${totalTasks}` : visible }}</span>
        <div v-if="!loadingWide && totalTasks" class="region-actions toolbar">
          <button type="button" class="region-action" title="Colapsar o desplegar todos los grupos"
                  @click="collapseAll" aria-label="Colapsar o desplegar todos los grupos"><span class="ui-icon" data-icon="collapse" aria-hidden="true"></span></button>
          <RegionMenu :items="filtersMenu" :active="!!hidden.size || !!normalizedSearch" title="Qué tareas se ven" @toggle="fromMenu" />
        </div>
      </div>

      <p v-if="wideView && loadingWide" class="nota">trayendo los sprints…</p>
      <!-- El buscador NO se movió al menú: se usa todo el tiempo, es una sola fila y vale para las
           cinco vistas a la vez. Va arriba del acordeón por eso mismo. -->
      <div class="filtros" v-if="!loadingWide && totalTasks">
        <label class="fbusca input-group" :class="{ act: !!normalizedSearch }">
          <span class="ui-icon" data-icon="search" aria-hidden="true"></span>
          <input v-model="searchQuery" class="input" type="search" placeholder="buscar por título…"
                 aria-label="Buscar tarea por título o clave">
          <button v-if="searchQuery" class="btn btn-ghost btn-icon btn-xs fx" type="button" title="limpiar" @click="searchQuery = ''" aria-label="Limpiar búsqueda"><span class="ui-icon" data-icon="close" aria-hidden="true"></span></button>
        </label>
      </div>
      <!-- Sin resultados NO puede ser una lista vacía a secas: se lee como «no tengo tareas», que es
           otra cosa. Dice qué se buscó y ofrece deshacerlo. -->
      <p v-if="!loadingWide && totalTasks && !visible" class="nota">
        Ninguna tarea coincide<span v-if="normalizedSearch"> con «<b>{{ searchQuery.trim() }}</b>»</span><span
          v-if="hidden.size"> entre los estados que dejaste visibles</span>.
        <button class="btn-link lnk" type="button" @click="searchQuery = ''; hidden.clear()">ver todas</button>
      </p>

      <!-- UNA VISTA POR ESTADO. ⚠ Con búsqueda puesta se abren TODAS: buscar y que el resultado
           quede escondido detrás de un grupo plegado es la forma más rápida de creer que no está. -->
      <section v-for="g in groupedIssues" :key="g.id" class="view"
               :class="{ abierta: isOpen(g.id) || !!normalizedSearch }">
        <div class="region-head">
          <button type="button" class="view-tog" :aria-expanded="isOpen(g.id) || !!normalizedSearch"
                  :aria-controls="'group-' + g.id" @click="toggleSection(g.id)">
            <span class="ui-icon" data-icon="chevron" aria-hidden="true"></span>
            <span>{{ g.title }}</span>
          </button>
          <span class="cnt">{{ g.tasks.length }}</span>
        </div>
        <div v-if="isOpen(g.id) || normalizedSearch" :id="'group-' + g.id" class="region-body">
          <!-- La fila ENTERA es el botón: elegir una tarea es el gesto de esta columna, y un
               target de 28px de alto se acierta sin mirar. -->
          <div v-for="i in g.tasks" :key="i.Key" class="tree-item">
            <button type="button" class="tree-row"
              :class="{ sel: active?.Key === i.Key, done: i.StatusCategory === 'done' }"
              :title="i.Summary" @click="openTask(i)" @dblclick="openTask(i, true)"
              @contextmenu="openTaskMenu($event, i)" @keydown="openTaskMenuWithKeyboard($event, i)">
              <span class="tr-dot" :class="statusClass(i.StatusCategory)" aria-hidden="true"></span>
              <span class="tr-key">{{ i._local ? 'local' : i.Key }}</span>
              <span class="tr-tt">{{ i.Summary }}</span>
              <span v-if="remaining(i.Key)" class="tr-n" :title="`${remaining(i.Key)} pendiente(s)`"
                    :aria-label="`${remaining(i.Key)} pendientes`">{{ remaining(i.Key) }} pend.</span>
              <span v-if="i._effortId && daysUntouched(i._effortId) >= DORMANT_DAYS" class="tr-z"
                    :title="`${daysUntouched(i._effortId)} días sin tocar el archivo`">z</span>
            </button>
            <button v-if="!i._local && i.StatusCategory !== 'done'" type="button" class="tree-state"
                    :aria-label="`Avanzar ${i.Key} al siguiente estado`" :title="`Siguiente estado desde ${i.Status}`"
                    @click="openTaskMenu($event, i)">
              <span class="ui-icon" data-icon="move" aria-hidden="true"></span>
            </button>
          </div>
        </div>
      </section>

      <!-- VISTA · traer de Jira. Arranca CERRADA y cerrada cuesta UNA FILA, no cero: así se ve que
           existe sin comerse la pantalla. Sus controles viven acá y sus filas en el editor — cada
           fila del import lleva un select y dos líneas, y eso no entra en 300px. -->
      <section class="view" :class="{ abierta: isOpen('jira') }">
        <div class="region-head">
          <button type="button" class="view-tog" :aria-expanded="isOpen('jira')"
                  @click="toggleSection('jira')">
            <span class="ui-icon" data-icon="chevron" aria-hidden="true"></span>
            <span>Traer de Jira</span>
          </button>
          <span v-if="inbox" class="cnt" :class="{ filtrando: inbox.pending }">{{ inbox.pending }}</span>
        </div>
        <div v-if="isOpen('jira')" class="region-body sidebar-jira">
          <button class="btn qa-go" :disabled="inboxBusy" @click="loadInbox()">
          {{ inboxBusy ? 'Preguntando a Jira…' : inbox ? 'Volver a mirar' : 'Buscar lo que falta' }}
          </button>
          <label class="sync-all checkbox-row">
          <input type="checkbox" class="checkbox" v-model="inboxAll" @change="inbox && loadInbox()" />
          <span>incluir terminadas <em>nacen archivadas</em></span>
          </label>
          <p v-if="inbox" class="badge badge-outline chip">
          {{ inbox.pending }} sin registro
          <template v-if="inbox.registered"> · {{ inbox.registered }} ya registradas</template>
          </p>
          <p class="mut">Mira por <b>asignación</b>, no por sprint: es lo único que crea una tarea local.</p>
          </div>
      </section>
    </aside>

    <!-- El menú vive en `body`: el scroll del árbol recortaría cualquier elemento posicionado dentro
         del sidebar. También se abre con la tecla Menú o Shift+F10 sobre la fila enfocada. -->
    <Teleport to="body">
      <div v-if="taskMenu" ref="taskMenuEl" class="region-menu task-context-menu"
           role="menu" tabindex="-1" :aria-label="`Avanzar ${taskMenu.task.Key}`"
           :style="{ left: taskMenu.x + 'px', top: taskMenu.y + 'px' }"
           @keydown="taskMenuKeys">
        <p class="task-menu-head">Siguiente paso desde <b>{{ taskMenu.task.Status }}</b></p>
        <button v-if="taskMenu.loading" type="button" class="region-menu-item" role="menuitem" disabled>
          <span class="ui-icon" data-icon="more" aria-hidden="true"></span>
          <span class="menu-label">Consultando Jira…</span>
        </button>
        <button v-for="t in taskMenu.transitions" :key="t.id" type="button"
                class="region-menu-item task-transition" role="menuitem" :disabled="taskMenu.loading"
                :title="`Transición «${t.name}»`" @click="applyTransition(t)">
          <span class="ui-icon" data-icon="move" aria-hidden="true"></span>
          <span class="menu-label">{{ t.to }}</span>
          <span v-if="isTowardTesting(t, taskMenu.testing)" class="mv-tag">+ aviso</span>
        </button>
        <button v-if="taskMenu.error" type="button" class="region-menu-item task-menu-error" role="menuitem" disabled>
          <span class="ui-icon" data-icon="more" aria-hidden="true"></span>
          <span class="menu-label">{{ taskMenu.error }}</span>
        </button>
      </div>
    </Teleport>

    <!-- EDITOR: sin tarea elegida, el sprint. Con una elegida, la tarea. -->
    <main class="editor">
      <!-- LAS PESTAÑAS ABIERTAS. ⚠ La que está en PREVISTA va en itálica y es la que el próximo clic
           del árbol reemplaza; se fija con doble clic en la fila o con un clic acá. Sin eso, recorrer
           el árbol deja una pestaña por tarea mirada. -->
      <nav v-if="openTabs.length" class="editor-tabs" aria-label="Tareas abiertas">
        <div v-for="t in openTabs" :key="t.Key" class="et"
             :class="{ act: active?.Key === t.Key, previa: preview === t.Key }">
          <button type="button" class="et-b" :title="t.Summary"
                  :aria-current="active?.Key === t.Key ? 'true' : undefined"
                  @click="openTask(t, true)" @auxclick.middle.prevent="closeTab(t.Key)">
            <span class="tr-dot" :class="statusClass(t.StatusCategory)" aria-hidden="true"></span>
            <span class="et-k">{{ t._local ? 'local' : t.Key }}</span>
          </button>
          <button type="button" class="btn btn-ghost btn-icon btn-xs et-x" :aria-label="`Cerrar ${t.Key}`" title="Cerrar"
                  @click="closeTab(t.Key)"><span class="ui-icon" data-icon="close" aria-hidden="true"></span></button>
        </div>
      </nav>
      <p v-if="loading" class="msg">Cargando el sprint…</p>
      <p v-else-if="error" class="msg bad">{{ error }}</p>
      <TaskEditor v-else-if="active" :key="active.Key"
        :title="active.Summary" :task-key="active._local ? 'local · ' + active._effortId : active.Key"
        @close="closeTab(active.Key)">
        <template #meta>
          <span v-if="!active._local" class="badge badge-outline status" :class="statusClass(active.StatusCategory)">{{ active.Status }}</span>
          <span v-else class="badge badge-outline status sin-jira" title="no sale a Jira hasta que se decida">sin publicar</span>
        </template>
        <!-- El centro conserva el documento y las evidencias que explican cómo se lo trabajó. Los
             datos breves van en su cabecera, las consultas de apoyo al costado y las ramas abajo. -->

        <template #acciones>
          <div v-if="documentSections.length || jevTarget" class="toolbar" role="group" aria-label="Acciones de la tarea">
            <button v-if="jevTarget" type="button" class="btn btn-ghost btn-sm task-jev-trigger"
                    :aria-expanded="jevOpen" aria-controls="task-guidance" title="Orientar el siguiente paso con Jev"
                    @click="openGuidance"><span aria-hidden="true">✦</span> Orientar</button>
            <template v-if="documentSections.length">
            <span v-if="copied" class="toolbar-note" role="status">{{ copied === 'ok' ? 'Copiado' : 'No se pudo copiar' }}</span>
            <button class="region-action" title="Copiar para compartir (sin registro ni comandos)"
                    aria-label="Copiar para compartir" @click="copyBody('compartir')">
              <span class="ui-icon" :data-icon="copied === 'ok' ? 'check' : 'copy'" aria-hidden="true"></span>
            </button>
            <RegionMenu title="Opciones del documento" :items="documentMenu" @select="documentAction" />
            </template>
          </div>
        </template>

        <template #paneles>
          <div class="task-head-panels">
            <div class="task-head-facts" aria-label="Datos de la tarea">
              <span v-if="active.OriginSprint" class="orig" :class="{ carried: active.CarriedOver }"
                :title="active.CarriedOver ? `Nació en ${active.OriginSprint} y se arrastró sin terminar` : `Nació en ${active.OriginSprint}`">
                <i></i>{{ active.OriginSprint }}
              </span>
              <span v-if="active.HasPoints && active.Points">{{ active.Points }} pts</span>
              <span v-if="!active._local">{{ hhmm(active.SpentSecs) }} en Jira</span>
              <span v-if="minutesOf(active.Key)" class="mine">{{ minHhmm(minutesOf(active.Key)) }} sin subir</span>
              <i v-if="active._local && stageOf(active._effortId)" class="stg suelto"
                 :class="'s-' + stageOf(active._effortId)?.id">{{ stageOf(active._effortId)?.label }}</i>
              <a v-if="site && !active._local" class="task-jira-link" :href="jiraLink(active.Key)"
                 target="_blank" rel="noopener">Abrir en Jira ↗</a>
            </div>
            <button v-if="pendingProgressOf(active.Key)" type="button" class="task-completion"
                    :aria-label="`Abrir pendientes: ${pendingProgressOf(active.Key).done} de ${pendingProgressOf(active.Key).total} finalizados`"
                    :title="'Avance según las casillas finalizadas. Abrir Pendientes.'"
                    @click="openAux('pendientes')">
              <span class="task-completion-copy"><b>{{ pendingProgressOf(active.Key).percent }}%</b>
                {{ pendingProgressOf(active.Key).done }}/{{ pendingProgressOf(active.Key).total }} pendientes finalizados</span>
              <span class="task-completion-track" aria-hidden="true"><i :style="{ width: `${pendingProgressOf(active.Key).percent}%` }"></i></span>
            </button>
            <TaskGuidance v-if="jevOpen && jevTarget" id="task-guidance" :guidance="jevGuidance"
                          :loading="jevBusy" :error="jevError" @start="guideWithJev"
                          @close="closeGuidance" @copy="copyJevGuidance" />

            <!-- Llegar a pruebas conserva el acto compuesto: primero se revisa el mensaje y sólo
                 después el server mueve el issue y avisa a quien valida. -->
            <template v-if="qa?.key === active.Key">
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
                  <button class="btn qa-go" :disabled="qaBusy || !qa.transition || !qa.text.trim()" @click="sendQA()">
                    {{ qaBusy ? 'Enviando…' : 'Mover y avisar' }}
                  </button>
                  <button class="btn btn-outline qa-no" :disabled="qaBusy" @click="qa = null">Cancelar</button>
                </div>
              </div>
            </template>
            <p v-if="qaDone" class="qa-done" role="status">{{ qaDone }}</p>
            <p v-else-if="qaError && !qa" class="qa-err" role="alert">{{ qaError }}</p>
          </div>
        </template>

        <section v-if="contextGroups.length" class="task-context-timeline" aria-label="Contexto de la tarea por fecha">
          <section v-for="group in contextGroups" :key="group.day" class="task-context-day">
            <h3>{{ group.label }}</h3>
            <article v-for="event in group.items" :key="event.id" class="task-context-entry">
              <p v-for="(paragraph, paragraphIndex) in contextParagraphs(event)" :key="paragraphIndex">
                <!-- El espacio va interpolado: un `<span> </span>` lo borra el compilador (texto sólo de
                     espacio como único hijo) y el rótulo quedaba pegado, «Objetivo.Que…». -->
                <template v-if="paragraph.label"><strong>{{ paragraph.label }}</strong>{{ ' ' }}</template>
                <template v-for="(part, partIndex) in partsWithCanon(paragraph.text)" :key="partIndex">
                  <a v-if="part.type === 'canon'" :href="canonLink(part.target)" target="_blank" rel="noopener">{{ part.label }}</a>
                  <template v-else>{{ part.value }}</template>
                </template>
              </p>
              <p v-for="reference in dbReferencesOf(event)" :key="reference.target">
                Consulta DB · <strong>{{ reference.environment }}</strong>: <code>{{ reference.target }}</code>.
              </p>
              <p v-for="reference in harnessReferencesOf(event)" :key="reference.target">
                Prueba ejecutada: <code>{{ reference.target }}</code>.
              </p>
            </article>
          </section>
        </section>

        <section class="task-reference" aria-label="Documento y evidencia de la tarea">
            <section class="work-block">
              <div class="work-block-head"><h4>Documento de trabajo</h4><small>Estado, decisiones y material vigente</small></div>
              <div v-if="summarySections.length" class="desc cuerpo-md">
                <section v-for="section in summarySections" :key="section.id" :id="section.id" class="document-section" :class="{ 'retoma-panel': section.resume }" v-html="section.summaryHtml"></section>
              </div>
              <p v-else class="desc none">{{ documentSections.length ? 'El contenido de esta tarea está en las otras secciones.' : 'Esta tarea todavía no tiene documentación de trabajo.' }}</p>
            </section>

            <section class="work-block task-findings">
              <div class="work-block-head"><h4>Hallazgos y decisiones</h4><small>{{ findingsOf(active.Key).length }} registrados</small></div>
              <p class="nota">Conclusiones fechadas del trabajo, con la forma de volver a comprobarlas.</p>
              <p v-if="!findingsOf(active.Key).length" class="nota">Esta tarea no tiene hallazgos registrados.</p>
              <div v-if="findingsOf(active.Key).length" class="proc">
                <span class="proc-cuenta">{{ provenanceOf(active.Key).withHow }} de {{ provenanceOf(active.Key).total }} dicen cómo volver a comprobarlos</span>
                <span v-for="[f, n] in provenanceOf(active.Key).sources" :key="f" class="badge badge-outline fchip" :class="{ amb: isEnvironment(f) }">{{ f }} <b>{{ n }}</b></span>
                <span v-if="provenanceOf(active.Key).withoutHow" class="badge badge-outline fchip sin" title="no traen comando ni consulta: para volver a medirlo hay que reconstruirlo">{{ provenanceOf(active.Key).withoutHow }} sin cómo</span>
              </div>
              <section v-for="g in findingsByKind(active.Key)" :key="g.id" class="hgrupo">
                <h4>{{ g.tit }}<span class="badge badge-outline badge-xs hcnt">{{ g.items.length }}</span></h4>
                <p class="hpie">{{ g.pie }}</p>
                <article v-for="(a, n) in g.items" :key="n" class="hitem" :class="{ vencido: overdue(a) }">
                  <div class="hmeta"><span class="hfecha">{{ a.date }}</span><span class="hedad">{{ ageText(a) }}</span><span v-if="a.who" class="hquien">espera a {{ a.who }}</span></div>
                  <p class="hque">{{ a.what }}</p>
                  <p v-if="a.sources?.length" class="hfuentes"><span v-for="f in a.sources" :key="f" class="badge badge-outline fchip" :class="{ amb: isEnvironment(f) }">{{ f }}</span></p>
                  <pre v-if="a.how" class="hcomo" :class="{ 'sql-block': isSqlFinding(a) }"><code v-if="isSqlFinding(a)" class="language-sql" v-html="highlightSQL(a.how)"></code><template v-else>{{ a.how }}</template></pre>
                </article>
              </section>
            </section>

            <section class="work-block">
              <TaskEvidence :evidence="workEvidence" :notes="bodyOf(active.Key)" :harness-url="harnessUrl" :tracer-url="tracerUrl" :branches="activeTaskBranches" @show-branches="showBranchPanel" />
            </section>

        </section>

      </TaskEditor>

      <!-- LA PESTAÑA DE BIENVENIDA: el sprint. Es lo que se ve al entrar y al soltar una tarea. -->
      <!-- ⚠ Sin tarea elegida manda LA VISTA ABIERTA: con «traer de Jira» abierta el editor lleva
           sus filas (que en el sidebar no entran), y si no, el sprint. -->
      <div v-else-if="!isOpen('jira')" class="region-body editor-view">
        <div class="stats">
          <div class="stat">
            <div class="k">Tareas</div>
            <div class="v">{{ done }}/{{ issues.length }}</div>
            <!-- La barra dice de un vistazo lo que el número obliga a dividir mentalmente. -->
            <div class="progress progress-xs bar" v-if="issues.length"><i :style="{ width: (100 * done / issues.length) + '%' }"></i></div>
            <div class="s">terminadas en el sprint</div>
          </div>
          <!-- PUNTOS: ya no es opcional. La empresa los pide desde el 2026-08-18, así que el check que
               los escondía se retiró. -->
          <div class="stat" :class="{ mal: withoutPoints.length }">
            <div class="k">Puntos que cuentan</div>
            <div class="v">{{ countedPts }}<span class="de">/{{ committedPts }}</span></div>
            <!-- la barra es lo que ya cuenta; la marca, por dónde va el sprint. Relleno a la izquierda
                 de la marca = vas atrás, y cuánto se lee sin hacer la cuenta. -->
            <div class="progress progress-xs bar" v-if="committedPts">
              <i :style="{ width: (100 * countedPts / committedPts) + '%' }"></i>
              <u v-if="pace" :style="{ left: pace.consumed + '%' }" :title="`el sprint va por el ${pace.consumed}%`"></u>
            </div>
            <div class="s" v-if="pace && pace.behind > 0">{{ pace.behind }}% atrás del calendario ·
              quedan {{ pace.days }} {{ pace.days === 1 ? 'día' : 'días' }}</div>
            <div class="s" v-else-if="pace">al día con el calendario</div>
            <div class="s" v-else>sólo cuentan Terminado y En revisión</div>
          </div>
          <div class="stat" :class="{ mal: jiraTime === 0 }">
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
        <p v-if="overCapacity || strandedPts.length || withoutPoints.length" class="pts-detalle">
          <!-- Lo primero, porque cambia cómo se lee todo lo demás: si te comprometiste al doble de lo
               que entra, ir «atrás del calendario» no es un problema de ritmo. -->
          <span v-if="overCapacity" class="pd-i pd-mal"><b>{{ overCapacity.points }} pt comprometidos</b>
            · {{ overCapacity.times }}× tu capacidad (≈{{ CAPACITY }}: un 5 es medio sprint)</span>
          <template v-if="strandedPts.length">
            <span class="pd-k">no cuentan todavía:</span>
            <span v-for="([est, n]) in strandedPts" :key="est" class="pd-i"><b>{{ n }} pt</b> en {{ est }}</span>
          </template>
          <span v-if="withoutPoints.length" class="pd-i pd-mal"><b>sin estimar:</b> {{ withoutPoints.join(' · ') }}</span>
        </p>
        <section class="card">
          <!-- `region-head grupo` de `taller.css`: la misma barra que los grupos del árbol, en vez de
               un `<h2>` con su propia banda. Y el encabezado ES el botón —antes era un `<button>`
               ADENTRO de un `<h2>`, o sea dos elementos para una sola cosa. -->
          <button type="button" class="region-head grupo section-toggle" :aria-expanded="journeyOpen"
                  aria-controls="journey-content" @click="journeyOpen = !journeyOpen">
            <span class="gh"><span class="ui-icon" data-icon="chevron" aria-hidden="true"></span> Mi jornada
              <span class="mut">· últimos {{ days }} días{{ rangeMin ? ` · ${minHhmm(rangeMin)}` : '' }}</span></span>
          </button>
          <div id="journey-content" v-show="journeyOpen">
          <p class="nota" v-if="pulseOff">El pulso todavía no está corriendo, así que esta grilla no dice
            «no trabajé» — dice que nadie estaba anotando. Se instala una vez y arranca solo con la sesión:
            <code>make pulso-install</code>.</p>
          <p class="nota" v-else-if="!rangeMin">Sin cambios registrados en los últimos {{ days }} días.</p>
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
          </div>
        </section>
      </div>

      <div v-else class="region-body editor-view">
        <!-- TRAER DE JIRA. La única vista que mira por ASIGNACIÓN y no por sprint, y la única que CREA
             una tarea local. Va al final y colapsada porque es mantenimiento del registro, no la
             operación del día: se abre cuando arranca un sprint o cuando alguien te asigna algo. -->
        <section class="card">
          <div class="region-head grupo">
            <span class="gh">Traer de Jira <span class="mut">· lo que está a mi nombre en CORE y no en el registro local</span></span>
          </div>
          <div class="sync-h">
            <button class="btn qa-go" :disabled="inboxBusy" @click="loadInbox()">
              {{ inboxBusy ? 'Preguntando a Jira…' : inbox ? 'Volver a mirar' : 'Buscar lo que falta' }}
            </button>
            <label class="sync-all checkbox-row">
              <input type="checkbox" class="checkbox" v-model="inboxAll" @change="inbox && loadInbox()" />
              <span>incluir terminadas <em>nacen archivadas</em></span>
            </label>
            <span v-if="inbox" class="badge badge-outline chip">
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
                <button class="btn-link lnk" @click="pickAll('new')">todas como tarea nueva</button>
                <button class="btn-link lnk" @click="pickAll('')">ninguna</button>
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
                    <b class="badge badge-outline badge-xs" :class="statusClass(f.issue.category)">{{ f.issue.status }}</b>
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

              <button class="btn qa-go" :disabled="!picked.length || importBusy" @click="runImport()">
                {{ importBusy ? 'Registrando…' : `Traer ${picked.length}` }}
              </button>
            </template>

            <ul v-if="importResults.length" class="sync-res">
              <li v-for="r in importResults" :key="r.key" :class="{ bad: r.action === 'error' }">
                <b>{{ r.key }}</b> {{ ACTION_LABEL[r.action] || r.action }}
                <span class="mut">{{ r.file || r.error }}</span>
                <span v-if="r.archived" class="badge badge-outline chip">archivada</span>
              </li>
            </ul>
          </template>
        </section>
      </div>
    </main>

    <!-- PANEL · ramas de la tarea enfocada. Cruza editor + vistas para conservar la tabla como área
         principal y el selector de sus repos a la derecha incluso en ventanas medianas. -->
    <section v-if="showBranchConsole" id="context-branches-panel" class="panel ramas-panel"
             :class="{ 'sin-ramas': !activeTaskBranches.branches.length }"
             :style="{ height: (activeTaskBranches.branches.length ? branchConsoleHeight : 76) + 'px' }">
      <div v-if="activeTaskBranches.branches.length" class="rsz rsz-panel" v-resize="branchPanelResize"></div>
      <RepoBranches :snapshot="activeTaskBranches" :task-label="active?.Summary || ''"
                    :refreshing="refreshingBranches" :refresh-error="branchesError"
                    @refresh="refreshBranches" @close="hideBranchConsole" />
    </section>

    <!-- AUXILIARYBAR · consultas que conviene mantener al lado del trabajo: el contrato publicado
         (Jira), el checklist accionable (Pendientes) y los Artifacts navegables. -->
    <aside id="task-views" v-if="showAux" class="auxiliarybar" aria-label="Vistas de la tarea">
      <div class="rsz rsz-aux" v-resize="resizeOptions('--auxiliarybar-w', -1)"></div>
      <nav class="aux-tabs" role="tablist" aria-label="Contenido de la tarea">
        <button v-for="v in auxViews" :key="v.id" type="button" role="tab" class="aux-tab"
                :class="{ activa: auxOpen(v.id) }" :data-vista="v.id"
                :id="'aux-tab-' + v.id" :aria-controls="'aux-panel-' + v.id"
                :aria-selected="auxOpen(v.id)" :tabindex="auxOpen(v.id) ? 0 : -1"
                @click="openAux(v.id)" @keydown="auxTabsKeyboard($event, v.id)">
          <span>{{ v.label }}</span>
          <i v-if="v.alert" class="aux-alerta" title="Requiere revisión">●</i>
          <span v-if="v.count !== undefined" class="aux-count">{{ v.count }}</span>
        </button>
      </nav>
      <template v-for="v in auxViews" :key="v.id">
        <section v-if="auxOpen(v.id)" class="region-body aux-vista aux-tab-panel"
                 :class="{ 'jira-tab-panel': v.id === 'jira' }"
                 role="tabpanel" :id="'aux-panel-' + v.id" :aria-labelledby="'aux-tab-' + v.id">
          <template v-if="v.id === 'jira'">
            <p v-if="active._local" class="nota">Esta tarea es local y todavía no está publicada en Jira.</p>
            <template v-else>
              <div class="jira-heading">
                <span class="badge badge-outline status" :class="statusClass(active.StatusCategory)">{{ active.Status }}</span>
                <a v-if="site" class="link" :href="jiraLink(active.Key)" target="_blank" rel="noopener">Abrir {{ active.Key }} en Jira ↗</a>
              </div>
              <iframe v-if="jiraDocument" class="jira-preview" :srcdoc="jiraDocument"
                sandbox="allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer"
                :title="'Descripción de ' + active.Key + ' en Jira'"></iframe>
              <p v-else class="desc none">Jira no devolvió una descripción para esta tarea.</p>
            </template>
          </template>
          <template v-if="v.id === 'pendientes'">
            <div class="pending-heading">
              <p class="nota">Pendientes del documento privado, con sus notas y enlaces.</p>
              <button type="button" class="region-action pending-review-trigger"
                      :disabled="!remaining(active?.Key) || pendingReviewBusy"
                      :aria-label="pendingReviewBusy ? 'Revisando pendientes con Jev' : 'Revisar si los pendientes siguen abiertos con Jev'"
                      :title="remaining(active?.Key) ? 'Revisar con Jev si la evidencia registrada indica que algún pendiente ya se resolvió. No modifica la tarea.' : 'No hay pendientes abiertos para revisar.'"
                      @click="reviewPendingWithJev">
                <span aria-hidden="true">✦</span>
              </button>
            </div>
            <p class="pending-review-disclosure">El análisis sólo empieza al pulsar ✦. Envía título, estado, pendientes abiertos y hallazgos fechados; no el documento completo ni comandos.</p>
            <section v-if="pendingReviewBusy || pendingReviewError || pendingReview" class="pending-review" aria-live="polite">
              <p v-if="pendingReviewBusy" class="nota">Jev está contrastando los pendientes con la evidencia registrada…</p>
              <p v-else-if="pendingReviewError" class="pending-review-error">{{ pendingReviewError }}</p>
              <template v-else>
                <p class="pending-review-summary">{{ pendingReviewSummary || 'Jev no devolvió una clasificación.' }}</p>
                <ul v-if="pendingReview.items?.length" class="pending-review-list">
                  <li v-for="item in pendingReview.items" :key="item.id" class="pending-review-item"
                      :class="pendingReviewClass(item.status)">
                    <span class="pending-review-status">{{ pendingReviewLabel(item.status) }}</span>
                    <span class="pending-review-text">{{ reviewPending(item)?.what || 'Pendiente revisado' }}</span>
                    <span class="pending-review-confidence">{{ Math.round((item.probability || 0) * 100) }}%</span>
                  </li>
                </ul>
                <p v-if="pendingReview.omitted" class="pending-review-disclosure">Se revisaron los primeros {{ pendingReview.items.length }}; quedan {{ pendingReview.omitted }} para revisión manual.</p>
                <p class="pending-review-disclosure">Es una señal para revisar el archivo: no marca ni elimina ninguna casilla.</p>
              </template>
            </section>
            <div v-if="pendingSections.length" class="desc cuerpo-md pending-document">
              <section v-for="section in pendingSections" :key="section.id" class="document-section">
                <h2 v-if="section.pendingHtml !== section.html">{{ section.title || 'Pendientes' }}</h2>
                <div v-html="section.pendingHtml"></div>
              </section>
            </div>
            <p v-else-if="!pendingOf(active?.Key).length" class="nota">Esta tarea no tiene pendientes registrados.</p>
            <template v-else>
            <section v-for="(g, n) in pendingBySection(active?.Key)" :key="n" class="hgrupo">
              <h4>{{ g.tit }}<span class="badge badge-outline badge-xs hcnt">{{ g.items.filter(p => !p.done).length }}</span></h4>
              <article v-for="(p, m) in g.items" :key="m" class="pitem" :class="{ hecho: p.done }">
                <span class="pmark" aria-hidden="true">{{ p.done ? '✓' : '○' }}</span>
                <p class="pque">{{ p.what }}</p>
              </article>
            </section>
            </template>

          </template>
          <template v-if="v.id === 'artifacts'">
            <p class="nota">Lo que produjo esta tarea: prototipos, consultas y notas. Cada uno se abre en una pestaña nueva.</p>
            <button v-for="artifact in taskArtifacts(active.Key)" :key="artifact.file" class="artifact-row" @click="openArtifact(artifact.file)">
              <span class="badge badge-outline artifact-type">{{ artifactType(artifact.file) }}</span>
              <span class="artifact-txt"><b>{{ artifact.label }}</b><span class="artifact-file">{{ artifact.file.split('/').pop() }}</span></span>
              <span class="artifact-open">Abrir ↗</span>
            </button>
            <p v-if="!taskArtifacts(active.Key).length" class="nota">Esta tarea todavía no tiene artifacts.</p>
          </template>
        </section>
      </template>
    </aside>

    <footer class="statusbar">
      <strong>{{ sprint ? shortName(sprint.name) : 'sin sprint' }}</strong>
      <span v-if="sprintDays">{{ sprintDays.state === 'upcoming' ? `arranca en ${sprintDays.startsIn} d`
        : sprintDays.state === 'closed' ? `cerrado hace ${sprintDays.endedAgo} d`
        : `quedan ${sprintDays.remaining} d · ${sprintDays.pct}% consumido` }}</span>
      <span v-if="!loadingWide">{{ visible }} tarea{{ visible === 1 ? '' : 's' }} a la vista</span>
      <span v-if="jiraSyncing" class="sync-state" role="status">actualizando Jira…</span>
      <span v-else-if="syncError" class="sync-state sync-error" :title="syncError">Jira sin actualizar</span>
      <span v-if="active" class="sb-act">{{ active._local ? 'local' : active.Key }}</span>
      <div class="layout-controls" role="group" aria-label="Regiones visibles">
        <button type="button" class="region-action" :aria-pressed="sidebarVisible" aria-controls="tasks-sidebar"
                aria-label="Mostrar u ocultar tareas" title="Mostrar u ocultar tareas" @click="sidebarVisible = !sidebarVisible">
          <span class="ui-icon" data-icon="sidebar" aria-hidden="true"></span>
        </button>
        <button v-if="active" ref="branchPanelToggle" type="button" class="region-action sb-console"
                :aria-pressed="showBranchConsole" aria-controls="context-branches-panel"
                aria-label="Mostrar u ocultar ramas" title="Mostrar u ocultar ramas" @click="toggleBranchConsole">
          <span class="ui-icon" data-icon="console" aria-hidden="true"></span>
          <span>Ramas</span><span class="sb-count">{{ activeTaskBranches.branches.length }}</span>
        </button>
        <button type="button" class="region-action" :aria-pressed="showAux" :disabled="!active"
                aria-label="Mostrar u ocultar vistas" title="Mostrar u ocultar vistas" @click="toggleDetail">
          <span class="ui-icon" data-icon="detail" aria-hidden="true"></span>
        </button>
      </div>
    </footer>
  </div>
</template>

<style scoped>
/* ── LAS REGIONES PROPIAS ────────────────────────────────────────────────────────────────────────
   `taller.css` pone el esqueleto (grid, superficies, el contrato de scroll); esto es lo que sólo
   significa algo acá: los dos modos, la fila del árbol y la vista de sprint. */

/* ⚠ Acá vivía el `.ab-b` del activitybar. Se fue con el acordeón: con UN solo contenedor de vistas,
   un activitybar de una entrada no cambia nada — en VS Code esa columna cambia de CONTENEDOR, y acá
   sólo había uno. El vocabulario sigue en `taller.css` para el día que haya dos. */

/* EL ÁRBOL — una fila por tarea. La fila ENTERA es el botón: elegir es el único gesto de esta
   columna, así que el target es la fila y no un enlace adentro. 28px de alto se acierta sin mirar. */
/* (El encabezado de cada grupo es `.region-head.grupo` de `taller.css`: misma forma que el de la
   vista, pegajoso mientras se recorre el grupo.) */
.tree-item { position: relative; min-width: 0 }
.tree-row { display: flex; align-items: center; gap: 7px; width: calc(100% - 10px); min-height: 30px;
  margin: 1px 5px; padding: 4px 31px 4px 9px; border: 0; border-radius: var(--radius-md);
  background: none; color: inherit; font: inherit; cursor: pointer; text-align: left;
  box-shadow: inset 2px 0 0 transparent }
.tree-row:hover { background: var(--sel) }
/* ⚠ Lo seleccionado se marca con una BARRA a la izquierda además del fondo: sólo con fondo, en una
   lista de 40 filas grises, hay que comparar contra la vecina para saber cuál está activa. */
.tree-row.sel { background: color-mix(in oklab, var(--acc) 10%, var(--sel)); box-shadow: inset 2px 0 0 var(--acc) }
.tree-row.done { color: var(--texto-3) }
.tree-row.done.sel, .tree-row.done:hover { color: var(--txt) }
.tree-state { position: absolute; z-index: 1; right: 8px; top: 50%; translate: 0 -50%; display: grid;
  place-items: center; width: 23px; height: 23px; padding: 0; border: 0; border-radius: var(--radius);
  background: transparent; color: var(--mut); cursor: pointer; opacity: .72 }
.tree-state:hover, .tree-state:focus-visible, .tree-item:focus-within .tree-state { opacity: 1; color: var(--txt); background: var(--line) }
.tree-state .ui-icon { width: 13px; height: 13px }
.tr-dot { width: 7px; height: 7px; border-radius: 50%; flex: none; background: var(--mut) }
.tr-dot.e-ok { background: var(--ok) } .tr-dot.e-doing { background: var(--acc) }
.tr-key { font: 10.5px var(--font-mono); color: var(--mut); flex: none }
/* Sobre el fondo de la fila elegida la rampa ya no alcanza (--mut quedaba en 4,05:1): la clave sube a tinta plena. */
.tree-row.sel .tr-key { color: var(--txt) }
.tr-tt { flex: 1; min-width: 0; font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.tr-n { font-size: 9.5px; font-weight: 700; color: var(--warn); flex: none; white-space: nowrap }
.tr-z { font-size: 10px; color: var(--mut); flex: none }

.sidebar-jira { padding: 12px 10px; display: flex; flex-direction: column; gap: 10px; align-items: flex-start }
.sidebar-jira .mut { font-size: 11.5px; line-height: 1.5 }

/* EL EDITOR SIN TAREA — el sprint o el import, según qué vista del acordeón esté abierta. Acota el
   ancho de LECTURA (no el del contenedor): una línea de 120 caracteres no se lee, y el editor puede
   ser muy ancho. ⚠ Se llamaba `.sprint-view` y la usaban las DOS ramas: un nombre que dice «sprint»
   sobre la vista del import hace que hasta un chequeo escrito a propósito conteste mal. */
.editor-view { padding: 22px 24px 40px }
.editor-view > * { max-width: 1100px }

.task-context-timeline { max-width: 780px; padding: 2px 0 20px }
.task-context-day + .task-context-day { margin-top: 20px }
.task-context-day h3 { margin: 0 0 10px; font-size: 14px }
.task-context-entry + .task-context-entry { margin-top: 15px }
.task-context-entry p { margin: 0 0 7px; font-size: 13px; line-height: 1.55 }
.task-context-entry strong { font-weight: 700 }
.task-context-entry a { color: var(--acc); text-decoration: none }
.task-context-entry a:hover { text-decoration: underline }
.task-context-entry code { color: var(--txt); font-size: 11.5px; overflow-wrap: anywhere }
.task-reference { min-width: 0; max-width: 920px; margin-top: 10px; padding-top: 20px; border-top: 1px solid var(--line) }
.work-block-head h4 { color: var(--mut); font-size: 10px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase }
.work-block + .work-block { margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--line) }
.work-block-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin: 0 0 12px }
.work-block-head h4 { margin: 0 }
.work-block-head small { color: var(--mut); font-size: 10.5px; text-align: right }
.task-findings > .nota { margin-bottom: 12px }

/* LA FICHA — lo que la tarjeta mostraba de un vistazo, ahora con el ancho del editor. */
.ficha { padding-bottom: 14px; margin-bottom: 14px; border-bottom: 1px solid var(--line) }

.sb-act { margin-left: auto; font: 11px var(--font-mono); color: var(--txt) }
.sync-state { color: var(--mut); font-size: 10.5px }
.sync-error { color: var(--warn) }
.sync-state + .sb-act { margin-left: 0 }
.sb-console { display:inline-flex; align-items:center; width:auto; gap:5px; padding:0 7px; font-size:10.5px }
.sb-console .ui-icon { width:13px; height:13px }
.sb-count { min-width:17px; padding:0 4px; color:var(--txt); background:var(--line2);
  border-radius:999px; font-size:9px; font-variant-numeric:tabular-nums }

/* El riel permanece en una sola línea: a 340px no caben seis nombres sin desplazar, y partirlo en dos
   filas volvería a quitarle alto al contenido. La pestaña activa se une al cuerpo con la línea baja. */
.aux-tabs { display: flex; flex: none; min-width: 0; gap: 2px; padding: 4px 6px;
  overflow-x: auto; overflow-y: hidden; border-bottom: 1px solid var(--line);
  background: var(--panel2); scrollbar-width: thin }
.aux-tab { display: flex; align-items: center; gap: 5px; flex: none; height: 28px; padding: 0 9px;
  border: 0; border-radius: var(--radius-md); background: none; color: var(--mut);
  font: inherit; font-size: 11px; cursor: pointer; white-space: nowrap }
.aux-tab:hover { color: var(--txt); background: var(--sel) }
.aux-tab.activa { color: var(--txt); background: var(--background); box-shadow: 0 1px 2px rgb(0 0 0 / .16) }
.aux-count { min-width: 16px; padding: 0 4px; border-radius: 999px; background: var(--line2);
  color: var(--txt); font-size: 9px; font-variant-numeric: tabular-nums; text-align: center }
.aux-tab-panel { display: flex; flex-direction: column; padding: 12px 14px 20px }
.aux-alerta { color: var(--warn); font-style: normal; font-size: 8px; flex: none }

/* ── LAS MANIJAS ─────────────────────────────────────────────────────────────────────────────────
   `taller.css` pone el aspecto; acá va DÓNDE: pegadas al borde interior de cada sidebar, en capa
   sobre él. ⚠ Se salen 3px hacia afuera (`margin`) para que la zona de agarre cubra el borde de
   verdad y no haya que apuntarle a un píxel. */
.sidebar, .auxiliarybar, .ramas-panel { position: relative }
.workbench.con-consola-ramas {
  grid-template-areas:
    "titlebar    titlebar  titlebar  titlebar"
    "banner      banner    banner    banner"
    "activitybar sidebar   editor    auxiliarybar"
    "activitybar sidebar   panel     panel"
    "statusbar   statusbar statusbar statusbar";
}
.rsz-sb, .rsz-aux { position: absolute; top: 0; bottom: 0; width: calc(var(--rsz) + 6px) }
.rsz-sb { right: -3px }
.rsz-aux { left: -3px }
.rsz-sb::before { left: 3px; right: auto; width: 1px }
.rsz-aux::before { left: auto; right: 3px; width: 1px }
.ramas-panel { overflow: visible }
.rsz-panel { position:absolute; inset:-3px 0 auto; height:calc(var(--rsz) + 6px) }
.rsz-panel::before { top:3px; bottom:auto; height:1px }

/* ── LAS PESTAÑAS DEL EDITOR ─────────────────────────────────────────────────────────────────────
   La activa se marca con una línea ARRIBA y el fondo del editor, como en VS Code: la línea dice cuál
   es sin depender de que el ojo compare fondos, y el fondo la une con el contenido de abajo. */
.editor-tabs { display: flex; flex: none; gap: 2px; padding: 3px 6px 0; overflow-x: auto;
  background: var(--panel2); border-bottom: 1px solid var(--line); scrollbar-width: thin }
.et { display: flex; align-items: center; flex: none; max-width: 200px;
  border-radius: var(--radius-md) var(--radius-md) 0 0; position: relative }
.et::before { content: ''; position: absolute; inset: auto 8px -1px; height: 2px;
  border-radius: 2px 2px 0 0; background: transparent }
.et.act::before { background: var(--acc) }
.et.act { background: var(--background) }
.et-b { display: flex; align-items: center; gap: 7px; min-width: 0; border: 0; background: none;
  color: var(--mut); font: inherit; font-size: 12px; padding: 7px 4px 7px 10px; cursor: pointer }
.et.act .et-b { color: var(--txt) }
/* ⚠ La PREVISTA en itálica, igual que VS Code: es la única señal de que el próximo clic en el árbol
   la va a reemplazar. Sin marca, el reemplazo se lee como que la pestaña «se perdió». */
.et.previa .et-k { font-style: italic }
.et-k { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--font-mono);
  font-size: 11px }
/* Sobre `.btn.btn-ghost.btn-icon.btn-xs`: la ✕ de la pestaña aparece al pasar por encima. */
.et-x { color: var(--mut); font-size: 15px; line-height: 1; opacity: 0 }
.et:hover .et-x, .et.act .et-x, .et-x:focus-visible { opacity: 1 }
.et-x:hover { background: var(--sel); color: var(--txt) }
/* ⚠ El contador del encabezado es la ÚNICA señal de que hay un filtro puesto, ahora que las casillas
   viven en el menú. Cuando filtra, deja de ser un número apagado y se prende: si no se nota, el
   filtro se olvida encendido y la tarea que falta se lee como «no existe». */
.region-head .cnt { font-size: 10.5px; font-weight: 700; font-variant-numeric: tabular-nums;
  color: var(--mut); flex: none }
.region-head .cnt.filtrando { color: var(--warn) }
/* Con las casillas afuera, `.filtros` es sólo la fila del buscador. */
.sidebar :deep(.filtros) { padding: 8px 10px; margin: 0; border-bottom: 1px solid var(--line) }

/* ⚠ `.workbench.ancha` ya no tiene regla, y es a propósito: no hay `.wrap` de ancho máximo porque el
   workbench ocupa la ventana y quien acota el ancho de lectura es cada región. El `max-width: 1180px`
   que vivía acá era de cuando TODO era una columna de texto. La clase sigue puesta en el marcado —la
   usa el JS para saber en qué vista está—, pero como CSS estaba VACÍA desde entonces. */

/* Menú contextual de una tarea. Las opciones son las que devolvió Jira; el rótulo conserva el estado
   de origen para que una transición nunca parezca una acción genérica sobre toda la lista. */
.task-context-menu { width: min(270px, calc(100vw - 16px)) }
.task-menu-head { margin: 0 5px 4px; padding: 5px 5px 7px; border-bottom: 1px solid var(--line);
  color: var(--mut); font-size: 11px }
.task-menu-head b { color: var(--txt); font-weight: 600 }
.task-transition .ui-icon { color: var(--mut) }
.task-menu-error { white-space: normal; line-height: 1.35 }
.mv-tag { font-size: 9.5px; font-weight: 700; color: var(--ok); text-transform: uppercase; letter-spacing: .3px }

/* Filtro por estado. Van arriba de la grilla y no dentro de las tarjetas: es una decisión sobre el
   CONJUNTO. La deshabilitada se ve —conserva su cero— porque un bucket vacío es un dato. */
.filtros { display: flex; gap: 5px; flex-wrap: wrap; margin: 0 0 12px }
/* El buscador vive en la fila de las casillas y con la misma pastilla: es el mismo tipo de cosa —una
   vista sobre la lista—, no un control aparte. `margin-left: auto` lo empuja al final para que las
   casillas queden juntas y se lean como un grupo. */
/* ⚠ Era una PÍLDORA (radio 999) con fondo propio, y ya tenía la forma de un `input-group`: la lupa
   y la ✕ adentro y el borde en la etiqueta. Le falta sólo ser el componente — así el foco lo enciende
   entero, como en el panel del harness y en el trazador. */
.fbusca { margin-left: auto; height: 28px; padding: 0 6px 0 10px }
.fbusca:focus-within, .fbusca.act { border-color: color-mix(in srgb, var(--acc) 45%, transparent);
  background: var(--card) }
/* Adentro del grupo el campo va DESNUDO: el borde y el anillo los lleva la etiqueta. */
.fbusca .input { font-size: 12px; width: 190px }
.fbusca .input::placeholder { color: var(--mut) }
/* La X nativa de `type=search` no existe en todos los navegadores: se pone una propia y se esconde. */
.fbusca input::-webkit-search-cancel-button { display: none }
/* Sobre `.btn.btn-ghost.btn-icon.btn-xs`: sólo el glifo, que es más grande que el texto del botón. */
.fx { color: var(--mut); font-size: 15px; line-height: 1 }
/* «ver todas» del estado vacío: un enlace, no un botón — deshacer un filtro no compite con nada. */
.lnk { border: 0; background: transparent; color: var(--acc); font: inherit; font-size: inherit;
  cursor: pointer; padding: 0; margin-left: 6px; text-decoration: underline }

/* ⚠ Acá vivían `header.titlebar`, `.logo`, `h1`, `.sub` y `.sp`. El titlebar se fue: decía
   «Tablero · Sprint N · registro de tiempo y hallazgos» y gastaba 77px de alto en repetir lo que ya
   dicen la pestaña del navegador y el statusbar. Su única acción —«sólo este sprint»— está en el
   menú ⋯ del sidebar. */
.chip { padding: 4px 11px; color: var(--mut); font-size: 12px; gap: 6px }

/* ⚠ Los cuatro indicadores ya se separan ENTRE SÍ con el `border-right` de cada celda: el marco de
   afuera con su radio era una segunda forma de decir «esto es un bloque», y encima obligaba a
   `overflow: hidden` para que las esquinas recortaran lo de adentro. Queda una banda, cerrada abajo
   por una línea. */
.stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0; margin-bottom: 16px;
  border-bottom: 1px solid var(--line) }
.stat { background: var(--card); border: 0; border-right: 1px solid var(--line); padding: 12px 16px }
.stat:last-child { border-right: 0 }
.stat .k { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; color: var(--mut) }
.stat .v { font-size: 22px; font-weight: 600; margin: 3px 0 2px; letter-spacing: -.5px; font-variant-numeric: tabular-nums }
.stat .s { font-size: 11.5px; color: var(--mut) }
/* ⚠ Este modificador se llamaba `.alert` y el componente compartido se lo comió: `taller.css`
   declara `.alert` como el AVISO de shadcn, que es `display: grid` con una primera columna de 16px
   para el icono. Un `.stat.alert` quedaba convertido en esa grilla y sus hijos caían en la columna
   angosta: el rótulo y la leyenda medían **0 px de ancho** y se leían una letra por renglón. No falla
   nada, no hay error en consola — se ve como un diseño roto. Es el mismo choque que `.empty`, y la
   regla que deja es la misma: cuando un nombre del bloque compartido coincide con uno propio, se
   resuelve EL DÍA que se agrega el componente. Hoy lo chequea `make estilo-check`. */
.stat.mal .v { color: var(--warn) }
.stat.ok .v { color: var(--acc) }

/* ⚠ Misma corrección que en el panel del trazador: una sección no necesita fondo propio, marco Y
   radio para decir que es una pieza. Lo dice su ENCABEZADO, que ahora sale a sangre contra el padding
   del editor (`margin: 0 -24px`) y se lee como una banda de lado a lado en vez de como otra tarjeta. */
.card { padding: 0 0 18px; margin-bottom: 20px }
/* Sobre `.region-head.grupo` de `taller.css`, que ya trae la forma (11px, mayúsculas, apagado), el
   color y el pegado. Acá sólo van las dos desviaciones: sale A SANGRE contra los 24px del editor —una
   banda de lado a lado se lee como encabezado, una barra con aire a los costados como otra tarjeta— y
   lleva borde arriba, porque estas secciones se apilan sin lista de por medio. */
.card .region-head.grupo { margin: 0 -24px 14px; padding: 8px 24px; width: auto;
  border-top: 1px solid var(--line) }
.card .region-head.grupo .gh { display: flex; align-items: center; gap: 9px; min-width: 0 }
/* La aclaración al lado del título vuelve a minúsculas: es prosa, no un rótulo. */
.card .region-head.grupo .mut { color: var(--mut); font-weight: 400; text-transform: none; letter-spacing: 0 }

/* ⚠ Acá vivían `.tgrid` y `.task`: la grilla de tarjetas y la tarjeta. Se fueron con la
   reestructuración — las tareas son filas del árbol en el sidebar (`.tree-row`) y su contenido es el
   editor. */
.key { font-weight: 800; font-size: 12.5px; font-variant-numeric: tabular-nums }
/* Sobre `.badge.badge-outline`: el estado en Jira. El color lo pone `statusClass`, que devuelve sólo
   el estado — los mismos tres nombres pintan también el PUNTO del árbol, que no es una píldora. */
.status { font-size: 10.5px; padding: 2px 8px }
.e-ok { color: var(--txt); border-color: var(--line2); background: var(--panel2) }
.e-doing { color: var(--accent-foreground); border-color: var(--acc); background: var(--accent) }
.e-todo { color: var(--mut); border-color: var(--line); background: var(--panel2) }
/* origen de la tarea: el punto dice si cerró en su sprint (verde) o la arrastraron (rojo) */
.orig { display: inline-flex; align-items: center; gap: 5px }
.orig i { width: 7px; height: 7px; border-radius: 50%; background: var(--ok); flex: none }
.orig.carried { color: var(--bad) }
.orig.carried i { background: var(--bad) }

.fld { display: flex; align-items: baseline; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; color: var(--mut); margin-bottom: 7px }
.fld em { font-style: normal; text-transform: none; letter-spacing: 0; color: var(--tenue); font-weight: 400; margin-left: 5px }
/* descripción completa de Jira (acá NO se recorta: es lo que se pidió ver entero) */
.desc { font-size: 13px; line-height: 1.55; color: var(--txt); margin: 0; white-space: pre-wrap }
.desc.none { color: var(--mut); font-style: italic }
/* un artifact en el panel: el tipo a la izquierda, el nombre del archivo abajo (es lo que lo identifica
   en disco). Es un botón —se aprieta y abre—, así que lleva su marco como cualquier objeto. */
.artifact-row { display: flex; align-items: center; gap: 12px; width: 100%; text-align: left; cursor: pointer;
  background: none; border: 1px solid var(--line); border-radius: var(--radius); padding: 12px 14px; margin-bottom: 9px;
  font: inherit; color: var(--txt) }
.artifact-row:hover { border-color: var(--acc); background: var(--secondary) }
.artifact-type { flex: none; min-width: 44px; justify-content: center; font: 600 10px/1.6 var(--mono); color: var(--mut) }
.artifact-row:hover .artifact-type { color: var(--txt) }
.artifact-txt { flex: 1; min-width: 0 }
.artifact-txt b { display: block; font-size: 13.5px; font-weight: 600 }
.artifact-txt b::first-letter { text-transform: uppercase }
.artifact-file { display: block; font-size: 11px; color: var(--mut); font-family: var(--mono);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 2px }
.artifact-open { color: var(--mut); font-size: 12px }
.artifact-row:hover .artifact-open { color: var(--acc) }
/* handoff a QA: la ÚNICA acción del tablero que escribe en Jira y manda un mensaje, así que el envío
   pasa por una previsualización editable. `.qa-go` es el botón de confirmar dentro del panel, que se
   abre al mover la tarea hacia Testing desde el menú de estados. */
/* La única acción del tablero que escribe afuera: es la PRIMARIA, o sea `.btn` a secas. */
.qa-go { height: 32px; font-size: 12.5px; font-weight: 600 }
.qa-go:hover:not(:disabled) { background: var(--acc) }
.qa-go:disabled { opacity: .45; cursor: default }
.qa-no { height: 32px; font-size: 12.5px; color: var(--mut) }
.qa-no:hover:not(:disabled) { color: var(--txt) }
.qa-box { padding: 13px; margin-top: 10px; background: var(--panel2) }
.qa-head { font-size: 12.5px; color: var(--mut); margin: 0 0 11px }
.qa-head b { color: var(--txt); font-weight: 600 }
.qa-box textarea { width: 100%; box-sizing: border-box; background: var(--card); color: var(--txt);
  border: 1px solid var(--line); border-radius: var(--radius); padding: 9px 11px; font: inherit; font-size: 12.5px;
  line-height: 1.5; resize: vertical }
.qa-acts { display: flex; gap: 8px; margin-top: 11px }
.qa-done { font-size: 12.5px; color: var(--ok); margin: 9px 0 0 }
.qa-err { font-size: 12.5px; color: var(--bad); margin: 9px 0 0 }
/* el guard: si el aviso menciona algo interno, se listan los motivos y el envío queda rechazado */
.qa-bad { margin: 9px 0 0; padding-left: 18px; font-size: 12px; color: var(--bad) }

/* etapa del esfuerzo: evaluar → trabajar → crear las tareas */
.stg { font-size: 9.5px; font-weight: 700; letter-spacing: .3px; padding: 2px 7px; border-radius: 999px;
  border: 1px solid var(--line); color: var(--mut); text-transform: none; white-space: nowrap }
.s-work { color: var(--warn); border-color: color-mix(in oklab, var(--warn) 28%, var(--card)); background: color-mix(in oklab, var(--warn) 18%, var(--card)) }
.s-tasks { color: var(--txt); border-color: var(--line2); background: var(--panel2) }

/* la clave de la tarea abre Jira; la flecha aparece al pasar por encima para no ensuciar el listado */
.link { text-decoration: none; color: inherit; cursor: pointer }
.link:hover { color: var(--acc); text-decoration: underline }
.ext { opacity: 0; font-size: .82em; transition: .12s }
.link:hover .ext { opacity: .75 }

/* ⚠ Esto se llamaba `.empty` y el componente compartido se lo comió: `.empty` de `taller.css` es el
   estado vacío ENTERO —columna centrada, alto completo, medio de 40px— y estos son NOTAS de una
   línea que explican una vista. Renombrado a `.nota`, que es lo que son. La colisión la vi al agregar
   el componente y no la resolví; apareció centrada en la vista Ramas dos días después. */
.nota { color: var(--mut); font-size: 12.5px; margin: 0 0 14px; max-width: 62ch }

/* La acción de Jev vive pegada a la fuente de verdad (las casillas), no como un nuevo modo del
   tablero. El icono no sugiere automatización: el texto explica qué cruza y la salida conserva el
   estado de "parece" hasta que una persona actualice el documento. */
.pending-heading { display: flex; align-items: flex-start; gap: 8px; }
.pending-heading .nota { flex: 1; }
.pending-review-trigger { flex: none; width: 28px; height: 28px; padding: 0; color: var(--acc); font-size: 15px; }
.pending-review-trigger:disabled { color: var(--mut); opacity: .45; cursor: default; }
.pending-review-disclosure { color: var(--mut); font-size: 11.5px; line-height: 1.45; margin: -6px 0 12px; }
.pending-review { margin: 0 0 15px; padding: 10px; border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--panel2); }
.pending-review .nota { margin-bottom: 0; }
.pending-review-summary { margin: 0 0 8px; font-size: 12px; color: var(--txt); font-weight: 600; }
.pending-review-list { list-style: none; display: grid; gap: 7px; padding: 0; margin: 0 0 10px; }
.pending-review-item { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 7px; align-items: baseline; font-size: 11.5px; }
.pending-review-status { font-weight: 700; white-space: nowrap; }
.pending-review-item.resolved .pending-review-status { color: var(--ok); }
.pending-review-item.open .pending-review-status { color: var(--warn); }
.pending-review-item.unclear .pending-review-status, .pending-review-error { color: var(--bad); }
.pending-review-text { min-width: 0; line-height: 1.4; }
.pending-review-confidence { color: var(--mut); font: 10.5px/1 var(--mono, ui-monospace, monospace); }
.pending-review .pending-review-disclosure:last-child { margin-bottom: 0; }

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
.cel { width: var(--cel); height: 21px; border-radius: var(--radius-md); flex: none; transition: .12s }
/* el finde solo atenúa el FONDO: si una celda tiene registro, el color no se toca — sería mentirle al
   ojo sobre cuánto tiempo hubo ahí */
.cel.weekend.n0 { opacity: .45 }
.cel:hover { outline: 2px solid var(--acc); outline-offset: 1px }
.n0 { background: repeating-linear-gradient(-45deg, var(--sel) 0 3px, transparent 3px 6px), var(--panel2) }
/* PULSO (fuente «código»): usa una segunda escala gris. No mide lo mismo que los avances,
   pero conservar una sola familia visual evita que el color compita con el contenido.
   `c0` es LISO, no rayado: es "el agente miró y no había nada", que es un dato; el rayado (`n0`) queda
   reservado para "no hubo registro". Esa distinción es la única que el pulso puede hacer y los avances no. */
.c0 { background: var(--panel2) }
.c1 { background: color-mix(in oklab, var(--mut) 22%, var(--panel2)) }
.c2 { background: color-mix(in oklab, var(--mut) 42%, var(--panel2)) }
.c3 { background: color-mix(in oklab, var(--mut) 66%, var(--panel2)) }
.c4 { background: var(--mut) }
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
  border-radius: var(--radius-md) 5px 0 0; background: var(--panel2);
  box-shadow: inset 0 -2px 0 var(--line), inset 2px 0 0 var(--line), inset -2px 0 0 var(--line) }
/* el sprint que estás viendo arriba se resalta acá, para atar el mapa al selector */
.jspan.sel { color: var(--accent-foreground); background: var(--accent);
  box-shadow: inset 0 -2px 0 var(--acc), inset 2px 0 0 var(--acc), inset -2px 0 0 var(--acc) }
.jtot .cel { height: 16px; background: none; font-size: 9.5px; color: var(--mut); text-align: center;
  font-variant-numeric: tabular-nums }
.jaxis .cel { height: auto; background: none; font-size: 10px; color: var(--mut); text-align: center }
.jtot .cel:hover, .jaxis .cel:hover { outline: none }
.legend { display: flex; align-items: center; gap: 5px; margin-top: 12px; font-size: 11px; color: var(--mut) }
.legend i { width: 13px; height: 13px; border-radius: var(--radius-md); display: inline-block }
.legend .note { margin-left: 12px }

/* ── Barras de progreso ─────────────────────────────────────────────────────────────────────────
   `progress progress-xs` de `taller.css`. Lo propio es el aire: acá la barra va DEBAJO de un número
   y arriba de su leyenda, así que lo que queda es su margen. */
.bar { margin: 2px 0 7px }
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
.sync-row select { flex: none; width: 240px; font-size: 12px; padding: 5px 7px; border-radius: var(--radius);
  border: 1px solid var(--line); background: var(--panel2); color: var(--txt) }
.sync-i { min-width: 0 }
.sync-t { margin: 0; font-size: 13px; line-height: 1.45; display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap }
.sync-t b { font-weight: 700; padding: 2px 7px }
.sync-m { margin: 3px 0 0; font-size: 11px; color: var(--mut) }
.sync-sug { margin-left: 8px; color: var(--acc) }
.sync-res { list-style: none; margin: 14px 0 0; padding: 12px 0 0; border-top: 1px solid var(--line);
  font-size: 12.5px; display: grid; gap: 5px }
.sync-res .bad { color: var(--bad) }
.sync-res .chip { margin-left: 6px; padding: 1px 8px; font-size: 10.5px }

/* HALLAZGOS ------------------------------------------------------------------------------------ */
.hgrupo { margin-bottom: 22px; }
.hgrupo h4 { font-size: 13px; margin: 0 0 2px; display: flex; align-items: center; gap: 7px; }
/* ⚠ Sin `opacity: .55`: apilada sobre el color dejaba el conteo abajo del umbral. El escalón lo da
   la rampa, no un velo. */
.hcnt { font: 11px/1 var(--mono, ui-monospace, monospace); color: var(--texto-3);
        border-color: currentColor; padding: 2px 6px; }
/* ⚠ El mismo arreglo, en el resto del bloque (2026-09-23). El pie iba en `opacity: .5` (3,44:1), y el ítem
   entero en `.85`, que se multiplicaba con el `.6` de su línea de fecha: la fecha y la antigüedad de un
   hallazgo quedaban en 3,53:1 y `make estilo-contraste` no lo veía, porque mide la opacidad del nodo y no la
   de sus ancestros. Lo vencido se distingue por la barra y la antigüedad en color, no por apagar lo demás. */
.hpie { font-size: 11.5px; color: var(--tenue); margin: 0 0 10px; }
.hitem { border-left: 2px solid currentColor; padding: 2px 0 2px 11px; margin-bottom: 12px; }
.hitem.vencido { border-left-color: var(--bad); }
.hmeta { display: flex; gap: 9px; flex-wrap: wrap; align-items: baseline;
         font: 11px/1.4 var(--mono, ui-monospace, monospace); color: var(--tenue); margin-bottom: 3px; }
.hitem.vencido .hedad { color: var(--bad); font-weight: 600; }
.hque { margin: 0; font-size: 13.5px; line-height: 1.5; }
/* Pendientes: la marca a la izquierda y el texto al lado. Un ítem hecho se apaga y se tacha —el mismo
   gesto que las tarjetas terminadas—: sigue estando (dice qué se resolvió) pero ya no es trabajo. */
.pitem { display: flex; gap: 9px; align-items: baseline; padding: 3px 0; }
.pmark { font-size: 12px; color: var(--acc); line-height: 1.5; }
.pque { margin: 0; font-size: 13.5px; line-height: 1.5; }
.pitem.hecho { color: var(--tenue); }
.pitem.hecho .pmark { color: var(--mut); }
.pitem.hecho .pque { text-decoration: line-through; }
.hcomo { margin: 7px 0 0; padding: 8px 10px; border-radius: var(--radius-md); background: var(--sel);
         font: 11.5px/1.6 var(--mono, ui-monospace, monospace); white-space: pre-wrap;
         word-break: break-word; }

/* CON QUÉ SE COMPROBÓ. Las etiquetas las deriva el server del `Cómo`; acá sólo se pintan.
   Dos pesos distintos a propósito: la HERRAMIENTA es un dato de contexto y va apagada; el AMBIENTE
   lleva el color de acento porque cambia cuánto vale lo que se afirma — «medido en prod» y «medido en
   local» no son la misma frase. Y «sin cómo» va en rojo apagado: no es un error, es una deuda. */
.proc { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin: 0 0 14px;
        padding-bottom: 12px; border-bottom: 1px solid var(--line); }
.proc-cuenta { font-size: 11.5px; color: var(--tenue); margin-right: 2px; }
/* Sobre `.badge.badge-outline`: con qué se comprobó. Monoespaciada porque son COMANDOS, y radio
   chico porque es un rótulo. ⚠ Sin `opacity: .85`, que se apilaba sobre el color. */
.fchip { font: 10.5px/1 var(--mono, ui-monospace, monospace); padding: 4px 7px;
         border-radius: var(--radius-md); background: var(--sel); border-color: transparent; }
/* El número va en el color del chip: con `opacity: .6` encima quedaba en 3,18:1 sobre el de ambiente. Y cada
   chip de color es relleno O contorno: el ambiente, que resalta, va relleno; «sin cómo», que es una deuda
   y no un error, va sólo con contorno —con el tinte debajo su texto no llegaba a 4,5:1 (4,38)—. */
.fchip b { font-weight: 700; margin-left: 2px; }
.fchip.amb { color: var(--acc); background: color-mix(in srgb, var(--acc) 10%, transparent); }
.fchip.sin { color: var(--bad); border-color: color-mix(in oklab, var(--bad) 45%, transparent); background: transparent; }
.hfuentes { display: flex; gap: 5px; flex-wrap: wrap; margin: 6px 0 0; }

/* PUNTOS ---------------------------------------------------------------------------------------- */
.stat .v .de { color: var(--tenue); font-size: .62em; font-weight: 500; margin-left: 1px; }
/* la marca de por dónde va el sprint, sobre la barra de lo entregado */
.stat .bar { position: relative; }
.stat .bar u { position: absolute; top: -2px; bottom: -2px; width: 2px; background: currentColor;
               opacity: .55; border-radius: var(--radius-sm); }
.pts-detalle { display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: baseline;
               margin: -6px 0 18px; font-size: 12.5px; color: var(--mut); }
.pd-k { color: var(--tenue); }
.pd-i b { font-weight: 600; }
.pd-mal { color: var(--bad); }

/* ── el CUERPO TÉCNICO en el cajón ───────────────────────────────────────────────────────────────
   Son documentos largos con tablas, citas y bloques de código: sin estilo propio `marked` los deja
   como un muro gris y el cajón deja de abrirse. Lo que se busca acá es ESCANEO, no lectura lineal.
   Va con `:deep()` porque el HTML lo inyecta `v-html` y el estilo del componente es `scoped`. */
/* Es un callout —«si retomás esto sin contexto»—: barra de color y tinte, cuadrado. El marco completo
   alrededor no dice nada que el fondo no diga ya, y el radio pelea con la barra recta. */
.retoma-panel { margin: 0 0 14px; padding: 13px 14px; border-left: 3px solid var(--acc);
  background: var(--panel2); }
/* Datos que identifican el trabajo actual. Viven junto al título porque siguen siendo ciertos al
   cambiar de vista lateral; el sidebar ya no repite una ficha de la misma tarea. */
.task-head-panels { display: flex; flex-direction: column; gap: 7px; min-width: 0 }
.task-head-facts { display: flex; align-items: center; flex-wrap: wrap; gap: 5px 10px;
  min-width: 0; color: var(--mut); font-size: 11.5px }
.task-head-facts .mine { color: var(--acc) }
.task-jira-link { margin-left: auto; color: var(--acc); font-size: 11.5px; text-decoration: none }
.task-jira-link:hover { text-decoration: underline }
.task-completion { display: flex; align-items: center; gap: 9px; width: min(360px, 100%); padding: 0;
  border: 0; background: none; color: var(--mut); cursor: pointer; font: inherit; text-align: left }
.task-completion-copy { flex: none; font-size: 11px; white-space: nowrap }
.task-completion-copy b { color: var(--txt); font-variant-numeric: tabular-nums }
.task-completion-track { display: block; flex: 1; min-width: 44px; height: 5px; overflow: hidden;
  border-radius: 99px; background: var(--line) }
.task-completion-track i { display: block; height: 100%; border-radius: inherit; background: var(--acc) }
.task-completion:hover .task-completion-copy { color: var(--txt) }
.task-completion:focus-visible { outline: 2px solid var(--acc); outline-offset: 3px; border-radius: 2px }
.task-head-panels .qa-box { margin-top: 3px; max-width: 760px }
.task-jev-trigger { height: 26px; padding: 0 8px; color: var(--mut); font-size: 11px; }
.task-jev-trigger[aria-expanded="true"] { background: var(--panel2); color: var(--txt); }
/* ⚠ el `pre-wrap` de `.desc` respeta los saltos del markdown crudo y deja el HTML lleno de huecos */
.desc.cuerpo-md { white-space: normal; line-height: 1.55 }
.cuerpo-md :deep(h2) { font-size: 15px; margin: 22px 0 8px; padding-top: 12px; border-top: 1px solid var(--line) }
.cuerpo-md :deep(h3) { font-size: 13px; margin: 16px 0 6px; opacity: .9 }
.cuerpo-md :deep(h2:first-child), .cuerpo-md :deep(h3:first-child) { margin-top: 0; padding-top: 0; border-top: 0 }
.cuerpo-md :deep(p) { margin: 0 0 10px }
.cuerpo-md :deep(ul), .cuerpo-md :deep(ol) { margin: 0 0 10px; padding-left: 20px }
.cuerpo-md :deep(li) { margin: 3px 0 }
.cuerpo-md :deep(code) { font-size: 11.5px; padding: 1px 4px; border-radius: var(--radius-md); background: var(--panel2) }
.cuerpo-md :deep(pre) { overflow-x: auto; padding: 10px 12px; border-radius: var(--radius); background: var(--panel2);
                        margin: 0 0 12px }
.cuerpo-md :deep(pre code) { padding: 0; background: none }
/* SQL tiene su propia señal visual: es evidencia de datos, no un comando de Harness ni texto libre.
   El resaltado se calcula localmente y escapa cada fragmento antes de inyectarlo. */
.sql-block { position: relative; padding-top: 29px !important; border: 1px solid color-mix(in srgb, var(--acc) 28%, var(--line));
             background: color-mix(in srgb, var(--panel2) 88%, var(--acc) 12%) !important; }
.sql-block::before { content: 'SQL'; position: absolute; top: 8px; left: 11px; color: var(--acc); font: 700 9px/1 var(--mono, ui-monospace, monospace);
                     letter-spacing: .1em; }
.sql-block :deep(.sql-token.sql-keyword) { color: var(--sql-keyword); font-weight: 700; }
.sql-block :deep(.sql-token.sql-function) { color: var(--sql-function); }
.sql-block :deep(.sql-token.sql-string) { color: var(--sql-string); }
.sql-block :deep(.sql-token.sql-number), .sql-block :deep(.sql-token.sql-literal) { color: var(--sql-number); }
.sql-block :deep(.sql-token.sql-comment) { color: var(--mut); font-style: italic; }
.sql-block :deep(.sql-token.sql-identifier) { color: var(--sql-identifier); }
/* la cita es el marcador de MEDICIÓN / RIESGO / PREGUNTA: se resalta porque es lo que envejece */
.cuerpo-md :deep(blockquote) { margin: 0 0 12px; padding: 8px 12px; border-left: 3px solid var(--acc);
                               background: var(--panel2); border-radius: 0 8px 8px 0 }
.cuerpo-md :deep(blockquote p:last-child) { margin-bottom: 0 }
/* las tablas son la mitad del valor de estos cuerpos: scrollean solas antes que romper el cajón.
   ⚠ `width: fit-content` y no el ancho del cajón: `display: block` las volvía block-level, así que una
   tabla de dos columnas cortas se ESTIRABA hasta los 771 px del panel y quedaba con celdas enormes y
   vacías. Medido: las de contenido corto pasan de 771 a ~350; las que de verdad necesitan más siguen
   en el tope y scrollean, que es para lo que está el `max-width`. */
.cuerpo-md :deep(table) { border-collapse: collapse; margin: 0 0 12px; font-size: 11.5px; display: block;
                          overflow-x: auto; width: fit-content; max-width: 100% }
/* ⚠ Cada celda tenía su propio marco: una grilla de rectángulos de 1px que pesa más que los datos, y
   en una tabla de diez columnas es lo único que se ve. Con una línea por FILA las columnas se siguen
   leyendo —las alinea el texto— y el dibujo desaparece. Mismo cambio que en `context`. */
.cuerpo-md :deep(th), .cuerpo-md :deep(td) { border-bottom: 1px solid var(--line); padding: 5px 12px 5px 0; text-align: left; vertical-align: top }
.cuerpo-md :deep(tr:last-child td) { border-bottom: 0 }
.cuerpo-md :deep(th) { color: var(--mut); font-weight: 600; white-space: nowrap }
.cuerpo-md :deep(hr) { border: 0; border-top: 1px solid var(--line); margin: 18px 0 }
/* Los enlaces del documento. Sin esta regla quedaban con el azul del navegador (#0000ee) sobre el fondo
   oscuro, cerca de 2:1. Van subrayados porque están en medio de la prosa: el color solo no los distingue. */
.cuerpo-md :deep(a) { color: var(--acc); text-underline-offset: 2px }
.cuerpo-md :deep(a:hover) { text-decoration-thickness: 2px }

/* una tarea LOCAL se distingue de una de Jira, pero no grita: es material de trabajo, no un problema */
.key.local { color: var(--mut); font-style: normal; letter-spacing: .02em }
.status.sin-jira { border-style: dashed; color: var(--mut) }
/* la etapa suelta (tarjeta local): mismo chip que dentro del esfuerzo, sin el contenedor */
.stg.suelto { font-style: normal }

/* Estructura compacta del tablero y de las tarjetas. */
/* El reset del `<button>` como encabezado vive en `taller.css` (`button.region-head`). */
.section-toggle { user-select: none }
.card button.section-toggle { margin-bottom: 0 }
#journey-content { padding-top: 16px }
/* (`.task-group-heading` y `.group-count` se fueron: los grupos son `.region-head.grupo`, y su
   conteo usa el mismo `.cnt` que el encabezado de la vista.) */
.document-section { scroll-margin-top: 12px }
.document-section + .document-section { margin-top: 22px }
/* ⚠ Las casillas de los Pendientes salen de un `- [ ]` de markdown, así que no se les puede poner
   clase: se les da la piel por ELEMENTO. Es la misma que `.checkbox` de `taller.css` —16px, radio 4,
   marcada en `--primary` con el tilde dibujado con dos bordes—; `accent-color` sólo teñía la casilla
   nativa del sistema y dejaba su forma, que cambia con el SO. */
.pending-document :deep(input[type=checkbox]),
.cuerpo-md :deep(input[type=checkbox]) {
  appearance: none; -webkit-appearance: none; flex: none; display: inline-grid; place-content: center;
  width: 14px; height: 14px; margin: 0 7px 0 0; vertical-align: -2px;
  border: 1px solid var(--line2); border-radius: var(--radius-md); background: transparent; color: var(--acc-ink);
}
.pending-document :deep(input[type=checkbox])::after,
.cuerpo-md :deep(input[type=checkbox])::after {
  content: ""; width: 3px; height: 7px; margin-top: -2px;
  border: solid currentColor; border-width: 0 2px 2px 0; transform: rotate(45deg) scale(0);
}
.pending-document :deep(input[type=checkbox]:checked),
.cuerpo-md :deep(input[type=checkbox]:checked) { background: var(--acc); border-color: var(--acc) }
.pending-document :deep(input[type=checkbox]:checked)::after,
.cuerpo-md :deep(input[type=checkbox]:checked)::after { transform: rotate(45deg) scale(1) }
/* La casilla ya ES la marca del ítem: con la viñeta del `<ul>` encima cada pendiente tenía dos. Sólo a
   los ítems con casilla —una lista común conserva su viñeta—, y también cuando `marked` los envuelve
   en un `<p>` (lista «suelta», con líneas en blanco entre ítems). */
.cuerpo-md :deep(li:has(> input[type=checkbox], > p > input[type=checkbox])) { list-style: none }
.jira-tab-panel { padding: 0; overflow: hidden }
/* Sin padding por el iframe de la vista previa, que va a sangre; el aviso de una tarea local no es un
   iframe y quedaba pegado al borde de la región. Mismo aire que el encabezado de Jira. */
.jira-tab-panel > .nota { padding: 12px 14px; margin: 0 }
.jira-heading { display: flex; align-items: center; gap: 12px; flex: none; padding: 10px 14px;
  border-bottom: 1px solid var(--line); font-size: 12px; flex-wrap: wrap }
.jira-preview { display: block; flex: 1; min-height: 0; width: 100%; height: 100%; border: 0;
  border-radius: 0; background: transparent }
.sidebar > .region-head { min-height: 40px; padding: 7px 10px }
/* «trayendo los sprints…» cuelga directo del sidebar, sin cuerpo que le dé aire: toma el del encabezado. */
.sidebar > .nota { padding: 8px 10px; margin: 0 }
.sidebar .view > .region-head { min-height: 32px; padding: 4px 10px; border-bottom: 0 }
.sidebar .view > .region-body { padding-top: 3px; padding-bottom: 3px }
.statusbar .layout-controls { gap: 2px; padding: 2px; border-radius: var(--radius-md); background: var(--panel2) }
.statusbar .layout-controls .region-action { border-radius: var(--radius-md) }
button:focus-visible, summary:focus-visible { outline: 2px solid var(--mut); outline-offset: 3px }
@media (max-width: 650px) {
  .stats { grid-template-columns: repeat(2, minmax(0, 1fr)) }
  .stat:nth-child(2) { border-right: 0 }
  .stat:nth-child(-n+2) { border-bottom: 1px solid var(--line) }
  .fbusca { margin-left: 0; width: 100% }
  .fbusca input { width: 100%; min-width: 0 }
  .section-toggle { flex-wrap: wrap }
}
</style>
