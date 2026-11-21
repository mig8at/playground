/* Interacción compartida, sin dependencia de Vue ni de un bundler.
 * El consumidor decide las regiones; este módulo sólo ajusta sus medidas. */
export function readSize(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    const n = raw === null ? NaN : Number.parseFloat(raw);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  } catch { return fallback; }
}

export function saveSize(key, value) {
  try { localStorage.setItem(key, String(value)); } catch { /* Preferencias opcionales. */ }
}

/* ── QUÉ SE GUARDA Y DÓNDE ─────────────────────────────────────────────────────────────────────
 * Una regla para las cuatro herramientas (README §«Qué se guarda y dónde»):
 *   lo que identifica lo que estás mirando o haciendo → la URL: se copia, se pega en una tarea, vuelve
 *     con F5 y con atrás/adelante (la tarea del tablero, el comercio del harness, la traza, la pantalla);
 *   una preferencia personal (una pestaña, un filtro, un grupo abierto, un modo) → `localStorage`, con
 *     `readPref`/`savePref`, bajo `<herramienta>.<nombre>`;
 *   datos grandes (las trazas del trazador) → IndexedDB;
 *   lo peligroso o lo generado por corrida (el ambiente compartido, la cédula sintética) → NO se guarda:
 *     recargar y quedar escribiendo en `dev` sin darse cuenta es peor que volver a elegirlo. */

/** Una preferencia en JSON. Si no está, está rota o el navegador no deja leer, vuelve `fallback`. */
export function readPref(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const value = JSON.parse(raw);
    return value ?? fallback;
  } catch { return fallback; }
}

