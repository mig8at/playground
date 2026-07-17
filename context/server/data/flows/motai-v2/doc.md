# Motai v2 · tarea
> **flujo:** **Motai** (v1 = como ES hoy, nodo padre) · **rama:** `feature/motai-v2` · **PR:** backend →develop · frontend →staging · **estado:** 🧪 en pruebas
>
> Des-motaizar la originación de Motai: reemplazar los ifs quemados (`isMotaiRenting`/`158`/modos) por **configuración** (product/calculator/document_types), hacia el modelo único paramétrico.

<!-- Esta tarea trabaja sobre el flujo Motai. El "cómo funciona Motai v1" NO se repite acá: vive en el flujo padre. Acá va el TARGET, lo ejecutado, la bitácora y los pendientes. -->

## Objetivo
Llevar Motai v1 (ver el nodo padre **Motai**) al deber-ser esquematizado en `playground/examples/motai.html` (PRD MVP2 + análisis de brechas). El target (7 piezas):
1. **CATEGORÍA DE PRODUCTO** — los productos dejan de ser 'modos' del comercio y pasan a ser LENDERS CreditopX por categoría (crédito / arrendamiento / arrendamiento-con-compra) elegidos en el marketplace; muere el disparador dual `isMotaiRenting` / `MOTAI_LENDER_IDS[158]` y la pantalla `merchant-mode`.
2. **INGRESOS por CASCADA** de fuentes (AgilData→Mareigua→TusDatos→Ábaco→Manual, 1ª que responde) → perfil App (Ábaco) / No-App (tradicional); persistir `average_income` de Ábaco (hoy se calcula y se descarta) y cablearlo.
3. **CALCULADORA ÚNICA** en backend (hoy quemada y DUPLICADA en front `LenderCardContent`/`useLenderSelection`): renting (tarifa PMT 24m /30*7 × factor) y RTO (valor a financiar con cuota inicial editable + anualidad semanal 52/78/104).
4. **VIABILIDAD R1–R8** por CONFIG en el motor de reglas que Motai HOY SALTEA (`DatacreditoQueryByAllied::userViability` + `RiskCentralValidationService` + `ProfilingRulesService`): 2 referencias, Datacrédito consultado, score≥400, canon $150k–$300k, cuota≤25% ing.semanal, deuda≤40% ing.mensual, endeudamiento<50%.
5. **DECISIÓN por INGRESO** (PRD): ≥$3M directa / <$3M codeudor — la FUENTE no cambia la decisión (App=No-App).
6. **CODEUDOR** = pieza NUEVA (modelo + formulario + gate score>650), solo si ingreso<$3M.
7. **PEP** (sin historial local): identidad + Datacrédito no consultables → DECISIÓN DE NEGOCIO ABIERTA (validación manual / exención de política / garantía).

El flujo termina en la **PANTALLA DEL ASESOR** (aprobar / validar codeudor / rechazar); firma/desembolso/cobranza (`PromissoryNote`, `LoanAuthorizationService` Estado 11, servicing `motai/update-status`) son POST-APROBACIÓN, **fuera del alcance** del target.

## Lo que se hizo
<!-- por frente: QUÉ · POR QUÉ · dónde vive · CÓMO AJUSTAR -->

### 1 · Des-hardcode de Motai (front + back)
Eliminados end-to-end `isMotaiRenting` / `merchant_mode` / `MOTAI_LENDER_IDS` / id 158 como lógica (0 referencias por grep). El comportamiento pasó a config: `lenders.product` (credit|renting|rto) decide la card y los skips; `lenders_by_allied_branches.document_types` habilita PEP por sucursal; el salto de buró es el bypass por documento PEP (ya existía). **Ajustar** = editar columnas, no código.

### 2 · Muerte de los "modes"
Deprecadas en código `allied_modes`/`user_request_modes` (+6 archivos borrados, filtro `AlliedModeLenderFilterService` eliminado, página merchant-mode del front borrada). Eran la raíz del código quemado y de una inconsistencia: el usuario pre-elegía el producto en una pantalla previa y `/lenders` re-decidía con ese modo, rompiendo el flujo normal. Ahora `/lenders` decide como cualquier solicitud. Las TABLAS siguen en BD (drop físico pendiente, BD compartida con application).

