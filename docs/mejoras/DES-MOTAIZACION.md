# Des-Motaización — censo verificado y ejecución del des-hardcodeo

> **Pedido (2026-07-12).** "Eliminar el código hardcodeado o muy atado a Motai y hacerlo genérico,
> para que diferentes comercios puedan ofrecer renting." Este documento es la **especificación de
> ejecución** de ese pedido: el censo de hardcodes **re-verificado hoy contra los repos**, el
> mecanismo genérico que los reemplaza, la traducción del PRD de Manuela (MVP2) a configuración, y
> el orden de PRs para ejecutarlo sin romper Motai.
>
> **Relación con los docs previos** (no los repite; los aterriza):
> - [MOTAI-PLAN-EVOLUCION.md](MOTAI-PLAN-EVOLUCION.md) — el plan maestro E0–E4 y el pivot §10
>   (productos = lenders CreditopX por categoría). Este doc **ejecuta su Etapa 1** con el detalle
>   fino y el censo al día.
> - [MODELO-RENTING-PROPUESTA.md](MODELO-RENTING-PROPUESTA.md) — la versión para negocio.
> - `motai-manu.pdf` (Manuela Romero, Dir. Producto, 23/05/2026) — el PRD MVP2, digerido acá en §4.
>
> **Verificación:** anclas de código re-validadas el **2026-07-12** con barrido independiente sobre
> `legacy-backend` y `frontend-monorepo` (`application`: sin lógica Motai, solo esquema/copy).

---

## 1. La idea en una página

Hoy el flujo "sabe" que es Motai por **identificadores clavados** (`lender 158`, `isMotaiRenting`,
`'motai_renting'`, TyC 16/17, modo id 2) repartidos por backend y frontend. El reemplazo NO es
inventar infraestructura nueva — es usar la que ya existe como la usan los demás productos:

| Principio | Qué significa |
|---|---|
| **1. La CATEGORÍA del producto dispara el comportamiento** | `if categoria == 'arrendamiento'` reemplaza a `if lender == 158 / isMotaiRenting`. Hoy NO existe campo de categoría de lender: **crearlo es el corazón del trabajo**. |
| **2. Productos = lenders CreditopX del catálogo** | Compra / renting / rent-to-own son lenders hermanos (rt=2), como CrediPullman o SmartPay. Se cae el eje "modo del comercio" (y su pantalla). |
| **3. La config vive POR LENDER** | Reglas (`lender_rules`/`lender_datacredito_rules`), precio (`credit_line_by_lenders` + extensiones), documentos (plantillas legales). El CRUD de admin ya existe. |
| **4. La ficha del comercio queda FLACA** | Branding + qué lenders habilita (`lenders_by_allieds`) + cómo decide (manual/mixta/automática — lo único nuevo a nivel comercio). |
| **5. Sin defaults mágicos** | Lo que no está configurado, no aplica (fail-closed donde toque riesgo). El front no interpreta strings de modo: lee config que ya viaja. |

**Referencia visual del deber-ser:** el simulador `playground/flow` ya modela este target — los
productos (Crédito / Renting / Renting con compra) son un **atributo del lender** en el catálogo,
las reglas viven por nivel (entidad → comercio → sucursal → categoría) con herencia pisada, y la
formalización se ramifica por tipo de respuesta, no por ids. Sirve para mostrar el modelo a negocio
sin leer código.

---

## 2. Qué se quita, qué se reusa, qué se crea

