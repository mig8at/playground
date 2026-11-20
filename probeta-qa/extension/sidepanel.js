// El panel lateral de Probeta-qa: las pruebas a mano del wizard en QA, sin el harness ni claves. Lo que se escribe queda en
// chrome.storage (una persona y un perfil por máquina). Hace sola: inventar la persona, dictarle las centrales al lambda de
// mocks de qa (`bureaus.js`), leer el OTP del servicio de OTP (con la VPN), rellenar, «Continuar aquí» y el recorrido. Con
// el SERVIDOR DE PROBETA (opcional, en ⚙) suma la base de la solicitud, la cédula libre y «Aprobar identidad».
// Cada prueba es una persona nueva: no se da de baja ni se borra a nadie.
import { dictateQa, lambdaAlive, LAMBDA_QA } from './bureaus.js';
import { latestOtp, otpAlive, server, serverHealth, inventPerson, DEFAULT_SERVER, OTP_SERVICE } from './services.js';

const $ = (id) => document.getElementById(id);
const PERSON = ['doc', 'firstName', 'lastName', 'phone', 'email', 'amount', 'issueDate'];
// La fecha de expedición por defecto: posterior a la mayoría de edad de cualquier fecha de nacimiento del wizard.
const ISSUE_DATE = '2010-08-20';
const PROFILE = ['occupation', 'income', 'months', 'score', 'negatives', 'consulted'];
const PRESETS = {
  approves: { occupation: 'Empleado', income: '2500000', months: '13', score: '700', negatives: '0', consulted: '1' },
  unemployed: { occupation: 'Sin empleo', income: '0', months: '0', score: '650', negatives: '0', consulted: '1' },
  lowScore: { occupation: 'Empleado', income: '2500000', months: '13', score: '420', negatives: '3', consulted: '6' },
};
let isQa = false;         // ¿la pestaña es el wizard de qa?
let tabId = null;
let lastUreq = null;
let serverUrl = '';       // el servidor de Probeta, o '' si no hay
let serverOk = false;     // ¿contestó la última vez?

// ── la pestaña ──────────────────────────────────────────────────────────────────────────────────────────────────
// El wizard de qa: `originaciones…-qa.dev.creditop.com`. dev y staging NO: su backend consulta otro lambda, sin dictado.
const qaOf = (url) => { try { const h = new URL(url).host; return /\.dev\.creditop\.com$/.test(h) && /originaciones/.test(h) && /-qa\./.test(h); } catch { return false; } };
const ureqOf = (url) => { try { const m = /\/(\d{5,9})(?=\/|$)/.exec(new URL(url).pathname); return m ? Number(m[1]) : null; } catch { return null; } };
// La entrada del flujo de la pestaña: `{origen}/{flujo}/{sucursal}` (autogestión o asesor).
let entryBase = null;
const entryOf = (url) => { try { const u = new URL(url); const m = /^\/([a-z-]+)\/([0-9a-f]{8})(?=\/|$)/.exec(u.pathname); return m ? `${u.origin}/${m[1]}/${m[2]}` : null; } catch { return null; } };
// EN CURSO: la pestaña ya pasó de la pantalla del monto. Desde ahí la persona es la de esa solicitud y sus datos se bloquean.
const inProgress = (url) => { try { return /^\/[a-z-]+\/[0-9a-f]{8}\/(?!solicitar\/?$)[^/]/.test(new URL(url).pathname); } catch { return false; } };
function lockPerson(locked) {
  for (const k of PERSON) $(k).disabled = locked;
  $('newPerson').disabled = locked;
  $('lockNote').hidden = !locked;
}

// `#tab=<id>`: el panel atado a UNA pestaña (abierto como página, para probarlo) en vez de seguir a la activa.
const pinnedTab = Number(new URLSearchParams(location.hash.slice(1)).get('tab')) || null;
async function syncTab() {
  const [tab] = pinnedTab ? [await chrome.tabs.get(pinnedTab).catch(() => null)] : await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id ?? null;
  isQa = !!tab?.url && qaOf(tab.url);
  const env = $('env');
  env.textContent = isQa ? 'qa' : 'no es el wizard de qa';
  env.className = 'chip ' + (isQa ? 'ok' : '');
  $('fill').disabled = !isQa;
  entryBase = isQa ? entryOf(tab.url) : null;
  lockPerson(isQa && inProgress(tab?.url));
  const u = isQa ? ureqOf(tab.url) : null;
  if (u !== lastUreq) { lastUreq = u; lastStatus = null; $('reqLine').textContent = u ? String(u) : ''; refreshDb(); }
  renderStep(tab?.url);
  await trackScreen(tab?.url);
  renderFlow();
}

