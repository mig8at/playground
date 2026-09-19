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
- 🔴 **BUG VIVO: reversar un pago RETENIDO revienta con un fatal.**
  `application/app/Http/Controllers/Admin/CreditopXPaymentController.php:1450` resuelve el tipo con
  `where('name','PAGO REVERSADO')`, y la fila de la tabla se llama **`REVERSADO`** (id 8) — `first()`
  devuelve `null` y `null->id` tira `Attempt to read property "id" on null`. Solo dispara en esa rama
  (`:1449`, pagos aún sin aplicar); las otras dos —ya aplicado, ya reversado— funcionan. Ver **F-126**.
  ⚠ **Medido contra PRODUCCIÓN el 2026-09-18, no contra el dump: hay 732 pagos en RETENIDO y el último
  entró ese mismo día a las 19:05**, y los nueve nombres de la tabla confirman que `PAGO REVERSADO` no
  existe. *(Acá decía «56 en el dump local». El dump subestimaba por trece veces: era alcanzable, pero
  no se veía cuánto.)*
- 🔴 **Cambiar la fecha de pago sin mover el corte la revierte sola.** La fecha de pago está APAREADA
  con una fecha de corte, y el motor la recalcula **a partir del corte**
  (`application/app/Helpers/CutoffCalendar.php:118`, `billingDateForPaymentDate`): cambiar una sin la otra deja el ciclo inconsistente y el recálculo
  devuelve la anterior — el cambio se deshace sin que nadie lo toque (**CRED-127**). Es el mecanismo
  detrás de «cambiamos la fecha y volvió a aparecer la anterior». Desde el 2026-09-18 la pantalla de
  administración declara si el cambio se puede hacer y por qué no, con la misma pregunta que hace el
  guardado, así vista y POST no discrepan. Y los días elegibles dependen de la periodicidad
  (`application/app/Helpers/CutoffCalendar.php:99`): mensual tres, quincenal **dos** —el tercero no existe en su ciclo— y
  semanal **ninguno**, porque paga siempre el mismo día de la semana. Ofrecer un día que el ciclo no
  tiene es la otra forma de que el cambio no quede. Leído en `main` el 2026-09-18.
- 🔴 **La otra mitad de CRED-127 es la que costó plata: un pago parcial podía dejar al cliente PEOR.**
  Al aplicar un pago parcial sobre un crédito **en mora**, la fecha de pago se recalculaba
  retrocediendo **un mes fijo** — y en un prestamista **quincenal** eso es un ciclo entero de más. La
  fecha caía en el pasado y la fila se guardaba declarando el crédito **al día** (`days_past_due = 0`);
  a la mañana siguiente el proceso diario veía la fecha vencida y lo devolvía a mora, **y de ahí no
  salía solo**, porque la fecha únicamente avanza cuando se paga el mínimo completo. El cliente pagaba
  y quedaba peor que antes. ✔ **La causa está corregida en `main`:**
  `application/app/Helpers/CutoffCalendar.php:142-164` — `currentCyclePaymentDate` retrocede con
  `previousBillingDate`; en mensual conserva el día que eligió el cliente (`:155-163`), y en semanal y
  quincenal manda el derivado, porque ahí el día lo fija el corte y no hay día del mes que preservar.
- ✔ **Y la reparación ya corrió en producción — medido, no deducido.** El 2026-09-16 entre las 22:07 y
  las 22:10: **83 créditos** con la fecha corregida (`creditop_x_log`, `type = 'SANEAMIENTO'`, «Fecha de
  pago corregida tras quedar movida hacia atrás») y **25 condonados** por
  `creditop_x_requests_history.movement_type = 'CONDONACIÓN POR CORRECCIÓN DE FECHA DE PAGO'`, por un
  total de **382.419,81** — la mora y los gastos de cobranza que disparó la fecha fantasma. Tres cosas
  del diseño que valen para cualquier saneamiento futuro y que el comando
  (`application/app/Console/Commands/CorrectBackdatedPaymentDate.php`) hace explícitas:
  **(1)** la fecha se reconstruye desde el corte **agendado al momento del pago**, no el de hoy —
  usar el de hoy borra mora real: una primera pasada dejó en 19 días un crédito con 175;
  **(2)** los días de mora se recalculan pero **nunca se suben** por encima de lo que el crédito ya
  cargaba, porque subirlos puede cruzar un umbral de gasto de cobranza — cobrarle más a alguien por
  haber pagado, para arreglar un error nuestro; **(3)** corre **en seco por defecto** y sólo escribe
  con `--apply`, una transacción por crédito releyendo la fila bajo lock.
  ⚠ **La condonación NO declara al día a nadie:** de los 25, **24 conservan mora que sí se ganaron**,
  así que `leave_up_to_date` queda en falso y el estado es el que dejó la corrección de fecha. Se
  perdona lo que generó el error, no lo que el cliente debe.
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