/** Guarda una preferencia en JSON; `undefined` la borra. Una falla del almacenamiento nunca rompe la UI. */
export function savePref(key, value) {
  try {
    if (value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch { /* preferencia opcional: vale durante esta visita */ }
}

/** Escribe la URL sin recargar, y sólo si cambió. `push` cuando cambia QUÉ se mira (otra tarea, otro
 * comercio, otra solicitud): atrás vuelve a lo anterior. Sin `push` reemplaza: elegir una pestaña, un
 * modo o una etapa no es navegar, y diez entradas por traza dejan inútil el botón atrás. */
export function setRoute(url, { push = false } = {}) {
  const current = location.pathname + location.search + location.hash;
  if (!url || current === url) return false;
  history[push ? 'pushState' : 'replaceState'](null, '', url);
  return true;
}

/** Lee una ruta de hash, `#/comercio/motai?canal=qr`: sus partes decodificadas y sus parámetros. El hash
 * no necesita que el servidor sepa de rutas; por eso lo usan el tablero y el harness. */
export function readHashRoute(hash = location.hash) {
  const raw = String(hash || '').replace(/^#\/?/, '');
  const cut = raw.indexOf('?');
  const path = cut < 0 ? raw : raw.slice(0, cut);
  const parts = path.split('/').filter(Boolean).map((part) => { try { return decodeURIComponent(part); } catch { return ''; } });
  return { parts, params: new URLSearchParams(cut < 0 ? '' : raw.slice(cut + 1)) };
}

/** Arma una ruta de hash. Un parámetro vacío, nulo o igual a su valor por defecto (`defaults`) no se
 * escribe: la URL dice sólo lo que se eligió, y un enlace viejo no queda atado a un default que cambió. */
export function hashRoute(parts, params = {}, defaults = {}) {
  const path = parts.filter((p) => p !== undefined && p !== null && p !== '').map((p) => encodeURIComponent(String(p))).join('/');
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '' || String(value) === String(defaults[key] ?? '\u0000')) continue;
    query.set(key, String(value));
  }
  const qs = query.toString();
  return `#/${path}${qs ? `?${qs}` : ''}`;
}

/* ── MÍNIMO O NADA ─────────────────────────────────────────────────────────────────────────────
 * Una región que se redimensiona mide 0 o al menos su mínimo: entre los dos no hay nada. Vale por
 * cualquier camino —arrastre, teclado, ventana o una medida guardada— y por eso vive acá y no en cada
 * herramienta, que la venían escribiendo cada una a su manera y dejaban columnas de 160px con el
 * texto cortado.
 *
 * El modelo que se espera del consumidor: guarda lo que ELIGIÓ la persona —la medida preferida y si
 * la región está abierta— y lo que se pinta lo DERIVA con `fitRegions` contra la ventana. Así, un
 * plegado por falta de lugar no pisa la preferencia y la región vuelve sola cuando la ventana crece. */

// La regla en una línea: por debajo del mínimo, o sin lugar para el mínimo, la región mide 0.
export function regionSize(value, min, max = Infinity) {
  if (!(value >= min) || max < min) return 0;
  return Math.round(Math.min(value, max));
}

// La medida con la que vuelve una región plegada: la última que tuvo abierta, nunca menos que el
// mínimo, y 0 si en la ventana de ahora no entra ni el mínimo.
export function reopenSize(last, min, max = Infinity, fallback = min) {
  const want = last >= min ? last : Math.max(min, fallback);
  return regionSize(Math.min(want, max), min, max);
}

// Reparte `available` px entre regiones abiertas, dadas en ORDEN DE SACRIFICIO (la primera es la que
// se pliega antes: el sidebar secundario, después el sidebar). Primero las achica hasta su mínimo; si
// no alcanza, pliega la primera y vuelve a repartir entre las que quedan, así una columna no queda
// achicada de más por un plegado que ya hizo lugar. Devuelve las medidas a pintar, en el mismo orden.
export function fitRegions(available, regions) {
  const wanted = regions.map((r) => regionSize(r.size, r.min));
  for (let folded = 0; folded <= regions.length; folded++) {
    const sizes = wanted.map((v, i) => (i < folded ? 0 : v));
    let missing = sizes.reduce((a, b) => a + b, 0) - available;
    if (missing <= 0) return sizes;
    const slack = sizes.reduce((a, v, i) => a + (v ? v - regions[i].min : 0), 0);
    if (missing > slack) continue;
    for (let i = 0; i < sizes.length && missing > 0; i++) {
      if (!sizes[i]) continue;
      const give = Math.min(missing, sizes[i] - regions[i].min);
      sizes[i] -= give;
      missing -= give;
    }
    return sizes;
  }
  return regions.map(() => 0);
}

// Los mínimos son tokens de `workbench.css` (`--sidebar-min`, `--panel-min`, `--editor-min`): se leen de
// ahí para que el número exista en un solo lugar.
export function cssSize(name, fallback) {
  try {
    const n = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
    return Number.isFinite(n) ? n : fallback;
  } catch { return fallback; }
}

export function bindResize(handle, options) {
  let o = options;
  let stop = () => {};
  // La última medida abierta, para Enter. El consumidor que ya la guarda la ofrece con `reopen()`.
  let last = null;
  const number = (v) => Number(typeof v === 'function' ? v() : v);
  // ⚠ Plegar es lo normal; `collapsible: false` es la excepción y se declara. Antes era al revés, y
  // la mitad de las regiones de my-tools no plegaba.
  const folds = () => o.collapsible !== false;
  // ⚠ El mínimo NO se achica para caber en el máximo: eso era lo que dejaba una columna de 160 con un
  // mínimo de 240. Si no entra el mínimo, la región se pliega.
  const bounds = () => ({ min: number(o.min), max: Math.max(0, number(o.max)) });
  function syncAttributes() {
    const { min, max } = bounds();
    handle.setAttribute('role', 'separator');
    handle.setAttribute('tabindex', '0');
    handle.setAttribute('aria-orientation', o.axis === 'y' ? 'horizontal' : 'vertical');
    handle.setAttribute('aria-label', o.label);
    handle.setAttribute('aria-valuemin', String(folds() ? 0 : min));
    handle.setAttribute('aria-valuemax', String(Math.round(max)));
    handle.title = `${o.label} · arrastra para ajustar o usa las flechas`;
    syncValues();
  }
  function syncValues() {
    const val = Math.round(o.get());
    if (val > 0) last = val;
    handle.setAttribute('aria-valuenow', String(val));
    handle.setAttribute('aria-valuetext', val ? `${val} píxeles` : 'Oculto');
  }
  function sync() { syncAttributes(); }
  function set(value) {
    const { min, max } = bounds();
    const next = folds()
      ? regionSize(value, min, max)
      : Math.round(Math.max(min, Math.min(max, value)));
    if (next > 0) last = next;
    o.set(next);
    syncValues();
  }
  function reopen() {
    const { min, max } = bounds();
    const remembered = o.reopen ? number(o.reopen) : last;
    return reopenSize(remembered, min, max, number(o.defaultValue ?? min));
  }
  function toggle() {
    if (!folds()) return;
    set(o.get() ? 0 : reopen());
    finish();
  }
  const finish = () => o.commit?.(o.get());
  function keydown(e) {
    const vertical = o.axis === 'y';
    const decrement = vertical ? 'ArrowUp' : 'ArrowLeft';
    const increment = vertical ? 'ArrowDown' : 'ArrowRight';
    const { min, max } = bounds();
    if (![decrement, increment, 'Home', 'End', 'Enter'].includes(e.key)) return;
    e.preventDefault();
    if (e.key === 'Enter') { toggle(); return; }
    if (e.key === 'Home') set(folds() ? 0 : min);
    else if (e.key === 'End') set(max);
    else {
      const step = (e.key === increment ? 1 : -1) * (o.sign ?? 1) * (e.shiftKey ? 48 : 16);
      const current = o.get();
      // Plegada, la flecha que agranda la abre en su última medida: sumar 16 a 0 no llega al mínimo.
      if (!current && step > 0) set(reopen());
      else set(current + step);
    }
    finish();
  }
  function pointerdown(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    stop();
    handle.focus({ preventScroll: true });
    handle.setPointerCapture(e.pointerId);
    const start = o.axis === 'y' ? e.clientY : e.clientX;
    const initial = o.get();
    let rafId = null;
    let pendingVal = null;

    // El borde sigue al puntero: la región mide lo que marca el puntero, y si eso es menos que el
    // mínimo, mide 0. Cruzar el mínimo de vuelta en el mismo gesto la reabre.
    const move = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      const delta = ((o.axis === 'y' ? ev.clientY : ev.clientX) - start) * (o.sign ?? 1);
      pendingVal = initial + delta;
      if (!rafId) {
        rafId = requestAnimationFrame(() => {
          rafId = null;
          if (pendingVal !== null) set(pendingVal);
        });
      }
    };
    const end = (ev) => { if (ev.pointerId === e.pointerId) stop(); };
    handle.classList.add('on');
    document.body.classList.add('resizing');
    document.body.style.cursor = o.axis === 'y' ? 'row-resize' : 'col-resize';
    stop = () => {
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
      if (pendingVal !== null) { set(pendingVal); pendingVal = null; }
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      handle.removeEventListener('lostpointercapture', end);
      if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId);
      handle.classList.remove('on');
      document.body.classList.remove('resizing');
      document.body.style.removeProperty('cursor');
      finish();
      stop = () => {};
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
    handle.addEventListener('lostpointercapture', end);
  }
  handle.addEventListener('keydown', keydown);
  handle.addEventListener('pointerdown', pointerdown);
  sync();
  return {
    update(next) { o = next; sync(); },
    sync,
    toggle,
    destroy() {
      stop();
      handle.removeEventListener('keydown', keydown);
      handle.removeEventListener('pointerdown', pointerdown);
    },
  };
}

