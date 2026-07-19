# frontend-e2e · reglas de trabajo

Lo descriptivo (arquitectura, cadena panel → `bin/asesor` → spec, tabla de mocks, envs, Node 22.18+) vive
en `README.md`. Acá van **solo** las reglas que ya costaron tiempo.

## Cada corrida destruye la anterior — hacé la forense ANTES

`bin/asesor` arranca siempre con `scrubphone` (`bin/asesor:99`), que borra los users cliente del teléfono
de bypass **y sus `user_requests`**, con `FOREIGN_KEY_CHECKS=0` (`pkg/asesor.ts:178-197`). No hay undo.

- Si querés inspeccionar una corrida, consultala **antes** de lanzar la siguiente.
- Si `user_requests` te da vacío para un id que imprimió una corrida vieja, no concluyas "nunca existió":
  lo borró el scrub (F-52).
- `user_request_records` **no** está en `childTables` (`pkg/asesor.ts:17-24`) → sobrevive huérfano. Es lo
  único que permite reconstruir a posteriori; entrá por ahí.

## No le creas al verde

Hay **82 `.catch(() => {})`** en `dev/guided.spec.ts`. El único paso blindado es el salto a `/lenders`,
que distingue "ventana cerrada" y **tira** (`dev/guided.spec.ts:538-545`); el resto se traga el error.
`shot()` imprime `📸 <archivo>` aunque el screenshot haya fallado (`dev/guided.spec.ts:63-64`).

- Antes de dar una corrida por buena: mirá el **mtime** de `.auth/guided-*.png` y que estén las líneas
  `nav →` del log. "1 passed" no alcanza.
- Si escribís pasos nuevos, no envuelvas en `.catch` vacío el paso que le da sentido a la corrida (F-03).

## Mocks: arrancá a mano los que nadie levanta

- `bin/asesor` levanta `mock-preapprovals` siempre (`bin/asesor:120`) y, **solo con target `local`**,
  payvalida + mdm + lenders + forms (`bin/asesor:129-134`). `mock-redirect` lo levanta `bin/ecommerce`
  (`bin/asesor:56`). Contra `dev` no se levanta ninguno de esos cuatro.
- **`mock-abaco` y `mock-pdf-mapper` no los levanta nadie.** Si tu flujo toca Ábaco (renting Motai) o la
  vinculación de Credifamilia, corré `bin/mock-abaco start` / `bin/mock-pdf-mapper start` vos.

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
