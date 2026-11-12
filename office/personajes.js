// OFFICE · los personajes en papel cortado. Lo usan la llamada (index.html) y el editor (editor.html): el mismo
// dibujo, los mismos gestos y el mismo recuadro. Un personaje es un objeto plano (ver CAST en index.html y las
// opciones en OPCIONES, abajo); person(p) lo dibuja y tile(p) arma su recuadro de la llamada.

// El logo de CreditOp (la palabra), del repo móvil: packages/cds_mobile/assets/logos/creditop_logo.svg. Va una sola
// vez en la página como símbolo, en sus colores y en la versión bordada: las letras en currentColor (blanco en las
// chaquetas) y la E en su verde de marca.
document.body.insertAdjacentHTML('afterbegin', `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><symbol id="creditop-logo" viewBox="0 0 232 30"><g clip-path="url(#co-clip)"><path fill="#4c39ff" d="M52.469 19.035c.23-.096.428-.188.618-.281 1.689-.844 3.01-2.025 3.928-3.508.916-1.483 1.382-3.172 1.382-5.025s-.465-3.542-1.382-5.025c-.918-1.483-2.24-2.662-3.928-3.508C51.402.848 49.422.421 47.202.421H35.65c-.97 0-1.753.759-1.753 1.694v25.844c0 .815.657 1.487 1.498 1.532a45 45 0 0 0 4.607 0c.846-.045 1.508-.715 1.508-1.532V20.02h.86a3.16 3.16 0 0 1 2.637 1.385l4.928 7.345c.271.405.727.667 1.226.695a64 64 0 0 0 3.6.103h.22a63 63 0 0 0 2.821-.072c.315-.017.623-.164.783-.429a.85.85 0 0 0-.02-.923l-6.097-9.093zm-1.94-8.896a3.2 3.2 0 0 1-.416 1.612 2.9 2.9 0 0 1-1.159 1.12c-.499.267-1.088.403-1.75.403h-5.031a.645.645 0 0 1-.657-.635V7.602c0-.352.293-.635.657-.635h5.031c.662 0 1.253.136 1.75.403a2.9 2.9 0 0 1 1.159 1.12 3.3 3.3 0 0 1 .417 1.651zm62.534-7.816c-2.331-1.263-4.98-1.905-7.874-1.905h-10.75c-.969 0-1.751.759-1.751 1.694v25.595c0 .937.785 1.694 1.752 1.694h10.749c2.894 0 5.545-.64 7.874-1.904 2.332-1.266 4.183-3.02 5.507-5.22 1.321-2.2 1.992-4.679 1.992-7.369s-.671-5.17-1.992-7.368c-1.321-2.197-3.175-3.955-5.507-5.22zm-12.763 5.7c0-.586.49-1.06 1.096-1.06h3.158c1.614 0 3.054.34 4.282 1.013a7.1 7.1 0 0 1 2.848 2.814c.669 1.202 1.008 2.589 1.008 4.123s-.339 2.922-1.008 4.124a7.1 7.1 0 0 1-2.848 2.813c-1.226.673-2.668 1.012-4.282 1.012h-3.158c-.606 0-1.096-.473-1.096-1.059zM133.13.377a91 91 0 0 0-2.257-.028h-.012c-.749 0-1.507.009-2.259.028-.865.02-1.543.696-1.543 1.534V27.92c0 .837.676 1.511 1.539 1.535.729.02 1.471.03 2.2.03h.063c.754 0 1.518-.012 2.271-.03.863-.024 1.539-.698 1.539-1.535V1.911c0-.838-.678-1.513-1.544-1.534zm31.391.043h-21.939c-.841 0-1.539.633-1.585 1.444a32 32 0 0 0 0 3.652c.046.813.744 1.448 1.585 1.448h6.067c.605 0 1.095.473 1.095 1.059v19.949c0 .808.647 1.48 1.474 1.53.695.042 1.4.066 2.098.07h.231c.768 0 1.546-.023 2.314-.07.839-.052 1.496-.724 1.496-1.532V8.023c0-.586.489-1.06 1.095-1.06h6.069c.843 0 1.539-.639 1.585-1.456a32 32 0 0 0 0-3.632c-.046-.817-.744-1.457-1.585-1.457zm66.032 4.96c-.96-1.552-2.339-2.78-4.098-3.65C224.7.86 222.642.421 220.34.421h-11.018c-.875 0-1.588.689-1.588 1.534v25.997c0 .82.664 1.494 1.513 1.532a53 53 0 0 0 2.203.054h.087c.764 0 1.534-.02 2.295-.054.851-.04 1.515-.712 1.515-1.535v-6.286c0-.569.48-1.03 1.066-1.03h3.924c2.332 0 4.402-.427 6.154-1.268 1.76-.843 3.134-2.038 4.079-3.547s1.425-3.254 1.425-5.19c0-1.935-.487-3.699-1.444-5.25zm-6.423 5.168c0 .667-.155 1.279-.458 1.815-.3.532-.749.956-1.325 1.263-.585.307-1.258.464-2.005.464h-4.333a.645.645 0 0 1-.657-.635V7.603c0-.352.293-.635.657-.635h4.333c.747 0 1.423.157 2.005.464a3.2 3.2 0 0 1 1.325 1.262c.306.537.458 1.162.458 1.858zM185.758 0c-8.555 0-15.516 6.729-15.516 15.001 0 8.273 6.961 14.999 15.516 14.999s15.519-6.729 15.519-14.999S194.316 0 185.758 0m8.11 15.001c0 4.323-3.638 7.837-8.107 7.837s-8.107-3.517-8.107-7.837 3.638-7.837 8.107-7.837 8.107 3.517 8.107 7.837M15.51 7.17c1.079 0 2.157.28 2.17.285 1.735.473 2.973 1.453 3.708 2.19a1.62 1.62 0 0 0 2.004.211 25 25 0 0 0 1.98-1.405c.54-.427 1.069-.881 1.568-1.354a1.497 1.497 0 0 0 .058-2.125C25.562 3.467 23.117 1.478 19.636.55A16 16 0 0 0 14.37.049 15.67 15.67 0 0 0 4.38 4.58C1.717 7.24.166 10.72.013 14.378c-.174 4.119 1.358 8.027 4.312 11 2.957 2.977 6.93 4.615 11.185 4.615s8.432-1.75 11.362-4.803a1.5 1.5 0 0 0-.104-2.193 25.3 25.3 0 0 0-3.667-2.622 1.63 1.63 0 0 0-1.929.207 8.26 8.26 0 0 1-3.495 1.968 8 8 0 0 1-2.162.283c-2.91-.051-8.107-2.713-8.107-7.834 0-4.32 3.635-7.835 8.105-7.835z"/><path fill="#05d587" d="M66.868 7.294h14.806c.844 0 1.54-.637 1.585-1.45a36 36 0 0 0 0-3.98c-.046-.811-.741-1.446-1.585-1.446H66.868c-.84 0-1.539.635-1.585 1.446a35 35 0 0 0 0 3.985c.046.81.742 1.445 1.585 1.445m19.365 16.824c-.046-.809-.741-1.441-1.585-1.441h-17.78c-.843 0-1.539.64-1.585 1.455a35 35 0 0 0 0 3.969c.046.815.744 1.452 1.585 1.452h17.78c.844 0 1.542-.642 1.585-1.46a35 35 0 0 0 0-3.973zm-19.365-5.536h9.499c.843 0 1.541-.642 1.585-1.46a36 36 0 0 0 0-3.973c-.046-.809-.742-1.439-1.585-1.439h-9.499c-.843 0-1.539.64-1.585 1.455a35 35 0 0 0 0 3.969c.046.815.744 1.452 1.585 1.452z"/></g><defs><clipPath id="co-clip"><path fill="#fff" d="M0 0h232v30H0z"/></clipPath></defs></symbol><symbol id="creditop-logo-mono" viewBox="0 0 232 30"><g clip-path="url(#co-clip-mono)"><path fill="currentColor" d="M52.469 19.035c.23-.096.428-.188.618-.281 1.689-.844 3.01-2.025 3.928-3.508.916-1.483 1.382-3.172 1.382-5.025s-.465-3.542-1.382-5.025c-.918-1.483-2.24-2.662-3.928-3.508C51.402.848 49.422.421 47.202.421H35.65c-.97 0-1.753.759-1.753 1.694v25.844c0 .815.657 1.487 1.498 1.532a45 45 0 0 0 4.607 0c.846-.045 1.508-.715 1.508-1.532V20.02h.86a3.16 3.16 0 0 1 2.637 1.385l4.928 7.345c.271.405.727.667 1.226.695a64 64 0 0 0 3.6.103h.22a63 63 0 0 0 2.821-.072c.315-.017.623-.164.783-.429a.85.85 0 0 0-.02-.923l-6.097-9.093zm-1.94-8.896a3.2 3.2 0 0 1-.416 1.612 2.9 2.9 0 0 1-1.159 1.12c-.499.267-1.088.403-1.75.403h-5.031a.645.645 0 0 1-.657-.635V7.602c0-.352.293-.635.657-.635h5.031c.662 0 1.253.136 1.75.403a2.9 2.9 0 0 1 1.159 1.12 3.3 3.3 0 0 1 .417 1.651zm62.534-7.816c-2.331-1.263-4.98-1.905-7.874-1.905h-10.75c-.969 0-1.751.759-1.751 1.694v25.595c0 .937.785 1.694 1.752 1.694h10.749c2.894 0 5.545-.64 7.874-1.904 2.332-1.266 4.183-3.02 5.507-5.22 1.321-2.2 1.992-4.679 1.992-7.369s-.671-5.17-1.992-7.368c-1.321-2.197-3.175-3.955-5.507-5.22zm-12.763 5.7c0-.586.49-1.06 1.096-1.06h3.158c1.614 0 3.054.34 4.282 1.013a7.1 7.1 0 0 1 2.848 2.814c.669 1.202 1.008 2.589 1.008 4.123s-.339 2.922-1.008 4.124a7.1 7.1 0 0 1-2.848 2.813c-1.226.673-2.668 1.012-4.282 1.012h-3.158c-.606 0-1.096-.473-1.096-1.059zM133.13.377a91 91 0 0 0-2.257-.028h-.012c-.749 0-1.507.009-2.259.028-.865.02-1.543.696-1.543 1.534V27.92c0 .837.676 1.511 1.539 1.535.729.02 1.471.03 2.2.03h.063c.754 0 1.518-.012 2.271-.03.863-.024 1.539-.698 1.539-1.535V1.911c0-.838-.678-1.513-1.544-1.534zm31.391.043h-21.939c-.841 0-1.539.633-1.585 1.444a32 32 0 0 0 0 3.652c.046.813.744 1.448 1.585 1.448h6.067c.605 0 1.095.473 1.095 1.059v19.949c0 .808.647 1.48 1.474 1.53.695.042 1.4.066 2.098.07h.231c.768 0 1.546-.023 2.314-.07.839-.052 1.496-.724 1.496-1.532V8.023c0-.586.489-1.06 1.095-1.06h6.069c.843 0 1.539-.639 1.585-1.456a32 32 0 0 0 0-3.632c-.046-.817-.744-1.457-1.585-1.457zm66.032 4.96c-.96-1.552-2.339-2.78-4.098-3.65C224.7.86 222.642.421 220.34.421h-11.018c-.875 0-1.588.689-1.588 1.534v25.997c0 .82.664 1.494 1.513 1.532a53 53 0 0 0 2.203.054h.087c.764 0 1.534-.02 2.295-.054.851-.04 1.515-.712 1.515-1.535v-6.286c0-.569.48-1.03 1.066-1.03h3.924c2.332 0 4.402-.427 6.154-1.268 1.76-.843 3.134-2.038 4.079-3.547s1.425-3.254 1.425-5.19c0-1.935-.487-3.699-1.444-5.25zm-6.423 5.168c0 .667-.155 1.279-.458 1.815-.3.532-.749.956-1.325 1.263-.585.307-1.258.464-2.005.464h-4.333a.645.645 0 0 1-.657-.635V7.603c0-.352.293-.635.657-.635h4.333c.747 0 1.423.157 2.005.464a3.2 3.2 0 0 1 1.325 1.262c.306.537.458 1.162.458 1.858zM185.758 0c-8.555 0-15.516 6.729-15.516 15.001 0 8.273 6.961 14.999 15.516 14.999s15.519-6.729 15.519-14.999S194.316 0 185.758 0m8.11 15.001c0 4.323-3.638 7.837-8.107 7.837s-8.107-3.517-8.107-7.837 3.638-7.837 8.107-7.837 8.107 3.517 8.107 7.837M15.51 7.17c1.079 0 2.157.28 2.17.285 1.735.473 2.973 1.453 3.708 2.19a1.62 1.62 0 0 0 2.004.211 25 25 0 0 0 1.98-1.405c.54-.427 1.069-.881 1.568-1.354a1.497 1.497 0 0 0 .058-2.125C25.562 3.467 23.117 1.478 19.636.55A16 16 0 0 0 14.37.049 15.67 15.67 0 0 0 4.38 4.58C1.717 7.24.166 10.72.013 14.378c-.174 4.119 1.358 8.027 4.312 11 2.957 2.977 6.93 4.615 11.185 4.615s8.432-1.75 11.362-4.803a1.5 1.5 0 0 0-.104-2.193 25.3 25.3 0 0 0-3.667-2.622 1.63 1.63 0 0 0-1.929.207 8.26 8.26 0 0 1-3.495 1.968 8 8 0 0 1-2.162.283c-2.91-.051-8.107-2.713-8.107-7.834 0-4.32 3.635-7.835 8.105-7.835z"/><path fill="#05d587" d="M66.868 7.294h14.806c.844 0 1.54-.637 1.585-1.45a36 36 0 0 0 0-3.98c-.046-.811-.741-1.446-1.585-1.446H66.868c-.84 0-1.539.635-1.585 1.446a35 35 0 0 0 0 3.985c.046.81.742 1.445 1.585 1.445m19.365 16.824c-.046-.809-.741-1.441-1.585-1.441h-17.78c-.843 0-1.539.64-1.585 1.455a35 35 0 0 0 0 3.969c.046.815.744 1.452 1.585 1.452h17.78c.844 0 1.542-.642 1.585-1.46a35 35 0 0 0 0-3.973zm-19.365-5.536h9.499c.843 0 1.541-.642 1.585-1.46a36 36 0 0 0 0-3.973c-.046-.809-.742-1.439-1.585-1.439h-9.499c-.843 0-1.539.64-1.585 1.455a35 35 0 0 0 0 3.969c.046.815.744 1.452 1.585 1.452z"/></g><defs><clipPath id="co-clip-mono"><path fill="#fff" d="M0 0h232v30H0z"/></clipPath></defs></symbol></svg>`)

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
const cut = (inner) => `<g class="cut">${inner}</g>`
const soft = (inner) => `<g class="cut-soft">${inner}</g>`
const r1 = (n) => Math.round(n * 10) / 10

