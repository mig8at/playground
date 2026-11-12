// office-personajes.js — los personajes de Office en papel cortado, para usar en cualquier página.
// GENERADO por office/paquete/build.mjs a partir de office/personajes.js y office/personajes.css: no se edita a mano.
// Uso: ver README.md (junto a este archivo).
const OFFICE_PAQUETE = true
// el dibujo, tal cual está en office/personajes.js, encerrado en su propio alcance
const P = (() => {
const module = { exports: {} }
// OFFICE · los personajes en papel cortado. Lo usan la llamada (index.html) y el editor (editor.html): el mismo
// dibujo, los mismos gestos y el mismo recuadro. Un personaje es un objeto plano (ver CAST en index.html y las
// opciones en OPCIONES, abajo); person(p) lo dibuja y tile(p) arma su recuadro de la llamada.

// El logo de CreditOp (la palabra), del repo móvil: packages/cds_mobile/assets/logos/creditop_logo.svg. Va una sola
// vez en la página como símbolo, en sus colores y en la versión bordada: las letras en currentColor (blanco en las
// chaquetas) y la E en su verde de marca.
// En Node (el CLI de personajes) no hay página: el logo va dentro de cada SVG que se genera (LOGO_SVG). En el paquete
// (office/paquete, que define OFFICE_PAQUETE) tampoco se toca la página: cada personaje lleva su logo adentro.
const LOGO_SVG = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><symbol id="creditop-logo" viewBox="0 0 232 30"><g clip-path="url(#co-clip)"><path fill="#4c39ff" d="M52.469 19.035c.23-.096.428-.188.618-.281 1.689-.844 3.01-2.025 3.928-3.508.916-1.483 1.382-3.172 1.382-5.025s-.465-3.542-1.382-5.025c-.918-1.483-2.24-2.662-3.928-3.508C51.402.848 49.422.421 47.202.421H35.65c-.97 0-1.753.759-1.753 1.694v25.844c0 .815.657 1.487 1.498 1.532a45 45 0 0 0 4.607 0c.846-.045 1.508-.715 1.508-1.532V20.02h.86a3.16 3.16 0 0 1 2.637 1.385l4.928 7.345c.271.405.727.667 1.226.695a64 64 0 0 0 3.6.103h.22a63 63 0 0 0 2.821-.072c.315-.017.623-.164.783-.429a.85.85 0 0 0-.02-.923l-6.097-9.093zm-1.94-8.896a3.2 3.2 0 0 1-.416 1.612 2.9 2.9 0 0 1-1.159 1.12c-.499.267-1.088.403-1.75.403h-5.031a.645.645 0 0 1-.657-.635V7.602c0-.352.293-.635.657-.635h5.031c.662 0 1.253.136 1.75.403a2.9 2.9 0 0 1 1.159 1.12 3.3 3.3 0 0 1 .417 1.651zm62.534-7.816c-2.331-1.263-4.98-1.905-7.874-1.905h-10.75c-.969 0-1.751.759-1.751 1.694v25.595c0 .937.785 1.694 1.752 1.694h10.749c2.894 0 5.545-.64 7.874-1.904 2.332-1.266 4.183-3.02 5.507-5.22 1.321-2.2 1.992-4.679 1.992-7.369s-.671-5.17-1.992-7.368c-1.321-2.197-3.175-3.955-5.507-5.22zm-12.763 5.7c0-.586.49-1.06 1.096-1.06h3.158c1.614 0 3.054.34 4.282 1.013a7.1 7.1 0 0 1 2.848 2.814c.669 1.202 1.008 2.589 1.008 4.123s-.339 2.922-1.008 4.124a7.1 7.1 0 0 1-2.848 2.813c-1.226.673-2.668 1.012-4.282 1.012h-3.158c-.606 0-1.096-.473-1.096-1.059zM133.13.377a91 91 0 0 0-2.257-.028h-.012c-.749 0-1.507.009-2.259.028-.865.02-1.543.696-1.543 1.534V27.92c0 .837.676 1.511 1.539 1.535.729.02 1.471.03 2.2.03h.063c.754 0 1.518-.012 2.271-.03.863-.024 1.539-.698 1.539-1.535V1.911c0-.838-.678-1.513-1.544-1.534zm31.391.043h-21.939c-.841 0-1.539.633-1.585 1.444a32 32 0 0 0 0 3.652c.046.813.744 1.448 1.585 1.448h6.067c.605 0 1.095.473 1.095 1.059v19.949c0 .808.647 1.48 1.474 1.53.695.042 1.4.066 2.098.07h.231c.768 0 1.546-.023 2.314-.07.839-.052 1.496-.724 1.496-1.532V8.023c0-.586.489-1.06 1.095-1.06h6.069c.843 0 1.539-.639 1.585-1.456a32 32 0 0 0 0-3.632c-.046-.817-.744-1.457-1.585-1.457zm66.032 4.96c-.96-1.552-2.339-2.78-4.098-3.65C224.7.86 222.642.421 220.34.421h-11.018c-.875 0-1.588.689-1.588 1.534v25.997c0 .82.664 1.494 1.513 1.532a53 53 0 0 0 2.203.054h.087c.764 0 1.534-.02 2.295-.054.851-.04 1.515-.712 1.515-1.535v-6.286c0-.569.48-1.03 1.066-1.03h3.924c2.332 0 4.402-.427 6.154-1.268 1.76-.843 3.134-2.038 4.079-3.547s1.425-3.254 1.425-5.19c0-1.935-.487-3.699-1.444-5.25zm-6.423 5.168c0 .667-.155 1.279-.458 1.815-.3.532-.749.956-1.325 1.263-.585.307-1.258.464-2.005.464h-4.333a.645.645 0 0 1-.657-.635V7.603c0-.352.293-.635.657-.635h4.333c.747 0 1.423.157 2.005.464a3.2 3.2 0 0 1 1.325 1.262c.306.537.458 1.162.458 1.858zM185.758 0c-8.555 0-15.516 6.729-15.516 15.001 0 8.273 6.961 14.999 15.516 14.999s15.519-6.729 15.519-14.999S194.316 0 185.758 0m8.11 15.001c0 4.323-3.638 7.837-8.107 7.837s-8.107-3.517-8.107-7.837 3.638-7.837 8.107-7.837 8.107 3.517 8.107 7.837M15.51 7.17c1.079 0 2.157.28 2.17.285 1.735.473 2.973 1.453 3.708 2.19a1.62 1.62 0 0 0 2.004.211 25 25 0 0 0 1.98-1.405c.54-.427 1.069-.881 1.568-1.354a1.497 1.497 0 0 0 .058-2.125C25.562 3.467 23.117 1.478 19.636.55A16 16 0 0 0 14.37.049 15.67 15.67 0 0 0 4.38 4.58C1.717 7.24.166 10.72.013 14.378c-.174 4.119 1.358 8.027 4.312 11 2.957 2.977 6.93 4.615 11.185 4.615s8.432-1.75 11.362-4.803a1.5 1.5 0 0 0-.104-2.193 25.3 25.3 0 0 0-3.667-2.622 1.63 1.63 0 0 0-1.929.207 8.26 8.26 0 0 1-3.495 1.968 8 8 0 0 1-2.162.283c-2.91-.051-8.107-2.713-8.107-7.834 0-4.32 3.635-7.835 8.105-7.835z"/><path fill="#05d587" d="M66.868 7.294h14.806c.844 0 1.54-.637 1.585-1.45a36 36 0 0 0 0-3.98c-.046-.811-.741-1.446-1.585-1.446H66.868c-.84 0-1.539.635-1.585 1.446a35 35 0 0 0 0 3.985c.046.81.742 1.445 1.585 1.445m19.365 16.824c-.046-.809-.741-1.441-1.585-1.441h-17.78c-.843 0-1.539.64-1.585 1.455a35 35 0 0 0 0 3.969c.046.815.744 1.452 1.585 1.452h17.78c.844 0 1.542-.642 1.585-1.46a35 35 0 0 0 0-3.973zm-19.365-5.536h9.499c.843 0 1.541-.642 1.585-1.46a36 36 0 0 0 0-3.973c-.046-.809-.742-1.439-1.585-1.439h-9.499c-.843 0-1.539.64-1.585 1.455a35 35 0 0 0 0 3.969c.046.815.744 1.452 1.585 1.452z"/></g><defs><clipPath id="co-clip"><path fill="#fff" d="M0 0h232v30H0z"/></clipPath></defs></symbol><symbol id="creditop-logo-mono" viewBox="0 0 232 30"><g clip-path="url(#co-clip-mono)"><path fill="currentColor" d="M52.469 19.035c.23-.096.428-.188.618-.281 1.689-.844 3.01-2.025 3.928-3.508.916-1.483 1.382-3.172 1.382-5.025s-.465-3.542-1.382-5.025c-.918-1.483-2.24-2.662-3.928-3.508C51.402.848 49.422.421 47.202.421H35.65c-.97 0-1.753.759-1.753 1.694v25.844c0 .815.657 1.487 1.498 1.532a45 45 0 0 0 4.607 0c.846-.045 1.508-.715 1.508-1.532V20.02h.86a3.16 3.16 0 0 1 2.637 1.385l4.928 7.345c.271.405.727.667 1.226.695a64 64 0 0 0 3.6.103h.22a63 63 0 0 0 2.821-.072c.315-.017.623-.164.783-.429a.85.85 0 0 0-.02-.923l-6.097-9.093zm-1.94-8.896a3.2 3.2 0 0 1-.416 1.612 2.9 2.9 0 0 1-1.159 1.12c-.499.267-1.088.403-1.75.403h-5.031a.645.645 0 0 1-.657-.635V7.602c0-.352.293-.635.657-.635h5.031c.662 0 1.253.136 1.75.403a2.9 2.9 0 0 1 1.159 1.12 3.3 3.3 0 0 1 .417 1.651zm62.534-7.816c-2.331-1.263-4.98-1.905-7.874-1.905h-10.75c-.969 0-1.751.759-1.751 1.694v25.595c0 .937.785 1.694 1.752 1.694h10.749c2.894 0 5.545-.64 7.874-1.904 2.332-1.266 4.183-3.02 5.507-5.22 1.321-2.2 1.992-4.679 1.992-7.369s-.671-5.17-1.992-7.368c-1.321-2.197-3.175-3.955-5.507-5.22zm-12.763 5.7c0-.586.49-1.06 1.096-1.06h3.158c1.614 0 3.054.34 4.282 1.013a7.1 7.1 0 0 1 2.848 2.814c.669 1.202 1.008 2.589 1.008 4.123s-.339 2.922-1.008 4.124a7.1 7.1 0 0 1-2.848 2.813c-1.226.673-2.668 1.012-4.282 1.012h-3.158c-.606 0-1.096-.473-1.096-1.059zM133.13.377a91 91 0 0 0-2.257-.028h-.012c-.749 0-1.507.009-2.259.028-.865.02-1.543.696-1.543 1.534V27.92c0 .837.676 1.511 1.539 1.535.729.02 1.471.03 2.2.03h.063c.754 0 1.518-.012 2.271-.03.863-.024 1.539-.698 1.539-1.535V1.911c0-.838-.678-1.513-1.544-1.534zm31.391.043h-21.939c-.841 0-1.539.633-1.585 1.444a32 32 0 0 0 0 3.652c.046.813.744 1.448 1.585 1.448h6.067c.605 0 1.095.473 1.095 1.059v19.949c0 .808.647 1.48 1.474 1.53.695.042 1.4.066 2.098.07h.231c.768 0 1.546-.023 2.314-.07.839-.052 1.496-.724 1.496-1.532V8.023c0-.586.489-1.06 1.095-1.06h6.069c.843 0 1.539-.639 1.585-1.456a32 32 0 0 0 0-3.632c-.046-.817-.744-1.457-1.585-1.457zm66.032 4.96c-.96-1.552-2.339-2.78-4.098-3.65C224.7.86 222.642.421 220.34.421h-11.018c-.875 0-1.588.689-1.588 1.534v25.997c0 .82.664 1.494 1.513 1.532a53 53 0 0 0 2.203.054h.087c.764 0 1.534-.02 2.295-.054.851-.04 1.515-.712 1.515-1.535v-6.286c0-.569.48-1.03 1.066-1.03h3.924c2.332 0 4.402-.427 6.154-1.268 1.76-.843 3.134-2.038 4.079-3.547s1.425-3.254 1.425-5.19c0-1.935-.487-3.699-1.444-5.25zm-6.423 5.168c0 .667-.155 1.279-.458 1.815-.3.532-.749.956-1.325 1.263-.585.307-1.258.464-2.005.464h-4.333a.645.645 0 0 1-.657-.635V7.603c0-.352.293-.635.657-.635h4.333c.747 0 1.423.157 2.005.464a3.2 3.2 0 0 1 1.325 1.262c.306.537.458 1.162.458 1.858zM185.758 0c-8.555 0-15.516 6.729-15.516 15.001 0 8.273 6.961 14.999 15.516 14.999s15.519-6.729 15.519-14.999S194.316 0 185.758 0m8.11 15.001c0 4.323-3.638 7.837-8.107 7.837s-8.107-3.517-8.107-7.837 3.638-7.837 8.107-7.837 8.107 3.517 8.107 7.837M15.51 7.17c1.079 0 2.157.28 2.17.285 1.735.473 2.973 1.453 3.708 2.19a1.62 1.62 0 0 0 2.004.211 25 25 0 0 0 1.98-1.405c.54-.427 1.069-.881 1.568-1.354a1.497 1.497 0 0 0 .058-2.125C25.562 3.467 23.117 1.478 19.636.55A16 16 0 0 0 14.37.049 15.67 15.67 0 0 0 4.38 4.58C1.717 7.24.166 10.72.013 14.378c-.174 4.119 1.358 8.027 4.312 11 2.957 2.977 6.93 4.615 11.185 4.615s8.432-1.75 11.362-4.803a1.5 1.5 0 0 0-.104-2.193 25.3 25.3 0 0 0-3.667-2.622 1.63 1.63 0 0 0-1.929.207 8.26 8.26 0 0 1-3.495 1.968 8 8 0 0 1-2.162.283c-2.91-.051-8.107-2.713-8.107-7.834 0-4.32 3.635-7.835 8.105-7.835z"/><path fill="#05d587" d="M66.868 7.294h14.806c.844 0 1.54-.637 1.585-1.45a36 36 0 0 0 0-3.98c-.046-.811-.741-1.446-1.585-1.446H66.868c-.84 0-1.539.635-1.585 1.446a35 35 0 0 0 0 3.985c.046.81.742 1.445 1.585 1.445m19.365 16.824c-.046-.809-.741-1.441-1.585-1.441h-17.78c-.843 0-1.539.64-1.585 1.455a35 35 0 0 0 0 3.969c.046.815.744 1.452 1.585 1.452h17.78c.844 0 1.542-.642 1.585-1.46a35 35 0 0 0 0-3.973zm-19.365-5.536h9.499c.843 0 1.541-.642 1.585-1.46a36 36 0 0 0 0-3.973c-.046-.809-.742-1.439-1.585-1.439h-9.499c-.843 0-1.539.64-1.585 1.455a35 35 0 0 0 0 3.969c.046.815.744 1.452 1.585 1.452z"/></g><defs><clipPath id="co-clip-mono"><path fill="#fff" d="M0 0h232v30H0z"/></clipPath></defs></symbol></svg>`
if (typeof document !== 'undefined' && typeof OFFICE_PAQUETE === 'undefined') document.body.insertAdjacentHTML('afterbegin', LOGO_SVG)

// ── LOS PAISAJES DE PAPEL ────────────────────────────────────────────────────────────────────────
// Cada recuadro es una escena de capas recortadas (viewBox 400×300), con la paleta de papel: verde azulado,
// crema, rojo y naranja. Cada capa lleva su sombra (.cut), y eso es lo que la hace papel.
const P = { ink: '#13323a', deep: '#1d4a54', teal: '#2b6670', soft: '#4f8b8a', sage: '#8db3a9', cream: '#f1e4c7', red: '#c5381f', redDeep: '#962b19', orange: '#e5592a', amber: '#f08c3d',
  yellow: '#f2c14e', pink: '#ee8f8f', rose: '#d9667a', lilac: '#9b8ec7', plum: '#5e3b6b', sky: '#78b4d0', navy: '#24406b', grass: '#7fae6a', forest: '#3f6f4a' }
const cloud = (x, y, s, fill) => `<g class="cut"><path transform="translate(${x} ${y}) scale(${s})" d="M0 40 q4-26 30-22 q10-24 38-16 q22-14 40 8 q26-2 28 30 Z" fill="${fill}"/></g>`
const sun = (x, y, r, rings) => `<g class="cut">${rings.map((c, i) => `<circle cx="${x}" cy="${y}" r="${r * (1 - i * .22)}" fill="${c}"/>`).join('')}</g>`
const wave = (y, amp, fill, phase = 0) => `<g class="cut"><path d="M-10 ${y} C${60 + phase} ${y - amp} ${130 + phase} ${y + amp} 200 ${y} S${340 - phase} ${y - amp} 410 ${y + 4} V310 H-10Z" fill="${fill}"/></g>`
// rayos de sol: cuñas alternadas desde un centro
const rays = (x, y, n, c1, c2) => `<g>${Array.from({ length: n }, (_, i) => { const a0 = (i / n) * Math.PI * 2, a1 = ((i + .5) / n) * Math.PI * 2; return `<path d="M${x} ${y} L${x + 600 * Math.cos(a0)} ${y + 600 * Math.sin(a0)} L${x + 600 * Math.cos(a1)} ${y + 600 * Math.sin(a1)}Z" fill="${i % 2 ? c1 : c2}"/>` }).join('')}</g>`
const stars = (fill, pts) => `<g class="cut-soft">${pts.map(([x, y, r]) => `<path d="M${x} ${y - r} l${r * .3} ${r * .7} l${r * .7} ${r * .3} l${-r * .7} ${r * .3} l${-r * .3} ${r * .7} l${-r * .3} ${-r * .7} l${-r * .7} ${-r * .3} l${r * .7} ${-r * .3}Z" fill="${fill}"/>`).join('')}</g>`
const confetti = (cols, n, seed) => { let s = '', k = seed; for (let i = 0; i < n; i++) { k = (k * 9301 + 49297) % 233280; const x = (k / 233280) * 400; k = (k * 9301 + 49297) % 233280; const y = (k / 233280) * 170; s += `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${3 + (i % 3) * 2}" fill="${cols[i % cols.length]}"/>` } return `<g class="cut-soft">${s}</g>` }
const SCENES = {
  sunset: () => `<rect width="400" height="300" fill="${P.amber}"/>${rays(320, 70, 16, P.yellow, P.amber)}${sun(320, 70, 66, [P.redDeep, P.red, P.orange, P.yellow])}${cloud(10, 40, 1.1, P.cream)}${cloud(250, 140, .9, P.pink)}${wave(228, 26, P.plum)}${wave(254, 22, P.rose, 30)}${wave(282, 16, P.red, 10)}`,
  clouds: () => `<rect width="400" height="300" fill="${P.sky}"/>${cloud(-20, 10, 1.6, P.cream)}${cloud(260, 40, 1.2, P.pink)}${cloud(-30, 140, 1.4, P.lilac)}${stars(P.yellow, [[330, 150, 12], [70, 120, 9], [290, 30, 8]])}${wave(248, 22, P.navy)}${wave(276, 14, P.deep, 40)}`,
  hills: () => `<rect width="400" height="300" fill="${P.yellow}"/>${rays(70, 80, 14, P.cream, P.yellow)}${sun(70, 80, 46, [P.orange, P.amber])}${cloud(270, 30, 1, P.cream)}${wave(212, 30, P.grass)}${wave(242, 24, P.forest, 40)}${wave(274, 16, P.teal, 10)}`,
  sun: () => `<rect width="400" height="300" fill="${P.lilac}"/>${confetti([P.yellow, P.pink, P.cream, P.sky], 16, 7)}${sun(330, 70, 76, [P.plum, P.rose, P.pink, P.yellow])}${cloud(0, 60, 1.2, P.cream)}${wave(238, 24, P.navy)}${wave(268, 18, P.rose, 30)}`,
  waves: () => `<rect width="400" height="300" fill="${P.teal}"/>${stars(P.cream, [[60, 40, 10], [340, 120, 8], [180, 24, 7]])}${cloud(260, 20, 1.3, P.pink)}${cloud(-10, 90, 1, P.sky)}${wave(198, 26, P.navy)}${wave(230, 22, P.sky, 30)}${wave(260, 18, P.sage, 10)}${wave(286, 12, P.yellow, 40)}`,
  dusk: () => `<rect width="400" height="300" fill="${P.plum}"/>${stars(P.yellow, [[300, 40, 11], [360, 110, 7], [210, 70, 6], [150, 30, 8]])}${sun(70, 90, 56, [P.rose, P.pink, P.cream])}${cloud(250, 120, .9, P.lilac)}${wave(232, 26, P.navy)}${wave(262, 18, P.rose, 30)}${wave(288, 12, P.amber, 10)}`,
  garden: () => `<rect width="400" height="300" fill="${P.pink}"/>${confetti([P.cream, P.yellow, P.rose], 14, 3)}${sun(320, 80, 52, [P.amber, P.yellow])}${cloud(20, 30, 1.1, P.cream)}${wave(220, 28, P.grass)}${wave(252, 20, P.forest, 30)}${wave(280, 14, P.yellow, 10)}`,
  ocean: () => `<rect width="400" height="300" fill="${P.navy}"/>${rays(200, 320, 18, P.navy, P.deep)}${sun(90, 70, 44, [P.cream, P.yellow])}${stars(P.cream, [[300, 50, 9], [350, 140, 6], [240, 110, 7]])}${wave(226, 24, P.sky)}${wave(254, 20, P.teal, 30)}${wave(280, 14, P.sage, 10)}`,
  candy: () => `<rect width="400" height="300" fill="${P.sage}"/>${rays(200, 100, 20, P.sage, P.cream)}${cloud(10, 100, 1.2, P.pink)}${cloud(270, 40, 1.1, P.lilac)}${wave(232, 24, P.rose)}${wave(262, 18, P.orange, 30)}${wave(286, 12, P.plum, 10)}`,
}

// ── LOS PERSONAJES, EN PAPEL ─────────────────────────────────────────────────────────────────────
// Caricaturas originales del torso para arriba: cabeza grande, hombros chicos. Todos son personas, con la
// chaqueta del equipo; a los agentes los distingue su placa («agente de …»). Cada pieza es una capa con sombra.
// La cara es la misma maquinaria para todos: ojos con pupila (.pupils), cejas (.brow-l / .brow-r) y cuatro bocas
// (.m-smile, .m-talk, .m-think, .m-flat); el CSS elige cuál se ve y adónde miran según el estado del recuadro. La
// cabeza (.head) y el cuerpo (.body) se balancean por separado, poquito, como un títere de recortes.
const shade = (hex, f) => {
  const n = parseInt(hex.slice(1), 16)
  const ch = (v) => Math.max(0, Math.min(255, Math.round(v * f)))
  return `rgb(${ch(n >> 16)},${ch((n >> 8) & 255)},${ch(n & 255)})`
}
// mezcla dos colores: t = 0 es el primero, 1 el segundo
const mix = (a, b, t) => { const p = (h) => [16, 8, 0].map((s) => (parseInt(h.slice(1), 16) >> s) & 255); const [x, y] = [p(a), p(b)]; return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(',')})` }
const cut = (inner) => `<g class="cut">${inner}</g>`
const soft = (inner) => `<g class="cut-soft">${inner}</g>`
const r1 = (n) => Math.round(n * 10) / 10

// LA GEOMETRÍA DE LA CABEZA. El pelo se arma sobre la misma elipse de la cara (agrandada un poco), así abraza el
// contorno en vez de flotar encima: pt() da un punto de la elipse por ángulo (270° es arriba, 180° la izquierda).
const HEAD = { cx: 200, cy: 146 }
// La cara puede no ser una elipse: h.n la hace más cuadrada (2 es elipse) y h.rxB le da otro ancho a la mitad de abajo
// (la mandíbula). El pelo, los gorros y la barba usan este mismo pt(), así se acomodan solos a cualquier forma.
const pt = (h, deg, pad = 0) => {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a), e = 2 / (h.n || 2)
  const rx = s > 0 && h.rxB ? h.rxB : h.rx
  return [r1(h.cx + (rx + pad) * Math.sign(c) * Math.abs(c) ** e), r1(h.cy + (h.ry + pad) * Math.sign(s) * Math.abs(s) ** e)]
}
// el contorno de la cara, como trazado
const headPath = (h, pad = 0) => { let d = ''; for (let a = 0; a < 360; a += 4) { const [x, y] = pt(h, a, pad); d += `${d ? 'L' : 'M'}${x} ${y} ` } return `${d}Z` }
// las formas de cara: ancho arriba, alto, y opcionalmente cuadratura (n) y ancho de mandíbula (rxB)
const FACES = {
  round: { rx: 92, ry: 88 }, soft: { rx: 94, ry: 90 }, wide: { rx: 100, ry: 84 }, tall: { rx: 86, ry: 94 },
  largo: { rx: 80, ry: 102 }, achatada: { rx: 106, ry: 76 }, cuadrada: { rx: 90, ry: 90, n: 3.4 },
  mandibula: { rx: 84, ry: 92, rxB: 100, n: 2.6 }, corazon: { rx: 100, ry: 92, rxB: 72, n: 2.2 },
}
// un arco sobre la elipse, de a0 a a1 grados (sentido horario en pantalla), como «L x y L x y…»
const arc = (h, a0, a1, pad = 0, step = 4) => { const out = []; for (let a = a0; a1 > a0 ? a <= a1 : a >= a1; a += a1 > a0 ? step : -step) out.push(pt(h, a, pad)); out.push(pt(h, a1, pad)); return out.map(([x, y]) => `L${x} ${y}`).join(' ') }
const M = ([x, y]) => `M${x} ${y}`

// LOS PEINADOS. back va detrás de la cabeza (la melena que cae a los costados), front encima de la frente.
// Cada front es un casquete que sigue la elipse por arriba y termina en un flequillo con su propia forma.
const HAIR = {
  // corto con raya: casquete y un mechón que cruza la frente en diagonal
  side: (h, c) => ({
    front: `<path d="${M(pt(h, 172, 8))} ${arc(h, 172, 368, 8)} Q${h.cx + h.rx * .55} ${h.cy - h.ry * .2} ${h.cx + h.rx * .1} ${h.cy - h.ry * .52} Q${h.cx - h.rx * .45} ${h.cy - h.ry * .62} ${pt(h, 186, 2).join(' ')}Z" fill="${c}"/>
      <path d="M${h.cx + h.rx * .08} ${h.cy - h.ry - 6} q-10 22 -2 40" stroke="${shade(c, 1.35)}" stroke-width="5" fill="none" stroke-linecap="round"/>`,
  }),
  // corto texturado: casquete con puntas suaves en el borde
  crop: (h, c) => {
    // mechones: de un punto de la elipse al siguiente con una curva que se abulta hacia afuera, alternando el bulto
    const from = 188, to = 352, n = 8, step = (to - from) / n
    let tufts = ''
    for (let i = 0; i < n; i++) {
      const a = from + i * step
      const ctrl = pt(h, a + step / 2, 22 + (i % 2) * 7), end = pt(h, a + step, 7)
      tufts += ` Q${ctrl.join(' ')} ${end.join(' ')}`
    }
    return { front: `<path d="${M(pt(h, from, 7))}${tufts} Q${h.cx + h.rx * .55} ${h.cy - h.ry * .42} ${h.cx + 8} ${h.cy - h.ry * .52} Q${h.cx - h.rx * .3} ${h.cy - h.ry * .62} ${h.cx - h.rx * .55} ${h.cy - h.ry * .46} Q${h.cx - h.rx * .82} ${h.cy - h.ry * .38} ${pt(h, from, 4).join(' ')}Z" fill="${c}"/>
      <path d="M${h.cx - 18} ${h.cy - h.ry - 4} q12 -10 30 -4 M${h.cx + 24} ${h.cy - h.ry + 6} q12 -6 22 2" stroke="${shade(c, 1.35)}" stroke-width="5" fill="none" stroke-linecap="round"/>` }
  },
  // recogido: pelo largo peinado hacia atrás (la cola no se ve de frente), raya al medio y dos mechones sueltos que
  // caen por los costados de la frente hasta las mejillas
  recogido: (h, c) => {
    const l = shade(c, 1.3)
    const strand = (s) => `<path d="M${h.cx + s * 10} ${h.cy - h.ry * .74} Q${h.cx + s * h.rx * .62} ${h.cy - h.ry * .66} ${h.cx + s * h.rx * .8} ${h.cy - h.ry * .1} Q${h.cx + s * h.rx * .86} ${h.cy + h.ry * .26} ${h.cx + s * h.rx * .74} ${h.cy + h.ry * .36} Q${h.cx + s * h.rx * .72} ${h.cy - h.ry * .04} ${h.cx + s * h.rx * .5} ${h.cy - h.ry * .5} Q${h.cx + s * h.rx * .28} ${h.cy - h.ry * .66} ${h.cx + s * 10} ${h.cy - h.ry * .74}Z" fill="${c}"/>`
    return {
      back: `<ellipse cx="${h.cx + h.rx * .5}" cy="${h.cy - h.ry * .5}" rx="22" ry="18" fill="${shade(c, .85)}"/>`,
      front: `<path d="${M(pt(h, 182, 6))} ${arc(h, 182, 358, 7)} Q${h.cx + h.rx * .7} ${h.cy - h.ry * .66} ${h.cx} ${h.cy - h.ry * .78} Q${h.cx - h.rx * .7} ${h.cy - h.ry * .66} ${pt(h, 182, 4).join(' ')}Z" fill="${c}"/>
        ${strand(-1)}${strand(1)}
        <path d="M${h.cx} ${h.cy - h.ry - 6} Q${h.cx + 2} ${h.cy - h.ry * .9} ${h.cx} ${h.cy - h.ry * .78}" stroke="${shade(c, .7)}" stroke-width="3" fill="none"/>
        <path d="M${h.cx - 40} ${h.cy - h.ry + 4} q16 -10 30 -6 M${h.cx + 14} ${h.cy - h.ry + 2} q16 -6 30 2" stroke="${l}" stroke-width="4" fill="none" stroke-linecap="round"/>`,
    }
  },
  // corto clásico: casquete pegado a la cabeza, más bajo a los costados (rebajado) y la línea de la frente pareja,
  // apenas entrada en las sienes
  short: (h, c) => {
    const side = shade(c, 1.12)
    return { front: `<path d="${M(pt(h, 184, 5))} ${arc(h, 184, 356, 9)} L${pt(h, 356, 3).join(' ')} Q${h.cx + h.rx * .86} ${h.cy - h.ry * .3} ${h.cx + h.rx * .7} ${h.cy - h.ry * .52} Q${h.cx + h.rx * .5} ${h.cy - h.ry * .58} ${h.cx} ${h.cy - h.ry * .6} Q${h.cx - h.rx * .5} ${h.cy - h.ry * .58} ${h.cx - h.rx * .7} ${h.cy - h.ry * .52} Q${h.cx - h.rx * .86} ${h.cy - h.ry * .3} ${pt(h, 184, 3).join(' ')}Z" fill="${c}"/>
      <path d="M${pt(h, 186, 4).join(' ')} Q${h.cx - h.rx * .98} ${h.cy - h.ry * .5} ${h.cx - h.rx * .9} ${h.cy - h.ry * .62} M${pt(h, 354, 4).join(' ')} Q${h.cx + h.rx * .98} ${h.cy - h.ry * .5} ${h.cx + h.rx * .9} ${h.cy - h.ry * .62}" stroke="${side}" stroke-width="6" fill="none" stroke-linecap="round" opacity=".5"/>
      <path d="M${h.cx - 30} ${h.cy - h.ry - 2} q22 -12 52 -4" stroke="${shade(c, 1.4)}" stroke-width="5" fill="none" stroke-linecap="round"/>` }
  },
  // melena recta con flequillo hasta las cejas
  bob: (h, c) => ({
    back: `<path d="${M(pt(h, 160, 16))} ${arc(h, 160, 380, 16)} L${h.cx + h.rx + 14} ${h.cy + h.ry * .75} Q${h.cx + h.rx} ${h.cy + h.ry * .95} ${h.cx + h.rx * .62} ${h.cy + h.ry * .8} L${h.cx - h.rx * .62} ${h.cy + h.ry * .8} Q${h.cx - h.rx} ${h.cy + h.ry * .95} ${h.cx - h.rx - 14} ${h.cy + h.ry * .75}Z" fill="${c}"/>`,
    front: `<path d="${M(pt(h, 178, 10))} ${arc(h, 178, 362, 10)} L${h.cx + h.rx * .92} ${h.cy - h.ry * .3} Q${h.cx} ${h.cy - h.ry * .42} ${h.cx - h.rx * .92} ${h.cy - h.ry * .3}Z" fill="${c}"/>`,
  }),
  // largo ondulado, con raya al medio
  long: (h, c) => ({
    back: `<path d="${M(pt(h, 150, 18))} ${arc(h, 150, 390, 18)} C${h.cx + h.rx + 34} ${h.cy + h.ry * .7} ${h.cx + h.rx - 6} ${h.cy + h.ry * 1} ${h.cx + h.rx + 14} ${h.cy + h.ry * 1.32} L${h.cx - h.rx - 14} ${h.cy + h.ry * 1.32} C${h.cx - h.rx + 6} ${h.cy + h.ry * 1} ${h.cx - h.rx - 34} ${h.cy + h.ry * .7} ${pt(h, 150, 18).join(' ')}Z" fill="${c}"/>`,
    front: `<path d="${M(pt(h, 176, 9))} ${arc(h, 176, 364, 9)} Q${h.cx + h.rx * .7} ${h.cy - h.ry * .7} ${h.cx + 4} ${h.cy - h.ry * .9} Q${h.cx - h.rx * .7} ${h.cy - h.ry * .7} ${pt(h, 176, 4).join(' ')}Z" fill="${c}"/>`,
  }),
  // rizos: bolitas sobre la línea del cráneo
  curly: (h, c, hatted) => {
    const puffs = (pad, r, from, to, step) => { let s = ''; for (let a = from; a <= to; a += step) { const [x, y] = pt(h, a, pad); s += `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}"/>` } return s }
    // con gorro, los rizos sólo asoman a los costados, por debajo del ala
    if (hatted) return { back: puffs(10, 24, 150, 200, 16) + puffs(10, 24, 340, 390, 16), front: '' }
    return { back: puffs(14, 26, 160, 380, 20), front: puffs(4, 20, 200, 340, 20) + `<path d="${M(pt(h, 196, 4))} ${arc(h, 196, 344, 4)} Q${h.cx} ${h.cy - h.ry * .5} ${pt(h, 196, 4).join(' ')}Z" fill="${c}"/>` }
  },
  // moño alto y peinado tirante
  bun: (h, c, hatted) => ({
    back: `<circle cx="${h.cx}" cy="${h.cy - h.ry - 22}" r="30" fill="${c}"/>`,
    front: `<path d="${M(pt(h, 182, 7))} ${arc(h, 182, 358, 7)} Q${h.cx + h.rx * .6} ${h.cy - h.ry * .62} ${h.cx} ${h.cy - h.ry * .72} Q${h.cx - h.rx * .6} ${h.cy - h.ry * .62} ${pt(h, 182, 4).join(' ')}Z" fill="${c}"/>
      ${hatted ? '' : `<path d="M${h.cx - 30} ${h.cy - h.ry - 30} q30 -14 60 0" stroke="${shade(c, 1.35)}" stroke-width="5" fill="none" stroke-linecap="round"/>`}`,
  }),
  // rapado: casquete fino y oscuro
  buzz: (h, c) => ({ front: `<path d="${M(pt(h, 188, 4))} ${arc(h, 188, 352, 4)} Q${h.cx} ${h.cy - h.ry * .62} ${pt(h, 188, 2).join(' ')}Z" fill="${c}"/>` }),
  // gorro de lana sobre la cabeza
  beanie: (h, c) => ({
    front: `<path d="${M(pt(h, 186, 12))} ${arc(h, 186, 354, 12)}Z" fill="${c}"/><circle cx="${h.cx}" cy="${h.cy - h.ry - 14}" r="16" fill="${shade(c, 1.25)}"/>
      <path d="${M(pt(h, 186, 14))} ${arc(h, 186, 354, 14)} L${pt(h, 354, 14)[0]} ${pt(h, 354, 14)[1] + 26} ${arc(h, 354, 186, 12).replace(/L([\d.]+) ([\d.]+)/g, (m, x, y) => `L${x} ${r1(+y + 26)}`)}Z" fill="${shade(c, .8)}"/>`,
  }),
}

