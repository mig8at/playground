# Hallazgo — refactor no muestra la "Cuota" de Meddipay (vs application sí)

> **ESTADO: CERRADO (2026-06-24) — resuelto en `main`, sin fix pendiente.**
> `main` (deployed/`originaciones`) YA muestra **"Valor a financiar"** en los cards normales (probado por el screenshot de Welli del propio usuario + código: `LenderCardFinancialSummary` `showFinancingAmount`, `LenderCardContent.tsx:417-420`) y la **cuota REAL de la oferta** de Meddipay (`meddipayEstimatedFee`, `:909`). El "número engañoso" de application (amortización genérica) NO aplica en main. No se re-aplica ningún fix.
> Rama vacía `fix/lenders-recalc-financing-amount` (puntero stale a main viejo, sin commits únicos) **borrada** (`was 13908bd5`).
> Validación visual local quedó bloqueada por env (wizard de main no levanta con `pnpm dev`: deps transitivas `@radix-ui/*` en `optimizeDeps.include` no resueltas) — no necesaria: prueba por screenshot deployed + código.
> Micro-gap del card de recálculo (`shouldShowRecalculationMessage`, `:612-613`) — tras cambiar el monto mostraba SOLO el mensaje, ocultando "Valor a financiar" — **RESUELTO (2026-06-24)** en rama `fix/lender-card-recalc-show-financing-amount` (off main, commit `13ff6998`, pusheada — PR a main pendiente de abrir): la rama de recálculo ahora muestra `<MonetaryRow "Valor a financiar *">` + el mensaje (la cuota sigue oculta, deliberado). Verificado e2e con el mock de pre-aprobaciones (`bin/asesor sonria lenders --mock-pa` + `E2E_CHANGE_AMOUNT=900000` → Meddipay expandido muestra "Valor a financiar $921.960" + mensaje, sin cuota). Ver [SERVICIO-PRE-APROBACIONES.md](../codigo/SERVICIO-PRE-APROBACIONES.md) §8 (mock).

**Síntoma** (split refactor `originaciones` vs application `aliados`): en el marketplace, la tarjeta de **Meddipay** en **refactor** muestra "Pre aprobado · Cupo $X" + la nota *"Recuerda: si cambias el monto a financiar, la cuota mensual se recalculará automáticamente en la plataforma de Meddipay"* y **NO** muestra Cuota / Valor a financiar / Plazo. En **application** sí muestra una Cuota (ej. $806.690). Welli y Addi en refactor sí muestran cuota.

## Veredicto: NO es bug de null/type — es una rama intencional (decisión de producto/diseño)

La cuota **se calcula bien** y el campo existe; lo que pasa es que una condición de UI muestra el mensaje de "recalcular" **en lugar de** la cuota.

### Cadena de causa (verificada en código)

1. `LenderCardContent.tsx:819`
   ```ts
   const shouldShowRecalculationMessage = hasAmountChanged && Boolean(lenderData.offers?.length);
   ```
2. `LenderCardContent.tsx:577-578` (`LenderCardBodyDetails`): si `shouldShowRecalculationMessage` → renderiza `LenderCardRecalculationMessage` **en vez de** `LenderCardFinancialSummary` (la Cuota).
3. `hasAmountChanged` = global, `AvailableLenders.tsx:187`:
   ```ts
   const hasAmountChanged = requestedAmount !== initialAmount;
   ```
   - `initialAmount?: number` (default 0, viene del loader `?amount=`); `requestedAmount = useState(initialAmount)` → al montar son IGUALES (`false`).
   - Se vuelve `true` cuando el usuario **edita el monto** en el `RequestAmountForm` de la página de lenders (`AvailableLenders.tsx:213-215`, `onAmountChange={setRequestedAmount}`). Es la ÚNICA fuente normal de cambio (el `ExternalAmountUpdater` solo corre con `hasOnlyStandardWelli`).
4. `lenderData.offers` se pueblan en el backend en la **pre-aprobación**: `PreApprovedLenderService.php:495` → `$lender->offers = $commercial_offer ?? []`. Son las **ofertas comerciales** que devuelve el lender de integración (Meddipay rt=1) al pre-aprobar. Welli/Addi en esa vista no traen `offers` → siguen mostrando la cuota.
5. La cuota SÍ es calculable: `calculate-loan-financials.uc.ts` (fórmula de amortización con `credit_lines.rate` + `fee_number`); `showFee` es `true` para todos menos Welli (`LenderCard.tsx:494`). O sea, nada está `null`/`NaN`.

### Por qué difiere de application

- **refactor**: para lenders con ofertas comerciales (Meddipay), una vez que el monto cambia, la cuota genérica (amortización client-side) NO coincide con la oferta real (que la fija Meddipay). Para no mostrar un número equivocado, muestra el mensaje "se recalculará en la plataforma de Meddipay". → comportamiento DELIBERADO.
- **application**: siempre muestra una cuota de amortización (ej. $806.690), que para un lender por-ofertas es probablemente **inexacta** (no es la cuota real de la oferta). Es el número potencialmente engañoso.

