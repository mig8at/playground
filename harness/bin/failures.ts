#!/usr/bin/env node
// failures.ts — ¿qué falla, desde cuándo, en qué ambiente y con qué comercio? Lee el registro que dejan las corridas
// (`pkg/failure-log.ts`, `.runs/registry/cases.ndjson`) y lo resume por caso y ambiente.
//
//   node bin/failures.ts [--target qa] [--estado rojo|intermitente|verde|todos] [--dias 7] [--json] [--html]
//
// Por defecto muestra lo que NO está verde. `--html` escribe el dashboard (`.runs/registry/fallas.html`), una página
// autocontenida: los datos y el tema compartido (`tools/ui/theme.css` + `workbench.css`) van ADENTRO, leídos al
// generarla, así que no queda una copia del tema que envejezca. Sólo lectura: no toca bases ni sale a la red.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readCases, summarize, REGISTRY_DIR, REGISTRY_FILE, type CaseSummary } from '../pkg/failure-log.ts';

const argv = process.argv.slice(2);
const opt = (name: string) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
const has = (name: string) => argv.includes(`--${name}`);

const target = opt('target') || process.env.TARGET || '';
const estado = opt('estado') || process.env.ESTADO || 'no-verde';
const dias = Number(opt('dias') || process.env.DIAS || 0);

const { cases, broken } = readCases();
const since = dias > 0 ? new Date(Date.now() - dias * 86_400_000).toISOString() : '';
const scoped = cases.filter((c) => (!target || c.target === target) && (!since || c.at >= since));
const all = summarize(scoped);
const shown = all.filter((s) => estado === 'todos' ? true : estado === 'no-verde' ? s.estado !== 'verde' : s.estado === estado);

const count = (e: CaseSummary['estado']) => all.filter((s) => s.estado === e).length;
const meta = {
    formato: 'harness.failures/v1', archivo: REGISTRY_FILE, lineasRotas: broken,
    filtro: { target: target || null, estado, dias: dias || null },
    corridas: new Set(scoped.map((c) => c.run)).size, casos: all.length,
    rojos: count('rojo'), intermitentes: count('intermitente'), sinVeredicto: count('sin-veredicto'), verdes: count('verde'),
    desde: scoped.length ? scoped.map((c) => c.at).sort()[0] : null,
    generado: new Date().toISOString(),
};

if (has('json')) {
    process.stdout.write(JSON.stringify({ ...meta, filas: shown }) + '\n');
    process.exit(0);
}

if (has('html')) {
    const file = join(REGISTRY_DIR, 'fallas.html');
    writeFileSync(file, page(all, meta));
    console.log(`  dashboard → ${file}`);
    console.log(`  (${meta.casos} caso(s) · ${meta.rojos} rojo(s) · ${meta.intermitentes} intermitente(s) · ${meta.corridas} corrida(s))`);
    process.exit(0);
}

// ── TERMINAL ───────────────────────────────────────────────────────────────────────────────────────
// El registro guarda UTC; se muestra en la hora de esta máquina (Colombia), o una corrida de las 17h se lee a las 22h.
const day = (iso: string | null) => iso ? new Date(iso).toLocaleString('sv-SE', { hour12: false }).slice(0, 16) : '—';
const mark = { rojo: '✗', intermitente: '~', 'sin-veredicto': '?', verde: '✓' } as const;
console.log(`\n  FALLAS DEL HARNESS · registro de esta máquina · ${meta.corridas} corrida(s) · ${meta.casos} caso(s)`
    + (meta.desde ? ` · desde ${day(meta.desde)}` : ''));
console.log(`  ${meta.rojos} rojo(s) · ${meta.intermitentes} intermitente(s) · ${meta.sinVeredicto} sin veredicto · ${meta.verdes} verde(s)`
    + (target ? ` · sólo ${target}` : '') + (dias ? ` · últimos ${dias} día(s)` : ''));
