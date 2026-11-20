// El panel lateral de Probeta (la extensión de pruebas a mano del wizard). Lo que se escribe queda en chrome.storage (una persona y un perfil por máquina);
// lo que cambia la base o el mock lo hace el panel del harness (`/api/ext/*` en localhost:5195), que sabe dictarle al
// lambda de cada ambiente. Cada prueba es una persona nueva: no se da de baja ni se borra a nadie. Sin credenciales acá.
const API = 'http://localhost:5195/api/ext';
const $ = (id) => document.getElementById(id);
const PERSON = ['doc', 'firstName', 'lastName', 'phone', 'email', 'amount', 'issueDate'];
// La fecha de expedición por defecto: la del harness (`syntheticDates` en `pkg/date-trio.ts`), posterior a la mayoría de edad.
const ISSUE_DATE = '2010-08-20';
const PROFILE = ['occupation', 'income', 'months', 'score', 'negatives', 'consulted'];
const PRESETS = {
  approves: { occupation: 'Empleado', income: '2500000', months: '13', score: '700', negatives: '0', consulted: '1', experian: 'ok' },
  unemployed: { occupation: 'Sin empleo', income: '0', months: '0', score: '650', negatives: '0', consulted: '1', experian: 'ok' },
  lowScore: { occupation: 'Empleado', income: '2500000', months: '13', score: '420', negatives: '3', consulted: '6', experian: 'ok' },
  noExperian: { occupation: 'Empleado', income: '2500000', months: '13', score: '700', negatives: '0', consulted: '1', experian: 'empty' },
};
let target = null;       // el ambiente de la pestaña activa (local, dev, qa, staging) o null si no es el wizard
let tabId = null;
let experian = 'ok';
let lastUreq = null;

// ── el ambiente, por el host de la pestaña ──────────────────────────────────────────────────────────────────────
function targetOf(url) {
  try {
    const h = new URL(url).host;
    if (/^(localhost|127\.0\.0\.1):5174$/.test(h)) return 'local';
    if (!/\.dev\.creditop\.com$/.test(h) || !/originaciones/.test(h)) return null;
    if (/-qa\./.test(h)) return 'qa';
    if (/-stg\.|staging/.test(h)) return 'staging';
    return 'dev';
  } catch { return null; }
}
const ureqOf = (url) => { try { const m = /\/(\d{5,9})(?=\/|$)/.exec(new URL(url).pathname); return m ? Number(m[1]) : null; } catch { return null; } };

// La entrada del flujo de la pestaña: `{origen}/{flujo}/{sucursal}` (autogestión o asesor), como arranca el caminador.
let entryBase = null;
const entryOf = (url) => { try { const u = new URL(url); const m = /^\/([a-z-]+)\/([0-9a-f]{8})(?=\/|$)/.exec(u.pathname); return m ? `${u.origin}/${m[1]}/${m[2]}` : null; } catch { return null; } };
// EN CURSO: la pestaña ya pasó de la pantalla del monto (`…/solicitar`). Desde ahí la persona es la de esa solicitud: sus
// datos se bloquean, para no rellenar ni leer el OTP de otra. El perfil de las centrales sigue editable: se vuelve a dictar
// antes de enviar los datos personales. Para otra persona, «Nueva solicitud».
const inProgress = (url) => { try { return /^\/[a-z-]+\/[0-9a-f]{8}\/(?!solicitar\/?$)[^/]/.test(new URL(url).pathname); } catch { return false; } };
function lockPerson(locked) {
  for (const k of PERSON) $(k).disabled = locked;
  $('newPerson').disabled = locked || !target;
  $('lockNote').hidden = !locked;
}

// `#tab=<id>`: el panel atado a UNA pestaña (abierto como página, o para probarlo) en vez de seguir a la activa.
const pinnedTab = Number(new URLSearchParams(location.hash.slice(1)).get('tab')) || null;
async function syncTab() {
  const [tab] = pinnedTab ? [await chrome.tabs.get(pinnedTab).catch(() => null)] : await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id ?? null;
  target = tab?.url ? targetOf(tab.url) : null;
  const env = $('env');
  env.textContent = target ?? 'no es el wizard';
  env.className = 'chip ' + (target === 'qa' || target === 'local' ? 'ok' : target ? 'warn' : '');
  const note = $('envNote');
  note.hidden = !(target === 'dev' || target === 'staging');
  note.className = 'note warn';
  note.textContent = `En ${target} las centrales no se dictan (F-149).`;
  for (const b of ['ready', 'fill']) $(b).disabled = !target;
  entryBase = tab?.url ? entryOf(tab.url) : null;
  lockPerson(!!target && inProgress(tab?.url));
  const u = tab?.url ? ureqOf(tab.url) : null;
  if (u !== lastUreq) { lastUreq = u; lastStatus = null; $('reqLine').textContent = u ? String(u) : ''; refreshDb(); }
  renderStep(tab?.url);
  await trackScreen(tab?.url);
  renderFlow();
}

