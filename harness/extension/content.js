// En la página del wizard: lee lo que el panel necesita (la cédula escrita, la ruta), rellena los campos con lo del
// panel y, en datos personales, frena un instante el «Siguiente» para que el panel vuelva a dictar las centrales justo
// antes de que el backend las consulte.
(() => {
  if (window.__clienteDePrueba) return;
  window.__clienteDePrueba = true;

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
  const docTyped = () => find('docnum-input', FIELDS[2][2])?.value?.replace(/\D/g, '') || '';

  chrome.runtime.onMessage.addListener((msg, _s, reply) => {
    if (msg?.type === 'page') { reply({ url: location.href, doc: docTyped() }); return false; }
    if (msg?.type === 'fill') { reply({ filled: fill(msg.data || {}) }); return false; }
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
})();
