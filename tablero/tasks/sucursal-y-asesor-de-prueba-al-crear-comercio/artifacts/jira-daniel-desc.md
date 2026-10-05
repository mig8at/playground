> **Corrección del 2026-10-05.** La primera versión de esta tarea apuntaba al pool equivocado (el de us-east-1, que solo usan los wizards de dev, qa y staging). El pool de producción es el de **us-east-2**. Todo lo de abajo ya usa el correcto.

## Para qué

Que al crear un comercio en el admin queden listos, sin pasos manuales, su sucursal de prueba, un asesor de prueba y su cuenta en Cognito, para poder entrar al wizard como asesor sin crear el usuario a mano. En dev y qa ya funciona. Falta habilitarlo en producción, usando el pool Merchants que ya usa el wizard de producción: no se cambia su login ni se crea un cliente nuevo.

## Qué se pide a infra

**1. Permisos de IAM.** El rol `inertia-production-legacy-application-task-role` (servicio `legacy-application`, clúster `inertia-production`) hoy no tiene ningún permiso de Cognito. Se necesitan, sobre el pool `arn:aws:cognito-idp:us-east-2:299276669008:userpool/us-east-2_3n9lxmKCe` (Merchants, dominio `login.creditop.com`), solo estas cuatro acciones:
- `cognito-idp:AdminCreateUser`
- `cognito-idp:AdminSetUserPassword`
- `cognito-idp:AdminGetUser`
- `cognito-idp:AdminDeleteUser`

Solo para el servicio web (los workers no crean comercios). El pool y el servicio están en la misma región. Es un permiso aditivo; no toca el login de los asesores de hoy.

**2. Tres claves en el secret `prod/legacy-application`.** La definición de la tarea de producción no las referencia hoy:
- `MERCHANT_AWS_COGNITO_REGION` = `us-east-2`
- `ALLIED_TEST_ADVISOR_PASSWORD` = clave propia de producción, distinta de la de dev; Miguel la pasa por un canal privado. Debe cumplir la política del pool (mínimo 8 caracteres, con minúscula y número).
- `MERCHANT_AWS_COGNITO_USER_POOL_ID` = `us-east-2_3n9lxmKCe`. Es el interruptor: sin esta variable la app no llama a Cognito y el alta de comercios sigue como hoy. Se agrega el día de la prueba, coordinado con Miguel.

No modificar las claves `COGNITO_MERCHANT_*` que ya existen en ese secret.

Si el despliegue reconstruye la tarea desde el secret, llegan en el siguiente despliegue; si no, hay que agregarlas también a la definición de la tarea.

**3. El lambda de pre-registro de producción.** Este pool tiene el trigger `cognito-pre-sign-up-production`, así que cada cuenta que crea el admin pasa por él. En dev el primer intento tras un rato sin uso tardaba unos 2,3 s y vencía con el límite de 3 s; con más margen (4 s a la consulta y 5 s a la función) quedó estable. Hace falta decidir cómo se resuelve en producción: desplegar esa versión del lambda antes de la prueba, o aceptar el riesgo y reintentar. Es decisión de infra, porque el lambda atiende el login real.

**4. Tres preguntas.**
- Este pool tiene mensajes personalizados y un remitente de correo propio. Las cuentas se crean sin enviar invitación (`MessageAction = SUPPRESS`). ¿Confirmas que esos triggers no mandan ningún correo en ese caso?
- Los secrets de los wizards de dev y qa (`dev/loan-request-wizard` y `dev/loan-request-wizard-qa`) llevan la etiqueta `ProvidedBy: terraform` y se editaron a mano (solo `COGNITO_DOMAIN`, `COGNITO_CLIENT_ID` y `COGNITO_CLIENT_SECRET`, ahora apuntan al pool Merchants Dev `us-east-2_Mh2hIqeQ5`). ¿Un `terraform apply` los va a devolver al valor anterior? Si sí, ¿cómo se dejan fijos?
- ¿Hay problema en hacer lo mismo en staging (`dev/loan-request-wizard-stg`)?

## Lo que no hace falta

- Ningún cliente, dominio ni cambio en el pool ni en el wizard de producción.
- El permiso del lambda para este pool ya existe: el trigger está activo.

## Cómo se apaga

Vaciar `MERCHANT_AWS_COGNITO_USER_POOL_ID` y reiniciar los servicios. Las cuentas ya creadas se limpian aparte, una por una.

## Cómo se valida

- El admin de producción crea un comercio de prueba dedicado y aparece la cuenta del asesor en el pool.
- El asesor entra al wizard de producción y llega a su sucursal.
- Los asesores de siempre siguen entrando sin cambios.
- Se borra el comercio de prueba al terminar.
