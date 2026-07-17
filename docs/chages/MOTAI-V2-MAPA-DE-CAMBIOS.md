# Motai v2 — mapa de cambios (qué hicimos, por qué, y cómo ajustar)

> **Mapa consolidado y vigente** · actualizado 2026-07-17 · ramas `feature/motai-v2` en `legacy-backend` + `frontend-monorepo`.
> Objetivo del doc: dejar claro **todo lo que se cambió, por qué**, y **dónde tocar si hay que ajustar algo**. El registro puntual de la des-motaización inicial (Jul-15) vive en [MOTAI-V2-DES-MOTAIZACION-EJECUTADA.md](MOTAI-V2-DES-MOTAIZACION-EJECUTADA.md); este doc lo **supera** e incorpora lo que vino después (TyC por comercio, recálculo de monto, y la remoción del flag Ábaco).

---

## 0. La idea de fondo

**Des-motaizar** = sacar del código la lógica quemada específica de Motai (id `158`, `isMotaiRenting`, `merchant_mode`/modos) y moverla a **config por columna en BD**, para que Motai deje de ser un flujo especial y pase por el **flujo normal** de cualquier solicitud. Dar de alta otra entidad renting/RTO debe ser **filas de config**, no `if id == N` ni deploy de fórmulas.

---

## 1. Estado de las ramas y PRs

| Repo | Rama | PR apunta a | Estado |
|---|---|---|---|
| `legacy-backend` | `feature/motai-v2` | **`develop`** (retargeteado, ver §8) | pusheado |
| `frontend-monorepo` | `feature/motai-v2` | **`staging`** (sin retargetear) | pusheado |

**Commits nuestros (backend, PR→develop):** `936f0a7c` des-motaización · `44eb3c02` merge develop (resolución de conflictos del retarget) · `32cd4203` TyC por comercio · `098322a8` fix `$hasCredifamilia` · `4022b6c9` fix ProfilerML · `607fd2b0` recálculo liviano · `5013f4af` quitar columna `abaco`.

**Commits nuestros (frontend, PR→staging):** `653e7939` des-motaización front · `15f3b3e9` TyC front · `6708ea5b` recálculo liviano front.

> El diff del PR de backend vs develop muestra ~52 archivos: eso incluye **ruido heredado** de la divergencia staging↔develop (ver §8), no todo es nuestro. Nuestros cambios reales son los de los commits de arriba.

---

## 2. Frente 1 — Des-hardcode del Motai distribuido (front + back)

**Qué.** Se eliminó end-to-end (`0` referencias verificadas por grep en ambos repos): `isMotaiRenting` / `is_motai_renting`, `merchant_mode` / `merchantMode`, `MOTAI_LENDER_IDS`, y el id `158` usado como **lógica**.

**Por qué.** Motai era un flujo bifurcado: el flag viajaba en cada payload (teléfono/OTP/personal-info) y el backend bypasseaba pasos (saltaba risk-centrals, forzaba `corbeta=false`, TyC especial) mientras el front calculaba precio con fórmula quemada gateada por id. Imposible de escalar a otra entidad sin tocar código.

**Dónde vive ahora (config):**
| Comportamiento | Antes (hardcode) | Ahora (config) |
|---|---|---|
| Card renting + skips (cuota inicial, OTP bancario) | `MOTAI_LENDER_IDS.includes(158)` | `lenders.product` (`credit` \| `renting` \| `rto`) |
| Precio / valor a financiar | fórmula quemada en el front | `lenders.calculator` (json) evaluado en backend (§4) |
| Tipo de documento PEP | `merchantMode === 'motai-renting'` | `lenders_by_allied_branches.document_types` |
| Salto de buró | flag `isMotaiRenting` en OTP | bypass por documento `PEP` en personal-info (ya existía) |

**Cómo ajustar.** Para que una entidad muestre el card renting/rto: setear `lenders.product`. No hay `if` que tocar.

---

## 3. Frente 2 — Matar la lógica de "modes"