/* ── EL TEMA ────────────────────────────────────────────────────────────────────────────────────
 * Claro u oscuro, con el botón del pie. La primera vez sigue al sistema; cuando la persona elige,
 * queda guardado en su navegador (cada herramienta tiene su origen, así que cada una recuerda lo suyo).
 * El tema es la clase `.dark` de `theme.css` en el <html>, más `color-scheme` para que los controles
 * nativos (fechas, selects, scrollbars) acompañen.
 *
 * ⚠ Para no pintar un cuadro con el tema equivocado, la herramienta aplica el tema ANTES de que cargue
 * el módulo, con el renglón de `THEME_BOOT` en el <head>; `applyTheme` repite lo mismo después. */
export const THEME_KEY = 'ui.theme';
/* LA PALETA de color (traída del playground compartido el 2026-11-11): cada una es un bloque de `theme.css`
 * (`:root[data-palette="…"]`, con su versión oscura) y elegirla es poner `data-palette` en el <html>. Sin el atributo,
 * la base tal cual. Acá no hay cookie de dominio como en el compartido: se guarda en `ui.palette` y, dentro de Cockpit,
 * la reparte Cockpit como el tema. */
export const PALETTE_KEY = 'ui.palette';
export const PALETTES = [
  { id: 'default', label: 'Por defecto' },
  { id: 'vintage', label: 'Vintage Paper' },
  { id: 'catppuccin', label: 'Catppuccin' },
  { id: 'nord', label: 'Nord' },
  { id: 'monokaipro', label: 'Monokai Pro' },
  { id: 'ristretto', label: 'Monokai Ristretto' },
];
const PALETTE_IDS = PALETTES.map((p) => p.id).join('|');
// El tema y la paleta ANTES de pintar (lo inyecta cada herramienta en su <head>): sin esto, un parpadeo del color base.
export const THEME_BOOT = `try{var t=localStorage.getItem('${THEME_KEY}');if(t!=='light'&&t!=='dark')t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.classList.toggle('dark',t==='dark');document.documentElement.style.colorScheme=t}catch(e){}try{var p=localStorage.getItem('${PALETTE_KEY}');if(p&&p!=='default'&&/^(${PALETTE_IDS})$/.test(p))document.documentElement.setAttribute('data-palette',p)}catch(e){}`;

function storedTheme() {
  try { const t = localStorage.getItem(THEME_KEY); return t === 'light' || t === 'dark' ? t : null; }
  catch { return null; }
}
function systemTheme() {
  try { return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; }
  catch { return 'dark'; }
}
// El tema que corresponde: lo que eligió la persona o, si nunca eligió, el del sistema.
export function preferredTheme() { return storedTheme() || systemTheme(); }
export function currentTheme() { return document.documentElement.classList.contains('dark') ? 'dark' : 'light'; }

// Aplica un tema y avisa con `ui-theme` (lo necesita lo que pinta por su cuenta: un iframe, un canvas).
export function applyTheme(theme) {
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  root.style.colorScheme = theme;
  try { dispatchEvent(new CustomEvent('ui-theme', { detail: { theme } })); } catch { /* sin eventos */ }
}
/* DENTRO DE COCKPIT (cockpit/, la app de escritorio) cada herramienta es un iframe con su propio origen, así que cada
   una guardaría su tema: una quedaría clara y otra oscura. Por eso, ahí, elegir avisa a Cockpit (`theme`), que se lo
   pasa a las demás; y lo que manda Cockpit se aplica y se guarda como si se hubiera elegido acá. Fuera de un iframe,
   nada de esto corre. */
const inFrame = (() => { try { return window.parent !== window; } catch { return true; } })();
// Elegir es explícito: se guarda, y a partir de ahí el sistema ya no manda.
export function setTheme(theme, { fromCockpit = false } = {}) {
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* preferencia opcional */ }
  applyTheme(theme);
  if (inFrame && !fromCockpit) {
    try { window.parent.postMessage({ cockpit: true, type: 'theme', theme }, '*'); } catch { /* sin Cockpit */ }
  }
}
function themeFromCockpit(e) {
  const d = e.data;
  if (e.source !== window.parent || !d || d.cockpit !== true || d.type !== 'theme') return;
  if ((d.theme === 'light' || d.theme === 'dark') && d.theme !== currentTheme()) setTheme(d.theme, { fromCockpit: true });
}