// ── EL PASO: un solo botón a todo el ancho, debajo de «Nueva solicitud» y «Rellenar», que aparece según la pantalla de
// la pestaña y desaparece cuando se pasó. Cada paso es una pantalla que en las pruebas no se puede resolver como la persona:
//   · `…/<solicitud>/continue` («Solicitud en validación de usuario»): el asesor terminó y el cliente seguiría desde el link
//     del WhatsApp, que no le llega a nadie. «Continuar aquí» lleva la pestaña a `/self-service/<sucursal>/<solicitud>/
//     confirmation`, como si lo hubiera abierto (lo mismo que el harness en el traspaso).
//   · `…/<solicitud>/identity-validation` («Estamos validando tus datos»): la selfie de ADO no se puede hacer desde un
//     Chrome de escritorio. «Aprobar identidad» la aprueba a mano como el admin (`/api/ext/identity` → `dbops
//     identity-approve`, lo mismo que el panel con sus celulares) y vuelve a `…/confirmation`, que ya la saltea.
function stepOf(url) {
  try {
    const u = new URL(url || '');
    let m = /^\/(?:merchant|self-service)\/([0-9a-f]{8})\/(\d{5,9})\/continue/.exec(u.pathname);
    if (m) return { kind: 'handoff', label: 'Continuar aquí', note: 'Como el cliente, con el link que le llegaría por WhatsApp.',
      url: `${u.origin}/self-service/${m[1]}/${m[2]}/confirmation` };
    m = /^(\/[^/]+\/[0-9a-f]{8}\/\d{5,9})\/(identity-validation|validar-persona)/.exec(u.pathname);
    if (m) return { kind: 'identity', label: 'Aprobar identidad', note: 'A mano, como el admin: la selfie no se puede hacer desde acá. No prueba la validación real.',
      url: `${u.origin}${m[1]}/confirmation` };
  } catch { /* sin URL */ }
  return null;
}
let step = null;
function renderStep(url) {
  step = target ? stepOf(url) : null;
  $('step').hidden = !step;
  if (!step) return;
  $('stepBtn').textContent = step.label;
}
$('stepBtn').onclick = async () => {
  if (!step) return;
  const btn = $('stepBtn'), current = step;
  btn.disabled = true;
  try {
    if (current.kind === 'identity') {
      const r = await api('/identity', { ureq: lastUreq, phone: $('phone').value });
      if (!r.ok) return say(`No se aprobó: ${r.detail || r.error}`, 'bad');
      say('');
    } else {
      say('');
    }
    // En la MISMA pestaña; al cambiar la ruta el botón desaparece solo.
    await chrome.tabs.update(tabId, { url: current.url });
  } catch (e) { say(`No se pudo: ${e.message}`, 'bad'); }
  finally { btn.disabled = false; }
};

// ── lo guardado ─────────────────────────────────────────────────────────────────────────────────────────────────
async function load() {
  const s = await chrome.storage.local.get(['person', 'profile', 'preset']);
  const p = s.person || {};
  for (const k of PERSON) $(k).value = p[k] || (k === 'amount' ? '5000000' : k === 'issueDate' ? ISSUE_DATE : '');
  applyPreset(s.preset || 'approves', s.profile);
}
const save = () => chrome.storage.local.set({
  person: Object.fromEntries(PERSON.map((k) => [k, $(k).value.trim()])),
  profile: Object.fromEntries(PROFILE.map((k) => [k, $(k).value.trim()])),
  preset: document.querySelector('#presets .on')?.dataset.p || '',
});
function applyPreset(name, values) {
  const v = values || PRESETS[name] || PRESETS.approves;
  for (const k of PROFILE) $(k).value = v[k] ?? PRESETS.approves[k];
  experian = (PRESETS[name] || {}).experian || 'ok';
  document.querySelectorAll('#presets button').forEach((b) => b.classList.toggle('on', b.dataset.p === name));
}

