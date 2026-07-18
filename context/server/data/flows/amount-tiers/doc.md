# Amount tiers · contexto
> **estado:** al día con main · **Tramos por monto** (`creditop_x_conditions_by_amount_by_lender`, rt=2): bandas `[min_amount, max_amount)` **por lender** que recortan los plazos y topean el cupo a `max_amount − 1`. El enganche del tramo existe en la tabla pero hoy **solo lo aplica el front del listado v1**.

## Qué es
Una tabla de **5 columnas de negocio** que parametriza, **por lender** (no por comercio ni por sucursal), qué condiciones cambian según **cuánta plata pide** el usuario. Es la última capa de la consolidación rt=2 y la única que reacciona al **monto**: la categoría (nodo hermano **Profiling**) perfila a la *persona*, el tramo restringe la *operación*.

Importa por dos motivos operativos: (1) es la razón por la que un mismo usuario ve **menos cuotas** al subir el monto, o un **plazo único obligatorio** en montos bajos; (2) es un tope de cupo **invisible en la config del comercio** — no aparece en el panel de admin (`admin-anatomia-creditop`), no tiene seeder y no tiene CRUD en ninguno de los 3 repos, así que cuando un lender "no deja pedir más de X" y la categoría dice otra cosa, el culpable suele estar acá.

## Contenido

### La tabla
Creada por `2025_05_06_193105_create_creditop_x_conditions_by_amount_by_lender` (**idéntica byte a byte en los dos repos**, `diff` = 0), ampliada por `2025_08_21_163609_add_mandatory_fee_number_…`.

| columna | tipo / default | quién la lee | qué hace |
|---|---|---|---|
| `lender_id` | `unsignedBigInteger` def **0** | todos | dueño del tramo. **No hay `allied_id` ni `allied_branch_id`** → el tramo es global al lender |
| `min_amount` / `max_amount` | `integer` def **0** | repos + front | banda **semiabierta `[min, max)`** (`>=` min, `<` max) |
| `max_fee_number` | `integer` def **0** | plan de pagos + front | **plazo máximo** del tramo: recorta `credit_lines.fee_numbers` |
| `mandatory_fee_number` | `boolean` def **false** | plan de pagos + front | convierte `max_fee_number` en el **único** plazo ofrecido |
| `initial_fee_percentage` | `integer` def **0** | **solo front v1** | % de enganche que **pisa** `lender.initial_fee_percentage` |

Sin `allied_id`, sin vigencia, sin unicidad: **las bandas pueden solaparse** y el código lo asume (ver Gotchas). El Model (`App\Models\CreditopXConditionsByAmountByLender`, mismo archivo en los dos repos) es un CRUD pelado: `$table`, `$fillable` de 6 campos, `belongsTo(Lender)`, **sin `$casts`** y sin scopes.

**No existe fuente de datos versionada:** grep del nombre de tabla/modelo → 5 archivos en application, 12 en legacy, 0 en frontend; **ningún seeder, ninguna pantalla de admin**. Las filas se cargan por SQL directo.

### Lo que hace el tramo — 3 efectos, 3 lugares distintos

**1 · Topea el cupo a `max_amount − 1`** (coherente con la banda semiabierta: es el mayor entero que todavía cae dentro del tramo más alto).
Antes de topear, **se descartan los tramos cuyo `max_fee_number` no cabe en el plazo de la categoría**; el tope se calcula como el **máximo `max_amount` de los tramos sobrevivientes** — o sea que *un tramo largo filtrado baja el techo al del tramo corto*, y si no sobrevive ninguno **no hay tope**.
- v1 / application: `LenderRetrievalService.php:738-761` (`min(creditLines->max_amount, maxConditionAmount − 1)`).
- v1 / legacy: gemelo en `LenderRetrievalService.php:787-810` (además pega `amount_conditions` al lender, `:806`).
- **v2 / legacy (autoritativo hoy):** `CreditopXQuotaController.php:456-480` → `available_amount = max(0, min(available, maxConditionAmount − 1))`. El comentario `:456-460` es explícito: se aplica a **TODOS** los lenders CreditopX; sin filas, no aplica. Cubierto por test: `CreditopXQuotaControllerTest.php:386-413` (2.000.000 → **999.999**) y `:419-450` (tramo de plazo 24 vs categoría 12 → se filtra, **no topea**).

