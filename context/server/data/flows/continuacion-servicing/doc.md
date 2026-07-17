# Continuación / servicing · flujo
> **estado:** al día con main · La **2ª mitad** del ciclo de vida, **después del Estado 11**: cartera, causación, mora y cobranza. Solo existe como ciclo REAL para CreditopX in-platform (rt=2/3); corre 100% en `application`.

<!-- Este flujo arranca donde terminan los de originación (Estado 11 = desembolsado). No repite la originación; enlaza a creditopx. Es el subdominio cartera/servicing/billing/collections. -->

## Qué es
La originación **termina en el Estado 11** ("Autorizada" = desembolsado). La continuación **empieza ahí, pero SOLO existe para CreditopX in-platform (rt=2/3)**: el préstamo vive como una cadena de snapshots en el ledger `creditop_x_requests_history` (event-sourced), los pagos entran por **polling** y se aplican en cascada, y 6 crons diarios causan interés, facturan, entran en mora y cobran. Para **rt≠0 el rastro se detiene en el 11/26**: el préstamo lo gestiona la API del lender externo, y guards explícitos frenan cualquier re-update tras el 11.

> **Negocio:** en CreditopX el **capital y el riesgo son del comercio**, no de CreditOp; CreditOp **opera** la cobranza y gana **comisión por recaudo**. Lo de abajo es la operación, no la propiedad del capital.

| Pregunta | Respuesta |
|---|---|
| ¿Quién opera la cartera? | **CreditOp** (in-platform, rt=2/3) vía 6 crons + ledger propio. Para rt≠0 la gestiona el lender externo (CreditOp no se entera). |
| ¿Quién pone la plata / cobra? | El **comercio** pone el capital/riesgo; CreditOp opera el recaudo y cobra comisión. |
| ¿Cómo cierra? | **Paz y salvo** (`creditop_x_requests_status_id=3` cuando `total_payment_amount==0`) o **Cancelado** (4, anulación manual del cupo). La mora (2) es indefinida; no hay estado "castigo" persistido (es un bucket derivado `dias_mora>180` + venta de cartera manual). |
| ¿Simulable E2E? | **Parcial**: in-platform sí (sembrar el ledger + **invocar los crons a mano** + simular el pago por polling); rt≠0 **no** (lo gestiona un tercero). Hoy en legacy **0 superficies activas** → probar contra `application`. |

## Cómo funciona
**Los 6 crons diarios** (`app/Console/Kernel.php`, en orden de cadencia):

| Hora | Comando | Qué hace | Estado |
|---|---|---|---|
| 00:02 | `update-creditop-x-not-applied-wompi-payment` | Red de seguridad del polling (re-despacha `StatusCheck` sobre transacciones Wompi de ayer, `lender_id=52`) | — |
| 00:10 | `update-creditop-x-remove-outstanding-balances` | Condona "colillas" (exigible ≤ umbral, default 5000) ANTES del corte; solo NO-revolving | 1 |
| **00:30** | `update-creditop-x-requests-command` | **EL NÚCLEO**: causación de interés diario, fecha de corte/facturación, entrada en mora, gasto de cobranza | 1 ↔ 2 |
| 03:30 | `update-creditop-x-apply-payment-command` | Aplica pagos RETENIDOS a la cuota facturada (`applyRetainedPayments`) | → 3 posible |
| 04:00 | `update-creditop-x-revolving-credits-command` | Agrega utilizaciones del cupo rotativo (rt=3), resuelve mora del cupo | 1 ↔ 2 (cupo) |
| 09:30 | `reminder-creditop-x-requests-command` | Dunning/recordatorios (preventivo 1 / mora 2) por SMS/email/WhatsApp | — |

(`incentive-revolving-credits` ~10:00 está **DESACTIVADO** — SIDs de Twilio sin aprobar.)