| Quitar (hardcode) | Reusar (ya existe) | Crear (nuevo) |
|---|---|---|
| `isMotaiRenting` + rama bypass | Motor in-platform CreditopX (originación → firma → desembolso) | **Categoría de producto** en el catálogo de lenders |
| `MOTAI_RENTING_ALLIED_MODE_ID=2` + pantalla de modos | `allied_modes.config` JSON (transición) y `partner_modes` al front | Cálculo de precio **en backend** (una sola fuente) |
| `MOTAI_LENDER_IDS=[158]` + comparaciones de string en rutas | CRUD de reglas del admin (`lender_rules` / `lender_datacredito_rules`) | Extensiones: frecuencia **semanal**, margen/alistamiento/IVA en BD |
| Calculadora quemada y duplicada en el front | Filtro `AlliedModeLenderFilterService` (hoy NO-OP) | Codeudor (modelo + flujo + regla score) — Etapa 4 |
| TyC 16/17/18/13 ×3 lugares + legal atado a Credifamilia | Patrón legal de Credifamilia (PDF → S3 → correo/WhatsApp) | Pantalla/rol de decisión del comercio — Etapa 2 |
| PEP literal + `VENEZOLANA` + laboral ficticia | Ábaco end-to-end (plataformas → OTP → `average_income`) | Cablear `average_income` a la decisión — Etapa 4 |

---

## 3. Censo de hardcodes (verificado 2026-07-12)

> **✅ Validado contra `staging` (2026-07-12).** Se confirmó que **todo el código de Motai vive en la
> rama `staging`** de ambos repos (no es exclusivo de ramas de feature). Estado al validar: legacy
> `staging` = `d0a9446c` (1-jul, merge de main) · frontend `staging` = `f2223ac8` (10-jul). `git pull`
> de staging en ambos = *already up to date*. `application`: sin lógica Motai (§3.3). Los marcadores
> clave coinciden en staging con las anclas de abajo (const modo en `OnboardingController.php:36`,
> `MOTAI_LENDER_IDS` en `lender.constants.ts:13` **+** `phone-number-step-form.tsx:24`, la decisión
> backdoor `motaiUpdateStatusOrchestrator`/`MotaiUpdateStatusRequest`, `MotaiValidationService`,
> `AlliedModeLenderFilterService`, Ábaco). El barrido de legacy corrió sobre `fix/credifamilia-…`
> (7-jul, *adelante* de staging) pero la **superficie Motai es idéntica** entre esa rama y staging,
> así que las líneas de abajo son válidas para staging. En el front, staging es aún más amplio de lo
> enumerado (`isMotaiRenting` en 16 archivos, "motai" en 29) — F1–F17 son el subconjunto que carga
> el peso; el resto es plumbing/tests/traducciones.
>
> Leyenda **tipo**: 🔀 = condicional que ramifica comportamiento · 🔢 = constante/id/string mágico ·
> 🎨 = branding/copy quemado · 💰 = default de negocio quemado. **Etapa** = cuándo se elimina.

### 3.1 legacy-backend

> Raíz real: `github/legacy-backend`. Anclas validadas en `staging` (`d0a9446c`) y en `fix/credifamilia-…`
> (7-jul, adelante de staging); superficie Motai idéntica entre ambas.
> Dato clave: **el id `158` NO existe en el backend** — el acople por id de lender es solo del front;
> acá el eje es `isMotaiRenting` / el modo. Prefijo: `Modules/Onboarding/App/` salvo indicación.

**🔀 Condicionales que ramifican comportamiento**

