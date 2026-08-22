---
id: 63
title: "SmartPay: el canal IMEI cierra entero en local — receta y lo que hay que saber antes"
stage: work
created: "2026-08-22T19:30:00-05:00"
context_nodes: [smartpay, creditopx]
jira: []
jira_title: "SmartPay: unificar en configuración el id del lender del canal"
---

**ESTADO 2026-08-22.** El canal SmartPay **cierra de punta a punta en local**, hasta estado 11 con el
equipo inscrito en el MDM. El nodo `smartpay` decía que era imposible y era cierto hasta el 19-ago. El
hallazgo del sistema que salió de acá es **F-155**.

## Qué desbloqueó esto

`isSmartPay()` tenía el id del lender quemado en 160 (que fuera de producción no existe), así que
devolvía falso y **las tres cosas distintivas del canal no se activaban**. El 19-ago se cambió a
`production ? 160 : 152`. Nadie lo anunció como «ahora se puede probar el canal», pero eso es lo que
hizo.

⚠ **Y trajo un problema nuevo, que es F-155:** la config del canal sigue diciendo **153**, así que
fuera de producción una entidad se queda con la originación y **otra** con el branding del mailer.
Antes de probar, mirá contra qué id está corriendo cada mitad.

## La receta (local)

Hace falta: el mock del MDM (`:8098`, ya apuntado por `MERCHANT_GATEWAYS_HOST`), el mock de centrales
(`make harness-centrales`) y un comercio con la entidad IMEI **activa en una sucursal** — en el dump,
`CeluRD Test`. Que esté sólo asignada al comercio no alcanza.

1. `make harness-caso CASOS='celurd' LAMBDA=1` → deja la solicitud con el listado resuelto.
2. Seleccionar la entidad: `POST /api/onboarding/loan-application/update-user-request/{ur}`.
3. `POST /api/loans/requests/confirm` → **acá se decide el salto de AML**.
4. `GET /api/loans/requests/promissory-note/{ur}` → devuelve el **acuerdo de bloqueo**, no el pagaré.
5. `send-otp` + `verify-otp` (el código es la derivación del teléfono que usa el runner) → la solicitud
   queda en **«Autorizado pendiente desembolso»**.
6. `POST /api/loans/requests/device/register` con un IMEI de 15 dígitos → el mock responde el equipo
   `ENROLLED`.
7. `POST /api/loans/requests/device/{ur}/disburse` → **estado 11**.

⚠ **No llames a `authorize`.** El `verify-otp` devuelve `next_step: "authorize"` y en este path esa es
la instrucción equivocada: el cierre va por `device/register` → `disburse`.

## Cómo se verificó (contra un control, no a solas)

Cada afirmación se comparó con la **misma llamada sobre un comercio sin path IMEI**, creado con
segundos de diferencia y los mismos mocks — porque «no apareció el log» a solas no prueba nada:

| | canal IMEI | control |
|---|---|---|
| AML de TusDatos en el `confirm` | no corrió | **corrió** |
| documento de la previsualización | `device_lock_agreement` | `consent` |
| estado tras firmar | «Autorizado pendiente desembolso» | (el estándar va a 11) |

Y el cierre dejó `final_amount`, el IMEI en `user_request_products` y **cero filas en `device_locks`** —
que es lo correcto: el enum no tiene estado `enrolled`, las filas las crea el cron de mora.

## El ciclo de mora TAMBIÉN se puede correr (y salió un hallazgo)

El ledger `creditop_x_requests_history` lo escribe `application`, no legacy — pero se puede sembrar a
mano clonando una fila existente y apuntándola a la solicitud, con `creditop_x_requests_status_id = 2`
y `days_past_due >= 8`. Después los tres comandos corren sueltos:

    artisan app:lock-devices-past-due     # con status 2 y mora >= 8  → device_locks queda 'locked'
    artisan app:unlock-devices-paid       # pasando el ledger a 1 o 3 → 'unlocked'
    artisan app:unroll-devices-paid       # status 3 + saldo 0

Los dos primeros funcionan y dejan **una** fila. El tercero dejó **11 filas** para un mismo producto:
cada intento **crea** una fila en vez de reintentar sobre la existente. Eso es **F-156**, y en
producción son **40 equipos que nunca llegaron a bloquearse** mientras el cron los reintenta todos los
días desde hace hasta dos meses.

⚠ **Al medir `device_locks`, contá `DISTINCT user_request_product_id`.** Contando filas, `failed`
parece el estado dominante del sistema; contando equipos, es una minoría chica y atascada.

## Lo que sigue sin poder probarse acá

- **El ciclo de mora en condiciones reales**: acá el ledger se siembra a mano. Quién lo escribe de
  verdad es `application`, así que la cadena completa —causación de mora → bloqueo— sigue sin
  ejercitarse con legacy solo.
- **`user_request_device_info` sigue vacía** y no es del mock: su único escritor
  (`ImeiValidationService`) está registrado en el contenedor y tiene tests, pero **ninguna ruta lo
  invoca**. En producción la tabla también está vacía.

## Tarea (publicable)

**En una línea.** El identificador del canal SmartPay está escrito a mano en cuatro lugares del código
y fuera de producción dos de ellos no coinciden, así que el canal queda partido en dos.

**Por qué.** Una mitad del comportamiento del canal se aplica a una entidad y la otra mitad a otra. En
producción coinciden y no se nota; fuera de producción impide probar el canal completo y hace que los
resultados de una prueba no signifiquen lo que parece.

**Qué cambia.** Los cuatro lugares pasan a leer el mismo valor de configuración, que ya existe.

**Alcance.** Sólo la resolución del identificador. No cambia el comportamiento del canal en producción,
donde los cuatro lugares ya coinciden.

**Dónde probar.** Local o staging.

**Cómo validar.** Comprobar que la entidad que aplica el comportamiento distintivo del canal es la misma
que recibe la marca del canal en los correos.

**Criterios de aceptación.** Una sola entidad concentra las dos cosas en todos los ambientes. En
producción el comportamiento no cambia.

**Dependencias.** Ninguna.