**Qué.** Deprecadas (en código) las tablas `allied_modes` / `user_request_modes`. Borrados 6 archivos (modelos `AlliedMode`/`UserRequestMode`, repos, interfaces, bindings) + `AlliedModeLenderFilterService` + la página de modos del front (`merchant-mode.tsx`, story, `motai-bg.png`, `route("modes")`).

**Por qué (el punto clave).** Los modos eran la raíz de gran parte del código quemado y de una **inconsistencia de flujo**: el usuario **pre-seleccionaba** en la página de modos si era "motai-renting" u otro, ese modo viajaba en `session`, y al llegar a `/lenders` había lógica (`AlliedModeLenderFilterService`) que **re-decidía/filtraba según el modo ya elegido** → rompía el flujo normal (una decisión tomada antes contaminaba el listado). Sin modos, `/lenders` decide como para cualquier solicitud y el "qué producto es" vive en el lender (`product`), no en una elección previa.

**Dónde.** `OnboardingController` (sin `attachMotaiRentingModeIfNeeded`), `LenderRetrievalService`/`LenderListingService` (el filtro por modo → passthrough), `RegisterCellPhoneService` (sin `partner_modes` en la respuesta del comercio).

**Cómo ajustar.** Las **tablas** `allied_modes`/`user_request_modes` siguen en BD (el código ya no las toca). Drop físico = migración aparte revisada (BD compartida con `application`) → ver §7 pendientes.

---

## 4. Frente 3 — Calculadora renting/rto en BD (no en código)

**Qué.** Dos columnas nuevas + un evaluador de fórmulas en backend:
- `lenders.product` (default `credit`): categoría; define si el front muestra la calculadora.
- `lenders.calculator` (json, nullable = identidad): la **fórmula propia** de cada lender.
- `app/Support/FormulaCalculator.php`: evalúa el json de forma **segura** (`symfony/expression-language`, sin `eval`, con `guard()` — solo aritmética escalar). `LenderListingService::attachCalculatedFields` → `buildCalculated()` corre el calculator por lender y adjunta `calculated` a cada uno del listado.

**Por qué.** Que los cálculos vivan en **datos**, no en código pensado para soportar la lógica de un tercero. Otra entidad = otra fila `calculator`, sin deploy.

**Formato del `calculator` (final):**
```json
{
  "params":  { "setup_fee": 1500000, "margin": 1.0, "tax": 0.19, "weekly_rate": 0.01206 },
  "formulas": {
    "amount":  "(amount + setup_fee) * (1 + margin) * (1 + tax)",
    "payment": "amount * weekly_rate * factor"
  },
  "plans": [ { "id": "mensual", "label": "Mensual", "factor": 1.0, "default": true } ]
}
```
`buildCalculated` corre `formulas` en orden (encadenable: `payment` usa el `amount` ya calculado) una vez por fila de `plans` (renting) o `terms` (rto), inyectando `factor`/`weeks`. Devuelve `calculated = { amount, plans:[{...,payment}], payment_unit, default_plan }`.

**Front.** `RentingLenderCardContent` **solo lee** `calculated` (`amount`, `plans`, `default_plan`, `payment_unit`) — elegir un plan cambia qué fila muestra, **no recalcula ni llama al backend**. Se borró el hardcode `getMotaiTotalAmount` / `RENTING_PLANS`.

**Cómo ajustar.**
- Cambiar el monto financiado o la cuota → editar `lenders.calculator` en BD. Cero código.
- Si el card renting **no muestra el selector de cuotas** → el `calculator` no tiene `plans`/`formulas.payment` (ver ⚠ en §7: el 158 sembrado en la migración solo trae `formulas.amount`).
- `FormulaCalculator` es **fail-safe**: si el json está mal, degrada a `{amount}` (no rompe el listado).

---

## 5. Frente 4 — Ábaco: flag introducido y **luego removido**

**Qué pasó.** En la des-motaización se agregó `lenders.abaco` (bool) para reemplazar el "¿requiere Ábaco?" que salía del modo. **En esta iteración se REMOVIÓ** la columna (commit `5013f4af`), porque **Ábaco lo está trabajando otro equipo** y la forma final (columna/tabla/nombre) la definen ellos.