| # | Hardcode | Dónde (verificado 2026-07-12) | Reemplazo |
|---|---|---|---|
| B1 | Disparador dual `isMotaiRenting === true \|\| merchant_mode === 'motai_renting'` | `Http/Controllers/OnboardingController.php:1216` | derivar de la **fila persistida** del modo (PR-4); string muere (PR-6) |
| B2 | Rama bypass: fuerza `corbeta=false` (`:1222`), salta userViability/Experian (`:1279`), salta `validateRiskCentrals` (`:1311`) | `OnboardingController.php:1217-1311` | `config.underwriting.skipBureau` por categoría, **fail-closed** (PR-4) |
| B3 | Persistencia del modo SOLO renting: `attachMotaiRentingModeIfNeeded()` desactiva modos y upsertea id=2 | `OnboardingController.php:1577-1599` | persistir SIEMPRE el modo elegido (PR-0) |
| B4 | Gate Ábaco `MOTV1000/1/2` por `config['isAbacoRequired']` | `Services/MotaiValidationService.php:110-111, 183-189` (mapas `:139-159`) | flag legítimo — queda, pero como config de categoría/lender, servicio renombrado (PR-4/6) |
| B5 | TyC por rama `if($isMotaiRenting)` → ids 16/17 (si no, 18/13) — **duplicado en 2 servicios** | `Services/RegisterCellPhoneService.php:411-442` · `Services/UserService.php:325-362` (+ id 18 en `OnboardingController.php:120,810,812`) | `config.legalDocs` una sola fuente (PR-3) |
| B6 | Bypass PEP: `isPEP` → inyecta laboral ficticia `1500000/'Empleado'/3` | `Services/OnboardingService.php:314, 338` | `config.underwriting.documentTypes` + captura/omisión declarada (PR-4) |
| B7 | Whitelist del campo `isMotaiRenting` en la validación de OTP (“only motai renting uses this field”) | `Http/Requests/ValidateOtpCodeRequest.php:36` · `SendOtpCodeRequest.php:40` | muere con el flag (PR-6) |
| B8 | Grupo de rutas `motai/` (`check-abaco-requirement`, `update-status`) | `routes/api.php:196-198` | rutas genéricas por categoría (PR-6, con alias de compat) |
| B9 | Plumbing del flag (propagación, no decide): RegisterCellPhone{Controller,Service}, OtpService, UserService, OnboardingController | ~15 puntos (`RegisterCellPhoneService.php:64-240`, `OtpService.php:364,371`, `UserService.php:58-371`, `OnboardingController.php:903-904`) | desaparece al derivar del modo persistido (PR-4/6) |

**🔢 Constantes / ids / strings mágicos**

| # | Hardcode | Dónde | Reemplazo |
|---|---|---|---|
| B10 | `MOTAI_RENTING_ALLIED_MODE_ID = 2` (sin seeder de `allied_modes` — fila insertada a mano) | `OnboardingController.php:36` (uso `:1583`) | leer por `code`+`allied_id` + **seeder** (PR-0) |
| B11 | Decisión manual backdoor: `motaiUpdateStatusOrchestrator` → `approve ? 11 : 9` + voucher; request solo `approve` bool (no existe “validar codeudor”) | `BackDoorUserService.php:569-642` · `MotaiUpdateStatusRequest.php` | Etapa 2 (rol+auth+auditoría); el 3er botón es Etapa 4 |
| B12 | Legal atado a Credifamilia: `ENABLED_LENDERS_FOR_LEGAL=[24]`, `templateProject='credifamilia'`, filename `…_CREDIFAMILIA_….pdf` | `LegalService.php:31,35,41` | `config.legalDocs.templates` por lender (PR-3) |
| B13 | `$lender_id = 24` quemado en la consulta Datacrédito por aliado | `Modules/Risk/…/DatacreditoQueryByAlliedController.php:385` | parámetro/config (PR-3/4) |

**⚙️ Piezas rotas o desconectadas (sanear en PR-0; cablear en E4)**