**2 · Recorta los plazos** (esto NO pasa en el listado: pasa al armar el plan de pagos y en el selector de cuotas del front).
- legacy v2: `RegularPaymentScheduleService.php:135-181` → `getByLenderAndAmount(lender_id, userRequest->amount)`; si matchean varias bandas ordena por `[max_fee_number, mandatory ? 0 : 1]` y **aplica la más restrictiva** (`:159-164`); si `mandatory_fee_number` **devuelve `[max_fee_number]` aunque ese plazo no esté en `fee_numbers`** (`:166-172`).
- application: `PromissoryNoteController.php:758-796` (`getCalculatePaymentSchedule`) → misma idea pero **matchea contra `amount − administrativeCosts`** (`:777-778`) y **cualquier** banda que matchee habilita el plazo (OR, no "la más restrictiva").
- front: `useInstallmentOptions.ts:37-73` filtra `installmentOptions` con `max_fee_number` y, si `mandatory_fee_number === 1`, deja solo esa opción — matcheando contra el **monto financiado** (`requestedAmount − initialFee`, `:108`), no el bruto.

**3 · Fija el enganche — solo en la ruta v1.**
`initial_fee_percentage` del tramo **pisa** el del lender (que en v1 el backend ya había sobreescrito con `category->min_initial_fee`): `calculate-loan-financials.uc.ts:176-194` (React) y `ListLenders.vue:3518-3531` (Vue de application), misma lógica: buscar la banda por `lender_id` + monto, y si `rule.initial_fee_percentage != null` devolverla. **Ningún backend lee esta columna** — es 100% decisión de cliente.
⚠ En el wizard actual **nunca se ejerce**: el wizard pega a `lenders-v2` (`loan-options.repository.ts:26`) y **v2 no devuelve la clave top-level `amountConditions`** (`processRevolvingAndCreditopXLenders` está comentado, `LenderListingService.php:178-182`) → `data.data.amountConditions ?? null` (`:67`) queda **null** → `getInitialFeePercentage` cae siempre al `lender.initial_fee_percentage`. Ver Gotchas.

### Dos canales de entrega al front (v1 vs v2)
| | listado **v1** `GET …/lenders/{id}` | listado **v2** `GET …/lenders-v2/{id}` |
|---|---|---|
| servicio | `LenderRetrievalService` (app + legacy) | `LenderListingService` (legacy) |
| top-level `amountConditions` | **sí** (filtrado por plazo de categoría; es el del **último** lender rt=2 del loop) | **no** (bloque comentado) |
| per-lender `amount_conditions` | solo en legacy y solo si el lender tiene reglas de categoría | **sí, a todos los lenders y sin filtrar** (`attachAmountConditions`, `:170` + `:247-272`) |
| tope de cupo | en el listado | movido a `POST /api/loans/lender/available-quota` |
| consumidor | Vue Inertia `ListLenders.vue` (application) | React `lenders-marketplace` |

Consecuencia: en el wizard v2 el tramo llega **solo** como `amount_conditions` por lender (→ plazos) y como cupo ya topeado dentro de `available` del pre-aprobado; el `initial_fee_percentage` del tramo queda inerte.

### Cableado (legacy)
`CreditopXConditionsByAmountByLenderRepositoryInterface` (2 métodos) → `…Repository`, bindeado en `LoansServiceProvider.php:327-330`. `getByLenderAndAmount` = `min_amount <= $amount AND max_amount > $amount`; `getAllByLenderIds` = `whereIn` + `groupBy('lender_id')` (devuelve `collect()` vacío si el array viene vacío). Consumidores inyectados: `CreditopXQuotaController`, `RegularPaymentScheduleService`, `LenderListingService`. **application no tiene repositorio**: usa el Model directo con `Cache::store('array')->remember(…, 30)` (cache en memoria del request, `LenderRetrievalService.php:691-694`).