if (broken) console.log(`  ⚠ ${broken} línea(s) del registro no se pudieron leer y se saltearon`);
if (!cases.length) console.log(`\n  El registro está vacío: lo llenan las corridas del runner de casos (make harness-case / harness-suite / harness-regression).\n`);
else if (!shown.length) console.log(`\n  Nada en «${estado}» con ese filtro.\n`);
for (const s of shown) {
    const who = s.suite && s.caso ? `${s.suite} · ${s.caso}`
        : `${s.comercio} → ${s.lender ?? 'listado'}` + (s.runner === 'walk' ? ` · caminador (${s.canal})` : '');
    const hist = s.historia.map((h) => h.ok ? '·' : '✗').join('');
    console.log(`\n  ${mark[s.estado]} ${s.estado.padEnd(13)} ${s.target.padEnd(8)} ${who}`);
    console.log(`      ${s.fallas}/${s.corridas} con falla · historia ${hist}`
        + (s.rojoDesde ? ` · rojo desde ${day(s.rojoDesde)}` : '') + ` · última ${day(s.ultima.at)}`
        + (s.ultima.ur ? ` · uReq ${s.ultima.ur}` : ''));
    const f = s.ultimaFalla;
    if (f && s.estado !== 'verde') {
        for (const d of (f.desvios.length ? f.desvios : [f.detalle ?? 'sin detalle']).slice(0, 3)) console.log(`      › ${d}`);
        console.log(`      repetir: ${f.comando}`);
    }
}
console.log(`\n  dashboard: make harness-fallas HTML=1 · para un agente: JSON=1\n`);

