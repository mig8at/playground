# frontend-e2e · reglas de trabajo

Lo descriptivo (arquitectura, cadena panel → `bin/asesor` → spec, tabla de mocks, envs, Node 22.18+) vive
en `README.md`. Acá van **solo** las reglas que ya costaron tiempo.

## Cada corrida destruye la anterior — hacé la forense ANTES

`bin/asesor` arranca siempre con `scrubphone` (`bin/asesor:99`), que borra los users cliente del teléfono
de bypass **y sus `user_requests`**, con `FOREIGN_KEY_CHECKS=0` (`pkg/asesor.ts:178-197`). No hay undo.

- Antes de borrar, el scrub **vuelca lo que está por perderse** a `.runs/ureq-<id>.json` (estado, lender,
  records). Si te falta una corrida vieja, entrá por ahí.
- Si `user_requests` te da vacío para un id que imprimió una corrida vieja, no concluyas "nunca existió":
  lo borró el scrub (F-52). Mirá `.runs/`.
- `user_request_records` **no** está en `childTables` (`pkg/asesor.ts:17-24`) → sobrevive huérfano. Es lo
  único que permite reconstruir a posteriori; entrá por ahí.

## No le creas al verde

Hay **82 `.catch(() => {})`** en `dev/guided.spec.ts`. El único paso blindado es el salto a `/lenders`,
que distingue "ventana cerrada" y **tira** (`dev/guided.spec.ts:538-545`); el resto se traga el error.
`shot()` imprime `📸 <archivo>` aunque el screenshot haya fallado (`dev/guided.spec.ts:63-64`).

- Cada navegación se imprime **contrastada con la BD** (`pkg/trace.ts`): a la izquierda dónde está el
  front, a la derecha el estado real de la solicitud, con `▲` cuando la BD se movió. El navegador muestra
  la *pretensión*; la BD, lo que pasó.
- El guiado cierra con **TRAZA CONTRASTADA** (transiciones + tramos ciegos + alertas) y un **VEREDICTO**.
  Falla si la solicitud terminó Cancelada/Negada sin pedirlo, **o si el front mostró una pantalla de
  éxito con la BD sin sellar** (el patrón exacto de F-50). Leé ese bloque, no el "1 passed".
- Un **tramo ciego** largo (muchas pantallas sin una sola transición) es la firma de un flujo que avanza
  en pantalla sin persistir: la traza lo señala solo.
- Si escribís pasos nuevos, no envuelvas en `.catch` vacío el paso que le da sentido a la corrida (F-03).

## Mocks: arrancá a mano los que nadie levanta

- `bin/asesor` levanta `mock-preapprovals` siempre (`bin/asesor:120`) y, **solo con target `local`**,
  payvalida + mdm + lenders + forms + **ábaco** (`bin/asesor:129-137`). `mock-redirect` lo levanta
  `bin/ecommerce` (`bin/asesor:56`). Contra `dev` no se levanta ninguno de esos cinco.
- **`mock-pdf-mapper` no lo levanta nadie.** Si tu flujo toca la vinculación de Credifamilia, corré
  `bin/mock-pdf-mapper start` vos.

## Dos caminos, y cada uno tiene su dueño

- **Rápido — es TU camino (el del agente), por CLI.** `dev/sweep.ts`: el flujo por API, sin navegador.
  Segundos. Modos `matrix` · `close` · `abaco`. **Exit code = veredicto**: `0` cerró · `1` desenlace malo
  o el front mintió · `2` quedó a mitad. Usalo para analizar contra BD y backend mockeado.
- **Visual — es el camino de MIGUEL, por el panel** (`npm run dev`). `dev/guided.spec.ts`: el wizard
  real con bypasses. Sirve para lo que un mock no puede dar: interactividad, render, comportamiento del
  front.

**No metas el modo rápido en el panel.** Ya se intentó y se revirtió: el panel existe para probar el
FRONTEND a mano; el rápido es una herramienta de análisis por consola. Mezclarlos confunde para qué
sirve cada uno. Si necesitás correr el rápido, es `node dev/sweep.ts …`, no un botón.

Los dos usan **la misma** capa de aserción (`pkg/trace.ts`: traza contrastada + `veredicto()` +
`ESTADO_ESPERADO`). No dupliques esa lógica en ninguno de los dos — tener dos definiciones de "pasó" es
como empiezan a derivar, y ahí una divergencia deja de ser diagnóstico y pasa a ser ruido.

**Cómo leer una divergencia:** mismas aserciones, distinto transporte ⇒ si el rápido pasa y el visual
falla, el problema está en el **frontend**. **Pero no al revés:** hay bugs que solo existen en el visual
y el rápido nunca los va a ver — F-50 fue una cancelación disparada por el routing del wizard
(`request-canceled` cancela en el loader), con el backend haciendo todo bien. El rápido valida negocio
y backend; el visual valida el camino real del usuario, que también tiene lógica de negocio.

