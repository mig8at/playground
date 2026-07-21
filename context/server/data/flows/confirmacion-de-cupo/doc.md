# Confirmación de cupo (omite buró) · task
> **rama:** `feat/backend-changes-for-already-confirmed-pre-approbal-flow-usage` (front `784585fe` · back `a603a5cd`) · **estado:** ✅ **MERGEADO** (2026-07-21)
>
> Un selector **"Confirmación de cupo"** en el onboarding que, para un cupo YA confirmado, **salta el buró (Experian)** vía un `flow-signature` y arranca la solicitud sin consultar central de riesgo. Trabajo de FRONTEND (Miguel), contraparte de las APIs de BACKEND (Jose).

## Contextos que usa
- **onboarding** — donde vive el flujo: el registro de celular/OTP y el `amount-form` se ramifican según el flow elegido; el selector y la firma del flow ocurren acá, ANTES del listado.
- **kyc** — lo que se OMITE: Experian / central de riesgo. El punto de la task es no consultar el buró cuando el cupo ya está confirmado; el detalle de burós vive en este nodo.

## Objetivo
Para un usuario con **cupo ya confirmado** (pre-aprobado por fuera), evitar la consulta a Experian: el front pregunta si puede omitir el buró y, si sí, firma un `flow-signature` (flow clásico, `flow_id=2`) que en backend **salta Experian y recorta los lenders a rt=0**. No re-explica el buró (ver **kyc**) ni el onboarding (ver **onboarding**).

⚠ **Flujo CLÁSICO, no el dynamic** — el dynamic es de RD, gateado por `alliedCountry===60`. Esta task es sobre el clásico.

## Ramas y PRs por repo
| Repo | Rama | Estado |
|---|---|---|
| `frontend-monorepo` | `feat/backend-changes-for-already-confirmed-pre-approbal-flow-usage` | commit `784585fe` en la rama, **sin merge a main** (la rama arrastra merges de staging; el trabajo real es SOLO ese commit) |
| `legacy-backend` (Jose) | familia `feat/new-flow-signature-api` · `feat/new-omit-experian-apis` · `feat/backend-changes-for-already-confirmed-pre-approbal-flow-usage` | las 2 APIs que el front consume |

> ⚠ **Contrato de las 2 APIs: el veredicto va en el `code` del body, NO en el HTTP status** (verificado). No leas el status para decidir; leé `code`.

## Lo que se hizo (frontend, commit `784585fe`)
### Net-new — la capa de pre-approval flow (5 archivos, en la rama, NO en el índice de main)
- `loan-application-form/src/lib/application/check-able-to-omit-experian.uc.ts` — el use-case que pregunta si este cupo puede omitir el buró.
- `loan-application-form/src/lib/application/sign-flow-signature.uc.ts` — firma el `flow-signature` (marca el flujo como confirmado).
- `loan-application-form/src/lib/infrastructure/pre-approval-flow.repository.ts` + `ports/pre-approval-flow.repository.ts` + `types/pre-approval-flow.ts` — el repositorio/puerto/tipos del flujo de pre-aprobación (las 2 APIs con verdicto en `code`).
### Modificados (6, resuelven en main)
- `app/routes/loan-application-form/phone-number.tsx` + `otp-verification.tsx` — el punto donde el flujo se ramifica.
- `components/phone-number.tsx` + `amount-form.tsx` — UI del selector/monto.
- `lib/index.ts` (exporta la capa nueva) + `lib/utils/schemas/phone-number.ts`.

## Cómo probar / validar
- Es un flujo de onboarding: usar el harness del wizard (**harness** → `bin/asesor`). Necesita un usuario con **cupo ya confirmado** en backend (las APIs de Jose deben estar desplegadas en el target).
- Verdicto correcto = leer el `code` del body de las 2 APIs (no el HTTP status); con `flow_id=2` el backend salta Experian y el listado queda recortado a rt=0.

## Verificación punta a punta (2026-07-21) — ✅ el objetivo SE CUMPLE

Trazado contra el código de la rama, ambos repos. La cadena cierra:

