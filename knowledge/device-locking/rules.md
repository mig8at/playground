# Bloqueo y desbloqueo de equipos IMEI por mora

Cubre el bloqueo remoto de equipos financiados (Trustonic, detrás del merchant gateway) en
`legacy-backend`: los dos motores que conviven, las condiciones para bloquear, las protecciones
contra el doble bloqueo, los caminos de desbloqueo y liberación, y los endpoints del bloqueo manual;
de `legacy-application`, su desbloqueo por pago con su interruptor y los botones del admin que llaman a esos
endpoints. Describe código de `main`; qué motor y qué interruptores están encendidos en un ambiente
es configuración de ese ambiente, y una respuesta de la plataforma no está acreditada por este tema.
El registro del IMEI en la originación está en `device-imei-validation`.

## Dos motores, uno a la vez

`DeviceLockingEngine::isV1()` lee `config('device_locking.engine')` (`DEVICE_LOCKING_ENGINE`), que
por defecto vale `legacy`; sólo el valor exacto `v1` activa el módulo, y cualquier otro deja el
motor legacy. El `Kernel` agenda `app:lock-devices-past-due` a las 04:00 sólo si **no** es `v1`, y
`DeviceLockingV1ScheduleServiceProvider` agenda `device-locking:tick` a las 04:00 sólo si **es**
`v1`. Los dos consultan el mismo predicado, así que corre exactamente uno.

Fuera del switch, el `Kernel` agenda siempre: `app:sync-device-locks` a las 03:00 (alinea
`device_locks` con el estado real de la plataforma antes de decidir), `app:unlock-devices-paid` a
las 05:00 y `app:unroll-devices-paid` a las 06:00.

## Cuándo se bloquea

Las dos selecciones parten de `CreditopXRequestHistory` con `status = 1`,
`creditop_x_requests_status_id = 2` (en mora), una entidad cuyo `path` se llama `IMEI` y algún
producto seleccionado con `imei` no nulo sin un bloqueo abierto. Difieren en el umbral:

- **Legacy**: `days_past_due >= 8` (`LOCK_DAYS_PAST_DUE`), igual para todos.
- **V1**: por comercio. Sólo recorre los comercios con su **propia** fila habilitada en
  `device_locking_configs` (`enabled` no se hereda de la fila global). El umbral, el título y el
  mensaje salen de la fila del comercio, si no de la fila global (`allied_id` nulo), y si no de las
  constantes (8 días, «Pago Vencido»). La API interna de configuración impone un piso al umbral
  (`device_locking.min_days_past_due`, 1 por defecto). Corta en `device_locking.max_devices_per_run`
  despachos por comercio y corrida (500 por defecto) y lo reporta como `DLV16001`. Un comercio que
  falla no aborta la corrida.

En los dos, el comercio necesita `allieds.trustonic_tenant_key`, leída de la base; sin ella el job
termina con un warning (en V1, `DLV12004`). El título y el mensaje en el equipo son fijos en legacy
(«Pago Vencido») y configurables por comercio en V1.

## Protección contra el doble bloqueo

Legacy tiene tres capas:

1. El comando excluye productos con `openDeviceLock`: una fila `pending`, `locked` o
   `unlock_failed`. `pending` cuenta para que un bloqueo asíncrono en vuelo no reciba un segundo
   intento.
2. El job vuelve a elegir el producto con el mismo criterio después de salir de la cola.
3. Antes de pedir el bloqueo consulta el estado en la plataforma: si ya está bloqueado registra una
   fila `locked` sin llamar; si ya hay un bloqueo en cola, no hace nada.

V1 excluye los estados de `DeviceLockState::blocking()` (`pending`, `locked`, `unlock_failed`,
`pending_release`), deduplica la solicitud dentro de la corrida (llega una vez por cuota vencida),
devuelve `DLV12010` cuando la guarda de la base rechaza la fila porque ya existe un bloqueo activo
del producto, y antes de llamar consulta la plataforma: si ya tiene un bloqueo en cola, lo registra
como `DLV12011` sin pedir otro (si esa consulta falla, bloquea igual).

## Qué pasa con la respuesta del gateway (legacy)