## Dónde mirar
- **Definición** (idéntica en los 2 repos): `database/migrations/2025_05_06_193105_create_creditop_x_conditions_by_amount_by_lender.php:14-22` · `database/migrations/2025_08_21_163609_add_mandatory_fee_number_to_creditop_x_conditions_by_amount_by_lender.php:15` · `app/Models/CreditopXConditionsByAmountByLender.php:11-19`.
- **Acceso a datos** (legacy): `Modules/Loans/App/Repositories/CreditopXConditionsByAmountByLenderRepository.php:11-30` (banda `[min,max)`) · `Modules/Loans/Contracts/Repositories/CreditopXConditionsByAmountByLenderRepositoryInterface.php:9-11` · bind en `Modules/Loans/App/Providers/LoansServiceProvider.php:327-330`.
- **Tope de cupo — ruta autoritativa** (legacy): `Modules/Loans/App/Http/Controllers/Customer/CreditopXQuotaController.php:456-464` (fetch + filtro por plazo de categoría) · `:466-480` (`max(0, min(available, max−1))` + log `QUOTA_CHECK_AMOUNT_CONDITION_APPLIED`) · `:486` (rechazo `below_min_amount`, que es por `creditLines->min_amount`, **no** por el tramo) · `:626` (`amount_conditions` en el payload). Ruta: `Modules/Loans/routes/api.php:107`.
- **Tope de cupo — listado v1**: application `app/Services/lenders/LenderRetrievalService.php:691-694` (cache) · `:738-743` (filtro por plazo de categoría) · `:745-760` (tope `−1`, **sin clamp a 0**) · `:267`/`:324`/`:823` (payload `amountConditions`); legacy `Modules/Onboarding/App/Services/lenders/LenderRetrievalService.php:715-718` · `:787-810` (idem + `:806` pega `amount_conditions`) · `:290`/`:361`/`:895`.
- **Listado v2** (legacy): `Modules/Onboarding/App/Services/lenders/LenderListingService.php:35` (inyección) · `:170` + `:247-272` (`attachAmountConditions`, sin filtrar, a todos) · `:178-182` (el `processRevolvingAndCreditopXLenders` v1 **comentado**). Entradas: `Modules/Onboarding/App/Http/Controllers/LenderListingController.php` y `…/ListLenderController.php:51`; rutas `Modules/Onboarding/routes/api.php:49-50`.
- **Recorte de plazos**: legacy `Modules/Loans/App/Services/PaymentSchedule/RegularPaymentScheduleService.php:135-181` · application `app/Http/Controllers/Customer/PromissoryNoteController.php:758-796` (ojo `− administrativeCosts` en `:777-778`).
- **Front React** (`frontend-monorepo/modules/loan-request-wizard/lenders-marketplace/src/`): `lib/application/calculate-loan-financials.uc.ts:142-174` (enganche mínimo / excedente) · `:176-194` (enganche del tramo) · `components/available-lenders/hooks/useInstallmentOptions.ts:21-73` (tipo + filtro de plazos) · `:108` (matchea con el monto financiado) · `lib/types/lender-api-response.ts:52-58` y `lib/domain/entities/loan-option.entity.ts:160-170` (los **dos** shapes: top-level vs per-lender) · `lib/infrastructure/repositories/loan-options.repository.ts:26` (v2) `:67` (`amountConditions ?? null`) · `lib/mappers/lender-response.mapper.ts:248` · `components/context/LenderMarketplaceContext.tsx:378-380` (`useAmountConditions`) · `components/lender-card/useLenderFinancials.ts:32` · `components/available-lenders/hooks/useInitialFee.ts:48-71`; inyección desde la ruta: `apps/loan-request-wizard/app/routes/lenders-marketplace/available-lenders.tsx:180`.
- **Front Vue** (application): `resources/js/pages/customer/lenders/list/v2/ListLenders.vue:1946` (prop `amountConditions`, `required: true`) · `:3238-3252` (`getFeeNumbers`, matchea con `amount − initialFee`) · `:3518-3531` (`getInitialFeePercentage`). Lo renderiza `app/Http/Controllers/Customer/ListLenderController.php:228`/`:289`.
- **Tests**: `Modules/Loans/tests/Feature/CreditopXQuotaControllerTest.php:386-413` (topea a `max−1`) · `:419-450` (tramo con plazo > categoría se filtra y **no** topea). Es la única cobertura automatizada del concepto en los 3 repos.

