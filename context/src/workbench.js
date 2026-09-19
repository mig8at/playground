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

export function bindResize(handle, options) {
  let o = options;
  let stop = () => {};
  const number = (v) => Number(typeof v === 'function' ? v() : v);
  const bounds = () => {
    const max = Math.max(0, number(o.max));
    return { min: Math.min(number(o.min), max), max };
  };
  function sync() {
    const { min, max } = bounds();
    handle.setAttribute('role', 'separator');
    handle.setAttribute('tabindex', '0');
    handle.setAttribute('aria-orientation', o.axis === 'y' ? 'horizontal' : 'vertical');
    handle.setAttribute('aria-label', o.label);
    handle.setAttribute('aria-valuemin', String(o.collapsible ? 0 : min));
    handle.setAttribute('aria-valuemax', String(Math.round(max)));
    handle.setAttribute('aria-valuenow', String(Math.round(o.get())));
    handle.setAttribute('aria-valuetext', o.get() ? `${Math.round(o.get())} píxeles` : 'Oculto');
    handle.title = `${o.label} · arrastra o usa las flechas · doble clic para restablecer`;
  }
  function set(value, collapse = false) {
    const { min, max } = bounds();
    const next = o.collapsible && (value === 0 || (collapse && value < min - 28))
      ? 0 : Math.max(min, Math.min(max, value));
    o.set(Math.round(next));
    sync();
  }
  const finish = () => o.commit?.(o.get());
  function reset() { set(number(o.defaultValue)); finish(); }
  function keydown(e) {
    const vertical = o.axis === 'y';
    const decrement = vertical ? 'ArrowUp' : 'ArrowLeft';
    const increment = vertical ? 'ArrowDown' : 'ArrowRight';
    const { min, max } = bounds();
    if (![decrement, increment, 'Home', 'End', 'Enter'].includes(e.key)) return;
    e.preventDefault();
    if (e.key === 'Enter') {
      if (o.collapsible) set(o.get() ? 0 : number(o.defaultValue));
      else set(number(o.defaultValue));
    } else if (e.key === 'Home') set(o.collapsible ? 0 : min);
    else if (e.key === 'End') set(max);
    else set(o.get() + (e.key === increment ? 1 : -1) * (o.sign ?? 1) * (e.shiftKey ? 48 : 16), true);
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
    const move = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      set(initial + ((o.axis === 'y' ? ev.clientY : ev.clientX) - start) * (o.sign ?? 1), true);
    };
    const end = (ev) => { if (ev.pointerId === e.pointerId) stop(); };
    handle.classList.add('on');
    document.body.classList.add('redimensionando');
    document.body.style.cursor = o.axis === 'y' ? 'row-resize' : 'col-resize';
    stop = () => {
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
  handle.addEventListener('dblclick', reset);
  sync();
  return {
    update(next) { o = next; sync(); },
    sync,
    destroy() {
      stop();
      handle.removeEventListener('keydown', keydown);
      handle.removeEventListener('pointerdown', pointerdown);
      handle.removeEventListener('dblclick', reset);
    },
  };
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
  function scrolled(e) { if (!menu?.contains(e.target)) close(); }
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