### Lo que NO es

- No es un crash por `null`/tipo. `hasAmountChanged` es `number !== number` (ambos number); es `true` porque el monto se editó, no por un type-mismatch.

## Riesgo / borde a confirmar (lo único "bug-ish")

- Si `initialAmount` llega `0`/ausente (loader sin `?amount`) mientras el `RequestAmountForm` ya tiene el monto real, `hasAmountChanged` sería `true` **sin que el usuario cambie nada** → el mensaje aparecería de más. Conviene guardar contra ese caso (ej. `hasAmountChanged = initialAmount > 0 && requestedAmount !== initialAmount`).

## Hallazgo crítico (2026-06-23): divergencia main vs develop

`LenderCardContent.tsx` está MUY distinto entre ramas (`git diff main develop`):

| | Card normal (con cuota) | Card recálculo (Meddipay + monto cambiado) |
|---|---|---|
| **main** (deployed / originaciones) | "Valor a financiar *" **+** "Cuota *" (ambos) — `LenderCardFinancialSummary` líneas ~412-443; además lógica por-lender `meddipayEstimatedFee`/`welliEstimatedFee`/`pramiEstimatedFee` (null → oculta SOLO la cuota) | solo `LenderCardRecalculationMessage` (sin valor a financiar) |
| **develop** (local, tiene los data-testid del e2e) | **solo "Cuota *"** (versión vieja, sin "Valor a financiar") | solo el mensaje |

→ Lo que se ve "sin Valor a financiar" en el synth es **develop atrasado**, NO el bug. **main YA muestra "Valor a financiar"** en los cards normales (= el screenshot deployed de Welli). Las ramas divergieron: develop tiene testids que main no; main tiene la lógica de lender-card que develop no.

**Ediciones revertidas**: las que había hecho sobre `LenderCardContent.tsx`/`AvailableLenders.tsx` en develop estaban sobre la versión vieja → revertidas (main ya hace casi todo, y mejor). develop queda como estaba (solo el `streamTimeout` del e2e sigue como cambio local).

## El card de recálculo (✅ RESUELTO 2026-06-24 — ver banner arriba)

El ÚNICO gap real (y es el del screenshot original de Meddipay): cuando `shouldShowRecalculationMessage = hasAmountChanged && offers?.length` (main línea ~876), la tarjeta muestra **solo el mensaje** "se recalculará en {lender}" — sin "Valor a financiar".

**VALIDACIÓN (2026-06-23): main YA lo resuelve, mejor.** main inyecta la cuota REAL de la oferta de Meddipay:
`meddipayEstimatedFee` (`LenderCardContent.tsx:909`) lee el installment del `transaction_data` (`extractMeddipayTermOptions`, por término); `effectiveFinancialData` (:939) lo pone en `estimatedFeeAmount`; se pasa al card (:1027). → En el camino normal (monto sin cambiar) la card muestra **"Valor a financiar" + "Cuota" (la real de la oferta)** vía `LenderCardFinancialSummary` (`showFinancingAmount=true`, :412-443). El número engañoso de application (amortización genérica) NO aplica en main.

Por lo tanto **el fix puntual NO es necesario** (y la edición que se había hecho se perdió al cambiar de rama; NO re-aplicar como "solución"). El ÚNICO micro-gap restante: la rama de recálculo (`shouldShowRecalculationMessage`, :612-613) tras cambiar el monto muestra solo el mensaje, sin "Valor a financiar" — es un pulido OPCIONAL (1 línea), no la solución del problema original.

Tensión: develop tiene los `data-testid` para e2e pero main no → el fix en main no se valida fácil por e2e local; y por convención los cambios de "refactor" son locales / sin PR sin pedir. No es reproducible en synth de todos modos (Meddipay pre-aprobado con `offers` = MS externo, no inyectable — [[synth-lender-type-boundary]]).

## Pregunta para producto

¿Es deseado que Meddipay (y lenders por-ofertas) **oculten la cuota** tras cambiar el monto y difieran a la plataforma del lender, o se quiere **paridad con application** (mostrar una cuota)?

- **Si se quiere ocultar** (defer a Meddipay): funciona como está; la cuota de application es la engañosa.
- **Si se quiere mostrar** la cuota: en vez del mensaje, renderizar la cuota de la **oferta seleccionada** (`lenderData.offers[selected]`) — no la amortización genérica — y/o relajar `shouldShowRecalculationMessage`.

## Archivos

- `frontend-monorepo/modules/loan-request-wizard/lenders-marketplace/src/components/lender-card/LenderCardContent.tsx` (819, 577-578, `LenderCardRecalculationMessage` 533-542, `LenderCardFinancialSummary` 382-425)
- `.../components/available-lenders/AvailableLenders.tsx` (187, 213-215)
- `.../components/lender-card/LenderCard.tsx` (494 `shouldShowFee`)
- `.../lib/application/calculate-loan-financials.uc.ts` (cuota = amortización)
- `legacy-backend/Modules/Onboarding/App/Services/lenders/PreApprovedLenderService.php:495` (`offers` = commercial_offer)