## Gotchas / riesgos
- **El `initial_fee_percentage` del tramo NO está muerto en la tabla, está desconectado en v2.** El nodo padre (**CreditopX**) y **Profiling** dicen "código muerto, nunca se lee": eso es cierto para *todo el backend* y para el wizard actual, pero **falso para el front v1** — `calculate-loan-financials.uc.ts:189-190` y `ListLenders.vue:3524-3529` lo aplican y **pisan** el `min_initial_fee` de la categoría. Sembrar un tramo con `initial_fee_percentage > 0` cambia el enganche en la ruta v1 (application, hoy default del parallel-run). En v2 la clave top-level ni se envía → queda inerte. **Riesgo de cutover**: si alguien "arregla" v2 devolviendo `amountConditions`, reactiva una regla de enganche dormida.
- **El tope depende de un tramo que quizá ni matchea el monto pedido.** El cupo se topea con `max(max_amount)` sobre *todos* los tramos del lender (filtrados por plazo), no con la banda donde cae el monto. O sea: el tope es "el techo global de la tabla − 1", y filtrar un tramo largo por plazo de categoría **baja** ese techo.
- **`max_fee_number === null` es rama muerta.** El filtro `…|| $condition->max_fee_number === null` aparece en las 3 implementaciones, pero la columna es `integer NOT NULL default 0` → nunca es null. Peor: un tramo con `max_fee_number = 0` **pasa siempre el filtro** y en el plan de pagos deja la lista de cuotas **vacía**.
- **Defaults 0 + falta de clamp.** Toda la tabla defaultea a 0. Con `max_amount = 0`, `CreditopXQuotaController:468` clampea (`max(0, …)`) pero los dos `LenderRetrievalService` v1 **no**: `min(max_amount, 0 − 1)` deja el cupo en **−1**.
- **Cuatro montos distintos para matchear la misma banda.** front-listado: `requestedAmount − initialFee` (`useInstallmentOptions:108`) · front-enganche: `requestedAmount` bruto (`calculate-loan-financials:148`) · legacy plan de pagos: `userRequest->amount` crudo · application plan de pagos: `amount − administrativeCosts`. En bordes de banda el plazo que ofrece el listado puede **no coincidir** con el que habilita el plan de pagos.
- **`mandatory_fee_number` diverge front↔back.** Legacy devuelve `[max_fee_number]` aunque no esté en `fee_numbers`; el front solo puede *filtrar* lo que ya está en `installmentOptions` y, si el filtro queda vacío, **devuelve la lista completa sin filtrar** (`useInstallmentOptions.ts:68-70`) — o sea que un plazo obligatorio ausente de `fee_numbers` produce, en el front, **cero restricción**.
- **`mandatory_fee_number` es `boolean` sin `$casts`.** El front tipa `number` y compara `=== 1` (`useInstallmentOptions.ts:64`); hoy funciona porque el tinyint se serializa 0/1. Agregar un cast `'boolean'` al Model rompería silenciosamente ese `===`. El Vue usa truthiness y no se vería afectado.
- **Bandas solapadas: 3 desempates distintos.** El repo no garantiza unicidad y el propio código lo dice (`RegularPaymentScheduleService.php:156`, "this shouldn't happen"). Legacy toma **la más restrictiva**; application acepta **cualquier** banda que matchee (OR); el front toma **la primera del array** (`.find`). Mismo dato, 3 resultados posibles.
- **Import muerto.** `Modules/Loans/App/Services/PromissoryNoteService.php:8` importa el Model y no lo usa: la lógica de tramos vive en `RegularPaymentScheduleService`. Es el residuo de la migración, no un segundo motor.
- **Fuga de variable en v1.** En `processRevolvingAndCreditopXLenders` (los dos repos) `$amountConditions` se pisa en cada iteración del loop de lenders rt=2, así que el top-level que sale al front es el del **último** lender procesado. El front se protege filtrando por `r.lender_id === lender.id` — pero si un día se ordena distinto y hay 2 rt=2 con tramos, el front recibe los de uno solo.
- **v1 exige categoría para que el tramo exista.** En los dos `LenderRetrievalService` todo el bloque cuelga de `if (count($lenderUserCategoryRules) > 0 …)`: un lender rt=2 **con tramos pero sin reglas de categoría** no recibe tope ni entrega `amount_conditions`. En v2 `attachAmountConditions` es incondicional.