// ── DASHBOARD ──────────────────────────────────────────────────────────────────────────────────────
function page(rows: CaseSummary[], m: typeof meta): string {
    const ui = resolve(import.meta.dirname, '../../tools/ui');
    const css = readFileSync(join(ui, 'theme.css'), 'utf8') + '\n' + readFileSync(join(ui, 'workbench.css'), 'utf8');
    // `</` cortaría el <script> si apareciera en un desvío: se escapa.
    const data = JSON.stringify({ meta: m, rows }).replace(/</g, '\\u003c');
    return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Fallas del harness</title>
<style>${css}</style>
<style>
  /* El puente: los colores de estado, en los dos temas, como el panel del harness. */
  :root { --ok: #15803d; --warn: #b45309; --danger: #b91c1c }
  .dark { --ok: #22c55e; --warn: #f59e0b; --danger: #f87171 }
  body { margin: 0; background: var(--background); color: var(--foreground); font-family: var(--font-sans) }
  .sidebar, .auxiliarybar, .editor { display: flex; flex-direction: column; border-color: var(--border) }
  .sidebar { border-right: 1px solid var(--border) }
  .auxiliarybar { border-left: 1px solid var(--border) }
  .filters { display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-3) var(--gutter) }
  .filters label { display: flex; flex-direction: column; gap: var(--space-1); font-size: var(--text-sm); color: var(--fg-3) }
  .filters select, .filters input { height: var(--control-md); border: 1px solid var(--input); border-radius: var(--radius-control);
    background: var(--background); color: var(--foreground); padding: 0 var(--space-2); font: inherit }
  .counts { display: grid; grid-template-columns: 1fr auto; gap: var(--space-1) var(--space-3); padding: 0 var(--gutter) var(--space-3);
    font-size: var(--text-sm); color: var(--fg-2) }
  .counts b { text-align: right; font-variant-numeric: tabular-nums }
  .st { display: inline-flex; align-items: center; gap: var(--space-1); white-space: nowrap }
  .st::before { content: ''; width: 8px; height: 8px; border-radius: 50%; background: var(--fg-3) }
  .st[data-e="rojo"]::before { background: var(--danger) }
  .st[data-e="intermitente"]::before { background: var(--warn) }
  .st[data-e="verde"]::before { background: var(--ok) }
  .hist { display: inline-flex; gap: 2px; vertical-align: middle }
  .hist i { width: 6px; height: 14px; border-radius: 1px; background: var(--ok) }
  .hist i.f { background: var(--danger) }
  .table tbody tr { cursor: pointer }
  .table tbody tr:hover td { background: var(--hover) }
  .table td.who { max-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
  .muted { color: var(--fg-3) }
  .detail { padding: var(--space-3) var(--gutter); display: flex; flex-direction: column; gap: var(--space-3); font-size: var(--text-base) }
  .detail h3 { margin: 0; font-size: var(--text-title) }
  .kv { display: grid; grid-template-columns: 96px 1fr; gap: var(--space-1) var(--space-3); font-size: var(--text-sm) }
  .kv dt { color: var(--fg-3) } .kv dd { margin: 0; overflow-wrap: anywhere }
  .devs { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: var(--space-1) }
  pre.cmd { margin: 0; padding: var(--space-2); background: var(--muted); border-radius: var(--radius-control);
    white-space: pre-wrap; overflow-wrap: anywhere; font-family: var(--font-mono); font-size: var(--text-sm) }
  .runs { display: flex; flex-direction: column; font-size: var(--text-sm) }
  .runs div { display: flex; justify-content: space-between; gap: var(--space-2); padding: 2px 0; border-bottom: 1px solid var(--border) }
  /* ⚠ «.empty» ya existe en la base con «display: flex», que le gana a «hidden»: por eso otro nombre. */
  .no-rows { padding: var(--space-6) var(--gutter); color: var(--fg-3) }
  .no-rows[hidden] { display: none }
  /* Los filtros son tres controles: no necesitan el ancho de un sidebar de navegación, y el editor sí. */
  .workbench > .sidebar { width: 200px }
  .workbench > .auxiliarybar { width: 320px }
  .table td.when { white-space: nowrap; color: var(--fg-2) }
  /* Ancho fijo para todo menos el caso, que se queda con el resto: con el reparto automático, la historia y el
     estado le ganaban espacio y el nombre del caso quedaba en tres letras. */
  .table.fixed { table-layout: fixed }
  .table td .sub { display: block; font-size: var(--text-xs); color: var(--fg-3); overflow: hidden; text-overflow: ellipsis }
  @media (max-width: 1000px) { .workbench { grid-template-columns: minmax(0,1fr) !important; grid-template-areas: "editor" "auxiliarybar" "statusbar" !important }
    .workbench > .sidebar { display: none } .workbench > .auxiliarybar { width: auto; border-left: 0; border-top: 1px solid var(--border) } }
</style>
</head>
<body>
<div class="workbench">
  <aside class="sidebar">
    <div class="region-head"><span>Filtros</span></div>
    <div class="region-body">
      <div class="filters">
        <label>Ambiente <select id="fTarget"><option value="">Todos</option></select></label>
        <label>Estado <select id="fEstado">
          <option value="no-verde">No verdes</option><option value="rojo">Rojos</option>
          <option value="intermitente">Intermitentes</option><option value="sin-veredicto">Sin veredicto</option>
          <option value="verde">Verdes</option><option value="todos">Todos</option></select></label>
        <label>Buscar <input id="fQ" placeholder="suite, caso, comercio, desvío"></label>
      </div>
      <div class="counts" id="counts"></div>
    </div>
  </aside>
  <main class="editor">
    <div class="region-head"><span id="title">Fallas del harness</span></div>
    <div class="region-body"><table class="table fixed"><colgroup><col style="width:104px"><col style="width:72px"><col><col style="width:56px"><col style="width:96px"><col style="width:92px"></colgroup><thead><tr>
      <th>Estado</th><th>Ambiente</th><th>Caso</th><th class="num">Fallas</th><th>Historia</th><th>Última</th>
    </tr></thead><tbody id="rows"></tbody></table><div class="no-rows" id="empty" hidden></div></div>
  </main>
  <aside class="auxiliarybar">
    <div class="region-head"><span>Detalle</span></div>
    <div class="region-body"><div class="detail" id="detail"><span class="muted">Elegí una fila.</span></div></div>
  </aside>
  <footer class="statusbar"><span id="status"></span></footer>
</div>
<script>
const D = ${data};
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const when = (iso) => iso ? new Date(iso).toLocaleString('sv-SE', { hour12: false }).slice(0, 16) : '—';
try { if (matchMedia('(prefers-color-scheme: dark)').matches) document.documentElement.classList.add('dark') } catch {}
for (const t of [...new Set(D.rows.map((r) => r.target))].sort()) $('fTarget').insertAdjacentHTML('beforeend', '<option>' + esc(t) + '</option>');
let sel = null;
function who(r) { return r.suite && r.caso ? r.caso : r.comercio + ' → ' + (r.lender ?? 'listado') }
function render() {
  const t = $('fTarget').value, e = $('fEstado').value, q = $('fQ').value.trim().toLowerCase();
  const rows = D.rows.filter((r) => (!t || r.target === t)
    && (e === 'todos' || (e === 'no-verde' ? r.estado !== 'verde' : r.estado === e))
    && (!q || JSON.stringify([r.suite, r.caso, r.comercio, r.lender, r.ultimaFalla?.desvios, r.ultimaFalla?.detalle]).toLowerCase().includes(q)));
  $('rows').innerHTML = rows.map((r, i) => '<tr data-k="' + esc(r.key) + '"' + (sel === r.key ? ' aria-selected="true"' : '') + '>'
    + '<td><span class="st" data-e="' + r.estado + '">' + r.estado + '</span></td>'
    + '<td>' + esc(r.target) + '</td>'
    + '<td class="who" title="' + esc((r.suite ?? '') + ' · ' + who(r)) + '">' + esc(who(r))
      + '<span class="sub">' + esc([r.suite, r.comercio + ' → ' + (r.lender ?? 'listado'), r.runner === 'walk' ? 'caminador · ' + r.canal : null].filter(Boolean).join(' · ')) + '</span></td>'
    + '<td class="num">' + r.fallas + '/' + r.corridas + '</td>'
    + '<td><span class="hist">' + r.historia.map((h) => '<i' + (h.ok ? '' : ' class="f"') + ' title="' + esc(when(h.at)) + (h.ur ? ' · uReq ' + h.ur : '') + '"></i>').join('') + '</span></td>'
    + '<td class="when">' + when(r.ultima.at).slice(5) + '</td></tr>').join('');
  $('empty').hidden = rows.length > 0;
  $('empty').textContent = D.rows.length ? 'Nada con ese filtro.' : 'El registro está vacío: lo llenan las corridas del runner de casos.';
  const c = (s) => D.rows.filter((r) => (!t || r.target === t) && r.estado === s).length;
  $('counts').innerHTML = [['Rojos', c('rojo')], ['Intermitentes', c('intermitente')], ['Sin veredicto', c('sin-veredicto')], ['Verdes', c('verde')]]
    .map(([k, v]) => '<span>' + k + '</span><b>' + v + '</b>').join('');
  $('title').textContent = 'Fallas del harness · ' + rows.length + ' caso(s)';
}
function detail(k) {
  const r = D.rows.find((x) => x.key === k); if (!r) return;
  sel = k; render();
  const f = r.ultimaFalla, last = r.ultima;
  $('detail').innerHTML = '<h3>' + esc(who(r)) + '</h3>'
    + '<dl class="kv"><dt>Estado</dt><dd><span class="st" data-e="' + r.estado + '">' + r.estado + '</span></dd>'
    + '<dt>Ambiente</dt><dd>' + esc(r.target) + '</dd><dt>Suite</dt><dd>' + esc(r.suite ?? '—') + '</dd>'
    + '<dt>Comercio</dt><dd>' + esc(r.comercio) + '</dd><dt>Entidad</dt><dd>' + esc(r.lender ?? '—') + '</dd>'
    + '<dt>Canal</dt><dd>' + esc(r.canal) + '</dd><dt>Fallas</dt><dd>' + r.fallas + ' de ' + r.corridas + '</dd>'
    + '<dt>Rojo desde</dt><dd>' + when(r.rojoDesde) + '</dd><dt>Último verde</dt><dd>' + when(r.ultimoVerde?.at) + '</dd>'
    + '<dt>Backend</dt><dd>' + esc(last.backend ?? '—') + '</dd></dl>'
    + (f ? '<div><b>Última falla</b> <span class="muted">' + when(f.at) + (f.ur ? ' · uReq ' + f.ur : '') + '</span>'
      + '<ul class="devs">' + (f.desvios.length ? f.desvios : [f.detalle ?? 'sin detalle']).map((d) => '<li>' + esc(String(d).replace(who(r) + ': ', '')) + '</li>').join('') + '</ul></div>'
      + '<div><b>Repetir</b><pre class="cmd">' + esc(f.comando) + '</pre></div>' : '')
    + '<div><b>Corridas</b><div class="runs">' + r.historia.slice().reverse().map((h) => '<div><span class="st" data-e="' + (h.ok ? 'verde' : 'rojo') + '">'
      + when(h.at) + '</span><span class="muted">' + (h.ur ? 'uReq ' + h.ur : '—') + '</span></div>').join('') + '</div></div>';
}
$('rows').addEventListener('click', (ev) => { const tr = ev.target.closest('tr'); if (tr) detail(tr.dataset.k) });
for (const id of ['fTarget', 'fEstado', 'fQ']) $(id).addEventListener('input', render);
$('status').textContent = D.meta.corridas + ' corrida(s) · desde ' + when(D.meta.desde) + ' · generado ' + when(D.meta.generado)
  + (D.meta.lineasRotas ? ' · ' + D.meta.lineasRotas + ' línea(s) rotas' : '');
render();
</script>
</body>
</html>
`;
}
