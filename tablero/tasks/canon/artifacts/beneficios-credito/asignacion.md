**Los «meses sin interés» de un crédito CreditopX son el subsidio de intereses de Creditop**: Creditop le paga a la entidad el interés corriente de unas cuotas del cliente. Hoy es el único beneficio de este tipo (código `INTEREST_SUBSIDY`). Por defecto cubre **3 cuotas desde la primera**.

**El programa se fija al crear el crédito**, en los dos monolitos, que aplican la misma regla. La fila de creación del histórico guarda qué programa le tocó (`benefit_program_id`), y cada fila nueva lo hereda. Cambiar o apagar un programa después no toca los créditos vivos: siguen con la versión con la que nacieron. Por eso los programas no se editan. Cada cambio cierra la vigencia actual y abre otra fila. Lo único que cambia el programa de un crédito vivo es la configuración manual (abajo).

**Qué programa le toca, en este orden:**

1. **El del comercio**, si hay uno vigente. Se prende por comercio y entidad desde el admin. Si hay uno para la entidad y otro para todo el comercio, gana el de la entidad. No depende del interruptor global ni exige origen app.
2. Si no hay programa del comercio que le sirva, **el global**, pero sólo con el interruptor `creditop_interest_subsidy` de `settings` en `{"enabled": true}`. Sin esa fila, o si no se puede leer, queda apagado: el subsidio lo paga Creditop. El programa global que siembra el seeder **sólo aplica a créditos de la app**.

Se mira sólo el primer programa del comercio que corresponde. Si exige origen app y el crédito no lo tiene, se pasa al global. Si el del comercio sirve pero no le deja cuotas que cubrir, el crédito queda sin subsidio y no se prueba el global.

**«De la app» quiere decir que la solicitud nació de canjear el código de cliente.** El canje deja un registro en `user_request_records` con el comentario «Solicitud creada desde validacion de codigo cliente.», y ese registro marca el origen app del crédito (`is_app`). Es el código que el cliente genera en la app y que el asesor escribe en el comercio.

**Quedan sin subsidio aunque haya programa:**
- las utilizaciones de un cupo rotativo;
- los créditos de una entidad que gestiona su cartera afuera (`externally_serviced`);
- un plazo más corto que la cuota desde la que arranca el subsidio: no le queda ninguna cuota que cubrir.

**El subsidio de la app desplaza la condonación de la entidad.** Un crédito de la app que nace con programa no lleva las cuotas con interés condonado que la entidad tenga configuradas: las cubre el subsidio. Un crédito por el flujo normal, o sin programa, conserva la condonación de la entidad.

**Un crédito puntual también se puede configurar a mano**, si ya está activo y no es de cupo rotativo. Se hace desde el detalle de la solicitud originada en el admin, con el permiso `manage creditop interest subsidy`, que la migración le da al rol Administrador. Se eligen las cuotas, desde cuál y la tolerancia de mora. Queda una fila `CONFIGURACIÓN SUBSIDIO CREDITOP` en el histórico, con su log. Lo que ya se decidió o pagó no se deshace, ni siquiera al apagarlo.

**El pagador siempre es Creditop.** La tabla admite que pague el comercio, pero ningún camino crea hoy un programa así, tampoco el del comercio.
