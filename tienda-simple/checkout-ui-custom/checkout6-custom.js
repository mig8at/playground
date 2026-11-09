/* Campos de Creditop en el checkout: «Auto-onboarding con Creditop».
 *
 * Cuando el comprador elige pagar con Creditop, el bloque de pago pide la fecha de nacimiento, la de expedición del
 * documento y la aceptación de los términos y la política de Creditop. Cada dato se guarda en el pedido como dato propio
 * de la app `creditop` (`vtexjs.checkout.setCustomData`); el conector de Creditop (5.1.0, con el switch encendido) los
 * lee del pedido y se los manda a Creditop, que así no vuelve a pedir el SMS ni el formulario.
 *
 * Requisitos de la tienda: la app `creditop` registrada en la configuración del checkout (campos birthDate,
 * expeditionDate y acceptedAt). Con otro medio de pago no aparece nada y no se exige nada.
 *
 * El switch manda: el script le pregunta al conector (`/_v/creditop/auto-onboarding`, 5.1.0) si está prendido. Apagado,
 * sin conector que conteste o mientras no contestó, no pide nada ni frena la compra: el comprador sigue por el SMS.
 *
 * La ACEPTACIÓN se da en cada visita al checkout: la que quedó guardada en el carrito de una compra anterior (el carrito
 * de VTEX la conserva) se borra al abrir el bloque, porque Creditop guarda esa hora como el momento en que el comprador
 * aceptó. Las fechas sí se conservan (las ve el comprador) y sólo se guardan si son válidas: mayor de 18 años y la
 * expedición posterior al nacimiento y no futura. Una fecha imposible no llega a Creditop.
 */
