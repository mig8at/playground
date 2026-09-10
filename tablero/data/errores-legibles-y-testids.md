---
id: 77
title: "Que el front diga QUÉ pasó: subcódigos de KYC, errores que no se tragan, y testids"
stage: work
ramas: feat/comercio-pantalla-de-bienvenida
created: "2026-09-09T18:00:00-05:00"
context_nodes: [kyc, onboarding, findings]
jira: []
jira_title: ""
---

## Si retomás esto sin contexto, empezá acá

Cuatro trabajos que salieron de la misma observación, mientras se probaba Alta Fleet (tarea #76):
**el producto sabe qué pasó y no lo dice** — ni al cliente que está en la pantalla, ni a la
herramienta que lo está probando.

No son cuatro ideas sueltas: son cuatro puntos de la misma cañería, del backend a la pantalla.

| | qué | dueño | tamaño |
|---|---|---|---|
| **1** | `error_subcode` de KYC → mensajes accionables | front | ✅ **hecho** (#983) |
| **2** | Los `catch` que no devuelven nada | front | 🟡 11 loaders + 4 actions del tronco; faltan 9 |
| **3** | `data-testid` en el wizard | front | ✅ **hecho** — 7, y el parche borrado |
| **4** | Mensajes presentables del catálogo `URV` | backend + front | ~94 mensajes |

El orden importa y no es por tamaño: **1 y 2 no dependen de nadie**, 3 desbloquea al harness, y 4 es
el único que necesita ponerse de acuerdo con quien mantiene el catálogo.

## Objetivo

Que cuando algo falle, el cliente lea **qué le falta hacer** en vez de quedarse frente a un botón
muerto o un «Oops! Algo salió mal»; y que el harness pueda agarrar los elementos por un id estable en
vez de adivinar por el texto de la etiqueta.

## Lo que está decidido

### 1 · `error_subcode` — y por qué va primero

El backend YA desambigua el genérico `ONB005` con una familia de **9 subcódigos** tipados en un enum
(`Modules/Onboarding/App/Services/KycValidationOutcome.php`): `EXPEDITION_DATE_INVALID`,
`EXPEDITION_DATE_MISMATCH`, `DOCUMENT_NOT_FOUND`, `DOCUMENT_DUPLICATE`, `BIRTH_DATE_INVALID`,
`BIRTH_DATE_UNDERAGE`, `STRATUM_REQUIRED`, `PROVIDER_ERROR`, `KYC_VALIDATION_FAILED`.

**Es de Miguel** (`mig-creditop`, 2026-05-14, *«Add OBS-KYC-03: disambiguate ONB005 with error_subcode
family and trap impossible expedition dates»*) y **no lo quitaron**: sigue vivo.

⚠ **Y es MEJOR diseño que el catálogo `URV` para esto**, que es la razón de que vaya primero: separa
*qué pasó* (el subcódigo, cerrado y tipado) de *qué le decimos al cliente* (la copia, en el front). Con
eso el backend nunca manda texto de cara al usuario, y el problema del punto 4 —mezcla de mensajes de
desarrollador y de cliente— no puede ocurrir.

### 2 · Los `catch` que devuelven `undefined`

Falla de dos formas distintas, y conviene no mezclarlas:

- **en un action** → el botón no hace nada (es **F-192**);
- **en un loader** → devuelve `undefined`, el componente destructura sobre eso y salta el error
  boundary: **«Oops! Algo salió mal»**.

### 3 · `data-testid`, no `id-qa`

Es lo que ya usan el patch del harness, `pkg/close.ts` (`lender-toggle-<id>`) y los dos que hay en el
front; es el default de `getByTestId` de Playwright y la convención de Testing Library. Un atributo
nuevo obligaría a configurar `testIdAttribute` y a migrar lo poco que hay, sin ganar nada.

⚠ Y al terminar hay que **borrar `bin/testids` y su patch**, o quedan dos fuentes de verdad y la que
está rota gana por descuido.

### 4 · El catálogo `URV` necesita que el backend marque qué es presentable

No alcanza con «mostrar el `message`»: hay que poder distinguir el texto de cliente del de
desarrollador. Lo limpio es un campo aparte en el envelope (`user_message`, o un booleano). Que lo
decida el front por heurística —adivinar por idioma— es exactamente la clase de truco que hoy nos
cuesta caro en el autorrelleno del harness.

## Lo que se midió

> **MEDICIÓN · 2026-09-09** — **el `error_subcode` no lo consume NADIE en el front.** En todo el
> monorepo aparece **una sola vez**, y es en un test (`packages/shared/utils/src/network/http-client.test.ts`).
> Ninguna pantalla switchea sobre él. Hoy, ante `ONB005`, `loan-request-form.tsx` aplana los errores
> por campo y muestra eso — sirve cuando el fallo es de un campo, pero los subcódigos que NO son de
> campo (`DOCUMENT_DUPLICATE`, `PROVIDER_ERROR`, `BIRTH_DATE_UNDERAGE`, `STRATUM_REQUIRED`) se pierden
> o llegan disfrazados, y son justo los que tienen remedios distintos.
> `grep` sobre `apps`, `modules` y `packages` del monorepo

> **MEDICIÓN · 2026-09-09** — ⚠ **el backend emite MAYÚSCULAS y el fixture del test usa minúsculas.**
> El backend manda `KycValidationOutcome::DOCUMENT_DUPLICATE->value` = `'DOCUMENT_DUPLICATE'`; el test
> del front usa `"document_duplicate"`. Un `switch` escrito mirando el test **no matchearía nunca, en
> silencio**. Es la primera trampa del punto 1.

> **MEDICIÓN · 2026-09-09** — **23 archivos de rutas tienen un `catch` que reporta a PostHog y no
> devuelve ni relanza nada.** Entre ellos `loan-confirmation`, `payment-schedule`, `sign-documents`,
> `otp-validation`, los cuatro de `dynamic/` y el **loader** de `first-payment-date`. ⚠ Y en local es
> mudo del todo: `APP_ENV=local` apaga `getServerPostHog`, así que el error no queda ni en telemetría.
> conteo con balanceo de llaves sobre `apps/loan-request-wizard/app/routes` (un `grep` simple daba
> falsos positivos: marcaba archivos ya arreglados)

> **MEDICIÓN · 2026-09-09** — **el catálogo `URV` mezcla idiomas.** De ~94 mensajes clasificables:
> **29 en español**, **42 en inglés**, 23 ambiguos. Ejemplos reales que hoy NO se le pueden mostrar a
> un cliente: `URV29004` → «The lending product is not configured.», `URV13000` → «User request flow
> signed successfully.». El clasificador es tosco, pero la proporción se sostiene.
> `grep` de los mapas `'URVxxxxx' => '…'` en `Modules`, clasificados por palabras marcadoras

> **MEDICIÓN · 2026-09-09** — **el front tiene DOS `data-testid` en total**, y los dos son
> incidentales (una story de storybook y `refine-ui`). Ninguno del wizard. El harness los inyecta con
> un **parche local** (`bin/testids on`), y **3 de los 4 archivos de ese parche ya no aplican**: el
> front cambió desde junio y la herramienta está rota sin que nadie se enterara. Por eso
> `pkg/autorelleno.ts` es heurístico —16 reglas de regex adivinando por `name`/`id`/`placeholder`/
> `aria-label`/texto del label— y su propio comentario lo explica.
> `git apply --check` del parche + conteo en el monorepo

## Riesgos

- **El punto 1 toca una pantalla del flujo real** (`loan-request-form`, los datos personales). Un
  mensaje mal mapeado es peor que ninguno: le dice al cliente que arregle lo que no está mal.
- **El punto 2 es mecánico sólo a medias.** Dejar de devolver `undefined` sí lo es; *dónde* pinta cada
  pantalla el mensaje, no. Hacerlo con un reemplazo masivo dejaría 23 pantallas con un banner puesto
  donde no se ve.
- **El punto 3 se pudre solo** si no se borra el parche del harness al terminar.
- **El punto 4 no se puede hacer sólo desde el front** sin filtrarle inglés al cliente.

## Cómo se comprueba

- **1** — forzar cada subcódigo contra local y ver el mensaje: `DOCUMENT_DUPLICATE` se reproduce
  mandando un documento que ya tiene otro usuario; `EXPEDITION_DATE_MISMATCH`, con una fecha que no
  coincide con la del buró (el lambda de mocks dicta la respuesta por cédula).
- **2** — `make harness-caminar`: un action que se traga el error se reporta como «no redirigió ni dio
  error»; arreglado, pasa a «respondió error: true» (verificado así en F-192).
- **3** — que `pkg/autorelleno.ts` pueda borrar reglas del heurístico y siga llenando.
- **4** — que ningún mensaje mostrado al cliente esté en inglés.

## Registro

### 2026-09-09 · el punto 3, hecho

Siete `data-testid` en cuatro archivos del front (`Creditop-SAS/frontend-monorepo#983`), y el parche
local del harness **borrado** — con su binario `bin/testids`.

> **MEDICIÓN · 2026-09-09** — **verificados en el DOM, no supuestos.** `MoneyInput` e `InputOTP` son
> wrappers y podrían no propagar el atributo: recorriendo el wizard aparecen los seis (monto, teléfono,
> OTP). El séptimo, `lender-toggle-<id>`, **no sale con Alta** —una sola entidad, no hay nada que
> plegar— y sí con **Pullman**: `lender-toggle-39`, `-9`, `-6`, `-32`.
> Playwright contra local, contando `[data-testid]` pantalla por pantalla

⚠ Y una trampa de la primera corrida: los seis daban **cero** porque la página estaba en la
**bienvenida** del comercio y no en el formulario. El testid estaba bien; la medición, mal.

⚠ Nota al margen, preexistente: en `harness/pkg/` conviven **`autorelleno.ts` y `autorrelleno.ts`**
(con una y con dos erres). Son módulos distintos y el nombre no lo dice.

### 2026-09-09 · el punto 2, la mitad de los loaders

**11 `catch` de loader en 10 archivos** ahora relanzan, con un helper compartido
(`captureAndRethrowServerException`) que lleva el porqué en su docblock en vez de repetirlo once
veces.

> **MEDICIÓN · 2026-09-09** — **relanzar no cambia lo que ve el cliente; cambia lo que recibe el
> boundary.** Ningún componente del árbol tolera un loader que devuelve `undefined` —todos hacen
> `const { x } = useLoaderData()`—, así que el error llegaba igual al boundary, pero como
> `TypeError: Cannot destructure property 'response' of undefined`. Pidiendo una solicitud
> inexistente, ahora llega `Failed to fetch first payment dates: NETWORK_ERROR`.
> ⚠ La excepción es `loan-approved.tsx`, el ÚNICO de los 12 que sí tiene camino alternativo para datos
> ausentes: ahí relanzar cambiaría el comportamiento y no se toca.
> `curl` a `/self-service/<hash>/999999/payment-schedule` y `/first-payment-date`, leyendo el error en
> el HTML del boundary

**Y los 4 ACTIONS del tronco CreditopX** —`loan-confirmation`, `payment-schedule`, `sign-documents`,
`otp-validation`— ya devuelven. El aviso vive en UN componente (`ActionErrorBanner`) sin props: lee el
`useActionData` de su ruta y se dibuja solo si hay `errorMessage`, así una pantalla lo adopta con una
línea y las que devuelven otra forma no lo activan sin querer. ⚠ `otp-validation` NO lleva banner
porque su UI ya pinta `actionData.error`: agregarlo mostraría el mismo error dos veces.

**Quedan 9 `catch` de ACTIONS**, y no se arreglan igual: ahí no hay que relanzar sino DEVOLVER
algo que la pantalla pinte, y cada pantalla decide dónde. todos de canales que no ejercitamos (`bancolombia/*`, `dynamic/*`,
`abaco`, `soft-update`). ⚠ Tocarlos a ciegas es peor que dejarlos: un banner puesto donde no se ve
PARECE arreglado y no lo está. El dato que los hace baratos: **7 de esos archivos ya consumen
`useActionData`**, así que ahí el cambio es de tres líneas.

### 2026-09-09 · el punto 1, hecho

En `frontend-monorepo#983`. La tabla y la decisión viven en `kyc-error-messages.ts`, aparte de la ruta
—mismo criterio que `kyc-pending-routing.ts`—, con **diez pruebas**.

⚠ Al implementarlo aparecieron **dos defectos que no estaban en el plan**: los discriminadores
(`error_code`, `error_subcode`) viajaban como **errores de campo**, porque el backend los manda dentro
del objeto de errores y `parseAnyApiError` aplana todas las claves por igual — y encima se contaban
como errores de campo en la analítica. Y el toast del mensaje **no se disparaba nunca** en esa rama: la
condición era `!actionData.errors` y la rama devuelve `errors` siempre, aunque sea `{}`, que es truthy.

Y una decisión que conviene no revertir sin pensarla: **el mensaje del subcódigo NO pisa al del
backend cuando hay error de campo**. El de `DOCUMENT_DUPLICATE` trae los últimos tres dígitos del
celular con el que ya está registrado el documento — es más específico que cualquier texto nuestro.


### 2026-09-09 · de dónde salieron los cuatro

Aparecieron probando Alta (#76). El primero se encontró arreglando **F-192**: el botón de la fecha de
pago no hacía nada porque el backend cortaba con 409 —«Tu solicitud requiere un codeudor aprobado antes
de firmar los documentos»— y el `catch` del action devolvía `undefined`. Al arreglar ése apareció la
pregunta de cuántos más había (23), y de ahí la de si el backend ya tenía mensajes mejores que los
códigos (sí: el `error_subcode` de OBS-KYC-03, sin usar hace cuatro meses).

## Tarea (publicable)

## En una línea

Cuando la validación de identidad falla, el cliente ve un mensaje que le dice **qué corregir** en vez
de un error genérico.

## Por qué

Hoy todos los fallos de validación de identidad llegan al cliente como el mismo error, aunque las
causas —y los remedios— sean distintos: un documento que ya está registrado a nombre de otra persona
no se resuelve igual que una fecha de expedición que no coincide, ni que un proveedor caído. El
cliente reintenta lo mismo, falla igual, y abandona.

El sistema ya distingue nueve causas distintas internamente; lo que falta es decírselo a quien está en
la pantalla.

## Qué cambia

La pantalla de datos personales muestra un mensaje distinto según la causa real, con la acción
concreta que corresponde. Los casos que hoy se pierden por completo —documento duplicado, menor de
edad, proveedor no disponible— pasan a tener su propio mensaje.

## Alcance

Sólo la validación de identidad del onboarding. No cambia ninguna regla de negocio ni quién es
aprobado: cambia únicamente lo que se le comunica al cliente cuando la validación no pasa.

## Dónde probar

Onboarding, pantalla de datos personales, con un documento que dispare cada caso.

## Cómo validar

- Un documento ya registrado a otra persona muestra el mensaje de documento duplicado, no un error
  genérico.
- Una fecha de expedición que no coincide lo dice explícitamente.
- Un fallo del proveedor se distingue de un dato mal ingresado por el cliente.
- Ningún mensaje mostrado al cliente aparece en inglés.

## Criterios de aceptación

- Los nueve casos tienen mensaje propio y en español.
- Ningún caso queda sin mensaje: lo no contemplado cae a un texto genérico, nunca a una pantalla en
  blanco ni a un botón que no responde.

## Dependencias / contraparte

Ninguna: el backend ya envía la información necesaria desde mayo.