| # | Hallazgo | Dónde | Acción |
|---|---|---|---|
| B14 | `GET scraping/init/gig-economy` **roto**: llama `initGigEconomyFromToken()` que no existe (solo `initGigEconomy` `:278`) | `AbacoController.php:42-51` · `routes/api.php:205` | borrar la ruta (PR-0) |
| B15 | Webhook Ábaco **NO-OP**: dispatch comentado (`:611-612`), `webhook_enabled=false` (Setting `abaco_config`) | `AbacoService.php:599-628, 29, 76` | decidir webhook vs polling (PR-0 / E2) |
| B16 | `average_income` — peor que huérfano: se calcula (`AbacoParserService.php:168-190`) pero el único consumidor (`AbacoService.php:575`) **ignora la clave y NO se persiste en BD** | ver ↑ | persistirlo + cablearlo a la decisión (E4; el PRD entero depende de este dato) |
| B17 | Filtro de lenders por modo **NO-OP**: lee `config['lenders']` pero ningún config lo trae | `Services/lenders/AlliedModeLenderFilterService.php:16-42` (cableado en `LenderRetrievalService.php:211`, `LenderListingService.php:127`) | poblarlo vía config (PR-1) o retirarlo al morir el eje modo |
| B18 | Migración con nombre engañoso: el archivo dice `create_merchant_modes_table` pero crea **`allied_modes`**; `config` JSON hoy solo lee `isAbacoRequired` + `lenders` | `database/migrations/2026_03_09_204622_…` | documentar; el seeder de PR-0 fija el contrato |

**Adyacente (mismo anti-patrón, tema PEP/migrante — no es Motai, aprovechar el viaje):** bypass de
reglas duras por **nacionalidad venezolana + lender Magnocell** (`Modules/Loans/…/LenderUserCategoryService.php:66-75,354-368`,
`LenderValidationService.php:340-342`) y mapa `['PEP'=>'V']` de Corbeta (`app/Actions/Allieds/Corbeta.php:24`).
El dummy laboral `1500000/'Empleado'/3` también aparece en ramas corbeta/Pash/AgilData genéricas
(`OnboardingService.php:620-623,735`, `OnboardingController.php:1325`) — al parametrizar B6, decidir
si esas ramas se absorben o quedan. Device-lock (Trustonic/IMEI): **separación limpia confirmada**.

### 3.2 frontend-monorepo

> Raíz real: `github/frontend-monorepo`. Prefijos abreviados: `modules/` =
> `modules/loan-request-wizard/` · `routes/` = `apps/loan-request-wizard/app/routes/`.

**🔀 Condicionales que ramifican comportamiento**

| # | Hardcode | Dónde (verificado 2026-07-12) | Reemplazo |
|---|---|---|---|
| F1 | `MOTAI_LENDER_IDS.includes(lender.id)` → sobreescribe el monto con el precio inflado | `modules/lenders-marketplace/…/useLenderSelection.ts:164` | categoría `arrendamiento` + precio de backend (PR-1/2) |
| F2 | Motai salta la validación de cuota inicial (“EXCEPCIÓN PARA MOTAI RENTING”) | `modules/…/AvailableLenders.tsx:553-557` | comportamiento por categoría (PR-1) |
| F3 | Rama Motai en loader/action del marketplace: salta OTP/modal → `continue` (“perfil Gig-economy”) | `routes/lenders-marketplace/available-lenders.tsx:77, :554-560` | ídem (PR-1) |
| F4 | `isMotai` selecciona el componente `MotaiLenderCardContent` | `modules/…/LenderCardContent.tsx:895` | variante por categoría, branding por config (PR-5) |
| F5 | `merchantMode === "motai-renting"` habilita la opción PEP | `modules/loan-application-form/…/personal-info-form.tsx:63-69` | `config.underwriting.documentTypes` (PR-4/5) |
| F6 | `isMotaiRenting: merchantMode === "motai-renting"` en el payload de 5 rutas | `routes/phone-number.tsx:190` · `otp-verification.tsx:131` · `loan-request-form.tsx:257` · `bancolombia/onboarding/otp.tsx:241` · `register.tsx:126` | leer `config` de `partner_modes` (PR-5); el back deriva de la fila persistida (PR-4) |
| F7 | Ramas `isAbacoRequired` que cambian destino final (`requestSent` vs `firstPaymentDate`) y pantallas de polling | `routes/loan-continue.tsx:349,393,400,433` · `identity-validation-status.tsx:188-189,596` | flag legítimo de config — dejar, pero alimentado por config del lender (no del modo) |