// LOS GORROS: una capa aparte, encima del pelo, así cualquier peinado lleva cualquier gorro. Todos lisos: sin letras
// ni marcas. Para que no floten, cada gorro se arma con dos medidas:
//   · hp, cuánto abulta el peinado que tapa (HAIR_VOL): el gorro se apoya por fuera del pelo, no adentro de él;
//   · la línea del gorro (hatLine): el borde de abajo, que va de una sien a la otra abrazando la frente, más bajo en
//     el medio, como se ve una prenda redonda puesta en la cabeza.
const HAIR_VOL = { curly: 22, long: 12, bob: 12, recogido: 8 } // el resto, aplastado bajo el gorro: 6
// los peinados cortos quedan enteros debajo del gorro: no asoma nada (una patilla suelta se veía como un recorte)
const SHORT_HAIR = ['side', 'crop', 'short', 'buzz', 'bun', 'beanie']
function hatLine(h, hp) {
  const L = pt(h, 200, hp), R = pt(h, 340, hp), C = [h.cx, h.cy - h.ry * .3]
  // un punto del borde, de t = 0 (sien izquierda) a 1 (sien derecha)
  const at = (t) => [r1((1 - t) ** 2 * L[0] + 2 * t * (1 - t) * C[0] + t * t * R[0]), r1((1 - t) ** 2 * L[1] + 2 * t * (1 - t) * C[1] + t * t * R[1])]
  // el mismo borde corrido dy (para el puño o la cinta), de derecha a izquierda
  const back = (dy) => `Q${C[0]} ${r1(C[1] + dy)} ${L[0]} ${r1(L[1] + dy)}`
  // la esquina de cada costado: del arco de la copa baja redondeada hasta el borde
  const corner = (P, side) => `Q${r1(P[0] + 4 * side)} ${r1(P[1] - 10)} ${P[0]} ${P[1]}`
  return { L, R, C, at, edge: `${corner(R, 1)} Q${C[0]} ${C[1]} ${L[0]} ${L[1]}`, back, top: h.cy - h.ry - hp }
}
const HATS = {
  // gorro de lana: la copa sigue la cabeza por fuera del pelo, el puño tejido abraza la frente, pompón arriba
  lana: (h, c, hp) => {
    const d = shade(c, .8), k = hatLine(h, hp), band = 24
    const dome = `${M(k.L)} ${arc(h, 200, 340, hp + 2)} ${k.edge}Z`
    const cuff = `M${k.L[0]} ${k.L[1] - band} Q${k.C[0]} ${k.C[1] - band} ${k.R[0]} ${k.R[1] - band} L${k.R[0]} ${k.R[1]} ${k.edge}Z`
    let ribs = ''
    for (let t = .05; t < .97; t += .075) { const [x, y] = k.at(t); ribs += `M${x} ${r1(y - band + 4)} v${band - 7} ` }
    return `${cut(`<path d="${dome}" fill="${c}"/><circle cx="${h.cx}" cy="${k.top - 16}" r="19" fill="${shade(c, 1.22)}"/>`)}
      ${soft(`<path d="${cuff}" fill="${d}"/>`)}
      <path d="${ribs}" stroke="${shade(c, .64)}" stroke-width="3" stroke-linecap="round"/>`
  },
  // chullo: ceñido como el de lana, con orejeras que cuelgan del borde del gorro y tapan las orejas (lengüetas
  // redondeadas), cordones con borla, una franja en zigzag y pompón
  chullo: (h, c, hp) => {
    const d = shade(c, .78), k = hatLine(h, hp)
    const ear = h.cy + h.ry * .42 // hasta dónde baja la orejera: un poco más abajo de la oreja
    const flap = (side) => {
      const outer = pt(h, side < 0 ? 190 : 350, hp + 2), inner = k.at(side < 0 ? .1 : .9)
      const tipX = (outer[0] + inner[0]) / 2 - 4 * side
      return `<path d="M${outer[0]} ${outer[1]} Q${outer[0] - 6 * side} ${ear - 30} ${tipX} ${ear} Q${inner[0] + 10 * side} ${ear - 26} ${inner[0]} ${inner[1]}Z" fill="${c}"/>
        <path d="M${tipX} ${ear} q${-2 * side} 18 ${2 * side} 34" stroke="${d}" stroke-width="5" fill="none" stroke-linecap="round"/><circle cx="${tipX + 2 * side}" cy="${ear + 38}" r="8" fill="${d}"/>`
    }
    const zig = []
    for (let a = 214, i = 0; a <= 326; a += 7, i++) zig.push(pt(h, a, hp - (i % 2 ? 22 : 10)))
    return `${cut(`${flap(-1)}${flap(1)}<path d="${M(pt(h, 190, hp + 2))} ${arc(h, 190, 350, hp + 2)} L${k.R[0]} ${k.R[1]} ${k.edge}Z" fill="${c}"/><circle cx="${h.cx}" cy="${k.top - 14}" r="15" fill="${shade(c, 1.2)}"/>`)}
      <path d="M${zig.map((q) => q.join(' ')).join(' L')}" stroke="#f1e4c7" stroke-width="6" fill="none" stroke-linejoin="round" stroke-linecap="round"/>
      <path d="M${k.R[0]} ${k.R[1]} ${k.edge}" stroke="${d}" stroke-width="8" fill="none" stroke-linecap="round"/>`
  },
  // cachucha: la copa en gajos se apoya en la línea del gorro y la visera sale del medio de ese borde
  cachucha: (h, c, hp) => {
    const d = shade(c, .74), l = shade(c, 1.2), k = hatLine(h, hp - 2), [vx0, vy0] = k.at(.16), [vx1, vy1] = k.at(.84), [mx, my] = k.at(.5)
    return `${cut(`<path d="${M(k.L)} ${arc(h, 200, 340, hp)} ${k.edge}Z" fill="${c}"/>`)}
      <path d="M${h.cx} ${k.top} Q${h.cx - h.rx * .4} ${k.top + 30} ${k.at(.28).join(' ')} M${h.cx} ${k.top} Q${h.cx + h.rx * .4} ${k.top + 30} ${k.at(.72).join(' ')}" stroke="${d}" stroke-width="3" fill="none"/>
      <circle cx="${h.cx}" cy="${k.top + 2}" r="7" fill="${l}"/>
      ${soft(`<path d="M${vx0} ${vy0} Q${mx} ${my + 40} ${vx1} ${vy1} Q${mx} ${my + 6} ${vx0} ${vy0}Z" fill="${d}"/>`)}`
  },
  // cachucha al revés: la visera asoma detrás de la coronilla y adelante, sobre la frente, se ve el broche
  reves: (h, c, hp) => {
    const d = shade(c, .74), k = hatLine(h, hp - 2), [mx, my] = k.at(.5)
    return `${cut(`<path d="M${h.cx - 50} ${k.top + 14} Q${h.cx} ${k.top - 30} ${h.cx + 50} ${k.top + 14}Z" fill="${d}"/>`)}
      ${cut(`<path d="${M(k.L)} ${arc(h, 200, 340, hp)} ${k.edge}Z" fill="${c}"/>`)}
      <path d="M${mx - 20} ${my - 1} a20 16 0 0 1 40 0Z" fill="${d}"/><path d="M${mx - 26} ${my - 22} h52" stroke="${shade(c, 1.2)}" stroke-width="4" stroke-linecap="round"/>`
  },
  // pescador: la copa nace de la línea del gorro y el ala la rodea, cayendo un poco más adelante que a los costados
  pescador: (h, c, hp) => {
    const d = shade(c, .78), l = shade(c, 1.15), k = hatLine(h, hp)
    const top = k.top - 10, w = h.rx + hp
    const crown = `M${k.L[0] + 8} ${k.L[1]} L${h.cx - w * .72} ${top + 12} Q${h.cx} ${top - 6} ${h.cx + w * .72} ${top + 12} L${k.R[0] - 8} ${k.R[1]} ${k.edge}Z`
    const brimL = [k.L[0] - 30, k.L[1] + 10], brimR = [k.R[0] + 30, k.R[1] + 10], [mx, my] = k.at(.5)
    return `${cut(`<path d="${crown}" fill="${c}"/>`)}
      <path d="M${k.L[0] + 4} ${k.L[1] - 14} Q${k.C[0]} ${k.C[1] - 14} ${k.R[0] - 4} ${k.R[1] - 14}" stroke="${d}" stroke-width="9" fill="none"/>
      ${cut(`<path d="M${brimL[0]} ${brimL[1]} Q${h.cx} ${k.C[1] - 34} ${brimR[0]} ${brimR[1]} Q${brimR[0] - 26} ${brimR[1] + 22} ${mx} ${my + 16} Q${brimL[0] + 26} ${brimL[1] + 22} ${brimL[0]} ${brimL[1]}Z" fill="${l}"/>`)}`
  },
  // boina: un disco blando que se apoya en la línea del gorro y se infla hacia un costado, con su cabito arriba
  boina: (h, c, hp) => {
    const d = shade(c, .76), k = hatLine(h, hp - 4), top = k.top
    const body = `M${k.L[0]} ${k.L[1]} C${k.L[0] - 34} ${k.L[1] - 44} ${h.cx - h.rx * .7} ${top - 24} ${h.cx + 10} ${top - 18} C${h.cx + h.rx + hp + 46} ${top - 12} ${k.R[0] + 40} ${k.R[1] - 30} ${k.R[0]} ${k.R[1]} ${k.edge}Z`
    return `${cut(`<rect x="${h.cx + 4}" y="${top - 34}" width="8" height="16" rx="4" fill="${d}"/><path d="${body}" fill="${c}"/>`)}
      <path d="M${k.L[0] + 2} ${k.L[1] - 4} Q${k.C[0]} ${k.C[1] - 4} ${k.R[0] - 2} ${k.R[1] - 4}" stroke="${d}" stroke-width="8" fill="none" stroke-linecap="round"/>`
  },
}

