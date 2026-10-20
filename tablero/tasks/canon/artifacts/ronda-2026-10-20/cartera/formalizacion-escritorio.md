**El cierre exige continuar desde un navegador móvil.** La guarda cubre todo el tramo de la solicitud: la continuación del flujo, la validación de identidad, la aprobación y aceptación, el pago de la cuota inicial, la elección de fecha y plan de pagos, la vista previa, el envío y verificación del código y la autorización. Desde escritorio responde 403 con `continue-link-sent` y la dirección de un QR, y envía al cliente un enlace para continuar, como máximo una vez al día. Ese rechazo no indica por sí mismo un problema de permisos.

El QR es una imagen que el backend dibuja al pedirla. El frente le agrega la pantalla en la que está el cliente y el QR lleva a esa misma pantalla en el celular; si no la dice, lleva a la confirmación. El backend recibe sólo la pantalla y arma él la dirección, así que el QR siempre apunta al frente de Creditop. Esa imagen queda fuera de la guarda, porque la pide el mismo escritorio que acaba de ser frenado.

Quedan fuera de la guarda la continuación del codeudor, las rutas del equipo (registro, desembolso y consultas de estado), el estado del pago de la cuota inicial, el listado de documentos, la información de pago y el cambio de fecha de pago o de número de cuotas. La excepción del codeudor evita enviar a su sesión un enlace preparado para el titular.

La guarda también puede enviar el mensaje durante una prueba desde escritorio.
