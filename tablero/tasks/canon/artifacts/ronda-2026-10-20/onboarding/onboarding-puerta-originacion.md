**Un comercio o una sucursal deshabilitados no originan solicitudes nuevas en el monolito nuevo, pero las que ya estaban en curso terminan.** Puede originar sólo el punto de venta cuya sucursal y cuyo comercio tienen estado 1; cualquier otro valor cuenta como deshabilitado, y se mira primero la sucursal. Sin sucursal se valida sólo el comercio, y sin ninguno de los dos se deja pasar. Una sucursal o un comercio inexistentes, o un error al resolverlos, no cuentan como habilitados: la consulta lanza y el punto de entrada responde 500.

La regla no está dentro de la creación compartida de solicitudes: cada punto de entrada la pide explícitamente, justo antes de crear. Hoy la piden cuatro, todos con 403 y el subcódigo `ALLIED_DISABLED`, que es lo estable para el frente:

- **Validar el código del celular** (`ONB041`), después del desvío del codeudor —que se suma a una solicitud en curso— y antes de crear o reutilizar la solicitud. El código ya quedó consumido. La entrada de la tienda con pedido firmado pasa por el mismo punto.
- **La validación del código del módulo nuevo** (`OBV22012`), donde el subcódigo viaja en `data.errorSubcode`.
- **El canje del código de la app** (`CCO008`), antes de consultar el código, para no gastarlo.
- **Elegir entidad**, sólo cuando la elección crea otra solicitud a partir de la vigente (`ONB041`); si sólo actualiza la vigente, no se bloquea.

⚠ **Quedan caminos que crean solicitudes sin preguntar**: un endpoint de actualización liviana de la selección, que puede crear otra solicitud y hoy no llama ninguna pantalla; el procesamiento de datos personales de identidad; el alta por puerta trasera, el estudio exprés, los formularios dinámicos, el onboarding móvil y Corbeta. El monolito viejo no tiene la regla: crea sin mirar el estado, salvo cuando delega la validación del código en el monolito nuevo para los comercios del bypass; ahí el 403 lo hace caer a su validación local, que encuentra el código ya consumido.

El asistente muestra un mensaje propio de comercio deshabilitado en la validación del código, el canje y la elección de entidad, y relee el perfil del asesor para pintar el bloqueo. Las pantallas propias de Bancolombia no lo distinguen y muestran su error genérico.
