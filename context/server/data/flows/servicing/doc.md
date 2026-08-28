# Servicing · contexto
> **estado:** al día con main **con una corrección** (2026-07-19) · La **2ª mitad** del ciclo de vida, **después del Estado 11**: cartera, causación, mora y cobranza. Solo existe como ciclo REAL para CreditopX in-platform (rt=2/3); corre 100% en `application` **salvo el device-lock de SmartPay** (ver abajo).

> ⚠ **CORRECCIÓN (2026-07-19, ver [findings F-39]):** la afirmación "0 crons de servicing en legacy" **ya no es cierta**. `app/Console/Kernel.php` de legacy-backend agenda HOY los 3 crons de cobranza por hardware (`app:lock-devices-past-due` 04:00 · `unlock-devices-paid` 05:00 · `unroll-devices-paid` 06:00) y **funcionan en local**: sembrando mora en `creditop_x_requests_history` (status 2, `days_past_due>=8`) sobre una solicitud con IMEI enrolado, el cron despacha el job, llama al MDM y persiste `device_locks` en `locked`. Receta completa y gotcha del contrato (`devices[]` → `results[]`) en el nodo **findings** (F-39). El RESTO del servicing (cascada de cobranza, intereses, seguros, capital) sí sigue 100% en `application`.

## Qué es
La originación **termina en el Estado 11** ("Autorizada" = desembolsado). La continuación **empieza ahí, pero SOLO existe para CreditopX in-platform (rt=2/3)**: el préstamo vive como una cadena de snapshots en el ledger `creditop_x_requests_history` (event-sourced), los pagos entran por **polling** y se aplican en cascada, y 6 crons diarios causan interés, facturan, entran en mora y cobran. Para **rt≠0 el rastro se detiene en el 11/26**: el préstamo lo gestiona la API del lender externo, y guards explícitos frenan cualquier re-update tras el 11.

> **Negocio:** en CreditopX el **capital y el riesgo son del comercio**, no de CreditOp; CreditOp **opera** la cobranza y gana **comisión por recaudo**. Lo de abajo es la operación, no la propiedad del capital.

| Pregunta | Respuesta |
|---|---|
| ¿Quién opera la cartera? | **CreditOp** (in-platform, rt=2/3) vía 6 crons + ledger propio. Para rt≠0 la gestiona el lender externo (CreditOp no se entera). |
| ¿Quién pone la plata / cobra? | El **comercio** pone el capital/riesgo; CreditOp opera el recaudo y cobra comisión. |
| ¿Cómo cierra? | **Paz y salvo** (`creditop_x_requests_status_id=3` cuando `total_payment_amount==0`) o **Cancelado** (4, anulación manual del cupo). La mora (2) es indefinida; no hay estado "castigo" persistido (es un bucket derivado `dias_mora>180` + venta de cartera manual). |
| ¿Simulable E2E? | **Parcial**: in-platform sí (sembrar el ledger + **invocar los crons a mano** + simular el pago por polling); rt≠0 **no** (lo gestiona un tercero). En legacy corren 3 crons de device-lock (SmartPay) que **consumen** el ledger (ver F-39); el resto de la cartera se prueba contra `application`. |

## Antes de concluir
- 🔴 **BUG VIVO: reversar un pago RETENIDO revienta con un fatal.** `reversePayment:1378` resuelve el
  tipo con `where('name','PAGO REVERSADO')`, y la fila de la tabla se llama **`REVERSADO`** (id 8) —
  `first()` devuelve `null` y `null->id` tira `Attempt to read property "id" on null`. Solo dispara en
  esa rama (`:1377`, pagos aún sin aplicar); las otras dos —ya aplicado, ya reversado— funcionan. En el
  dump local hay **56 pagos en RETENIDO**, o sea que es alcanzable. Ver **F-126**.