**(2026-09-19) Nodo RE-VERIFICADO entero.** 12 afirmaciones auditadas contra `origin/main`, cero
chequeos débiles y ninguna falsa — y **cero deriva de citas** (10 ancladas, ninguna movida ni corrida).
Exactos, carácter por carácter: el bug de `PAGO REVERSADO` contra la fila `REVERSADO`
(`CreditopXPaymentController.php:1450`, dentro de la rama `RETENIDO` de `:1449`),
`CutoffCalendar::billingDateForPaymentDate` en `:118`, y **los tres crons de device-lock de SmartPay
siguen agendados y sin comentar** en `legacy-backend/app/Console/Kernel.php:30`, `:32` y `:33`.
⚠ **Eso último merece decirse porque el mismo día se comprobó lo contrario en el otro monolito**: el
commit del 2026-09-11 que apagó los reportes periódicos tocó el `Kernel.php` de `application`, no el de
`legacy-backend`. Los dos schedulers se mueven por separado, así que «los crons están apagados» nunca
es una afirmación del sistema: es de un repo.

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

⚠ **Y hay un cron de recordatorios MÁS, que está puesto y no manda nada: el semanal.** `app:reminder-weekly-loans` corre **diario a las 09:00 de Bogotá**, `withoutOverlapping`, agendado en el Kernel del monolito **nuevo** (`legacy-backend/app/Console/Kernel.php:41`), y es para **Motai Renting y Rent to Own** (CRED-226). Está desplegado **pero dormido**, y la llave de encendido es **activar las plantillas**. Medido en prod el 2026-09-18: **22 plantillas `weekly_*` sembradas, todas con `status = 0`, cero envíos**, todas con `cutoff_type_id = 3` (semanal); las **8 activas** no tienen `cutoff_type_id` y son las que hoy mandan lo que sí sale. Encenderlas pide además la guarda de corte desplegada en `legacy-application` y las plantillas registradas en `messaging-service`. **Que el cron corra no significa que comunique**: acá corre todos los días y no manda una sola.

**Cómo se lee `reminder_dispatch_log`**, que es donde queda el rastro (medido en prod: **70.320 enviados, 76.237 omitidos y 1.760 fallidos** en 59 corridas desde el 2026-07-06): la columna `channels` guarda **sólo los canales que efectivamente salieron** —no los que se intentaron— y el canal que falló va en `error` con su motivo, también cuando el envío fue parcial. Contar canales intentados con esa columna subestima.

**El estado de cuenta que acompaña al recordatorio, y su contraseña.** El PDF lo genera `legacy-backend/Modules/Loans/App/Services/StatementOfAccountService.php`, extraído de `CreditopXPaymentService::createStatementOfAccount` justamente para que el comando semanal lo use **sin arrastrar el servicio de pagos**. Se sube a **S3 cifrado con la cédula del cliente** —o sea que el PDF pide esa contraseña para abrirse— y el rastro queda en `statements_of_account_log`. ⚠ **La fecha de corte que se IMPRIME depende de la periodicidad del prestamista**, no es fija: **5 días antes del pago en el mensual y 2 en el semanal** (`CutoffCalendar`). Es la parte «consciente de la cadencia» de CRED-226, y es lo que hace que el mismo documento sirva para los dos ciclos. Medido en prod el 2026-09-18: **53.509 estados de cuenta sobre 7.427 créditos** desde 2025-02-25, el último esa misma mañana.