**Recorrido del préstamo:**
1. **Nacimiento (post-11):** `CreditopXRequestHistoryController::createFirstRegister` crea la 1ª fila (`movement_type='CREACIÓN'`, `status=1`, `creditop_x_requests_status_id=1`), invocado desde `ConsentController:196` tras el 11. Si es rotativo (rt=3) incrementa `used_limit`/`billing_used_limit` en el `RevolvingCredit` (= UTILIZACIÓN del cupo).
2. **Causación diaria (00:30):** interés del día = `billing_principal_amount * rate/30`; anexa fila nueva `status=1`, marca la anterior `status=0`.
3. **Fecha de corte / facturación (00:30):** arma el pago mínimo (`principal + interés + seguros + FGA + mora`), amortiza capital, recalcula seguro de vida, avanza `installment_number`; soporta esquema quincenal (`cutoff_type_id==2`).
4. **Mora (00:30, si `next_payment_date < hoy`):** `days_past_due += 1`, `status_id=2`, interés de mora + **gasto de cobranza fijo por rango** (`LenderCollectionChargeService`, una vez al entrar al rango). Recuperación: `2 → 1` si se cubre el exigible.
5. **Ingreso de pago (evento, NO cron):** Wompi/Payvalida se confirman por **polling** (`Jobs/Lenders/Wompi/StatusCheck`, `tries=60`), luego `CreditopXPaymentController::processPayment` aplica en **cascada de imputación**: `gasto de cobranza → mora → interés → seguro de vida → seguro de garantía → capital` (el excedente reduce capital).
6. **Paz y salvo:** cuando `total_payment_amount == 0`, `applyPayment` fija `status=3` + `creditop_x_requests_status_id=3`.
7. **Cupo rotativo (rt=3):** al pagar capital libera cupo para reuso con **FGA proporcional** (`corresponding_fga = paid_principal − paid_principal × used_limit/billing_used_limit`); el cron 04:00 resuelve mora del cupo pero NO toca `used_limit`.

## Estados y códigos
**DOS máquinas de estado independientes que se confunden** (el Estado 11 es el puente):
- **Catálogo A — `user_request_statuses`** (la SOLICITUD/originación, hasta 11/26): 1 Nueva · 3 Selección · 6 Negada · 7 Vencida · 8 Cancelada · 9 Perfil · 10 Pendiente autorización · **11 Autorizada (terminal de originación)** · 21 stand-by · 25 pendiente desembolso · 26 Facturado. ⚠ Sin seeder ni INSERT (ids reconstruidos de código; 2 y 7 los menos confirmados).
- **Catálogo B — `creditop_x_user_request_statuses`** (el PRÉSTAMO in-platform, **el que importa post-11**): **1 Al día · 2 En mora · 3 Paz y salvo · 4 Cancelado**. ⚠ El seeder solo crea 1 y 2; los ids 3 y 4 se usan en código pero viven solo en la BD real.
- **`status` sobrecargado** (3 sentidos, no confundir): en la fila del ledger 1=vigente/0=histórico/3=paz y salvo/5=reversado; en `RevolvingCredit` 1/0=cupo activo/inactivo; y aparte `creditop_x_requests_status_id` (1/2/3/4) = estado del crédito.
- Catálogo global → raíz.

## Sistemas externos
- **Wompi / Payvalida** (pasarela de recaudo): los pagos se confirman por **polling** (`StatusCheck`, `ttl=18000s`), NO por webhook. El cron 00:02 es la red de seguridad (hardcodeado a `lender_id=52`).
- **Twilio / SMS / email** (dunning): recordatorios preventivos y de mora (cron 09:30) + los reportes recurrentes.
- **Corbeta** (facturación/conciliación rt=1 Bancolombia): cruza por PIN y confirma consumo; sube a estado 26 FACTURADO. (Comparte superficie con el nodo `agregadores`.)