## El recorrido del wizard en el panel (`panel/steps.json`)

Canvas SVG **vertical** y arrastrable (drag · rueda = zoom · doble clic = encuadrar), estilo grafo de
git: tronco común hasta `/lenders` y de ahí un carril por `response_type`. Dibuja **solo los carriles
que ese comercio tiene y con entidades PRENDIDAS** (mira `rt` + `lender_status`). El hover de cada nodo
lista los archivos del paso.

**Por qué vertical y no horizontal** (ya se probó y se revirtió): en horizontal la bifurcación cae al
final del tronco y los carriles arrancan al principio, así que la curva de unión vuelve cruzando todo el
diagrama. Medido: bifurcación en x=456, carril de 8 nodos ≈900px, contenedor 1238 → no entra. Girando el
eje, el largo se gasta en alto (que se recorre arrastrando) y la curva queda corta.

**Por qué sin librería de grafos** (D3 / vis-network se evaluaron): son ~20 nodos en carriles paralelos,
o sea posiciones que ya conocemos — un motor de layout no tiene nada que resolver. El criterio: *¿puedo
ubicar los nodos a mano sin que se crucen las aristas?* Si sí, CSS/SVG. Donde **sí** habría un grafo real
es el árbol de `context`: 33 nodos, 342 archivos compartidos, 1.578 aristas implícitas.

- **Qué cuenta como archivo del paso** (respetalo si lo editás): la ruta del front + los servicios que su
  loader/action invoca, y el controlador del endpoint + los servicios de dominio que llama. **No** utils,
  ni tipos, ni cierre transitivo de imports. Si el número no significa "lo que este paso toca de verdad",
  es decoración con cara de dato.
- **Validá siempre después de tocarlo:** `node bin/steps-check.ts` (sale ≠0 si alguna ruta no existe). El
  panel además muestra un aviso si el chequeo falla — un conteo que ya no resuelve es peor que nada.

## Canal de entrada: asesor · ecommerce

El panel tiene un selector de **canal** (junto al del buró). Cambia la PUERTA, no el caso: el usuario
sintético es el mismo y viaja **adentro** de la URL base64, así podés correr la misma identidad entrando
por asesor y por tienda y comparar.

- `asesor` → `bin/asesor`, login Cognito, wizard en `/merchant`.
- `ecommerce` → `bin/ecommerce` + `E2E_ENTRY=ecommerce`; el spec arma la URL con `pkg/checkout-b64.ts`.

⚠ **Hoy el canal ecommerce NO cierra un crédito CreditopX.** Aterriza en `resolve-ecommerce-flow`, que es
el resolvedor de **Bancolombia**, y para un comercio CreditopX el flowType sale `no_preapproved` y su
loader **cancela** (F-54). Sirve para ejercitar el contrato base64 —que funciona y crea la solicitud—, no
para llegar a Aprobado. Falta portar la landing genérica (`checkout-redirection.tsx`), que vive solo en
`feat/ecommerce-checkout-integration`.

La fuente autoritativa del contrato es el plugin real: `playground/creditop-woocommerce`
(`class-creditop-gateway.php:470-512`). Está reconciliado en la cabecera de `pkg/checkout-b64.ts`.

## Reglas sueltas

- **No corras `npm test` pelado**: colecta 98 tests en 35 archivos e incluye `dev/guided.spec.ts`, que es
  interactivo (`testIgnore` solo saca `_scratch/` y los reportes — `playwright.config.ts:28`). Pasá rutas.
- **En toda llamada por API mandá `x-cognito-identity-id`**: sin ese header `update-user-request` pone
  `corporate_user_id = NULL` y te borra el asesor de la solicitud en silencio (F-46).
- **No inviertas en el eje ecommerce**: no hay ruta `checkout` en `apps/loan-request-wizard/app/routes.ts`
  (verificado; lo único con ese nombre es `bancolombia/cancel-checkout:164`) → `bin/ecommerce` y
  `channel/ecommerce-*.spec.ts` dan 404 (F-40).
- El panel lanza `bin/asesor <slug>` **sin `auto`** (`panel/server.ts:153`) → siempre modo manual. El
  guiado es solo por terminal, y ahí el **comercio va primero**: `bin/asesor <comercio> auto`.
- Si matás `bin/asesor` con `kill -9`, verificá que el wizard recuperó su `.env.local`: queda en
  `.env.local.asesor-bak` y solo lo restaura el `trap EXIT` (`bin/asesor:198-201`).