- ⚠ **`movement_type` del ledger está vacío en el 90 % de las filas** (194.113 de ~214.700 en el dump
  local). Reconstruir la historia de un crédito filtrando por `movement_type` pierde casi todo: los
  nombres (`FECHA DE CORTE` 7.050 · `APLICACIÓN DE PAGO` 5.894 · `CONDONACIÓN DE COLILLAS` 4.897 ·
  `CREACIÓN` 2.419) solo cubren los hitos, no la causación diaria.
- ⚠ **El «medio de pago» lo decide QUIÉN registra, no cómo se pagó**: `payment_method` sale de
  `corporate_user_id > 0 ? 'Cajas' : 'PSE'` (`:90`). Un pago cargado por un usuario corporativo queda
  como «Cajas» aunque haya entrado por pasarela. No sirve para conciliar contra el proveedor.
- **El seguro de vida se cobra solo si `insurance_balance > 0`** (`:133`), condición que la cascada
  simple no muestra: un crédito con el seguro ya saldado saltea ese escalón y el excedente baja antes
  a capital.
- **Sin sucursal, el pago se imputa a la 17**: `allied_branch_id ?? 17` (`:85`), con el comentario
  «si no tiene branch seríamos nosotros». Los reportes por sucursal heredan ese default.
- **DOS máquinas de estado que se confunden** (`user_request_status_id` originación ≠ `creditop_x_requests_status_id` préstamo); el 11 es el puente.
- **`status` sobrecargado en 3 sentidos** (vigencia de fila / activo-inactivo de cupo / estado del crédito).
- **Seeder engañosamente incompleto**: `CreditopXUserRequestsStatusesSeeder` solo siembra 1 y 2; los ids 3/4 viven solo en la BD real. Y `user_request_statuses` **no tiene seeder ni INSERT** (ids 2/7 sin confirmar).
- **Umbral de colilla 5000 hardcodeado disperso** (~6 sitios); un lender sin `residualBalance` cae al default → puede ocultar centavos en un "saldado".
- **Pagos por polling, no webhook**: el cron 00:02 (red de seguridad) está hardcodeado a `lender_id=52` y `status_id [21,23]` → otra pasarela colgada no se recoge.
- **`UserRequestObserver` NO es el motor de estados** (pese al nombre): solo bonos/gamificación. Las transiciones están dispersas imperativamente en ~15 controllers + 5 crons.
- **Cron 00:30 sin chunking** (carga toda la cartera viva en memoria) · **`cutoff_type_id==2`=quincenal** bifurca fechas en 4 sitios · **`incentive-revolving` desactivado**.
- **Copias en legacy con imports colgantes** (`use App\Http\Controllers\Admin\CreditopXPaymentController` — namespace equivocado): no es "migración parcial funcional", es código muerto que reventaría.
- **Riesgo trigger huérfano**: apagar `application` rompería la cartera — el cron que mueve el ledger vive solo ahí.

## Contenido
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

⚠ **El cron de las 03:30 ahora deja rastro de lo que NO aplicó** (`UpdateCreditopXApplyPaymentCommand.php`,
2026-07-30). Antes un pago retenido que no se podía aplicar se perdía en silencio; hoy hay dos casos
explícitos, cada uno con `DB::rollBack()` **de esa transacción sola** y una fila en `logs`:
`SIN HISTÓRICO VIGENTE` (no hay fila con `status = 1` donde aplicar) y
`NO APLICADO POR VALIDACIÓN DE MONTO` (el histórico vigente tiene `next_payment_amount <= 0`, o sea no
hay cuota pendiente → el pago **sigue retenido** hasta el próximo ciclo de facturación). Los fallos se
acumulan y se registran juntos al final de la corrida. Si un pago "desapareció", empezá por esos logs.

**Hay pantalla de detalle del cupo rotativo** (`/cupos-rotativos/{revolvingCredit}`,
`routes/customer.php`): movimientos, pagos y documentos. El cálculo lo arma `buildDetailPayload` y se
**comparte** entre el detalle de admin (`Admin\RevolvingCreditsController`) y el de aliados
(`Customer\RevolvingCreditsController`), a propósito, para que las dos pantallas muestren lo mismo.

