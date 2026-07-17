# Motai v2 — des-motaización ejecutada (modes + flags + calculadora + documentos)

> **Registro de cambios ejecutados** · 2026-07-15 · ramas `feature/motai-v2` en `legacy-backend` + `frontend-monorepo` (cambios **sin commit**, migración **sin correr**).
> Pregunta que responde: *¿realmente eliminamos la página de modos y toda la lógica bypasseada por `isMotaiRenting` / id 158 / modos?*
>
> ⚠ **Este es el registro puntual del Jul-15.** Para el estado VIGENTE ver [MOTAI-V2-MAPA-DE-CAMBIOS.md](MOTAI-V2-MAPA-DE-CAMBIOS.md), que actualiza tres cosas de acá: (1) **TyC** pasó de "→ default" a **tabla `allied_documents` por comercio** (§3.3 quedó viejo); (2) el flag **`abaco` fue REMOVIDO** (§3.6 revertido — lo maneja otro equipo); (3) se agregó el **recálculo liviano de monto** en `/lenders`. Además las ramas ya están **commiteadas y pusheadas** (backend PR→develop retargeteado, frontend PR→staging).

---

## 1. Veredicto del barrido final

**Sí.** Verificado con grep sobre ambos repos al cierre (2026-07-15):

| Búsqueda | frontend-monorepo | legacy-backend |
|---|---|---|
| `isMotaiRenting` / `is_motai_renting` | **0 referencias** | **0 referencias** |
| `merchantMode` / `merchant-mode` / `merchant_mode` | **0** | **0** |
| `MOTAI_LENDER_IDS` | **0** (constante + export borrados) | n/a (nunca existió) |
| Página/route de modos (`merchant-mode.tsx`, `route("modes")`, `redirectToModes`, `partner_modes`) | **0** | **0** (respuesta del comercio ya no manda `partner_modes`) |
| `allied_modes` / `user_request_modes` (código) | n/a | **0 en código** (solo 3 comentarios "deprecado"; tablas quedan en BD, ver §6) |
| Lender id `158` como **lógica** | **0** | **0** |

**Lo que queda con "motai"/"158" es legítimo y NO es lógica bypasseada:**

| Resto | Por qué queda |
|---|---|
| `158` en la **migración** (`add_motai_v2_columns`) | Es **backfill de DATOS**, no lógica: marca a Motai como `product='renting'`, `abaco=true`, su fórmula y PEP en sus sucursales. Exactamente el patrón deseado: el id vive en **config**, no en `if`s. |
| `field_id == 158` en `UsersDataCreditopXExport` / `CreditopXFormController` | **Falso positivo**: es un campo EAV de formulario (coincidencia de número), no el lender. |
| `MotaiValidationService` / `MotaiValidationController` / rutas `/api/onboarding/motai/*` | **Nombres** de endpoints/clases consumidos por el front (`abaco.repository.ts`, `financial-profile.repository.ts`). La **lógica interna ya es genérica** (lee `lender.abaco`). Renombrar rutas = breaking change de API coordinado → fuera de alcance (candidato: `/api/onboarding/abaco/*`). |
| Bypass **PEP** en `OnboardingService::storePersonalInfo` | **Se mantiene a propósito**: es el mecanismo correcto, keyea por `document_type === 'PEP'` (config-driven, ya no depende de modo ni de id). |
| `BackDoorUserController/Service` | Pantalla del asesor (decisión manual) — pieza aparte del plan (actor administrador, E2), no era parte de modes. |
| Comentarios `Motai v2:` en código | Documentación del porqué de cada cambio. |

---

## 2. El cambio de fondo: flujo estandarizado

**Antes** (Motai era un flujo especial):

```
entrada comercio → [PÁGINA DE MODOS (solo Motai)] → teléfono → OTP ─┐
                     └─ setea session "merchant-mode"               │
   isMotaiRenting viaja en CADA payload (teléfono/OTP/personal-info)│
   y el backend bypasea: salta risk-centrals, fuerza corbeta=false, │
   marca user_request_modes, TyC especial (ids 16/17), y el front   │
   calcula el precio con fórmula quemada gateada por id 158         ┘
```