// LA GEOMETRÍA DE LA CABEZA. El pelo se arma sobre la misma elipse de la cara (agrandada un poco), así abraza el
// contorno en vez de flotar encima: pt() da un punto de la elipse por ángulo (270° es arriba, 180° la izquierda).
const HEAD = { cx: 200, cy: 146 }
const pt = (h, deg, pad = 0) => { const a = (deg * Math.PI) / 180; return [r1(h.cx + (h.rx + pad) * Math.cos(a)), r1(h.cy + (h.ry + pad) * Math.sin(a))] }
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
const HAIR_VOL = { curly: 22, long: 12, bob: 12 } // el resto, aplastado bajo el gorro: 6
// los peinados cortos quedan enteros debajo del gorro: no asoma nada (una patilla suelta se veía como un recorte)
const SHORT_HAIR = ['side', 'crop', 'buzz', 'bun', 'beanie']
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
  beard: (p, h) => {
    const c = p.hairColor, chin = h.cy + h.ry + 12
    // de la patilla izquierda, por el contorno de la cara, a la derecha; abajo cierra en ondas suaves hacia el mentón
    const jaw = `${M(pt(h, 196, 3))} ${arc(h, 196, 164, 3)} Q${h.cx - h.rx * .6} ${chin - 6} ${h.cx - 26} ${chin} Q${h.cx - 13} ${chin + 8} ${h.cx} ${chin + 4} Q${h.cx + 13} ${chin + 8} ${h.cx + 26} ${chin} Q${h.cx + h.rx * .6} ${chin - 6} ${pt(h, 16, 3).join(' ')} ${arc(h, 16, -16, 3)}`
    // por dentro: deja libres las mejillas y la boca
    const inner = `L${h.cx + h.rx - 14} ${h.cy - 4} Q${h.cx + h.rx * .62} ${h.cy + h.ry * .3} ${h.cx + 30} ${h.cy + h.ry * .46} Q${h.cx} ${h.cy + h.ry * .36} ${h.cx - 30} ${h.cy + h.ry * .46} Q${h.cx - h.rx * .62} ${h.cy + h.ry * .3} ${h.cx - h.rx + 14} ${h.cy - 4}Z`
    return `<g class="cut-soft"><path d="${jaw} ${inner}" fill="${c}"/>
      <path d="M${h.cx - 34} ${h.cy + h.ry * .44} q16 -16 34 -6 q18 -10 34 6 q-16 8 -34 2 q-18 6 -34 -2Z" fill="${c}"/></g>`
  },
  freckles: (p, h) => [[-52, 36], [-42, 44], [-32, 36], [32, 36], [42, 44], [52, 36]].map(([x, y]) => `<circle cx="${h.cx + x}" cy="${h.cy + y}" r="3" fill="#962b19" opacity=".5"/>`).join(''),
}

