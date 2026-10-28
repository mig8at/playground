# Bloqueo y desbloqueo de equipos IMEI por mora

Cubre el bloqueo remoto de equipos financiados (Trustonic, detrás del merchant gateway) en
`legacy-backend`: los dos motores que conviven, las condiciones para bloquear, las protecciones
contra el doble bloqueo y los caminos de desbloqueo y liberación; de `application`, sólo el
interruptor de su desbloqueo por pago. Describe código de `main`; qué motor y qué interruptores
están encendidos en un ambiente es configuración de ese ambiente, y una respuesta de la plataforma
no está acreditada por este tema. El registro del IMEI en la originación está en
`device-imei-validation`.

## Dos motores, uno a la vez

`DeviceLockingEngine::isV1()` lee `config('device_locking.engine')` (`DEVICE_LOCKING_ENGINE`), que
por defecto vale `legacy`. El `Kernel` agenda `app:lock-devices-past-due` a las 04:00 sólo si **no**
es `v1`, y `DeviceLockingV1ScheduleServiceProvider` agenda `device-locking:tick` a las 04:00 sólo si
**es** `v1`. Los dos consultan el mismo predicado, así que corre exactamente uno.

Fuera del switch, el `Kernel` agenda siempre: `app:sync-device-locks` a las 03:00 (alinea
`device_locks` con el estado real de la plataforma antes de decidir), `app:unlock-devices-paid` a
las 05:00 y `app:unroll-devices-paid` a las 06:00.

## Cuándo se bloquea

Las dos selecciones parten de `CreditopXRequestHistory` con `status = 1`,
`creditop_x_requests_status_id = 2` (en mora), una entidad cuyo `path` se llama `IMEI` y algún
producto con `imei` no nulo sin un bloqueo abierto. Difieren en el umbral:

- **Legacy**: `days_past_due >= 8` (`LOCK_DAYS_PAST_DUE`), igual para todos.
- **V1**: por comercio. Sólo recorre los comercios con la configuración habilitada en
  `device_locking_configs`, cada uno con su `days_past_due` (8 si no tiene); el request del admin
  impone un piso (`device_locking.min_days_past_due`). Corta en `device_locking.max_devices_per_run`
  despachos por corrida (500 por defecto) y lo reporta como `DLV16001`. Un comercio que falla no
  aborta la corrida.

En los dos, el comercio necesita `allieds.trustonic_tenant_key`; sin ella el job termina con un
warning (en V1, `DLV12004`). El título y el mensaje en el equipo son fijos en legacy («Pago Vencido»)
y configurables por comercio en V1.

## Protección contra el doble bloqueo

Legacy tiene tres capas:

1. El comando excluye productos con `openDeviceLock`: una fila `pending`, `locked` o
   `unlock_failed`. `pending` cuenta para que un bloqueo asíncrono en vuelo no reciba un segundo
   intento.
2. El job vuelve a elegir el producto con el mismo criterio después de salir de la cola.
3. Antes de pedir el bloqueo consulta el estado en la plataforma: si ya está bloqueado registra una
   fila `locked` sin llamar; si ya hay un bloqueo en cola, no hace nada.

V1 excluye los estados de `DeviceLockState::blocking()` (`pending`, `locked`, `unlock_failed`,
`pending_release`), deduplica la solicitud dentro de la corrida y tiene la guarda `DLV12010` cuando
otra corrida tiene el bloqueo activo.

## Qué pasa con la respuesta del gateway (legacy)

`DeviceLockStatusJob` crea la fila `pending` en una transacción y traduce la respuesta con
`GatewayLockOutcome`: asíncrona deja `pending` y despacha `PollDeviceLockBatchJob` a los 5 minutos;
transitoria borra la fila y reprograma a los 10 minutos, hasta 10 veces, y después la deja
`failed`; bloqueado (o ya bloqueado) la deja `locked`; el resto, `failed`. El job tiene `tries = 3`
y `backoff = 60`. En V1, `LockDeviceJob` (3 intentos, 60 s) sólo reintenta proveedor inalcanzable
(`DLV12008`) o error interno (`DLV12009`); un rechazo o un equipo no enrolado no se reintenta.

## Desbloqueo y liberación

- `app:unlock-devices-paid` (legacy, diario): créditos con `creditop_x_requests_status_id` 1 o 3,
  entidad IMEI y un producto con `activeDeviceLock` (`locked` o `unlock_failed`; éste cuenta porque
  el equipo sigue físicamente bloqueado).
- `device-locking:reconcile-payment-unlocks` (V1, cada 10 minutos salvo de 00:00 a 01:00), agendado
  con cualquier motor pero apagado si el setting `device_locking_payment_unlock_enabled` es falso o
  no existe. Desbloquea cuando el crédito queda al día o lo pendiente es igual o menor que la colilla
  de la entidad, y sólo da por desbloqueado lo que la plataforma confirma.
- En `application`, `UnlockDeviceIfUpToDate` se despacha al registrar un pago en el admin. Su
  interruptor es `legacy_application_payment_unlock_enabled`, que sin fila queda **encendido**: el
  traspaso a V1 es apagar ese y encender el otro.
- `app:unroll-devices-paid` libera del MDM los créditos en estado 3 con
  `principal_amount_balance = 0`, salvo los que ya tienen `pending_release` o `released`.

El pago en tiempo real de `legacy-backend` ya no despacha desbloqueos: no hay otro
`DeviceLockStatusJob` de desbloqueo que el del comando diario.
