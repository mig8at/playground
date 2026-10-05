# Mensaje para infra (Daniel) · asesores de prueba · 2026-10-05

> Texto listo para pegar en Slack. Los datos de prod salen de lecturas hechas el 2026-10-05 con el acceso de solo lectura
> (rol del servicio, política y triggers del pool, definición de la tarea). Las variables de prod que faltan salen de la definición
> de la tarea, no del valor del secret (con solo lectura no se ven).

**Daniel, te resumo lo que hicimos con el objetivo "asesores de prueba" y lo que haría falta en prod.**

## 1. El objetivo
Que al crear un comercio en el admin de `legacy-application` queden listos, sin pasos manuales, su sucursal de prueba, un asesor de prueba (perfil Comercial, marcado `is_test = 1`) y **su cuenta en Cognito** con la clave ya definitiva. Así se puede entrar al wizard como asesor sin crear el usuario a mano en Cognito y copiar su `sub` a la base.

## 2. Qué hicimos (dev y qa)
- **Código:** la app crea el asesor y su cuenta con `AdminCreateUser` y `AdminSetUserPassword`, y guarda el `sub` en `users.cognito_id`. Está en `legacy-application` `develop`.
- **Lambda de pre-registro (dev):** dos PRs en `cognito-pre-sign-up`, ya mergeados: permiso del stack para el pool Merchants Dev, y más margen de espera (consulta 4 s, función 5 s) porque el primer intento tras un rato sin uso tardaba unos 2,3 s y vencía.
- **Login de los wizards de qa y dev desplegado → pool Merchants Dev** (`us-east-2_Mh2hIqeQ5`, tu cuenta de dev). Antes iniciaban sesión contra el pool Merchants de **producción** (`us-east-1_XnF2zz3Ou`): el id, el dominio `auth.merchant.creditop.com` y el cliente `il7p9ueb…` son los de la consola de prod, y las URLs de retorno de qa, staging y dev estaban en ese cliente. Cambiamos en Secrets Manager solo `COGNITO_DOMAIN`, `COGNITO_CLIENT_ID` y `COGNITO_CLIENT_SECRET` de `dev/loan-request-wizard-qa` y `dev/loan-request-wizard`, con un cliente nuevo por ambiente en Merchants Dev, y copiamos la marca de la pantalla de login de prod (Managed Login v2). Los valores anteriores quedan como versión anterior de cada secret.
- Probado: alta del comercio → cuenta de Cognito al primer intento → el asesor entra al wizard de qa y llega a su sucursal.
- Efecto buscado y aceptado: las cuentas de asesor de siempre (del pool de prod) ya no entran a qa ni a dev; solo los asesores de prueba.

## 3. Lo que necesito que mires (dev/qa)
Los secrets de los wizards tienen la etiqueta `ProvidedBy: terraform` y los editamos a mano. **¿Un `terraform apply` los va a pisar y devolver al valor anterior?** Si sí, ¿dejamos el cambio en el código o marcamos esas tres claves para que no se sobrescriban?
Y: **¿hay problema si hacemos lo mismo en staging?** (mismo esquema, tercer secret `dev/loan-request-wizard-stg`).

## 4. Prod: lo que haría falta de tu parte
En prod **el pool Merchants que ya existe está bien y se queda**: no se cambia el login del wizard ni se crea un cliente nuevo. Solo queremos que el admin pueda crear los asesores de prueba en ese pool. Revisé qué hay hoy y lo que falta es esto:

1. **Permisos de IAM.** El rol `inertia-production-legacy-application-task-role` (servicio `legacy-application`, clúster `inertia-production`, us-east-2) **no tiene ningún permiso de Cognito** hoy. Hacen falta, sobre el pool `arn:aws:cognito-idp:us-east-1:299276669008:userpool/us-east-1_XnF2zz3Ou`, estas cuatro acciones, que son las que usa el código y nada más:
   `cognito-idp:AdminCreateUser`, `cognito-idp:AdminSetUserPassword`, `cognito-idp:AdminGetUser`, `cognito-idp:AdminDeleteUser`.
   (Solo el servicio web; los workers no crean comercios. El pool está en us-east-1 y el servicio en us-east-2: el ARN lleva la región del pool.)
2. **Tres claves en el secret `prod/legacy-application`.** La definición de la tarea de prod no las referencia hoy:
   - `MERCHANT_AWS_COGNITO_REGION` = `us-east-1`
   - `MERCHANT_AWS_COGNITO_USER_POOL_ID` = `us-east-1_XnF2zz3Ou`
   - `ALLIED_TEST_ADVISOR_PASSWORD` = una clave **propia de prod**, distinta de la de dev. Te la paso Miguel por un canal privado; tiene que cumplir la política del pool (mínimo 8, mayúscula, minúscula, número y símbolo).
   Si el despliegue reconstruye la tarea desde el secret, llegan en el siguiente despliegue; si no, hay que agregarlas también a la definición de la tarea.
   Sin `MERCHANT_AWS_COGNITO_USER_POOL_ID` la app **no llama a Cognito** y el alta de comercios sigue como hoy: esa variable es el interruptor.

## 5. Lo que NO hace falta en prod
- **Nada del lambda de pre-registro.** El pool Merchants de prod no tiene trigger de pre-registro (`LambdaConfig` vacío) y solo permite crear usuarios al administrador (`AllowAdminCreateUserOnly = true`), así que `AdminCreateUser` no pasa por ningún lambda. El stack de prod del lambda no se toca.
- Ningún cliente nuevo, dominio ni cambio en el pool ni en el wizard de prod.

## 6. Lo que hacemos nosotros (no es de infra)
- Llevar el código a `main` y a un tag: el 2026-10-01 se sacó de `main` con un revert, así que hay que volver a promoverlo.
- Confirmar que las columnas `is_test` existen en la base de prod (las trae una migración de `legacy-backend`); si no, el asesor se crea sin marca pero el alta no falla.
- Primera prueba acotada con un comercio de prueba dedicado y, después, rotar la clave.

## 7. Cómo se apaga
Dejar vacío `MERCHANT_AWS_COGNITO_USER_POOL_ID` y reiniciar los servicios. Las cuentas ya creadas se limpian aparte, una por una.
