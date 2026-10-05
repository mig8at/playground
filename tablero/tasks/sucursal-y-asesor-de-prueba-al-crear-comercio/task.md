---
id: 98
title: "Sucursal y asesor de prueba al crear un comercio"
ramas: feat/usuario-y-sucursal-de-prueba-al-crear-comercio, feat/asesor-de-prueba-marca-is-test, fix/timeout-validacion-correo, feat/permiso-pool-merchants-dev
stage: work
created: "2026-10-01T10:48:29-05:00"
knowledge: [merchant-onboarding]
canon: [comercio, sucursal, asesor, actores]
jira: [CORE-0000]
jira_title: "Sucursal y asesor de prueba al crear un comercio"
---

## Pendientes

- [ ] Reemplazar el marcador `CORE-0000` por el CORE real en `jira:`; termina cuando el issue figura en el
  frontmatter y `CORE-0000` desaparece. (El tablero exige `CORE-` con dígitos: el marcador no es un issue.)
  Depende de: asignación en Slack — número del issue.
- [x] Obtener los permisos IAM del rol `inertia-develop-legacy-application-task-role` sobre Merchants Dev
  (`AdminCreateUser`, `AdminSetUserPassword`, `AdminGetUser`, `AdminDeleteUser`). Verificado el 2026-10-02 por
  efecto, no leyendo IAM (el rol de desarrollo no lo lee): los comercios 346 y 347 crearon su cuenta en el pool.
- [x] Mergear el PR del lambda que agrega al stack el permiso para Merchants Dev (hecho el 2026-10-02; el
  despliegue terminó en `UPDATE_COMPLETE` y el lambda rechaza con su mensaje un correo ajeno).
- [x] Quitar la entrada manual `merchants-dev-pool` de la política del lambda (hecho el 2026-10-02): la política
  quedó con las dos entradas del stack y Cognito sigue invocando al lambda.
- [x] Ensayar el cambio y la vuelta en el wizard desplegado de dev (hecho el 2026-10-02): el asesor de prueba entra y la
  vuelta deja el secret en su versión anterior, con el servicio estable.
- [ ] Extender a qa y staging lo ya probado en dev con el front local (2026-10-02, cliente `wizard-local`):
  un cliente nuevo en el pool para el wizard (código de autorización, secreto, scopes `openid phone email`,
  retorno y salida de cada front), esas tres variables más la de retorno en cada wizard, y
  `MERCHANT_AWS_COGNITO_*` en el admin de qa y staging; termina cuando `make harness-login-check
  TARGETS=dev,qa,staging ALLIED=<id>` da «entró» en los tres.
  Depende de: Daniel Sánchez (infra) — crear el cliente y cargar las variables; verificar si el gateway
  que valida el token acepta ese pool.
- [ ] Reubicar los asesores que ya entran a qa y staging: su `cognito_id` es del pool actual y dejarán de
  entrar al cambiar; termina cuando cada uno existe en Merchants Dev con su `sub` en la base.
- [x] Confirmar a qué pool apuntan dev, qa y staging (2026-10-02): al de PRODUCCIÓN. El id `us-east-1_XnF2zz3Ou` es el
  pool Merchants de la consola de producción. Falta, sólo para cerrar del todo, ver en esa consola que el dominio
  `auth.merchant.creditop.com` y el cliente `il7p9ueb…` son los de ese pool.
