---
id: 75
title: "BCP: tres defectos del recorrido del asesor"
ramas: bcp-gate-y-productos, bcp-productos-del-payload, no-retomar-solicitud-cerrada
stage: work
created: "2026-09-09T08:12:00-05:00"
canon: [altas, listado, arquitectura, onboarding, formularios]
jira: [CORE-548]
jira_title: "BCP: tres defectos del recorrido del asesor"
---

## Objetivo

Que el botón de atrás no pueda dañar una solicitud de BCP, que el asesor pueda corregir los datos del
vehículo, y que la decisión que registra quede escrita contra los productos que la pantalla de
entidades después consulta — sin ids de entidad copiados en el código.

## Dónde se toca

**`frontend-monorepo`** (rama `fix/bcp-gate-y-productos`, 5 archivos):
- `apps/loan-request-wizard/app/routes/entidad/resultado.tsx` — guarda de etapa en `loader` y `action`,
  la lista de productos sale del payload, el fallback se reporta.
- `apps/loan-request-wizard/app/modules/form-placements/infrastructure/alternate-flow-session-marker.server.ts`
  — la marca guarda la DECISIÓN (`approved`/`rejected`), no un booleano.
- `apps/loan-request-wizard/app/utils/onboarding-destination.server.ts` — `isReopenablePlacement`,
  acotada por tipo a `pre_alternate_flow`.
- `apps/loan-request-wizard/app/routes/placement-form.tsx` — `resolveFormToServe`, y borrar la marca al
  guardar el vehículo corregido.
- `apps/loan-request-wizard/app/utils/otp-funnel-cookie.test.ts` — tests del marcador.

**`legacy-backend`** (rama `fix/bcp-productos-del-payload`, 6 archivos):
- `Modules/UserRequestV1/App/Repositories/UserRequestRepository.php` — `getLendingProductsByBranch`.
- `Modules/UserRequestV1/App/Services/GetPreApprovalPayloadService.php` — el orquestador.
- `Modules/UserRequestV1/config/config.php` — `manual_product_keys`.
- `Modules/UserRequestV1/App/Domain/PreApprovalPayloadData.php`, la interfaz del repositorio, y
  `tests/Unit/PreApprovalLendingProductsTest.php`.

**`playground/harness`**: `dev/montar-peru.ts` (los slugs), `mock-preapprovals/server.mjs` (valida la
clave) y `dev/bcp-volver.ts` (recorrido C).

## Cómo se ataca

1. **El gate.** La pantalla de resultado no miraba la etapa. Guarda en el `loader` **y** en el `action`
   —quien llama a la ruta se saltea la pantalla— y la marca de sesión pasa a guardar *qué* se decidió,
   porque con un booleano las guardas no podían distinguir un rechazo (que cierra la solicitud) de una
   aprobación. El simulador queda sin guarda a propósito: no escribe nada.
2. **El vehículo.** Eran dos preguntas contestadas por una función. `resolveOnboardingDestination` dice
   cuál es el próximo paso; `isReopenablePlacement` dice si además hay que SERVIR la pantalla que
   piden. Y guardar el formulario corregido borra la marca, así que el próximo paso vuelve a ser el
   simulador.
3. **Los productos.** El id sale de la sucursal de la solicitud; la CLAVE, de config. La lectura va
   acotada a `manual_product_keys` — los productos cuyo veredicto lo reporta el asesor.

## Lo que se evaluó y NO se eligió

- **Los ids de entidad en una variable de entorno.** Era mover el problema: el dato ya vive en la base,
  una variable se olvida en silencio, y otra entidad obligaría a tocar cada ambiente. Descartado en
  revisión.
- **Devolver TODAS las entidades activas de la sucursal.** Fue la primera versión del backend y es lo
  que Fercho frenó, con razón. Ver la medición de abajo.
- **Derivar la clave del producto del `slug` del lender.** Parece lo natural —el marketplace lo hace—
  pero sólo funciona para los lenders de una palabra. Ver la medición.
- **Atar el par suelto `lending_product_key`/`_id` al primer elemento de la lista.** Lo ataba a
  `ORDER BY l.id`, un AUTO_INCREMENT, y contradecía la compatibilidad que el propio payload promete.
- **Tests en `Feature/`**, que es donde Fercho los pidió. No se puede: el `Pest.php` de ese módulo ata
  `RefreshDatabase` a esa carpeta, así que un archivo nuevo ahí recrea la base. Van en `Unit/`.

## Lo que está decidido, y lo que se midió

> **DECISIÓN · 2026-09-09.** Las claves elegibles van en config (`manual_product_keys`) y los ids en la
> base. Es la distinción entera: un id es una fila AUTO_INCREMENT que difiere por ambiente; la clave es
> el contrato con el microservicio y es la misma en los tres. Verificado: `bcp_consumo` en dev (206) y
> en producción (198), `bcp_vehicular` en dev (207).

> **HALLAZGO · 2026-09-09 · local mentía.** Los slugs de BCP en local se sembraban en kebab
> (`bcp-consumo`), y el mock de pre-aprobados aceptaba cualquier clave y devolvía aprobado. O sea que
> el registro de la decisión no llegaba a ningún lado y la corrida se veía verde. Los dos corregidos:
> el seeder siembra los slugs de dev/producción y el mock corta con 400, como el handler real.

