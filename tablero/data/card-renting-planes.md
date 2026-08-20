---
id: 14
title: "Card de renting: planes, pago semanal y estados de carga"
ramas: motai-renting-planes, monto-actualizando, renting-sin-chips
stage: tasks
created: "2026-07-30T12:30:19-05:00"
context_nodes: [motai, creditopx]
jira: [CORE-323]
jira_title: "Renting: la tarjeta muestra plan y pago semanal, y el precio de la semana cambia según el plazo"
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

## Tarea (publicable)

## En una línea
La tarjeta de la entidad de renting ahora muestra el plan de alquiler y el pago semanal que le corresponde, y deja de mostrar información de cupo que no aplica a ese producto.

## Por qué
Renting no es un crédito: el cliente alquila por un tiempo y paga semanalmente. La tarjeta mostraba solo un monto y, encima, dos etiquetas de crédito ("Pre aprobado" y "Cupo disponible") que prometen algo que el producto no entrega. Y al cambiar el monto aparecía un aviso de texto mientras la tarjeta seguía mostrando el valor anterior, sin señal de que ese número estaba desactualizado.

## Qué cambia
- La tarjeta de renting muestra **Pago semanal** y un selector de **Plan**: Semana, Mes o Trimestre.
- **El precio de la semana cambia según el plazo**, igual que en la calculadora oficial de Motai: alquilar una sola semana sale **25% más caro** y comprometer un trimestre trae **6% de descuento**. Se paga siempre semanal; el plan es cuánto tiempo se alquila.
- En renting ya **no** se muestran "Pre aprobado" ni "Cupo disponible": ese cupo es un techo interno, no plata disponible para el cliente.
- Al cambiar el monto, el aviso de texto se reemplaza por **tres puntos de carga en el número mismo** (monto y pago), que aparecen desde que se escribe y desaparecen cuando llegan los valores nuevos.

## Alcance
- Aplica al comercio de renting y a las entidades configuradas con ese producto.
- **No** cambia las entidades de crédito: siguen mostrando sus etiquetas y su cuota como hoy.
- Las tarifas son configuración de la entidad: cambiarlas no requiere despliegue.
- Si el recálculo del monto falla, la tarjeta vuelve a mostrar el número (desactualizado) en lugar de quedarse cargando.

## Dónde probar
- Ambiente de pruebas · comercio de renting · marketplace de entidades.
- **Precondición:** comercio habilitado con la entidad de renting y un usuario que llegue al marketplace. La configuración de tarifas ya está cargada en el ambiente.

## Cómo validar
1. Con monto solicitado **$2.000.000**, la tarjeta muestra **Monto pre aprobado $8.330.000**, **Pago semanal $100.450** y el plan **Mes** preseleccionado.
2. Cambiar el plan a **Semana** → el pago semanal sube a **$125.563**. Cambiarlo a **Trimestre** → baja a **$94.423**. El monto pre aprobado no cambia.
3. Cambiar el monto → mientras se recalcula, aparecen **tres puntos** en el monto y en el pago (y **no** un texto debajo del campo); al terminar se ven los valores nuevos.
4. Regresión: una entidad de **crédito** sigue mostrando "Pre aprobado" y "Cupo disponible"; la de renting no.

## Criterios de aceptación
- [ ] La tarjeta de renting muestra pago semanal y selector de plan (Semana · Mes · Trimestre).
- [ ] Los tres planes dan los pagos esperados para un mismo monto (25% más caro por semana, 6% menos por trimestre).
- [ ] En renting no aparecen "Pre aprobado" ni "Cupo disponible".
- [ ] Al cambiar el monto se ven los tres puntos en el número, sin el aviso de texto.
- [ ] Las entidades de crédito no cambiaron su comportamiento.

## Dependencias / contraparte
Las tarifas salen de la calculadora oficial de Motai (pestaña Renting) y se reprodujeron con diferencia menor a un peso. Si negocio ajusta los factores por plazo, es un cambio de configuración de la entidad, sin despliegue.

**Estado del despliegue al crear la tarea:** las etiquetas de cupo ya están publicadas en el ambiente de pruebas. Los planes con su pago semanal y los puntos de carga **están pendientes de despliegue**: hasta que salgan, los puntos 1, 2 y 3 de la validación no se pueden verificar todavía.
