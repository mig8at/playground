**La app sólo exige verificar la identidad para lo premium de Salud Financiera.** La verificación (selfie y documento por ambas caras con ADO, a través del servicio de identidad) aparece como compuerta antes del diagnóstico completo; la versión gratuita no pasa por esa compuerta. Un documento que el proveedor no sabe leer tampoco pasa la compuerta, aunque el servicio no marque que haga falta verificar.

El servicio de identidad decide con una sola regla el estado de la cuenta y si deja empezar un intento:

- un intento **aprobado para el documento actual** verifica a la persona sin ventana de tiempo; si el documento de la ficha cambia, la aprobación o el rechazo anteriores dejan de aplicar;
- tras un **rechazo definitivo** del mismo documento, la cuenta queda «requiere verificación» con motivo `identity_rejected` y **no se puede empezar otro intento**: el siguiente inicio se rechaza y la persona necesita soporte;
- soporte puede registrar una aprobación, que pasa por la misma regla.

⚠ **«Registrada previamente» se lee al revés en cada lado.** Cuando ADO responde que el documento y el rostro ya están enrolados en otra transacción, el servicio de identidad cierra el intento como **rechazo definitivo no reintentable** (`previously_registered`, código `IDS3018`). La app, en cambio, trata ese rechazo como una aprobación y abre el diagnóstico completo, pero esa aprobación vive sólo en memoria durante la sesión. Al iniciar la sesión siguiente la app vuelve a preguntar el estado de la cuenta, el servicio responde «requiere verificación» con `identity_rejected`, y la app muestra el rechazo sin ofrecer reintento.

Así, una persona premium ya enrolada en ADO entra la primera vez y queda bloqueada en la siguiente, sin haber hecho nada distinto. Sólo la destraba una aprobación de soporte en el servicio de identidad. Ante «antes podía ver Salud Financiera y ahora me pide ir a soporte», lo primero es mirar si su último intento terminó en `previously_registered`.
