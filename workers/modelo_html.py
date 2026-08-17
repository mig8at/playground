#!/usr/bin/env python3
"""La carta del modelo de datos: la mitad VISUAL de `cli.py relaciones`.

Las dos mitades salen del MISMO `modelo.cargar()`, y por eso no pueden contradecirse. Esa es toda la
razón de que esto sea un generador y no una página escrita: el día que cambie una tabla, la carta
cambia con `--html`, no a mano. Una documentación de modelo de datos mantenida a mano es la que
después dice `6 = Anulada` cuando en producción es `Negada`.

QUÉ CODIFICA LA FORMA, que es lo que un listado de texto no puede:
  · el TAMAÑO de la barra = cuántas filas tiene la tabla en prod (escala log: si no, `logs` con 9M
    aplasta a todas las demás y la carta muestra una sola barra)
  · la CERTEZA de cada relación = peso del punto, no color. Lleno = FK declarada (el motor la
    garantiza) · hueco = convención (mecánica, se deduce del nombre) · punteado = inferida por un
    modelo · rojo = inferida y NO se sostiene en los datos. Que sean cuatro pesos del mismo trazo y
    no cuatro colores es a propósito: es UNA escala, y una escala se lee como escala.
  · lo MUERTO se destiñe. 247 tablas donde 56 no tienen una sola fila es una carta que miente si
    todas se dibujan igual de firmes.
"""
from __future__ import annotations

import html
import json
import math
import pathlib

import modelo