⚠ **Una trampa del comando que generaliza a cualquiera que acepte `--date`:** `Carbon::createFromFormat` **normaliza en silencio** las fechas que no existen (`2026-02-30` → `2026-03-02`). Con `--force` eso manda recordatorios reales del día equivocado, así que la fecha se acepta sólo si vuelve idéntica al formatearla de nuevo.

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
7. **Cupo rotativo (rt=3):** al pagar capital libera cupo para reuso con **FGA proporcional** (`corresponding_fga = paid_principal − paid_principal × used_limit/billing_used_limit`). ⚠ **Acá decía que «el cron 04:00 resuelve mora del cupo pero NO toca `used_limit`». Desde el 2026-08-26 ya no.** `used_limit` y `billing_used_limit` venían siendo **acumuladores que nadie reconciliaba**: cada pago los restaba sin piso ni techo, así que una razón `used/billing` por encima de 1 —un pago aplicado dos veces, un ajuste manual— se comía más cupo del que el cliente pagó, y con `billing_used_limit` en 0 la fórmula dividía por cero. De ahí salieron **cupos en 0 con utilizaciones vivas que además quedaban fuera de la consolidación para siempre**, porque el cron los seleccionaba justamente por `used_limit > 0`. Hoy: la liberación en el pago sigue siendo **inmediata** —el cliente debe ver el cupo liberado de una vez— pero **acotada** (razón limitada a `[0,1]`, cada campo contra su propio saldo, ninguno negativo), y la **consolidación nocturna DERIVA los dos campos de las utilizaciones activas**, que son la fuente de verdad: `application/app/Services/CreditopX/RevolvingCreditAggregates.php` (aritmética pura, sin Eloquent, para poder probarla sin base), llamada desde `application/app/Console/Commands/UpdateCreditopXRevolvingCreditsCommand.php`. El mismo cron recalcula `installment_amount` como **suma de las cuotas** —antes sólo se tocaba al originar y al pagar, así que entre una utilización y otra el cliente veía una cuota que ya no correspondía— y toma `next_payment_date`/`next_billing_date` de la utilización **más temprana**; antes el cupo sólo rodaba su fecha por mora, o sea que **quien pagaba a tiempo veía una fecha vencida**. Y la selección dejó de ser `used_limit > 0`: ahora entra cualquier cupo con al menos una utilización activa (`:186-188`), que es lo que rescata a los que quedaron en 0.
   ⚠ **Se autocorrige, pero la deriva no se acabó.** Medido en prod: el día que entró (**2026-08-31**) el cron corrigió **11 cupos de una sola vez** —la deriva acumulada— y desde entonces corrige **uno cada dos o tres días** (17/9, 14/9, 11/9). Para dimensionarla sin escribir nada: `php artisan creditopx:auditar-rotativos --solo-con-deriva`, que compara cupo por cupo lo guardado contra lo derivado y **no escribe**.
   ⚠ **Y un tercer efecto del mismo arreglo, que explica un síntoma aparte:** la colección de utilizaciones se materializa con `get()` antes de recorrerla (`:195-197`), porque **un Builder no es `Traversable`** — con el `foreach` sobre el Builder no se iteraba nada y **la condonación de colillas de las utilizaciones simplemente no ocurría**.

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
`application/app/Http/Controllers/Admin/CreditopXPaymentController.php:1440` (`reversePayment`) marca la
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

**Y hay un TERCER llamador, que ya mergeó.** El canal de soporte por WhatsApp (`Modules/SupportBot`)
reusa este mismo servicio en vez de reimplementarlo, y le agrega dos cosas que la ruta de la app no
tiene: sólo créditos de `response_type = 2` (`App/Services/ClientLookupService.php`) y el monto de la
cuota resuelto en el backend.

⚠ **Y la extracción destapó un hueco de consentimiento que llevaba años abierto.** La lógica salió de
`Consumer\CreditChangeController` y `Customer\CreditChangeController`, que eran **copias literales** una
de otra (~430 líneas cada una, con tres diferencias), y las dos escribían **`otp_id => 0`** en
`creditop_x_changes_log` con el comentario «OTP validation handled by mobile app authentication». O sea
que **el registro del cambio no guardaba ninguna prueba de que el dueño del crédito lo autorizó** — sólo
de que alguien autenticado en la app lo pidió. Hoy el `otpId` es parámetro del servicio
(`legacy-backend/Modules/Loans/App/Services/CreditChangeService.php:57`, `:102`) y cada consumidor pasa
lo que de verdad tiene: la app móvil sigue pasando `0` porque autentica por su cuenta, y el canal de
WhatsApp pasa **el id del código que la persona escribió**. Al leer ese log, un `0` no significa «sin
OTP»: significa «la autorización se resolvió afuera de este registro».

