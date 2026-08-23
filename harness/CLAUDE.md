# harness · reglas de trabajo

> **Para qué existe:** es **la herramienta con la que se valida una tarea contra el código real.** No es
> contexto (eso es `context/`) ni el trabajo en sí (eso es `tablero/`): es lo que se usa para **comprobar
> corriendo** lo que en los otros dos está escrito. Si una afirmación se puede verificar acá, verificala
> antes de escribirla como cierta en un nodo.

Lo descriptivo (arquitectura en detalle, envs, Node 22.18+) vive en `README.md`. Acá van las **reglas
que ya costaron tiempo** — y el mapa mínimo para no perderse.

## Cómo está construido (7 capas, y cada una tiene un trabajo)

| Capa | Qué es | Cuándo la tocás |
|---|---|---|
| `panel/` | La UI del harness (`npm run dev` → **:5195**). Es una cáscara sobre `bin/asesor`, no un segundo motor. | Camino visual: lo maneja Miguel |
| `bin/` | **Plumbing**: launchers (`asesor` · `ecommerce` · `qr` · `panel`), los 11 `mock-*` y utilidades (`dbops.ts` · `envget.ts` · `steps-check.ts` · `preflight.ts`) | Casi nunca directo — el panel los llama |
| `dev/` | **Herramientas por consola**, una por pregunta (abajo) | Camino rápido: es TU camino |
| `pkg/` | La **librería compartida** (25 módulos): `trace.ts` (aserciones) · `db.ts` · `inject.ts` · `cognito.ts` · `qr.ts`+`qr-steps.ts` · `checkout-b64.ts` · `wizard-steps.ts` · `windows.ts` · … | Al agregar capacidad, va acá — no duplicada en dos runners |
| `mock-*/` | **la flota de mocks con launcher** (la tabla de puertos, abajo) + 2 páginas estáticas (`mock-bank/`, `mock-store/`, sin launcher: las sirve el spec) | Cuando el proveedor externo estorba |
| `channel/` | **13 suites de caracterización** (`*.spec.ts`): congelan el comportamiento ACTUAL | Antes de cambiar algo, para tener red |
| `.runs/` · `.auth/` | Forense de la última corrida (volcados, screenshots) | Cuando algo falló y hay que reconstruir |

**La cadena del camino visual:** panel (:5195) → `bin/asesor <comercio>` → `dev/guided.spec.ts`
(Playwright) → wizard real (:5174) → backend del target.

**Los mocks y sus puertos** (el launcher es `bin/<nombre>`):

| | | | |
|---|---|---|---|
| `mock-preapprovals` :8095 | `mock-redirect` :8096 | `mock-payvalida` :8097 | `mock-mdm` :8098 |
| `mock-lenders` :8099 | `mock-pdf-mapper` :8100 | `mock-forms` :8101 | `mock-abaco` :8102 |
| `mock-corbeta` :8103 | `mock-bancolombia` :8104 | `mock-financial-health` :4000 | `mock-centrales` :8105 |
| `mock-deceval` :8106 | `mock-netco` :8107 | | |

**Las herramientas de consola, por la pregunta que contestan:**

| Comando | Contesta |
|---|---|
| `dev/sweep.ts` | ¿qué desenlace da cada comercio × entidad? (modos `matrix` · `close` · `abaco`) |
| `dev/qr-corbeta.ts` | ¿el canal QR cierra en estado 25 con código? (por API, sin browser) |
| `dev/caminar-qr.ts` | ¿qué pantallas existen de verdad y en qué orden? (clickea solo) |
| `dev/contrato-bancolombia.ts` | ¿el mock cumple los esquemas zod del front? (`npm run contrato:bancolombia`) |
| `dev/sandbox-bancolombia.ts` | **¿el BANCO DE VERDAD acepta lo que mandamos?** el único que pega contra el gateway real (`make harness-sandbox`) |
| `dev/experian-check.ts` · `experian-api.ts` | ¿esta solicitud omitió el buró, y se puede *afirmar*? |
| `dev/loki-trace.ts` | ¿POR QUÉ terminó así? forense en los logs (`make harness-loki UREQ=…`) |
| `dev/pantallas.ts` | **¿por qué PANTALLAS habría pasado el cliente?** el recorrido del wizard derivado del router en `main`, y al revés: `ENDPOINT=confirm-payment-schedule` → qué pantalla es (`make harness-pantallas`) |