**Recorrido del préstamo:**
1. **Nacimiento (post-11):** `CreditopXRequestHistoryController::createFirstRegister` crea la 1ª fila (`movement_type='CREACIÓN'`, `status=1`, `creditop_x_requests_status_id=1`), invocado desde `ConsentController:196` tras el 11. Si es rotativo (rt=3) incrementa `used_limit`/`billing_used_limit` en el `RevolvingCredit` (= UTILIZACIÓN del cupo).
2. **Causación diaria (00:30):** interés del día = `billing_principal_amount * rate/30`; anexa fila nueva `status=1`, marca la anterior `status=0`.
3. **Fecha de corte / facturación (00:30):** arma el pago mínimo (`principal + interés + seguros + FGA + mora`), amortiza capital, recalcula seguro de vida, avanza `installment_number`; soporta esquema quincenal (`cutoff_type_id==2`).
4. **Mora (00:30, si `next_payment_date < hoy`):** `days_past_due += 1`, `status_id=2`, interés de mora + **gasto de cobranza fijo por rango** (`LenderCollectionChargeService`, una vez al entrar al rango). Recuperación: `2 → 1` si se cubre el exigible.
5. **Ingreso de pago (evento, NO cron):** Wompi/Payvalida se confirman por **polling** (`Jobs/Lenders/Wompi/StatusCheck`, `tries=60`), luego `CreditopXPaymentController::processPayment` aplica en **cascada de imputación**: `gasto de cobranza → mora → interés → seguro de vida → seguro de garantía → capital` (el excedente reduce capital).
6. **Paz y salvo:** cuando `total_payment_amount == 0`, `applyPayment` fija `status=3` + `creditop_x_requests_status_id=3`.
7. **Cupo rotativo (rt=3):** al pagar capital libera cupo para reuso con **FGA proporcional** (`corresponding_fga = paid_principal − paid_principal × used_limit/billing_used_limit`); el cron 04:00 resuelve mora del cupo pero NO toca `used_limit`.

### El pago por dentro (`CreditopXPaymentController`, 1.696 líneas — leído 2026-08-08)

Tres mecanismos que no se deducen de la cascada y explican la mayoría de los «no cuadra»:

**1 · La bifurcación de entrada es la fecha de corte, no el monto.**
`application/app/Http/Controllers/Admin/CreditopXPaymentController.php:62` (`processPayment`) mira
`last_register->next_payment_amount`: si es `> 0` (ya hubo corte) **aplica el pago ya**; si no, lo
**RETIENE** —lo guarda como `payment_type_id = 1 RETENIDO`— y recién lo aplica el cron de las 03:30 vía
`applyRetainedPayments:1088`. Un pago hecho antes del corte no mueve el saldo el mismo día, y eso no
es un error: es el diseño.

**2 · La idempotencia existe pero es MUDA.** Si llega un pago con un `payment_gateway_transaction_id`
que ya tiene registro, el método hace `return` **sin excepción, sin log y sin valor de retorno**
(`:64-67`). Para el que llama es indistinguible de un pago aplicado con éxito. Al depurar un pago
«que se perdió», descartá esto primero mirando `creditop_x_payment_register` por esa transacción.

**3 · Reversar NO borra: reescribe cuál fila del ledger es la vigente.**
`application/app/Http/Controllers/Admin/CreditopXPaymentController.php:1377` (`reversePayment`) marca la
fila actual `status=0`, la del pago `status=5`, **restaura la anterior a `status=1`** y arrastra el
`next_register` a 5. Por eso el saldo de un crédito es siempre «la fila con `status=1`», nunca la
última por fecha — y por eso una reversa mal cortada deja dos filas vigentes o ninguna.

