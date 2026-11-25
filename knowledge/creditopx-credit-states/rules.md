# Estados de un crédito CreditopX: vivos, Insolvencia y estados especiales

Qué estados puede tener un crédito CreditopX de consumo (`creditop_x_requests_history.creditop_x_requests_status_id`),
cómo entra y sale de cada uno, y qué cambia cada estado en los pagos, la causación, la cobranza, el bloqueo de
equipos, el cupo y lo que ven el cliente y el admin. Los cambios los escribe `legacy-application` (el admin y la noche
de cartera); `legacy-backend` también aplica pagos y decide qué ve y qué paga el cliente en la app. Describe `main` de
los dos monolitos y `main-pro` de la app. Las acciones de cartera que no cambian el estado (condonaciones,
refinanciación) están en [la cartera](../creditopx-portfolio-servicing/rules.md#acciones-del-admin-sobre-la-cartera).

## El catálogo y sus grupos

`CreditopXUserRequestStatus` (tabla `creditop_x_user_request_statuses`) tiene las mismas constantes en los dos
monolitos; el código compara por id, así que los ids son fijos:

| id | constante | qué es |
|---|---|---|
| 1 | `UP_TO_DATE` | Al día |
| 2 | `PAST_DUE` | En mora |
| 3 | `SETTLED` | Paz y salvo: el saldo cayó bajo la colilla de la entidad |
| 4 | `CANCELLED` | Cancelado (anulado) |
| 6 | `PRODUCT_RECOVERED` | Producto recuperado |
| 7 | `GUARANTEE_FUND_RECOVERED` | Recuperado por fondo de garantías |
| 8 | `EXTERNALLY_MANAGED` | Administrado externamente |
| 9 | `DECEASED` | Fallecido |
| 10 | `RESERVED_PARKED` | Reservado: sin fila en el catálogo, no se reutiliza |
| 11 | `FRAUD` | Fraude |
| 12 | `DISABILITY` | Incapacidad total o permanente |
| 13 | `INSOLVENCY` | Insolvencia |
| 14 | `DECEASED_RECOVERED` | Fallecido – Recuperado aseguradora |
| 15 | `DISABILITY_RECOVERED` | Incapacidad – Recuperado aseguradora |
| 16 | `FRAUD_RECOVERED` | Fraude – Recuperado por error en validación |

No hay id 5. Los grupos:

- **`LIVE`** = 1, 2, 13: el crédito tiene fila vigente y causa.
- **`SUSPENDED`** = 9, 11, 12: el crédito queda sin fila vigente y con el saldo quieto mientras se adelanta la
  reclamación. `CLAIM_RECOVERY` mapea cada uno a su recuperación (9→14, 12→15, 11→16); legacy-backend lista esas
  tres en `CLAIM_RECOVERED`.
- **`COLLECTABLE`** = 1, 2: los únicos que reciben gestión de cobranza. Insolvencia está viva pero fuera de la
  cobranza.
- **`SPECIAL_STATES`** (legacy-application): los nombres de 9, 11–16, que usa el admin.

Un crédito en Insolvencia guarda siempre 13, pague o no, así que su mora sale de `days_past_due`:
`CreditopXUserRequestStatus::isInArrears` (legacy-application) y `CreditopXRequestHistoryService::isInArrears`
(legacy-backend) cuentan como en mora el 2 y el 13 con días de mora. Con la misma idea,
`UpdateCreditopXRemoveOutstandingBalances::PAST_DUE_CAPABLE_STATUSES` = 2, 13.

## El estado del crédito y el de la fila

Cada fila del histórico tiene dos columnas ([el historial](../admin-panel/rules.md#el-historial-de-un-credito-creditopx-lleva-dos-estados)):
`creditop_x_requests_status_id`, el estado del crédito, y `status`, el de la fila: `0` reemplazada, `1` vigente,
`2` anulada, `3` paz y salvo, `5` reversada y `8` vigente de un crédito administrado externamente. Un crédito
**cerrado** en un estado deja una fila cuyo `status` es el id del estado: 6, 7, 9, 11, 12 o 14–16. Así:

- **Vivo** (1, 2, 13): fila con `status = 1`, la única que toman la causación, los pagos y la cobranza.
- **Suspendido** (9, 11, 12): fila con `status` igual al estado (`SpecialStateGate::isSuspendedRow`), con el saldo
  que tenía; puede estar condonada a 0 y seguir en su estado.
- **Recuperado por reclamación** (14–16), **producto recuperado** (6) y **fondo de garantías** (7): fila cerrada
  con su id como `status`.
- **Cancelado** (4): la misma fila vigente pasa a `status = 2` con estado 4.

La fila que manda es la más reciente sin contar `0` ni `5`: `SpecialStateGate::current` en legacy-application,
`CreditopXRequestHistory::currentCreditStatusId` y `getCurrentByUserRequest` en legacy-backend.

## Quién escribe un cambio de estado

Todo cambio hecho por una persona pasa por `App\Actions\CreditopX\States\CreditStateWriter` (legacy-application),
dentro de la transacción que abre cada acción:

- **`lockCurrent`** bloquea la solicitud (`user_requests`), la fila recibida y la más reciente del crédito. Si la
  fila que mandó la pantalla ya no es la más reciente (corrió la causación, entró un pago, otra persona lo
  gestionó), rechaza con `CreditChangeRejected` («recárgala»). También rechaza si el crédito tiene otra fila viva
  (`status` 1 u 8).
- **`close`** cierra el crédito: replica la fila con el id del estado como `status` y como estado (opcionalmente con
  `ZeroBalances::apply`) y apaga la anterior (`status = 0`). Queda sin fila vigente.
- **`open`** reemplaza la fila vigente por otra también vigente con otro estado (Insolvencia y «quitar estado»);
  sólo «quitar estado» le pone `leavesInsolvency`.
- **`record`** deja una fila en `creditop_x_credit_state_changes` (`action`, `from_status_id`, `to_status_id`,
  `from_history_id`, `to_history_id`, `frozen_balance` = saldo total antes del cambio, `reason`,
  `indemnified_amount`, `waived_amount`, `claim_entity`, `claim_reference`, `event_date`, `paid_at`, `note`,
  `corporate_user_id`) y un `creditop_x_log` con el antes y el después. Las acciones son `mark`, `recover`,
  `waive_loss`, `release`, `cancel`, `product_recovery` y `zero_balance`. Un índice único sobre la columna generada
  `recovery_marker` admite una sola `recover` por crédito.

`ZeroBalances::apply` pone en 0 los saldos, el exigible del período y lo que haría causar (`installment_value`,
`daily_interest`, `days_past_due`, `late_payment_principal_exclude`); no toca los `paid_*`, las fechas ni el número
de cuota. `ZeroBalances::owed` es la deuda: capital, interés, mora, seguro, seguro de fianza y cobranza.

Ninguna acción se aplica a una utilización de cupo rotativo (`revolving_credit_id`): rechazan con «se gestiona
desde el cupo» ([el cupo](../creditopx-revolving-credit/rules.md#gestionar-el-cupo-entero)).

## Plata en camino frena el cambio

`MoneyInTransit::rejection` revisa, antes de cancelar, recuperar un producto o suspender, que no haya plata del
cliente sin aplicar, porque después no habría fila vigente donde aplicarla:

- **Pagos retenidos** (`creditop_x_payments.payment_type_id = 1`, saldo a favor): frenan la cancelación y el
  producto recuperado. Al suspender no frenan: se aplican antes (ver marcar).
- **Pago en caja pendiente** (`creditop_x_payment_registers.status_id = 3`) de los últimos `WINDOW_DAYS` (3).
- **Transacción de pasarela** de la ventana que no sea cuota inicial: frena si sigue abierta (`PENDING`,
  `PENDINGFORPAYMENTMETHOD`, `STARTED` o sin estado conocido) o si está aprobada sin `CreditopXPaymentRegister`.
  Pasados `CONFIRM_WITH_GATEWAY_AFTER_MINUTES` (60) se pregunta a Wompi (`WompiReferenceLookup`): si no la conoce o
  la cerró sin cobrar, no frena; si la aprobó, cuenta como cobrada sin aplicar. Una transacción con aviso de plata
  sin aplicar (ver pagos) no frena.

## Cancelar y producto recuperado

- **Cancelar** (`CancelCredit`, ruta `solicitudes-originadas/{id}/anular`, `CancelRequest` con el permiso
  `cancel creditop x requests`): exige la fila vigente y un motivo, `retracto` u `operativa`
  (`CreditopXCreditStateChange::CANCELLATION_REASONS`), que se guarda en `reason` del cambio de estado; Cancelado
  sigue siendo un solo estado. Actualiza la misma fila (no crea otra): saldos a 0, `status = 2`, estado 4, y la
  solicitud a `user_request_status_id = 8`. El log `ANNULMENT` y el paso a `status 2` con estado 4 son lo que
  escucha el trigger del outbox.
- **Producto recuperado** (`MarkProductRecovered`, permiso `mark creditop x product as recovered`): exige la fila
  vigente, cierra con `close(..., 6, 'PRODUCTO RECUPERADO', zeroBalances: true)` y deja `product_recovery`.
- **Recuperado por fondo de garantías** (7, permiso
  `mark creditop x product as recovered by guarantee fund`): lo escribe
  `CreditopXRequestHistoryController::applyRecovery`, no `CreditStateWriter`: replica la fila vigente con `status` y
  estado 7 sin tocar saldos y apaga la anterior.

Las dos primeras pasan por `lockCurrent` y `MoneyInTransit` con los retenidos frenando. `creditop-x:zero-closed-balances`
(`ZeroClosedCreditBalancesCommand`) pone en 0, en la misma fila y con la acción `zero_balance`, los créditos
cancelados o en producto recuperado que conservaban saldo.

## Marcar un estado especial

`MarkSpecialState` (ruta `estado-especial`, permiso `mark creditop x credit special state`; `estado-especial/simular`
es la vista previa) marca 9, 11, 12 o 13 sobre la fila vigente:

- **Fallecido, Fraude o Incapacidad** se marcan desde 1, 2 o 13. Antes de cerrar aplica el saldo a favor
  (`applyRetainedPayments` de cada retenido) para que lo suspendido sea el neto; si ese saldo cubre toda la deuda,
  rechaza. Luego exige que no haya otra plata en camino y cierra con `close`: el crédito queda sin fila vigente, con
  el mismo saldo. Fuera de la transacción genera el estado de cuenta con el saldo suspendido
  (`GenerateSuspendedCreditStatement`, regenerable en `estado-especial/estado-de-cuenta`).
- **Insolvencia** se marca sólo desde 1 o 2, sin revisar plata en camino, con `open`: el crédito sigue vivo en una
  fila vigente con estado 13.

Movimientos `FALLECIDO`, `FRAUDE`, `INCAPACIDAD TOTAL O PERMANENTE` e `INSOLVENCIA`; logs `DECEASED`, `FRAUD`,
`DISABILITY` e `INSOLVENCY`. Guarda `event_date`, `note`, `claim_entity` y `claim_reference`. La vista previa lista
los otros créditos vivos de consumo del cliente (`otherLiveCredits`, recortados a los que el usuario ve) y cuenta
sus cupos rotativos activos; marcarlos es otra acción por crédito.

## Salir de un suspendido: reclamación, pérdida o quitar el estado

- **Recuperación por reclamación** (`SettleClaim`, ruta `reclamacion`, permiso `settle creditop x credit claim`):
  sobre un suspendido con saldo, un `indemnified_amount` mayor que 0 y no mayor que el saldo. Cierra en el estado de
  `CLAIM_RECOVERY` con saldos a 0 y guarda `indemnified_amount` y `waived_amount` (saldo − indemnizado). El
  desglose (`SettleClaim::breakdown`, orden cobranza, mora, interés, seguro, seguro de fianza, capital) sólo va al
  log. No crea pagos. Una sola por crédito.
- **Condonar la pérdida** (`WaiveSuspendedLoss`, ruta `condonar-perdida`, permiso
  `condone creditop x credit to settled`): saldos a 0 sin pago; el crédito se queda en su estado suspendido
  (movimiento `CONDONACIÓN POR PÉRDIDA`, log con `WAIVER_LABELS`).
- **Quitar el estado** (`ReleaseSpecialState`, ruta `quitar-estado-especial`, permiso
  `release creditop x credit special state`): vuelve a 1 o 2 según `days_past_due`. Desde Insolvencia sólo cambia
  el estado (`open` con `leavesInsolvency`). Desde un suspendido con saldo vuelve a dar fila vigente con el mismo
  saldo y reprograma las fechas (`ReleaseSpecialState::reschedule`): no se causa ni se factura el tiempo
  suspendido, y el corte queda en el futuro. Si las fechas cambiaron, regenera el plan de pagos
  (`RegenerateScheduleAfterRelease`). No aplica a un suspendido sin saldo, a un recuperado ni a un cancelado. Un
  crédito que pasó de Insolvencia a suspendido vuelve a 1 o 2, no a 13.

`creditop-x:insolvency-rollback` (`InsolvencyRollbackCommand`) saca de Insolvencia todos los créditos con
`ReleaseSpecialState` y, con `--restore`, los vuelve a marcar.

## La guardia que conserva Insolvencia

Lo que escribe la fila siguiente de un crédito (la causación, un pago, una condonación, un cambio desde la app)
calcula el estado como 1 o 2. En los dos modelos `CreditopXRequestHistory`, `booted()` → `creating` revisa la
fila anterior (sin las reversadas, con `lockForUpdate` si hay transacción abierta): si estaba en 13 y la que se crea
llega con 1 o 2, la deja en 13, salvo que traiga `leavesInsolvency = true`. Los demás estados pasan: paz y salvo,
cancelado, recuperado o un suspendido sí sacan el crédito de Insolvencia. `CorrectBackdatedPaymentDate::correctedStatus`
tampoco toca un 13.

## Pagos según el estado

Los dos motores bloquean la fila vigente antes de aplicar (`lockLiveRegister` en
`Admin\CreditopXPaymentController` de legacy-application; `CreditopXRequestHistoryRepository::lockActiveForPayment`
en legacy-backend), así que un pago y un cambio de estado sobre el mismo crédito van en fila
([el pago](../creditopx-payment-application/rules.md#dos-motores-con-la-misma-cascada)). Insolvencia recibe pagos
por el camino normal en todas las entradas.

`SpecialStateGate::paymentRejection` (legacy-application) dice que no recibe pagos un crédito sin fila vigente en
9, 11, 12, 14–16, Cancelado (4) o Producto recuperado (6):

- **Admin** (`store`), **pendiente de caja Pullman** (`storePending`) y **portal**
  (`Customer\CreditopXRequestHistoryController::registerPayment`) lo rechazan con un mensaje antes de cobrar.
- **Plata ya cobrada** que llega a `processPayment` (la consulta nocturna de Wompi, un pendiente de caja confirmado
  tarde): si el crédito está suspendido con saldo, `ApplyPaymentToSuspendedCredit` descuenta el monto de los saldos
  en el orden de la cascada en otra fila que sigue suspendida (`PAGO EN ESTADO ESPECIAL`, log
  `PAYMENT ON SPECIAL STATE`), sin recalcular mora ni avisar al cliente. Lo que no se aplica (el sobrante, o todo
  si no hay saldo o no es un suspendido) queda en `creditop_x_log` con tipo `UNAPPLIED PAYMENT SPECIAL STATE`, uno
  por transacción o recaudo (`flagUnappliedPayment`). El pendiente de Pullman que no se aplicó pasa a reversado y
  conserva su referencia.
- **App y Wompi (legacy-backend):** `createCuotaIntent` exige una fila `status` 1 u 8, así que no se crea la
  intención de un suspendido; el webhook, si no hay cartera activa y el crédito está en 9, 11, 12 o 14–16, deja el
  mismo aviso (`SpecialStateUnappliedPayment::flag`) y no aplica. `payments:reapply-unapplied-wompi`
  (`ReapplyUnappliedWompiPaymentsCommand`) y la reconciliación de legacy-application
  (`UpdateCreditopXNotAppliedWompiPaymentCommand::approvedWithoutPayment`) omiten una transacción con ese aviso.
- **Reversos:** `SpecialStateGate::reversalRejection` niega reversar un pago aplicado a un suspendido o uno anterior
  a un cambio de estado (`creditop_x_credit_state_changes.to_history_id >=` la fila del pago); un retenido sí se
  reversa.

## Causación, mora y colilla

La causación nocturna (`UpdateCreditopXRequestsCommand`, [la cartera](../creditopx-portfolio-servicing/rules.md#gasto-de-cobranza-por-dias-de-mora))
recorre las filas `status = 1`, así que causa 1, 2 y 13 y no toca los cerrados. `liveRowFor` relee la fila
bloqueada: si dejó de ser la vigente y el crédito no tiene otra (se suspendió, se canceló), esa noche no se causa y
queda el log `Causación omitida`. En 13 cuenta interés y días de mora igual, pero no carga el gasto de cobranza por
días de mora. La condonación de colilla (`UpdateCreditopXRemoveOutstandingBalances::isCondonable`) trata 2 y 13
igual ([la colilla](../creditopx-portfolio-servicing/rules.md#colilla-el-residuo-se-condona-en-el-corte)). La
auditoría diaria de legacy-backend `closed-and-live-history-coexist` (`HistoryChainAuditRepository::closedAndLivePairs`)
reporta un crédito con una fila viva y otra cerrada en 3, 9, 11, 12 o 14–16.

## Cobranza, recordatorios y bloqueo de equipos

- **Recordatorios:** los de `ReminderCreditopXRequestsCommand` (en los dos monolitos) y los semanales
  (`WeeklyReminderQuery`) filtran `whereIn('creditop_x_requests_status_id', COLLECTABLE)` además del estado de cada
  plantilla: ni 13 ni un cerrado reciben recordatorio aunque haya una plantilla configurada para él
  ([los recordatorios](../weekly-collection-reminders/rules.md#que-tiene-que-ser-cierto-para-que-un-credito-reciba-algo)).
- **Bloqueo:** los dos motores de bloqueo de legacy-backend (`LockDevicesPastDueCommand` y
  `LockCandidateRepository` del módulo) toman sólo `creditop_x_requests_status_id = 2`: un 13 en mora no se
  bloquea.
- **Desbloqueo:** `app:unlock-devices-paid` (`UnlockDevicesPaidCommand::unlockCandidates`) desbloquea filas
  vigentes en 1 o 3, o en 13 con `days_past_due = 0`. El desbloqueo al pagar del módulo
  (`UnlockDeviceOnPaymentService`) usa `CREDIT_STATUS_CURRENT = 1` o la colilla, así que un 13 al día espera a la
  corrida nocturna. En legacy-application, `PredictStandingAfterCore::standingStatus` trata un 13 como 1 o 2 según
  sus días de mora ([el desbloqueo](../device-locking/rules.md#desbloqueo-y-liberacion)).

## Cupo y capacidad de pago

- **Bloqueo de otro crédito:** `ActiveCreditRuleEvaluator::evaluateSpecialStates` (legacy-backend) corre primero en
  `available-quota` (`CreditopXQuotaController`) y en `RevolvingHardPolicyGate`. Rechaza con
  `special_state_credit_exists` si la última fila de algún crédito de la persona, con cualquier entidad, está en
  9, 11, 12, 14, 15 o 16 con `status` igual al estado (`ActiveCreditRepository::BLOCKING_SPECIAL_STATES`).
  Insolvencia no bloquea, y quitar el estado deja de bloquear. Un cupo rotativo ya aprobado se devuelve antes de esa
  compuerta ([el diagnóstico](../creditopx-setup-diagnosis/rules.md#diagnostico-salio-sin-cupo)).
- **Crédito activo con la entidad:** `ActiveCreditRepository::ACTIVE_REGISTER_STATUSES` cuenta como activo la fila
  vigente y también la de un suspendido.
- **Capacidad:** `CreditopXDatacreditoAdjustmentService::getCoreBankingInstallments` suma la cuota de las filas
  vigentes y de los suspendidos con `principal_amount_balance > 0`.

## Lo que ve el cliente

En legacy-backend, que atiende la app:

- **Fallecido y su recuperación** (`HIDDEN_FROM_CLIENT` = 9, 14) no se muestran: `debt-summary`, la información de
  pago (`ConsumerPaymentInfoService`), el resumen del crédito, la vista previa pública de Wompi
  (`PaymentIntentService::preview`) y `findPaymentInfoCredit` responden como si el crédito no existiera.
- **Fraude e Incapacidad** (`CLIENT_VISIBLE_SUSPENDED` = 11, 12) salen en la lista
  (`getSuspendedVisibleToClientByUser`, `clientVisibleSuspendedRow`) con `payment_allowed = false`, montos en null y
  sin sumar a la deuda total.
- **La etiqueta:** `clientLabel` muestra «En revisión» (`config('creditop_x_states.client_label')`,
  `CREDITOP_X_SPECIAL_STATE_CLIENT_LABEL`) en lugar del nombre de 9, 11, 12 y 14–16, y `clientStatusId` responde
  `null` como id. Insolvencia se muestra con su nombre.
- **`payment_allowed`:** en `DebtSummaryService` es verdadero si el estado está en `LIVE`; en la información de pago,
  si hay fila `status` 1 u 8 (`hasPayablePortfolio`), la misma compuerta de `createCuotaIntent`. La app
  (`PaymentInfo.canPay`) paga sólo con `payment_enabled && payment_allowed`
  ([Mis créditos](../creditop-mobile/rules.md#mis-creditos)).

## Lo que ve el admin

El detalle del crédito (`CreditopXRequestHistoryController@show`) manda `specialState` = `CreditStateSummary::of`,
que pinta la tarjeta de estados especiales (salvo en una utilización): estado, saldo, qué estados se pueden marcar
(los cuatro desde 1 o 2; los tres suspendidos desde 13), si se puede registrar la reclamación, condonar la pérdida,
quitar el estado o generar el estado de cuenta, el historial de `creditop_x_credit_state_changes` y los pagos con
aviso `UNAPPLIED PAYMENT SPECIAL STATE`. El servidor vuelve a exigir el permiso en cada ruta y
`CreditopXCreditStateController::onlyOwnCredit` responde 404 si el usuario no ve el crédito en su listado. El
tablero cuenta aparte los estados especiales (9, 11, 12, 13) y las recuperaciones (14–16), fuera de «al día»; el
reporte de riesgo (`CreditopXRiskController`) los saca de las franjas de mora por su nombre
(`isSpecialStateName`). El listado y su exporte muestran el motivo de cancelación
(`CreditopXCreditStateChange::cancellationReasons`).

## Límites

- **Cupo rotativo:** ninguna acción de estado se aplica a una utilización, y no hay estados especiales para la línea
  del cupo: `RevolvingHardPolicyGate` sólo frena el otorgamiento.
- **Pagos que difieren entre monolitos:** legacy-application aplica la plata tardía a un suspendido con saldo;
  legacy-backend nunca la aplica y sólo deja el aviso. El aviso de legacy-backend cubre 9, 11, 12 y 14–16, no
  Cancelado ni Producto recuperado; `paymentRejection` de legacy-application sí los cubre.
- **Fondo de garantías (7):** no pasa por `CreditStateWriter` ni `MoneyInTransit`, no deja fila en
  `creditop_x_credit_state_changes` y no está entre los estados que `paymentRejection` reconoce.
- **Sin cobranza no es sin mora:** Insolvencia sigue causando y contando días de mora; sólo quedan fuera los
  recordatorios, el bloqueo y el gasto de cobranza.
- **Bloqueo por persona:** las recuperaciones por reclamación siguen bloqueando otro crédito y ninguna acción del
  admin lo levanta, salvo quitar el estado a un suspendido con saldo.
- **El nombre que ve el cliente** se cambia por configuración, sin código; los estados 9 y 14 no se muestran.