### El eje que las corridas por API no cubren: qué VEÍA el cliente

`caso.ts` va por API y no abre el navegador — por eso es rápido y paralelizable. Lo que pierde es la
pantalla: una corrida dice «HTTP 500 en `confirm-payment-schedule`» y nadie sabe dónde habría estado
parado el cliente, que es lo que preguntan producto, soporte y QA.

`make harness-pantallas ENDPOINT=<endpoint>` contesta eso **sin integrar nada**: no maneja el navegador,
no corre nada, no valida. Deriva el recorrido de `apps/loan-request-wizard/app/routes.ts` en `main` —el
router mismo—, así que una pantalla nueva aparece sola y una borrada desaparece sola.

⚠ **Es un techo, no una traza.** Dice qué PUEDE llamar cada pantalla, no qué llamó en tu corrida: sale
de lo que la pantalla importa. La salida distingue los dos niveles —`→` lo llama esa pantalla, `·` está
en un paquete que importa— y no hay que leerlos igual.

## Cuándo cargar una skill

Lo profundo por canal vive en skills, y se carga solo cuando hace falta:

| Skill | Cargala cuando |
|---|---|
| `harness-canal-qr` | trabajés el canal QR / Corbeta / Bancolombia (el más grande: mocks del banco, contrato zod, las 9–10 pantallas) |
| `harness-panel` | toques el panel: el mapa del recorrido, `CAPS`, el selector de comercio, el switch de front/Cognito, `dbops activity` |
| `harness-canal-ecommerce` | trabajés la entrada por tienda (URL base64) y su techo actual |

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

Hay **94 `.catch(() => {})`** en `dev/guided.spec.ts` (medido el 2026-07-31; eran 82 y el spec creció —
si el número te importa, contalo: `grep -c 'catch(() => {})' dev/guided.spec.ts`). El único paso blindado
es el salto a `/lenders`,
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

## Dos caminos, y cada uno tiene su dueño

- **Rápido — es TU camino (el del agente), por CLI.** `dev/sweep.ts`: el flujo por API, sin navegador.
  Segundos. Modos `matrix` · `close` · `abaco`. **Exit code = veredicto**: `0` cerró · `1` desenlace malo
  o el front mintió · `2` quedó a mitad. Usalo para analizar contra BD y backend mockeado.
- **Visual — es el camino de MIGUEL, por el panel** (`npm run dev`). `dev/guided.spec.ts`: el wizard
  real con bypasses. Sirve para lo que un mock no puede dar: interactividad, render, comportamiento del
  front.
- **Forense — `dev/experian-check.ts`.** Después de una corrida: ¿esta solicitud omitió Experian, y se
  puede *afirmar*? "No hay fila de buró nueva" tiene **tres** causas distintas (flujo firmado · la
  compuerta de frecuencia cortó antes · caché de 1 mes), y hay que descartar dos para creerle a la
  tercera. Mismo contrato que el rápido: **exit code = veredicto** (`0` probada · `1` sí se consultó ·
  `2` no concluyente). Detalle en F-60.