El catálogo que ordena todo esto es **`creditop_x_payment_types`** (verificado en BD local, 2026-08-08):
**1** RETENIDO · **2** ABONO A CAPITAL · **3** PAGO A CUOTA · **4** PAGO TOTAL · **5** CONDONACIÓN
INTERESES · **6** DESC. 5% SOBRE CAPITAL · **7** PAGO CUOTA INICIAL · **8** REVERSADO.

### Cambiarle las condiciones a un crédito VIVO: fecha de pago y plazo

El cliente puede mover **el día en que le cobran** y **el número de cuotas** de un crédito ya
desembolsado. Vive en `legacy-backend`, no en `application` —es una de las pocas piezas de servicing que
no—, y los dos caminos que existen hoy en `main` son de la app: `Modules/Loans/App/Http/Controllers/Customer/CreditChangeController.php`
y su gemelo en `Consumer/`. Las reglas **no** están en el controlador: las decide
`Modules/Loans/App/Services/CreditChangeValidationService.php:41`, y cada cambio aplicado deja fila en
**`creditop_x_changes_log`**.

**Los cinco portones, EN ORDEN** (corta en el primero que falla, así que el código de error dice cuál
cayó, no todos los que habrían caído):

| # | Condición | Código si falla |
|---|---|---|
| 1 | la solicitud existe | `USER_REQUEST_NOT_FOUND` |
| 2 | el lender **no** gestiona el crédito por su cuenta (`lenders.externally_serviced`) | `EXTERNALLY_SERVICED` |
| 3 | hay fila viva en el ledger (`status IN (1,8)`) | `NO_ACTIVE_CREDIT` |
| 4 | **no hay cuota por pagar** | `HAS_PENDING_PAYMENT` |
| 5 | **ningún cambio en los últimos 6 meses** (`creditop_x_changes_log`) | `RECENT_CHANGE_EXISTS` |

⚠ **El portón 4 NO es mora, y confundirlos hace diagnosticar al revés.** La condición es
`next_payment_amount > 0` (`legacy-backend/Modules/Loans/App/Services/CreditChangeValidationService.php:57`) — «tenés una cuota liquidada por pagar»—, no `days_past_due`. Medido
en dev el 2026-08-20: un crédito con **`days_past_due = 0`** y la próxima cuota liquidada responde
`HAS_PENDING_PAYMENT`; y al revés, uno con 174 días de mora responde **el mismo** código, así que el
código de error no distingue «te falta pagar» de «estás en mora».

⚠ Y el mensaje de ese rechazo dice literalmente «no puedes cambiar **el plazo**» aunque se esté pidiendo
la **fecha**: el texto es uno solo para los dos caminos, y lo lee el cliente.

**Las opciones que se ofrecen, cada una con su regla propia:**

- **Fechas** (`getNextPaymentCycles`): sólo los días **5, 16 y 28**, y se ofrecen las **dos** siguientes
  al punto de partida. Los tres días están escritos en el código (`legacy-backend/Modules/Loans/App/Services/CreditChangeValidationService.php:96`), no en configuración: nadie
  fuera de ingeniería puede cambiarlos ni consultarlos. ⚠ En `main` el punto de partida es la fecha del
  crédito **sin comparar con hoy**, así que a un crédito con la fecha vencida le ofrece fechas pasadas
  que el propio endpoint de guardado rechaza → **F-148**.
- **Plazos** (`simulatePossibleFees`): los de la línea de crédito del lender
  (`credit_line_by_lenders.fee_numbers`, una lista tipo `1,3,6,12`), filtrados a los **mayores a las
  cuotas ya pagadas** y a los que **no superan el tope de la categoría** del cliente. ⚠ Cuando la
  categoría **no tiene tope** el filtro los descarta TODOS, así que al mejor cliente no se le puede
  cambiar el plazo → **F-147**.
- Que un crédito **admita cambios** y que **tenga opciones** son dos preguntas distintas: la lista de
  plazos puede venir vacía con `can_change = true`, y en ese caso la fecha sí se puede cambiar.