## Dónde mirar
- **Crons / causación / cartera** (application): `app/Console/Kernel.php`, `Commands/{UpdateCreditopXRequestsCommand,UpdateCreditopXRemoveOutstandingBalances,UpdateCreditopXApplyPaymentCommand,UpdateCreditopXRevolvingCreditsCommand,ReminderCreditopXRequestsCommand,UpdateCreditopXNotAppliedWompiPaymentCommand,IncentiveRevolvingCreditsCommand}.php`.
- **Ledger / pagos / cierre** (application): `CreditopXRequestHistoryController` (`createFirstRegister`), `CreditopXPaymentController` (`processPayment` cascada, `applyRetainedPayments`, `reversePayment`), `CreditopXPaymentManageController`, `ConsentController`, `VoucherController`, `Api/PayvalidaController`.
- **Revolving (rt=3)** (application): `RevolvingCreditsController` (disable→4), `CreditopXRevolvingCreditPaymentController` (FGA proporcional), models `RevolvingCredit`/`RevolvingCreditHistory`/`CreditopXRevolvingCreditPayment`.
- **Cobranza / gasto por mora** (application): `Services/lenders/LenderCollectionChargeService.php` + `Models/CreditopXLenderCollectionCharge.php` + `CreditopXLenderResidualBalance` (umbral de colilla).
- **Pago por polling** (application): `Actions/Lenders/{Wompi,Payvalida}.php`, `Jobs/Lenders/Wompi/{StatusCheck,CheckStatus}.php`.
- **Modelos del ledger** (application): `CreditopXRequestHistory`, `CreditopXUserRequestStatus`, `CreditopXPayment`, `CreditopXConsent`, `UserRequestStatus`, `Observers/UserRequestObserver` (⚠ NO es el motor de estados — solo bonos/gamificación).
- **Reportes / conciliación** (application): `Commands/{DailyReport,AlliedsDailyReport,LenderDisbursementsReport,ConsumerLoansWeeklyReport,Report,CorbetaConciliationReport}Command`, `CorbetaConciliationReportController`, `EndOfMonthReportController`, `Exports/{DailyReport,AlliedsDailyReport,CreditopXRequestsReport,RevolvingCredits}Export`.
- **Bonificación Credifamilia** (application): `Jobs/Lenders/Credifamilia/{BonificationCheck,SendBonificationReport}`, `Models/Bonification`.
- **Cierre al comercio + riesgo** (application): `Customer/WoocommerceController` (POST al comercio en 11), `Admin/CreditopXRiskController` (cartera-por-riesgo, venta de cartera).
- **Recaudo Pullman** (application): `Services/PullmanService`, `Repositories/PullmanRepository`, `Jobs/ValidatePullmanPayment` (SQL Server `pullman_db`).
- **Estado de migración** (legacy-backend): `app/Console/Kernel.php` (**prueba: 0 crons de servicing**), `Modules/Loans/App/Services/CreditopXPaymentService.php` (copia muerta, firma vieja), `Modules/Payments/App/Services/{CustomerPaymentService,PaymentLinkService}.php` (crea links pero NO imputa al ledger), `Modules/System/.../EndOfMonthReportController.php` (reconstruido), `Modules/Onboarding/App/Services/EcommerceRequestService.php` (**la notif de cierre SÍ migró**), stubs `app/Services/PullmanService.php`+`app/Repositories/PullmanRepository.php`.

## Frontera de simulación / harness
**El servicing corre 100% en `application`; en legacy hay 0 superficies activas** (copias muertas con imports colgantes que reventarían si se agendaran). Cualquier prueba de cartera va contra application.
- **Inyectable (in-platform):** el nacimiento del ledger (`createFirstRegister`, síncrono tras el 11), la causación, el corte, la mora y el cierre por pago total (paz y salvo NO exige firma externa — es interno).
- **Cómo probar (honesto):** (1) crear el crédito, (2) mover `next_billing_date`/el reloj a mano, (3) **invocar los comandos artisan en el orden del Kernel** (00:10 → 00:30 → 03:30 → 04:00) — no basta esperar, hay que **disparar los crons**, (4) verificar la nueva fila `status=1` y el `creditop_x_requests_status_id`.
- **Pago:** Wompi/Payvalida por **polling** (no webhook) → simular la `PaymentGatewayTransaction` aprobada o `dispatchSync` el `StatusCheck`, luego correr `apply-payment`.
- **rt≠0 = NO sintetizable** (decide/gestiona un tercero).
- **Relevante al OKR:** el cron 00:30 carga TODA la cartera **sin chunking** (`:42-43`) → revienta a escala; y **no hay alerting estructurado** — las excepciones notifican a `laura.cabra@creditop.com` **hardcodeado (~10 veces)**. Punto natural para instrumentar salud/alertas.

## Datos de prueba / usuario que pasa
Para ejercer el servicing (in-platform) hay que **sembrar el ledger** `creditop_x_requests_history` a mano y disparar los crons: fila `status=1` + `creditop_x_requests_status_id=2` + `next_payment_date < hoy` para probar **mora**; `status IN [1,3]` para **al día/recuperación**; `total_payment_amount==0` para **paz y salvo**. El pago requiere simular una `PaymentGatewayTransaction` Wompi aprobada (o `dispatchSync` el `StatusCheck`). No hay "usuario que aprueba": la decisión ya ocurrió en originación; esto es post-11.

