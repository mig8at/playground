// Qué está hecho y qué falta para llevar cada tienda a producción, por etapas: lo que dibuja la vista «Pendientes».
// Sale de las tareas `integracion-vtex` e `integracion-shopify` del tablero (su sección «Pendientes»); si cambia allá,
// se cambia acá.
//
// Cada item: `done` (verde) o pendiente; `blocks` marca lo que frena la salida a producción; `by` dice de quién depende.
export const STORE_PENDING = {
  VTEX: {
    title: 'VTEX · camino a producción',
    stages: [
      {
        title: 'Construido y probado',
        items: [
          { text: 'El conector pide la URL a payment-link y redirige al wizard', done: true },
          { text: 'payment-link y status en main y en producción (v0.6.21)', done: true },
          { text: 'La apertura por referencia (?ref=) en main del backend y del front', done: true },
          { text: 'Compra real en la cuenta VTEX y Test Suite 7 de 7', done: true },
          { text: 'Recorrido completo en qa: pedido → solicitud en 11 → VTEX recibe approved', done: true },
          { text: 'El cobro al facturar: la transacción queda Finished', done: true },
          { text: 'El tipo de documento de VTEX se traduce a CC', done: true },
        ],
      },
      {
        title: 'Mergear',
        items: [
          { text: 'Creditop-SAS/vtex#21 · el conector', blocks: true },
          { text: 'Creditop-SAS/legacy-backend#1693 · alta de sucursales VTEX', blocks: true },
        ],
      },
      {
        title: 'Publicar en VTEX',
        items: [
          { text: 'Decidir si se restringe el modo Test Suite', blocks: true },
          { text: 'Publicar la 5.0.0 e instalarla sólo en la cuenta piloto: una 4.x rompería las tiendas que ya la tienen', blocks: true },
          { text: 'Que VTEX homologue la versión nueva', blocks: true, by: 'VTEX' },
        ],
      },
      {
        title: 'Primer comercio',
        items: [
          { text: 'Sucursal ecommerce de Mario Hernández (comercio 350) con su token', blocks: true, by: 'Comercial' },
        ],
      },
      {
        title: 'Después · no bloquea',
        items: [
          { text: 'Reembolsos y cancelaciones reales (hoy: «hacerlo a mano», que VTEX acepta)', by: 'Producto' },
          { text: 'Cuánto dura la referencia del link de pago', by: 'Producto' },
          { text: 'Revocar el token de la sucursal de prueba 530aa4f7' },
          { text: 'Devolverle la condición de pago a Oscar', by: 'Oscar' },
          { text: 'Qué tiendas tienen hoy el conector viejo (4.x)', by: 'Oscar' },
        ],
      },
    ],
  },
  Shopify: {
    title: 'Shopify · camino a producción',
    stages: [
      {
        title: 'Construido y probado',
        items: [
          { text: 'La app abre la sesión de pago y pide la URL a payment-link', done: true },
          { text: 'Checkout real en la tienda de desarrollo: el comprador cae en el wizard', done: true },
          { text: 'Aprobado, negado y pendiente con el aviso firmado', done: true },
          { text: 'Cierre en qa con una solicitud real, sin atarla a mano', done: true },
          { text: 'Shopify como plataforma 4: pedidos atribuidos a Shopify en qa', done: true },
          { text: 'payment-link publicado en el gateway de producción', done: true },
          { text: 'La config publicable pide sólo permisos de pagos', done: true },
        ],
      },
      {
        title: 'Mergear',
        items: [
          { text: 'Creditop-SAS/shopify#22 · la app', blocks: true },
          { text: 'Creditop-SAS/legacy-backend#1693 · la plataforma 4', blocks: true },
        ],
      },
      {
        title: 'Aprobación de Shopify',
        items: [
          { text: 'Creditop como Payments Partner y el acuerdo de ingresos firmado', blocks: true, by: 'Shopify · Merchants' },
          { text: 'Reembolsos: Shopify los pide y hoy la app los rechaza', blocks: true, by: 'Producto' },
          { text: 'Pasar la revisión de la app de pagos', blocks: true, by: 'Shopify' },
        ],
      },
      {
        title: 'Alojar',
        items: [
          { text: 'La app con URL fija en qa y en producción (en pausa hasta la aprobación)', blocks: true },
        ],
      },
      {
        title: 'Después · no bloquea',
        items: [
          { text: 'Tomar el celular de la dirección: el código está, falta una compra en qa' },
          { text: 'Ícono propio de Creditop en el checkout' },
          { text: 'Autenticación propia del aviso a la tienda', by: 'Oscar' },
          { text: 'Revocar el token de c390eed9 y el que quedó en la historia del repo', by: 'Oscar · Infra' },
        ],
      },
    ],
  },
}