// ── el servidor del panel ───────────────────────────────────────────────────────────────────────────────────────
async function api(path, body) {
  const sep = path.includes('?') ? '&' : '?';
  const r = await fetch(`${API}${path}${sep}target=${encodeURIComponent(target)}`, body
    ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  const j = await r.json().catch(() => ({}));
  if (!r.ok && !j.detail && !j.detalle) throw new Error(j.error || `el panel contestó ${r.status}`);
  return j;
}
const say = (text, kind = '') => { const l = $('log'); l.textContent = text; l.className = 'log ' + kind; };
const digits = (s) => String(s || '').replace(/\D/g, '');

async function refreshState() {
  const doc = digits($('doc').value);
  const st = $('state');
  st.hidden = true;
  if (!target || doc.length < 6 || $('doc').disabled) return;
  try {
    const s = await api(`/state?doc=${doc}`);
    if (!s.active) return;
    st.hidden = false;
    const last = s.requests?.[0];
    st.textContent = `Ya tiene cliente: ${s.active.name}${last ? ` · última ${last.id}` : ''}`;
    st.className = 'state warn';
  } catch { /* sin red: no se dice nada */ }
}

const profileBody = () => ({
  doc: digits($('doc').value), firstName: $('firstName').value.trim().toUpperCase(), lastName: $('lastName').value.trim().toUpperCase(),
  occupation: $('occupation').value, income: Number(digits($('income').value)), months: Number(digits($('months').value)),
  score: Number(digits($('score').value)), negatives: Number(digits($('negatives').value)), consulted: Number(digits($('consulted').value)),
  delinquencies: Number(digits($('negatives').value)), experian,
});
async function dictate() {
  const r = await api('/dictate', profileBody());
  return { ok: !!r.ok, text: r.ok ? 'centrales dictadas' : (r.detalle || 'no se dictó') };
}

// ── los botones ─────────────────────────────────────────────────────────────────────────────────────────────────
async function freshPerson() {
  const p = await api('/person');
  $('doc').value = p.doc; $('phone').value = p.phone; $('firstName').value = p.firstName; $('lastName').value = p.lastName; $('email').value = p.email;
  save(); refreshState(); $('otp').textContent = '—';
}
$('newPerson').onclick = async () => {
  try { await freshPerson(); say(''); }
  catch (e) { say(`No pude armar otra persona: ${e.message}`, 'bad'); }
};
// NUEVA SOLICITUD: persona nueva (cédula, celular y correo sin cliente activo), centrales dictadas y la pestaña al inicio del
// flujo con el monto. No da de baja ni borra a nadie: el cliente y la solicitud anteriores quedan en la base.
$('ready').onclick = async () => {
  if (!entryBase) { say('Abrí el wizard de una sucursal en esta pestaña (autogestión o asesor).', 'bad'); return; }
  $('ready').disabled = true; say('…');
  try {
    await freshPerson();
    const d = await dictate();
    const amount = digits($('amount').value) || '5000000';
    lockPerson(false);
    await chrome.tabs.update(tabId, { url: `${entryBase}/solicitar?amount=${amount}` });
    say(d.ok ? '' : d.text, d.ok ? '' : 'warn');
  } catch (e) { say(`No se armó la solicitud nueva: ${e.message}`, 'bad'); }
  $('ready').disabled = false;
};
$('fill').onclick = async () => {
  if (tabId == null) return;
  const data = Object.fromEntries(PERSON.map((k) => [k, $(k).value.trim()]));
  data.amount = digits(data.amount); data.phone = digits(data.phone); data.doc = digits(data.doc);
  data.firstName = data.firstName.toUpperCase(); data.lastName = data.lastName.toUpperCase();
  await readOtp();   // el de ESTE momento: el de la firma se genera después del del ingreso
  data.otp = digits($('otp').textContent);
  try {
    const r = await chrome.tabs.sendMessage(tabId, { type: 'fill', data });
    const warn = r?.warnings?.length ? ` ⚠ ${r.warnings.join(' · ')}` : '';
    say(r?.warnings?.length ? warn.trim() : r?.filled?.length ? '' : 'Nada que rellenar acá.', r?.warnings?.length ? 'warn' : '');
  } catch { say('La página no contesta: recargala (la extensión se carga al abrirla).', 'warn'); }
};
document.querySelectorAll('#presets button').forEach((b) => b.onclick = () => { applyPreset(b.dataset.p); save(); });
for (const k of [...PERSON, ...PROFILE]) $(k).addEventListener('change', () => { save(); if (k === 'doc') refreshState(); });

// ── el OTP ──────────────────────────────────────────────────────────────────────────────────────────────────────
async function readOtp() {
  const phone = digits($('phone').value);
  if (!target || phone.length < 10) { $('otp').textContent = '—'; return; }
  try { const r = await api(`/otp?phone=${phone}`); $('otp').textContent = r.code || '—'; $('otp').title = r.code ? `${r.source}${r.at ? ` · ${r.at}` : ''}` : 'todavía no se generó'; }
  catch { $('otp').textContent = '—'; }
}
$('otpRefresh').onclick = readOtp;
$('otpCopy').onclick = () => { const c = $('otp').textContent; if (/\d/.test(c)) navigator.clipboard.writeText(c); };

// ── EL RECORRIDO: una línea de tiempo de bolitas que se llenan con las pantallas por las que pasa la pestaña. ─────
// Los pasos FIJOS salen siempre, en el orden del wizard; los OPCIONALES (los que dependen del comercio o la entidad) sólo si
// la pestaña pasó por ahí. Lo anterior a la pantalla actual se da por hecho aunque no se haya visto (el panel se abrió a
// mitad), con la hora sólo si se vio. El último punto, «Autorizada (11)», lo dice la BASE (el estado de la solicitud), y un
// estado de cancelación o rechazo lo pinta en rojo. Las horas viven en `chrome.storage.session` por pestaña: se van al
// cerrar el navegador. Los nombres de las pantallas, los que maneja el caminador (`dev/walk-wizard.ts`).
const FLOW = [
  ['monto', 'Monto', (s, q) => s === 'solicitar' && !/phone/i.test(q.get('step') || '')],
  ['phone', 'Celular', (s, q) => s === 'solicitar' && /phone/i.test(q.get('step') || '')],
  ['otp', 'Código (OTP)', (s) => s === 'otp'],
  ['personal', 'Datos personales', (s) => /^(personal-info|save-personal-info)$/.test(s)],
  ['kyc', 'Validando datos', (s) => /^(kyc-processing|validating|validando)$/.test(s), true],
  ['employment', 'Empleo', (s) => s === 'employment-info'],
  ['abaco', 'Ingresos (Ábaco)', (s) => s === 'abaco', true],
  ['additional', 'Formulario adicional', (s) => /^(dynamic-form|additional-info)$/.test(s), true],
  ['lenders', 'Entidades', (s) => s === 'lenders'],
  ['handoff', 'Traspaso al cliente', (s) => s === 'continue', true],
  ['confirmation', 'Confirmación', (s) => s === 'confirmation'],
  ['identity', 'Identidad', (s) => /^(identity-validation|validar-persona)/.test(s)],
  ['downPayment', 'Cuota inicial', (s) => s === 'down-payment', true],
  ['paymentDate', 'Fecha de pago', (s) => /^(first-payment-date|payment-schedule)$/.test(s)],
  ['documents', 'Documentos', (s) => s === 'sign-documents', true],
  ['signature', 'Firma', (s) => /^(otp-validation|waiting-signature)$/.test(s)],
  ['approved', 'Aprobado', (s) => /^(loan-approved|approved)$/.test(s), true],
];
const ORDER = Object.fromEntries(FLOW.map(([k], i) => [k, i]));
let lastStatus = null;            // { status, statusName } de la solicitud, del último dictamen
let visits = {};                  // { clave: 'HH:MM' } de esta pestaña
let current = null;               // la clave de la pantalla actual, o `{ unknown: segmento }`
function screenOf(url) {
  try {
    const u = new URL(url);
    const segs = u.pathname.split('/').filter(Boolean);
    if (segs.length < 3 || !/^[0-9a-f]{8}$/.test(segs[1])) return null;
    // `/flujo/sucursal/solicitar` o `/flujo/sucursal/<solicitud o celular>/<pantalla>/…`
    const s = /^\d+$/.test(segs[2]) ? (segs[3] || '') : segs[2];
    if (!s) return null;
    const hit = FLOW.find(([, , m]) => m(s, u.searchParams));
    return hit ? hit[0] : { unknown: s };
  } catch { return null; }
}
async function trackScreen(url) {
  if (tabId == null) return;
  const key = `flow:${tabId}`;
  visits = (await chrome.storage.session.get(key))[key] || {};
  current = target ? screenOf(url) : null;
  if (typeof current !== 'string') return;
  // Volver al monto después de haber pasado del código es OTRA solicitud: se empieza de cero.
  if (current === 'monto' && Object.keys(visits).some((k) => ORDER[k] > ORDER.otp)) visits = {};
  if (!visits[current]) {
    visits[current] = new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false });
    await chrome.storage.session.set({ [key]: visits });
  }
}
function renderFlow() {
  const box = $('flow');
  if (!target || !current) { box.innerHTML = ''; return; }
  const unknown = typeof current === 'object' ? current.unknown : null;
  // El punto de la pantalla actual en el orden: una desconocida va justo después de lo último que se vio.
  const seen = Object.keys(visits).map((k) => ORDER[k]).filter((i) => i != null);
  const at = unknown ? Math.max(-1, ...seen) + 0.5 : ORDER[current];
  const items = FLOW.filter(([k, , , optional]) => !optional || visits[k] || k === current)
    .map(([k, label]) => ({ k, label, pos: ORDER[k], time: visits[k] || '' }));
  if (unknown) items.push({ k: 'unknown', label: unknown.replace(/-/g, ' '), pos: at, time: '' });
  items.sort((a, b) => a.pos - b.pos);
  const st = Number(lastStatus?.status), name = String(lastStatus?.statusName || '');
  const authorized = st === 11, failed = /cancel|rechaz|negad|desist|expir|anulad/i.test(name);
  for (const it of items) it.state = authorized || it.pos < at ? 'done' : it.pos === at ? 'cur' : 'pend';
  items.push({ k: 'end', label: failed ? name : 'Autorizada (11)', state: authorized ? 'done' : failed ? 'bad' : 'pend', time: '' });
  box.innerHTML = '';
  items.forEach((it, i) => {
    const row = document.createElement('div'); row.className = 'st';
    const rail = document.createElement('div'); rail.className = 'rail';
    rail.appendChild(Object.assign(document.createElement('span'), { className: `dot ${it.state}`, textContent: it.state === 'done' ? '✓' : it.state === 'bad' ? '✕' : '' }));
    if (i < items.length - 1) rail.appendChild(Object.assign(document.createElement('span'), { className: `line ${it.state === 'done' ? 'done' : ''}` }));
    const lbl = document.createElement('div'); lbl.className = `lbl ${it.state}`;
    const name = document.createElement('span');
    if (it.state === 'cur') { name.append(Object.assign(document.createElement('b'), { textContent: it.label }), ' ', Object.assign(document.createElement('span'), { className: 'now', textContent: '· ahora' })); }
    else name.textContent = it.label;
    lbl.append(name, Object.assign(document.createElement('time'), { textContent: it.time }));
    row.append(rail, lbl); box.appendChild(row);
  });
}

