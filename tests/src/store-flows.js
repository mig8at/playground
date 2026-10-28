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
      { id: 'back', label: 'legacy-backend' },
      { id: 'front', label: 'Wizard' },
    ],
    steps: [
      { phase: 'La compra' },
      { from: 'buyer', to: 'store', text: 'Paga con Creditop' },
      { from: 'store', to: 'app', text: 'authorize' },
      { from: 'app', to: 'back', text: 'payment-link' },
      { from: 'back', to: 'buyer', text: 'URL del wizard (?ref=)', back: true },
      { phase: 'En Creditop' },
      { from: 'buyer', to: 'front', text: 'Abre el pedido' },
      { from: 'front', to: 'back', text: 'OTP y solicitud' },
      { phase: 'El resultado' },
      { from: 'back', to: 'store', text: 'Aviso: approved / denied' },
      { from: 'store', to: 'app', text: 'authorize de nuevo' },
      { from: 'app', to: 'back', text: 'status' },
      { from: 'store', to: 'app', text: 'settle al facturar: cobra' },
    ],
  },
  Shopify: {
    title: 'Shopify · cómo se comunica una compra',
    actors: [
      { id: 'buyer', label: 'Comprador' },
      { id: 'store', label: 'Shopify' },
      { id: 'app', label: 'App de pagos' },
      { id: 'back', label: 'legacy-backend' },
      { id: 'front', label: 'Wizard' },
    ],
    steps: [
      { phase: 'La compra' },
      { from: 'buyer', to: 'store', text: 'Paga con Creditop' },
      { from: 'store', to: 'app', text: 'Sesión de pago' },
      { from: 'app', to: 'back', text: 'payment-link' },
      { from: 'back', to: 'buyer', text: 'URL del wizard (?ref=)', back: true },
      { phase: 'En Creditop' },
      { from: 'buyer', to: 'front', text: 'Abre el pedido' },
      { from: 'front', to: 'back', text: 'OTP y solicitud' },
      { phase: 'El resultado' },
      { from: 'back', to: 'app', text: 'Aviso: completed / failed' },
      { from: 'app', to: 'store', text: 'Pagado o rechazado' },
    ],
  },
}
