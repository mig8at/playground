<script setup>
// Tablero — mi sprint, con registro de tiempo y bitácora.
//
// El registro persiste como JSONL del lado del server (internal/store). Lo de arriba (sprint, tareas)
// sale de /api/sprint (Jira Agile 1.0); la bitácora, de /api/entries.
//
// LA REGLA QUE ATRAVIESA TODO: lo que se escribe acá termina en Jira, donde lo lee el equipo. Nunca
// puede mencionar el playground, un hallazgo interno (F-xx), una ruta de archivo ni un nombre de repo.
// Por eso el campo de nota tiene un GUARD que BLOQUEA el botón, en vez de solo advertir.
//
// CONVENCIÓN: identificadores y clases CSS en inglés; solo el texto visible y los comentarios en español.
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import TaskPanel from './TaskPanel.vue';
import { readPreference, savePreference, groupTasks } from './ui-state.js';
import { organizeDocument } from './task-document.js';
import { jiraPreview } from './jira-preview.js';

// La URL del server, parametrizable para poder levantar una SEGUNDA instancia sin tocar el código:
// `npm run dev` usa `concurrently -k`, así que reiniciar el server para probar un cambio tumba también
// el front de quien esté trabajando. Con esto se levanta un par aparte:
//   cd server && WEB_PORT=8790 go run ./cmd/web
//   VITE_TABLERO_API=http://localhost:8790 npx vite --port 5296
const SERVER = import.meta.env.VITE_TABLERO_API || 'http://localhost:8787';
const BOARD = 384;            // CORE — el proyecto donde están MIS tareas (no LO / Loans Origination)

const loading = ref(true);
const error = ref('');
const sprint = ref(null);
const sprints = ref([]);      // los más recientes, del actual hacia atrás — los usan las bandas de la jornada
const SPRINT_TABS = 4;        // cuántos ofrece el selector del header (los demás sólo pintan banda)
const site = ref('');         // https://<site>.atlassian.net — lo manda el server, sale de su .env
const issues = ref([]);
const panelTab = ref('');
const journeyOpen = ref(readPreference('journey-open', true) === true);
watch(journeyOpen, value => savePreference('journey-open', value));
const collapsedGroups = ref(new Set(['terminada']));
function toggleGroup(id) {
  const next = new Set(collapsedGroups.value);
  next.has(id) ? next.delete(id) : next.add(id);
  collapsedGroups.value = next;
}
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
// La bitácora vive en JSONL del lado del server. Acá se mapea al shape que usa la UI: `date` es el
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
// ── filtro local por estado ──────────────────────────────────────────────────────────────────────
// Los buckets se derivan de `StatusCategory` (`new` / `indeterminate` / `done`), que es lo ÚNICO que Jira
// garantiza en todos los workflows — no de los nombres en español, que cambian con el board. Las dos
// excepciones están justificadas abajo, en `bucketDe`.
//
// PARTICIONAN: toda tarea cae en exactamente uno. Un filtro cuyos buckets no cubren todo esconde tareas
// en silencio, que es peor que no tener filtro. Medido el 2026-08-19 con 16 tarjetas: 1+3+1+2+9 = 16.
const FILTROS = [
  { id: 'sin-iniciar', label: 'sin iniciar' },
  { id: 'iniciada', label: 'iniciada' },
  { id: 'bloqueada', label: 'bloqueada' },
  { id: 'pruebas', label: 'en pruebas' },
  { id: 'terminada', label: 'terminada' },
];
// ⚠ Los dos tests por NOMBRE están acá a propósito, y no por comodidad:
//
//   · «bloqueada» — el board de CORE la declara en la categoría `new`, así que sin este test una tarea
//     bloqueada (CORE-19: 3 pt y trabajo encima) se lee como que nadie la tocó. Y es justo el estado que
//     uno quiere ver: no se destraba trabajando, se destraba hablando con alguien.
//   · «en pruebas» — es `indeterminate` como «en progreso», pero es donde más puntos se quedan varados,
//     a un estado de contar. Mezclarla con «iniciada» esconde el atasco.
//
// El resto sale de `StatusCategory`, que es lo único que Jira garantiza en cualquier workflow.
const bloqueada = (i) => /bloquead/i.test(i?.Status || '');
const bucketDe = (i) => {
  if (i.StatusCategory === 'done') return 'terminada';
  if (enPruebas(i)) return 'pruebas';
  if (bloqueada(i)) return 'bloqueada';
  if (i.StatusCategory === 'new') return 'sin-iniciar';
  return 'iniciada';   // `indeterminate` que no está en pruebas ni bloqueada: en progreso, en revisión
};
// Se guarda lo que está OCULTO, no lo visible: el conjunto vacío es "se ve todo", así que el estado
// inicial no depende de conocer la lista de buckets y agregar uno nuevo no lo esconde por omisión.
// Eso reemplaza a la pastilla «todas», que era el mismo default escrito como una opción más.
//
// NO se persiste a propósito: abrir el tablero y ver 2 tarjetas porque quedó un filtro de ayer se lee
// como "perdí trabajo", no como "hay un filtro puesto". Arranca siempre con todo visible.
const ocultos = ref(new Set());
const alternarFiltro = (id) => { ocultos.value.has(id) ? ocultos.value.delete(id) : ocultos.value.add(id) };