**🔢 Constantes / ids / strings mágicos**

| # | Hardcode | Dónde | Reemplazo |
|---|---|---|---|
| F8 | `MOTAI_LENDER_IDS = [158]` **duplicado** | `modules/lenders-marketplace/…/lender.constants.ts:13` **+** re-declarado inline en `phone-number-step-form.tsx:24` | muere con la categoría (PR-1/6) |
| F9 | Fórmula del precio quemada y **duplicada**: `(monto + 1.500.000) · 2 · 1,19` | `modules/…/LenderCardContent.tsx:236-245` (`getMotaiTotalAmount`, usada en `:810`) **+** `useLenderSelection.ts:164-176` | endpoint de pricing en backend (PR-2) |
| F10 | Paths de API con “motai” quemado | `abaco.repository.ts:30` (`/api/onboarding/motai/check-abaco-requirement`) · `financial-profile.repository.ts:75,81` (`/api/onboarding/motai/update-status`) | rutas genéricas por categoría/config (PR-4/6) |
| F11 | Polling Ábaco `36` intentos (vs 15/20) | `modules/identity-validation/…/validation-polling.constants.ts:3` (consumido en `loan-continue.tsx:447`, `identity-validation-status.tsx:718`) | config de polling por validación (PR-5, menor) |
| F12 | String `"motai-renting"` — 6ª aparición | `personal-info-form.tsx:66` | ídem F6 |

**🎨 Branding / copy / UI quemado**

| # | Hardcode | Dónde | Reemplazo |
|---|---|---|---|
| F13 | Pantalla de modos con branding Motai: `motai-bg.png`, colores `#010C4E80/#96A5FF/#293AA0/#010C4E`, `alt="motai-logo"` | `modules/loan-application-form/…/merchant-mode.tsx:5,19,21,26-28,33` (ruta `routes/loan-application-form/merchant-mode.tsx`, path `"modes"`) | `config.branding`; la pantalla entera muere si D6 confirma marketplace (PR-6) |
| F14 | Copy de la tarjeta Motai (“Te financiamos”, “* El valor total…”) + colores violeta | `LenderCardContent.tsx:824,838` | copy por config/categoría (PR-5) |
| F15 | **PDFs legales de Motai en URLs S3 quemadas** (Política de datos + TyC `…_MOTAI_V20260310.pdf`) | `phone-number-step-form.tsx:39,45` | `config.legalDocs.templates` (PR-3) |

**💰 Defaults de negocio quemados**

| # | Hardcode | Dónde | Reemplazo |
|---|---|---|---|
| F16 | Tarjeta PEP: `nationality:"VENEZOLANA"`, `gender:"-"`, `birthdate:"- - -"` | `modules/loan-application-form/…/init-loan-request.tsx:266-268` (PEP dispara `PepCard` + paso fecha de expedición `:259-281`) | captura real o config por tipo de documento (PR-4/5) |
| F17 | `terms: true` quemado en el payload (consentimiento) | `routes/phone-number.tsx:187` · `bancolombia/onboarding/register.tsx:123` · `otp-resend.tsx:122` | consentimiento real ligado a `config.legalDocs` (PR-3/5) |

**Patrón adyacente (mismo anti-patrón, no-Motai — aprovechar el viaje):** `ONVACATION_LENDER_IDS=[313]`
(`phone-number-step-form.tsx:25`, ramifica URLs legales igual que Motai) y
`HIDE_AVAILABLE_CREDIT_TAG_LENDER_IDS=[160]` (`lender.constants.ts:31`, ya con `TODO(backend)`): la
solución de categoría+config debería absorberlos también. El flujo IMEI/device-lock NO se cruza con
modos/renting (solo comparte el mecanismo de polling) — confirmado fuera de alcance.

### 3.3 application

