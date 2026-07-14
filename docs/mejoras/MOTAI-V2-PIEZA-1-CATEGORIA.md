# Pieza 1 · Categoría de producto — spec de implementación

> **Es** el corazón de la des-motaización: hoy el comportamiento lo dispara un **id/modo clavado**;
> el target lo dispara una **categoría de lender**. Cerrar esta pieza es lo que mata el hardcode.
> **Deriva de:** `MOTAI-V2-MAPEO.md` (pieza 1) + `DES-MOTAIZACION.md` (B1/B7/B9/B10/B18, F4/F6).
> **Verificado** leyendo los repos reales (2026-07-14). ⚠️ `legacy-backend` estaba en la rama
> `fix/credifamilia-consumo-tasa-mensual-2-decimales` (no `staging`): los números de línea de legacy
> pueden variar ±; re-verificar al implementar sobre la rama de análisis.

---

## 1. Qué resuelve (target de `motai.html`)
- Los productos son **lenders CreditopX por categoría** (crédito / arrendamiento / arrendamiento-con-compra), elegidos en el **marketplace**.
- Una **categoría de lender** dispara el comportamiento (bypass de buró, Ábaco, TyC, card, etc.) — no `id == 158` ni un "modo".
- **Desaparece la pantalla de modos**.

## 2. Cómo está hoy — DOS disparadores redundantes

### A) Frontend — por **id 158** (`MOTAI_LENDER_IDS`)
| Archivo | Línea | Qué hace |
|---|---|---|
| `lenders-marketplace/.../domain/constants/lender.constants.ts` | 13 | `export const MOTAI_LENDER_IDS = [158]` — **la fuente** |
| `.../lender-card/LenderCardContent.tsx` | 22, 895, 1012 | `const isMotai = MOTAI_LENDER_IDS.includes(lenderData.id)`; `if (isMotai) {…}` → variante de card |
| `.../available-lenders/hooks/useLenderSelection.ts` | 7, 164 | `if (MOTAI_LENDER_IDS.includes(lender.id))` |
| `.../available-lenders/AvailableLenders.tsx` | 22, 554 | `if (MOTAI_LENDER_IDS.includes(Number(lender.id)))` |
| `lenders-marketplace/src/lib/index.ts` | 47 | re-export |
| `loan-application-form/.../phone-number-step-form.tsx` | 24, 26, 38, 44 | **DUPLICA** `const MOTAI_LENDER_IDS = [158]` local → `isMotaiRenting` → arma las **URLs de TyC/privacidad en S3** |

### B) Backend — por **modo** + flag `isMotaiRenting`
| Archivo | Línea | Qué hace |
|---|---|---|
| `Onboarding/.../Controllers/OnboardingController.php` | 36 | `const MOTAI_RENTING_ALLIED_MODE_ID = 2` (id de modo **clavado**, sin seeder) |
| ídem | ~1593 | `attachMotaiRentingModeIfNeeded()` → upsertea el modo id=2 (solo renting) |
| `Onboarding/.../Services/lenders/AlliedModeLenderFilterService.php` | — | el "filtro de entidades por modo" que **hoy no filtra** (NO-OP) |
| `Onboarding/.../Repositories/AlliedModeRepository.php`, `app/Models/AlliedMode.php` | — | acceso a `allied_modes` |
| Migración `..._create_merchant_modes_table.php` | — | crea `allied_modes` (nombre engañoso); `config` JSON solo lee `isAbacoRequired` + `lenders` |
| Front (payload) → back: `isMotaiRenting` propagado por ~13 archivos | — | `OnboardingController`, `RegisterCellPhone{Controller,Service}`, `OtpService`, `UserService`, `MotaiValidationService`, `LenderListingService`, `Send/ValidateOtpCodeRequest` (whitelist del campo), etc. |

**Nota:** el front (id 158) y el back (modo) son **dos mecanismos distintos para lo mismo**. El id 158 **no existe en el backend** (el acople por id es solo del front).

## 3. Qué crear (lo nuevo)
- **Categoría de lender**: columna/tabla nueva (no existe hoy; `lender_users_categories` segmenta USUARIOS, no lenders) + **seeder** que marca el 158 = `arrendamiento`.
- (`application` admin) exponer la categoría en el alta del lender.

## 4. Plan de cambios — dual-read, Motai nunca deja de funcionar
Orden sugerido (cada paso probado; el hardcode se borra al final):

1. **Crear la categoría** (BD + modelo + seeder 158→arrendamiento). No cambia comportamiento todavía.
2. **Dual-read en los evaluadores**: donde hoy dice `MOTAI_LENDER_IDS.includes(id)` / `isMotaiRenting`, leer **categoría** con *fallback* a los ids/modo viejos.
   - Front: `LenderCardContent.tsx`, `useLenderSelection.ts`, `AvailableLenders.tsx`, `phone-number-step-form.tsx` (+ borrar el duplicado local).
   - Back: derivar de la **fila del modo persistida** / categoría, no del string por request.
3. **Unificar el disparador del back**: matar `MOTAI_RENTING_ALLIED_MODE_ID = 2` → leer el modo por `code`+`allied_id` con **seeder** de `allied_modes` (B10/B18).
4. **Front por categoría**: variante de card y branding por **config** (no por id) — F4/F6.
5. **Borrar el hardcode** (PR final): `MOTAI_LENDER_IDS` (const + duplicado), `isMotaiRenting` + su plumbing (~13 archivos) + whitelist en OTP, la **pantalla merchant-mode**, `merchantMode`/`motai-renting` strings.

## 5. Checklist de la pieza (sub-tareas del subnodo `motai-v2`)
- [ ] Categoría de lender: BD + modelo + seeder (158 = arrendamiento)
- [ ] Dual-read front (4 archivos) con fallback a `MOTAI_LENDER_IDS`
- [ ] Dual-read back (derivar del modo persistido, no del request)
- [ ] Seeder de `allied_modes` + leer por `code`+`allied_id` (mata id=2)
- [ ] Card/branding por categoría (config), no por id
- [ ] Borrar hardcode: ids, flag, plumbing, pantalla de modos

## 6. Riesgos / dependencias
- **C2** (pieza 4): la categoría `arrendamiento` es la que hoy **salta el buró**; al cablearla hay que decidir si se mantiene el bypass o corre R1–R8 (revierte el corazón de `isMotaiRenting`). Coordinar con pieza 4.
- **Legal/TyC** (pieza 7): las URLs de TyC en S3 se arman con el mismo id (`phone-number-step-form.tsx:38/44`) → al des-idear, mover a `config.legalDocs`.
- **Líneas ±**: legacy leído en rama credifamilia; re-verificar en la rama de análisis.