/* ── LA PALETA ──────────────────────────────────────────────────────────────────────────────────── */
const validPalette = (id) => (PALETTES.some((p) => p.id === id) ? id : null);
export function chosenPalette() {
  try { return validPalette(localStorage.getItem(PALETTE_KEY)) || 'default'; } catch { return 'default'; }
}
// Aplica una paleta y avisa con `ui-palette` (lo que pinta por su cuenta —un canvas— tiene que releer colores).
export function applyPalette(id) {
  const root = document.documentElement;
  if (id && id !== 'default' && validPalette(id)) root.setAttribute('data-palette', id);
  else root.removeAttribute('data-palette');
  try { dispatchEvent(new CustomEvent('ui-palette', { detail: { palette: id } })); } catch { /* sin eventos */ }
}
// Elegir es explícito: se guarda y se aplica; dentro de Cockpit, además se le avisa para que la pase a las demás.
export function setPalette(id, { fromCockpit = false } = {}) {
  if (!validPalette(id)) return;
  try { id === 'default' ? localStorage.removeItem(PALETTE_KEY) : localStorage.setItem(PALETTE_KEY, id); } catch { /* preferencia opcional */ }
  applyPalette(id);
  if (inFrame && !fromCockpit) {
    try { window.parent.postMessage({ cockpit: true, type: 'palette', palette: id }, '*'); } catch { /* sin Cockpit */ }
  }
}
function paletteFromCockpit(e) {
  const d = e.data;
  if (e.source !== window.parent || !d || d.cockpit !== true || d.type !== 'palette') return;
  if (validPalette(d.palette) && d.palette !== chosenPalette()) setPalette(d.palette, { fromCockpit: true });
}

// El botón del pie: el icono de contraste, fijo, y la etiqueta dice lo que hace el clic.
/* EL PANEL «CLAUDE» DE COCKPIT, EN EL PIE: dentro de Cockpit, al lado del botón de tema, un asterisco abre y cierra el
   panel donde se ve lo que hace Claude. Lo agrega esta base, así aparece en el pie de TODAS las herramientas sin que
   cada una lo declare; fuera de Cockpit no existe. Cockpit contesta con el estado (`claude`: abierto, y si hay
   actividad sin ver, que se marca con un punto). */
function cockpitClaudeButton(themeButton) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `${themeButton.className} cockpit-claude`.trim();
  button.innerHTML = '<span class="ui-icon" data-icon="claude" aria-hidden="true"></span>';
  button.setAttribute('aria-label', 'Lo que hace Claude');
  button.setAttribute('aria-pressed', 'false');
  button.title = 'Lo que hace Claude: abre o cierra el panel de Cockpit';
  const click = () => { try { window.parent.postMessage({ cockpit: true, type: 'claude' }, '*'); } catch { /* sin Cockpit */ } };
  const state = (e) => {
    const d = e.data;
    if (e.source !== window.parent || !d || d.cockpit !== true || d.type !== 'claude') return;
    button.setAttribute('aria-pressed', String(!!d.open));
    button.classList.toggle('unseen', !!d.unseen && !d.open);
  };
  button.addEventListener('click', click);
  addEventListener('message', state);
  themeButton.before(button);
  return () => { button.removeEventListener('click', click); removeEventListener('message', state); button.remove(); };
}

export function bindThemeToggle(button) {
  const icon = button.querySelector('.ui-icon') || button.appendChild(Object.assign(document.createElement('span'), { className: 'ui-icon' }));
  icon.setAttribute('aria-hidden', 'true');
  function paint() {
    const theme = currentTheme();
    const label = theme === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro';
    icon.dataset.icon = 'theme';
    button.setAttribute('aria-label', label);
    button.title = `${theme === 'dark' ? 'Tema oscuro' : 'Tema claro'} · ${label.toLowerCase()}`;
  }
  const click = () => setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
  // Mientras la persona no elija, el tema sigue al sistema si cambia (el modo nocturno del SO).
  let media = null;
  const follow = () => { if (!storedTheme()) applyTheme(systemTheme()); };
  try { media = matchMedia('(prefers-color-scheme: dark)'); media.addEventListener('change', follow); } catch { media = null; }
  button.addEventListener('click', click);
  addEventListener('ui-theme', paint);
  if (inFrame) addEventListener('message', themeFromCockpit);
  if (inFrame) addEventListener('message', paletteFromCockpit);
  const dropClaude = inFrame ? cockpitClaudeButton(button) : null;
  applyTheme(preferredTheme());
  applyPalette(chosenPalette());
  paint();
  return { destroy() { button.removeEventListener('click', click); removeEventListener('ui-theme', paint); media?.removeEventListener('change', follow); removeEventListener('message', themeFromCockpit); removeEventListener('message', paletteFromCockpit); dropClaude?.(); } };
}