// ── buscador por título ──────────────────────────────────────────────────────────────────────────
// Se le quitan los ACENTOS a los dos lados: los títulos vienen de Jira con tildes y nadie las escribe
// al buscar, así que sin esto «validacion» no encuentra «Validación» y el buscador parece roto justo
// con las tareas en español, que son casi todas.
// Busca también por CLAVE porque pegar «CORE-431» es la otra forma natural de buscar una tarea, y no
// puede colisionar con un título: ningún título tiene esa forma.
const busca = ref('');
const sinTildes = (s) => (s || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const buscaNorm = computed(() => sinTildes(busca.value).trim());

// ── las tareas LOCALES, las que todavía no tienen Jira ────────────────────────────────────────────
//
// El tablero mostraba sólo issues de Jira, así que una tarea que vive únicamente en `data/<slug>.md`
// era INVISIBLE: sin tarjeta, sin bitácora, sin cajón de ramas. Se veía nada más con `make tareas`, y
// por eso el avance escrito ahí no lo miraba nadie (medido el 2026-08-27: ocho días).
//
// ⚠ Que aparezcan NO las publica. Publicar a Jira sigue siendo una decisión que se PIDE —hoy
// `make jira-create JSON=…`— y a propósito no hay botón acá: una tarea local es material de trabajo, y
// el día que valga la pena compartirla se decide, no se filtra por estar en pantalla.
// APAGADO por defecto: el tablero es, antes que nada, el sprint — lo que el equipo ve. Las locales son
// material propio y son MUCHAS (16 contra 7 del sprint el 2026-08-27): encendidas por defecto ahogaban
// justo lo que uno viene a mirar. Se prenden cuando se las está trabajando.
const verLocales = ref(false);

const localesSueltas = computed(() => {
  if (!verLocales.value) return [];
  const ligados = new Set(Object.values(taskLocals.value).map(v => v?.effortId).filter(Boolean));
  return efforts.value
    .filter(e => e.id && !ligados.has(e.id) && !e.archived)
    .map(e => ({
      // La clave imita la forma de Jira para que todo lo que indexa por `Key` —selección, cajones,
      // contador de bitácora— siga funcionando sin ramas especiales.
      Key: `LOCAL-${e.id}`,
      Summary: e.title,
      Status: 'local',
      StatusCategory: e.stage === 'work' ? 'indeterminate' : 'new',
      Points: 0,
      _local: true,
      _esfuerzoId: e.id,
    }));
});

// Cuántas locales hay, se estén viendo o no: una píldora sin número obliga a prenderla para descubrir
// si tiene algo, que es exactamente lo que las otras casillas ya evitan.
const cuantasLocales = computed(() => {
  const ligados = new Set(Object.values(taskLocals.value).map(v => v?.effortId).filter(Boolean));
  return efforts.value.filter(e => e.id && !ligados.has(e.id) && !e.archived).length;
});

const visibleTasks = computed(() => {
  // Conserva la deduplicación y el origen antes de agrupar por estado.
  if (vistaAncha.value) {
    // Una tarea ARRASTRADA entre sprints viene en el listado de cada sprint que la incluyó. Agrupada eso
    // era correcto (una fila por grupo); suelta son tarjetas DUPLICADAS — CORE-365 salía tres veces, una
    // por Sprint 12, 11 y 10. Se deduplica por `Key` quedándose con el sprint MÁS NUEVO (el listado viene
    // nuevo→viejo) y el arrastre NO se pierde: se cuenta, porque una tarea en su 3.er sprint es una señal.
    const porKey = new Map();
    for (const g of porSprint.value) {
      for (const i of g.issues) {
        const ya = porKey.get(i.Key);
        if (ya) { ya._arrastres++; continue; }
        porKey.set(i.Key, { ...i, _sprint: nombreCorto(g.sprint.name), _arrastres: 1 });
      }
    }
    return conFiltro([...porKey.values(), ...localesSueltas.value]);
  }
  // `issues` ya viene ordenado nuevo → viejo desde el server y ese orden se preserva tal cual.
  const conEsfuerzo = issues.value.map((i) => {
    const eid = taskLocals.value[i.Key]?.effortId || 0;
    const t = eid ? efforts.value.find(e => e.id === eid)?.title : '';
    return t ? { ...i, _esfuerzo: t, _esfuerzoId: eid } : i;
  });
  return conFiltro([...conEsfuerzo, ...localesSueltas.value]);
});
const groupedIssues = computed(() => groupTasks(visibleTasks.value, bucketDe));
// El filtro se aplica al FINAL de las dos ramas: es una vista sobre la lista, no otra lista.
// Las casillas y el buscador se combinan con Y, que es lo que uno espera: buscar dentro de lo que
// quedó visible, no que escribir en la caja reviva lo que se destildó.
function conFiltro(ts) {
  const q = buscaNorm.value;
  const porEstado = ocultos.value.size ? ts.filter(i => !ocultos.value.has(bucketDe(i))) : ts;
  return q ? porEstado.filter(i => sinTildes(i.Summary).includes(q) || sinTildes(i.Key).includes(q)) : porEstado;
}
// Los conteos salen de la lista SIN filtrar: si salieran de la filtrada, un bucket destildado diría 0 y
// dejaría de poder volver a tildarse con conocimiento de qué esconde.
const sinFiltrar = computed(() => {
  if (vistaAncha.value) {
    const vistos = new Set(), out = [];
    for (const g of porSprint.value) for (const i of g.issues) {
      if (!vistos.has(i.Key)) { vistos.add(i.Key); out.push(i); }
    }
    return out;
  }
  return issues.value;
});
const conteoFiltro = computed(() => {
  const n = {};
  for (const f of FILTROS) n[f.id] = 0;
  for (const i of [...sinFiltrar.value, ...localesSueltas.value]) n[bucketDe(i)]++;
  return n;
});

// El MÉTODO de trabajo, explícito: primero se evalúa, después se trabaja, y las tareas de Jira se
// escriben AL FINAL — recién ahí hay contexto completo para definirlas bien.
const STAGES = [
  { id: 'evaluation', label: 'Evaluando' },
  { id: 'work', label: 'Trabajando' },
  { id: 'tasks', label: 'Tareas creadas' },
];
const esProyecto = (id) => efforts.value.find(e => e.id === id)?.clase === 'proyecto';
const stageOf = (id) => STAGES.find(s => s.id === (efforts.value.find(e => e.id === id)?.stage || 'evaluation'));
// DÍAS SIN TOCAR el archivo de la tarea, según git (el server lo calcula; ver store/toques.go). La etapa
// dice si algo se está evaluando o trabajando, no si sigue vivo: medido el 2026-09-14, 22 de las 39
// abiertas llevaban 14 días o más sin tocarse y todas se veían igual. DORMIDA a los 14; a los 30 la
// pregunta es si se archiva o se anota por qué espera.
const DORMIDA_DIAS = 14;
const diasSinTocar = (id) => {
  const t = efforts.value.find(e => e.id === id)?.tocadoEn;
  if (!t) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(t + 'T12:00:00')) / 86400000));
};
// PROTOTIPOS del esfuerzo: los html autocontenidos de `data/artifacts/` que sirve el server. Son
// varios porque una tarea suele tener más de un actor o más de un camino, y verlos al lado es lo
// que permite decidir. Se abren en pestaña aparte — son para mirarlos, no para vivir embebidos acá.
const artifactsOf = (id) => efforts.value.find(e => e.id === id)?.artifacts || [];
const openArtifact = (file) => window.open(`${SERVER}/artifacts/${file}`, '_blank', 'noopener');
// los prototipos cuelgan del ESFUERZO, pero se piden desde la tarjeta de una TAREA: se resuelve el
// esfuerzo por su clave, igual que la bitácora
const protosDe = (key) => artifactsOf(esfuerzoDe(key));

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
  const eid = esfuerzoDe(key);
  return (ramasSnap.value.tareas || {})[String(eid)] || null;
};
const ramasCuenta = (key) => (ramasDe(key)?.ramas || []).length;
// LA ENTREGA, EN LA TARJETA Y SIN ABRIR NADA. La pregunta que uno le hace al tablero es «¿esto ya
// está en producción?», y hasta hoy había que abrir el cajón de ramas para contestarla. `main` es la
// vara (context/ se mide contra main), así que el resumen habla de main y deja el resto para el cajón.
const entregaDe = (key) => {
  const rs = ramasDe(key)?.ramas || [];
  if (!rs.length) return null;
  const enMain = rs.filter(r => r.en?.main).length;
  const abiertos = rs.filter(r => r.pr?.estado === 'OPEN');
  if (enMain === rs.length) {
    return { texto: '✓ main', clase: 'ok', titulo: `las ${rs.length === 1 ? 'rama está' : rs.length + ' ramas están'} en main` };
  }
  if (enMain > 0) {
    return { texto: `${enMain}/${rs.length} main`, clase: 'medio', titulo: `${enMain} de ${rs.length} ramas llegaron a main` };
  }
  if (abiertos.length) {
    const bases = [...new Set(abiertos.map(p => p.pr.base))].join(', ');
    return { texto: `${abiertos.length} PR → ${bases}`, clase: 'espera', titulo: `nada en main todavía; ${abiertos.length} PR abierto(s) contra ${bases}` };
  }
  return { texto: 'sin llegar', clase: 'espera', titulo: 'ninguna rama llegó a main y no hay PR abierto' };
};
// Cómo se supo que el cambio está en un ambiente. `patch` es el patch-id de la punta (la señal fuerte);
// `pr` es el commit del PR mergeado, que es lo que salva al squash con el mensaje o el contenido
// editados — sin esa segunda señal, la tarea de Alta Fleet decía que nada suyo estaba en main.
const COMO_TEXTO = {
  patch: 'el cambio ya está acá (el patch-id de la punta aparece en el ambiente)',
  pr: 'llegó por el PR: el patch-id no coincide (squash con el mensaje o el contenido editados), pero el commit del merge ya es ancestro de este ambiente',
};
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
const nombreCorto = (n) => (n || '').replace(/^.*?(Sprint)/i, '$1');
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
const vistaAncha = ref(true);
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
// Cuenta TARJETAS, no filas de sprint: sumar `g.issues.length` daba 24 cuando en pantalla había 16,
// porque las arrastradas venían repetidas. El contador y la grilla salen ahora de la misma lista.
const visibles = computed(() => visibleTasks.value.length);
const totalTasks = computed(() => sinFiltrar.value.length + localesSueltas.value.length);

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
// De la clave de una tarjeta al esfuerzo local. Es la ÚNICA forma de resolverlo, y todo lo que abre un
// cajón —cuerpo, hallazgos, pendientes, prototipos, ramas, bitácora— pasa por acá.
//
// ⚠ Contempla las tarjetas LOCALES (`LOCAL-<id>`), que no están en el mapa de Jira porque no están en
// Jira. Cuando cada cajón resolvía el esfuerzo por su cuenta contra `taskLocals`, las locales salían
// todas vacías —«sin cuerpo técnico»— con el cuerpo ahí al lado.
const esfuerzoDe = (key) => {
  if (typeof key === 'string' && key.startsWith('LOCAL-')) return Number(key.slice(6)) || 0;
  return taskLocals.value[key]?.effortId || 0;
};
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

// ── el CUERPO TÉCNICO de la tarea, que es lo que de verdad se quiere leer ──────────────────────────
//
// Antes acá se mostraba la descripción de JIRA. Es la información equivocada para este tablero: Jira
// dice qué hay que hacer, en el lenguaje del equipo, y ya se lee en Jira. Lo que no está en ningún otro
// lado es el CUERPO del archivo de la tarea — qué se hizo, cómo se llegó a cada conclusión, con qué se
// midió, en qué ramas vive y cómo se integra en cada repo. El server ya lo expone como `techNotes`
// (el cuerpo privado, sin la sección publicable); sólo faltaba mirarlo.
//
// La de Jira sigue a un clic, en el enlace del encabezado: no se pierde, se despriorizó.
const cuerpoDe = (key) => efforts.value.find(e => e.id === esfuerzoDe(key))?.techNotes || '';

