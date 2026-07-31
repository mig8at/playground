---
id: 14
title: "Card de renting: planes, pago semanal y estados de carga"
stage: tasks
created: "2026-07-30T12:30:19-05:00"
context_nodes: [motai, creditopx]
---

ESTADO 2026-07-30: 3 cambios. Uno mergeado en `qa`, dos en ramas locales sin pushear.

1) CHIPS — PR #758, MERGEADO en qa (rama fix/renting-sin-chips-de-cupo, commit bc6f07a4).
   Los chips "Pre aprobado"/"Cupo disponible" se armaban en TRES lugares y ninguno miraba el producto:
   `createTags` (mapper del listado), `createApprovedLenderTags` (tras la pre-aprobación) y
   `buildTagsFromResolution` (rechazo). Ahora `productHidesQuotaTags(product)` en
   lender.constants.ts los apaga para renting. NO se sumó 158 a HIDE_AVAILABLE_CREDIT_TAG_LENDER_IDS:
   ese override es por id y el propio archivo pide borrarlo (TODO(backend)).
   Detalle: el chip queda fuera DENTRO de la rama de CreditopX, no antes — si no, un renting caía al
   `else` y mostraba un chip de probabilidad. En el rechazo se va el cupo pero queda "Sin cupo
   disponible" (el cliente tiene que saber que no pasó). 7 tests nuevos.

2) PLANES + PAGO SEMANAL — rama `feature/motai-renting-planes`, commit 9390b3ff, SIN PUSHEAR.
   Migración `2026_07_30_120000_seed_motai_renting_plans_calculator`: agrega al `lenders.calculator` de
   158 la matriz `plans` y `formulas.payment`. Sin esto `buildCalculated` (LenderListingService) no
   emite `plans` ni `payment_unit`, y el bloque de la card está detrás de `plans.length > 0`.
   Números del .xlsx real (`Calculadora Renting VF (2).xlsx`, pestaña Renting), leído con openpyxl:
     C8  precio   = (costo + alistamiento) * (1+margen) + IVA      → 15.470.000
     C14 BASE     = -PMT(1,8% ; 24 ; precio)/30*7   (fila MES)      → 186.550,5875
     C13 Semana   = C14 * D13 (D13 = 1,25)                         → 233.188,2343
     C15 Trimestre= C14 * D15 (D15 = 0,94)                         → 175.357,5522
     C18 duración = IF(plan="Semana",1, IF(plan="Mes",4, 12))       → 1 · 4 · 12 semanas
     C21 tabla    = VLOOKUP(plan; B13:C15; 2; 0) * IF(semana<=C18,1,0)
   Verificado con FormulaCalculator: delta < 0,0001 en las tres tarifas. `default` en `mes` (la base).
   APLICADA A MANO en local (batch 180) y en la BD COMPARTIDA dev/qa (batch 197), con el artisan del
   contenedor y las credenciales de dev pisadas por env → queda en el ledger, no es un UPDATE suelto.
   El 1,8% en renting NO es interés: es parámetro de precio (sin opción de compra no hay saldo). Tocar
   el prorrateo ÷30×7 recaracteriza el producto → decisión legal, no técnica.

3) PUNTITOS EN EL MONTO — rama `fix/monto-actualizando-sin-banner`, commit 71a7a949, SIN PUSHEAR.
   Se borró el `<p>Actualizando opciones con el nuevo monto…</p>` de AvailableLenders y se agregó
   `RecalculatingAmountBridge` (headless, dentro del provider, mismo patrón que ExternalAmountUpdater):
   espeja "recálculo en curso" al flag por lender `isUpdatingAmount` que ya existía (el de Welli), así
   `DisplayAmount`/`MonetaryRow` muestran el Loader sin tocar la card ni hilar props. Solo lenders con
   `calculated` → nunca choca con el reprecio externo.
   Dos decisiones: los puntos arrancan al TIPEAR (450ms de debounce en los que el número está viejo) y
   se apagan en la TRANSICIÓN del fetcher a idle, no cuando llega `data` — si el recálculo falla `data`
   queda undefined y la card se quedaba cargando para siempre.

PENDIENTES
a) Pushear las dos ramas y abrir PR a `qa` (la 2 y la 3). Hasta que se despliegue, Duncan solo puede
   validar los chips.
b) La story de Storybook de Motai Renting quedó en la versión pre-des-motaización (sin `product` ni
   `calculated`) → no dibuja la card nueva. Deuda de esa story; por eso lo visual no se pudo verificar
   fuera del wizard.
c) RTO (Motai RB): el backend ya emite `terms` (plazo + cuota) pero la card solo lee `plans` → sin
   selector. Ahí sí hace falta tocar el front.

HERRAMIENTA (no va a Jira)
Switch de front en el harness: `CFE_FRONT=local|ambiente` + selector en el panel, para probar el front
LOCAL contra el backend de qa sin esperar deploy. Hallazgo: el pool de Cognito lo trae el FRONT (el
wizard local usa login.creditop.com), así que con front local se loguea con la cuenta de .cognito.json
(pool dev) y el cache de sesión se llama por front, no por target. Funciona porque dev y qa comparten BD.