// ── EL PASO: un botón a todo el ancho que aparece según la pantalla y desaparece cuando se pasó.
//   · `…/<solicitud>/continue`: el asesor terminó y el cliente seguiría desde el link del WhatsApp. «Continuar aquí» lleva
//     la pestaña a `/self-service/<sucursal>/<solicitud>/confirmation`, como si lo hubiera abierto.
//   · `…/<solicitud>/identity-validation`: la selfie no se puede hacer desde un Chrome de escritorio. «Aprobar identidad»
//     la aprueba a mano por el SERVIDOR de Probeta (escribe en la base) y vuelve a `…/confirmation`. Sin servidor, dice qué
//     falta. No se usa el botón del admin: manda un WhatsApp real al celular del cliente, y acá los celulares se inventan.
function stepOf(url) {
  try {
    const u = new URL(url || '');
    let m = /^\/(?:merchant|self-service)\/([0-9a-f]{8})\/(\d{5,9})\/continue/.exec(u.pathname);
    if (m) return { kind: 'handoff', label: 'Continuar aquí', url: `${u.origin}/self-service/${m[1]}/${m[2]}/confirmation` };
    m = /^(\/[^/]+\/[0-9a-f]{8}\/\d{5,9})\/(identity-validation|validar-persona)/.exec(u.pathname);
    if (m) return { kind: 'identity', label: 'Aprobar identidad', url: `${u.origin}${m[1]}/confirmation` };
  } catch { /* sin URL */ }
  return null;
}
let step = null;
function renderStep(url) {
  step = isQa ? stepOf(url) : null;
  $('step').hidden = !step;
  if (!step) return;
  $('stepBtn').textContent = step.label;
  const blocked = step.kind === 'identity' && !serverOk;
  $('stepBtn').disabled = blocked;
  $('stepNote').hidden = !blocked;
  $('stepNote').textContent = blocked ? 'Necesita el servidor de Probeta (⚙): aprobarla es escribir en la base.' : '';
}
$('stepBtn').onclick = async () => {
  if (!step) return;
  const btn = $('stepBtn'), current = step;
  btn.disabled = true;
  try {
    if (current.kind === 'identity') {
      const r = await server(serverUrl, '/identity', { ureq: lastUreq, phone: digits($('phone').value) });
      if (!r.ok) return say(`No se aprobó: ${r.detail || r.error}`, 'bad');
    }
    say('');
    await chrome.tabs.update(tabId, { url: current.url });
  } catch (e) { say(`No se pudo: ${e.message}`, 'bad'); }
  finally { btn.disabled = false; }
};

// ── lo guardado ─────────────────────────────────────────────────────────────────────────────────────────────────
async function load() {
  const s = await chrome.storage.local.get(['person', 'profile', 'preset', 'serverUrl']);
  const p = s.person || {};
  for (const k of PERSON) $(k).value = p[k] || (k === 'amount' ? '5000000' : k === 'issueDate' ? ISSUE_DATE : '');
  if (!p.doc) Object.entries(inventPerson()).forEach(([k, v]) => { $(k).value = v; });
  applyPreset(s.preset || 'approves', s.profile);
  serverUrl = s.serverUrl ?? DEFAULT_SERVER;
  $('serverUrl').value = serverUrl;
}
const save = () => chrome.storage.local.set({
  person: Object.fromEntries(PERSON.map((k) => [k, $(k).value.trim()])),
  profile: Object.fromEntries(PROFILE.map((k) => [k, $(k).value.trim()])),
  preset: document.querySelector('#presets .on')?.dataset.p || '',
});
function applyPreset(name, values) {
  const v = values || PRESETS[name] || PRESETS.approves;
  for (const k of PROFILE) $(k).value = v[k] ?? PRESETS.approves[k];
  document.querySelectorAll('#presets button').forEach((b) => b.classList.toggle('on', b.dataset.p === name));
}
const say = (text, kind = '') => { const l = $('log'); l.textContent = text; l.className = 'log ' + kind; };
const digits = (s) => String(s || '').replace(/\D/g, '');

// ¿La cédula ya tiene cliente? Sólo con el servidor; sin él no se dice nada.
async function refreshState() {
  const st = $('state');
  st.hidden = true;
  const doc = digits($('doc').value);
  if (!serverOk || doc.length < 6 || $('doc').disabled) return;
  try {
    const s = await server(serverUrl, `/person?doc=${doc}&phone=${digits($('phone').value)}`);
    if (s.free !== false) return;
    st.hidden = false;
    st.textContent = s.detail || 'Esa cédula o ese celular ya tienen cliente activo en qa.';
    st.className = 'state warn';
  } catch { /* sin servidor: no se dice nada */ }
}

