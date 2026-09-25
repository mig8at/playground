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

// Los mínimos son tokens de `taller.css` (`--sidebar-min`, `--panel-min`, `--editor-min`): se leen de
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
  // la mitad de las regiones del playground no plegaba.
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
    document.body.classList.add('redimensionando');
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
      document.body.classList.remove('redimensionando');
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
 * El tema es la clase `.dark` de `tema.css` en el <html>, más `color-scheme` para que los controles
 * nativos (fechas, selects, scrollbars) acompañen.
 *
 * ⚠ Para no pintar un cuadro con el tema equivocado, la herramienta aplica el tema ANTES de que cargue
 * el módulo, con el renglón de `THEME_BOOT` en el <head>; `applyTheme` repite lo mismo después. */
export const THEME_KEY = 'ui.theme';
export const THEME_BOOT = `try{var t=localStorage.getItem('${THEME_KEY}');if(t!=='light'&&t!=='dark')t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.classList.toggle('dark',t==='dark');document.documentElement.style.colorScheme=t}catch(e){}`;

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
// Elegir es explícito: se guarda, y a partir de ahí el sistema ya no manda.
export function setTheme(theme) {
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* preferencia opcional */ }
  applyTheme(theme);
}

// El botón del pie. Muestra el icono del tema ACTUAL y su etiqueta dice lo que hace el clic.
export function bindThemeToggle(button) {
  const icon = button.querySelector('.ui-icon') || button.appendChild(Object.assign(document.createElement('span'), { className: 'ui-icon' }));
  icon.setAttribute('aria-hidden', 'true');
  function paint() {
    const theme = currentTheme();
    const label = theme === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro';
    icon.dataset.icon = theme === 'dark' ? 'moon' : 'sun';
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
  applyTheme(preferredTheme());
  paint();
  return { destroy() { button.removeEventListener('click', click); removeEventListener('ui-theme', paint); media?.removeEventListener('change', follow); } };
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
    menu.style.top = `${Math.max(8, Math.min(anchor.bottom + 4, innerHeight - box.height - 8))}px`;
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
      if (item.separador) {
        const separator = document.createElement('hr'); separator.setAttribute('role', 'separator');
        menu.appendChild(separator); continue;
      }
      const checkbox = Object.hasOwn(item, 'checked');
      const link = !item.disabled && item.href && /^(https?:\/\/|\/)/.test(item.href);
      const control = document.createElement(link ? 'a' : 'button');
      control.className = 'region-menu-item';
      control.dataset.menuId = item.id;
      control.setAttribute('role', checkbox ? 'menuitemcheckbox' : 'menuitem');
      control.tabIndex = -1;
      if (checkbox) control.setAttribute('aria-checked', String(!!item.checked));
      if (link) { control.href = item.href; control.target = item.target || '_blank'; control.rel = 'noopener noreferrer'; }
      else { control.type = 'button'; control.disabled = !!item.disabled; }
      if (item.title) control.title = item.title;
      const glyph = icon(checkbox ? 'check' : (item.icon || 'more'));
      if (checkbox && !item.checked) glyph.style.visibility = 'hidden';
      control.appendChild(glyph);
      const text = document.createElement('span'); text.className = 'menu-label'; text.textContent = item.label;
      control.appendChild(text);
      if (item.count !== undefined) {
        const count = document.createElement('span'); count.className = 'n'; count.textContent = item.count;
        control.appendChild(count);
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