**Qué quedó:**
- La columna `abaco` **ya no se crea** en la migración ni está en el modelo `Lender` (`$fillable`/`$casts`).
- `MotaiValidationService::checkAbacoRequirementOrchestrator` (endpoint "¿requiere Ábaco?", devuelve `MOTV1001`/`MOTV1000`) **se dejó intacto** como *seam*: sigue leyendo `$userRequest->lender?->abaco ?? false`. Sin la columna, Eloquent devuelve `null` → `false` → "no requerido". **No rompe.**

**Por qué así.** No adelantarnos al diseño del otro equipo. Cuando ellos definan la fuente del dato, el seam se enciende (o se ajusta la línea 82 de `MotaiValidationService`).

**Cómo ajustar / coordinar.**
- Si el equipo de Ábaco agrega una columna `lenders.abaco` (bool), el endpoint funciona sin cambios.
- Si la nombran distinto o la ponen en otra tabla → tocar `MotaiValidationService.php:82`.
- ⚠ **Local**: si ya corriste la migración vieja, tu BD local tiene la columna `abaco` huérfana → `migrate:fresh` o dropearla a mano. Staging/prod corren la versión final (sin la columna).

---

## 6. Frente 5 — TyC por comercio (URLs en BD)

**Qué.** Tabla nueva `allied_documents` (`allied_id`, `type` ∈ {`terms_and_conditions`|`data_policy`|`risk_policy`|…}, `terms_and_conditions_id`, `sort`, `status`) + modelo `AlliedDocument` + `Allied::documents()`. El comercio configura qué documentos legales usa; el back los expone (`AlliedInfoController`) y los persiste al aceptar (`RegisterCellPhoneService::storeTermsAndConditions`).

**Por qué.** Des-hardcodear los `terms_and_conditions_id` quemados (Motai usaba 16/17; default 13). Ahora cada comercio define sus documentos en BD.

**Aclaración importante de modelo:** `allied_documents` **NO guarda la URL** — guarda un **FK a `terms_and_conditions`** (el catálogo donde ya vivía la URL/versión). Lo que movimos a config es el **mapeo comercio→documento**, no la URL en sí.

**Cómo resuelve (`storeTermsAndConditions`, corre al aceptar en el paso de teléfono/registro):**
1. Si `hasCredifamilia` → doc `18` (aún hardcodeado, placeholder).
2. Si el comercio tiene filas en `allied_documents` → registra **esas** (ordenadas por `sort`).
3. Si no → **DEFAULT (fallback en código)**: último TyC activo (`TermsController`) + doc `13` (política de datos).

**Qué hace la migración:** backfillea **solo la entidad específica** (Motai 158 → `data_policy=16` + `terms_and_conditions=17`). El default **no se siembra** (es el fallback de código, comportamiento pre-existente, intacto).

**Sobre "mostramos TyC sin haber elegido lender":** es correcto que se muestra/acepta a **nivel comercio, en el registro** (pre-lender) — pero eso es el **flujo pre-existente**; nuestro cambio solo movió el origen de las URLs a config. TyC *por lender* (post-selección) hoy solo existe para Credifamilia (`hasCredifamilia`).

**Cómo ajustar / gotchas:**
- Configurar TyC de un comercio nuevo (SmartPay 14/15, etc.) = insertar filas en `allied_documents` apuntando a IDs existentes del catálogo. Mejor por **seeder por-entorno o panel admin** que en la migración (los IDs difieren staging/prod).
- ⚠ **`allied_documents` reemplaza al default, no lo mergea**: si un comercio configura solo TyC y olvida `data_policy`, ese comercio pierde la política de datos. La config por comercio debe ser **completa**.
- ⚠ El backfill de 158 **no es idempotente** (sin `updateOrInsert`): re-correr la migración duplicaría filas → el usuario aceptaría TyC dos veces. Fix sugerido: `updateOrInsert` por `(allied_id, type)`.
- Docs 13 (política datos) y 18 (Credifamilia) **siguen hardcodeados** en el fallback → pendientes si el objetivo es 100% config.

