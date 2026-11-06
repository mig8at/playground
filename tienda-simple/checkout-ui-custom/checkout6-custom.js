/* Campos de Creditop en el checkout: «Auto-onboarding con Creditop».
 *
 * Cuando el comprador elige pagar con Creditop, el bloque de pago pide la fecha de nacimiento, la de expedición del
 * documento y la aceptación de los términos y la política de Creditop. Cada dato se guarda en el pedido como dato propio
 * de la app `creditop` (`vtexjs.checkout.setCustomData`); el conector de Creditop (5.1.0, con el switch encendido) los
 * lee del pedido y se los manda a Creditop, que así no vuelve a pedir el SMS ni el formulario.
 *
 * Requisitos de la tienda: la app `creditop` registrada en la configuración del checkout (campos birthDate,
 * expeditionDate y acceptedAt) y el switch encendido en la configuración de la app Creditop. Con otro medio de pago no
 * aparece nada y no se exige nada.
 */
(function () {
  var APP = 'creditop'
  var BOX_ID = 'creditop-auto-onboarding'
  // Los mismos documentos que el wizard de Creditop enlaza al pedir el celular.
  var TERMS_URL = 'https://ct-app-dev.s3.us-east-2.amazonaws.com/admin/config/terms-and-conditions/TERMINOS_Y_CONDICIONES_CREDITOP_COLOMBIA_SAS_V20260209.pdf'
  var POLICY_URL = 'https://ct-app-dev.s3.us-east-2.amazonaws.com/admin/config/terms-and-conditions/POLITICA_DE_TRATAMIENTO_DE_DATOS_CREDITOP_COLOMBIA_SAS_V20260310.pdf'

  function checkout() { return window.vtexjs && window.vtexjs.checkout }

  /* Lo que ya quedó guardado en el pedido (para volver a pintar el bloque sin perder lo escrito). */
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

  function complete() {
    var f = saved()
    return !!(f.birthDate && f.expeditionDate && f.acceptedAt)
  }

  function field(label, id, value, max) {
    return '<label class="cr-ao-field" for="' + id + '"><span>' + label + '</span>' +
      '<input type="date" id="' + id + '" value="' + (value || '') + '" max="' + max + '" required></label>'
  }

  function render() {
    var group = creditopGroup()
    if (!group || document.getElementById(BOX_ID)) return
    var f = saved()
    var today = new Date().toISOString().slice(0, 10)
    var box = document.createElement('div')
    box.id = BOX_ID
    box.innerHTML =
      '<p class="cr-ao-title">Para pagar a cuotas con Creditop</p>' +
      '<p class="cr-ao-help">Con estos datos Creditop no te los vuelve a pedir y el proceso es más rápido.</p>' +
      field('Fecha de nacimiento', 'cr-ao-birth', f.birthDate, today) +
      field('Fecha de expedición de la cédula', 'cr-ao-expedition', f.expeditionDate, today) +
      // El texto va en un solo <span>: la etiqueta es flex y, suelto, cada pedazo de texto y cada enlace era una columna.
      '<label class="cr-ao-accept"><input type="checkbox" id="cr-ao-accept"' + (f.acceptedAt ? ' checked' : '') + '>' +
      '<span>Acepto los <a href="' + TERMS_URL + '" target="_blank" rel="noopener">términos y condiciones</a> y la ' +
      '<a href="' + POLICY_URL + '" target="_blank" rel="noopener">política de tratamiento de datos</a> de Creditop.</span></label>' +
      '<p class="cr-ao-error" id="cr-ao-error" hidden>Completá tus fechas y aceptá los términos de Creditop para continuar.</p>'
    group.appendChild(box)
    box.querySelector('#cr-ao-birth').addEventListener('change', function (e) { save('birthDate', e.target.value); hideErrorIfFilled() })
    box.querySelector('#cr-ao-expedition').addEventListener('change', function (e) { save('expeditionDate', e.target.value); hideErrorIfFilled() })
    box.querySelector('#cr-ao-accept').addEventListener('change', function (e) {
      // La hora de la aceptación es la de la casilla: Creditop la guarda como el momento en que el comprador aceptó.
      save('acceptedAt', e.target.checked ? new Date().toISOString() : '')
      hideErrorIfFilled()
    })
  }

  /* El aviso de «falta algo» se va en cuanto el bloque está completo (se mira la pantalla: el pedido se guarda después). */
  function hideErrorIfFilled() {
    var error = document.getElementById('cr-ao-error')
    var birth = document.getElementById('cr-ao-birth')
    var expedition = document.getElementById('cr-ao-expedition')
    var accept = document.getElementById('cr-ao-accept')
    if (error && birth && birth.value && expedition && expedition.value && accept && accept.checked) error.hidden = true
  }

  /* «Comprar ahora» no avanza con Creditop elegido y algún dato sin completar: se dice qué falta. */
  document.addEventListener('click', function (e) {
    var button = e.target && e.target.closest && e.target.closest('#payment-data-submit, .payment-submit-wrap button, .btn-place-order')
    if (!button || !creditopGroup() || complete()) return
    e.preventDefault()
    e.stopPropagation()
    var error = document.getElementById('cr-ao-error')
    if (error) { error.hidden = false; error.scrollIntoView({ block: 'center', behavior: 'smooth' }) }
  }, true)

  // El checkout vuelve a pintar el paso de pago a menudo (al cambiar de medio, al recalcular): se mira y se repone.
  new MutationObserver(render).observe(document.documentElement, { childList: true, subtree: true })
  document.addEventListener('DOMContentLoaded', render)
})()
