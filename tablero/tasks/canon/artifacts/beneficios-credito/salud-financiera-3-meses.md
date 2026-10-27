**Los «3 meses gratis» que anuncia la app no son meses sin interés: son tres meses del informe completo de Salud Financiera.** No cambian la cuota ni el interés del crédito. Los meses sin interés son otra cosa, el subsidio de intereses de Creditop: [[creditopx/context#el-subsidio-de-intereses-de-creditop-se-fija-al-crear-el-credito-y-no-es-lo-que-promete-el-banner-de-la-app]].

**La promesa sale del banner de beneficios de la app.** Cada comercio puede tener su propia foto y su propia nota, y sus puntos de venta las heredan. Si el comercio no tiene, se usa la configurada en `settings`. Si tampoco hay, la nota por defecto es «Tus 3 meses gratis se activan cuando tu crédito sea desembolsado.». La frase está escrita dos veces, en `legacy-backend` y en merchant-api: si cambia, hay que cambiarla en los dos.

**Los da el servicio de beneficios (Entitlement), con su regla `creditop_x`.** Concede el plan `creditop_x`, que da `financial_health.full`, durante tres meses. Es una sola vez por persona, por la primera compra CreditopX autorizada con el código de la app después de publicada la regla. Publicarla no concede hacia atrás: las compras anteriores no cuentan. Una anulación confirmada retira el beneficio.

Legacy no decide nada. Cada compra autorizada, cancelada o anulada deja un aviso ([[creditopx/context#cada-compra-autorizada-cancelada-o-anulada-deja-un-aviso-para-el-servicio-de-beneficios]]). El servicio vuelve a leer la compra en legacy antes de conceder o retirar.

**La regla nace apagada.** El servicio la crea desactivada hasta que se publique la versión de lanzamiento. Mientras siga así, la compra queda registrada pero no concede nada, aunque el banner lo prometa. Si está prendida o no se ve en la base del servicio de beneficios, no en la de legacy.
