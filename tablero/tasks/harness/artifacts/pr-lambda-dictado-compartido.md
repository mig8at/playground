## Qué pasa hoy

Lo dictado por el admin API (`POST /mockoon-admin/global-vars`) o por `GET /dictar` es una variable global de Mockoon, y vive en la memoria del contenedor del Lambda que recibió el pedido. Cuando hay más de un contenedor caliente, la consulta del backend puede caer en otro, que no tiene el dictado y contesta la respuesta por defecto.

Medido en qa el 2026-10-21, con la cédula `1026013773` dictada:

- diez lecturas seguidas de Ágil Data devolvieron lo dictado;
- doce lecturas a la vez devolvieron lo dictado en 2, la respuesta por defecto (`JUAN CARLOS PEREZ GOMEZ`) en 9 y un error en 1;
- en la solicitud 503897 el dictado se confirmó 21 s antes de que `kyc-gateway` consultara Ágil Data, y lo que se guardó fue la respuesta por defecto. El pipeline de KYC rechazó la identidad.

## Qué cambia

- `shared-dictation.js` envuelve el request listener de Mockoon. Cada dictado se guarda también en una tabla de DynamoDB (`DICTATION_TABLE`) antes de pasárselo a Mockoon.
- Antes de contestar cualquier pedido, el contenedor lee un ítem de versión de la tabla. Si cambió, trae los dictados y se los carga a su propio Mockoon por el admin API.
- `state/purge` y `global-vars/purge` también vacían la tabla, y así limpian en todos los contenedores.
- Lo que nadie limpió vence a las 24 h (`expiresAt`, TTL de DynamoDB; configurable con `DICTATION_TTL_SECONDS`).
- Si la tabla no responde, el dictado devuelve `502` («no quedó compartido») en vez de «has been set», y el resto de las rutas sigue contestando.
- `template.yaml`: la tabla `risk-services-mock-dictations-${Environment}` (`PAY_PER_REQUEST`, TTL), la variable `DICTATION_TABLE` y `DynamoDBCrudPolicy` sobre esa tabla.
- `npm test` (`node --test`) y `npm run local` (el mock como servidor HTTP, con el mismo envoltorio).
- README: las notas que decían que el dictado vive en un contenedor.

## Compatibilidad

- **Sin cambio para quien consulta:** las mismas rutas, las mismas reglas por cédula de `riskservices.json` y las mismas respuestas por defecto. Una cédula sin dictado contesta exactamente lo de hoy.
- **Sin cambio para quien dicta:** el mismo endpoint, el mismo token (`Bearer mock-admin`), el mismo cuerpo y la misma respuesta.
- **Sin `DICTATION_TABLE`** (`sam local`, o un entorno sin la tabla), el envoltorio no hace nada y todo funciona como antes.

Lo que sí cambia de comportamiento:

- Un dictado se ve en todos los contenedores. Es el objetivo.
- Un dictado olvidado ya no desaparece cuando se recicla un contenedor: dura hasta que alguien purgue o hasta 24 h. Afecta sólo a esa cédula, como hoy.
- Purgar limpia en todos los contenedores, no sólo en el que recibió el pedido.
- Cada pedido suma una lectura a DynamoDB (≈7 ms de mediana en local).

## Cómo se probó

En local:

- `npm test`: dos instancias de Mockoon sobre una tabla en memoria. Pasa. Sin el envoltorio, la misma prueba falla con `JUAN CARLOS PEREZ GOMEZ`.
- Tres procesos sobre el DynamoDB de LocalStack, dictando sólo en uno, con doce lecturas a la vez repartidas entre los tres: 12 de 12 con lo dictado.
- Un proceso que arranca después del dictado lo contesta.
- `/dictar` en uno se ve en otro, y purgar en uno limpia en todos.
- El `handler` con un evento de API Gateway comparte igual.
- Sin DynamoDB, las consultas contestan y el dictado da `502`.

Sin probar: el despliegue. No validé el template con `sam`, y el rol del CI necesita poder crear la tabla y la política. Si no puede, CloudFormation revierte el stack y el Lambda queda como está.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
