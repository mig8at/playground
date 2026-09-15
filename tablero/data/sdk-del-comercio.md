---
id: 82
title: "El SDK del comercio: el onboarding dentro de la tienda"
clase: proyecto
stage: evaluation
created: "2026-09-14T14:30:00-05:00"
context_nodes: [ecommerce, onboarding, entities, architecture]
jira: []
jira_title: "El SDK del comercio: el onboarding dentro de la tienda"
---

# El SDK del comercio: el onboarding dentro de la tienda

> **estado:** EXPLORACIÓN, no comprometida. Nada de esto está construido ni prometido.
>
> **Si retomás esto sin contexto, empezá acá:** la pregunta es si el flujo de originación puede
> SALIR de CreditOp y correr dentro de la página del comercio, para que el comprador no se vaya de
> la tienda. Se evaluaron dos formas: el **iframe está muerto** (cuatro bloqueos independientes en
> `main`, medidos) y el **SDK en el DOM del comercio sobrevive** — y se probó corriéndolo. Lo que
> falta es una decisión de producto, no más investigación.
>
> **El próximo paso es:** medir cuántos comercios ecommerce mapean el campo documento. Eso decide si
> la experiencia sin fricción es real o sólo una demo.

⚠ **NO es la migración del canal.** Aquella es la tarea **#6 · Ecommerce web stateless** (CORE-30):
llevar el checkout de la tienda al wizard nuevo, con sus PRs abiertos. Esta explora una capa NUEVA
encima. Se separaron el 2026-09-14 a pedido de Miguel, porque venían creciendo en el mismo archivo y
son dos trabajos con dos horizontes distintos.

## Lo que esta tarea HEREDA de la #6, y no repite

- **Los seis campos que el comercio ya entrega** (`prefill`: email, phone, firstName, lastName,
  documentNumber, documentType) y sus cuatro trampas — apellidos con el mapeo muerto, `document_type`
  no mapeable, dirección y ciudad que viajan y se tiran, y el `'CC'` quemado en una de las dos puntas.
- **Que esos seis cubren los cinco obligatorios de `personal-info`**, así que el piso de fricción
  puede ser cero.
- **Que el formulario ya reacciona a medias** (`visibleOptionalFields` oculta, `lockedFields` bloquea).

Todo eso está medido y escrito en la #6. Acá sólo se usa.

## Las dos formas evaluadas, y por qué sólo una sobrevive

La pregunta que abrió este hilo es de la parte ecommerce: **que el comprador no se vaya de la tienda**.
Se evaluaron dos formas y sólo una sobrevive.

**Descartada — iframe.** No por gusto: está bloqueado en `main`, por diseño, en cuatro lugares
independientes.

1. El wizard manda `X-Frame-Options: DENY` **siempre** y `frame-ancestors 'none'`, con el comentario
   literal «el wizard nunca se embebe en iframe (confirmado)» —
   `frontend-monorepo/apps/loan-request-wizard/app/utils/security-headers.server.ts:122,137`.
2. El monolito manda `SAMEORIGIN` + `frame-ancestors 'self'` —
   `legacy-application/app/Http/Middleware/SecurityHeaders.php:38,101`.
3. La cookie `__session` del wizard es `sameSite: "lax"`: en iframe cross-site **no viaja**, y sostiene
   `ownedLoanRequests`, la marca de etapa y el `sessionId` de trazas.
4. Lo posterior a elegir entidad no es framable por nadie, y el repo ya lo midió dos veces:
   `routes/entidad/simulador.tsx:276` (el simulador de BCP responde `SAMEORIGIN` y el frame queda en
   blanco) y `submit-post-redirect.ts:8` («no sirve fetch/XHR ni un iframe»).

**Viva — SDK en el DOM del comercio.** Esquiva 1-3 (el DOM sería del comercio, no un frame ajeno) y
acepta 4 como su frontera natural.

### El prototipo

`tablero/data/artifacts/sdk-del-comercio.prototipo-tecnico.html` — un archivo, sin build ni
dependencias: una tienda falsa con el «SDK» adentro, que maneja el flujo por API y pinta el listado
dentro de la página. Se sirve con `make soporte-qa` y se abre en
`http://localhost:5199/sdk-del-comercio.prototipo-tecnico.html` — **no con doble clic**: en `file://`
el Origin es `null` y la prueba deja de parecerse a una tienda.

El contrato salió de los repositorios del wizard en `main`, no de suposiciones. ⚠ Y ahí apareció que
**el wizard ya migró parte a OnboardingV2** (`api/v2/onboarding/otp-auth/validate`, códigos `OBV22xxx`),
así que el nodo `onboarding` de `context/` quedó viejo donde dice que G3 no tiene consumidores.

### Lo medido (2026-09-14, local, origen `:5199` → backend `:80`)

Las tres llamadas dieron **200** — o sea, **una página de otro origen puede manejar el flujo hasta el
listado hoy**, sin secreto de servidor: `phone/register` → `otp-auth/validate` (`OBV22005`, uReq 466543)
→ `lenders-v2`.

⚠ **Pero salieron 6 entidades, no 7.** El mismo comercio por `make harness-listado` da 7. La que falta es
**CrediPullman (77, rt=2)** — la de CreditopX. No es un bug: el harness **inyecta** ingreso y score antes
de pedir el listado; acá el usuario es temporal y no tiene ninguno, así que rt=2 no calcula cupo y se
cae. **Mostrar cupo en la tienda sin pedir datos personales no muestra la oferta de CreditopX**, que es
justo donde el comercio pone capital y CreditOp cobra comisión. Hay que decidirlo antes de diseñar la
pantalla.