// Lo que se pone encima: lentes, audífonos, aretes, barba, pecas.
const EXTRAS = {
  glasses: (p, h) => `<g class="cut-soft" fill="none" stroke="#13323a" stroke-width="6"><rect x="${h.cx - 64}" y="${h.cy - 22}" width="54" height="46" rx="${p.glassesRound ? 23 : 14}"/><rect x="${h.cx + 10}" y="${h.cy - 22}" width="54" height="46" rx="${p.glassesRound ? 23 : 14}"/><path d="M${h.cx - 10} ${h.cy - 2} h20"/></g>`,
  headphones: (p, h) => `<g class="cut"><path d="${M(pt(h, 180, 20))} ${arc(h, 180, 360, 20)}" fill="none" stroke="${p.gear}" stroke-width="13" stroke-linecap="round"/><rect x="${h.cx - h.rx - 22}" y="${h.cy - 14}" width="30" height="54" rx="13" fill="${p.gear}"/><rect x="${h.cx + h.rx - 8}" y="${h.cy - 14}" width="30" height="54" rx="13" fill="${p.gear}"/></g>`,
  earrings: (p, h) => `<g class="cut-soft"><circle cx="${h.cx - h.rx - 2}" cy="${h.cy + 34}" r="9" fill="none" stroke="${p.gear}" stroke-width="5"/><circle cx="${h.cx + h.rx + 2}" cy="${h.cy + 34}" r="9" fill="none" stroke="${p.gear}" stroke-width="5"/></g>`,
  // LAS BARBAS: todas del tono de una barba corta (el color del pelo mezclado con la piel) y armadas sobre la forma de
  // la cara. corta: franja por la mandíbula y bigote · tupida: también las mejillas · delgada: una línea fina por el
  // borde de la mandíbula · chivera: bigote y barba sólo en el mentón · candado: bigote unido a la chivera alrededor de
  // la boca · bigote: sólo el bigote
  beard: (p, h, style = 'corta') => {
    const c = mix(p.hairColor, p.skin, style === 'tupida' ? .12 : .28), mouthY = h.cy + h.ry * .56, chin = h.cy + h.ry + 10, cx = h.cx
    const rxB = h.rxB || h.rx
    const mustache = (w = 30, t = 0) => `<path d="M${cx - w} ${mouthY - 12 - t} q${w * .47} ${-11 - t} ${w} ${-5} q${w * .53} ${-6} ${w} ${5 + t} q${-w * .5} ${6 + t} ${-w} ${1} q${-w * .5} ${5 + t} ${-w} ${-1}Z" fill="${c}"/>`
    const jaw = `${M(pt(h, 194, 2))} ${arc(h, 194, 166, 2)} Q${cx - rxB * .62} ${chin - 4} ${cx - 24} ${chin} Q${cx} ${chin + 6} ${cx + 24} ${chin} Q${cx + rxB * .62} ${chin - 4} ${pt(h, 14, 2).join(' ')} ${arc(h, 14, -14, 2)}`
    const cheeks = (y1, y2) => `L${pt(h, -14, -12).join(' ')} Q${cx + rxB * .84} ${h.cy + h.ry * y1} ${cx + 32} ${h.cy + h.ry * y2} Q${cx} ${h.cy + h.ry * (y2 - .08)} ${cx - 32} ${h.cy + h.ry * y2} Q${cx - rxB * .84} ${h.cy + h.ry * y1} ${pt(h, 194, -12).join(' ')}Z`
    const shapes = {
      corta: `<path d="${jaw} ${cheeks(.6, .68)}" fill="${c}"/>${mustache()}`,
      tupida: `<path d="${jaw} ${cheeks(.3, .5)}" fill="${c}"/>${mustache(32, 2)}`,
      delgada: `<path d="${jaw} L${pt(h, -14, -8).join(' ')} ${arc(h, -14, 14, -8)} Q${cx + rxB * .58} ${chin - 14} ${cx} ${chin - 6} Q${cx - rxB * .58} ${chin - 14} ${pt(h, 166, -8).join(' ')} ${arc(h, 166, 194, -8)}Z" fill="${c}"/>`,
      chivera: `${mustache(26)}<path d="M${cx - 20} ${mouthY + 14} Q${cx - 24} ${chin - 4} ${cx} ${chin + 4} Q${cx + 24} ${chin - 4} ${cx + 20} ${mouthY + 14} Q${cx} ${mouthY + 22} ${cx - 20} ${mouthY + 14}Z" fill="${c}"/>`,
      candado: `<path fill-rule="evenodd" d="M${cx - 38} ${mouthY - 12} Q${cx - 46} ${chin - 6} ${cx} ${chin + 4} Q${cx + 46} ${chin - 6} ${cx + 38} ${mouthY - 12} Q${cx} ${mouthY - 26} ${cx - 38} ${mouthY - 12}Z M${cx - 27} ${mouthY - 2} Q${cx} ${mouthY + 24} ${cx + 27} ${mouthY - 2} Q${cx} ${mouthY - 8} ${cx - 27} ${mouthY - 2}Z" fill="${c}"/>`,
      bigote: mustache(34, 3),
    }
    return `<g class="cut-soft">${shapes[style] || shapes.corta}</g>`
  },


  freckles: (p, h) => [[-52, 36], [-42, 44], [-32, 36], [32, 36], [42, 44], [52, 36]].map(([x, y]) => `<circle cx="${h.cx + x}" cy="${h.cy + y}" r="3" fill="#962b19" opacity=".5"/>`).join(''),
}

