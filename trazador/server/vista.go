// vista.go — la traza como un run de CI: sidebar de etapas a la izquierda, detalle con log numerado a la
// derecha. El layout imita a propósito el de GitHub Actions, porque es un vocabulario que el equipo ya lee
// sin explicación: check verde, paso que se abre, log con números de línea.
//
// POR QUÉ UN ARCHIVO AUTOCONTENIDO Y NO UNA APP: un caso de soporte se adjunta a un ticket. Un HTML sin
// red ni CDN se abre en un mes, en la máquina de otro, sin levantar nada. Una app servida por el binario
// es mejor para explorar (pegar un número y buscar) — son dos usos distintos, y el mismo `Traza` sirve a
// los dos: esta vista y la consola NO calculan nada por su cuenta, solo renderizan.
//
// LOS DATOS VAN COMO JSON y el DOM se arma en JS. Es a propósito: si el HTML repitiera la información en
// dos formatos, los dos se desincronizarían en el primer cambio.
//
// CONVENCIÓN: identificadores en inglés, texto visible en español.
package main

import (
	"encoding/json"
	"fmt"
	"html"
	"os"
)

func escribirHTML(t Traza, s *Solicitud, ruta string) error {
	datos, err := json.Marshal(struct {
		Traza
		Comercio string `json:"comercio"`
		Sucursal string `json:"sucursal"`
		Lender   string `json:"lender"`
		RT       int    `json:"rt"`
		Estado   int    `json:"estado"`
		EstadoN  string `json:"estadoN"`
		Monto    string `json:"monto"`
	}{t, s.Comercio, s.Sucursal, s.Lender, s.LenderRT, s.Estado, s.EstadoN, fmt.Sprintf("%.0f", s.Monto)})
	if err != nil {
		return err
	}

	pagina := `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Traza ` + fmt.Sprint(t.UReq) + ` · ` + html.EscapeString(t.Target) + `</title>
<style>
:root{--bg:#0d1117;--panel:#161b22;--panel2:#010409;--line:#30363d;--txt:#e6edf3;--dim:#8b949e;
 --ok:#3fb950;--warn:#d29922;--fail:#f85149;--skip:#6e7681;--unknown:#a371f7;--accent:#58a6ff;--sel:#1f6feb26}
@media (prefers-color-scheme:light){:root{--bg:#fff;--panel:#f6f8fa;--panel2:#f6f8fa;--line:#d0d7de;--txt:#1f2328;
 --dim:#59636e;--ok:#1a7f37;--warn:#9a6700;--fail:#cf222e;--skip:#6e7781;--unknown:#8250df;--accent:#0969da;--sel:#0969da14}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--txt);
 font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}
.top{display:flex;align-items:center;gap:10px;padding:16px 20px;border-bottom:1px solid var(--line);flex-wrap:wrap}
.top h1{font-size:18px;margin:0;font-weight:600}
.top .num{color:var(--dim);font-weight:400}
.top .meta{color:var(--dim);font-size:13px;width:100%}
.ico{flex:0 0 20px;height:20px;border-radius:50%;display:grid;place-items:center;font-size:12px;font-weight:700;color:#fff}
.ico.ok{background:var(--ok)}.ico.warn{background:var(--warn)}.ico.fail{background:var(--fail)}
.ico.skip{background:transparent;color:var(--skip);border:1px solid var(--line)}
.ico.unknown{background:transparent;color:var(--unknown);border:1px dashed var(--unknown)}
.ico.big{flex:0 0 26px;height:26px;font-size:15px}
.cols{display:grid;grid-template-columns:290px minmax(0,1fr);min-height:calc(100vh - 78px)}
@media (max-width:820px){.cols{grid-template-columns:1fr}.side{border-right:0;border-bottom:1px solid var(--line)}}
.side{border-right:1px solid var(--line);padding:14px 0}
.side h2{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--dim);margin:0 0 8px;padding:0 16px}
.jobs{list-style:none;margin:0;padding:0}
.jobs li{display:flex;align-items:center;gap:9px;padding:7px 16px;cursor:pointer;border-left:2px solid transparent;font-size:13px}
.jobs li:hover{background:var(--sel)}
.jobs li.act{background:var(--sel);border-left-color:var(--accent);font-weight:600}
.jobs li .n{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.jobs li .t{color:var(--dim);font-size:11px;font-variant-numeric:tabular-nums}
.side .det{margin-top:16px;padding:13px 16px 0;border-top:1px solid var(--line);font-size:12px;color:var(--dim);line-height:1.7}
.side .det b{color:var(--txt);font-weight:600}
.main{padding:18px 20px;min-width:0}
.aviso{font-size:12px;color:var(--warn);margin:5px 0}
.crumb{color:var(--accent);font-size:15px;font-weight:600;margin-bottom:2px;word-break:break-word}
.sub2{color:var(--dim);font-size:13px;margin-bottom:14px}
.sec{border:1px solid var(--line);border-radius:8px;margin-bottom:14px;overflow:hidden;background:var(--panel)}
.sec>.hh{display:flex;align-items:center;gap:9px;padding:10px 13px;cursor:pointer;font-weight:600;font-size:13px}
.sec>.hh:hover{background:var(--sel)}
.sec>.bb{display:none}
.sec.open>.bb{display:block}
.cr{color:var(--dim);font-size:11px;display:inline-block;transition:transform .12s}
.sec.open .cr{transform:rotate(90deg)}
.srow{display:flex;align-items:center;gap:9px;padding:6px 13px 6px 34px;border-top:1px solid var(--line);font-size:13px}
.dot{width:8px;height:8px;border-radius:50%;flex:0 0 8px}
.dot.ok{background:var(--ok)}.dot.fail{background:var(--fail)}.dot.skip{background:var(--skip)}
.srow .l{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.srow .d{color:var(--dim);font-size:12px;white-space:nowrap}
.src{font-size:10px;color:var(--dim);border:1px solid var(--line);border-radius:4px;padding:0 5px;white-space:nowrap}
.log{background:var(--panel2);border-top:1px solid var(--line);overflow-x:auto;
 font:12px/1.7 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.log table{border-collapse:collapse;width:100%}
.log td{padding:0 8px;vertical-align:top;white-space:pre-wrap;word-break:break-word}
.log td.ln{width:1%;text-align:right;color:var(--skip);user-select:none;white-space:nowrap;
 position:sticky;left:0;background:var(--panel2)}
.log td.tm{width:1%;color:var(--dim);white-space:nowrap}
.log tr.err td:not(.ln){color:var(--fail)}
.log tr:hover td{background:var(--sel)}
.why{color:var(--fail);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;
 padding:9px 13px;word-break:break-word}
.nota{padding:8px 13px;border-top:1px solid var(--line);color:var(--dim);font-size:12px}
.badge{display:inline-block;padding:1px 9px;border-radius:999px;font-size:12px;font-weight:600;border:1px solid currentColor}
.badge.ok{color:var(--ok)}.badge.fail{color:var(--fail)}.badge.warn{color:var(--warn)}.badge.skip{color:var(--skip)}
.regla{border-left:3px solid var(--accent);background:var(--panel);padding:10px 12px;border-radius:0 6px 6px 0;
 font-size:12px;color:var(--dim);margin-bottom:14px}
</style></head><body>
<div id="app"></div>
<script>
const D = ` + string(datos) + `;

const ICO = {ok:['✓','ok'], warn:['!','warn'], fail:['✕','fail'], skip:['·','skip'],
             'sin-evidencia':['?','unknown'], 'sin-registro':['~','skip'], default:['·','skip']};
const FUENTE = {db:'BD', loki:'logs', default:'supuesto'};
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const ic = (st, big) => { const p = ICO[st] || ICO.skip;
  return '<span class="ico ' + p[1] + (big ? ' big' : '') + '">' + p[0] + '</span>'; };

// La etapa que se abre primero es la que rompió; si no rompió nada, la última con actividad. Es lo que uno
// quiere ver al abrir un run que falló, sin tener que buscarlo.
let sel = (() => {
  if (D.brokeAt) { const i = D.etapas.findIndex(e => e.id === D.brokeAt); if (i >= 0) return i; }
  const f = D.etapas.findIndex(e => e.status === 'fail' || e.status === 'warn');
  if (f >= 0) return f;
  let u = 0; D.etapas.forEach((e, i) => { if (e.at) u = i; }); return u;
})();

function sidebar() {
  const items = D.etapas.map((e, i) =>
    '<li class="' + (i === sel ? 'act' : '') + '" data-i="' + i + '">' +
      ic(e.status) + '<span class="n">' + esc(e.label) + '</span>' +
      '<span class="t">' + esc(e.at || '') + '</span></li>').join('');
  const av = (D.warnings || []).map(w => '<div class="aviso">⚠ ' + esc(w) + '</div>').join('');
  return '<aside class="side"><h2>Etapas del flujo</h2><ul class="jobs">' + items + '</ul>' +
    '<div class="det"><b>Detalles</b><br>ambiente <b>' + esc(D.target) + '</b><br>' +
    'fuentes ' + esc((D.sources || []).join(' + ')) + '<br>' +
    'estado ' + D.estado + ' «' + esc(D.estadoN) + '»' +
    (D.brokeAt ? '<br>rompió en <b>' + esc(D.brokeAt) + '</b>' : '') + '</div>' +
    (av ? '<div class="det"><b>Avisos (' + (D.warnings || []).length + ')</b>' + av + '</div>' : '') +
    '</aside>';
}

function panel() {
  const e = D.etapas[sel];
  let h = '<div class="crumb">' + esc(D.target) + ' / ' + D.ureq + ' / ' + esc(e.label) + '</div>';

  const estado = {ok:'completó', warn:'completó con errores', fail:'FALLÓ',
                  skip:'no se ejecutó', 'sin-evidencia':'sin evidencia en la BD',
                  'sin-registro':'ocurrió, pero sin registro'}[e.status] || e.status;
  const parts = [];
  if (e.at) parts.push('a las ' + esc(e.at));
  parts.push('fuente <b>' + esc(FUENTE[e.source] || '—') + '</b>');
  if (e.eventosDe) parts.push(e.eventosDe + ' líneas de log');
  h += '<div class="sub2">' + estado + ' · ' + parts.join(' · ') + '</div>';

  if (e.detail) h += '<div class="regla">' + esc(e.detail) + '</div>';
  if (e.reason) h += '<div class="sec open"><div class="hh"><span class="cr">▸</span>' + ic('fail') +
                     'Motivo</div><div class="bb"><div class="why">' + esc(e.reason) + '</div></div></div>';

  if (e.subs && e.subs.length) {
    h += '<div class="sec open"><div class="hh"><span class="cr">▸</span>' + ic('ok') +
         'Sub-pasos <span class="src">' + e.subs.length + '</span></div><div class="bb">' +
      e.subs.map(sb => {
        const d = (sb.status === 'ok' || sb.status === 'fail') ? sb.status : 'skip';
        return '<div class="srow"><span class="dot ' + d + '"></span><span class="l">' + esc(sb.label) +
          '</span><span class="d">' + esc(sb.detail || '') + '</span><span class="src">' +
          esc(FUENTE[sb.source] || '') + '</span></div>';
      }).join('') + '</div></div>';
  }

  if (e.eventos && e.eventos.length) {
    const rows = e.eventos.map((ev, i) =>
      '<tr class="' + (ev.level === 'error' ? 'err' : '') + '"><td class="ln">' + (i + 1) +
      '</td><td class="tm">' + esc(ev.at) + '</td><td>' + esc(ev.msg) + '</td></tr>').join('');
    const corte = e.eventosDe > e.eventos.length
      ? '<div class="nota">mostrando ' + e.eventos.length + ' de ' + e.eventosDe +
        ' líneas — los errores van primero, para que el recorte nunca se coma la causa</div>' : '';
    h += '<div class="sec open"><div class="hh"><span class="cr">▸</span>' + ic('ok') +
         'Log <span class="src">' + e.eventosDe + '</span></div><div class="bb">' +
         '<div class="log"><table>' + rows + '</table></div>' + corte + '</div></div>';
  }

  const vacia = !(e.subs && e.subs.length) && !(e.eventos && e.eventos.length) && !e.reason;
  if (vacia) {
    h += '<div class="regla">Sin detalle para esta etapa. ' +
      (e.status === 'sin-evidencia'
        ? 'La BD no la registra (el cupo rt=2 no se persiste; el listado rt=1 vive en DynamoDB) y ningún log la nombra. <b>No es lo mismo que «no ocurrió».</b>'
        : 'El flujo no llegó hasta acá.') + '</div>';
  }
  return '<main class="main">' + h + '</main>';
}

function pintar() {
  const res = {aprobado:'ok', roto:'fail', abandonado:'warn', 'en-curso':'skip'}[D.outcome] || 'skip';
  document.getElementById('app').innerHTML =
    '<div class="top">' + ic(res, true) +
      '<h1>Solicitud ' + D.ureq + ' <span class="num">' + esc(D.target) + '</span></h1>' +
      '<span class="badge ' + res + '">' + esc(D.outcome) + '</span>' +
      '<div class="meta">' + esc(D.comercio) + ' · ' + esc(D.sucursal) +
      (D.lender ? ' · ' + esc(D.lender) + ' (rt=' + D.rt + ')' : '') +
      ' · monto ' + esc(D.monto) + '</div></div>' +
    '<div class="cols">' + sidebar() + panel() + '</div>';

  document.querySelectorAll('.jobs li').forEach(li =>
    li.onclick = () => { sel = +li.dataset.i; pintar(); });
  document.querySelectorAll('.sec .hh').forEach(hh =>
    hh.onclick = () => hh.parentNode.classList.toggle('open'));
}
pintar();
</script></body></html>`

	return os.WriteFile(ruta, []byte(pagina), 0o644)
}