## Lo que NO entra

- **El monto a financiar** (F-185): sigue viajando sólo en la dirección y `user_requests.amount` se
  queda con el valor del vehículo. El backend ya tiene el endpoint en `qa`; el front no lo llama. Es de
  `bcp-peru-estructurar-entidad`, y toca código de plataforma que usan todos los flujos.
- **La decisión persistida en la solicitud.** Hoy vive en la cookie del navegador del asesor, así que
  el que cambia de equipo repite el tramo. Falla hacia el lado seguro.
- **La pertenencia de la solicitud** en las otras dos pantallas de formulario: alcanza a Credifamilia,
  Ábaco y Motai.
- **La marca de sesión sin techo** (una clave por solicitud, contra el límite de ~4 KB de la cookie).
  Fercho lo levantó y quedó para ticket aparte, como él propuso.
- **El simulador embebido**: sigue bloqueado por `X-Frame-Options` y por el cortafuegos de IPs
  peruanas de la contraparte. No se puede ejercitar en ningún ambiente.

## Cómo se comprueba

    make harness-peru && make harness-forms-g2
    cd harness && E2E_TARGET=local node dev/bcp-volver.ts --comercio '#50e007e4'

Tres recorridos: **A** la ida completa (más los experimentos de «atrás» y la corrección del vehículo),
**B** aprobar → volver → rechazar, **C** rechazar → volver → aprobar. Los dos ✗ que quedan son de
F-185 y son esperados.

Y las pruebas: `./vendor/bin/sail artisan test Modules/UserRequestV1/tests/Unit/PreApprovalLendingProductsTest.php`
(⚠ nunca la suite entera) y, en el wizard, `SESSION_SECRET=x npx vitest run app/utils/otp-funnel-cookie.test.ts`.
## Tarea (publicable)

## En una línea

En el recorrido de BCP el botón de atrás podía matar una solicitud ya aprobada,
impedía corregir los datos del vehículo, y la decisión del asesor se registraba contra productos
escritos a mano que en producción no existen.

## Por qué

Los tres se dan en el uso normal del asesor, no en un caso raro. Marcar «Rechazado» en una
pantalla a la que se llega apretando atrás dos veces cerraba una solicitud viva, y desde ahí no hay
vuelta: hay que abrir otra y volver a pedirle todo al cliente. Corregir una cuota inicial mal tecleada
era imposible: el sistema empujaba hacia adelante sin dejar tocar nada, y el cliente terminaba viendo
una cuota calculada sobre un monto que no pidió. Y la decisión sobre la oferta preaprobada se
registraba contra una lista de productos escrita a mano que mezclaba ambientes, así que en producción
disparaba consultas que fallan siempre y, si el producto que hacía falta no estaba en la lista, la
pantalla de entidades salía vacía sin ninguna pista de por qué.

## Qué cambia

La pantalla donde se marca el resultado ya no acepta una segunda decisión: quien vuelve
a ella con la decisión tomada va al paso que le corresponde — y si había rechazado, a la pantalla de
cierre, no al resto del recorrido de una solicitud que ya terminó. El formulario del vehículo vuelve a
ser editable después de la simulación, y corregirlo obliga a simular de nuevo, porque lo simulado antes
era de otro crédito. Los productos contra los que se registra la decisión los resuelve el sistema
contra el punto de venta de esa solicitud, así que son los mismos que la pantalla de entidades consulta
después y no hay nada que configurar en ningún ambiente.

## Alcance

Sólo el recorrido de la entidad peruana. No cambia qué se le ofrece al cliente, ni la
simulación, ni el resultado de una solicitud que avanza sin volver atrás. **No** entra el monto a
financiar, que sigue perdiéndose al recargar o al volver: va aparte porque toca el listado de entidades
de todos los flujos.

## Dónde probar

En **qa** (`originaciones-qa.dev.creditop.com`), con el comercio de pruebas peruano y
el producto vehicular. ⚠ Requiere que el cambio del monolito esté desplegado **antes** que el del
front.

## Cómo validar

Tres recorridos, con un vehículo de 60.000, cuota inicial 10.000 y bono 2.000:
1. Llegar al resultado de la preaprobación, marcar **Aprobado**, apretar atrás hasta esa pantalla y
   marcar **Rechazado**. La solicitud tiene que quedar como estaba, no negada.
2. Al revés: marcar **Rechazado** y volver atrás. Tiene que llevar a la pantalla de cierre, no al
   formulario siguiente ni al listado de entidades.
3. Pasada la simulación, volver al formulario del vehículo, cambiar el valor a 75.000 y guardar. Tiene
   que dejar editarlo y devolver al simulador.

## Criterios de aceptación

Una decisión ya tomada no se puede volver a tomar, y una solicitud
rechazada no revive. Los datos del vehículo se pueden corregir en cualquier momento antes de elegir
entidad, y corregirlos vuelve a pedir la simulación. Un cliente que avanza sin volver atrás llega al
listado de entidades igual que hoy.

## Dependencias / contraparte

El simulador embebido sigue sin poder ejercitarse: la contraparte no ha
autorizado mostrarlo dentro de nuestras pantallas y su cortafuegos sólo acepta direcciones de Perú.
Mientras eso no pase, esa pantalla se ve vacía en cualquier ambiente y no es parte de esta validación.