(function () {
  var APP = 'creditop'
  var BOX_ID = 'creditop-auto-onboarding'
  var SWITCH_URL = '/_v/creditop/auto-onboarding'
  // Los mismos documentos que el wizard de Creditop enlaza al pedir el celular.
  // ⚠ Son los del ambiente de pruebas: para una tienda en producción van los de producción.
  var TERMS_URL = 'https://ct-app-dev.s3.us-east-2.amazonaws.com/admin/config/terms-and-conditions/TERMINOS_Y_CONDICIONES_CREDITOP_COLOMBIA_SAS_V20260209.pdf'
  var POLICY_URL = 'https://ct-app-dev.s3.us-east-2.amazonaws.com/admin/config/terms-and-conditions/POLITICA_DE_TRATAMIENTO_DE_DATOS_CREDITOP_COLOMBIA_SAS_V20260310.pdf'
  var MIN_AGE = 18

  // null: todavía no se sabe · true / false: lo que contestó el conector (falla = false).
  var enabled = null
  // Lo que el comprador dejó en ESTA visita (las fechas pueden venir del carrito; la aceptación, nunca).
  var state = { birthDate: '', expeditionDate: '', acceptedAt: '' }
  var opened = false

  function askSwitch() {
    if (!window.fetch) { enabled = false; return }
    fetch(SWITCH_URL, { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : {} })
      .then(function (body) { enabled = body && body.autoOnboarding === true; render() })
      .catch(function () { enabled = false })
  }

  function checkout() { return window.vtexjs && window.vtexjs.checkout }

  /* Lo que quedó guardado en el carrito. */
  function saved() {
    var of = checkout() && checkout().orderForm
    var apps = (of && of.customData && of.customData.customApps) || []
    for (var i = 0; i < apps.length; i++) if (apps[i].id === APP) return apps[i].fields || {}
    return {}
  }

  function save(field, value) {
    var c = checkout()
    if (!c || !c.setCustomData) return
    c.setCustomData({ app: APP, field: field, value: value || '' })
  }

  /* El bloque de Creditop en el paso de pago: está en la pantalla sólo mientras Creditop es el medio elegido. */
  function creditopGroup() { return document.querySelector('.CreditopGroupPaymentGroup') }

  function today() { return new Date().toISOString().slice(0, 10) }

  function yearsAgo(n) {
    var d = new Date()
    d.setFullYear(d.getFullYear() - n)
    return d.toISOString().slice(0, 10)
  }

  /* Por qué una fecha no vale ('' si vale). Las fechas `AAAA-MM-DD` se comparan como texto. */
  function birthProblem(v) {
    if (!v) return ''
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || v < '1900-01-01') return 'La fecha de nacimiento no es válida.'
    if (v > yearsAgo(MIN_AGE)) return 'Para pagar con Creditop tenés que ser mayor de ' + MIN_AGE + ' años.'
    return ''
  }

  function expeditionProblem(v, birth) {
    if (!v) return ''
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || v > today()) return 'La fecha de expedición no es válida.'
    if (birth && v <= birth) return 'La fecha de expedición tiene que ser posterior a la de nacimiento.'
    return ''
  }

  function complete() {
    return !!(state.birthDate && state.expeditionDate && state.acceptedAt)
  }

  function field(label, id, value, min, max) {
    return '<label class="cr-ao-field" for="' + id + '"><span>' + label + '</span>' +
      '<input type="date" id="' + id + '" value="' + (value || '') + '" min="' + min + '" max="' + max + '" required>' +
      '<small class="cr-ao-field-error" id="' + id + '-error" hidden></small></label>'
  }

  function showFieldError(id, message) {
    var el = document.getElementById(id + '-error')
    var input = document.getElementById(id)
    if (el) { el.textContent = message; el.hidden = !message }
    if (input) input.setAttribute('aria-invalid', message ? 'true' : 'false')
  }

  /* Valida las dos fechas juntas (la expedición depende del nacimiento) y guarda en el carrito sólo lo válido. */
  function onDates() {
    var birth = document.getElementById('cr-ao-birth').value
    var expedition = document.getElementById('cr-ao-expedition').value
    var birthError = birthProblem(birth)
    var expeditionError = expeditionProblem(expedition, birthError ? '' : birth)
    showFieldError('cr-ao-birth', birthError)
    showFieldError('cr-ao-expedition', expeditionError)
    var nextBirth = birth && !birthError ? birth : ''
    var nextExpedition = expedition && !expeditionError ? expedition : ''
    if (nextBirth !== state.birthDate) { state.birthDate = nextBirth; save('birthDate', nextBirth) }
    if (nextExpedition !== state.expeditionDate) { state.expeditionDate = nextExpedition; save('expeditionDate', nextExpedition) }
    hideErrorIfComplete()
  }

  function render() {
    if (enabled !== true) return
    var group = creditopGroup()
    if (!group || document.getElementById(BOX_ID)) return

    if (!opened) {
      // Primera vez en esta visita: las fechas del carrito se toman si son válidas y la aceptación vieja se borra.
      opened = true
      var f = saved()
      if (f.birthDate && !birthProblem(f.birthDate)) state.birthDate = f.birthDate
      if (f.expeditionDate && !expeditionProblem(f.expeditionDate, state.birthDate)) state.expeditionDate = f.expeditionDate
      if (f.acceptedAt) save('acceptedAt', '')
    }

    var box = document.createElement('div')
    box.id = BOX_ID
    box.innerHTML =
      '<p class="cr-ao-title">Para pagar a cuotas con Creditop</p>' +
      '<p class="cr-ao-help">Con estos datos Creditop no te los vuelve a pedir y el proceso es más rápido.</p>' +
      field('Fecha de nacimiento', 'cr-ao-birth', state.birthDate, '1900-01-01', yearsAgo(MIN_AGE)) +
      field('Fecha de expedición de la cédula', 'cr-ao-expedition', state.expeditionDate, '1900-01-01', today()) +
      // El texto va en un solo <span>: la etiqueta es flex y, suelto, cada pedazo de texto y cada enlace era una columna.
      '<label class="cr-ao-accept"><input type="checkbox" id="cr-ao-accept"' + (state.acceptedAt ? ' checked' : '') + '>' +
      '<span>Acepto los <a href="' + TERMS_URL + '" target="_blank" rel="noopener">términos y condiciones</a> y la ' +
      '<a href="' + POLICY_URL + '" target="_blank" rel="noopener">política de tratamiento de datos</a> de Creditop.</span></label>' +
      '<p class="cr-ao-error" id="cr-ao-error" hidden>Completá tus fechas y aceptá los términos de Creditop para continuar.</p>'
    group.appendChild(box)
    box.querySelector('#cr-ao-birth').addEventListener('change', onDates)
    box.querySelector('#cr-ao-expedition').addEventListener('change', onDates)
    box.querySelector('#cr-ao-accept').addEventListener('change', function (e) {
      // La hora de la aceptación es la de la casilla: Creditop la guarda como el momento en que el comprador aceptó.
      state.acceptedAt = e.target.checked ? new Date().toISOString() : ''
      save('acceptedAt', state.acceptedAt)
      hideErrorIfComplete()
    })
  }

  /* El aviso de «falta algo» se va en cuanto el bloque está completo. */
  function hideErrorIfComplete() {
    var error = document.getElementById('cr-ao-error')
    if (error && complete()) error.hidden = true
  }

  /* «Comprar ahora» no avanza con Creditop elegido y algún dato sin completar: se dice qué falta.
   * Sólo en el paso de pago: el checkout arma ese paso oculto desde el carrito, y el «Finalizar compra» del carrito
   * (`#cart-to-orderform`) también lleva `.btn-place-order`; sin esta guarda el carrito quedaba sin avanzar. */
  document.addEventListener('click', function (e) {
    if (location.hash.indexOf('#/payment') !== 0) return
    var button = e.target && e.target.closest && e.target.closest('#payment-data-submit, .payment-submit-wrap button, .btn-place-order')
    if (!button || button.id === 'cart-to-orderform') return
    if (enabled !== true || !creditopGroup() || complete()) return
    e.preventDefault()
    e.stopPropagation()
    var error = document.getElementById('cr-ao-error')
    if (error) { error.hidden = false; error.scrollIntoView({ block: 'center', behavior: 'smooth' }) }
  }, true)

  // El checkout vuelve a pintar el paso de pago a menudo (al cambiar de medio, al recalcular): se mira y se repone.
  new MutationObserver(render).observe(document.documentElement, { childList: true, subtree: true })
  document.addEventListener('DOMContentLoaded', render)
  askSwitch()
})()
