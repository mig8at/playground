# El salto headless a `/lenders` en staging — RESUELTO (rebote + `/solicitar`)

Estado al 2026-07-22. **Cerrado.** El síntoma original (**no llegaba a `/lenders`**) y el paso por
`/solicitar` durante el login están resueltos y verificados. La causa raíz completa vive en **F-66**
(findings); esto es el resumen junto al harness. Se conserva porque el diagnóstico previo apuntó dos veces a
la hipótesis equivocada (el build de staging; luego "el cache no retiene la sesión") y vale dejar por qué.

## El síntoma (era)

Con **"Saltar a: Lenders"** contra `staging`, el wizard quedaba en `/merchant/<hash>/solicitar` en vez de
abrir el listado. El harness lo reportaba como *"el front rebotó la solicitud sembrada — su estado no pasa
el guard de /lenders"*. En `local` el mismo salto **sí** funcionaba.

## La causa raíz (verificada): no era el front, era una carrera post-login del harness

- **No es el build de staging** (era la hipótesis principal del pendiente): `git -C frontend-monorepo diff
  HEAD origin/staging` de `routes.ts`, `available-lenders.tsx`, `default-layout.tsx` y `auth/callback.tsx`
  da **vacío**. El flujo de `/lenders` es idéntico. `origin/staging` (`e896abaf`) ya incluye la feature #719.
- **No es el estado de la solicitud.** Ningún loader de `/merchant/:hash/:ur/lenders` mira
  `user_request_status_id`: `default-layout` solo rebota si la sucursal del asesor ≠ el hash de la URL (acá
  coinciden), y `available-lenders` no tiene `redirect` en su loader. El estado 9 nunca fue el problema.
- **Era una carrera post-login.** `cognitoLogin` volvía apenas la URL tocaba el host de la app —una ruta de
  tránsito (`/auth/callback` → `/merchant` → `/solicitar`), **antes** de asentar la sesión—, y el segundo
  `goto` a `/lenders` competía con esa cadena en vuelo. Con `.catch(() => {})`, el goto se abortaba y
  quedabas en `/solicitar`. **El server nunca rebotó `/lenders`**: en el log no hay ningún
  `↪ …/lenders → …/solicitar`, solo el aterrizaje normal del callback. En local no pasa porque la sesión
  está cacheada y el único `goto` va directo.

## El arreglo — parte 1: llegar a `/lenders` (VERIFICADO en vivo)

- `pkg/cognito.ts` — tras el submit, espera a **salir de las rutas de tránsito** (`AUTH_TRANSIT`) y a
  `networkidle` antes de volver, para no dejar redirects en vuelo.
- `dev/guided.spec.ts` (`DIRECT_LENDERS`) — login y salto separados; el `goto` a `/lenders` va **después**,
  con reintento (hasta 3) esperando un destino real.
- Aviso honesto: `lendersBounced` distingue "el front lo rechazó" de "el salto ni se pidió".

Corrida 2026-07-22 (uReq 464365): `entrada DIRECTA → /merchant/76db47f5/464365/lenders`. ✅

## El paso por `/solicitar` (cuando hay login) y el arreglo — parte 2

El aterrizaje post-login es `/solicitar` por el **front**: `routes/auth/callback.tsx` hace
`redirectTo || "/merchant"`, pero Cognito manda el destino en el `state`, no en un query `redirectTo` → el
deep-link a `/lenders` se pierde y cae en `/merchant → /solicitar`. La única vía harness-side de no verlo es
**no loguear**: reusar la sesión cacheada.

Y acá hubo un segundo diagnóstico equivocado: parecía que el cache **no retenía la sesión** (no aparecía
`__session`). En realidad **el deploy de staging llama a esa cookie `_session`** (un guión, `@.creditop.com`),
no `__session` (el nombre del build local, host-only). El cache SÍ la guardaba; se buscaba el nombre equivocado.

Arreglo (parte 2, aplicado y verificado):

- `pkg/cognito.ts::persistCognitoState()` — da `expires` a las *session cookies* y re-persiste el cache; el
  guiado lo re-guarda **ya en `/lenders`**. El cache queda con `_session`.
- `dev/warm-session.spec.ts` — **pre-login headless** (`cognitoLogin` + `persistCognitoState`), sin correr un
  flujo. Correlo una vez cuando el token caducó.
- `bin/session-check.ts` — chequeo REAL por target: pega a `/merchant` del front con las cookies del cache y
  mira si rebota a Cognito. **No mira el nombre de la cookie** — la verdad es si el front deja pasar.
- **Panel** — dot verde/gris en cada botón de ambiente (`GET /api/session-status`); clic en el gris dispara el
  pre-login headless con un loader (`POST /api/session-refresh`).

## Cómo se usa

1. **Al abrir el panel se precargan los 3 tokens**: chequea los 3 ambientes (fetch real) y autentica
   headless —sin ventana— los que estén sin token. El dot lo muestra: **verde** = válido (las corridas
   arrancan sin loguear ni pasar por `/solicitar`) · **ámbar pulsante** = autenticando · **gris** =
   caducó/no existe (clic = autenticar) o front caído (local/dev sin `:5174`; no bloquea).
2. **"Preparar + Lanzar" espera al token**: deshabilitado con "obteniendo token…" mientras se autentica el
   target activo, y con "sin token" si falta (el dot gris es el botón de autenticar). Verde → habilitado.
3. Con el dot verde, "Saltar a: Lenders" entra **directo** al marketplace. La sesión dura la ventana del
   refresh token (días).

⚠ **El desvío "staging necesita headed" fue un diagnóstico FALSO** (quedó revertido): el warm nunca esperaba
el login — el regex del host matcheaba el `redirect_uri` del query en la propia página del password y todo
retornaba a los 0s con el auth en vuelo (de ahí el "colgado", el loop de Cognito visible y las cookies
`oauth2:*` acumuladas). Arreglado comparando `url.host` (pkg/cognito.ts), staging completa **headless en
~29s**. Detalle completo y lección en **F-66**.

Verificado (2026-07-22): warm headless staging → `WARM_OK` + `_session` en el cache → `session-check` =
`valid` → dot verde; gating del botón verificado en sus tres estados. Nota: local/dev necesitan el `:5174`
arriba para el pre-login y el chequeo (staging es el deploy, siempre disponible).

## Contexto relacionado

- **F-66** — el detalle canónico de esto.
- **F-65** — el seed registraba contra el backend local aunque el target fuera dev (lo previo del salto).
- **F-58** — el rechazo de la firma viaja en HTTP 200; el harness mira el `code`, no el status.
- El recorte a `response_type = 0` con `flow_id = 2` deja el marketplace **vacío** en comercios sin
  entidades rt=0 (Pullman en local). No es un bug: consecuencia de negocio a confirmar con producto.