**Ahora** (Motai = el flujo normal de cualquier solicitud):

```
entrada comercio → solicitar (monto + teléfono) → OTP → personal-info → lenders → …
```

y lo que era especial pasó a **config por columna**:

| Comportamiento | Antes (hardcode) | Ahora (config) |
|---|---|---|
| Tipo de documento PEP en el selector | `if merchantMode === 'motai-renting'` en el front | `lenders_by_allied_branches.document_types` → backend expone `allowed_document_types` (unión por sucursal, piso CC/CE) |
| Salto de buró | flag `isMotaiRenting` (por modo, en OTP) | **por documento**: bypass PEP en personal-info (ya existía; ahora es el único mecanismo) |
| Card renting + skips (cuota inicial, OTP bancario) | `MOTAI_LENDER_IDS.includes(158)` | `lenders.product` (`credit` \| `renting` \| `rto`) |
| Precio / valor a financiar | fórmula duplicada y quemada en el front (`getMotaiTotalAmount` + `useLenderSelection`) | `lenders.calculator` (json: `params` + `formulas`), evaluada en el **backend** por `App\Support\FormulaCalculator` (symfony/expression-language, sin `eval`, con guard); default `null` = identidad. El listado adjunta `calculated` por lender |
| ¿Requiere Ábaco? | `allied_modes.config.isAbacoRequired` vía modo activo | `lenders.abaco` (bool) leído por `MotaiValidationService` desde el lender de la solicitud |
| TyC | URLs S3 de Motai quemadas (front) + ids 16/17 (back) | **default de CreditOp** + `TODO(motai-v2)`: redefinir entrega de TyC **por entidad** en la selección de lender |

**Resultado:** dar de alta otra entidad renting/RTO (p. ej. "Alta") = **filas de config** (product, calculator, abaco, document_types), sin `if id == N`, sin deploy de fórmulas, sin página especial.

---

## 3. Qué se hizo, pieza por pieza

### 3.1 Tipos de documento por sucursal (des-quema del PEP)
- **BD**: columna `document_types` (json) en `lenders_by_allied_branches`; backfill `["CC","CE"]`; Motai 158 → `["CC","CE","PEP"]`.
- **Backend**: `AlliedInfoController` (endpoint del comercio/branch `GET /api/loans/allied/{hash}`) resuelve y expone `allowed_document_types`.
- **Front**: `allied-theme` (schema/repo) lo mapea; `personal-info-form` filtra el selector por esa lista (fallback = catálogo completo). Se borraron `merchantMode` y el filtro `!== 'PEP'` quemados.

### 3.2 Calculadora por lender (backend-first)
- **BD**: `lenders.product` (default `credit`) + `lenders.calculator` (json, nullable = identidad). Backfill Motai: `renting` + `{"params":{"setup_fee":1500000,"margin":1.0,"tax":0.19},"formulas":{"amount":"(amount + setup_fee) * (1 + margin) * (1 + tax)"}}` (keys en inglés).
- **Backend**: `App\Support\FormulaCalculator` (wrapper de `symfony/expression-language ^8.1` — **requiere PHP 8.4+**, el contenedor corre 8.4.18; solo escalares, sin funciones, + `guard()`). `LenderListingService::attachCalculatedFields` adjunta `calculated` (+ `product`) a cada lender del listado. Verificado: renting → `14.360.920` con costo `4.534.000`; credit → identidad; inputs maliciosos rechazados.
- **Front**: plumbing `calculated`/`product` (entity + mapper); `RentingLenderCardContent` (ex `MotaiLenderCardContent`) muestra `calculated.amount`; el payload de selección persiste ese valor. **Borrados** `getMotaiTotalAmount`, la fórmula duplicada y `MOTAI_LENDER_IDS`. Skips (saltar cuota inicial y OTP bancario/redirect a continuar) ahora por `product === "renting"` (el payload manda `product` al action).
- Recalcular al cambiar monto ya existía (`/lenders/payment-plan-options`, `/lenders/{id}/update-amount`) y consume la misma fuente.
- Demo interactivo del formato de fórmulas: `playground/examples/calculadora-formulas.html`.