async function dictate() {
  const doc = digits($('doc').value);
  const name = `${$('firstName').value.trim()} ${$('lastName').value.trim()}`.trim().toUpperCase();
  const n = (id) => { const v = digits($(id).value); return v === '' ? undefined : Number(v); };
  const r = await dictateQa(doc, { name, occupation: $('occupation').value, income: n('income'), months: n('months'),
    score: n('score'), negatives: n('negatives'), delinquencies: n('negatives'), consulted: n('consulted') });
  return { ok: r.ok, text: r.ok ? 'centrales dictadas' : r.lines.filter((l) => l.includes('✗')).join(' · ') };
}

// ── los botones ─────────────────────────────────────────────────────────────────────────────────────────────────
// Una persona nueva. Con el servidor, se prueba hasta que la cédula y el celular estén libres en qa.
async function freshPerson() {
  let p = inventPerson();
  for (let i = 0; serverOk && i < 6; i++) {
    const s = await server(serverUrl, `/person?doc=${p.doc}&phone=${p.phone}`).catch(() => null);
    if (!s || s.free !== false) break;
    p = inventPerson();
  }
  for (const [k, v] of Object.entries(p)) $(k).value = v;
  save(); refreshState(); $('otp').textContent = '—';
}
$('newPerson').onclick = async () => { await freshPerson(); say(''); };
// NUEVA SOLICITUD: persona nueva, centrales dictadas y la pestaña al inicio del flujo con el monto. No borra a nadie.
$('ready').onclick = async () => {
  if (!entryBase) { say('Abrí en esta pestaña el wizard de qa de una sucursal (autogestión o asesor).', 'bad'); return; }
  $('ready').disabled = true; say('Dictando las centrales…');
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
    say(r?.warnings?.length ? `⚠ ${r.warnings.join(' · ')}` : r?.filled?.length ? '' : 'Nada que rellenar acá.', r?.warnings?.length ? 'warn' : '');
  } catch { say('La página no contesta: recargala (la extensión se carga al abrirla).', 'warn'); }
};
document.querySelectorAll('#presets button').forEach((b) => b.onclick = () => { applyPreset(b.dataset.p); save(); });
for (const k of [...PERSON, ...PROFILE]) $(k).addEventListener('change', () => { save(); if (k === 'doc') refreshState(); });

// ── el OTP ──────────────────────────────────────────────────────────────────────────────────────────────────────
let otpError = '';
async function readOtp() {
  const phone = digits($('phone').value);
  if (!isQa || phone.length < 10) { $('otp').textContent = '—'; return; }
  try {
    const r = await latestOtp(phone);
    otpError = '';
    $('otp').textContent = r.code || '—';
    $('otp').title = r.code ? `servicio de OTP · ${r.at}` : 'todavía no se generó';
  } catch { otpError = 'sin VPN'; $('otp').textContent = '—'; $('otp').title = 'No se llega al servicio de OTP: ¿VPN de dev?'; }
}
$('otpRefresh').onclick = readOtp;
$('otpCopy').onclick = () => { const c = $('otp').textContent; if (/\d/.test(c)) navigator.clipboard.writeText(c); };