**Confirmado (2026-07-12): sin lógica Motai.** Solo copy de marketing (3 spans idénticos en
`resources/js/pages/customer/lenders/list/v2/ListLenders.vue:296,813,1225`) y 2 migraciones de
esquema Ábaco (settings + columna `abaco` en `user_summaries`). Nada que des-hardcodear acá; el
servicing/cobranza que vive en este repo es workstream aparte (§6).

---

## 4. El PRD de Manuela (MVP2) traducido a configuración

El PRD define la política del renting/rent-to-own. La lectura clave: **casi todo es CONFIG, no
código** — reglas con clave estable + valor, por categoría de producto. Solo tres piezas son código
nuevo (codeudor, patrimonio, frecuencia semanal).

### 4.1 Las reglas universales (R1–R8) como claves estables

Los "R1/R2…" del PRD son posicionales (insertar una regla renumera todo). Se usan claves estables
`dominio.atributo_[min|max|required]` (catálogo del plan §10.2, completado con el detalle de las
páginas 7–11 del PRD):

| Clave estable | PRD | Valor | ¿Existe hoy? |
|---|---|---|---|
| `references.count_min` | R1 | 2 referencias | existe (EAV 176–182) |
| `datacredito.query_required` | R2 | 100% de solicitantes | existe · **revertir bypass** (C2) |
| `datacredito.score_min` | R3 | 400 ⚠️ (vs 0 en §5 del PRD — C9) | existe (`lender_datacredito_rules.score`) |
| `datacredito.overdue_max` | §5 | mora vigente ≤ $10M aceptable | existe (`current_dues`) |
| `capacity.debt_to_networth_max` | R8/§5 | endeudamiento < 50% patrimonio | **nuevo** (no hay campo patrimonio) |
| `pricing.canon_weekly_min` | R4 | canon semanal ≥ $150.000 | existe · extender a semanal |
| `pricing.canon_weekly_max` | R5 | canon semanal ≤ $300.000 | existe · extender a semanal |
| `capacity.installment_to_weekly_income_max` | R6 | cuota ≤ 25% ingreso semanal promedio | existe (field 87 + cuota) |
| `capacity.dti_monthly_max` | R7 | (deudas + cuota) ≤ 40% ingreso mensual | existe (`lender_users_category_rules`) |
| `cosigner.required_below_income` | §3/§4 | codeudor si ingreso < $2.9M | **nuevo** |
| `cosigner.score_min` | §4/§5 | score codeudor > 650 | **nuevo** (regla datacrédito sobre el codeudor) |

### 4.2 La política por perfil (App / No-App) — es la MISMA regla con otra fuente

El PRD la presenta como 4 filas, pero es **una** matriz: `fuente de ingreso × umbral`:

| Perfil | Fuente del ingreso | Ingreso ≥ $3M | Ingreso < $2.9M |
|---|---|---|---|
| **App** (conductores) | **Ábaco** (`average_income` — ⚠ hoy se calcula pero **ni se persiste ni nadie lo lee** (B16); persistirlo + cablearlo es prerequisito de TODA esta política — Etapa 4) | Aprobación directa | Condicional: **codeudor obligatorio** |
| **No-App** (empleados/independientes) | AgilData + Mareigua + TusDatos (cascada que ya existe) | Aprobación directa | Condicional: **codeudor obligatorio** |

→ En config: `underwriting.incomeSources = ["abaco"] | ["agildata","mareigua","tusdatos"]` por
perfil detectado, y las reglas de arriba se evalúan igual. **No hay código específico por perfil**,
solo la fuente del dato. (Mapeo operativo del PRD: Palenca→Ábaco; extractos+cert laboral→centrales.)

### 4.3 Rangos de cuota por perfil (tope de canon dinámico)

