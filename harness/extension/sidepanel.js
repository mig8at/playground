// El panel lateral «Cliente de prueba». Lo que se escribe queda en chrome.storage (una persona y un perfil por máquina);
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
  note.hidden = !(target === 'dev' || target === 'staging' || !target);
  note.className = 'note warn';
  note.textContent = !target ? 'Abrí el wizard (qa, dev, staging o local) en esta pestaña.'
    : `En ${target} el backend consulta un lambda que no acepta dictado: las centrales contestan lo de por defecto (F-149). La solicitud nueva y el OTP sí funcionan.`;
  for (const b of ['ready', 'fill']) $(b).disabled = !target;
  entryBase = tab?.url ? entryOf(tab.url) : null;
  lockPerson(!!target && inProgress(tab?.url));
  const u = tab?.url ? ureqOf(tab.url) : null;
  if (u !== lastUreq) { lastUreq = u; lastStatus = null; renderRequest(); }
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
  $('stepNote').textContent = step.note;
}
$('stepBtn').onclick = async () => {
  if (!step) return;
  const btn = $('stepBtn'), current = step;
  btn.disabled = true;
  try {
    if (current.kind === 'identity') {
      const r = await api('/identity', { ureq: lastUreq, phone: $('phone').value });
      if (!r.ok) return say(`No se aprobó: ${r.detail || r.error}`, 'bad');
      say(`${r.detail}. Vuelvo a la confirmación.`, 'ok');
    } else {
      say(`Seguís como el cliente en la solicitud ${lastUreq}.`, 'ok');
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
  if (!target || doc.length < 6) { st.textContent = 'Escribí o generá una cédula.'; st.className = 'state'; return; }
  try {
    const s = await api(`/state?doc=${doc}`);
    if (!s.active) { st.textContent = 'Sin cliente activo: se registra de cero.'; st.className = 'state ok'; return; }
    const last = s.requests?.[0];
    st.textContent = `Ya existe: ${s.active.name}, ${s.requests?.length ?? 0} solicitud(es)${last ? `, la última ${last.id} en ${last.status}` : ''}.`
     ;
    st.className = 'state warn';
  } catch (e) { st.textContent = `No pude leer la cédula: ${e.message}`; st.className = 'state warn'; }
}

const profileBody = () => ({
  doc: digits($('doc').value), firstName: $('firstName').value.trim().toUpperCase(), lastName: $('lastName').value.trim().toUpperCase(),
  occupation: $('occupation').value, income: Number(digits($('income').value)), months: Number(digits($('months').value)),
  score: Number(digits($('score').value)), negatives: Number(digits($('negatives').value)), consulted: Number(digits($('consulted').value)),
  delinquencies: Number(digits($('negatives').value)), experian,
});
async function dictate() {
  const r = await api('/dictate', profileBody());
  return { ok: !!r.ok, text: r.ok ? `Centrales dictadas: ${(r.burós || []).map((l) => l.split(' · ').slice(0, 3).join(' · ')).join(' | ')}` : (r.detalle || 'no se dictó') };
}

// ── los botones ─────────────────────────────────────────────────────────────────────────────────────────────────
async function freshPerson() {
  const p = await api('/person');
  $('doc').value = p.doc; $('phone').value = p.phone; $('firstName').value = p.firstName; $('lastName').value = p.lastName; $('email').value = p.email;
  save(); refreshState(); $('otp').textContent = '—';
}
$('newPerson').onclick = async () => {
  try { await freshPerson(); say('Persona nueva, sin cliente activo en esta base.', 'ok'); }
  catch (e) { say(`No pude armar otra persona: ${e.message}`, 'bad'); }
};
// NUEVA SOLICITUD: persona nueva (cédula, celular y correo sin cliente activo), centrales dictadas y la pestaña al inicio del
// flujo con el monto. No da de baja ni borra a nadie: el cliente y la solicitud anteriores quedan en la base.
$('ready').onclick = async () => {
  if (!entryBase) { say('Abrí el wizard de una sucursal en esta pestaña (autogestión o asesor).', 'bad'); return; }
  $('ready').disabled = true; say('Armando la solicitud nueva…');
  try {
    await freshPerson();
    const d = await dictate();
    const amount = digits($('amount').value) || '5000000';
    lockPerson(false);
    await chrome.tabs.update(tabId, { url: `${entryBase}/solicitar?amount=${amount}` });
    say(`Persona nueva ${$('doc').value} · ${d.text}`, d.ok ? 'ok' : 'warn');
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
    say((r?.filled?.length ? `Rellené: ${r.filled.join(', ')}.` : 'En esta pantalla no había nada que rellenar.') + warn, r?.warnings?.length ? 'warn' : r?.filled?.length ? 'ok' : '');
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

// ── la solicitud de la pestaña y su dictamen ────────────────────────────────────────────────────────────────────
let openVerdict = false;   // el dictamen abierto o plegado, entre refrescos
async function renderRequest() {
  const box = $('req');
  if (!lastUreq || !target) { box.textContent = 'Todavía no hay solicitud en esta pestaña.'; return; }
  try {
    const v = await api(`/verdict?ureq=${lastUreq}`);
    box.innerHTML = '';
    const row = (a, b) => { const d = document.createElement('div'); d.className = 'row'; d.append(Object.assign(document.createElement('span'), { textContent: a }), Object.assign(document.createElement('span'), { textContent: b })); box.appendChild(d); };
    lastStatus = { status: v.status, statusName: v.statusName };
    renderFlow();
    row('Solicitud', `${v.ureq} · ${v.status} «${v.statusName || ''}»`);
    if (v.lender) row('Entidad', v.lender);
    // El dictamen (centrales y avisos), plegado: el recorrido ya dice dónde va.
    const lines = (v.verdict || []).slice(1);
    if (lines.length) {
      const det = document.createElement('details');
      det.open = openVerdict;
      det.ontoggle = () => { openVerdict = det.open; };
      det.appendChild(Object.assign(document.createElement('summary'), { textContent: `Dictamen (${lines.length})` }));
      const ul = document.createElement('ul');
      for (const line of lines) ul.appendChild(Object.assign(document.createElement('li'), { textContent: line }));
      det.appendChild(ul); box.appendChild(det);
    }
  } catch (e) { box.textContent = `No pude leer la solicitud ${lastUreq}: ${e.message}`; }
}

// ── lo que avisa la página ──────────────────────────────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (sender.tab?.id !== tabId) return false;
  if (msg?.type === 'docTyped' && digits(msg.doc) !== digits($('doc').value)) { $('doc').value = msg.doc; save(); refreshState(); }
  // Antes del «Siguiente» de datos personales: se vuelve a dictar (el lambda lo olvida en minutos) y se suelta el envío.
  if (msg?.type === 'beforeSubmit') {
    if (!target || digits($('doc').value).length < 6) { reply({ ok: false }); return false; }
    dictate().then((d) => { say(`Antes de enviar · ${d.text}`, d.ok ? 'ok' : 'warn'); reply(d); }).catch((e) => { say(`No se volvió a dictar: ${e.message}`, 'warn'); reply({ ok: false }); });
    return true;
  }
  return false;
});

chrome.tabs.onActivated.addListener(syncTab);
chrome.tabs.onUpdated.addListener((id, info) => { if (id === tabId && info.url) syncTab(); });
setInterval(() => { syncTab(); if (lastUreq) renderRequest(); readOtp(); }, 5000);
load().then(syncTab).then(() => { refreshState(); readOtp(); });