// La cara: ojos, cejas, nariz y las cuatro bocas. Es una caricatura: ojos grandes con pupila chica (más cómicos),
// cejas gruesas, narices de varias formas y, a quien le toca, dientes salidos.
//   f.eye: tamaño de ojo · f.nose: 'bulb' | 'long' | 'button' | 'hook' · f.teeth: 'buck' | 'grin' · f.lids: párpado caído
const NOSES = {
  none: () => '',
  // mico: dos fosas en el hocico
  // oso, panda, león: triángulo redondeado con brillo
  bear: (cx, cy, c) => `<path d="M${cx - 18} ${cy + 14} Q${cx} ${cy + 8} ${cx + 18} ${cy + 14} Q${cx + 14} ${cy + 30} ${cx} ${cy + 34} Q${cx - 14} ${cy + 30} ${cx - 18} ${cy + 14}Z" fill="${c}"/><ellipse cx="${cx - 5}" cy="${cy + 16}" rx="5" ry="3" fill="#fbf4e4" opacity=".5"/>`,
  // koala: grande y ovalada, vertical
  koala: (cx, cy, c) => `<ellipse cx="${cx}" cy="${cy + 22}" rx="17" ry="24" fill="${c}"/><ellipse cx="${cx - 5}" cy="${cy + 10}" rx="5" ry="4" fill="#fbf4e4" opacity=".45"/>`,
  // cerdito: trompa con dos fosas
  snout: (cx, cy, c) => `<ellipse cx="${cx}" cy="${cy + 24}" rx="30" ry="21" fill="${c}"/><ellipse cx="${cx - 10}" cy="${cy + 24}" rx="5" ry="7" fill="${shade(c, .62)}"/><ellipse cx="${cx + 10}" cy="${cy + 24}" rx="5" ry="7" fill="${shade(c, .62)}"/>`,
  // mapache: botón negro chiquito
  dot: (cx, cy, c) => `<ellipse cx="${cx}" cy="${cy + 20}" rx="12" ry="9" fill="${c}"/>`,
  // gato, conejo, ratón: triangulito invertido
  cat: (cx, cy, c) => `<path d="M${cx - 10} ${cy + 14} Q${cx} ${cy + 10} ${cx + 10} ${cy + 14} Q${cx + 4} ${cy + 24} ${cx} ${cy + 25} Q${cx - 4} ${cy + 24} ${cx - 10} ${cy + 14}Z" fill="${c}"/>`,
  // gorila: ancha y plana, con dos fosas grandes
  flat: (cx, cy, c) => `<path d="M${cx - 26} ${cy + 26} Q${cx - 24} ${cy + 4} ${cx} ${cy + 4} Q${cx + 24} ${cy + 4} ${cx + 26} ${cy + 26} Q${cx} ${cy + 36} ${cx - 26} ${cy + 26}Z" fill="${c}"/><ellipse cx="${cx - 11}" cy="${cy + 24}" rx="8" ry="6" fill="#1d1a19"/><ellipse cx="${cx + 11}" cy="${cy + 24}" rx="8" ry="6" fill="#1d1a19"/>`,
  nostrils: (cx, cy, c) => `<ellipse cx="${cx - 9}" cy="${cy + 24}" rx="5" ry="4" fill="${c}"/><ellipse cx="${cx + 9}" cy="${cy + 24}" rx="5" ry="4" fill="${c}"/>`,
  bulb: (cx, cy, c) => `<ellipse cx="${cx}" cy="${cy + 22}" rx="20" ry="17" fill="${c}"/><ellipse cx="${cx - 6}" cy="${cy + 17}" rx="5" ry="4" fill="#fbf4e4" opacity=".55"/>`,
  long: (cx, cy, c) => `<path d="M${cx - 6} ${cy - 4} q-6 30 -14 40 q14 10 30 0 q-6 -16 -10 -40Z" fill="${c}"/>`,
  button: (cx, cy, c) => `<circle cx="${cx}" cy="${cy + 22}" r="11" fill="${c}"/>`,
  hook: (cx, cy, c) => `<path d="M${cx - 4} ${cy - 6} q30 18 18 42 q-10 8 -24 2 q10 -6 6 -12 q-12 -20 0 -32Z" fill="${c}"/>`,
}
// El pico del pato: ancho y plano, como una paleta redondeada que sobresale de la cara (no la puntita de un pollo).
// La parte de arriba lleva un brillo y las fosas (sin raya de comisura: con el pico abierto parecía otra boca); la
// de abajo, más angosta. Al hablar el pico se
// mueve como una mandíbula (personajes.css: .beak-jaw baja, .beak-top sube apenas, .beak-inside se abre desde arriba),
// no con el estirón de la boca de las personas, que en un pico se veía falso.
function beak(cx, y, c, w = 74) {
  // pico de tucán (w > 100): grande, cae por delante del mentón, con la punta roja y una arista oscura
  if (w > 100) {
    const tip = '#c5381f', low = (dy) => `<path d="M${cx - 22} ${y + 18 + dy} Q${cx - 26} ${y + 58 + dy} ${cx + 2} ${y + 78 + dy} Q${cx + 8} ${y + 56 + dy} ${cx + 20} ${y + 20 + dy}Z" fill="${shade(c, .82)}"/>`
    const top = `<path d="M${cx - 36} ${y - 16} Q${cx} ${y - 30} ${cx + 36} ${y - 16} Q${cx + 40} ${y + 30} ${cx + 8} ${y + 76} Q${cx - 2} ${y + 84} ${cx - 8} ${y + 72} Q${cx - 34} ${y + 30} ${cx - 36} ${y - 16}Z" fill="${c}"/>
      <path d="M${cx - 2} ${y + 60} Q${cx + 6} ${y + 74} ${cx + 8} ${y + 76} Q${cx - 2} ${y + 84} ${cx - 8} ${y + 72} Q${cx - 6} ${y + 64} ${cx - 2} ${y + 60}Z" fill="${tip}"/>
      <path d="M${cx - 30} ${y - 14} Q${cx} ${y - 24} ${cx + 30} ${y - 14}" stroke="#2a2523" stroke-width="5" fill="none" stroke-linecap="round"/>
      <path d="M${cx + 4} ${y - 8} Q${cx + 14} ${y + 30} ${cx + 4} ${y + 62}" stroke="${shade(c, 1.15)}" stroke-width="5" fill="none" stroke-linecap="round"/>`
    return `<g class="m-smile">${soft(low(0) + top)}</g>
      <g class="m-talk"><g class="beak-inside"><ellipse cx="${cx - 2}" cy="${y + 58}" rx="16" ry="22" fill="#6e1f12"/></g><g class="beak-jaw">${soft(low(10))}</g><g class="beak-top big">${soft(top)}</g></g>
      <g class="m-think"><g transform="rotate(-6 ${cx} ${y})">${soft(low(0) + top)}</g></g>
      <g class="m-flat">${soft(low(-2) + top)}</g>`
  }
  // pico chico (búho): un ganchito que apunta hacia abajo, y abajo una puntita que se abre al hablar
  if (w < 30) {
    const d = shade(c, .75)
    const top = `<path d="M${cx - 14} ${y - 12} Q${cx} ${y - 18} ${cx + 14} ${y - 12} Q${cx + 8} ${y + 10} ${cx} ${y + 20} Q${cx - 8} ${y + 10} ${cx - 14} ${y - 12}Z" fill="${c}"/>`
    const low = (dy) => `<path d="M${cx - 8} ${y + 12 + dy} Q${cx} ${y + 26 + dy} ${cx + 8} ${y + 12 + dy}Z" fill="${d}"/>`
    return `<g class="m-smile">${soft(low(-2) + top)}</g>
      <g class="m-talk"><g class="beak-inside"><ellipse cx="${cx}" cy="${y + 18}" rx="9" ry="9" fill="#6e1f12"/></g><g class="beak-jaw">${soft(low(6))}</g><g class="beak-top">${soft(top)}</g></g>
      <g class="m-think"><g transform="rotate(-8 ${cx} ${y})">${soft(low(-2) + top)}</g></g>
      <g class="m-flat">${soft(low(-3) + top)}</g>`
  }
  const d = shade(c, .78), l = shade(c, 1.12), jaw = shade(c, .9)
  const upper = `<path d="M${cx - w} ${y + 6} C${cx - w - 6} ${y - 18} ${cx - 30} ${y - 24} ${cx} ${y - 22} C${cx + 30} ${y - 24} ${cx + w + 6} ${y - 18} ${cx + w} ${y + 6} C${cx + w - 6} ${y + 24} ${cx + 30} ${y + 26} ${cx} ${y + 24} C${cx - 30} ${y + 26} ${cx - w + 6} ${y + 24} ${cx - w} ${y + 6}Z" fill="${c}"/>
    <path d="M${cx - 44} ${y - 12} Q${cx} ${y - 22} ${cx + 44} ${y - 12}" stroke="${l}" stroke-width="5" fill="none" stroke-linecap="round"/>
    <ellipse cx="${cx - 14}" cy="${y - 6}" rx="5" ry="3" fill="${d}"/><ellipse cx="${cx + 14}" cy="${y - 6}" rx="5" ry="3" fill="${d}"/>`
  const lower = (dy) => `<path d="M${cx - w + 14} ${y + 14 + dy} C${cx - w + 10} ${y + 34 + dy} ${cx - 24} ${y + 40 + dy} ${cx} ${y + 40 + dy} C${cx + 24} ${y + 40 + dy} ${cx + w - 10} ${y + 34 + dy} ${cx + w - 14} ${y + 14 + dy}Z" fill="${jaw}"/>`
  return `<g class="m-smile">${soft(lower(0) + upper)}</g>
    <g class="m-talk"><g class="beak-inside"><path d="M${cx - w + 14} ${y + 14} Q${cx} ${y + 22} ${cx + w - 14} ${y + 14} Q${cx + w - 20} ${y + 36} ${cx} ${y + 38} Q${cx - w + 20} ${y + 36} ${cx - w + 14} ${y + 14}Z" fill="#6e1f12"/><ellipse cx="${cx}" cy="${y + 32}" rx="20" ry="6" fill="#e5592a"/></g>
      <g class="beak-jaw">${soft(lower(6))}</g><g class="beak-top">${soft(upper)}</g></g>
    <g class="m-think"><g transform="rotate(-7 ${cx} ${y})">${soft(lower(-2) + upper)}</g></g>
    <g class="m-flat">${soft(lower(-4) + upper)}</g>`
}
function face(h, f) {
  const { cx, cy } = h, eyeY = cy - 2, gap = h.rx * .42, eye = f.eye || 25, mouthY = cy + h.ry * .56
  const L = cx - gap, R = cx + gap, pr = eye * .36
  const lash = f.lashes ? `<path d="M${L - eye * .8} ${eyeY - eye * .6} l-10 -8 M${L - eye * .5} ${eyeY - eye * .85} l-6 -10 M${R + eye * .8} ${eyeY - eye * .6} l10 -8 M${R + eye * .5} ${eyeY - eye * .85} l6 -10" stroke="#13323a" stroke-width="4" stroke-linecap="round"/>` : ''
  const lids = f.lids ? `<path d="M${L - eye} ${eyeY - 2} a${eye} ${eye} 0 0 1 ${eye * 2} 0Z M${R - eye} ${eyeY - 2} a${eye} ${eye} 0 0 1 ${eye * 2} 0Z" fill="${f.nose}"/>` : ''
  // Los dientes se recortan con la misma forma de la boca (clipPath por recuadro): cuelgan del labio de arriba y
  // nunca asoman por encima. Los salidos son dos paletas un poco más largas que bajan desde ese borde.
  const smileD = `M${cx - 30} ${mouthY - 6} q30 34 60 0 q-30 14 -60 0Z`
  const id = f.id, upper = mouthY + 1 // el labio de arriba de la sonrisa, en el centro
  const teethSmile = f.teeth === 'buck' ? `<rect x="${cx - 11}" y="${upper - 6}" width="10" height="15" rx="3" fill="#fbf4e4"/><rect x="${cx + 1}" y="${upper - 6}" width="10" height="15" rx="3" fill="#fbf4e4"/>`
    : f.teeth === 'grin' ? `<rect x="${cx - 30}" y="${mouthY - 8}" width="60" height="16" fill="#fbf4e4"/>` : ''
  const teethTalk = f.teeth === 'buck' ? `<rect x="${cx - 10}" y="${mouthY - 14}" width="9" height="15" rx="3" fill="#fbf4e4"/><rect x="${cx + 1}" y="${mouthY - 14}" width="9" height="15" rx="3" fill="#fbf4e4"/>`
    : f.teeth === 'grin' ? `<rect x="${cx - 20}" y="${mouthY - 14}" width="40" height="9" fill="#fbf4e4"/>` : ''
  const clips = `<defs><clipPath id="ms-${id}"><path d="${smileD}"/></clipPath><clipPath id="mt-${id}"><ellipse cx="${cx}" cy="${mouthY + 4}" rx="20" ry="17"/></clipPath></defs>`
  return `
    <g class="eyes">${soft(`<ellipse cx="${L}" cy="${eyeY}" rx="${eye * .9}" ry="${eye}" fill="#fbf4e4"/><ellipse cx="${R}" cy="${eyeY}" rx="${eye * .9}" ry="${eye * 1.06}" fill="#fbf4e4"/>`)}
      <g class="pupils"><circle cx="${L + 3}" cy="${eyeY + 4}" r="${pr}" fill="#13323a"/><circle cx="${R - 3}" cy="${eyeY + 4}" r="${pr}" fill="#13323a"/>
        <circle cx="${L + 3 + pr * .4}" cy="${eyeY + 4 - pr * .4}" r="${pr * .32}" fill="#f6ecd6"/><circle cx="${R - 3 + pr * .4}" cy="${eyeY + 4 - pr * .4}" r="${pr * .32}" fill="#f6ecd6"/></g>
      ${lids}${lash}</g>
    <g class="brow-l">${soft(`<path d="M${L - 24} ${eyeY - eye - 6} q22 -18 44 -4 l-4 9 q-18 -10 -36 3Z" fill="${f.brow}"/>`)}</g>
    <g class="brow-r">${soft(`<path d="M${R + 24} ${eyeY - eye - 6} q-22 -18 -44 -4 l4 9 q18 -10 36 3Z" fill="${f.brow}"/>`)}</g>
    ${clips}
    ${f.beak ? beak(cx, mouthY - 8, f.beak, f.beakW) : `<g class="m-smile">${soft(`<path d="${smileD}" fill="#962b19"/>`)}<g clip-path="url(#ms-${id})">${teethSmile}</g></g>
    <g class="m-talk"><g class="mouth">${soft(`<ellipse cx="${cx}" cy="${mouthY + 4}" rx="20" ry="17" fill="#6e1f12"/><ellipse cx="${cx}" cy="${mouthY + 13}" rx="12" ry="6" fill="#e5592a"/>`)}<g clip-path="url(#mt-${id})">${teethTalk}</g></g></g>
    <g class="m-think">${soft(`<path d="M${cx - 16} ${mouthY + 4} q9 -9 18 0 q9 9 18 -3 l2 6 q-11 11 -21 1 q-8 -6 -15 2Z" fill="${f.mouth}"/>`)}</g>
    <g class="m-flat">${soft(`<path d="M${cx - 16} ${mouthY + 2} q16 -6 32 2 l-1 6 q-15 -6 -30 0Z" fill="${f.mouth}"/>`)}${f.teeth === 'buck' ? `<rect x="${cx - 8}" y="${mouthY + 5}" width="7" height="8" rx="2" fill="#fbf4e4"/><rect x="${cx + 1}" y="${mouthY + 5}" width="7" height="8" rx="2" fill="#fbf4e4"/>` : ''}</g>`}
    ${soft(NOSES[f.noseShape || 'button'](cx, cy, f.noseColor))}`
}