*(Acá había una marca `⏳ PENDIENTE DE MERGE` que decía «vive en `develop`/`staging`, no en `main`».
Caducó: verificado el 2026-09-18, el módulo está en `origin/main` y su último commit ahí es del
**2026-09-06**. La marca sobrevivió doce días a su propio merge — y una marca de pendiente vencida no
avisa, se lee como cierta.)*

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
impaga** — el «debe 300 pesos y le sale una cuota» dejó de ser un reclamo válido. Y el ciclo ganó **corte
SEMANAL** (`lenders.cutoff_type_id = 3`: paga los viernes, factura los miércoles) con las reglas de
fechas centralizadas en `CutoffCalendar` — el devengo semanal usa la conversión **efectiva** de la
tasa mensual (`((1+i)^(7/30)-1)/7`): devengar proporcional sobrecobraría interés cada ciclo. Mensual y
quincenal no cambian de comportamiento (leído el 2026-08-28 en el commit y su helper, con suite
propia).

### Las tres operaciones que ESCRIBEN sobre un crédito, y la foto que las hace auditables

Las tres acciones viven en `application/app/Actions/CreditopX/` — el monolito VIEJO, donde vive el servicing— y el comando de saneamiento, en cambio, está en el NUEVO.

- **Refinanciar** (`RefinanceCredit.php`): condona todo lo que **no sea capital** y arma un plan nuevo. ⚠ **La trampa está en qué es «capital»:** del saldo vigente sobrevive `principal_amount_balance`, **que ya incluye el fondo de garantía** — `guarantee_amount_balance` es su **desglose informativo, no una deuda aparte**, y por eso **NO se suma otra vez**. Sumarlo duplicaría el FGA en el plan nuevo. Deja el movimiento `CONDONACIÓN POR REFINANCIACIÓN`; medido en prod el 2026-09-18: **46 créditos**, el último ese mismo día.
- **Condonar a paz y salvo** (`CondoneCreditToSettled.php`): todos los saldos a 0 —capital con su FGA adentro, intereses corrientes, mora, seguros y gastos de cobranza— y el crédito pasa a **status 3**, *el mismo estado y la misma forma* que deja un crédito que termina de pagarse por aplicación de pago. ⚠ **Los acumulados `paid_*` NO se tocan, y es deliberado: una condonación no es un pago del cliente.** Quien cuente recaudo con esas columnas no se come las condonaciones — que es justamente el punto.
- **Sanear historias duplicadas** (`legacy-backend/app/Console/Commands/FixCreditopXDuplicateHistoriesCommand.php`): anula (`status = 5`) la cadena que sobra cuando un crédito quedó con más de una historia activa. **Lo detecta la auditoría** —el chequeo `duplicate-active-request-history`— y esto es **el brazo que lo arregla**; cubre sólo los dos casos en que la decisión **no requiere criterio**. Es el patrón que conviene copiar: el que detecta avisa, y el que corrige se limita a lo mecánico.

**Y las tres dejan rastro con la misma pieza:** `CreditStateSnapshot.php` guarda una **foto del antes y otra del después** en la columna `response` de `creditop_x_log`, y en `request` lo que se pidió **junto con quién lo ejecutó**. Por eso el log de estas operaciones se audita **sin reconstruir el estado desde el histórico ni cruzar con la tabla de usuarios** — que es lo que hace practicable revisar una condonación meses después.

## Estados y códigos

### Dos herramientas de solo lectura sobre la cartera que conviene conocer antes de tocar nada