### 3 · Calculadora renting/rto en BD
`lenders.calculator` (json `{params, formulas:{amount, payment}, plans|terms}`) evaluado en backend por `app/Support/FormulaCalculator.php` (symfony/expression-language, sin eval, fail-safe → degrada a `{amount}`). `LenderListingService::buildCalculated` corre la fórmula por fila de plans/terms y adjunta `calculated` por lender; la card (`RentingLenderCardContent`) SOLO LEE. **Ajustar precio/cuota = editar el json en BD.** ⚠ El calculator de 158 sembrado en la migración solo trae `formulas.amount` (sin plans/payment → sin selector de cuotas); las plans se probaron con lenders clonados (169/170 en local).

### 4 · Ábaco: flag removido (lo maneja otro equipo)
Se había agregado `lenders.abaco` (bool) y se REMOVIÓ (commit 5013f4af): la forma final la define el equipo de Ábaco. `MotaiValidationService:82` queda como seam (`lender->abaco` → null → false = "no requerido") → **hoy nadie entra al flujo Ábaco** hasta que ellos cableen la fuente. El endpoint `/api/onboarding/motai/check-abaco-requirement` sigue vivo (lo consumen 4 loaders del wizard) — NO borrar; candidato a rename `/abaco/*`.

### 5 · TyC por comercio (`allied_documents`)
Tabla nueva: `allied_id` + `type` (terms_and_conditions|data_policy|…) + FK a `terms_and_conditions` (la URL ya vivía ahí; lo que se movió a config es el MAPEO comercio→documento). `storeTermsAndConditions`: docs del comercio si existen; si no, DEFAULT en código (último TyC activo + doc 13). Backfill solo Motai 158 (16+17). ⚠ Config por comercio REEMPLAZA al default (debe ser completa) · backfill no idempotente · docs 13/18 siguen hardcodeados en el fallback.

### 6 · Recálculo de monto en /lenders (endpoint liviano)
`GET lenders-v2/{ur}/recalculate?amount=` corre SOLO FormulaCalculator (~0.15s vs ~0.67s el listado) — la elegibilidad y el cupo del pre-aprobado son del USUARIO (amount-independientes), así que al cambiar el monto NO se re-corren pre-aprobados. Front: debounce 450ms → `recalcFetcher.load('/merchant/…/lenders/recalculate')` → merge del `calculated` en las cards. Monto STATELESS (no se persiste ni va a la URL). Borde conocido: lenders con monto mínimo (welli/meddipay/prami/bancolombia-consumo) no se re-consultan solos al cruzar el mínimo — botón "reintentar" por card (gateado por `requestedAmount >= minimumAmount`).

## Cómo probar / validar
**Barrido grep de completitud** (2026-07-15, ambos repos) — prueba de que la des-motaización no dejó lógica quemada:

| Búsqueda | frontend-monorepo | legacy-backend |
|---|---|---|
| `isMotaiRenting` / `is_motai_renting` | **0** | **0** |
| `merchantMode` / `merchant-mode` / `merchant_mode` | **0** | **0** |
| `MOTAI_LENDER_IDS` | **0** (constante+export borrados) | n/a |
| ruta de modos (`merchant-mode.tsx`, `route("modes")`, `partner_modes`) | **0** | **0** |
| `allied_modes` / `user_request_modes` (código) | n/a | **0** (solo 3 comentarios "deprecado"; tablas quedan en BD) |
| id `158` como **lógica** | **0** | **0** |

Lo que legítimamente queda con "motai"/"158" NO es lógica bypasseada: el `158` en la migración es **backfill de datos** (el id vive en config, no en `if`s); `field_id==158` en EAV es falso positivo; `MotaiValidationService`/rutas `/api/onboarding/motai/*` son **nombres** de endpoints que consume el front (lógica interna ya genérica); el bypass PEP en `storePersonalInfo` es el mecanismo correcto (keyea por `document_type==='PEP'`). Prueba E2E del flujo pendiente (requiere la migración corrida) — ver Pendientes.

