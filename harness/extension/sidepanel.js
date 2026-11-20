// El panel lateral «Cliente de prueba». Lo que se escribe queda en chrome.storage (una persona y un perfil por máquina);
// lo que cambia la base o el mock lo hace el panel del harness (`/api/ext/*` en localhost:5195), que sabe dictarle al
// lambda de cada ambiente y dar de baja por el conector. La extensión no guarda credenciales.
const API = 'http://localhost:5195/api/ext';
const $ = (id) => document.getElementById(id);
const PERSON = ['doc', 'firstName', 'lastName', 'phone', 'email', 'amount'];
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
    : `En ${target} el backend consulta un lambda que no acepta dictado: las centrales contestan lo de por defecto (F-149). La baja y el OTP sí funcionan.`;
  for (const b of ['ready', 'fill', 'newPerson']) $(b).disabled = !target;
  const u = tab?.url ? ureqOf(tab.url) : null;
  if (u !== lastUreq) { lastUreq = u; renderRequest(); }
}

// ── lo guardado ─────────────────────────────────────────────────────────────────────────────────────────────────
async function load() {
  const s = await chrome.storage.local.get(['person', 'profile', 'preset']);
  const p = s.person || {};
  for (const k of PERSON) $(k).value = p[k] ?? (k === 'amount' ? '5000000' : '');
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
      + (s.active.test ? '' : ' No parece de prueba: no se da de baja desde acá.');
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
$('newPerson').onclick = async () => {
  try {
    const p = await api('/person');
    $('doc').value = p.doc; $('phone').value = p.phone; $('firstName').value = p.firstName; $('lastName').value = p.lastName; $('email').value = p.email;
    save(); refreshState(); say('Persona nueva, sin cliente activo en esta base.', 'ok');
  } catch (e) { say(`No pude armar otra persona: ${e.message}`, 'bad'); }
};
$('ready').onclick = async () => {
  const doc = digits($('doc').value);
  if (doc.length < 6) { say('Falta la cédula.', 'bad'); return; }
  $('ready').disabled = true; say('Dejando listo…');
  try {
    const reset = await api('/reset', { doc });
    const d = await dictate();
    say(`${reset.ok ? reset.detail : `No se dio de baja: ${reset.detail}`} · ${d.text}`, reset.ok && d.ok ? 'ok' : 'warn');
    refreshState();
  } catch (e) { say(`No quedó listo: ${e.message}`, 'bad'); }
  $('ready').disabled = false;
};
$('fill').onclick = async () => {
  if (tabId == null) return;
  const data = Object.fromEntries(PERSON.map((k) => [k, $(k).value.trim()]));
  data.amount = digits(data.amount); data.phone = digits(data.phone); data.doc = digits(data.doc);
  data.firstName = data.firstName.toUpperCase(); data.lastName = data.lastName.toUpperCase();
  try {
    const r = await chrome.tabs.sendMessage(tabId, { type: 'fill', data });
    say(r?.filled?.length ? `Rellené: ${r.filled.join(', ')}.` : 'En esta pantalla no había nada que rellenar.', r?.filled?.length ? 'ok' : '');
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

// ── la solicitud de la pestaña y su dictamen ────────────────────────────────────────────────────────────────────
async function renderRequest() {
  const box = $('req');
  if (!lastUreq || !target) { box.textContent = 'Todavía no hay solicitud en esta pestaña.'; return; }
  try {
    const v = await api(`/verdict?ureq=${lastUreq}`);
    box.innerHTML = '';
    const row = (a, b) => { const d = document.createElement('div'); d.className = 'row'; d.append(Object.assign(document.createElement('span'), { textContent: a }), Object.assign(document.createElement('span'), { textContent: b })); box.appendChild(d); };
    row('Solicitud', `${v.ureq} · ${v.status} «${v.statusName || ''}»`);
    if (v.lender) row('Entidad', v.lender);
    const ul = document.createElement('ul');
    for (const line of (v.verdict || []).slice(1)) ul.appendChild(Object.assign(document.createElement('li'), { textContent: line }));
    box.appendChild(ul);
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
