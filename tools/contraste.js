/* Contraste de lo que SE PINTA, no de lo que dice una regla.
 *
 * `make estilo-check` §3 sólo puede mirar reglas que fijan color Y fondo en la misma regla — son 11 a
 * 37 por herramienta. El resto del texto hereda su color de un ancestro y su fondo de otro, y eso
 * ningún chequeo estático lo puede resolver. Esto sí: recorre el DOM, resuelve el fondo efectivo
 * subiendo por los ancestros y mide cada nodo con texto propio.
 *
 * CÓMO SE CORRE: pegalo en la consola del navegador con la herramienta abierta (:5191 tablero ·
 * :5192 trazador · :5195 panel) y llamá a `__contraste()`.
 *
 * ⚠ Dos trampas que costaron una medición equivocada cada una:
 *   1. Chrome deja `oklch()` SIN RESOLVER en el computed style. Parsear esos números como si fueran
 *      RGB da cualquier cosa — mi primer intento reportó 1,00 en todo. La única forma exacta es
 *      PINTAR el color en un canvas y leer el píxel.
 *   2. `opacity` se apila sobre el color y el chequeo estático no la ve, porque la regla sola es
 *      correcta. Acá se aplica al final, que es lo que hace el navegador — y es la de TODA la cadena de
 *      ancestros, no sólo la del nodo: hasta el 2026-09-23 se miraba sólo la propia, y la fecha de un
 *      hallazgo del tablero (ítem en `.85` × su línea en `.6`) salía verde estando en 3,53:1.
 *
 * WCAG exime a los controles INACTIVOS, así que lo deshabilitado sale marcado y no cuenta.
 */
window.__contraste = () => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 1;
  const ctx = cv.getContext('2d', { willReadFrequently: true }); const cache = new Map();
  const aRGB = (s) => { if (cache.has(s)) return cache.get(s);
    ctx.globalCompositeOperation = 'copy'; ctx.fillStyle = s; ctx.fillRect(0,0,1,1);
    ctx.globalCompositeOperation = 'source-over';
    const d = ctx.getImageData(0,0,1,1).data;
    const v = { c: [d[0],d[1],d[2]], a: d[3]/255 }; cache.set(s, v); return v };
  const lin = c => c <= 0.04045 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4);
  const lum = ([r,g,b]) => 0.2126*lin(r/255) + 0.7152*lin(g/255) + 0.0722*lin(b/255);
  const K = (a,b) => { const L1 = lum(a), L2 = lum(b); return (Math.max(L1,L2)+0.05)/(Math.min(L1,L2)+0.05) };
  const mez = (f,b) => f.a >= 1 ? f.c : f.c.map((v,i) => v*f.a + b[i]*(1-f.a));
  const fondo = (el) => { let n = el;
    while (n && n !== document.documentElement) {
      const b = aRGB(getComputedStyle(n).backgroundColor);
      if (b.a > 0.92) return b.c;
      if (b.a > 0) return mez(b, fondo(n.parentElement || document.body));
      n = n.parentElement; }
    return aRGB(getComputedStyle(document.body).backgroundColor).c };
  const hex = c => '#' + c.map(x => Math.round(x).toString(16).padStart(2,'0')).join('');
  const malos = [];
  for (const el of document.querySelectorAll('*')) {
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
    const cs = getComputedStyle(el);
    let op = 1; for (let n = el; n && n !== document.documentElement; n = n.parentElement) op *= +getComputedStyle(n).opacity;
    if (cs.visibility === 'hidden' || op === 0) continue;
    const txt = [...el.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim())
                                  .map(n => n.textContent.trim()).join(' ');
    if (!txt) continue;
    const bg = fondo(el);
    const px = parseFloat(cs.fontSize), peso = +cs.fontWeight || 400;
    const min = (px >= 24 || (px >= 18.66 && peso >= 700)) ? 3 : 4.5;   // AA: texto grande pide menos
    let col = mez(aRGB(cs.color), bg);
    if (op < 1) col = mez({ c: col, a: op }, bg);
    const k = K(col, bg);
    if (k >= min) continue;
    malos.push({ k: +k.toFixed(2), min, px, fg: hex(col), bg: hex(bg), opacidad: op,
      inactivo: el.disabled === true || !!el.closest('fieldset[disabled],[disabled]'),
      cls: (typeof el.className === 'string' ? el.className : '').slice(0,30), txt: txt.slice(0,30) });
  }
  const vivos = malos.filter(m => !m.inactivo);
  const p = {}; for (const m of vivos) if (!p[m.cls] || p[m.cls].k > m.k) p[m.cls] = m;
  const detalle = Object.values(p).sort((a,b) => a.k - b.k);
  if (typeof console.table === 'function') console.table(detalle);
  /* `detalle` va en el retorno además de la tabla: `tools/contraste.mjs` lo corre sin consola. */
  return { nodos: malos.length, activos: vivos.length, inactivos: malos.length - vivos.length,
           unicos: detalle.length, detalle };
};
window.__contraste()