PAGINA = """<title>Carta del modelo CreditOp</title>
<style>
:root {
  --paper:#EDF0EE; --surface:#F8FAF8; --hueco:#E3E8E5;
  --ink:#101E1D; --ink-2:#4A5C5C; --ink-3:#7B8C8A;
  --line:#CBD5D1; --line-2:#DEE5E2;
  --accent:#17605C; --gold:#8A5D14; --warn:#A3392A;
  --sans:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  --mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;
}
@media (prefers-color-scheme:dark){ :root:not([data-theme="light"]){
  --paper:#0B1314; --surface:#121D1E; --hueco:#182525;
  --ink:#DFE7E4; --ink-2:#8AA09E; --ink-3:#5E7371;
  --line:#223232; --line-2:#1A2828;
  --accent:#52B3A9; --gold:#C79A4A; --warn:#D9705E;
}}
:root[data-theme="dark"]{
  --paper:#0B1314; --surface:#121D1E; --hueco:#182525;
  --ink:#DFE7E4; --ink-2:#8AA09E; --ink-3:#5E7371;
  --line:#223232; --line-2:#1A2828;
  --accent:#52B3A9; --gold:#C79A4A; --warn:#D9705E;
}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--sans);
  font-size:15px;line-height:1.55;-webkit-font-smoothing:antialiased}
.env{max-width:1180px;margin:0 auto;padding:40px 24px 80px}
h1{font-size:clamp(26px,4vw,38px);letter-spacing:-.022em;font-weight:600;margin:0;text-wrap:balance}
h2{font-size:12px;letter-spacing:.13em;text-transform:uppercase;color:var(--ink-3);
  font-weight:600;margin:0}
.sub{color:var(--ink-2);margin:10px 0 0;max-width:64ch}
.mono{font-family:var(--mono);font-variant-numeric:tabular-nums}
hr{border:0;border-top:1px solid var(--line);margin:38px 0}

/* cifras de cabecera */
.cifras{display:flex;flex-wrap:wrap;gap:34px;margin-top:26px}
.cifra b{display:block;font-family:var(--mono);font-size:27px;font-weight:600;letter-spacing:-.02em}
.cifra span{font-size:11.5px;letter-spacing:.09em;text-transform:uppercase;color:var(--ink-3)}
.cifra.alerta b{color:var(--warn)}

/* la espina */
.espina{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px;margin-top:18px}
.hub{background:var(--surface);border:1px solid var(--line);border-radius:3px;padding:14px 16px;
  border-top:2px solid var(--gold);text-align:left;font:inherit;color:inherit;cursor:pointer;width:100%}
.hub:hover,.hub:focus-visible{border-color:var(--accent);outline:none}
.hub .n{font-family:var(--mono);font-size:15px;font-weight:600}
.hub .d{font-family:var(--mono);font-size:26px;color:var(--gold);letter-spacing:-.02em;
  font-variant-numeric:tabular-nums}
.hub .c{font-size:11.5px;color:var(--ink-3);letter-spacing:.05em;text-transform:uppercase}

/* buscador */
.busca{display:flex;gap:10px;align-items:center;margin:0 0 20px}
input[type=search]{flex:1;background:var(--surface);border:1px solid var(--line);border-radius:3px;
  padding:9px 12px;font-family:var(--mono);font-size:13.5px;color:var(--ink)}
input[type=search]:focus{outline:2px solid var(--accent);outline-offset:-1px;border-color:transparent}

/* vecindarios */
.barrios{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px}
.barrio{background:var(--surface);border:1px solid var(--line);border-radius:3px;padding:15px 16px 12px}
.barrio header{display:flex;justify-content:space-between;align-items:baseline;gap:10px;
  padding-bottom:9px;border-bottom:1px solid var(--line-2);margin-bottom:9px}
.barrio h3{margin:0;font-size:14.5px;font-weight:600;letter-spacing:-.005em}
.barrio .cuenta{font-family:var(--mono);font-size:11.5px;color:var(--ink-3);white-space:nowrap;
  font-variant-numeric:tabular-nums}
.barrio p{margin:0 0 11px;font-size:12.5px;color:var(--ink-2);line-height:1.45}
.fila{display:grid;grid-template-columns:1fr 62px;gap:9px;align-items:center;width:100%;
  background:none;border:0;padding:2.5px 0;font:inherit;color:inherit;cursor:pointer;text-align:left}
.fila:hover .t,.fila:focus-visible .t{color:var(--accent);text-decoration:underline}
.fila:focus-visible{outline:1px solid var(--accent);outline-offset:2px}
.fila .t{font-family:var(--mono);font-size:12.5px;overflow:hidden;text-overflow:ellipsis;
  white-space:nowrap}
.fila.muerta .t{color:var(--ink-3);text-decoration:line-through;text-decoration-thickness:.5px}
.fila.catalogo .t{color:var(--ink-2)}
.barra{height:5px;background:var(--hueco);border-radius:1px;overflow:hidden}
.barra i{display:block;height:100%;background:var(--accent);opacity:.72}
.fila.hub .t{color:var(--gold);font-weight:600}
.fila.hub .barra i{background:var(--gold)}

/* detalle */
.detalle{position:fixed;inset:auto 0 0;max-height:74vh;overflow:auto;background:var(--surface);
  border-top:2px solid var(--accent);padding:20px 24px 28px;
  box-shadow:0 -14px 40px rgba(0,0,0,.14);transform:translateY(101%)}
.detalle.abierto{transform:none}
@media (prefers-reduced-motion:no-preference){.detalle{transition:transform .22s ease}}
.detalle .env{padding:0}
.cerrar{position:absolute;top:14px;right:20px;background:none;border:1px solid var(--line);
  border-radius:3px;color:var(--ink-2);cursor:pointer;font:inherit;padding:2px 9px;line-height:1.5}
.cerrar:hover{border-color:var(--accent);color:var(--accent)}
.dcols{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:26px;margin-top:16px}
.rel{display:flex;gap:9px;align-items:baseline;padding:3px 0;font-family:var(--mono);font-size:12.5px}
.rel .col{color:var(--ink-2)}
.rel .flecha{color:var(--ink-3)}
.rel button{background:none;border:0;padding:0;font:inherit;color:var(--accent);cursor:pointer;
  text-decoration:underline;text-underline-offset:2px}
.rel .rol{display:block;font-family:var(--sans);font-size:12px;color:var(--ink-3);margin-left:19px}
.pin{flex:0 0 9px;height:9px;border-radius:50%;margin-top:5px;border:1.5px solid var(--accent)}
.pin.fk{background:var(--accent)}
.pin.conv{background:none}
.pin.inf{border-style:dotted}
.pin.rota{border-color:var(--warn);border-style:dotted;background:none}
.rel.rota .col,.rel.rota button{color:var(--warn)}
.nota{font-size:12px;color:var(--warn);font-family:var(--sans)}

/* leyenda */
.leyenda{display:flex;flex-wrap:wrap;gap:20px;font-size:12px;color:var(--ink-2);margin-top:14px}
.leyenda span{display:flex;align-items:center;gap:7px}
.vacio{color:var(--ink-3);font-size:13px;padding:14px 0}
</style>

<div class="env">
  <h1>Carta del modelo de datos</h1>
  <p class="sub">Las __TABLAS__ tablas de CreditOp agrupadas en vecindarios de negocio, y con qué se
  une cada una. El esquema declara <b>__FK__</b> claves foráneas: las otras __NOFK__ relaciones no
  están en la base — se reconstruyeron, y cada una dice de dónde salió.</p>

  <div class="cifras">
    <div class="cifra"><b>__TABLAS__</b><span>tablas</span></div>
    <div class="cifra"><b>__VIVAS__</b><span>con datos</span></div>
    <div class="cifra"><b>__RELS__</b><span>relaciones</span></div>
    <div class="cifra alerta"><b>__ROTAS__</b><span>no se sostienen</span></div>
  </div>

  <hr>

  <h2>La espina — el 61% de las relaciones llega a estas cuatro</h2>
  <p class="sub">Por eso no hay buscador de caminos en esta carta: con cuatro tablas así de
  concentradas, cualquier par queda a dos saltos pasando por un hub, y sale una unión correcta de
  sintaxis y falsa de negocio.</p>
  <div class="espina">__ESPINA__</div>

  <hr>

  <h2>Los vecindarios</h2>
  <div class="leyenda" style="margin-bottom:20px">
    <span><i class="pin fk"></i> clave foránea declarada</span>
    <span><i class="pin conv"></i> convención de nombre</span>
    <span><i class="pin inf"></i> inferida por un modelo</span>
    <span><i class="pin rota"></i> inferida y no se sostiene</span>
    <span>· barra = filas en prod (escala log) · <s>tachada</s> = vacía</span>
  </div>
  <div class="busca">
    <input type="search" id="q" placeholder="filtrar tablas…  (p. ej. otp, lender, revolving)"
           aria-label="filtrar tablas">
  </div>
  <div class="barrios" id="barrios">__BARRIOS__</div>

  <hr>
  <p class="sub" style="font-size:13px;color:var(--ink-3)">
    Filas medidas en producción el __MEDIDO__ (estimación de <span class="mono">information_schema</span>,
    sirve para el orden de magnitud y para distinguir 0 de mucho, no para reportar cifras).
    Se regenera con <span class="mono">workers/cli.py relaciones --html</span>.</p>
</div>

<aside class="detalle" id="detalle" aria-live="polite">
  <div class="env"><button class="cerrar" id="cerrar">cerrar</button><div id="cuerpo"></div></div>
</aside>

<script>
const M = __DATOS__;
const cuerpo = document.getElementById('cuerpo');
const panel  = document.getElementById('detalle');
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const clase = via => via === 'FK declarada' ? 'fk' : via === 'convención' ? 'conv' : 'inf';
const num = n => n == null ? '—' : n.toLocaleString('es-CO');

function abrir(t){
  const v = M.tablas[t];
  if (!v) return;
  const sale = v.apunta_a.map(([col, r]) => `
    <div class="rel ${r['⚠'] ? 'rota' : ''}">
      <i class="pin ${r['⚠'] ? 'rota' : clase(r.via)}"></i>
      <div><span class="col">${esc(col)}</span> <span class="flecha">→</span>
        <button data-t="${esc(r.a)}">${esc(r.a)}</button>
        ${r.rol ? `<span class="rol">${esc(r.rol)}</span>` : ''}
        ${r['⚠'] ? '<span class="rol nota">medido contra los datos: hay filas que apuntan a nada</span>' : ''}
      </div></div>`).join('') || '<p class="vacio">no apunta a ninguna tabla</p>';
  const entra = v.le_apuntan.map(k => {
    const [tt, col] = [k.split('.')[0], k.split('.').slice(1).join('.')];
    return `<div class="rel"><i class="pin conv" style="visibility:hidden"></i><div>
      <button data-t="${esc(tt)}">${esc(tt)}</button><span class="col">.${esc(col)}</span></div></div>`;
  }).join('') || '<p class="vacio">ninguna tabla le apunta</p>';
  cuerpo.innerHTML = `
    <h1 class="mono" style="font-size:21px">${esc(t)}</h1>
    <p class="sub" style="margin-top:6px">${esc(v.racimo)}
      ${v.heredado ? ' · vecindario heredado de a dónde apunta' : ''}
      · <b class="mono">${num(v.filas)}</b> filas · ${esc(v.estado)}</p>
    <div class="dcols">
      <div><h2>Apunta a (${v.apunta_a.length})</h2>${sale}</div>
      <div><h2>Le apuntan (${v.le_apuntan.length})</h2>${entra}</div>
    </div>`;
  panel.classList.add('abierto');
  panel.scrollTop = 0;
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-t]');
  if (b) { abrir(b.dataset.t); e.preventDefault(); }
});
document.getElementById('cerrar').onclick = () => panel.classList.remove('abierto');
document.addEventListener('keydown', e => { if (e.key === 'Escape') panel.classList.remove('abierto'); });

document.getElementById('q').addEventListener('input', e => {
  const q = e.target.value.trim().toLowerCase();
  document.querySelectorAll('.barrio').forEach(b => {
    let vis = 0;
    b.querySelectorAll('.fila').forEach(f => {
      const ok = !q || f.dataset.t.toLowerCase().includes(q);
      f.style.display = ok ? '' : 'none';
      if (ok) vis++;
    });
    b.style.display = vis ? '' : 'none';
  });
});
</script>
"""