`DeviceLockStatusJob` crea la fila `pending` en una transacción y traduce la respuesta con
`GatewayLockOutcome`: asíncrona deja `pending` y despacha `PollDeviceLockBatchJob` a los 5 minutos;
transitoria borra la fila y reprograma a los 10 minutos, hasta 10 veces, y después la deja
`failed`; bloqueado (o ya bloqueado) la deja `locked`; el resto, `failed`. El job tiene `tries = 3`
y `backoff = 60`. En V1, `LockDeviceJob` (3 intentos, 60 s) sólo reintenta proveedor inalcanzable
(`DLV12008`) o error interno (`DLV12009`); un rechazo (`DLV12006`) o un equipo no enrolado
(`DLV12007`) no se reintenta en la cola.

## Desbloqueo y liberación

- `app:unlock-devices-paid` (legacy, diario): créditos con `creditop_x_requests_status_id` 1 o 3,
  entidad IMEI y un producto con `activeDeviceLock` (`locked` o `unlock_failed`; éste cuenta porque
  el equipo sigue físicamente bloqueado).
- `device-locking:reconcile-payment-unlocks` (V1, cada 10 minutos salvo de 00:00 a 01:00), agendado
  con cualquier motor pero apagado si el setting `device_locking_payment_unlock_enabled` es falso o
  no existe. Toma el último pago aplicado de cada crédito y desbloquea cuando el crédito queda al día
  o lo pendiente es igual o menor que la colilla de la entidad; deja fuera los créditos rotativos, y
  sólo da por desbloqueado lo que una segunda lectura de la plataforma confirma.
- En `legacy-application`, `UnlockDeviceIfUpToDate` se despacha al registrar en el admin un pago de un
  crédito no rotativo, y `app:reconcile-payment-unlocks` lo vuelve a correr cada 10 minutos (salvo de
  00:00 a 01:00) para los casos sin cerrar, incluidos los pagos que aplicó `legacy-backend`. Los dos
  dependen de `legacy_application_payment_unlock_enabled`, que sin fila queda **encendido**: el
  traspaso a V1 es apagar ese y encender el otro. Toma la tenant del comercio de la base y desbloquea
  a través de `/api/partners/unlock-device` (ver la sección siguiente).
- `app:unroll-devices-paid` libera del MDM los créditos en estado 3 con
  `principal_amount_balance = 0`, entidad IMEI y producto con `imei`, salvo los que ya tienen
  `pending_release` o `released`.

Al aplicar un pago, `legacy-backend` no despacha desbloqueo directo: no hay otro
`DeviceLockStatusJob` de desbloqueo que el del comando diario.

## Bloqueo y desbloqueo manual

Aparte del ciclo programado, `legacy-backend` expone `POST /api/partners/lock-device`,
`/unlock-device`, `/unlock-pin-device` y `/get-device-status`. En `Modules/Partner/routes/api.php`
se registran después de que cierra el grupo `Route::middleware(['auth.cognito'])`, sin middleware
propio; el `RouteServiceProvider` del módulo sólo agrega `otel` y `api`, y el grupo `api` no
autentica. El código no exige sesión ni permiso.

`AlliedProductsController` toma `imei` y `trustonic_tenant_key` del cuerpo, y
`AlliedProductService` llama al gateway con esa tenant: no la lee de la base ni comprueba que el
IMEI pertenezca a una solicitud de ese comercio. El origen y el actor (`X-Device-Lock-Origin`,
`X-Actor-*`) se registran como el llamador los declara, no como prueba. Un bloqueo o desbloqueo
manual escribe en `device_locks` sobre el producto más reciente con ese IMEI, reutilizando la fila
viva si existe; esa fila cuenta después para los comandos programados como cualquier otra. La
consulta de estado no escribe.

En `legacy-application`, `CreditopXRequestHistoryController::deviceManagement` y `devicePinUnlock`
(`routes/admin.php`) están detrás del grupo `admin`, es decir, del login del admin, sin un `can:`
como los de sus rutas vecinas. Reenvían el `imei` y la `trustonic_tenant_key` que llegan en el
request, con las cabeceras del usuario logueado, y auditan el intento en `device_lock_audits`.