## Gotchas / riesgos
- **DOS máquinas de estado que se confunden** (`user_request_status_id` originación ≠ `creditop_x_requests_status_id` préstamo); el 11 es el puente.
- **`status` sobrecargado en 3 sentidos** (vigencia de fila / activo-inactivo de cupo / estado del crédito).
- **Seeder engañosamente incompleto**: `CreditopXUserRequestsStatusesSeeder` solo siembra 1 y 2; los ids 3/4 viven solo en la BD real. Y `user_request_statuses` **no tiene seeder ni INSERT** (ids 2/7 sin confirmar).
- **Umbral de colilla 5000 hardcodeado disperso** (~6 sitios); un lender sin `residualBalance` cae al default → puede ocultar centavos en un "saldado".
- **Pagos por polling, no webhook**: el cron 00:02 (red de seguridad) está hardcodeado a `lender_id=52` y `status_id [21,23]` → otra pasarela colgada no se recoge.
- **`UserRequestObserver` NO es el motor de estados** (pese al nombre): solo bonos/gamificación. Las transiciones están dispersas imperativamente en ~15 controllers + 5 crons.
- **Cron 00:30 sin chunking** (carga toda la cartera viva en memoria) · **`cutoff_type_id==2`=quincenal** bifurca fechas en 4 sitios · **`incentive-revolving` desactivado**.
- **Copias en legacy con imports colgantes** (`use App\Http\Controllers\Admin\CreditopXPaymentController` — namespace equivocado): no es "migración parcial funcional", es código muerto que reventaría.
- **Riesgo trigger huérfano**: apagar `application` rompería la cartera — el cron que mueve el ledger vive solo ahí.

## Preguntas abiertas
- [ ] Nombres/ids EXACTOS de `user_request_statuses` (sin seeder → requiere `SELECT id,name` en prod).
- [ ] ¿Hay notificación de **PAZ Y SALVO** (status=3) hacia el comercio/lender? No localizada (sí existe el aviso de Estado 11).
- [ ] ¿El parallel-run comparte la MISMA RDS? Si sí, legacy origina (11) y application "continúa" el MISMO `CreditopXRequestHistory` → el ciclo ya sería compartido a nivel de datos. Confirmar `DB_HOST` de prod.
- [ ] ¿rt≠0 recibe algún evento de cobranza/mora/cierre del tercero post-facturación, o el rastro termina 100% en 26?
- [ ] ¿La versión vieja del motor de servicing copiada en legacy es intento abandonado o punto de partida vigente? (determina borrarla o retomarla).

## Diferencias vs otros flujos
- **vs los flujos de originación (creditopx/smartpay/motai/credifamilia/agregadores):** ellos terminan en el Estado 11; este EMPIEZA ahí. No hay decisión de crédito acá — es cartera/cobranza.
- **vs rt≠0 (agregadores, Credifamilia rt=4):** para ellos NO hay ciclo de vida en CreditOp (prueba negativa: todos los crons post-desembolso son `creditop_x_*`); el préstamo lo gestiona el lender y CreditOp no ve la mora/cierre. **SmartPay** es el caso especial que CONSUME este ledger: sus 3 crons de device-lock leen `creditop_x_requests_history` (mora → bloquea el celular).

## Bitácora
- **2026-07-17** — Nodo creado desde la raíz. Superficie curada: **60 archivos** (application 52 · legacy-backend 8), 60/60 resuelven. Fuente `CONTINUACION-CREDITO-ANALISIS.md` (verified-deep). Es la 2ª mitad del ciclo; los 8 archivos de legacy documentan el estado de migración (servicing = 0 superficies activas, fuera del alcance de la migración de originación).

## Enlaces
- Análisis maestro (fuente del `archivo:línea`): `docs/codigo/CONTINUACION-CREDITO-ANALISIS.md`.
- Estado de migración: `docs/codigo/ESTADO-MIGRACION.md` (§ "OUT = servicing") · `docs/codigo/PENDIENTES-MIGRACION.md` (P2.1/P2.2).
- Flujo del que hereda el Estado 11: nodo **creditopx**. Caso especial que consume el ledger: nodo **smartpay** (device-lock).
- Memorias: `continuacion-credito-servicing` · `creditopx-modelo-comercio` (economía comisión) · `synth-lender-type-boundary`.
