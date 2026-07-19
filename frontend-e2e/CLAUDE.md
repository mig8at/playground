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

## Dos caminos, una sola definición de "pasó"

- **Rápido** (`dev/sweep.ts`, o ⚡ en el panel): el flujo por API, sin navegador. Segundos. Modos
  `matrix` · `close` · `abaco`. **Exit code = veredicto**: `0` cerró · `1` desenlace malo o el front
  mintió · `2` quedó a mitad.
- **Visual** (`dev/guided.spec.ts`): el wizard real, con bypasses. Minutos.

Los dos usan **la misma** capa de aserción (`pkg/trace.ts`: traza contrastada + `veredicto()` +
`ESTADO_ESPERADO`). No dupliques esa lógica en ninguno de los dos — tener dos definiciones de "pasó" es
como empiezan a derivar, y ahí una divergencia deja de ser diagnóstico y pasa a ser ruido.

**Cómo leer una divergencia:** mismas aserciones, distinto transporte ⇒ si el rápido pasa y el visual
falla, el problema está en el **frontend**. **Pero no al revés:** hay bugs que solo existen en el visual
y el rápido nunca los va a ver — F-50 fue una cancelación disparada por el routing del wizard
(`request-canceled` cancela en el loader), con el backend haciendo todo bien. El rápido valida negocio
y backend; el visual valida el camino real del usuario, que también tiene lógica de negocio.

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