/* ── LA CONSOLA MAXIMIZADA ──────────────────────────────────────────────────────────────────────
 * El botón de la banda de la consola le da todo el alto de la columna (`.workbench.panel-max`, en
 * workbench.css). Es temporal a propósito: no se guarda, porque es la única forma de tapar el editor y
 * nadie tiene que volver a una herramienta y encontrar el editor escondido. Se deshace con el mismo
 * botón o con Escape desde adentro de la consola. */
export function bindPanelMaximize(button, { root = button.closest('.workbench'), panel = button.closest('.panel') } = {}) {
  const icon = button.querySelector('.ui-icon') || button.appendChild(Object.assign(document.createElement('span'), { className: 'ui-icon' }));
  icon.setAttribute('aria-hidden', 'true');
  const isMax = () => root.classList.contains('panel-max');
  function paint() {
    const max = isMax();
    icon.dataset.icon = max ? 'restore' : 'maximize';
    const label = max ? 'Restaurar la consola' : 'Maximizar la consola';
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-pressed', String(max));
    button.title = label;
  }
  function set(max) { root.classList.toggle('panel-max', max); paint(); }
  const click = () => set(!isMax());
  const key = (e) => { if (e.key === 'Escape' && isMax() && panel?.contains(e.target)) { set(false); button.focus?.(); } };
  button.addEventListener('click', click);
  root.addEventListener('keydown', key);
  paint();
  return { set, destroy() { button.removeEventListener('click', click); root.removeEventListener('keydown', key); } };
}

// Directiva opcional para las tres apps Vue. El harness usa bindResize directamente.
const bindings = new WeakMap();
export function refreshResizers(container) {
  container.querySelectorAll('[role="separator"]').forEach((el) => bindings.get(el)?.sync());
}
export const vResize = {
  mounted(el, { value }) { bindings.set(el, bindResize(el, value)); },
  updated(el, { value }) { bindings.get(el)?.update(value); },
  beforeUnmount(el) { bindings.get(el)?.destroy(); bindings.delete(el); },
};