def _barra(filas: int | None, maximo: float) -> int:
    """Ancho en %, en escala LOG: `logs` tiene 9M y la mediana ronda las 100 filas. En lineal la
    carta sería una barra llena y 246 vacías, que no es una comparación sino un solo dato."""
    if not filas:
        return 0
    return max(3, min(100, round(100 * math.log10(filas + 1) / maximo)))


def generar(destino: pathlib.Path) -> pathlib.Path:
    m = modelo.cargar()
    T, grupos = m["tablas"], modelo.por_racimo(m)
    hubs = dict(modelo.espina(m))
    maximo = math.log10(max((v["filas"] or 0) for v in T.values()) + 1)

    espina = "".join(
        f'<button class="hub" data-t="{html.escape(t)}"><div class="n">{html.escape(t)}</div>'
        f'<div class="d">{n}</div><div class="c">columnas le apuntan · '
        f'{(T[t]["filas"] or 0):,} filas</div></button>'
        for t, n in modelo.espina(m))

    barrios = []
    for k in sorted(grupos, key=lambda k: -len(grupos[k])):
        vivas = sum(1 for t in grupos[k] if T[t]["estado"] == "viva")
        filas = []
        for t in grupos[k]:
            v = T[t]
            cls = ("hub" if t in hubs else
                   "muerta" if v["estado"] == "VACÍA" else
                   "catalogo" if v["estado"] in ("catálogo", "vista") else "")
            filas.append(
                f'<button class="fila {cls}" data-t="{html.escape(t)}">'
                f'<span class="t">{html.escape(t)}</span>'
                f'<span class="barra"><i style="width:{_barra(v["filas"], maximo)}%"></i></span>'
                f'</button>')
        barrios.append(
            f'<section class="barrio"><header><h3>{html.escape(k)}</h3>'
            f'<span class="cuenta">{len(grupos[k])} · {vivas} con datos</span></header>'
            f'<p>{html.escape(modelo.descripcion(k))}</p>{"".join(filas)}</section>')

    n_rel = sum(len(v["apunta_a"]) for v in T.values())
    n_fk = sum(1 for v in T.values() for _, r in v["apunta_a"] if r["via"] == "FK declarada")
    pagina = (PAGINA
              .replace("__DATOS__", json.dumps(m, ensure_ascii=False, separators=(",", ":")))
              .replace("__ESPINA__", espina)
              .replace("__BARRIOS__", "".join(barrios))
              .replace("__TABLAS__", str(len(T)))
              .replace("__VIVAS__", str(sum(1 for v in T.values() if v["estado"] == "viva")))
              .replace("__RELS__", str(n_rel))
              .replace("__FK__", str(n_fk))
              .replace("__NOFK__", str(n_rel - n_fk))
              .replace("__ROTAS__", str(sum(1 for v in T.values()
                                            for _, r in v["apunta_a"] if r.get("⚠"))))
              .replace("__MEDIDO__", str(m["medido"])))
    destino.write_text(pagina, encoding="utf-8")
    return destino
