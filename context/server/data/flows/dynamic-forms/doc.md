# Dynamic Forms · contexto
> **estado:** al día con main · Formularios backend-driven: el backend define qué campos pide el wizard (personal-info + config, laboral-info) y los persiste como EAV en `user_field_values`.

<!-- Seed desde playground/flow; superficie de código a linkar en la fase de data. -->

## Qué es
El wizard no tiene los campos del formulario quemados en el front: el **backend define qué pedir**. El front llama a un endpoint de **config de personal-info** y arma el formulario dinámicamente; lo que el cliente responde se guarda en un esquema **EAV** (`user_field_values`, atributo→valor por `field_id`).

En el simulador esto no es un nodo propio: aparece como (a) la fila **"Form dinámico"** de MAP.md §S3, (b) los **inputs del nodo Solicitud** (`SolicitudNode`), y (c) el destino EAV `user_field_values` que consumen luego el buró y las reglas. Es la fase que llena a la `user_request` con los datos personales/laborales que después evalúan las reglas.

## Contenido
**El form dinámico** (MAP.md §S3 fila 6): el backend legacy expone personal-info + su **config** y laboral-info; el front las consume con un repository dedicado. Los campos que el flow modela como inputs de la solicitud (`sol.*` en `fieldDocs.js`, nodo `SolicitudNode`):

- **Monto** (`user_requests.amount`) — decide; entra por 3 orígenes según canal (sesión/base64/body OTP).
- **Cuota inicial** (`user_requests.initial_fee`) — el % lo EXIGE la categoría (rt=2), no el comercio.
- **Salario declarado** (`user_field_values` field_id **87**) — **solo se pide si el buró (Ágil/Mareigua/Quanto) NO reportó ingreso**; es la última prioridad de la cascada. Si entra declarado cuenta como ingreso NO verificado → puede fallar reglas con `verified_income`.
- **Nombre / Apellido** (`users`/`user_requests`) — display, no deciden.
- **Tipo de documento** (`users.document_type`) — CC / CE / PEP; algunas entidades restringen el tipo (regla `documentTypes`/group_rule).
- **N° de documento** (`users.document_number`) — identifica al cliente y dispara la consulta de buró (con frecuencia por aliado).
- **Fecha de expedición** — dato de identidad (KYC); ninguna regla del listado la usa.

**El esquema EAV** (`user_field_values`, ver MAP.md §S4): el mapper del buró espeja al EAV con `field_id` conocidos — **87** = ingreso/salario, **29** = ocupación, **160** = flag, **90** = egresos. Al procesar Quanto se **fuerzan** EAV `29='Empleado'` y `160='no'` **hardcodeados**.

## Dónde mirar
- **Form dinámico** (legacy): `Modules/Onboarding/routes/api.php:44-46` (personal-info + config, laboral-info) — MAP.md §S3 fila 6.
- **Config de personal-info** (frontend): `.../personal-info-config/infrastructure/personal-info-config.repository.ts:14` — MAP.md §S3 fila 6.
- **Escritura del EAV** (application): `app/Actions/RiskCentrals/Experian.php:348-397` (EAV 87/29/160; ocup='Empleado' y flag='no' hardcodeados) · `:433-473` (EAV 90 egresos) — MAP.md §S4 fila 5.
- **Tabla EAV**: `user_field_values` (87 ingreso / 29 ocupación / 160 flag / 90 egresos) — MAP.md §S4 tablas.

## Gotchas / riesgos
- **Salario declarado = último recurso**: solo aparece si Ágil Data y Quanto vienen `null`; entra como ingreso no verificado (puede reprobar reglas de ingreso verificado).
- **EAV forzados**: `29='Empleado'` y `160='no'` se escriben hardcodeados al procesar Quanto → un usuario sin central de riesgo queda marcado "Empleado" artificialmente.
- **"PEP" tiene doble sentido**: acá `document_type` PEP = **Permiso Especial de Permanencia** (migratorio, Motai renting), NO Persona Expuesta Políticamente (AML).
- El flow **no modela el form dinámico como nodo propio**: se ve reflejado en los inputs del nodo Solicitud y en la fila "Form dinámico" de S3; la identidad/KYC se cubre en el contexto **kyc**.

## Bitácora
- **2026-07-17** — Contexto sembrado desde playground/flow (nodo `SolicitudNode` + `fieldDocs.js` `sol.*`/`node.solicitud` + MAP.md §S3 fila 6 / §S4 EAV).

## Enlaces
- Padre: **Formalization**. Simulador: playground/flow (nodo Solicitud). Mapa: playground/flow/MAP.md §S3 (form dinámico) / §S4 (EAV `user_field_values`).
- Relacionado: **kyc** (el buró llena los mismos `field_id` EAV que el form declarado), **onboarding** (donde corre el form en el journey real).