| # | Dónde | Qué pasa |
|---|---|---|
| 1 | `phone-number.tsx` (loader) | `CheckAbleToOmitExperianUc` → `GET /api/v2/risk/check-if-able-to-omit/experian-acierta/{hash}`; si `code=RKV26000` ⇒ `showQuotaConfirmation` |
| 2 | `amount-form.tsx` | selector **"Confirmación de cupo"** (radio Sí/No) — vive en la pantalla de MONTO (de ahí la confusión de "guarda el monto": **no guarda monto**) |
| 3 | `phone-number.tsx:170-177` (action) | `"yes"` → sesión `flowSignatureChoice = already-confirmed-pre-approval`; `"no"` → `standard`; sin selector → `unset` |
| 4 | `otp-verification.tsx:155-176` | tras OTP válido + `loanRequestId` ⇒ `POST /api/v1/user-request/{id}/flow-signature/{alias}` (**best-effort**: si falla, sigue en estándar) |
| 5 | `UserRequestRepository.php:186` | `UserRequest::where('id',…)->update(['flow_id' => 2])` |
| 6 | **`app/Actions/RiskCentrals/Experian.php`** | **el corte REAL**: `if flow_id === Flow::ALREADY_CONFIRMED_PRE_APPROVAL return null` en **los 3 modos** (Acierta · Quanto · Acierta+Quanto) |
| 7 | `CheckExperianTriggerService.php` (Stage 3) | espejo en arquitectura nueva → `RKV24029` |
| 8 | `Modules/Onboarding/.../LenderListingController.php` | para `flow_id=2` el listado se recorta a `response_type = 0` (solo entidades SIN integración directa) |

`Flow::ALREADY_CONFIRMED_PRE_APPROVAL = 2` (`Modules/UserRequestV1/App/Constants/Flow.php`).

### Lo que el backend de Jose (`a603a5cd`) trae además
- **Contador de consultas por comercio + regla de frecuencia** (Stage 2): `GetExperianQueryCountByAlliedIdService` (lee sin avanzar) + `IncrementExperianQueryCountByAlliedIdService` (avanza). El contador **solo sube justo antes de consultar Experian de verdad**. Sin regla ⇒ `RKV24023`; `count % every !== 0` ⇒ `RKV24024`. **Es un segundo mecanismo de ahorro, independiente del flujo de pre-aprobado.**
- `FLOW_ASSIGNABLE_STATUS_IDS` ampliado de `[1]` a `[1, 9]` (antes la firma fallaba con `URV13005` si la solicitud estaba en estado 9).
- Deuda que el propio commit registra: `RKV2TD014` — `CheckExperianTriggerService` con **15 dependencias** y un orquestador de ~700 líneas.

### ⚠ Deuda abierta: rechazo de firma que pasa inadvertido
`signFlow` (`pre-approval-flow.repository.ts:61-63`) devuelve `okAsync` **con solo mirar el HTTP**, pero `URV13004` (rechazo del validador, **sin escritura**) viaja en **HTTP 200**. Su hermano `checkAbleToOmitExperianAcierta` (:38) **sí** ramifica por `code`. Consecuencia: el front cree que firmó, la solicitud queda en `flow_id=1` y **Experian se consulta** — sin error ni rastro en Sentry.

**Hoy NO se dispara**: el único rechazo posible (`ACPA1001`) repite el chequeo que el front ya hizo, sobre la **misma sucursal** (verificado: `findWithEcommerceExclusions` filtra por `allied_branch_id`, así que una solicitud reusada nunca es de otra sucursal). Solo una carrera al editar `allowed_to_omit_experian_allieds` entre pantallas.

**Por qué igual importa**: el validador dice *"More flow actions/validations — each with its own ACPA1xxx rejection reason — will be added here"*. Cuando lleguen validaciones que el front NO pueda anticipar, el fallo silencioso se vuelve real. Los demás rechazos sí se ven (`URV13005`→409, `URV13001`→404, `URV13002`→422, `URV13003`→500).

**Arreglo (pendiente, no urgente)**: que `signFlow` exija `code === 'URV13000'` y si no devuelva `errAsync`, para caer en el `captureServerException` que ya existe. No cambia el comportamiento del usuario.

## Bitácora
- **2026-07** — implementado en el front (commit `784585fe`) + verificado (typecheck 0 errores propios / biome). Depende de las APIs de backend de Jose (flow-signature + omit-experian).
- **2026-07-18** — registrada como task del árbol de context.
- **2026-07-21** — **mergeado** (front `784585fe` + back `a603a5cd`). Validado punta a punta contra el código: el objetivo se cumple. Se descubre la deuda del rechazo silencioso en `signFlow` (ver arriba) — se deja escrita para atacar después, no se corrige ahora porque ya está mergeado y hoy no se dispara.

## Pendientes
- [ ] **Deuda**: `signFlow` debe validar `code === 'URV13000'` (hoy toma `URV13004`/HTTP 200 como éxito). Ver arriba.
- [ ] Probar el flujo corriendo (esta validación fue **lectura de código**, no ejecución): hace falta un comercio en `allowed_to_omit_experian_allieds` y las APIs desplegadas en el target.
- [x] ~~Merge de la rama~~ — mergeado 2026-07-21.

## Enlaces
- Memoria: `[[pre-approval-omit-experian-frontend]]`.
- Contextos: **onboarding** (el flujo) · **kyc** (el buró que omite).