- **Forense de logs — `dev/loki-trace.ts` (`pkg/loki.ts`).** Después de una corrida: ¿por qué terminó
  así? La BD dice el desenlace, los logs dicen la causa — una regla que excluyó un lender **no mueve
  ningún estado**, así que es invisible para la traza contrastada. Colapsa la solicitud a un resumen
  (fallas deduplicadas con `×N`, una fila por entidad evaluada con su regla y veredicto, el recorrido del
  backend, y los silencios entre peticiones) y vuelca todo a `.runs/forense-<ureq>/`.
  **Se dispara solo** al cerrar los dos runners (`forenseAlCerrar`), y **solo si el veredicto salió mal o
  a mitad**: si cerró como se pedía no consulta nada (0 ms). En `guided.spec.ts` va **antes** de los
  `expect` a propósito — `expect` lanza, así que puesto después no correría nunca justo en los fallos que
  vino a explicar. Espera `E2E_LOKI_SETTLE_MS` antes de preguntar (el batch de `LokiHandler` flushea al
  morir el proceso) y se traga cualquier error: un forense que tumba la corrida que venía a explicar es
  peor que no tenerlo.
  ⚠ **NO es una fuente de aserción y no debe entrar en `veredicto()`**: la ausencia de una línea tiene
  cuatro causas indistinguibles (no se logueó · el level la filtró · el batch no hizo flush · lag de
  ingesta). Su exit code dice si se pudo *mirar*, no si el negocio pasó — nunca devuelve 1.
  ⚠ Solo ve **legacy-backend**: el `trace_id` no se propaga entre servicios (los Go no lo emiten), y solo
  encuentra traces que traigan el uReq en su `context` (~8% de las líneas ancla el resto). Lo declara al
  imprimir; leé ese bloque antes de concluir de una ausencia.
  **Tres modos, los elige solo y los anuncia:** *completo* (ancla + expande por trace) · *degradado* (hay
  ancla, no hay trace) · *ventana* (no hay ancla: todo lo de la ventana, **solo con Loki local**, atado a
  la URL y no a una perilla — contra uno compartido serían corridas ajenas).

**Observabilidad en local: `make harness-obs-up`** (Loki + Tempo **reales** en Docker — un mock
obligaría a reimplementar LogQL). La receta completa del `.env` del backend está en `README.md`
§Observabilidad. La trampa que no perdona: **`LOG_CHANNEL=loki`, no `stack`** — `stack` incluye
`dynamodb` con `ignore_exceptions => false` y sin credenciales de AWS la excepción **rompe el request**.

⚠ **NO apuntes el target `local` al Loki de dev.** Con la BD funciona (leés las filas que tu corrida
escribió); con Loki no, porque tu corrida local no escribió allá: leerías la corrida de otro cuyo
`user_request_id` coincide — y coincide, la BD local es un dump de dev y los id avanzan en el mismo rango
(2026-08-04: local 464664, dev 464620). `pkg/loki.ts:porQueNo` lo **bloquea**.

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

⚠ **Y hay un tercer eje que ninguno de los dos cubre:** los **esquemas zod del front**. El runner por
consola pega contra el backend, que es más laxo, así que puede estar **verde con el recorrido visual
roto** (F-88). Si trabajás Bancolombia, cargá `harness-canal-qr` y corré `npm run contrato:bancolombia`.

## Mocks: arrancá a mano los que nadie levanta

- `bin/asesor` levanta `mock-preapprovals` siempre (`bin/asesor:120`) y, **solo con target `local`**,
  payvalida + mdm + lenders + forms + **ábaco** + **financial-health** (`bin/asesor:189-199`).
  `mock-redirect` lo levanta `bin/ecommerce` (`bin/asesor:56`). Contra `dev` no se levanta ninguno de
  esos seis. `mock-financial-health` es distinto al resto: **no inventa datos** — lee el usuario
  sintético REAL de la BD local (por eso ocupa el `:4000` que el `.env` del wizard ya apunta). Ver F-70.
- **Los tres de Credifamilia no los levanta nadie.** Si tu flujo toca rt=4, corré vos
  `bin/mock-pdf-mapper start` (:8100, la vinculación), `bin/mock-deceval start` (:8106, el pagaré) y
  `bin/mock-netco start` (:8107, la firma). Faltando cualquiera, la solicitud queda en **estado 28** con
  un mensaje que habla del proveedor y no del mock (F-165). `dev/caso.ts` ya avisa en el prevuelo cuando
  el caso va a cerrar; el resto de los runners todavía no.
- **Si editás un mock, asegurate de que el proceso que corre sea ese código** (F-87). Node no recarga el
  módulo: `start` veía el puerto respondiendo y salía con `✓ ya arriba`, sirviendo la versión anterior — el
  arreglo no se aplicaba y **nada lo avisaba**. `mock-bancolombia` y `mock-corbeta` ya lo resuelven solos:
  publican en `GET /` la huella `codigo` (mtime de su `server.mjs`) y su launcher reinicia si difiere. Los
  otros mocks **todavía no**: ahí reiniciá a mano (`bin/<mock> stop && bin/<mock> start`). Y cuando un
  arreglo "no hace nada", la primera pregunta es si lo que corre es lo que editaste.

## Qué es real en cada target