// El torso: la chaqueta del equipo, igual para todos en el color de cada uno. Tiene cuello de solapas, cremallera,
// la camiseta asomando en la V y el logo de CreditOp bordado en el pecho (se balancea con el cuerpo).
function torso(p) {
  const j = p.shirt, jd = shade(j, .78), jl = shade(j, 1.18)
  return `<g class="body">
    ${cut(`<path d="M72 306 q6-74 128-78 q122 4 128 78 L336 420 L64 420Z" fill="${j}"/>`)}
    <path d="M172 228 L200 270 L228 228Z" fill="${p.accent || '#f1e4c7'}"/>
    <path d="M181 190 h38 v52 q-19 12 -38 0Z" fill="${shade(p.skin, .86)}"/>
    <path d="M181 190 h38 v18 q-19 10 -38 0Z" fill="${shade(p.skin, .74)}"/>
    <path d="M178 240 q22 16 44 0" stroke="${shade(p.accent || '#f1e4c7', .8)}" stroke-width="6" fill="none" stroke-linecap="round"/>
    <path d="M84 420 V306 q6 -40 30 -58 M316 420 V306 q-6 -40 -30 -58" stroke="${jd}" stroke-width="4" fill="none" stroke-linecap="round"/>
    <path d="M200 268 V420" stroke="${jd}" stroke-width="7"/><path d="M200 268 V420" stroke="${jl}" stroke-width="2" stroke-dasharray="3 3"/>
    ${soft(`<rect x="195" y="270" width="10" height="16" rx="3" fill="${jl}"/>`)}
    ${soft(`<path d="M176 226 L200 268 L172 276 Q154 254 160 230Z M224 226 L200 268 L228 276 Q246 254 240 230Z" fill="${jd}"/>`)}
    ${soft(`<use href="#creditop-logo-mono" x="218" y="285" width="78" height="10" style="color:#ffffff"/>`)}
  </g>`
}