// ── EL RECORRIDO: bolitas que se llenan con las pantallas por las que pasa la pestaña. Los pasos FIJOS salen siempre; los
// OPCIONALES sólo si se pasó por ahí. El último punto, «Autorizada (11)», lo dice la base (con el servidor) o la pantalla de
// crédito aprobado. Las horas viven en `chrome.storage.session` por pestaña.
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
let lastStatus = null;            // { status, statusName } de la solicitud, de la base (con el servidor)
let visits = {};
let current = null;
function screenOf(url) {
  try {
    const u = new URL(url);
    const segs = u.pathname.split('/').filter(Boolean);
    if (segs.length < 3 || !/^[0-9a-f]{8}$/.test(segs[1])) return null;
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
  current = isQa ? screenOf(url) : null;
  if (typeof current !== 'string') return;
  if (current === 'monto' && Object.keys(visits).some((k) => ORDER[k] > ORDER.otp)) visits = {};
  if (!visits[current]) {
    visits[current] = new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false });
    await chrome.storage.session.set({ [key]: visits });
  }
}
function renderFlow() {
  const box = $('flow');
  if (!isQa || !current) { box.innerHTML = ''; return; }
  const unknown = typeof current === 'object' ? current.unknown : null;
  const seen = Object.keys(visits).map((k) => ORDER[k]).filter((i) => i != null);
  const at = unknown ? Math.max(-1, ...seen) + 0.5 : ORDER[current];
  const items = FLOW.filter(([k, , , optional]) => !optional || visits[k] || k === current)
    .map(([k, label]) => ({ k, label, pos: ORDER[k], time: visits[k] || '' }));
  if (unknown) items.push({ k: 'unknown', label: unknown.replace(/-/g, ' '), pos: at, time: '' });
  items.sort((a, b) => a.pos - b.pos);
  const st = Number(lastStatus?.status), name = String(lastStatus?.statusName || '');
  const authorized = st === 11 || (!lastStatus && current === 'approved');
  const failed = /cancel|rechaz|negad|desist|expir|anulad/i.test(name);
  for (const it of items) it.state = authorized || it.pos < at ? 'done' : it.pos === at ? 'cur' : 'pend';
  items.push({ k: 'end', label: failed ? name : 'Autorizada (11)', state: authorized ? 'done' : failed ? 'bad' : 'pend', time: '' });
  box.innerHTML = '';
  items.forEach((it, i) => {
    const row = document.createElement('div'); row.className = 'st';
    const rail = document.createElement('div'); rail.className = 'rail';
    rail.appendChild(Object.assign(document.createElement('span'), { className: `dot ${it.state}`, textContent: it.state === 'done' ? '✓' : it.state === 'bad' ? '✕' : '' }));
    if (i < items.length - 1) rail.appendChild(Object.assign(document.createElement('span'), { className: `line ${it.state === 'done' ? 'done' : ''}` }));
    const lbl = document.createElement('div'); lbl.className = `lbl ${it.state}`;
    const nm = document.createElement('span');
    if (it.state === 'cur') nm.append(Object.assign(document.createElement('b'), { textContent: it.label }), ' ', Object.assign(document.createElement('span'), { className: 'now', textContent: '· ahora' }));
    else nm.textContent = it.label;
    lbl.append(nm, Object.assign(document.createElement('time'), { textContent: it.time }));
    row.append(rail, lbl); box.appendChild(row);
  });
}

// ── LA CONSOLA DE LA BASE (sólo con el servidor): las tablas que toca la solicitud, una pestaña por tabla, en una tabla
// horizontal con las columnas que importan. Un objeto se abre entero debajo; un número de catálogo dice su nombre al pasar
// el mouse; lo cifrado de las centrales se descifra al tocarlo (si el servidor tiene con qué). Lo que cambió desde la
// lectura anterior queda resaltado unos segundos. Sólo lectura, cada 5 s.
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
const NOISE = /^(user_id|user_request_id|allied_id|allied_branch_id|uuid|deleted_at|new_id|is_test|mobile_created|manual_register|headers)$/;
let dbAllCols = false;
const SHORT = { user_request_records: 'ur_records', risk_central_user_data: 'centrales', user_request_risk_central_user_data: 'ur_centrales',
  user_summaries: 'summaries', user_field_values: 'field_values', creditop_x_user_requests_records: 'creditop_x', lender_transactions: 'lender_tx' };
