# Probeta · extensión de Chrome

El laboratorio de las pruebas a mano: mezclás persona, centrales y monto, y mirás qué sale.

Un panel lateral junto al wizard (qa, dev, staging o local) para probar **a mano** con un cliente listo. Habla con el
panel del harness (`localhost:5195`, rutas `/api/ext/*` en `panel/server.ts`), que es quien le dicta al lambda de cada
ambiente. La extensión no guarda credenciales. `make harness-extension` dice cómo cargarla.

- **Persona**: cédula, nombre, celular, correo y monto. ↻ arma una persona sin cliente activo en esa base. Al escribir la
  cédula en el wizard, el panel la toma y dice si ya existe.
- **Centrales**: perfiles (Aprueba, Sin empleo, Score bajo, Experian sin info); los valores, plegados en «Ajustar
  valores», como la vista Burós del panel.
- **Nueva solicitud**: persona nueva (cédula, celular y correo sin cliente activo), centrales dictadas y la pestaña al
  inicio del flujo en el que está (`/<flujo>/<sucursal>/solicitar?amount=<monto>`, autogestión o asesor). **No da de baja
  ni borra a nadie**: el cliente y la solicitud anteriores quedan en la base (decisión de Miguel, 2026-11-20; si un día
  hace falta, un script de limpieza aparte). **Rellenar**: escribe lo de arriba en la pantalla, y en la del OTP (el
  del ingreso, 4 dígitos, o el de la firma del pagaré, 6) el que lee en ese momento, sólo si su largo es el del campo.
  En la pantalla de la fecha de expedición elige el día, el mes y el año del campo **Expedición** (por defecto
  2010-08-20, la del harness): abre cada combo de Radix en orden, como lo haría la persona, y si ya muestra la fecha no
  lo toca.
- **Con una solicitud en curso** (la pestaña pasó de `…/solicitar`), los datos de la persona quedan bloqueados: son los de
  esa solicitud. El perfil de las centrales sigue editable.
- **Antes de cada envío de datos personales** («Siguiente», «Continuar») la página espera un instante a que el panel
  vuelva a dictar: el lambda olvida lo dictado en minutos (F-139).
