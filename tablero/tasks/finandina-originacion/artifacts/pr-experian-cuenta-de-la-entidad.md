feat(CORE-845): Experian consulta con la cuenta que entrega una entidad de la sucursal, y la búsqueda de credenciales deja de mezclar centrales

## Qué cambia

**1. Experian consulta con la cuenta que entrega una entidad de la sucursal.**
El onboarding compra Experian en datos personales, antes de que el cliente elija entidad. Hasta hoy la cuenta salía de la entidad que se pasa a la consulta, del comercio o de la sucursal, y si no, de config. Una entidad que entrega su propia cuenta (Banco Finandina) nunca se usaba en el onboarding.

Ahora, en la consulta sin entidad pedida (la del onboarding), si ni el comercio ni la sucursal tienen cuenta para el producto, se usa la de la primera entidad **activa** de la sucursal (asociación activa) que tenga una, en orden fijo por id de entidad; config sigue siendo lo último. Es el mismo criterio que ya usa Mareigua (`Mareigua::getCredentials`). Una consulta para una entidad concreta que no tiene cuenta propia sigue saliendo con config: no se le factura a otra entidad.

- La cuenta es por producto: una cuenta de `Experian - Acierta` no se usa para Quanto ni para Acierta+Quanto.
- Se deja en el log la sucursal, las entidades con cuenta y la elegida.
- La respuesta guardada (`risk_central_user_data.request`) lleva `credential_id`; `null` es la de config.
- No cambia la reutilización del último mes: no mira con qué cuenta se consultó.

**2. La búsqueda de credenciales mezclaba centrales.**
`RiskCentralCredential::findForUserRequest` y `forBranchLenders` hacían `RiskCentral::find($riskCentral)` con un modelo. Eloquent lo lee como arreglo y devuelve **todas** las centrales cuyo id coincide con algún valor del modelo. Deceval (id 7, `enabled = 1`) traía también `Experian - Acierta` (id 1): en cuanto una entidad tiene las dos cuentas, el pagaré sale al azar con la de Experian y falla con `Undefined array key "deceval_depositante"`. Hoy no pasa en producción porque ninguna entidad tiene cuenta activa de Experian Acierta; pasaría al cargar la de Finandina. El arreglo vale para todo lo que pasa por esas dos funciones (Deceval, ADO, Experian y Mareigua): cada una recibe ahora sólo las credenciales de su central.

## Cómo se probó

- `tests/Feature/Risk/ExperianAccountByBranchTest.php` (12 casos): orden de elección, entidad o asociación inactiva, cuenta borrada, por producto, la del comercio y la de la entidad pedida ganan, una consulta para otra entidad sin cuenta sigue con config, el token sale con la cuenta elegida y se guarda `credential_id`, y que Deceval no devuelve la cuenta de Experian. Los dos últimos fallan sin el arreglo del modelo.
- Las pruebas de Mareigua por sucursal siguen verdes (10).
- En local, con la cuenta de Experian de Finandina cargada a la entidad 149 y Experian respondido por el mock: autogestión en una sucursal de Finandina hasta el estado 11. Experian se consultó con la cuenta de Finandina (`credential_id` de la entidad) y el pagaré salió con la credencial de Deceval correcta. Antes del arreglo, la misma corrida daba 500 al firmar.

## Para tener en cuenta al desplegar (en este orden)

1. Desplegar este cambio. Sin cuenta de Experian cargada a ninguna entidad, no cambia nada.
2. Cargar la cuenta de Finandina como credencial de la entidad 149 en `Experian - Acierta` (llaves `experian_client_id`, `experian_client_secret`, `experian_username`, `experian_password`, `experian_user`, `experian_shortcode`). **No antes del paso 1**: sin el arreglo de la búsqueda, el pagaré de Finandina puede salir con la cuenta de Experian.
3. Agregar la 149 a `experian_trigger_bypass_rules.lenders`. Una sucursal sólo con Finandina hoy no compra Experian; en qa, Mediarte lo compra porque tiene a Credifamilia (24) en esa lista.

Si el cliente no trae ingreso de Ágil Data ni Mareigua, la compra es Acierta+Quanto, y para ese producto Finandina no tiene cuenta cargada: sale con la de config.