🔴 **El monto de la cuota lo pone QUIEN LLAMA.** La ruta de la app exige `fee_value` en el cuerpo y lo
valida sólo como `numeric, min:0`, sin compararlo con lo que ofreció: el llamador fija cuánto va a pagar
la persona. Verificado en `main` el 2026-08-20. Sigue así.

⚠ **De dónde salen estas reglas, que importa para no tratarlas como política confirmada.** Están sólo en
el código: lo escribió otra persona en **diciembre de 2025** («Se agregaron servicios para cambio de
fecha de pago y cambio de plazo») para la app, y se ajustó en marzo y abril de 2026. Buscadas el
2026-08-20 en Confluence (no se pudo: credencial vencida), en este árbol, en el cerebro de producto y en
Slack: **ninguna las enuncia**. Lo más cercano es una lista de preguntas frecuentes de producto de
septiembre de 2025 que pregunta *«¿Puedo cambiar la fecha de pago?»* y *«¿Puedo cambiar el plazo?»* — las
preguntas, sin la respuesta. O sea: los 6 meses y los días 5/16/28 son **decisiones de implementación sin
política escrita detrás**. Y F-147 es la prueba de que el código no es una copia fiel de la intención.

> ⏳ **PENDIENTE DE MERGE** — un tercer llamador, el canal de soporte por WhatsApp
> (`Modules/SupportBot`), reusa este mismo servicio en vez de reimplementarlo, y le agrega dos cosas que
> la ruta de la app no tiene: sólo créditos de `response_type = 2` y el monto de la cuota resuelto en el
> backend. Vive en `develop`/`staging`, **no en `main`**. La tarea:
> `tablero/data/agente-soporte-modificacion-datos.md`. Al mergear: re-verificar y **borrar esta marca**.

**(2026-08-28)** `main` sumó **tres comandos de REPARACIÓN del rotativo** (en `application`, que es
donde corre el servicing): `revolving:apply-unapplied-payments` (aplica dinero recaudado que no llegó a
las utilizaciones; tolera diferencias de 1 peso como redondeo), `revolving:fix-used-limit` (corrige
`used_limit`/`billing_used_limit` cuando se liberó cupo de más; verifica que reproduce el estado antes
de tocar) y `revolving:repair-stranded-utilizations` (alinea la fecha de pago de utilizaciones que
quedaron atrás de su cupo). Importan por lo que confiesan: **esos tres modos de falla existen en
producción y ya tienen herramienta oficial** — ante un rotativo con plata recaudada sin aplicar o cupo
liberado de más, el arreglo es el comando, no un UPDATE a mano. **La causa raíz del primero también
está arreglada en `main`** (leída el 2026-08-28 en `CreditopXPaymentController`): la idempotencia por
transacción de pasarela se evaluaba POR utilización, y como el reparto de un pago de rotativo llama
una vez por utilización con el MISMO id, la primera creaba el registro y bloqueaba al resto — plata
recaudada sin aplicar. Hoy esa validación sólo corre en el camino directo (consumo). Verificado contra `main` leyendo los
tres cuerpos. Y del mismo tramo: el summary del consumer (CRED-148) ahora trata una sobra ≤ el umbral
`creditop_x_lender_residual_balances` de la entidad (default 5.000) como **resto residual, no cuota
impaga** — el «debe 300 pesos y le sale una cuota» dejó de ser un reclamo válido.