- **OTP**: en local, los últimos 4 del celular; fuera, el último que generó el servicio de OTP (el de #qa-messages).
- **Recorrido** (pestaña): la línea de tiempo —bolitas que se llenan con las pantallas por las que pasa la pestaña, con su hora—
  y, al lado del título, la solicitud y la entidad. Los pasos fijos (monto, celular, código, datos personales, empleo,
  entidades, confirmación, identidad, fecha de pago, firma) salen siempre; los opcionales sólo si se pasó por ahí. El
  último punto, «Autorizada (11)», lo dice la base; una cancelación o un rechazo lo pinta en rojo.
- **La base de la solicitud** (pestaña **Base**): una pestaña por tabla que toca la solicitud (`user_requests`,
  `users`, sus registros, las centrales, summaries, field values, CreditopX, la transacción con la entidad, `logs`), con
  sus filas —las de esa solicitud y su cliente, no por ventana de tiempo: la base de qa es compartida— en una tabla
  horizontal, sólo con las columnas que aportan (afuera lo repetido, lo cifrado y lo interno; «todas las columnas» las
  muestra). Un objeto
  JSON (`{…} 9 claves`) o un texto largo se toca y se abre entero y formateado debajo, con «Copiar». La respuesta de cada central (`data`, cifrada con el APP_KEY del backend) dice «🔒 cifrado»: al tocarla se
  descifra y se abre formateada (sólo clientes de prueba, nunca prod). Los números de catálogo (estado, entidad, central, campo, estado de CreditopX, sucursal…)
  van subrayados: al pasar el mouse, la celda cambia el número por su nombre (`11` → «Autorizada»). Lo que cambió desde
  la lectura anterior queda resaltado 20 s (● en la pestaña). Sólo lectura (`dbops request-tables`), cada 5 s y sólo con
  una solicitud en la pestaña. No ve lo que se borra; cada celda va completa hasta 40 KB y las credenciales no se leen.
- **El botón del paso**, debajo de «Nueva solicitud» y «Rellenar», a todo el ancho: aparece en las pantallas que en las
  pruebas no se pueden resolver como la persona y desaparece al pasarlas.
  - `…/continue` («Solicitud en validación de usuario», el asesor terminó): **Continuar aquí** lleva la pestaña a
    `/self-service/<sucursal>/<solicitud>/confirmation`, el link que le llegaría al cliente por WhatsApp. En la página
    misma aparece el mismo botón, flotante abajo.
  - `…/identity-validation` (la selfie de ADO, que no se puede hacer desde un Chrome de escritorio): **Aprobar
    identidad** la aprueba a mano como el admin (`dbops identity-approve`, lo mismo que el panel con sus celulares) y
    vuelve a `…/confirmation`. Sólo si la solicitud es del celular de arriba y su cliente tiene correo de prueba; nunca
    prod. Es un rodeo: no prueba que la validación real funcione.

- **La solicitud, abajo, en cuatro pestañas** (2026-11-26): **Recorrido**, **Base**, **Documentos** y **Voucher**; la elegida se
  recuerda en la máquina. **Documentos** muestra una miniatura de la primera página de cada documento firmado
  (`user_request_signing_documents`: vinculación, T&C, pagaré…), con la hora de la firma; al tocarla, el PDF se abre en
  una pestaña aparte. «Descargar» lo baja como `<solicitud>_<documento>.pdf` y «descargar todos» los baja juntos. El
  panel sirve los PDF y arma las miniaturas (`/api/ext/documents` y `/api/ext/document`, `thumb=1` con `pdftoppm`,
  guardadas en memoria): la primera vez tardan unos segundos. Sólo desde el bucket de S3 o el S3 local, y fuera de local
  sólo de un cliente de prueba. Se vuelve a leer cada 15 s. Probado con la 505329 de qa: las tres miniaturas, la hora
  bien y el T&C abierto aparte.
- **Voucher** (2026-11-26): la tirilla «¡Transacción exitosa!» que el backend arma al quedar Autorizada (11) y le manda
  al cliente, la que mira el comercio para entregar. Se ve entera; al tocarla o con «Abrir» se abre en otra pestaña, y
  «Descargar» la baja como `<solicitud>_voucher.pdf`. No queda en la base: el panel (`/api/ext/voucher`, `info=1` dice
  si está) la busca en el bucket por su llave fija, `admin/allieds/vouchers/<cédula>-<request_number>.pdf`, con la raíz
  del bucket de un documento firmado (en local sin firmados, el `AWS_URL` del backend). Si la solicitud está en 11 y no
  está, lo dice: es un «Voucher generation failed» del backend. Probado con la 505329 de qa (145 KB, la miniatura bien).
- **Esqueletos y lo recordado** (2026-11-26): lo último que se leyó de cada solicitud (tablas, documentos, voucher)
  queda en memoria y en `chrome.storage.session` (las últimas 12), así que al volver a una pestaña se pinta al instante
  y se refresca detrás, aunque el panel se haya cerrado. Lo que nunca se leyó muestra un esqueleto del tamaño final
  (la consola con sus pestañas y filas, tres tarjetas de documento, el hueco del voucher) y la consola guarda su alto
  con datos, para que nada salte al llegar. Visto con un Chromium sin ventana y la API con 4 s de demora: a 0,4 s de
  volver ya estaban las tablas y el voucher.

⚠ Sólo qa y local aceptan dictado (F-149): en dev y staging el panel lo avisa y las centrales contestan lo de por
defecto. Nunca prod. `sidepanel.html#tab=<id>` ata el panel a una pestaña (para abrirlo como página o probarlo).

Probado el 2026-11-20 en un Chromium con la extensión cargada contra qa: persona nueva, dictado, monto y celular
rellenados, el OTP leído del servicio, datos personales rellenados y el envío frenado para volver a dictar (505190).