---

## 7. Frente 6 — Recálculo de monto en `/lenders` (endpoint liviano)

**Qué.** Al cambiar el "Monto a solicitar", el front recalcula el `calculated` (renting/rto) vía un **endpoint liviano** nuevo — `GET lenders-v2/{ur}/recalculate?amount=` — que corre **solo `FormulaCalculator`**, sin re-correr listado/perfilamiento/datacrédito/cupo/**pre-aprobados**.

**Por qué.** La cuota depende del monto, pero **la elegibilidad y el cupo del pre-aprobado NO** (son del usuario, amount-independientes). Re-correr todo el listado + los pre-aprobados en cada cambio de monto era desperdicio (~0.67s + N llamadas al MS). El endpoint liviano mide **~0.15s**.

**Cómo funciona (patrón espejado del de pre-aprobados: una llamada por API, no en el loader):**
- Back: `LenderListingController@recalculate` → `LenderListingService::recalculate` → `{lenders:{<id>:{product,calculated}}}`.
- Front: `AvailableLenders.handleAmountChange` (debounce 450ms) → `recalcFetcher.load('/merchant/{hash}/{ur}/lenders/recalculate?amount=')` → mergea el `calculated` recomputado en las cards (`loanOptionsWithRecalc`). Ruta-recurso `recalculate.tsx` (loader GET server-side con auth). Monto **stateless** (no se sincroniza `?amount` a la URL).

**Cómo ajustar / bordes:**
- La ruta-recurso vive **solo bajo `merchant/`** (como `preapproval-retry`); se llama con path **absoluto** `/merchant/...` (es flow-agnóstica; no está en el árbol `:flow`/self-service). Si se usa prefijo dinámico → 404 silencioso en self-service.
- El crédito calcula la cuota **client-side** (`CalculateLoanFinancialsUc`) → se actualiza instantáneo sin esperar el endpoint.
- **Lenders sensibles al mínimo** (welli/meddipay/prami/bancolombia-consumo): si el monto arranca por debajo de su mínimo y luego sube, **no se re-consulta automático** (el viejo full-refetch sí). Queda cubierto por el botón "reintentar" de la card, que se habilita cuando `requestedAmount >= minimumAmount`. Welli además re-precia por su cuenta (`ExternalAmountUpdater`).

---

## 8. Retargeteo de legacy (staging → develop) — tenerlo presente

La rama `feature/motai-v2` de **legacy** se creó **sobre staging**, se subió y se abrió un **PR → staging**. Por pedido del líder, el PR se **retargeteó a `develop`**, lo que generó conflictos que se resolvieron con un **merge de develop** en la rama (commit `44eb3c02`).

**Consecuencia a tener presente:** como la rama nació de staging y ahora apunta a develop, el diff del PR vs develop arrastra la **divergencia staging↔develop** → el `develop..HEAD` muestra ~52 archivos, pero **no todo es nuestro**; nuestros cambios reales son los de los commits listados en §1. Si el diff del PR se ve "inflado", es por esto, no por el alcance del trabajo.

**Frontend NO se retargeteó**: su PR sigue apuntando a **staging** y está limpio (3 commits sobre staging). Si en algún momento también lo mandan a develop, habrá que mergear develop igual que en backend.

**Fixes que entraron por el merge de develop** (no son de la des-motaización, son bugs pre-existentes de develop que rompían local): `098322a8` (`$hasCredifamilia` indefinido rompía el register) y `4022b6c9` (`ProfilerML` 500 en `/lenders` sin `H2O_API_HOST`). ⚠ El de `$hasCredifamilia` **también vive en develop** → avisar al equipo.

---

## 9. Mapa rápido: "si hay que ajustar X → tocar Y"

| Si querés ajustar… | Tocá… | ¿Código o BD? |
|---|---|---|
| Monto financiado / cuota de renting/rto | `lenders.calculator` (json) | **BD** |
| Qué card se muestra (credit/renting/rto) | `lenders.product` | **BD** |
| Que aparezca el selector de cuotas en el card | `lenders.calculator` → agregar `plans`/`terms` + `formulas.payment` | **BD** |
| Tipos de documento (PEP) por sucursal | `lenders_by_allied_branches.document_types` | **BD** |
| TyC / política de un comercio | `allied_documents` (FK a `terms_and_conditions`) | **BD** |
| El default de TyC (sin config) | `RegisterCellPhoneService::storeTermsAndConditions` (docs 13/18 aún hardcoded) | código |
| "¿Requiere Ábaco?" | columna removida → coordinar con equipo Ábaco; seam en `MotaiValidationService.php:82` | — |
| El recálculo por monto | `LenderListingService::recalculate` (back) + `AvailableLenders.handleAmountChange` (front) | código |
| Orden de los lenders en el listado | `lenders_by_allieds.sort` (nivel comercio), dentro del bucket de probabilidad | **BD** |
| Motor de fórmulas (seguridad/operadores) | `app/Support/FormulaCalculator.php` | código |

---

## 10. Pendientes y consideraciones conocidas

| # | Pendiente | Nota |
|---|---|---|
| 1 | Correr la migración en staging/prod | Va por pipeline. Sin ella, Motai se comporta como `credit`. |
| 2 | ⚠ `calculator` de 158 solo tiene `formulas.amount` | Las `plans`/`payment` (selector de cuotas) se probaron en local con lenders clonados (169/170), **no** están en la migración → el card renting en staging/prod mostraría el monto pero **sin selector de cuotas**. Actualizar el `calculator` de 158 (o el real en staging). |
| 3 | Idempotencia de los backfills de 158 | Ni el `calculator`/`product` ni el `allied_documents` usan `updateOrInsert` → re-correr duplica/pisa. |
| 4 | RTO (`product='rto'`) | Falta seed de `terms` (52/78/104 semanas), su card propia, y la fórmula de valor a financiar (los números del PRD no reversan limpio sin la calculadora VF). |
| 5 | TyC: docs 13 y 18 aún hardcoded | + validar con **legal** la entrega de TyC por entidad. |
| 6 | Drop físico de `allied_modes`/`user_request_modes` | Migración aparte (BD compartida con `application`). |
| 7 | `PHP >= 8.4` en CI/prod | Requerido por `symfony/expression-language ^8.1` (si algún entorno corre 8.2 → re-pinear a `^7.0`). |
| 8 | Renombrar rutas `/api/onboarding/motai/*` → genéricas | Naming only; breaking change de API, coordinar front+back. |
| 9 | Admin/CRUD para `product`/`calculator`/`document_types`/`allied_documents` | Hoy se editan por BD; para que operaciones lo gestione sin ingeniería. |
| 10 | El 158 real no lista en el dump local | Le faltan filas de config que en staging sí existen (categoría/cupo, dc-rule genérica) → el card renting se prueba clonando un lender que sí lista, o en staging. |

---

## 11. Relación con otros docs

- Registro puntual de la des-motaización inicial (Jul-15): [MOTAI-V2-DES-MOTAIZACION-EJECUTADA.md](MOTAI-V2-DES-MOTAIZACION-EJECUTADA.md) — ⚠ describe TyC como "→ default" y `abaco` como columna; **este mapa lo actualiza** (TyC pasó a `allied_documents`; `abaco` fue removido).
- Censo original de hardcodes: [../mejoras/DES-MOTAIZACION.md](../mejoras/DES-MOTAIZACION.md).
- Plan y decisiones: [../mejoras/MOTAI-PLAN-EVOLUCION.md](../mejoras/MOTAI-PLAN-EVOLUCION.md).
- Realidad previa del flujo Motai: [../codigo/MOTAI-FLUJO-ANALISIS.md](../codigo/MOTAI-FLUJO-ANALISIS.md) (⚠ estado ANTES de esta rama).