| Perfil | Ingreso mensual | Cuota semanal estándar | Para cuota > $250.000 |
|---|---|---|---|
| App (Ábaco) | > $3M | $150.000–$250.000 | Datacrédito completo |
| App (Ábaco) | $1M–$2.999.999 | $150.000–$180.000 | Datacrédito completo |
| No-App | > $3M | $150.000–$250.000 | Datacrédito completo |
| No-App | < $2.999.999 | $150.000–$180.000 | cubierto por perfil |

→ Config: tabla `pricing.installment_caps[]` (perfil, banda de ingreso, min, max, requisito). El
canon global $150k–$300k aplica a ambos modelos (renting y RTO).

### 4.4 El simulador (calculadora) — a backend, con dos hallazgos

**Renting (hoja 1):** `precio = (costo + alistamiento 1.5M) × (1+margen 1x) × IVA 1.19` — la fórmula
del PRD **coincide exacto** con la quemada hoy en el front (`$14.360.920` para el ejemplo). Planes
por factor sobre la tarifa base: semanal 1.25x · mensual 1.0x · trimestral 0.94x.
⚠️ **Pregunta a Manuela:** el PRD no define cómo se deriva la **tarifa base** ($173.176) del precio
de venta — está en el Excel anexo (`Calculadora Renting VF.xlsx`); hay que extraer esa fórmula para
poder moverla a backend.

**Rent-to-own (hoja 2):** amortización francesa **semanal** sobre `valor a financiar` (costo +
alistamiento + extras + IVA − cuota inicial), tasa 1.8% mensual ≈ 0.4125% semanal.
⚠️ **C10 (hallazgo nuevo, verificado matemáticamente):** la tabla del PRD dice "12 meses = **12
semanas**", pero la cuota del ejemplo ($230.997) solo cierra con **52 semanas** (12 meses reales de
pagos semanales): `10.790.920 × 0.004125 / (1 − 1.004125⁻⁵²) = $230.997` ✓ (ídem 18m→78s: $162.078;
24m→104s: $127.815). **La columna "Semanas" del PRD está mal (12/18/24 debería decir 52/78/104)** —
cerrar con Manuela antes de programar el simulador.

→ Config: `pricing = { alistamiento, margen, iva, tasaMensual, planes[], extras }` por lender;
**cálculo en backend** (una sola fuente); el front solo renderiza.

### 4.5 Documentos, decisión y cobranza

| Pieza | PRD | Traducción |
|---|---|---|
| Docs renting | Contrato + Pagaré | `legalDocs.formalization` por lender (plantillas S3 + pdf-mapper, patrón Credifamilia generalizado) |
| Docs rent-to-own | + **Garantía mobiliaria** (prenda sin tenencia) | ídem, un doc más en la lista del lender RTO |
| Política de riesgo RTO | **Igual** a renting | plantilla de reglas **compartida** entre ambos lenders (D7) |
| Decisión | Aprobar / Validar codeudor / Rechazar | Etapa 2 (pantalla + rol + auditoría); "Validar codeudor" hoy NO tiene backend |
| Cobranza | Semanal vencida (viernes), WhatsApp 6 segmentos de mora, llamadas desde día 7 | **Workstream aparte** (servicing en `application`); `cutoff_type_id` no modela semanal → extender |
| Reporte Excel a Motai | Registro de cada solicitud | No está en código; probablemente lo reemplaza el panel del administrador (E2) |

---

## 5. Orden de ejecución (PRs chicos, Motai nunca deja de funcionar)

**Regla de compatibilidad:** cada paso introduce el mecanismo genérico **leyendo con fallback al
hardcode** (dual-read), se verifica E2E, y recién el último paso borra los hardcodes. El E2E de los
3 modos de Motai se corre ANTES de empezar (línea base) y después de cada PR.