// Markdown de verdad y no una regex a mano: estos cuerpos usan tablas, citas, bloques de código y
// enlaces, y una tabla mal renderizada es peor que no mostrarla. El contenido es un archivo local
// escrito por nosotros, así que `v-html` acá no toma nada de afuera.
// `estadoDe` queda sólo como respaldo para los archivos sin sección de retoma. Las tarjetas vivas usan
// la retoma y el próximo paso declarados, que son el estado vigente y no una inferencia del historial.
const estadoDe = (key) => {
  const md = cuerpoDe(key);
  if (!md) return '';
  let enBloque = false, pasoElTitulo = false;
  for (const cruda of md.split('\n')) {
    const l = cruda.trim();
    if (l.startsWith('```')) { enBloque = !enBloque; continue; }
    if (enBloque || !l) continue;
    if (l.startsWith('#')) { pasoElTitulo = true; continue; }
    if (l.startsWith('|') || l.startsWith('<!--') || l.startsWith('---')) continue;
    const texto = l.replace(/^>\s?/, '').trim();
    if (!texto || texto.startsWith('|')) continue;
    // Sin título arriba no hay convención que valga: se cae a la primera prosa, como antes.
    if (!pasoElTitulo && cruda.startsWith('>')) continue;
    return texto.replace(/[*`]/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').slice(0, 240);
  }
  return '';
};

// La tarjeta no toma la primera línea del archivo: puede ser una nota de migración o historia vieja.
// La portada de una tarea es «Si retomás esto sin contexto», y el server la expone como dato derivado.
const limpiarMarkdown = (s, limite = 240) => (s || '')
  .replace(/<!--[^]*?-->/g, '')
  .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
  .replace(/[*\`_]/g, '')
  .replace(/^>\s?/gm, '')
  .replace(/\s+/g, ' ').trim().slice(0, limite);
const retomaLocal = (md) => {
  const m = /^##\s+[0-9.·\s]*si retom[áa]s[^\n]*\n/mi.exec(md || '');
  if (!m) return '';
  const resto = (md || '').slice(m.index + m[0].length);
  const corte = resto.search(/^##\s/m);
  return resto.slice(0, corte < 0 ? resto.length : corte).trim();
};
const proximoLocal = (md) => {
  const m = /\*\*El pr[óo]ximo paso es:?\*\*\s*(.*?)(?:\n\s*\n|\n##|$)/is.exec(md || '');
  return m ? limpiarMarkdown(m[1], 280).replace(/^[:·\s]+/, '') : '';
};
const effortDe = (key) => efforts.value.find(e => e.id === esfuerzoDe(key));
const retomaDe = (key) => effortDe(key)?.retoma || retomaLocal(cuerpoDe(key));
const proximoDe = (key) => effortDe(key)?.proximoPaso || proximoLocal(cuerpoDe(key));
const resumenDe = (key) => {
  const retoma = retomaDe(key);
  if (!retoma) return estadoDe(key);
  return limpiarMarkdown(retoma.replace(/\*\*El pr[óo]ximo paso es:?\*\*[\s\S]*$/i, ''), 240);
};

const documentSections = computed(() => organizeDocument(active.value ? cuerpoDe(active.value.Key) : ''));
const summarySections = computed(() => documentSections.value.filter(section => section.summaryHtml));
const pendingSections = computed(() => documentSections.value.filter(section => section.pendingHtml));
const jiraDocument = computed(() => jiraPreview(active.value));
const indiceCuerpo = computed(() => summarySections.value.filter(section => section.title));
function irASeccion(id) {
  const section = document.getElementById(id);
  if (section?.tagName === 'DETAILS') section.open = true;
  section?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

const contextLink = (node) => 'http://localhost:5193/?node=' + encodeURIComponent(node);

// COPIAR EL CUERPO ENTERO, para pegarlo en otro lado (Slack, un hilo, otra sesión).
//
// Se copia el MARKDOWN, no el HTML renderizado: es lo que se pegó bien en todos lados y lo que otra
// herramienta puede volver a parsear. Copiar el `innerText` del panel pierde las tablas y los bloques
// de código, que es justo lo que uno quiere compartir de estos cuerpos.
//
// Y va con encabezado: pegado suelto, este texto empieza en «## Si retomás esto sin contexto» y quien
// lo recibe no sabe de qué tarea es. Se le antepone la clave, el título y los nodos de contexto para
// que sea autosuficiente — más la advertencia de que es PRIVADO, porque lo es: nombra repos, rutas y
// F-xx, y no pasa el guard de Jira. La decisión de compartirlo es de quien copia; que salga sin el
// aviso, no.
const copiado = ref('');       // '' | 'ok' | 'error'
const copiadoCual = ref('');   // qué botón lo dejó así, para pintar sólo ese
let copiadoTimer = null;

// El marcador de anotación, COPIADO del server (`store/anotaciones.go`) y no reinventado: si los dos
// no cortan por la misma línea, lo que el panel muestra como «Cómo» y lo que el copiado saca dejan de
// ser lo mismo, y eso no falla — miente.
const RE_ANOTACION = /^ {0,3}>\s*\*\*(MEDICI[ÓO]N|DECISI[ÓO]N|PREGUNTA|RIESGO)\s*·\s*\d{4}-\d{2}-\d{2}\s*(?:·\s*[^*]+?)?\s*\*\*/i;

// EL CORTE PARA COMPARTIR: se saca lo que es MÍO, no lo que «parece interno».
//
// La tentación era filtrar por palabras —borrar lo que diga `harness`, `playground`, `make …`— y es
// justo lo que NO hay que hacer: un filtro por regex se come 88 de 89 menciones y uno confía en él,
// que es peor que no tenerlo. Es la misma lección que el guard de Jira ya dejó escrita.
//
// Se corta por ESTRUCTURA, que el formato ya tiene. Medido sobre la tarea de Alta (89 líneas con
// herramientas, en 12 secciones): el grueso vive en dos lugares que no hay que adivinar —
//   · `## Registro`, que es la bitácora de qué hice cada día (48 de las 89);
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
const SECCIONES_MIAS = /^(registro|bit[áa]cora|c[óo]mo se comprueba|c[óo]mo probar)\b/i;

// ⚠ Los prefijos van con `^ {0,3}` y NO con `trimStart()`, y esa es la diferencia entre cortar bien
// y dejar contenido huérfano. En markdown un encabezado admite hasta TRES espacios de sangría; con
// CUATRO ya es un bloque de código indentado. Con `trimStart()` la línea `    # 1 · montar el
// comercio` —que es un comentario de shell dentro de un bloque— pasaba por encabezado de nivel 1,
// APAGABA el corte y dejaba escapar el resto de la sección. Se vio corriéndolo, no leyéndolo.
const RE_FENCE  = /^ {0,3}(```|~~~)/;
const RE_TITULO = /^ {0,3}(#{1,6})\s+(.+?)\s*$/;
const RE_CITA   = /^ {0,3}>/;

function cortarParaCompartir(md) {
  const out = [];
  let enBloque = false, enRecorte = false, trasAnotacion = false;
  const guardar = (l) => { if (!enRecorte) out.push(l); };
  for (const l of md.split('\n')) {
    // Dentro de un bloque de código un `>` o un `##` son contenido, no estructura — y acá se BORRA
    // texto, así que confundirlos cuesta caro.
    if (RE_FENCE.test(l)) { enBloque = !enBloque; trasAnotacion = false; guardar(l); continue; }
    if (enBloque) { guardar(l); continue; }
    const h = RE_TITULO.exec(l);
    if (h) {
      // Un encabezado de nivel 1 o 2 abre o cierra el recorte; los `###` de adentro son de su sección.
      if (h[1].length <= 2) enRecorte = SECCIONES_MIAS.test(h[2]);
      trasAnotacion = false;
      if (enRecorte) continue;
    }
    if (enRecorte) continue;
    if (RE_ANOTACION.test(l)) { out.push(l); trasAnotacion = true; continue; }
    if (trasAnotacion && RE_CITA.test(l)) continue;   // el `Cómo`: fuera
    trasAnotacion = false;
    out.push(l);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function textoParaCompartir(modo) {
  const i = active.value;
  if (!i) return '';
  const e = efforts.value.find(x => x.id === esfuerzoDe(i.Key));
  let cuerpo = cuerpoDe(i.Key);
  if (!cuerpo) return '';
  if (modo === 'compartir') cuerpo = cortarParaCompartir(cuerpo);
  const nodos = (e?.contextNodes || '').split(',').map(s => s.trim()).filter(Boolean);
  // ⚠ Las líneas en blanco son SIGNIFICATIVAS acá, no decoración: sin la que separa la cita del
  // cuerpo, el primer párrafo se pega al `>` y markdown se lo traga DENTRO del blockquote. Por eso
  // la línea opcional de nodos se decide al armar el arreglo y no con un `.filter` de vacíos
  // después — ese filtro se comía también los separadores, que es justo el bug que tenía esto.
  const cita = [`> Cuerpo técnico del tablero, copiado el ${new Date().toLocaleDateString('es-CO')}.`];
  if (nodos.length) cita.push(`> Nodos de contexto: ${nodos.join(', ')}.`);
  // Decir QUÉ se recortó, y no sólo que se recortó: quien lo recibe tiene que poder pedir lo que falta.
  if (modo === 'compartir') cita.push('> Recortado para compartir: sin el registro de trabajo, sin «cómo se comprueba» y sin los comandos de reproducción.');
  cita.push('> ⚠ PRIVADO — nombra repos, rutas y hallazgos internos. Esto NO es lo que sale a Jira.');
  const titulo = `# ${i.Key} · ${e?.title || i.Summary || ''}`.trim();
  return [titulo, '', ...cita, '', cuerpo.trim(), ''].join('\n');
}

async function copiarCuerpo(modo) {
  const txt = textoParaCompartir(modo);
  if (!txt) return;
  clearTimeout(copiadoTimer);
  copiadoCual.value = modo;
  copiado.value = (await alPortapapeles(txt)) ? 'ok' : 'error';
  copiadoTimer = setTimeout(() => { copiado.value = ''; copiadoCual.value = ''; }, 2000);
}

// Dos caminos, y el respaldo cuelga de que el primero FALLE, no de que falte.
//
// ⚠ Esa distinción es el bug que tenía esto y que sólo apareció probándolo: `navigator.clipboard`
// puede EXISTIR y aun así rechazar. Pide contexto seguro **y** documento enfocado, así que tira
// `NotAllowedError` si la pestaña perdió el foco — y como yo miraba sólo si la función existía, el
// respaldo quedaba muerto y el botón se ponía en rojo con la API ahí, disponible.
async function alPortapapeles(txt) {
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

// Cerrar el cajón limpia el estado: si no, se vuelve a abrir mostrando un ✓ de la vez pasada.
watch([panelTab, () => active.value?.Key], () => { clearTimeout(copiadoTimer); copiado.value = ''; copiadoCual.value = ''; });
function openTask(task) { active.value = task; panelTab.value = 'resumen'; }

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

// ── hallazgos: los hechos con fecha que la tarea declara en su cuerpo ──────────────────────────
// Vienen del ESFUERZO, igual que los prototipos, y salen del texto: el server los recoge de los
// marcadores `> **MEDICIÓN · fecha** — …`. Ver `server/internal/store/anotaciones.go`.
//
// Lo que aportan sobre la prosa es la EDAD. Una medición de hace dos meses se lee igual de segura
// que la de ayer, y una pregunta abierta hace una semana no le grita a nadie. Acá la edad se ve, y
// eso es lo único que la prosa no puede hacer.
const hallazgosDe = (key) => efforts.value.find(e => e.id === esfuerzoDe(key))?.anotaciones || [];
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

// ── PENDIENTES ───────────────────────────────────────────────────────────────────────────────────
// Lo que queda por hacer, sacado de las casillas del CUERPO (ver `pendientes.go` para el parser y el
// porqué del corte antes de la publicable). No se escriben ni se tildan desde acá a propósito: el
// cuerpo es el archivo, y editarlo por dos caminos es cómo se desincronizan las cosas.
const pendientesDe = (key) => efforts.value.find(e => e.id === esfuerzoDe(key))?.pendientes || [];
// Lo que se cuenta son los ABIERTOS. Medido sobre las 41 tareas: 37 casillas escritas y 1 tildada —
// nadie vuelve a marcarlas—, así que el total diría "hay deuda" incluso cuando ya no queda nada.
const quedan = (key) => pendientesDe(key).filter(p => !p.hecho).length;
// Agrupados por el encabezado bajo el que se escribieron: en una tarea larga los pendientes vienen de
// frentes distintos («Pendientes», «Cerrar con negocio», «Al retomar»), y en una lista plana se leen
// todos como si fueran lo mismo.
const pendientesPorSeccion = (key) => {
  const grupos = [];
  for (const p of pendientesDe(key)) {
    const tit = p.seccion || 'Sin sección';
    const g = grupos.find(x => x.tit === tit);
    (g || grupos[grupos.push({ tit, items: [] }) - 1]).items.push(p);
  }
  return grupos;
};

// Las pestañas comparten la tarea activa y sus fuentes de consulta.
const taskTabs = computed(() => {
  const key = active.value?.Key;
  return [
    { id: 'resumen', label: 'Resumen' },
    { id: 'jira', label: 'Jira' },
    { id: 'pendientes', label: 'Pendientes', count: quedan(key), alert: active.value?.StatusCategory === 'done' && quedan(key) > 0 },
    { id: 'hallazgos', label: 'Hallazgos', count: hallazgosDe(key).length, alert: hallazgosDe(key).some(vencido) },
    { id: 'ramas', label: 'Ramas', count: ramasCuenta(key) },
    { id: 'bitacora', label: 'Bitácora', count: ofActive.value.length },
    ...(protosDe(key).length ? [{ id: 'prototipos', label: 'Prototipos', count: protosDe(key).length }] : []),
  ];
});
const cerrarConEsc = (e) => { if (e.key === 'Escape') { panelTab.value = ''; mover.value = null; } };
onMounted(() => window.addEventListener('keydown', cerrarConEsc));
onUnmounted(() => { window.removeEventListener('keydown', cerrarConEsc); clearTimeout(copiadoTimer); });
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
// (Acá vivía `yaPasoPorQA`, que decidía cuándo esconder el viejo botón «A pruebas». Se fue con el botón:
// ya no hace falta adivinar dónde tiene sentido un movimiento — la lista de destinos la da Jira, y si
// desde este estado no se puede ir a pruebas, ese destino simplemente no aparece.)

// ── mover de estado: los destinos los DEFINE JIRA, no una lista de acá ──────────────────────────
// Medido el 2026-08-19 contra el workflow de CORE: el botón cableado a «pruebas» fallaba en todos los
// estados salvo «Terminada», porque ninguna transición AVANZA a pruebas (la única que llega ahí sale de
// Terminada y se llama «Se devuelve a pruebas»). Escribir los estados en el cliente garantiza volver a
// equivocarse cuando alguien edite el workflow; preguntárselos a Jira, no.
const mover = ref(null);   // null = menú cerrado; si no: { key, transitions:[{id,name,to}], testing }
const moverBusy = ref(false);
const moverError = ref('');

async function abrirMover(i) {
  if (mover.value?.key === i.Key) { mover.value = null; return; }
  active.value = i; mover.value = null; moverError.value = ''; qa.value = null;
  moverBusy.value = true;
  try {
    const j = await (await fetch(`${SERVER}/api/transitions?key=${i.Key}`)).json();
    if (j.error) moverError.value = j.error;
    // Sin transiciones no se abre un menú vacío: se dice por qué. Pasa de verdad — «Bloqueada» sólo
    // sale a «En progreso» e «Invalidada», y un estado terminal no saldría a ninguna parte.
    else if (!(j.transitions || []).length) moverError.value = `Jira no ofrece ninguna salida desde «${i.Status}»`;
    else mover.value = { key: i.Key, transitions: j.transitions, testing: j.testing || 'pruebas' };
  } catch { moverError.value = 'no se pudo hablar con el server'; }
  finally { moverBusy.value = false; }
}

// El destino que coincide con el estado de pruebas NO se mueve directo: cae en el flujo de QA, donde
// mover y avisarle a quien valida son un mismo acto (y el mensaje se previsualiza).
const esHaciaPruebas = (t) => (t.to || '').toLowerCase().includes((mover.value?.testing || 'pruebas').toLowerCase());

async function aplicarTransicion(t) {
  const i = active.value;
  if (esHaciaPruebas(t)) { mover.value = null; await openQA(i); return; }
  moverBusy.value = true; moverError.value = '';
  try {
    const j = await (await fetch(`${SERVER}/api/transitions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: i.Key, id: t.id }),
    })).json();
    if (j.error) { moverError.value = j.error; return; }
    mover.value = null;
    // Se recarga desde Jira en vez de simular el cambio acá: el estado nuevo puede traer otras cosas
    // (el workflow puede tocar campos) y una copia local sería una segunda verdad.
    await loadSprint(sprint.value?.id);
    if (vistaAncha.value) await cargarUltimos4();
  } catch { moverError.value = 'no se pudo hablar con el server'; }
  finally { moverBusy.value = false; }
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
  // Los 4 sprints se traen al final: dependen de `sprintTabs`, que se llena con la lista de arriba.
  // Sin await: la vista pinta el sprint activo primero y las otras tarjetas entran cuando llegan.
  cargarUltimos4();
});
</script>

<template>
  <div class="wrap" :class="{ ancha: vistaAncha }">
    <header>
      <div class="logo">T</div>
      <div>
        <h1>Tablero</h1>
        <!-- Nombra el sprint ACTIVO: los indicadores de abajo son suyos, y sin las pestañas nada más
             lo decía. Que la lista muestre 4 sprints no cambia a cuál miden las métricas. -->
        <p class="sub">{{ sprint ? nombreCorto(sprint.name) : 'Mi sprint' }} · registro de tiempo y hallazgos</p>
      </div>
      <div class="sp" v-if="sprint">
        <!-- El único botón de vista que queda: enfocar SÓLO el sprint activo. El default es al revés
             (todo lo de la ventana), que es lo que uno mira el 90% del tiempo. -->
        <button class="tact vista" :class="{ act: !vistaAncha }" @click="alternarVista"
          :title="vistaAncha ? `ver sólo ${sprint?.name || 'el sprint activo'}` : 'ver mis tareas de los últimos sprints'">
          {{ vistaAncha ? 'sólo este sprint' : `últimos ${sprintTabs.length} sprints` }}
        </button>
        <span v-if="sprintDays?.state === 'upcoming'" class="chip">arranca en {{ sprintDays.startsIn }} día{{ sprintDays.startsIn === 1 ? '' : 's' }}</span>
        <span v-else-if="sprintDays?.state === 'closed'" class="chip warn">cerrado hace {{ sprintDays.endedAgo }} día{{ sprintDays.endedAgo === 1 ? '' : 's' }}</span>
        <span v-else-if="sprintDays?.state === 'ongoing'" class="chip chip-bar">{{ sprintDays.remaining }} día{{ sprintDays.remaining === 1 ? '' : 's' }} restante{{ sprintDays.remaining === 1 ? '' : 's' }}<i class="mini"><b :style="{ width: sprintDays.pct + '%' }"></b></i></span>
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
        <h2 class="journey-heading"><button class="section-toggle" :aria-expanded="journeyOpen" aria-controls="journey-content" @click="journeyOpen = !journeyOpen">
          <span aria-hidden="true">{{ journeyOpen ? '⌄' : '›' }}</span> Mi jornada
          <span class="mut">· últimos {{ days }} días{{ rangeMin ? ` · ${minHhmm(rangeMin)}` : '' }}</span>
        </button></h2>
        <div id="journey-content" v-show="journeyOpen">
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
          <!-- Con filtro puesto dice las DOS mitades («9 / 16»): sólo el número filtrado hace pensar que
               se perdieron tareas, y sólo el total contradice lo que se ve en la grilla. -->
          <span v-if="!cargandoAncha" class="cnt">{{ ocultos.size || buscaNorm ? `${visibles} / ${totalTasks}` : visibles }}</span>
        </h2>
        <p v-if="vistaAncha && cargandoAncha" class="empty">trayendo los sprints…</p>
        <!-- Filtro LOCAL: no vuelve a pedirle nada al server, sólo tapa lo que no corresponde.
             CHECKBOXES y no una pastilla activa a la vez: la pregunta real no es «¿cuál quiero ver?»
             sino «¿cuáles quiero sacar de la vista?», y esas dos se responden distinto — ocultar sólo
             las terminadas era imposible con selección única. Tildado = se ve. Por eso ya no hay
             «todas»: es el estado en que arranca, y como opción sólo repetía el default.
             Cada casilla lleva su conteo porque un filtro sin conteo obliga a clickear para descubrir
             que está vacío. Las que no tienen nada se deshabilitan en vez de esconderse: que «en
             pruebas 0» se vea es información. -->
        <div class="filtros" v-if="!cargandoAncha && totalTasks">
          <label v-for="f in FILTROS" :key="f.id" class="fpill"
            :class="{ off: ocultos.has(f.id), bloq: f.id === 'bloqueada', vacio: !conteoFiltro[f.id] }"
            :title="ocultos.has(f.id) ? `mostrar ${f.label}` : `ocultar ${f.label}`">
            <input type="checkbox" :checked="!ocultos.has(f.id)" :disabled="!conteoFiltro[f.id]"
              @change="alternarFiltro(f.id)">
            {{ f.label }}<span class="cnt">{{ conteoFiltro[f.id] }}</span>
          </label>
          <!-- LAS LOCALES son otro eje: las casillas de arriba filtran por ESTADO, esto por ORIGEN.
               Va separada por eso, y arranca APAGADA — el tablero es el sprint primero. -->
          <label class="fpill origen" :class="{ off: !verLocales, vacio: !cuantasLocales }"
            :title="verLocales ? 'ocultar las tareas locales' : 'mostrar también las tareas locales (no están en Jira)'">
            <input type="checkbox" v-model="verLocales" :disabled="!cuantasLocales">
            locales<span class="cnt">{{ cuantasLocales }}</span>
          </label>
          <!-- Buscador por título (y por clave: pegar «CORE-431» es la otra forma de buscar una tarea).
               Va en la MISMA fila que las casillas porque es lo mismo —una vista sobre la lista— y
               separarlo haría pensar que son dos filtros independientes cuando se combinan con Y. -->
          <label class="fbusca" :class="{ act: !!buscaNorm }">
            <span class="lupa" aria-hidden="true">⌕</span>
            <input v-model="busca" type="search" placeholder="buscar por título…"
              aria-label="Buscar tarea por título o clave">
            <button v-if="busca" class="fx" type="button" title="limpiar" @click="busca = ''">×</button>
          </label>
        </div>
        <!-- Sin resultados NO puede ser una grilla vacía a secas: se lee como «no tengo tareas», que es
             otra cosa. Dice qué se buscó y ofrece deshacerlo. -->
        <p v-if="!cargandoAncha && totalTasks && !visibles" class="empty">
          Ninguna tarea coincide<span v-if="buscaNorm"> con «<b>{{ busca.trim() }}</b>»</span><span
            v-if="ocultos.size"> entre los estados que dejaste visibles</span>.
          <button class="lnk" type="button" @click="busca = ''; ocultos.clear()">ver todas</button>
        </p>
        <template v-for="g in groupedIssues" :key="g.id">
          <h3 class="task-group-heading">
            <button class="section-toggle" :aria-expanded="!!buscaNorm || !collapsedGroups.has(g.id)"
              :aria-controls="'group-' + g.id" @click="toggleGroup(g.id)">
              <span aria-hidden="true">{{ buscaNorm || !collapsedGroups.has(g.id) ? '⌄' : '›' }}</span>
              {{ g.title }}<span class="group-count">{{ g.tasks.length }}</span>
            </button>
          </h3>
          <div class="tgrid" :id="'group-' + g.id" v-show="buscaNorm || !collapsedGroups.has(g.id)">
            <div v-for="i in g.tasks" :key="i.Key" class="task"
              :class="{ sel: active?.Key === i.Key, wide: qa?.key === i.Key, done: i.StatusCategory === 'done' }"
              @click="active = i">
              <div class="tl">
                <span v-if="i._local" class="key local" title="tarea local — todavía no está en Jira">local · {{ i._esfuerzoId }}</span>
                <a v-else-if="site" class="key link" :href="jiraLink(i.Key)" target="_blank" rel="noopener"
                  @click.stop :title="`Abrir ${i.Key} en Jira`">{{ i.Key }} <span class="ext">↗</span></a>
                <span v-else class="key">{{ i.Key }}</span>
                <span v-if="!i._local" class="status" :class="statusClass(i.StatusCategory)">{{ i.Status }}</span>
                <span v-else class="status sin-jira" title="no sale a Jira hasta que se decida">sin publicar</span>
              </div>
              <div class="tt">{{ i.Summary }}</div>

              <!-- Estado actual breve; el próximo paso tiene su propia línea debajo. -->
              <p v-if="resumenDe(i.Key)" class="jd" :title="resumenDe(i.Key)">{{ resumenDe(i.Key) }}</p>
              <p v-else-if="i.Description" class="jd" :title="i.Description">{{ i.Description }}</p>
              <p v-else class="jd none">sin cuerpo técnico todavía</p>

              <p class="next-step" :class="{ missing: !proximoDe(i.Key) }" :title="proximoDe(i.Key)">
                <span>Próximo paso</span>{{ proximoDe(i.Key) || 'Por definir en la retoma' }}
              </p>
              <div class="task-meta">
                <i v-if="i._local && stageOf(i._esfuerzoId)" class="stg suelto" :class="'s-' + stageOf(i._esfuerzoId)?.id">{{ stageOf(i._esfuerzoId)?.label }}</i>
                <!-- PROYECTO PROPIO: herramienta, exploración o mejora a futuro. No va a Jira nunca, así
                     que no se le pide sección publicable ni se lo cuenta como trabajo del día a día. Es
                     una decisión declarada (`clase:`), no algo que se deduzca de si tiene clave. -->
                <span v-if="esProyecto(i._esfuerzoId)" class="spchip proyecto"
                  title="proyecto propio: herramienta, exploración o mejora a futuro. No sale a Jira">proyecto</span>
                <!-- El grupo al que pertenece la tarjeta, como chip: reemplaza al encabezado que antes
                     partía la grilla. `_esfuerzo` en la vista del sprint, `_sprint` en la ancha. -->
                <span v-if="i._esfuerzo" class="spchip esf" :title="`esfuerzo: ${i._esfuerzo}`">
                  {{ i._esfuerzo }}
                  <i v-if="stageOf(i._esfuerzoId)" class="stg" :class="'s-' + stageOf(i._esfuerzoId)?.id">{{ stageOf(i._esfuerzoId)?.label }}</i>
                </span>
                <span v-if="i._sprint" class="spchip" :title="`del ${i._sprint}`">{{ i._sprint }}</span>
                <!-- Cuánto hace que nadie toca el archivo de la tarea. Sólo aparece cuando ya es
                     DORMIDA: una tarjeta que dice «hoy» en cada tarea viva es ruido. -->
                <span v-if="i._esfuerzoId && diasSinTocar(i._esfuerzoId) >= DORMIDA_DIAS" class="spchip dormida"
                  :title="`el archivo de la tarea no se toca desde ${efforts.find(e => e.id === i._esfuerzoId)?.tocadoEn} — ¿sigue viva? a los 30 días, archivar o anotar por qué espera`">
                  {{ diasSinTocar(i._esfuerzoId) }} d sin tocar{{ diasSinTocar(i._esfuerzoId) >= 30 ? ' · ¿archivar?' : '' }}</span>
                <!-- El arrastre no es decoración: una tarea que va por su 3.er sprint es lo que uno
                     quiere ver sin abrir nada. Sólo aparece cuando hay más de uno. -->
                <span v-if="i._arrastres > 1" class="spchip drag"
                  :title="`aparece en ${i._arrastres} sprints — viene arrastrada`">{{ i._arrastres }}.º sprint</span>
              </div>
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

              <!-- Una entrada al contexto y la acción explícita de cambiar estado. -->
              <div class="tacts" @click.stop>
                <button class="tact principal" @click="openTask(i)">Retomar</button>
                <span v-if="quedan(i.Key)" class="card-note" :class="{ warn: i.StatusCategory === 'done' }">
                  {{ quedan(i.Key) }} pendiente{{ quedan(i.Key) === 1 ? '' : 's' }}
                </span>
                <span v-if="hallazgosDe(i.Key).some(vencido)" class="card-note warn">Revisar hallazgos</span>
                <button v-if="!i._local" class="tact move-task" :class="{ act: mover?.key === i.Key }"
                  :disabled="moverBusy || qa?.key === i.Key" @click="abrirMover(i)">
                  {{ moverBusy && active?.Key === i.Key ? 'Consultando Jira…' : '⇢ Mover' }}
                </button>
              </div>

              <!-- Handoff a QA, dentro de SU tarjeta. El mensaje se previsualiza y se puede editar: nunca
                   sale algo que no se vio, y el server lo re-valida contra el guard antes de publicarlo. -->
              <!-- Los destinos REALES, tal como los devolvió Jira. Si alguien edita el workflow, esto
                   cambia solo: no hay ninguna lista de estados escrita en el cliente. -->
              <div v-if="mover?.key === i.Key" class="mv" @click.stop>
                <p class="mv-h">Desde <b>{{ i.Status }}</b>, Jira deja ir a:</p>
                <div class="mv-opts">
                  <button v-for="t in mover.transitions" :key="t.id" class="mv-o"
                    :class="{ qa: esHaciaPruebas(t) }" :disabled="moverBusy"
                    :title="`transición «${t.name}»`" @click="aplicarTransicion(t)">
                    {{ t.to }}<span v-if="esHaciaPruebas(t)" class="mv-tag">+ aviso</span>
                  </button>
                </div>
              </div>
              <p v-if="moverError && active?.Key === i.Key" class="qa-err">{{ moverError }}</p>

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

    <TaskPanel v-if="panelTab && active" :key="active.Key" v-model:tab="panelTab"
      :title="active.Summary" :task-key="active._local ? 'local · ' + active._esfuerzoId : active.Key"
      :tabs="taskTabs" @close="panelTab = ''">
      <div v-if="panelTab === 'resumen'" class="task-tab-body">
          <div v-if="documentSections.length" class="drawer-cps">
            <button class="drawer-cp" :class="copiadoCual === 'compartir' ? copiado : ''"
                    title="Copiar SIN el registro de trabajo ni los comandos de reproducción — para mandárselo a alguien"
                    @click="copiarCuerpo('compartir')">
              <span aria-hidden="true">{{ copiadoCual === 'compartir' && copiado === 'ok' ? '✓' : copiadoCual === 'compartir' && copiado === 'error' ? '✕' : '⧉' }}</span>
              {{ copiadoCual === 'compartir' && copiado === 'ok' ? 'copiado' : copiadoCual === 'compartir' && copiado === 'error' ? 'no se pudo' : 'compartir' }}
            </button>
            <button class="drawer-cp" :class="copiadoCual === 'todo' ? copiado : ''"
                    title="Copiar el cuerpo ENTERO, con el registro y los comandos — para retomar la tarea"
                    @click="copiarCuerpo('todo')">
              <span aria-hidden="true">{{ copiadoCual === 'todo' && copiado === 'ok' ? '✓' : copiadoCual === 'todo' && copiado === 'error' ? '✕' : '⧉' }}</span>
              {{ copiadoCual === 'todo' && copiado === 'ok' ? 'copiado' : copiadoCual === 'todo' && copiado === 'error' ? 'no se pudo' : 'todo' }}
            </button>
          </div>

          <p class="empty">Contexto privado de la tarea. Los pendientes y hallazgos están en sus pestañas.</p>

            <div v-if="effortDe(active.Key)?.contextNodes" class="retoma-contextos">
              <span>Contexto local:</span>
              <a v-for="n in effortDe(active.Key).contextNodes.split(',').map(x => x.trim()).filter(Boolean)"
                :key="n" class="ctx-link" :href="contextLink(n)" target="_blank" rel="noopener"
                :title="`Abrir ${n} en context/ · requiere make context`">{{ n }} ↗</a>
            </div>

          <!-- Sólo las secciones principales: el Registro puede tener cientos de entradas y no debe
               convertir el índice de retoma en una lista cronológica. -->
          <nav v-if="indiceCuerpo.length > 2" class="toc">
            <button v-for="h in indiceCuerpo" :key="h.id" class="toc-i"
                    @click="irASeccion(h.id)">{{ h.title }}</button>
          </nav>

          <div v-if="summarySections.length" class="desc cuerpo-md">
            <template v-for="section in summarySections" :key="section.id">
              <details v-if="section.history" :id="section.id" class="document-history">
                <summary>{{ section.title }} <span>· historial de trabajo</span></summary>
                <div v-html="section.summaryHtml"></div>
              </details>
              <section v-else :id="section.id" class="document-section" :class="{ 'retoma-panel': section.retoma }" v-html="section.summaryHtml"></section>
            </template>
          </div>
          <p v-else class="desc none">{{ documentSections.length ? 'El contenido de esta tarea está en las otras pestañas.' : 'Esta tarea todavía no tiene un resumen privado.' }}</p>

      </div>
      <div v-if="panelTab === 'jira'" class="task-tab-body">
        <p v-if="active._local" class="empty">Esta tarea es local y todavía no está publicada en Jira.</p>
        <template v-else>
          <div class="jira-heading">
            <span class="status" :class="statusClass(active.StatusCategory)">{{ active.Status }}</span>
            <a v-if="site" class="link" :href="jiraLink(active.Key)" target="_blank" rel="noopener">Abrir {{ active.Key }} en Jira ↗</a>
          </div>
          <p class="empty">Descripción recibida de Jira al cargar el sprint. El formato se adapta al tablero.</p>
          <iframe v-if="jiraDocument" class="jira-preview" :srcdoc="jiraDocument"
            sandbox="allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer"
            :title="'Descripción de ' + active.Key + ' en Jira'"></iframe>
          <p v-else class="desc none">Jira no devolvió una descripción para esta tarea.</p>
        </template>
      </div>
      <div v-if="panelTab === 'pendientes'" class="task-tab-body">

          <p class="empty">Pendientes del documento privado, con sus notas y enlaces.</p>
          <div v-if="pendingSections.length" class="desc cuerpo-md pending-document">
            <section v-for="section in pendingSections" :key="section.id" class="document-section">
              <h2 v-if="section.pendingHtml !== section.html">{{ section.title || 'Pendientes' }}</h2>
              <div v-html="section.pendingHtml"></div>
            </section>
          </div>
          <p v-else-if="!pendientesDe(active?.Key).length" class="empty">Esta tarea no tiene pendientes registrados.</p>
          <template v-else>
          <section v-for="(g, n) in pendientesPorSeccion(active?.Key)" :key="n" class="hgrupo">
            <h4>{{ g.tit }}<span class="hcnt">{{ g.items.filter(p => !p.hecho).length }}</span></h4>
            <article v-for="(p, m) in g.items" :key="m" class="pitem" :class="{ hecho: p.hecho }">
              <span class="pmark" aria-hidden="true">{{ p.hecho ? '✓' : '○' }}</span>
              <p class="pque">{{ p.que }}</p>
            </article>
          </section>
          </template>

      </div>
      <div v-if="panelTab === 'hallazgos'" class="task-tab-body">

          <p class="empty">Salen del cuerpo de la tarea. Se escriben ahí, donde se argumentan.</p>
          <p v-if="!hallazgosDe(active?.Key).length" class="empty">Esta tarea no tiene hallazgos registrados.</p>
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
      <div v-if="panelTab === 'ramas'" class="task-tab-body">

          <p v-if="!ramasCuenta(active?.Key)" class="empty">No hay ramas medidas para esta tarea.</p>
          <p v-if="ramasCuenta(active?.Key)" class="empty">Medido {{ haceCuanto(ramasDe(active?.Key)?.medidoEn || ramasSnap.medidoEn) }}
            <span v-if="ramasSnap.incompletas?.length" class="warn">· {{ ramasSnap.incompletas.length }} tarea(s) sin medir</span>
          </p>
          <p v-if="entregaDe(active?.Key)" class="resumen-entrega">
            <span class="entrega" :class="entregaDe(active?.Key).clase">{{ entregaDe(active?.Key).texto }}</span>
            {{ entregaDe(active?.Key).titulo }}
          </p>
          <!-- El cómo se mide explicado en UNA línea: el párrafo largo empujaba la tabla, que es lo que
               se viene a mirar. El detalle queda a un hover de distancia. -->
          <p class="empty comomide">
            <span title="`git cherry` compara por patch-id, así que un cambio que llegó por squash de UN commit cuenta como mergeado aunque la rama ya no exista.">Medido por <b>patch-id</b></span>,
            y cuando el squash cambió el patch —mensaje o contenido editados al mergear— por el
            <span title="Si el PR se mergeó y su commit resultante ya es ancestro del ambiente, el cambio está aunque el patch-id no coincida. Sin esta segunda señal, un PR squasheado que YA estaba en main salía como «no llegó».">
              <b>commit del PR</b> (<span class="si via-pr">✓</span>)</span>.
            Refrescar: <code>make tareas-ramas</code>.</p>
          <div class="tabla-wrap">
            <table class="ramas">
              <thead>
                <tr>
                  <th>repo</th><th>rama</th><th>PR</th>
                  <th v-for="a in ambientesDe(active?.Key)" :key="a" :class="{ ppal: a === 'main' }">{{ a }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="r in ramasDe(active?.Key)?.ramas || []" :key="r.repo + r.rama">
                  <td>{{ r.repo }}</td>
                  <td><code :title="r.asunto">{{ r.rama }}</code> <span class="sha">{{ r.commit }}</span>
                    <!-- «local» no quiere decir "sin pushear": al aprobar un PR la remota se borra y queda
                         la copia local. Las columnas de ambiente dicen cuál de las dos es. -->
                    <span v-if="r.local" class="solo-local"
                      title="la rama sólo existe en esta máquina — puede ser que nunca se pusheó, o que se borró al mergear el PR">local</span></td>
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
                  <td v-for="a in ambientesDe(active?.Key)" :key="a" class="amb" :class="{ ppal: a === 'main' }">
                    <span v-if="!(a in (r.propios || {}))" class="na" title="ese ambiente no existe en este repo">—</span>
                    <span v-else-if="r.en?.[a]" class="si" :class="{ 'via-pr': r.como?.[a] === 'pr' }"
                      :title="COMO_TEXTO[r.como?.[a]] || 'el cambio ya está acá'">✓</span>
                    <span v-else class="no" title="el cambio todavía no está acá">·</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

      </div>
      <div v-if="panelTab === 'bitacora'" class="task-tab-body">

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
      <div v-if="panelTab === 'prototipos'" class="task-tab-body">

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
    </TaskPanel>
  </div>
</template>

<style scoped>
.wrap { max-width: 1180px; margin: 0 auto; padding: 26px 22px 60px }
/* Vista ancha: la página se suelta. Los 1180px son para leer UNA columna de tarjetas; con cuatro sprints
   a la vez lo que se quiere es abarcar, y la grilla ya es `auto-fill` — sólo hay que dejarla crecer. */
.wrap.ancha { max-width: none }
/* Menú de estados. Las opciones son las que devolvió Jira, así que el ancho lo decide el contenido:
   fijar columnas cortaría nombres como «Se devuelve a pruebas». */
.mv { margin: 8px 0 0; padding: 9px 10px; background: var(--panel2); border: 1px solid var(--line);
  border-radius: 9px }
.mv-h { margin: 0 0 7px; font-size: 11.5px; color: var(--mut) }
.mv-h b { color: var(--txt); font-weight: 600 }
.mv-opts { display: flex; flex-wrap: wrap; gap: 5px }
.mv-o { border: 1px solid var(--line2); background: var(--panel); color: var(--txt); font: inherit;
  font-size: 12px; font-weight: 600; padding: 4px 9px; border-radius: 7px; cursor: pointer;
  display: inline-flex; align-items: center; gap: 5px; transition: .12s }
.mv-o:hover:not(:disabled) { border-color: color-mix(in srgb, var(--acc) 55%, transparent) }
.mv-o:disabled { opacity: .5; cursor: default }
/* El que dispara el aviso a QA se distingue: no es sólo un cambio de estado, además le escribe a alguien. */
.mv-o.qa { border-color: #4ade8055 }
.mv-tag { font-size: 9.5px; font-weight: 700; color: #4ade80; text-transform: uppercase; letter-spacing: .3px }

/* Filtro por estado. Van arriba de la grilla y no dentro de las tarjetas: es una decisión sobre el
   CONJUNTO. La deshabilitada se ve —conserva su cero— porque un bucket vacío es un dato. */
.filtros { display: flex; gap: 5px; flex-wrap: wrap; margin: 0 0 12px }
/* Tildada = se ve, que es el estado normal: por eso la tildada va en tono fuerte y la destildada se
   apaga. Al revés (resaltar la que está oculta) el tablero se leería como si el trabajo estuviera
   apagado. */
.fpill { border: 1px solid color-mix(in srgb, var(--acc) 45%, transparent); background: var(--panel);
  color: var(--txt); font: inherit; font-size: 12px; font-weight: 600; padding: 4px 10px;
  border-radius: 999px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px;
  transition: .12s }
.fpill:hover { border-color: var(--line2) }
.fpill input { accent-color: var(--acc); margin: 0; cursor: inherit }
/* Destildada = oculta: se apaga igual que una tarea terminada, y por lo mismo — sigue estando, pero
   ya no participa de lo que se está mirando. */
.fpill.off { color: var(--mut); background: var(--panel2); border-color: var(--line) }
/* Bloqueada en rojo aunque esté destildada: es la única del filtro que pide una acción de OTRA persona,
   así que tiene que verse incluso cuando se la sacó de la vista. */
.fpill.bloq { color: #f87171; border-color: #f8717144 }
.fpill.bloq:not(.off) { color: #fca5a5; border-color: #f87171aa }
/* Sin tareas: la casilla no hace nada; el conteo en 0 se muestra igual, que es información. */
.fpill.vacio { opacity: .38; cursor: default }
.fpill .cnt { font-size: 10.5px; opacity: .8; font-weight: 700 }
/* El buscador vive en la fila de las casillas y con la misma pastilla: es el mismo tipo de cosa —una
   vista sobre la lista—, no un control aparte. `margin-left: auto` lo empuja al final para que las
   casillas queden juntas y se lean como un grupo. */
.fbusca { display: inline-flex; align-items: center; gap: 5px; margin-left: auto;
  border: 1px solid var(--line); background: var(--panel2); border-radius: 999px;
  padding: 3px 6px 3px 10px; transition: .12s }
.fbusca:focus-within, .fbusca.act { border-color: color-mix(in srgb, var(--acc) 45%, transparent);
  background: var(--panel) }
.fbusca .lupa { color: var(--mut); font-size: 13px; line-height: 1 }
.fbusca input { border: 0; background: transparent; color: var(--txt); font: inherit; font-size: 12px;
  width: 190px; outline: none; padding: 1px 0 }
.fbusca input::placeholder { color: var(--mut) }
/* La X nativa de `type=search` no existe en todos los navegadores: se pone una propia y se esconde. */
.fbusca input::-webkit-search-cancel-button { display: none }
.fx { border: 0; background: transparent; color: var(--mut); font: inherit; font-size: 15px;
  line-height: 1; cursor: pointer; padding: 0 4px; border-radius: 999px }
.fx:hover { color: var(--txt) }
/* «ver todas» del estado vacío: un enlace, no un botón — deshacer un filtro no compite con nada. */
.lnk { border: 0; background: transparent; color: var(--acc); font: inherit; font-size: inherit;
  cursor: pointer; padding: 0; margin-left: 6px; text-decoration: underline }

/* De qué sprint es la tarjeta. Va en la línea de la clave, chiquito: es contexto, no el dato principal. */
.spchip { margin-left: auto; font-size: 10.5px; color: var(--mut); border: 1px solid var(--line);
  border-radius: 5px; padding: 1px 5px; white-space: nowrap }
/* El chip del esfuerzo puede ser largo (es un título): se recorta en vez de empujar la línea. */
.spchip.esf { max-width: 46%; overflow: hidden; text-overflow: ellipsis; color: var(--acc);
  border-color: color-mix(in srgb, var(--acc) 35%, transparent); display: inline-flex; gap: 5px; align-items: center }
.spchip.esf .stg { font-style: normal; font-size: 9.5px; opacity: .8 }
/* Arrastre: va PEGADO al chip del sprint (el `margin-left:auto` es del primero, que ya empujó los dos
   al borde) y en ámbar, porque es un aviso — no el mismo tono que el dato neutro de al lado. */
.spchip.drag { margin-left: 4px; color: #fbbf24; border-color: #fbbf2455 }
.spchip.dormida { margin-left: 4px; color: #a8a29e; border-color: #a8a29e55; font-style: italic }
.spchip.proyecto { margin-left: 4px; color: #60a5fa; border-color: #60a5fa55; background: #60a5fa12 }
header { display: flex; align-items: center; gap: 14px; margin-bottom: 22px; flex-wrap: wrap; row-gap: 10px }
.logo { width: 34px; height: 34px; border-radius: 7px; display: grid; place-items: center; font-weight: 800;
  color: #171717; font-size: 17px; background: #fff }
h1 { font-size: 20px; margin: 0; letter-spacing: .2px }
.sub { color: var(--mut); font-size: 13px; margin: 2px 0 0 }
.sp { margin-left: auto; display: flex; align-items: center; gap: 10px; font-size: 13px }
.chip { padding: 4px 11px; border-radius: 999px; border: 1px solid var(--line); color: var(--mut); font-size: 12px; white-space: nowrap }
.chip.warn { color: var(--warn); border-color: #5a4313; background: #211907 }

/* engranaje de ajustes: los checks de campos de la empresa. `pushed` lo empuja a la derecha cuando no
   hay barra de sprint que ya ocupe el margen automático */

.stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0; margin-bottom: 12px;
  border: 1px solid var(--line); border-radius: 8px; overflow: hidden }
.stat { background: var(--panel); border: 0; border-right: 1px solid var(--line); padding: 12px 16px }
.stat:last-child { border-right: 0 }
.stat .k { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; color: var(--mut) }
.stat .v { font-size: 22px; font-weight: 600; margin: 3px 0 2px; letter-spacing: -.5px; font-variant-numeric: tabular-nums }
.stat .s { font-size: 11.5px; color: var(--mut) }
.stat.alert .v { color: var(--warn) }
.stat.ok .v { color: var(--acc) }

.card { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 18px; margin-bottom: 16px }
.card h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .8px; color: var(--mut); margin: 0 0 14px; font-weight: 700;
  display: flex; align-items: center; gap: 6px }
/* selector de fuente de la jornada: a la derecha del título, mismo control que el selector de sprints
   (`.tabs`) pero más chico — es un cambio de lente, no una navegación. */
.card h2 .on { color: var(--acc); margin-left: 6px }
.card h2 .mut { color: var(--mut); font-weight: 400; text-transform: none; letter-spacing: 0 }

/* Las filas mantienen la misma jerarquía de lectura dentro de cada estado. */
.tgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 320px), 1fr)); gap: 12px; margin-bottom: 18px; align-items: start }
.tgrid > .task.wide { grid-column: 1 / -1 }
.task { border: 1px solid var(--line); border-radius: 8px; padding: 12px 13px; cursor: pointer; transition: .12s }
.task:hover { border-color: #737373 }
.task.sel { border-color: var(--acc); background: #1a1a1a }
/* Terminada = sigue en la grilla, pero deja de competir por la atención: en gris y apagada, como algo
   que ya no está vivo. Se apaga la tarjeta ENTERA (`filter`) y no cada color a mano — así el chip verde
   de estado, el punto del sprint de origen y los chips de esfuerzo se van juntos, sin mantener una lista
   de excepciones que se desactualiza cuando se agrega un elemento nuevo a la card.
   ⚠ Vuelve a color al pasarle por encima, al abrirla y con el panel de QA desplegado: revisar lo que ya
   se hizo es una tarea normal, y hacerla leyendo texto atenuado sería cambiar ruido por fricción.
   `filter` es seguro acá porque la card no tiene descendientes `fixed` — el cajón vive FUERA, por eso. */
.task.done { filter: grayscale(1); opacity: .55 }
.task.done:hover, .task.done.sel, .task.done.wide { filter: none; opacity: 1 }
.tl { display: flex; align-items: center; justify-content: space-between; gap: 9px; margin-bottom: 9px; flex-wrap: wrap }
.key { font-weight: 800; font-size: 12.5px; font-variant-numeric: tabular-nums }
.status { font-size: 10.5px; padding: 2px 8px; border-radius: 999px; border: 1px solid }
.e-ok { color: #d4d4d4; border-color: #404040; background: #181818 }
.e-doing { color: #fff; border-color: #737373; background: #242424 }
.e-todo { color: #a3a3a3; border-color: #333; background: #181818 }
.tt { font-size: 14px; font-weight: 600; line-height: 1.45; margin-bottom: 8px }
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
.tact.act { color: var(--acc); border-color: #737373; background: #242424 }
.tact.principal { color: #171717; border-color: #fff; background: #fff; }
.tact.principal:hover:not(:disabled) { background: #d4d4d4; }
.mas-acciones { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; width: 100%; }
/* el de QA es el único que ESCRIBE (mueve en Jira y manda un DM): se distingue del resto */
.tact.go { color: #171717; border-color: #fff; background: #fff }
.tact.go:hover:not(:disabled) { background: #d4d4d4; color: #171717 }
/* La entrega dentro del botón de ramas: verde cuando todo está en main, ámbar a medio camino, y
   gris cuando todavía no llegó nada. El color hace el trabajo de un vistazo; el texto, el de precisar. */
.entrega { margin-left: 6px; font-size: 10px; font-weight: 700; letter-spacing: .02em;
  padding: 1px 5px; border-radius: 999px; border: 1px solid transparent }
.entrega.ok { color: #d4d4d4; border-color: #404040; background: #181818 }
.entrega.medio { color: #fbbf24; border-color: #fbbf2455; background: #fbbf2412 }
.entrega.espera { color: var(--mut); border-color: var(--line); background: var(--panel2) }
.resumen-entrega { display: flex; align-items: center; gap: 8px; margin: 0 0 8px; color: var(--txt); font-size: 12.5px }
.resumen-entrega .entrega { margin-left: 0 }
/* la columna que importa: `main` es la vara con la que se mide el contexto */
.ramas th.ppal, .ramas td.ppal { background: #181818; border-left: 1px solid var(--line) }
.ramas th.ppal { color: var(--txt); font-weight: 800 }
.comomide span[title] { border-bottom: 1px dotted var(--line); cursor: help }
/* un ✓ que se supo por el PR y no por el patch-id: se marca para que el dato pueda explicarse */
.amb .si.via-pr { color: #4ade80cc; border-bottom: 1px dotted #4ade8077 }
.tact .cnt { background: var(--line); color: var(--txt); font-size: 10px; font-weight: 700;
  padding: 1px 6px; border-radius: 999px }
.tact.act .cnt { background: var(--acc); color: #171717 }
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
/* El botón de copiar. Lleva él el `margin-left:auto` y se lo quita a la ✕ que viene después: si los
   dos lo tienen, el espacio libre se reparte entre ellos y quedan separados a media barra. */
.drawer-cps { display: flex; gap: 6px; margin-bottom: 16px }
.drawer-cp { display: inline-flex; align-items: center; gap: 5px;
  border: 1px solid var(--line); border-radius: 6px; background: none; color: var(--mut);
  font: inherit; font-size: 11.5px; cursor: pointer; padding: 3px 8px; line-height: 1.4;
  white-space: nowrap; transition: color .12s, border-color .12s }
.drawer-cp:hover { color: var(--txt); border-color: var(--mut) }
.drawer-cp.ok { color: #4ade80; border-color: currentColor }
.drawer-cp.error { color: var(--bad); border-color: currentColor }
/* una propuesta en el panel: el nombre del archivo abajo, que es lo que la identifica en disco */
.proto-row { display: flex; align-items: center; gap: 12px; width: 100%; text-align: left; cursor: pointer;
  background: none; border: 1px solid var(--line); border-radius: 9px; padding: 12px 14px; margin-bottom: 9px;
  font: inherit; color: var(--txt) }
.proto-row:hover { border-color: var(--acc); background: #242424 }
.proto-play { color: var(--acc); font-size: 12px }
.proto-txt { flex: 1; min-width: 0 }
.proto-txt b { display: block; font-size: 13.5px; font-weight: 600; text-transform: capitalize }
.proto-file { display: block; font-size: 11px; color: var(--mut); font-family: ui-monospace, Menlo, monospace;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 2px }
.proto-ext { color: var(--mut); font-size: 12px }
.proto-row:hover .proto-ext { color: var(--acc) }
/* handoff a QA: la ÚNICA acción del tablero que escribe en Jira y manda un mensaje, así que el envío
   pasa por una previsualización editable. `.qa-go` es el botón de confirmar dentro del panel; el que lo
   abre desde la tarjeta es `.tact.go`, más discreto porque convive con las otras acciones. */
.qa-go { border: 1px solid #fff; background: #fff; color: #171717; font: inherit; font-size: 12.5px;
  font-weight: 600; padding: 7px 13px; border-radius: 9px; cursor: pointer }
.qa-go:hover:not(:disabled) { background: #d4d4d4 }
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

/* etapa del esfuerzo: evaluar → trabajar → crear las tareas */
.stg { font-size: 9.5px; font-weight: 700; letter-spacing: .3px; padding: 2px 7px; border-radius: 999px;
  border: 1px solid var(--line); color: var(--mut); text-transform: none; white-space: nowrap }
.s-work { color: #f6c667; border-color: #4a3a16; background: #241a08 }
.s-tasks { color: #d4d4d4; border-color: #404040; background: #181818 }
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
.n0 { background: repeating-linear-gradient(-45deg, #ffffff14 0 3px, transparent 3px 6px), var(--panel2) }
.n1 { background: #333 } .n2 { background: #525252 } .n3 { background: #737373 } .n4 { background: #d4d4d4 }
/* PULSO (fuente «código»): usa una segunda escala gris. No mide lo mismo que la bitácora,
   pero conservar una sola familia visual evita que el color compita con el contenido.
   `c0` es LISO, no rayado: es "el agente miró y no había nada", que es un dato; el rayado (`n0`) queda
   reservado para "no hubo registro". Esa distinción es la única que el pulso puede hacer y la bitácora no. */
.c0 { background: var(--panel2) }
.c1 { background: #292929 } .c2 { background: #474747 } .c3 { background: #696969 } .c4 { background: #a3a3a3 }
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
.jspan.sel { color: var(--acc); background: #242424;
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
.icon { width: 24px; height: 24px; border-radius: 6px; display: grid; place-items: center; font-size: 11px; flex: none; background: #242424 }
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
/* Pendientes: la marca a la izquierda y el texto al lado. Un ítem hecho se apaga y se tacha —el mismo
   gesto que las tarjetas terminadas—: sigue estando (dice qué se resolvió) pero ya no es trabajo. */
.pitem { display: flex; gap: 9px; align-items: baseline; padding: 3px 0; }
.pmark { font-size: 12px; color: var(--acc); line-height: 1.5; }
.pque { margin: 0; font-size: 13.5px; line-height: 1.5; }
.pitem.hecho { opacity: .45; }
.pitem.hecho .pmark { color: var(--mut); }
.pitem.hecho .pque { text-decoration: line-through; }
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

/* ── el CUERPO TÉCNICO en el cajón ───────────────────────────────────────────────────────────────
   Son documentos largos con tablas, citas y bloques de código: sin estilo propio `marked` los deja
   como un muro gris y el cajón deja de abrirse. Lo que se busca acá es ESCANEO, no lectura lineal.
   Va con `:deep()` porque el HTML lo inyecta `v-html` y el estilo del componente es `scoped`. */
.toc { display: flex; flex-wrap: wrap; gap: 4px; margin: 0 0 14px; padding: 10px; border-radius: 8px;
       background: var(--panel2); border: 1px solid var(--line); max-height: 132px; overflow: auto }
.toc-i { font: inherit; font-size: 11px; line-height: 1.3; padding: 3px 8px; border-radius: 999px; cursor: pointer;
         background: transparent; border: 1px solid var(--line); color: var(--txt); white-space: nowrap }
.toc-i:hover { background: var(--line) }
.toc-i.sub { opacity: .62; font-size: 10px }
.retoma-panel { margin: 0 0 14px; padding: 13px 14px; border: 1px solid #404040; border-radius: 8px;
  background: #181818; }
.retoma-label { color: var(--acc); font-size: 10.5px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; }
.retoma-estado { margin: 6px 0 8px; color: var(--txt); line-height: 1.55; }
.retoma-paso { margin: 0; color: var(--txt); line-height: 1.55; }
.retoma-contextos { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 11px; color: var(--mut); font-size: 12px; }
.ctx-link { border: 1px solid #404040; color: var(--acc); background: #111; border-radius: 999px; padding: 2px 7px; cursor: pointer; font: inherit; text-decoration: none; }
.ctx-link:hover { background: #242424; }
/* ⚠ el `pre-wrap` de `.desc` respeta los saltos del markdown crudo y deja el HTML lleno de huecos */
.desc.cuerpo-md { white-space: normal; line-height: 1.55 }
.cuerpo-md :deep(h2) { font-size: 15px; margin: 22px 0 8px; padding-top: 12px; border-top: 1px solid var(--line) }
.cuerpo-md :deep(h3) { font-size: 13px; margin: 16px 0 6px; opacity: .9 }
.cuerpo-md :deep(h2:first-child), .cuerpo-md :deep(h3:first-child) { margin-top: 0; padding-top: 0; border-top: 0 }
.cuerpo-md :deep(p) { margin: 0 0 10px }
.cuerpo-md :deep(ul), .cuerpo-md :deep(ol) { margin: 0 0 10px; padding-left: 20px }
.cuerpo-md :deep(li) { margin: 3px 0 }
.cuerpo-md :deep(code) { font-size: 11.5px; padding: 1px 4px; border-radius: 4px; background: var(--panel2) }
.cuerpo-md :deep(pre) { overflow-x: auto; padding: 10px 12px; border-radius: 8px; background: var(--panel2);
                        border: 1px solid var(--line); margin: 0 0 12px }
.cuerpo-md :deep(pre code) { padding: 0; background: none }
/* la cita es el marcador de MEDICIÓN / RIESGO / PREGUNTA: se resalta porque es lo que envejece */
.cuerpo-md :deep(blockquote) { margin: 0 0 12px; padding: 8px 12px; border-left: 3px solid var(--acc);
                               background: var(--panel2); border-radius: 0 8px 8px 0 }
.cuerpo-md :deep(blockquote p:last-child) { margin-bottom: 0 }
/* las tablas son la mitad del valor de estos cuerpos: scrollean solas antes que romper el cajón */
.cuerpo-md :deep(table) { border-collapse: collapse; margin: 0 0 12px; font-size: 11.5px; display: block;
                          overflow-x: auto; max-width: 100% }
.cuerpo-md :deep(th), .cuerpo-md :deep(td) { border: 1px solid var(--line); padding: 5px 9px; text-align: left; vertical-align: top }
.cuerpo-md :deep(th) { background: var(--panel2); font-weight: 600; white-space: nowrap }
.cuerpo-md :deep(hr) { border: 0; border-top: 1px solid var(--line); margin: 18px 0 }

/* una tarea LOCAL se distingue de una de Jira, pero no grita: es material de trabajo, no un problema */
.key.local { color: var(--mut); font-style: normal; letter-spacing: .02em }
.status.sin-jira { background: transparent; border: 1px dashed var(--line); color: var(--mut) }
/* la etapa suelta (tarjeta local): mismo chip que dentro del esfuerzo, sin el contenedor */
.stg.suelto { font-style: normal }

/* Estructura compacta del tablero y de las tarjetas. */
.section-toggle { display: flex; align-items: center; gap: 9px; width: 100%; border: 0; padding: 0;
  background: none; color: inherit; text-align: left; font: inherit; cursor: pointer }
.section-toggle > span:first-child { width: 12px; color: var(--mut); flex: none }
.card h2.journey-heading { margin-bottom: 0 }
#journey-content { padding-top: 16px }
.task-group-heading { margin: 22px 0 12px; padding-top: 18px; border-top: 1px solid var(--line);
  font-size: 13px; font-weight: 600 }
.group-count { margin-left: 3px; color: var(--mut); font: 11px ui-monospace, monospace }
.task-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; margin: 10px 0 8px }
.task-meta .spchip { margin-left: 0; max-width: 100% }
.task-meta:empty { display: none }
.next-step { margin: 10px 0 0; font-size: 12px; line-height: 1.5; color: var(--txt);
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden }
.next-step > span { display: block; color: var(--mut); font-size: 10px; margin-bottom: 3px }
.next-step.missing { color: var(--mut) }
.card-note { color: var(--mut); font-size: 10.5px }
.card-note.warn { color: var(--warn) }
.move-task { margin-left: auto }
.document-section { scroll-margin-top: 12px }
.document-section + .document-section { margin-top: 22px }
.retoma-contextos { margin-bottom: 16px }
.pending-document :deep(input[type=checkbox]) { accent-color: var(--acc); margin-right: 7px }
.jira-heading { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; font-size: 12px; flex-wrap: wrap }
.jira-preview { width: 100%; height: 65vh; min-height: 360px; border: 1px solid var(--line); border-radius: 8px; background: var(--panel) }
.document-history { margin-top: 20px; padding: 14px; border: 1px solid var(--line); border-radius: 8px; scroll-margin-top: 12px }
.document-history > summary { cursor: pointer; font-weight: 600; font-size: 13px }
.document-history > summary span { font-weight: 400; color: var(--mut); font-size: 11px }
.document-history[open] > summary { margin-bottom: 18px }
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