// LOS ANIMALES: misma chaqueta y misma cara animable que las personas; cambia la cabeza. p.species: una clave de
// SPECIES (mico, pato, gorila, oso, panda, koala, mapache, cerdito, oveja, león, gato, zorro, perro, conejo, ratón,
// rana, pingüino, búho, tucán, loro, perezoso, capibara, jaguar)
// (sin species, persona). p.skin es el color del pelaje o de las plumas. Diseños propios: no copian a nadie.
// piezas que comparten los animales
const ANIMAL = {
  // orejas redondas arriba a los costados (oso, panda, koala, león, ratón)
  roundEars: (h, r, c, inner, deg = 222) => [pt(h, deg, -4), pt(h, 540 - deg, -4)].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}"/>${inner ? `<circle cx="${x}" cy="${y + 2}" r="${r * .55}" fill="${inner}"/>` : ''}`).join(''),
  // orejas en punta (mapache, cerdito si caen)
  pointEars: (h, c, inner, drop = 0) => [-1, 1].map((side) => {
    const [x, y] = pt(h, side < 0 ? 228 : 312, -6), tip = [x + side * 14, y - 46 + drop], base = 26
    return `<path d="M${x - base} ${y + 8} L${tip[0]} ${tip[1]} L${x + base} ${y + 8}Z" fill="${c}" stroke="${c}" stroke-width="10" stroke-linejoin="round"/>${inner ? `<path d="M${x - base * .5} ${y + 4} L${tip[0]} ${tip[1] + 16} L${x + base * .5} ${y + 4}Z" fill="${inner}" stroke="${inner}" stroke-width="5" stroke-linejoin="round"/>` : ''}`
  }).join(''),
  // bolitas alrededor de la cabeza (melena, lana)
  puffs: (h, pad, r, from, to, step, c) => { let s = ''; for (let a = from; a <= to; a += step) { const [x, y] = pt(h, a, pad); s += `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}"/>` } return s },
  // bigotes: tres por lado, desde el hocico
  whiskers: (h, c = '#3a2a24') => [-1, 1].map((s) => [-8, 2, 12].map((dy, i) => `<path d="M${h.cx + s * 30} ${h.cy + 34 + dy} q${s * 26} ${-4 + i * 4} ${s * 50} ${-8 + i * 8}" stroke="${c}" stroke-width="3" fill="none" stroke-linecap="round" opacity=".7"/>`).join('')).join(''),
  // orejas caídas a los costados (perro)
  floppyEars: (h, c) => [-1, 1].map((s) => `<path d="M${h.cx + s * (h.rx - 24)} ${h.cy - h.ry + 22} Q${h.cx + s * (h.rx + 30)} ${h.cy - 40} ${h.cx + s * (h.rx + 14)} ${h.cy + 50} Q${h.cx + s * (h.rx - 4)} ${h.cy + 70} ${h.cx + s * (h.rx - 18)} ${h.cy + 34} Q${h.cx + s * (h.rx - 34)} ${h.cy - 20} ${h.cx + s * (h.rx - 24)} ${h.cy - h.ry + 22}Z" fill="${c}"/>`).join(''),
  // orejas largas hacia arriba (conejo)
  longEars: (h, c, inner) => [-1, 1].map((s) => { const x = h.cx + s * 34, y = h.cy - h.ry + 14; return `<g transform="rotate(${s * 10} ${x} ${y})"><ellipse cx="${x}" cy="${y - 62}" rx="24" ry="70" fill="${c}"/><ellipse cx="${x}" cy="${y - 58}" rx="12" ry="54" fill="${inner}"/></g>` }).join(''),
  // hocico claro abajo
  muzzle: (h, c, rx = 48, ry = 34) => `<ellipse cx="${h.cx}" cy="${h.cy + 40}" rx="${rx}" ry="${ry}" fill="${c}"/>`,
}
const SPECIES = {
  // oso de anteojos: pelaje casi negro, anteojos crema alrededor de los ojos que bajan al hocico
  oso: (p, h) => {
    const fur = p.skin, cream = '#ecd9b0'
    return {
      back: ANIMAL.roundEars(h, 26, fur, shade(fur, 1.35)), head: `<ellipse cx="${h.cx}" cy="${h.cy}" rx="${h.rx}" ry="${h.ry}" fill="${fur}"/>`,
      mask: `<path d="M${h.cx - 64} ${h.cy - 28} Q${h.cx - 36} ${h.cy - 50} ${h.cx - 12} ${h.cy - 26} Q${h.cx} ${h.cy - 14} ${h.cx + 12} ${h.cy - 26} Q${h.cx + 36} ${h.cy - 50} ${h.cx + 64} ${h.cy - 28} Q${h.cx + 70} ${h.cy + 4} ${h.cx + 44} ${h.cy + 20} L${h.cx + 40} ${h.cy + 24} Q${h.cx} ${h.cy + 4} ${h.cx - 40} ${h.cy + 24} L${h.cx - 44} ${h.cy + 20} Q${h.cx - 70} ${h.cy + 4} ${h.cx - 64} ${h.cy - 28}Z" fill="${cream}"/>${ANIMAL.muzzle(h, cream)}`,
      nose: 'bear', noseColor: '#1d1a19', brow: shade(fur, .6), mouth: '#3a2015',
    }
  },
  // panda: blanco con orejas y manchas de los ojos negras
  panda: (p, h) => {
    const fur = p.skin, ink = '#22232a'
    return {
      back: ANIMAL.roundEars(h, 28, ink), head: `<ellipse cx="${h.cx}" cy="${h.cy}" rx="${h.rx}" ry="${h.ry}" fill="${fur}"/>`,
      mask: `<ellipse cx="${h.cx - 36}" cy="${h.cy}" rx="30" ry="36" fill="${ink}" transform="rotate(24 ${h.cx - 36} ${h.cy})"/><ellipse cx="${h.cx + 36}" cy="${h.cy}" rx="30" ry="36" fill="${ink}" transform="rotate(-24 ${h.cx + 36} ${h.cy})"/>`,
      nose: 'bear', noseColor: ink, brow: '#5a5b63', mouth: ink,
    }
  },
  // koala: gris, orejas grandes y peludas, nariz grande ovalada
  koala: (p, h) => {
    const fur = p.skin, inner = '#f1e4e0'
    const ear = (side) => { const [x, y] = pt(h, side < 0 ? 200 : 340, 0); return ANIMAL.puffs({ cx: x, cy: y, rx: 0, ry: 0 }, 30, 16, 0, 330, 30, fur) + `<circle cx="${x}" cy="${y}" r="38" fill="${fur}"/><circle cx="${x}" cy="${y + 2}" r="22" fill="${inner}"/>` }
    return { back: ear(-1) + ear(1), head: `<ellipse cx="${h.cx}" cy="${h.cy}" rx="${h.rx}" ry="${h.ry}" fill="${fur}"/>`, mask: ANIMAL.muzzle(h, shade(fur, 1.18), 40, 30),
      nose: 'koala', noseColor: '#2a2b30', brow: shade(fur, .55), mouth: '#2a2b30' }
  },
  // mapache: gris, orejas en punta, antifaz oscuro y cara blanca alrededor
  mapache: (p, h) => {
    const fur = p.skin, ink = '#2a2b30', white = '#f4efe6'
    return {
      back: ANIMAL.pointEars(h, fur, ink), head: `<ellipse cx="${h.cx}" cy="${h.cy}" rx="${h.rx}" ry="${h.ry}" fill="${fur}"/>`,
      mask: `<path d="M${h.cx - 70} ${h.cy - 40} Q${h.cx} ${h.cy - 66} ${h.cx + 70} ${h.cy - 40} Q${h.cx + 40} ${h.cy - 30} ${h.cx} ${h.cy - 34} Q${h.cx - 40} ${h.cy - 30} ${h.cx - 70} ${h.cy - 40}Z" fill="${white}"/>
        <path d="M${h.cx - 88} ${h.cy - 6} Q${h.cx - 50} ${h.cy - 40} ${h.cx} ${h.cy - 18} Q${h.cx + 50} ${h.cy - 40} ${h.cx + 88} ${h.cy - 6} Q${h.cx + 60} ${h.cy + 32} ${h.cx} ${h.cy + 14} Q${h.cx - 60} ${h.cy + 32} ${h.cx - 88} ${h.cy - 6}Z" fill="${ink}"/>${ANIMAL.muzzle(h, white, 44, 30)}`,
      nose: 'dot', noseColor: ink, brow: white, mouth: ink,
    }
  },
  // cerdito: rosado, orejas en punta que caen hacia adelante, trompa
  cerdito: (p, h) => {
    const fur = p.skin
    return { back: ANIMAL.pointEars(h, shade(fur, .9), shade(fur, .78), 18), head: `<ellipse cx="${h.cx}" cy="${h.cy}" rx="${h.rx}" ry="${h.ry}" fill="${fur}"/>`, mask: '',
      nose: 'snout', noseColor: shade(fur, 1.12), brow: shade(fur, .6), mouth: shade(fur, .45) }
  },
  // oveja: cara crema rodeada de lana en bolitas, orejitas de lado
  oveja: (p, h) => {
    const wool = p.skin, face = '#f3dcc2'
    const ears = [-1, 1].map((s) => `<ellipse cx="${h.cx + s * (h.rx + 10)}" cy="${h.cy + 4}" rx="30" ry="14" fill="${shade(face, .9)}" transform="rotate(${s * 18} ${h.cx + s * (h.rx + 10)} ${h.cy + 4})"/>`).join('')
    return { back: ears + ANIMAL.puffs(h, 6, 30, 150, 390, 18, wool), head: `<ellipse cx="${h.cx}" cy="${h.cy + 6}" rx="${h.rx - 14}" ry="${h.ry - 8}" fill="${face}"/>`,
      mask: '', top: ANIMAL.puffs(h, -18, 24, 220, 320, 25, shade(wool, 1.04)),
      nose: 'bear', noseColor: shade(face, .62), brow: shade(face, .5), mouth: '#6e3a2a' }
  },
  // león: cara dorada con melena alrededor y orejas redondas
  // gato: orejas en punta con interior rosado, nariz en triangulito y bigotes
  gato: (p, h) => {
    const fur = p.skin
    return { back: ANIMAL.pointEars(h, fur, '#f2b8b0'), head: `<ellipse cx="${h.cx}" cy="${h.cy}" rx="${h.rx}" ry="${h.ry}" fill="${fur}"/>`, mask: ANIMAL.muzzle(h, shade(fur, 1.2), 40, 26),
      front: ANIMAL.whiskers(h), nose: 'cat', noseColor: '#e98a9a', brow: shade(fur, .55), mouth: '#5a2a1a' }
  },
  // zorro: naranja, orejas grandes con punta oscura, mejillas blancas que suben hasta los ojos
  zorro: (p, h) => {
    const fur = p.skin, white = '#f6efe2', tip = '#3a2a24'
    return { back: ANIMAL.pointEars(h, fur, tip), head: `<ellipse cx="${h.cx}" cy="${h.cy}" rx="${h.rx}" ry="${h.ry}" fill="${fur}"/>`,
      mask: `<path d="M${h.cx - h.rx + 6} ${h.cy + 6} Q${h.cx - 50} ${h.cy - 10} ${h.cx} ${h.cy + 16} Q${h.cx + 50} ${h.cy - 10} ${h.cx + h.rx - 6} ${h.cy + 6} Q${h.cx + h.rx - 18} ${h.cy + h.ry - 4} ${h.cx} ${h.cy + h.ry} Q${h.cx - h.rx + 18} ${h.cy + h.ry - 4} ${h.cx - h.rx + 6} ${h.cy + 6}Z" fill="${white}"/>`,
      nose: 'dot', noseColor: tip, brow: shade(fur, .6), mouth: '#5a2a1a' }
  },
  // perro: orejas caídas, una mancha sobre un ojo, hocico claro y nariz grande
  perro: (p, h) => {
    const fur = p.skin, ear = p.mask || shade(fur, .7)
    return { back: '', head: `<ellipse cx="${h.cx}" cy="${h.cy}" rx="${h.rx}" ry="${h.ry}" fill="${fur}"/>`,
      mask: `<ellipse cx="${h.cx + 36}" cy="${h.cy - 6}" rx="32" ry="30" fill="${ear}"/>${ANIMAL.muzzle(h, shade(fur, 1.22), 46, 32)}`,
      front: ANIMAL.floppyEars(h, ear), nose: 'bear', noseColor: '#22232a', brow: shade(fur, .5), mouth: '#5a2a1a' }
  },
  // conejo: orejas largas con interior rosado, dientes salidos, nariz rosada y bigotes
  conejo: (p, h) => {
    const fur = p.skin
    return { back: ANIMAL.longEars(h, fur, '#f2b8b0'), head: `<ellipse cx="${h.cx}" cy="${h.cy}" rx="${h.rx}" ry="${h.ry}" fill="${fur}"/>`, mask: ANIMAL.muzzle(h, shade(fur, 1.12), 38, 26),
      front: ANIMAL.whiskers(h, shade(fur, .5)), nose: 'cat', noseColor: '#e98a9a', brow: shade(fur, .55), mouth: '#5a2a1a', teeth: 'buck' }
  },
  // ratón: gris, orejas redondas enormes con interior rosado, nariz rosada y bigotes
  raton: (p, h) => {
    const fur = p.skin
    return { back: ANIMAL.roundEars(h, 44, fur, '#f2b8b0', 214), head: `<ellipse cx="${h.cx}" cy="${h.cy}" rx="${h.rx}" ry="${h.ry}" fill="${fur}"/>`, mask: ANIMAL.muzzle(h, shade(fur, 1.15), 36, 24),
      front: ANIMAL.whiskers(h), nose: 'cat', noseColor: '#e98a9a', brow: shade(fur, .55), mouth: '#5a2a1a' }
  },
  // rana: verde, cabeza ancha con dos lomas arriba donde van los ojos y barriga clara en la papada
  rana: (p, h) => {
    const skin = p.skin
    return { back: `<circle cx="${h.cx - 40}" cy="${h.cy - h.ry + 12}" r="34" fill="${skin}"/><circle cx="${h.cx + 40}" cy="${h.cy - h.ry + 12}" r="34" fill="${skin}"/>`,
      head: `<ellipse cx="${h.cx}" cy="${h.cy + 4}" rx="${h.rx + 8}" ry="${h.ry - 6}" fill="${skin}"/>`, mask: `<ellipse cx="${h.cx}" cy="${h.cy + 52}" rx="62" ry="28" fill="${shade(skin, 1.3)}"/>`,
      front: `<circle cx="${h.cx - 52}" cy="${h.cy - 40}" r="5" fill="${shade(skin, .75)}"/><circle cx="${h.cx + 56}" cy="${h.cy - 34}" r="4" fill="${shade(skin, .75)}"/>`,
      nose: 'none', brow: shade(skin, .5), mouth: '#3a2015' }
  },
  // pingüino: cabeza oscura con la cara blanca en forma de corazón y un pico corto
  pinguino: (p, h) => {
    const ink = p.skin
    return { back: '', head: `<ellipse cx="${h.cx}" cy="${h.cy}" rx="${h.rx}" ry="${h.ry}" fill="${ink}"/>`,
      mask: `<path d="M${h.cx} ${h.cy - 20} Q${h.cx - 30} ${h.cy - 64} ${h.cx - 66} ${h.cy - 30} Q${h.cx - 84} ${h.cy + 30} ${h.cx} ${h.cy + h.ry - 6} Q${h.cx + 84} ${h.cy + 30} ${h.cx + 66} ${h.cy - 30} Q${h.cx + 30} ${h.cy - 64} ${h.cx} ${h.cy - 20}Z" fill="#f6f1e6"/>`,
      nose: 'none', brow: '#3a3d45', mouth: '#3a2015', beak: '#f08c3d', beakW: 34 }
  },
  // búho: café, discos claros alrededor de los ojos, penachos y un pico chiquito
  buho: (p, h) => {
    const fur = p.skin, disc = shade(fur, 1.35)
    return { back: ANIMAL.pointEars(h, shade(fur, .8), null, -6), head: `<ellipse cx="${h.cx}" cy="${h.cy}" rx="${h.rx}" ry="${h.ry}" fill="${fur}"/>`,
      mask: `<circle cx="${h.cx - 38}" cy="${h.cy - 2}" r="40" fill="${disc}"/><circle cx="${h.cx + 38}" cy="${h.cy - 2}" r="40" fill="${disc}"/>
        <path d="M${h.cx - 30} ${h.cy + 44} q30 22 60 0 M${h.cx - 22} ${h.cy + 58} q22 16 44 0" stroke="${shade(fur, .75)}" stroke-width="4" fill="none" stroke-linecap="round"/>`,
      nose: 'none', brow: shade(fur, .5), mouth: '#3a2015', beak: '#e3a33c', beakW: 22 }
  },
  // tucán: cabeza negra, babero amarillo en la garganta, anillo azul alrededor de los ojos y el pico grande
  tucan: (p, h) => {
    const ink = p.skin
    return { back: '', head: `<ellipse cx="${h.cx}" cy="${h.cy}" rx="${h.rx}" ry="${h.ry}" fill="${ink}"/>`,
      mask: `<path d="M${h.cx - 70} ${h.cy + 20} Q${h.cx} ${h.cy - 6} ${h.cx + 70} ${h.cy + 20} Q${h.cx + 56} ${h.cy + h.ry} ${h.cx} ${h.cy + h.ry + 4} Q${h.cx - 56} ${h.cy + h.ry} ${h.cx - 70} ${h.cy + 20}Z" fill="#f6e7b0"/>
        <circle cx="${h.cx - h.rx * .42}" cy="${h.cy - 2}" r="30" fill="#78b4d0"/><circle cx="${h.cx + h.rx * .42}" cy="${h.cy - 2}" r="30" fill="#78b4d0"/>`,
      nose: 'none', brow: '#4a4d55', mouth: '#2a2523', beak: p.beak || '#f08c3d', beakW: 120 }
  },
  // loro: verde, mejillas amarillas, anillo claro en los ojos y pico en ganchito color hueso
  loro: (p, h) => {
    const feather = p.skin
    return { back: '', head: `<ellipse cx="${h.cx}" cy="${h.cy}" rx="${h.rx}" ry="${h.ry}" fill="${feather}"/>`,
      mask: `<ellipse cx="${h.cx - 52}" cy="${h.cy + 26}" rx="30" ry="24" fill="#f2c14e"/><ellipse cx="${h.cx + 52}" cy="${h.cy + 26}" rx="30" ry="24" fill="#f2c14e"/>
        <circle cx="${h.cx - h.rx * .42}" cy="${h.cy - 2}" r="28" fill="#f6efe2"/><circle cx="${h.cx + h.rx * .42}" cy="${h.cy - 2}" r="28" fill="#f6efe2"/>`,
      top: `<path d="M${h.cx - 10} ${h.cy - h.ry + 6} q-8 -28 10 -40 q-2 20 10 26 q4 -18 22 -20 q-12 14 -10 34Z" fill="#c5381f"/>`,
      nose: 'none', brow: shade(feather, .55), mouth: '#2a2523', beak: '#ecdcc0', beakW: 28 }
  },
  // perezoso: pelaje café claro, máscara crema ovalada, franjas oscuras que bajan desde los ojos, sonrisa tranquila
  perezoso: (p, h) => {
    const fur = p.skin, cream = '#efe0c4', band = '#4a3326'
    return { back: '', head: `<ellipse cx="${h.cx}" cy="${h.cy}" rx="${h.rx}" ry="${h.ry}" fill="${fur}"/>`,
      mask: `<ellipse cx="${h.cx}" cy="${h.cy + 8}" rx="${h.rx - 16}" ry="${h.ry - 18}" fill="${cream}"/>
        <path d="M${h.cx - 24} ${h.cy - 18} Q${h.cx - 50} ${h.cy - 22} ${h.cx - 74} ${h.cy + 4} Q${h.cx - 66} ${h.cy + 18} ${h.cx - 52} ${h.cy + 14} Q${h.cx - 38} ${h.cy + 2} ${h.cx - 20} ${h.cy + 4}Z" fill="${band}"/>
        <path d="M${h.cx + 24} ${h.cy - 18} Q${h.cx + 50} ${h.cy - 22} ${h.cx + 74} ${h.cy + 4} Q${h.cx + 66} ${h.cy + 18} ${h.cx + 52} ${h.cy + 14} Q${h.cx + 38} ${h.cy + 2} ${h.cx + 20} ${h.cy + 4}Z" fill="${band}"/>`,
      top: `<path d="M${h.cx - 30} ${h.cy - h.ry + 10} q14 -22 30 -10 q14 -16 30 6" stroke="${shade(fur, .8)}" stroke-width="6" fill="none" stroke-linecap="round"/>`,
      nose: 'dot', noseColor: '#3a2a24', brow: shade(fur, .6), mouth: '#5a2a1a' }
  },
  // capibara: cabeza más cuadrada y alargada, orejitas arriba, hocico ancho con las fosas arriba, ojos chicos
  capibara: (p, h) => {
    const fur = p.skin, d = shade(fur, .8)
    return { back: ANIMAL.roundEars(h, 16, d, shade(fur, .65), 236),
      head: `<rect x="${h.cx - h.rx + 4}" y="${h.cy - h.ry + 4}" width="${(h.rx - 4) * 2}" height="${(h.ry - 4) * 2 + 10}" rx="62" fill="${fur}"/>`,
      mask: `<rect x="${h.cx - 56}" y="${h.cy + 16}" width="112" height="${h.ry - 4}" rx="40" fill="${shade(fur, .9)}"/>`,
      nose: 'nostrils', noseColor: shade(fur, .5), brow: shade(fur, .55), mouth: '#3a2015', eye: 20 }
  },
  // jaguar: dorado con rosetas, orejas redondas de dorso oscuro, hocico blanco, nariz rosada y bigotes
  jaguar: (p, h) => {
    const fur = p.skin, spot = '#3a2a24'
    const rosette = (x, y, r) => [0, 72, 144, 216, 288].map((a) => `<circle cx="${(x + r * Math.cos(a * Math.PI / 180)).toFixed(1)}" cy="${(y + r * Math.sin(a * Math.PI / 180)).toFixed(1)}" r="3.5" fill="${spot}"/>`).join('')
    return { back: ANIMAL.roundEars(h, 22, spot, fur, 228), head: `<ellipse cx="${h.cx}" cy="${h.cy}" rx="${h.rx}" ry="${h.ry}" fill="${fur}"/>`,
      mask: `${rosette(h.cx - 50, h.cy - 52, 10)}${rosette(h.cx + 46, h.cy - 56, 9)}${rosette(h.cx, h.cy - 70, 8)}${rosette(h.cx - 74, h.cy + 18, 8)}${rosette(h.cx + 74, h.cy + 20, 8)}${ANIMAL.muzzle(h, '#f6efe2', 44, 30)}`,
      front: ANIMAL.whiskers(h), nose: 'cat', noseColor: '#c9706a', brow: shade(fur, .5), mouth: '#5a2a1a' }
  },
  leon: (p, h) => {
    const fur = p.skin, mane = p.mask || shade(fur, .62)
    return { back: ANIMAL.puffs(h, 22, 36, 0, 350, 22, mane) + ANIMAL.roundEars(h, 22, fur, shade(fur, 1.25), 226), head: `<ellipse cx="${h.cx}" cy="${h.cy}" rx="${h.rx}" ry="${h.ry}" fill="${fur}"/>`,
      mask: ANIMAL.muzzle(h, shade(fur, 1.28)), nose: 'bear', noseColor: '#7a3b2a', brow: shade(fur, .55), mouth: '#5a2a1a' }
  },
  mico: (p, h) => {
    const fur = p.skin, mask = p.mask || '#ecc9a0', d = shade(fur, .8)
    return {
      back: `<circle cx="${h.cx - h.rx - 4}" cy="${h.cy + 4}" r="32" fill="${fur}"/><circle cx="${h.cx + h.rx + 4}" cy="${h.cy + 4}" r="32" fill="${fur}"/>
        <circle cx="${h.cx - h.rx - 4}" cy="${h.cy + 4}" r="19" fill="${mask}"/><circle cx="${h.cx + h.rx + 4}" cy="${h.cy + 4}" r="19" fill="${mask}"/>`,
      head: `<ellipse cx="${h.cx}" cy="${h.cy}" rx="${h.rx}" ry="${h.ry}" fill="${fur}"/>`,
      // la máscara clara: dos lóbulos alrededor de los ojos y el hocico
      mask: `<ellipse cx="${h.cx - 32}" cy="${h.cy - 4}" rx="38" ry="40" fill="${mask}"/><ellipse cx="${h.cx + 32}" cy="${h.cy - 4}" rx="38" ry="40" fill="${mask}"/><ellipse cx="${h.cx}" cy="${h.cy + 42}" rx="60" ry="40" fill="${mask}"/>`,
      top: `<path d="M${h.cx - 18} ${h.cy - h.ry + 6} q-4 -26 14 -30 q-8 16 6 22 q2 -20 20 -20 q-10 14 0 28Z" fill="${d}"/>`,
      nose: 'nostrils', noseColor: shade(fur, .6), brow: shade(fur, .6), mouth: '#6e1f12',
    }
  },
  // gorila: cabeza con la cresta alta, cara de cuero oscura con la ceja ósea marcada, orejas pequeñas pegadas
  gorila: (p, h) => {
    // la cara: café claro cálido sobre un pelaje café; cuero oscuro sobre uno gris
    const fur = p.skin, n = parseInt(fur.slice(1), 16), warm = (n >> 16) > (n & 255) + 18
    const face = p.mask || (warm ? '#a5704f' : '#5d524f'), d = shade(fur, .78)
    return {
      back: `<ellipse cx="${h.cx - h.rx + 2}" cy="${h.cy + 6}" rx="16" ry="20" fill="${face}"/><ellipse cx="${h.cx + h.rx - 2}" cy="${h.cy + 6}" rx="16" ry="20" fill="${face}"/>`,
      // la cabeza es la elipse con una cresta que sube por arriba
      head: `<ellipse cx="${h.cx}" cy="${h.cy}" rx="${h.rx}" ry="${h.ry}" fill="${fur}"/><path d="M${h.cx - h.rx * .55} ${h.cy - h.ry * .7} Q${h.cx} ${h.cy - h.ry - 46} ${h.cx + h.rx * .55} ${h.cy - h.ry * .7}Z" fill="${fur}"/>`,
      // la cara: un escudo ancho de cuero que toma los ojos y el hocico; encima, la ceja ósea
      mask: `<path d="M${h.cx - 70} ${h.cy - 30} Q${h.cx} ${h.cy - 52} ${h.cx + 70} ${h.cy - 30} Q${h.cx + 84} ${h.cy + 30} ${h.cx + 50} ${h.cy + 66} Q${h.cx} ${h.cy + 86} ${h.cx - 50} ${h.cy + 66} Q${h.cx - 84} ${h.cy + 30} ${h.cx - 70} ${h.cy - 30}Z" fill="${face}"/>
        <path d="M${h.cx - 74} ${h.cy - 26} Q${h.cx - 38} ${h.cy - 54} ${h.cx} ${h.cy - 34} Q${h.cx + 38} ${h.cy - 54} ${h.cx + 74} ${h.cy - 26} Q${h.cx + 40} ${h.cy - 38} ${h.cx} ${h.cy - 24} Q${h.cx - 40} ${h.cy - 38} ${h.cx - 74} ${h.cy - 26}Z" fill="${shade(face, .8)}"/>`,
      top: `<path d="M${h.cx - 18} ${h.cy - h.ry + 2} q16 -14 34 -4" stroke="${shade(fur, 1.3)}" stroke-width="5" fill="none" stroke-linecap="round"/>`,
      nose: 'flat', noseColor: shade(face, .78), brow: warm ? '#3a2015' : '#2a2523', mouth: warm ? '#3a2015' : '#2a2523',
    }
  },
  pato: (p, h) => {
    const feather = p.skin, d = shade(feather, .85)
    return {
      back: '',
      head: `<ellipse cx="${h.cx}" cy="${h.cy}" rx="${h.rx}" ry="${h.ry}" fill="${feather}"/>`,
      mask: '',
      // un copete de tres plumas
      top: `<path d="M${h.cx - 6} ${h.cy - h.ry + 4} q-20 -20 -8 -36 q4 18 14 22 q-2 -24 16 -34 q-2 22 6 30 q8 -14 22 -12 q-14 12 -16 30Z" fill="${d}"/>`,
      nose: 'none', brow: shade(feather, .55), mouth: '#6e1f12', beak: p.beak || '#f08c3d',
    }
  },
}
function creature(p) {
  const h = { ...HEAD, rx: 94, ry: 88 }, a = SPECIES[p.species](p, h)
  const has = (x) => p.extras?.includes(x)
  return `${torso(p)}
  <g class="head">
    ${a.back ? cut(a.back) : ''}
    ${cut(a.head)}
    ${a.mask ? soft(a.mask) : ''}
    ${a.front ? soft(a.front) : ''}
    ${a.top && !p.hat ? cut(a.top) : ''}
    <ellipse cx="${h.cx - h.rx * .62}" cy="${h.cy + 30}" rx="14" ry="8" fill="#e5592a" opacity=".3"/><ellipse cx="${h.cx + h.rx * .62}" cy="${h.cy + 30}" rx="14" ry="8" fill="#e5592a" opacity=".3"/>
    ${face(h, { id: p.id, brow: a.brow, nose: p.skin, noseColor: a.noseColor || shade(p.skin, .7), noseShape: a.nose, eye: p.eye || a.eye || 26, lids: p.lids, mouth: a.mouth, lashes: p.lashes, beak: a.beak, beakW: a.beakW, teeth: a.teeth })}
    ${p.hat && HATS[p.hat] ? HATS[p.hat](h, p.hatColor || '#c5381f', 8) : ''}
    ${has('glasses') ? EXTRAS.glasses(p, h) : ''}
    ${has('headphones') ? EXTRAS.headphones(p, h) : ''}
  </g>`
}
function person(p) {
  if (p.species && SPECIES[p.species]) return creature(p)
  const s = p.skin, sh = shade(s, .86)
  const h = { ...HEAD, ...(FACES[p.face] || FACES.round) }, rx = h.rx
  const hair = HAIR[p.hair](h, p.hairColor, !!p.hat)
  const has = (x) => p.extras?.includes(x)
  // la barba: un estilo (beardStyle); los personajes viejos con «beard» en extras llevan la corta
  const beardStyle = p.beardStyle !== undefined ? p.beardStyle : has('beard') ? 'corta' : ''
  // el pelo largo cae detrás de los hombros: va antes que la chaqueta (y se balancea con la cabeza)
  const behind = p.hair === 'long'
  return `${behind ? `<g class="head">${cut(hair.back)}</g>` : ''}${torso(p)}
  <g class="head">
    ${hair.back && !behind && !(p.hat && p.hair === 'bun') ? cut(hair.back) : ''}
    ${cut([pt(h, 174, -2), pt(h, 6, -2)].map(([x, y]) => `<ellipse cx="${x}" cy="${y + 4}" rx="15" ry="19" fill="${sh}"/>`).join(''))}
    ${has('earrings') ? EXTRAS.earrings(p, h) : ''}
    ${cut(`<path d="${headPath(h)}" fill="${s}"/>`)}
    <ellipse cx="${h.cx - rx * .6}" cy="${h.cy + 34}" rx="14" ry="8" fill="#e5592a" opacity=".32"/><ellipse cx="${h.cx + rx * .6}" cy="${h.cy + 34}" rx="14" ry="8" fill="#e5592a" opacity=".32"/>
    ${has('freckles') ? EXTRAS.freckles(p, h) : ''}
    ${beardStyle ? EXTRAS.beard(p, h, beardStyle) : ''}
    ${face(h, { id: p.id, brow: shade(p.hairColor, .8), nose: s, noseColor: shade(s, .8), noseShape: p.nose, eye: p.eye, teeth: p.teeth, lids: p.lids, mouth: '#962b19', lashes: p.lashes })}
    ${p.hat && SHORT_HAIR.includes(p.hair) ? '' : cut(hair.front)}
    ${p.hat && HATS[p.hat] ? HATS[p.hat](h, p.hatColor || '#c5381f', (HAIR_VOL[p.hair] ?? 6) + 4) : ''}
    ${has('glasses') ? EXTRAS.glasses(p, h) : ''}
    ${has('headphones') ? EXTRAS.headphones(p, h) : ''}
  </g>`
}