### 3.3 TyC → default (+ decisión pendiente)
- **Front** (`phone-number-step-form`): se quitaron las URLs S3 de Motai → default de CreditOp (OnVacation 313 intacto — no es Motai).
- **Back** (`RegisterCellPhoneService` + `UserService::storeTermsAndConditions`): se quitó la rama Motai (ids 16/17) → default (id 13 + últimas TyC activas). Credifamilia (id 18) intacto.
- Razón: la TyC "de Motai" se asumía desde la **página de modos**; sin esa página el supuesto muere. `TODO(motai-v2)`: la TyC por **entidad** se redefine en la **selección de lender** (ahí sí hay entidad).

### 3.4 Página de modos eliminada
- Borrados: route `merchant-mode.tsx`, componente + export, asset `motai-bg.png`, story de storybook, `route("modes")` en `routes.ts`.
- Redirigidos a `solicitar` (la ruta normal de teléfono): botón "Iniciar Solicitud" de `loan-continue` y los redirects post-aprobación de `financial-profile`.
- Limpieza: `redirectToModes` (default-layout), lecturas muertas en `phone-number`.

### 3.5 `allied_modes` / `user_request_modes` deprecados (código)
- `attachMotaiRentingModeIfNeeded` + inyecciones de repos fuera del `OnboardingController`.
- `AlliedModeLenderFilterService` **borrado** (sin modo activo era no-op: devolvía todos) y sus llamadas en `LenderRetrievalService`/`LenderListingService` reemplazadas por passthrough.
- `partner_modes` fuera de la respuesta del comercio (`RegisterCellPhoneService`) y del tipo del front.
- **Borrados 6 archivos**: modelos `AlliedMode`/`UserRequestMode`, repos + interfaces, y sus bindings del ServiceProvider. Relación `Allied::alliedModes()` fuera.
- **Hallazgo**: estas tablas NO eran solo de la página — también alimentaban el filtro de lenders y el endpoint de Ábaco; por eso Ábaco se movió a columna (abajo).

### 3.6 Ábaco → columna por lender
- **BD**: `lenders.abaco` (bool, default false); backfill Motai 158 = true.
- **Backend**: `MotaiValidationService` (endpoint "¿requiere Ábaco?") ahora lee `userRequest->lender?->abaco`. Sin lender elegido → no requerido.
- Concepto (negocio): Ábaco = **ingreso extra** por lender, no reemplazo de buró; para PEP equivale a "0 de buró + Ábaco". `TODO`: la integración fina queda por definir; el bool des-hardcodea hoy.

### 3.7 `isMotaiRenting` / `merchant_mode` muertos end-to-end
- **Backend**: fuera de las Requests (`SendOtpCodeRequest`/`ValidateOtpCodeRequest`), del orquestador de OTP (`userViability` corre solo por `!hadPreApproveLender`; `validateRiskCentrals` sin excepción; sin force `corbeta=false`), y del threading `OtpService → UserService → storeTermsAndConditions` + logs.
- **Front**: fuera de todos los routes (loan-request-form, phone-number, otp-verification, otp-resend, loan-continue, available-lenders) y de la lib completa (UCs `save-personal-info`/`verify-phone-otp`/`save-phone-number`/`resend-otp`, repos, tipos), con limpieza de `session`/imports huérfanos.
- **Bancolombia**: también se le quitó `isMotaiRenting` (era cruft copiado — Bancolombia nunca es Motai), lo que permitió remover el campo 100% de la lib compartida.
- Aclaración técnica importante (verificada): en el paso de OTP **no se consulta buró** si no hay datos de personal-info (`userViability` solo dispara Datacrédito con datos + viabilidad) → quitar el flag ahí **no** re-activa buró para Motai; el salto real es el bypass PEP de personal-info.

---

## 4. Verificación