- [x] Mergear el [PR 252](pr:application#252) y comprobarlo en dev (2026-10-05): los asesores nacen con `is_test = 1` y
  `test_reason = 'manual'`, y siguen entrando.
- [x] Borrar las dos cuentas del pool Merchants Dev que dejaron los comercios 353 y 354 (hecho el 2026-10-05, pool en 0) (cuentas `cb5c7fdad-fake` y
  `c5073e8d9-fake`); termina cuando el pool está en 0 usuarios.
  Depende de: Miguel — renovar la sesión de AWS.
- [ ] Evitar que el revert del 2026-10-01 que sacó el asesor de prueba de `main` ([PR 251](pr:application#251)) lo saque también de
  `develop` en el próximo merge de `main`; termina cuando el flujo de promoción a `main` lo incluye de nuevo (un revert del revert).
- [ ] Cambiar la clave compartida de dev (`ALLIED_TEST_ADVISOR_PASSWORD`): quedó escrita en una
  conversación; termina cuando el secret tiene una clave nueva y la anterior ya no abre la cuenta.
- [ ] Hacer la Fase 1 de «Cómo se ataca» (leer prod, sólo lectura); termina cuando se sabe qué pool usa el
  wizard de prod, qué permisos tiene el rol de la tarea, qué dice la política de claves del pool y cómo se
  reconocen las solicitudes de prueba.
  Depende de: Miguel — renovar la sesión del perfil de producción.
- [ ] Decidir en prod si la cuenta de Cognito es automática desde el primer día o se pasa antes por la Fase 2 (sin
  Cognito); se recomienda la Fase 2 primero. Termina cuando está escrita la decisión en un bloque.
- [ ] Definir la clave propia de producción y su rotación; termina cuando `prod/legacy-application` la tiene y no es
  la de dev.
  Depende de: Miguel — la clave.
- [ ] Ensayar en dev la reversa (claves vacías y reinicio de los servicios); termina cuando las tareas arrancan con
  valores vacíos o se descubre que no y se cambia la reversa.
- [ ] Opcional: enrutar `c*-fake@creditop.com` a un buzón compartido; termina cuando un correo de
  recuperación de clave a ese formato llega a alguien.
  Depende de: quien administra el Workspace.
- [x] Documentar las dos altas y el alcance de la baja verificados en `main` en
  `knowledge/merchant-onboarding`, con fuentes de ambos monolitos.
- [ ] Ampliar `knowledge/merchant-onboarding` con el usuario de prueba cuando #243 esté en `main`;
  termina con el servicio y sus condiciones comprobados contra esa ref. Las pruebas y la
  configuración de desarrollo siguen en esta tarea; no se convierten en reglas de producción.
  Depende de: que #243 llegue a `main`.
- [ ] Que el motivo de una falla de Cognito sea visible sin logs: mostrar el código de error de AWS en la nota que ve
  el admin (no es un secreto); termina cuando el diálogo y la tarjeta lo muestran y una prueba lo fija.
- [ ] Que los eventos del servicio lleguen a Loki en dev: activar Loki para `legacy-application` (hoy
  `GRAFANA_LOKI_ENABLED=false` y sin endpoint ni credenciales) **y** registrar los eventos por `TracerService`; termina
  cuando `{service_name="legacy-application"}` devuelve líneas `allied.test_advisor`.
  Depende de: Daniel Sánchez (infra) — activar Loki con las credenciales del backend.
- [ ] Comprobar en un log real de dev que una falla de Cognito no escribe la clave; termina cuando se
  provoca una falla y el log no la contiene.
  Depende de: que los eventos sean legibles (los dos pendientes anteriores).
- [ ] Quitar de `.claude/launch.json` la entrada `admin-test-advisor`, que apunta a un worktree que ya no
  existe; termina cuando no figura.
  Depende de: Miguel — confirmar que se quita sólo esa entrada y no el archivo.
- [x] PR #243 revisado, mergeado a `develop` y desplegado en dev — 2026-10-01 (ver la pila).
- [x] Variables del secret de dev puestas y verificadas (`MERCHANT_AWS_COGNITO_*` y la clave compartida) —
  2026-10-01.

## Objetivo

Al crear un comercio en el admin de `legacy-application` quedan, sin pasos manuales:

- una **sucursal de prueba** `b<hash>-fake`,
- un **asesor Comercial** (perfil 4) asignado a ella, con correo `c<hash>-fake@creditop.com`, y
- su **cuenta en el pool de Cognito de comercios** con `users.cognito_id` ya guardado,

para entrar al wizard con ese asesor sin crear la cuenta a mano en Cognito ni copiar el `sub`. El mismo
`<hash>` (el de la sucursal) enlaza las tres cosas, es único y se reconstruye desde la URL de entrada.
Nunca puede romper el alta del comercio, y un comercio que ya tiene el usuario no recibe otro.

## Dónde se toca

Todo en `legacy-application` (alias `application` en el tablero), rama `develop`:

- `app/Services/Allied/TestAdvisorProvisioner.php` — el servicio: sucursal + asesor en una transacción, y
  luego la cuenta en Cognito; `find`, `summary`, `resetPassword`, `buildEmail`, `branchName`.
- `app/Services/Allied/TestAdvisorResult.php` — lo que viaja a la pantalla (la clave compartida **no** viaja).
- `app/Services/Cognito/MerchantPoolClient.php` — `AdminCreateUser` (sin correo) + `AdminSetUserPassword`
  permanente; `setPassword`, `findSub`; borra la cuenta si queda sin clave.
- `app/Http/Controllers/Admin/AlliedController.php` — `store` llama al servicio **después** de confirmar el
  comercio; devuelve el resultado en el flash.
- `app/Http/Controllers/Admin/AlliedTestAdvisorController.php` y `app/Http/Requests/Admin/Allied/TestAdvisorRequest.php`
  — crear y restablecer desde la tarjeta, con el permiso `create allied`. Rutas en `routes/admin.php`.
- `app/Http/Middleware/HandleInertiaRequests.php` — comparte el resumen y el flash.
- `config/services.php` — `cognito_merchants` (región, pool, endpoint para el emulador) y
  `allied_test_advisor` (dominio y clave compartida).
- `resources/js/components/allieds/AlliedTestAdvisorCard.vue` y `AlliedTestAdvisorDialog.vue`, montados en
  `pages/admin/allieds/allied-edit/AlliedEdit.vue` y `pages/admin/allieds/Index.vue`.
- Pruebas: `tests/Unit/Services/Cognito/MerchantPoolClientTest.php`, `tests/Unit/Services/Allied/TestAdvisorEmailTest.php`
  y `tests/Feature/AlliedTestAdvisorTest.php`.

Lo que no es de este repo y condiciona: el lambda `cognito-pre-sign-up-development` (repo
`cognito-pre-sign-up`, consulta `POST /api/onboarding/check/email` de `legacy-backend`), el pool Merchants Dev
y el rol de la tarea en AWS, y el workflow de despliegue `config-ci` (reconstruye las variables de la tarea
desde el secret `dev/legacy-application` en **cada** despliegue).

## Cómo se ataca

1. **Servicio idempotente que no rompe el alta** (hecho, #243). Primero la base y después Cognito: el lambda
   de pre-registro sólo acepta correos que ya existen en la base de su ambiente.
2. **Tarjeta «Usuario de prueba»** en la edición del comercio (hecho): estado, crear, restablecer clave y
   reintentar la cuenta de Cognito sólo si el ambiente tiene pool.
3. **Activación por ambiente** (variables en el secret + permisos IAM del rol de la tarea + el lambda del pool).
   Dev: variables hechas, faltan los permisos. Sin las variables el servicio no llama a Cognito: crea sucursal y
   asesor y deja la cuenta «omitida».
4. **Producción**, por fases y cada una reversible. Es un plan, todavía no se ejecuta nada.

   **Qué cambia respecto de dev:**

   | | dev | producción |
   |---|---|---|
   | Cómo llega el código | push a `develop` | tag sobre `main` (`push: tags: "*"`); clúster `inertia-production`, **cuatro** servicios: `legacy-application`, `-worker`, `-worker-high`, `-scheduler` |
   | Secret | `dev/legacy-application` | `prod/legacy-application` |
   | Pool de comercios | Merchants Dev `us-east-2_Mh2hIqeQ5` | el que use el wizard **de prod**: `us-east-1_XnF2zz3Ou` por los secrets de dev (a confirmar leyendo `prod/loan-request-wizard`); el `.env` local apunta a `us-east-2_3n9lxmKCe`, **otro** pool de la misma cuenta: hay que saber cuál es el vivo. Región `us-east-1` o `us-east-2` según el caso |
   | Lambda de pre-registro | `cognito-pre-sign-up-development` → backend de dev | el de producción → `legacy-backend.inertia-production`; el pool ya está en uso, pero hay que comprobar que su política autoriza al pool vigente |
   | IAM | rol de la tarea de dev | rol de la tarea de prod, sobre el ARN del pool **de prod** (cuenta y región de prod) |
   | Clave compartida | la de dev | **otra**, propia de prod, nunca la de dev |
   | La cuenta creada | **no** entra al wizard (otro pool) | **sí** entra: es un asesor real de un comercio real |

   **Fase 0 — antes de tocar prod (en dev).** Que infra dé el IAM y deje el permiso del lambda en el stack; probar el
   flujo completo en dev (comercio nuevo, cuenta, reintento); **ensayar la reversa** (claves vacías + reinicio) para
   comprobar que las tareas arrancan con valores vacíos, hoy sin verificar; y cerrar con infra a qué pool apunta cada
   ambiente.

   **Fase 1 — leer prod, sin cambiar nada** (perfil de producción, sólo lectura): el pool que usa el wizard de prod
   y su región; el rol de la tarea y qué permisos de Cognito tiene ya; el lambda del pool, su política y su
   `USER_SERVICE_URL`; `AllowAdminCreateUserOnly` y la política de claves del pool (la clave de prod tiene que
   cumplirla); colisiones de datos (`users` tiene únicos el correo, el celular y el documento: buscar `4-9000%` en
   documentos, `4-399%` en celulares y `c%-fake@%` en correos); y **cómo se reconocen las solicitudes de prueba**
   en producción.

   **Fase 2 — el código a prod, sin variables de Cognito** (un tag). Cada comercio nuevo nace con sucursal y asesor,
   sin cuenta de Cognito, y la tarjeta lo explica. Se comprueba creando **un** comercio de prueba dedicado desde el
   admin de prod (una operación normal del admin) y se deja identificado. Es el paso que valida que el alta no se
   rompe antes de dar acceso a nadie.

   **Fase 3 — permisos y variables de prod:** IAM del rol de la tarea de prod (cuatro acciones, ARN del pool de
   prod), `MERCHANT_AWS_COGNITO_REGION`, `MERCHANT_AWS_COGNITO_USER_POOL_ID` y `ALLIED_TEST_ADVISOR_PASSWORD` con la
   clave propia de prod. Las variables llegan en el **siguiente despliegue** (el workflow reconstruye la tarea desde
   el secret), y como son cuatro servicios, hay que re-ejecutar el despliegue del último tag o sacar uno nuevo.

   **Fase 4 — prueba acotada en prod:** el comercio de prueba dedicado → la cuenta aparece en el pool de prod,
   `users.cognito_id` es igual a su `sub`, y Miguel inicia sesión en el wizard de prod con ese asesor. Después, dar de
   baja el comercio (apaga a sus asesores en la base bajo las condiciones de `knowledge/merchant-onboarding`) **y borrar la cuenta del pool**: la baja no la toca.

   **Fase 5 — monitoreo:** buscar en los logs los eventos `allied.test_advisor`, `allied.test_advisor.failed` y
   `allied.test_advisor.cognito_failed`; contar los asesores de prueba por correo `c%-fake@%`.

   **Reversa en prod:** vaciar `MERCHANT_AWS_COGNITO_USER_POOL_ID` (con eso no se llama a Cognito) y reiniciar los
   cuatro servicios; para apagar todo, revertir el release con un tag nuevo. Las cuentas ya creadas se borran del pool
   y sus usuarios se desactivan.

## Lo que se evaluó y NO se eligió

- **Probar contra el pool que usa el wizard** (`us-east-2_3n9lxmKCe` en el `.env` local; `us-east-1_XnF2zz3Ou`
  en los secrets de dev, qa y staging). Los ids coinciden con los de la consola de producción y no existen en
  la cuenta dev: desde dev no se llega y escribir ahí mezclaría cuentas de prueba con las reales.
- **Un respaldo con `COGNITO_MERCHANT_*`** para no pedir variables nuevas. Esas variables ya están en los secrets de
  todos los ambientes, pero apuntan al pool de prod: habría activado la creación de cuentas desde dev, qa y
  staging sin que nadie lo decidiera.
- **Vista previa «Se creará automáticamente» en el formulario de alta.** Se hizo y Miguel la descartó: el comercio
  se crea como siempre y el resultado se ve después, en la tarjeta y en el diálogo.
- **Un botón «Crear cuenta en Cognito» siempre visible.** Se veía forzado, porque la cuenta se crea sola. Quedó
  como «Reintentar cuenta de Cognito», sólo si el ambiente tiene pool y la cuenta falta.
- **Correo `comercial+<slug>@`**, luego `c-<slug>-fake@`. El alias `+` no gustó; el slug no es único ni existe si el
  nombre no tiene letras latinas. Se eligió el hash de la sucursal: único, determinista y reconstruible.
- **La clave `Creditop123*` en el código.** Pública y dentro del repo, con un correo predecible. Se cambió por una
  variable de entorno con un secreto, que además no se muestra en pantalla.
- **Quitar o relajar el lambda de pre-registro.** Es el único filtro del auto-registro (el pool permite que
  alguien se registre solo). Es una decisión de infra, no de esta tarea.
- **Perfiles 6 y 7.** El pool de comercios es el de los asesores Comercial (perfil 4).
- **Probar en local con la base local y el pool de dev.** El lambda consulta la base de dev y no encuentra el
  correo. Se probó con un emulador local de AWS y, en una corrida acotada, con la base de dev real.

## Lo que NO entra

- Activar la cuenta de Cognito en dev, qa o staging a ciegas: ahí el wizard inicia sesión contra otro pool, así que
  una cuenta creada en Merchants Dev no sirve para entrar (sí sirve para probar la creación).
- La otra alta de comercios, `POST /api/partners/merchants` de `legacy-backend`: no se encontró quién la usa.
- Cambiar el lambda, la política del pool o los permisos de IAM: son de infra.
- Borrar automáticamente los comercios de prueba.

## Cómo se comprueba — y el MATERIAL para volver a hacerlo

(última comprobación completa: 2026-10-01)

**Pruebas automáticas** (desde `legacy-application`, por ruta; la suite entera no se corre):

    php vendor/bin/phpunit tests/Unit/Services/Cognito/MerchantPoolClientTest.php
    php vendor/bin/phpunit tests/Unit/Services/Allied/TestAdvisorEmailTest.php

La de funcionalidad (`tests/Feature/AlliedTestAdvisorTest.php`) usa `RefreshDatabase`, pero este repo **no migra
desde cero** (`lenders_by_allieds` espera `initial_fee_percentage`, que crea `legacy-backend`). Se corrió con
`DatabaseTransactions` sobre el esquema `testing` local, con la estructura de `creditop` clonada. La guarda de
`tests/CreatesApplication.php` sólo deja `127.0.0.1` y el esquema `testing`. Los seeders completos fallan por
llaves foráneas de CreditopX; la prueba siembra sólo permisos, roles y ajustes. Dos factories (País, Comercio) están
desfasadas del esquema y la prueba crea esas filas a mano.

**Permisos sin escribir nada.** Una acción de administración sobre un usuario que no existe: «no existe» =
permitido, `AccessDenied` = falta el permiso (IAM autoriza antes de buscar al usuario):

    AWS_PROFILE=dev aws cognito-idp admin-create-user --user-pool-id us-east-2_Mh2hIqeQ5 --message-action RESEND --username no-existe@example.com

**El cliente real desde PHP** (SDK con el perfil SSO): se vacían `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` y
`AWS_SESSION_TOKEN` del proceso, porque el `.env` local trae credenciales del emulador y el SDK las usaría primero.

**El servicio completo contra la base de dev** (única forma de que el lambda vea el correo): un script que crea un
comercio temporal, llama al servicio, verifica `users.cognito_id == sub`, y **limpia siempre por id exacto**
(rol, asesor, sucursal, comercio) más la cuenta de Cognito. Aborta si el host no es `inertia-development`. Usa el
usuario maestro del RDS de dev: sólo con autorización explícita y acotado. El bucket de S3 se apunta a uno inexistente
para que el QR no escriba nada.

**Despliegue a dev.** El workflow reconstruye las variables de la tarea desde el secret en cada despliegue: las claves
nuevas tienen que estar **antes** del merge. Una clave vacía en el secret es un riesgo no verificado (ECS podría no
arrancar la tarea); la reversa segura sigue sin probarse.

**Reversa.** Apagar Cognito sin tocar el código: dejar vacías las tres claves del secret y reiniciar los servicios
(`aws ecs update-service --force-new-deployment`). No borrarlas: la definición de tarea las referencia por nombre.

## Referencias

- Plan para qa y staging (cambiar el login del wizard a Merchants Dev, con hoja de vuelta): `artifacts/plan-pruebas-qa-staging.html`, del 2026-10-02.
- Scripts para cambiar el login de un wizard desplegado a Merchants Dev y volver (la carpeta local `cognito`, junto a `playground`, fuera de git y sin secretos): estado, crear el cliente, cambiar, probar el login y revertir, con `--dry-run`.
- Plan para producción (mantener el pool de producción; apagar es vaciar una variable): `artifacts/plan-produccion.html`, del 2026-10-02.
- [PR #243](pr:application#243) — mergeado a `develop` el 2026-10-01.
- Conocimiento local: `knowledge/merchant-onboarding/rules.md`; cubre las entradas de `main`, no la configuración de pools por ambiente.
- Canon (opcional para negocio/producto): [comercio](canon:comercio), [sucursal](canon:sucursal), [asesor](canon:asesor), [actores](canon:actores).
- Hilo con infra en Slack (Daniel Sánchez): pools por ambiente y permisos.

## Tarea (publicable)

## En una línea

Al crear un comercio queda armado, sin pasos manuales, un asesor de prueba con su sucursal y su acceso para entrar al
flujo de solicitud.

## Por qué

Para probar un comercio nuevo hacía falta crear a mano la cuenta del asesor y enlazarla con su usuario. Eso era lento,
dependía de acceso a la consola de autenticación y lo hacía solo quien conocía los pasos.

## Qué cambia

- Cada comercio nuevo nace con una sucursal de prueba y un asesor de prueba asignado a ella.
- La cuenta de acceso del asesor se crea sola donde el ambiente lo permite.
- En la pantalla de edición del comercio se ve el usuario de prueba y se puede crear, si el comercio no lo tiene, o
  restablecer su clave.
- Si la cuenta de acceso no se pudo crear, la pantalla lo dice y permite reintentarla.

## Alcance

Aplica a los comercios que se crean desde el panel de administración. Los comercios que ya existen no cambian hasta que
se les pide su usuario de prueba desde la edición.

## Dónde probar

En el ambiente de desarrollo, con la versión desplegada.

## Cómo validar

1. Crear un comercio desde el panel de administración.
2. Comprobar que se muestra el diálogo con el usuario de prueba.
3. Abrir el comercio y revisar la tarjeta «Usuario de prueba»: su sucursal, su correo y el estado de su cuenta de acceso.
4. Probar «Restablecer clave» y comprobar que se pide confirmación.
5. Repetir sobre un comercio que ya tenía usuario y comprobar que no se crea otro.

## Cambios en datos

Por cada comercio nuevo se crean una sucursal y un usuario de perfil Comercial. No hay cambios de estructura.

## Criterios de aceptación

- Un comercio nuevo tiene exactamente una sucursal de prueba y un asesor de prueba.
- Crear el comercio nunca falla por culpa del asesor de prueba.
- El usuario de prueba no se duplica.
- La clave compartida del ambiente no se muestra en ninguna pantalla.

## Dependencias / contraparte

- Infraestructura: permisos para crear las cuentas de acceso en el ambiente.