## Estados y códigos
**DOS máquinas de estado independientes que se confunden** (el Estado 11 es el puente):
- **Catálogo A — `user_request_statuses`** (la SOLICITUD/originación): el catálogo completo verificado contra BD vive en la raíz → **`creditop` §Estados** (⚠ corrige nombres que este nodo tenía de código: 1 es «Validación OTP», no «Nueva»; 21 es «En aprobación del médico», no «stand-by»; 25 es «Pendiente de facturación»). Los que le importan a servicing: **11 Autorizada (la frontera)** · 26 Facturado · **27 Paz y salvo — de la SOLICITUD, no confundir con el 3 del catálogo B**.
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
- **Estado de migración** (legacy-backend): `app/Console/Kernel.php` (**agenda 3 crons de device-lock SmartPay que leen el ledger — ver F-39; 0 crons que OPEREN la cascada de cartera**), `Modules/Loans/App/Services/CreditopXPaymentService.php` (copia muerta, firma vieja), `Modules/Payments/App/Services/{CustomerPaymentService,PaymentLinkService}.php` (crea links pero NO imputa al ledger), `Modules/System/.../EndOfMonthReportController.php` (reconstruido), `Modules/Onboarding/App/Services/EcommerceRequestService.php` (**la notif de cierre SÍ migró**), stubs `app/Services/PullmanService.php`+`app/Repositories/PullmanRepository.php`.

## Frontera de simulación / harness
**El servicing corre 100% en `application`; en legacy solo corren los 3 crons de device-lock de SmartPay** (que leen el ledger de mora — ver F-39; el resto son copias muertas con imports colgantes que reventarían si se agendaran). Cualquier prueba de la cascada de cartera va contra application.
- **Inyectable (in-platform):** el nacimiento del ledger (`createFirstRegister`, síncrono tras el 11), la causación, el corte, la mora y el cierre por pago total (paz y salvo NO exige firma externa — es interno).
- **Cómo probar (honesto):** (1) crear el crédito, (2) mover `next_billing_date`/el reloj a mano, (3) **invocar los comandos artisan en el orden del Kernel** (00:10 → 00:30 → 03:30 → 04:00) — no basta esperar, hay que **disparar los crons**, (4) verificar la nueva fila `status=1` y el `creditop_x_requests_status_id`.
- **Pago:** Wompi/Payvalida por **polling** (no webhook) → simular la `PaymentGatewayTransaction` aprobada o `dispatchSync` el `StatusCheck`, luego correr `apply-payment`.
- **rt≠0 = NO sintetizable** (decide/gestiona un tercero).
- **Relevante al OKR:** el cron 00:30 carga TODA la cartera **sin chunking** (`:42-43`) → revienta a escala; y **no hay alerting estructurado** — las excepciones notifican a `laura.cabra@creditop.com` **hardcodeado (~10 veces)**. Punto natural para instrumentar salud/alertas.

## Datos de prueba / usuario que pasa
Para ejercer el servicing (in-platform) hay que **sembrar el ledger** `creditop_x_requests_history` a mano y disparar los crons: fila `status=1` + `creditop_x_requests_status_id=2` + `next_payment_date < hoy` para probar **mora**; `status IN [1,3]` para **al día/recuperación**; `total_payment_amount==0` para **paz y salvo**. El pago requiere simular una `PaymentGatewayTransaction` Wompi aprobada (o `dispatchSync` el `StatusCheck`). No hay "usuario que aprueba": la decisión ya ocurrió en originación; esto es post-11.

## Diferencias vs otros flujos
- **vs los flujos de originación (creditopx/smartpay/motai/credifamilia/agregadores):** ellos terminan en el Estado 11; este EMPIEZA ahí. No hay decisión de crédito acá — es cartera/cobranza.
- **vs rt≠0 (agregadores, Credifamilia rt=4):** para ellos NO hay ciclo de vida en CreditOp (prueba negativa: todos los crons post-desembolso son `creditop_x_*`); el préstamo lo gestiona el lender y CreditOp no ve la mora/cierre. **SmartPay** es el caso especial que CONSUME este ledger: sus 3 crons de device-lock leen `creditop_x_requests_history` (mora → bloquea el celular).

## Lo que NO está verificado
- ¿Hay notificación de PAZ Y SALVO (status=3) hacia el comercio/lender? La del Estado 11 existe; esta no se localizó.
- ¿rt≠0 recibe algún evento post-facturación del tercero (cobranza/mora/cierre), o el rastro termina en 26?