// ── LA CONSOLA: las tablas que toca la solicitud, una pestaña por tabla, con sus filas (las de esta solicitud y su cliente,
// no «lo último que se escribió»: la base de qa es compartida), en una tabla horizontal: primero las columnas que importan
// de esa tabla, después las demás. Un objeto JSON o un texto largo se toca y se abre entero, formateado, debajo. Lo que cambió desde la lectura anterior queda resaltado unos segundos. Sólo
// lectura (`/api/ext/tables` → `dbops request-tables`), cada 5 s y sólo con una solicitud en la pestaña.
// LAS COLUMNAS QUE APORTAN, por tabla y en este orden. Afuera lo repetido (el usuario o la solicitud en tablas que ya son
// de ella), lo cifrado (`data` de las centrales) y lo interno. «Todas las columnas», abajo, muestra el resto.
const SHOW = {
  user_requests: ['id', 'user_request_status_id', 'lender_id', 'amount', 'final_amount', 'initial_fee', 'fee_number', 'fee_value', 'rate',
    'selected_payment_date', 'disbursed_at', 'self_management', 'updated_at'],
  users: ['id', 'first_name', 'surname', 'document_type', 'document_number', 'expedition_date', 'date_of_birth', 'cell_phone', 'email',
    'onboarding_channel', 'validated', 'manual_validation', 'status', 'updated_at'],
  user_request_records: ['user_request_status_id', 'comment', 'update_by', 'created_at'],
  risk_central_user_data: ['id', 'risk_central_id', 'score', 'data', 'request', 'additional_info', 'created_at'],
  user_request_risk_central_user_data: ['id', 'risk_central_user_data_id', 'created_at'],
  user_summaries: ['agildata', 'mareigua', 'tusdatos', 'datacredito', 'quanto', 'abaco', 'updated_at'],
  user_field_values: ['field_id', 'form_id', 'value', 'file_name', 'created_at'],
  creditop_x_user_requests_records: ['creditop_x_user_requests_process_statuses_id', 'status', 'updated_at'],
  logs: ['method', 'description', 'request', 'response', 'created_at'],
};
// Para una tabla sin lista (p. ej. `lender_transactions`): todo menos esto.
const NOISE = /^(user_id|user_request_id|allied_id|allied_branch_id|uuid|deleted_at|new_id|is_test|mobile_created|manual_register|headers)$/;
let dbAllCols = false;
const SHORT = { user_request_records: 'ur_records', risk_central_user_data: 'centrales', user_request_risk_central_user_data: 'ur_centrales',
  user_summaries: 'summaries', user_field_values: 'field_values', creditop_x_user_requests_records: 'creditop_x', lender_transactions: 'lender_tx' };
