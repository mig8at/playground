**En la app, cómo compra el cliente en un comercio lo deciden las sedes del comercio, no su tipo de tienda.** La app lee las sedes de merchant-api y deriva los canales del tipo de punto de venta de cada una:

- **Venta asistida**: sedes de venta asistida o de ambos tipos que tengan teléfono o WhatsApp válido. El cliente contacta a un vendedor.
- **Tienda física**: sedes físicas o de ambos tipos, ordenadas por cercanía. También es el canal que queda cuando no hay contactos válidos.
- **Sin tipo declarado**: si ninguna sede declara tipo, las que tienen dirección o ubicación cuentan como tiendas. Si alguna sede declara tipo, las que no lo declaran se ignoran.
- **Sedes que no cargaron**: queda sólo el canal físico, sin tiendas ni contactos: el cliente recibe el código y nada más.

Siempre hay al menos un canal. Con más de uno, el cliente elige; con uno, la app sigue directo. El tipo de tienda que declara el comercio ya no decide el flujo: la app sólo lo conserva para la analítica.

Elegido el canal, la app pide el código de compra al servicio que lo emite, con comercio, entidad y canal (asistido o físico). Cómo se emite, cuánto dura y dónde vale está en [[onboarding/context#el-codigo-de-la-app-lo-emite-un-servicio-aparte-y-solo-vale-en-su-comercio]]; cómo nace la solicitud al canjearlo, en [[onboarding/context#con-el-codigo-de-la-app-la-solicitud-nace-sin-validar-el-celular-y-ya-con-su-entidad]].

Por eso, ante «al cliente no le aparece la opción de hablar con un vendedor», lo que hay que revisar es el tipo de punto de venta y los contactos de las sedes de ese comercio, no la configuración del comercio.