const HOT_MS = 20000;
let db = { ureq: null, tables: [], at: '' }, dbTab = 'user_requests', dbPrev = new Map(), dbChanged = new Map(), dbBusy = false;
async function refreshDb() {
  if (!isQa || !lastUreq || !serverOk || dbBusy) { renderDb(); return; }
  dbBusy = true;
  try {
    const r = await server(serverUrl, `/tables?ureq=${lastUreq}`);
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
const jsonOf = (v) => { if (typeof v !== 'string' || !/^[\[{]/.test(v)) return undefined; try { return JSON.parse(v); } catch { return undefined; } };
let dbDetail = null;
const dbPlain = new Map();
const isCipher = (table, col) => table === 'risk_central_user_data' && col === 'data';
async function decryptRow(row) {
  const k = `${row.id}:${row.data}`;
  if (dbPlain.has(k)) return;
  dbPlain.set(k, { loading: true }); renderDb();
  try {
    const r = await server(serverUrl, `/decrypt?ureq=${lastUreq}&id=${row.id}`);
    dbPlain.set(k, r.ok ? { plain: r.plain ?? '' } : { error: r.detail || 'no se pudo' });
  } catch (e) { dbPlain.set(k, { error: e.message }); }
  renderDb();
}
function renderDb() {
  const tabs = $('dbTabs'), rows = $('dbRows'), foot = $('dbFoot');
  const show = !!lastUreq && isQa && serverOk;
  $('dbConsole').hidden = $('dbTitle').hidden = !show;
  if (!show) return;
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
        td.textContent = obj !== undefined ? (Array.isArray(obj) ? `[…] ${obj.length}` : `{…} ${Object.keys(obj || {}).length} claves`) : String(v);
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

// ── ⚙ CONFIGURACIÓN: qué necesita cada parte y si está. Cada fila dice qué habilita y, si falla, qué falta. ──────────
function checkRow(ok, title, what, why, level = ok ? 'ok' : 'bad', sub = []) {
  const li = document.createElement('li');
  li.append(Object.assign(document.createElement('span'), { className: `dot ${level}` }), Object.assign(document.createElement('b'), { textContent: title }),
    Object.assign(document.createElement('span'), { className: 'what', textContent: what }));
  if (why) li.append(Object.assign(document.createElement('span'), { className: `why ${level === 'ok' ? '' : level}`, textContent: why }));
  if (sub.length) {
    const ul = Object.assign(document.createElement('ul'), { className: 'sub' });
    for (const p of sub) ul.append(Object.assign(document.createElement('li'), { textContent: `${p.ok ? '✓' : '✗'} ${p.name}${p.detail ? ` · ${p.detail}` : ''}` }));
    li.append(ul);
  }
  return li;
}
async function runChecks() {
  const box = $('checks');
  box.innerHTML = '<li class="note">Probando…</li>';
  const [lambda, otp, srv] = await Promise.all([lambdaAlive(), otpAlive(), serverHealth(serverUrl)]);
  serverOk = srv.ok;
  box.innerHTML = '';
  box.append(
    checkRow(isQa, 'Wizard de qa en esta pestaña', 'Rellenar, «Nueva solicitud», «Continuar aquí» y el recorrido.',
      isQa ? '' : 'Abrí una sucursal en originaciones…-qa.dev.creditop.com.', isQa ? 'ok' : 'warn'),
    checkRow(lambda.ok, 'Mock de centrales de qa', `Dictar Ágil Data y Experian. ${LAMBDA_QA.replace(/^https:\/\//, '').split('/')[0]}`, lambda.ok ? '' : lambda.detail),
    checkRow(otp.ok, 'Servicio de OTP · VPN de dev', `Leer el OTP del celular. ${OTP_SERVICE.replace(/^http:\/\//, '')}`, otp.ok ? '' : `${otp.detail} Sin él, el OTP está en Slack #qa-messages.`),
    checkRow(srv.ok, 'Servidor de Probeta', 'La base de la solicitud, la cédula libre y «Aprobar identidad».',
      srv.ok ? '' : `${srv.detail}. Opcional: sin él, lo demás anda.`, srv.ok ? 'ok' : 'warn', srv.pieces),
  );
  syncTab(); refreshState();
}
function showConfig(on) {
  $('mainView').hidden = on; $('configView').hidden = !on;
  $('gear').classList.toggle('on', on);
  if (on) runChecks();
}
$('gear').onclick = () => showConfig($('configView').hidden);
$('back').onclick = () => showConfig(false);
$('recheck').onclick = runChecks;
$('serverUrl').addEventListener('change', async () => {
  serverUrl = $('serverUrl').value.trim().replace(/\/$/, '');
  await chrome.storage.local.set({ serverUrl });
  runChecks();
});

// ── lo que avisa la página ──────────────────────────────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (sender.tab?.id !== tabId) return false;
  if (msg?.type === 'docTyped' && digits(msg.doc) !== digits($('doc').value)) { $('doc').value = msg.doc; save(); refreshState(); }
  // Antes del «Siguiente» de datos personales: se vuelve a dictar (el lambda lo olvida en minutos) y se suelta el envío.
  if (msg?.type === 'beforeSubmit') {
    if (!isQa || digits($('doc').value).length < 6) { reply({ ok: false }); return false; }
    dictate().then((d) => { if (!d.ok) say(d.text, 'warn'); reply(d); }).catch((e) => { say(`No se volvió a dictar: ${e.message}`, 'warn'); reply({ ok: false }); });
    return true;
  }
  return false;
});

chrome.tabs.onActivated.addListener(syncTab);
chrome.tabs.onUpdated.addListener((id, info) => { if (id === tabId && info.url) syncTab(); });
// El servidor se vuelve a mirar cada 30 s: si se prende o se apaga, aparecen o se van sus partes.
setInterval(async () => { const h = await serverHealth(serverUrl); if (h.ok !== serverOk) { serverOk = h.ok; syncTab(); refreshState(); } }, 30000);
setInterval(() => { syncTab(); readOtp(); refreshDb(); }, 5000);
load().then(async () => { serverOk = (await serverHealth(serverUrl)).ok; }).then(syncTab).then(() => { refreshState(); readOtp(); });
