## Para qué

Que al crear un comercio en el admin queden listos, sin pasos manuales, su sucursal de prueba, un asesor de prueba y su cuenta en Cognito, para poder entrar al wizard como asesor sin crear el usuario a mano. En dev y qa ya funciona. Falta habilitarlo en producción, usando el pool Merchants que ya existe: no se cambia el login del wizard ni se crea un cliente nuevo.

## Qué se pide a infra

**1. Permisos de IAM.** El rol `inertia-production-legacy-application-task-role` (servicio `legacy-application`, clúster `inertia-production`) hoy no tiene ningún permiso de Cognito. Se necesitan, sobre el pool `arn:aws:cognito-idp:us-east-1:299276669008:userpool/us-east-1_XnF2zz3Ou`, solo estas cuatro acciones:
- `cognito-idp:AdminCreateUser`
- `cognito-idp:AdminSetUserPassword`
- `cognito-idp:AdminGetUser`
- `cognito-idp:AdminDeleteUser`

Solo para el servicio web (los workers no crean comercios). El pool está en us-east-1 y el servicio en us-east-2: el ARN lleva la región del pool. Es un permiso aditivo; no toca el login de los asesores de hoy.

**2. Tres claves en el secret `prod/legacy-application`.** La definición de la tarea de producción no las referencia hoy:
- `MERCHANT_AWS_COGNITO_REGION` = `us-east-1`
- `ALLIED_TEST_ADVISOR_PASSWORD` = clave propia de producción, distinta de la de dev; Miguel la pasa por un canal privado. Debe cumplir la política del pool.
- `MERCHANT_AWS_COGNITO_USER_POOL_ID` = `us-east-1_XnF2zz3Ou`. Es el interruptor: sin esta variable la app no llama a Cognito y el alta de comercios sigue como hoy. Se agrega el día de la prueba, coordinado con Miguel.

No modificar las claves `COGNITO_MERCHANT_*` que ya existen en ese secret.

Si el despliegue reconstruye la tarea desde el secret, llegan en el siguiente despliegue; si no, hay que agregarlas también a la definición de la tarea.

**3. Dos preguntas sobre lo ya hecho.**
- Los secrets de los wizards de dev y qa (`dev/loan-request-wizard` y `dev/loan-request-wizard-qa`) llevan la etiqueta `ProvidedBy: terraform` y se editaron a mano (solo `COGNITO_DOMAIN`, `COGNITO_CLIENT_ID` y `COGNITO_CLIENT_SECRET`, ahora apuntan al pool Merchants Dev `us-east-2_Mh2hIqeQ5`). ¿Un `terraform apply` los va a devolver al valor anterior? Si sí, ¿cómo se dejan fijos?
- ¿Hay problema en hacer lo mismo en staging (`dev/loan-request-wizard-stg`)?

## Lo que no hace falta

- Nada del lambda de pre-registro en producción: el pool Merchants de producción no tiene trigger de pre-registro y solo permite crear usuarios al administrador.
- Ningún cliente, dominio ni cambio en el pool o en el wizard de producción.

## Cómo se apaga

Vaciar `MERCHANT_AWS_COGNITO_USER_POOL_ID` y reiniciar los servicios. Las cuentas ya creadas se limpian aparte, una por una.

## Cómo se valida

- El admin de producción crea un comercio de prueba dedicado y aparece la cuenta del asesor en el pool.
- El asesor entra al wizard de producción y llega a su sucursal.
- Los asesores de siempre siguen entrando sin cambios.
- Se borra el comercio de prueba al terminar.
