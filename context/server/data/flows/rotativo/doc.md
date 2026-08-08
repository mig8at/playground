# Rotativo (rt=3) · cómo se otorga el cupo

> **verificado contra `main` + producción** el **2026-08-07**. El motor se leyó del código; los pesos,
> rangos y la configuración por lender se midieron en la BD de prod (lectura); las dos rutinas SQL se
> leyeron por MySQL directo de dev.

## Qué es

El **cupo rotativo** es la línea revolvente de CreditopX (`response_type = 3`): al cliente no se le
aprueba *un crédito*, se le aprueba un **cupo** que puede usar, pagar y volver a usar. Este nodo cubre
**el otorgamiento** —cómo sale el número—; lo que pasa después (causación, mora, el cupo que se libera
al pagar) es `servicing`.

Su rasgo distintivo, y la razón de que casi no aparezca en el código: **el rotativo NO usa el motor de
tiers de consumo.** Medido en prod: de los **16 lenders rt=3 activos, 14 no tienen una sola fila** en
`lender_users_category_rules`. En vez de tiers usa un **multiplicador de riesgo de 1 a 5** calculado en
SQL, y una tabla de cuota inicial + FGA por nivel.

## El motor, paso a paso

El otorgamiento vive en `RevolvingLoanConfigService::getRevolvingLoanConfig` y es una secuencia corta:

1. **Ingreso promedio** — `FN_User_Income_Average(user_id, agildata_id, mareigua_id, APP_KEY)`. La
   rutina descifra el reporte adentro de la BD (por eso recibe la `APP_KEY`). Nodo `db-routines`.
2. **Egreso por deudas** — Experian `agregatedInfo.overview.balances.valueMonthlyPayment × 1000`.
3. **Gastos fijos** — `FN_CreditopX_Profiling_Fixed_Expense_Perc(ingreso)` devuelve un **porcentaje**
   del ingreso, no un monto.
4. **Capacidad de pago** = `ingreso − deuda − gastos + deuda_creditop` (⚠ el signo del último término
   es intencional y engaña — ver Gotchas).
5. **Multiplicador de riesgo** = `FN_CreditopX_Revolving_Credit_Multiplier(datacredito, userSummary)`.
6. **Corte duro: `multiplier <= 3` → `approved_limit = 0`.** No hay listado, no hay condiciones, no hay
   motivo escrito en ningún lado. Es de lejos la causa más probable de un «me dio cupo 0».
7. **Cupo** = `capacidad × multiplicador`, capado a `lenders.max_rev_credit`, y **redondeado hacia abajo
   a múltiplos de 50.000**.
8. **Plazo mínimo** = `ceil(cupo_sin_topar / capacidad) + 1`.
9. **Cuota inicial y FGA** = fila de `creditop_x_profiling_down_payment_FGA` para
   `(lender_id, multiplier_risk = (int) multiplicador)`. Si el lender no tiene config, **quedan en 0**
   (fail-open explícito: el comentario nombra a Dentalpay).

## El multiplicador: seis variables, promedio ponderado

`FN_CreditopX_Revolving_Credit_Multiplier` puntúa seis variables de **1 a 5** y devuelve el promedio
ponderado `SUM(peso × puntaje) / SUM(peso)`. Los pesos y los cortes **no están en el código**: viven en
`creditop_x_profiling_multiplier_risk_vars` (peso) y `creditop_x_profiling_multiplier_risk_rangs`
(rangos → puntaje), sembrados por `RevolvingLoanVars.php`. Medido en prod el 2026-08-07:

| variable | peso | de dónde sale | cortes → puntaje |
|---|---:|---|---|
| `EXPERIAN_SCORE` | **30** | `models[0].scoreValue` | 0→1 · 1-300→**0** · 301-400→1 · 401-500→2 · 501-600→3 · 601-700→4 · 701+→5 |
| `CURRENT_NEGATIVE_CREDITS` | 20 | `overview.principals.currentNegativeCredits` | 0→5 · 1→3 · 2+→1 |
| `CONTINUITY` | **20** | `agildata` > `mareigua`: `continuity_12/6/3_months` | 0→1 · 3→3 · 6→4 · 12→5 |
| `HISTORICAL_NEGATIVE_CREDITS` | 10 | `negativeHistoricalLast12Months` | 0→5 · 1→3 · 2+→1 |
| `HISTORICAL_QUERIES` | 10 | `consultedLast6Months` | 0-5→5 · 6-10→3 · 11+→1 |
| `CREDIT_CARDS_QUANTITY` | 10 | `FN_Experian_CC_Quantity_Active(creditCard)` | 0→1 · 1+→5 |

La función devuelve un **JSON con el valor Y el puntaje de cada variable** — o sea que el cómputo es
perfectamente auditable… si alguien lo guardara. Nadie lo guarda (ver Gotchas).

## Los cinco niveles: qué es configurable y qué no

La documentación de negocio lo dice así: *«para rotativo se manejan siempre cinco niveles de riesgo, los
cuales ya están predefinidos y configurados por Creditop. A diferencia del crédito de consumo, no se
aplican políticas individualizadas»* [Confluence · *Solicitud de Políticas Creditop X*, 2025-07-01].
**Verificado y cierto**, y los cinco niveles son literales: la migración los fija con
`->check('multiplier_risk BETWEEN 1 AND 5')`, y los 13 lenders configurados en prod tienen exactamente
5 filas cada uno.

Lo que el comercio elige por nivel es **sólo la economía**, no el criterio:

- **cuota inicial** (`down_payment`, 0-100 %) y **FGA** (0-100 %) por nivel;
- **cupo máximo por cliente** (`lenders.max_rev_credit`) — **general, no por nivel**;
- seguro de vida y tipo de validación de identidad (AWS vs ADO), que viven fuera de esta tabla.

Configuraciones reales en prod (13 lenders): algunas escalonan de verdad —el 71 va de
`cuota 40 % / FGA 25 %` en nivel 1 a `0 % / 5 %` en nivel 5—, y **siete de los trece ponen el mismo par
en los cinco niveles**, o sea que el nivel no cambia nada para ese comercio.

## Dónde mirar

- **El otorgamiento (autoritativo, el que CREA el cupo)** —
  `application/app/Services/lenders/RevolvingLoanConfigService.php:30 getRevolvingLoanConfig`:
  `:64` ingreso · `:74` gastos fijos · `:77` capacidad de pago · `:80` multiplicador · `:87` **el corte
  `<= 3`** · `:95` redondeo del cupo · `:97` plazo mínimo · `:102` cuota inicial y FGA por nivel ·
  `:114` lock de concurrencia por `(user, lender)` · `:119` re-chequeo de cupo activo dentro del lock.
  ⚠ Corre en **`legacy-application`**, no en `legacy-backend`: la migración no lo alcanzó.
- **La pantalla de condiciones (la OTRA implementación)** —
  `legacy-backend/Modules/Loans/App/Services/RevolvingCreditsService.php:486` llama
  `RevolvingCreditRepository.php:113 callCallUserConditionsSP` → `CALL SP_CreditopX_Revolving_Credit`.
  Ese SP recalcula **todo** en SQL, y no da lo mismo (ver Gotchas). Su request:
  `GetRevolvingCreditConditionsRequest.php`.
- **Los parámetros del multiplicador** — `legacy-backend/database/seeders/RevolvingLoanVars.php:25` es
  el único lugar del repo donde se ven los pesos y los rangos; la verdad viva está en las dos tablas.
  La migración que las crea: `2025_03_10_101510_create_revolving_loan_parameters_tables.php:28`.
- **La economía por nivel** —
  `2025_03_11_111511_create_revolving_loan_down_payment__f_g_a_table.php:19` (la tabla, con los tres
  `check`) y `:15` (`lenders.max_rev_credit`, el tope general). El modelo:
  `application/app/Models/CreditopXProfilingDownPaymentFGA.php`.