const HOT_MS = 20000;
let db = { ureq: null, tables: [], at: '' }, dbTab = 'user_requests', dbPrev = new Map(), dbChanged = new Map(), dbBusy = false;
async function refreshDb() {
  if (!target || !lastUreq || dbBusy) { renderDb(); return; }
  dbBusy = true;
  try {
    const r = await api(`/tables?ureq=${lastUreq}`);
    if (db.ureq !== lastUreq) { dbPrev = new Map(); dbChanged = new Map(); dbDetail = null; }
    const now = Date.now(), first = dbPrev.size === 0;
    for (const t of r.tables || []) for (const row of t.rows) {
      const key = `${t.table}:${row.id}`, before = dbPrev.get(key);
      if (!first && !before) dbChanged.set(key, { at: now, cols: new Set(Object.keys(row)), isNew: true });
      else if (before) {
        const cols = Object.keys(row).filter((c) => before[c] !== row[c]);
        if (cols.length) dbChanged.set(key, { at: now, cols: new Set(cols), isNew: false });
      }
      dbPrev.set(key, row);
    }
    db = { ureq: lastUreq, tables: r.tables || [], labels: r.labels || {}, at: new Date().toLocaleTimeString('es-CO', { hour12: false }) };
    // El estado y la entidad de la solicitud salen de aquí mismo (antes, de un dictamen aparte): el final del recorrido y
    // la línea de arriba.
    const ur = db.tables.find((x) => x.table === 'user_requests')?.rows?.[0];
    if (ur) {
      lastStatus = { status: ur.user_request_status_id, statusName: db.labels.user_request_status_id?.[String(ur.user_request_status_id)] || '' };
      const lender = db.labels.lender_id?.[String(ur.lender_id)];
      $('reqLine').textContent = `${lastUreq}${lender ? ` · ${lender}` : ''}`;
      renderFlow();
    }
  } catch (e) { db = { ...db, error: e.message }; }
  dbBusy = false;
  renderDb();
}
/** ¿Es un objeto o una lista en JSON? Devuelve el valor ya parseado, o `undefined`. */
const jsonOf = (v) => { if (typeof v !== 'string' || !/^[\[{]/.test(v)) return undefined; try { return JSON.parse(v); } catch { return undefined; } };
let dbDetail = null;   // { key, col }: la celda abierta abajo de la tabla
// LO CIFRADO: `risk_central_user_data.data` (la respuesta de la central) va cifrado con el APP_KEY del backend. La celda dice
// «🔒 cifrado» y, al tocarla, el panel la descifra (`/api/ext/decrypt`, sólo clientes de prueba) y se abre debajo. Una vez
// por fila: queda guardado mientras no cambie.
const dbPlain = new Map();   // `${id}:${valor cifrado}` → { plain } | { error } | { loading: true }
const isCipher = (table, col) => table === 'risk_central_user_data' && col === 'data';
async function decryptRow(row) {
  const k = `${row.id}:${row.data}`;
  if (dbPlain.has(k)) return;
  dbPlain.set(k, { loading: true }); renderDb();
  try {
    const r = await api(`/decrypt?ureq=${lastUreq}&id=${row.id}`);
    dbPlain.set(k, r.ok ? { plain: r.plain ?? '' } : { error: r.detail || 'no se pudo' });
  } catch (e) { dbPlain.set(k, { error: e.message }); }
  renderDb();
}
function renderDb() {
  const tabs = $('dbTabs'), rows = $('dbRows'), foot = $('dbFoot');
  $('dbConsole').hidden = $('dbTitle').hidden = !lastUreq || !target;
  if (!lastUreq || !target) return;
  if (db.ureq !== lastUreq) { tabs.innerHTML = ''; rows.innerHTML = '<div class="empty">Leyendo…</div>'; foot.textContent = ''; return; }
  const now = Date.now(), hot = (key) => { const c = dbChanged.get(key); return c && now - c.at < HOT_MS ? c : null; };
  tabs.innerHTML = '';
  for (const t of db.tables) {
    const b = Object.assign(document.createElement('button'), { className: `tab${t.table === dbTab ? ' on' : ''}`, title: t.error || t.table });
    const recent = t.rows.some((row) => hot(`${t.table}:${row.id}`));
    b.append(SHORT[t.table] || t.table, Object.assign(document.createElement('span'), { className: `n${t.rows.length ? ' has' : ''}`, textContent: t.error ? '!' : t.rows.length }));
    if (recent) b.append(Object.assign(document.createElement('span'), { className: 'hot', textContent: ' ●' }));
    b.onclick = () => { dbTab = t.table; dbDetail = null; renderDb(); };
    tabs.appendChild(b);
  }
  const t = db.tables.find((x) => x.table === dbTab) || db.tables[0];
  let hidden = 0;
  const keep = rows.querySelector('.grid')?.scrollLeft || 0, keepPre = rows.querySelector('.detail pre')?.scrollTop || 0;
  rows.innerHTML = '';
  if (!t || !t.rows.length) rows.innerHTML = `<div class="empty">${t?.error ? `No se pudo leer: ${t.error}` : 'Sin filas para esta solicitud todavía.'}</div>`;
  else {
    // LAS COLUMNAS: primero las que importan de esa tabla, después las demás; afuera las que están vacías en todas las filas.
    const all = [...new Set(t.rows.flatMap((r) => Object.keys(r)))];
    const filled = all.filter((c) => t.rows.some((r) => r[c] != null && r[c] !== ''));
    const curated = SHOW[t.table] ? SHOW[t.table].filter((c) => filled.includes(c)) : filled.filter((c) => !NOISE.test(c));
    const cols = dbAllCols ? [...curated, ...filled.filter((c) => !curated.includes(c))] : curated;
    hidden = filled.length - curated.length;
    const wrap = Object.assign(document.createElement('div'), { className: 'grid' });
    const table = document.createElement('table');
    const head = table.createTHead().insertRow();
    for (const c of cols) head.appendChild(Object.assign(document.createElement('th'), { textContent: c }));
    const body = table.createTBody();
    for (const row of t.rows) {
      const key = `${t.table}:${row.id}`, chg = hot(key);
      const tr = body.insertRow();
      if (chg?.isNew) tr.className = 'new';
      for (const c of cols) {
        const v = row[c], obj = jsonOf(v);
        const td = tr.insertCell();
        if (chg && !chg.isNew && chg.cols.has(c)) td.classList.add('chg');
        if (v == null) { td.textContent = 'NULL'; td.classList.add('null'); continue; }
        // Un objeto se resume en la celda («{…} 12 claves») y se abre formateado abajo; un texto largo, igual.
        // Un número de catálogo (estado, entidad, central…): se ve el número y, al pasar el mouse, la misma celda dice su
        // NOMBRE en su lugar (sin tooltip). Las dos van en la celda; el CSS muestra una u otra.
        const label = (c !== 'status_id' || t.table === 'lender_transactions') ? db.labels?.[c]?.[String(v)] : undefined;
        if (label) {
          td.classList.add('enum');
          td.append(Object.assign(document.createElement('span'), { className: 'num', textContent: String(v) }),
            Object.assign(document.createElement('span'), { className: 'name', textContent: label }));
          continue;
        }
        if (isCipher(t.table, c)) {
          td.textContent = '🔒 cifrado';
          td.classList.add('open', 'cipher');
          if (dbDetail?.key === key && dbDetail.col === c) td.classList.add('sel');
          td.onclick = () => { const same = dbDetail?.key === key && dbDetail.col === c; dbDetail = same ? null : { key, col: c }; if (!same) decryptRow(row); renderDb(); };
          continue;
        }
        const text = obj !== undefined ? (Array.isArray(obj) ? `[…] ${obj.length}` : `{…} ${Object.keys(obj || {}).length} claves`) : String(v);
        td.textContent = text;
        td.title = obj !== undefined ? 'Ver el objeto' : String(v);
        if (obj !== undefined || String(v).length > 40) {
          td.classList.add('open');
          if (dbDetail?.key === key && dbDetail.col === c) td.classList.add('sel');
          td.onclick = () => { dbDetail = dbDetail?.key === key && dbDetail.col === c ? null : { key, col: c }; renderDb(); };
        }
      }
    }
    wrap.appendChild(table); rows.appendChild(wrap);
    wrap.scrollLeft = keep;
    // EL DETALLE: la celda elegida, entera, con el JSON formateado.
    const row = dbDetail && t.rows.find((r) => `${t.table}:${r.id}` === dbDetail.key);
    if (row && dbDetail.col in row) {
      const cipher = isCipher(t.table, dbDetail.col), dec = cipher ? dbPlain.get(`${row.id}:${row[dbDetail.col]}`) : null;
      const v = cipher ? (dec?.loading ? 'Descifrando…' : dec?.error ? `No se pudo descifrar: ${dec.error}` : dec?.plain ?? '') : row[dbDetail.col];
      const obj = jsonOf(v);
      const det = Object.assign(document.createElement('div'), { className: 'detail' });
      const bar = Object.assign(document.createElement('div'), { className: 'bar' });
      const copy = Object.assign(document.createElement('button'), { textContent: 'Copiar' });
      copy.onclick = () => navigator.clipboard.writeText(obj !== undefined ? JSON.stringify(obj, null, 2) : String(v));
      const close = Object.assign(document.createElement('button'), { textContent: '✕' });
      close.onclick = () => { dbDetail = null; renderDb(); };
      bar.append(Object.assign(document.createElement('span'), { textContent: `${SHORT[t.table] || t.table} · id ${row.id} · ${dbDetail.col}${cipher ? ' · descifrado' : ''}` }), copy, close);
      det.append(bar, Object.assign(document.createElement('pre'), { textContent: obj !== undefined ? JSON.stringify(obj, null, 2) : String(v) }));
      rows.appendChild(det);
      det.querySelector('pre').scrollTop = keepPre;
    }
  }
  const recentCount = [...dbChanged.values()].filter((c) => now - c.at < HOT_MS).length;
  foot.innerHTML = '';
  const all = Object.assign(document.createElement('button'), { className: 'link', textContent: dbAllCols ? 'menos columnas' : `todas las columnas (+${hidden})`, hidden: !hidden && !dbAllCols });
  all.onclick = () => { dbAllCols = !dbAllCols; renderDb(); };
  foot.append(Object.assign(document.createElement('span'), { textContent: `${db.at}${db.error ? ' · ⚠ ' + db.error : ''}${recentCount ? ` · ● ${recentCount} cambio(s)` : ''}` }), all);
}

// ── lo que avisa la página ──────────────────────────────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (sender.tab?.id !== tabId) return false;
  if (msg?.type === 'docTyped' && digits(msg.doc) !== digits($('doc').value)) { $('doc').value = msg.doc; save(); refreshState(); }
  // Antes del «Siguiente» de datos personales: se vuelve a dictar (el lambda lo olvida en minutos) y se suelta el envío.
  if (msg?.type === 'beforeSubmit') {
    if (!target || digits($('doc').value).length < 6) { reply({ ok: false }); return false; }
    dictate().then((d) => { if (!d.ok) say(d.text, 'warn'); reply(d); }).catch((e) => { say(`No se volvió a dictar: ${e.message}`, 'warn'); reply({ ok: false }); });
    return true;
  }
  return false;
});

chrome.tabs.onActivated.addListener(syncTab);
chrome.tabs.onUpdated.addListener((id, info) => { if (id === tabId && info.url) syncTab(); });
setInterval(() => { syncTab(); readOtp(); refreshDb(); }, 5000);
load().then(syncTab).then(() => { refreshState(); readOtp(); });
