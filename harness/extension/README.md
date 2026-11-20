# Cliente de prueba · extensión de Chrome

Un panel lateral junto al wizard (qa, dev, staging o local) para probar **a mano** con un cliente listo. Habla con el
panel del harness (`localhost:5195`, rutas `/api/ext/*` en `panel/server.ts`), que es quien le dicta al lambda de cada
ambiente. La extensión no guarda credenciales. `make harness-extension` dice cómo cargarla.

- **Quién**: cédula, nombre, celular, correo y monto. ↻ arma una persona sin cliente activo en esa base. Al escribir la
  cédula en el wizard, el panel la toma y dice si ya existe.
- **Cómo responden las centrales**: perfiles (Aprueba, Sin empleo, Score bajo, Experian sin info) y los valores, como la
  vista Burós del panel.
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
- **La solicitud**: el recorrido como línea de tiempo —bolitas que se llenan con las pantallas por las que pasa la
  pestaña, con su hora—, la solicitud de la URL con su estado y entidad, y el dictamen (`pg request verdict`) plegado.
  Los pasos fijos (monto, celular, código, datos personales, empleo, entidades, confirmación, identidad, fecha de pago,
  firma) salen siempre; los opcionales (validando datos, Ábaco, formulario adicional, traspaso, cuota inicial,
  documentos) sólo si se pasó por ahí. Lo anterior a la pantalla actual se da por hecho aunque el panel no lo haya visto
  (sin hora). El último punto, «Autorizada (11)», lo dice la base; una cancelación o un rechazo lo pinta en rojo.
- **Consola · la base de la solicitud** (al final, plegada): una pestaña por tabla que toca la solicitud (`user_requests`,
  `users`, sus registros, las centrales, summaries, field values, CreditopX, la transacción con la entidad, `logs`), con
  sus filas —las de esa solicitud y su cliente, no por ventana de tiempo: la base de qa es compartida— en una tabla
  horizontal: primero las columnas que importan, después las demás (afuera las vacías en todas las filas). Un objeto
  JSON (`{…} 9 claves`) o un texto largo se toca y se abre entero y formateado debajo, con «Copiar». Lo que cambió desde
  la lectura anterior queda resaltado 20 s (● en la pestaña). Sólo lectura (`dbops request-tables`), cada 5 s y sólo con
  la consola abierta. No ve lo que se borra; cada celda va completa hasta 40 KB y las credenciales no se leen.
- **El botón del paso**, debajo de «Nueva solicitud» y «Rellenar», a todo el ancho: aparece en las pantallas que en las
  pruebas no se pueden resolver como la persona y desaparece al pasarlas.
  - `…/continue` («Solicitud en validación de usuario», el asesor terminó): **Continuar aquí** lleva la pestaña a
    `/self-service/<sucursal>/<solicitud>/confirmation`, el link que le llegaría al cliente por WhatsApp. En la página
    misma aparece el mismo botón, flotante abajo.
  - `…/identity-validation` (la selfie de ADO, que no se puede hacer desde un Chrome de escritorio): **Aprobar
    identidad** la aprueba a mano como el admin (`dbops identity-approve`, lo mismo que el panel con sus celulares) y
    vuelve a `…/confirmation`. Sólo si la solicitud es del celular de arriba y su cliente tiene correo de prueba; nunca
    prod. Es un rodeo: no prueba que la validación real funcione.

⚠ Sólo qa y local aceptan dictado (F-149): en dev y staging el panel lo avisa y las centrales contestan lo de por
defecto. Nunca prod. `sidepanel.html#tab=<id>` ata el panel a una pestaña (para abrirlo como página o probarlo).

Probado el 2026-11-20 en un Chromium con la extensión cargada contra qa: persona nueva, dictado, monto y celular
rellenados, el OTP leído del servicio, datos personales rellenados y el envío frenado para volver a dictar (505190).
