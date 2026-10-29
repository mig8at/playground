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
          { text: 'Creditop-SAS/vtex#21 · el conector, en main con el tag v5.0.0', done: true },
          { text: 'El alta de sucursales VTEX ya en main y en producción', done: true },
        ],
      },
      {
        title: 'Publicar en VTEX',
        items: [
          { text: 'Publicar la 5.0.0 y dejarla instalable (vtex publish + deploy)', done: true },
          { text: 'La 5.x en master de la cuenta de pruebas; dos ambientes: develop (qa) y master (prod)', done: true },
          { text: 'Compra en qa con la 5.0.0 publicada: aprobada y cobrada al facturar (Finished)', done: true },
          { text: 'Test Suite sin restringir: el modo prueba lo activa el header que manda VTEX (estándar del framework) y no aprueba pedidos reales', done: true },
        ],
      },
      {
        title: 'Hash y token desde el admin (CORE-913)',
        items: [
          { text: 'Token versión 5 desde el admin: se emite, se ve una vez y se revoca', done: true },
          { text: 'Sucursal ecommerce de prueba e<hash>-fake al crear el comercio, y botón para los existentes', done: true },
          { text: 'En qa la tienda VTEX usa ecf9342be-fake y la compra se aprueba de punta a punta', done: true },
          { text: 'Editar la sucursal ecommerce (URL, plataforma con Shopify, credenciales) en dev', done: true },
          { text: 'Llevar el admin a main y a producción: PR #349, falta aprobación, merge y tag', blocks: true, by: 'Oscar' },
          { text: 'Migración de is_test: diferida hasta que algún reporte la use (sin ella todo funciona)' },
        ],
      },
      {
        title: 'Prueba en producción',
        items: [
          { text: 'Sucursal ecommerce de prueba de Creditop en producción con su token versión 5', blocks: true },
          { text: 'Afiliación «Creditop prod» en master (modo Production) y su condición de pago', blocks: true },
          { text: 'Una compra en producción hasta el wizard', blocks: true },
        ],
      },
      {
        title: 'Primer comercio',
        items: [
          { text: 'Que VTEX homologue la 5.0.0 para que otras cuentas la instalen y la afilien (para nuestra cuenta no hace falta)', blocks: true, by: 'VTEX' },
          { text: 'Sucursal ecommerce de Mario Hernández (comercio 350) con su token versión 5', blocks: true, by: 'Comercial' },
        ],
      },
      {
        title: 'Después · no bloquea',
        items: [
          { text: 'Reembolso manual: el conector sigue contestando «hacerlo a mano» y además avisa a Creditop, que cancela el crédito aparte (el mismo procedimiento que Shopify)', by: 'Producto' },
          { text: 'Cuánto dura la referencia del link de pago', by: 'Producto' },
        ],
      },
      {
        title: 'Versión posterior',
        items: [
          { text: 'Aviso «Paga con Creditop» en la página del producto, como el de Addi (bloque del tema)', by: 'Producto' },
          { text: 'Formulario para los datos que faltan: tipo y número de documento, expedición (Payment App del checkout)', by: 'Producto' },
          { text: 'Que Creditop sepa cuándo el comercio facturó (el settle de VTEX) y, aparte, cuándo se entregó', by: 'Producto' },
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
          { text: 'Shopify como plataforma 4, ya en main y en producción', done: true },
        ],
      },
      {
        title: 'Aprobación de Shopify',
        items: [
          { text: 'Creditop como Payments Partner y el acuerdo de ingresos firmado', blocks: true, by: 'Shopify · Merchants' },
          { text: 'Definir el reembolso manual: la app lo aprueba en Shopify y avisa a Creditop, que cancela el crédito aparte (el mismo procedimiento que VTEX)', blocks: true, by: 'Producto' },
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
        ],
      },
      {
        title: 'Versión posterior',
        items: [
          { text: 'Aviso «Paga con Creditop» en la página del producto, como el de Addi (bloque de tema de la app)', by: 'Producto' },
          { text: 'Formulario para los datos que faltan: tipo y número de documento, expedición (falta ver cómo: el pago offsite no dibuja campos)', by: 'Producto' },
        ],
      },
    ],
  },
}