// La cara: ojos, cejas, nariz y las cuatro bocas. Es una caricatura: ojos grandes con pupila chica (más cómicos),
// cejas gruesas, narices de varias formas y, a quien le toca, dientes salidos.
//   f.eye: tamaño de ojo · f.nose: 'bulb' | 'long' | 'button' | 'hook' · f.teeth: 'buck' | 'grin' · f.lids: párpado caído
const NOSES = {
  none: () => '',
  // mico: dos fosas en el hocico
  nostrils: (cx, cy, c) => `<ellipse cx="${cx - 9}" cy="${cy + 24}" rx="5" ry="4" fill="${c}"/><ellipse cx="${cx + 9}" cy="${cy + 24}" rx="5" ry="4" fill="${c}"/>`,
  bulb: (cx, cy, c) => `<ellipse cx="${cx}" cy="${cy + 22}" rx="20" ry="17" fill="${c}"/><ellipse cx="${cx - 6}" cy="${cy + 17}" rx="5" ry="4" fill="#fbf4e4" opacity=".55"/>`,
  long: (cx, cy, c) => `<path d="M${cx - 6} ${cy - 4} q-6 30 -14 40 q14 10 30 0 q-6 -16 -10 -40Z" fill="${c}"/>`,
  button: (cx, cy, c) => `<circle cx="${cx}" cy="${cy + 22}" r="11" fill="${c}"/>`,
  hook: (cx, cy, c) => `<path d="M${cx - 4} ${cy - 6} q30 18 18 42 q-10 8 -24 2 q10 -6 6 -12 q-12 -20 0 -32Z" fill="${c}"/>`,
}
// El pico del pato: la parte de arriba fija y la de abajo que baja al hablar (dentro de .mouth, como la boca).
function beak(cx, y, c) {
  const d = shade(c, .8), upper = `<path d="M${cx - 40} ${y + 4} Q${cx} ${y - 18} ${cx + 40} ${y + 4} Q${cx + 34} ${y + 18} ${cx} ${y + 18} Q${cx - 34} ${y + 18} ${cx - 40} ${y + 4}Z" fill="${c}"/><ellipse cx="${cx - 9}" cy="${y + 2}" rx="4" ry="3" fill="${d}"/><ellipse cx="${cx + 9}" cy="${y + 2}" rx="4" ry="3" fill="${d}"/>`
  const lower = (dy) => `<path d="M${cx - 30} ${y + 14 + dy} Q${cx} ${y + 34 + dy} ${cx + 30} ${y + 14 + dy} Q${cx} ${y + 22 + dy} ${cx - 30} ${y + 14 + dy}Z" fill="${d}"/>`
  return `<g class="m-smile">${soft(lower(0) + upper)}</g>
    <g class="m-talk">${soft(`<ellipse cx="${cx}" cy="${y + 24}" rx="24" ry="12" fill="#6e1f12"/>`)}<g class="mouth">${soft(lower(10))}</g>${soft(upper)}</g>
    <g class="m-think"><g transform="rotate(-8 ${cx} ${y})">${soft(lower(-2) + upper)}</g></g>
    <g class="m-flat">${soft(lower(-3) + upper)}</g>`
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
    ${f.beak ? beak(cx, mouthY - 8, f.beak) : `<g class="m-smile">${soft(`<path d="${smileD}" fill="#962b19"/>`)}<g clip-path="url(#ms-${id})">${teethSmile}</g></g>
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

// LOS ANIMALES: misma chaqueta y misma cara animable que las personas; cambia la cabeza. p.species: 'mico' | 'pato'
// (sin species, persona). p.skin es el color del pelaje o de las plumas. Diseños propios: no copian a nadie.
const SPECIES = {
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
    ${a.top && !p.hat ? cut(a.top) : ''}
    <ellipse cx="${h.cx - h.rx * .62}" cy="${h.cy + 30}" rx="14" ry="8" fill="#e5592a" opacity=".3"/><ellipse cx="${h.cx + h.rx * .62}" cy="${h.cy + 30}" rx="14" ry="8" fill="#e5592a" opacity=".3"/>
    ${face(h, { id: p.id, brow: a.brow, nose: p.skin, noseColor: a.noseColor || shade(p.skin, .7), noseShape: a.nose, eye: p.eye || 26, lids: p.lids, mouth: a.mouth, lashes: p.lashes, beak: a.beak })}
    ${p.hat && HATS[p.hat] ? HATS[p.hat](h, p.hatColor || '#c5381f', 8) : ''}
    ${has('glasses') ? EXTRAS.glasses(p, h) : ''}
    ${has('headphones') ? EXTRAS.headphones(p, h) : ''}
  </g>`
}
function person(p) {
  if (p.species && SPECIES[p.species]) return creature(p)
  const s = p.skin, sh = shade(s, .86)
  const [rx, ry] = { round: [92, 88], wide: [100, 84], tall: [86, 94], soft: [94, 90] }[p.face || 'round']
  const h = { ...HEAD, rx, ry }
  const hair = HAIR[p.hair](h, p.hairColor, !!p.hat)
  const has = (x) => p.extras?.includes(x)
  // el pelo largo cae detrás de los hombros: va antes que la chaqueta (y se balancea con la cabeza)
  const behind = p.hair === 'long'
  return `${behind ? `<g class="head">${cut(hair.back)}</g>` : ''}${torso(p)}
  <g class="head">
    ${hair.back && !behind && !(p.hat && p.hair === 'bun') ? cut(hair.back) : ''}
    ${cut(`<ellipse cx="${h.cx - rx + 2}" cy="${h.cy + 10}" rx="15" ry="19" fill="${sh}"/><ellipse cx="${h.cx + rx - 2}" cy="${h.cy + 10}" rx="15" ry="19" fill="${sh}"/>`)}
    ${has('earrings') ? EXTRAS.earrings(p, h) : ''}
    ${cut(`<ellipse cx="${h.cx}" cy="${h.cy}" rx="${rx}" ry="${ry}" fill="${s}"/>`)}
    <ellipse cx="${h.cx - rx * .6}" cy="${h.cy + 34}" rx="14" ry="8" fill="#e5592a" opacity=".32"/><ellipse cx="${h.cx + rx * .6}" cy="${h.cy + 34}" rx="14" ry="8" fill="#e5592a" opacity=".32"/>
    ${has('freckles') ? EXTRAS.freckles(p, h) : ''}
    ${has('beard') ? EXTRAS.beard(p, h) : ''}
    ${face(h, { id: p.id, brow: shade(p.hairColor, .8), nose: s, noseColor: shade(s, .8), noseShape: p.nose, eye: p.eye, teeth: p.teeth, lids: p.lids, mouth: has('beard') ? '#f1e4c7' : '#962b19', lashes: p.lashes })}
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
  species: { '': 'Persona', mico: 'Mico', pato: 'Pato' },
  // el color de la piel, del pelaje o de las plumas, según la especie
  skinBy: { '': null, mico: ['#7a4e2d', '#5e3b26', '#a8703f', '#3b2a20', '#9aa0a6'], pato: ['#f2c14e', '#f6f1e6', '#e3c07a', '#8db3a9', '#c98a3a'] },
  skin: ['#f6d2b0', '#f0c49b', '#e9b98f', '#e0ac7e', '#d99c74', '#c68a5e', '#a8703f', '#8a5a3c', '#5e3b26'],
  hair: { side: 'Raya al lado', crop: 'Corto texturado', bob: 'Melena recta', long: 'Largo ondulado', curly: 'Rizos', bun: 'Moño', buzz: 'Rapado', beanie: 'Gorro de lana' },
  hairColor: ['#1f1712', '#23171a', '#4a2f1c', '#5a3a22', '#8a4b2a', '#962b19', '#c98a3a', '#e3c07a', '#9aa0a6', '#c5381f', '#2b6670', '#9b8ec7'],
  face: { round: 'Redonda', soft: 'Suave', wide: 'Ancha', tall: 'Alargada' },
  nose: { button: 'Botón', bulb: 'Bola', long: 'Larga', hook: 'Ganchuda' },
  teeth: { '': 'Sin dientes', grin: 'Sonrisa con dientes', buck: 'Dientes salidos' },
  extras: { glasses: 'Lentes', headphones: 'Audífonos', earrings: 'Aretes', beard: 'Barba', freckles: 'Pecas' },
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
  return {
    ...base,
    skin: pick(OPCIONES.skin), hair: pick(keys(OPCIONES.hair)), hairColor: pick(OPCIONES.hairColor), face: pick(keys(OPCIONES.face)),
    nose: pick(keys(OPCIONES.nose)), teeth: pick(keys(OPCIONES.teeth)), eye: 20 + Math.floor(Math.random() * 11),
    extras, hat: Math.random() < .35 ? pick(keys(OPCIONES.hat).filter(Boolean)) : '', hatColor: pick(OPCIONES.hatColor), lashes: Math.random() < .4, lids: Math.random() < .15, glassesRound: Math.random() < .5, gear: pick(OPCIONES.gear),
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
document.addEventListener('click', (e) => { if (e.target.closest('[data-paper-toggle]')) setPaper(!document.documentElement.classList.contains('paper')) })
document.addEventListener('DOMContentLoaded', () => setPaper(paperOn()))
setPaper(paperOn())