**1 · La auditoría diaria de salud** (`legacy-backend/app/Console/Commands/AuditCreditopXHealthCommand.php`) corre **después** de los procesos nocturnos y publica en el canal de Slack `creditop-x-health`. ⚠ **Detecta y avisa, nunca corrige** — cada ajuste de datos se revisa caso por caso. Hoy trae cinco chequeos, y la lista sola ya dice cuáles son los modos de falla conocidos de esta cartera: **fecha de pago movida hacia atrás** (el de CRED-127), **historial activo duplicado**, **creación duplicada de crédito**, **descuadre del pago mínimo** y **pago sin historial**. Para agregar uno **no se toca el comando**: se implementa `App\Audit\Contracts\HealthCheck` en `app/Audit/Checks` y se registra en `config/audit.php`, que también fija el tope de hallazgos por chequeo (`AUDIT_CTOPX_MAX_FINDINGS`, 15 por defecto) y el webhook.

**2 · La predicción del estado sin correr el core** (`application/app/Actions/CreditopX/PredictStandingAfterCore.php`) contesta, **sin ejecutar nada y sin escribir**, si un crédito de consumo va a quedar **al día** después de las corridas nocturnas pendientes. Lo hace **espejando en memoria los dos comandos que deciden el estado**, en el mismo orden: el de las 00:10 (condonación de colillas al corte) y el de las 00:30 (corte, mora y limpieza). Es la respuesta a «si paga esto hoy, ¿mañana aparece al día?» **sin tener que esperar a mañana**. ⚠ Y como es un espejo, **hereda la obligación de moverse con ellos**: si alguno de los dos comandos cambia su regla y éste no, la predicción miente sin fallar.
**DOS máquinas de estado independientes que se confunden** (el Estado 11 es el puente):
- **Catálogo A — `user_request_statuses`** (la SOLICITUD/originación): el catálogo completo verificado contra BD vive en la raíz → **`creditop` §Estados** (⚠ corrige nombres que este nodo tenía de código: 1 es «Validación OTP», no «Nueva»; 21 es «En aprobación del médico», no «stand-by»; 25 es «Pendiente de facturación»). Los que le importan a servicing: **11 Autorizada (la frontera)** · 26 Facturado · **27 Paz y salvo — de la SOLICITUD, no confundir con el 3 del catálogo B**.
- **Catálogo B — `creditop_x_user_request_statuses`** (el PRÉSTAMO in-platform, **el que importa post-11**): **1 Al día · 2 En mora · 3 Paz y salvo · 4 Cancelado**. ⚠ El seeder solo crea 1 y 2; los ids 3 y 4 se usan en código pero viven solo en la BD real.
- **`status` sobrecargado** (3 sentidos, no confundir): en la fila del ledger 1=vigente/0=histórico/3=paz y salvo/5=reversado; en `RevolvingCredit` 1/0=cupo activo/inactivo; y aparte `creditop_x_requests_status_id` (1/2/3/4) = estado del crédito.
- Catálogo global → raíz.

## Sistemas externos
- **Wompi / Payvalida** (pasarela de recaudo): los pagos se confirman por **polling** (`StatusCheck`, `ttl=18000s`), NO por webhook. El cron 00:02 es la red de seguridad (hardcodeado a `lender_id=52`).
- **Twilio / SMS / email** (dunning): recordatorios preventivos y de mora (cron 09:30) + los reportes recurrentes.
- **Corbeta** (facturación/conciliación rt=1 Bancolombia): cruza por PIN y confirma consumo; sube a estado 26 FACTURADO. (Comparte superficie con el nodo `agregadores`.)

**(2026-08-28) Re-verificación asistida completa** (worker → 8; las 2 que invalidaban, verificadas —
ciertas): **el cambio de condiciones de un crédito vivo ya no acepta la cuota del que llama** — el
backend resuelve el valor con `resolveFeeOption()` desde la simulación autorizada
(`CreditChangeController:334`, cierra F-147/F-148: imponer un `fee_value` arbitrario ya no es posible);
y **«cero crons de servicing en el nuevo» dejó de ser cierto**: el Kernel del nuevo agenda los
recordatorios de CreditopX a las 09:30 de Santo Domingo (República Dominicana). Más: el tablero de
cupos rotativos con pestañas y métricas desacopladas, plantillas WhatsApp con variables estrictas en el
dunning, filtros de exclusión en reportes, y el enrutamiento dinámico al checkout nuevo con metadatos
de comprobantes.

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
