El arranque consulta la sesión actual y decide entre autenticación, onboarding y la app. El onboarding visual se recuerda localmente; una sesión válida no implica que la persona ya haya visto esas pantallas.

**La entrada empieza por Cognito y sólo cae al monolito si la persona no existe.** La app pide primero el inicio de sesión de Cognito con autenticación personalizada: si el usuario existe, Cognito manda el código de un solo uso. Si Cognito responde que no existe, la app delega en el flujo mobile de `legacy-backend`, que envía y valida su propio código. La app recuerda qué proveedor mandó el código a cada celular y lo valida contra ese mismo; un código de Cognito no se puede validar en el monolito ni al revés.

Al validar en el monolito, **`MOBA2009` (409) no es un error**: significa que el código fue correcto y la persona tiene que registrarse. El registro pide documento (cédula o cédula de extranjería), nombres, apellidos, correo, fecha de expedición, ingreso, situación laboral y estrato, y el monolito:

- rechaza documento o correo ya asociados a otro usuario;
- valida nombres, apellidos y fecha de expedición contra el documento;
- crea una solicitud contra el **comercio por defecto de la app**, que sale de la configuración móvil (`mobile_onboarding_settings`, en sus reglas de crédito por defecto);
- consulta Experian sólo si esa misma configuración lo tiene prendido.

Esa configuración también trae un usuario de prueba con teléfono y código fijos. Si falta la fila o la clave, el registro falla con un código `MOBA3002`. Los códigos `MOBA*` se traducen a errores de interfaz en el cliente, así que una falla de este tramo se investiga como contrato de `legacy-backend` o de Cognito según qué proveedor mandó el código, no como un fallo genérico de Flutter.

La capa de red agrega el token de acceso a las rutas protegidas e intenta renovarlo ante una respuesta de autorización fallida. Si no logra renovarlo, la app marca la sesión como vencida, da de baja el dispositivo de notificaciones y devuelve a iniciar sesión. En el ambiente `mock` no se usa backend real ni Cognito.