| PR | Qué hace | Toca | Riesgo |
|---|---|---|---|
| **0** | Saneamiento (fixes de E0): borrar `GET scraping/init/gig-economy` roto (B14); unificar disparador dual (B1); persistir modo SIEMPRE (B3); matar `MOTAI_RENTING_ALLIED_MODE_ID=2` → leer por `code`+`allied_id` + **seeder de `allied_modes`** (B10/B18); decidir webhook Ábaco (B15); **persistir `average_income`** (B16 — barato acá, desbloquea E4) | backend | bajo |
| **1** | **Categoría de producto** en el catálogo (`crédito` / `arrendamiento`): columna/tabla nueva + seed para 158; los evaluadores leen categoría con fallback a `MOTAI_LENDER_IDS`/`isMotaiRenting` (dual-read) | backend + BD | medio |
| **2** | **Precio a backend**: endpoint de pricing por lender (config `alistamiento/margen/iva`); el front consume y borra las 2 copias de la fórmula | backend + front | medio |
| **3** | **Legal por config**: TyC ids → `config.legalDocs` (una sola fuente); plantillas de formalización por lender (generalizar patrón Credifamilia: `ENABLED_LENDERS_FOR_LEGAL` y slugs → config) | backend | medio |
| **4** | **Underwriting por config**: `skipBureau` / `incomeSources` / `documentTypes` leídos de la fila persistida del modo (no del string por request); PEP y laboral ficticia parametrizados | backend | **alto** (toca riesgo — fail-closed) |
| **5** | **Front sin strings de modo**: las 5 rutas que comparan `"motai-renting"` leen el `config` que ya viaja en `partner_modes`; branding/nationality/consentimientos a config | front | bajo |
| **6** | **Borrar los hardcodes**: caen `isMotaiRenting` (+ su plumbing B9 y whitelist OTP B7), `MOTAI_LENDER_IDS` (×2), strings de modo (×6), rutas `motai/` → genéricas con alias (B8), pantalla de modos si D6 lo confirma (el producto se elige en el marketplace) | ambos | medio |
| **7** | **Prueba de fuego**: alta de un 2º comercio (Alta) SOLO con filas de config + plantillas. Si algo pide código → es brecha del paso 1–6, se corrige allí | config | — |

**Criterios de salida (heredados del plan, E1):** (a) E2E de los 3 modos idéntico antes/después;
(b) `grep -ri "motai"` en lógica de negocio devuelve solo datos/seeds, no condicionales; (c) la
calculadora tiene UNA implementación (backend); (d) un comercio nuevo entra sin tocar código.

---

## 6. Qué NO entra en este pedido (y dónde queda)

- **IMEI / device-lock (MDM, Trustonic):** flujo de compra de celulares del allied Motai, árbol
  aparte — no se toca.
- **Panel/rol del administrador** (decide el comercio): Etapa 2 del plan; este doc solo deja los
  hogares de config listos.
- **Motor de decisión R1–R8 + codeudor + amortización** (MVP2): Etapa 4; la traducción del §4 deja
  las reglas listas para cargarse cuando el motor exista.
- **Cobranza semanal WhatsApp:** servicing (`application`), workstream aparte.

## 7. Preguntas a cerrar (con dueño)

| # | Pregunta | Dueño |
|---|---|---|
| C9 | Score mínimo titular: ¿400 (R3) o 0 (§5 del PRD)? | Manuela |
| **C10** | **La columna "Semanas" del simulador RTO está mal (12/18/24 ≠ meses; la cuota cierra con 52/78/104)** — confirmar | Manuela |
| C3/D5 | ¿"Datacrédito 100%" (R2) incluye a los PEP (thin-file por definición)? | negocio/compliance |
| — | Fórmula de la **tarifa base** del renting (está solo en el Excel anexo) | Manuela |
| D6 | ¿El producto se elige en el marketplace (cae la pantalla de modos)? | negocio/diseño |
| D7 | ¿Renting y RTO son 2 lenders del catálogo o 1 con flag "opción de compra"? (política idéntica → plantilla compartida) | negocio |
| #9 | ¿El reporte Excel a Motai existe fuera del repo o lo reemplaza el panel? | Manuela |
