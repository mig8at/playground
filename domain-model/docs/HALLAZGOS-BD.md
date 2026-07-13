# Hallazgos de BD — resolución de las cuestiones abiertas del deber-ser

> **Naturaleza:** verificación **100% read-only** contra el dev remoto (solo `SELECT`/`SHOW`/
> `information_schema`). **Cero cambios a la base de datos.** Los resultados se documentan en el
> deber-ser local (`modelo-dominio.json`) vía `scripts/apply-db-findings.mjs` — no se toca dev.
>
> **Fecha:** 2026-06 · Queries en `queries-cuestiones-abiertas.sql`.

---

## 1. Cardinalidad de canales → **N:M** (vía tabla puente)

**Evidencia:**
- Existen `user_requests_by_payment_links` (cols: `id, user_request_id, payment_link_id`) y
  `user_requests_by_ecommerce_request` (cols: `id, ecommerce_request_id, user_request_id`).
- Ambas tablas **solo tienen PRIMARY en `id`** — **sin UNIQUE** en `user_request_id`.
- `user_requests` **no** tiene columna `payment_link_id` ni `ecommerce_request_id` (no hay FK directa).

**Decisión (deber-ser):** la relación canal↔solicitud es **N:M** vía puente, no N:1 directa.
- `ecommerceRequest → loanApplication`: **N:M** (vía `user_requests_by_ecommerce_request`).
- `paymentLink → loanApplication`: **N:M** (vía `user_requests_by_payment_links`); un link masivo origina N solicitudes.

---

## 2. `role` ↔ `user_profile` → **el mismo eje (1:1)**

**Evidencia:**
- `roles` = 13 filas (1–12 idénticas en nombre a `user_profiles`; roles agrega `13 Entidad Comercio`).
- `user_profiles` = 12 filas (1–12).
- `model_has_roles`: único `model_type` = `App\Models\User` (4913 actores).
- **4898/4898** usuarios con asignación de rol tienen **`role_id == user_profile_id`** (coincidencia total).
- `users`: 227 597/227 597 con `user_profile_id` poblado.

**Decisión (deber-ser):** `Role` y `UserProfile` son **el mismo eje conceptual (1:1)**. El RBAC (Spatie)
y la visibilidad por estado (`status_per_profiles`) comparten identidad. Documentado en `role.descripcion`.

---

## 3. `multiple_allieds` → **N:M Customer↔Merchant real** (denormalizado, ~2%)

**Evidencia:**
- `users.multiple_allieds` = `varchar(255)` nullable; **no** hay tabla puente users↔allieds.
- Poblado: **4 671** no-null vs 222 926 null (~2%). Valores = arrays JSON: `"[148]"`, `"[94]"`, `"[]"`, `"[null]"`.

**Decisión (deber-ser):** es una relación **N:M Customer↔Merchant** denormalizada como array JSON
(sparse). `merchant_id` es el comercio primario; `multiple_allieds` el conjunto extendido.
**Normalizado** a la entidad bridge **`CustomerMerchant`** (`customer_id`, `merchant_id`, `is_primary`,
`status`), miembro del agregado `Customer`. El atributo `multiple_allieds` se conserva como mapeo legacy
para migración. (Solo en el deber-ser; la BD no se toca.)

---

## 4. FKs colgantes → **referencias a tablas inexistentes**

**Evidencia:**
- De `payment_plans`, `credit_note_calculations`, `starting_value_calculations`, `treasury_calculations`
  → **solo existe `treasury_calculations`**.
- `treasury_calculations`: `id, name, description, formula (text), sort, status, created_at, updated_at`
  → es el **catálogo de fórmulas de pricing** (confirma el VO `PricingFormula`).

**Decisión (deber-ser):** `merchant.payment_plan_id`, `lenderTerms.credit_note_calculation_id` y
`lenderTerms.starting_value_calculation_id` son **referencias colgantes** (tabla destino inexistente).
Anotadas como tal; el pricing real vive en `treasury_calculations`/`PricingFormula`. Resolver (apuntar
al catálogo) o eliminar.

---

## 5. Grano del KYC en modo agregador → **per-lender** (ya estaba modelado)

**Evidencia:**
- `jumio_accounts` y `crosscore_evaluations` **traen `lender_id`** (+ `user_id`, `user_request_id`).
- `metamap_logs`, `ocr_logs`, `compare_face_logs`, `validations` **no** traen `lender_id`.
- `jumio_accounts`: UNIQUE solo en `uuid` (e `id`); `lender_id`/`user_id` indexados no-únicos.
- Empírico: en la muestra, cada `user_id` tiene 1 `lender_id` distinto (per-lender, hoy mayormente 1).

**Decisión (deber-ser):** la verificación de Jumio/CrossCore es **per-lender** (grano
`(customer, application, lender)`). El modelo **ya** tenía `lender_id` en `jumioVerification` y
`crosscoreEvaluation` — el dato de dev lo **confirma**, no requirió cambio.