## Plan y decisiones (deber-ser)
Síntesis del plan maestro (absorbe `MOTAI-PLAN-EVOLUCION` + `DES-MOTAIZACION` + specs, para no abrir los docs):
- **Roadmap E0–E4:** E0 saneamiento (persistir `average_income` de Ábaco —hoy se descarta—, endpoint muerto, seeder del modo) → E1 categoría de producto (dispara el comportamiento, lee con respaldo a los ids viejos) → E2 calculadora a backend (una fórmula, config por producto) → E3 legal por config (TyC por comercio) → E4 reglas por config (buró/fuentes/tipos de documento). Regla de oro: **Motai nunca deja de funcionar** (dual-read, los ids se borran al final).
- **PIVOT §10:** los productos = **lenders CreditopX por CATEGORÍA** (CTPX-BUY / CTPX-RENT / CTPX-RTO), hermanos de CrediPullman/SmartPay; muere `isMotaiRenting`/`MOTAI_LENDER_IDS[158]`/la pantalla merchant-mode; la ficha del comercio queda flaca (marca + qué lenders habilita).
- **Censo** B1-B18 (backend) / F1-F17 (frontend) verificado vs staging.
- **Conflictos C1–C10** (a resolver con negocio): C1 terminología (el "renting" del código = "rent-to-own" del negocio), C2 buró (¿R2 "Datacrédito 100%" aplica a PEP?), C9 score mínimo (PRD dice **400** en un lado y **0** en otro), **C10 la columna "semanas" del simulador RTO está mal: son 52/78/104** (= 12/18/24 meses).
- **Decisiones D1–D7** (diseño): productos como lenders por categoría, ficha flaca, herencia no-copia de reglas, actor administrador separado del asesor, etc.
- **8 PRs dual-read** en `DES-MOTAIZACION.md`. Es el **primer escalón ejecutado** del deber-ser del group Plataforma.

## Bitácora
- **2026-07-15** — Arranque de la des-motaización sobre `feature/motai-v2` (nacida de staging). Censo re-verificado B1-B18/F1-F17 en `docs/mejoras/DES-MOTAIZACION.md`.
- **2026-07-17** — **Retargeteo del PR de legacy a `develop`** (por pedido del líder; nació de staging). Conflictos resueltos con merge de develop (`44eb3c02`). Consecuencia: el diff del PR vs develop arrastra la divergencia staging↔develop (~52 archivos) — no todo es nuestro. **Frontend NO se retargeteó** (sigue →staging, limpio). Fixes que entraron por el merge (bugs pre-existentes de develop que rompían local): `$hasCredifamilia` indefinido (`098322a8`, **también vive en develop → avisar al equipo**) y ProfilerML 500 sin `H2O_API_HOST` (`4022b6c9`).
- **2026-07-17** — Ábaco: se removió el flag `lenders.abaco` (lo define otro equipo). Endpoint check-abaco-requirement conservado como seam.

## Pendientes
- [ ] Migración en staging/prod (por pipeline); sin ella Motai se comporta como `credit`.
- [ ] Calculator de 158 con plans/payment (hoy solo `amount`) + backfills idempotentes.
- [ ] RTO: seed terms 52/78/104, card propia, fórmula VF (el PRD no reversa limpio).
- [ ] TyC: docs 13/18 hardcodeados + validar entrega por entidad con legal.
- [ ] Drop físico `allied_modes`/`user_request_modes` · PHP≥8.4 en CI · rename rutas `motai/*` · CRUD admin de product/calculator/documents.

## Enlaces
- **Jira:** CORE-265 (flujo unificado) · CORE-266 (calculadora) · CORE-267 (TyC) · CORE-268 (recálculo de monto) — sprint CORE Sprint 7.
- **Docs:** cambios consolidados `docs/chages/MOTAI-V2-MAPA-DE-CAMBIOS.md` · plan `docs/mejoras/DES-MOTAIZACION.md` (censo + 8 PRs dual-read) · mapeo `docs/mejoras/MOTAI-V2-MAPEO.md`.
- **Flujo padre:** nodo **Motai** (v1).
