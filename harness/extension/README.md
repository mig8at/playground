# Cliente de prueba · extensión de Chrome

Un panel lateral junto al wizard (qa, dev, staging o local) para probar **a mano** con un cliente listo. Habla con el
panel del harness (`localhost:5195`, rutas `/api/ext/*` en `panel/server.ts`), que es quien le dicta al lambda de cada
ambiente y da de baja por el conector. La extensión no guarda credenciales. `make harness-extension` dice cómo cargarla.

- **Quién**: cédula, nombre, celular, correo y monto. ↻ arma una persona sin cliente activo en esa base. Al escribir la
  cédula en el wizard, el panel la toma y dice si ya existe.
- **Cómo responden las centrales**: perfiles (Aprueba, Sin empleo, Score bajo, Experian sin info) y los valores, como la
  vista Burós del panel.
- **Dejar listo**: da de baja al cliente activo de la cédula —sólo si su correo es de prueba (`qa…@gmail.com`,
  `qa.harness…`, `synth-…`, `ext.prueba+…`)— y dicta las centrales. **Rellenar**: escribe lo de arriba en la pantalla.
- **Antes de cada envío de datos personales** («Siguiente», «Continuar») la página espera un instante a que el panel
  vuelva a dictar: el lambda olvida lo dictado en minutos (F-139).
- **OTP**: en local, los últimos 4 del celular; fuera, el último que generó el servicio de OTP (el de #qa-messages).
- **La solicitud**: la de la URL de la pestaña, con su dictamen (`pg request verdict`).
- **Validación de identidad**: en `…/<solicitud>/identity-validation` (la selfie de ADO, que no se puede hacer desde un
  Chrome de escritorio) aparece **Aprobar identidad**: la aprueba a mano como el admin (`dbops identity-approve`, lo
  mismo que el panel con sus celulares) y vuelve a `…/confirmation`. Sólo si la solicitud es del celular de arriba y su
  cliente tiene correo de prueba; nunca prod. Es un rodeo: no prueba que la validación real funcione.
- **Sigue el cliente**: cuando el asesor termina (`/merchant/<sucursal>/<solicitud>/continue`, «Solicitud en validación
  de usuario»), el panel arma el link del cliente —el del WhatsApp, que en las pruebas no llega—
  `/self-service/<sucursal>/<solicitud>/confirmation`, y lo abre en una pestaña nueva o lo copia.

⚠ Sólo qa y local aceptan dictado (F-149): en dev y staging el panel lo avisa y las centrales contestan lo de por
defecto. Nunca prod. `sidepanel.html#tab=<id>` ata el panel a una pestaña (para abrirlo como página o probarlo).
⚠ La fecha de expedición (día, mes y año, desplegables de Radix) todavía se elige a mano: «Rellenar» no la toca.

Probado el 2026-11-20 en un Chromium con la extensión cargada contra qa: persona nueva, dictado, monto y celular
rellenados, el OTP leído del servicio, datos personales rellenados y el envío frenado para volver a dictar (505190).
La baja desde la extensión no se pudo comprobar entera: la llamada al conector falló sin decir por qué (ya lo dice).
