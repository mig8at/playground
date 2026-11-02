/* Qué es cada tabla, en palabras de negocio: lo que aparece en la consola al tocar el título de una tabla.
 *
 * `source` dice de dónde sale cada descripción, para que se distinga lo comprobado de lo leído:
 *   · «código» — se leyó el código de legacy-backend (main) que la escribe o la usa;
 *   · «base» — se midió en la base (qué filas deja una solicitud de prueba y con qué valores);
 *   · «columnas» — sale del nombre y las columnas de la tabla, SIN verificar en el código.
 * Una tabla que no está acá muestra sólo eso: que todavía no tiene descripción. Al corregir una, se cambia acá. */
export const TABLE_DOCS = {
  user_requests: {
    title: 'La solicitud de crédito',
    what: 'Una fila por solicitud: de qué comercio y sucursal viene, cuánto pide el cliente, en qué estado va (user_request_status_id), qué entidad eligió (lender_id) y, cuando pase, cuándo se desembolsó (disbursed_at).',
    why: 'Es el centro de todo: el resto de las tablas cuelga de su id. Vacío en lender_id quiere decir que todavía no eligió entidad.',
    source: 'código y base',
  },
  users: {
    title: 'La persona',
    what: 'El cliente que pidió el crédito: nombre (como quedó después de la validación de identidad), cédula, celular, correo, si ya se validó y por qué canal entró.',
    why: 'La misma tabla guarda al personal (asesores, administradores): las columnas de comercio, sucursal y entidad son de ellos, no del cliente. El celular, el correo y la cédula de un cliente activo son únicos: por eso hay que darlo de baja para repetir un registro.',
    source: 'código y base',
  },
  user_field_values: {
    title: 'Lo que respondió (o se completó) del perfil',
    what: 'Una fila por dato del formulario: situación laboral (campo 29), ingresos (87), egresos (90) y otros. Puede venir de lo que escribió el cliente o de lo que contestó una central (Ágil Data, Mareigua).',
    why: 'Es lo que miran las reglas de las entidades: si el ingreso está acá es porque alguien lo dio.',
    source: 'código y base',
  },
  ecommerce_requests: {
    title: 'El pedido de la tienda',
    what: 'Lo que mandó la tienda online (Shopify, VTEX, WooCommerce) al pedir el enlace de pago: el pedido, el monto, el comprador, a dónde vuelve el cliente al terminar (return_url) y a dónde se avisa el resultado (process_url).',
    why: 'Con origin = payment_link, la tienda pidió el enlace por API y el cliente llega con una referencia (checkout_reference) que vence a la hora. products vacío quiere decir que la tienda no mandó qué compró.',
    source: 'código y base',
  },
  user_requests_by_ecommerce_request: {
    title: 'El vínculo entre el pedido y la solicitud',
    what: 'Une un pedido de la tienda con la solicitud que nació de él.',
    why: 'Es por donde el backend sabe a qué tienda avisarle cuando la solicitud termina (aprobada, negada o cancelada).',
    source: 'código',
  },
  ecommerce_requests_log: {
    title: 'La bitácora del pedido',
    what: 'Lo que el backend fue haciendo con el pedido de la tienda: por ejemplo, cuándo le asignó la solicitud.',
    why: 'Sirve para reconstruir el recorrido del pedido; no decide nada.',
    source: 'base',
  },
  user_request_records: {
    title: 'El historial de estados',
    what: 'Una fila cada vez que la solicitud cambió de estado: a cuál, cuándo y quién la movió (update_by).',
    why: 'Ojo: lo que cambia el estado sin pasar por la aplicación (el simulador de qa, un UPDATE a mano) no deja fila acá.',
    source: 'código y base',
  },
  kyc_name_checks: {
    title: 'La comparación del nombre con las centrales',
    what: 'Una fila cada vez que se comparó el nombre que escribió el cliente con el que devolvió una central de identidad (Ágil Data, Mareigua, TusDatos): si coincidió y, si no, por qué (por ejemplo wrong_document: ninguna palabra en común).',
    why: 'Es sólo un registro: no aprueba ni rechaza. Si Ágil Data no coincide, la cadena pregunta a TusDatos, que decide. TusDatos guarda sus filas sin número de solicitud.',
    source: 'código',
  },
  risk_central_user_data: {
    title: 'Lo que contestaron las centrales',
    what: 'La respuesta guardada de cada central de riesgo o de identidad para la persona (cifrada).',
    why: 'Funciona como caché por usuario: mientras exista una respuesta reciente, el backend no vuelve a consultar la central.',
    source: 'código',
  },
  user_request_risk_central_user_data: {
    title: 'Qué respuestas de centrales usó la solicitud',
    what: 'Une la solicitud con las respuestas de centrales (risk_central_user_data) que se tuvieron en cuenta para ella.',
    why: 'Permite saber con qué datos de las centrales se decidió esta solicitud.',
    source: 'columnas',
  },
  logs: {
    title: 'La bitácora técnica',
    what: 'Eventos que el backend registra durante la solicitud, con lo que pidió y lo que recibió: por ejemplo, que no se consultó Experian y por qué.',
    why: 'Sirve para entender una decisión del sistema; no cambia nada.',
    source: 'base',
  },
  solicitudes_audit: {
    title: 'La auditoría de la solicitud',
    what: 'Histórico de cambios sobre la solicitud y sus datos relacionados: qué campo cambió, de qué valor a cuál y cuándo.',
    why: 'Lo escribe la base misma, así que también ve cambios que no dejan rastro en el historial de estados.',
    source: 'base',
  },
  twilio_logs: {
    title: 'Los mensajes enviados al cliente',
    what: 'Cada SMS o WhatsApp que se intentó mandar durante la solicitud (por ejemplo, el enlace para seguir en el celular), con lo que se pidió y lo que respondió el servicio de mensajes.',
    why: 'Si el mensaje falló, acá está el error (por ejemplo, una plantilla que no existe en el ambiente).',
    source: 'base',
  },
  otp_logs: {
    title: 'Los códigos de verificación',
    what: 'Los códigos OTP que se enviaron para validar el celular y si se validaron.',
    why: 'Sirve para saber si el cliente recibió y usó el código.',
    source: 'columnas',
  },
  user_terms_acepteds: {
    title: 'Los términos que aceptó',
    what: 'Qué términos y autorizaciones aceptó el cliente y cuándo.',
    why: 'Es la constancia de la aceptación.',
    source: 'columnas',
  },
  lender_transactions: {
    title: 'Lo que pasó con la entidad',
    what: 'Las operaciones con la entidad financiera elegida: la consulta, su respuesta y el estado en que la dejó.',
    why: 'Es donde se ve qué contestó la entidad (aprobada, negada, en revisión).',
    source: 'columnas',
  },
}