- **Consulta y administración** (NO otorgan, sólo leen) —
  `legacy-backend/Modules/Loans/App/Services/RevolvingCreditsService.php:55 getRevolvingCreditsData` ·
  `:140 getRevolvingCreditDetails` (pagaré, garantía, consentimientos) · `:235 simulatePaymentSchedule`.
- **El front** — `frontend-monorepo/…/loan-origination/src/components/RevolvingCreditIntro.tsx`, la
  pantalla que introduce el producto en el wizard.
- **Las rutinas SQL** (ninguna está en `files[]`, son `.sql`): `FN_CreditopX_Revolving_Credit_Multiplier`
  ⚠ **no tiene fuente en ningún repo** — se lee con
  `go run . -target dev -sql "SELECT routine_definition FROM information_schema.routines WHERE routine_name='…'"`.
  `SP_CreditopX_Revolving_Credit` sí está, en `legacy-backend/migrate.sql`. Nodo `db-routines`.

## Gotchas / riesgos

- ⚠ **Los niveles 1 y 2 no se pueden alcanzar nunca.** El corte rechaza `multiplier <= 3` **antes** de
  leer la tabla de cuota inicial/FGA, así que la fila que se lee es siempre `(int) multiplicador ∈
  {3, 4, 5}` — y el 3 sólo cuando el promedio cae en `(3, 4)`. Los 13 lenders tienen configurados los 5
  niveles: **26 de las 65 filas son configuración muerta**. Al leer un tablero de configuración, los
  niveles 1 y 2 se ven activos y no lo están.
- ⚠ **El nivel 5 casi tampoco.** `(int)` **trunca**: `4,99 → 4`. Para caer en el nivel 5 hace falta un
  promedio **exactamente** 5,0, o sea las seis variables en su puntaje máximo.
- ⚠ **Las dos implementaciones dan resultados distintos para el mismo cliente.** El PHP otorga y el SP
  alimenta la pantalla de condiciones; divergen en al menos cinco puntos, todos verificados leyendo
  ambos cuerpos:

  | | PHP (`RevolvingLoanConfigService`) | SQL (`SP_CreditopX_Revolving_Credit`) |
  |---|---|---|
  | función de multiplicador | `FN_CreditopX_Revolving_Credit_Multiplier` — 6 variables, **incluye continuidad laboral** | `FN_CreditopX_Profiling_Multiplier_Risk` — **otra función**, sólo Experian |
  | deuda CreditOp | la **suma** a la capacidad (`+ ctop_debt`) | la **resta** (`+ creditopXInstallment` dentro del paréntesis) |
  | rechazo | `multiplier <= 3` → cupo 0 | **no rechaza** |
  | redondeo del cupo | `floor(x/50.000) × 50.000` | `TRUNCATE(x, -4)` → a **10.000** |
  | nivel para FGA/cuota | `(int) m` — **trunca** | `m = 5 ? 5 : TRUNCATE(m,0) + 1` — **redondea hacia arriba** |
  | plazo mínimo | `ceil(cupo / capacidad) + 1` | `trunc(**max_rev_credit** / capacidad) + 1` |

  La fila del nivel es la más visible en soporte: para un multiplicador 3,7 el PHP cobra la cuota inicial
  del **nivel 3** y el SP muestra la del **nivel 4**. **No se determinó cuál de las dos es la
  intencionada**; lo que sí es seguro es que el número que ve el cliente y el que queda guardado no
  salen del mismo cálculo.
- ⚠ **El `+ deuda_creditop` de la capacidad de pago no es un error de signo.** Suma de vuelta lo que
  CreditOp ya le prestó, porque ese saldo **también** viene dentro del `valueMonthlyPayment` de Experian
  y si no se devuelve se cuenta dos veces. El propio código lo dice en el TODO de
  `RevolvingLoanConfigService.php:72`. El SP hace lo contrario. Es el mismo patrón que las dos
  convenciones de tasa (F-71): dos caminos, dos convenciones, ninguna declarada.