**La regla del harness: `local` mockea, `dev` y `staging` prueban contra lo real.** Si en dev algo sale
por un mock, dev deja de ser representativo y la prueba no vale.

| | `local` | `dev` | `staging` | `qa` |
|---|---|---|---|---|
| pre-aprobaciones | mock `:8095` | **MS real** `pre-approvals-service…:8082` | MS real | MS real |
| payvalida · mdm · lenders · forms · ábaco | mocks | reales | reales | reales |
| backend (rama que sirve) | local (sail/Docker) | `legacy-backend` → **develop** | `legacy-backend-stg` → **staging** | `legacy-backend-qa` → **qa** |
| BD | local (sail/Docker) | dev real (compartida) | **la misma de dev** | **la misma de dev** |
| front | local `:5174` | local `:5174` | **desplegado** (`originaciones-stg`) | **desplegado** (`originaciones-qa`) |

⚠ Hasta el 2026-08-19, `.env.staging` apuntaba a **qa** (backend `-qa` + `originaciones-qa`) y el
target `staging` medía la rama equivocada. Se partió en dos: `.env.staging` (ahora sí `legacy-backend-stg`
+ `originaciones-stg`) y `.env.qa` (lo que el archivo viejo siempre fue). Para saber qué rama tenés
enfrente sin adivinar: `allowed_document_types` en `GET /api/loans/allied/{hash}` **solo** lo trae `qa`.

⚠ **`dev` y `staging` NO son el mismo backend, aunque el cluster se llame igual.** En `inertia-develop`
conviven **dos servicios**: `legacy-backend` (sirve la rama `develop`, workflow `main-dev.yaml`) y
`legacy-backend-qa` (sirve **`qa`**, workflow `main-qa.yaml`). La **BD sí es compartida**, así que un dato
sembrado se ve desde los dos y todo *parece* consistente — lo que cambia es **qué código responde**.
Confundirlos hace medir la rama equivocada: probando Ábaco contra `legacy-backend` (develop) daba
`MOTV1000` porque esa rama todavía decide por los modos deprecados, y se leía como "el feature está roto"
cuando en `qa` respondía `MOTV1001`. Para saber qué rama tenés enfrente, pedí un campo que solo exista en
una: `GET /api/loans/allied/{hash}` trae `allowed_document_types` solo con motai-v2 (o sea, solo en `qa`).

## Reglas sueltas

- **No corras `npm test` pelado**: colecta 98 tests en 35 archivos e incluye `dev/guided.spec.ts`, que es
  interactivo (`testIgnore` solo saca `_scratch/` y los reportes — `playwright.config.ts:28`). Pasá rutas.
- **En toda llamada por API mandá `x-cognito-identity-id`**: sin ese header `update-user-request` pone
  `corporate_user_id = NULL` y te borra el asesor de la solicitud en silencio (F-46).
- **El scrub por consola va con `E2E_TARGET=local` EXPLÍCITO** en el env del hijo: `bin/dbops.ts` es otro
  proceso, su default es **dev**, y ahí el guard de escrituras compartidas lo bloquea (F-53) sin que se note.
- El panel lanza `bin/asesor <slug>` **sin `auto`** (`panel/server.ts:153`) → siempre modo manual. El
  guiado es solo por terminal, y ahí el **comercio va primero**: `bin/asesor <comercio> auto`.
- Si matás `bin/asesor` con `kill -9`, verificá que el wizard recuperó su `.env.local`: queda en
  `.env.local.asesor-bak` y solo lo restaura el `trap EXIT` (`bin/asesor:198-201`).
- **No te quedes con el puerto del panel (:5195).** Si dejás una instancia tuya corriendo, el
  `npm run dev` de Miguel no arranca. Ya pasó dos veces: levantalo solo si lo vas a usar, y bajalo.
- **El wizard local no arranca sin instalar el monorepo con pnpm.** Da
  `Cannot find module '@radix-ui/react-collapsible'` (declarado en `packages/ui/package.json` y en el
  lock, pero no materializado). ⚠ El monorepo usa **pnpm** (hay `node_modules/.pnpm`): un `npm install`
  falla con `Cannot read properties of null (reading 'name')` — sin tocar el lock, pero sin instalar nada.
  Es `pnpm install` en la raíz del monorepo.
