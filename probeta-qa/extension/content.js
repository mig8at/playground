// En la página del wizard: lee lo que el panel necesita (la cédula escrita, la ruta), rellena los campos con lo del
// panel y, en datos personales, frena un instante el «Siguiente» para que el panel vuelva a dictar las centrales justo
// antes de que el backend las consulte.
(() => {
  if (window.__probetaQa) return;
  window.__probetaQa = true;

  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const labelOf = (el) => {
    const byFor = el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (byFor) return byFor.textContent || '';
    let p = el.parentElement;
    for (let i = 0; p && i < 4; i++, p = p.parentElement) { const l = p.querySelector('label'); if (l && !l.contains(el)) return l.textContent || ''; }
    return el.getAttribute('aria-label') || el.getAttribute('placeholder') || '';
  };
  // Un campo por su data-testid (lo más estable) o por su rótulo.
  const find = (testId, label) => {
    const byId = testId && document.querySelector(`[data-testid="${testId}"]`);
    if (byId && visible(byId)) return byId;
    return [...document.querySelectorAll('input:not([type=hidden]), textarea')].find((f) => visible(f) && label.test(labelOf(f))) || null;
  };
  // React no ve un `value =` suelto: se usa el setter nativo y se dispara `input`.
  const setValue = (el, value) => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const FIELDS = [
    ['amount', 'amount-input', /monto|cu[aá]nto/i],
    ['phone', 'phone-input', /celular|tel[eé]fono/i],
    ['doc', 'docnum-input', /n[uú]mero de (documento|identidad|identificaci[oó]n)|c[eé]dula/i],
    ['firstName', 'name-input', /^\s*nombre/i],
    ['lastName', 'surname-input', /apellido/i],
    ['email', 'email-input', /correo|email/i],
  ];
  const fill = (data) => {
    const done = [];
    for (const [key, testId, label] of FIELDS) {
      const v = data[key];
      const el = v != null && v !== '' ? find(testId, label) : null;
      if (!el || el.value === String(v)) continue;
      setValue(el, String(v));
      done.push(key);
    }
    if (fillOtp(String(data.otp || ''))) done.push('otp');
    return done;
  };
  /* EL OTP: el mismo componente (`Otp` de shared-components) en el ingreso (4 dígitos) y en la firma del pagaré
   * (`/otp-validation`, 6): el largo lo dice su `maxLength`. Sólo se escribe si el código que leyó el panel tiene ese
   * largo, para no poner el del ingreso en la firma. Si viene partido en casillas de a uno, se reparte. La pantalla del
   * código de la app (`/codigo`) no es un SMS: no se toca. */
  const fillOtp = (code) => {
    if (!code || /\/codigo\/?$/.test(location.pathname)) return false;
    const inputs = [...document.querySelectorAll('input:not([type=hidden])')].filter(visible);
    const one = document.querySelector('[data-testid="otp-input"]') || inputs.find((f) => f.name === 'otp' || f.autocomplete === 'one-time-code');
    if (one && visible(one)) {
      const max = Number(one.getAttribute('maxlength') || 0);
      if (max > 1 && max !== code.length) return false;
      if (one.value === code) return false;
      setValue(one, code); return true;
    }
    const boxes = inputs.filter((f) => f.getAttribute('maxlength') === '1');
    if (boxes.length !== code.length) return false;
    boxes.forEach((b, i) => setValue(b, code[i]));
    return true;
  };
  /* LA FECHA DE EXPEDICIÓN: un trío día / mes / año de Radix (`button[role=combobox]` sin name ni id). No se le puede
   * escribir: se abre cada combo y se toca la opción, EN ORDEN —el siguiente se habilita al elegir el anterior— y
   * volviendo a buscar los combos en cada paso, porque Radix reemplaza el nodo al cambiar el valor. Es la mecánica del
   * autorrelleno del harness (`pkg/autofill.ts`) con su regla (`pkg/date-trio.ts`): qué parte es cada combo sale de lo
   * que muestra o de su placeholder, y sólo se toca si la pantalla habla de la expedición. */
  const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\*/g, '').trim();
  const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
  const partOf = (el) => {
    const t = norm(el.textContent);
    if (MONTHS.includes(t)) return 'mes';
    if (/^\d{4}$/.test(t)) return 'anio';
    if (/^\d{1,2}$/.test(t)) return 'dia';
    const e = `${t} ${norm(el.getAttribute('aria-label'))}`;
    if (/\bmes\b|\bmonth\b/.test(e)) return 'mes';
    if (/\bano\b|\banio\b|\byear\b/.test(e)) return 'anio';
    if (/\bdia\b|\bday\b/.test(e)) return 'dia';
    return null;
  };
  const wanted = (part, date) => {
    const [aa, mm, dd] = date.split('-');
    if (part === 'anio') return [aa];
    if (part === 'mes') return [MONTHS[Number(mm) - 1], String(Number(mm)), mm];
    return [String(Number(dd)), dd];
  };
  const combos = () => [...document.querySelectorAll('[role=combobox],[aria-haspopup=listbox]')].filter(visible);
  const closePopover = async (trigger) => {
    for (let i = 0; i < 2 && trigger.getAttribute('aria-expanded') === 'true'; i++) {
      (document.activeElement || trigger).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
      await wait(120);
    }
  };
  const fillIssueDate = async (date, warnings) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return false;
    if (!/expedici|expedid/.test(norm(document.body.innerText.slice(0, 600)))) return false;
    const parts = combos().map(partOf);
    if (!['dia', 'mes', 'anio'].every((p) => parts.includes(p))) return false;
    let touched = false;
    for (const part of ['dia', 'mes', 'anio']) {
      const trigger = combos().find((c) => partOf(c) === part);
      if (!trigger) { warnings.push(`no encontré el combo del ${part}`); continue; }
      const want = wanted(part, date);
      if (want.some((w) => norm(w) === norm(trigger.textContent))) continue;   // ya está
      if (trigger.disabled || trigger.getAttribute('aria-disabled') === 'true' || trigger.hasAttribute('data-disabled')) { warnings.push(`el ${part} está deshabilitado`); continue; }
      trigger.click();
      await wait(250);
      const panel = document.getElementById(trigger.getAttribute('aria-controls') || '') || document;
      const option = [...panel.querySelectorAll('[role=option]:not([aria-disabled=true])')].find((o) => want.some((w) => norm(o.textContent) === norm(w)));
      if (!option) { await closePopover(trigger); warnings.push(`el ${part} no tiene «${want[0]}»`); continue; }
      option.scrollIntoView({ block: 'nearest' });
      option.click();
      await wait(250);
      await closePopover(trigger);
      touched = true;
    }
    return touched;
  };
  const docTyped = () => find('docnum-input', FIELDS[2][2])?.value?.replace(/\D/g, '') || '';

  chrome.runtime.onMessage.addListener((msg, _s, reply) => {
    if (msg?.type === 'page') { reply({ url: location.href, doc: docTyped() }); return false; }
    if (msg?.type === 'fill') {
      const data = msg.data || {};
      const filled = fill(data), warnings = [];
      fillIssueDate(String(data.issueDate || ''), warnings)
        .then((ok) => { if (ok) filled.push('expedición'); reply({ filled, warnings }); })
        .catch((e) => reply({ filled, warnings: [...warnings, `la fecha: ${e.message}`] }));
      return true;
    }
    return false;
  });

  // Al escribir la cédula, el panel se entera (para mostrar si ya existe y dictarle).
  let lastDoc = '';
  document.addEventListener('input', () => {
    const d = docTyped();
    if (d && d !== lastDoc && d.length >= 6) { lastDoc = d; chrome.runtime.sendMessage({ type: 'docTyped', doc: d, url: location.href }).catch(() => {}); }
  }, true);

  // EL «SIGUIENTE» DE DATOS PERSONALES: se frena una vez, el panel vuelve a dictar (hasta 8 s) y se toca de nuevo.
  let passing = false;
  document.addEventListener('click', async (ev) => {
    if (passing || !/\/personal-info/.test(location.pathname)) return;
    const btn = ev.target instanceof Element ? ev.target.closest('button') : null;
    if (!btn || !/^(siguiente|continuar|enviar)$/i.test((btn.textContent || '').trim())) return;
    ev.preventDefault(); ev.stopImmediatePropagation();
    const r = await Promise.race([
      chrome.runtime.sendMessage({ type: 'beforeSubmit', url: location.href }).catch(() => null),
      new Promise((ok) => setTimeout(() => ok(null), 8000)),
    ]);
    passing = true;
    btn.click();
    setTimeout(() => { passing = false; }, 1500);
    void r;
  }, true);

  /* EL SALTO AL CLIENTE, EN LA PÁGINA: en `…/<solicitud>/continue` («Solicitud en validación de usuario») el cliente
   * seguiría desde el link del WhatsApp, que en las pruebas no le llega a nadie. Un botón flotante lleva la pestaña a
   * `/self-service/<sucursal>/<solicitud>/confirmation`, como si lo hubiera abierto. En Shadow DOM, para que el CSS del
   * wizard no lo toque; el wizard navega sin recargar, así que se mira la ruta cada medio segundo. */
  const clientLink = () => {
    const m = /^\/(?:merchant|self-service)\/([0-9a-f]{8})\/(\d{5,9})\/continue/.exec(location.pathname);
    return m ? `${location.origin}/self-service/${m[1]}/${m[2]}/confirmation` : null;
  };
  let jump = null;
  const syncJump = () => {
    const link = clientLink();
    if (!link) { jump?.remove(); jump = null; return; }
    if (jump?.dataset.link === link && jump.isConnected) return;
    jump?.remove();
    jump = document.createElement('div');
    jump.dataset.link = link;
    jump.style.cssText = 'position:fixed;z-index:2147483647;left:50%;bottom:16px;transform:translateX(-50%)';
    const root = jump.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>
      button { all: unset; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 2px;
        padding: 10px 18px; border-radius: 12px; background: #1c1c1a; color: #fafaf9; box-shadow: 0 6px 20px rgba(0,0,0,.25);
        font: 600 14px/1.2 system-ui, -apple-system, sans-serif; white-space: nowrap }
      button:hover { background: #2f2f2c }
      small { font-weight: 400; font-size: 11px; color: #b4b2a9 }
    </style><button title="${link}">Continuar como el cliente →<small>Probeta-qa · el link del WhatsApp</small></button>`;
    root.querySelector('button').onclick = () => { location.href = link; };
    document.documentElement.appendChild(jump);
  };
  syncJump();
  setInterval(syncJump, 500);
})();