- ⚠ **`ctop_debt` casi siempre pierde un sumando** (`:35`): `a ?? 0 + $suma ?? 0` se evalúa como
  `a ?? (0 + $suma) ?? 0` porque en PHP `+` liga más fuerte que `??`. Si el cliente **ya tiene** un cupo
  rotativo activo, la suma de las cuotas de sus créditos CreditopX **se descarta**. Ver **F-116**.
- ⚠ **Sin continuidad laboral, la penalización es máxima y silenciosa.** `CONTINUITY` pesa 20 y sus
  rangos son valores exactos (0, 3, 6, 12). Si no hay ni `agildata` ni `mareigua`, la función deja
  `continuityValue = NULL`, el `SELECT … INTO` no matchea y la variable **conserva su `DEFAULT 0`** — o
  sea **0 puntos, peor que el peor cliente** (el piso de la tabla es 1). Un problema de disponibilidad
  de una fuente de datos se cobra como riesgo del cliente. Ver **F-117**.
- ⚠ **Un score de 0 puntúa MEJOR que un score de 1 a 300.** El rango `0-0 → 1` y el `1-300 → 0` son las
  únicas dos celdas de toda la tabla que rompen el piso de 1 punto. Con peso 30, esos 30 puntos separan
  al que no tiene score del que lo tiene malo, a favor del primero.
- **El cómputo no deja rastro.** `RevolvingLoanConfigService.php:85` dice literalmente
  `//TODO guardar log con resultados`, y el JSON con los seis puntajes se descarta. Un rechazo por
  `multiplier <= 3` no escribe log, no escribe fila y no cambia de estado: el trazador puede mostrar que
  el cliente entró y que no hubo cupo, **nunca por qué**. Es el hueco de auditoría más grande del
  producto. Ver **F-115**.
- **Rotativo ≠ el `revolving` de `servicing`.** Este nodo termina cuando el cupo queda creado; el
  consumo del cupo, la causación y los seis crons diarios son `servicing`.

## Preguntas abiertas

- [ ] ¿Cuál de las dos implementaciones es la intencionada? Si el SP quedó viejo, la pantalla de
      condiciones está mintiendo; si el viejo es el PHP, se otorga con el motor equivocado.
- [ ] `FN_CreditopX_Profiling_Multiplier_Risk` (la del SP) no se leyó en detalle: ¿cuántas variables usa
      y con qué pesos? Está entre las 27 rutinas «sólo internas» del nodo `db-routines`.
- [ ] Los 7 lenders con el mismo par cuota/FGA en los 5 niveles: ¿es decisión comercial o configuración
      copiada sin pensar? Se contesta preguntando, no leyendo.
- [ ] `debtToIncome = 40` en el SP calcula `ingreso × 40 − deuda` (sin dividir por 100) y el bloque que
      lo usaba está **comentado**. Resto muerto, pero si alguien lo reactiva el número es absurdo.

## Enlaces

- `servicing` — qué pasa con el cupo DESPUÉS: consumo, causación, mora, los 6 crons.
- `profiling` — el otro motor de categorización (rt=2, por tiers). Comparten vocabulario («capacidad»,
  «categoría») con significados distintos.
- `db-routines` — `FN_CreditopX_Revolving_Credit_Multiplier` es una de las 4 rutinas **sin fuente en
  ningún repo**; `FN_User_Income_Average` y `FN_CreditopX_Profiling_Fixed_Expense_Perc` también viven ahí.
- `creditopx` — el padre: qué es un lender rt=2/3 y por qué el comercio pone el capital.
- `trazador` — por qué un rechazo de rotativo sale `sin-evidencia` en el árbol de la solicitud.
- `findings` — **F-115** (el cómputo sin rastro) · **F-116** (`ctop_debt`) · **F-117** (continuidad NULL).
