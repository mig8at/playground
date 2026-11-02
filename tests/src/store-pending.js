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
        title: 'Hecho',
        items: [
          { text: 'Conector 5.0.0: pide la URL a payment-link, redirige al wizard y cobra al facturar', done: true },
          { text: 'payment-link y status en producción (legacy-backend v0.6.21)', done: true },
          { text: 'Conector en main (vtex#21), publicado y desplegado como 5.0.0', done: true },
          { text: 'Cuenta de pruebas con dos ambientes: develop contra qa y master contra prod', done: true },
          { text: 'Admin en dev: token versión 5, sucursales de prueba p/e, botón y edición (#345, #348)', done: true },
          { text: 'Compra en qa con la sucursal ecf9342be-fake: aprobada de punta a punta', done: true },
          { text: 'Test Suite sin restringir: el modo prueba lo activa el header que manda VTEX y no aprueba pedidos reales', done: true },
        ],
      },
      {
        title: 'Siguientes pasos, en orden',
        items: [
          { text: '1 · Aprobar y mergear el PR #349 a main (todo el admin de la tarea)', blocks: true, by: 'Oscar' },
          { text: '2 · Taguear legacy-application para desplegar a producción', blocks: true, by: 'Miguel' },
          { text: '3 · Admin de prod: en un comercio de prueba de Creditop, crear la sucursal ecommerce de prueba, ponerla en Vtex y emitir su token versión 5 (guardar hash y token en tests/.env)', blocks: true, by: 'Miguel' },
          { text: '4 · VTEX master: afiliación «Creditop prod» (v5, modo Production) con ese hash y token, y su condición de pago apagada', blocks: true, by: 'Miguel' },
          { text: '5 · Prueba en prod: apagar «Creditop qa», prender «Creditop prod», comprar hasta el wizard, verla en tests (prod) y volver las condiciones', blocks: true, by: 'Miguel' },
          { text: '6 · Homologación de la 5.0.0 en VTEX para que otras cuentas la instalen (preguntar si la 4.x pasó por eso)', blocks: true, by: 'VTEX · Oscar' },
          { text: '7 · Primer comercio: sucursal ecommerce de Mario Hernández con su token versión 5 y la afiliación en su cuenta', blocks: true, by: 'Comercial' },
        ],
      },
      {
        title: 'Después · no bloquea',
        items: [
          { text: 'Reembolso manual: el conector sigue contestando «hacerlo a mano» y además avisa a Creditop, que cancela el crédito aparte', by: 'Producto' },
          { text: 'Cuánto dura la referencia del link de pago', by: 'Producto' },
          { text: 'Migración de is_test: diferida hasta que algún reporte la use (sin ella todo funciona)' },
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
        title: 'Hecho',
        items: [
          { text: 'La app abre la sesión de pago, pide la URL a payment-link y resuelve con el aviso firmado', done: true },
          { text: 'Cierre en qa con una solicitud real: pedido pagado en Shopify', done: true },
          { text: 'Shopify como plataforma 4, en main y en producción', done: true },
          { text: 'Sucursal ecommerce de prueba e4a51ff3f-fake (tipo Shopify) con su token versión 5 en qa', done: true },
          { text: 'Shopify se puede elegir al crear y editar una sucursal ecommerce en el admin (dev)', done: true },
          { text: 'Compra en qa con la sucursal e4a51ff3f-fake: aprobada y la sesión resuelta como pagada', done: true },
          { text: 'Creditop aprobado como Payments Partner (2025-06) y acuerdo de ingresos firmado (2026-01-21, según el hilo con Shopify)', done: true },
          { text: 'La app de pagos se instala en cualquier plan: probada en una tienda Basic', done: true },
        ],
      },
      {
        title: 'Siguientes pasos, en orden',
        items: [

          { text: '1 · Retomar el hilo con Shopify: Colombia y COP, estado de la cuenta Partner 4296643 y qué exigen a un BNPL (liquidación en 5 días, reembolsos)', blocks: true, by: 'Manuela' },
          { text: '2 · Revisar y mergear Creditop-SAS/shopify#22 (la app)', blocks: true, by: 'Oscar' },
          { text: '3 · Alojar la app con URL fija en qa (después producción) y decidir dónde va el mTLS', blocks: true, by: 'Dani' },
          { text: '4 · shopify app deploy con las URLs de qa: versión nueva con una sola extensión de pago, avisando antes a Juan (dueño de las versiones de marzo)', blocks: true },
          { text: '5 · Definir el reembolso manual: la app lo aprueba en Shopify y avisa a Creditop, que cancela el crédito aparte', blocks: true, by: 'Producto' },
          { text: '6 · Pasar la revisión de la app de pagos de Shopify (2 a 3 semanas)', blocks: true, by: 'Shopify' },
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