| Check | Resultado |
|---|---|
| `php -l` de todos los `.php` cambiados | ✓ 0 errores |
| Pint | Repo NO está Pint-enforced (archivos no tocados también fallan) → sin churn de estilo en modificados; **los 2 archivos nuevos** (`FormulaCalculator`, migración) quedaron **Pint-clean** |
| DI del contenedor (`sail artisan tinker`) | ✓ resuelve `OnboardingController`, `MotaiValidationService`, `OtpService`, `UserService`, `RegisterCellPhoneService`, `LenderListingService` |
| Evaluador de fórmulas (CLI en contenedor) | ✓ renting `14360920` / credit identidad / encadenado / `alert(1)`, `system("ls")`, ternarios, prop-access **rechazados** |
| biome (front, 33 archivos cambiados) | ✓ limpio (1 warning **pre-existente** ajeno: `resolutionState` en `AvailableLenders.tsx`) |
| `tsc` app completo | ✓ **223 errores = baseline exacto** del repo → **0 errores nuevos** |
| Bug atrapado en el barrido | Un log de `UserService` referenciaba `$isMotaiRenting` ya removido (variable indefinida) → corregido |

Alcance: **legacy-backend 26 archivos** · **frontend-monorepo 37 archivos** (todo sin commit, para un commit único por repo).

---

## 5. Migración única (prerequisito de todo)

`legacy-backend/database/migrations/2026_07_15_120000_add_motai_v2_columns.php` — un solo archivo:

1. `lenders_by_allied_branches.document_types` (json) + backfill `["CC","CE"]`.
2. `lenders.product` (default `credit`) + `lenders.calculator` (json) + `lenders.abaco` (bool).
3. Backfill Motai 158: `renting` + fórmula + `abaco=true` + PEP en sus sucursales.

⚠ **Sin la migración, Motai se comporta como credit** (card estándar, sin PEP extra, sin Ábaco): todo el comportamiento renting depende ahora de config. Correr con `./vendor/bin/sail artisan migrate` (BD compartida con `application` — coordinar).

---

## 6. Pendientes (fuera de este cambio)

| # | Pendiente | Nota |
|---|---|---|
| 1 | **Correr la migración** + prueba E2E del flujo Motai | renting por `product`, PEP salta buró, card muestra `calculated.amount`, Ábaco por `lender.abaco` |
| 2 | **Commit único por repo** | Cuando el flujo esté probado (regla: sin push, sin PR hasta OK) |
| 3 | **Drop físico** de `allied_modes` / `user_request_modes` | Migración aparte revisada (BD compartida); el código ya no las toca |
| 4 | **TyC por entidad** | Redefinir dónde/cuándo se entrega (selección de lender); hoy Motai firma la default — **validar con legal** |
| 5 | Renombrar rutas `/api/onboarding/motai/*` → genéricas (`/abaco/*`) | Naming only; coordinar front+back |
| 6 | `PHP >= 8.4` en CI/prod para `symfony/expression-language ^8.1` | Si algún entorno corre 8.2 → re-pinear a `^7.0` |
| 7 | Story de storybook `MotaiRenting` | Mock desactualizado **de antes** (usa id 151, sin `product`): actualizar a `product:"renting"` + `calculated` para demostrar el card nuevo |
| 8 | Deshabilitar lenders que no aceptan PEP en el listado | Decisión de negocio anotada, explícitamente fuera de este alcance |
| 9 | Admin/CRUD para `product` / `calculator` / `abaco` / `document_types` | Hoy se editan por BD; para que operaciones lo gestione sin ingeniería |

---

## 7. Relación con otros docs

- Censo original de hardcodes: [mejoras/DES-MOTAIZACION.md](../mejoras/DES-MOTAIZACION.md) (este doc **ejecuta** buena parte de B1-B18/F1-F17).
- Spec de tipos de documento: [mejoras/MOTAI-V2-TIPOS-DOCUMENTO-POR-SUCURSAL.md](../mejoras/MOTAI-V2-TIPOS-DOCUMENTO-POR-SUCURSAL.md) (implementado con un ajuste: el dato viaja por el endpoint del comercio `AlliedInfoController`, no por `getPersonalInfoConfig`).
- Plan general y decisiones: [mejoras/MOTAI-PLAN-EVOLUCION.md](../mejoras/MOTAI-PLAN-EVOLUCION.md).
- La realidad previa del flujo Motai: [codigo/MOTAI-FLUJO-ANALISIS.md](../codigo/MOTAI-FLUJO-ANALISIS.md) (⚠ describe el estado ANTES de esta rama).