// ── EL RECUADRO ──────────────────────────────────────────────────────────────────────────────────
const STATE_LABEL = { typing: 'teclea', thinking: 'piensa', talking: 'habla', idle: 'escucha' }
const MIC = '<svg viewBox="0 0 24 24" fill="#f1e4c7"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M6 11a6 6 0 0 0 12 0" stroke="#f1e4c7" stroke-width="2" fill="none"/><rect x="11" y="17" width="2" height="4"/></svg>'
function tile(p, i = 0) {
  const el = document.createElement('section')
  el.className = 'tile'
  el.setAttribute('aria-label', p.owner ? `${p.name}, agente de ${p.owner}` : p.guest ? `${p.name}, invitado de ejemplo` : p.name)
  renderTile(el, p)
  // que no parpadeen todos a la vez
  el.style.setProperty('--d', `${-i * 1.7}s`)
  return el
}
// Pinta (o repinta, desde el editor) el recuadro de un personaje. El nombre va como texto: un nombre escrito en
// el editor nunca se interpreta como HTML.
function renderTile(el, p) {
  el.innerHTML = `<svg viewBox="0 0 400 300" preserveAspectRatio="xMidYMax slice" aria-hidden="true">${(SCENES[p.scene] || SCENES.sunset)()}
      <g transform="translate(46 54) scale(.77)"><g class="avatar">${person(p)}</g></g></svg>
    <div class="think" aria-hidden="true">···</div>
    <span class="state"></span>
    <div class="nameplate"><span class="mic">${MIC}</span><span class="who"></span>${p.owner ? ` <small>· ${escapeHTML(p.owner)}</small>` : p.guest ? ' <small>· invitado</small>' : ''}<span class="bars"><i></i><i></i><i></i></span></div>`
  el.querySelector('.who').textContent = p.name
}
const escapeHTML = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
function setTileState(el, st) {
  el.classList.toggle('talking', st === 'talking')
  el.classList.toggle('thinking', st === 'thinking')
  el.classList.toggle('typing', st === 'typing')
  el.classList.toggle('idle', st === 'idle')
  el.classList.toggle('muted', st !== 'talking')
  const badge = el.querySelector('.state')
  badge.textContent = STATE_LABEL[st]; badge.className = `state ${st}`
}

// ── LOS PERSONAJES GUARDADOS ─────────────────────────────────────────────────────────────────────
// Los que se arman en el editor quedan en este navegador (localStorage, office:custom). Si no hay o no se puede
// leer, la llamada sigue con su elenco de siempre.
function loadCustom() { try { return JSON.parse(localStorage.getItem('office:custom') || '[]') } catch { return [] } }
function saveCustom(list) { try { localStorage.setItem('office:custom', JSON.stringify(list)); return true } catch { return false } }

// ── LO QUE SE PUEDE ELEGIR ───────────────────────────────────────────────────────────────────────
// El catálogo del editor: cada opción es una pieza que person() ya sabe dibujar. Agregar una (un peinado, una
// nariz) es sumarla en su objeto de arriba y nombrarla acá.
const OPCIONES = {
  species: { '': 'Persona', mico: 'Mico', pato: 'Pato', gorila: 'Gorila', oso: 'Oso de anteojos', panda: 'Panda', koala: 'Koala', mapache: 'Mapache', cerdito: 'Cerdito', oveja: 'Oveja', leon: 'León', gato: 'Gato', zorro: 'Zorro', perro: 'Perro', conejo: 'Conejo', raton: 'Ratón', rana: 'Rana', pinguino: 'Pingüino', buho: 'Búho', tucan: 'Tucán', loro: 'Loro', perezoso: 'Perezoso', capibara: 'Capibara', jaguar: 'Jaguar' },
  // el color de la piel, del pelaje o de las plumas, según la especie
  skinBy: { '': null, mico: ['#7a4e2d', '#5e3b26', '#a8703f', '#3b2a20', '#9aa0a6'], pato: ['#f2c14e', '#f6f1e6', '#e3c07a', '#8db3a9', '#c98a3a'], gorila: ['#4e2e1f', '#3a2116', '#6b4128', '#3b3f45', '#5a5f66'],
    oso: ['#2e2622', '#4a3326', '#6b4a33'], panda: ['#f4efe6', '#e8e2d6'], koala: ['#9aa0a6', '#7f868e', '#b8bcc2'], mapache: ['#8a8f96', '#6f747b', '#a3a8ae'],
    cerdito: ['#f2a7a0', '#eebcb0', '#d98f86'], oveja: ['#fbf6ea', '#e9dff2', '#ddd0bc'], leon: ['#e3a33c', '#d18b2e', '#efbf5c'],
    gato: ['#f0a85a', '#9aa0a6', '#3a3a40', '#f4efe6'], zorro: ['#e5692a', '#c9561f', '#d98a4a'], perro: ['#d9b48a', '#a8703f', '#f4efe6', '#6b4a33'], conejo: ['#f1e4c7', '#c9a27a', '#e7d8cf'],
    raton: ['#a3a8ae', '#c9c2b4', '#8a8f96'], rana: ['#7fbf5a', '#5ea06b', '#a6c95a'], pinguino: ['#22283a', '#2e3a52', '#1d1f24'], buho: ['#8a5a3c', '#6b4a33', '#a8805a'],
    tucan: ['#1d1f24', '#2a2d33'], loro: ['#5ea06b', '#7fbf5a', '#3f8f5a'], perezoso: ['#a8805a', '#8a6a4c', '#c4a07a'], capibara: ['#a8703f', '#8a5a3c', '#c48a52'], jaguar: ['#e3a33c', '#d18b2e', '#efbf5c'] },
  skin: ['#f6d2b0', '#f0c49b', '#e9b98f', '#e0ac7e', '#d99c74', '#c68a5e', '#a8703f', '#8a5a3c', '#5e3b26'],
  hair: { side: 'Raya al lado', short: 'Corto clásico', recogido: 'Recogido', crop: 'Corto texturado', bob: 'Melena recta', long: 'Largo ondulado', curly: 'Rizos', bun: 'Moño', buzz: 'Rapado', beanie: 'Gorro de lana' },
  hairColor: ['#1f1712', '#23171a', '#4a2f1c', '#5a3a22', '#8a4b2a', '#962b19', '#c98a3a', '#e3c07a', '#9aa0a6', '#c5381f', '#2b6670', '#9b8ec7'],
  face: { round: 'Redonda', soft: 'Suave', wide: 'Ancha', tall: 'Alargada', largo: 'Larga', achatada: 'Achatada', cuadrada: 'Cuadrada', mandibula: 'Mandíbula ancha', corazon: 'Corazón' },
  beardStyle: { '': 'Sin barba', corta: 'Corta', tupida: 'Tupida', delgada: 'Delgada', chivera: 'Chivera', candado: 'Candado', bigote: 'Solo bigote' },
  nose: { button: 'Botón', bulb: 'Bola', long: 'Larga', hook: 'Ganchuda' },
  teeth: { '': 'Sin dientes', grin: 'Sonrisa con dientes', buck: 'Dientes salidos' },
  extras: { glasses: 'Lentes', headphones: 'Audífonos', earrings: 'Aretes', freckles: 'Pecas' },
  hat: { '': 'Sin gorro', lana: 'Gorro de lana', chullo: 'Chullo con orejeras', cachucha: 'Cachucha', reves: 'Cachucha al revés', pescador: 'Pescador', boina: 'Boina' },
  hatColor: ['#c5381f', '#e5592a', '#f2c14e', '#2b6670', '#13323a', '#8db3a9', '#9b8ec7', '#5e3b6b', '#f1e4c7', '#24406b'],
  looks: { lashes: 'Pestañas', lids: 'Párpado caído', glassesRound: 'Lentes redondos' },
  gear: ['#13323a', '#c5381f', '#f08c3d', '#f1e4c7', '#2b6670', '#9b8ec7'],
  shirt: ['#2b6670', '#1d4a54', '#13323a', '#4f8b8a', '#8db3a9', '#e5592a', '#f08c3d', '#c5381f', '#962b19', '#9b8ec7', '#5e3b6b', '#24406b'],
  accent: ['#f1e4c7', '#13323a', '#f08c3d', '#c5381f', '#8db3a9', '#f2c14e'],
  scene: { sunset: 'Atardecer', clouds: 'Nubes', hills: 'Colinas', sun: 'Sol y confeti', waves: 'Olas', dusk: 'Noche', garden: 'Jardín', ocean: 'Mar de noche', candy: 'Menta' },
}
// Un personaje al azar, armado sólo con lo del catálogo.
function randomPerson(base = {}) {
  const pick = (a) => a[Math.floor(Math.random() * a.length)]
  const keys = (o) => Object.keys(o)
  const extras = keys(OPCIONES.extras).filter(() => Math.random() < .28)
  const beardStyle = Math.random() < .3 ? pick(keys(OPCIONES.beardStyle).filter(Boolean)) : ''
  return {
    ...base,
    skin: pick(OPCIONES.skin), hair: pick(keys(OPCIONES.hair)), hairColor: pick(OPCIONES.hairColor), face: pick(keys(OPCIONES.face)),
    nose: pick(keys(OPCIONES.nose)), teeth: pick(keys(OPCIONES.teeth)), eye: 20 + Math.floor(Math.random() * 11),
    extras, beardStyle, hat: Math.random() < .35 ? pick(keys(OPCIONES.hat).filter(Boolean)) : '', hatColor: pick(OPCIONES.hatColor), lashes: Math.random() < .4, lids: Math.random() < .15, glassesRound: Math.random() < .5, gear: pick(OPCIONES.gear),
    shirt: pick(OPCIONES.shirt), accent: pick(OPCIONES.accent), scene: pick(keys(OPCIONES.scene)),
  }
}

// ── LA TEXTURA DE PAPEL ──────────────────────────────────────────────────────────────────────────
// Prendida por defecto; el botón «Papel» (data-paper-toggle) la alterna y la preferencia queda en este navegador.
function paperOn() { try { return localStorage.getItem('office:paper') !== 'off' } catch { return true } }
function setPaper(on) {
  document.documentElement.classList.toggle('paper', on)
  try { localStorage.setItem('office:paper', on ? 'on' : 'off') } catch { /* sin guardar, igual se aplica */ }
  document.querySelectorAll('[data-paper-toggle]').forEach((b) => b.setAttribute('aria-pressed', String(on)))
}
if (typeof document !== 'undefined' && typeof OFFICE_PAQUETE === 'undefined') {
  document.addEventListener('click', (e) => { if (e.target.closest('[data-paper-toggle]')) setPaper(!document.documentElement.classList.contains('paper')) })
  document.addEventListener('DOMContentLoaded', () => setPaper(paperOn()))
  setPaper(paperOn())
}

// ── PARA NODE ────────────────────────────────────────────────────────────────────────────────────
// El CLI (office/cli/personaje.mjs) carga este mismo archivo: lo que dibuja la llamada es lo que sale del CLI.
if (typeof module !== 'undefined') module.exports = { person, SCENES, OPCIONES, SPECIES, HAIR, HATS, randomPerson, shade, LOGO_SVG, STATE_LABEL }