## Preguntas abiertas
- [ ] **Cuántas filas hay y de qué lenders.** No hay dump local ni seeder; el volumen real y qué miembros de la familia CreditopX usan tramos no se pudo verificar (needs-runtime / query a staging).
- [ ] **¿Quién carga las filas?** No hay CRUD en los 3 repos. Queda por confirmar si algún back-office fuera de estos repos las edita o si es 100% SQL manual.
- [ ] **¿Cuál es el monto "correcto" para matchear la banda** — bruto, neto de enganche o neto de costos administrativos? Hoy conviven las 3 lecturas; cuál es la intención de negocio no está en el código.
- [ ] **¿v2 debe recuperar el top-level `amountConditions`?** El bloque comentado (`LenderListingService.php:178-182`) sugiere trabajo a medio terminar; no hay TODO explícito que diga si el enganche por tramo se retiró a propósito.
- [ ] **¿"Monto por debajo del primer tramo → rechazo"?** El doc sembrado lo afirmaba; **no se encontró ese corte en código** (sin match, simplemente no se aplica restricción). El único rechazo por monto es `below_min_amount` contra `creditLines->min_amount` (`CreditopXQuotaController.php:486`), que no es del tramo. Queda por confirmar si era una regla de negocio deseada y nunca implementada.

## Bitácora
- **2026-07-18** — Fase de data: nodo documentado por ANALISIS DE CODIGO (no habia doc fuente) + superficie curada.
- **2026-07-17** — Contexto sembrado desde `playground/flow` (TramoNode + MAP.md §S5, verificado). Superficie de código a linkar en la fase de data.

## Enlaces
- Padre: **CreditopX**. Hermano: **Profiling** (la categoría — enganche/cupo/plazo por *persona*; el tramo solo por *monto*).
- Consumidores del tramo en otros nodos: **MS-preapprovals** (envuelve `/available-quota`, por donde llega el cupo ya topeado como `lender.available`) · **Pullman** / **SmartPay** / **MotaiX** (miembros rt=2 candidatos a tener tramos).
- Repos: **legacy-backend** (repositorio + v2) · **application** (v1, ruta viva del parallel-run) · **frontend-monorepo** (los dos únicos lugares que leen `initial_fee_percentage` del tramo).
- Simulador: `playground/flow` (nodo "Tramos por monto"), mapa `playground/flow/MAP.md` §S5.
- Memorias: `lender-listing-cascade` · `migracion-application-a-legacy-estado` · `admin-anatomia-creditop` (por qué el tramo no aparece en el panel) · `reglas-comercio-lender-map` · `orden-lenders-ml-desactivado`.