// Un único menú para Vue y HTML: se monta en body para no cortarse por el scroll
// de una región. Los datos se leen al abrir; los controles de negocio no se duplican.
let menuSequence = 0;
let closeCurrentMenu = null;
export function bindMenu(trigger, { getItems, onSelect, label = 'Más opciones' }) {
  let menu = null;
  const id = `workbench-menu-${++menuSequence}`;
  trigger.setAttribute('aria-haspopup', 'menu');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-controls', id);
  const focusable = () => [...(menu?.querySelectorAll('[role^="menuitem"]:not(:disabled)') || [])];
  function position() {
    if (!menu) return;
    const anchor = trigger.getBoundingClientRect();
    menu.style.maxWidth = `${Math.max(0, innerWidth - 16)}px`;
    menu.style.maxHeight = `${Math.max(0, innerHeight - 16)}px`;
    const box = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(anchor.right - box.width, innerWidth - box.width - 8))}px`;
    // Abajo del botón si entra; si no, ARRIBA: un menú que se abre desde el pie y se empuja contra el borde
    // tapaba al propio botón que lo abrió (el selector de perfil de keyring).
    const below = anchor.bottom + 4;
    const above = anchor.top - box.height - 4;
    const top = below + box.height + 8 <= innerHeight || above < 8 ? below : above;
    menu.style.top = `${Math.max(8, Math.min(top, innerHeight - box.height - 8))}px`;
  }
  function close(restoreFocus = false) {
    if (!menu) return;
    menu.remove(); menu = null;
    trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('focusin', focusOutside);
    document.removeEventListener('scroll', scrolled, true);
    window.removeEventListener('resize', position);
    if (closeCurrentMenu === close) closeCurrentMenu = null;
    if (restoreFocus && trigger.isConnected) trigger.focus({ preventScroll: true });
  }
  function outside(e) { if (!menu?.contains(e.target) && !trigger.contains(e.target)) close(); }
  function focusOutside(e) { if (!menu?.contains(e.target) && !trigger.contains(e.target)) close(); }
  // ⚠ Un check deja el menú abierto, pero lo que alterna puede mover un scroll de la región —filtrar el
  // log lo acorta y el navegador ajusta su `scrollTop`—, y ese scroll lo cerraba justo después del clic.
  // Se ignora el scroll de los dos cuadros que siguen a una selección: ese no lo hizo la persona.
  let settling = false;
  function settle() {
    settling = true;
    requestAnimationFrame(() => requestAnimationFrame(() => { settling = false; }));
  }
  function scrolled(e) { if (!settling && !menu?.contains(e.target)) close(); }
  function icon(name) {
    const span = document.createElement('span');
    span.className = 'ui-icon'; span.dataset.icon = name; span.setAttribute('aria-hidden', 'true');
    return span;
  }
  function refresh() {
    if (!menu) return;
    const focused = document.activeElement?.dataset.menuId;
    menu.replaceChildren();
    for (const item of getItems()) {
      if (item.separator) {
        const separator = document.createElement('hr'); separator.setAttribute('role', 'separator');
        menu.appendChild(separator); continue;
      }
      // Tres clases de ítem: una casilla (`checked`) se alterna y deja el menú abierto; una opción única
      // (`selected`: elegir un perfil, un ambiente) se marca igual pero cierra, porque ya se eligió; el
      // resto es una acción, que cierra.
      const radio = Object.hasOwn(item, 'selected');
      const checkbox = !radio && Object.hasOwn(item, 'checked');
      const link = !item.disabled && item.href && /^(https?:\/\/|\/)/.test(item.href);
      const control = document.createElement(link ? 'a' : 'button');
      control.className = 'region-menu-item';
      control.dataset.menuId = item.id;
      control.setAttribute('role', radio ? 'menuitemradio' : checkbox ? 'menuitemcheckbox' : 'menuitem');
      control.tabIndex = -1;
      if (checkbox) control.setAttribute('aria-checked', String(!!item.checked));
      if (radio) control.setAttribute('aria-checked', String(!!item.selected));
      if (link) { control.href = item.href; control.target = item.target || '_blank'; control.rel = 'noopener noreferrer'; }
      else { control.type = 'button'; control.disabled = !!item.disabled; }
      if (item.title) control.title = item.title;
      const glyph = icon(checkbox || radio ? 'check' : (item.icon || 'more'));
      if ((checkbox && !item.checked) || (radio && !item.selected)) glyph.style.visibility = 'hidden';
      control.appendChild(glyph);
      const text = document.createElement('span'); text.className = 'menu-label'; text.textContent = item.label;
      control.appendChild(text);
      if (item.count !== undefined) {
        const count = document.createElement('span'); count.className = 'n'; count.textContent = item.count;
        control.appendChild(count);
      }
      // El atajo del ítem, como tecla (`shortcut: 'mod+shift+c'`): el menú es donde se descubre.
      if (item.shortcut) {
        const k = document.createElement('kbd'); k.className = 'kbd'; k.textContent = formatShortcut(item.shortcut);
        control.appendChild(k);
      }
      control.addEventListener('click', () => {
        if (checkbox) settle();
        if (!checkbox) close(!link);
        onSelect?.(item.id);
        if (checkbox) queueMicrotask(refresh);
      });
      menu.appendChild(control);
    }
    position();
    if (focused) focusable().find((el) => el.dataset.menuId === focused)?.focus({ preventScroll: true });
  }
  function keys(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); return; }
    if (e.key === 'Tab') { close(true); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const items = focusable();
    const current = items.indexOf(document.activeElement);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1
      : (current + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  }
  function open(last = false) {
    if (menu) return;
    closeCurrentMenu?.(); closeCurrentMenu = close;
    menu = document.createElement('div'); menu.id = id; menu.className = 'region-menu';
    menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', label);
    menu.addEventListener('keydown', keys);
    document.body.appendChild(menu);
    trigger.setAttribute('aria-expanded', 'true');
    refresh();
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('focusin', focusOutside);
    document.addEventListener('scroll', scrolled, true);
    window.addEventListener('resize', position);
    const items = focusable(); items[last ? items.length - 1 : 0]?.focus({ preventScroll: true });
  }
  function toggle() { if (menu) close(true); else open(); }
  function triggerKeys(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); open(e.key === 'ArrowUp'); }
    if (e.key === 'Escape') close(true);
  }
  trigger.addEventListener('click', toggle);
  trigger.addEventListener('keydown', triggerKeys);
  return { open, close, refresh, destroy() {
    close(); trigger.removeEventListener('click', toggle); trigger.removeEventListener('keydown', triggerKeys);
  } };
}

// ── ATAJOS ───────────────────────────────────────────────────────────────────────────────────────
// Un atajo se escribe una vez, igual en todas las herramientas: 'mod+k', 'mod+shift+p', 'alt+r', '?', 'g t'
// no (sin secuencias). `mod` es ⌘ en Mac y Ctrl en el resto. formatShortcut lo muestra como se lee en ESA
// máquina (⌘K · Ctrl+K) y matchShortcut dice si un keydown es ése.
const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
export function formatShortcut(shortcut, mac = isMac()) {
  const names = mac ? { mod: '⌘', shift: '⇧', alt: '⌥', ctrl: '⌃', enter: '↩', escape: 'Esc', backspace: '⌫' }
    : { mod: 'Ctrl', shift: 'Shift', alt: 'Alt', ctrl: 'Ctrl', enter: 'Enter', escape: 'Esc', backspace: 'Retroceso' };
  const parts = String(shortcut).toLowerCase().split('+').map((p) => names[p] || (p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1)));
  return parts.join(mac ? '' : '+');
}
export function matchShortcut(e, shortcut, mac = isMac()) {
  const parts = String(shortcut).toLowerCase().split('+');
  const key = parts.pop();
  const want = { mod: parts.includes('mod'), shift: parts.includes('shift'), alt: parts.includes('alt'), ctrl: parts.includes('ctrl') };
  const mod = mac ? e.metaKey : e.ctrlKey;
  const ctrl = mac ? e.ctrlKey : false;
  // Un carácter que ya sale con Shift (?, !, :) no pide Shift aparte: '?' es Shift+/ en casi todos los teclados.
  const printable = key.length === 1 && !/[a-z0-9]/.test(key);
  if (mod !== want.mod || e.altKey !== want.alt || ctrl !== want.ctrl) return false;
  if (!printable && e.shiftKey !== want.shift) return false;
  const pressed = (e.key || '').toLowerCase();
  return pressed === key || (key.length === 1 && /[a-z0-9]/.test(key) && (e.code || '').toLowerCase() === (/[0-9]/.test(key) ? `digit${key}` : `key${key}`));
}
// Escribiendo en un campo, un atajo sin modificador (?, una letra) es texto, no un comando.
const typing = (el) => !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

// ── AVISO BREVE ──────────────────────────────────────────────────────────────────────────────────
// toast('Producto creado') · toast('Se borró la tarea', { action: { label: 'Deshacer', run: () => … } }).
// De a uno: uno nuevo reemplaza al anterior. Se va solo (4 s; con una acción, 8 s, para alcanzar a tocarla) y
// queda mientras el puntero está encima. Lo lee un lector de pantalla (aria-live).
let currentToast = null;
export function toast(title, { description = '', action = null, icon = '', kind = '', timeout } = {}) {
  currentToast?.close();
  let stack = document.querySelector('.toast-stack');
  if (!stack) {
    stack = document.createElement('div'); stack.className = 'toast-stack';
    stack.setAttribute('role', 'status'); stack.setAttribute('aria-live', 'polite');
    document.body.appendChild(stack);
  }
  const el = document.createElement('div');
  el.className = 'toast' + (kind === 'destructive' ? ' toast-destructive' : '');
  if (icon) { const i = document.createElement('span'); i.className = 'ui-icon toast-icon'; i.dataset.icon = icon; i.setAttribute('aria-hidden', 'true'); el.appendChild(i); }
  const t = document.createElement('div'); t.className = 'toast-title'; t.textContent = title; el.appendChild(t);
  if (description) { const d = document.createElement('div'); d.className = 'toast-desc'; d.textContent = description; el.appendChild(d); }
  const actions = document.createElement('div'); actions.className = 'toast-actions';
  if (action) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'btn btn-ghost btn-xs'; b.textContent = action.label;
    b.addEventListener('click', () => { handle.close(); action.run?.(); });
    actions.appendChild(b);
  }
  const x = document.createElement('button'); x.type = 'button'; x.className = 'region-action'; x.title = 'Cerrar'; x.setAttribute('aria-label', 'Cerrar el aviso');
  x.innerHTML = '<span class="ui-icon" data-icon="close" aria-hidden="true"></span>';
  x.addEventListener('click', () => handle.close());
  actions.appendChild(x); el.appendChild(actions);
  stack.appendChild(el);
  let timer = null;
  const ms = timeout ?? (action ? 8000 : 4000);
  const arm = () => { if (ms > 0) timer = setTimeout(() => handle.close(), ms); };
  el.addEventListener('pointerenter', () => clearTimeout(timer));
  el.addEventListener('pointerleave', arm);
  const handle = { el, close() { clearTimeout(timer); el.remove(); if (currentToast === handle) currentToast = null; } };
  currentToast = handle;
  arm();
  return handle;
}

// ── CONFIRMACIÓN ─────────────────────────────────────────────────────────────────────────────────
// if (await confirmDialog({ title: '¿Borrar el flujo «X»?', description: 'No se puede deshacer.', confirm: 'Borrar',
//   destructive: true })) … — en lugar de confirm(). Devuelve true sólo con el botón de confirmar; Escape, Cancelar o un
// clic afuera devuelven false. Con destructive, el foco arranca en Cancelar.
export function confirmDialog({ title, description = '', confirm = 'Confirmar', cancel = 'Cancelar', destructive = false } = {}) {
  return new Promise((resolve) => {
    const d = document.createElement('dialog'); d.className = 'ui-dialog';
    d.setAttribute('aria-labelledby', 'ui-dialog-title');
    const h = document.createElement('h2'); h.className = 'dialog-title'; h.id = 'ui-dialog-title'; h.textContent = title; d.appendChild(h);
    if (description) { const p = document.createElement('p'); p.className = 'dialog-desc'; p.textContent = description; d.appendChild(p); }
    const row = document.createElement('div'); row.className = 'dialog-actions';
    const no = document.createElement('button'); no.type = 'button'; no.className = 'btn btn-outline'; no.textContent = cancel;
    const yes = document.createElement('button'); yes.type = 'button'; yes.className = 'btn' + (destructive ? ' btn-destructive' : ''); yes.textContent = confirm;
    row.append(no, yes); d.appendChild(row);
    let answer = false;
    const done = (v) => { answer = v; d.close(); };
    no.addEventListener('click', () => done(false));
    yes.addEventListener('click', () => done(true));
    d.addEventListener('click', (e) => { if (e.target === d) done(false); }); // el clic en el fondo
    d.addEventListener('close', () => { d.remove(); resolve(answer); });
    document.body.appendChild(d);
    d.showModal();
    (destructive ? no : yes).focus();
  });
}

// ── PALETA DE COMANDOS ───────────────────────────────────────────────────────────────────────────
// registerCommands([{ id, label, group?, icon?, shortcut?, keywords?, hint?, when?: () => bool, run }]) suma los
// comandos de la herramienta (devuelve cómo sacarlos). bindCommandPalette() pone ⌘K (y ?, sin estar escribiendo)
// para abrirla y el atajo propio de cada comando. filterCommands es la búsqueda: sin tildes ni mayúsculas, todas
// las palabras tienen que aparecer, y gana la que empieza antes.
const commands = new Map();
export function registerCommands(list) {
  for (const c of list) commands.set(c.id, c);
  return () => { for (const c of list) if (commands.get(c.id) === c) commands.delete(c.id); };
}
const plain = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export function filterCommands(list, query) {
  const words = plain(query).split(/\s+/).filter(Boolean);
  if (!words.length) return list.slice();
  const scored = [];
  for (const c of list) {
    const label = plain(c.label), haystack = `${label} ${plain(c.group)} ${plain((c.keywords || []).join(' '))}`;
    if (!words.every((w) => haystack.includes(w))) continue;
    const at = label.indexOf(words[0]);
    scored.push({ c, score: (at < 0 ? 1000 : at) + (label.startsWith(words[0]) ? -500 : 0) });
  }
  return scored.sort((a, b) => a.score - b.score).map((x) => x.c);
}
const available = () => [...commands.values()].filter((c) => !c.when || c.when());
let palette = null;
export function openCommandPalette(initial = '') {
  if (palette) return;
  const d = document.createElement('dialog'); d.className = 'command'; d.setAttribute('aria-label', 'Comandos');
  const input = document.createElement('input'); input.className = 'command-input'; input.type = 'text';
  input.placeholder = 'Buscá una acción…'; input.setAttribute('role', 'combobox'); input.setAttribute('aria-expanded', 'true');
  input.setAttribute('aria-controls', 'command-list'); input.setAttribute('aria-autocomplete', 'list'); input.value = initial;
  const list = document.createElement('div'); list.className = 'command-list'; list.id = 'command-list'; list.setAttribute('role', 'listbox');
  d.append(input, list); document.body.appendChild(d);
  let shown = [], active = 0;
  function render() {
    shown = filterCommands(available(), input.value);
    active = Math.min(active, Math.max(0, shown.length - 1));
    list.replaceChildren();
    if (!shown.length) { const e = document.createElement('div'); e.className = 'command-empty'; e.textContent = 'Nada coincide'; list.appendChild(e); return; }
    let group = null;
    shown.forEach((c, i) => {
      if (!input.value.trim() && c.group && c.group !== group) {
        group = c.group; const g = document.createElement('div'); g.className = 'command-group'; g.textContent = c.group; list.appendChild(g);
      }
      const b = document.createElement('button'); b.type = 'button'; b.className = 'command-item'; b.id = `command-${i}`;
      b.setAttribute('role', 'option'); b.setAttribute('aria-selected', String(i === active)); b.tabIndex = -1;
      if (c.icon) { const ic = document.createElement('span'); ic.className = 'ui-icon'; ic.dataset.icon = c.icon; ic.setAttribute('aria-hidden', 'true'); b.appendChild(ic); }
      const l = document.createElement('span'); l.className = 'command-label'; l.textContent = c.label; b.appendChild(l);
      if (c.hint) { const h = document.createElement('span'); h.className = 'command-hint'; h.textContent = c.hint; b.appendChild(h); }
      if (c.shortcut) { const k = document.createElement('kbd'); k.className = 'kbd'; k.textContent = formatShortcut(c.shortcut); b.appendChild(k); }
      b.addEventListener('pointermove', () => { if (active !== i) { active = i; mark(); } });
      b.addEventListener('click', () => choose(i));
      list.appendChild(b);
    });
    input.setAttribute('aria-activedescendant', `command-${active}`);
  }
  function mark() {
    list.querySelectorAll('.command-item').forEach((b, i) => b.setAttribute('aria-selected', String(i === active)));
    input.setAttribute('aria-activedescendant', `command-${active}`);
    list.querySelector(`#command-${active}`)?.scrollIntoView({ block: 'nearest' });
  }
  function choose(i) { const c = shown[i]; d.close(); if (c) setTimeout(() => c.run?.(), 0); }
  input.addEventListener('input', () => { active = 0; render(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (shown.length) { active = (active + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length; mark(); } }
    else if (e.key === 'Home' && !input.value) { e.preventDefault(); active = 0; mark(); }
    else if (e.key === 'End' && !input.value) { e.preventDefault(); active = shown.length - 1; mark(); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(active); }
  });
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
  d.addEventListener('close', () => { d.remove(); palette = null; });
  palette = d;
  render();
  d.showModal();
  input.focus();
}
let paletteBound = false;
export function bindCommandPalette({ shortcut = 'mod+k' } = {}) {
  if (paletteBound) return;
  paletteBound = true;
  document.addEventListener('keydown', (e) => {
    if (palette || e.defaultPrevented) return;
    if (matchShortcut(e, shortcut) || (!typing(e.target) && matchShortcut(e, '?'))) { e.preventDefault(); openCommandPalette(); return; }
    for (const c of available()) {
      if (!c.shortcut || !matchShortcut(e, c.shortcut)) continue;
      // Sin modificador (una letra, ?), escribiendo en un campo es texto.
      if (!/(mod|alt|ctrl)\+/.test(c.shortcut) && typing(e.target)) continue;
      e.preventDefault(); c.run?.(); return;
    }
  });
}