return module.exports
})()

// ── EL PAQUETE ───────────────────────────────────────────────────────────────────────────────────
const CSS = "/* OFFICE · los personajes en papel cortado: la paleta, el recuadro de la llamada y la animación de recortes.\n Lo usan la llamada (index.html) y el editor (editor.html); el dibujo está en personajes.js. */\n:root {\n  /* la paleta del papel */\n  --ink: #13323a; --teal-deep: #1d4a54; --teal: #2b6670; --teal-soft: #4f8b8a; --sage: #8db3a9;\n  --cream: #f1e4c7; --cream-dim: #d9c9a6; --red: #c5381f; --red-deep: #962b19; --orange: #e5592a; --amber: #f08c3d;\n  --text: #f6ecd6; --dim: #9aa3a6;\n  color-scheme: dark;\n}\n.tile { position: relative; border-radius: 22px; overflow: hidden; min-height: 0;\n  box-shadow: 0 3px 0 rgba(0, 0, 0, .18), 0 10px 22px rgba(0, 0, 0, .35); transition: box-shadow .2s, transform .2s; }\n.tile svg { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }\n.tile.talking { box-shadow: 0 0 0 4px var(--cream), 0 0 0 8px var(--orange), 0 12px 26px rgba(0, 0, 0, .4); transform: translateY(-2px); }\n.cut { filter: drop-shadow(0 3px 2px rgba(10, 25, 30, .38)) drop-shadow(0 1px 0 rgba(10, 25, 30, .25)); }\n.cut-soft { filter: drop-shadow(0 2px 1.5px rgba(10, 25, 30, .3)); }\n\n/* El nombre, abajo a la izquierda, en una tira de papel; el estado arriba a la derecha. */\n.nameplate { position: absolute; left: 12px; bottom: 12px; display: flex; align-items: center; gap: 8px; z-index: 2;\n  background: var(--cream); color: var(--ink); padding: 5px 12px 5px 8px; border-radius: 10px; font-weight: 800; font-size: 13px;\n  box-shadow: 0 2px 0 var(--cream-dim), 0 4px 10px rgba(0, 0, 0, .3); }\n.nameplate small { font-weight: 700; color: var(--teal); }\n.mic { width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; background: var(--teal); }\n.mic svg { position: static; width: 12px; height: 12px; }\n.tile.muted .mic { background: var(--red); }\n.state { position: absolute; right: 12px; top: 12px; z-index: 2; font-size: 12px; font-weight: 800; padding: 3px 10px; border-radius: 999px;\n  background: rgba(19, 50, 58, .72); color: var(--text); }\n.state.talking { background: var(--orange); color: var(--cream); }\n/* las barras de audio del que habla */\n.bars { display: none; gap: 2px; align-items: flex-end; height: 12px; }\n.tile.talking .bars { display: inline-flex; }\n.bars i { width: 3px; background: var(--orange); border-radius: 2px; animation: bar .5s ease-in-out infinite alternate; }\n.bars i:nth-child(2) { animation-delay: .15s; } .bars i:nth-child(3) { animation-delay: .3s; }\n@keyframes bar { from { height: 3px; } to { height: 12px; } }\n\n/* el globo de «está pensando» */\n.think { position: absolute; top: 16%; right: 14%; z-index: 2; background: var(--cream); color: var(--ink); font-weight: 900;\n  padding: 0 12px 6px; border-radius: 18px; font-size: 22px; letter-spacing: 2px; box-shadow: 0 3px 0 var(--cream-dim), 0 6px 12px rgba(0, 0, 0, .3);\n  opacity: 0; transform: translateY(6px) scale(.9); transition: opacity .25s, transform .25s; }\n.tile.thinking .think { opacity: 1; transform: none; }\n\n/* LA ANIMACIÓN DE RECORTES: poco y suave. La cabeza y el cuerpo se balancean por separado desde el cuello; lo\n   que cambia con el estado son las cejas, adónde miran las pupilas y cuál de las cuatro bocas se ve. */\n.avatar, .head, .body, .pupils, .brow-l, .brow-r, .eyes, .mouth { transform-box: view-box; }\n.body { transform-origin: 200px 300px; animation: sway 4.6s ease-in-out infinite alternate; animation-delay: var(--d, 0s); }\n.head { transform-origin: 200px 236px; animation: bob 3.4s ease-in-out infinite alternate; animation-delay: var(--d, 0s); }\n@keyframes sway { from { transform: rotate(-1.2deg); } to { transform: rotate(1.2deg); } }\n@keyframes bob { from { transform: rotate(-2deg) translateY(0); } to { transform: rotate(2deg) translateY(-2px); } }\n.tile.talking .head { animation: nod .7s ease-in-out infinite alternate; }\n@keyframes nod { from { transform: rotate(-3deg) translateY(0); } to { transform: rotate(2deg) translateY(-5px); } }\n.eyes { transform-origin: 200px 150px; animation: blink 5s infinite; animation-delay: var(--d, 0s); }\n@keyframes blink { 0%, 95%, 100% { transform: scaleY(1); } 97% { transform: scaleY(.08); } }\n.pupils { transition: transform .25s steps(2); }\n.tile.idle .pupils { animation: look 7s steps(1) infinite; animation-delay: var(--d, 0s); }\n@keyframes look { 0%, 100% { transform: none; } 35% { transform: translate(-6px, 1px); } 65% { transform: translate(6px, 0); } }\n.tile.typing .pupils { transform: translate(0, 7px); }\n.tile.thinking .pupils { transform: translate(7px, -8px); }\n.brow-l, .brow-r { transition: transform .25s steps(2); }\n.brow-l { transform-origin: 160px 120px; } .brow-r { transform-origin: 240px 120px; }\n.tile.talking .brow-l, .tile.talking .brow-r { transform: translateY(-6px); }\n.tile.thinking .brow-r { transform: translateY(-10px) rotate(-12deg); }\n.tile.thinking .brow-l { transform: translateY(2px) rotate(6deg); }\n.tile.typing .brow-l { transform: translateY(3px) rotate(10deg); }\n.tile.typing .brow-r { transform: translateY(3px) rotate(-10deg); }\n.m-talk, .m-think, .m-flat { display: none; }\n.tile.talking .m-smile, .tile.thinking .m-smile, .tile.typing .m-smile { display: none; }\n.tile.talking .m-talk, .tile.thinking .m-think, .tile.typing .m-flat { display: inline; }\n.mouth { transform-origin: 200px 200px; animation: talk .24s steps(2) infinite alternate; }\n@keyframes talk { from { transform: scaleY(.45); } to { transform: scaleY(1.15); } }\n/* el pico del pato habla como una mandíbula: la parte de abajo baja, la de arriba sube apenas y la boca se abre\n   desde arriba; mismo ritmo que la boca de las personas */\n.beak-jaw, .beak-top, .beak-inside { transform-box: fill-box; transform-origin: 50% 0%; }\n.tile.talking .beak-jaw { animation: jaw .24s ease-in-out infinite alternate; }\n.tile.talking .beak-top { animation: bill .24s ease-in-out infinite alternate; }\n.tile.talking .beak-inside { animation: inside .24s ease-in-out infinite alternate; }\n@keyframes jaw { from { transform: translateY(-8px); } to { transform: translateY(4px) rotate(1deg); } }\n@keyframes bill { from { transform: translateY(1px); } to { transform: translateY(-3px); } }\n@keyframes inside { from { transform: scaleY(.25); } to { transform: scaleY(1); } }\n/* el pico grande del tucán: la parte de arriba se recoge hacia la base (como si levantara el pico) y deja ver la\n   boca y la parte de abajo */\n.tile.talking .beak-top.big { animation: bigbill .24s ease-in-out infinite alternate; }\n@keyframes bigbill { from { transform: scaleY(1); } to { transform: scaleY(.74); } }\n/* LA BOCA MOVIDA DESDE AFUERA (lipsync): quien reproduce un audio pone --boca de 0 (cerrada) a 1 (abierta) cuadro a\n   cuadro con el volumen, y la boca sigue eso en vez de su vaivén fijo. La cabeza sigue asintiendo. */\n.tile.talking.lipsync .mouth { animation: none; transform: scaleY(calc(.3 + var(--boca, .5) * .95)); transition: transform 50ms linear; }\n.tile.talking.lipsync .beak-jaw { animation: none; transform: translateY(calc(-8px + var(--boca, .5) * 12px)); transition: transform 50ms linear; }\n.tile.talking.lipsync .beak-inside { animation: none; transform: scaleY(calc(.25 + var(--boca, .5) * .75)); transition: transform 50ms linear; }\n.tile.talking.lipsync .beak-top { animation: none; transform: translateY(calc(var(--boca, .5) * -3px)); transition: transform 50ms linear; }\n.tile.talking.lipsync .beak-top.big { animation: none; transform: scaleY(calc(1 - var(--boca, .5) * .26)); transition: transform 50ms linear; }\n.glow { animation: glow 1.6s ease-in-out infinite alternate; }\n@keyframes glow { from { opacity: .55; } to { opacity: 1; } }\n.paused * { animation-play-state: paused !important; }\n\n\n/* LA TEXTURA DE PAPEL: fibras y grano encima de cada recuadro, multiplicadas con los colores. Se prende y se apaga\n   con la clase .paper en el <html> (botón «Papel»; la preferencia queda en localStorage, office:paper). */\n.tile::after { content: \"\"; position: absolute; inset: 0; z-index: 1; pointer-events: none; opacity: 0; transition: opacity .25s;\n  mix-blend-mode: multiply;\n  background-image:\n    url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300'><filter id='f'><feTurbulence type='fractalNoise' baseFrequency='.012 .09' numOctaves='3' seed='7'/><feColorMatrix values='0 0 0 0 .55  0 0 0 0 .5  0 0 0 0 .42  0 0 0 .55 0'/></filter><rect width='100%' height='100%' filter='url(%23f)'/></svg>\"),\n    url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='g'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' seed='3'/><feColorMatrix values='0 0 0 0 .45  0 0 0 0 .4  0 0 0 0 .35  0 0 0 .8 0'/></filter><rect width='100%' height='100%' filter='url(%23g)'/></svg>\"); }\n.paper .tile::after { opacity: .5; }\n/* con papel, los bordes de cada capa se ven un poco más gruesos, como cartulina */\n.paper .cut { filter: drop-shadow(0 3px 2px rgba(10, 25, 30, .42)) drop-shadow(0 1px 0 rgba(10, 25, 30, .3)) drop-shadow(0 -1px 0 rgba(255, 250, 235, .18)); }\n\nsvg.tile { box-shadow: none !important; transform: none !important; border-radius: inherit; }\n"

// Los gestos, en castellano o con el nombre de la clase.
const GESTOS = { escucha: 'idle', teclea: 'typing', piensa: 'thinking', habla: 'talking', idle: 'idle', typing: 'typing', thinking: 'thinking', talking: 'talking' }
// Lo que lleva un personaje si su JSON no lo dice.
const BASE = { name: 'Personaje', owner: '', species: '', skin: '#e0ac7e', hair: 'side', hairColor: '#4a2f1c', face: 'round', nose: 'button', teeth: 'grin', eye: 25,
  extras: [], beardStyle: '', hat: '', hatColor: '#c5381f', lashes: false, lids: false, glassesRound: false, gear: '#13323a', shirt: '#2b6670', accent: '#f1e4c7', scene: 'sunset' }
let serial = 0

/** El personaje completo a partir de un JSON parcial (o un texto JSON). */
export function personaje(config = {}) {
  const c = typeof config === 'string' ? JSON.parse(config) : config
  const p = { ...BASE, ...c }
  if (p.species && !c.skin && P.OPCIONES.skinBy[p.species]) p.skin = P.OPCIONES.skinBy[p.species][0]
  // un id propio por dibujo: los recortes de la boca usan ids y no pueden repetirse en la página
  return { ...p, id: `op${++serial}`, kind: p.owner ? 'agent' : 'human', agent: !!p.owner }
}

/** El SVG del personaje como texto. opciones: { gesto: 'escucha'|'teclea'|'piensa'|'habla', fondo: true|false } */
export function svg(config, { gesto = 'escucha', fondo = true } = {}) {
  const p = personaje(config), st = GESTOS[gesto] || 'idle'
  const scene = fondo ? (P.SCENES[p.scene] || P.SCENES.sunset)() : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" class="tile ${st}" style="--d:${-(Math.random() * 5).toFixed(2)}s">${scene}<g transform="translate(46 54) scale(.77)"><g class="avatar">${P.person(p)}</g></g></svg>`
}

/** Un personaje al azar, armado sólo con el catálogo. base fija lo que no se quiere sortear (nombre, especie…). */
export function alAzar(base = {}) {
  const p = P.randomPerson({ ...BASE, ...base })
  if (p.species && P.OPCIONES.skinBy[p.species]) p.skin = P.OPCIONES.skinBy[p.species][Math.floor(Math.random() * P.OPCIONES.skinBy[p.species].length)]
  const { id, kind, agent, ...rest } = p
  return rest
}

/** Lo que se puede elegir: especies, caras, peinados, barbas, gorros, colores, fondos. */
export const OPCIONES = P.OPCIONES

// ── EL COMPONENTE ────────────────────────────────────────────────────────────────────────────────
// <office-personaje config='{"name":"Ana","hair":"curly"}' gesto="habla" fondo="false"></office-personaje>
// boca="0.7": la boca la mueve quien lo usa (de 0 cerrada a 1 abierta, p. ej. con el volumen de un audio); sin el
// atributo, la boca hace su vaivén propio.
// Su estilo vive en su propio shadow DOM: no toca ni lo toca el CSS de la página. Sólo existe en el navegador: en Node
// (un servidor que genere avatares) se usan svg() y alAzar().
export const OfficePersonaje = typeof HTMLElement === 'undefined' ? null : class extends HTMLElement {
  static observedAttributes = ['config', 'gesto', 'fondo', 'boca']
  #config = {}
  constructor() { super(); this.attachShadow({ mode: 'open' }) }
  get config() { return this.#config }
  set config(v) { this.#config = typeof v === 'string' ? JSON.parse(v) : v; this.render() }
  get gesto() { return this.getAttribute('gesto') || 'escucha' }
  set gesto(v) { this.setAttribute('gesto', v) }
  attributeChangedCallback(name, _, value) {
    if (name === 'config') { try { this.#config = JSON.parse(value || '{}') } catch { this.#config = {} } }
    // svg.tile y no el primer svg: antes va el del logo (escondido), y cambiarle la clase a ése no mueve nada
    const svg = this.shadowRoot.querySelector('svg.tile')
    if (name === 'gesto' && svg) { svg.setAttribute('class', `tile ${GESTOS[value] || 'idle'}`); this.#mouth(svg); return }
    if (name === 'boca' && svg) { this.#mouth(svg); return }
    this.render()
  }
  // la boca movida desde afuera: la clase lipsync y la apertura en --boca
  #mouth(svg) {
    const v = this.getAttribute('boca')
    svg.classList.toggle('lipsync', v !== null)
    if (v !== null) svg.style.setProperty('--boca', String(Math.max(0, Math.min(1, Number(v) || 0))))
  }
  connectedCallback() { this.render() }
  render() {
    if (!this.isConnected) return
    this.shadowRoot.innerHTML = `<style>:host{display:inline-block;width:240px;aspect-ratio:4/3;border-radius:18px;overflow:hidden}svg.tile{width:100%;height:100%;display:block}${CSS}</style>${P.LOGO_SVG}${svg(this.#config, { gesto: this.gesto, fondo: this.getAttribute('fondo') !== 'false' })}`
    this.#mouth(this.shadowRoot.querySelector('svg.tile'))
  }
}
if (OfficePersonaje && typeof customElements !== 'undefined' && !customElements.get('office-personaje')) customElements.define('office-personaje', OfficePersonaje)

/** Atajo: dibuja un personaje dentro de un elemento y devuelve el componente (para cambiarle el gesto después). */
export function dibujar(el, config, { gesto = 'escucha', fondo = true } = {}) {
  const c = document.createElement('office-personaje')
  c.setAttribute('gesto', gesto)
  if (!fondo) c.setAttribute('fondo', 'false')
  c.config = config
  el.replaceChildren(c)
  return c
}