### El artefacto para producto

`tablero/data/artifacts/sdk-del-comercio.experiencia-para-producto.html` — mismo tema, otro público:
sin códigos, sin endpoints, sin `main` vs rama. Muestra la experiencia del comprador y **la única
palanca**: seis interruptores de «qué nos manda esta tienda» y una ficha de producto que se re-dibuja
mostrando cuánto tiene que escribir. No pega contra la API (es simulado, para que ande en cualquier
demo). Cierra con las tres decisiones que son de producto. Publicado también como artifact:
<https://claude.ai/code/artifact/00755787-ad1c-4f46-9dcf-61f47298ebf0>

### Qué destraba la entidad rt=2 — y no son los datos del comercio

> **MEDICIÓN · 2026-09-14** — ¿dar los datos personales hace aparecer a **CrediPullman (77, rt=2)**?
> **No: lo que la destraba es la consulta al buró.**
> **Cómo se vuelve a comprobar:** corré el flujo por API contra local tres veces, mismo comercio
> (`e9409aff`) y mismo monto (2.000.000), variando **sólo** el endpoint de datos personales —
> `phone/register` → `api/v2/onboarding/otp-auth/validate` (OTP `1111`) → el endpoint bajo prueba →
> `lenders-v2`; después mirá los `user_field_values` 29/87/160 del usuario.

Los tres resultados:

| camino | respuesta | campos EAV 29/87/160 | listado | rt=2 |
|---|---|---|---|---|
| **sin** guardar datos | — | ninguno | **6** | ✗ |
| **v2** `api/v2/onboarding/personal-info` | `OBV21001` ok | **ninguno** | **6** | ✗ |
| **v1** `api/onboarding/loan-application/personal-info` | *«laboral information obtained **via risk centrals**»* | **29=Empleado · 87=2320000 · 160=no** | **7** | ✓ |

**La causa es el buró, no el dato del comercio.** El v2 «recoge y persiste, y nada más» —su propio
docblock lo dice y explica por qué: el v1 corría la cascada AgilData → Mareigua y disparaba Experian
dentro de la misma llamada, así que llenar el formulario **compraba consultas de buró**, y con el
pipeline de KYC encendido se pagaban dos veces (run `01a036f7`: legacy compró Experian 22:29:11, el
pipeline lo recompró 22:29:52). En el camino nuevo la identidad la resuelve el pipeline, que es «el
dueño del orden, del control de frescura y **del dinero**».

**Consecuencia para el SDK, y es la decisión de producto de verdad:** las seis entidades externas salen
con celular + OTP y nada más. La del propio comercio —la única con capital del comercio y comisión de
CreditOp— exige **una consulta de buró que se paga por comprador que la dispare, califique o no**. No es
«¿pedimos datos o no?»: es **«¿pagamos buró dentro de la tienda, y con qué gatillo?»**.

⚠ Y ojo con el atajo: usar el **v1** desde el SDK para que aparezca la rt=2 vuelve a comprar el buró en
el lugar equivocado, que es exactamente lo que el v2 vino a arreglar.

**Cómo se midió** (reproducible): `phone/register` → `api/v2/.../otp-auth/validate` (OTP `1111` en local)
→ el endpoint de datos personales bajo prueba → `lenders-v2`, y después los `user_field_values`
29/87/160 en la base. Para el caso v2 hizo falta aplicar **temporalmente** la versión de `main` de
`StorePersonalInfoRequest.php` sobre el working tree (la rama `feat/lenders-tabla-cards` trae el
validador viejo con `$this` en un método `static`) y **restaurarla al terminar** — verificado: la rama
quedó en `4f9c9319` y el working tree limpio. Y el v1 exige **fecha de nacimiento**: sin ella devuelve
`ONB005`.

### Lo que el prototipo NO resuelve

- `auth.cognito` (`ResolveCognitoUser`) lee `x-user-id` / `x-cognito-identity-id` de headers y **nunca
  rechaza**; CORS es `allowed_origins: ['*']`. Hoy está contenido porque quien llama es el SSR del
  wizard, dentro del cluster. Un SDK publica ese contrato.
- No existe clave pública por comercio, ni allowlist de origen, ni rate limit por origen. Lo único hoy
  es el rate limit de personal-info (4/hora por documento).
- Los módulos del wizard **no son librerías**: `@creditop/lenders-marketplace` y
  `@creditop/loan-application-form` tienen `main: "./src/index.ts"` (TS crudo, sin `dist` ni `exports`)
  y declaran `react-router` como peerDependency. El único paquete con forma distribuible es
  `packages/form-engine` (tsup + `dist` + `exports`) — es el molde si se sigue por acá.
- Sería la **cuarta** superficie sobre el mismo contrato (G1 · G2 · G3 · SDK).


## Pendientes
- [ ] **Medir cuántos comercios ecommerce mapean el campo documento** (`allied_ecommerce_credentials` + los `ecommerce_requests.data` ya guardados). Es lo que decide si la experiencia sin fricción es real o es una demo: sin documento no hay identificación y la entidad del propio comercio no aparece.
- [ ] **Antes de cualquier piloto**: clave pública por comercio + allowlist de origen + rate limit por origen en `api/onboarding`. Hoy no hay nada de eso.
- [ ] **Decidir el gatillo del buró**: la oferta del propio comercio exige una consulta que se paga por comprador que la dispare, califique o no. No es «¿pedimos datos?».
- [ ] Renombrar CORE-543 en Jira, que sigue diciendo «Inicio paso refactor ecommerce» (`make jira-edit`). Lo decide Miguel: escribe hacia afuera.
