// Cómo habla cada tienda con legacy-backend y el wizard, paso a paso: lo que dibuja el diagrama del editor. Sale del
// código de `main` de legacy-backend (payment-link, el aviso al estado final y la consulta de estado) y de las ramas de
// los conectores (vtex#21, shopify#22). Si cambia un contrato, se cambia acá.
//
// Sólo lo esencial: quién le habla a quién. Cada paso es un mensaje `from` → `to` (los ids de `actors`); `phase`
// abre un tramo con título.
export const STORE_FLOWS = {
  VTEX: {
    title: 'VTEX · cómo se comunica una compra',
    actors: [
      { id: 'buyer', label: 'Comprador' },
      { id: 'store', label: 'VTEX' },
      { id: 'app', label: 'Conector' },
      { id: 'back', label: 'Creditop', sub: 'legacy-backend y wizard' },
    ],
    steps: [
      { phase: 'Clic en «Finalizar compra» · unos 5 s' },
      { from: 'buyer', to: 'store', text: 'Finalizar compra' },
      { note: 'store', text: 'Crea el pedido, con el pago pendiente' },
      { from: 'store', to: 'app', text: 'authorize' },
      { from: 'app', to: 'back', text: 'POST /legacy-api/ecommerce/payment-link' },
      { from: 'back', to: 'app', text: 'URL ?ref=', back: true },
      { from: 'app', to: 'store', text: 'pendiente + URL', back: true },
      { from: 'store', to: 'buyer', text: 'Lo redirige solo, sin otro clic', back: true },
      { phase: 'En Creditop' },
      { from: 'buyer', to: 'back', text: 'Hace la solicitud' },
      { phase: 'El resultado' },
      { from: 'back', to: 'store', text: 'Aviso: approved / denied' },
      { from: 'store', to: 'app', text: 'authorize de nuevo' },
      { from: 'app', to: 'back', text: 'GET /legacy-api/ecommerce/status/{paymentId}' },
      { from: 'app', to: 'store', text: 'Aprobado o negado', back: true },
      { note: 'store', text: 'Aprobado: listo para preparar · negado: se cancela' },
      { note: 'store', text: 'Si nadie avisa, VTEX lo cancela a las 6 h' },
      { phase: 'Al facturar' },
      { from: 'store', to: 'app', text: 'settle' },
      { from: 'app', to: 'back', text: 'GET /legacy-api/ecommerce/status/{paymentId}' },
      { note: 'store', text: 'Cobra' },
    ],
  },
  Shopify: {
    title: 'Shopify · cómo se comunica una compra',
    actors: [
      { id: 'buyer', label: 'Comprador' },
      { id: 'store', label: 'Shopify' },
      { id: 'app', label: 'App de pagos' },
      { id: 'back', label: 'Creditop', sub: 'legacy-backend y wizard' },
    ],
    steps: [
      { phase: 'Clic en «Pay now»' },
      { from: 'buyer', to: 'store', text: 'Pay now' },
      { from: 'store', to: 'app', text: 'Sesión de pago' },
      { from: 'app', to: 'back', text: 'POST /legacy-api/ecommerce/payment-link' },
      { from: 'back', to: 'app', text: 'URL ?ref=', back: true },
      { from: 'app', to: 'store', text: 'redirect_url', back: true },
      { from: 'store', to: 'buyer', text: 'Lo redirige solo, sin otro clic', back: true },
      { note: 'store', text: 'Todavía no hay pedido' },
      { phase: 'En Creditop' },
      { from: 'buyer', to: 'back', text: 'Hace la solicitud' },
      { phase: 'El resultado' },
      { from: 'back', to: 'app', text: 'Aviso firmado: «la solicitud cambió»' },
      { from: 'app', to: 'back', text: 'GET /legacy-api/ecommerce/status/{order_key}' },
      { from: 'back', to: 'app', text: 'completed / failed / cancelled / pending', back: true },
      { from: 'app', to: 'store', text: 'Resolve o Reject' },
      { note: 'store', text: 'Resolve: crea el pedido pagado · Reject: vuelve al checkout' },
      { phase: 'Si vuelve antes del resultado' },
      { from: 'buyer', to: 'app', text: '«Volver a la tienda»' },
      { from: 'app', to: 'store', text: 'Pending' },
      { note: 'store', text: 'Crea el pedido como pendiente de pago' },
      { phase: 'Si el aviso no llega' },
      { from: 'app', to: 'back', text: 'Cada 10 min: GET …/ecommerce/status de lo pendiente' },
      { from: 'app', to: 'store', text: 'Resolve o Reject' },
    ],
  },
}
