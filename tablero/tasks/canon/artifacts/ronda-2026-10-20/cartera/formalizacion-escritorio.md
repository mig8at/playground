**El cierre exige continuar desde un navegador móvil.** La guarda cubre la vista previa, el envío y verificación del código y la autorización. Desde escritorio responde 403 con `continue-link-sent` y la dirección de un QR, y envía al cliente un enlace para continuar, como máximo una vez al día. Ese rechazo no indica por sí mismo un problema de permisos.

El QR es una imagen que el backend dibuja al pedirla. El frente le agrega la pantalla en la que está el cliente y el QR lleva a esa misma pantalla en el celular; si no la dice, lleva a la confirmación. El backend recibe sólo la pantalla y arma él la dirección, así que el QR siempre apunta al frente de Creditop. Esa imagen queda fuera de la guarda, porque la pide el mismo escritorio que acaba de ser frenado.

Quedan fuera de la guarda la continuación del codeudor, el registro y desembolso del equipo, el listado de documentos y la información de pago. La excepción del codeudor evita enviar a su sesión un enlace preparado para el titular.

La guarda también puede enviar el mensaje durante una prueba desde escritorio.
