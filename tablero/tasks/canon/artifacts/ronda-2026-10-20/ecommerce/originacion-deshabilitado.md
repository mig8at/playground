**En el monolito nuevo, un comercio o una sucursal deshabilitados no originan una solicitud nueva, pero sólo en algunas puertas; en el monolito viejo no hay ninguna.** Darlo de baja ([[#dar-de-baja-un-comercio-apaga-siempre-a-todos-sus-asesores]]) apaga a sus asesores, pero hasta que existió esta regla ningún camino de creación miraba su estado y sus asesores seguían originando.

La regla exige la sucursal activa y su comercio activo; si no llega sucursal se mira sólo el comercio, y si no llega ninguno se deja pasar. Se llama explícitamente justo antes de crear, en cuatro puntos:

- la validación del código de un solo uso del recorrido nuevo, que es también la entrada con un pedido firmado por la tienda;
- el canje del código de preaprobado;
- la selección de entidad cuando crea otra solicitud a partir de la vigente;
- la validación del código de la segunda versión del onboarding.

Todas responden 403 con el mismo subcódigo de «comercio deshabilitado», que es lo que lee el asistente para mostrar el bloqueo y volver a pedir el perfil del asesor; la segunda versión lo manda en otro campo de la respuesta. Si la verificación no da veredicto —una sucursal que no existe o un error interno—, no se origina: falla.

Lo que **no** frena:

- **una solicitud en curso**: actualizar la vigente, elegir entidad sobre ella o recibir el aviso de un proveedor siguen aunque el comercio se haya deshabilitado. La validación del código, en cambio, frena antes de reusar una solicitud abierta;
- **los demás caminos que crean solicitudes**: el flujo exprés, los de soporte interno, el móvil, los formularios dinámicos y el checkout de Corbeta no pasan por la regla;
- **el monolito viejo**: su registro del celular, su validación del código, el simulador del asesor y el canje del código toman la sucursal sin mirar su estado ni el del comercio.
